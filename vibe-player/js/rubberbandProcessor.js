// --- /vibe-player/js/rubberbandProcessor.js ---
// AudioWorkletProcessor for real-time time-stretching using Rubberband WASM.

// Processor Name - must match the name used when creating the AudioWorkletNode
const PROCESSOR_NAME = 'rubberband-processor';

/**
 * @class RubberbandProcessor
 * @extends AudioWorkletProcessor
 * @description Processes audio using the Rubberband library compiled to WASM.
 *              Handles loading, playback control, dynamic speed changes, and seeking.
 */
class RubberbandProcessor extends AudioWorkletProcessor {

    /**
     * @constructor
     * @param {AudioWorkletNodeOptions} options - Options passed from the AudioWorkletNode constructor.
     * @param {object} options.processorOptions - Custom options for the processor.
     * @param {number} options.processorOptions.sampleRate - The sample rate of the AudioContext.
     * @param {number} options.processorOptions.numberOfChannels - Number of audio channels.
     * @param {ArrayBuffer} options.processorOptions.wasmBinary - The pre-fetched Rubberband WASM binary.
     * @param {string} options.processorOptions.loaderScriptText - The pre-fetched Rubberband WASM loader script text.
     */
    constructor(options) {
        super();
        console.log("[Worklet] RubberbandProcessor created.");

        // --- Initialization from options ---
        this.processorOpts = options.processorOptions || {};
        this.sampleRate = this.processorOpts.sampleRate || currentTime; // currentTime is a global in AudioWorkletGlobalScope
        this.numberOfChannels = this.processorOpts.numberOfChannels || 0;
        this.wasmBinary = this.processorOpts.wasmBinary; // Should be an ArrayBuffer
        this.loaderScriptText = this.processorOpts.loaderScriptText; // Should be a string

        // --- WASM and Rubberband State ---
        /** @type {object|null} WASM module exports */
        this.wasmModule = null;
        /** @type {boolean} Flag indicating WASM and Rubberband instance are ready */
        this.wasmReady = false;
        /** @type {number} Pointer to the RubberbandStretcher instance in WASM memory */
        this.rubberbandStretcher = 0; // WASM pointer (integer)

        // --- Playback State ---
        /** @type {boolean} Controls if audio processing occurs */
        this.isPlaying = false;
        /** @type {number} The target playback speed ratio (1.0 = normal) */
        this.currentTargetSpeed = 1.0;
        /** @type {number} The stretch ratio last applied to Rubberband (1 / targetSpeed) */
        this.lastAppliedStretchRatio = 1.0;
        /** @type {boolean} Flag indicating a state reset is needed before the next process block */
        this.resetNeeded = true;
        /** @type {boolean} Flag indicating the end of the source audio has been processed */
        this.streamEnded = false;
        /** @type {boolean} Flag to track if the final block flag has been sent to _rubberband_process */
        this.finalBlockSent = false;

        // --- Audio Data & Buffers ---
        /** @type {number} Current playback position within the source audio (in seconds) */
        this.playbackPositionInSeconds = 0.0;
        /** @type {number} Pointer to the array of input channel pointers in WASM memory */
        this.inputPtrs = 0;
        /** @type {number} Pointer to the array of output channel pointers in WASM memory */
        this.outputPtrs = 0;
        /** @type {number[]} Array holding pointers to individual input channel buffers in WASM memory */
        this.inputChannelBuffers = [];
         /** @type {number[]} Array holding pointers to individual output channel buffers in WASM memory */
        this.outputChannelBuffers = [];
        /** @const {number} Size of processing blocks used internally by WASM (must match library expectations if fixed) */
        this.blockSizeWasm = 1024; // Typical Rubberband block size
        /** @type {Float32Array[]|null} Array containing the full audio data for each channel */
        this.originalChannels = null;
        /** @type {boolean} Flag indicating if audio data has been loaded */
        this.audioLoaded = false;
        /** @type {number} Duration of the loaded audio in seconds */
        this.sourceDurationSeconds = 0;

        // --- Communication & Initialization ---
        if (this.port) {
            this.port.onmessage = this.handleMessage.bind(this);
            console.log("[Worklet] Port message handler assigned.");
        } else {
            // This shouldn't happen in normal operation but good to log
            console.error("[Worklet] CONSTRUCTOR: Message port is not available!");
        }

        // --- Initial Checks ---
        if (!this.wasmBinary) this.postErrorAndStop("WASM binary missing in options.");
        if (!this.loaderScriptText) this.postErrorAndStop("Loader script text missing in options.");
        if (!this.sampleRate || this.sampleRate <= 0) this.postErrorAndStop("Invalid SampleRate provided.");
        if (!this.numberOfChannels || this.numberOfChannels <= 0) this.postErrorAndStop("Invalid NumberOfChannels provided.");

        // WASM initialization is triggered by the 'load-audio' message.
        console.log("[Worklet] Initialized state variables. Waiting for audio data.");
    } // --- End Constructor ---

