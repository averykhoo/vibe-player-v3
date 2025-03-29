// /vibe-player/audio/hybrid-processor.js
// NOTE: Name is historical ('hybrid'), implementation is real-time only.
// To be renamed later (e.g., rubberband-processor.js).

// Constants from AudioApp.config would be ideal, but worklets have separate scope.
// Define necessary constants directly or pass them via processorOptions if they might change.
const PROCESSOR_NAME = 'rubberband-processor'; // Intended future name
const DEFAULT_BLOCK_SIZE_WASM = 1024; // Internal buffer size for WASM processing
const TIME_UPDATE_INTERVAL_MS = 1000 / 15; // Approx. 15Hz update rate (adjust based on config.visualization.timeUpdateFrequencyHz if passed)

// Global within the worklet scope to hold loaded WASM exports
let wasmModule = null;
let wasmReady = false;

class RubberbandProcessor extends AudioWorkletProcessor {

    constructor(options) {
        super();
        console.log("[Worklet] Processor initializing...");

        this.processorOpts = options.processorOptions || {};
        this.sampleRate = this.processorOpts.sampleRate || currentTime; // currentTime is built-in global for WorkletProcessor
        this.numberOfChannels = this.processorOpts.numberOfChannels || 0;
        this.timeUpdateFrequencyHz = this.processorOpts.timeUpdateFrequencyHz || (1000 / TIME_UPDATE_INTERVAL_MS);
        this.wasmBinary = this.processorOpts.wasmBinary;
        this.loaderScriptText = this.processorOpts.loaderScriptText;

        // Ensure wasmModule and wasmReady are reset for new instances
        wasmModule = null;
        wasmReady = false;

        this.rubberbandStretcher = 0; // Pointer to the C++ RubberbandStretcher instance

        // Playback State
        this.isPlaying = false;
        this.currentTargetSpeed = 1.0;
        this.currentGain = 1.0; // Added gain control
        this.lastAppliedStretchRatio = 1.0;
        this.resetNeeded = true; // Force reset on first process block or after seeks/pauses
        this.streamEnded = false; // Has the end of the source buffer been reached?
        this.finalBlockProcessed = false; // Has the final block been sent to _rubberband_process?
        this.playbackPositionInSeconds = 0.0; // Conceptual position in the *original* audio

        // WASM Memory Management
        this.inputPtrs = 0; // Pointer to array of input buffer pointers in WASM heap
        this.outputPtrs = 0; // Pointer to array of output buffer pointers in WASM heap
        this.inputChannelBuffers = []; // Array of pointers to individual channel input buffers
        this.outputChannelBuffers = []; // Array of pointers to individual channel output buffers
        this.blockSizeWasm = DEFAULT_BLOCK_SIZE_WASM; // Size of internal WASM buffers

        // Audio Data
        this.originalChannels = null; // Array of Float32Arrays holding the audio data
        this.audioLoaded = false;
        this.sourceDurationSeconds = 0;

        // Time Update throttling
        this.lastTimeUpdateSent = -Infinity; // Ensure first update sends

        // --- Validate Initial State ---
        if (!this.wasmBinary) {
            this.postErrorAndStop("Initialization failed: WASM binary missing.");
            return;
        }
        if (!this.loaderScriptText) {
            this.postErrorAndStop("Initialization failed: Loader script text missing.");
            return;
        }
        if (!this.sampleRate || this.sampleRate <= 0) {
            this.postErrorAndStop("Initialization failed: Invalid SampleRate.");
            return;
        }
        if (!this.numberOfChannels || this.numberOfChannels <= 0) {
            this.postErrorAndStop("Initialization failed: Invalid NumberOfChannels.");
            return;
        }

        // Assign message handler (port should be valid here)
        if (this.port) {
            this.port.onmessage = this.handleMessage.bind(this);
            console.log("[Worklet] Port message handler assigned.");
        } else {
            // This case should theoretically not happen if the processor is created correctly
            console.error("[Worklet] CONSTRUCTOR: Message port is not available!");
        }
        console.log("[Worklet] Initial state variables set.");
    }

