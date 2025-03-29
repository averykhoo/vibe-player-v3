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
console.log(`[Worklet Script] Evaluating script for ${PROCESSOR_NAME}`);

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
        console.log("[Worklet Constructor] HybridAudioProcessor constructor called.");

        // --- Processor Options & Initial State ---
        // Store options passed from the main thread during node creation
        this.processorOpts = options.processorOptions || {};
        console.log("[Worklet Constructor] Received processorOptions:", JSON.stringify(this.processorOpts)); // Log received options (stringify avoids potential circular issues in console)

        this.sampleRate = this.processorOpts.sampleRate || currentTime; // currentTime is from AudioWorkletGlobalScope
        this.numberOfChannels = this.processorOpts.numberOfChannels || 0;
        this.wasmBinary = this.processorOpts.wasmBinary;           // ArrayBuffer
        this.loaderScriptText = this.processorOpts.loaderScriptText; // String

        console.log(`[Worklet Constructor] Initializing with SR=${this.sampleRate}, Ch=${this.numberOfChannels}, HasWasm=${!!this.wasmBinary}, HasLoader=${!!this.loaderScriptText}`);


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
        this.blockSizeWasm = 2048; // e.g., ~42ms @ 48kHz

        // --- Playback & Parameter State ---
        this.isPlaying = false;        // Is the processor actively generating audio?
        this.audioLoaded = false;      // Have original & slow buffers been received?
        this.originalChannels = null;  // Array<Float32Array> for original audio data
        this.slowChannels = null;      // Array<Float32Array> for pre-processed slow audio data
        this.originalDurationSeconds = 0; // Duration of the original audio
        this.conceptualPlaybackTime = 0.0; // Time relative to the *original* audio's timeline

        // --- Current Real-time Parameters (Initialized from processorOptions, updated via messages) ---
        this.targetSpeed = this.processorOpts.initialSpeed ?? 1.0;
        this.targetPitchSemitones = this.processorOpts.initialPitchSemitones ?? 0.0;
        this.targetFormantScale = this.processorOpts.initialFormantScale ?? 1.0;
        this.hybridThreshold = this.processorOpts.initialHybridThreshold ?? 0.8;
        this.initialSlowSpeed = this.processorOpts.initialSlowSpeed ?? 0.25; // Speed used to generate slowChannels
        this.sourceOverride = this.processorOpts.initialSourceOverride ?? 'auto'; // 'auto', 'original', 'slow'
        // this.switchBehavior = this.processorOpts.initialSwitchBehavior ?? 'microfade'; // 'abrupt', 'mute', 'microfade'
        this.switchBehavior = 'abrupt'; // Force abrupt, ignore processorOpts.initialSwitchBehavior
        console.warn("[Worklet DEBUG] Forcing 'abrupt' switch behavior.");
        // Ensure sampleRate is valid before calculating frames
        this.microFadeDurationFrames = (this.sampleRate > 0)
            ? Math.max(1, Math.round((this.processorOpts.microFadeDurationMs ?? 5) / 1000 * this.sampleRate))
            : 128; // Default frame count if sampleRate is invalid
        this.fadeFramesTotal = this.microFadeDurationFrames; // Cache total fade frames

        // --- Internal Processing & State Tracking ---
        this.actualSourceIsSlow = false;      // Which buffer are we *currently* reading from?
        this.targetSourceIsSlow = false;      // Which buffer *should* we be reading from based on params?
        this.lastAppliedStretchRatio = -1; // Initialize to invalid value to force first update
        this.lastAppliedPitchScale = -1;
        this.lastAppliedFormantScale = -1;
        this.resetNeeded = true;              // Force _rubberband_reset before first process block
        this.streamEnded = false;             // Has source audio been fully processed by Rubberband?
        this.finalBlockSent = false;          // Has the final flag been sent to _rubberband_process?
        this.outputSilenceCounter = 0;        // Counter for outputting silence padding after stream ends

        // --- Switching State Machine ---
        this.switchState = 'idle';      // 'idle', 'fading-out', 'muting', 'fading-in'
        this.fadeGain = 1.0;            // Current gain multiplier for fades (0.0 to 1.0)
        this.fadeFramesRemaining = 0;     // Frames left in current fade phase

        this.initializationFailed = false; // Flag to track constructor/init issues

        // --- Message Handling Setup ---
        this.port.onmessage = this.handleMessage.bind(this);
        console.log("[Worklet Constructor] Port message handler assigned.");

        // --- Initial Validation ---
        if (!this.wasmBinary || !this.loaderScriptText || !this.sampleRate || this.sampleRate <= 0 || !this.numberOfChannels || this.numberOfChannels <= 0) {
             const errorMsg = `Processor creation failed: Invalid options. SR=${this.sampleRate}, Ch=${this.numberOfChannels}, WASM=${!!this.wasmBinary}, Loader=${!!this.loaderScriptText}`;
             console.error(`[Worklet Constructor] ${errorMsg}`);
             try { this.port.postMessage({type: 'error', message: errorMsg}); } catch(e){}
             this.initializationFailed = true; // Set flag
             return;
        }

        // --- Pre-compile Loader Function ---
        console.log("[Worklet Constructor] Compiling loader script function...");
        try {
            const getLoaderFactory = new Function(`${this.loaderScriptText}; return Rubberband;`);
            RubberbandLoaderFn = getLoaderFactory(); // Store the factory function in outer scope
            if (typeof RubberbandLoaderFn !== 'function') {
                throw new Error("Loader script evaluation did not yield an async function factory named 'Rubberband'.");
            }
            console.log("[Worklet Constructor] Rubberband loader function compiled successfully.");
        } catch (e) {
            const errorMsg = `Failed to compile Rubberband loader script: ${e.message}`;
            console.error(`[Worklet Constructor] ${errorMsg}`);
            try { this.port.postMessage({type: 'error', message: errorMsg}); } catch(e2){}
            RubberbandLoaderFn = null; // Ensure it's null on failure
            this.initializationFailed = true;
        }

        console.log("[Worklet Constructor] Initialization complete. Waiting for audio data...");
    } // --- End Constructor ---

    // --- WASM Initialization ---
    /**
     * Initializes the Rubberband WASM module and instance asynchronously using the pre-compiled loader function.
     * Triggered after receiving audio data via 'load-audio' message.
     * @private
     */
    async initializeWasmAndRubberband() {
        console.log("[Worklet InitWasm] Starting initializeWasmAndRubberband...");
        if (this.wasmReady) {
            console.warn("[Worklet InitWasm] WASM already initialized, skipping.");
            return;
        }
        if (!RubberbandLoaderFn) {
             console.error("[Worklet InitWasm] Cannot initialize WASM: Loader function not available.");
             this.postErrorAndStop("Cannot initialize WASM: Loader function unavailable.");
             return;
        }
        // Check if constructor already failed
        if (this.initializationFailed) {
             console.error("[Worklet InitWasm] Skipping initialization due to earlier failure in constructor.");
             return;
        }

        console.log("[Worklet InitWasm] Initializing WASM & Rubberband instance via loader...");
        try {
            // --- Instantiate WASM using Loader Script ---
            const instantiateWasm = (imports, successCallback) => {
                 console.log("[Worklet InitWasm Hook] instantiateWasm hook called by loader.");
                 WebAssembly.instantiate(this.wasmBinary, imports)
                    .then(output => {
                        console.log("[Worklet InitWasm Hook] WASM instantiation successful via hook.");
                        successCallback(output.instance, output.module);
                    }).catch(error => {
                        console.error("[Worklet InitWasm Hook] WASM Instantiation hook failed:", error);
                        this.postError(`WASM Hook Error: ${error.message}`);
                        // Consider how to reject the outer await RubberbandLoaderFn call here.
                        // If the loader doesn't handle rejection from the hook, this might hang.
                    });
                 return {}; // Expected by Emscripten loaders
            };

            // --- Call the Loader Function ---
            console.log("[Worklet InitWasm] Calling RubberbandLoaderFn...");
            const loadedModule = await RubberbandLoaderFn({
                instantiateWasm: instantiateWasm,
                print: (...args) => console.log("[WASM Log]", ...args),
                printErr: (...args) => console.error("[WASM Err]", ...args),
                onAbort: (reason) => this.postErrorAndStop(`WASM Aborted: ${reason}`),
             });
            console.log("[Worklet InitWasm] RubberbandLoaderFn resolved.");

            // --- Verify Module and Get Exports ---
            wasmModule = loadedModule;
            if (!wasmModule || typeof wasmModule._rubberband_new !== 'function') {
                console.error("[Worklet InitWasm] Loaded module:", JSON.stringify(wasmModule)); // Log loaded object structure
                throw new Error("_rubberband_new function not found on loaded module. WASM loading failed.");
            }
            console.log("[Worklet InitWasm] WASM Module exports verified.");
            this.RBOptions = wasmModule.RubberBandOptionFlag;

            // --- Create Rubberband Instance (Real-time Flags) ---
            const rbFlags = (this.RBOptions?.ProcessRealTime ?? 0x01) | // Use ?? for safety
                          (this.RBOptions?.EngineDefault ?? 0x00) |
                          (this.RBOptions?.PitchHighQuality ?? 0x02000000) |
                          (this.RBOptions?.FormantPreserved ?? 0x01000000);
            console.log(`[Worklet InitWasm] Creating Rubberband instance (RealTime). SR=${this.sampleRate}, Ch=${this.numberOfChannels}, Flags=0x${rbFlags.toString(16)}`);
            this.rubberbandStretcher = wasmModule._rubberband_new(
                this.sampleRate, this.numberOfChannels, rbFlags, 1.0, 1.0
            );
            if (!this.rubberbandStretcher) {
                throw new Error("_rubberband_new call failed to create instance.");
            }
            console.log(`[Worklet InitWasm] Rubberband instance created: ptr=${this.rubberbandStretcher}`);

            // --- Allocate WASM Memory Buffers ---
            console.log("[Worklet InitWasm] Allocating WASM memory...");
            this._allocateWasmMemory();

            this.wasmReady = true;
            console.log("[Worklet InitWasm] WASM and Rubberband instance ready.");
            console.log("[Worklet InitWasm] Attempting to post 'processor-ready' status...");
            this.postStatus('processor-ready');
            console.log("[Worklet InitWasm] 'processor-ready' status posted.");

        } catch (error) {
             console.error(`[Worklet InitWasm] FATAL INITIALIZATION ERROR: ${error.message}\n${error.stack}`);
             this.postErrorAndStop(`Engine Init Error: ${error.message}`);
             this.wasmReady = false;
             this.cleanupWasmResources();
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
        console.log("[Worklet AllocMem] Allocating WASM memory buffers...");
        const pointerSize = 4;
        const frameSize = 4; // Float32
        const bufferSizeBytes = this.blockSizeWasm * frameSize;

        try { // Wrap allocations in try/catch for better error reporting if one fails
            this.inputPtrs = wasmModule._malloc(this.numberOfChannels * pointerSize);
            this.outputPtrs = wasmModule._malloc(this.numberOfChannels * pointerSize);
            if (!this.inputPtrs || !this.outputPtrs) throw new Error("Failed pointer array alloc.");
            console.log(`[Worklet AllocMem] Allocated pointer arrays: input=${this.inputPtrs}, output=${this.outputPtrs}`);

            this.inputChannelBufPtrs = [];
            this.outputChannelBufPtrs = [];

            for (let i = 0; i < this.numberOfChannels; ++i) {
                const inputBuf = wasmModule._malloc(bufferSizeBytes);
                const outputBuf = wasmModule._malloc(bufferSizeBytes);
                if (!inputBuf || !outputBuf) throw new Error(`Buffer alloc failed for Channel ${i}.`);

                this.inputChannelBufPtrs.push(inputBuf);
                this.outputChannelBufPtrs.push(outputBuf);

                // Set the pointers in the WASM pointer arrays
                wasmModule.HEAPU32[(this.inputPtrs / pointerSize) + i] = inputBuf;
                wasmModule.HEAPU32[(this.outputPtrs / pointerSize) + i] = outputBuf;
            }
            console.log(`[Worklet AllocMem] Allocated ${this.numberOfChannels}x input/output WASM buffers (${this.blockSizeWasm} frames each).`);
        } catch (allocError) {
             console.error("[Worklet AllocMem] Error during WASM memory allocation:", allocError);
             this.cleanupWasmMemory(); // Attempt to free any partially allocated memory
             throw allocError; // Re-throw error to be caught by initializeWasmAndRubberband
        }
    }


    // --- Message Handling ---
    /**
     * Handles messages received from the main thread via the MessagePort.
     * @param {MessageEvent} event - The message event containing command and data.
     * @private
     */
    handleMessage(event) {
        const data = event.data;
        // console.log(`[Worklet MsgHandler] Received message type: ${data.type}`); // Log message type

        if (this.initializationFailed && data.type !== 'cleanup') {
             console.warn("[Worklet MsgHandler] Ignoring message - processor initialization failed earlier.");
             return;
         }

        try {
            switch (data.type) {
                case 'load-audio':
                    console.log("[Worklet MsgHandler] Handling 'load-audio'.");
                    this.loadAudioData(data);
                    break;
                case 'play':
                    console.log("[Worklet MsgHandler] Handling 'play'.");
                    this.startPlayback();
                    break;
                case 'pause':
                    console.log("[Worklet MsgHandler] Handling 'pause'.");
                    this.pausePlayback();
                    break;
                case 'seek':
                    console.log("[Worklet MsgHandler] Handling 'seek'. Position:", data.positionSeconds);
                    this.seekPlayback(data.positionSeconds);
                    break;
                 case 'jump':
                     console.log("[Worklet MsgHandler] Handling 'jump'. Seconds:", data.seconds);
                    this.jumpPlayback(data.seconds);
                    break;
                case 'set-params':
                    // console.log("[Worklet MsgHandler] Handling 'set-params'. Params:", data.params); // Reduce log noise
                    this.updateParameters(data.params);
                    break;
                case 'cleanup':
                    console.log("[Worklet MsgHandler] Handling 'cleanup'.");
                    this.cleanup();
                    break;
                default:
                    console.warn("[Worklet MsgHandler] Received unknown message type:", data.type);
            }
        } catch (error) {
            console.error(`[Worklet MsgHandler] Error handling message type ${data.type}: ${error.message}\n${error.stack}`);
            this.postError(`Msg '${data.type}' Handler Error: ${error.message}`);
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
         console.log("[Worklet LoadAudio] Received audio data.");
         if (this.audioLoaded) {
            console.warn("[Worklet LoadAudio] Audio already loaded, overwriting and resetting state...");
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
         console.log(`[Worklet LoadAudio] Data structure valid (${this.numberOfChannels} channels).`);

         try {
             console.log("[Worklet LoadAudio] Converting ArrayBuffers to Float32Arrays...");
             this.originalChannels = data.originalChannels.map(buffer => new Float32Array(buffer));
             this.slowChannels = data.slowChannels.map(buffer => new Float32Array(buffer));
             console.log("[Worklet LoadAudio] Conversion complete.");

             // Validate buffer lengths
             if (!this.originalChannels[0] || this.originalChannels[0].length === 0) { throw new Error("Original audio channel 0 is empty."); }
             if (!this.slowChannels[0] || this.slowChannels[0].length === 0) { throw new Error("Slow audio channel 0 is empty."); }

             this.originalDurationSeconds = this.originalChannels[0].length / this.sampleRate;
             console.log(`[Worklet LoadAudio] Audio data processed. Original duration: ${this.originalDurationSeconds.toFixed(2)}s`);
             this.audioLoaded = true;
             this.resetPlaybackState();

             // --- Trigger WASM Initialization ---
             if (!this.wasmReady) {
                 console.log("[Worklet LoadAudio] WASM not ready. Calling initializeWasmAndRubberband...");
                 this.initializeWasmAndRubberband(); // Intentionally async
             } else {
                  console.log("[Worklet LoadAudio] WASM ready, ensuring Rubberband state is reset for new audio.");
                  this.resetNeeded = true;
             }
         } catch (error) {
             console.error("[Worklet LoadAudio] Error processing received audio data:", error);
             this.postErrorAndStop(`Error processing loaded audio data: ${error.message}`);
             this.audioLoaded = false; this.originalChannels = null; this.slowChannels = null;
         }
    }

    /** Resets playback-related state variables. @private */
    resetPlaybackState() {
        // console.log("[Worklet ResetState] Resetting playback state."); // Less noise
        this.conceptualPlaybackTime = 0.0;
        this.isPlaying = false;
        this.streamEnded = false;
        this.finalBlockSent = false;
        this.outputSilenceCounter = 0;
        this.resetNeeded = true;
        this.switchState = 'idle';
        this.fadeGain = 1.0;
        this.fadeFramesRemaining = 0;
        // Reset last applied values to force update after reset
        this.lastAppliedStretchRatio = -1;
        this.lastAppliedPitchScale = -1;
        this.lastAppliedFormantScale = -1;
    }

    // --- Playback Control Logic ---
    /** Starts or resumes playback. @private */
    startPlayback() {
         if (this.isPlaying) { /* console.warn("[Worklet Play] Already playing."); */ return; }
         if (!this.audioLoaded || !this.wasmReady) { this.postError("Cannot play: Audio/WASM not ready."); return; }
         console.log("[Worklet Play] Starting playback.");
         if (this.streamEnded || this.conceptualPlaybackTime >= this.originalDurationSeconds) { console.log("[Worklet Play] Resetting position from end."); this.resetPlaybackState(); }
         this.isPlaying = true;
         // if (this.resetNeeded) console.log("[Worklet Play] Reset flag is true."); // Less noise
         this.port.postMessage({type: 'playback-state', isPlaying: true});
    }

    /** Pauses playback. @private */
    pausePlayback() {
         if (!this.isPlaying) { return; }
         console.log("[Worklet Pause] Pausing playback.");
         this.isPlaying = false;
         this.port.postMessage({type: 'playback-state', isPlaying: false});
    }

    /** Seeks playback to a specific time. @private */
    seekPlayback(positionSeconds) {
        if (!this.audioLoaded || !this.wasmReady) { console.warn("[Worklet Seek] Cannot seek: Not ready."); return; }
        const targetTime = Math.max(0, Math.min(positionSeconds, this.originalDurationSeconds));
        console.log(`[Worklet Seek] Seeking to ${targetTime.toFixed(3)}s`);
        this.conceptualPlaybackTime = targetTime; this.resetNeeded = true; this.streamEnded = false; this.finalBlockSent = false; this.outputSilenceCounter = 0; this.switchState = 'idle'; this.fadeGain = 1.0;
    }

     /** Jumps playback forward or backward. @private */
     jumpPlayback(seconds) {
        if (!this.audioLoaded || !this.wasmReady) { console.warn("[Worklet Jump] Cannot jump: Not ready."); return; }
        const newPosition = this.conceptualPlaybackTime + seconds; this.seekPlayback(newPosition);
     }

    /** Updates processing parameters from main thread message. @private */
    updateParameters(params) {
         if (!this.wasmReady) { /* console.warn("[Worklet SetParams] Cannot update: WASM not ready."); */ return; }
         // console.log("[Worklet SetParams] Updating parameters:", params); // Less noise
         let needsReset = false;
         if (params.speed !== undefined && this.targetSpeed !== params.speed) { this.targetSpeed = Math.max(0.1, Math.min(params.speed, 10.0)); }
         if (params.pitchSemitones !== undefined && this.targetPitchSemitones !== params.pitchSemitones) { this.targetPitchSemitones = params.pitchSemitones; }
         if (params.formantScale !== undefined && this.targetFormantScale !== params.formantScale) { this.targetFormantScale = params.formantScale; }
         if (params.hybridThreshold !== undefined && this.hybridThreshold !== params.hybridThreshold) { this.hybridThreshold = params.hybridThreshold; }
         if (params.switchBehavior !== undefined && this.switchBehavior !== params.switchBehavior) { this.switchBehavior = params.switchBehavior; }
         if (params.sourceOverride !== undefined && this.sourceOverride !== params.sourceOverride) { this.sourceOverride = params.sourceOverride; needsReset = true; }
         if(needsReset && !this.resetNeeded) { this.resetNeeded = true; console.log("[Worklet SetParams] Parameter update triggered reset requirement."); }
    }


    // --- Core Audio Processing Loop ---
    /**
     * Main processing function called by the AudioWorklet system.
     * @param {Array<Array<Float32Array>>} inputs - Input buffers (unused).
     * @param {Array<Array<Float32Array>>} outputs - Output buffers to fill.
     * @param {object} parameters - AudioParam data (unused).
     * @returns {boolean} True to keep the processor alive.
     */
    process(inputs, outputs, parameters) {
        // --- Preconditions & State Checks ---
        if (this.initializationFailed) return false;
        if (!this.audioLoaded || !this.wasmReady || !this.rubberbandStretcher) {
            this.outputSilence(outputs); return true;
        }
        const outputBuffer = outputs[0];
        if (!outputBuffer || outputBuffer.length !== this.numberOfChannels || !outputBuffer[0]) {
            this.outputSilence(outputs); return true;
        }
        const outputBlockSize = outputBuffer[0].length;
        if (outputBlockSize === 0) return true;

        // --- Handle Paused State ---
        if (!this.isPlaying) { this.outputSilence(outputs); return true; }

        // --- Handle Stream End ---
        if (this.streamEnded) {
            const available = wasmModule._rubberband_available(this.rubberbandStretcher);
            if (available <= 0) { this.outputSilence(outputs); return true; }
        }

        // --- Processing Logic ---
        try {
            // 1. Determine Target Source
            this.targetSourceIsSlow = this.determineTargetSource();
            const switchNeeded = this.targetSourceIsSlow !== this.actualSourceIsSlow;

            // 2. Manage Switching State
            if (switchNeeded && this.switchState === 'idle') { this.initiateSwitch(); }
            if (this.switchState !== 'idle') {
                this.advanceSwitchState(outputBlockSize);
                if (this.switchState === 'muting' || this.switchState === 'fading-out') {
                    this.applyGainAndOutput(outputs, null, 0); return true;
                }
            }

            // 3. Get Current Source & Calculate Ratios
            const currentSourceChannels = this.actualSourceIsSlow ? this.slowChannels : this.originalChannels;
            // Ensure source channels are available (should be checked by audioLoaded, but belt-and-suspenders)
            if (!currentSourceChannels || !currentSourceChannels[0]) { throw new Error("Current source channel data is missing."); }
            const currentSourceNominalSpeed = this.actualSourceIsSlow ? this.initialSlowSpeed : 1.0;
            const { stretchRatio, pitchScale, formantScale } = this.calculateRubberbandParams(currentSourceNominalSpeed);

            // 4. Apply Updates to Rubberband (Reset / Ratio / Scale)
            this.applyRubberbandUpdates(stretchRatio, pitchScale, formantScale);

            // 5. Calculate Input Requirements
            let inputFramesToRead = this.blockSizeWasm; // Start by trying to fill WASM block

            // 6. Calculate Read Position & Available Input
            const sourceSampleRate = this.sampleRate;
            let readPosInSourceSamples = 0;
            let sourceTotalSamples = 0;
            if (this.actualSourceIsSlow) {
                 sourceTotalSamples = this.slowChannels[0].length;
                 readPosInSourceSamples = Math.round((this.conceptualPlaybackTime / this.initialSlowSpeed) * sourceSampleRate);
            } else {
                 sourceTotalSamples = this.originalChannels[0].length;
                 readPosInSourceSamples = Math.round(this.conceptualPlaybackTime * sourceSampleRate);
            }
            readPosInSourceSamples = Math.max(0, Math.min(readPosInSourceSamples, sourceTotalSamples));
            let actualInputProvided = Math.min(inputFramesToRead, sourceTotalSamples - readPosInSourceSamples);
            actualInputProvided = Math.max(0, actualInputProvided);

            // 7. Handle End Of Stream Input Signal
            const isLastDataBlock = (readPosInSourceSamples + actualInputProvided) >= sourceTotalSamples;
            const sendFinalFlag = isLastDataBlock && !this.finalBlockSent;

            // 8. Prepare Input & Call Rubberband Process
            if (actualInputProvided > 0 || sendFinalFlag) {
                for (let i = 0; i < this.numberOfChannels; i++) {
                     const sourceData = currentSourceChannels[i];
                     const wasmInputBufferView = new Float32Array(wasmModule.HEAPF32.buffer, this.inputChannelBufPtrs[i], this.blockSizeWasm);
                     if (actualInputProvided > 0) {
                         const endReadPos = readPosInSourceSamples + actualInputProvided;
                         const inputSlice = sourceData.subarray(readPosInSourceSamples, endReadPos);
                         const copyLength = Math.min(inputSlice.length, this.blockSizeWasm);
                         if(copyLength > 0) wasmInputBufferView.set(inputSlice.subarray(0, copyLength));
                         if(copyLength < this.blockSizeWasm) wasmInputBufferView.fill(0.0, copyLength, this.blockSizeWasm);
                     } else { wasmInputBufferView.fill(0.0); }
                }
                wasmModule._rubberband_process(this.rubberbandStretcher, this.inputPtrs, actualInputProvided, sendFinalFlag ? 1 : 0);
                if (sendFinalFlag) { console.log("[Worklet Process] Final input block flag sent."); this.finalBlockSent = true; }
            }

            // 9. Retrieve Processed Output
            let totalRetrieved = 0; let available = 0;
            const tempOutputBuffers = Array.from({length: this.numberOfChannels}, () => new Float32Array(outputBlockSize));
            do {
                 available = wasmModule._rubberband_available(this.rubberbandStretcher); available = Math.max(0, available);
                 if (available > 0) {
                     const neededNow = outputBlockSize - totalRetrieved; if (neededNow <= 0) break;
                     const framesToRetrieve = Math.min(available, neededNow, this.blockSizeWasm); if (framesToRetrieve <= 0) break;
                     const retrieved = wasmModule._rubberband_retrieve(this.rubberbandStretcher, this.outputPtrs, framesToRetrieve);
                     if (retrieved > 0) {
                         for (let i = 0; i < this.numberOfChannels; i++) {
                             const wasmOutputBufferView = new Float32Array(wasmModule.HEAPF32.buffer, this.outputChannelBufPtrs[i], retrieved);
                             const copyLength = Math.min(retrieved, tempOutputBuffers[i].length - totalRetrieved);
                             if (copyLength > 0) tempOutputBuffers[i].set(wasmOutputBufferView.subarray(0, copyLength), totalRetrieved);
                         }
                         totalRetrieved += retrieved;
                     } else if (retrieved < 0) { console.error(`Retrieve error: ${retrieved}`); available = 0; break; }
                       else { available = 0; } // retrieved 0
                 }
            } while (available > 0 && totalRetrieved < outputBlockSize);

            // 10. Copy to Output & Update Time
            this.applyGainAndOutput(outputs, tempOutputBuffers, totalRetrieved); // Applies fadeGain
            const sourceTimeConsumedThisBlock = (actualInputProvided / sourceSampleRate) * currentSourceNominalSpeed;
            this.conceptualPlaybackTime += sourceTimeConsumedThisBlock;
            this.conceptualPlaybackTime = Math.min(this.conceptualPlaybackTime, this.originalDurationSeconds);

            // 11. Send Time Update (Maybe throttle this later)
             if (this.isPlaying) { this.port.postMessage({type: 'time-update', currentTime: this.conceptualPlaybackTime }); }

            // 12. Check for Stream End Condition
             // Use `available` from *after* the retrieve loop completed
            if (this.finalBlockSent && available <= 0 && !this.streamEnded) {
                 // Check if available is really 0 after the last possible retrieve attempt
                 const finalAvailableCheck = wasmModule._rubberband_available(this.rubberbandStretcher);
                 if (finalAvailableCheck <= 0) {
                      console.log("[Worklet Process] Playback stream processing finished.");
                      this.streamEnded = true; this.postStatus('Playback ended');
                 }
            }

        } catch (error) {
             console.error(`[Worklet Process] Error: ${error.message}\n${error.stack}`);
             this.postError(`Processing Error: ${error.message}`);
             this.pausePlayback(); this.outputSilence(outputs); return true;
        }

        return true; // Keep processor alive
    } // --- End process() ---


    // --- Helper Methods ---
    /** Calculates the target source based on current parameters. @private */
    determineTargetSource() { switch (this.sourceOverride) { case 'original': return false; case 'slow': return true; default: return this.targetSpeed <= this.hybridThreshold; } }
    /** Calculates the parameters needed by Rubberband. @private */
    calculateRubberbandParams(sourceNominalSpeed) { const stretchRatio = sourceNominalSpeed / Math.max(0.01, this.targetSpeed); const pitchScale = Math.pow(2, this.targetPitchSemitones / 12.0); const formantScale = this.targetFormantScale; const clampedStretch = Math.max(0.05, Math.min(stretchRatio, 20.0)); const clampedPitch = Math.max(0.1, Math.min(pitchScale, 10.0)); const clampedFormant = Math.max(0.1, Math.min(formantScale, 10.0)); return { stretchRatio: clampedStretch, pitchScale: clampedPitch, formantScale: clampedFormant }; }
    /** Applies updates (reset, ratios, scales) to the Rubberband instance. @private */
applyRubberbandUpdates(stretchRatio, pitchScale, formantScale) {
        // stretchRatio, pitchScale, formantScale are calculated *before* this function is called,
        // based on the *current* this.actualSourceIsSlow state.

        let paramsChanged = false;
         const ratioTolerance = 1e-6;

        if (this.resetNeeded) {
            // **** PROBLEM AREA ****
            // The 'stretchRatio' passed into this function was calculated BEFORE the reset logic runs.
            // If we just switched TO the slow source, 'actualSourceIsSlow' might still be FALSE when
            // calculateRubberbandParams was called OUTSIDE this function for this process() iteration.
            // THEREFORE, the 'stretchRatio' passed in here might be based on the OLD source (1.0 / targetSpeed).
            // We need to recalculate the ratio HERE using the NEW target source's nominal speed.

            // Determine the nominal speed of the source we are *switching TO*
            const targetNominalSpeed = this.targetSourceIsSlow ? this.initialSlowSpeed : 1.0;
            // Recalculate the correct parameters based on the TARGET state
            const correctParams = this.calculateRubberbandParams(targetNominalSpeed);
            const correctStretchRatio = correctParams.stretchRatio;
            const correctPitchScale = correctParams.pitchScale;
            const correctFormantScale = correctParams.formantScale;

            // **** USE THE CORRECTED VALUES FOR LOGGING AND SETTING ****
            console.log(`[Worklet Reset] Applying R=${correctStretchRatio.toFixed(3)}, P=${correctPitchScale.toFixed(3)}, F=${correctFormantScale.toFixed(3)} (TargetSpeed=${this.targetSpeed.toFixed(3)}, SwitchingToSlow=${this.targetSourceIsSlow})`);

            wasmModule._rubberband_reset(this.rubberbandStretcher);
            // Apply the *corrected* values after reset
            wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, correctStretchRatio);
            wasmModule._rubberband_set_pitch_scale(this.rubberbandStretcher, correctPitchScale);
            wasmModule._rubberband_set_formant_scale(this.rubberbandStretcher, correctFormantScale);

            // Update last applied values with the corrected ones
            this.lastAppliedStretchRatio = correctStretchRatio;
            this.lastAppliedPitchScale = correctPitchScale;
            this.lastAppliedFormantScale = correctFormantScale;

            this.resetNeeded = false;
            this.finalBlockSent = false;
            this.streamEnded = false;
            // Sync the actual source state AFTER the reset is complete and correct ratio is applied
            this.actualSourceIsSlow = this.targetSourceIsSlow;
            paramsChanged = true; // Mark that params were applied
            return paramsChanged; // Exit early after reset
        }

        // --- Apply normal updates if NOT resetting ---
        // (The rest of the function remains the same, using the originally passed-in stretchRatio etc.)
        if (Math.abs(stretchRatio - this.lastAppliedStretchRatio) > ratioTolerance) { /* ... */ }
        if (Math.abs(pitchScale - this.lastAppliedPitchScale) > ratioTolerance) { /* ... */ }
        if (Math.abs(formantScale - this.lastAppliedFormantScale) > ratioTolerance) { /* ... */ }

        return paramsChanged;
    }
    /** Initiates the source switching process. @private */
    initiateSwitch() { console.log(`[Worklet Switch] Init: ${this.actualSourceIsSlow ? 'Slow' : 'Orig'} -> ${this.targetSourceIsSlow ? 'Slow' : 'Orig'} (${this.switchBehavior})`); switch (this.switchBehavior) { case 'mute': this.switchState = 'muting'; this.fadeFramesRemaining = Math.max(128, Math.round(this.sampleRate * 0.01)); this.fadeGain = 0.0; break; case 'microfade': this.switchState = 'fading-out'; this.fadeFramesRemaining = this.fadeFramesTotal; break; default: this.resetNeeded = true; this.switchState = 'idle'; break; } }
    /** Advances the state machine for mute/fade transitions. @private */
    advanceSwitchState(blockSize) {
         // Only advance if frames remaining > 0 OR we are starting fade-in
        if (this.fadeFramesRemaining > 0 || this.switchState === 'fading-in') {
            if (this.switchState === 'fading-out') { this.fadeGain = Math.max(0, this.fadeFramesRemaining / this.fadeFramesTotal); this.fadeFramesRemaining -= blockSize; }
            else if (this.switchState === 'fading-in') { this.fadeGain = 1.0 - Math.max(0, this.fadeFramesRemaining / this.fadeFramesTotal); this.fadeFramesRemaining -= blockSize; }
            else if (this.switchState === 'muting') { this.fadeGain = 0.0; this.fadeFramesRemaining -= blockSize; }
            else { this.fadeGain = 1.0; } // Idle
            this.fadeGain = Math.max(0.0, Math.min(1.0, this.fadeGain)); // Clamp gain
        }

        // Check for state transition completion *after* updating gain/frames
        if (this.fadeFramesRemaining <= 0 && this.switchState !== 'idle') {
             if (this.switchState === 'fading-out' || this.switchState === 'muting') {
                 console.log("[Worklet Switch] Resetting after fade/mute."); this.resetNeeded = true;
                 if (this.switchBehavior === 'microfade') { this.switchState = 'fading-in'; this.fadeFramesRemaining = this.fadeFramesTotal; this.fadeGain = 0; /* Start fade-in from 0 */}
                 else { this.switchState = 'idle'; this.fadeGain = 1.0; }
             } else if (this.switchState === 'fading-in') {
                 console.log("[Worklet Switch] Fade-in complete."); this.switchState = 'idle'; this.fadeGain = 1.0;
             }
        }
    }
    /** Applies fade gain and copies data to worklet output buffers. @private */
    applyGainAndOutput(outputs, sourceDataArrays, frameCount) {
         const outputBuffer = outputs[0]; const outputBlockSize = outputBuffer[0].length;
         for (let i = 0; i < this.numberOfChannels; ++i) {
             const targetChannel = outputBuffer[i]; const sourceData = sourceDataArrays ? sourceDataArrays[i] : null;
             for (let j = 0; j < outputBlockSize; ++j) {
                 const sample = (sourceData && j < frameCount) ? sourceData[j] : 0.0; targetChannel[j] = sample * this.fadeGain;
             }
         }
     }
    /** Fills the output buffers with silence. @private */
    outputSilence(outputs) { const outputBuffer = outputs[0]; if (!outputBuffer) return; for (let i = 0; i < outputBuffer.length; i++) { if (outputBuffer[i]) { outputBuffer[i].fill(0.0); } } }

    // --- Communication Helpers ---
    /** Posts a status message back to the main thread. @private */
    postStatus(message) { try { this.port.postMessage({ type: 'status', message }); } catch (e) { console.error(`[Worklet] FAILED to post status '${message}':`, e); } }
    /** Posts an error message back to the main thread. @private */
    postError(message) { console.error(`[Worklet Error] ${message}`); try { this.port.postMessage({ type: 'error', message }); } catch (e) { console.error(`[Worklet] FAILED to post error '${message}':`, e); } }
    /** Posts an error and requests cleanup. @private */
    postErrorAndStop(message) { this.postError(message); this.cleanup(); }

    // --- Cleanup ---
    /** Cleans up WASM memory and the Rubberband instance. @private */
    cleanupWasmResources() { console.log("[Worklet Cleanup] Cleaning up WASM resources..."); if (this.rubberbandStretcher !== 0 && wasmModule?._rubberband_delete) { try { console.log(`[Worklet Cleanup] Deleting Rubberband instance: ptr=${this.rubberbandStretcher}`); wasmModule._rubberband_delete(this.rubberbandStretcher); } catch (e) { console.error("[Worklet Cleanup] Error deleting RB instance:", e); } finally { this.rubberbandStretcher = 0; } } this.cleanupWasmMemory(); this.wasmReady = false; }
    /** Frees memory allocated in the WASM heap. @private */
    cleanupWasmMemory() { if (wasmModule?._free) { /* console.log("[Worklet Cleanup] Freeing WASM buffers..."); */ this.inputChannelBufPtrs.forEach(ptr => { if (ptr) try { wasmModule._free(ptr); } catch(e){} }); this.outputChannelBufPtrs.forEach(ptr => { if (ptr) try { wasmModule._free(ptr); } catch(e){} }); this.inputChannelBufPtrs = []; this.outputChannelBufPtrs = []; if (this.inputPtrs) try { wasmModule._free(this.inputPtrs); } catch(e){} if (this.outputPtrs) try { wasmModule._free(this.outputPtrs); } catch(e){} this.inputPtrs = 0; this.outputPtrs = 0; } }
    /** Full processor cleanup. @private */
    cleanup() { console.log("[Worklet Cleanup] Full cleanup requested."); this.isPlaying = false; this.audioLoaded = false; this.cleanupWasmResources(); this.originalChannels = null; this.slowChannels = null; wasmModule = null; RubberbandLoaderFn = null; console.log("[Worklet Cleanup] Full cleanup finished."); this.postStatus("Processor cleaned up"); }

} // --- End of HybridAudioProcessor class ---

// --- Register the Processor ---
try {
    if (typeof registerProcessor === 'function') {
         registerProcessor(PROCESSOR_NAME, HybridAudioProcessor);
         console.log(`[Worklet Script] Processor '${PROCESSOR_NAME}' registered successfully.`);
    } else {
        console.error(`[Worklet Script] FATAL: 'registerProcessor' function not found.`);
    }
} catch (error) {
    console.error(`[Worklet Script] FATAL: Failed to register processor '${PROCESSOR_NAME}':`, error);
    try { self.postMessage?.({ type: 'error', message: `FATAL: Failed to register processor ${PROCESSOR_NAME}: ${error.message}` }); } catch(e) {}
}

// --- /vibe-player/audio/hybrid-processor.js ---
