// --- /vibe-player/js/rubberbandProcessor.js ---
// AudioWorkletProcessor for real-time time-stretching using Rubberband WASM.

const PROCESSOR_NAME = 'rubberband-processor';

/**
 * @class RubberbandProcessor
 * @extends AudioWorkletProcessor
 * @description Processes audio using the Rubberband library compiled to WASM.
 */
class RubberbandProcessor extends AudioWorkletProcessor {

    /**
     * @constructor
     * @param {AudioWorkletNodeOptions} options - Options passed from the AudioWorkletNode constructor.
     */
    constructor(options) {
        super();
        console.log("[Worklet] RubberbandProcessor created.");
        // ... (Initialization remains the same) ...
        this.processorOpts = options.processorOptions || {}; this.sampleRate = this.processorOpts.sampleRate || currentTime; this.numberOfChannels = this.processorOpts.numberOfChannels || 0; this.wasmBinary = this.processorOpts.wasmBinary; this.loaderScriptText = this.processorOpts.loaderScriptText; this.wasmModule = null; this.wasmReady = false; this.rubberbandStretcher = 0; this.isPlaying = false; this.currentTargetSpeed = 1.0; this.lastAppliedStretchRatio = 1.0; this.currentTargetPitchScale = 1.0; this.lastAppliedPitchScale = 1.0; this.currentTargetFormantScale = 1.0; this.lastAppliedFormantScale = 1.0; this.resetNeeded = true; this.streamEnded = false; this.finalBlockSent = false; this.playbackPositionInSeconds = 0.0; this.inputPtrs = 0; this.outputPtrs = 0; this.inputChannelBuffers = []; this.outputChannelBuffers = []; this.blockSizeWasm = 1024; this.originalChannels = null; this.audioLoaded = false; this.sourceDurationSeconds = 0; if (this.port) { this.port.onmessage = this.handleMessage.bind(this); } else { console.error("[Worklet] CONSTRUCTOR: Port is not available!"); } if (!this.wasmBinary) this.postErrorAndStop("WASM binary missing."); if (!this.loaderScriptText) this.postErrorAndStop("Loader script text missing."); if (!this.sampleRate || this.sampleRate <= 0) this.postErrorAndStop("Invalid SampleRate."); if (!this.numberOfChannels || this.numberOfChannels <= 0) this.postErrorAndStop("Invalid NumberOfChannels."); console.log("[Worklet] Initialized state vars. Waiting for audio.");
    }