    /**
     * Initializes the WASM module and creates the Rubberband instance.
     * Uses the pre-fetched binary and loader script text.
     * @private
     * @returns {Promise<void>}
     */
    async initializeWasmAndRubberband() {
        if (this.wasmReady) {
            console.warn("[Worklet] WASM/Rubberband already initialized.");
            return;
        }
        if (!this.wasmBinary || !this.loaderScriptText) {
            this.postErrorAndStop("Cannot initialize WASM: Binary or Loader script missing.");
            return;
        }

        try {
            this.postStatus("Initializing WASM & Rubberband...");
            console.log("[Worklet] Initializing WASM & Rubberband instance...");

            // Hook for the loader to instantiate the WASM module
            const instantiateWasm = (imports, successCallback) => {
                console.log("[Worklet] instantiateWasm hook called.");
                WebAssembly.instantiate(this.wasmBinary, imports)
                    .then(output => {
                        console.log("[Worklet] WebAssembly.instantiate successful.");
                        // wasmExports = output.instance.exports; // Not strictly needed if module resolves correctly
                        successCallback(output.instance, output.module);
                        console.log("[Worklet] instantiateWasm successCallback executed.");
                    }).catch(error => {
                    console.error("[Worklet] WebAssembly.instantiate (hook) failed:", error);
                    this.postError(`WASM Instantiation hook failed: ${error.message}`);
                });
                return {}; // Indicate async instantiation
            };

            // Execute the loader script text to get the module factory function
            let loaderFunc;
            try {
                console.log("[Worklet] Evaluating loader script text...");
                // Safer than eval: Creates function in global scope, but isolated from constructor scope vars
                const getLoaderFactory = new Function(`${this.loaderScriptText}; return Rubberband;`);
                const moduleFactory = getLoaderFactory(); // Get the outer IIFE result
                loaderFunc = moduleFactory; // The factory returns the async loader function
                if (typeof loaderFunc !== 'function') {
                    throw new Error(`Loader script evaluation did not return a function.`);
                }
                console.log("[Worklet] Loader function obtained via new Function.");
            } catch (loaderError) {
                console.error("[Worklet] Error evaluating loader script:", loaderError);
                throw new Error(`Could not get loader function from script: ${loaderError.message}`);
            }

            // Call the loader function returned by the factory
            console.log("[Worklet] Calling loader function with hook...");
            // Pass only the necessary parts of the environment for the loader
            const loadedModule = await loaderFunc({ instantiateWasm: instantiateWasm });
            this.wasmModule = loadedModule; // Store the resolved module with exports
            console.log("[Worklet] Loader promise resolved. Module object keys:", this.wasmModule ? Object.keys(this.wasmModule).length : 'null');

            // --- Verification ---
            if (!this.wasmModule || typeof this.wasmModule._rubberband_new !== 'function') {
                 throw new Error(`_rubberband_new not found on loaded WASM module. Loading failed.`);
            }
            console.log("[Worklet] WASM Module exports verified (_rubberband_new found).");

            // --- Rubberband Instance Creation ---
            // Access flags directly from the loaded module
            const RBOptions = this.wasmModule.RubberBandOptionFlag || {};
            const ProcessRealTime = RBOptions.ProcessRealTime ?? 0x00000001;
            const EngineDefault = RBOptions.EngineDefault ?? 0x00000000; // Typically EngineFaster
            const PitchHighQuality = RBOptions.PitchHighQuality ?? 0x02000000;
            const options = ProcessRealTime | EngineDefault | PitchHighQuality; // Use real-time mode
            console.log(`[Worklet] Creating Rubberband instance with options: ${options.toString(16)}`);

            this.rubberbandStretcher = this.wasmModule._rubberband_new(
                this.sampleRate,
                this.numberOfChannels,
                options,
                1.0, // Initial time ratio (will be updated)
                1.0  // Initial pitch scale (not changing pitch)
            );
            if (!this.rubberbandStretcher) {
                throw new Error("_rubberband_new failed to create stretcher instance.");
            }
            console.log(`[Worklet] Rubberband instance created: ptr=${this.rubberbandStretcher}`);

            // --- Memory Allocation ---
            if (typeof this.wasmModule._malloc !== 'function' || typeof this.wasmModule._free !== 'function' || !this.wasmModule.HEAPU32 || !this.wasmModule.HEAPF32) {
                throw new Error("WASM module memory or allocation functions missing.");
            }
            const pointerSize = 4; // Assuming 32-bit WASM pointers
            this.inputPtrs = this.wasmModule._malloc(this.numberOfChannels * pointerSize);
            this.outputPtrs = this.wasmModule._malloc(this.numberOfChannels * pointerSize);
            if (!this.inputPtrs || !this.outputPtrs) {
                throw new Error("Failed to allocate pointer arrays in WASM memory.");
            }
            console.log(`[Worklet] Allocated pointer arrays: input=${this.inputPtrs}, output=${this.outputPtrs}`);

            this.inputChannelBuffers = [];
            this.outputChannelBuffers = [];
            const frameSize = 4; // sizeof(float)
            for (let i = 0; i < this.numberOfChannels; ++i) {
                const bufferSizeBytes = this.blockSizeWasm * frameSize;
                const inputBuf = this.wasmModule._malloc(bufferSizeBytes);
                const outputBuf = this.wasmModule._malloc(bufferSizeBytes);
                if (!inputBuf || !outputBuf) {
                    this.cleanupWasmMemory(); // Clean up previously allocated memory
                    throw new Error(`Failed to allocate channel buffer ${i} in WASM memory.`);
                }
                this.inputChannelBuffers.push(inputBuf);
                this.outputChannelBuffers.push(outputBuf);
                // Write pointer values into the pointer arrays
                this.wasmModule.HEAPU32[(this.inputPtrs / pointerSize) + i] = inputBuf;
                this.wasmModule.HEAPU32[(this.outputPtrs / pointerSize) + i] = outputBuf;
            }
            console.log(`[Worklet] Allocated ${this.numberOfChannels} input/output WASM channel buffers (${this.blockSizeWasm} frames each).`);

            this.wasmReady = true;
            console.log("[Worklet] WASM and Rubberband instance ready.");
            this.postStatus('processor-ready'); // Signal readiness *after* everything is set up

        } catch (error) {
            console.error(`[Worklet] WASM/Rubberband Init Error: ${error.message}\n${error.stack}`);
            this.postError(`WASM/Rubberband Init Error: ${error.message}`);
            this.wasmReady = false;
            this.rubberbandStretcher = 0;
            this.cleanupWasmMemory(); // Attempt cleanup on failure
        }
    } // --- End initializeWasmAndRubberband ---