    // --- WASM Initialization ---
    async initializeWasmAndRubberband() {
        if (wasmReady || !this.wasmBinary || !this.loaderScriptText) {
            console.warn("[Worklet] Skipping WASM initialization (already ready or missing assets).");
            return;
        }
        console.log("[Worklet] Initializing WASM & Rubberband instance...");
        try {
            // 1. Define the hook expected by the loader
            const instantiateWasm = (imports, successCallback) => {
                console.log("[Worklet] instantiateWasm hook called.");
                WebAssembly.instantiate(this.wasmBinary, imports)
                    .then(output => {
                        console.log("[Worklet] WebAssembly.instantiate successful.");
                        // Note: We store the module instance globally in the worklet scope
                        successCallback(output.instance, output.module);
                        console.log("[Worklet] instantiateWasm successCallback executed.");
                    }).catch(error => {
                        console.error("[Worklet] WebAssembly.instantiate (hook) failed:", error);
                        this.postErrorAndStop(`WASM Instantiation hook failed: ${error.message}`);
                    });
                // Required by Emscripten loader pattern
                return {};
            };

            // 2. Evaluate the loader script text to get the loader function factory
            let loaderFuncFactory;
            try {
                console.log("[Worklet] Evaluating loader script text...");
                // Use 'self' explicitly if 'window' isn't reliable in worklet context
                const getLoaderFactory = new Function(`${this.loaderScriptText}; return self.Rubberband;`);
                loaderFuncFactory = getLoaderFactory();
                if (typeof loaderFuncFactory !== 'function') {
                    throw new Error(`Loader script evaluation did not return a function.`);
                }
                console.log("[Worklet] Loader function factory obtained via new Function.");
            } catch (loaderError) {
                console.error("[Worklet] Error evaluating loader script:", loaderError);
                throw new Error(`Could not get loader factory from script: ${loaderError.message}`);
            }

            // 3. Call the factory to get the actual loader function
            // const loaderFunc = loaderFuncFactory(); // Factory returns the async function
            // if (typeof loaderFunc !== 'function') {
            //     throw new Error(`Loader factory did not return the expected async function.`);
            // }

             // 3. Call the loader function directly (assuming factory returns the async loader directly)
             const loaderFunc = loaderFuncFactory; // Assuming factory returns the async loader

            // 4. Call the loader function with the hook and WASM binary
            console.log("[Worklet] Calling loader function with hook and WASM binary...");
            // Pass necessary arguments to the loader
            wasmModule = await loaderFunc({
                instantiateWasm: instantiateWasm,
                wasmBinary: this.wasmBinary
                // Add other potential args like print/printErr if needed by the loader
            });
            console.log("[Worklet] Loader promise resolved. Module object received.");

            // 5. Verify WASM Module loaded correctly
            if (!wasmModule || typeof wasmModule._rubberband_new !== 'function') {
                const availableKeys = wasmModule ? Object.keys(wasmModule).join(', ') : 'undefined/null';
                throw new Error(`WASM Module loading failed or _rubberband_new not found. Available keys: ${availableKeys}`);
            }
            console.log("[Worklet] WASM Module exports verified (_rubberband_new found).");

            // 6. Create Rubberband instance
            const RBOptions = wasmModule.RubberbandOptions || {};
            const ProcessRealTime = RBOptions.ProcessRealTime ?? 0x00000001;
            const EngineDefault = RBOptions.EngineFaster ?? 0; // EngineFaster is often default
            const PitchHighQuality = RBOptions.PitchHighQuality ?? 0x02000000; // A reasonable default quality
            // Combine options using bitwise OR
            const options = ProcessRealTime | EngineDefault | PitchHighQuality;
            console.log(`[Worklet] Creating Rubberband instance with options: ${options.toString(16)} (SampleRate: ${this.sampleRate}, Channels: ${this.numberOfChannels})`);

            // rubberband_new(sampleRate, channels, options, initialTimeRatio, initialPitchScale)
            this.rubberbandStretcher = wasmModule._rubberband_new(this.sampleRate, this.numberOfChannels, options, 1.0, 1.0);
            if (!this.rubberbandStretcher) {
                throw new Error("_rubberband_new failed to create instance.");
            }
            console.log(`[Worklet] Rubberband instance created: ptr=${this.rubberbandStretcher}`);

            // 7. Allocate WASM memory for buffer pointers and channel buffers
            if (typeof wasmModule._malloc !== 'function' || !wasmModule.HEAPU32 || !wasmModule.HEAPF32) {
                throw new Error("Memory management functions or HEAP views missing on WASM module.");
            }
            const pointerSize = 4; // Size of a pointer in WASM (usually 32-bit)
            const frameSize = 4; // Size of a Float32

            this.inputPtrs = wasmModule._malloc(this.numberOfChannels * pointerSize);
            this.outputPtrs = wasmModule._malloc(this.numberOfChannels * pointerSize);
            if (!this.inputPtrs || !this.outputPtrs) {
                throw new Error("Failed to allocate WASM memory for pointer arrays.");
            }
            console.log(`[Worklet] Allocated pointer arrays: input=${this.inputPtrs}, output=${this.outputPtrs}`);

            this.inputChannelBuffers = [];
            this.outputChannelBuffers = [];
            for (let i = 0; i < this.numberOfChannels; ++i) {
                const bufferSizeBytes = this.blockSizeWasm * frameSize;
                const inputBuf = wasmModule._malloc(bufferSizeBytes);
                const outputBuf = wasmModule._malloc(bufferSizeBytes);
                if (!inputBuf || !outputBuf) {
                    this.cleanupWasmMemory(); // Free already allocated buffers
                    throw new Error(`Failed to allocate WASM memory for channel buffer ${i}.`);
                }
                this.inputChannelBuffers.push(inputBuf);
                this.outputChannelBuffers.push(outputBuf);
                // Store the buffer pointers in the pointer arrays within WASM memory
                wasmModule.HEAPU32[(this.inputPtrs / pointerSize) + i] = inputBuf;
                wasmModule.HEAPU32[(this.outputPtrs / pointerSize) + i] = outputBuf;
            }
            console.log(`[Worklet] Allocated ${this.numberOfChannels} input/output WASM buffers (${this.blockSizeWasm} frames each).`);

            wasmReady = true; // Set flag only after everything succeeded
            console.log("[Worklet] WASM and Rubberband instance ready.");
            this.postStatus('processor-ready'); // Signal readiness to main thread

        } catch (error) {
            console.error(`[Worklet] WASM/Rubberband Init Error: ${error.message}\n${error.stack}`);
            this.postErrorAndStop(`WASM/Rubberband Init Error: ${error.message}`);
            wasmReady = false;
            this.cleanupWasmMemory(); // Ensure partial allocations are freed
            if (this.rubberbandStretcher) { // If instance was created but buffer alloc failed
                 try { if (wasmModule?._rubberband_delete) wasmModule._rubberband_delete(this.rubberbandStretcher); } catch(e){}
                 this.rubberbandStretcher = 0;
            }
        }
    }

