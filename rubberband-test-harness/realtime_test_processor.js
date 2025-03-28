// Assuming rubberband.js/wasm are accessible globally OR Module passed correctly

const PROCESSOR_NAME = 'hybrid-processor'; // Must match main thread

class HybridProcessor extends AudioWorkletProcessor {

    constructor(options) {
        super(); // Must call super() first

        console.log("[Worklet] Processor created with options:", options);

        this.wasmModule = options.processorOptions.wasmModule;
        this.sampleRate = options.processorOptions.sampleRate; // Use rate from audio file
        this.numberOfChannels = options.processorOptions.numberOfChannels;
        this.initialSlowSpeed = options.processorOptions.initialSlowSpeed;

        // --- State ---
        this.isPlaying = false;
        this.currentTargetSpeed = 1.0;
        this.useSlowSource = false;      // True if simulating read from 'slowBuffer'
        this.rubberbandStretcher = 0;    // WASM instance pointer
        this.lastAppliedStretchRatio = 0;
        this.lastSourceWasSlow = false;
        this.resetNeeded = true;         // Force initial reset and ratio set

        // Playback Position (relative to the conceptual *original* timeline)
        this.playbackPositionInSeconds = 0.0;

        // Buffers (WASM pointers)
        this.inputPtrs = 0;
        this.outputPtrs = 0;
        this.inputChannelBuffers = []; // Array of WASM pointers
        this.outputChannelBuffers = []; // Array of WASM pointers
        this.blockSizeWasm = 1024; // Internal WASM buffer size

        // Audio Data Storage (initially null until loaded via message)
        this.originalChannels = null;
        // In this test, 'slowChannels' just points to original for logic testing
        this.slowChannels = null;

        this.audioLoaded = false;

        this.port.onmessage = this.handleMessage.bind(this);
        this.initializeRubberband();

        console.log("[Worklet] Initialized.");
    }

    initializeRubberband() {
        if (!this.wasmModule || this.rubberbandStretcher !== 0) {
            console.error("[Worklet] Cannot initialize Rubberband: Missing WASM module or already initialized.");
            return;
        }
        try {
            console.log("[Worklet] Initializing Rubberband instance...");
            const options = this.wasmModule.RubberbandOptions.ProcessRealTime  // REAL-TIME mode
                          | this.wasmModule.RubberbandOptions.EngineDefault
                          //| this.wasmModule.RubberbandOptions.FormantPreserved // Add if needed later
                          | this.wasmModule.RubberbandOptions.PitchHighQuality; // Good default

            // Create instance with placeholder ratios
            this.rubberbandStretcher = this.wasmModule._rubberband_new(
                this.sampleRate,
                this.numberOfChannels,
                options,
                1.0, // Initial time ratio (will be overwritten)
                1.0  // Initial pitch scale
            );

            if (!this.rubberbandStretcher) {
                throw new Error("Module._rubberband_new failed (returned 0).");
            }
            console.log(`[Worklet] Rubberband instance created: ptr=${this.rubberbandStretcher}`);

            // Allocate persistent WASM buffers
            this.inputPtrs = this.wasmModule._malloc(this.numberOfChannels * 4);
            this.outputPtrs = this.wasmModule._malloc(this.numberOfChannels * 4);
            if (!this.inputPtrs || !this.outputPtrs) throw new Error("Failed to allocate pointer arrays.");

            for (let i = 0; i < this.numberOfChannels; ++i) {
                const inputBuf = this.wasmModule._malloc(this.blockSizeWasm * 4); // Float32 = 4 bytes
                const outputBuf = this.wasmModule._malloc(this.blockSizeWasm * 4);
                if (!inputBuf || !outputBuf) throw new Error(`Failed to allocate channel buffer ${i}.`);
                this.inputChannelBuffers.push(inputBuf);
                this.outputChannelBuffers.push(outputBuf);
                this.wasmModule.HEAPU32[this.inputPtrs / 4 + i] = inputBuf;
                this.wasmModule.HEAPU32[this.outputPtrs / 4 + i] = outputBuf;
            }
            console.log(`[Worklet] Allocated ${this.numberOfChannels} WASM buffers (size ${this.blockSizeWasm * 4} bytes each).`);

        } catch (error) {
            console.error(`[Worklet] Rubberband Initialization Error: ${error.message}`);
            this.port.postMessage({ type: 'error', message: `Rubberband Init Error: ${error.message}` });
            this.rubberbandStretcher = 0; // Mark as failed
            // Consider cleaning up partial allocations if possible
        }
    }