    /**
     * Handles messages received from the main thread via the node's port.
     * @param {MessageEvent} event - The message event containing data.
     */
    handleMessage(event) {
        const data = event.data;
        // console.log(`[Worklet] Received message: ${data.type}`); // Basic message log
        try {
            switch (data.type) {
                case 'load-audio':
                    if (this.audioLoaded) {
                        console.warn("[Worklet] Audio already loaded, overwriting.");
                        // Reset state before loading new audio
                        this.playbackPositionInSeconds = 0;
                        this.resetNeeded = true;
                        this.streamEnded = false;
                        this.finalBlockSent = false;
                    }
                    if (data.channelData && Array.isArray(data.channelData) && data.channelData.length > 0) {
                        if (data.channelData.length !== this.numberOfChannels) {
                            this.postError(`Received audio has ${data.channelData.length} channels, expected ${this.numberOfChannels}.`);
                            this.audioLoaded = false;
                            return;
                        }
                        // Convert ArrayBuffers back to Float32Arrays
                        this.originalChannels = data.channelData.map(buffer => new Float32Array(buffer));
                        this.audioLoaded = true;
                        this.sourceDurationSeconds = (this.originalChannels[0]?.length || 0) / this.sampleRate;
                        console.log(`[Worklet] Audio data received and stored. Duration: ${this.sourceDurationSeconds.toFixed(3)}s`);

                        // Trigger WASM initialization if not already done
                        if (!this.wasmReady) {
                            if (this.wasmBinary && this.loaderScriptText) {
                                // Don't await, let it run in background and signal readiness via message
                                this.initializeWasmAndRubberband();
                            } else {
                                this.postError("Cannot initialize WASM: Binary or Loader script missing.");
                            }
                        } else {
                            // If WASM was already ready, signal processor readiness again for the new audio.
                            console.log("[Worklet] WASM already ready, signaling processor-ready for new audio.");
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
                            // If playback ended or was stopped at the end, reset position to start
                            if (this.streamEnded || this.playbackPositionInSeconds >= this.sourceDurationSeconds) {
                                console.log("[Worklet] Play received after end/at end. Resetting position.");
                                this.playbackPositionInSeconds = 0;
                                this.resetNeeded = true; // Force reset before playing again
                                this.streamEnded = false;
                                this.finalBlockSent = false;
                            }
                            this.isPlaying = true;
                            console.log("[Worklet] Play command processed. isPlaying = true.");
                            this.port?.postMessage({ type: 'playback-state', isPlaying: true }); // Confirm state
                        } else {
                            console.log("[Worklet] Play command received, but already playing.");
                        }
                    } else {
                        const reason = !this.wasmReady ? 'WASM not ready' : 'Audio not loaded';
                        this.postError(`Cannot play: ${reason}.`);
                        console.warn(`[Worklet] Play command ignored: ${reason}.`);
                        this.port?.postMessage({ type: 'playback-state', isPlaying: false }); // Ensure main thread knows it's not playing
                    }
                    break;

                case 'pause':
                    if (this.isPlaying) {
                        this.isPlaying = false;
                        console.log("[Worklet] Pause command processed. isPlaying = false.");
                        this.port?.postMessage({ type: 'playback-state', isPlaying: false }); // Confirm state
                    } else {
                        console.log("[Worklet] Pause command received, but already paused.");
                    }
                    break;

                case 'set-speed':
                    if (this.wasmReady) {
                        const newSpeed = Math.max(0.01, data.value || 1.0); // Ensure speed is positive
                        if (this.currentTargetSpeed !== newSpeed) {
                            this.currentTargetSpeed = newSpeed;
                            console.log(`[Worklet] Target speed updated to ${this.currentTargetSpeed.toFixed(3)}x.`);
                            // Ratio update happens within process() loop if needed
                        }
                    } else {
                        console.warn("[Worklet] Cannot set speed: WASM not ready.");
                    }
                    break;

                 case 'seek':
                    if (this.wasmReady && this.audioLoaded) {
                        const seekPosition = Math.max(0, Math.min(data.positionSeconds || 0, this.sourceDurationSeconds));
                        this.playbackPositionInSeconds = seekPosition;
                        this.resetNeeded = true; // Force reset to clear internal buffers
                        this.streamEnded = false; // If seeking, we haven't ended yet
                        this.finalBlockSent = false;
                        console.log(`[Worklet] Seek command processed. New position: ${this.playbackPositionInSeconds.toFixed(3)}s. Reset needed.`);
                        // No need to reset rubberband here, resetNeeded flag handles it in process()
                    } else {
                        console.warn("[Worklet] Cannot seek: WASM not ready or audio not loaded.");
                    }
                    break;

                case 'cleanup':
                    this.cleanup();
                    break;

                default:
                    console.warn("[Worklet] Received unknown message type:", data.type);
            }
        } catch (error) {
            this.postError(`Error handling message ${data.type}: ${error.message}`);
            console.error(`[Worklet] Error handling message ${data.type}: ${error.message}\n${error.stack}`);
            this.isPlaying = false; // Stop processing on error
            this.port?.postMessage({ type: 'playback-state', isPlaying: false });
        }
    } // --- End handleMessage ---

