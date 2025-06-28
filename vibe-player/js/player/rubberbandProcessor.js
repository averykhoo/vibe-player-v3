// vibe-player/js/player/rubberbandProcessor.js
// AudioWorkletProcessor for real-time time-stretching using Rubberband WASM.

// Constants cannot be accessed here directly, but name is needed for registration.
/** @const {string} Name of the AudioWorkletProcessor. */
const PROCESSOR_NAME = 'rubberband-processor';

/**
 * @class RubberbandProcessor
 * @extends AudioWorkletProcessor
 * @description Processes audio using the Rubberband library compiled to WASM.
 * Handles loading Rubberband WASM, managing its state, processing audio frames
 * for time-stretching and pitch-shifting, and communicating with the main thread.
 * Runs within an AudioWorkletGlobalScope.
 */
class RubberbandProcessor extends AudioWorkletProcessor {

    /**
     * Initializes the processor instance. Sets up initial state and message handling.
     * WASM/Rubberband initialization happens asynchronously via message handler or first process call.
     * @constructor
     * @param {AudioWorkletNodeOptions} options - Options passed from the AudioWorkletNode constructor.
     * @param {object} options.processorOptions - Custom options.
     * @param {number} options.processorOptions.sampleRate - The sample rate of the audio context.
     * @param {number} options.processorOptions.numberOfChannels - The number of channels in the input audio.
     * @param {ArrayBuffer} options.processorOptions.wasmBinary - The pre-fetched WASM binary of Rubberband.
     * @param {string} options.processorOptions.loaderScriptText - The text of the Rubberband WASM loader script.
     */
    constructor(options) {
        super(options); // Pass options to base constructor
        console.log("[Worklet] RubberbandProcessor created.");

        // --- State Initialization ---
        /** @private @type {object} Options passed from the main thread. */
        this.processorOpts = options.processorOptions || {};
        /** @private @type {number} Sample rate of the audio context. */
        this.sampleRate = this.processorOpts.sampleRate || sampleRate; // sampleRate is global in AudioWorkletGlobalScope
        /** @private @type {number} Number of audio channels. */
        this.numberOfChannels = this.processorOpts.numberOfChannels || 0;
        /** @private @type {ArrayBuffer|null} The WASM binary. */
        this.wasmBinary = this.processorOpts.wasmBinary;
        /** @private @type {string|null} The WASM loader script text. */
        this.loaderScriptText = this.processorOpts.loaderScriptText;

        /** @private @type {object|null} Exported functions from the WASM module. */
        this.wasmModule = null;
        /** @private @type {boolean} Flag indicating if WASM and Rubberband are initialized. */
        this.wasmReady = false;
        /** @private @type {number} Pointer to the RubberbandStretcher instance in WASM memory. */
        this.rubberbandStretcher = 0; // Using 'number' as it's an opaque pointer (integer).

        /** @private @type {boolean} Current playback state. */
        this.isPlaying = false;
        /** @private @type {number} Target speed ratio for time-stretching. */
        this.currentTargetSpeed = 1.0;
        /** @private @type {number} Target pitch scale. */
        this.currentTargetPitchScale = 1.0;
        /** @private @type {number} Target formant scale. */
        this.currentTargetFormantScale = 1.0;
        /** @private @type {number} Last applied stretch ratio to Rubberband. */
        this.lastAppliedStretchRatio = 1.0;
        /** @private @type {number} Last applied pitch scale to Rubberband. */
        this.lastAppliedPitchScale = 1.0;
        /** @private @type {number} Last applied formant scale to Rubberband. */
        this.lastAppliedFormantScale = 1.0;

        /** @private @type {boolean} Flag indicating if Rubberband state needs reset (e.g., after seek). */
        this.resetNeeded = true;
        /** @private @type {boolean} Flag indicating if the end of the source audio has been processed. */
        this.streamEnded = false;
        /** @private @type {boolean} Flag indicating if the final block has been sent to `rubberband_process`. */
        this.finalBlockSent = false;
        /** @private @type {number} Current playback position in the source audio, in seconds. */
        this.playbackPositionInSeconds = 0.0;

        /** @private @type {number} Pointer to the array of input channel buffer pointers in WASM memory. */
        this.inputPtrs = 0;
        /** @private @type {number} Pointer to the array of output channel buffer pointers in WASM memory. */
        this.outputPtrs = 0;
        /** @private @type {number[]} Array of pointers to individual input channel buffers in WASM memory. */
        this.inputChannelBuffers = [];
        /** @private @type {number[]} Array of pointers to individual output channel buffers in WASM memory. */
        this.outputChannelBuffers = [];
        /** @private @type {number} Fixed block size for WASM memory buffers (in frames). */
        this.blockSizeWasm = 1024;

        /** @private @type {Float32Array[]|null} Array of Float32Arrays holding the original audio data for each channel. */
        this.originalChannels = null;
        /** @private @type {boolean} Flag indicating if audio data has been loaded into the processor. */
        this.audioLoaded = false;
        /** @private @type {number} Duration of the loaded audio in seconds. */
        this.sourceDurationSeconds = 0;

        if (this.port) {
            this.port.onmessage = this.handleMessage.bind(this);
        } else {
            console.error("[Worklet] CONSTRUCTOR: Message port is not available! Cannot receive messages.");
        }

        if (!this.wasmBinary) this.postErrorAndStop("WASM binary missing in processorOptions.");
        if (!this.loaderScriptText) this.postErrorAndStop("Loader script text missing in processorOptions.");
        if (!this.sampleRate || this.sampleRate <= 0) this.postErrorAndStop(`Invalid SampleRate provided: ${this.sampleRate}`);
        if (!this.numberOfChannels || this.numberOfChannels <= 0) this.postErrorAndStop(`Invalid NumberOfChannels provided: ${this.numberOfChannels}`);

        console.log("[Worklet] RubberbandProcessor instance constructed. Waiting for audio data or commands.");
    }