    handleMessage(event) {
        const data = event.data;
        // console.log("[Worklet] Received message:", data.type); // DEBUG
        try {
            switch (data.type) {
                case 'load-audio':
                    if (data.channelData && data.channelData.length === this.numberOfChannels) {
                        this.originalChannels = data.channelData;
                        // For this test, slowChannels points to the same data
                        this.slowChannels = this.originalChannels;
                        this.audioLoaded = true;
                        this.playbackPositionInSeconds = 0; // Reset position
                        this.port.postMessage({ type: 'status', message: 'Audio loaded' });
                        console.log("[Worklet] Audio data loaded.");
                    } else {
                        console.error("[Worklet] Invalid audio data received.");
                         this.port.postMessage({ type: 'error', message: 'Invalid audio data received.' });
                    }
                    break;
                case 'play':
                    this.isPlaying = true;
                    this.resetNeeded = true; // Force reset/ratio set on play start
                    console.log("[Worklet] Play command received.");
                    break;
                case 'pause':
                    this.isPlaying = false;
                     console.log("[Worklet] Pause command received.");
                    break;
                case 'set-speed':
                    if (this.currentTargetSpeed !== data.value) {
                        this.currentTargetSpeed = data.value;
                        // Don't reset here, let the process loop handle ratio changes
                        console.log(`[Worklet] Target speed set to: ${this.currentTargetSpeed}`);
                    }
                    break;
                case 'set-source':
                     if (this.useSlowSource !== data.useSlow) {
                        this.useSlowSource = data.useSlow;
                        this.resetNeeded = true; // Force reset when source changes
                        console.log(`[Worklet] Source set to: ${this.useSlowSource ? 'Slow (Simulated)' : 'Original'}`);
                    }
                    break;
                // Add cases for pitch, formant, threshold, switch-behavior later
            }
        } catch (error) {
            console.error(`[Worklet] Error handling message ${data.type}: ${error.message}`);
             this.port.postMessage({ type: 'error', message: `Error handling message ${data.type}: ${error.message}` });
        }
    }