    /**
     * The core audio processing function called by the AudioWorklet system.
     * @param {Float32Array[][]} inputs - Input audio data (not used in this source-node setup).
     * @param {Float32Array[][]} outputs - Output buffers to fill with processed audio.
     * @param {Record<string, Float32Array>} parameters - Audio parameters (not used here).
     * @returns {boolean} `true` to keep the processor alive, `false` to terminate.
     */
    process(inputs, outputs, parameters) {
        // --- Pre-computation Checks ---
        if (!this.wasmReady || !this.audioLoaded || !this.rubberbandStretcher) {
            // If not ready, output silence and keep processor alive waiting for init/audio
            this.outputSilence(outputs);
            return true;
        }
        if (!this.isPlaying) {
            // If paused, output silence but keep alive
            this.outputSilence(outputs);
            return true;
        }
        // If stream ended AND rubberband has no more output, silence and keep alive (until cleanup)
        if (this.streamEnded) {
             let available = 0;
             try {
                 available = this.wasmModule?._rubberband_available(this.rubberbandStretcher) ?? 0;
                 available = Math.max(0, available); // Ensure non-negative
             } catch (e) { /* Ignore potential errors checking availability after end */ }
             if (available <= 0) {
                 this.outputSilence(outputs);
                 return true; // Keep alive, waiting for potential seek/play or cleanup
             }
        }

        const outputBuffer = outputs[0]; // Assuming one output
        // Validate output structure
        if (!outputBuffer || outputBuffer.length !== this.numberOfChannels || !outputBuffer[0]) {
            console.warn("[Worklet] Invalid output buffer structure in process(). Outputting silence.");
            this.outputSilence(outputs);
            return true; // Keep alive
        }
        const outputBlockSize = outputBuffer[0].length; // e.g., 128 samples
        if (outputBlockSize === 0) return true; // Nothing to do for this block

        try {
            // --- Ratio and State Management ---
            const sourceChannels = this.originalChannels; // Always use original source now
            const sourceSpeed = 1.0; // Source speed is always 1.0
            const safeTargetSpeed = Math.max(0.01, this.currentTargetSpeed); // Ensure > 0
            const targetStretchRatio = sourceSpeed / safeTargetSpeed; // Ratio needed by Rubberband
            const safeStretchRatio = Math.max(0.05, Math.min(20.0, targetStretchRatio)); // Clamp ratio
            const ratioChanged = Math.abs(safeStretchRatio - this.lastAppliedStretchRatio) > 1e-6;

            // Reset Rubberband state if needed (seek, start, significant ratio change)
            if (this.resetNeeded) {
                console.log(`[Worklet] Resetting Rubberband state. Ratio: ${safeStretchRatio.toFixed(3)}`);
                this.wasmModule._rubberband_reset(this.rubberbandStretcher);
                this.wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, safeStretchRatio);
                this.lastAppliedStretchRatio = safeStretchRatio;
                this.resetNeeded = false;
                this.finalBlockSent = false; // Reset flag on explicit reset
                this.streamEnded = false;   // Reset flag on explicit reset
            } else if (ratioChanged) {
                // If only the ratio changed significantly, update it without a full reset
                console.log(`[Worklet] Updating time ratio to ${safeStretchRatio.toFixed(3)}`);
                this.wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, safeStretchRatio);
                this.lastAppliedStretchRatio = safeStretchRatio;
            }