    /**
     * Initializes the WASM module and the RubberbandStretcher instance.
     * This involves evaluating a loader script and using a custom `instantiateWasm` hook.
     * It also allocates memory within the WASM heap for audio buffers.
     * @private
     * @async
     * @returns {Promise<void>} Resolves when initialization is complete, or rejects on error.
     */
    async initializeWasmAndRubberband() {
        if (this.wasmReady) return; // Avoid re-initialization
        if (!this.wasmBinary || !this.loaderScriptText) {
            this.postErrorAndStop("Cannot initialize WASM: Resources missing.");
            return;
        }
        this.postStatus("Initializing WASM & Rubberband...");
        try {
            /** @type {function(WebAssembly.Imports, function(WebAssembly.Instance, WebAssembly.Module): void): object} */
            const instantiateWasm = (imports, successCallback) => {
                WebAssembly.instantiate(this.wasmBinary, imports)
                    .then(output => successCallback(output.instance, output.module))
                    .catch(error => this.postError(`WASM Hook Instantiate Error: ${error.message}`));
                return {}; // Emscripten convention
            };

            /** @type {function(object): Promise<object>} */
            let loaderFunc;
            try { // Security Note: Using Function constructor can be risky if loaderScriptText is from untrusted source.
                const getLoaderFactory = new Function('moduleArg', `${this.loaderScriptText}; return Rubberband;`);
                loaderFunc = getLoaderFactory();
                if (typeof loaderFunc !== 'function') throw new Error("Loader script did not return an async function.");
            } catch (e) {
                throw new Error(`Loader script evaluation error: ${e.message}`);
            }

            this.wasmModule = await loaderFunc({instantiateWasm: instantiateWasm});
            if (!this.wasmModule || typeof this.wasmModule._rubberband_new !== 'function') {
                throw new Error("WASM module loaded, but essential Rubberband exports not found.");
            }

            const RBOptions = this.wasmModule.RubberBandOptionFlag || {};
            const options = (RBOptions.ProcessRealTime ?? 0x01) | (RBOptions.PitchHighQuality ?? 0x02000000) | (RBOptions.PhaseIndependent ?? 0x2000);
            this.rubberbandStretcher = this.wasmModule._rubberband_new(this.sampleRate, this.numberOfChannels, options, 1.0, 1.0);
            if (!this.rubberbandStretcher) throw new Error("_rubberband_new failed to create stretcher instance.");

            const pointerSize = 4;
            const frameSize = 4; // Assuming 32-bit floats and pointers
            this.inputPtrs = this.wasmModule._malloc(this.numberOfChannels * pointerSize);
            this.outputPtrs = this.wasmModule._malloc(this.numberOfChannels * pointerSize);
            if (!this.inputPtrs || !this.outputPtrs) throw new Error("Failed to allocate memory for channel pointer arrays.");

            for (let i = 0; i < this.numberOfChannels; ++i) {
                const bufferSizeBytes = this.blockSizeWasm * frameSize;
                const inputBuf = this.wasmModule._malloc(bufferSizeBytes);
                const outputBuf = this.wasmModule._malloc(bufferSizeBytes);
                if (!inputBuf || !outputBuf) {
                    this.cleanupWasmMemory();
                    throw new Error(`Buffer malloc failed for Channel ${i}.`);
                }
                this.inputChannelBuffers.push(inputBuf);
                this.outputChannelBuffers.push(outputBuf);
                this.wasmModule.HEAPU32[(this.inputPtrs / pointerSize) + i] = inputBuf;
                this.wasmModule.HEAPU32[(this.outputPtrs / pointerSize) + i] = outputBuf;
            }
            this.wasmReady = true;
            this.postStatus('processor-ready');
        } catch (error) {
            console.error(`[Worklet] WASM/Rubberband Init Error: ${error.message}`, error.stack);
            this.postError(`Init Error: ${error.message}`);
            this.wasmReady = false;
            this.rubberbandStretcher = 0;
            this.cleanupWasmMemory();
        }
    }