    /**
     * Initializes the WASM module and creates the Rubberband instance.
     * @private
     * @returns {Promise<void>}
     */
    async initializeWasmAndRubberband() {
        if (this.wasmReady) { return; }
        if (!this.wasmBinary || !this.loaderScriptText) { this.postErrorAndStop("Cannot initialize WASM: Resources missing."); return; }

        try {
            this.postStatus("Initializing WASM & Rubberband...");
            console.log("[Worklet] Initializing WASM & Rubberband instance...");

            const instantiateWasm = (imports, successCallback) => { /* ... */ console.log("[Worklet] instantiateWasm hook called."); WebAssembly.instantiate(this.wasmBinary, imports) .then(output => { console.log("[Worklet] WASM instantiate successful."); successCallback(output.instance, output.module); }).catch(error => { console.error("[Worklet] WASM instantiate hook failed:", error); this.postError(`WASM Hook Error: ${error.message}`); }); return {}; };
            let loaderFunc; try { const getLoaderFactory = new Function(`${this.loaderScriptText}; return Rubberband;`); const moduleFactory = getLoaderFactory(); loaderFunc = moduleFactory; if (typeof loaderFunc !== 'function') { throw new Error(`Loader script did not return function.`); } } catch (loaderError) { throw new Error(`Loader script eval error: ${loaderError.message}`); }
            const loadedModule = await loaderFunc({ instantiateWasm: instantiateWasm }); this.wasmModule = loadedModule;
            if (!this.wasmModule || typeof this.wasmModule._rubberband_new !== 'function') { throw new Error(`_rubberband_new not found.`); }

            // --- Rubberband Instance Creation ---
            const RBOptions = this.wasmModule.RubberBandOptionFlag || {};
            // Define flags for quality
            const ProcessRealTime = RBOptions.ProcessRealTime ?? 0x00000001;
            const EngineFiner = RBOptions.EngineFiner ?? 0x20000000; // Quality engine
            const PitchHighQuality = RBOptions.PitchHighQuality ?? 0x02000000;
            const PhaseIndependent = RBOptions.PhaseIndependent ?? 0x00002000; // Often good for voice
            const TransientsCrisp = RBOptions.TransientsCrisp ?? 0x00000000; // Good for consonants (default)
            // const TransientsMixed = RBOptions.TransientsMixed ?? 0x00000100; // Alternative if Crisp is harsh

            // *** MODIFIED OPTIONS FOR SPEECH QUALITY ***
            const options = ProcessRealTime | EngineFiner | PitchHighQuality | PhaseIndependent | TransientsCrisp;
            console.log(`[Worklet] Creating Rubberband instance with options: ${options.toString(16)} (Speech Quality Focus)`);

            this.rubberbandStretcher = this.wasmModule._rubberband_new( this.sampleRate, this.numberOfChannels, options, 1.0, 1.0 );
            if (!this.rubberbandStretcher) { throw new Error("_rubberband_new failed."); }
            console.log(`[Worklet] Rubberband instance: ptr=${this.rubberbandStretcher}`);

            // --- Memory Allocation ---
            // ... (Memory allocation logic remains the same) ...
            if (typeof this.wasmModule._malloc !== 'function' || !this.wasmModule.HEAPU32) { throw new Error("WASM memory functions missing."); } const pointerSize = 4; this.inputPtrs = this.wasmModule._malloc(this.numberOfChannels * pointerSize); this.outputPtrs = this.wasmModule._malloc(this.numberOfChannels * pointerSize); if (!this.inputPtrs || !this.outputPtrs) { throw new Error("Pointer array alloc failed."); } this.inputChannelBuffers = []; this.outputChannelBuffers = []; const frameSize = 4; for (let i = 0; i < this.numberOfChannels; ++i) { const bufferSizeBytes = this.blockSizeWasm * frameSize; const inputBuf = this.wasmModule._malloc(bufferSizeBytes); const outputBuf = this.wasmModule._malloc(bufferSizeBytes); if (!inputBuf || !outputBuf) { this.cleanupWasmMemory(); throw new Error(`Buffer alloc failed Ch ${i}.`); } this.inputChannelBuffers.push(inputBuf); this.outputChannelBuffers.push(outputBuf); this.wasmModule.HEAPU32[(this.inputPtrs / pointerSize) + i] = inputBuf; this.wasmModule.HEAPU32[(this.outputPtrs / pointerSize) + i] = outputBuf; }

            this.wasmReady = true;
            console.log("[Worklet] WASM and Rubberband ready.");
            this.postStatus('processor-ready');

        } catch (error) { /* ... (Error handling unchanged) ... */ console.error(`[Worklet] WASM/Rubberband Init Error: ${error.message}\n${error.stack}`); this.postError(`Init Error: ${error.message}`); this.wasmReady = false; this.rubberbandStretcher = 0; this.cleanupWasmMemory(); }
    }

