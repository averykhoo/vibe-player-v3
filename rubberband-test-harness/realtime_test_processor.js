// NOTE: We DO NOT import the loader here anymore.

const PROCESSOR_NAME = 'hybrid-processor';
const OUTPUT_SILENCE_THRESHOLD = 0.00001;

class HybridProcessor extends AudioWorkletProcessor {

    constructor(options) {
        super();
        console.log("[Worklet] Processor created.");

        // --- Get initial config & WASM Binary ---
        this.processorOpts = options.processorOptions || {};
        this.sampleRate = this.processorOpts.sampleRate || currentTime; // Fallback, but should be provided
        this.numberOfChannels = this.processorOpts.numberOfChannels || 0;
        this.initialSlowSpeed = this.processorOpts.initialSlowSpeed || 0.25;
        this.wasmBinary = this.processorOpts.wasmBinary; // ArrayBuffer (transferred)

        // --- WASM/Rubberband State ---
        this.wasmModule = null; // Will hold WASM exports
        this.wasmReady = false;
        this.rubberbandStretcher = 0;

        // --- Other State & Buffers ---
        this.isPlaying = false;
        this.currentTargetSpeed = 1.0;
        this.useSlowSource = false;
        this.lastAppliedStretchRatio = 0;
        this.lastSourceWasSlow = false;
        this.resetNeeded = true;
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

        this.port.onmessage = this.handleMessage.bind(this);
        console.log("[Worklet] Initialized state variables.");

        // Check if WASM Binary was received correctly
        if (!this.wasmBinary) {
            console.error("[Worklet] CRITICAL: WASM binary ArrayBuffer not received in options!");
            this.postError("WASM binary missing in options.");
        }
        // WASM Initialization will be triggered by 'load-audio' message
    }

