// --- /vibe-player/audio/hybrid-processor.js ---
/**
 * @fileoverview AudioWorkletProcessor for Vibe Player Pro.
 * Implements hybrid real-time audio time stretching, pitch shifting, and formant shifting
 * using the Rubberband library compiled to WebAssembly. It dynamically switches between
 * processing the original audio and a pre-computed slow version based on the target speed.
 *
 * It receives audio data and control parameters from the main thread (main.js) via messages
 * and uses a custom loader script ('rubberband-loader.js') text, also passed from the main
 * thread, to initialize the Rubberband WASM instance within its own scope.
 */

// Processor Name - must match the name used when creating the AudioWorkletNode in main.js
// and should align with AudioApp.config.PROCESSOR_NAME. Hardcoded here as direct config access isn't possible.
const PROCESSOR_NAME = 'hybrid-audio-processor';

// Scope for WASM module exports after initialization
let wasmModule = null;
// Scope for the Rubberband loader factory function obtained via eval/new Function
let RubberbandLoaderFn = null; // Will hold the async function factory


class HybridAudioProcessor extends AudioWorkletProcessor {

    // --- Static Configuration (if needed, or rely on processorOptions) ---
    // Example: static MUTE_DURATION_FRAMES = 128; // ~2.6ms @ 48kHz

    // --- Constructor ---
    constructor(options) {
        super(); // Call parent constructor
        console.log("[Worklet] HybridAudioProcessor constructor called.");

        // --- Processor Options & Initial State ---
        // Store options passed from the main thread during node creation
        this.processorOpts = options.processorOptions || {};
        this.sampleRate = this.processorOpts.sampleRate || currentTime; // currentTime is from AudioWorkletGlobalScope
        this.numberOfChannels = this.processorOpts.numberOfChannels || 0;
        this.wasmBinary = this.processorOpts.wasmBinary;           // ArrayBuffer
        this.loaderScriptText = this.processorOpts.loaderScriptText; // String

        // --- WASM & Rubberband State ---
        // wasmModule is defined outside the class scope
        this.wasmReady = false;
        this.rubberbandStretcher = 0; // Pointer (integer) to the C++ RubberbandStretcher instance
        this.RBOptions = null;        // To store the RubberBandOptionFlag enum after load
        this.inputPtrs = 0;           // WASM address of input channel pointer array
        this.outputPtrs = 0;          // WASM address of output channel pointer array
        this.inputChannelBufPtrs = [];// Array of WASM addresses for each input channel buffer
        this.outputChannelBufPtrs = [];// Array of WASM addresses for each output channel buffer
        // Internal processing block size for WASM buffers (can be tuned)
        // Larger might be slightly more efficient but increases latency within the block.
        this.blockSizeWasm = 2048; // e.g., ~42ms @ 48kHz

        // --- Playback & Parameter State ---
        this.isPlaying = false;        // Is the processor actively generating audio?
        this.audioLoaded = false;      // Have original & slow buffers been received?
        this.originalChannels = null;  // Array<Float32Array> for original audio data
        this.slowChannels = null;      // Array<Float32Array> for pre-processed slow audio data
        this.originalDurationSeconds = 0; // Duration of the original audio
        // Conceptual playback time, always relative to the *original* audio's timeline (0 to originalDurationSeconds)
        this.conceptualPlaybackTime = 0.0;

        // --- Current Real-time Parameters (Initialized from processorOptions, updated via messages) ---
        this.targetSpeed = this.processorOpts.initialSpeed ?? 1.0;
        this.targetPitchSemitones = this.processorOpts.initialPitchSemitones ?? 0.0;
        this.targetFormantScale = this.processorOpts.initialFormantScale ?? 1.0;
        this.hybridThreshold = this.processorOpts.initialHybridThreshold ?? 0.8;
        this.initialSlowSpeed = this.processorOpts.initialSlowSpeed ?? 0.25; // Speed used to generate slowChannels
        this.sourceOverride = this.processorOpts.initialSourceOverride ?? 'auto'; // 'auto', 'original', 'slow'
        this.switchBehavior = this.processorOpts.initialSwitchBehavior ?? 'microfade'; // 'abrupt', 'mute', 'microfade'
        this.microFadeDurationFrames = Math.max(1, Math.round((this.processorOpts.microFadeDurationMs ?? 5) / 1000 * this.sampleRate));

        // --- Internal Processing & State Tracking ---
        this.actualSourceIsSlow = false;      // Which buffer are we *currently* reading from?
        this.targetSourceIsSlow = false;      // Which buffer *should* we be reading from based on params?
        // Last applied values to Rubberband instance to avoid redundant calls
        this.lastAppliedStretchRatio = -1; // Initialize to invalid value
        this.lastAppliedPitchScale = -1;
        this.lastAppliedFormantScale = -1;
        this.resetNeeded = true;              // Force _rubberband_reset before first process block
        this.streamEnded = false;             // Has source audio been fully processed by Rubberband?
        this.finalBlockSent = false;          // Has the final flag been sent to _rubberband_process?
        this.outputSilenceCounter = 0;        // Counter for outputting silence padding after stream ends

        // --- Switching State Machine ---
        this.switchState = 'idle';      // 'idle', 'fading-out', 'muting', 'fading-in'
        this.fadeGain = 1.0;            // Current gain multiplier for fades (0.0 to 1.0)
        this.fadeFramesTotal = this.microFadeDurationFrames; // Total frames for fade ramp
        this.fadeFramesRemaining = 0;     // Frames left in current fade phase


        // --- Message Handling Setup ---
        this.port.onmessage = this.handleMessage.bind(this);
        console.log("[Worklet] HybridProcessor initialized. Waiting for audio data...");

        // --- Initial Validation ---
        if (!this.wasmBinary || !this.loaderScriptText || !this.sampleRate || this.sampleRate <= 0 || !this.numberOfChannels || this.numberOfChannels <= 0) {
            this.postErrorAndStop(`Processor creation failed: Invalid options received. SR=${this.sampleRate}, Ch=${this.numberOfChannels}, WASM=${!!this.wasmBinary}, Loader=${!!this.loaderScriptText}`);
            return; // Stop initialization
        }

        // --- Pre-compile Loader Function ---
        // Optimization: Compile the loader function string once during construction.
        try {
            // Assuming the loader script defines a global variable 'Rubberband' which holds the async factory function
            const getLoaderFactory = new Function(`${this.loaderScriptText}; return Rubberband;`);
            RubberbandLoaderFn = getLoaderFactory(); // Store the factory function
            if (typeof RubberbandLoaderFn !== 'function') {
                throw new Error("Loader script did not expose 'Rubberband' async function factory.");
            }
            console.log("[Worklet] Rubberband loader function compiled successfully.");
        } catch (e) {
            this.postErrorAndStop(`Failed to compile Rubberband loader script: ${e.message}`);
            RubberbandLoaderFn = null; // Ensure it's null on failure
        }
    }

