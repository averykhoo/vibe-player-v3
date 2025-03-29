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
        console.log("[Worklet Constructor] Received processorOptions:", this.processorOpts); // Log received options

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
        this.blockSizeWasm = 2048;    // Internal processing block size for WASM buffers

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
        this.initialSlowSpeed = this.processorOpts.initialSlowSpeed ?? 0.25;
        this.sourceOverride = this.processorOpts.initialSourceOverride ?? 'auto';
        this.switchBehavior = this.processorOpts.initialSwitchBehavior ?? 'microfade';
        this.microFadeDurationFrames = Math.max(1, Math.round((this.processorOpts.microFadeDurationMs ?? 5) / 1000 * this.sampleRate));
        this.fadeFramesTotal = this.microFadeDurationFrames; // Cache total fade frames

        // --- Internal Processing & State Tracking ---
        this.actualSourceIsSlow = false;
        this.targetSourceIsSlow = false;
        this.lastAppliedStretchRatio = -1;
        this.lastAppliedPitchScale = -1;
        this.lastAppliedFormantScale = -1;
        this.resetNeeded = true;
        this.streamEnded = false;
        this.finalBlockSent = false;
        this.outputSilenceCounter = 0;

        // --- Switching State Machine ---
        this.switchState = 'idle';
        this.fadeGain = 1.0;
        this.fadeFramesRemaining = 0;


        // --- Message Handling Setup ---
        this.port.onmessage = this.handleMessage.bind(this);
        console.log("[Worklet Constructor] Port message handler assigned.");

        // --- Initial Validation ---
        if (!this.wasmBinary || !this.loaderScriptText || !this.sampleRate || this.sampleRate <= 0 || !this.numberOfChannels || this.numberOfChannels <= 0) {
             const errorMsg = `Processor creation failed: Invalid options. SR=${this.sampleRate}, Ch=${this.numberOfChannels}, WASM=${!!this.wasmBinary}, Loader=${!!this.loaderScriptText}`;
             console.error(`[Worklet Constructor] ${errorMsg}`);
             // Attempt to post error back immediately, though port might not be fully ready
             try { this.port.postMessage({type: 'error', message: errorMsg}); } catch(e){}
             // Cannot proceed, but need to let the system know to keep alive potentially? Or throw?
             // Throwing here might prevent registration entirely. Let's rely on postError maybe.
             this.initializationFailed = true; // Set a flag
             return;
        }

        // --- Pre-compile Loader Function ---
        console.log("[Worklet Constructor] Compiling loader script function...");
        try {
            // Assuming the loader script defines a global variable 'Rubberband' which holds the async factory function
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
            // Hook function for the loader script to call WebAssembly.instantiate
            const instantiateWasm = (imports, successCallback) => {
                 console.log("[Worklet InitWasm Hook] instantiateWasm hook called by loader.");
                 WebAssembly.instantiate(this.wasmBinary, imports)
                    .then(output => {
                        console.log("[Worklet InitWasm Hook] WASM instantiation successful via hook.");
                        // Pass the instance and module object to the loader's callback
                        successCallback(output.instance, output.module);
                    }).catch(error => {
                        console.error("[Worklet InitWasm Hook] WASM Instantiation hook failed:", error);
                        // Post error back to main thread
                        this.postError(`WASM Hook Error: ${error.message}`);
                        // How to reject the outer promise depends on RubberbandLoaderFn's implementation.
                        // If it doesn't handle rejection, this might hang or resolve incorrectly.
                    });
                 return {}; // Expected by Emscripten loaders
            };

            // --- Call the Loader Function ---
            console.log("[Worklet InitWasm] Calling RubberbandLoaderFn...");
            const loadedModule = await RubberbandLoaderFn({
                instantiateWasm: instantiateWasm,
                // Pass other potential options if the loader uses them (print, printErr)
                print: (...args) => console.log("[WASM Log]", ...args),
                printErr: (...args) => console.error("[WASM Err]", ...args),
                onAbort: (reason) => this.postErrorAndStop(`WASM Aborted: ${reason}`),
             });
            console.log("[Worklet InitWasm] RubberbandLoaderFn resolved.");

            // --- Verify Module and Get Exports ---
            wasmModule = loadedModule; // Assign to the outer scope variable
            if (!wasmModule || typeof wasmModule._rubberband_new !== 'function') {
                console.error("[Worklet InitWasm] Loaded module:", wasmModule); // Log what was loaded
                throw new Error("_rubberband_new function not found on loaded module. WASM loading failed.");
            }
            console.log("[Worklet InitWasm] WASM Module exports verified.");
            this.RBOptions = wasmModule.RubberBandOptionFlag; // Store options enum locally

            // --- Create Rubberband Instance (Real-time Flags) ---
            const rbFlags = this.RBOptions.ProcessRealTime |
                          this.RBOptions.EngineDefault |
                          this.RBOptions.PitchHighQuality |
                          this.RBOptions.FormantPreserved;
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
            this._allocateWasmMemory(); // This function logs internally too

            this.wasmReady = true;
            console.log("[Worklet InitWasm] WASM and Rubberband instance ready.");
            console.log("[Worklet InitWasm] Attempting to post 'processor-ready' status...");
            this.postStatus('processor-ready'); // Signal readiness to main thread
            console.log("[Worklet InitWasm] 'processor-ready' status posted."); // Confirm it was called

        } catch (error) {
             // Catch errors specifically during the initialization process
             console.error(`[Worklet InitWasm] FATAL INITIALIZATION ERROR: ${error.message}\n${error.stack}`);
             this.postErrorAndStop(`Engine Init Error: ${error.message}`); // Notify main thread
             this.wasmReady = false;
             this.cleanupWasmResources(); // Attempt cleanup
        }
    }

    /**
     * Allocates persistent memory buffers in the WASM heap for audio data transfer.
     * @private
     * @throws {Error} If allocation fails.
     */
    _allocateWasmMemory() {
        // ... (Implementation remains the same - already includes logging) ...
         if (!wasmModule || typeof wasmModule._malloc !== 'function') { throw new Error("WASM module or _malloc function not available."); }
         console.log("[Worklet AllocMem] Allocating WASM memory buffers...");
         const pointerSize = 4; const frameSize = 4; const bufferSizeBytes = this.blockSizeWasm * frameSize;
         this.inputPtrs = wasmModule._malloc(this.numberOfChannels * pointerSize);
         this.outputPtrs = wasmModule._malloc(this.numberOfChannels * pointerSize);
         if (!this.inputPtrs || !this.outputPtrs) { throw new Error("Failed pointer array alloc."); }
         console.log(`[Worklet AllocMem] Allocated pointer arrays: input=${this.inputPtrs}, output=${this.outputPtrs}`);
         this.inputChannelBufPtrs = []; this.outputChannelBufPtrs = [];
         for (let i = 0; i < this.numberOfChannels; ++i) {
             const inputBuf = wasmModule._malloc(bufferSizeBytes);
             const outputBuf = wasmModule._malloc(bufferSizeBytes);
             if (!inputBuf || !outputBuf) { this.cleanupWasmMemory(); throw new Error(`Buffer alloc failed for Channel ${i}.`); }
             this.inputChannelBufPtrs.push(inputBuf); this.outputChannelBufPtrs.push(outputBuf);
             wasmModule.HEAPU32[(this.inputPtrs / pointerSize) + i] = inputBuf;
             wasmModule.HEAPU32[(this.outputPtrs / pointerSize) + i] = outputBuf;
         }
         console.log(`[Worklet AllocMem] Allocated ${this.numberOfChannels}x input/output WASM buffers (${this.blockSizeWasm} frames each).`);
    }


    // --- Message Handling ---
    /**
     * Handles messages received from the main thread via the MessagePort.
     * @param {MessageEvent} event - The message event containing command and data.
     * @private
     */
    handleMessage(event) {
        const data = event.data;
        console.log(`[Worklet MsgHandler] Received message type: ${data.type}`); // Log message type

        // If constructor failed, ignore messages except cleanup?
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
                    console.log("[Worklet MsgHandler] Handling 'set-params'. Params:", data.params);
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
            // Catch synchronous errors within message handlers
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

             // Basic validation of buffer lengths
             if (!this.originalChannels[0] || this.originalChannels[0].length === 0) { throw new Error("Original audio channel 0 is empty."); }
             if (!this.slowChannels[0] || this.slowChannels[0].length === 0) { throw new Error("Slow audio channel 0 is empty."); }

             this.originalDurationSeconds = this.originalChannels[0].length / this.sampleRate;
             console.log(`[Worklet LoadAudio] Audio data processed. Original duration: ${this.originalDurationSeconds.toFixed(2)}s`);
             this.audioLoaded = true;
             this.resetPlaybackState(); // Ensure clean state for new audio

             // --- Trigger WASM Initialization ---
             if (!this.wasmReady) {
                 console.log("[Worklet LoadAudio] WASM not ready. Calling initializeWasmAndRubberband...");
                 this.initializeWasmAndRubberband(); // Intentionally async, don't await here
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
        console.log("[Worklet ResetState] Resetting playback state.");
        this.conceptualPlaybackTime = 0.0;
        this.isPlaying = false;
        this.streamEnded = false;
        this.finalBlockSent = false;
        this.outputSilenceCounter = 0;
        this.resetNeeded = true; // Force Rubberband reset on next process
        this.switchState = 'idle';
        this.fadeGain = 1.0;
        this.fadeFramesRemaining = 0;
    }

    // --- Playback Control Logic ---
    /** Starts or resumes playback. @private */
    startPlayback() {
        // ... (Implementation remains the same - includes checks and reset logic) ...
         if (this.isPlaying) { console.warn("[Worklet Play] Already playing."); return; }
         if (!this.audioLoaded || !this.wasmReady) { this.postError("Cannot play: Audio/WASM not ready."); return; }
         console.log("[Worklet Play] Starting playback.");
         if (this.streamEnded || this.conceptualPlaybackTime >= this.originalDurationSeconds) { console.log("[Worklet Play] Resetting position from end."); this.resetPlaybackState(); }
         this.isPlaying = true;
         if (this.resetNeeded) console.log("[Worklet Play] Reset flag is true.");
         this.port.postMessage({type: 'playback-state', isPlaying: true});
    }

    /** Pauses playback. @private */
    pausePlayback() {
        // ... (Implementation remains the same) ...
         if (!this.isPlaying) { /* console.log("[Worklet Pause] Already paused."); */ return; }
         console.log("[Worklet Pause] Pausing playback.");
         this.isPlaying = false;
         this.port.postMessage({type: 'playback-state', isPlaying: false});
    }

    /** Seeks playback to a specific time. @private */
    seekPlayback(positionSeconds) {
        // ... (Implementation remains the same - clamps time, sets resetNeeded) ...
         if (!this.audioLoaded || !this.wasmReady) { console.warn("[Worklet Seek] Cannot seek: Not ready."); return; }
         const targetTime = Math.max(0, Math.min(positionSeconds, this.originalDurationSeconds));
         console.log(`[Worklet Seek] Seeking to ${targetTime.toFixed(3)}s`);
         this.conceptualPlaybackTime = targetTime; this.resetNeeded = true; this.streamEnded = false; this.finalBlockSent = false; this.outputSilenceCounter = 0; this.switchState = 'idle'; this.fadeGain = 1.0;
    }

     /** Jumps playback forward or backward. @private */
     jumpPlayback(seconds) {
        // ... (Implementation remains the same - calls seekPlayback) ...
        if (!this.audioLoaded || !this.wasmReady) { console.warn("[Worklet Jump] Cannot jump: Not ready."); return; }
        const newPosition = this.conceptualPlaybackTime + seconds; this.seekPlayback(newPosition);
     }

    /** Updates processing parameters from main thread message. @private */
    updateParameters(params) {
        // ... (Implementation remains the same - updates internal state, sets resetNeeded if required) ...
         if (!this.wasmReady) { console.warn("[Worklet SetParams] Cannot update: WASM not ready."); return; }
         console.log("[Worklet SetParams] Updating parameters:", params);
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
        if (this.initializationFailed) return false; // Stop if constructor failed
        if (!this.audioLoaded || !this.wasmReady || !this.rubberbandStretcher) {
            // console.log("[Worklet Process] Waiting - Audio/WASM not ready."); // Reduce log noise
            this.outputSilence(outputs); return true;
        }
        const outputBuffer = outputs[0];
        if (!outputBuffer || outputBuffer.length !== this.numberOfChannels || !outputBuffer[0]) {
             console.warn("[Worklet Process] Invalid output buffer structure."); this.outputSilence(outputs); return true;
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
                    this.applyGainAndOutput(outputs, null, 0); return true; // Output silence/fade and skip processing
                }
            }

            // 3. Get Current Source & Calculate Ratios
            const currentSourceChannels = this.actualSourceIsSlow ? this.slowChannels : this.originalChannels;
            const currentSourceNominalSpeed = this.actualSourceIsSlow ? this.initialSlowSpeed : 1.0;
            const { stretchRatio, pitchScale, formantScale } = this.calculateRubberbandParams(currentSourceNominalSpeed);

            // 4. Apply Updates to Rubberband (Reset / Ratio / Scale)
            this.applyRubberbandUpdates(stretchRatio, pitchScale, formantScale); // Handles resetNeeded flag

            // 5. Calculate Input Requirements
            // const safetyMarginFactor = 1.5; const latencyFrames = 0;
            // let inputFramesNeeded = Math.ceil((outputBlockSize * safetyMarginFactor) / Math.max(0.1, stretchRatio)) + latencyFrames;
            // inputFramesNeeded = Math.max(this.blockSizeWasm / 4, inputFramesNeeded);
            // inputFramesNeeded = Math.min(this.blockSizeWasm, inputFramesNeeded); // Limit to WASM buffer
             // Simplified: Just try to fill the WASM block unless near end? Or fixed small read?
             // Let's try filling blockSizeWasm generally, unless near end.
             let inputFramesToRead = this.blockSizeWasm;


            // 6. Calculate Read Position & Available Input
            const sourceSampleRate = this.sampleRate;
            let readPosInSourceSamples = 0; let sourceTotalSamples = 0;
            if (this.actualSourceIsSlow) {
                 sourceTotalSamples = this.slowChannels[0].length;
                 readPosInSourceSamples = Math.round((this.conceptualPlaybackTime / this.initialSlowSpeed) * sourceSampleRate);
            } else {
                 sourceTotalSamples = this.originalChannels[0].length;
                 readPosInSourceSamples = Math.round(this.conceptualPlaybackTime * sourceSampleRate);
            }
            readPosInSourceSamples = Math.max(0, Math.min(readPosInSourceSamples, sourceTotalSamples));
            let actualInputProvided = Math.min(inputFramesToRead, sourceTotalSamples - readPosInSourceSamples); // Limit read by available data
            actualInputProvided = Math.max(0, actualInputProvided);

            // 7. Handle End Of Stream Input Signal
            const isLastDataBlock = (readPosInSourceSamples + actualInputProvided) >= sourceTotalSamples;
            const sendFinalFlag = isLastDataBlock && !this.finalBlockSent;

            // 8. Prepare Input & Call Rubberband Process
            if (actualInputProvided > 0 || sendFinalFlag) {
                for (let i = 0; i < this.numberOfChannels; i++) { /* ... copy data to WASM input buffers ... */
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
            do { /* ... retrieve loop as before ... */
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
                     else { available = 0; }
                 }
            } while (available > 0 && totalRetrieved < outputBlockSize);

            // 10. Copy to Output & Update Time
            this.applyGainAndOutput(outputs, tempOutputBuffers, totalRetrieved); // Applies fadeGain
            const sourceTimeConsumedThisBlock = (actualInputProvided / sourceSampleRate) * currentSourceNominalSpeed;
            this.conceptualPlaybackTime += sourceTimeConsumedThisBlock;
            this.conceptualPlaybackTime = Math.min(this.conceptualPlaybackTime, this.originalDurationSeconds); // Clamp

            // 11. Send Time Update (Maybe throttle this later)
             if(this.isPlaying) { // Only send updates if playing
                 this.port.postMessage({type: 'time-update', currentTime: this.conceptualPlaybackTime });
             }

            // 12. Check for Stream End Condition
            if (this.finalBlockSent && available <= 0 && totalRetrieved < outputBlockSize) {
                if (!this.streamEnded) {
                     console.log("[Worklet Process] Playback stream processing finished.");
                     this.streamEnded = true; this.postStatus('Playback ended');
                     // Maybe automatically pause after end? Let main thread decide?
                     // this.isPlaying = false; this.port.postMessage({type:'playback-state', isPlaying: false});
                }
            }

        } catch (error) {
             console.error(`[Worklet Process] Error: ${error.message}\n${error.stack}`);
             this.postError(`Processing Error: ${error.message}`);
             this.pausePlayback(); this.outputSilence(outputs); return true; // Keep alive after error?
        }

        return true; // Keep processor alive
    } // --- End process() ---


    // --- Helper Methods ---
    /** Calculates the target source based on current parameters. @private */
    determineTargetSource() { /* ... same ... */ switch (this.sourceOverride) { case 'original': return false; case 'slow': return true; default: return this.targetSpeed <= this.hybridThreshold; } }
    /** Calculates the parameters needed by Rubberband. @private */
    calculateRubberbandParams(sourceNominalSpeed) { /* ... same ... */ const stretchRatio = sourceNominalSpeed / Math.max(0.01, this.targetSpeed); const pitchScale = Math.pow(2, this.targetPitchSemitones / 12.0); const formantScale = this.targetFormantScale; const clampedStretch = Math.max(0.05, Math.min(stretchRatio, 20.0)); const clampedPitch = Math.max(0.1, Math.min(pitchScale, 10.0)); const clampedFormant = Math.max(0.1, Math.min(formantScale, 10.0)); return { stretchRatio: clampedStretch, pitchScale: clampedPitch, formantScale: clampedFormant }; }
    /** Applies updates (reset, ratios, scales) to the Rubberband instance. @private */
    applyRubberbandUpdates(stretchRatio, pitchScale, formantScale) { /* ... same ... */ let paramsChanged = false; const ratioTolerance = 1e-6; if (this.resetNeeded) { console.log(`[Worklet Reset] Applying R=${stretchRatio.toFixed(3)}, P=${pitchScale.toFixed(3)}, F=${formantScale.toFixed(3)}`); wasmModule._rubberband_reset(this.rubberbandStretcher); wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, stretchRatio); wasmModule._rubberband_set_pitch_scale(this.rubberbandStretcher, pitchScale); wasmModule._rubberband_set_formant_scale(this.rubberbandStretcher, formantScale); this.lastAppliedStretchRatio = stretchRatio; this.lastAppliedPitchScale = pitchScale; this.lastAppliedFormantScale = formantScale; this.resetNeeded = false; this.finalBlockSent = false; this.streamEnded = false; this.actualSourceIsSlow = this.targetSourceIsSlow; paramsChanged = true; return paramsChanged; } if (Math.abs(stretchRatio - this.lastAppliedStretchRatio) > ratioTolerance) { wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, stretchRatio); this.lastAppliedStretchRatio = stretchRatio; paramsChanged = true; } if (Math.abs(pitchScale - this.lastAppliedPitchScale) > ratioTolerance) { wasmModule._rubberband_set_pitch_scale(this.rubberbandStretcher, pitchScale); this.lastAppliedPitchScale = pitchScale; paramsChanged = true; } if (Math.abs(formantScale - this.lastAppliedFormantScale) > ratioTolerance) { wasmModule._rubberband_set_formant_scale(this.rubberbandStretcher, formantScale); this.lastAppliedFormantScale = formantScale; paramsChanged = true; } return paramsChanged; }
    /** Initiates the source switching process. @private */
    initiateSwitch() { /* ... same ... */ console.log(`[Worklet Switch] Init: ${this.actualSourceIsSlow ? 'Slow' : 'Orig'} -> ${this.targetSourceIsSlow ? 'Slow' : 'Orig'} (${this.switchBehavior})`); switch (this.switchBehavior) { case 'mute': this.switchState = 'muting'; this.fadeFramesRemaining = Math.round(this.sampleRate * 0.01); this.fadeGain = 0.0; break; case 'microfade': this.switchState = 'fading-out'; this.fadeFramesRemaining = this.fadeFramesTotal; break; default: this.resetNeeded = true; this.switchState = 'idle'; break; } }
    /** Advances the state machine for mute/fade transitions. @private */
    advanceSwitchState(blockSize) { /* ... same ... */ if (this.fadeFramesRemaining <= 0 && this.switchState !== 'idle') { if (this.switchState === 'fading-out' || this.switchState === 'muting') { console.log("[Worklet Switch] Resetting after fade/mute."); this.resetNeeded = true; if (this.switchBehavior === 'microfade') { this.switchState = 'fading-in'; this.fadeFramesRemaining = this.fadeFramesTotal; } else { this.switchState = 'idle'; this.fadeGain = 1.0; } } else if (this.switchState === 'fading-in') { console.log("[Worklet Switch] Fade-in complete."); this.switchState = 'idle'; this.fadeGain = 1.0; } } if (this.switchState === 'fading-out') { this.fadeGain = Math.max(0, this.fadeFramesRemaining / this.fadeFramesTotal); this.fadeFramesRemaining -= blockSize; } else if (this.switchState === 'fading-in') { this.fadeGain = 1.0 - Math.max(0, this.fadeFramesRemaining / this.fadeFramesTotal); this.fadeFramesRemaining -= blockSize; } else if (this.switchState === 'muting') { this.fadeGain = 0.0; this.fadeFramesRemaining -= blockSize; } else { this.fadeGain = 1.0; } this.fadeGain = Math.max(0.0, Math.min(1.0, this.fadeGain)); }
    /** Applies fade gain and copies data to worklet output buffers. @private */
    applyGainAndOutput(outputs, sourceDataArrays, frameCount) { /* ... same ... */ const outputBuffer = outputs[0]; const outputBlockSize = outputBuffer[0].length; for (let i = 0; i < this.numberOfChannels; ++i) { const targetChannel = outputBuffer[i]; const sourceData = sourceDataArrays ? sourceDataArrays[i] : null; for (let j = 0; j < outputBlockSize; ++j) { const sample = (sourceData && j < frameCount) ? sourceData[j] : 0.0; targetChannel[j] = sample * this.fadeGain; } } }
    /** Fills the output buffers with silence. @private */
    outputSilence(outputs) { /* ... same ... */ const outputBuffer = outputs[0]; if (!outputBuffer) return; for (let i = 0; i < outputBuffer.length; i++) { if (outputBuffer[i]) { outputBuffer[i].fill(0.0); } } }

    // --- Communication Helpers ---
    /** Posts a status message back to the main thread. @private */
    postStatus(message) { try { this.port.postMessage({ type: 'status', message }); } catch (e) { console.error(`[Worklet] FAILED to post status '${message}':`, e); } }
    /** Posts an error message back to the main thread. @private */
    postError(message) { console.error(`[Worklet Error] ${message}`); try { this.port.postMessage({ type: 'error', message }); } catch (e) { console.error(`[Worklet] FAILED to post error '${message}':`, e); } }
    /** Posts an error and requests cleanup. @private */
    postErrorAndStop(message) { this.postError(message); this.cleanup(); }

    // --- Cleanup ---
    /** Cleans up WASM memory and the Rubberband instance. @private */
    cleanupWasmResources() { /* ... same ... */ console.log("[Worklet Cleanup] Cleaning up WASM resources..."); if (this.rubberbandStretcher !== 0 && wasmModule?._rubberband_delete) { try { console.log(`[Worklet Cleanup] Deleting Rubberband instance: ptr=${this.rubberbandStretcher}`); wasmModule._rubberband_delete(this.rubberbandStretcher); } catch (e) { console.error("[Worklet Cleanup] Error deleting Rubberband instance:", e); } finally { this.rubberbandStretcher = 0; } } this.cleanupWasmMemory(); this.wasmReady = false; }
    /** Frees memory allocated in the WASM heap. @private */
    cleanupWasmMemory() { /* ... same ... */ if (wasmModule?._free) { this.inputChannelBufPtrs.forEach(ptr => { if (ptr) try { wasmModule._free(ptr); } catch(e){} }); this.outputChannelBufPtrs.forEach(ptr => { if (ptr) try { wasmModule._free(ptr); } catch(e){} }); this.inputChannelBufPtrs = []; this.outputChannelBufPtrs = []; if (this.inputPtrs) try { wasmModule._free(this.inputPtrs); } catch(e){} if (this.outputPtrs) try { wasmModule._free(this.outputPtrs); } catch(e){} this.inputPtrs = 0; this.outputPtrs = 0; } }
    /** Full processor cleanup. @private */
    cleanup() { console.log("[Worklet Cleanup] Full cleanup requested."); this.isPlaying = false; this.audioLoaded = false; this.cleanupWasmResources(); this.originalChannels = null; this.slowChannels = null; wasmModule = null; RubberbandLoaderFn = null; console.log("[Worklet Cleanup] Full cleanup finished."); this.postStatus("Processor cleaned up"); }

} // --- End of HybridAudioProcessor class ---

// --- Register the Processor ---
try {
    // Check if already registered - might happen with hot reload?
    // This check isn't standard but can prevent errors in some dev environments.
    // if (typeof registerProcessor === 'function' && !processorRegistry.has(PROCESSOR_NAME)) {
    if (typeof registerProcessor === 'function') {
         registerProcessor(PROCESSOR_NAME, HybridAudioProcessor);
         console.log(`[Worklet Script] Processor '${PROCESSOR_NAME}' registered successfully.`);
    } else if (typeof registerProcessor !== 'function') {
        console.error(`[Worklet Script] FATAL: 'registerProcessor' function not found.`);
    }
    // } else {
    //     console.warn(`[Worklet Script] Processor '${PROCESSOR_NAME}' already registered? Skipping.`);
    // }
} catch (error) {
    console.error(`[Worklet Script] FATAL: Failed to register processor '${PROCESSOR_NAME}':`, error);
    // Attempt to notify main thread about registration failure
    try { self.postMessage?.({ type: 'error', message: `FATAL: Failed to register processor ${PROCESSOR_NAME}: ${error.message}` }); } catch(e) {}
}

// --- /vibe-player/audio/hybrid-processor.js ---
