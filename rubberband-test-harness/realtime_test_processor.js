const PROCESSOR_NAME = 'hybrid-processor';
const OUTPUT_SILENCE_THRESHOLD = 0.00001;

let wasmExports = null;

class HybridProcessor extends AudioWorkletProcessor {

    constructor(options) {
        super();
        console.log("[Worklet] Processor created.");

        this.processorOpts = options.processorOptions || {};
        this.sampleRate = this.processorOpts.sampleRate || currentTime;
        this.numberOfChannels = this.processorOpts.numberOfChannels || 0;
        this.initialSlowSpeed = this.processorOpts.initialSlowSpeed || 0.25;
        this.wasmBinary = this.processorOpts.wasmBinary;
        this.loaderScriptText = this.processorOpts.loaderScriptText;

        this.wasmModule = null;
        this.wasmReady = false;
        this.rubberbandStretcher = 0;

        this.isPlaying = false;
        this.currentTargetSpeed = 1.0;
        this.useSlowSource = false;
        this.lastAppliedStretchRatio = 0;
        this.lastSourceWasSlow = false;
        this.resetNeeded = true; // Flag to force reset before next process block
        this.streamEnded = false; // Flag to indicate the source stream has ended AND been processed
        this.finalBlockSent = false; // Flag to track if the final block has been sent to process

        this.playbackPositionInSeconds = 0.0;
        this.inputPtrs = 0;
        this.outputPtrs = 0;
        this.inputChannelBuffers = [];
        this.outputChannelBuffers = [];
        this.blockSizeWasm = 1024;
        this.originalChannels = null;
        this.slowChannels = null;
        this.audioLoaded = false;
        this.sourceDurationSeconds = 0;

        // Ensure port is valid before assigning onmessage
        if (this.port) {
            this.port.onmessage = this.handleMessage.bind(this);
            console.log("[Worklet] Port message handler assigned.");
        } else {
            console.error("[Worklet] CONSTRUCTOR: Message port is not available!");
            // Cannot communicate, might need to handle this state
        }
        console.log("[Worklet] Initialized state variables.");

        if (!this.wasmBinary) {
            this.postErrorAndStop("WASM binary missing.");
            return;
        }
        if (!this.loaderScriptText) {
            this.postErrorAndStop("Loader script text missing.");
            return;
        }
        if (!this.sampleRate || !this.numberOfChannels) {
            this.postErrorAndStop("SampleRate/Channels missing.");
            return;
        }
    }