    // --- Main Processing Loop ---
    process(inputs, outputs, parameters) {
        if (!this.isPlaying || !this.audioLoaded || this.rubberbandStretcher === 0) {
            // Output silence if paused, not loaded, or instance failed
             this.outputSilence(outputs);
            return true; // Keep processor alive
        }

        const outputBuffer = outputs[0]; // Assume one output
        const outputBlockSize = outputBuffer[0].length; // Typically 128

        try {
            // --- Determine Source and Calculate Ratio ---
            const sourceIsSlow = this.useSlowSource;
            const sourceChannels = sourceIsSlow ? this.slowChannels : this.originalChannels;
            const sourceSpeed = sourceIsSlow ? this.initialSlowSpeed : 1.0;
            const sourceDurationSeconds = (sourceChannels && sourceChannels[0]) ? (sourceChannels[0].length / this.sampleRate) : 0;

            const targetStretchRatio = sourceSpeed / this.currentTargetSpeed;

            // --- Handle State Changes (Reset / Set Ratio) ---
            const ratioChanged = Math.abs(targetStretchRatio - this.lastAppliedStretchRatio) > 0.001; // Tolerance for float compare
            const sourceChanged = sourceIsSlow !== this.lastSourceWasSlow;

            if (this.resetNeeded || sourceChanged || ratioChanged) {
                 console.log(`[Worklet] State change detected: ResetNeeded=${this.resetNeeded}, SourceChanged=${sourceChanged}, RatioChanged=${ratioChanged}`);
                 console.log(`[Worklet] Applying Stretch Ratio: ${targetStretchRatio.toFixed(4)} (SourceSpeed: ${sourceSpeed}, TargetSpeed: ${this.currentTargetSpeed})`);

                 if (this.resetNeeded || sourceChanged) {
                    this.wasmModule._rubberband_reset(this.rubberbandStretcher);
                    console.log("[Worklet] Rubberband instance reset.");
                    // Recalculate read position based on *conceptual* original time
                    // This logic needs refinement based on how position is tracked
                    // For now, just reset makes sure state is clean. Accurate seeking is complex.
                 }

                 this.wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, targetStretchRatio);
                 // Add _set_pitch_scale, _set_formant_scale here later
                 this.lastAppliedStretchRatio = targetStretchRatio;
                 this.lastSourceWasSlow = sourceIsSlow;
                 this.resetNeeded = false; // Reset applied
            }


            // --- Calculate Input Frames Needed ---
            // This is an approximation. Rubberband might internally buffer/process differently.
            // Aim to provide *at least* enough input to generate one output block.
            // A safety margin is good. Needs careful tuning.
            let inputFramesNeeded = Math.ceil(outputBlockSize / targetStretchRatio); // Frames needed from the *source* buffer
            // Add latency? Add buffer? Let's start simple.
            inputFramesNeeded = Math.max(1, inputFramesNeeded); // Need at least 1 frame


            // --- Calculate Read Position ---
            // Map current conceptual time back to the index in the selected source buffer
            let readPosInSourceSamples;
            if (sourceIsSlow) {
                 readPosInSourceSamples = Math.round(this.playbackPositionInSeconds * this.sampleRate / this.initialSlowSpeed);
            } else {
                 readPosInSourceSamples = Math.round(this.playbackPositionInSeconds * this.sampleRate);
            }
            readPosInSourceSamples = Math.max(0, readPosInSourceSamples); // Clamp start

            const sourceTotalSamples = sourceChannels[0].length;

             // Adjust inputFramesNeeded if near end of source buffer
             if (readPosInSourceSamples + inputFramesNeeded > sourceTotalSamples) {
                 inputFramesNeeded = sourceTotalSamples - readPosInSourceSamples;
             }

            let isFinalInputChunk = (readPosInSourceSamples + inputFramesNeeded >= sourceTotalSamples);

             if (inputFramesNeeded <= 0) {
                 // Reached end of source input, output silence for this block
                 this.outputSilence(outputs);
                 // Consider stopping playback? Send message to main thread?
                 if (!isFinalInputChunk) { // Prevent spamming message
                     console.log("[Worklet] Reached end of input source.");
                     // Maybe post message: this.port.postMessage({ type: 'playback-end' });
                 }
                 isFinalInputChunk = true; // Ensure flag is set if we somehow overshoot
                 inputFramesNeeded = 0; // Process 0 frames if ended
                 // No need to play further? Depends on whether rubberband needs a final flush
                 // In real-time, usually just stop feeding input.
                 // For this test, let's just output silence.
                 this.isPlaying = false; // Stop playback internally
                 this.port.postMessage({ type: 'status', message: 'Playback ended' }); // Inform main thread
                 return true;
             }

            // --- Copy Input to WASM ---
            for (let i = 0; i < this.numberOfChannels; i++) {
                const sourceData = sourceChannels[i];
                const wasmInputBufferView = new Float32Array(this.wasmModule.HEAPF32.buffer, this.inputChannelBuffers[i], this.blockSizeWasm);

                // Slice or subarray might be slightly faster if source is ArrayBufferView
                const inputSlice = sourceData.subarray(readPosInSourceSamples, readPosInSourceSamples + inputFramesNeeded);
                wasmInputBufferView.set(inputSlice);

                // Zero-pad if needed (though process should handle frame count)
                if (inputFramesNeeded < this.blockSizeWasm) {
                    wasmInputBufferView.fill(0.0, inputFramesNeeded);
                }
            }

            // --- Process ---
            this.wasmModule._rubberband_process(
                this.rubberbandStretcher,
                this.inputPtrs,
                inputFramesNeeded,
                0 // 'final' flag is typically 0 in continuous real-time mode
            );

            // --- Retrieve Output ---
            let totalRetrieved = 0;
            let available = 0;
            const tempOutputBuffers = Array.from({ length: this.numberOfChannels }, () => new Float32Array(outputBlockSize)); // Temp storage for retrieved chunks

            do {
                available = this.wasmModule._rubberband_available(this.rubberbandStretcher);
                if (available > 0) {
                    // Retrieve only up to what's needed OR available, whichever is smaller
                    const neededNow = outputBlockSize - totalRetrieved;
                    const framesToRetrieve = Math.min(available, neededNow, this.blockSizeWasm); // Also limited by WASM buffer size

                    if (framesToRetrieve <= 0) break; // Already got enough for this block

                    const retrieved = this.wasmModule._rubberband_retrieve(
                        this.rubberbandStretcher,
                        this.outputPtrs,
                        framesToRetrieve
                    );

                    if (retrieved > 0) {
                        for (let i = 0; i < this.numberOfChannels; i++) {
                             const wasmOutputBufferView = new Float32Array(this.wasmModule.HEAPF32.buffer, this.outputChannelBuffers[i], retrieved);
                             // Copy data into our temporary JS buffer for this channel
                             tempOutputBuffers[i].set(wasmOutputBufferView, totalRetrieved);
                        }
                        totalRetrieved += retrieved;
                    } else if (available > 0) {
                         console.warn(`[Worklet] Available > 0 but retrieve returned 0.`);
                         available = 0; // Break inner loop
                    }
                }
            } while (available > 0 && totalRetrieved < outputBlockSize);


            // --- Copy to Output & Update Position ---
            for (let i = 0; i < this.numberOfChannels; ++i) {
                if (outputBuffer[i]) { // Check if output channel exists
                     // Copy from our temp buffer to the actual worklet output
                    outputBuffer[i].set(tempOutputBuffers[i].subarray(0, totalRetrieved));
                    // Zero-pad the rest if we didn't retrieve a full block
                    if (totalRetrieved < outputBlockSize) {
                        outputBuffer[i].fill(0.0, totalRetrieved);
                    }
                }
            }

             // Update playback position based on INPUT frames consumed, mapped back to ORIGINAL timeline
            const inputSecondsConsumed = inputFramesNeeded / this.sampleRate;
            this.playbackPositionInSeconds += inputSecondsConsumed;


        } catch (error) {
            console.error(`[Worklet] Processing Error: ${error.message}\n${error.stack}`);
            this.port.postMessage({ type: 'error', message: `Processing Error: ${error.message}` });
            this.isPlaying = false; // Stop playback on error
            this.outputSilence(outputs); // Output silence after error
        }