    // --- WASM Initialization ---
    /**
     * Initializes the Rubberband WASM module and instance asynchronously using the pre-compiled loader function.
     * Triggered after receiving audio data via 'load-audio' message.
     * @private
     */
    async initializeWasmAndRubberband() {
        if (this.wasmReady) {
            console.warn("[Worklet] WASM already initialized, skipping.");
            return;
        }
        if (!RubberbandLoaderFn) {
             this.postErrorAndStop("Cannot initialize WASM: Loader function not available.");
             return;
        }
        console.log("[Worklet] Initializing WASM & Rubberband instance via loader...");
        try {
            // --- Instantiate WASM using Loader Script ---
            // Hook function for the loader script to call WebAssembly.instantiate
            const instantiateWasm = (imports, successCallback) => {
                 // console.log("[Worklet] instantiateWasm hook called by loader.");
                 WebAssembly.instantiate(this.wasmBinary, imports)
                    .then(output => {
                        // console.log("[Worklet] WASM instantiation successful via hook.");
                        // Pass the instance and module object to the loader's callback
                        successCallback(output.instance, output.module);
                    }).catch(error => {
                        console.error("[Worklet] WASM Instantiation hook failed:", error);
                        // Reject the main initialization promise if hook fails
                        // This relies on the loader function properly handling promise rejection.
                        this.postError(`WASM Hook Error: ${error.message}`);
                        // How to reject the outer promise? Needs careful loader design. For now, post error.
                    });
                 return {}; // Expected by Emscripten loaders
            };

            // --- Call the Loader Function ---
            // The loader function is expected to return a promise that resolves with the module exports object.
            const loadedModule = await RubberbandLoaderFn({
                instantiateWasm: instantiateWasm,
                // Pass other potential options if the loader uses them (print, printErr)
                print: (...args) => console.log("[WASM Log]", ...args),
                printErr: (...args) => console.error("[WASM Err]", ...args),
                onAbort: (reason) => this.postErrorAndStop(`WASM Aborted: ${reason}`),
             });

            // --- Verify Module and Get Exports ---
            wasmModule = loadedModule; // Assign to the outer scope variable
            if (!wasmModule || typeof wasmModule._rubberband_new !== 'function') {
                throw new Error("_rubberband_new function not found on loaded module. WASM loading failed.");
            }
            console.log("[Worklet] WASM Module exports verified.");
            this.RBOptions = wasmModule.RubberBandOptionFlag; // Store options enum locally

            // --- Create Rubberband Instance (Real-time Flags) ---
            const rbFlags = this.RBOptions.ProcessRealTime | // MUST be real-time
                          this.RBOptions.EngineDefault | // Default engine (faster)
                          this.RBOptions.PitchHighQuality | // Good quality pitch shifting
                          this.RBOptions.FormantPreserved; // Preserve formants by default
                          // Add other flags as needed from config or options
            console.log(`[Worklet] Creating Rubberband instance (RealTime). SR=${this.sampleRate}, Ch=${this.numberOfChannels}, Flags=0x${rbFlags.toString(16)}`);
            this.rubberbandStretcher = wasmModule._rubberband_new(
                this.sampleRate,
                this.numberOfChannels,
                rbFlags,
                1.0, // Initial time ratio (will be updated)
                1.0  // Initial pitch scale (will be updated)
            );
            if (!this.rubberbandStretcher) {
                throw new Error("_rubberband_new call failed to create instance.");
            }
            console.log(`[Worklet] Rubberband instance created: ptr=${this.rubberbandStretcher}`);

            // --- Allocate WASM Memory Buffers ---
            this._allocateWasmMemory();

            this.wasmReady = true;
            console.log("[Worklet] WASM and Rubberband instance ready.");
            this.postStatus('processor-ready'); // Signal readiness to main thread

        } catch (error) {
             console.error(`[Worklet] FATAL: WASM/Rubberband Initialization Error: ${error.message}\n${error.stack}`);
             this.postErrorAndStop(`Engine Init Error: ${error.message}`);
             this.wasmReady = false;
             this.cleanupWasmResources(); // Attempt cleanup of any partial allocations
        }
    }

