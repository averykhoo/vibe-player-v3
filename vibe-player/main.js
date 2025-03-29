// --- /vibe-player/main.js ---
/**
 * @namespace AudioApp
 * @description Main application namespace and orchestrator for Vibe Player Pro.
 * This script initializes the application, manages state, handles the offline
 * processing pipeline (decode, VAD, Rubberband preprocess), manages the
 * AudioWorklet for playback, and coordinates communication between modules.
 * It replaces the previous app.js and audioEngine.js.
 * MUST be loaded AFTER libraries (ort, fft) but BEFORE other app modules.
 */
var AudioApp = AudioApp || {}; // Ensure namespace exists if loaded out of order, though order is critical.

AudioApp = (function() {
    'use strict';

    // --- Application State ---
    // Design Decision: Keep essential state needed for orchestration here.
    /** @type {AudioContext|null} The single persistent audio context */
    let audioCtx = null;
    /** @type {AudioWorkletNode|null} Node hosting the hybrid-processor */
    let workletNode = null;
    /** @type {AudioBuffer|null} The fully decoded original audio */
    let originalBuffer = null;
    /** @type {AudioBuffer|null} The offline pre-processed slow audio version */
    let slowBuffer = null;
    /** @type {Float32Array|null} Audio resampled to 16kHz mono for VAD */
    let pcm16k = null;
    /** @type {VadResult|null} Stores results from vadAnalyzer */
    let vadResults = null;
    /** @type {File|null} The currently loaded audio file */
    let currentFile = null;
    /** @type {boolean} Main thread's desired playback state */
    let isPlaying = false;
    /** @type {boolean} Flag indicating the worklet processor is loaded and ready */
    let workletReady = false;
    /** @type {boolean} Flag indicating all audio buffers are loaded/processed and sent to worklet */
    let audioReady = false; // Renamed from Vibe Player's state for clarity
    /** @type {ArrayBuffer|null} Pre-fetched Rubberband WASM binary */
    let rubberbandWasmBinary = null;
    /** @type {string|null} Pre-fetched Rubberband custom loader script text */
    let rubberbandLoaderText = null;
    /** @type {boolean} Prevents redundant cleanup calls on unload */
    let cleanupScheduled = false;

    // --- Initialization ---
    /**
     * Initializes the Vibe Player Pro application.
     * Creates AudioContext, loads WASM assets, initializes modules, sets up listeners.
     * @public
     */
    function init() {
        console.log("AudioApp (main.js): Initializing Vibe Player Pro...");

        // Create Audio Context - critical first step
        if (!setupAudioContext()) {
            AudioApp.uiManager?.showError("Fatal: Could not initialize Web Audio API.", true); // Use uiManager if available
            return; // Stop initialization if context fails
        }

        // Initialize core modules (assuming they are loaded and attached to AudioApp by now)
        // Pass initial config values needed by uiManager for setup
        const cfg = AudioApp.config; // Alias for convenience
        AudioApp.uiManager.init(
            cfg.DEFAULT_GAIN, cfg.DEFAULT_SPEED, cfg.DEFAULT_PITCH_SEMITONES,
            cfg.DEFAULT_FORMANT_SCALE, cfg.DEFAULT_HYBRID_THRESHOLD, cfg.DEFAULT_INITIAL_SLOW_SPEED
        );
        AudioApp.visualizer.init();
        // Note: VAD modules don't have an explicit public `init` in this design.
        // `sileroWrapper.create` is called during file processing.

        // Pre-fetch Rubberband WASM assets concurrently
        // ORT WASM is loaded implicitly when `sileroWrapper.create` is called.
        Promise.all([
             fetchWasmAsset(cfg.RUBBERBAND_WASM_PATH, 'Rubberband WASM binary')
                .then(data => rubberbandWasmBinary = data)
                .catch(handleAssetLoadError), // Use centralized error handler
             fetchWasmAsset(cfg.RUBBERBAND_LOADER_PATH, 'Rubberband Loader script', 'text')
                .then(data => rubberbandLoaderText = data)
                .catch(handleAssetLoadError)
        ]).then(() => {
             if (rubberbandWasmBinary && rubberbandLoaderText) {
                 console.log("AudioApp: Rubberband WASM assets pre-fetched.");
                 AudioApp.uiManager.setFileInfo("Ready. Select an audio file.");
             }
             // Error state is handled by handleAssetLoadError
        });

        // Setup event listeners for UI interactions and window events
        setupAppEventListeners();

        console.log("AudioApp: Initialized.");
    }

    // --- AudioContext Management ---
    /**
     * Creates or resumes the main AudioContext.
     * @returns {boolean} True if context is ready (running or resumable), false on critical failure.
     * @private
     */
    function setupAudioContext() {
        if (audioCtx && audioCtx.state !== 'closed') {
            console.log("AudioApp: AudioContext already exists.");
            return true; // Already setup
        }
        try {
            console.log("AudioApp: Creating AudioContext...");
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') {
                console.warn("AudioApp: AudioContext is suspended. Needs user interaction (e.g., click Play) to resume.");
                // We will attempt resume on first play action.
            }
            console.log(`AudioApp: AudioContext created. Sample Rate: ${audioCtx.sampleRate}, State: ${audioCtx.state}`);
            return true;
        } catch (e) {
            console.error("AudioApp: Failed to create AudioContext.", e);
            // Attempt to inform UI even if uiManager might not be fully init yet
            const fileInfo = document.getElementById('fileInfo');
            if (fileInfo) {
                fileInfo.textContent = "ERROR: Web Audio API not supported or failed to initialize.";
                fileInfo.style.color = 'red';
            }
            return false;
        }
    }

     // --- WASM Asset Fetching ---
    /**
     * Fetches WASM binary or loader script text.
     * @param {string} path - URL path to the asset.
     * @param {string} assetName - Description for logging.
     * @param {'arrayBuffer' | 'text'} [type='arrayBuffer'] - Fetch response type.
     * @returns {Promise<ArrayBuffer|string>}
     * @throws {Error} If fetch fails.
     * @private
     */
    async function fetchWasmAsset(path, assetName, type = 'arrayBuffer') {
        console.log(`AudioApp: Fetching ${assetName} from ${path}...`);
        const response = await fetch(path);
        if (!response.ok) {
            throw new Error(`Fetch failed ${response.status} for ${assetName} at ${path}`);
        }
        const data = await (type === 'text' ? response.text() : response.arrayBuffer());
        console.log(`AudioApp: Fetched ${assetName} (${type === 'text' ? data.length + ' chars' : data.byteLength + ' bytes'}).`);
        return data;
    }

    /**
     * Handles errors during initial WASM asset loading.
     * @param {Error} error
     * @private
     */
    function handleAssetLoadError(error) {
         console.error("AudioApp: Critical asset loading failed:", error);
         AudioApp.uiManager.showError(`Failed to load core components: ${error.message}. App may not function.`, true);
         // Disable file input? Or let user try and fail later? Disable for clarity.
         const fileInput = document.getElementById('audioFile');
         if (fileInput) fileInput.disabled = true;
    }


    // --- Event Listener Setup ---
    /**
     * Sets up listeners for custom events dispatched by other modules and window events.
     * @private
     */
    function setupAppEventListeners() {
        // --- UI -> App Event Listeners ---
        document.addEventListener('audioapp:fileSelected', handleFileSelected);
        document.addEventListener('audioapp:playPauseClicked', handlePlayPause);
        document.addEventListener('audioapp:jumpClicked', handleJump);
        document.addEventListener('audioapp:seekRequested', handleSeek); // From Visualizer clicks
        document.addEventListener('audioapp:paramChanged', handleParameterChange); // Generic handler for playback/hybrid params
        document.addEventListener('audioapp:vadThresholdChanged', handleVadThresholdChange); // Specific VAD tuning
        document.addEventListener('audioapp:keyPressed', handleKeyPress); // From uiManager

        // --- Worklet -> App Event Listeners (Set up in setupWorkletMessageListener) ---

        // --- Window Event Listeners ---
        window.addEventListener('resize', handleWindowResize);
        window.addEventListener('beforeunload', handleBeforeUnload); // Cleanup
    }

    // --- Core File Processing Pipeline ---
    /**
     * Orchestrates the entire offline processing pipeline when a file is selected.
     * @param {CustomEvent} e - Event detail contains { file: File }
     * @private
     */
    async function handleFileSelected(e) {
        currentFile = e.detail.file;
        if (!currentFile || !audioCtx) {
            console.warn("AudioApp: File selection ignored - No file or AudioContext.");
            return;
        }
        // Ensure essential WASM assets are loaded before proceeding
        if (!rubberbandWasmBinary || !rubberbandLoaderText) {
             handleAssetLoadError(new Error("Cannot process file, core Rubberband assets missing."));
             return;
        }

        console.log("AudioApp: File selected -", currentFile.name);
        await cleanupCurrentAudio(); // Reset state and worklet before processing new file
        AudioApp.uiManager.resetUIForLoading(currentFile.name); // Update UI state
        AudioApp.visualizer.clearVisuals();
        AudioApp.visualizer.showSpinner(true); // Show spinner during potentially long processing

        const startTime = performance.now();
        try {
            // --- Stage 1: Decode Audio ---
            AudioApp.uiManager.setFileInfo(`Decoding ${currentFile.name}...`);
            const decodedBuffer = await decodeAudioFile(currentFile);
            originalBuffer = decodedBuffer;
            console.log(`AudioApp: Decoded ${originalBuffer.duration.toFixed(2)}s @ ${originalBuffer.sampleRate}Hz`);
            AudioApp.uiManager.updateTimeDisplay(0, originalBuffer.duration);

            // --- Stage 2: Resample for VAD ---
            AudioApp.uiManager.setFileInfo(`Resampling for VAD...`);
            pcm16k = await resampleForVAD(originalBuffer);
            console.log(`AudioApp: Resampled to ${pcm16k.length} samples @ 16kHz`);

            // --- Stage 3: VAD Analysis (Ensure model is loaded/created via wrapper) ---
            AudioApp.uiManager.setFileInfo(`Analyzing VAD (loading model if needed)...`);
            // `create` is idempotent, safe to call multiple times. Handles ORT WASM loading on first call.
            const vadModelReady = await AudioApp.sileroWrapper.create(AudioApp.config.VAD_SAMPLE_RATE, AudioApp.config.VAD_MODEL_PATH);
            if (!vadModelReady) throw new Error("VAD Model could not be loaded/created. Check console for details (e.g., WASM paths in sileroWrapper.js).");

            AudioApp.uiManager.setFileInfo(`Analyzing VAD...`); // Update status after potential model load
            vadResults = await AudioApp.vadAnalyzer.analyze(pcm16k); // Uses processor -> wrapper
            console.log(`AudioApp: VAD analysis complete. ${vadResults.regions.length} initial regions found.`);
            AudioApp.uiManager.updateVadDisplay(vadResults.initialPositiveThreshold, vadResults.initialNegativeThreshold);
            AudioApp.uiManager.setSpeechRegionsText(vadResults.regions);

            // --- Stage 4: Rubberband Offline Preprocessing ---
            const initialSlowSpeed = AudioApp.uiManager.getCurrentConfig().initialSlowSpeed; // Get from UI
            AudioApp.uiManager.setFileInfo(`Preprocessing slow version (${initialSlowSpeed}x)...`);
            slowBuffer = await preprocessSlowVersion(originalBuffer, initialSlowSpeed);
            if (!slowBuffer) throw new Error("Failed to generate pre-processed slow audio version."); // Check result
            console.log(`AudioApp: Preprocessed slow version (${slowBuffer.duration.toFixed(2)}s @ ${initialSlowSpeed}x)`);

            // --- Stage 5: Setup Worklet & Transfer Buffers ---
            AudioApp.uiManager.setFileInfo(`Initializing audio engine...`);
            await setupAndStartWorklet(); // Creates node, sets up message listener
            if (!workletReady) throw new Error("Audio engine (Worklet) failed to initialize."); // Check readiness
            transferAudioDataToWorklet(originalBuffer, slowBuffer); // Send buffers

            // --- Stage 6: Draw Visualizations ---
            AudioApp.uiManager.setFileInfo(`Generating visuals...`);
            await AudioApp.visualizer.computeAndDrawVisuals(originalBuffer, vadResults.regions);

            // --- Final Ready State ---
            audioReady = true; // Mark audio as fully processed and ready in the worklet
            const endTime = performance.now();
            console.log(`AudioApp: Total file processing time: ${((endTime - startTime) / 1000).toFixed(2)}s`);
            AudioApp.uiManager.setFileInfo(`Ready: ${currentFile.name}`);
            AudioApp.uiManager.enableControls(true); // Enable playback and parameter controls

        } catch (error) {
            const endTime = performance.now();
            console.error(`AudioApp: Error during file processing pipeline after ${((endTime - startTime) / 1000).toFixed(2)}s:`, error);
            AudioApp.uiManager.showError(`Processing failed: ${error.message}`, true);
            await cleanupCurrentAudio(); // Clean up partially processed state on error
            // Ensure UI is reset to a usable state
             AudioApp.uiManager.resetUI();
             AudioApp.uiManager.setFileInfo("Processing error. Please try another file.");

        } finally {
            AudioApp.visualizer.showSpinner(false); // Hide spinner regardless of success/failure
        }
    }

    /**
     * Decodes an audio file using the Web Audio API.
     * @param {File} file
     * @returns {Promise<AudioBuffer>}
     * @throws {Error} If decoding fails.
     * @private
     */
    async function decodeAudioFile(file) {
        console.log("AudioApp: Decoding audio file...");
        const arrayBuffer = await file.arrayBuffer();
        // Ensure context is running before decode attempt
        if (audioCtx.state === 'suspended') {
            console.log("AudioApp: Attempting to resume AudioContext for decoding...");
            await audioCtx.resume(); // Needs to succeed before decodeAudioData
             if (audioCtx.state !== 'running') throw new Error("AudioContext could not be resumed for decoding.");
        }
        try {
            // Use the persistent audioCtx
            return await audioCtx.decodeAudioData(arrayBuffer);
        } catch (e) {
            console.error("AudioApp: decodeAudioData failed:", e);
            let message = "Failed to decode audio file. Format might not be supported";
            if (e.message) message += ` (${e.message})`;
            throw new Error(message);
        }
    }

    /**
     * Resamples an AudioBuffer to 16kHz mono using OfflineAudioContext.
     * @param {AudioBuffer} buffer - The original AudioBuffer.
     * @returns {Promise<Float32Array>} The 16kHz mono PCM data.
     * @throws {Error} If resampling fails.
     * @private
     */
    async function resampleForVAD(buffer) {
         console.log("AudioApp: Resampling audio for VAD...");
         const targetSR = AudioApp.config.VAD_SAMPLE_RATE;
         // Optimization: If already correct format, just copy channel data
         if (buffer.sampleRate === targetSR && buffer.numberOfChannels === 1) {
             console.log("AudioApp: Audio already 16kHz mono, skipping resampling.");
             return buffer.getChannelData(0).slice(); // Return a copy to avoid mutation issues
         }
         try {
             // Offline context is temporary and safe to create here
             const offlineCtx = new OfflineAudioContext(1, Math.ceil(buffer.duration * targetSR), targetSR);
             const src = offlineCtx.createBufferSource();
             src.buffer = buffer;
             src.connect(offlineCtx.destination);
             src.start(0);
             const renderedBuffer = await offlineCtx.startRendering();
             return renderedBuffer.getChannelData(0);
         } catch (e) {
             console.error("AudioApp: Offline resampling failed:", e);
             throw new Error(`Failed to resample audio for VAD: ${e.message}`);
         }
    }

    /**
     * Runs the Rubberband offline process to create a high-quality slow version.
     * This is complex as it requires loading and using the WASM module directly on the main thread.
     * @param {AudioBuffer} buffer - The original AudioBuffer.
     * @param {number} targetSlowSpeed - The target speed multiplier (e.g., 0.25).
     * @returns {Promise<AudioBuffer|null>} The processed slow AudioBuffer, or null on failure.
     * @throws {Error} If preprocessing fails.
     * @private
     */
    async function preprocessSlowVersion(buffer, targetSlowSpeed) {
        console.log(`AudioApp: Preprocessing slow version at ${targetSlowSpeed}x...`);
        if (!rubberbandWasmBinary || !rubberbandLoaderText) {
             throw new Error("Rubberband WASM components not loaded for preprocessing.");
        }
        if (!buffer || targetSlowSpeed <= 0) {
             throw new Error("Invalid input for preprocessing.");
        }

        // --- Load Rubberband Library Directly ---
        // This uses the helper function to load the library outside the worklet context.
        const RBLib = await loadRubberbandLibraryDirectly(rubberbandWasmBinary, rubberbandLoaderText);
        if (!RBLib) throw new Error("Failed to load Rubberband library instance for preprocessing.");

        const stretchRatio = 1.0 / targetSlowSpeed; // Rubberband uses stretch factor
        const sampleRate = buffer.sampleRate;
        const channels = buffer.numberOfChannels;
        const inputLength = buffer.length;

        // --- Configure Rubberband Instance (Offline) ---
        // Choose flags for high-quality offline processing
        const rbFlags = RBLib.RubberBandOptionFlag.ProcessOffline | // OFFLINE mode
                      RBLib.RubberBandOptionFlag.EngineFiner | // Finer engine for quality
                      RBLib.RubberBandOptionFlag.PitchHighQuality |
                      RBLib.RubberBandOptionFlag.FormantPreserved |
                      RBLib.RubberBandOptionFlag.SmoothingOn | // Enable smoothing
                      RBLib.RubberBandOptionFlag.WindowLong;   // Longer window often better for music/complex audio

        const statePtr = RBLib._rubberband_new(sampleRate, channels, rbFlags, 1.0, 1.0); // Initial ratios
        let processedBuffer = null; // To store the final AudioBuffer
        let wasmMemory = null;      // Instance of WasmMemoryManager helper

        if (!statePtr) throw new Error("_rubberband_new failed during preprocessing.");

        try {
            RBLib._rubberband_set_time_ratio(statePtr, stretchRatio);
            RBLib._rubberband_set_pitch_scale(statePtr, 1.0); // Keep pitch the same for slow version
            RBLib._rubberband_set_expected_input_duration(statePtr, inputLength);

            // Latency helps determine a good block size
            const latency = RBLib._rubberband_get_latency(statePtr);
            const blockSize = Math.max(1024, latency > 0 ? latency * 2 : 4096); // Sensible block size
            console.log(`AudioApp (Preprocess): BlockSize=${blockSize}, Latency=${latency}`);

            wasmMemory = new AudioApp.WasmMemoryManager(RBLib); // Instantiate memory manager

            // --- Allocate WASM Memory for this operation ---
            const inputPtrsRef = wasmMemory.allocUint32Array(channels);
            const outputPtrsRef = wasmMemory.allocUint32Array(channels);
            const inputBufRefs = Array.from({ length: channels }, () => wasmMemory.allocFloat32Array(blockSize));
            const outputBufRefs = Array.from({ length: channels }, () => wasmMemory.allocFloat32Array(blockSize));
            for (let i = 0; i < channels; ++i) {
                inputPtrsRef.view[i] = inputBufRefs[i].address;
                outputPtrsRef.view[i] = outputBufRefs[i].address;
            }

            // --- Study Pass ---
            console.time("Rubberband Preprocess Study");
            let framesLeft = inputLength;
            let offset = 0;
            while (framesLeft > 0) {
                const processNow = Math.min(blockSize, framesLeft);
                const isFinal = (processNow === framesLeft);
                for (let i = 0; i < channels; ++i) {
                    // Get subarray directly from AudioBuffer's channel data
                    inputBufRefs[i].view.set(buffer.getChannelData(i).subarray(offset, offset + processNow));
                }
                RBLib._rubberband_study(statePtr, inputPtrsRef.address, processNow, isFinal ? 1 : 0);
                framesLeft -= processNow;
                offset += processNow;
            }
            console.timeEnd("Rubberband Preprocess Study");

            // --- Process Pass ---
            console.time("Rubberband Preprocess Process");
            framesLeft = inputLength;
            offset = 0;
            const outputChunks = Array.from({ length: channels }, () => []);
            let totalOutputFrames = 0;
            let finalSent = false;
            let available = 0;

            while (framesLeft > 0 || !finalSent) {
                // --- Feed Input ---
                const processNow = Math.min(blockSize, framesLeft);
                const isFinal = (processNow > 0 && processNow === framesLeft) || (processNow === 0 && !finalSent);
                 if (processNow > 0) {
                    for (let i = 0; i < channels; ++i) {
                        inputBufRefs[i].view.set(buffer.getChannelData(i).subarray(offset, offset + processNow));
                    }
                    framesLeft -= processNow;
                    offset += processNow;
                 }

                 // --- Call Process ---
                 RBLib._rubberband_process(statePtr, inputPtrsRef.address, processNow, isFinal ? 1 : 0);
                 if (isFinal) finalSent = true;

                 // --- Retrieve ALL Available Output ---
                 do {
                     available = RBLib._rubberband_available(statePtr);
                     if (available > 0) {
                         const retrieveNow = Math.min(available, blockSize);
                         const retrieved = RBLib._rubberband_retrieve(statePtr, outputPtrsRef.address, retrieveNow);
                         if (retrieved > 0) {
                             totalOutputFrames += retrieved;
                             for (let i = 0; i < channels; ++i) {
                                 // Important: slice() creates a copy, necessary as the WASM buffer is reused
                                 outputChunks[i].push(outputBufRefs[i].view.slice(0, retrieved));
                             }
                         } else {
                              // If retrieve returns 0 but available > 0, something is wrong, break loop
                              console.warn("AudioApp (Preprocess): Retrieve returned 0 despite available > 0");
                              available = 0; // Force loop exit
                         }
                     }
                 } while (available > 0);

                 // --- Check Exit Condition ---
                 if (finalSent && available <= 0) {
                     break; // Exit main while loop
                 }
            } // End process loop
            console.timeEnd("Rubberband Preprocess Process");

            // --- Combine Output Chunks into AudioBuffer ---
            if (totalOutputFrames > 0) {
                 // Use the persistent audioCtx to create the final buffer
                 processedBuffer = audioCtx.createBuffer(channels, totalOutputFrames, sampleRate);
                 for (let i = 0; i < channels; ++i) {
                     const targetChannel = processedBuffer.getChannelData(i);
                     let currentOffset = 0;
                     for (const chunk of outputChunks[i]) {
                         targetChannel.set(chunk, currentOffset);
                         currentOffset += chunk.length;
                     }
                 }
                 // Verification
                 const expectedFrames = Math.round(inputLength * stretchRatio);
                 console.log(`AudioApp (Preprocess): Output ${totalOutputFrames} frames. Expected ~${expectedFrames}.`);
                 if (Math.abs(totalOutputFrames - expectedFrames) > blockSize * 2) { // Tolerance check
                     console.warn("AudioApp (Preprocess): Output length differs significantly from expected length.");
                 }
            } else {
                 // Handle case where processing yields no output (shouldn't happen for valid input)
                 throw new Error("Offline Rubberband processing yielded zero output frames.");
            }

        } catch (e) {
            console.error("AudioApp: Error during offline Rubberband processing:", e);
            throw new Error(`Failed to preprocess slow audio: ${e.message}`);
        } finally {
            // --- Cleanup WASM Resources ---
            if (statePtr && RBLib) {
                try { RBLib._rubberband_delete(statePtr); } catch (delErr) { console.error("Error deleting Rubberband instance:", delErr); }
            }
            // Free memory allocated via the manager
            wasmMemory?.freeAll();
            console.log("AudioApp (Preprocess): Cleaned up temporary Rubberband instance and memory.");
        }

        return processedBuffer; // Return the processed AudioBuffer
    }

     /**
     * Helper to load the Rubberband library directly on the main thread.
     * Needs the custom loader script text and the WASM binary.
     * @param {ArrayBuffer} wasmBinary
     * @param {string} loaderText
     * @returns {Promise<object|null>} The loaded WASM module exports, or null on failure.
     * @private
     */
     async function loadRubberbandLibraryDirectly(wasmBinary, loaderText) {
         console.log("AudioApp: Loading Rubberband library directly for offline use...");
         try {
             // Use 'new Function' to evaluate the loader script safely
             // This assumes the loader script assigns the async factory function to a global 'Rubberband' variable
             const getLoaderFactory = new Function(`${loaderText}; return Rubberband;`);
             const moduleFactory = getLoaderFactory(); // Get the factory function

             if (typeof moduleFactory !== 'function') {
                 throw new Error("Loader script did not define the expected 'Rubberband' async function factory.");
             }

             // Define the instantiation hook for direct loading
             const instantiateWasmDirect = (imports, successCallback) => {
                 console.log("AudioApp (Direct Load): instantiateWasm hook called.");
                 WebAssembly.instantiate(wasmBinary, imports)
                    .then(output => {
                        console.log("AudioApp (Direct Load): WASM instantiation successful.");
                        // The loader should call this callback with the final instance/module
                        successCallback(output.instance, output.module);
                    })
                    .catch(e => console.error("AudioApp (Direct Load): Direct WASM instantiation failed:", e));
                 return {}; // Emscripten loaders often expect an object back
             };

             // Call the factory/loader function, passing the hook
             // This assumes the loader function accepts an object with the instantiateWasm hook
             const loadedModule = await moduleFactory({ instantiateWasm: instantiateWasmDirect });

             if (!loadedModule || typeof loadedModule._malloc !== 'function') {
                 throw new Error("Loaded module is invalid or missing expected exports (_malloc).");
             }

             console.log("AudioApp: Rubberband library loaded directly.");
             return loadedModule; // Return the exports object

         } catch (e) {
             console.error("AudioApp: Failed to load Rubberband library directly:", e);
             return null; // Indicate failure
         }
     }

     /**
      * WasmMemoryManager Helper Class (defined within main.js scope for offline use)
      * @private
      */
     AudioApp.WasmMemoryManager = class WasmMemoryManager {
         constructor(wasmModuleInstance) {
             this.module = wasmModuleInstance;
             this.allocations = []; // Track allocated pointers for easy cleanup
             if (!this.module || typeof this.module._malloc !== 'function' || typeof this.module._free !== 'function') {
                 throw new Error("WasmMemoryManager: Invalid WASM module instance provided.");
             }
         }
         _alloc(sizeBytes, typeName = 'buffer') {
             const address = this.module._malloc(sizeBytes);
             if (!address) throw new Error(`WasmMemoryManager: _malloc(${sizeBytes}) failed for ${typeName}`);
             this.allocations.push(address);
             // console.log(`WMM Alloc: ${typeName} (${sizeBytes} bytes) at ${address}`);
             return address;
         }
         allocFloat32Array(length) {
             const sizeBytes = length * Float32Array.BYTES_PER_ELEMENT;
             const address = this._alloc(sizeBytes, 'Float32Array');
             // Ensure HEAPF32 is valid and buffer covers the allocated range
             if (!this.module.HEAPF32 || address + sizeBytes > this.module.HEAPF32.buffer.byteLength) {
                 throw new Error("WasmMemoryManager: WASM HEAPF32 buffer is invalid or too small for allocation.");
             }
             return { address, view: new Float32Array(this.module.HEAPF32.buffer, address, length), length };
         }
          allocUint32Array(length) {
             const sizeBytes = length * Uint32Array.BYTES_PER_ELEMENT;
             const address = this._alloc(sizeBytes, 'Uint32Array');
             if (!this.module.HEAPU32 || address + sizeBytes > this.module.HEAPU32.buffer.byteLength) {
                 throw new Error("WasmMemoryManager: WASM HEAPU32 buffer is invalid or too small for allocation.");
             }
             return { address, view: new Uint32Array(this.module.HEAPU32.buffer, address, length), length };
         }
         // Add other types like allocUint8Array if needed

         freeAll() {
             // console.log(`WMM Freeing ${this.allocations.length} allocations...`);
             this.allocations.forEach(addr => {
                 try { this.module._free(addr); } catch (e) { console.error(`WMM Free Error at ${addr}:`, e); }
             });
             this.allocations = [];
         }
     };


    // --- AudioWorklet Management ---
    /**
     * Sets up the AudioWorklet node and connects it.
     * @private
     */
    async function setupAndStartWorklet() {
        // Check prerequisites
        if (!audioCtx || audioCtx.state === 'closed') throw new Error("AudioContext not ready for worklet setup.");
        if (!originalBuffer || !slowBuffer) throw new Error("Audio buffers not ready for worklet setup.");
        if (!rubberbandWasmBinary || !rubberbandLoaderText) throw new Error("Rubberband WASM assets not ready for worklet setup.");

        await cleanupWorkletNode(); // Ensure no previous node exists

        try {
            console.log(`AudioApp: Adding AudioWorklet module: ${AudioApp.config.HYBRID_PROCESSOR_PATH}`);
            await audioCtx.audioWorklet.addModule(AudioApp.config.HYBRID_PROCESSOR_PATH);
            console.log("AudioApp: AudioWorklet module added.");

            // Create a transferable copy of the WASM binary for the options
            const wasmBinaryTransfer = rubberbandWasmBinary.slice(0);

            // Get initial config values from UI Manager
            const currentConfig = AudioApp.uiManager.getCurrentConfig();
            const currentParams = AudioApp.uiManager.getCurrentParams(); // Also get initial playback params

            console.log("AudioApp: Creating AudioWorkletNode...");
            workletNode = new AudioWorkletNode(audioCtx, AudioApp.config.PROCESSOR_NAME, {
                numberOfInputs: 0, // The processor generates audio
                numberOfOutputs: 1, // Output to the speakers
                outputChannelCount: [originalBuffer.numberOfChannels], // Match source channel count
                processorOptions: {
                    // Essential parameters
                    sampleRate: audioCtx.sampleRate,
                    numberOfChannels: originalBuffer.numberOfChannels,
                    // Initial hybrid/playback settings
                    initialSlowSpeed: currentConfig.initialSlowSpeed,
                    initialHybridThreshold: currentConfig.hybridThreshold,
                    initialSpeed: currentParams.speed,
                    initialPitchSemitones: currentParams.pitchSemitones,
                    initialFormantScale: currentParams.formantScale,
                    initialSwitchBehavior: currentParams.switchBehavior,
                    initialSourceOverride: currentParams.sourceOverride,
                    microFadeDurationMs: AudioApp.config.MICROFADE_DURATION_MS,
                    // WASM Assets (binary transferred, text cloned)
                    wasmBinary: wasmBinaryTransfer,
                    loaderScriptText: rubberbandLoaderText
                }
            }); // Note: Transfer list only applies to postMessage, not processorOptions. Binary is copied.

            setupWorkletMessageListener(); // Setup handler for messages FROM worklet

            // Connect worklet output to the main audio context destination
            workletNode.connect(audioCtx.destination);
            console.log("AudioApp: AudioWorkletNode created and connected.");

            // Worklet is created but not 'ready' until it confirms via message
            workletReady = false;

        } catch (error) {
            console.error("AudioApp: Error setting up AudioWorklet:", error);
            await cleanupWorkletNode(); // Attempt cleanup if node was partially created
            throw new Error(`Failed to initialize audio engine: ${error.message}`);
        }
    }

    /**
     * Sets up the listener for messages coming FROM the AudioWorkletProcessor.
     * @private
     */
    function setupWorkletMessageListener() {
        if (!workletNode) return;

        workletNode.port.onmessage = (event) => {
            const data = event.data;
            // console.log(`[Main] Msg from Worklet: ${data.type}`, data.message || data.currentTime || ''); // Debugging

            switch (data.type) {
                case 'status':
                    console.log(`[WorkletStatus] ${data.message}`);
                    if (data.message === 'processor-ready') {
                        workletReady = true;
                        console.log("AudioApp: Worklet processor reported ready.");
                        // Now safe to send initial audio data if available
                        if (originalBuffer && slowBuffer && !audioReady) { // Check audioReady to prevent double-send
                            // This might be called before handleFileSelected finishes transferring,
                            // which is fine; transferAudioDataToWorklet handles checks.
                            // console.log("Attempting data transfer triggered by processor-ready");
                            // transferAudioDataToWorklet(originalBuffer, slowBuffer);
                        } else if (audioReady) {
                            console.log("Worklet ready, audio already sent.");
                        }
                    } else if (data.message === 'Playback ended') {
                        if (isPlaying) { // Only react if main thread thought it was playing
                            console.log("AudioApp: Playback ended message received.");
                            isPlaying = false;
                            AudioApp.uiManager.setPlayButtonState(false);
                            // Optionally seek to start or update time display to duration
                             if (originalBuffer) {
                                 AudioApp.uiManager.updateTimeDisplay(originalBuffer.duration, originalBuffer.duration);
                                 AudioApp.visualizer.updateProgressIndicator(originalBuffer.duration, originalBuffer.duration);
                             }
                        }
                    } else if (data.message === 'Processor cleaned up') {
                        console.log("AudioApp: Worklet confirms cleanup.");
                        workletReady = false; // Mark as not ready after cleanup
                    }
                    break;

                case 'error':
                    console.error(`[WorkletError] ${data.message}`);
                    AudioApp.uiManager.showError(`Audio Engine Error: ${data.message}`, true);
                    // Trigger cleanup and reset state
                    isPlaying = false; audioReady = false; workletReady = false;
                    AudioApp.uiManager.enableControls(false);
                    cleanupWorkletNode(); // Attempt safe cleanup
                    break;

                case 'playback-state':
                    // Optional: Synchronize UI if worklet state differs from main thread's desired state
                    // console.log(`[Main] Worklet confirms playing state: ${data.isPlaying}`);
                    if (isPlaying !== data.isPlaying) {
                        console.warn("AudioApp: Worklet playback state desynced! Updating UI.");
                        isPlaying = data.isPlaying; // Sync main thread state to worklet reality
                        AudioApp.uiManager.setPlayButtonState(isPlaying);
                    }
                    break;

                case 'time-update':
                     // Receive current conceptual time from worklet for UI updates
                     if(audioReady && originalBuffer && !isNaN(data.currentTime)) {
                        const currentTime = Math.max(0, Math.min(data.currentTime, originalBuffer.duration));
                        AudioApp.uiManager.updateTimeDisplay(currentTime, originalBuffer.duration);
                        AudioApp.visualizer.updateProgressIndicator(currentTime, originalBuffer.duration);
                     }
                    break;

                default:
                    console.warn("[Main] Unhandled message from worklet:", data);
            }
        };

        workletNode.onprocessorerror = (event) => {
            // This handles unrecoverable errors within the processor itself
            console.error("[Main] Unrecoverable AudioWorklet processor error:", event);
            AudioApp.uiManager.showError("Critical Audio Engine Failure! Please reload.", true);
            // Reset everything, worklet is likely dead
            isPlaying = false; audioReady = false; workletReady = false;
            AudioApp.uiManager.enableControls(false);
            cleanupWorkletNode();
            // Close context? Maybe not automatically, let user reload page.
        };
    }

    /**
     * Transfers audio buffer data (original and slow) to the worklet via postMessage.
     * Uses Transferable objects for efficiency.
     * @param {AudioBuffer} origBuf
     * @param {AudioBuffer} slowBuf
     * @private
     */
     function transferAudioDataToWorklet(origBuf, slowBuf) {
         if (!workletNode) {
             console.error("AudioApp: Cannot transfer audio data - Worklet node not available.");
             return;
         }
         if (!workletReady) {
             console.warn("AudioApp: Worklet not ready yet, delaying audio data transfer.");
             // Consider setting a flag to transfer when 'processor-ready' is received.
             // For now, assume this is called *after* worklet is ready.
             return;
         }
          if (audioReady) {
             console.warn("AudioApp: Audio data already transferred or marked ready, skipping transfer.");
             return; // Prevent re-transferring
         }
         if (!origBuf || !slowBuf) {
             console.error("AudioApp: Cannot transfer audio data - Buffers missing.");
             return;
         }

         console.log("AudioApp: Transferring audio data to worklet...");
         const transferList = [];
         const originalChannelData = [];
         const slowChannelData = [];

         try {
             const numChannels = origBuf.numberOfChannels;
             if (numChannels !== slowBuf.numberOfChannels) {
                 throw new Error("Original and slow buffers have different channel counts.");
             }

             for (let i = 0; i < numChannels; i++) {
                 // Original Buffer Data
                 const origData = origBuf.getChannelData(i);
                 // Create a transferable copy of the underlying ArrayBuffer section
                 const origCopy = origData.buffer.slice(origData.byteOffset, origData.byteOffset + origData.byteLength);
                 originalChannelData.push(origCopy);
                 transferList.push(origCopy); // Add the copy to the transfer list

                 // Slow Buffer Data
                 const slowData = slowBuf.getChannelData(i);
                 const slowCopy = slowData.buffer.slice(slowData.byteOffset, slowData.byteOffset + slowData.byteLength);
                 slowChannelData.push(slowCopy);
                 transferList.push(slowCopy);
             }

             // Send the message with the copies and the transfer list
             postWorkletMessage({
                 type: 'load-audio',
                 originalChannels: originalChannelData,
                 slowChannels: slowChannelData
             }, transferList);

              console.log(`AudioApp: Transferred ${numChannels} channel pairs of audio buffers.`);
              // Note: audioReady will be set true during the pipeline *after* this call succeeds.

         } catch (error) {
             console.error("AudioApp: Error preparing audio data for transfer:", error);
             AudioApp.uiManager.showError(`Failed to send audio data to engine: ${error.message}`);
             // Should trigger cleanup? Potentially.
             throw error; // Re-throw to be caught by pipeline handler
         }
     }


    // --- UI Event Handlers ---

    /** Handles play/pause button click. Assumes context/worklet are ready. @private */
    async function handlePlayPause() {
        if (!audioReady || !workletReady || !audioCtx) {
            console.warn("AudioApp: Cannot play/pause - audio/worklet not ready.");
            return;
        }

        // Ensure AudioContext is running (required for worklet processing)
        if (audioCtx.state === 'suspended') {
            console.log("AudioApp: Resuming AudioContext on play...");
            try {
                await audioCtx.resume();
                if (audioCtx.state !== 'running') throw new Error("Context did not resume.");
            } catch (e) {
                AudioApp.uiManager.showError(`Audio Playback Error: Could not resume AudioContext. ${e.message}`, true);
                return; // Prevent sending message if context failed
            }
        }

        // Toggle desired state and send message to worklet
        isPlaying = !isPlaying;
        postWorkletMessage({ type: isPlaying ? 'play' : 'pause' });
        AudioApp.uiManager.setPlayButtonState(isPlaying); // Update UI immediately
        console.log(`AudioApp: Playback ${isPlaying ? 'requested' : 'paused'}.`);
    }

    /** Handles jump button clicks. @private */
    function handleJump(e) {
        if (!audioReady || !workletReady) return;
        console.log(`AudioApp: Jump by ${e.detail.seconds}s requested.`);
        postWorkletMessage({ type: 'jump', seconds: e.detail.seconds });
        // Note: Actual time update will come back from the worklet via 'time-update' message.
        // We could optimistically update the UI here, but it might jump back if worklet adjusts.
    }

     /** Handles seek requests from visualizer clicks. @private */
    function handleSeek(e) {
        if (!audioReady || !workletReady || !originalBuffer) return;
        const targetTime = e.detail.fraction * originalBuffer.duration;
        console.log(`AudioApp: Seek to ${targetTime.toFixed(2)}s requested.`);
        postWorkletMessage({ type: 'seek', positionSeconds: targetTime });
         // Optimistically update UI immediately for better responsiveness
         AudioApp.uiManager.updateTimeDisplay(targetTime, originalBuffer.duration);
         AudioApp.visualizer.updateProgressIndicator(targetTime, originalBuffer.duration);
    }

    /** Handles changes from parameter sliders/selectors. Sends all params. @private */
    function handleParameterChange(e) {
         if (!audioReady || !workletReady) return;
         // console.log(`AudioApp: Parameter change detected - ${e.detail.param}: ${e.detail.value}`);
         // Get *all* current parameter values from UI to send in one message
         const params = AudioApp.uiManager.getCurrentParams();
         postWorkletMessage({ type: 'set-params', params: params });
    }

     /** Handles changes from VAD tuning sliders. Triggers VAD recalc and visual update. @private */
    function handleVadThresholdChange(e) {
         if (!vadResults || !originalBuffer) {
            console.warn("AudioApp: Cannot handle VAD threshold change - VAD results missing.");
            return; // Ignore if VAD hasn't run successfully
         }
         const { type, value } = e.detail;
         // Update analyzer, which recalculates and stores the new regions
         const newRegions = AudioApp.vadAnalyzer.handleThresholdUpdate(type, value);
         // Update UI text display with new regions
         AudioApp.uiManager.setSpeechRegionsText(newRegions);
         // Redraw waveform highlight *only* using the new regions
         AudioApp.visualizer.redrawWaveformHighlight(originalBuffer, newRegions);
    }

     /** Handles keyboard shortcuts. @private */
     function handleKeyPress(e) {
         // Only handle if audio is loaded and ready for playback commands
         if (!audioReady) return;

         const key = e.detail.key;
         const jumpTime = AudioApp.uiManager.getCurrentConfig().jumpTime; // Get current jump time

         switch (key) {
             case 'Space':
                 handlePlayPause(); // Reuse existing play/pause handler
                 break;
             case 'ArrowLeft':
                 if (workletReady) postWorkletMessage({ type: 'jump', seconds: -jumpTime });
                 break;
             case 'ArrowRight':
                 if (workletReady) postWorkletMessage({ type: 'jump', seconds: jumpTime });
                 break;
         }
     }

    // --- Window Event Handlers ---
    /** Handles window resize, redraws visuals. @private */
    function handleWindowResize() {
         // Get current regions from the analyzer
         const currentRegions = AudioApp.vadAnalyzer.getCurrentRegions();
         // Ask visualizer to resize and redraw
         AudioApp.visualizer.resizeAndRedraw(originalBuffer, currentRegions);

         // Update progress indicator position immediately after resize
         if (originalBuffer) {
             // Get last known time from UI (simplest approach without querying worklet)
             const times = AudioApp.uiManager.getCurrentTimes();
             AudioApp.visualizer.updateProgressIndicator(times.currentTime, times.duration);
         }
    }

    /** Handles page unload, triggers cleanup. @private */
    function handleBeforeUnload() {
        if (!cleanupScheduled) {
            console.log("AudioApp: Initiating cleanup on page unload...");
            cleanupScheduled = true;
            // Perform thorough cleanup, including closing the AudioContext
            cleanupCurrentAudio(true); // Pass true to close context
        }
    }

    // --- Worklet Communication Helper ---
    /**
     * Sends a message to the AudioWorkletNode, handling potential errors.
     * @param {object} message - The message object.
     * @param {Transferable[]} [transferList=[]] - Array of transferable objects.
     * @private
     */
    function postWorkletMessage(message, transferList = []) {
        if (workletNode && workletNode.port && workletNode.port instanceof MessagePort) { // Extra check
            try {
                // console.log(`[Main] Posting message to worklet: ${message.type}`); // Verbose debugging
                workletNode.port.postMessage(message, transferList);
            } catch (error) {
                // Handle common errors like detached port or transfer list issues
                console.error(`[Main] Error posting message type ${message.type}:`, error);
                AudioApp.uiManager.showError(`Communication error with audio engine: ${error.message}`, true);
                // If communication fails consistently, might need to reset/cleanup
                // Consider cleanupCurrentAudio(); here if errors persist.
            }
        } else {
             // Don't log error if worklet just isn't ready yet or already cleaned up
             if (workletReady && workletNode) { // Only warn if we expected it to be available
                 console.warn(`[Main] Cannot post message type ${message.type}: Worklet port not available or closed?`);
             }
        }
    }

    // --- Cleanup Logic ---
    /**
     * Cleans up resources associated with the current audio file, worklet, and optionally context.
     * @param {boolean} [closeContext=false] - If true, also closes the main AudioContext.
     * @private
     */
    async function cleanupCurrentAudio(closeContext = false) {
        console.log(`AudioApp: Cleaning up audio resources... (Close Context: ${closeContext})`);
        isPlaying = false;
        audioReady = false; // Mark as not ready
        // workletReady will be set false by cleanupWorkletNode or its confirmation message

        // Stop worklet processing and disconnect node
        await cleanupWorkletNode();

        // Clear stored buffer/analysis data
        originalBuffer = null;
        slowBuffer = null;
        pcm16k = null;
        vadResults = null;
        currentFile = null;

        // Clear visuals and UI state related to audio
        AudioApp.visualizer?.clearVisuals();
        AudioApp.uiManager?.resetUI(); // Reset UI to initial state

        // Close the main AudioContext only if requested (usually on page unload)
        if (closeContext && audioCtx && audioCtx.state !== 'closed') {
            console.log("AudioApp: Closing persistent AudioContext...");
            try {
                await audioCtx.close();
                console.log("AudioApp: AudioContext closed.");
            } catch (e) {
                 console.warn("AudioApp: Error closing AudioContext:", e);
            } finally {
                 audioCtx = null; // Ensure reference is cleared
            }
        }
        console.log("AudioApp: Resource cleanup finished.");
    }

     /**
      * Safely cleans up the worklet node by sending a cleanup message,
      * closing the port, and disconnecting.
      * @private
      */
     async function cleanupWorkletNode() {
        if (workletNode) {
            const nodeToClean = workletNode; // Capture current node reference
            workletNode = null; // Prevent new messages being sent to the old node
            workletReady = false; // Mark as not ready immediately
            console.log("AudioApp: Cleaning up existing AudioWorkletNode...");
            try {
                // Send cleanup command to the processor
                if (nodeToClean.port && nodeToClean.port instanceof MessagePort) {
                     nodeToClean.port.postMessage({ type: 'cleanup' });
                     // Optional: Wait briefly for message to be potentially processed
                     // await new Promise(resolve => setTimeout(resolve, 30));
                     nodeToClean.port.close(); // Close the communication channel
                }
                nodeToClean.disconnect(); // Disconnect from audio graph
                console.log("AudioApp: Worklet node disconnected and port closed.");
            } catch (e) {
                // Log errors but continue, node reference is already cleared
                console.warn("AudioApp: Error during worklet node cleanup:", e);
            }
        } else {
             // console.log("AudioApp: No active worklet node to clean up.");
        }
     }


    // --- Public Interface ---
    // Only expose the main initialization function.
    // All other interactions are driven by events.
    return {
        init: init
    };
})(); // End of AudioApp IIFE

// --- /vibe-player/main.js ---