            // --- Input Data Preparation ---
            // Calculate how many input frames are likely needed for this output block. Add buffer.
            let inputFramesNeeded = Math.ceil(outputBlockSize / safeStretchRatio) + 4; // Small buffer
            inputFramesNeeded = Math.max(1, inputFramesNeeded); // Need at least 1

            // Calculate current read position in the source audio data
            let readPosInSourceSamples = Math.round(this.playbackPositionInSeconds * this.sampleRate);
            const sourceTotalSamples = sourceChannels[0]?.length || 0;
            readPosInSourceSamples = Math.max(0, Math.min(readPosInSourceSamples, sourceTotalSamples)); // Clamp position

            // Determine how many input samples are actually available from the current position
            let actualInputProvided = Math.min(inputFramesNeeded, sourceTotalSamples - readPosInSourceSamples);
            actualInputProvided = Math.max(0, actualInputProvided); // Ensure non-negative

            // Check if this is the last block of data from the source
            const isFinalDataBlock = (readPosInSourceSamples + actualInputProvided) >= sourceTotalSamples;
            // Determine if the 'final' flag needs to be sent to rubberband_process
            const sendFinalFlag = isFinalDataBlock && !this.finalBlockSent;

            // --- Process Input with Rubberband ---
            if (actualInputProvided > 0 || sendFinalFlag) {
                // Prepare WASM input buffers
                for (let i = 0; i < this.numberOfChannels; i++) {
                    const sourceData = sourceChannels[i];
                    const wasmInputBufferView = new Float32Array(this.wasmModule.HEAPF32.buffer, this.inputChannelBuffers[i], this.blockSizeWasm);
                    if (actualInputProvided > 0) {
                        const endReadPos = readPosInSourceSamples + actualInputProvided;
                        const inputSlice = sourceData.subarray(readPosInSourceSamples, endReadPos);
                        const copyLength = Math.min(inputSlice.length, this.blockSizeWasm); // Don't overflow WASM buffer
                        if (copyLength > 0) {
                            wasmInputBufferView.set(inputSlice.subarray(0, copyLength));
                        }
                        // Zero-pad the rest of the WASM buffer if needed
                        if (copyLength < this.blockSizeWasm) {
                            wasmInputBufferView.fill(0.0, copyLength);
                        }
                    } else {
                        // If no actual data but sending final flag, zero out the buffer
                        wasmInputBufferView.fill(0.0);
                    }
                }

                // Call rubberband_process
                this.wasmModule._rubberband_process(
                    this.rubberbandStretcher,
                    this.inputPtrs,
                    actualInputProvided,
                    sendFinalFlag ? 1 : 0 // final flag
                );

                // Update playback position based on input consumed
                // Convert samples consumed back to seconds
                const inputSecondsConsumed = (actualInputProvided / this.sampleRate);
                this.playbackPositionInSeconds += inputSecondsConsumed;
                 // Clamp position to duration just in case
                this.playbackPositionInSeconds = Math.min(this.playbackPositionInSeconds, this.sourceDurationSeconds);

                // Send time update message (potentially throttle this later)
                this.port?.postMessage({type: 'time-update', currentTime: this.playbackPositionInSeconds });

                if (sendFinalFlag) {
                    console.log("[Worklet] Final block flag sent to _rubberband_process.");
                    this.finalBlockSent = true; // Mark that the final flag has been sent
                }
            }