    // --- WASM & Rubberband Initialization (Triggered after audio loaded) ---
    async initializeWasmAndRubberband() {
        if (this.wasmReady) return;
        if (!this.wasmBinary) { this.postError("Cannot initialize: WASM binary missing."); return; }
        if (!this.sampleRate || !this.numberOfChannels) { this.postError("Cannot initialize Rubberband: Sample rate or channel count missing."); return; }

        try {
            console.log("[Worklet] Initializing WASM & Rubberband instance...");

            // --- instantiateWasm Hook ---
            // This function is called by the loader script code
            const instantiateWasm = (imports, successCallback) => {
                console.log("[Worklet] instantiateWasm hook called.");
                WebAssembly.instantiate(this.wasmBinary, imports)
                    .then(output => {
                        console.log("[Worklet] WebAssembly.instantiate successful.");
                        successCallback(output.instance, output.module);
                    })
                    .catch(error => {
                        console.error("[Worklet] WebAssembly.instantiate failed:", error);
                        this.postError(`WASM Instantiation failed: ${error.message}`);
                        throw error; // Propagate error to stop loader
                    });
                return {}; // Indicate async instantiation
            };

            // --- Get Loader Function ---
            // This relies on rubberband.js defining 'RubberbandModuleLoader' globally
            // when executed. We execute it using eval() as importScripts is unreliable.
            // ** This is potentially risky if rubberband.js has side effects or relies on `window` **
            let loaderFunc;
            try {
                // Fetch the loader script text (assuming it's served)
                // This fetch happens INSIDE the worklet
                 console.log("[Worklet] Fetching loader script text 'rubberband.js'...");
                 const response = await fetch('rubberband.js'); // Path relative to HTML? Or absolute? Needs testing. Assume relative for now.
                 if (!response.ok) throw new Error(`HTTP error ${response.status}`);
                 const loaderScriptText = await response.text();
                 console.log("[Worklet] Evaluating loader script text...");
                 // Use eval in a way that tries to capture the loader function
                 // Create a temporary scope
                 const getLoader = new Function(`${loaderScriptText}; return Rubberband;`); // Assumes loader returns the async function directly
                 const moduleFactory = getLoader(); // Execute the script, get the factory/loader
                 loaderFunc = moduleFactory(); // Get the actual async loader function

                 if (typeof loaderFunc !== 'function') throw new Error("Loader function not found after eval.");
                 console.log("[Worklet] Loader function obtained via eval.");

            } catch (loaderError) {
                 console.error("[Worklet] Failed to get loader function:", loaderError);
                 throw new Error(`Could not get RubberbandModuleLoader: ${loaderError.message}`);
            }


            // --- Call the Loader with the Hook ---
             console.log("[Worklet] Calling loader function with instantiateWasm hook...");
             this.wasmModule = await loaderFunc({ // Use the obtained loader function
                 instantiateWasm: instantiateWasm
             });
             console.log("[Worklet] RubberbandModuleLoader promise resolved.");


            // --- Check Module and Initialize Rubberband ---
             if (!this.wasmModule || typeof this.wasmModule._rubberband_new !== 'function') {
                 throw new Error("Module loading failed or _rubberband_new not found.");
             }
             console.log("[Worklet] WASM Module Exports ready:", Object.keys(this.wasmModule));

            // --- Initialize Rubberband Instance ---
            const RBOptions = this.wasmModule.RubberbandOptions || {}; // Use loaded module
            const options = (RBOptions.ProcessRealTime || 1) | (RBOptions.EngineDefault || 0) | (RBOptions.PitchHighQuality || 0x02000000);
            this.rubberbandStretcher = this.wasmModule._rubberband_new(
                 this.sampleRate, this.numberOfChannels, options, 1.0, 1.0
            );
            if (!this.rubberbandStretcher) throw new Error("_rubberband_new failed.");
            console.log(`[Worklet] Rubberband instance created: ptr=${this.rubberbandStretcher}`);

            // --- Allocate Buffers ---
            this.inputPtrs = this.wasmModule._malloc(this.numberOfChannels * 4);
            this.outputPtrs = this.wasmModule._malloc(this.numberOfChannels * 4);
            if (!this.inputPtrs || !this.outputPtrs) throw new Error("Failed to allocate pointer arrays.");
            this.inputChannelBuffers = [];
            this.outputChannelBuffers = [];
            for (let i = 0; i < this.numberOfChannels; ++i) { /* ... allocate using this.wasmModule._malloc ... */
                 const inputBuf = this.wasmModule._malloc(this.blockSizeWasm * 4);
                 const outputBuf = this.wasmModule._malloc(this.blockSizeWasm * 4);
                 if (!inputBuf || !outputBuf) throw new Error(`Failed to allocate channel buffer ${i}.`);
                 this.inputChannelBuffers.push(inputBuf);
                 this.outputChannelBuffers.push(outputBuf);
                 this.wasmModule.HEAPU32[this.inputPtrs / 4 + i] = inputBuf;
                 this.wasmModule.HEAPU32[this.outputPtrs / 4 + i] = outputBuf;
             }
            console.log(`[Worklet] Allocated ${this.numberOfChannels} WASM buffers.`);

            this.wasmReady = true;
            console.log("[Worklet] WASM and Rubberband instance ready.");
            this.postStatus('processor-ready'); // Now truly ready


        } catch (error) {
            console.error(`[Worklet] WASM/Rubberband Initialization Error: ${error.message}\n${error.stack}`);
            this.postError(`WASM/Rubberband Init Error: ${error.message}`);
            this.wasmReady = false;
            this.rubberbandStretcher = 0;
            this.cleanupWasmMemory();
        }
    }


    handleMessage(event) {
        const data = event.data;
        try {
            switch (data.type) {
                // NO 'init-wasm' case anymore
                case 'load-audio':
                    if (this.audioLoaded) {
                         console.warn("[Worklet] Audio already loaded, ignoring new data.");
                         return;
                    }
                    if (data.channelData && data.channelData.length === this.numberOfChannels) {
                        this.originalChannels = data.channelData.map(buffer => new Float32Array(buffer));
                        this.slowChannels = this.originalChannels;
                        this.audioLoaded = true;
                        this.playbackPositionInSeconds = 0;
                        this.sourceDurationSeconds = this.originalChannels[0].length / this.sampleRate;
                        console.log(`[Worklet] Audio data received. Duration: ${this.sourceDurationSeconds.toFixed(3)}s`);
                        // --- Trigger WASM initialization AFTER audio data is loaded ---
                        if (!this.wasmReady && this.wasmBinary) { // Check binary exists
                             this.initializeWasmAndRubberband(); // Start async init now
                        } else if (this.wasmReady) {
                             // If WASM was somehow already ready, signal processor ready
                             this.postStatus('processor-ready');
                        } else {
                            this.postError("Cannot init WASM: Binary missing.");
                        }
                    } else { this.postError('Invalid audio data received.'); this.audioLoaded = false; }
                    break;
                case 'play':
                    if (this.wasmReady && this.audioLoaded) {
                        this.isPlaying = true; this.resetNeeded = true;
                        console.log("[Worklet] Play command received.");
                    } else { this.postError('Processor not ready to play.'); }
                    break;
                case 'pause': this.isPlaying = false; console.log("[Worklet] Pause command received."); break;
                case 'set-speed': if (this.wasmReady && this.currentTargetSpeed !== data.value) this.currentTargetSpeed = data.value; break;
                case 'set-source': if (this.wasmReady && this.useSlowSource !== data.useSlow) { this.useSlowSource = data.useSlow; this.resetNeeded = true; } break;
                case 'cleanup': this.cleanup(); break;
            }
        } catch (error) { this.postError(`Error handling message ${data.type}: ${error.message}`); }
    }