    /**
     * Handles messages received from the main AudioEngine via the processor's port.
     * @private
     * @param {MessageEvent<object>} event - The event containing the message data.
     * @param {string} event.data.type - Message type (e.g., 'load-audio', 'play', 'seek').
     * @param {*} [event.data.value] - Optional value associated with the message.
     * @param {ArrayBuffer[]} [event.data.channelData] - Audio data for 'load-audio'.
     * @param {number} [event.data.positionSeconds] - Seek position for 'seek'.
     */
    handleMessage(event) {
        const data = event.data;
        try {
            switch (data.type) {
                case 'load-audio':
                    this.playbackPositionInSeconds = 0;
                    this.resetNeeded = true;
                    this.streamEnded = false;
                    this.finalBlockSent = false;
                    this.currentTargetSpeed = 1.0;
                    this.lastAppliedStretchRatio = 1.0;
                    this.currentTargetPitchScale = 1.0;
                    this.lastAppliedPitchScale = 1.0;
                    this.currentTargetFormantScale = 1.0;
                    this.lastAppliedFormantScale = 1.0;
                    this.audioLoaded = false;
                    this.originalChannels = null;
                    this.sourceDurationSeconds = 0;

                    if (data.channelData && Array.isArray(data.channelData) && data.channelData.length === this.numberOfChannels) {
                        this.originalChannels = data.channelData.map(buffer => new Float32Array(buffer));
                        this.audioLoaded = true;
                        this.sourceDurationSeconds = (this.originalChannels[0]?.length || 0) / this.sampleRate;
                        if (!this.wasmReady) {
                            this.initializeWasmAndRubberband();
                        } else {
                            this.postStatus('processor-ready');
                        }
                    } else {
                        this.postError('Invalid audio data received for loading.');
                    }
                    break;
                case 'play':
                    if (this.wasmReady && this.audioLoaded) {
                        if (!this.isPlaying) {
                            if (this.streamEnded || this.playbackPositionInSeconds >= this.sourceDurationSeconds) {
                                this.playbackPositionInSeconds = 0;
                                this.resetNeeded = true;
                                this.streamEnded = false;
                                this.finalBlockSent = false;
                            }
                            this.isPlaying = true;
                            this.port?.postMessage({type: 'playback-state', isPlaying: true});
                        }
                    } else {
                        this.postError(`Cannot play: ${!this.wasmReady ? 'WASM not ready' : 'Audio not loaded'}.`);
                        this.port?.postMessage({type: 'playback-state', isPlaying: false});
                    }
                    break;
                case 'pause':
                    if (this.isPlaying) {
                        this.isPlaying = false;
                        this.port?.postMessage({type: 'playback-state', isPlaying: false});
                    }
                    break;
                case 'set-speed':
                    if (this.wasmReady && typeof data.value === 'number') this.currentTargetSpeed = Math.max(0.01, data.value);
                    break;
                case 'set-pitch':
                    if (this.wasmReady && typeof data.value === 'number') this.currentTargetPitchScale = Math.max(0.1, data.value);
                    break;
                case 'set-formant':
                    if (this.wasmReady && typeof data.value === 'number') this.currentTargetFormantScale = Math.max(0.1, data.value);
                    break;
                case 'seek':
                    if (this.wasmReady && this.audioLoaded && typeof data.positionSeconds === 'number') {
                        this.playbackPositionInSeconds = Math.max(0, Math.min(data.positionSeconds, this.sourceDurationSeconds));
                        this.resetNeeded = true;
                        this.streamEnded = false;
                        this.finalBlockSent = false;
                    }
                    break;
                case 'cleanup':
                    this.cleanup();
                    break;
                default:
                    console.warn("[Worklet] Received unknown message type:", data.type);
            }
        } catch (error) {
            this.postError(`Error in handleMessage ('${data.type}'): ${error.message}`);
            this.isPlaying = false;
            this.port?.postMessage({type: 'playback-state', isPlaying: false});
        }
    }

