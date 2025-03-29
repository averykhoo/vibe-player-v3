// --- /vibe-player/js/audioEngine.js ---
// Manages Web Audio API, AudioWorklet loading/communication, decoding, resampling, and playback control.
// Uses Rubberband WASM via an AudioWorkletProcessor for time-stretching.

var AudioApp = AudioApp || {}; // Ensure namespace exists

AudioApp.audioEngine = (function() {
    'use strict';

    // --- Web Audio API & Worklet State ---
    /** @type {AudioContext|null} The single, persistent audio context */
    let audioCtx = null;
    /** @type {GainNode|null} Node for controlling volume */
    let gainNode = null;
    /** @type {AudioWorkletNode|null} Node running the Rubberband processor */
    let workletNode = null;
    /** @type {AudioBuffer|null} Cache the original decoded buffer */
    let currentDecodedBuffer = null;
    /** @type {string|null} Stores the Object URL if needed for other purposes (currently not) */
    // let currentObjectURL = null; // Keep commented unless needed

    /** @type {boolean} Internal track of *desired* playback state (sent to worklet) */
    let isPlaying = false;
    /** @type {boolean} Tracks if the worklet is ready to process audio */
    let workletReady = false;
    /** @type {number} Stores the current playback time *reported by the worklet* */
    let currentWorkletTime = 0.0;
    /** @type {number} Stores the target playback speed */
    let currentPlaybackSpeed = 1.0;

    // --- WASM Resources ---
    /** @type {ArrayBuffer|null} Fetched WASM binary for Rubberband */
    let wasmBinary = null;
    /** @type {string|null} Fetched loader script text for Rubberband */
    let loaderScriptText = null;

    // --- Constants ---
    /** @const {string} Path to the worklet processor script */
    const PROCESSOR_SCRIPT_URL = 'js/rubberbandProcessor.js';
    /** @const {string} Name of the worklet processor */
    const PROCESSOR_NAME = 'rubberband-processor'; // Match the name registered in the processor script
    /** @const {string} Path to the WASM binary */
    const WASM_BINARY_URL = 'lib/rubberband.wasm';
    /** @const {string} Path to the WASM loader script */
    const LOADER_SCRIPT_URL = 'lib/rubberband-loader.js';

    // --- Initialization ---

    /**
     * Initializes the Audio Engine: creates context, fetches WASM/loader resources.
     * @public
     */
    async function init() {
        console.log("AudioEngine: Initializing...");
        setupAudioContext(); // Create AudioContext and GainNode
        await preFetchWorkletResources(); // Fetch WASM and loader script early
        console.log("AudioEngine: Initialized.");
    }

    // --- Setup & Resource Fetching ---

    /**
     * Creates the persistent AudioContext and GainNode if they don't exist or are closed.
     * @private
     * @returns {boolean} True if context is ready, false otherwise.
     */
    function setupAudioContext() {
        if (audioCtx && audioCtx.state !== 'closed') {
            console.log("AudioEngine: AudioContext already exists and is open.");
            return true;
        }
        try {
            if (audioCtx && audioCtx.state === 'closed') {
                console.log("AudioEngine: Recreating closed AudioContext.");
            }
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            gainNode = audioCtx.createGain();
            gainNode.gain.value = 1.0;
            gainNode.connect(audioCtx.destination);
            workletNode = null; // Reset worklet node ref when context changes
            workletReady = false;
            console.log(`AudioEngine: AudioContext created/reset (state: ${audioCtx.state}).`);
            if (audioCtx.state === 'suspended') {
                console.warn("AudioEngine: AudioContext is suspended. User interaction needed to start/resume playback.");
            }
            return true;
        } catch (e) {
            console.error("AudioEngine: Failed to create AudioContext.", e);
            audioCtx = null; gainNode = null; workletNode = null; workletReady = false;
            dispatchEngineEvent('audioapp:engineError', { type: 'context', error: new Error("Web Audio API not supported or context creation failed") });
            return false;
        }
    }

    /**
     * Fetches the WASM binary and loader script needed by the worklet.
     * Stores them in module variables. Runs once during init.
     * @private
     * @returns {Promise<void>}
     */
    async function preFetchWorkletResources() {
        console.log("AudioEngine: Pre-fetching WASM resources...");
        try {
            // Fetch WASM binary
            const wasmResponse = await fetch(WASM_BINARY_URL);
            if (!wasmResponse.ok) throw new Error(`Fetch failed ${wasmResponse.status} for ${WASM_BINARY_URL}`);
            wasmBinary = await wasmResponse.arrayBuffer();
            console.log(`AudioEngine: Fetched WASM binary (${wasmBinary.byteLength} bytes).`);

            // Fetch Loader Script text
            const loaderResponse = await fetch(LOADER_SCRIPT_URL);
            if (!loaderResponse.ok) throw new Error(`Fetch failed ${loaderResponse.status} for ${LOADER_SCRIPT_URL}`);
            loaderScriptText = await loaderResponse.text();
            console.log(`AudioEngine: Fetched Loader Script text (${loaderScriptText.length} chars).`);
        } catch (fetchError) {
            console.error("AudioEngine: Failed to fetch WASM/Loader resources:", fetchError);
            wasmBinary = null;
            loaderScriptText = null;
            dispatchEngineEvent('audioapp:engineError', { type: 'resource', error: fetchError });
            // App will be functional but playback stretching won't work.
        }
    }

    // --- Loading, Decoding, Resampling Pipeline ---

    /**
     * Loads a File, decodes, resamples for VAD, and sets up the AudioWorklet.
     * @param {File} file - The audio file selected by the user.
     * @returns {Promise<void>} A promise that resolves when basic loading/decoding is done or rejects on error.
     * @throws {Error} If context is unavailable or initial processing fails.
     * @public
     */
    async function loadAndProcessFile(file) {
        // Ensure context exists
        if (!audioCtx || audioCtx.state === 'closed') {
            console.error("AudioEngine: AudioContext not available for loading file.");
            if (!setupAudioContext()) {
                throw new Error("AudioContext could not be created/reset.");
            }
        }
        // Resume context if suspended (might need user interaction later)
        if (audioCtx.state === 'suspended') {
           await audioCtx.resume().catch(e => console.warn("AudioEngine: Attempted context resume failed during load.", e));
        }

        // --- Reset State ---
        await cleanupCurrentWorklet(); // Clean up previous worklet if any
        currentDecodedBuffer = null;
        isPlaying = false;
        currentWorkletTime = 0.0;

        // --- Decode Audio ---
        try {
            const arrayBuffer = await file.arrayBuffer();
            console.log("AudioEngine: Decoding audio data...");
            currentDecodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            console.log(`AudioEngine: Decoded ${currentDecodedBuffer.duration.toFixed(2)}s @ ${currentDecodedBuffer.sampleRate}Hz`);
            dispatchEngineEvent('audioapp:audioLoaded', { audioBuffer: currentDecodedBuffer });

            // --- Resample for VAD (Separate Offline Context) ---
            console.log("AudioEngine: Resampling audio for VAD...");
            const pcm16k = await convertAudioBufferTo16kHzMonoFloat32(currentDecodedBuffer);
            console.log(`AudioEngine: Resampled to ${pcm16k.length} samples @ 16kHz`);
            dispatchEngineEvent('audioapp:resamplingComplete', { pcmData: pcm16k });

            // --- Setup Worklet (after decoding & resampling) ---
            if (!wasmBinary || !loaderScriptText) {
                throw new Error("Cannot setup Worklet: WASM/Loader resources missing.");
            }
            await setupAndStartWorklet(currentDecodedBuffer); // Now pass the buffer

        } catch (error) {
            console.error("AudioEngine: Error during load/decode/resample/worklet setup:", error);
            currentDecodedBuffer = null;
            const errorType = error.message.includes("decodeAudioData") ? 'decodingError' :
                              error.message.includes("resampling") ? 'resamplingError' :
                              error.message.includes("Worklet") ? 'workletError' : 'loadError';
            dispatchEngineEvent(`audioapp:${errorType}`, { error: error });
            throw error; // Re-throw for app.js
        }
    }

    /**
     * Resampling function (remains the same as before).
     * @param {AudioBuffer} audioBuffer
     * @returns {Promise<Float32Array>}
     * @throws {Error}
     * @private
     */
    function convertAudioBufferTo16kHzMonoFloat32(audioBuffer) {
        const targetSampleRate = 16000;
        const targetLength = Math.ceil(audioBuffer.duration * targetSampleRate);
        if (!targetLength || targetLength <= 0) {
            console.warn("AudioEngine: Calculated zero length for resampling, returning empty array.");
            return Promise.resolve(new Float32Array(0));
        }
        try {
            const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
            const src = offlineCtx.createBufferSource();
            src.buffer = audioBuffer;
            src.connect(offlineCtx.destination);
            src.start();
            return offlineCtx.startRendering().then(renderedBuffer => {
                return renderedBuffer.getChannelData(0);
            }).catch(err => {
                console.error("AudioEngine: Error during audio resampling:", err);
                throw new Error(`Audio resampling failed: ${err.message}`);
            });
        } catch (offlineCtxError) {
             console.error("AudioEngine: Error creating OfflineAudioContext for resampling:", offlineCtxError);
             return Promise.reject(new Error(`Failed to create OfflineContext for resampling: ${offlineCtxError.message}`));
        }
    }

    // --- AudioWorklet Setup and Communication ---

    /**
     * Cleans up the existing AudioWorkletNode if it exists.
     * @private
     * @returns {Promise<void>}
     */
    async function cleanupCurrentWorklet() {
        workletReady = false; // Mark as not ready
        if (workletNode) {
            console.log("[AudioEngine] Cleaning up previous worklet node...");
            try {
                postWorkletMessage({ type: 'cleanup' }); // Ask processor to clean itself up
                // Give a brief moment for the message to potentially be processed
                await new Promise(resolve => setTimeout(resolve, 50));
                workletNode.port.onmessage = null; // Remove listener
                workletNode.onprocessorerror = null;
                workletNode.disconnect(); // Disconnect from GainNode
                console.log("[AudioEngine] Previous worklet node disconnected.");
            } catch (e) {
                console.warn("[AudioEngine] Error during worklet cleanup:", e);
            } finally {
                workletNode = null; // Nullify the reference
            }
        }
    }

    /**
     * Sets up the AudioWorklet module, creates the node, and sends initial data.
     * @param {AudioBuffer} decodedBuffer - The original decoded audio buffer.
     * @private
     * @returns {Promise<void>}
     */
    async function setupAndStartWorklet(decodedBuffer) {
        if (!audioCtx || !decodedBuffer || !wasmBinary || !loaderScriptText || !gainNode) {
            throw new Error("Cannot setup worklet - missing context, buffer, WASM resources, or gain node.");
        }

        await cleanupCurrentWorklet(); // Ensure any old one is gone

        try {
            console.log(`[AudioEngine] Adding AudioWorklet module: ${PROCESSOR_SCRIPT_URL}`);
            await audioCtx.audioWorklet.addModule(PROCESSOR_SCRIPT_URL);
            console.log("[AudioEngine] AudioWorklet module added.");

            // Prepare data for processor options - create a transferable copy of WASM binary
            const wasmBinaryTransfer = wasmBinary.slice(0);
            const processorOpts = {
                sampleRate: audioCtx.sampleRate,
                numberOfChannels: decodedBuffer.numberOfChannels,
                wasmBinary: wasmBinaryTransfer, // Pass copy
                loaderScriptText: loaderScriptText // Pass text (cloned)
            };
            const transferListWasm = [wasmBinaryTransfer]; // List for transfer

            console.log("[AudioEngine] Creating AudioWorkletNode...");
            workletNode = new AudioWorkletNode(audioCtx, PROCESSOR_NAME, {
                numberOfInputs: 0, // No external input nodes feeding into it
                numberOfOutputs: 1,
                outputChannelCount: [decodedBuffer.numberOfChannels], // Match source
                processorOptions: processorOpts
            }); // Note: transferList is NOT specified here, it's for postMessage

            // Setup message handling *before* sending data
            setupWorkletMessageHandler();

            workletNode.onprocessorerror = (event) => {
                console.error(`[AudioEngine] Critical Processor Error event:`, event);
                dispatchEngineEvent('audioapp:engineError', { type: 'workletProcessor', error: new Error("Processor crashed") });
                cleanupCurrentWorklet(); // Attempt cleanup
                workletReady = false; isPlaying = false;
                dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: false });
            };

            // Connect worklet output to the gain node
            workletNode.connect(gainNode);
            console.log("[AudioEngine] AudioWorkletNode created and connected to GainNode.");

            // Prepare audio channel data for transfer
            const channelData = [];
            const transferListAudio = [];
            for (let i = 0; i < decodedBuffer.numberOfChannels; i++) {
                const dataArray = decodedBuffer.getChannelData(i);
                // Create a *copy* to transfer, leaving original buffer intact
                const bufferCopy = dataArray.buffer.slice(dataArray.byteOffset, dataArray.byteOffset + dataArray.byteLength);
                channelData.push(bufferCopy);
                transferListAudio.push(bufferCopy);
            }

            // Send WASM binary (already prepared) and audio data
            console.log(`[AudioEngine] Sending audio channel data (${channelData.length}) to worklet...`);
            postWorkletMessage({
                type: 'load-audio',
                channelData: channelData // Send copies
            }, transferListAudio); // Transfer ownership of the copies

            // The 'processor-ready' message from the worklet will set workletReady = true

        } catch (error) {
            console.error("[AudioEngine] Error setting up Worklet Node:", error);
            await cleanupCurrentWorklet(); // Clean up if setup fails
            throw error; // Re-throw
        }
    }

    /**
     * Sets up the onmessage handler for the current workletNode.
     * @private
     */
    function setupWorkletMessageHandler() {
        if (!workletNode) return;

        workletNode.port.onmessage = (event) => {
            const data = event.data;
             // console.log("[AudioEngine] Received message from worklet:", data.type); // DEBUG

            switch(data.type) {
                case 'status':
                    console.log(`[WorkletStatus] ${data.message}`);
                    if (data.message === 'processor-ready') {
                        workletReady = true;
                        dispatchEngineEvent('audioapp:workletReady'); // Inform app.js
                    } else if (data.message === 'Playback ended') {
                        isPlaying = false; // Update state based on worklet event
                        currentWorkletTime = 0; // Reset time on end
                        dispatchEngineEvent('audioapp:playbackEnded');
                        dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: false });
                    } else if (data.message === 'Processor cleaned up') {
                        workletReady = false;
                        isPlaying = false;
                    }
                    break;
                case 'error':
                    console.error(`[WorkletError] ${data.message}`);
                    dispatchEngineEvent('audioapp:engineError', { type: 'workletRuntime', error: new Error(data.message) });
                    // Optionally trigger cleanup here?
                    workletReady = false; isPlaying = false;
                    dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: false });
                    break;
                case 'playback-state':
                    // console.log(`[AudioEngine] Worklet confirmed playback state: ${data.isPlaying}`);
                    // Update UI/app state based on *worklet's* confirmation
                    if (isPlaying !== data.isPlaying) {
                         console.warn(`[AudioEngine] Discrepancy between desired (${isPlaying}) and worklet (${data.isPlaying}) state.`);
                         isPlaying = data.isPlaying; // Sync desired state to worklet reality
                    }
                    dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: data.isPlaying });
                    break;
                case 'time-update':
                    // Receive time updates from the worklet
                    if (typeof data.currentTime === 'number' && currentDecodedBuffer) {
                        currentWorkletTime = data.currentTime;
                        dispatchEngineEvent('audioapp:timeUpdated', { currentTime: currentWorkletTime, duration: currentDecodedBuffer.duration });
                    }
                    break;
                default:
                    console.warn("[AudioEngine] Unhandled message type from worklet:", data.type);
            }
        };
    }

    /**
     * Helper to send messages to the worklet port.
     * @param {object} message - The message object to send.
     * @param {Transferable[]} [transferList=[]] - Optional array of transferable objects.
     * @private
     */
    function postWorkletMessage(message, transferList = []) {
        if (workletNode && workletNode.port) {
            try {
                // console.log("[AudioEngine] Posting message to worklet:", message.type); // DEBUG
                workletNode.port.postMessage(message, transferList);
            } catch (error) {
                console.error("[AudioEngine] Error posting message to worklet:", error);
                dispatchEngineEvent('audioapp:engineError', { type: 'workletComm', error: error });
                // Handle communication error - maybe cleanup?
                cleanupCurrentWorklet();
                workletReady = false; isPlaying = false;
                dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: false });
            }
        } else {
            // Only warn if we expected the worklet to be ready
            if (workletReady || message.type !== 'cleanup') {
                console.warn(`[AudioEngine] Cannot post message (${message.type}): Worklet node or port not available.`);
            }
        }
    }

    // --- Playback Control Methods (Public) ---

    /**
     * Toggles the playback state by sending a message to the worklet.
     * Also handles AudioContext resuming on user interaction.
     * @public
     */
    async function togglePlayPause() {
        if (!workletReady) {
            console.warn("AudioEngine: Cannot toggle play/pause - worklet not ready.");
            return;
        }
        // --- Resume AudioContext on User Interaction ---
        if (audioCtx && audioCtx.state === 'suspended') {
            console.log("[AudioEngine] Attempting to resume AudioContext on user interaction...");
            try {
                await audioCtx.resume();
                console.log("[AudioEngine] AudioContext resumed. State:", audioCtx.state);
            } catch (err) {
                console.error("[AudioEngine] Failed to resume AudioContext:", err);
                dispatchEngineEvent('audioapp:engineError', { type: 'contextResume', error: err });
                return; // Don't proceed if context couldn't resume
            }
        }
        if (!audioCtx || audioCtx.state !== 'running') {
            console.error(`AudioEngine: Cannot play/pause - AudioContext not running (state: ${audioCtx?.state}).`);
            return;
        }
        // --- End Resume Logic ---

        const targetIsPlaying = !isPlaying; // Target state based on *our* tracked state
        postWorkletMessage({ type: targetIsPlaying ? 'play' : 'pause' });
        isPlaying = targetIsPlaying; // Update desired state immediately
        // UI update will happen when worklet confirms via 'playback-state' message
        console.log(`[AudioEngine] Sent ${targetIsPlaying ? 'play' : 'pause'} message.`);
    }

    /**
     * Jumps the playback position by a specified number of seconds.
     * @param {number} seconds - The amount to jump (positive or negative).
     * @public
     */
    function jumpBy(seconds) {
        if (!workletReady || !currentDecodedBuffer) {
            console.warn("AudioEngine: Cannot jump - worklet not ready or no audio loaded.");
            return;
        }
        // Use worklet-reported time for calculations
        seek(currentWorkletTime + seconds);
    }

    /**
     * Seeks the playback position to a specific time by sending a message.
     * @param {number} time - The target time in seconds.
     * @public
     */
    function seek(time) {
        if (!workletReady || !currentDecodedBuffer || isNaN(currentDecodedBuffer.duration)) {
            console.warn("AudioEngine: Cannot seek - worklet not ready or duration unknown.");
            return;
        }
        const targetTime = Math.max(0, Math.min(time, currentDecodedBuffer.duration));
        postWorkletMessage({ type: 'seek', positionSeconds: targetTime });
        // Worklet will handle updating its internal position and state
        // Update local time immediately for potentially faster UI feedback, worklet update will refine it.
        currentWorkletTime = targetTime;
        dispatchEngineEvent('audioapp:timeUpdated', { currentTime: currentWorkletTime, duration: currentDecodedBuffer.duration });
        console.log(`[AudioEngine] Sent seek message: ${targetTime.toFixed(2)}s`);
    }

    /**
     * Sets the playback speed (rate) by sending a message.
     * @param {number} speed - The desired playback speed.
     * @public
     */
    function setSpeed(speed) {
         const rate = Math.max(0.25, Math.min(parseFloat(speed) || 1.0, 2.0));
         if (currentPlaybackSpeed !== rate) {
             currentPlaybackSpeed = rate;
             console.log(`[AudioEngine] Playback speed target set to ${rate.toFixed(2)}x`);
             if (workletReady) {
                 postWorkletMessage({ type: 'set-speed', value: rate });
             }
         }
    }

    /**
     * Sets the gain (volume) level via the GainNode.
     * @param {number} gain - The desired gain multiplier (0.0 to 2.0).
     * @public
     */
    function setGain(gain) {
        if (!gainNode || !audioCtx || audioCtx.state === 'closed') {
            console.warn("AudioEngine: Cannot set gain - GainNode or valid AudioContext missing.");
            return;
        }
        const value = Math.max(0.0, Math.min(parseFloat(gain) || 1.0, 2.0));
        gainNode.gain.setTargetAtTime(value, audioCtx.currentTime, 0.015);
    }

    /**
     * Gets the current playback time (reported by worklet) and total duration.
     * @returns {{currentTime: number, duration: number}}
     * @public
     */
    function getCurrentTime() {
        return {
            currentTime: currentWorkletTime,
            duration: currentDecodedBuffer ? currentDecodedBuffer.duration : 0
        };
    }

     // --- Cleanup ---

    /**
     * Cleans up resources: stops worklet, closes AudioContext.
     * @public
     */
    function cleanup() {
        console.log("AudioEngine: Cleaning up resources...");
        cleanupCurrentWorklet().finally(() => { // Ensure worklet cleanup is attempted
            if (audioCtx && audioCtx.state !== 'closed') {
                audioCtx.close().then(() => console.log("AudioEngine: AudioContext closed."))
                               .catch(e => console.warn("AudioEngine: Error closing AudioContext:", e));
            }
            audioCtx = null; gainNode = null; workletNode = null; // Reset all refs
            currentDecodedBuffer = null;
            wasmBinary = null; loaderScriptText = null; // Clear fetched resources
            workletReady = false; isPlaying = false; currentWorkletTime = 0.0;
        });
    }

    // --- Utility & Dispatch Helper ---

    /**
     * Dispatches a custom event specific to the audio engine.
     * @param {string} eventName - The name of the event.
     * @param {object} [detail={}] - Data payload.
     * @private
     */
    function dispatchEngineEvent(eventName, detail = {}) {
        document.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
    }

    // --- Public Interface ---
    return {
        init: init,
        loadAndProcessFile: loadAndProcessFile,
        togglePlayPause: togglePlayPause,
        jumpBy: jumpBy,
        seek: seek,
        setSpeed: setSpeed,
        setGain: setGain,
        getCurrentTime: getCurrentTime,
        cleanup: cleanup
        // No need to expose worklet-specific methods like postWorkletMessage externally
    };
})();
// --- /vibe-player/js/audioEngine.js ---