            // --- Retrieve Processed Output ---
            let totalRetrieved = 0;
            let available = 0;
            // Create temporary buffers to hold potentially multiple retrieve calls
            const tempOutputBuffers = Array.from({ length: this.numberOfChannels }, () => new Float32Array(outputBlockSize));

            // Loop until we fill the output block or Rubberband has no more samples
            do {
                available = this.wasmModule._rubberband_available(this.rubberbandStretcher);
                available = Math.max(0, available); // Ensure non-negative

                if (available > 0) {
                    const neededNow = outputBlockSize - totalRetrieved;
                    if (neededNow <= 0) break; // Output block is full

                    // Determine how many frames to retrieve in this iteration
                    const framesToRetrieve = Math.min(available, neededNow, this.blockSizeWasm);
                    if (framesToRetrieve <= 0) break; // Should not happen if available > 0, but safety check

                    // Retrieve the processed samples into WASM memory
                    const retrieved = this.wasmModule._rubberband_retrieve(
                        this.rubberbandStretcher,
                        this.outputPtrs,
                        framesToRetrieve
                    );

                    if (retrieved > 0) {
                         // Copy retrieved samples from WASM memory to temporary JS buffers
                         for (let i = 0; i < this.numberOfChannels; i++) {
                            // Create a view into the WASM output buffer for this channel
                            const wasmOutputBufferView = new Float32Array(this.wasmModule.HEAPF32.buffer, this.outputChannelBuffers[i], retrieved);
                            // Determine how many samples can be copied into the remaining space
                            const copyLength = Math.min(retrieved, tempOutputBuffers[i].length - totalRetrieved);
                             if (copyLength > 0) {
                                // Copy the subarray into the correct position in the temp buffer
                                tempOutputBuffers[i].set(wasmOutputBufferView.subarray(0, copyLength), totalRetrieved);
                             }
                         }
                         totalRetrieved += retrieved; // Update total retrieved count
                    } else if (retrieved < 0) {
                        // Error occurred during retrieve
                        console.error(`[Worklet] _rubberband_retrieve returned error code: ${retrieved}`);
                        available = 0; // Stop trying to retrieve
                        break;
                    } else {
                        // Retrieved 0 frames, means no more available currently
                        available = 0;
                    }
                }
            } while (available > 0 && totalRetrieved < outputBlockSize);