    // --- Message Handling ---
    handleMessage(event) {
        const data = event.data;
        // console.log(`[Worklet] Received message: ${data.type}`); // Can be verbose
        try {
            switch (data.type) {
                case 'load-audio':
                    if (!data.channelData || !Array.isArray(data.channelData) || data.channelData.length !== this.numberOfChannels) {
                        this.postErrorAndStop(`Invalid audio data received. Expected ${this.numberOfChannels} channels.`);
                        return;
                    }
                    console.log(`[Worklet] Received audio data for ${data.channelData.length} channels.`);
                    // Convert ArrayBuffers back to Float32Arrays
                    this.originalChannels = data.channelData.map(buffer => new Float32Array(buffer));
                    this.audioLoaded = true;
                    this.playbackPositionInSeconds = 0;
                    this.sourceDurationSeconds = (this.originalChannels[0]?.length || 0) / this.sampleRate;
                    console.log(`[Worklet] Audio loaded. Duration: ${this.sourceDurationSeconds.toFixed(3)}s`);

                    // Reset playback state for new audio
                    this.resetPlaybackState();

                    // Initialize WASM *after* receiving audio data if not already done
                    if (!wasmReady) {
                        this.initializeWasmAndRubberband(); // Non-blocking async call
                    } else {
                        // If WASM was already ready, ensure Rubberband state is reset for the new audio
                        this.resetRubberbandState();
                        console.log("[Worklet] WASM already ready, resetting Rubberband state for new audio.");
                         // Notify main thread again that processor is ready for *this* audio
                        this.postStatus('processor-ready');
                    }
                    break;

                case 'play':
                    if (this.isPlaying) {
                        console.log("[Worklet] Play command received, but already playing.");
                        break; // Avoid unnecessary state changes or resets
                    }
                    if (!wasmReady || !this.audioLoaded) {
                        console.warn(`[Worklet] Cannot play: ${!wasmReady ? 'WASM not ready' : 'Audio not loaded'}.`);
                        break;
                    }
                    console.log("[Worklet] Play command received.");
                    // If playback reached the end, reset position before playing again
                    if (this.streamEnded || this.playbackPositionInSeconds >= this.sourceDurationSeconds) {
                        console.log("[Worklet] Play received after end/at end. Resetting position.");
                        this.playbackPositionInSeconds = 0;
                        this.resetNeeded = true; // Ensure state is reset
                    }
                    this.isPlaying = true;
                    this.streamEnded = false; // Reset end flag
                    this.finalBlockProcessed = false; // Reset final block flag
                    if (this.resetNeeded) console.log("[Worklet] Reset flag was true on Play command.");
                    this.port.postMessage({type: 'playback-state', isPlaying: true});
                    break;

                case 'pause':
                    if (!this.isPlaying) {
                        console.log("[Worklet] Pause command received, but already paused.");
                        break;
                    }
                    console.log("[Worklet] Pause command received.");
                    this.isPlaying = false;
                     // Setting resetNeeded ensures that when playback resumes,
                     // Rubberband starts fresh, avoiding potential artifacts from stale internal state.
                    this.resetNeeded = true;
                    this.port.postMessage({type: 'playback-state', isPlaying: false});
                    break;

                case 'seek':
                    if (!wasmReady || !this.audioLoaded) {
                        console.warn(`[Worklet] Cannot seek: ${!wasmReady ? 'WASM not ready' : 'Audio not loaded'}.`);
                        break;
                    }
                    const seekPosition = Math.max(0, Math.min(data.positionSeconds ?? 0, this.sourceDurationSeconds));
                    this.playbackPositionInSeconds = seekPosition;
                    this.resetNeeded = true; // Force reset after seek
                    this.streamEnded = false; // Reset end flag after seek
                    this.finalBlockProcessed = false;
                    console.log(`[Worklet] Seek to ${this.playbackPositionInSeconds.toFixed(3)}s. Reset needed.`);
                    // Optional: Send time update immediately after seek?
                    // this.sendTimeUpdate(this.playbackPositionInSeconds);
                    break;

                case 'jump':
                    if (!wasmReady || !this.audioLoaded) {
                         console.warn(`[Worklet] Cannot jump: ${!wasmReady ? 'WASM not ready' : 'Audio not loaded'}.`);
                         break;
                    }
                    const jumpSeconds = data.seconds ?? 0;
                    const currentPosition = this.playbackPositionInSeconds;
                    const newPosition = Math.max(0, Math.min(currentPosition + jumpSeconds, this.sourceDurationSeconds));
                    this.playbackPositionInSeconds = newPosition;
                    this.resetNeeded = true; // Force reset after jump
                    this.streamEnded = false; // Reset end flag
                    this.finalBlockProcessed = false;
                    console.log(`[Worklet] Jumped by ${jumpSeconds}s to ${this.playbackPositionInSeconds.toFixed(3)}s. Reset needed.`);
                     // Optional: Send time update immediately after jump?
                    // this.sendTimeUpdate(this.playbackPositionInSeconds);
                    break;

                case 'set-speed':
                    if (!wasmReady) {
                        console.warn("[Worklet] Cannot set speed: WASM not ready.");
                        break;
                    }
                    const newSpeed = Math.max(0.01, data.value ?? 1.0); // Ensure positive speed
                    if (this.currentTargetSpeed !== newSpeed) {
                        this.currentTargetSpeed = newSpeed;
                        // Ratio change is handled within process() loop, no reset needed unless drastic
                        console.log(`[Worklet] Target speed set to ${this.currentTargetSpeed.toFixed(3)}x`);
                    }
                    break;

                 case 'set-gain':
                    // Gain is applied *after* Rubberband processing
                    const newGain = Math.max(0, data.value ?? 1.0); // Ensure non-negative gain
                    if (this.currentGain !== newGain) {
                        this.currentGain = newGain;
                        console.log(`[Worklet] Gain set to ${this.currentGain.toFixed(3)}`);
                    }
                    break;

                case 'cleanup':
                    console.log("[Worklet] Cleanup command received.");
                    this.cleanup();
                    break;

                default:
                    console.warn("[Worklet] Received unknown message type:", data.type);
            }
        } catch (error) {
            this.postErrorAndStop(`Error handling message ${data.type}: ${error.message}`);
            console.error(`[Worklet] Msg ${data.type} error: ${error.message}\n${error.stack}`);
        }
    }