    /**
     * Handles messages received from the main thread.
     * @param {MessageEvent} event
     */
    handleMessage(event) { /* ... (No changes needed in message handling) ... */ const data = event.data; try { switch (data.type) { case 'load-audio': this.playbackPositionInSeconds = 0; this.resetNeeded = true; this.streamEnded = false; this.finalBlockSent = false; this.currentTargetSpeed = 1.0; this.lastAppliedStretchRatio = 1.0; this.currentTargetPitchScale = 1.0; this.lastAppliedPitchScale = 1.0; this.currentTargetFormantScale = 1.0; this.lastAppliedFormantScale = 1.0; if (data.channelData && Array.isArray(data.channelData) && data.channelData.length === this.numberOfChannels) { this.originalChannels = data.channelData.map(buffer => new Float32Array(buffer)); this.audioLoaded = true; this.sourceDurationSeconds = (this.originalChannels[0]?.length || 0) / this.sampleRate; console.log(`[Worklet] Audio loaded. Duration: ${this.sourceDurationSeconds.toFixed(3)}s`); if (!this.wasmReady) { this.initializeWasmAndRubberband(); } else { this.postStatus('processor-ready'); } } else { this.postError('Invalid audio data.'); this.audioLoaded = false; } break; case 'play': if (this.wasmReady && this.audioLoaded) { if (!this.isPlaying) { if (this.streamEnded || this.playbackPositionInSeconds >= this.sourceDurationSeconds) { this.playbackPositionInSeconds = 0; this.resetNeeded = true; this.streamEnded = false; this.finalBlockSent = false; } this.isPlaying = true; console.log("[Worklet] Play"); this.port?.postMessage({ type: 'playback-state', isPlaying: true }); } } else { this.postError(`Cannot play: ${!this.wasmReady ? 'WASM' : 'Audio'} not ready.`); this.port?.postMessage({ type: 'playback-state', isPlaying: false }); } break; case 'pause': if (this.isPlaying) { this.isPlaying = false; console.log("[Worklet] Pause"); this.port?.postMessage({ type: 'playback-state', isPlaying: false }); } break; case 'set-speed': if (this.wasmReady) { const newSpeed = Math.max(0.01, data.value || 1.0); if (this.currentTargetSpeed !== newSpeed) { this.currentTargetSpeed = newSpeed; } } break; case 'set-pitch': if (this.wasmReady) { const newPitch = Math.max(0.1, data.value || 1.0); if (this.currentTargetPitchScale !== newPitch) { this.currentTargetPitchScale = newPitch; } } break; case 'set-formant': if (this.wasmReady) { const newFormant = Math.max(0.1, data.value || 1.0); if (this.currentTargetFormantScale !== newFormant) { this.currentTargetFormantScale = newFormant; console.log(`[Worklet] Received set-formant. Target set to: ${this.currentTargetFormantScale.toFixed(3)}`); } } break; case 'seek': if (this.wasmReady && this.audioLoaded) { const seekPosition = Math.max(0, Math.min(data.positionSeconds || 0, this.sourceDurationSeconds)); this.playbackPositionInSeconds = seekPosition; this.resetNeeded = true; this.streamEnded = false; this.finalBlockSent = false; console.log(`[Worklet] Seek to ${this.playbackPositionInSeconds.toFixed(3)}s`); } break; case 'cleanup': this.cleanup(); break; default: console.warn("[Worklet] Unknown message:", data.type); } } catch (error) { this.postError(`Msg ${data.type} error: ${error.message}`); console.error(`[Worklet] Msg ${data.type} error: ${error.stack}`); this.isPlaying = false; this.port?.postMessage({ type: 'playback-state', isPlaying: false }); } }