    /**
     * Allocates persistent memory buffers in the WASM heap for audio data transfer.
     * @private
     * @throws {Error} If allocation fails.
     */
    _allocateWasmMemory() {
        if (!wasmModule || typeof wasmModule._malloc !== 'function') {
            throw new Error("WASM module or _malloc function not available for memory allocation.");
        }
        console.log("[Worklet] Allocating WASM memory buffers...");
        const pointerSize = 4; // Bytes per pointer (assuming 32-bit WASM)
        const frameSize = 4;   // Bytes per Float32 sample
        const bufferSizeBytes = this.blockSizeWasm * frameSize; // Size of each channel buffer

        // Allocate arrays in WASM memory to hold pointers to the channel buffers
        this.inputPtrs = wasmModule._malloc(this.numberOfChannels * pointerSize);
        this.outputPtrs = wasmModule._malloc(this.numberOfChannels * pointerSize);
        if (!this.inputPtrs || !this.outputPtrs) {
            throw new Error("Failed to allocate WASM memory for channel pointer arrays.");
        }
        // console.log(`[Worklet] Allocated pointer arrays: input=${this.inputPtrs}, output=${this.outputPtrs}`);

        // Allocate individual buffers for each input and output channel
        this.inputChannelBufPtrs = [];
        this.outputChannelBufPtrs = [];
        for (let i = 0; i < this.numberOfChannels; ++i) {
            const inputBuf = wasmModule._malloc(bufferSizeBytes);
            const outputBuf = wasmModule._malloc(bufferSizeBytes);
            if (!inputBuf || !outputBuf) {
                // Clean up already allocated buffers before throwing
                this.cleanupWasmMemory();
                throw new Error(`WASM buffer allocation failed for Channel ${i}.`);
            }
            this.inputChannelBufPtrs.push(inputBuf);
            this.outputChannelBufPtrs.push(outputBuf);

            // Write the buffer addresses into the pointer arrays in WASM memory
            wasmModule.HEAPU32[(this.inputPtrs / pointerSize) + i] = inputBuf;
            wasmModule.HEAPU32[(this.outputPtrs / pointerSize) + i] = outputBuf;
        }
        console.log(`[Worklet] Allocated ${this.numberOfChannels}x input/output WASM buffers (${this.blockSizeWasm} frames each).`);
    }


    // --- Message Handling ---
    /**
     * Handles messages received from the main thread via the MessagePort.
     * @param {MessageEvent} event - The message event containing command and data.
     * @private
     */
    handleMessage(event) {
        const data = event.data;
        // console.log(`[Worklet] Received message: ${data.type}`); // Debugging

        try {
            switch (data.type) {
                case 'load-audio':
                    this.loadAudioData(data);
                    break;
                case 'play':
                    this.startPlayback();
                    break;
                case 'pause':
                    this.pausePlayback();
                    break;
                case 'seek':
                    this.seekPlayback(data.positionSeconds);
                    break;
                 case 'jump':
                    this.jumpPlayback(data.seconds);
                    break;
                case 'set-params':
                    this.updateParameters(data.params);
                    break;
                case 'cleanup':
                    this.cleanup();
                    break;
                default:
                    console.warn("[Worklet] Received unknown message type:", data.type);
            }
        } catch (error) {
            // Catch synchronous errors within message handlers
            this.postError(`Msg '${data.type}' Handler Error: ${error.message}`);
            console.error(`[Worklet] Error handling message type ${data.type}: ${error.message}\n${error.stack}`);
            // Optional: Pause playback on handler errors?
            // this.pausePlayback();
        }
    }

    /**
     * Loads and validates audio data received from main thread.
     * Triggers WASM initialization upon first successful load.
     * @param {object} data - Message data containing audio channels.
     * @param {Array<ArrayBuffer>} data.originalChannels - Original audio data.
     * @param {Array<ArrayBuffer>} data.slowChannels - Pre-processed slow audio data.
     * @private
     */
    loadAudioData(data) {
         if (this.audioLoaded) {
            console.warn("[Worklet] Audio already loaded. Re-loading data...");
            // Reset relevant state if reloading is intended
            this.resetPlaybackState();
         }

         // Validate received data structure
         if (!data.originalChannels || !data.slowChannels ||
             !Array.isArray(data.originalChannels) || !Array.isArray(data.slowChannels) ||
             data.originalChannels.length !== this.numberOfChannels ||
             data.slowChannels.length !== this.numberOfChannels) {
             this.postErrorAndStop("Invalid or mismatched audio channel data received.");
             return;
         }

         try {
             // Convert ArrayBuffers to Float32Arrays
             this.originalChannels = data.originalChannels.map(buffer => new Float32Array(buffer));
             this.slowChannels = data.slowChannels.map(buffer => new Float32Array(buffer));

             // Basic validation of buffer lengths (assuming Float32)
             if (!this.originalChannels[0] || this.originalChannels[0].length === 0) {
                  throw new Error("Original audio channel 0 is empty or invalid.");
             }
              if (!this.slowChannels[0] || this.slowChannels[0].length === 0) {
                  throw new Error("Slow audio channel 0 is empty or invalid.");
             }
             // Calculate durations
             this.originalDurationSeconds = this.originalChannels[0].length / this.sampleRate;
             // Note: slowDuration isn't strictly needed for calculations if using conceptual time

             console.log(`[Worklet] Audio data loaded. Original duration: ${this.originalDurationSeconds.toFixed(2)}s`);
             this.audioLoaded = true;
             this.resetPlaybackState(); // Ensure clean state for new audio

             // --- Trigger WASM Initialization ---
             // If WASM isn't ready yet, start the initialization process now that we have audio info.
             if (!this.wasmReady) {
                 this.initializeWasmAndRubberband(); // Intentionally async, don't await here
             } else {
                  // If WASM was already ready (e.g., previous file load), ensure Rubberband is reset
                  console.log("[Worklet] WASM ready, ensuring Rubberband state is reset for new audio.");
                  this.resetNeeded = true;
             }
         } catch (error) {
             this.postErrorAndStop(`Error processing loaded audio data: ${error.message}`);
             this.audioLoaded = false;
             this.originalChannels = null;
             this.slowChannels = null;
         }
    }

    /** Resets playback-related state variables. @private */
    resetPlaybackState() {
        this.conceptualPlaybackTime = 0.0;
        this.isPlaying = false;
        this.streamEnded = false;
        this.finalBlockSent = false;
        this.outputSilenceCounter = 0;
        this.resetNeeded = true; // Force Rubberband reset
        this.switchState = 'idle';
        this.fadeGain = 1.0;
        this.fadeFramesRemaining = 0;
        // Don't reset lastApplied values here, let the process loop handle initial application
    }