     // --- Core Processing Loop ---
    process(inputs, outputs, parameters) {
        // --- Initial Checks ---
        if (!wasmReady || !this.audioLoaded || !this.rubberbandStretcher) {
            this.outputSilence(outputs); // Output silence if not ready
            return true; // Keep processor alive
        }

        // Output silence if paused or playback has finished and drained
        if (!this.isPlaying) {
             if (this.streamEnded && wasmModule._rubberband_available(this.rubberbandStretcher) <= 0) {
                 // If paused AFTER the stream ended and buffer is drained, stay silent.
                 this.outputSilence(outputs);
                 return true;
             }
             // If paused MID-STREAM, we still need to process available output
             // to drain the buffer from when it was playing.
        }

        const outputBuffer = outputs[0];
        // Validate output buffer structure
        if (!outputBuffer || outputBuffer.length !== this.numberOfChannels || !outputBuffer[0]) {
            console.warn("[Worklet] Invalid output buffer structure in process().");
            this.outputSilence(outputs);
            return true;
        }
        const outputBlockSize = outputBuffer[0].length; // Samples per channel in this block
        if (outputBlockSize === 0) return true; // Nothing to do

        // --- Processing Logic ---
        try {
            // 1. Determine Target Stretch Ratio
            const safeTargetSpeed = Math.max(0.01, this.currentTargetSpeed);
            // Stretch ratio = source speed / target speed. Source speed is always 1.0 here.
            const targetStretchRatio = 1.0 / safeTargetSpeed;
            // Clamp ratio to prevent extreme values that might destabilize Rubberband
            const safeStretchRatio = Math.max(0.05, Math.min(20.0, targetStretchRatio));
            const ratioChanged = Math.abs(safeStretchRatio - this.lastAppliedStretchRatio) > 1e-6;

            // 2. Reset Rubberband State if Needed (Seek, Pause/Resume, Start, Significant Ratio Change?)
            // Resetting on pause/resume ensures clean start. Reset on seek/jump is handled in message handler.
            if (this.resetNeeded) {
                console.log(`[Worklet] Resetting Rubberband state. Ratio: ${safeStretchRatio.toFixed(3)}`);
                wasmModule._rubberband_reset(this.rubberbandStretcher);
                wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, safeStretchRatio);
                this.lastAppliedStretchRatio = safeStretchRatio;
                this.resetNeeded = false; // Reset the flag
                // No need to reset streamEnded or finalBlockProcessed here, handled by seek/play/load
            } else if (ratioChanged) {
                // Apply ratio changes dynamically if not resetting
                wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, safeStretchRatio);
                this.lastAppliedStretchRatio = safeStretchRatio;
            }