    /**
     * The core audio processing function.
     * @param {Float32Array[][]} inputs
     * @param {Float32Array[][]} outputs
     * @param {Record<string, Float32Array>} parameters
     * @returns {boolean}
     */
    process(inputs, outputs, parameters) { /* ... (Process logic remains the same, uses updated flags implicitly during next reset) ... */ if (!this.wasmReady || !this.audioLoaded || !this.rubberbandStretcher || !this.wasmModule) { this.outputSilence(outputs); return true; } if (!this.isPlaying) { this.outputSilence(outputs); return true; } if (this.streamEnded) { let available = this.wasmModule._rubberband_available?.(this.rubberbandStretcher) ?? 0; if (Math.max(0, available) <= 0) { this.outputSilence(outputs); return true; } } const outputBuffer = outputs[0]; if (!outputBuffer || outputBuffer.length !== this.numberOfChannels || !outputBuffer[0]) { this.outputSilence(outputs); return true; } const outputBlockSize = outputBuffer[0].length; if (outputBlockSize === 0) return true; try { const sourceChannels = this.originalChannels; const safeTargetSpeed = Math.max(0.01, this.currentTargetSpeed); const targetStretchRatio = 1.0 / safeTargetSpeed; const safeStretchRatio = Math.max(0.05, Math.min(20.0, targetStretchRatio)); const ratioChanged = Math.abs(safeStretchRatio - this.lastAppliedStretchRatio) > 1e-6; const safeTargetPitch = Math.max(0.1, this.currentTargetPitchScale); const pitchChanged = Math.abs(safeTargetPitch - this.lastAppliedPitchScale) > 1e-6; const safeTargetFormant = Math.max(0.1, this.currentTargetFormantScale); const formantChanged = Math.abs(safeTargetFormant - this.lastAppliedFormantScale) > 1e-6; if (this.resetNeeded) { this.wasmModule._rubberband_reset(this.rubberbandStretcher); this.wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, safeStretchRatio); this.wasmModule._rubberband_set_pitch_scale(this.rubberbandStretcher, safeTargetPitch); this.wasmModule._rubberband_set_formant_scale(this.rubberbandStretcher, safeTargetFormant); this.lastAppliedStretchRatio = safeStretchRatio; this.lastAppliedPitchScale = safeTargetPitch; this.lastAppliedFormantScale = safeTargetFormant; this.resetNeeded = false; this.finalBlockSent = false; this.streamEnded = false; console.log(`[Worklet] Rubberband Reset. R:${safeStretchRatio.toFixed(3)}, P:${safeTargetPitch.toFixed(3)}, F:${safeTargetFormant.toFixed(3)}`); } else { if (ratioChanged) { this.wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, safeStretchRatio); this.lastAppliedStretchRatio = safeStretchRatio; } if (pitchChanged) { this.wasmModule._rubberband_set_pitch_scale(this.rubberbandStretcher, safeTargetPitch); this.lastAppliedPitchScale = safeTargetPitch; console.log(`[Worklet] Pitch updated to ${safeTargetPitch.toFixed(3)}`); } if (formantChanged) { console.log(`[Worklet] Applying formant scale: ${safeTargetFormant.toFixed(3)}`); this.wasmModule._rubberband_set_formant_scale(this.rubberbandStretcher, safeTargetFormant); this.lastAppliedFormantScale = safeTargetFormant; } } let inputFramesNeeded = Math.ceil(outputBlockSize / safeStretchRatio) + 4; inputFramesNeeded = Math.max(1, inputFramesNeeded); let readPosInSourceSamples = Math.round(this.playbackPositionInSeconds * this.sampleRate); const sourceTotalSamples = sourceChannels[0]?.length || 0; readPosInSourceSamples = Math.max(0, Math.min(readPosInSourceSamples, sourceTotalSamples)); let actualInputProvided = Math.min(inputFramesNeeded, sourceTotalSamples - readPosInSourceSamples); actualInputProvided = Math.max(0, actualInputProvided); const isFinalDataBlock = (readPosInSourceSamples + actualInputProvided) >= sourceTotalSamples; const sendFinalFlag = isFinalDataBlock && !this.finalBlockSent; if (actualInputProvided > 0 || sendFinalFlag) { for (let i = 0; i < this.numberOfChannels; i++) { const sourceData = sourceChannels[i]; const wasmInputBufferView = new Float32Array(this.wasmModule.HEAPF32.buffer, this.inputChannelBuffers[i], this.blockSizeWasm); if (actualInputProvided > 0) { const endReadPos = readPosInSourceSamples + actualInputProvided; const inputSlice = sourceData.subarray(readPosInSourceSamples, endReadPos); const copyLength = Math.min(inputSlice.length, this.blockSizeWasm); if (copyLength > 0) { wasmInputBufferView.set(inputSlice.subarray(0, copyLength)); } if (copyLength < this.blockSizeWasm) { wasmInputBufferView.fill(0.0, copyLength); } } else { wasmInputBufferView.fill(0.0); } } this.wasmModule._rubberband_process(this.rubberbandStretcher, this.inputPtrs, actualInputProvided, sendFinalFlag ? 1 : 0); const inputSecondsConsumed = (actualInputProvided / this.sampleRate); this.playbackPositionInSeconds += inputSecondsConsumed; this.playbackPositionInSeconds = Math.min(this.playbackPositionInSeconds, this.sourceDurationSeconds); this.port?.postMessage({type: 'time-update', currentTime: this.playbackPositionInSeconds }); if (sendFinalFlag) { this.finalBlockSent = true; } } let totalRetrieved = 0; let available = 0; const tempOutputBuffers = Array.from({ length: this.numberOfChannels }, () => new Float32Array(outputBlockSize)); do { available = this.wasmModule._rubberband_available(this.rubberbandStretcher); available = Math.max(0, available); if (available > 0) { const neededNow = outputBlockSize - totalRetrieved; if (neededNow <= 0) break; const framesToRetrieve = Math.min(available, neededNow, this.blockSizeWasm); if (framesToRetrieve <= 0) break; const retrieved = this.wasmModule._rubberband_retrieve(this.rubberbandStretcher, this.outputPtrs, framesToRetrieve); if (retrieved > 0) { for (let i = 0; i < this.numberOfChannels; i++) { const wasmOutputBufferView = new Float32Array(this.wasmModule.HEAPF32.buffer, this.outputChannelBuffers[i], retrieved); const copyLength = Math.min(retrieved, tempOutputBuffers[i].length - totalRetrieved); if (copyLength > 0) { tempOutputBuffers[i].set(wasmOutputBufferView.subarray(0, copyLength), totalRetrieved); } } totalRetrieved += retrieved; } else if (retrieved < 0) { console.error(`[Worklet] _rubberband_retrieve error: ${retrieved}`); available = 0; break; } else { available = 0; } } } while (available > 0 && totalRetrieved < outputBlockSize); for (let i = 0; i < this.numberOfChannels; ++i) { if (outputBuffer[i]) { const copyLength = Math.min(totalRetrieved, outputBlockSize); if (copyLength > 0) { outputBuffer[i].set(tempOutputBuffers[i].subarray(0, copyLength)); } if (copyLength < outputBlockSize) { outputBuffer[i].fill(0.0, copyLength); } } } if (this.finalBlockSent && available <= 0 && totalRetrieved < outputBlockSize) { if (!this.streamEnded) { console.log("[Worklet] Playback stream ended."); this.streamEnded = true; this.isPlaying = false; this.postStatus('Playback ended'); this.port?.postMessage({ type: 'playback-state', isPlaying: false }); } } } catch (error) { console.error(`[Worklet] Processing Error: ${error.message}\n${error.stack}`); this.postError(`Processing Error: ${error.message}`); this.isPlaying = false; this.streamEnded = true; this.outputSilence(outputs); this.port?.postMessage({ type: 'playback-state', isPlaying: false }); return true; } return true; }

    // ... (outputSilence, postStatus, postError, postErrorAndStop, cleanupWasmMemory, cleanup methods remain unchanged) ...
    /** Fills output buffers with silence. @private */
    outputSilence(outputs) { if (!outputs || !outputs[0] || !outputs[0][0]) return; const outputChannels = outputs[0]; const numChannels = outputChannels.length; const blockSize = outputChannels[0]?.length || 0; if (blockSize === 0) return; for (let i = 0; i < numChannels; ++i) { if (outputChannels[i]) { outputChannels[i].fill(0.0); } } }
    /** Posts status message. @private */
    postStatus(message) { try { if (!this.port) { console.error("[Worklet] Port null, cannot post status."); return; } this.port.postMessage({type: 'status', message}); } catch (e) { console.error(`[Worklet] FAILED to post status '${message}':`, e); } }
    /** Posts error message. @private */
    postError(message) { try { if (!this.port) { console.error("[Worklet] Port null, cannot post error."); return; } this.port.postMessage({type: 'error', message}); } catch (e) { console.error(`[Worklet] FAILED to post error '${message}':`, e); } }
    /** Posts error and stops. @private */
    postErrorAndStop(message) { this.postError(message); this.cleanup(); }
    /** Frees WASM memory. @private */
    cleanupWasmMemory() { if (this.wasmModule && typeof this.wasmModule._free === 'function') { try { this.inputChannelBuffers.forEach(ptr => { if (ptr) this.wasmModule._free(ptr); }); this.outputChannelBuffers.forEach(ptr => { if (ptr) this.wasmModule._free(ptr); }); this.inputChannelBuffers = []; this.outputChannelBuffers = []; if (this.inputPtrs) this.wasmModule._free(this.inputPtrs); if (this.outputPtrs) this.wasmModule._free(this.outputPtrs); this.inputPtrs = 0; this.outputPtrs = 0; } catch (e) { console.error("[Worklet] Error during WASM memory cleanup:", e); } } }
    /** Cleans up all resources. @private */
    cleanup() { console.log("[Worklet] Cleanup requested."); this.isPlaying = false; if (this.wasmReady && this.rubberbandStretcher !== 0 && this.wasmModule && typeof this.wasmModule._rubberband_delete === 'function') { try { this.wasmModule._rubberband_delete(this.rubberbandStretcher); this.rubberbandStretcher = 0; } catch (e) { console.error("[Worklet] Error deleting Rubberband instance:", e); } } this.cleanupWasmMemory(); this.wasmReady = false; this.audioLoaded = false; this.originalChannels = null; this.wasmModule = null; this.wasmBinary = null; this.loaderScriptText = null; this.playbackPositionInSeconds = 0; this.streamEnded = true; this.finalBlockSent = false; this.resetNeeded = true; console.log("[Worklet] Cleanup finished."); this.postStatus("Processor cleaned up"); }

} // --- End RubberbandProcessor Class ---

// --- Registration ---
try { if (typeof registerProcessor === 'function') { registerProcessor(PROCESSOR_NAME, RubberbandProcessor); } else { console.error("[Worklet] registerProcessor not defined."); } }
catch (error) { console.error(`[Worklet] Failed to register processor:`, error); try { if (self?.postMessage) self.postMessage({ type: 'error', message: `Failed to register processor: ${error.message}` }); } catch(e) {} }
// --- /vibe-player/js/rubberbandProcessor.js ---