    // --- Playback Control Logic ---
    /** Starts or resumes playback. @private */
    startPlayback() {
        if (this.isPlaying) {
            console.warn("[Worklet] Play command received, but already playing.");
            return;
        }
        if (!this.audioLoaded || !this.wasmReady) {
            this.postError("Cannot play: Audio data or WASM engine not ready.");
            return;
        }
        console.log("[Worklet] Starting playback.");
        // If playback reached the end, reset position to start before playing again
        if (this.streamEnded || this.conceptualPlaybackTime >= this.originalDurationSeconds) {
             console.log("[Worklet] Playback reached end. Resetting position.");
             this.resetPlaybackState(); // Reset time, flags, etc.
        }
        this.isPlaying = true;
        // Ensure reset happens if needed (e.g., after seeking while paused, or first play)
        if (this.resetNeeded) console.log("[Worklet] Reset flag is true on Play command.");
        this.port.postMessage({type: 'playback-state', isPlaying: true}); // Confirm state
    }

    /** Pauses playback. @private */
    pausePlayback() {
        if (!this.isPlaying) {
            // console.log("[Worklet] Pause command received, but already paused.");
            return;
        }
        console.log("[Worklet] Pausing playback.");
        this.isPlaying = false;
        // No need to reset Rubberband state on pause, just stop feeding/retrieving.
        this.port.postMessage({type: 'playback-state', isPlaying: false}); // Confirm state
    }

    /** Seeks playback to a specific time. @private */
    seekPlayback(positionSeconds) {
        if (!this.audioLoaded || !this.wasmReady) {
             console.warn("[Worklet] Cannot seek: Audio/WASM not ready.");
             return;
        }
        // Clamp seek time to valid range [0, duration]
        const targetTime = Math.max(0, Math.min(positionSeconds, this.originalDurationSeconds));
        console.log(`[Worklet] Seeking to ${targetTime.toFixed(3)}s`);
        this.conceptualPlaybackTime = targetTime;
        this.resetNeeded = true; // Force Rubberband state reset after seek
        this.streamEnded = false; // Allow playback to continue if seeking before end
        this.finalBlockSent = false;
        this.outputSilenceCounter = 0;
        this.switchState = 'idle'; // Abort any ongoing fades
        this.fadeGain = 1.0;
        // If playing, the next process() call will handle the reset and continue.
        // If paused, the reset will happen when playback resumes.
    }

     /** Jumps playback forward or backward. @private */
     jumpPlayback(seconds) {
        if (!this.audioLoaded || !this.wasmReady) {
             console.warn("[Worklet] Cannot jump: Audio/WASM not ready.");
             return;
        }
        // Calculate new position based on current conceptual time
        const newPosition = this.conceptualPlaybackTime + seconds;
        // Seek handles clamping and resetting state
        this.seekPlayback(newPosition);
     }

    /** Updates processing parameters from main thread message. @private */
    updateParameters(params) {
        if (!this.wasmReady) {
             console.warn("[Worklet] Cannot update parameters: WASM not ready.");
             return;
        }
        // Update internal state from received params object
        let needsReset = false;
        if (params.speed !== undefined && this.targetSpeed !== params.speed) {
             this.targetSpeed = Math.max(0.1, Math.min(params.speed, 10.0)); // Apply reasonable limits
             // Ratio changes don't necessarily need a full reset, just set_time_ratio
        }
        if (params.pitchSemitones !== undefined && this.targetPitchSemitones !== params.pitchSemitones) {
            this.targetPitchSemitones = params.pitchSemitones;
            // Pitch changes don't necessarily need a reset
        }
         if (params.formantScale !== undefined && this.targetFormantScale !== params.formantScale) {
            this.targetFormantScale = params.formantScale;
            // Formant changes don't necessarily need a reset
        }
        if (params.hybridThreshold !== undefined && this.hybridThreshold !== params.hybridThreshold) {
            this.hybridThreshold = params.hybridThreshold;
            // Changing threshold doesn't need reset, affects source selection logic
        }
         if (params.switchBehavior !== undefined && this.switchBehavior !== params.switchBehavior) {
             this.switchBehavior = params.switchBehavior;
             // Changing switch behavior doesn't strictly need reset, but might interact with state machine
        }
         if (params.sourceOverride !== undefined && this.sourceOverride !== params.sourceOverride) {
             this.sourceOverride = params.sourceOverride;
             needsReset = true; // Forcing source requires state reset
         }
         // InitialSlowSpeed is read-only after initialization

         if(needsReset) {
             this.resetNeeded = true;
             console.log("[Worklet] Parameter update triggered Rubberband reset requirement.");
         }
         // Actual application of these parameters happens within the process() loop.
    }