            // 3. Calculate Input Samples Needed (Estimate)
            // Need enough input to generate approximately outputBlockSize output.
            // Add some padding (e.g., latency, processing delay). Rubberband docs might specify padding needed.
            const latencyFrames = wasmModule._rubberband_get_latency(this.rubberbandStretcher) ?? 0;
            let inputFramesNeeded = Math.ceil(outputBlockSize / safeStretchRatio) + latencyFrames + 4; // Heuristic padding
            inputFramesNeeded = Math.max(1, Math.min(inputFramesNeeded, this.blockSizeWasm)); // Don't exceed internal buffer size

            // 4. Determine Current Read Position & Available Input
            let readPosInSourceSamples = Math.round(this.playbackPositionInSeconds * this.sampleRate);
            const sourceTotalSamples = this.originalChannels[0]?.length || 0;
            readPosInSourceSamples = Math.max(0, Math.min(readPosInSourceSamples, sourceTotalSamples));

            let actualInputProvided = 0;
            let isFinalDataBlock = false;

            // Only provide input if playing and haven't reached the end
            if (this.isPlaying && !this.streamEnded) {
                 actualInputProvided = Math.min(inputFramesNeeded, sourceTotalSamples - readPosInSourceSamples);
                 actualInputProvided = Math.max(0, actualInputProvided); // Ensure non-negative
                 isFinalDataBlock = (readPosInSourceSamples + actualInputProvided) >= sourceTotalSamples;
            }

            // Determine if the final block needs to be *sent* to process
            // Send final flag only once, when playing and reaching the end.
            const sendFinalFlag = this.isPlaying && isFinalDataBlock && !this.finalBlockProcessed;

