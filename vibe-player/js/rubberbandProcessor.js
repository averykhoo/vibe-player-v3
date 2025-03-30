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
        // Extract processor options provided from the main thread
        this.processorOpts = options.processorOptions || {};
        // Audio properties
        // `currentTime` is a global in AudioWorkletGlobalScope representing the context time,
        // but `sampleRate` should come from the node options or the context itself passed in options.
        this.sampleRate = this.processorOpts.sampleRate || currentTime; // Use currentTime as fallback only
        if (this.sampleRate === currentTime && typeof sampleRate !== 'undefined') {
             // If options didn't provide it, try the global scope `sampleRate` variable
             this.sampleRate = sampleRate;
        }
        if (this.sampleRate === currentTime) {
             console.warn(`[Worklet] sampleRate defaulting to global currentTime (${currentTime}), expected in processorOptions.`);
             // Use a common default if still unresolved, though this is risky
             this.sampleRate = this.sampleRate || 44100;
        }

        this.numberOfChannels = this.processorOpts.numberOfChannels || 0;
        // WASM resources (passed from main thread)
        this.wasmBinary = this.processorOpts.wasmBinary;
        this.loaderScriptText = this.processorOpts.loaderScriptText;
        // WASM state
        this.wasmModule = null; // Will hold the loaded & compiled WASM module exports
        this.wasmReady = false; // Flag indicating if WASM is initialized
        // Rubberband state
        this.rubberbandStretcher = 0; // Pointer to the Rubberband instance in WASM memory
        // Playback state
        this.isPlaying = false;
        // Target parameters (set via messages)
        this.currentTargetSpeed = 1.0;
        this.currentTargetPitchScale = 1.0;
        this.currentTargetFormantScale = 1.0;
        // Applied parameters (to detect changes)
        this.lastAppliedStretchRatio = 1.0; // Note: speed = 1.0 / ratio
        this.lastAppliedPitchScale = 1.0;
        this.lastAppliedFormantScale = 1.0;
        // Processing state
        this.resetNeeded = true; // Flag to trigger rubberband_reset
        this.streamEnded = false; // Flag indicating the source stream has ended
        this.finalBlockSent = false; // Flag indicating the last block has been sent to rubberband_process
        this.playbackPositionInSeconds = 0.0; // Tracks current position in the source audio
        // WASM Memory Buffers
        this.inputPtrs = 0; // Pointer to array of input channel buffer pointers
        this.outputPtrs = 0; // Pointer to array of output channel buffer pointers
        this.inputChannelBuffers = []; // Array of pointers to individual input channel buffers
        this.outputChannelBuffers = []; // Array of pointers to individual output channel buffers
        this.blockSizeWasm = 1024; // Processing block size used within WASM (must match allocations)
        // Source Audio Data
        this.originalChannels = null; // Will hold Float32Arrays of the original audio
        this.audioLoaded = false;
        this.sourceDurationSeconds = 0;

        // --- Setup Message Port ---
        // Check if port exists before assigning onmessage
        if (this.port) {
            this.port.onmessage = this.handleMessage.bind(this);
        } else {
            // This case should ideally not happen in a standard AudioWorklet setup
            console.error("[Worklet] CONSTRUCTOR: Message port is not available!");
        }

        // --- Initial Validation ---
        if (!this.wasmBinary) this.postErrorAndStop("WASM binary missing.");
        if (!this.loaderScriptText) this.postErrorAndStop("Loader script text missing.");
        if (!this.sampleRate || this.sampleRate <= 0) this.postErrorAndStop(`Invalid SampleRate provided: ${this.sampleRate}`);
        if (!this.numberOfChannels || this.numberOfChannels <= 0) this.postErrorAndStop("Invalid NumberOfChannels provided.");

        console.log("[Worklet] Initialized state variables. Waiting for audio data via message.");
    }

    /**
     * Initializes the WASM module and creates the Rubberband instance.
     * Uses a custom loader script evaluated via Function constructor and an instantiateWasm hook.
     * @private
     * @returns {Promise<void>}
     */
    async initializeWasmAndRubberband() {
        if (this.wasmReady) { return; } // Avoid re-initialization
        if (!this.wasmBinary || !this.loaderScriptText) {
            this.postErrorAndStop("Cannot initialize WASM: Resources missing.");
            return;
        }

        try {
            this.postStatus("Initializing WASM & Rubberband...");
            console.log("[Worklet] Initializing WASM & Rubberband instance...");

            // Define instantiateWasm hook (using closure to capture `this`)
            const instantiateWasm = (imports, successCallback) => {
                console.log("[Worklet] instantiateWasm hook called.");
                WebAssembly.instantiate(this.wasmBinary, imports)
                    .then(output => {
                        console.log("[Worklet] WASM instantiate successful.");
                        // Call the success callback provided by the Emscripten loader code
                        successCallback(output.instance, output.module);
                    })
                    .catch(error => {
                        console.error("[Worklet] WASM instantiate hook failed:", error);
                        this.postError(`WASM Hook Error: ${error.message}`);
                        // Propagate error - the loader's readyPromise should reject
                    });
                // Emscripten convention: Return exports object, potentially empty synchronously
                // The actual exports are provided via the successCallback
                return {};
            };

            // Evaluate loader script text safely to get the module factory
            let loaderFunc;
            try {
                // Wrap script text in a function constructor to evaluate it in a controlled scope
                // The script defines 'Rubberband' and returns it.
                const getLoaderFactory = new Function(
                    'moduleArg', // Argument name expected by the modified loader's outer function
                    `${this.loaderScriptText}; return Rubberband;` // Execute script, return the factory
                );
                // Call the factory function, which should return the async loader function
                const moduleFactory = getLoaderFactory();

                loaderFunc = moduleFactory; // moduleFactory is the async function returned by the IIFE in the loader
                if (typeof loaderFunc !== 'function') {
                    throw new Error(`Loader script did not return an async function.`);
                }
            } catch (loaderError) {
                throw new Error(`Loader script eval error: ${loaderError.message}`);
            }

            // Call the async loader function provided by the evaluated script
            // Pass the instantiateWasm hook in the argument object
            const loadedModule = await loaderFunc({
                instantiateWasm: instantiateWasm // Pass the hook function
                // wasmBinary is not needed here as instantiateWasm handles instantiation
            });

            this.wasmModule = loadedModule; // Store the resolved module object

            // Basic check for essential functions after module loads
            if (!this.wasmModule || typeof this.wasmModule._rubberband_new !== 'function') {
                 throw new Error(`WASM Module loaded, but _rubberband_new function not found.`);
            }
            console.log("[Worklet] WASM module loaded and exports assigned by loader.");

            // --- Rubberband Instance Creation ---
            const RBOptions = this.wasmModule.RubberBandOptionFlag || this.wasmModule.RubberbandOptions || {}; // Check both possible names
             if (!RBOptions || Object.keys(RBOptions).length === 0) {
                 console.warn("[Worklet] RubberBandOptionFlag not found on WASM module. Using default numeric values.");
             }

            // Define flags for quality, using fallbacks if flags aren't on module
            const ProcessRealTime = RBOptions.ProcessRealTime ?? 0x00000001;
            const EngineFiner = RBOptions.EngineFiner ?? 0x20000000;       // Use finer engine for quality
            const PitchHighQuality = RBOptions.PitchHighQuality ?? 0x02000000; // High quality pitch shifting
            const PhaseIndependent = RBOptions.PhaseIndependent ?? 0x00002000; // Often good for voice
            const TransientsCrisp = RBOptions.TransientsCrisp ?? 0x00000000;   // Default, good for consonants
            // const FormantPreserved = RBOptions.FormantPreserved ?? 0x01000000; // Keep for reference

            const options = ProcessRealTime | PitchHighQuality | PhaseIndependent | TransientsCrisp;
            console.log(`[Worklet] Creating Rubberband instance with options: ${options.toString(16)} (SampleRate: ${this.sampleRate}, Channels: ${this.numberOfChannels})`);

            this.rubberbandStretcher = this.wasmModule._rubberband_new(
                this.sampleRate,
                this.numberOfChannels,
                options,
                1.0, // Initial time ratio (corresponds to speed = 1.0)
                1.0 // Initial pitch scale
            );

            if (!this.rubberbandStretcher) {
                // _rubberband_new returns 0 on failure
                throw new Error("_rubberband_new failed to create instance (returned 0).");
            }
            console.log(`[Worklet] Rubberband instance created: ptr=${this.rubberbandStretcher}`);

            // --- Memory Allocation ---
            // Verify memory management functions exist after module load
            if (typeof this.wasmModule._malloc !== 'function' || !this.wasmModule.HEAPU32) {
                throw new Error("WASM memory functions (_malloc/HEAPU32) missing after module load.");
            }
            const pointerSize = 4; // Assuming 32-bit pointers in WASM

            // Allocate memory for the arrays that hold pointers to channel buffers
            this.inputPtrs = this.wasmModule._malloc(this.numberOfChannels * pointerSize);
            this.outputPtrs = this.wasmModule._malloc(this.numberOfChannels * pointerSize);
            if (!this.inputPtrs || !this.outputPtrs) { throw new Error("Pointer array _malloc failed."); }

            this.inputChannelBuffers = []; // JS array to hold pointers to WASM buffers
            this.outputChannelBuffers = []; // JS array to hold pointers to WASM buffers
            const frameSize = 4; // sizeof(float)

            // Determine blockSizeWasm (e.g., 1024 samples per channel per block)
            this.blockSizeWasm = 1024; // A common size, adjust if needed.

            // Allocate memory for each channel's input and output buffer in WASM heap
            for (let i = 0; i < this.numberOfChannels; ++i) {
                const bufferSizeBytes = this.blockSizeWasm * frameSize;
                const inputBuf = this.wasmModule._malloc(bufferSizeBytes);
                const outputBuf = this.wasmModule._malloc(bufferSizeBytes);

                if (!inputBuf || !outputBuf) {
                    this.cleanupWasmMemory(); // Clean up already allocated buffers on error
                    throw new Error(`Buffer _malloc failed for Channel ${i}.`);
                }

                this.inputChannelBuffers.push(inputBuf);
                this.outputChannelBuffers.push(outputBuf);

                // Store the WASM buffer pointers into the pointer arrays in WASM memory
                // HEAPU32 is used because pointers are 32-bit unsigned integers
                this.wasmModule.HEAPU32[(this.inputPtrs / pointerSize) + i] = inputBuf;
                this.wasmModule.HEAPU32[(this.outputPtrs / pointerSize) + i] = outputBuf;
            }
             console.log("[Worklet] Input/Output buffers allocated in WASM memory.");

            this.wasmReady = true;
            console.log("[Worklet] WASM and Rubberband ready.");
            this.postStatus('processor-ready'); // Notify main thread

        } catch (error) {
            console.error(`[Worklet] WASM/Rubberband Init Error: ${error.message}\n${error.stack}`);
            this.postError(`Init Error: ${error.message}`); // Notify main thread
            this.wasmReady = false;
            this.rubberbandStretcher = 0; // Ensure stretcher pointer is invalid
            this.cleanupWasmMemory(); // Attempt cleanup on initialization error
        }
    }

    /**
     * Handles messages received from the main thread via the node's port.
     * @param {MessageEvent} event
     */
    handleMessage(event) {
        const data = event.data;
        // console.log("[Worklet] Received message:", data.type, data); // Debugging

        try {
            switch (data.type) {
                case 'load-audio':
                    // Reset state for new audio file
                    this.playbackPositionInSeconds = 0;
                    this.resetNeeded = true;
                    this.streamEnded = false;
                    this.finalBlockSent = false;
                    // Reset parameters to default
                    this.currentTargetSpeed = 1.0;
                    this.lastAppliedStretchRatio = 1.0;
                    this.currentTargetPitchScale = 1.0;
                    this.lastAppliedPitchScale = 1.0;
                    this.currentTargetFormantScale = 1.0;
                    this.lastAppliedFormantScale = 1.0;

                    if (data.channelData && Array.isArray(data.channelData) && data.channelData.length === this.numberOfChannels) {
                        // Convert ArrayBuffers back to Float32Arrays
                        this.originalChannels = data.channelData.map(buffer => new Float32Array(buffer));
                        this.audioLoaded = true;
                        this.sourceDurationSeconds = (this.originalChannels[0]?.length || 0) / this.sampleRate;
                        console.log(`[Worklet] Audio loaded. Duration: ${this.sourceDurationSeconds.toFixed(3)}s, Channels: ${this.numberOfChannels}, SampleRate: ${this.sampleRate}`);

                        // Initialize WASM now if not already done
                        if (!this.wasmReady) {
                            this.initializeWasmAndRubberband(); // This will post 'processor-ready' on success
                        } else {
                             this.postStatus('processor-ready'); // Already ready, just confirm
                        }
                    } else {
                        this.postError('Invalid audio data received in load-audio message.');
                        this.audioLoaded = false;
                    }
                    break;

                case 'play':
                    if (this.wasmReady && this.audioLoaded) {
                        if (!this.isPlaying) {
                            // If playback ended or seeking to end, reset position to start before playing
                            if (this.streamEnded || this.playbackPositionInSeconds >= this.sourceDurationSeconds) {
                                this.playbackPositionInSeconds = 0;
                                this.resetNeeded = true; // Ensure Rubberband state is reset
                                this.streamEnded = false;
                                this.finalBlockSent = false;
                            }
                            this.isPlaying = true;
                            console.log("[Worklet] Play command received.");
                            this.port?.postMessage({ type: 'playback-state', isPlaying: true }); // Confirm state
                        }
                    } else {
                         this.postError(`Cannot play: ${!this.wasmReady ? 'WASM not ready' : 'Audio not loaded'}.`);
                         this.port?.postMessage({ type: 'playback-state', isPlaying: false }); // Ensure main thread knows it's not playing
                    }
                    break;

                case 'pause':
                    if (this.isPlaying) {
                        this.isPlaying = false;
                        console.log("[Worklet] Pause command received.");
                        this.port?.postMessage({ type: 'playback-state', isPlaying: false }); // Confirm state
                    }
                    break;

                case 'set-speed':
                    if (this.wasmReady) {
                        const newSpeed = Math.max(0.01, data.value || 1.0); // Ensure positive speed
                        if (this.currentTargetSpeed !== newSpeed) {
                            this.currentTargetSpeed = newSpeed;
                            // Actual application happens in process() loop
                        }
                    }
                    break;

                 case 'set-pitch':
                     if (this.wasmReady) {
                         const newPitch = Math.max(0.1, data.value || 1.0); // Ensure positive pitch scale
                         if (this.currentTargetPitchScale !== newPitch) {
                             this.currentTargetPitchScale = newPitch;
                             // Actual application happens in process() loop
                         }
                     }
                     break;

                 case 'set-formant':
                    if (this.wasmReady) {
                        const newFormant = Math.max(0.1, data.value || 1.0); // Ensure positive formant scale
                        if (this.currentTargetFormantScale !== newFormant) {
                            this.currentTargetFormantScale = newFormant;
                            // Actual application happens in process() loop
                        }
                    }
                    break;

                case 'seek':
                    if (this.wasmReady && this.audioLoaded) {
                        const seekPosition = Math.max(0, Math.min(data.positionSeconds || 0, this.sourceDurationSeconds));
                        this.playbackPositionInSeconds = seekPosition;
                        this.resetNeeded = true; // Force reset after seek for clean state
                        this.streamEnded = false; // If seeking, stream hasn't ended yet
                        this.finalBlockSent = false;
                        console.log(`[Worklet] Seek command received. Position set to ${this.playbackPositionInSeconds.toFixed(3)}s`);
                        // Optionally, send time update immediately after seek?
                        // this.port?.postMessage({type: 'time-update', currentTime: this.playbackPositionInSeconds });
                    }
                    break;

                case 'cleanup':
                    this.cleanup();
                    break;

                default:
                    console.warn("[Worklet] Received unknown message type:", data.type);
            }
        } catch (error) {
             // Catch errors during message handling
             this.postError(`Error handling message type '${data.type}': ${error.message}`);
             console.error(`[Worklet] Error handling message type '${data.type}': ${error.stack}`);
             // Try to ensure a safe state
             this.isPlaying = false;
             this.port?.postMessage({ type: 'playback-state', isPlaying: false });
        }
    }

    /**
     * The core audio processing function called by the Web Audio API.
     * Handles pulling data from source, processing via Rubberband, and outputting.
     * @param {Float32Array[][]} inputs - Input audio data (unused in this node).
     * @param {Float32Array[][]} outputs - Output buffers to fill.
     * @param {Record<string, Float32Array>} parameters - Audio parameters (unused here).
     * @returns {boolean} - Return true to keep the processor alive, false to terminate.
     */
    process(inputs, outputs, parameters) {
        // --- Precondition Checks ---
        if (!this.wasmReady || !this.audioLoaded || !this.rubberbandStretcher || !this.wasmModule) {
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
                available = this.wasmModule._rubberband_available?.(this.rubberbandStretcher) ?? 0;
             } catch (e) { console.error("[Worklet] Error calling _rubberband_available:", e); }
            if (Math.max(0, available) <= 0) {
                this.outputSilence(outputs);
                return true;
            }
        }

        const outputBuffer = outputs[0];
        if (!outputBuffer || outputBuffer.length !== this.numberOfChannels || !outputBuffer[0]) {
             console.warn("[Worklet] Invalid output buffer structure.");
             this.outputSilence(outputs);
             return true;
        }
        const outputBlockSize = outputBuffer[0].length; // Number of frames to generate (typically 128)
        if (outputBlockSize === 0) {
            return true;
        }


        try {
            // --- Parameter Updates ---
            const sourceChannels = this.originalChannels;
            const safeTargetSpeed = Math.max(0.01, this.currentTargetSpeed);
            const targetStretchRatio = 1.0 / safeTargetSpeed;
            const safeStretchRatio = Math.max(0.05, Math.min(20.0, targetStretchRatio));
            const ratioChanged = Math.abs(safeStretchRatio - this.lastAppliedStretchRatio) > 1e-6;
            const safeTargetPitch = Math.max(0.1, this.currentTargetPitchScale);
            const pitchChanged = Math.abs(safeTargetPitch - this.lastAppliedPitchScale) > 1e-6;
            const safeTargetFormant = Math.max(0.1, this.currentTargetFormantScale);
            const formantChanged = Math.abs(safeTargetFormant - this.lastAppliedFormantScale) > 1e-6;

            // --- Handle Reset or Parameter Changes ---
            if (this.resetNeeded) {
                this.wasmModule._rubberband_reset(this.rubberbandStretcher);
                // Apply current parameters immediately after reset
                this.wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, safeStretchRatio);
                this.wasmModule._rubberband_set_pitch_scale(this.rubberbandStretcher, safeTargetPitch);
                // Still call set_formant_scale even if we suspect it does nothing, to maintain logical consistency
                this.wasmModule._rubberband_set_formant_scale(this.rubberbandStretcher, safeTargetFormant);
                this.lastAppliedStretchRatio = safeStretchRatio;
                this.lastAppliedPitchScale = safeTargetPitch;
                this.lastAppliedFormantScale = safeTargetFormant;
                this.resetNeeded = false;
                this.finalBlockSent = false; // Ensure this is reset too
                this.streamEnded = false;    // Stream hasn't ended if we just reset
                console.log(`[Worklet] Rubberband Reset. Applied R:${safeStretchRatio.toFixed(3)}, P:${safeTargetPitch.toFixed(3)}, F:${safeTargetFormant.toFixed(3)}`);
            } else {
                // Apply parameter changes if they occurred
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

            // --- Input Processing ---
            // Calculate how many input frames are roughly needed based on the output block size and current stretch ratio
            // Add a small buffer (+4) as recommended by Rubberband docs
            let inputFramesNeeded = Math.ceil(outputBlockSize / safeStretchRatio) + 4; // Using safeStretchRatio applied above
            inputFramesNeeded = Math.max(1, inputFramesNeeded); // Need at least 1

            // Determine current read position in the source buffer
            let readPosInSourceSamples = Math.round(this.playbackPositionInSeconds * this.sampleRate);
            const sourceTotalSamples = sourceChannels[0]?.length || 0;
            readPosInSourceSamples = Math.max(0, Math.min(readPosInSourceSamples, sourceTotalSamples)); // Clamp position

            // Calculate how many input frames can actually be provided from the current position
            let actualInputProvided = Math.min(inputFramesNeeded, sourceTotalSamples - readPosInSourceSamples);
            actualInputProvided = Math.max(0, actualInputProvided); // Ensure non-negative

            // Check if this is the final block of data from the source
            const isFinalDataBlock = (readPosInSourceSamples + actualInputProvided) >= sourceTotalSamples;
            // Determine if the 'final' flag should be sent to rubberband_process
            // Only send it once, on the iteration where the last source samples are provided.
            const sendFinalFlag = isFinalDataBlock && !this.finalBlockSent;

            // If there's input to provide OR if it's time to send the final flag (even with 0 input frames)
            if (actualInputProvided > 0 || sendFinalFlag) {
                // Copy input data to WASM buffers
                for (let i = 0; i < this.numberOfChannels; i++) {
                    const sourceData = sourceChannels[i];
                    // Create a view into the specific WASM memory buffer for this channel
                    const wasmInputBufferView = new Float32Array(
                        this.wasmModule.HEAPF32.buffer, // The underlying ArrayBuffer of WASM memory
                        this.inputChannelBuffers[i],    // Start byte offset of this channel's buffer
                        this.blockSizeWasm               // Length of the buffer in elements (Floats)
                    );

                    if (actualInputProvided > 0) {
                        const endReadPos = readPosInSourceSamples + actualInputProvided;
                        // Get a subarray from the original audio data
                        const inputSlice = sourceData.subarray(readPosInSourceSamples, endReadPos);
                        // Copy the slice into the WASM buffer view
                        const copyLength = Math.min(inputSlice.length, this.blockSizeWasm); // Don't overflow WASM buffer
                        if (copyLength > 0) {
                            wasmInputBufferView.set(inputSlice.subarray(0, copyLength));
                        }
                        // Zero out remaining part of WASM buffer if input was shorter than blockSizeWasm
                        if (copyLength < this.blockSizeWasm) {
                            wasmInputBufferView.fill(0.0, copyLength);
                        }
                    } else {
                        // If providing 0 input frames (only sending final flag), zero out the buffer
                         wasmInputBufferView.fill(0.0);
                    }
                }

                // Call rubberband_process
                this.wasmModule._rubberband_process(
                    this.rubberbandStretcher,
                    this.inputPtrs,        // Pointer to array of input buffer pointers
                    actualInputProvided,   // Number of frames provided in this call
                    sendFinalFlag ? 1 : 0  // Final flag (1 if true, 0 if false)
                );

                // Update playback position based on input consumed (before stretching)
                const inputSecondsConsumed = (actualInputProvided / this.sampleRate);
                this.playbackPositionInSeconds += inputSecondsConsumed;
                // Clamp position just in case of floating point inaccuracies
                this.playbackPositionInSeconds = Math.min(this.playbackPositionInSeconds, this.sourceDurationSeconds);

                // --- Latency Correction for Time Update --- // *** MODIFIED BLOCK START ***
                let correctedTime = this.playbackPositionInSeconds; // Default to uncorrected time
                try {
                    // Check if wasmModule and the function exist before calling
                    if (this.wasmModule && typeof this.wasmModule._rubberband_get_latency === 'function') {
                        const latencySamples = this.wasmModule._rubberband_get_latency(this.rubberbandStretcher);
                        if (typeof latencySamples === 'number' && latencySamples >= 0 && this.sampleRate > 0) {
                            const rubberbandLatencySeconds = latencySamples / this.sampleRate;
                            // ALSO consider the latency of the current output block buffer (typically 128 samples)
                            const outputBlockLatencySeconds = outputBlockSize / this.sampleRate;
                            const totalLatencySeconds = rubberbandLatencySeconds + outputBlockLatencySeconds;

                            // Subtract TOTAL latency: reported time should reflect the input time corresponding to the *actual audio hitting the speakers*
                            correctedTime = Math.max(0, this.playbackPositionInSeconds - totalLatencySeconds);
                            // console.log(`Pos: ${this.playbackPositionInSeconds.toFixed(3)}, RB Latency: ${rubberbandLatencySeconds.toFixed(3)}, Block Latency: ${outputBlockLatencySeconds.toFixed(3)}, Corrected: ${correctedTime.toFixed(3)}`); // Debug
                        } else {
                           // Log only if latency is invalid, avoid spamming for valid 0 latency
                           if (typeof latencySamples !== 'number' || latencySamples < 0) {
                               console.warn("[Worklet] _rubberband_get_latency returned invalid value or sampleRate invalid:", latencySamples, this.sampleRate);
                           }
                        }
                    } else if (!this.wasmModule || typeof this.wasmModule._rubberband_get_latency !== 'function') {
                        // Log if the function is missing (should only happen once or if module unloaded)
                        // console.warn("[Worklet] _rubberband_get_latency function not available on wasmModule.");
                    }
                } catch(latencyError) {
                    console.warn("[Worklet] Error getting latency:", latencyError);
                }
                // --- Latency Correction --- // *** MODIFIED BLOCK END ***

                // Send time update message (using corrected time)
                // Debounce this? Sending every 128 samples might be excessive.
                // Send less frequently? e.g., every N calls?
                // For now, send every time.
                this.port?.postMessage({type: 'time-update', currentTime: correctedTime });


                if (sendFinalFlag) {
                    this.finalBlockSent = true; // Mark final flag as sent
                }
            } // End if (actualInputProvided > 0 || sendFinalFlag)

            // --- Output Retrieval ---
            let totalRetrieved = 0;
            let available = 0;
            // Create temporary JS buffers to hold retrieved data before copying to output
             const tempOutputBuffers = Array.from({ length: this.numberOfChannels }, () => new Float32Array(outputBlockSize));

            // Loop to retrieve frames until the output buffer is full or Rubberband has no more
            do {
                 // Check if wasmModule and function exist before calling
                 if (this.wasmModule && typeof this.wasmModule._rubberband_available === 'function') {
                    available = this.wasmModule._rubberband_available(this.rubberbandStretcher);
                    available = Math.max(0, available); // Ensure non-negative
                 } else {
                    available = 0; // Assume none available if function missing
                 }


                if (available > 0) {
                    const neededNow = outputBlockSize - totalRetrieved;
                    if (neededNow <= 0) break; // Output buffer is full

                    // Determine how many frames to retrieve in this iteration
                    const framesToRetrieve = Math.min(available, neededNow, this.blockSizeWasm); // Cannot retrieve more than blocksizeWasm at once
                    if (framesToRetrieve <= 0) break; // Should not happen if available > 0

                    // Call rubberband_retrieve (check function existence)
                    let retrieved = 0;
                    if (this.wasmModule && typeof this.wasmModule._rubberband_retrieve === 'function') {
                        retrieved = this.wasmModule._rubberband_retrieve(
                            this.rubberbandStretcher,
                            this.outputPtrs,     // Pointer to array of output buffer pointers
                            framesToRetrieve     // Number of frames requested
                        );
                    } else {
                         console.warn("[Worklet] _rubberband_retrieve function not available.");
                         retrieved = -1; // Simulate error if function missing
                    }


                    if (retrieved > 0) {
                        // Copy retrieved data from WASM buffers to temporary JS buffers
                        for (let i = 0; i < this.numberOfChannels; i++) {
                            const wasmOutputBufferView = new Float32Array(
                                this.wasmModule.HEAPF32.buffer,
                                this.outputChannelBuffers[i],
                                retrieved // Only read the number of frames actually retrieved
                            );
                            // Copy into the correct position in the temp JS buffer
                            const copyLength = Math.min(retrieved, tempOutputBuffers[i].length - totalRetrieved);
                            if (copyLength > 0) {
                                tempOutputBuffers[i].set(wasmOutputBufferView.subarray(0, copyLength), totalRetrieved);
                            }
                        }
                        totalRetrieved += retrieved;
                    } else if (retrieved < 0) {
                         // An error occurred in _rubberband_retrieve
                         console.error(`[Worklet] _rubberband_retrieve returned error code: ${retrieved}`);
                         available = 0; // Stop retrieving
                         break;
                    } else {
                         // retrieved === 0, means no frames retrieved despite 'available' > 0?
                         // This might indicate an issue or just end of internal buffer.
                         available = 0; // Stop retrieving for safety
                    }
                } // end if (available > 0)
            } while (available > 0 && totalRetrieved < outputBlockSize);

            // --- Copy to Final Output ---
            // Copy data from temporary JS buffers to the actual AudioWorklet output buffers
            for (let i = 0; i < this.numberOfChannels; ++i) {
                 if (outputBuffer[i]) { // Check if output channel buffer exists
                     const copyLength = Math.min(totalRetrieved, outputBlockSize);
                     if (copyLength > 0) {
                         outputBuffer[i].set(tempOutputBuffers[i].subarray(0, copyLength));
                     }
                     // Zero out the rest of the buffer if not enough samples were retrieved
                     if (copyLength < outputBlockSize) {
                         outputBuffer[i].fill(0.0, copyLength);
                     }
                 }
            }

            // --- Check for Stream End ---
            // If the final block was sent AND rubberband has no more samples available
            // AND we couldn't fill the entire output block in this call, then the stream has truly ended.
            if (this.finalBlockSent && available <= 0 && totalRetrieved < outputBlockSize) {
                if (!this.streamEnded) {
                    console.log("[Worklet] Playback stream ended.");
                    this.streamEnded = true;
                    this.isPlaying = false; // Stop playback state
                    this.postStatus('Playback ended'); // Notify main thread
                    this.port?.postMessage({ type: 'playback-state', isPlaying: false }); // Confirm state
                    // Don't reset position here, wait for explicit play/seek
                }
            }

        } catch (error) {
            console.error(`[Worklet] Processing Error: ${error.message}\n${error.stack}`);
            this.postError(`Processing Error: ${error.message}`);
            this.isPlaying = false; // Stop playback on error
            this.streamEnded = true; // Consider stream ended on error
            this.outputSilence(outputs); // Try to output silence
            this.port?.postMessage({ type: 'playback-state', isPlaying: false }); // Notify main thread
            return true; // Keep processor alive despite error? Or return false? Let's keep it alive for now.
        }

        return true; // Keep processor alive
    } // --- End process() ---

    /**
     * Fills the output buffers with silence.
     * @private
     * @param {Float32Array[][]} outputs - The output buffers from the process method.
     */
    outputSilence(outputs) {
        if (!outputs || !outputs[0] || !outputs[0][0]) return; // Basic validation

        const outputChannels = outputs[0];
        const numChannels = outputChannels.length;
        const blockSize = outputChannels[0]?.length || 0;

        if (blockSize === 0) return; // Nothing to fill

        for (let i = 0; i < numChannels; ++i) {
            if (outputChannels[i]) { // Check if channel buffer exists
                outputChannels[i].fill(0.0);
            }
        }
    }

    /**
     * Posts a status message back to the main thread.
     * @private
     * @param {string} message - The status message string.
     */
    postStatus(message) {
        try {
             if (!this.port) { console.error("[Worklet] Port is null, cannot post status."); return; }
             this.port.postMessage({type: 'status', message});
        } catch (e) {
            // Handle potential errors if the port is closed or detached
            console.error(`[Worklet] FAILED to post status '${message}':`, e);
        }
    }

    /**
     * Posts an error message back to the main thread.
     * @private
     * @param {string} message - The error message string.
     */
    postError(message) {
         try {
             if (!this.port) { console.error("[Worklet] Port is null, cannot post error."); return; }
            this.port.postMessage({type: 'error', message});
         } catch (e) {
             console.error(`[Worklet] FAILED to post error '${message}':`, e);
         }
    }

    /**
     * Posts an error message and requests cleanup.
     * @private
     * @param {string} message - The error message string.
     */
    postErrorAndStop(message) {
        this.postError(message);
        this.cleanup(); // Request cleanup
    }

    /**
     * Frees WASM memory allocated for buffers and pointer arrays.
     * Safe to call even if memory wasn't fully allocated or module is gone.
     * @private
     */
    cleanupWasmMemory() {
        if (this.wasmModule && typeof this.wasmModule._free === 'function') {
            try {
                // Free individual channel buffers
                this.inputChannelBuffers.forEach(ptr => {
                    if (ptr) this.wasmModule._free(ptr);
                });
                this.outputChannelBuffers.forEach(ptr => {
                    if (ptr) this.wasmModule._free(ptr);
                });
                this.inputChannelBuffers = []; // Clear JS arrays
                this.outputChannelBuffers = [];

                // Free pointer arrays
                if (this.inputPtrs) this.wasmModule._free(this.inputPtrs);
                if (this.outputPtrs) this.wasmModule._free(this.outputPtrs);
                this.inputPtrs = 0; // Reset pointers
                this.outputPtrs = 0;

            } catch (e) {
                 console.error("[Worklet] Error during WASM memory cleanup with _free:", e);
                 // Avoid throwing here, cleanup should be best-effort
            }
        } else {
             // console.log("[Worklet] Skipping WASM memory cleanup: _free function not available.");
        }
        // Ensure pointers are reset even if _free wasn't called/available
        this.inputPtrs = 0; this.outputPtrs = 0;
        this.inputChannelBuffers = []; this.outputChannelBuffers = [];
    }

    /**
     * Cleans up all resources used by the processor.
     * Deletes the Rubberband instance, frees WASM memory, resets state.
     * @private
     */
    cleanup() {
        console.log("[Worklet] Cleanup requested.");
        this.isPlaying = false; // Stop playback state

        // Delete Rubberband instance
        if (this.wasmReady && this.rubberbandStretcher !== 0 && this.wasmModule && typeof this.wasmModule._rubberband_delete === 'function') {
            try {
                this.wasmModule._rubberband_delete(this.rubberbandStretcher);
            } catch (e) {
                console.error("[Worklet] Error deleting Rubberband instance:", e);
            }
        }
        this.rubberbandStretcher = 0; // Mark as deleted

        // Free WASM memory
        this.cleanupWasmMemory();

        // Reset state variables
        this.wasmReady = false;
        this.audioLoaded = false;
        this.originalChannels = null;
        this.wasmModule = null; // Release reference to module
        this.wasmBinary = null; // Allow binary to be garbage collected if needed
        this.loaderScriptText = null;
        this.playbackPositionInSeconds = 0;
        this.streamEnded = true;
        this.finalBlockSent = false;
        this.resetNeeded = true;

        console.log("[Worklet] Cleanup finished.");
        this.postStatus("Processor cleaned up"); // Notify main thread

        // Optional: Close the port? Generally not needed, processor termination handles it.
        // if (this.port) this.port.close();
    }

} // --- End RubberbandProcessor Class ---

// --- Registration ---
// Register the processor with the defined name.
// Handle potential errors during registration.
try {
    // Check if running in an AudioWorkletGlobalScope where registerProcessor is defined
    // Also check for `sampleRate` global which is expected in this scope
    if (typeof registerProcessor === 'function' && typeof sampleRate !== 'undefined') {
        registerProcessor(PROCESSOR_NAME, RubberbandProcessor);
    } else {
        console.error("[Worklet] registerProcessor or global sampleRate not defined. Ensure this script is loaded via addModule().");
        // Attempt to notify main thread if possible (might fail if port isn't set up yet)
        try { if (self?.postMessage) self.postMessage({ type: 'error', message: 'registerProcessor or global sampleRate not defined.' }); } catch(e) {}
    }
} catch (error) {
    console.error(`[Worklet] Failed to register processor '${PROCESSOR_NAME}':`, error);
    // Attempt to notify main thread
    try { if (self?.postMessage) self.postMessage({ type: 'error', message: `Failed to register processor: ${error.message}` }); } catch(e) {}
}
// --- /vibe-player/js/rubberbandProcessor.js ---