    // --- Core Audio Processing Loop ---
    /**
     * Main processing function called by the AudioWorklet system.
     * Handles hybrid source selection, switching, parameter updates,
     * Rubberband processing, and output generation.
     * @param {Array<Array<Float32Array>>} inputs - Input buffers (unused in this processor).
     * @param {Array<Array<Float32Array>>} outputs - Output buffers to fill.
     * @param {object} parameters - AudioParam data (unused in this processor).
     * @returns {boolean} True to keep the processor alive.
     */
    process(inputs, outputs, parameters) {
        // --- Preconditions & State Checks ---
        if (!this.audioLoaded || !this.wasmReady || !this.rubberbandStretcher) {
            // If not ready, output silence and wait.
            this.outputSilence(outputs);
            return true; // Keep processor alive
        }

        // Get the first output buffer array (e.g., for stereo: [leftChannelData, rightChannelData])
        const outputBuffer = outputs[0];
        // Check output buffer validity
        if (!outputBuffer || outputBuffer.length !== this.numberOfChannels || !outputBuffer[0]) {
            console.warn("[Worklet] Invalid output buffer structure in process().");
            return true; // Keep alive, but can't process
        }
        const outputBlockSize = outputBuffer[0].length; // Samples per channel in this block (e.g., 128)
        if (outputBlockSize === 0) return true; // Nothing to do if block size is zero

        // --- Handle Paused State ---
        if (!this.isPlaying) {
             // If paused but a switch was pending, complete it silently? Or just output silence?
             // For simplicity, just output silence when paused.
            this.outputSilence(outputs);
            // Keep alive even when paused
            return true;
        }

        // --- Handle Stream End ---
        // If stream ended and no more samples available from Rubberband, output silence.
        if (this.streamEnded) {
            const available = wasmModule._rubberband_available(this.rubberbandStretcher);
            if (available <= 0) {
                // Optionally output a few blocks of silence for fade-out, then stop entirely?
                // For now, just keep outputting silence.
                this.outputSilence(outputs);
                // Optional: Stop after N silent blocks to save CPU?
                // if (this.outputSilenceCounter++ > 10) return false; // Example: stop after ~10 blocks
                return true; // Keep alive
            }
            // If stream ended but samples ARE available, proceed to retrieve them below.
        }


        // --- Determine Target Source & Handle Switching ---
        try {
            // 1. Determine which source *should* be used based on current parameters
            this.targetSourceIsSlow = this.determineTargetSource();

            // 2. Detect if a source switch is needed
            const switchNeeded = this.targetSourceIsSlow !== this.actualSourceIsSlow;

            // 3. Manage Switching State Machine
            // This handles fades or mutes if a switch is needed.
            if (switchNeeded && this.switchState === 'idle') {
                this.initiateSwitch();
            }
            // Advance fade/mute state if currently switching
            if (this.switchState !== 'idle') {
                this.advanceSwitchState(outputBlockSize);
                // If muting or fading out, output silence or faded audio and return early
                if (this.switchState === 'muting' || this.switchState === 'fading-out') {
                    this.applyGainAndOutput(outputs, null, 0); // Apply gain (might be 0) to silence
                    return true;
                }
                // If fade-in just completed, switchState becomes 'idle'
            }

            // 4. Determine Actual Source and Ratio for *this* block
            const currentSourceChannels = this.actualSourceIsSlow ? this.slowChannels : this.originalChannels;
            const currentSourceNominalSpeed = this.actualSourceIsSlow ? this.initialSlowSpeed : 1.0;
            const { stretchRatio, pitchScale, formantScale } = this.calculateRubberbandParams(currentSourceNominalSpeed);


            // 5. Apply Parameter Updates to Rubberband Instance (if needed)
            // This includes resetting state after seek/source change or applying new ratios/scales.
            const paramsChanged = this.applyRubberbandUpdates(stretchRatio, pitchScale, formantScale);
            if (paramsChanged) {
                 // If params changed significantly (esp. ratio after reset), recalculate required input frames maybe?
                 // For simplicity, assume calculation below is sufficient for now.
            }


            // --- Calculate Input Requirements ---
            // Estimate how many input frames are needed from the source buffer to produce roughly outputBlockSize output frames.
            // Add some latency buffer (e.g., a few ms worth of samples). Needs careful tuning.
            const safetyMarginFactor = 1.5; // Process more input than strictly needed based on ratio
            const latencyFrames = 0; // wasmModule._rubberband_get_latency(this.rubberbandStretcher); // Can use latency for better estimate
            let inputFramesNeeded = Math.ceil((outputBlockSize * safetyMarginFactor) / Math.max(0.1, stretchRatio)) + latencyFrames; // Avoid division by zero/tiny ratio
            inputFramesNeeded = Math.max(this.blockSizeWasm / 4, inputFramesNeeded); // Need at least some input, capped maybe?
             inputFramesNeeded = Math.min(this.blockSizeWasm, inputFramesNeeded); // Limit input chunk to WASM buffer size


             // --- Calculate Read Position & Available Input ---
             // Map conceptual time (relative to original) to sample index in the *current* source buffer.
             const sourceSampleRate = this.sampleRate; // Assuming source and context rates match
             let readPosInSourceSamples = 0;
             let sourceTotalSamples = 0;

             if (this.actualSourceIsSlow) {
                 sourceTotalSamples = this.slowChannels[0].length;
                 // Time progresses slower relative to the slow buffer's samples
                 readPosInSourceSamples = Math.round((this.conceptualPlaybackTime / this.initialSlowSpeed) * sourceSampleRate);
             } else {
                 sourceTotalSamples = this.originalChannels[0].length;
                 readPosInSourceSamples = Math.round(this.conceptualPlaybackTime * sourceSampleRate);
             }
             // Clamp read position to valid range within the source buffer
             readPosInSourceSamples = Math.max(0, Math.min(readPosInSourceSamples, sourceTotalSamples));

             // Determine how many frames can actually be provided from the current position
             let actualInputProvided = Math.min(inputFramesNeeded, sourceTotalSamples - readPosInSourceSamples);
             actualInputProvided = Math.max(0, actualInputProvided); // Ensure non-negative

             // --- Handle End Of Stream Input ---
             const isLastDataBlock = (readPosInSourceSamples + actualInputProvided) >= sourceTotalSamples;
             // Only send the final=1 flag ONCE when the last block of actual data is processed.
             const sendFinalFlag = isLastDataBlock && !this.finalBlockSent;


            // --- Prepare Input & Call Rubberband Process ---
            if (actualInputProvided > 0 || sendFinalFlag) {
                // Copy input data from the selected source buffer to WASM memory buffers
                for (let i = 0; i < this.numberOfChannels; i++) {
                    const sourceData = currentSourceChannels[i];
                    // Create a view into the specific WASM buffer for this channel
                    const wasmInputBufferView = new Float32Array(wasmModule.HEAPF32.buffer, this.inputChannelBufPtrs[i], this.blockSizeWasm);

                    if (actualInputProvided > 0) {
                        const endReadPos = readPosInSourceSamples + actualInputProvided;
                        // Get subarray (view) of the source data
                        const inputSlice = sourceData.subarray(readPosInSourceSamples, endReadPos);
                        // Copy data into the WASM buffer view, respecting blockSizeWasm limit
                        const copyLength = Math.min(inputSlice.length, this.blockSizeWasm);
                        if (copyLength > 0) {
                             wasmInputBufferView.set(inputSlice.subarray(0, copyLength));
                        }
                        // Zero out remaining part of WASM buffer if input was smaller
                        if (copyLength < this.blockSizeWasm) {
                             wasmInputBufferView.fill(0.0, copyLength, this.blockSizeWasm);
                        }
                    } else {
                        // If sending only the final flag with no data, zero out the buffer
                        wasmInputBufferView.fill(0.0);
                    }
                }

                // --- Call Rubberband Process ---
                // console.log(`DEBUG: process(in=${actualInputProvided}, final=${sendFinalFlag ? 1:0}) @ time=${this.conceptualPlaybackTime.toFixed(3)}s, ratio=${stretchRatio.toFixed(3)}`);
                wasmModule._rubberband_process(
                    this.rubberbandStretcher,
                    this.inputPtrs,        // Pointer to array of input buffer pointers
                    actualInputProvided,   // Number of valid frames in the input buffers
                    sendFinalFlag ? 1 : 0  // Final block signal
                );

                if (sendFinalFlag) {
                    console.log("[Worklet] Final input block flag sent to Rubberband.");
                    this.finalBlockSent = true;
                }
            }

            // --- Retrieve Processed Output ---
            let totalRetrieved = 0;
            let available = 0;
            // Create temporary JS buffers to hold retrieved data before copying to output
            // Avoid creating these every block if possible - maybe reuse member arrays?
             const tempOutputBuffers = Array.from({length: this.numberOfChannels}, () => new Float32Array(outputBlockSize));

            do {
                available = wasmModule._rubberband_available(this.rubberbandStretcher);
                available = Math.max(0, available); // Ensure non-negative

                if (available > 0) {
                    const neededNow = outputBlockSize - totalRetrieved; // How many more frames fit in the output block
                    if (neededNow <= 0) break; // Output block is full

                    // Determine how many frames to retrieve in this iteration
                    const framesToRetrieve = Math.min(available, neededNow, this.blockSizeWasm); // Cannot retrieve more than available, needed, or WASM buffer size
                    if (framesToRetrieve <= 0) break; // Should not happen if available > 0 and neededNow > 0

                    // Call retrieve - copies data from Rubberband internal buffers to our WASM output buffers
                    const retrieved = wasmModule._rubberband_retrieve(
                        this.rubberbandStretcher,
                        this.outputPtrs,        // Pointer to array of output buffer pointers
                        framesToRetrieve
                    );

                    if (retrieved > 0) {
                        // Copy data from WASM output buffers to temporary JS buffers
                        for (let i = 0; i < this.numberOfChannels; i++) {
                            // Create a view into the WASM output buffer for this channel
                            const wasmOutputBufferView = new Float32Array(wasmModule.HEAPF32.buffer, this.outputChannelBufPtrs[i], retrieved);
                            // Calculate how many samples to copy (minimum of retrieved and remaining space in temp buffer)
                            const copyLength = Math.min(retrieved, tempOutputBuffers[i].length - totalRetrieved);
                            if (copyLength > 0) {
                                // Copy from WASM view to JS temp buffer at the correct offset
                                tempOutputBuffers[i].set(wasmOutputBufferView.subarray(0, copyLength), totalRetrieved);
                            }
                        }
                        totalRetrieved += retrieved; // Update total frames collected for this output block
                    } else if (retrieved < 0) {
                        // Handle error codes from _rubberband_retrieve if applicable
                        console.error(`[Worklet] _rubberband_retrieve error code: ${retrieved}`);
                        available = 0; // Stop trying to retrieve
                        break;
                    } else {
                        // Retrieve returned 0, means no more output available right now
                        available = 0; // Ensure loop terminates
                    }
                }
            } while (available > 0 && totalRetrieved < outputBlockSize); // Loop while output available and output block not full


            // --- Copy to Output & Update Time ---
            // Copy the collected data from temp buffers to the actual worklet output buffers.
            // Also apply fade gain if necessary.
            this.applyGainAndOutput(outputs, tempOutputBuffers, totalRetrieved);


            // --- Update Conceptual Playback Time ---
            // Time advances based on the amount of *source time* that was consumed by Rubberband.
            // This is tricky: _rubberband_process consumes input, but the *rate* depends on the stretch ratio.
            // If we provided `actualInputProvided` frames from `currentSourceChannels` which has nominal speed `currentSourceNominalSpeed`,
            // the equivalent time progressed on the *original* timeline is:
            // `(actualInputProvided / sourceSampleRate) * currentSourceNominalSpeed`
            const sourceTimeConsumedThisBlock = (actualInputProvided / sourceSampleRate) * currentSourceNominalSpeed;
            this.conceptualPlaybackTime += sourceTimeConsumedThisBlock;

            // Clamp conceptual time to duration to prevent overshoot
             this.conceptualPlaybackTime = Math.min(this.conceptualPlaybackTime, this.originalDurationSeconds);

             // Send time update back to main thread periodically
             // Throttle this to avoid flooding message channel (e.g., every ~100ms)
             // Need a simple timer mechanism here. For now, send every block:
             this.port.postMessage({type: 'time-update', currentTime: this.conceptualPlaybackTime });


            // --- Check for Stream End Condition ---
            // The stream truly ends when the final block has been sent to process() AND
            // _rubberband_available() returns 0 after the last retrieve attempt.
            if (this.finalBlockSent && available <= 0 && totalRetrieved < outputBlockSize) { // Check available *after* the retrieve loop
                if (!this.streamEnded) {
                     console.log("[Worklet] Playback stream ended (final block processed, no more available).");
                     this.streamEnded = true;
                     // Don't stop isPlaying here, let it play out any remaining buffered samples.
                     // Send status message to main thread.
                     this.postStatus('Playback ended');
                     // Main thread might reset state upon receiving this.
                }
            }

        } catch (error) {
            // Catch synchronous errors within the process loop
             console.error(`[Worklet] Processing Error: ${error.message}\n${error.stack}`);
             this.postError(`Processing Error: ${error.message}`);
             this.pausePlayback(); // Stop processing on error
             this.outputSilence(outputs); // Output silence for this block
             // Don't return false here, let it try again next block unless error is fatal
             return true;
        }

        // Keep the processor alive
        return true;
    } // --- End process() ---