            // 5. Provide Input to Rubberband (if any)
            if (actualInputProvided > 0) {
                 // Copy data from originalChannels to WASM input buffers
                for (let i = 0; i < this.numberOfChannels; i++) {
                    const sourceData = this.originalChannels[i];
                    // Create a view into the specific WASM memory region for this channel's input buffer
                    const wasmInputBufferView = new Float32Array(wasmModule.HEAPF32.buffer, this.inputChannelBuffers[i], this.blockSizeWasm);
                    const endReadPos = readPosInSourceSamples + actualInputProvided;
                    const inputSlice = sourceData.subarray(readPosInSourceSamples, endReadPos);

                     // Check slice length vs wasm buffer view length
                    const copyLength = Math.min(inputSlice.length, wasmInputBufferView.length);
                    wasmInputBufferView.set(inputSlice.subarray(0, copyLength));

                    // Zero out remaining part of the WASM buffer if input slice was shorter
                    if (copyLength < wasmInputBufferView.length) {
                         wasmInputBufferView.fill(0.0, copyLength);
                     }
                }
                // Call _rubberband_process
                wasmModule._rubberband_process(this.rubberbandStretcher, this.inputPtrs, actualInputProvided, sendFinalFlag ? 1 : 0);

                 // Update conceptual playback position based on input consumed
                 const inputSecondsConsumed = actualInputProvided / this.sampleRate;
                 this.playbackPositionInSeconds += inputSecondsConsumed;
                 this.playbackPositionInSeconds = Math.min(this.playbackPositionInSeconds, this.sourceDurationSeconds); // Clamp to duration

                if (sendFinalFlag) {
                    console.log("[Worklet] Final block flag sent to process().");
                    this.finalBlockProcessed = true; // Mark final block as sent
                 }
                 if (isFinalDataBlock) {
                      // We've reached the end of the source buffer with this input block
                      // Don't mark streamEnded yet, wait for output buffer to drain.
                 }

            } else if (sendFinalFlag) {
                 // Special case: End of stream reached exactly, need to send final flag with 0 input samples.
                 wasmModule._rubberband_process(this.rubberbandStretcher, this.inputPtrs, 0, 1);
                 console.log("[Worklet] Final block flag sent with 0 input samples.");
                 this.finalBlockProcessed = true;
            }


            // 6. Retrieve Output from Rubberband
            let totalRetrieved = 0;
            let available = 0;
            // Use temporary buffers to avoid modifying worklet output buffers directly in loop
            const tempOutputBuffers = Array.from({ length: this.numberOfChannels }, () => new Float32Array(outputBlockSize));

            do {
                available = wasmModule._rubberband_available(this.rubberbandStretcher);
                available = Math.max(0, available); // Ensure non-negative

                if (available > 0) {
                    const neededNow = outputBlockSize - totalRetrieved;
                    if (neededNow <= 0) break; // Output block is full

                    const framesToRetrieve = Math.min(available, neededNow, this.blockSizeWasm); // Don't exceed internal buffer size
                    if (framesToRetrieve <= 0) break; // Should not happen if available > 0

                    const retrieved = wasmModule._rubberband_retrieve(this.rubberbandStretcher, this.outputPtrs, framesToRetrieve);

                    if (retrieved > 0) {
                        // Copy retrieved data from WASM output buffers to temp JS buffers
                        for (let i = 0; i < this.numberOfChannels; i++) {
                            const wasmOutputBufferView = new Float32Array(wasmModule.HEAPF32.buffer, this.outputChannelBuffers[i], retrieved);
                             // Calculate remaining space in the temporary output buffer for this channel
                            const remainingSpace = tempOutputBuffers[i].length - totalRetrieved;
                            const copyLength = Math.min(retrieved, remainingSpace); // Copy only what fits
                             if (copyLength > 0) {
                                 // Copy from WASM view to the correct position in the temp buffer
                                 tempOutputBuffers[i].set(wasmOutputBufferView.subarray(0, copyLength), totalRetrieved);
                             }
                        }
                        totalRetrieved += retrieved;
                    } else if (retrieved < 0) {
                        console.error(`[Worklet] _rubberband_retrieve error code: ${retrieved}`);
                        available = 0; // Stop retrieving on error
                        break;
                    } else {
                         // retrieved == 0, even if available > 0. Might indicate internal state issue?
                        console.warn(`[Worklet] _rubberband_available returned ${available} but _retrieve returned 0.`);
                        available = 0; // Stop retrieving
                    }
                }
            } while (available > 0 && totalRetrieved < outputBlockSize); // Loop until output block is full or no more available