    async initializeWasmAndRubberband() {
        if (this.wasmReady || !this.wasmBinary || !this.loaderScriptText) {
            console.warn("[Worklet] Skipping WASM initialization.");
            return;
        }
        try {
            console.log("[Worklet] Initializing WASM & Rubberband instance...");
            const instantiateWasm = (imports, successCallback) => {
                console.log("[Worklet] instantiateWasm hook called.");
                WebAssembly.instantiate(this.wasmBinary, imports)
                    .then(output => {
                        console.log("[Worklet] WebAssembly.instantiate successful.");
                        wasmExports = output.instance.exports;
                        successCallback(output.instance, output.module);
                        console.log("[Worklet] instantiateWasm successCallback executed.");
                    }).catch(error => {
                    console.error("[Worklet] WebAssembly.instantiate (hook) failed:", error);
                    this.postError(`WASM Instantiation hook failed: ${error.message}`);
                });
                return {};
            };
            let loaderFunc;
            try {
                console.log("[Worklet] Evaluating loader script text...");
                const getLoaderFactory = new Function(`${this.loaderScriptText}; return Rubberband;`);
                const moduleFactory = getLoaderFactory();
                loaderFunc = moduleFactory;
                if (typeof loaderFunc !== 'function') {
                    const factoryType = typeof moduleFactory;
                    const factoryValue = factoryType === 'object' ? JSON.stringify(moduleFactory) : String(moduleFactory);
                    throw new Error(`Loader script evaluation did not return a function (moduleFactory was type ${factoryType}, value: ${factoryValue.substring(0, 100)}...).`);
                }
                console.log("[Worklet] Loader function obtained via new Function.");
            } catch (loaderError) {
                console.error("[Worklet] Error evaluating loader script:", loaderError);
                throw new Error(`Could not get loader function from script: ${loaderError.message}`);
            }

            console.log("[Worklet] Calling loader function with hook and WASM binary...");
            const loadedModule = await loaderFunc({instantiateWasm: instantiateWasm, wasmBinary: this.wasmBinary});
            this.wasmModule = loadedModule;
            console.log("[Worklet] Loader promise resolved. Module object keys:", this.wasmModule ? Object.keys(this.wasmModule).length : 'null');

            if (!this.wasmModule || typeof this.wasmModule._rubberband_new !== 'function') {
                if (wasmExports && typeof wasmExports._rubberband_new === 'function') {
                    console.warn("[Worklet] Main module object missing exports, using globally stored wasmExports.");
                    this.wasmModule = wasmExports;
                } else {
                    const availableKeys = this.wasmModule ? Object.keys(this.wasmModule).join(', ') : 'undefined';
                    const exportsAvailable = wasmExports ? Object.keys(wasmExports).join(', ') : 'undefined';
                    throw new Error(`_rubberband_new not found on loaded module (${availableKeys}) or global exports (${exportsAvailable}). Loading failed.`);
                }
            }
            console.log("[Worklet] WASM Module exports verified (_rubberband_new found).");

            const RBOptions = this.wasmModule.RubberbandOptions || this.wasmModule.RubberBandOptionFlag || {};
            const ProcessRealTime = RBOptions.ProcessRealTime ?? 1;
            const EngineDefault = RBOptions.EngineDefault ?? 0;
            const PitchHighQuality = RBOptions.PitchHighQuality ?? 0x02000000;
            const options = ProcessRealTime | EngineDefault | PitchHighQuality;
            console.log(`[Worklet] Creating Rubberband instance with options: ${options.toString(16)}`);
            this.rubberbandStretcher = this.wasmModule._rubberband_new(this.sampleRate, this.numberOfChannels, options, 1.0, 1.0);
            if (!this.rubberbandStretcher) {
                throw new Error("_rubberband_new failed.");
            }
            console.log(`[Worklet] Rubberband instance created: ptr=${this.rubberbandStretcher}`);

            if (typeof this.wasmModule._malloc !== 'function' || !this.wasmModule.HEAPU32) {
                throw new Error("Memory management functions missing.");
            }
            const pointerSize = 4;
            this.inputPtrs = this.wasmModule._malloc(this.numberOfChannels * pointerSize);
            this.outputPtrs = this.wasmModule._malloc(this.numberOfChannels * pointerSize);
            if (!this.inputPtrs || !this.outputPtrs) {
                throw new Error("Failed pointer array alloc.");
            }
            console.log(`[Worklet] Allocated pointer arrays: input=${this.inputPtrs}, output=${this.outputPtrs}`);
            this.inputChannelBuffers = [];
            this.outputChannelBuffers = [];
            const frameSize = 4;
            for (let i = 0; i < this.numberOfChannels; ++i) {
                const bufferSizeBytes = this.blockSizeWasm * frameSize;
                const inputBuf = this.wasmModule._malloc(bufferSizeBytes);
                const outputBuf = this.wasmModule._malloc(bufferSizeBytes);
                if (!inputBuf || !outputBuf) {
                    this.cleanupWasmMemory();
                    throw new Error(`Buffer alloc failed Ch ${i}.`);
                }
                this.inputChannelBuffers.push(inputBuf);
                this.outputChannelBuffers.push(outputBuf);
                this.wasmModule.HEAPU32[(this.inputPtrs / pointerSize) + i] = inputBuf;
                this.wasmModule.HEAPU32[(this.outputPtrs / pointerSize) + i] = outputBuf;
            }
            console.log(`[Worklet] Allocated ${this.numberOfChannels} input/output WASM buffers (${this.blockSizeWasm} frames each).`);

            this.wasmReady = true;
            console.log("[Worklet] WASM and Rubberband instance ready.");
            this.postStatus('processor-ready'); // Signal readiness
            console.log("[Worklet] 'processor-ready' status posted."); // <-- LOGGING ADDED

        } catch (error) {
            console.error(`[Worklet] WASM/Rubberband Init Error: ${error.message}\n${error.stack}`);
            this.postError(`WASM/Rubberband Init Error: ${error.message}`);
            this.wasmReady = false;
            this.rubberbandStretcher = 0;
            this.cleanupWasmMemory();
        }
    }

