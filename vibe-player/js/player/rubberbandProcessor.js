// --- /vibe-player/js/player/rubberbandProcessor.js --- // Updated Path
// AudioWorkletProcessor for real-time time-stretching using Rubberband WASM.

// Constants cannot be accessed here directly, but name is needed for registration.
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
     * @param {object} options.processorOptions - Custom options containing sampleRate, numberOfChannels, wasmBinary, loaderScriptText.
     */
    constructor(options) {
        super();
        console.log("[Worklet] RubberbandProcessor created.");

        // --- State Initialization ---
        this.processorOpts = options.processorOptions || {};
        // Audio properties (passed in options)
        this.sampleRate = this.processorOpts.sampleRate || sampleRate; // Fallback to global scope 'sampleRate' if needed
        this.numberOfChannels = this.processorOpts.numberOfChannels || 0;
        // WASM resources (passed via options)
        this.wasmBinary = this.processorOpts.wasmBinary;
        this.loaderScriptText = this.processorOpts.loaderScriptText;
        // WASM/Rubberband state
        /** @type {object|null} WASM module exports. */ this.wasmModule = null;
        /** @type {boolean} */ this.wasmReady = false;
        /** @type {number} Pointer to the RubberbandStretcher instance in WASM memory. */ this.rubberbandStretcher = 0;
        // Playback control state
        /** @type {boolean} */ this.isPlaying = false;
        /** @type {number} */ this.currentTargetSpeed = 1.0;
        /** @type {number} */ this.currentTargetPitchScale = 1.0;
        /** @type {number} */ this.currentTargetFormantScale = 1.0;
        /** @type {number} */ this.lastAppliedStretchRatio = 1.0; // Speed = 1 / Ratio
        /** @type {number} */ this.lastAppliedPitchScale = 1.0;
        /** @type {number} */ this.lastAppliedFormantScale = 1.0;
        // Processing state
        /** @type {boolean} */ this.resetNeeded = true; // Force reset initially and after seek
        /** @type {boolean} */ this.streamEnded = false; // True when source audio fully processed AND buffer empty
        /** @type {boolean} */ this.finalBlockSent = false; // True once the last block flag sent to rubberband_process
        /** @type {number} Current playback position in SOURCE audio (seconds). */ this.playbackPositionInSeconds = 0.0;
        // WASM Memory Management
        /** @type {number} Pointer to array of input channel buffer pointers in WASM mem. */ this.inputPtrs = 0;
        /** @type {number} Pointer to array of output channel buffer pointers in WASM mem. */ this.outputPtrs = 0;
        /** @type {number[]} JS array holding pointers to input channel buffers in WASM mem. */ this.inputChannelBuffers = [];
        /** @type {number[]} JS array holding pointers to output channel buffers in WASM mem. */ this.outputChannelBuffers = [];
        /** @type {number} Size of blocks used for WASM buffer allocation/processing. */ this.blockSizeWasm = 1024; // Fixed block size for WASM buffers
        // Source Audio Data
        /** @type {Float32Array[]|null} Holds original audio data per channel. */ this.originalChannels = null;
        /** @type {boolean} */ this.audioLoaded = false;
        /** @type {number} */ this.sourceDurationSeconds = 0;

        // --- Message Port Setup ---
        if (this.port) {
            this.port.onmessage = this.handleMessage.bind(this);
        } else {
            console.error("[Worklet] CONSTRUCTOR: Message port is not available!");
        }

        // --- Initial Validation ---
        if (!this.wasmBinary) this.postErrorAndStop("WASM binary missing.");
        if (!this.loaderScriptText) this.postErrorAndStop("Loader script text missing.");
        if (!this.sampleRate || this.sampleRate <= 0) this.postErrorAndStop(`Invalid SampleRate: ${this.sampleRate}`);
        if (!this.numberOfChannels || this.numberOfChannels <= 0) this.postErrorAndStop(`Invalid NumberOfChannels: ${this.numberOfChannels}`);

        console.log("[Worklet] Initialized. Waiting for audio data.");
    }

    /**
     * Initializes the WASM module (compiling + instantiating) and creates the Rubberband instance in WASM memory.
     * Uses a custom loader script evaluated via Function constructor and an instantiateWasm hook.
     * Allocates necessary memory buffers within the WASM heap.
     * Posts 'processor-ready' status on success or 'error' on failure.
     * @private
     * @returns {Promise<void>} Resolves when initialization is complete, rejects on fatal error.
     */
    async initializeWasmAndRubberband() {
        // Prevent re-initialization
        if (this.wasmReady) { return; }
        if (!this.wasmBinary || !this.loaderScriptText) {
            this.postErrorAndStop("Cannot initialize WASM: Resources missing.");
            return;
        }

        try {
            this.postStatus("Initializing WASM & Rubberband...");
            console.log("[Worklet] Initializing WASM & Rubberband instance...");

            // Define instantiateWasm hook (required by the custom loader)
            // This function is called by the loader script to perform the actual WASM instantiation.
            const instantiateWasm = (imports, successCallback) => {
                console.log("[Worklet] instantiateWasm hook called by loader.");
                WebAssembly.instantiate(this.wasmBinary, imports)
                    .then(output => {
                        console.log("[Worklet] WASM instantiate successful.");
                        // Pass the instance and module back to the loader script via its callback
                        successCallback(output.instance, output.module);
                    })
                    .catch(error => {
                        console.error("[Worklet] WASM instantiate hook failed:", error);
                        this.postError(`WASM Hook Error: ${error.message}`);
                        // Allow the loader's promise to reject
                    });
                return {}; // Emscripten convention: return empty exports synchronously
            };

            // Evaluate the custom loader script text to get the module factory function
            let loaderFunc;
            try {
                const getLoaderFactory = new Function('moduleArg', `${this.loaderScriptText}; return Rubberband;`);
                loaderFunc = getLoaderFactory(); // This should be the async loader function
                if (typeof loaderFunc !== 'function') throw new Error(`Loader script did not return an async function.`);
            } catch (loaderError) { throw new Error(`Loader script eval error: ${loaderError.message}`); }

            // Call the async loader function, passing the instantiateWasm hook
            const loadedModule = await loaderFunc({ instantiateWasm: instantiateWasm });
            this.wasmModule = loadedModule; // Store the resolved module object containing WASM exports

            // Verify essential WASM exports exist
            if (!this.wasmModule || typeof this.wasmModule._rubberband_new !== 'function' || typeof this.wasmModule._malloc !== 'function' || !this.wasmModule.HEAPU32) {
                 throw new Error(`WASM Module loaded, but essential exports (_rubberband_new, _malloc, HEAPU32) not found.`);
            }
            console.log("[Worklet] WASM module loaded and exports assigned.");

            // --- Create Rubberband Instance ---
            const RBOptions = this.wasmModule.RubberBandOptionFlag || {}; // Use flags from WASM module if available
            const ProcessRealTime = RBOptions.ProcessRealTime ?? 0x00000001;
            const PitchHighQuality = RBOptions.PitchHighQuality ?? 0x02000000;
            const PhaseIndependent = RBOptions.PhaseIndependent ?? 0x00002000; // Good for voice
            const TransientsCrisp = RBOptions.TransientsCrisp ?? 0x00000000;   // Good default
            // const EngineFiner = RBOptions.EngineFiner ?? 0x20000000; // Not used currently due to performance
            const options = ProcessRealTime | PitchHighQuality | PhaseIndependent | TransientsCrisp;
            console.log(`[Worklet] Creating Rubberband instance with options: ${options.toString(16)} (SR: ${this.sampleRate}, Ch: ${this.numberOfChannels})`);

            this.rubberbandStretcher = this.wasmModule._rubberband_new(this.sampleRate, this.numberOfChannels, options, 1.0, 1.0);
            if (!this.rubberbandStretcher) throw new Error("_rubberband_new failed (returned 0).");
            console.log(`[Worklet] Rubberband instance created: ptr=${this.rubberbandStretcher}`);

            // --- Allocate WASM Memory Buffers ---
            const pointerSize = 4; // Assuming 32-bit pointers
            const frameSize = 4; // sizeof(float)
            this.blockSizeWasm = 1024; // Define fixed block size for internal buffers

            // Allocate memory for arrays holding channel pointers
            this.inputPtrs = this.wasmModule._malloc(this.numberOfChannels * pointerSize);
            this.outputPtrs = this.wasmModule._malloc(this.numberOfChannels * pointerSize);
            if (!this.inputPtrs || !this.outputPtrs) throw new Error("Pointer array _malloc failed.");

            this.inputChannelBuffers = []; this.outputChannelBuffers = [];
            // Allocate memory for each channel's buffer
            for (let i = 0; i < this.numberOfChannels; ++i) {
                const bufferSizeBytes = this.blockSizeWasm * frameSize;
                const inputBuf = this.wasmModule._malloc(bufferSizeBytes);
                const outputBuf = this.wasmModule._malloc(bufferSizeBytes);
                if (!inputBuf || !outputBuf) { this.cleanupWasmMemory(); throw new Error(`Buffer _malloc failed for Channel ${i}.`); }
                this.inputChannelBuffers.push(inputBuf);
                this.outputChannelBuffers.push(outputBuf);
                // Store buffer pointers in the pointer arrays in WASM memory
                this.wasmModule.HEAPU32[(this.inputPtrs / pointerSize) + i] = inputBuf;
                this.wasmModule.HEAPU32[(this.outputPtrs / pointerSize) + i] = outputBuf;
            }
             console.log("[Worklet] Input/Output buffers allocated in WASM memory.");

            this.wasmReady = true;
            console.log("[Worklet] WASM and Rubberband ready.");
            this.postStatus('processor-ready'); // Notify main thread

        } catch (error) {
            console.error(`[Worklet] WASM/Rubberband Init Error: ${error.message}\n${error.stack}`);
            this.postError(`Init Error: ${error.message}`);
            this.wasmReady = false; this.rubberbandStretcher = 0;
            this.cleanupWasmMemory(); // Attempt cleanup
        }
    }

    /**
     * Handles messages received from the main thread (AudioEngine).
     * @param {MessageEvent} event - The event object containing message data.
     * @param {object} event.data - The message data.
     * @param {string} event.data.type - The message type (e.g., 'load-audio', 'play', 'pause', 'seek', 'set-speed', 'set-pitch', 'cleanup').
     */
    handleMessage(event) {
        const data = event.data;
        // console.log("[Worklet] Received message:", data.type, data); // Debugging

        try {
            switch (data.type) {
                case 'load-audio':
                    // Reset state for new audio
                    this.playbackPositionInSeconds = 0; this.resetNeeded = true;
                    this.streamEnded = false; this.finalBlockSent = false;
                    this.currentTargetSpeed = 1.0; this.lastAppliedStretchRatio = 1.0;
                    this.currentTargetPitchScale = 1.0; this.lastAppliedPitchScale = 1.0;
                    this.currentTargetFormantScale = 1.0; this.lastAppliedFormantScale = 1.0;
                    this.audioLoaded = false; this.originalChannels = null; this.sourceDurationSeconds = 0;

                    if (data.channelData && Array.isArray(data.channelData) && data.channelData.length === this.numberOfChannels) {
                        // Convert ArrayBuffers back to Float32Arrays
                        this.originalChannels = data.channelData.map(buffer => new Float32Array(buffer));
                        this.audioLoaded = true;
                        this.sourceDurationSeconds = (this.originalChannels[0]?.length || 0) / this.sampleRate;
                        console.log(`[Worklet] Audio loaded. Duration: ${this.sourceDurationSeconds.toFixed(3)}s`);
                        // Initialize WASM now if first time or after cleanup
                        if (!this.wasmReady) { this.initializeWasmAndRubberband(); }
                        else { this.postStatus('processor-ready'); } // Confirm readiness if already init'd
                    } else { this.postError('Invalid audio data received.'); }
                    break;

                case 'play':
                    if (this.wasmReady && this.audioLoaded) {
                        if (!this.isPlaying) {
                             // If ended or at end, reset position to start
                            if (this.streamEnded || this.playbackPositionInSeconds >= this.sourceDurationSeconds) {
                                this.playbackPositionInSeconds = 0; this.resetNeeded = true;
                                this.streamEnded = false; this.finalBlockSent = false;
                            }
                            this.isPlaying = true; console.log("[Worklet] Play command.");
                            this.port?.postMessage({ type: 'playback-state', isPlaying: true });
                        }
                    } else { this.postError(`Cannot play: ${!this.wasmReady ? 'WASM not ready' : 'Audio not loaded'}.`); this.port?.postMessage({ type: 'playback-state', isPlaying: false }); }
                    break;

                case 'pause':
                    if (this.isPlaying) {
                        this.isPlaying = false; console.log("[Worklet] Pause command.");
                        this.port?.postMessage({ type: 'playback-state', isPlaying: false });
                    }
                    break;

                case 'set-speed':
                     if (this.wasmReady) {
                         const newSpeed = Math.max(0.01, data.value || 1.0);
                         if (this.currentTargetSpeed !== newSpeed) { this.currentTargetSpeed = newSpeed; }
                     } break;
                 case 'set-pitch':
                     if (this.wasmReady) {
                         const newPitch = Math.max(0.1, data.value || 1.0);
                         if (this.currentTargetPitchScale !== newPitch) { this.currentTargetPitchScale = newPitch; }
                     } break;
                 case 'set-formant': // Keep even if non-functional, matches interface
                    if (this.wasmReady) {
                        const newFormant = Math.max(0.1, data.value || 1.0);
                        if (this.currentTargetFormantScale !== newFormant) { this.currentTargetFormantScale = newFormant; }
                    } break;

                case 'seek':
                    if (this.wasmReady && this.audioLoaded) {
                        const seekPosition = Math.max(0, Math.min(data.positionSeconds || 0, this.sourceDurationSeconds));
                        this.playbackPositionInSeconds = seekPosition;
                        this.resetNeeded = true; // Force reset after seek
                        this.streamEnded = false; this.finalBlockSent = false;
                        console.log(`[Worklet] Seek command. Position: ${this.playbackPositionInSeconds.toFixed(3)}s`);
                        // Optionally send immediate time update:
                        // this.port?.postMessage({type: 'time-update', currentTime: this.playbackPositionInSeconds });
                    } break;

                case 'cleanup':
                    this.cleanup(); break;
                default:
                    console.warn("[Worklet] Received unknown message type:", data.type);
            }
        } catch (error) {
             this.postError(`Error handling message '${data.type}': ${error.message}`);
             console.error(`[Worklet] Error handling message type '${data.type}': ${error.stack}`);
             this.isPlaying = false; this.port?.postMessage({ type: 'playback-state', isPlaying: false });
        }
    }

    /**
     * Core audio processing method called by the AudioWorklet system.
     * Pulls source audio data, processes it through Rubberband WASM if playing,
     * retrieves stretched/shifted audio, and fills the output buffers.
     * Handles parameter updates (speed, pitch), state resets, and end-of-stream logic.
     * Sends 'time-update' and 'playback-state' messages to the main thread.
     * @param {Float32Array[][]} inputs - Input audio data (unused).
     * @param {Float32Array[][]} outputs - Output buffers to fill (typically [1][numChannels][128]).
     * @param {Record<string, Float32Array>} parameters - Audio parameters (unused).
     * @returns {boolean} - Return true to keep the processor alive, false to terminate.
     */
    process(inputs, outputs, parameters) {
        // --- Essential Checks ---
        if (!this.wasmReady || !this.audioLoaded || !this.rubberbandStretcher || !this.wasmModule) { this.outputSilence(outputs); return true; } // Not ready
        if (!this.isPlaying) { this.outputSilence(outputs); return true; } // Paused

        const outputBuffer = outputs[0];
        if (!outputBuffer || outputBuffer.length !== this.numberOfChannels || !outputBuffer[0]) { this.outputSilence(outputs); return true; } // Invalid output structure
        const outputBlockSize = outputBuffer[0].length; // Frames to generate (e.g., 128)
        if (outputBlockSize === 0) return true; // Nothing to do

        // --- End-of-Stream Check (Before Processing) ---
        // If stream ended previously AND no more samples buffered in Rubberband, output silence and stop.
        if (this.streamEnded) {
             let available = this.wasmModule._rubberband_available?.(this.rubberbandStretcher) ?? 0;
             if (Math.max(0, available) <= 0) {
                 this.outputSilence(outputs);
                 // Maybe post 'playback-state' false again? Handled by end-of-stream logic later.
                 return true; // Keep processor alive, but outputting silence.
             }
        }

        try {
            // --- Apply Parameter Changes ---
            const sourceChannels = this.originalChannels;
            const targetStretchRatio = 1.0 / Math.max(0.01, this.currentTargetSpeed); // Inverse of speed
            const safeStretchRatio = Math.max(0.05, Math.min(20.0, targetStretchRatio)); // Clamp ratio
            const safeTargetPitch = Math.max(0.1, this.currentTargetPitchScale);
            const safeTargetFormant = Math.max(0.1, this.currentTargetFormantScale);
            const ratioChanged = Math.abs(safeStretchRatio - this.lastAppliedStretchRatio) > 1e-6;
            const pitchChanged = Math.abs(safeTargetPitch - this.lastAppliedPitchScale) > 1e-6;
            const formantChanged = Math.abs(safeTargetFormant - this.lastAppliedFormantScale) > 1e-6; // Check even if non-functional

            // Reset Rubberband state if needed (seek) or apply parameter changes
            if (this.resetNeeded) {
                this.wasmModule._rubberband_reset(this.rubberbandStretcher);
                this.wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, safeStretchRatio);
                this.wasmModule._rubberband_set_pitch_scale(this.rubberbandStretcher, safeTargetPitch);
                this.wasmModule._rubberband_set_formant_scale(this.rubberbandStretcher, safeTargetFormant); // Apply formant
                this.lastAppliedStretchRatio = safeStretchRatio; this.lastAppliedPitchScale = safeTargetPitch; this.lastAppliedFormantScale = safeTargetFormant;
                this.resetNeeded = false; this.finalBlockSent = false; this.streamEnded = false;
                console.log(`[Worklet] Rubberband Reset. Applied R:${safeStretchRatio.toFixed(3)}, P:${safeTargetPitch.toFixed(3)}, F:${safeTargetFormant.toFixed(3)}`);
            } else { // Apply incremental changes if no reset
                if (ratioChanged) { this.wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, safeStretchRatio); this.lastAppliedStretchRatio = safeStretchRatio; }
                if (pitchChanged) { this.wasmModule._rubberband_set_pitch_scale(this.rubberbandStretcher, safeTargetPitch); this.lastAppliedPitchScale = safeTargetPitch; }
                 if (formantChanged) { this.wasmModule._rubberband_set_formant_scale(this.rubberbandStretcher, safeTargetFormant); this.lastAppliedFormantScale = safeTargetFormant; }
            }

            // --- Feed Input Data to Rubberband ---
            // Calculate how many source frames are needed based on output size and stretch ratio
            let inputFramesNeeded = Math.ceil(outputBlockSize / safeStretchRatio) + 4; // Add buffer recommended by Rubberband docs
            inputFramesNeeded = Math.max(1, inputFramesNeeded);

            // Calculate current read position and available samples from source
            let readPosInSourceSamples = Math.max(0, Math.min(Math.round(this.playbackPositionInSeconds * this.sampleRate), sourceChannels[0].length));
            let actualInputProvided = Math.max(0, Math.min(inputFramesNeeded, sourceChannels[0].length - readPosInSourceSamples));
            const isFinalDataBlock = (readPosInSourceSamples + actualInputProvided) >= sourceChannels[0].length;
            const sendFinalFlag = isFinalDataBlock && !this.finalBlockSent; // Only send 'final' flag once

            if (actualInputProvided > 0 || sendFinalFlag) {
                // Copy input chunk to WASM buffers
                for (let i = 0; i < this.numberOfChannels; i++) {
                    const wasmInputBufferView = new Float32Array(this.wasmModule.HEAPF32.buffer, this.inputChannelBuffers[i], this.blockSizeWasm);
                    if (actualInputProvided > 0) {
                        const inputSlice = sourceChannels[i].subarray(readPosInSourceSamples, readPosInSourceSamples + actualInputProvided);
                        const copyLength = Math.min(inputSlice.length, this.blockSizeWasm);
                        if (copyLength > 0) wasmInputBufferView.set(inputSlice.subarray(0, copyLength));
                        if (copyLength < this.blockSizeWasm) wasmInputBufferView.fill(0.0, copyLength); // Zero pad rest
                    } else { wasmInputBufferView.fill(0.0); } // Zero buffer if only sending final flag
                }

                // Process the chunk
                this.wasmModule._rubberband_process(this.rubberbandStretcher, this.inputPtrs, actualInputProvided, sendFinalFlag ? 1 : 0);

                // Update source playback position
                this.playbackPositionInSeconds += (actualInputProvided / this.sampleRate);
                this.playbackPositionInSeconds = Math.min(this.playbackPositionInSeconds, this.sourceDurationSeconds); // Clamp

                 // --- Latency Correction & Time Update ---
                let correctedTime = this.playbackPositionInSeconds;
                try {
                    if (this.wasmModule._rubberband_get_latency) {
                        const latencySamples = this.wasmModule._rubberband_get_latency(this.rubberbandStretcher);
                        if (typeof latencySamples === 'number' && latencySamples >= 0 && this.sampleRate > 0) {
                            const totalLatencySeconds = (latencySamples / this.sampleRate) + (outputBlockSize / this.sampleRate);
                            correctedTime = Math.max(0, this.playbackPositionInSeconds - totalLatencySeconds);
                        }
                    }
                } catch(latencyError) { console.warn("[Worklet] Error getting latency:", latencyError); }
                // Send time update frequently (main thread uses rAF for UI updates)
                this.port?.postMessage({type: 'time-update', currentTime: correctedTime });

                if (sendFinalFlag) this.finalBlockSent = true; // Mark final flag sent
            }

            // --- Retrieve Processed Output from Rubberband ---
            let totalRetrieved = 0; let available = 0;
            const tempOutputBuffers = Array.from({ length: this.numberOfChannels }, () => new Float32Array(outputBlockSize)); // Temp JS buffers

            // Loop until output buffer is full or Rubberband has no more samples
            do {
                 available = this.wasmModule._rubberband_available?.(this.rubberbandStretcher) ?? 0;
                 available = Math.max(0, available);
                 if (available <= 0) break;

                const neededNow = outputBlockSize - totalRetrieved; if (neededNow <= 0) break;
                const framesToRetrieve = Math.min(available, neededNow, this.blockSizeWasm); // Limit retrieval to WASM block size
                if (framesToRetrieve <= 0) break;

                const retrieved = this.wasmModule._rubberband_retrieve?.(this.rubberbandStretcher, this.outputPtrs, framesToRetrieve) ?? -1;

                if (retrieved > 0) {
                    // Copy from WASM buffers to temporary JS buffers
                    for (let i = 0; i < this.numberOfChannels; i++) {
                        const wasmOutputBufferView = new Float32Array(this.wasmModule.HEAPF32.buffer, this.outputChannelBuffers[i], retrieved);
                        const copyLength = Math.min(retrieved, tempOutputBuffers[i].length - totalRetrieved);
                        if (copyLength > 0) tempOutputBuffers[i].set(wasmOutputBufferView.subarray(0, copyLength), totalRetrieved);
                    }
                    totalRetrieved += retrieved;
                } else { available = 0; break; } // Error or no data retrieved, stop loop
            } while (totalRetrieved < outputBlockSize);

            // --- Copy to Final Output Buffers ---
            for (let i = 0; i < this.numberOfChannels; ++i) {
                 if (outputBuffer[i]) {
                     const copyLength = Math.min(totalRetrieved, outputBlockSize);
                     if (copyLength > 0) outputBuffer[i].set(tempOutputBuffers[i].subarray(0, copyLength));
                     if (copyLength < outputBlockSize) outputBuffer[i].fill(0.0, copyLength); // Zero pad end
                 }
            }

            // --- Check for Actual Stream End ---
            // If final block was sent, Rubberband has no more buffered samples, AND we couldn't fill the output buffer this time
            if (this.finalBlockSent && available <= 0 && totalRetrieved < outputBlockSize) {
                if (!this.streamEnded) {
                    console.log("[Worklet] Playback stream processing ended.");
                    this.streamEnded = true; this.isPlaying = false;
                    this.postStatus('Playback ended');
                    this.port?.postMessage({ type: 'playback-state', isPlaying: false });
                    // Don't reset position here.
                }
            }

        } catch (error) {
            console.error(`[Worklet] Processing Error: ${error.message}\n${error.stack}`);
            this.postError(`Processing Error: ${error.message}`);
            this.isPlaying = false; this.streamEnded = true;
            this.outputSilence(outputs);
            this.port?.postMessage({ type: 'playback-state', isPlaying: false });
            // Keep processor alive? Yes, for now. User might try playing again.
        }

        return true; // Keep processor alive
    } // --- End process() ---

    /**
     * Fills the output buffers with silence (zeros).
     * @private
     * @param {Float32Array[][]} outputs - The output buffers array from the process method.
     */
    outputSilence(outputs) {
        if (!outputs?.[0]?.[0]) return;
        for (let channel = 0; channel < outputs[0].length; ++channel) {
            outputs[0][channel]?.fill(0.0);
        }
    }

    /**
     * Posts a status message back to the main thread (AudioEngine).
     * @private
     * @param {string} message - The status message string.
     */
    postStatus(message) {
        try { this.port?.postMessage({ type: 'status', message }); }
        catch (e) { console.error(`[Worklet] FAILED to post status '${message}':`, e); }
    }

    /**
     * Posts an error message back to the main thread (AudioEngine).
     * @private
     * @param {string} message - The error message string.
     */
    postError(message) {
         try { this.port?.postMessage({ type: 'error', message }); }
         catch (e) { console.error(`[Worklet] FAILED to post error '${message}':`, e); }
    }

    /**
     * Posts an error message and attempts to trigger cleanup.
     * @private
     * @param {string} message - The error message string.
     */
    postErrorAndStop(message) {
        this.postError(message);
        this.cleanup(); // Request cleanup
    }

    /**
     * Frees WASM memory allocated for channel buffers and pointer arrays.
     * Safe to call even if memory wasn't fully allocated or module is gone.
     * @private
     */
    cleanupWasmMemory() {
        if (this.wasmModule?._free) {
            try {
                this.inputChannelBuffers.forEach(ptr => { if (ptr) this.wasmModule._free(ptr); });
                this.outputChannelBuffers.forEach(ptr => { if (ptr) this.wasmModule._free(ptr); });
                if (this.inputPtrs) this.wasmModule._free(this.inputPtrs);
                if (this.outputPtrs) this.wasmModule._free(this.outputPtrs);
            } catch (e) { console.error("[Worklet] Error during WASM memory cleanup:", e); }
        }
        // Reset pointers regardless
        this.inputPtrs = 0; this.outputPtrs = 0;
        this.inputChannelBuffers = []; this.outputChannelBuffers = [];
    }

    /**
     * Cleans up all resources: deletes Rubberband instance, frees WASM memory, resets state.
     * Called on 'cleanup' message or fatal error.
     * @private
     */
    cleanup() {
        console.log("[Worklet] Cleanup requested.");
        this.isPlaying = false;

        // Delete Rubberband instance via WASM function
        if (this.wasmReady && this.rubberbandStretcher !== 0 && this.wasmModule?._rubberband_delete) {
            try { this.wasmModule._rubberband_delete(this.rubberbandStretcher); }
            catch (e) { console.error("[Worklet] Error deleting Rubberband instance:", e); }
        }
        this.rubberbandStretcher = 0; // Mark as deleted

        this.cleanupWasmMemory(); // Free allocated buffers

        // Reset state
        this.wasmReady = false; this.audioLoaded = false;
        this.originalChannels = null; this.wasmModule = null;
        this.wasmBinary = null; this.loaderScriptText = null;
        this.playbackPositionInSeconds = 0; this.streamEnded = true;
        this.finalBlockSent = false; this.resetNeeded = true;

        console.log("[Worklet] Cleanup finished.");
        this.postStatus("Processor cleaned up"); // Notify main thread
    }

} // --- End RubberbandProcessor Class ---

// --- Processor Registration ---
try {
    // Check if running in AudioWorkletGlobalScope
    if (typeof registerProcessor === 'function' && typeof sampleRate !== 'undefined') {
        registerProcessor(PROCESSOR_NAME, RubberbandProcessor);
    } else {
        console.error("[Worklet] registerProcessor or global sampleRate not defined.");
        try { if (self?.postMessage) self.postMessage({ type: 'error', message: 'registerProcessor or global sampleRate not defined.' }); } catch(e) {}
    }
} catch (error) {
    console.error(`[Worklet] Failed to register processor '${PROCESSOR_NAME}':`, error);
    try { if (self?.postMessage) self.postMessage({ type: 'error', message: `Failed to register processor: ${error.message}` }); } catch(e) {}
}
// --- /vibe-player/js/player/rubberbandProcessor.js --- // Updated Path