            // --- Copy retrieved data to the actual output buffers ---
            for (let i = 0; i < this.numberOfChannels; ++i) {
                if (outputBuffer[i]) {
                    const copyLength = Math.min(totalRetrieved, outputBlockSize);
                    if (copyLength > 0) {
                        // Copy from the start of the temp buffer
                        outputBuffer[i].set(tempOutputBuffers[i].subarray(0, copyLength));
                    }
                    // Zero-pad the rest of the output block if not enough samples were retrieved
                    if (copyLength < outputBlockSize) {
                        outputBuffer[i].fill(0.0, copyLength);
                    }
                }
            }

             // --- Check for End of Stream ---
             // Stream ends if the final input block was sent, Rubberband has 0 available,
             // and we couldn't fill the current output block completely.
             if (this.finalBlockSent && available <= 0 && totalRetrieved < outputBlockSize) {
                 if (!this.streamEnded) { // Only trigger the end sequence once
                     console.log("[Worklet] Playback stream ended (final block processed, no more available).");
                     this.streamEnded = true;
                     this.isPlaying = false; // Stop requesting more processing
                     // Don't reset position here, let 'play' handle it if re-triggered
                     // this.resetNeeded = true; // Set reset needed for next play
                     this.postStatus('Playback ended');
                     this.port?.postMessage({ type: 'playback-state', isPlaying: false });
                 }
             }

        } catch (error) {
            console.error(`[Worklet] Processing Error: ${error.message}\n${error.stack}`);
            this.postError(`Processing Error: ${error.message}`);
            this.isPlaying = false; // Stop processing on error
            this.streamEnded = true; // Mark stream as ended due to error
            this.outputSilence(outputs); // Output silence on error
            this.port?.postMessage({ type: 'playback-state', isPlaying: false });
            return true; // Keep processor alive maybe? Or should it terminate? For now, keep alive.
        }

        return true; // Keep processor alive
    } // --- End process ---

    /**
     * Fills the output buffers with silence.
     * @param {Float32Array[][]} outputs - The output buffers from the process method.
     * @private
     */
    outputSilence(outputs) {
        if (!outputs || !outputs[0] || !outputs[0][0]) return; // Basic check
        const outputChannels = outputs[0];
        // Use the actual number of channels provided in the output buffer array
        const numChannels = outputChannels.length;
        const blockSize = outputChannels[0]?.length || 0;
        if (blockSize === 0) return;

        for (let i = 0; i < numChannels; ++i) {
            if (outputChannels[i]) { // Check if channel array exists
                outputChannels[i].fill(0.0);
            }
        }
    }

    /**
     * Posts a status message back to the main thread.
     * @param {string} message - The status message.
     * @private
     */
    postStatus(message) {
        try {
            // console.log(`[Worklet] Attempting to post status: ${message}`); // DEBUG
            if (!this.port) {
                console.error("[Worklet] Port is null, cannot post status.");
                return;
            }
            this.port.postMessage({ type: 'status', message });
        } catch (e) {
            console.error(`[Worklet] FAILED to post status message '${message}':`, e);
        }
    }

    /**
     * Posts an error message back to the main thread.
     * @param {string} message - The error message.
     * @private
     */
    postError(message) {
        try {
            if (!this.port) {
                console.error("[Worklet] Port is null, cannot post error.");
                return;
            }
            this.port.postMessage({ type: 'error', message });
        } catch (e) {
            console.error(`[Worklet] FAILED to post error message '${message}':`, e);
        }
    }

    /**
     * Posts an error and requests cleanup.
     * @param {string} message - The error message.
     * @private
     */
    postErrorAndStop(message) {
        this.postError(message);
        this.cleanup(); // Trigger internal cleanup
    }

    /**
     * Frees allocated WASM memory (buffers, pointer arrays).
     * @private
     */
    cleanupWasmMemory() {
        if (this.wasmModule && typeof this.wasmModule._free === 'function') {
            console.log("[Worklet] Cleaning up WASM memory...");
            try {
                // Free individual channel buffers
                this.inputChannelBuffers.forEach(ptr => { if (ptr) this.wasmModule._free(ptr); });
                this.outputChannelBuffers.forEach(ptr => { if (ptr) this.wasmModule._free(ptr); });
                this.inputChannelBuffers = [];
                this.outputChannelBuffers = [];

                // Free pointer arrays
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

    /**
     * Cleans up resources when the node is stopped or encounters a fatal error.
     * @private
     */
    cleanup() {
        console.log("[Worklet] Cleanup requested.");
        this.isPlaying = false; // Stop processing loop

        // Delete Rubberband instance
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
            console.warn("[Worklet] Skipping Rubberband instance deletion (not ready or already deleted).");
        }

        // Free WASM memory
        this.cleanupWasmMemory();

        // Reset state variables
        this.wasmReady = false;
        this.audioLoaded = false;
        this.originalChannels = null;
        this.wasmModule = null; // Release reference to module
        this.wasmBinary = null; // Release reference to binary data
        this.loaderScriptText = null;
        this.playbackPositionInSeconds = 0;
        this.streamEnded = true; // Mark as ended on cleanup
        this.finalBlockSent = false;
        this.resetNeeded = true; // Ensure reset if reused (though unlikely)

        console.log("[Worklet] Cleanup finished.");
        this.postStatus("Processor cleaned up");

        // Optionally close the port? Usually done by main thread.
        // if (this.port) { this.port.close(); }
    }

} // --- End RubberbandProcessor Class ---

// --- Registration ---
try {
    // `registerProcessor` is globally available in the AudioWorkletGlobalScope
    if (typeof registerProcessor === 'function') {
        registerProcessor(PROCESSOR_NAME, RubberbandProcessor);
        console.log(`[Worklet] ${PROCESSOR_NAME} registered successfully.`);
    } else {
        console.error("[Worklet] registerProcessor is not defined in this scope.");
    }
} catch (error) {
    console.error(`[Worklet] Failed to register processor '${PROCESSOR_NAME}':`, error);
    // Attempt to inform the main thread about the registration failure
    try {
        // `self.postMessage` might be available even if registerProcessor fails
        if (typeof self !== 'undefined' && self.postMessage) {
            self.postMessage({ type: 'error', message: `Failed to register processor: ${error.message}` });
        }
    } catch (e) { /* Ignore postMessage errors during critical failure */ }
}
// --- /vibe-player/js/rubberbandProcessor.js ---