            // 7. Copy retrieved data to actual worklet output buffers and apply gain
            for (let i = 0; i < this.numberOfChannels; ++i) {
                 if (outputBuffer[i]) {
                     const targetChannelBuffer = outputBuffer[i];
                     const sourceTempData = tempOutputBuffers[i];
                     const copyLength = Math.min(totalRetrieved, targetChannelBuffer.length);

                     if (copyLength > 0) {
                         if (this.currentGain === 1.0) {
                              // If gain is 1, just copy directly
                             targetChannelBuffer.set(sourceTempData.subarray(0, copyLength));
                         } else {
                             // Apply gain while copying
                             for (let j = 0; j < copyLength; j++) {
                                 targetChannelBuffer[j] = sourceTempData[j] * this.currentGain;
                             }
                         }
                     }
                     // Fill remaining part with silence if not enough data was retrieved
                     if (copyLength < targetChannelBuffer.length) {
                         targetChannelBuffer.fill(0.0, copyLength);
                     }
                 }
             }

            // 8. Check for End of Stream Condition
            // Stream ends when the final block has been *processed* by Rubberband
            // AND there's no more output available.
            if (this.finalBlockProcessed && available <= 0 && totalRetrieved < outputBlockSize) {
                 if (!this.streamEnded) { // Check if already marked as ended
                      console.log("[Worklet] Playback stream ended (final block processed, buffer drained).");
                      this.streamEnded = true;
                      this.isPlaying = false; // Stop playback automatically
                      this.playbackPositionInSeconds = this.sourceDurationSeconds; // Ensure position is exactly at the end
                      this.resetNeeded = true; // Need reset before next play
                      this.postStatus('Playback ended');
                      this.port.postMessage({type: 'playback-state', isPlaying: false});
                      // Send final time update
                      this.sendTimeUpdate(this.playbackPositionInSeconds, true); // Force send last update
                 }
            }