    // --- Helper Methods ---

    /** Calculates the target source based on current parameters. @private */
    determineTargetSource() {
        switch (this.sourceOverride) {
            case 'original': return false;
            case 'slow': return true;
            case 'auto':
            default: return this.targetSpeed <= this.hybridThreshold;
        }
    }

     /** Calculates the parameters needed by Rubberband based on target values and current source. @private */
    calculateRubberbandParams(sourceNominalSpeed) {
         // Calculate stretch ratio needed *relative to the current source's speed*
         const stretchRatio = sourceNominalSpeed / Math.max(0.01, this.targetSpeed); // Avoid division by zero

         // Pitch scale: Convert semitones to a multiplier (2^(semitones/12))
         const pitchScale = Math.pow(2, this.targetPitchSemitones / 12.0);

         // Formant scale: Directly use the target value
         const formantScale = this.targetFormantScale;

         // Clamp ratios to reasonable limits if necessary (Rubberband might handle this internally too)
         const clampedStretch = Math.max(0.05, Math.min(stretchRatio, 20.0));
         const clampedPitch = Math.max(0.1, Math.min(pitchScale, 10.0));
         const clampedFormant = Math.max(0.1, Math.min(formantScale, 10.0));

        return { stretchRatio: clampedStretch, pitchScale: clampedPitch, formantScale: clampedFormant };
    }