    /**
     * Core audio processing method. Called by the AudioWorklet system at regular intervals.
     * Manages audio data flow to/from Rubberband WASM, applies parameter changes, and handles playback state.
     * @param {Float32Array[][]} inputs - Input audio buffers (not used by this processor as it's a source).
     * @param {Float32Array[][]} outputs - Output audio buffers to be filled by this processor.
     *                                     Structure: `outputs[0][channelIndex][sampleIndex]`
     * @param {Record<string, Float32Array>} parameters - Real-time audio parameters (not used by this processor).
     * @returns {boolean} Returns `true` to keep the processor alive, `false` to terminate it.
     */
    process(inputs, outputs, parameters) {
        if (!this.wasmReady || !this.audioLoaded || !this.rubberbandStretcher || !this.wasmModule) {
            this.outputSilence(outputs);
            return true;
        }
        if (!this.isPlaying) {
            this.outputSilence(outputs);
            return true;
        }

        const outputBuffer = outputs[0];
        if (!outputBuffer || outputBuffer.length !== this.numberOfChannels || !outputBuffer[0]) {
            this.outputSilence(outputs);
            return true; // Should not happen if configured correctly
        }
        const outputBlockSize = outputBuffer[0].length; // e.g., 128 frames
        if (outputBlockSize === 0) return true;

        if (this.streamEnded) { // If stream previously ended, check if Rubberband has any remaining buffered samples
            const availableInRb = this.wasmModule._rubberband_available?.(this.rubberbandStretcher) ?? 0;
            if (Math.max(0, availableInRb) <= 0) {
                this.outputSilence(outputs);
                return true;
            }
        }

        try {
            const sourceChannels = /** @type {Float32Array[]} */ (this.originalChannels); // Assert type as it's checked by audioLoaded
            const targetStretchRatio = 1.0 / Math.max(0.01, this.currentTargetSpeed);
            const safeStretchRatio = Math.max(0.05, Math.min(20.0, targetStretchRatio));
            const safeTargetPitch = Math.max(0.1, this.currentTargetPitchScale);
            const safeTargetFormant = Math.max(0.1, this.currentTargetFormantScale);

            const ratioChanged = Math.abs(safeStretchRatio - this.lastAppliedStretchRatio) > 1e-6;
            const pitchChanged = Math.abs(safeTargetPitch - this.lastAppliedPitchScale) > 1e-6;
            const formantChanged = Math.abs(safeTargetFormant - this.lastAppliedFormantScale) > 1e-6;

            if (this.resetNeeded) {
                this.wasmModule._rubberband_reset(this.rubberbandStretcher);
                this.wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, safeStretchRatio);
                this.wasmModule._rubberband_set_pitch_scale(this.rubberbandStretcher, safeTargetPitch);
                this.wasmModule._rubberband_set_formant_scale(this.rubberbandStretcher, safeTargetFormant);
                this.lastAppliedStretchRatio = safeStretchRatio;
                this.lastAppliedPitchScale = safeTargetPitch;
                this.lastAppliedFormantScale = safeTargetFormant;
                this.resetNeeded = false;
                this.finalBlockSent = false;
                this.streamEnded = false;
            } else {
                if (ratioChanged) {
                    this.wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, safeStretchRatio);
                    this.lastAppliedStretchRatio = safeStretchRatio;
                }
                if (pitchChanged) {
                    this.wasmModule._rubberband_set_pitch_scale(this.rubberbandStretcher, safeTargetPitch);
                    this.lastAppliedPitchScale = safeTargetPitch;
                }
                if (formantChanged) {
                    this.wasmModule._rubberband_set_formant_scale(this.rubberbandStretcher, safeTargetFormant);
                    this.lastAppliedFormantScale = safeTargetFormant;
                }
            }