            // 9. Send Time Updates (Throttled)
            if (this.isPlaying && currentTime - this.lastTimeUpdateSent >= TIME_UPDATE_INTERVAL_MS / 1000) {
                 this.sendTimeUpdate(this.playbackPositionInSeconds);
            }

        } catch (error) {
            console.error(`[Worklet] Processing Error: ${error.message}\n${error.stack}`);
            this.postErrorAndStop(`Processing Error: ${error.message}`);
            this.outputSilence(outputs); // Output silence on error
            return true; // Keep processor alive but stop playback
        }

        // Keep processor alive
        return true;
    } // End process

    // --- Utility Methods ---

    resetPlaybackState() {
        this.isPlaying = false;
        this.streamEnded = false;
        this.finalBlockProcessed = false;
        this.resetNeeded = true;
        this.playbackPositionInSeconds = 0;
        this.lastTimeUpdateSent = -Infinity;
        // Don't reset targetSpeed or gain, keep user settings.
        // Reset lastAppliedRatio? Maybe not, let process() handle it.
        this.lastAppliedStretchRatio = 1.0 / this.currentTargetSpeed; // Re-calculate based on current speed
    }

    resetRubberbandState() {
         if (wasmReady && this.rubberbandStretcher && wasmModule._rubberband_reset) {
             try {
                 wasmModule._rubberband_reset(this.rubberbandStretcher);
                 // Reapply current ratio after reset
                 const safeTargetSpeed = Math.max(0.01, this.currentTargetSpeed);
                 const safeStretchRatio = Math.max(0.05, Math.min(20.0, 1.0 / safeTargetSpeed));
                 wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, safeStretchRatio);
                 this.lastAppliedStretchRatio = safeStretchRatio;
                 console.log("[Worklet] Rubberband internal state reset.");
             } catch (e) {
                 console.error("[Worklet] Error calling _rubberband_reset:", e);
                 this.postErrorAndStop("Error resetting Rubberband state.");
             }
         }
         this.resetNeeded = false; // Mark as reset
    }

    sendTimeUpdate(time, force = false) {
        if (force || currentTime - this.lastTimeUpdateSent >= TIME_UPDATE_INTERVAL_MS / 1000) {
            try {
                this.port.postMessage({
                    type: 'time-update',
                    currentTime: Math.min(time, this.sourceDurationSeconds) // Ensure time doesn't exceed duration
                });
                this.lastTimeUpdateSent = currentTime;
            } catch (e) {
                console.error("[Worklet] Failed to post time update:", e);
                // Don't stop processor for this error
            }
        }
    }

    outputSilence(outputs) {
        if (!outputs || !outputs[0] || !outputs[0][0]) return;
        const outputChannels = outputs[0];
        const numChannels = Math.min(outputChannels.length, this.numberOfChannels);
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
            if (!this.port) { console.error("[Worklet] Port is null, cannot post status."); return; }
            this.port.postMessage({type: 'status', message});
        } catch (e) { console.error(`[Worklet] FAILED to post status '${message}':`, e); }
    }

    postError(message) {
        console.error(`[Worklet] Posting Error: ${message}`); // Log error internally too
        try {
            if (!this.port) { console.error("[Worklet] Port is null, cannot post error."); return; }
            this.port.postMessage({type: 'error', message});
        } catch (e) { console.error(`[Worklet] FAILED to post error message '${message}':`, e); }
    }

    postErrorAndStop(message) {
        this.postError(message);
        this.cleanup(); // Attempt cleanup
        this.isPlaying = false; // Ensure playback stops
        this.streamEnded = true; // Mark as ended
         // Attempt to notify main thread about state change
         try { if(this.port) this.port.postMessage({type: 'playback-state', isPlaying: false}); } catch(e){}
    }

    // --- Resource Cleanup ---
    cleanupWasmMemory() {
        if (wasmReady && wasmModule && typeof wasmModule._free === 'function') {
            console.log("[Worklet] Cleaning up WASM memory...");
            try {
                this.inputChannelBuffers.forEach(ptr => { if (ptr) wasmModule._free(ptr); });
                this.outputChannelBuffers.forEach(ptr => { if (ptr) wasmModule._free(ptr); });
                this.inputChannelBuffers = [];
                this.outputChannelBuffers = [];
                if (this.inputPtrs) wasmModule._free(this.inputPtrs);
                if (this.outputPtrs) wasmModule._free(this.outputPtrs);
                this.inputPtrs = 0;
                this.outputPtrs = 0;
                console.log("[Worklet] Freed WASM buffers/pointers.");
            } catch (e) {
                console.error("[Worklet] Error during WASM memory cleanup:", e);
                // Don't stop processor, but log error
                this.postError(`Error during WASM memory cleanup: ${e.message}`);
            }
        } else {
            console.warn("[Worklet] Skipping WASM memory cleanup: Module or _free not available/ready.");
        }
    }

    cleanup() {
        console.log("[Worklet] Cleanup requested.");
        this.isPlaying = false;
        if (wasmReady && this.rubberbandStretcher !== 0 && wasmModule && typeof wasmModule._rubberband_delete === 'function') {
            try {
                console.log(`[Worklet] Deleting Rubberband instance: ptr=${this.rubberbandStretcher}`);
                wasmModule._rubberband_delete(this.rubberbandStretcher);
                this.rubberbandStretcher = 0;
                console.log("[Worklet] Rubberband instance deleted.");
            } catch (e) {
                console.error("[Worklet] Error deleting Rubberband instance:", e);
                this.postError(`Error deleting Rubberband instance: ${e.message}`);
            }
        } else {
            console.warn("[Worklet] Skipping Rubberband instance deletion (not ready or already deleted).");
        }
        this.cleanupWasmMemory();

        // Reset state variables
        wasmReady = false;
        wasmModule = null;
        this.audioLoaded = false;
        this.originalChannels = null;
        this.playbackPositionInSeconds = 0;
        this.streamEnded = true; // Mark as ended on cleanup
        this.finalBlockProcessed = false;
        this.resetNeeded = true;

        console.log("[Worklet] Cleanup finished.");
        this.postStatus("Processor cleaned up");

        // Optional: Close the port? Typically done by main thread.
        // if (this.port) this.port.close();
    }

} // End class RubberbandProcessor

// --- Register Processor ---
try {
    // Use the intended future name for registration
    registerProcessor('rubberband-processor', RubberbandProcessor);
    console.log(`[Worklet] 'rubberband-processor' registered successfully.`);
} catch (error) {
    console.error(`[Worklet] Failed to register processor:`, error);
    // Attempt to notify main thread if possible
    try { if (self && self.postMessage) self.postMessage({type: 'error', message: `Failed to register processor: ${error.message}`}); } catch(e){}
}

// /vibe-player/audio/hybrid-processor.js