    /** Applies updates (reset, ratios, scales) to the Rubberband instance if changed. @private */
    applyRubberbandUpdates(stretchRatio, pitchScale, formantScale) {
        let paramsChanged = false;
         const ratioTolerance = 1e-6; // Tolerance for float comparison

        // --- Handle Reset ---
        if (this.resetNeeded) {
            console.log(`[Worklet] Resetting Rubberband state. Applying R=${stretchRatio.toFixed(3)}, P=${pitchScale.toFixed(3)}, F=${formantScale.toFixed(3)}`);
            wasmModule._rubberband_reset(this.rubberbandStretcher);
            // Must set ratio/pitch/formant *after* reset
            wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, stretchRatio);
            wasmModule._rubberband_set_pitch_scale(this.rubberbandStretcher, pitchScale);
            wasmModule._rubberband_set_formant_scale(this.rubberbandStretcher, formantScale);
            this.lastAppliedStretchRatio = stretchRatio;
            this.lastAppliedPitchScale = pitchScale;
            this.lastAppliedFormantScale = formantScale;
            this.resetNeeded = false; // Reset flag is cleared
            this.finalBlockSent = false; // Reset final flag after reset
            this.streamEnded = false;
            this.actualSourceIsSlow = this.targetSourceIsSlow; // Sync actual source after reset
            paramsChanged = true;
            return paramsChanged; // Exit early after reset
        }