    handleMessage(event) {
        const data = event.data;
        // console.log(`[Worklet] Received message: ${data.type}`); // Basic message log
        try {
            switch (data.type) {
                case 'load-audio':
                    if (this.audioLoaded) {
                        console.warn("[Worklet] Audio already loaded.");
                    }
                    if (data.channelData && Array.isArray(data.channelData) && data.channelData.length > 0) {
                        if (data.channelData.length !== this.numberOfChannels) {
                            this.postError(`Received audio has ${data.channelData.length} channels, expected ${this.numberOfChannels}.`);
                            this.audioLoaded = false;
                            return;
                        }
                        this.originalChannels = data.channelData.map(buffer => new Float32Array(buffer));
                        this.slowChannels = this.originalChannels;
                        this.audioLoaded = true;
                        this.playbackPositionInSeconds = 0;
                        this.resetNeeded = true;
                        this.streamEnded = false;
                        this.finalBlockSent = false;
                        this.sourceDurationSeconds = (this.originalChannels[0]?.length || 0) / this.sampleRate;
                        console.log(`[Worklet] Audio data received. Duration: ${this.sourceDurationSeconds.toFixed(3)}s`);
                        if (!this.wasmReady) {
                            if (this.wasmBinary && this.loaderScriptText) {
                                // Don't await, let it run in background
                                this.initializeWasmAndRubberband();
                            } else {
                                this.postError("Cannot initialize WASM: Binary or Loader script missing.");
                            }
                        } else {
                            console.log("[Worklet] WASM already ready, posting processor-ready status again for potential re-load scenario.");
                            this.postStatus('processor-ready');
                        }
                    } else {
                        this.postError('Invalid or empty audio data received.');
                        this.audioLoaded = false;
                    }
                    break;

                case 'play':
                    if (this.wasmReady && this.audioLoaded) {
                        if (!this.isPlaying) {
                            if (this.streamEnded || this.playbackPositionInSeconds >= this.sourceDurationSeconds) {
                                console.log("[Worklet] Play received after end/at end. Resetting position.");
                                this.playbackPositionInSeconds = 0;
                                this.resetNeeded = true;
                            }
                            this.isPlaying = true;
                            this.streamEnded = false;
                            this.finalBlockSent = false;
                            if (this.resetNeeded) console.log("[Worklet] Reset flag was true on Play.");
                            console.log("[Worklet] Play command processed. isPlaying = true.");
                            this.port.postMessage({type: 'playback-state', isPlaying: true});
                        } else {
                            console.log("[Worklet] Play command received, but already playing.");
                        }
                    } else {
                        const reason = !this.wasmReady ? 'WASM not ready' : 'Audio not loaded';
                        this.postError(`Cannot play: ${reason}.`);
                        console.warn(`[Worklet] Play command ignored: ${reason}.`);
                        if (this.port) this.port.postMessage({type: 'playback-state', isPlaying: false});
                    }
                    break;

                case 'pause':
                    if (this.isPlaying) {
                        this.isPlaying = false;
                        console.log("[Worklet] Pause command processed. isPlaying = false.");
                        if (this.port) this.port.postMessage({type: 'playback-state', isPlaying: false});
                    } else {
                        console.log("[Worklet] Pause command received, but already paused.");
                    }
                    break;

                case 'set-speed':
                    if (this.wasmReady) {
                        const newSpeed = Math.max(0.01, data.value);
                        if (this.currentTargetSpeed !== newSpeed) {
                            this.currentTargetSpeed = newSpeed;
                        }
                    } else {
                        console.warn("[Worklet] Cannot set speed: WASM not ready.");
                    }
                    break;
                case 'set-source':
                    if (this.wasmReady) {
                        const newUseSlow = !!data.useSlow;
                        if (this.useSlowSource !== newUseSlow) {
                            this.useSlowSource = newUseSlow;
                            this.resetNeeded = true;
                            this.streamEnded = false;
                            this.finalBlockSent = false;
                            console.log(`[Worklet] Source set to: ${this.useSlowSource ? 'Slow' : 'Original'}. Reset needed.`);
                        }
                    } else {
                        console.warn("[Worklet] Cannot set source: WASM not ready.");
                    }
                    break;
                case 'seek':
                    if (this.wasmReady && this.audioLoaded) {
                        const seekPosition = Math.max(0, Math.min(data.positionSeconds || 0, this.sourceDurationSeconds));
                        this.playbackPositionInSeconds = seekPosition;
                        this.resetNeeded = true;
                        this.streamEnded = false;
                        this.finalBlockSent = false;
                        console.log(`[Worklet] Seek to ${this.playbackPositionInSeconds.toFixed(3)}s. Reset needed.`);
                    }
                    break;
                case 'cleanup':
                    this.cleanup();
                    break;
                default:
                    console.warn("[Worklet] Received unknown message type:", data.type);
            }
        } catch (error) {
            this.postError(`Msg ${data.type} error: ${error.message}`);
            console.error(`[Worklet] Msg ${data.type} error: ${error.message}\n${error.stack}`);
            this.isPlaying = false;
            if (this.port) this.port.postMessage({type: 'playback-state', isPlaying: false});
        }
    }