        return true; // Keep processor alive
    }

    outputSilence(outputs){
        const outputBuffer = outputs[0];
        const outputBlockSize = outputBuffer[0].length;
         for (let i = 0; i < this.numberOfChannels; ++i) {
             if (outputBuffer[i]) {
                 outputBuffer[i].fill(0.0);
             }
         }
    }

     // Optional: Cleanup WASM memory if processor is destroyed
     // Note: Standard AudioWorklet lifecycle doesn't guarantee a destructor.
     // Might need explicit 'destroy' message from main thread.
    cleanup() {
         console.log("[Worklet] Cleanup called.");
         if (this.wasmModule && this.rubberbandStretcher !== 0) {
             try { this.wasmModule._rubberband_delete(this.rubberbandStretcher); console.log("[Worklet] Deleted Rubberband instance."); }
             catch (e) { console.error(`[Worklet] Error deleting instance: ${e}`); }
             this.rubberbandStretcher = 0;
         }
         if (this.wasmModule) {
             this.inputChannelBuffers.forEach((ptr) => { if (ptr) try { this.wasmModule._free(ptr); } catch(e){} });
             this.outputChannelBuffers.forEach((ptr) => { if (ptr) try { this.wasmModule._free(ptr); } catch(e){} });
             if (this.inputPtrs) try { this.wasmModule._free(this.inputPtrs); } catch(e){}
             if (this.outputPtrs) try { this.wasmModule._free(this.outputPtrs); } catch(e){}
             this.inputChannelBuffers = [];
             this.outputChannelBuffers = [];
             this.inputPtrs = 0;
             this.outputPtrs = 0;
             console.log("[Worklet] Freed WASM memory.");
         }
     }

} // End of class definition

registerProcessor(PROCESSOR_NAME, HybridProcessor);

console.log(`[Worklet] ${PROCESSOR_NAME} registered.`);