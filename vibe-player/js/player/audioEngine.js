// --- /vibe-player/js/player/audioEngine.js --- // Updated Path
// Manages Web Audio API, AudioWorklet loading/communication, decoding, resampling, and playback control.
// Uses Rubberband WASM via an AudioWorkletProcessor for time-stretching and pitch/formant shifting.

/** @namespace AudioApp */
var AudioApp = AudioApp || {};

/**
 * @namespace AudioApp.audioEngine
 * @description Manages Web Audio API, AudioWorklet loading/communication,
 * decoding, resampling, and playback control.
 */
AudioApp.audioEngine = (function() {
    'use strict';

    // --- Web Audio API & Worklet State ---
    /** @type {AudioContext|null} The main AudioContext. */
    let audioCtx = null;
    /** @type {GainNode|null} Master gain node for volume control. */
    let gainNode = null;
    /** @type {AudioWorkletNode|null} The node hosting the Rubberband processor. */
    let workletNode = null;
    /** @type {AudioBuffer|null} The currently loaded and decoded audio buffer. */
    let currentDecodedBuffer = null;

    /** @type {boolean} Tracks the desired playback state (play/pause) sent to the worklet. */
    let isPlaying = false;
    /** @type {boolean} Indicates if the AudioWorklet processor is ready. */
    let workletReady = false;
    /** @type {number} Current playback time in seconds within the source audio, as tracked by the worklet or seek commands. */
    let currentWorkletTime = 0.0;
    /** @type {number} Current playback speed factor. */
    let currentPlaybackSpeed = 1.0;
    /** @type {number} Current pitch shift scale. */
    let currentPitchScale = 1.0;
    /** @type {number} Current formant shift scale. */
    let currentFormantScale = 1.0;

    // --- WASM Resources ---
    /** @type {ArrayBuffer|null} Stores the fetched WASM binary for Rubberband. */
    let wasmBinary = null;
    /** @type {string|null} Stores the text of the WASM loader script. */
    let loaderScriptText = null;


    /**
     * Initializes the Audio Engine: sets up AudioContext and pre-fetches WASM resources.
     * @public
     * @async
     * @returns {Promise<void>}
     */
    async function init() {
        console.log("AudioEngine: Initializing...");
        setupAudioContext();
        await preFetchWorkletResources();

        if (AudioApp.state) {
            AudioApp.state.subscribe('param:speed:changed', (newSpeed) => {
                AudioApp.audioEngine.setSpeed(newSpeed);
            });
            AudioApp.state.subscribe('param:pitch:changed', (newPitch) => {
                AudioApp.audioEngine.setPitch(newPitch);
            });
            AudioApp.state.subscribe('param:gain:changed', (newGain) => {
                AudioApp.audioEngine.setGain(newGain);
            });
            AudioApp.state.subscribe('status:isActuallyPlaying:changed', (nowPlaying) => {
                // Compare with internal isPlaying state to avoid redundant toggles if possible
                // This assumes 'this.isPlaying' refers to the local 'isPlaying' variable in this IIFE's scope.
                // If AudioApp.audioEngine.isPlaying() getter were available, it would be better.
                // For now, directly call togglePlayPause if the AppState differs from the engine's last known command state.
                // The togglePlayPause method itself handles the internal 'isPlaying' state.
                // This also means if something else (e.g. worklet event) changes internal 'isPlaying',
                // AppState might toggle it back if it's not in sync. This needs careful handling.
                // A simple approach: if AppState says "play" and engine isn't, play. If AppState says "pause" and engine is, pause.

                // Get current internal state (assuming isPlaying variable in this scope reflects it)
                const internalIsPlaying = isPlaying;
                if (internalIsPlaying !== nowPlaying) {
                    AudioApp.audioEngine.togglePlayPause(); // This will flip internal 'isPlaying' and command worklet
                }
            });
            console.log("AudioEngine: Subscribed to AppState changes.");
        } else {
            console.warn("AudioEngine: AppState not available for subscriptions during init.");
        }

        console.log("AudioEngine: Initialized.");
    }


    /**
     * Creates or resets the AudioContext and main GainNode.
     * @private
     * @returns {boolean} True if the AudioContext is ready, false otherwise.
     */
    function setupAudioContext() {
        if (audioCtx && audioCtx.state !== 'closed') { return true; }
        try {
            if (audioCtx && audioCtx.state === 'closed') {
                 console.log("AudioEngine: Recreating closed AudioContext.");
            }
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            gainNode = audioCtx.createGain();
            gainNode.gain.value = 1.0; // Default gain
            gainNode.connect(audioCtx.destination);
            workletNode = null; // Reset worklet node on context recreation
            workletReady = false;
            console.log(`AudioEngine: AudioContext created/reset (state: ${audioCtx.state}). Sample Rate: ${audioCtx.sampleRate}Hz`);
            if (audioCtx.state === 'suspended') {
                 console.warn("AudioEngine: AudioContext is suspended. User interaction (e.g., click) is needed to resume audio playback.");
            }
            return true;
        } catch (e) {
             console.error("AudioEngine: Failed to create AudioContext.", e);
             audioCtx = null; gainNode = null; workletNode = null; workletReady = false;
             dispatchEngineEvent('audioapp:engineError', { type: 'context', error: new Error("Web Audio API not supported or context creation failed.") });
             return false;
        }
    }

    /**
     * Pre-fetches WASM binary and loader script for the AudioWorklet.
     * Uses paths from `AudioApp.Constants`.
     * @private
     * @async
     * @returns {Promise<void>}
     */
    async function preFetchWorkletResources() {
        console.log("AudioEngine: Pre-fetching WASM resources...");
        try {
            if (typeof Constants === 'undefined') {
                throw new Error("Constants class not found. Cannot fetch resources.");
            }
            const wasmResponse = await fetch(Constants.AudioEngine.WASM_BINARY_URL);
            if (!wasmResponse.ok) throw new Error(`Fetch failed (${wasmResponse.status}) for WASM binary: ${Constants.AudioEngine.WASM_BINARY_URL}`);
            wasmBinary = await wasmResponse.arrayBuffer();

            const loaderResponse = await fetch(Constants.AudioEngine.LOADER_SCRIPT_URL);
            if (!loaderResponse.ok) throw new Error(`Fetch failed (${loaderResponse.status}) for Loader script: ${Constants.AudioEngine.LOADER_SCRIPT_URL}`);
            loaderScriptText = await loaderResponse.text();
            console.log("AudioEngine: WASM resources fetched successfully.");
        } catch (fetchError) {
            console.error("AudioEngine: Failed to fetch WASM/Loader resources:", fetchError);
            wasmBinary = null; loaderScriptText = null; // Ensure resources are null on error
            dispatchEngineEvent('audioapp:engineError', { type: 'resource', error: fetchError });
        }
    }


    /**
     * Loads an audio file, decodes it, and sets up the AudioWorklet for playback.
     * @public
     * @async
     * @param {File} file - The audio file to load.
     * @returns {Promise<void>} Resolves when setup is complete.
     * @throws {Error} If any critical step fails (e.g., context creation, decoding, worklet setup).
     */
     async function loadAndProcessFile(file) {
        if (!audioCtx || audioCtx.state === 'closed') {
             if (!setupAudioContext()) { throw new Error("AudioContext could not be created/reset for loading file."); }
        }
        if (audioCtx.state === 'suspended') { // Attempt to resume context if suspended
             await audioCtx.resume().catch(e => console.warn("AudioEngine: Context resume failed during load.", e));
             if (audioCtx.state !== 'running') {
                 throw new Error(`AudioContext could not be resumed (state: ${audioCtx.state}). User interaction might be required.`);
             }
        }

        await cleanupCurrentWorklet(); // Clean up any existing worklet instance
        currentDecodedBuffer = null; isPlaying = false; currentWorkletTime = 0.0; currentFormantScale = 1.0;

        try {
            const arrayBuffer = await file.arrayBuffer();
            currentDecodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            dispatchEngineEvent('audioapp:audioLoaded', { audioBuffer: currentDecodedBuffer });

            if (!wasmBinary || !loaderScriptText) {
                throw new Error("Cannot setup Worklet: WASM/Loader resources are missing. Ensure preFetchWorkletResources succeeded.");
            }
            await setupAndStartWorklet(currentDecodedBuffer);
        } catch (error) {
            console.error("AudioEngine: Error during load/decode/worklet setup:", error);
            currentDecodedBuffer = null;
            const errorType = error.message.includes("decodeAudioData") ? 'decodingError'
                              : error.message.includes("Worklet") ? 'workletError'
                              : 'loadError';
            dispatchEngineEvent(`audioapp:${errorType}`, { error: error });
            throw error; // Re-throw for the caller (app.js) to handle UI state
        }
    }

    /**
     * Resamples an AudioBuffer to 16kHz mono Float32Array using OfflineAudioContext.
     * @private
     * @param {AudioBuffer} audioBuffer - The original decoded audio buffer.
     * @returns {Promise<Float32Array>} A promise resolving to the resampled PCM data.
     */
    function convertAudioBufferTo16kHzMonoFloat32(audioBuffer) {
        if (typeof Constants === 'undefined') return Promise.reject(new Error("Constants class not found for resampling."));
        const targetSampleRate = Constants.VAD.SAMPLE_RATE;
        const targetLength = Math.ceil(audioBuffer.duration * targetSampleRate);

        if (!targetLength || targetLength <= 0) return Promise.resolve(new Float32Array(0));

        try {
            const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
            const src = offlineCtx.createBufferSource();
            src.buffer = audioBuffer;
            src.connect(offlineCtx.destination);
            src.start();
            return offlineCtx.startRendering().then(renderedBuffer => renderedBuffer.getChannelData(0))
                .catch(err => { throw new Error(`Audio resampling rendering failed: ${err.message}`); });
        } catch (offlineCtxError) {
            return Promise.reject(new Error(`OfflineContext creation failed: ${offlineCtxError.message}`));
        }
    }

    /**
     * Public wrapper to resample an AudioBuffer to 16kHz mono Float32Array.
     * @public
     * @async
     * @param {AudioBuffer} audioBuffer - The original decoded audio buffer.
     * @returns {Promise<Float32Array>} A promise resolving to the resampled PCM data.
     */
    async function resampleTo16kMono(audioBuffer) {
        console.log("AudioEngine: Resampling audio to 16kHz mono...");
        try {
             const pcm16k = await convertAudioBufferTo16kHzMonoFloat32(audioBuffer);
             console.log(`AudioEngine: Resampled to ${pcm16k.length} samples @ 16kHz.`);
             return pcm16k;
        } catch(error) {
             console.error("AudioEngine: Error during public resampling call:", error);
             dispatchEngineEvent('audioapp:resamplingError', { error: error });
             throw error;
        }
    }


    /**
     * Cleans up the current AudioWorkletNode: sends a 'cleanup' message,
     * removes listeners, and disconnects the node.
     * @private
     * @async
     * @returns {Promise<void>}
     */
    async function cleanupCurrentWorklet() {
        workletReady = false;
        if (workletNode) {
            console.log("[AudioEngine] Cleaning up previous worklet node...");
            try {
                postWorkletMessage({ type: 'cleanup' });
                await new Promise(resolve => setTimeout(resolve, 50)); // Brief delay for message processing

                if (workletNode.port) { // Check if port still exists
                    workletNode.port.onmessage = null;
                }
                workletNode.onprocessorerror = null;
                workletNode.disconnect();
            } catch (e) {
                console.warn("[AudioEngine] Error during worklet cleanup:", e);
            } finally {
                workletNode = null;
            }
        }
    }

    /**
     * Sets up the AudioWorklet processor: adds the module, creates the node,
     * connects it, and sends initial configuration and audio data.
     * @private
     * @async
     * @param {AudioBuffer} decodedBuffer - The audio buffer to process.
     * @returns {Promise<void>}
     * @throws {Error} If prerequisites are missing or setup fails.
     */
    async function setupAndStartWorklet(decodedBuffer) {
        if (!audioCtx || !decodedBuffer || !wasmBinary || !loaderScriptText || !gainNode || typeof Constants === 'undefined') {
            throw new Error("Cannot setup worklet - prerequisites missing.");
        }
        await cleanupCurrentWorklet(); // Ensure previous instance is cleared

        try {
            await audioCtx.audioWorklet.addModule(Constants.AudioEngine.PROCESSOR_SCRIPT_URL);
            const wasmBinaryTransfer = wasmBinary.slice(0); // Create a transferable copy
            const processorOpts = {
                sampleRate: audioCtx.sampleRate,
                numberOfChannels: decodedBuffer.numberOfChannels,
                wasmBinary: wasmBinaryTransfer,
                loaderScriptText: loaderScriptText
            };

            workletNode = new AudioWorkletNode(audioCtx, Constants.AudioEngine.PROCESSOR_NAME, {
                numberOfInputs: 0, numberOfOutputs: 1,
                outputChannelCount: [decodedBuffer.numberOfChannels],
                processorOptions: processorOpts
            });

            setupWorkletMessageHandler();
            workletNode.onprocessorerror = (event) => {
                console.error(`[AudioEngine] Critical Processor Error:`, event);
                dispatchEngineEvent('audioapp:engineError', { type: 'workletProcessor', error: new Error("Processor crashed or encountered a critical error.") });
                cleanupCurrentWorklet(); workletReady = false; isPlaying = false;
                dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: false });
            };

            workletNode.connect(gainNode);

            const channelData = []; const transferListAudio = [];
            for (let i = 0; i < decodedBuffer.numberOfChannels; i++) {
                const dataArray = decodedBuffer.getChannelData(i);
                const bufferCopy = dataArray.buffer.slice(dataArray.byteOffset, dataArray.byteOffset + dataArray.byteLength);
                channelData.push(bufferCopy);
                transferListAudio.push(bufferCopy);
            }
            postWorkletMessage({ type: 'load-audio', channelData: channelData }, transferListAudio);
        } catch (error) {
            console.error("[AudioEngine] Error setting up Worklet Node:", error);
            await cleanupCurrentWorklet();
            throw error;
        }
    }

    /**
     * Sets up the message handler for communication from the AudioWorkletProcessor.
     * @private
     */
    function setupWorkletMessageHandler() {
        if (!workletNode?.port) return;
        workletNode.port.onmessage = (event) => {
            const data = event.data;
            switch(data.type) {
                case 'status':
                    console.log(`[WorkletStatus] ${data.message}`);
                    if (data.message === 'processor-ready') {
                        workletReady = true; dispatchEngineEvent('audioapp:workletReady');
                    } else if (data.message === 'Playback ended') {
                        dispatchEngineEvent('audioapp:playbackEnded');
                    } else if (data.message === 'Processor cleaned up') {
                        workletReady = false; isPlaying = false;
                    }
                    break;
                case 'error':
                    console.error(`[WorkletError] ${data.message}`);
                    dispatchEngineEvent('audioapp:engineError', { type: 'workletRuntime', error: new Error(data.message) });
                    workletReady = false; isPlaying = false;
                    dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: false });
                    break;
                case 'playback-state':
                    dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: data.isPlaying });
                    break;
                case 'time-update':
                    if (typeof data.currentTime === 'number' && currentDecodedBuffer) {
                        currentWorkletTime = data.currentTime;
                    }
                    break;
                default:
                    console.warn("[AudioEngine] Unhandled message from worklet:", data.type, data);
            }
        };
    }

    /**
     * Safely posts a message to the AudioWorkletProcessor.
     * @private
     * @param {object} message - The message object.
     * @param {Transferable[]} [transferList=[]] - Optional array of transferable objects.
     */
    function postWorkletMessage(message, transferList = []) {
        if (workletNode?.port) {
            try {
                workletNode.port.postMessage(message, transferList);
            } catch (error) {
                console.error("[AudioEngine] Error posting message to worklet:", error, "Message type:", message.type);
                if (message.type !== 'cleanup') { // Avoid error loops on cleanup
                    dispatchEngineEvent('audioapp:engineError', { type: 'workletComm', error: error });
                }
                cleanupCurrentWorklet(); workletReady = false; isPlaying = false;
                dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: false });
            }
        } else {
            if (workletReady || message.type !== 'cleanup') { // Don't warn if not ready and trying to cleanup
                console.warn(`[AudioEngine] Cannot post message (${message.type}): Worklet node or port not available.`);
            }
        }
    }


    /**
     * Toggles the playback state (play/pause).
     * @public
     * @async
     * @returns {Promise<void>}
     */
    async function togglePlayPause() {
        if (!workletReady || !audioCtx) {
            console.warn("AudioEngine: Cannot toggle play/pause - Worklet or AudioContext not ready."); return;
        }
        if (audioCtx.state === 'suspended') {
            try { await audioCtx.resume(); }
            catch (err) {
                dispatchEngineEvent('audioapp:engineError', { type: 'contextResume', error: err }); return;
            }
        }
        if (audioCtx.state !== 'running') {
             console.error(`AudioEngine: AudioContext not running (state: ${audioCtx.state}). Cannot toggle playback.`); return;
        }
        const targetIsPlaying = !isPlaying;
        postWorkletMessage({ type: targetIsPlaying ? 'play' : 'pause' });
        isPlaying = targetIsPlaying; // Update desired state
    }

    /**
     * Jumps playback position relative to the current source time.
     * @public
     * @param {number} seconds - Seconds to jump (positive or negative).
     */
    function jumpBy(seconds) {
        if (!workletReady || !currentDecodedBuffer) return;
        seek(currentWorkletTime + seconds);
    }

    /**
     * Seeks playback to an absolute time in seconds within the source audio.
     * @public
     * @param {number} time - The target time in seconds.
     */
    function seek(time) {
        if (!workletReady || !currentDecodedBuffer || isNaN(currentDecodedBuffer.duration)) return;
        const targetTime = Math.max(0, Math.min(time, currentDecodedBuffer.duration));
        postWorkletMessage({ type: 'seek', positionSeconds: targetTime });
        currentWorkletTime = targetTime; // Update internal time immediately
    }

    /**
     * Sets the playback speed (rate).
     * @public
     * @param {number} speed - Desired playback speed (e.g., 1.0 for normal).
     */
    function setSpeed(speed) {
         const rate = Math.max(0.25, Math.min(parseFloat(String(speed)) || 1.0, 2.0));
         if (currentPlaybackSpeed !== rate) {
             currentPlaybackSpeed = rate;
             if (workletReady) postWorkletMessage({ type: 'set-speed', value: rate });
             dispatchEngineEvent('audioapp:internalSpeedChanged', { speed: rate });
         }
    }

    /**
     * Sets the pitch shift scale.
     * @public
     * @param {number} pitch - Desired pitch scale (e.g., 1.0 for normal).
     */
    function setPitch(pitch) {
        const scale = Math.max(0.25, Math.min(parseFloat(String(pitch)) || 1.0, 2.0));
        if (currentPitchScale !== scale) {
            currentPitchScale = scale;
            if (workletReady) postWorkletMessage({ type: 'set-pitch', value: scale });
        }
    }

    /**
     * Sets the formant shift scale.
     * @public
     * @param {number} formant - Desired formant scale (e.g., 1.0 for normal).
     */
    function setFormant(formant) {
        const scale = Math.max(0.5, Math.min(parseFloat(String(formant)) || 1.0, 2.0));
        if (currentFormantScale !== scale) {
            currentFormantScale = scale;
            if (workletReady) postWorkletMessage({ type: 'set-formant', value: scale });
        }
    }

    /**
     * Sets the master gain (volume) level.
     * @public
     * @param {number} gain - Desired gain level (0.0 to 5.0, 1.0 is normal).
     */
    function setGain(gain) {
        if (!gainNode || !audioCtx || audioCtx.state === 'closed') return;
        const value = Math.max(0.0, Math.min(parseFloat(String(gain)) || 1.0, 5.0));
        gainNode.gain.setTargetAtTime(value, audioCtx.currentTime, 0.015); // Smooth transition
    }

    /**
     * Gets the current playback time (source time) and total duration.
     * @public
     * @returns {{currentTime: number, duration: number}}
     */
    function getCurrentTime() {
        return {
            currentTime: currentWorkletTime,
            duration: currentDecodedBuffer?.duration || 0
        };
    }

    /**
     * Returns the active AudioContext instance.
     * @public
     * @returns {AudioContext|null}
     */
    function getAudioContext() {
        return audioCtx;
    }


    /**
     * Cleans up all audio resources.
     * @public
     */
    function cleanup() {
        console.log("AudioEngine: Cleaning up resources...");
        cleanupCurrentWorklet().finally(() => {
            if (audioCtx && audioCtx.state !== 'closed') {
                audioCtx.close().then(() => console.log("AudioEngine: AudioContext closed."))
                           .catch(e => console.warn("AudioEngine: Error closing AudioContext:", e));
            }
            audioCtx = null; gainNode = null; workletNode = null; currentDecodedBuffer = null;
            wasmBinary = null; loaderScriptText = null;
            workletReady = false; isPlaying = false;
            currentWorkletTime = 0.0; currentPlaybackSpeed = 1.0; currentPitchScale = 1.0; currentFormantScale = 1.0;
        });
    }


    /**
     * Dispatches a custom event on the document.
     * @private
     * @param {string} eventName - The name of the event.
     * @param {Object<string, any>} [detail={}] - Data to pass with the event.
     */
    function dispatchEngineEvent(eventName, detail = {}) {
        document.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
    }

    /**
     * @typedef {Object} AudioEnginePublicInterface
     * @property {function(): Promise<void>} init
     * @property {function(File): Promise<void>} loadAndProcessFile
     * @property {function(AudioBuffer): Promise<Float32Array>} resampleTo16kMono
     * @property {function(): Promise<void>} togglePlayPause
     * @property {function(number): void} jumpBy
     * @property {function(number): void} seek
     * @property {function(number): void} setSpeed
     * @property {function(number): void} setPitch
     * @property {function(number): void} setFormant
     * @property {function(number): void} setGain
     * @property {function(): {currentTime: number, duration: number}} getCurrentTime
     * @property {function(): (AudioContext|null)} getAudioContext
     * @property {function(): void} cleanup
     */

    /** @type {AudioEnginePublicInterface} */
    return {
        init: init,
        loadAndProcessFile: loadAndProcessFile,
        resampleTo16kMono: resampleTo16kMono,
        togglePlayPause: togglePlayPause,
        jumpBy: jumpBy,
        seek: seek,
        setSpeed: setSpeed,
        setPitch: setPitch,
        setFormant: setFormant,
        setGain: setGain,
        getCurrentTime: getCurrentTime,
        getAudioContext: getAudioContext,
        cleanup: cleanup
    };
})();
// --- /vibe-player/js/player/audioEngine.js --- // Updated Path