    process(inputs, outputs, parameters) {
        if (!this.wasmReady || !this.audioLoaded || !this.rubberbandStretcher) {
            this.outputSilence(outputs);
            return true;
        }
        if (!this.isPlaying) {
            this.outputSilence(outputs);
            return true;
        }
        if (this.streamEnded) {
            let available = 0;
            try {
                available = this.wasmModule._rubberband_available(this.rubberbandStretcher);
                available = Math.max(0, available);
            } catch (e) {
            }
            if (available <= 0) {
                this.outputSilence(outputs);
                return true;
            }
        }

        const outputBuffer = outputs[0];
        if (!outputBuffer || outputBuffer.length !== this.numberOfChannels || !outputBuffer[0]) {
            console.warn("[Worklet] Invalid output buffer structure in process().");
            this.outputSilence(outputs);
            return true;
        }
        const outputBlockSize = outputBuffer[0].length;
        if (outputBlockSize === 0) return true;

        try {
            const sourceIsSlow = this.useSlowSource;
            const sourceChannels = sourceIsSlow ? this.slowChannels : this.originalChannels;
            const sourceSpeed = sourceIsSlow ? this.initialSlowSpeed : 1.0;
            const safeTargetSpeed = Math.max(0.01, this.currentTargetSpeed);
            const targetStretchRatio = sourceSpeed / safeTargetSpeed;
            const safeStretchRatio = Math.max(0.05, Math.min(20.0, targetStretchRatio));
            const ratioChanged = Math.abs(safeStretchRatio - this.lastAppliedStretchRatio) > 1e-6;
            const sourceChanged = sourceIsSlow !== this.lastSourceWasSlow;

            if (this.resetNeeded) {
                console.log(`[Worklet] Resetting Rubberband. Ratio: ${safeStretchRatio.toFixed(3)}`);
                this.wasmModule._rubberband_reset(this.rubberbandStretcher);
                this.wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, safeStretchRatio);
                this.lastAppliedStretchRatio = safeStretchRatio;
                this.lastSourceWasSlow = sourceIsSlow;
                this.resetNeeded = false;
                this.finalBlockSent = false;
                this.streamEnded = false;
            } else if (sourceChanged) {
                console.log(`[Worklet] Resetting Rubberband due to source change. Ratio: ${safeStretchRatio.toFixed(3)}`);
                this.wasmModule._rubberband_reset(this.rubberbandStretcher);
                this.wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, safeStretchRatio);
                this.lastAppliedStretchRatio = safeStretchRatio;
                this.lastSourceWasSlow = sourceIsSlow;
                this.finalBlockSent = false;
                this.streamEnded = false;
            } else if (ratioChanged) {
                this.wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, safeStretchRatio);
                this.lastAppliedStretchRatio = safeStretchRatio;
            }

            let inputFramesNeeded = Math.ceil(outputBlockSize / safeStretchRatio) + 4;
            inputFramesNeeded = Math.max(1, inputFramesNeeded);
            let readPosInSourceSamples = Math.round(this.playbackPositionInSeconds * this.sampleRate);
            const sourceTotalSamples = sourceChannels[0]?.length || 0;
            readPosInSourceSamples = Math.max(0, Math.min(readPosInSourceSamples, sourceTotalSamples));
            let actualInputProvided = Math.min(inputFramesNeeded, sourceTotalSamples - readPosInSourceSamples);
            actualInputProvided = Math.max(0, actualInputProvided);
            const isFinalDataBlock = (readPosInSourceSamples + actualInputProvided) >= sourceTotalSamples;
            const sendFinalFlag = isFinalDataBlock && !this.finalBlockSent;

            if (actualInputProvided > 0 || sendFinalFlag) {
                for (let i = 0; i < this.numberOfChannels; i++) {
                    const sourceData = sourceChannels[i];
                    const wasmInputBufferView = new Float32Array(this.wasmModule.HEAPF32.buffer, this.inputChannelBuffers[i], this.blockSizeWasm);
                    if (actualInputProvided > 0) {
                        const endReadPos = readPosInSourceSamples + actualInputProvided;
                        const inputSlice = sourceData.subarray(readPosInSourceSamples, endReadPos);
                        const copyLength = Math.min(inputSlice.length, this.blockSizeWasm);
                        if (copyLength > 0) {
                            wasmInputBufferView.set(inputSlice.subarray(0, copyLength));
                        }
                        if (copyLength < this.blockSizeWasm) {
                            wasmInputBufferView.fill(0.0, copyLength, this.blockSizeWasm);
                        }
                    } else {
                        wasmInputBufferView.fill(0.0);
                    }
                }
                this.wasmModule._rubberband_process(this.rubberbandStretcher, this.inputPtrs, actualInputProvided, sendFinalFlag ? 1 : 0);
                if (sendFinalFlag) {
                    console.log("[Worklet] Final block flag sent.");
                    this.finalBlockSent = true;
                }
            }

            let totalRetrieved = 0;
            let available = 0;
            const tempOutputBuffers = Array.from({length: this.numberOfChannels}, () => new Float32Array(outputBlockSize));
            do {
                available = this.wasmModule._rubberband_available(this.rubberbandStretcher);
                available = Math.max(0, available);
                if (available > 0) {
                    const neededNow = outputBlockSize - totalRetrieved;
                    if (neededNow <= 0) break;
                    const framesToRetrieve = Math.min(available, neededNow, this.blockSizeWasm);
                    if (framesToRetrieve <= 0) break;
                    const retrieved = this.wasmModule._rubberband_retrieve(this.rubberbandStretcher, this.outputPtrs, framesToRetrieve);
                    if (retrieved > 0) {
                        for (let i = 0; i < this.numberOfChannels; i++) {
                            const wasmOutputBufferView = new Float32Array(this.wasmModule.HEAPF32.buffer, this.outputChannelBuffers[i], retrieved);
                            const copyLength = Math.min(retrieved, tempOutputBuffers[i].length - totalRetrieved);
                            if (copyLength > 0) {
                                tempOutputBuffers[i].set(wasmOutputBufferView.subarray(0, copyLength), totalRetrieved);
                            }
                        }
                        totalRetrieved += retrieved;
                    } else if (retrieved < 0) {
                        console.error(`[Worklet] _rubberband_retrieve error: ${retrieved}`);
                        available = 0;
                        break;
                    } else {
                        available = 0;
                    }
                }
            } while (available > 0 && totalRetrieved < outputBlockSize);

            for (let i = 0; i < this.numberOfChannels; ++i) {
                if (outputBuffer[i]) {
                    const copyLength = Math.min(totalRetrieved, outputBlockSize);
                    if (copyLength > 0) {
                        outputBuffer[i].set(tempOutputBuffers[i].subarray(0, copyLength));
                    }
                    if (copyLength < outputBlockSize) {
                        outputBuffer[i].fill(0.0, copyLength);
                    }
                }
            }
            const inputSecondsConsumedOriginalTime = (actualInputProvided / this.sampleRate);
            this.playbackPositionInSeconds += inputSecondsConsumedOriginalTime;
            this.playbackPositionInSeconds = Math.min(this.playbackPositionInSeconds, this.sourceDurationSeconds);

            if (this.finalBlockSent && available <= 0 && totalRetrieved < outputBlockSize) {
                if (!this.streamEnded) {
                    console.log("[Worklet] Stream ended (final block processed, no more available).");
                    this.streamEnded = true;
                    this.isPlaying = false;
                    this.playbackPositionInSeconds = 0;
                    this.resetNeeded = true;
                    this.postStatus('Playback ended');
                    if (this.port) this.port.postMessage({type: 'playback-state', isPlaying: false});
                }
            }

        } catch (error) {
            console.error(`[Worklet] Processing Error: ${error.message}\n${error.stack}`);
            this.postError(`Processing Error: ${error.message}`);
            this.isPlaying = false;
            this.streamEnded = true;
            this.outputSilence(outputs);
            if (this.port) this.port.postMessage({type: 'playback-state', isPlaying: false});
            return true;
        }

        return true;
    } // End process

    outputSilence(outputs) {
        if (!outputs || !outputs[0] || !outputs[0][0]) return;
        const outputChannels = outputs[0];
        const numChannels = Math.min(outputChannels.length, this.numberOfChannels || outputChannels.length);
        const blockSize = outputChannels[0]?.length || 0;
        if (blockSize === 0) return;
        for (let i = 0; i < numChannels; ++i) {
            if (outputChannels[i]) {
                outputChannels[i].fill(0.0);
            }
        }
    }

    postStatus(message) {
        try {
            console.log(`[Worklet] Attempting to post status: ${message}`); // <-- ADDED LOG
            if (!this.port) {
                console.error("[Worklet] Port is null, cannot post status.");
                return;
            }
            this.port.postMessage({type: 'status', message});
        } catch (e) {
            console.error(`[Worklet] FAILED to post status message '${message}':`, e); // <-- LOGGING ADDED
        }
    }

    postError(message) {
        try {
            if (!this.port) {
                console.error("[Worklet] Port is null, cannot post error.");
                return;
            }
            this.port.postMessage({type: 'error', message});
        } catch (e) {
            console.error(`[Worklet] FAILED to post error message '${message}':`, e); // <-- LOGGING ADDED
        }
    }

    postErrorAndStop(message) {
        this.postError(message);
        this.cleanup();
    }

    cleanupWasmMemory() {
        if (this.wasmModule && typeof this.wasmModule._free === 'function') {
            console.log("[Worklet] Cleaning up WASM memory...");
            try {
                this.inputChannelBuffers.forEach(ptr => {
                    if (ptr) this.wasmModule._free(ptr);
                });
                this.outputChannelBuffers.forEach(ptr => {
                    if (ptr) this.wasmModule._free(ptr);
                });
                this.inputChannelBuffers = [];
                this.outputChannelBuffers = [];
                if (this.inputPtrs) this.wasmModule._free(this.inputPtrs);
                if (this.outputPtrs) this.wasmModule._free(this.outputPtrs);
                this.inputPtrs = 0;
                this.outputPtrs = 0;
                console.log("[Worklet] Freed WASM buffers/pointers.");
            } catch (e) {
                console.error("[Worklet] Error during WASM memory cleanup:", e);
            }
        } else {
            console.warn("[Worklet] Skipping WASM memory cleanup: Module or _free not available.");
        }
    }

    cleanup() {
        console.log("[Worklet] Cleanup requested.");
        this.isPlaying = false;
        if (this.wasmReady && this.rubberbandStretcher !== 0 && this.wasmModule && typeof this.wasmModule._rubberband_delete === 'function') {
            try {
                console.log(`[Worklet] Deleting Rubberband instance: ptr=${this.rubberbandStretcher}`);
                this.wasmModule._rubberband_delete(this.rubberbandStretcher);
                this.rubberbandStretcher = 0;
                console.log("[Worklet] Rubberband instance deleted.");
            } catch (e) {
                console.error("[Worklet] Error deleting Rubberband instance:", e);
            }
        } else {
            console.warn("[Worklet] Skipping Rubberband instance deletion.");
        }
        this.cleanupWasmMemory();
        this.wasmReady = false;
        this.audioLoaded = false;
        this.originalChannels = null;
        this.slowChannels = null;
        this.wasmModule = null;
        this.wasmBinary = null;
        this.loaderScriptText = null;
        this.playbackPositionInSeconds = 0;
        this.streamEnded = true;
        this.finalBlockSent = false;
        this.resetNeeded = true;
        console.log("[Worklet] Cleanup finished.");
        this.postStatus("Processor cleaned up");
    }

} // End class

try {
    if (typeof registerProcessor === 'function') {
        registerProcessor(PROCESSOR_NAME, HybridProcessor);
        console.log(`[Worklet] ${PROCESSOR_NAME} registered.`);
    } else {
        console.error("[Worklet] registerProcessor not defined.");
    }
} catch (error) {
    console.error(`[Worklet] Failed to register processor:`, error);
    try {
        if (self?.postMessage) self.postMessage({
            type: 'error',
            message: `Failed to register processor: ${error.message}`
        });
    } catch (e) {
    }
}