            let inputFramesNeeded = Math.ceil(outputBlockSize / safeStretchRatio) + 4; // Recommended buffer
            inputFramesNeeded = Math.max(1, inputFramesNeeded);
            let readPosInSourceSamples = Math.round(this.playbackPositionInSeconds * this.sampleRate);
            readPosInSourceSamples = Math.max(0, Math.min(readPosInSourceSamples, sourceChannels[0].length));
            let actualInputProvided = Math.min(inputFramesNeeded, sourceChannels[0].length - readPosInSourceSamples);
            actualInputProvided = Math.max(0, actualInputProvided); // Ensure non-negative

            const isFinalDataBlock = (readPosInSourceSamples + actualInputProvided) >= sourceChannels[0].length;
            const sendFinalFlag = isFinalDataBlock && !this.finalBlockSent;

            if (actualInputProvided > 0 || sendFinalFlag) {
                for (let i = 0; i < this.numberOfChannels; i++) {
                    const wasmInputBufferView = new Float32Array(this.wasmModule.HEAPF32.buffer, this.inputChannelBuffers[i], this.blockSizeWasm);
                    if (actualInputProvided > 0) {
                        const inputSlice = sourceChannels[i].subarray(readPosInSourceSamples, readPosInSourceSamples + actualInputProvided);
                        wasmInputBufferView.set(inputSlice.subarray(0, Math.min(inputSlice.length, this.blockSizeWasm)));
                        if (inputSlice.length < this.blockSizeWasm) wasmInputBufferView.fill(0.0, inputSlice.length);
                    } else {
                        wasmInputBufferView.fill(0.0);
                    }
                }
                this.wasmModule._rubberband_process(this.rubberbandStretcher, this.inputPtrs, actualInputProvided, sendFinalFlag ? 1 : 0);
                this.playbackPositionInSeconds += (actualInputProvided / this.sampleRate);
                this.playbackPositionInSeconds = Math.min(this.playbackPositionInSeconds, this.sourceDurationSeconds);

                let correctedTime = this.playbackPositionInSeconds;
                try {
                    const latencySamples = this.wasmModule._rubberband_get_latency?.(this.rubberbandStretcher) ?? 0;
                    if (latencySamples >= 0 && this.sampleRate > 0) {
                        const totalLatencySeconds = (latencySamples / this.sampleRate) + (outputBlockSize / this.sampleRate);
                        correctedTime = Math.max(0, this.playbackPositionInSeconds - totalLatencySeconds);
                    }
                } catch (e) { /* ignore latency error */
                }
                this.port?.postMessage({type: 'time-update', currentTime: correctedTime});
                if (sendFinalFlag) this.finalBlockSent = true;
            }

