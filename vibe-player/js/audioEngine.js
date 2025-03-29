// --- /vibe-player/js/audioEngine.js ---
// Manages Web Audio API, AudioWorklet loading/communication, decoding, resampling, and playback control.
// Uses Rubberband WASM via an AudioWorkletProcessor for time-stretching and pitch/formant shifting.

var AudioApp = AudioApp || {}; // Ensure namespace exists

AudioApp.audioEngine = (function() {
    'use strict';

    // --- Web Audio API & Worklet State ---
    /** @type {AudioContext|null} */ let audioCtx = null;
    /** @type {GainNode|null} */ let gainNode = null;
    /** @type {AudioWorkletNode|null} */ let workletNode = null;
    /** @type {AudioBuffer|null} */ let currentDecodedBuffer = null;

    /** @type {boolean} */ let isPlaying = false;
    /** @type {boolean} */ let workletReady = false;
    /** @type {number} */ let currentWorkletTime = 0.0;
    /** @type {number} */ let currentPlaybackSpeed = 1.0;
    /** @type {number} */ let currentPitchScale = 1.0; // New state
    /** @type {number} */ let currentFormantScale = 1.0; // New state

    // --- WASM Resources ---
    /** @type {ArrayBuffer|null} */ let wasmBinary = null;
    /** @type {string|null} */ let loaderScriptText = null;

    // --- Constants ---
    /** @const {string} */ const PROCESSOR_SCRIPT_URL = 'js/rubberbandProcessor.js';
    /** @const {string} */ const PROCESSOR_NAME = 'rubberband-processor';
    /** @const {string} */ const WASM_BINARY_URL = 'lib/rubberband.wasm';
    /** @const {string} */ const LOADER_SCRIPT_URL = 'lib/rubberband-loader.js';

    // --- Initialization ---

    /**
     * Initializes the Audio Engine.
     * @public
     */
    async function init() {
        console.log("AudioEngine: Initializing...");
        setupAudioContext();
        await preFetchWorkletResources();
        console.log("AudioEngine: Initialized.");
    }

    // --- Setup & Resource Fetching ---

    /**
     * Creates/resets the AudioContext and GainNode.
     * @private
     * @returns {boolean} True if context is ready.
     */
    function setupAudioContext() {
        // ... (Setup context logic remains the same) ...
        if (audioCtx && audioCtx.state !== 'closed') { return true; }
        try { if (audioCtx && audioCtx.state === 'closed') { console.log("AudioEngine: Recreating closed AudioContext."); } audioCtx = new (window.AudioContext || window.webkitAudioContext)(); gainNode = audioCtx.createGain(); gainNode.gain.value = 1.0; gainNode.connect(audioCtx.destination); workletNode = null; workletReady = false; console.log(`AudioEngine: AudioContext created/reset (state: ${audioCtx.state}).`); if (audioCtx.state === 'suspended') { console.warn("AudioEngine: AudioContext is suspended. User interaction needed."); } return true; }
        catch (e) { console.error("AudioEngine: Failed to create AudioContext.", e); audioCtx = null; gainNode = null; workletNode = null; workletReady = false; dispatchEngineEvent('audioapp:engineError', { type: 'context', error: new Error("Web Audio API not supported") }); return false; }
    }

    /**
     * Fetches WASM resources.
     * @private
     * @returns {Promise<void>}
     */
    async function preFetchWorkletResources() {
        // ... (Fetching logic remains the same) ...
        console.log("AudioEngine: Pre-fetching WASM resources..."); try { const wasmResponse = await fetch(WASM_BINARY_URL); if (!wasmResponse.ok) throw new Error(`Fetch failed ${wasmResponse.status} for ${WASM_BINARY_URL}`); wasmBinary = await wasmResponse.arrayBuffer(); console.log(`AudioEngine: Fetched WASM binary (${wasmBinary.byteLength} bytes).`); const loaderResponse = await fetch(LOADER_SCRIPT_URL); if (!loaderResponse.ok) throw new Error(`Fetch failed ${loaderResponse.status} for ${LOADER_SCRIPT_URL}`); loaderScriptText = await loaderResponse.text(); console.log(`AudioEngine: Fetched Loader Script text (${loaderScriptText.length} chars).`); }
        catch (fetchError) { console.error("AudioEngine: Failed to fetch WASM/Loader resources:", fetchError); wasmBinary = null; loaderScriptText = null; dispatchEngineEvent('audioapp:engineError', { type: 'resource', error: fetchError }); }
    }

    // --- Loading, Decoding, Resampling Pipeline ---

    /**
     * Loads file, decodes, resamples, sets up worklet.
     * @param {File} file
     * @returns {Promise<void>}
     * @throws {Error}
     * @public
     */
     async function loadAndProcessFile(file) {
        // ... (Context check and resume logic remains the same) ...
        if (!audioCtx || audioCtx.state === 'closed') { console.error("AudioEngine: AudioContext not available."); if (!setupAudioContext()) { throw new Error("AudioContext could not be created/reset."); } } if (audioCtx.state === 'suspended') { await audioCtx.resume().catch(e => console.warn("AudioEngine: Context resume failed.", e)); }

        await cleanupCurrentWorklet();
        currentDecodedBuffer = null;
        isPlaying = false;
        currentWorkletTime = 0.0;
        currentPlaybackSpeed = 1.0; // Reset speed/pitch/formant on new file
        currentPitchScale = 1.0;
        currentFormantScale = 1.0;

        try {
            const arrayBuffer = await file.arrayBuffer();
            console.log("AudioEngine: Decoding audio data...");
            currentDecodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            console.log(`AudioEngine: Decoded ${currentDecodedBuffer.duration.toFixed(2)}s @ ${currentDecodedBuffer.sampleRate}Hz`);
            dispatchEngineEvent('audioapp:audioLoaded', { audioBuffer: currentDecodedBuffer });

            console.log("AudioEngine: Resampling audio for VAD...");
            const pcm16k = await convertAudioBufferTo16kHzMonoFloat32(currentDecodedBuffer);
            console.log(`AudioEngine: Resampled to ${pcm16k.length} samples @ 16kHz`);
            dispatchEngineEvent('audioapp:resamplingComplete', { pcmData: pcm16k });

            if (!wasmBinary || !loaderScriptText) { throw new Error("Cannot setup Worklet: WASM/Loader resources missing."); }
            await setupAndStartWorklet(currentDecodedBuffer);

        } catch (error) {
            // ... (Error handling remains the same) ...
            console.error("AudioEngine: Error during load/decode/resample/worklet setup:", error); currentDecodedBuffer = null; const errorType = error.message.includes("decodeAudioData") ? 'decodingError' : error.message.includes("resampling") ? 'resamplingError' : error.message.includes("Worklet") ? 'workletError' : 'loadError'; dispatchEngineEvent(`audioapp:${errorType}`, { error: error }); throw error;
        }
    }


    /**
     * Resampling function.
     * @param {AudioBuffer} audioBuffer
     * @returns {Promise<Float32Array>}
     * @throws {Error}
     * @private
     */
    function convertAudioBufferTo16kHzMonoFloat32(audioBuffer) {
        // ... (Resampling logic remains the same) ...
        const targetSampleRate = 16000; const targetLength = Math.ceil(audioBuffer.duration * targetSampleRate); if (!targetLength || targetLength <= 0) { console.warn("AudioEngine: Zero length for resampling."); return Promise.resolve(new Float32Array(0)); } try { const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate); const src = offlineCtx.createBufferSource(); src.buffer = audioBuffer; src.connect(offlineCtx.destination); src.start(); return offlineCtx.startRendering().then(renderedBuffer => { return renderedBuffer.getChannelData(0); }).catch(err => { console.error("AudioEngine: Resampling error:", err); throw new Error(`Audio resampling failed: ${err.message}`); }); } catch (offlineCtxError) { console.error("AudioEngine: OfflineContext creation error:", offlineCtxError); return Promise.reject(new Error(`OfflineContext creation failed: ${offlineCtxError.message}`)); }
    }

    // --- AudioWorklet Setup and Communication ---

    /**
     * Cleans up the existing AudioWorkletNode.
     * @private
     * @returns {Promise<void>}
     */
    async function cleanupCurrentWorklet() {
        // ... (Cleanup logic remains the same) ...
        workletReady = false; if (workletNode) { console.log("[AudioEngine] Cleaning up previous worklet node..."); try { postWorkletMessage({ type: 'cleanup' }); await new Promise(resolve => setTimeout(resolve, 50)); if (workletNode && workletNode.port) { workletNode.port.onmessage = null; workletNode.onprocessorerror = null; } if (workletNode) workletNode.disconnect(); console.log("[AudioEngine] Previous worklet node disconnected."); } catch (e) { console.warn("[AudioEngine] Error during worklet cleanup:", e); } finally { workletNode = null; } }
    }

    /**
     * Sets up the AudioWorklet module, node, and sends initial data.
     * @param {AudioBuffer} decodedBuffer
     * @private
     * @returns {Promise<void>}
     */
    async function setupAndStartWorklet(decodedBuffer) {
        // ... (Worklet setup logic remains the same) ...
        if (!audioCtx || !decodedBuffer || !wasmBinary || !loaderScriptText || !gainNode) { throw new Error("Cannot setup worklet - prerequisites missing."); } await cleanupCurrentWorklet(); try { console.log(`[AudioEngine] Adding AudioWorklet module: ${PROCESSOR_SCRIPT_URL}`); await audioCtx.audioWorklet.addModule(PROCESSOR_SCRIPT_URL); console.log("[AudioEngine] AudioWorklet module added."); const wasmBinaryTransfer = wasmBinary.slice(0); const processorOpts = { sampleRate: audioCtx.sampleRate, numberOfChannels: decodedBuffer.numberOfChannels, wasmBinary: wasmBinaryTransfer, loaderScriptText: loaderScriptText }; const transferListWasm = [wasmBinaryTransfer]; console.log("[AudioEngine] Creating AudioWorkletNode..."); workletNode = new AudioWorkletNode(audioCtx, PROCESSOR_NAME, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [decodedBuffer.numberOfChannels], processorOptions: processorOpts }); setupWorkletMessageHandler(); workletNode.onprocessorerror = (event) => { console.error(`[AudioEngine] Critical Processor Error:`, event); dispatchEngineEvent('audioapp:engineError', { type: 'workletProcessor', error: new Error("Processor crashed") }); cleanupCurrentWorklet(); workletReady = false; isPlaying = false; dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: false }); }; workletNode.connect(gainNode); console.log("[AudioEngine] AudioWorkletNode created and connected."); const channelData = []; const transferListAudio = []; for (let i = 0; i < decodedBuffer.numberOfChannels; i++) { const dataArray = decodedBuffer.getChannelData(i); const bufferCopy = dataArray.buffer.slice(dataArray.byteOffset, dataArray.byteOffset + dataArray.byteLength); channelData.push(bufferCopy); transferListAudio.push(bufferCopy); } console.log(`[AudioEngine] Sending audio data (${channelData.length} channels) to worklet...`); postWorkletMessage({ type: 'load-audio', channelData: channelData }, transferListAudio); } catch (error) { console.error("[AudioEngine] Error setting up Worklet Node:", error); await cleanupCurrentWorklet(); throw error; }
    }

    /**
     * Sets up the onmessage handler for the current workletNode.
     * @private
     */
    function setupWorkletMessageHandler() {
        // ... (Message handling logic remains the same) ...
        if (!workletNode) return; workletNode.port.onmessage = (event) => { const data = event.data; switch(data.type) { case 'status': console.log(`[WorkletStatus] ${data.message}`); if (data.message === 'processor-ready') { workletReady = true; dispatchEngineEvent('audioapp:workletReady'); } else if (data.message === 'Playback ended') { isPlaying = false; currentWorkletTime = 0; dispatchEngineEvent('audioapp:playbackEnded'); dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: false }); } else if (data.message === 'Processor cleaned up') { workletReady = false; isPlaying = false; } break; case 'error': console.error(`[WorkletError] ${data.message}`); dispatchEngineEvent('audioapp:engineError', { type: 'workletRuntime', error: new Error(data.message) }); workletReady = false; isPlaying = false; dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: false }); break; case 'playback-state': if (isPlaying !== data.isPlaying) { console.warn(`[AudioEngine] State mismatch: Desired=${isPlaying}, Worklet=${data.isPlaying}. Syncing.`); isPlaying = data.isPlaying; } dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: data.isPlaying }); break; case 'time-update': if (typeof data.currentTime === 'number' && currentDecodedBuffer) { currentWorkletTime = data.currentTime; dispatchEngineEvent('audioapp:timeUpdated', { currentTime: currentWorkletTime, duration: currentDecodedBuffer.duration }); } break; default: console.warn("[AudioEngine] Unhandled message from worklet:", data.type); } };
    }

    /**
     * Helper to send messages to the worklet port.
     * @param {object} message
     * @param {Transferable[]} [transferList=[]]
     * @private
     */
    function postWorkletMessage(message, transferList = []) {
        // ... (Message posting logic remains the same) ...
        if (workletNode && workletNode.port) { try { workletNode.port.postMessage(message, transferList); } catch (error) { console.error("[AudioEngine] Error posting message:", error); dispatchEngineEvent('audioapp:engineError', { type: 'workletComm', error: error }); cleanupCurrentWorklet(); workletReady = false; isPlaying = false; dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: false }); } } else { if (workletReady || message.type !== 'cleanup') { console.warn(`[AudioEngine] Cannot post msg (${message.type}): Worklet node/port not ready.`); } }
    }

    // --- Playback Control Methods (Public) ---

    /**
     * Toggles playback state via worklet message. Resumes context if needed.
     * @public
     */
    async function togglePlayPause() {
        // ... (Context resume logic remains the same) ...
        if (!workletReady) { console.warn("AudioEngine: Worklet not ready."); return; } if (audioCtx && audioCtx.state === 'suspended') { console.log("[AudioEngine] Resuming AC on user interaction..."); try { await audioCtx.resume(); console.log("[AudioEngine] AC resumed."); } catch (err) { console.error("[AudioEngine] Failed to resume AC:", err); dispatchEngineEvent('audioapp:engineError', { type: 'contextResume', error: err }); return; } } if (!audioCtx || audioCtx.state !== 'running') { console.error(`AudioEngine: AC not running (state: ${audioCtx?.state}).`); return; }

        const targetIsPlaying = !isPlaying;
        postWorkletMessage({ type: targetIsPlaying ? 'play' : 'pause' });
        isPlaying = targetIsPlaying; // Update desired state
        console.log(`[AudioEngine] Sent ${targetIsPlaying ? 'play' : 'pause'} message.`);
    }

    /**
     * Jumps playback position.
     * @param {number} seconds
     * @public
     */
    function jumpBy(seconds) {
        if (!workletReady || !currentDecodedBuffer) return;
        seek(currentWorkletTime + seconds);
    }

    /**
     * Seeks playback position via worklet message.
     * @param {number} time
     * @public
     */
    function seek(time) {
        if (!workletReady || !currentDecodedBuffer || isNaN(currentDecodedBuffer.duration)) return;
        const targetTime = Math.max(0, Math.min(time, currentDecodedBuffer.duration));
        postWorkletMessage({ type: 'seek', positionSeconds: targetTime });
        currentWorkletTime = targetTime; // Update local time optimistically
        dispatchEngineEvent('audioapp:timeUpdated', { currentTime: currentWorkletTime, duration: currentDecodedBuffer.duration });
        console.log(`[AudioEngine] Sent seek message: ${targetTime.toFixed(2)}s`);
    }

    /**
     * Sets playback speed via worklet message.
     * @param {number} speed
     * @public
     */
    function setSpeed(speed) {
         const rate = Math.max(0.25, Math.min(parseFloat(speed) || 1.0, 2.0));
         if (currentPlaybackSpeed !== rate) {
             currentPlaybackSpeed = rate;
             console.log(`[AudioEngine] Speed target set to ${rate.toFixed(2)}x`);
             if (workletReady) {
                 postWorkletMessage({ type: 'set-speed', value: rate });
             }
         }
    }

    /**
     * Sets pitch shift scale via worklet message.
     * @param {number} pitch - The desired pitch scale (e.g., 1.0 is normal, 1.1 is higher).
     * @public
     */
    function setPitch(pitch) {
        const scale = Math.max(0.5, Math.min(parseFloat(pitch) || 1.0, 2.0)); // Clamp to typical range
        if (currentPitchScale !== scale) {
            currentPitchScale = scale;
            console.log(`[AudioEngine] Pitch target set to ${scale.toFixed(2)}x`);
            if (workletReady) {
                postWorkletMessage({ type: 'set-pitch', value: scale });
            }
        }
    }

    /**
     * Sets formant shift scale via worklet message.
     * @param {number} formant - The desired formant scale (e.g., 1.0 is normal).
     * @public
     */
    function setFormant(formant) {
        const scale = Math.max(0.5, Math.min(parseFloat(formant) || 1.0, 2.0)); // Clamp to typical range
        if (currentFormantScale !== scale) {
            currentFormantScale = scale;
            console.log(`[AudioEngine] Formant target set to ${scale.toFixed(2)}x`);
            if (workletReady) {
                postWorkletMessage({ type: 'set-formant', value: scale });
            }
        }
    }

    /**
     * Sets gain (volume) using the GainNode.
     * @param {number} gain
     * @public
     */
    function setGain(gain) {
        // ... (Gain logic remains the same) ...
        if (!gainNode || !audioCtx || audioCtx.state === 'closed') { console.warn("AudioEngine: Cannot set gain - GainNode/Context missing."); return; } const value = Math.max(0.0, Math.min(parseFloat(gain) || 1.0, 5.0)); gainNode.gain.setTargetAtTime(value, audioCtx.currentTime, 0.015);
    }

    /**
     * Gets current playback time and duration.
     * @returns {{currentTime: number, duration: number}}
     * @public
     */
    function getCurrentTime() {
        // ... (getCurrentTime logic remains the same) ...
        return { currentTime: currentWorkletTime, duration: currentDecodedBuffer ? currentDecodedBuffer.duration : 0 };
    }

     // --- Cleanup ---

    /**
     * Cleans up resources.
     * @public
     */
    function cleanup() {
        // ... (Cleanup logic remains the same, includes worklet cleanup) ...
        console.log("AudioEngine: Cleaning up resources..."); cleanupCurrentWorklet().finally(() => { if (audioCtx && audioCtx.state !== 'closed') { audioCtx.close().then(() => console.log("AudioEngine: AudioContext closed.")).catch(e => console.warn("AudioEngine: Error closing AudioContext:", e)); } audioCtx = null; gainNode = null; workletNode = null; currentDecodedBuffer = null; wasmBinary = null; loaderScriptText = null; workletReady = false; isPlaying = false; currentWorkletTime = 0.0; });
    }

    // --- Utility & Dispatch Helper ---

    /**
     * Dispatches a custom event.
     * @param {string} eventName
     * @param {object} [detail={}]
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
        setPitch: setPitch, // Expose new method
        setFormant: setFormant, // Expose new method
        setGain: setGain,
        getCurrentTime: getCurrentTime,
        cleanup: cleanup
    };
})();
// --- /vibe-player/js/audioEngine.js ---