    process(inputs, outputs, parameters) {
        if (!this.wasmReady || !this.audioLoaded || this.rubberbandStretcher === 0 || !this.isPlaying) {
            this.outputSilence(outputs); return true;
        }

        const outputBuffer = outputs[0];
        if (!outputBuffer || !outputBuffer[0]) return true; // Stop if output structure is wrong

        const outputChannels = outputBuffer.length;
        const outputBlockSize = outputBuffer[0].length;

        if (outputChannels !== this.numberOfChannels) { /* ... error handling ... */ return true; }

        try {
            // Determine Source and Calculate Ratio
            const sourceIsSlow = this.useSlowSource;
            const sourceChannels = sourceIsSlow ? this.slowChannels : this.originalChannels;
            const sourceSpeed = sourceIsSlow ? this.initialSlowSpeed : 1.0;

            const safeTargetSpeed = Math.max(0.01, this.currentTargetSpeed);
            const targetStretchRatio = sourceSpeed / safeTargetSpeed;
            const safeStretchRatio = Math.max(0.05, Math.min(20.0, targetStretchRatio));

            // Handle State Changes
            const ratioChanged = Math.abs(safeStretchRatio - this.lastAppliedStretchRatio) > 0.0001;
            const sourceChanged = sourceIsSlow !== this.lastSourceWasSlow;

            if (this.resetNeeded || sourceChanged) {
                 this.wasmModule._rubberband_reset(this.rubberbandStretcher);
                 this.wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, safeStretchRatio);
                 this.lastAppliedStretchRatio = safeStretchRatio;
                 this.lastSourceWasSlow = sourceIsSlow;
                 this.resetNeeded = false;
            } else if (ratioChanged) {
                 this.wasmModule._rubberband_set_time_ratio(this.rubberbandStretcher, safeStretchRatio);
                 this.lastAppliedStretchRatio = safeStretchRatio;
            }

            // Calculate Input Frames Needed & Read Position
            let inputFramesNeeded = Math.ceil(outputBlockSize / safeStretchRatio); // Needs refinement maybe
            inputFramesNeeded = Math.max(1, inputFramesNeeded);

            let readPosInSourceSamples;
            const effectiveSourceSampleRate = this.sampleRate / sourceSpeed;
            readPosInSourceSamples = Math.round(this.playbackPositionInSeconds * effectiveSourceSampleRate);

            const sourceTotalSamples = sourceChannels[0].length;
            readPosInSourceSamples = Math.max(0, Math.min(readPosInSourceSamples, sourceTotalSamples));

            if (readPosInSourceSamples + inputFramesNeeded >= sourceTotalSamples) {
                inputFramesNeeded = sourceTotalSamples - readPosInSourceSamples;
            }
            const isEndOfInput = (inputFramesNeeded <= 0);

            if (isEndOfInput) {
                this.outputSilence(outputs);
                if (this.isPlaying) { this.isPlaying = false; this.postStatus('Playback ended'); this.playbackPositionInSeconds = 0;}
                return true;
            }

            // Copy Input to WASM
            for (let i = 0; i < this.numberOfChannels; i++) {
                const sourceData = sourceChannels[i];
                const wasmInputBufferView = new Float32Array(this.wasmModule.HEAPF32.buffer, this.inputChannelBuffers[i], this.blockSizeWasm);
                const inputSlice = sourceData.subarray(readPosInSourceSamples, readPosInSourceSamples + inputFramesNeeded);
                wasmInputBufferView.set(inputSlice);
                if (inputFramesNeeded < this.blockSizeWasm) { wasmInputBufferView.fill(0.0, inputFramesNeeded); }
            }

            // Process
            this.wasmModule._rubberband_process(this.rubberbandStretcher, this.inputPtrs, inputFramesNeeded, 0);

            // Retrieve Output
            let totalRetrieved = 0;
            let available = 0;
            const tempOutputBuffers = Array.from({ length: this.numberOfChannels }, () => new Float32Array(outputBlockSize));

            do {
                available = this.wasmModule._rubberband_available(this.rubberbandStretcher);
                if (available > 0) {
                    const neededNow = outputBlockSize - totalRetrieved;
                    if (neededNow <= 0) break;
                    const framesToRetrieve = Math.min(available, neededNow, this.blockSizeWasm);
                    const retrieved = this.wasmModule._rubberband_retrieve(this.rubberbandStretcher, this.outputPtrs, framesToRetrieve);
                    if (retrieved > 0) {
                        for (let i = 0; i < this.numberOfChannels; i++) {
                            const wasmOutputBufferView = new Float32Array(this.wasmModule.HEAPF32.buffer, this.outputChannelBuffers[i], retrieved);
                            tempOutputBuffers[i].set(wasmOutputBufferView, totalRetrieved);
                        }
                        totalRetrieved += retrieved;
                    } else if (available > 0) { available = 0; } // Break inner loop
                }
            } while (available > 0 && totalRetrieved < outputBlockSize);


            // Copy to Output & Update Position
            for (let i = 0; i < this.numberOfChannels; ++i) {
                if (outputBuffer[i]) {
                    outputBuffer[i].set(tempOutputBuffers[i].subarray(0, totalRetrieved));
                    if (totalRetrieved < outputBlockSize) { outputBuffer[i].fill(0.0, totalRetrieved); }
                }
            }
            const inputSecondsConsumedOriginalTime = (inputFramesNeeded / this.sampleRate) * sourceSpeed;
            this.playbackPositionInSeconds += inputSecondsConsumedOriginalTime;

        } catch (error) {
             console.error(`[Worklet] Processing Error: ${error.message}\n${error.stack}`);
             this.postError(`Processing Error: ${error.message}`);
             this.isPlaying = false;
             this.outputSilence(outputs);
        }
        return true;
    } // End process

    outputSilence(outputs){
        if (!outputs || !outputs[0] || !outputs[0][0]) return;
        const outputChannels = outputs[0];
        for (let i = 0; i < outputChannels.length; ++i) {
            if (outputChannels[i]) outputChannels[i].fill(0.0);
        }
    }

    postStatus(message) { try { this.port.postMessage({ type: 'status', message }); } catch(e) { /* ... */ } }
    postError(message) { try { this.port.postMessage({ type: 'error', message }); } catch(e) { /* ... */ } }

    cleanupWasmMemory() {
         if (this.wasmModule) {
             console.log("[Worklet] Cleaning up WASM memory...");
             this.inputChannelBuffers.forEach((ptr) => { if (ptr) try { this.wasmModule._free(ptr); } catch(e){} });
             this.outputChannelBuffers.forEach((ptr) => { if (ptr) try { this.wasmModule._free(ptr); } catch(e){} });
             if (this.inputPtrs) try { this.wasmModule._free(this.inputPtrs); } catch(e){}
             if (this.outputPtrs) try { this.wasmModule._free(this.outputPtrs); } catch(e){}
             this.inputChannelBuffers = []; this.outputChannelBuffers = [];
             this.inputPtrs = 0; this.outputPtrs = 0;
             console.log("[Worklet] Freed WASM buffers.");
         }
    }

    cleanup() {
         console.log("[Worklet] Cleanup requested.");
         this.isPlaying = false;
         if (this.wasmReady && this.rubberbandStretcher !== 0) {
             try { this.wasmModule._rubberband_delete(this.rubberbandStretcher); console.log("[Worklet] Deleted Rubberband instance."); }
             catch (e) { console.error(`[Worklet] Error deleting instance: ${e}`); }
             this.rubberbandStretcher = 0;
         }
         this.cleanupWasmMemory();
         this.wasmReady = false; this.audioLoaded = false; this.wasmModule = null;
     }

} // End of class

// Register the processor
try {
    registerProcessor(PROCESSOR_NAME, HybridProcessor);
    console.log(`[Worklet] ${PROCESSOR_NAME} registered successfully.`);
} catch (error) {
     console.error(`[Worklet] Failed to register processor ${PROCESSOR_NAME}:`, error);
     try { self.postMessage({ type: 'error', message: `Failed to register processor: ${error.message}`}); } catch(e) {}
}