            let totalRetrieved = 0;
            const tempOutputBuffers = Array.from({length: this.numberOfChannels}, () => new Float32Array(outputBlockSize));
            let availableInRb;
            do {
                availableInRb = this.wasmModule._rubberband_available?.(this.rubberbandStretcher) ?? 0;
                availableInRb = Math.max(0, availableInRb);
                if (availableInRb <= 0) break;
                const neededNow = outputBlockSize - totalRetrieved;
                if (neededNow <= 0) break;
                const framesToRetrieve = Math.min(availableInRb, neededNow, this.blockSizeWasm);
                if (framesToRetrieve <= 0) break;
                const retrieved = this.wasmModule._rubberband_retrieve?.(this.rubberbandStretcher, this.outputPtrs, framesToRetrieve) ?? -1;
                if (retrieved > 0) {
                    for (let i = 0; i < this.numberOfChannels; i++) {
                        const wasmOutputBufferView = new Float32Array(this.wasmModule.HEAPF32.buffer, this.outputChannelBuffers[i], retrieved);
                        tempOutputBuffers[i].set(wasmOutputBufferView.subarray(0, Math.min(retrieved, tempOutputBuffers[i].length - totalRetrieved)), totalRetrieved);
                    }
                    totalRetrieved += retrieved;
                } else {
                    availableInRb = 0;
                    break;
                }
            } while (totalRetrieved < outputBlockSize);

            for (let i = 0; i < this.numberOfChannels; ++i) {
                if (outputBuffer[i]) {
                    outputBuffer[i].set(tempOutputBuffers[i].subarray(0, Math.min(totalRetrieved, outputBlockSize)));
                    if (totalRetrieved < outputBlockSize) outputBuffer[i].fill(0.0, totalRetrieved);
                }
            }