        // --- Apply Time Ratio ---
        if (Math.abs(stretchRatio - this.lastAppliedStretchRatio) > ratioTolerance) {
            wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, stretchRatio);
            this.lastAppliedStretchRatio = stretchRatio;
            paramsChanged = true;
            // console.log(`[Worklet] Updated time ratio: ${stretchRatio.toFixed(3)}`);
        }

        // --- Apply Pitch Scale ---
        if (Math.abs(pitchScale - this.lastAppliedPitchScale) > ratioTolerance) {
            wasmModule._rubberband_set_pitch_scale(this.rubberbandStretcher, pitchScale);
            this.lastAppliedPitchScale = pitchScale;
            paramsChanged = true;
             // console.log(`[Worklet] Updated pitch scale: ${pitchScale.toFixed(3)}`);
        }

         // --- Apply Formant Scale ---
        if (Math.abs(formantScale - this.lastAppliedFormantScale) > ratioTolerance) {
            wasmModule._rubberband_set_formant_scale(this.rubberbandStretcher, formantScale);
            this.lastAppliedFormantScale = formantScale;
            paramsChanged = true;
             // console.log(`[Worklet] Updated formant scale: ${formantScale.toFixed(3)}`);
        }

        return paramsChanged;
    }

    /** Initiates the source switching process based on configured behavior. @private */
    initiateSwitch() {
        console.log(`[Worklet] Initiating switch from ${this.actualSourceIsSlow ? 'Slow' : 'Original'} to ${this.targetSourceIsSlow ? 'Slow' : 'Original'} (Behavior: ${this.switchBehavior})`);
        switch (this.switchBehavior) {
            case 'mute':
                this.switchState = 'muting';
                // Mute duration could be configurable, e.g., 1 block?
                this.fadeFramesRemaining = Math.round(this.sampleRate * 0.01); // ~10ms mute
                this.fadeGain = 0.0; // Mute immediately
                break;
            case 'microfade':
                this.switchState = 'fading-out';
                this.fadeFramesTotal = this.microFadeDurationFrames;
                this.fadeFramesRemaining = this.fadeFramesTotal;
                // Fade gain will ramp down in advanceSwitchState
                break;
            case 'abrupt':
            default:
                // Reset happens immediately in the next process loop's applyRubberbandUpdates
                this.resetNeeded = true;
                 // actualSourceIsSlow will sync after reset
                this.switchState = 'idle'; // No transition state needed
                break;
        }
    }

    /** Advances the state machine for mute/fade transitions. @private */
    advanceSwitchState(blockSize) {
        if (this.fadeFramesRemaining <= 0 && this.switchState !== 'idle') {
             // Transition phase complete
             if (this.switchState === 'fading-out' || this.switchState === 'muting') {
                 console.log("[Worklet] Switch: Mute/Fade-out complete. Resetting Rubberband.");
                 this.resetNeeded = true; // Trigger reset now that fade/mute is done
                 // If fading, start fade-in. If muting, just go idle.
                 if (this.switchBehavior === 'microfade') {
                     this.switchState = 'fading-in';
                     this.fadeFramesRemaining = this.fadeFramesTotal;
                     // Fade gain ramps up from 0 in next step
                 } else { // Muting complete
                     this.switchState = 'idle';
                     this.fadeGain = 1.0; // Restore gain
                 }
             } else if (this.switchState === 'fading-in') {
                 console.log("[Worklet] Switch: Fade-in complete.");
                 this.switchState = 'idle';
                 this.fadeGain = 1.0; // Ensure gain is fully 1.0
             }
        }

        // Update gain based on current state and remaining frames
        if (this.switchState === 'fading-out') {
            this.fadeGain = Math.max(0, this.fadeFramesRemaining / this.fadeFramesTotal);
            this.fadeFramesRemaining -= blockSize;
        } else if (this.switchState === 'fading-in') {
             this.fadeGain = 1.0 - Math.max(0, this.fadeFramesRemaining / this.fadeFramesTotal);
             this.fadeFramesRemaining -= blockSize;
        } else if (this.switchState === 'muting') {
             this.fadeGain = 0.0; // Keep muted
             this.fadeFramesRemaining -= blockSize;
        } else {
             // Idle state
             this.fadeGain = 1.0;
        }
        // Clamp gain just in case
        this.fadeGain = Math.max(0.0, Math.min(1.0, this.fadeGain));
    }

     /** Applies fade gain and copies data to worklet output buffers. @private */
     applyGainAndOutput(outputs, sourceDataArrays, frameCount) {
         const outputBuffer = outputs[0];
         const outputBlockSize = outputBuffer[0].length;

         for (let i = 0; i < this.numberOfChannels; ++i) {
             const targetChannel = outputBuffer[i];
             const sourceData = sourceDataArrays ? sourceDataArrays[i] : null; // Use temp data or null for silence

             // Fill the output block
             for (let j = 0; j < outputBlockSize; ++j) {
                 // Get sample from source if available, otherwise use 0 for silence padding
                 const sample = (sourceData && j < frameCount) ? sourceData[j] : 0.0;
                 // Apply fade gain
                 targetChannel[j] = sample * this.fadeGain;
             }
         }
     }


    /** Fills the output buffers with silence. @private */
    outputSilence(outputs) {
        const outputBuffer = outputs[0];
        if (!outputBuffer) return;
        for (let i = 0; i < outputBuffer.length; i++) {
            if (outputBuffer[i]) {
                 outputBuffer[i].fill(0.0);
            }
        }
    }

    // --- Communication Helpers ---
    /** Posts a status message back to the main thread. @private */
    postStatus(message) {
        try { this.port.postMessage({ type: 'status', message }); }
        catch (e) { console.error(`[Worklet] FAILED to post status '${message}':`, e); }
    }
    /** Posts an error message back to the main thread. @private */
    postError(message) {
        console.error(`[Worklet Error] ${message}`); // Log locally as well
        try { this.port.postMessage({ type: 'error', message }); }
        catch (e) { console.error(`[Worklet] FAILED to post error '${message}':`, e); }
    }
    /** Posts an error and requests cleanup. @private */
    postErrorAndStop(message) {
        this.postError(message);
        this.cleanup(); // Trigger internal cleanup
    }

    // --- Cleanup ---
    /** Cleans up WASM memory and the Rubberband instance. @private */
    cleanupWasmResources() {
         console.log("[Worklet] Cleaning up WASM resources...");
         // Delete Rubberband instance FIRST (might use memory freed later)
         if (this.rubberbandStretcher !== 0 && wasmModule && typeof wasmModule._rubberband_delete === 'function') {
             try {
                 console.log(`[Worklet] Deleting Rubberband instance: ptr=${this.rubberbandStretcher}`);
                 wasmModule._rubberband_delete(this.rubberbandStretcher);
             } catch (e) { console.error("[Worklet] Error deleting Rubberband instance:", e); }
             finally { this.rubberbandStretcher = 0; }
         } else {
             // console.log("[Worklet] Skipping Rubberband instance deletion (instance/module/delete missing).");
         }
         // Free allocated WASM memory buffers and pointer arrays
         this.cleanupWasmMemory();
         this.wasmReady = false; // Mark WASM as no longer ready
    }
     /** Frees memory allocated in the WASM heap. @private */
     cleanupWasmMemory() {
        if (wasmModule && typeof wasmModule._free === 'function') {
             // console.log("[Worklet] Freeing WASM memory buffers...");
             this.inputChannelBufPtrs.forEach(ptr => { if (ptr) try { wasmModule._free(ptr); } catch(e){/* ignore */} });
             this.outputChannelBufPtrs.forEach(ptr => { if (ptr) try { wasmModule._free(ptr); } catch(e){/* ignore */} });
             this.inputChannelBufPtrs = [];
             this.outputChannelBufPtrs = [];
             if (this.inputPtrs) try { wasmModule._free(this.inputPtrs); } catch(e){/* ignore */}
             if (this.outputPtrs) try { wasmModule._free(this.outputPtrs); } catch(e){/* ignore */}
             this.inputPtrs = 0;
             this.outputPtrs = 0;
             // console.log("[Worklet] Freed WASM buffers/pointers.");
        } else {
            // console.warn("[Worklet] Skipping WASM memory free: Module or _free not available.");
        }
     }
    /** Full processor cleanup. @private */
    cleanup() {
        console.log("[Worklet] Cleanup requested.");
        this.isPlaying = false;
        this.audioLoaded = false;
        this.cleanupWasmResources(); // Clean up WASM instance and memory
        // Clear references to audio data
        this.originalChannels = null;
        this.slowChannels = null;
        wasmModule = null; // Clear module reference
        console.log("[Worklet] Full cleanup finished.");
        this.postStatus("Processor cleaned up");
        // No need to close port here, main thread does that after sending cleanup message
    }

} // --- End of HybridAudioProcessor class ---

// --- Register the Processor ---
try {
    registerProcessor(PROCESSOR_NAME, HybridAudioProcessor);
    console.log(`[Worklet] Processor '${PROCESSOR_NAME}' registered successfully.`);
} catch (error) {
    console.error(`[Worklet] FATAL: Failed to register processor '${PROCESSOR_NAME}':`, error);
    // Attempt to notify main thread about registration failure if possible
    // This might fail if the script parsing itself errors badly.
    try {
        // Use self.postMessage for global scope communication if 'this.port' isn't available yet
        self.postMessage?.({ type: 'error', message: `FATAL: Failed to register processor ${PROCESSOR_NAME}: ${error.message}` });
    } catch(e) { /* ignore secondary error */ }
}

// --- /vibe-player/audio/hybrid-processor.js ---