            if (this.finalBlockSent && availableInRb <= 0 && totalRetrieved < outputBlockSize) {
                if (!this.streamEnded) {
                    this.streamEnded = true;
                    this.isPlaying = false;
                    this.postStatus('Playback ended');
                    this.port?.postMessage({type: 'playback-state', isPlaying: false});
                }
            }
        } catch (error) {
            console.error(`[Worklet] Processing Error: ${error.message}`, error.stack);
            this.postError(`Processing Error: ${error.message}`);
            this.isPlaying = false;
            this.streamEnded = true;
            this.outputSilence(outputs);
            this.port?.postMessage({type: 'playback-state', isPlaying: false});
        }
        return true;
    }

    /**
     * Fills the output audio buffers with silence (zeros).
     * @private
     * @param {Float32Array[][]} outputs - The output buffers from the `process` method.
     */
    outputSilence(outputs) {
        if (!outputs?.[0]?.[0]) return; // Ensure valid structure
        for (let channel = 0; channel < outputs[0].length; ++channel) {
            outputs[0][channel]?.fill(0.0); // Fill each channel buffer with 0.0
        }
    }

    /**
     * Posts a status message to the main thread.
     * @private
     * @param {string} message - The status message.
     */
    postStatus(message) {
        try {
            this.port?.postMessage({type: 'status', message});
        } catch (e) {
            console.error(`[Worklet] FAILED to post status '${message}':`, e.message);
        }
    }

    /**
     * Posts an error message to the main thread.
     * @private
     * @param {string} message - The error message.
     */
    postError(message) {
        try {
            this.port?.postMessage({type: 'error', message});
        } catch (e) {
            console.error(`[Worklet] FAILED to post error '${message}':`, e.message);
        }
    }

    /**
     * Posts an error message and initiates cleanup of the processor.
     * @private
     * @param {string} message - The error message.
     */
    postErrorAndStop(message) {
        this.postError(message);
        this.cleanup();
    }

    /**
     * Frees WASM memory allocated for input/output channel buffers and pointer arrays.
     * @private
     */
    cleanupWasmMemory() {
        if (this.wasmModule?._free) {
            try {
                this.inputChannelBuffers.forEach(ptr => {
                    if (ptr) this.wasmModule._free(ptr);
                });
                this.outputChannelBuffers.forEach(ptr => {
                    if (ptr) this.wasmModule._free(ptr);
                });
                if (this.inputPtrs) this.wasmModule._free(this.inputPtrs);
                if (this.outputPtrs) this.wasmModule._free(this.outputPtrs);
            } catch (e) {
                console.error("[Worklet] Error during explicit WASM memory cleanup:", e.message);
            }
        }
        this.inputPtrs = 0;
        this.outputPtrs = 0;
        this.inputChannelBuffers = [];
        this.outputChannelBuffers = [];
    }

    /**
     * Cleans up all resources used by the processor, including the Rubberband instance and WASM memory.
     * Resets the processor's state.
     * @private
     */
    cleanup() {
        console.log("[Worklet] Cleanup initiated.");
        this.isPlaying = false;
        if (this.wasmReady && this.rubberbandStretcher !== 0 && this.wasmModule?._rubberband_delete) {
            try {
                this.wasmModule._rubberband_delete(this.rubberbandStretcher);
            } catch (e) {
                console.error("[Worklet] Error deleting Rubberband instance:", e.message);
            }
        }
        this.rubberbandStretcher = 0;
        this.cleanupWasmMemory();
        this.wasmReady = false;
        this.audioLoaded = false;
        this.originalChannels = null;
        this.wasmModule = null;
        // Keep wasmBinary & loaderScriptText if re-init is possible without new options.
        // For full cleanup, these would be nulled too:
        // this.wasmBinary = null; this.loaderScriptText = null;
        this.playbackPositionInSeconds = 0;
        this.streamEnded = true;
        this.finalBlockSent = false;
        this.resetNeeded = true;
        this.postStatus("Processor cleaned up");
    }
}

try {
    if (typeof registerProcessor === 'function' && typeof sampleRate !== 'undefined') { // `sampleRate` is global in AudioWorkletGlobalScope
        registerProcessor(PROCESSOR_NAME, RubberbandProcessor);
    } else {
        console.error("[Worklet] `registerProcessor` or global `sampleRate` is not defined. Cannot register RubberbandProcessor.");
        // Attempt to notify main thread about this critical failure if postMessage is available
        if (typeof self !== 'undefined' && self.postMessage) {
            self.postMessage({
                type: 'error',
                message: 'Worklet environment error: registerProcessor or sampleRate undefined.'
            });
        }
    }
} catch (error) {
    console.error(`[Worklet] CRITICAL: Failed to register processor '${PROCESSOR_NAME}'. Error: ${error.message}`, error.stack);
    if (typeof self !== 'undefined' && self.postMessage) {
        self.postMessage({type: 'error', message: `Failed to register processor ${PROCESSOR_NAME}: ${error.message}`});
    }
}
// --- /vibe-player/js/player/rubberbandProcessor.js --- // Updated Path
