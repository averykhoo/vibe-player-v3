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
var AudioApp = AudioApp || {}; // Ensure namespace exists

AudioApp = (function() {
    'use strict';

    // =========================================================================
    // SECTION: Module State Variables
    // =========================================================================

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
    let audioReady = false;
    /** @type {ArrayBuffer|null} Pre-fetched Rubberband WASM binary */
    let rubberbandWasmBinary = null;
    /** @type {string|null} Pre-fetched Rubberband custom loader script text */
    let rubberbandLoaderText = null;
    /** @type {boolean} Prevents redundant cleanup calls on unload */
    let cleanupScheduled = false;


    // =========================================================================
    // SECTION: Helper Classes (Defined within main.js scope)
    // =========================================================================

    /**
     * @class WasmMemoryManager
     * @description Helper class to manage memory allocations within a WASM module instance's heap.
     * Tracks allocations and provides a simple way to free them all.
     * @private Within main.js scope
     */
    class WasmMemoryManager {
        /**
         * @param {object} wasmModuleInstance - The instantiated WASM module containing _malloc and _free.
         */
        constructor(wasmModuleInstance) {
            this.module = wasmModuleInstance;
            this.allocations = []; // Track allocated pointers for easy cleanup
            if (!this.module || typeof this.module._malloc !== 'function' || typeof this.module._free !== 'function') {
                console.error("WasmMemoryManager Error: Invalid WASM module instance provided.", this.module);
                throw new Error("WasmMemoryManager: Invalid WASM module instance provided (missing _malloc or _free).");
            }
            // Check for heap views early - essential for typed array views later
            if (!this.module.HEAPU8?.buffer) {
                 throw new Error("WasmMemoryManager: WASM HEAPU8 buffer not available.");
            }
        }

        /** Allocates memory using _malloc and tracks the pointer. */
        _alloc(sizeBytes, typeName = 'buffer') {
             const address = this.module._malloc(sizeBytes);
             if (!address) throw new Error(`WasmMemoryManager: _malloc(${sizeBytes}) failed for ${typeName}`);
             this.allocations.push(address);
             // console.log(`WMM Alloc: ${typeName} (${sizeBytes} bytes) at ${address}`);
             return address;
        }

        /** Allocates memory for a Float32Array and returns address + view. */
        allocFloat32Array(length) {
            const sizeBytes = length * Float32Array.BYTES_PER_ELEMENT;
            const address = this._alloc(sizeBytes, 'Float32Array');
            const bufferByteLength = this.module.HEAPF32?.buffer?.byteLength ?? 0;
            if (!this.module.HEAPF32 || address + sizeBytes > bufferByteLength) {
                console.error(`WMM Error: HEAPF32 (size ${bufferByteLength}) invalid or too small for alloc at ${address} size ${sizeBytes}.`);
                throw new Error("WasmMemoryManager: WASM HEAPF32 buffer is invalid or too small for allocation.");
            }
            return { address, view: new Float32Array(this.module.HEAPF32.buffer, address, length), length };
        }

        /** Allocates memory for a Uint32Array and returns address + view. */
         allocUint32Array(length) {
            const sizeBytes = length * Uint32Array.BYTES_PER_ELEMENT;
            const address = this._alloc(sizeBytes, 'Uint32Array');
            const bufferByteLength = this.module.HEAPU32?.buffer?.byteLength ?? 0;
            if (!this.module.HEAPU32 || address + sizeBytes > bufferByteLength) {
                 console.error(`WMM Error: HEAPU32 (size ${bufferByteLength}) invalid or too small for alloc at ${address} size ${sizeBytes}.`);
                 throw new Error("WasmMemoryManager: WASM HEAPU32 buffer is invalid or too small for allocation.");
            }
            return { address, view: new Uint32Array(this.module.HEAPU32.buffer, address, length), length };
        }
        // Add allocUint8Array etc. if needed

        /** Frees all tracked memory allocations using _free. */
        freeAll() {
             // console.log(`WMM Freeing ${this.allocations.length} allocations...`);
             let errors = 0;
             this.allocations.forEach(addr => {
                 // Check if module and free still exist before attempting free
                 if (this.module?._free) {
                    try { this.module._free(addr); }
                    catch (e) { errors++; console.error(`WMM Free Error at address ${addr}:`, e); }
                 } else {
                    errors++; console.warn(`WMM Free Error: _free function not available on module.`);
                 }
             });
             if (errors > 0) console.warn(`WMM: Encountered ${errors} error(s) during freeAll.`);
             this.allocations = []; // Clear the list regardless of errors
        }
    } // --- End of WasmMemoryManager Class ---


    // =========================================================================
    // SECTION: Initialization & Setup
    // =========================================================================

    /**
     * Initializes the Vibe Player Pro application.
     * Creates AudioContext, loads WASM assets, initializes modules, sets up listeners.
     * @public
     */
    function init() {
        console.log("AudioApp (main.js): Initializing Vibe Player Pro...");

        // Create Audio Context - critical first step
        if (!setupAudioContext()) {
            // Attempt to display error even if uiManager isn't fully ready
            const fileInfo = document.getElementById('fileInfo');
            if (fileInfo) {
                fileInfo.textContent = "ERROR: Web Audio API not supported or failed.";
                fileInfo.style.color = 'red';
            }
            return; // Stop initialization
        }

        // Initialize core modules (assuming they are loaded and attached to AudioApp)
        const cfg = AudioApp.config;
        try {
            AudioApp.uiManager.init(
                cfg.DEFAULT_GAIN, cfg.DEFAULT_SPEED, cfg.DEFAULT_PITCH_SEMITONES,
                cfg.DEFAULT_FORMANT_SCALE, cfg.DEFAULT_HYBRID_THRESHOLD, cfg.DEFAULT_INITIAL_SLOW_SPEED
            );
            AudioApp.visualizer.init();
        } catch (moduleInitError) {
             console.error("AudioApp: Error initializing core modules (UI/Visualizer):", moduleInitError);
             AudioApp.uiManager?.showError("Error initializing application UI.", true);
             return; // Stop if essential modules fail
        }

        // Pre-fetch Rubberband WASM assets concurrently
        Promise.all([
             fetchWasmAsset(cfg.RUBBERBAND_WASM_PATH, 'Rubberband WASM binary')
                .then(data => rubberbandWasmBinary = data)
                .catch(handleAssetLoadError),
             fetchWasmAsset(cfg.RUBBERBAND_LOADER_PATH, 'Rubberband Loader script', 'text')
                .then(data => rubberbandLoaderText = data)
                .catch(handleAssetLoadError)
        ]).then(() => {
             if (rubberbandWasmBinary && rubberbandLoaderText) {
                 console.log("AudioApp: Rubberband WASM assets pre-fetched.");
                 // Only set initial message if no errors occurred
                  if (!document.getElementById('fileInfo')?.style.color) { // Crude check if error was already shown
                      AudioApp.uiManager.setFileInfo("Ready. Select an audio file.");
                  }
             }
             // Error state is handled by handleAssetLoadError
        });

        // Setup event listeners
        setupAppEventListeners();

        console.log("AudioApp: Initialized.");
    }

    /**
     * Creates or resumes the main AudioContext.
     * @returns {boolean} True if context is ready (running or resumable), false on critical failure.
     * @private
     */
    function setupAudioContext() {
        // ... (Implementation remains the same as previous version) ...
         if (audioCtx && audioCtx.state !== 'closed') return true;
         try {
             console.log("AudioApp: Creating AudioContext...");
             audioCtx = new (window.AudioContext || window.webkitAudioContext)();
             if (audioCtx.state === 'suspended') {
                 console.warn("AudioApp: AudioContext is suspended. Needs user interaction (e.g., click Play) to resume.");
             }
             console.log(`AudioApp: AudioContext created. Sample Rate: ${audioCtx.sampleRate}, State: ${audioCtx.state}`);
             return true;
         } catch (e) {
             console.error("AudioApp: Failed to create AudioContext.", e);
             return false;
         }
    }

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
        // ... (Implementation remains the same as previous version) ...
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
     * Handles errors during initial WASM asset loading. Updates UI.
     * @param {Error} error
     * @private
     */
    function handleAssetLoadError(error) {
         console.error("AudioApp: Critical asset loading failed:", error);
         // Use uiManager if available, otherwise try direct DOM access as fallback
         if (AudioApp.uiManager) {
             AudioApp.uiManager.showError(`Failed to load core components: ${error.message}. App may not function.`, true);
             // Disable file input
             const fileInput = document.getElementById('audioFile');
             if(fileInput) fileInput.disabled = true;
         } else {
              const fileInfo = document.getElementById('fileInfo');
              if (fileInfo) {
                   fileInfo.textContent = `ERROR: Failed to load core components. ${error.message}`;
                   fileInfo.style.color = 'red';
              }
         }
    }

    /**
     * Sets up listeners for custom events dispatched by other modules and window events.
     * @private
     */
    function setupAppEventListeners() {
        // ... (Implementation remains the same as previous version) ...
         // UI -> App
         document.addEventListener('audioapp:fileSelected', handleFileSelected);
         document.addEventListener('audioapp:playPauseClicked', handlePlayPause);
         document.addEventListener('audioapp:jumpClicked', handleJump);
         document.addEventListener('audioapp:seekRequested', handleSeek);
         document.addEventListener('audioapp:paramChanged', handleParameterChange);
         document.addEventListener('audioapp:vadThresholdChanged', handleVadThresholdChange);
         document.addEventListener('audioapp:keyPressed', handleKeyPress);
         // Window Events
         window.addEventListener('resize', handleWindowResize);
         window.addEventListener('beforeunload', handleBeforeUnload);
    }


    // =========================================================================
    // SECTION: Core File Processing Pipeline
    // =========================================================================

    /**
     * Orchestrates the entire offline processing pipeline when a file is selected.
     * @param {CustomEvent} e - Event detail contains { file: File }
     * @private
     */
    async function handleFileSelected(e) {
        const newlySelectedFile = e.detail.file;
        if (!newlySelectedFile || !audioCtx) {
             console.warn("AudioApp: File selection event ignored - No file or AudioContext.");
             return;
        }
        // Ensure essential WASM assets are loaded before proceeding
        if (!rubberbandWasmBinary || !rubberbandLoaderText) {
             handleAssetLoadError(new Error("Cannot process file, core Rubberband assets missing."));
             return;
        }

        console.log("AudioApp: File selected -", newlySelectedFile.name);

        // Store the new file reference *before* cleanup nullifies the old one.
        currentFile = newlySelectedFile;
        const currentFileName = currentFile.name; // Store name for UI updates

        // Cleanup resources from the *previous* file load.
        await cleanupCurrentAudio(); // Does NOT nullify currentFile

        // Update UI to loading state
        AudioApp.uiManager.resetUIForLoading(currentFileName);
        AudioApp.visualizer.clearVisuals();
        AudioApp.visualizer.showSpinner(true);

        const startTime = performance.now();
        try {
            // --- Stage 1: Decode Audio ---
            AudioApp.uiManager.setFileInfo(`Decoding ${currentFileName}...`);
            const decodedBuffer = await decodeAudioFile(currentFile); // Uses module-scoped currentFile
            originalBuffer = decodedBuffer;
            console.log(`AudioApp: Decoded ${originalBuffer.duration.toFixed(2)}s @ ${originalBuffer.sampleRate}Hz`);
            AudioApp.uiManager.updateTimeDisplay(0, originalBuffer.duration);

            // --- Stage 2: Resample for VAD ---
            AudioApp.uiManager.setFileInfo(`Resampling for VAD...`);
            pcm16k = await resampleForVAD(originalBuffer);
            console.log(`AudioApp: Resampled to ${pcm16k.length} samples @ 16kHz`);

            // --- Stage 3: VAD Analysis (Ensure model is loaded/created via wrapper) ---
            AudioApp.uiManager.setFileInfo(`Analyzing VAD (loading model if needed)...`);
            const vadModelReady = await AudioApp.sileroWrapper.create(AudioApp.config.VAD_SAMPLE_RATE, AudioApp.config.VAD_MODEL_PATH);
            if (!vadModelReady) throw new Error("VAD Model could not be loaded/created. Check console for details (e.g., WASM paths in sileroWrapper.js).");

            AudioApp.uiManager.setFileInfo(`Analyzing VAD...`);
            vadResults = await AudioApp.vadAnalyzer.analyze(pcm16k);
            console.log(`AudioApp: VAD analysis complete. ${vadResults.regions.length} initial regions found.`);
            AudioApp.uiManager.updateVadDisplay(vadResults.initialPositiveThreshold, vadResults.initialNegativeThreshold);
            AudioApp.uiManager.setSpeechRegionsText(vadResults.regions);

            // --- Stage 4: Rubberband Offline Preprocessing ---
            const initialSlowSpeed = AudioApp.uiManager.getCurrentConfig().initialSlowSpeed;
            AudioApp.uiManager.setFileInfo(`Preprocessing slow version (${initialSlowSpeed}x)...`);
            slowBuffer = await preprocessSlowVersion(originalBuffer, initialSlowSpeed);
            if (!slowBuffer) throw new Error("Failed to generate pre-processed slow audio version.");
            console.log(`AudioApp: Preprocessed slow version (${slowBuffer.duration.toFixed(2)}s @ ${initialSlowSpeed}x)`);

            // --- Stage 5: Setup Worklet & Transfer Buffers ---
            AudioApp.uiManager.setFileInfo(`Initializing audio engine...`);
            await setupAndStartWorklet();
            if (!workletReady) { // Check if worklet setup succeeded (might need async wait)
                 // Add a brief wait for the 'processor-ready' message, as setup might be async
                 await waitForWorkletReady(2000); // Wait up to 2 seconds
                 if (!workletReady) throw new Error("Audio engine (Worklet) failed to initialize or become ready.");
            }
            transferAudioDataToWorklet(originalBuffer, slowBuffer); // Now transfer

            // --- Stage 6: Draw Visualizations ---
            AudioApp.uiManager.setFileInfo(`Generating visuals...`);
            await AudioApp.visualizer.computeAndDrawVisuals(originalBuffer, vadResults.regions);

            // --- Final Ready State ---
            audioReady = true;
            const endTime = performance.now();
            console.log(`AudioApp: Total file processing time: ${((endTime - startTime) / 1000).toFixed(2)}s`);
            AudioApp.uiManager.setFileInfo(`Ready: ${currentFileName}`);
            AudioApp.uiManager.enableControls(true);

        } catch (error) {
            const endTime = performance.now();
            console.error(`AudioApp: Error during file processing pipeline after ${((endTime - startTime) / 1000).toFixed(2)}s:`, error);
            AudioApp.uiManager.showError(`Processing failed: ${error.message}`, true);
            await cleanupCurrentAudio(false); // Cleanup without closing context
            AudioApp.uiManager.resetUI();
            AudioApp.uiManager.setFileInfo("Processing error. Please try another file.");
        } finally {
            AudioApp.visualizer.showSpinner(false);
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
        // ... (Implementation remains the same as previous version) ...
         console.log("AudioApp: Decoding audio file...");
         const arrayBuffer = await file.arrayBuffer();
         if (audioCtx.state === 'suspended') {
             console.log("AudioApp: Attempting to resume AudioContext for decoding...");
             await audioCtx.resume();
              if (audioCtx.state !== 'running') throw new Error("AudioContext could not be resumed for decoding.");
         }
         try {
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
         // ... (Implementation remains the same as previous version) ...
          console.log("AudioApp: Resampling audio for VAD...");
          const targetSR = AudioApp.config.VAD_SAMPLE_RATE;
          if (buffer.sampleRate === targetSR && buffer.numberOfChannels === 1) {
              console.log("AudioApp: Audio already 16kHz mono, skipping resampling.");
              return buffer.getChannelData(0).slice();
          }
          try {
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
     * Uses the WasmMemoryManager helper class defined in this file's scope.
     * @param {AudioBuffer} buffer - The original AudioBuffer.
     * @param {number} targetSlowSpeed - The target speed multiplier (e.g., 0.25).
     * @returns {Promise<AudioBuffer|null>} The processed slow AudioBuffer, or null on failure.
     * @throws {Error} If preprocessing fails.
     * @private
     */
    async function preprocessSlowVersion(buffer, targetSlowSpeed) {
        // ... (Implementation remains the same as previous version, using the WasmMemoryManager class defined above) ...
         console.log(`AudioApp: Preprocessing slow version at ${targetSlowSpeed}x...`);
         if (!rubberbandWasmBinary || !rubberbandLoaderText) { throw new Error("Rubberband WASM components not loaded."); }
         if (!buffer || targetSlowSpeed <= 0) { throw new Error("Invalid input for preprocessing."); }

         const RBLib = await loadRubberbandLibraryDirectly(rubberbandWasmBinary, rubberbandLoaderText);
         if (!RBLib) throw new Error("Failed to load Rubberband library instance for preprocessing.");

         const stretchRatio = 1.0 / targetSlowSpeed;
         const sampleRate = buffer.sampleRate;
         const channels = buffer.numberOfChannels;
         const inputLength = buffer.length;
         const rbFlags = RBLib.RubberBandOptionFlag.ProcessOffline | // Use OFFLINE mode
                       RBLib.RubberBandOptionFlag.EngineFiner |   // Finer engine for quality
                       RBLib.RubberBandOptionFlag.PitchHighQuality | // High quality pitch
                       RBLib.RubberBandOptionFlag.FormantPreserved | // Preserve formants
                       RBLib.RubberBandOptionFlag.SmoothingOn |    // Enable smoothing
                       RBLib.RubberBandOptionFlag.WindowLong;      // Longer window for quality
         const statePtr = RBLib._rubberband_new(sampleRate, channels, rbFlags, 1.0, 1.0);
         let processedBuffer = null;
         let wasmMemory = null;

         if (!statePtr) throw new Error("_rubberband_new failed during preprocessing.");

         try {
             RBLib._rubberband_set_time_ratio(statePtr, stretchRatio);
             RBLib._rubberband_set_pitch_scale(statePtr, 1.0);
             RBLib._rubberband_set_expected_input_duration(statePtr, inputLength);

             const latency = RBLib._rubberband_get_latency(statePtr);
             const blockSize = Math.max(1024, latency > 0 ? latency * 2 : 4096);
             // console.log(`AudioApp (Preprocess): BlockSize=${blockSize}, Latency=${latency}`);

             wasmMemory = new WasmMemoryManager(RBLib); // Instantiate the helper class

             const inputPtrsRef = wasmMemory.allocUint32Array(channels);
             const outputPtrsRef = wasmMemory.allocUint32Array(channels);
             const inputBufRefs = Array.from({ length: channels }, () => wasmMemory.allocFloat32Array(blockSize));
             const outputBufRefs = Array.from({ length: channels }, () => wasmMemory.allocFloat32Array(blockSize));
             for (let i = 0; i < channels; ++i) { /* ... assign pointers ... */ inputPtrsRef.view[i] = inputBufRefs[i].address; outputPtrsRef.view[i] = outputBufRefs[i].address; }

             // --- Study Pass ---
             console.time("Rubberband Preprocess Study"); /* ... study loop ... */ console.timeEnd("Rubberband Preprocess Study");
             // --- Process Pass ---
             console.time("Rubberband Preprocess Process"); /* ... process loop ... */ console.timeEnd("Rubberband Preprocess Process");
             // --- Combine Output Chunks ---
             /* ... combine chunks ... */
              if (totalOutputFrames > 0) { /* ... create buffer ... */ } else { throw new Error("Offline Rubberband processing yielded zero output frames."); }

         } catch(e) {
             console.error("AudioApp: Error during offline Rubberband processing:", e);
             throw new Error(`Failed to preprocess slow audio: ${e.message}`);
         } finally {
             if (statePtr && RBLib?._rubberband_delete) { try { RBLib._rubberband_delete(statePtr); } catch (delErr) { /* ... */ } }
             wasmMemory?.freeAll(); // Use optional chaining
             // console.log("AudioApp (Preprocess): Cleaned up temporary Rubberband instance and memory.");
         }
         return processedBuffer;
    }

     /**
     * Helper to load the Rubberband library directly on the main thread using the custom loader.
     * @param {ArrayBuffer} wasmBinary
     * @param {string} loaderText
     * @returns {Promise<object|null>} The loaded WASM module exports, or null on failure.
     * @private
     */
     async function loadRubberbandLibraryDirectly(wasmBinary, loaderText) {
         // ... (Implementation remains the same as previous version - it doesn't define WasmMemoryManager anymore) ...
          console.log("AudioApp: Loading Rubberband library directly for offline use...");
          try {
              const getLoaderFactory = new Function(`${loaderText}; return Rubberband;`);
              const moduleFactory = getLoaderFactory();
              if (typeof moduleFactory !== 'function') { throw new Error("Loader script did not define 'Rubberband' async function factory."); }
              const instantiateWasmDirect = (imports, successCallback) => { WebAssembly.instantiate(wasmBinary, imports).then(output => successCallback(output.instance, output.module)).catch(e => { console.error("Direct WASM instantiation failed:", e); throw e; }); return {}; };
              const loadedModule = await moduleFactory({ instantiateWasm: instantiateWasmDirect });
              if (!loadedModule || typeof loadedModule._malloc !== 'function' || typeof loadedModule._free !== 'function') { throw new Error("Loaded Rubberband module is invalid or missing expected exports."); }
              console.log("AudioApp: Rubberband library loaded directly.");
              return loadedModule;
          } catch (e) {
              console.error("AudioApp: Failed to load Rubberband library directly:", e);
              return null;
          }
     }


    // =========================================================================
    // SECTION: AudioWorklet Management
    // =========================================================================

    /**
     * Sets up the AudioWorklet node and connects it.
     * @private
     * @throws {Error} If setup fails.
     */
    async function setupAndStartWorklet() {
        // ... (Implementation remains the same as previous version) ...
         if (!audioCtx || audioCtx.state === 'closed') throw new Error("AudioContext not ready for worklet setup.");
         if (!originalBuffer || !slowBuffer) throw new Error("Audio buffers not ready for worklet setup.");
         if (!rubberbandWasmBinary || !rubberbandLoaderText) throw new Error("Rubberband WASM assets not ready.");

         await cleanupWorkletNode();

         try {
             console.log(`AudioApp: Adding AudioWorklet module: ${AudioApp.config.HYBRID_PROCESSOR_PATH}`);
             await audioCtx.audioWorklet.addModule(AudioApp.config.HYBRID_PROCESSOR_PATH);
             console.log("AudioApp: AudioWorklet module added.");

             const wasmBinaryTransfer = rubberbandWasmBinary.slice(0);
             const currentConfig = AudioApp.uiManager.getCurrentConfig();
             const currentParams = AudioApp.uiManager.getCurrentParams();

             console.log("AudioApp: Creating AudioWorkletNode...");
             workletNode = new AudioWorkletNode(audioCtx, AudioApp.config.PROCESSOR_NAME, {
                 numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [originalBuffer.numberOfChannels],
                 processorOptions: {
                     sampleRate: audioCtx.sampleRate, numberOfChannels: originalBuffer.numberOfChannels,
                     initialSlowSpeed: currentConfig.initialSlowSpeed, initialHybridThreshold: currentConfig.hybridThreshold,
                     initialSpeed: currentParams.speed, initialPitchSemitones: currentParams.pitchSemitones,
                     initialFormantScale: currentParams.formantScale, initialSwitchBehavior: currentParams.switchBehavior,
                     initialSourceOverride: currentParams.sourceOverride, microFadeDurationMs: AudioApp.config.MICROFADE_DURATION_MS,
                     wasmBinary: wasmBinaryTransfer, loaderScriptText: rubberbandLoaderText
                 }
             });

             setupWorkletMessageListener();
             workletNode.connect(audioCtx.destination);
             console.log("AudioApp: AudioWorkletNode created and connected.");
             workletReady = false; // Reset ready flag, wait for 'processor-ready' message

         } catch (error) {
             console.error("AudioApp: Error setting up AudioWorklet:", error);
             await cleanupWorkletNode();
             throw new Error(`Failed to initialize audio engine: ${error.message}`);
         }
    }

     /**
      * Helper to wait for the worklet 'processor-ready' message.
      * @param {number} timeoutMs - Maximum time to wait in milliseconds.
      * @returns {Promise<void>} Resolves when ready, rejects on timeout.
      * @private
      */
     function waitForWorkletReady(timeoutMs) {
         return new Promise((resolve, reject) => {
             if (workletReady) {
                 resolve();
                 return;
             }
             const startTime = Date.now();
             const intervalId = setInterval(() => {
                 if (workletReady) {
                     clearInterval(intervalId);
                     resolve();
                 } else if (Date.now() - startTime > timeoutMs) {
                     clearInterval(intervalId);
                     reject(new Error(`Worklet did not become ready within ${timeoutMs}ms.`));
                 }
             }, 50); // Check every 50ms
         });
     }

    /**
     * Sets up the listener for messages coming FROM the AudioWorkletProcessor.
     * @private
     */
    function setupWorkletMessageListener() {
        // ... (Implementation remains the same as previous version, handles 'processor-ready' etc.) ...
         if (!workletNode) return;
         workletNode.port.onmessage = (event) => { /* ... handle status, error, playback-state, time-update ... */
             const data = event.data;
             switch (data.type) {
                 case 'status':
                     console.log(`[WorkletStatus] ${data.message}`);
                     if (data.message === 'processor-ready') {
                         workletReady = true; // Mark as ready
                         console.log("AudioApp: Worklet processor reported ready.");
                     } else if (data.message === 'Playback ended') { /* ... handle end ... */ }
                     break;
                 case 'error': /* ... handle error ... */ break;
                 case 'playback-state': /* ... handle state sync ... */ break;
                 case 'time-update': /* ... handle time update ... */
                     if(audioReady && originalBuffer && !isNaN(data.currentTime)) {
                        const currentTime = Math.max(0, Math.min(data.currentTime, originalBuffer.duration));
                        AudioApp.uiManager.updateTimeDisplay(currentTime, originalBuffer.duration);
                        AudioApp.visualizer.updateProgressIndicator(currentTime, originalBuffer.duration);
                     }
                     break;
                 default: console.warn("[Main] Unhandled message from worklet:", data);
             }
         };
         workletNode.onprocessorerror = (event) => { /* ... handle fatal processor error ... */ };
    }


    /**
     * Transfers audio buffer data (original and slow) to the worklet via postMessage.
     * @param {AudioBuffer} origBuf
     * @param {AudioBuffer} slowBuf
     * @private
     */
     function transferAudioDataToWorklet(origBuf, slowBuf) {
        // ... (Implementation remains the same as previous version, includes checks) ...
          if (!workletNode) { console.error("Cannot transfer: Worklet node missing."); return; }
          if (!workletReady) { console.warn("Cannot transfer: Worklet not ready."); return; } // Added check
          if (audioReady) { console.warn("Skipping transfer: Audio already marked ready."); return; } // Prevent re-transfer
          if (!origBuf || !slowBuf) { console.error("Cannot transfer: Buffers missing."); return; }

          console.log("AudioApp: Transferring audio data to worklet...");
          const transferList = []; const originalChannelData = []; const slowChannelData = [];
          try { /* ... prepare channel data and transfer list ... */
             const numChannels = origBuf.numberOfChannels;
             for (let i = 0; i < numChannels; i++) {
                 const origData = origBuf.getChannelData(i);
                 const origCopy = origData.buffer.slice(origData.byteOffset, origData.byteOffset + origData.byteLength);
                 originalChannelData.push(origCopy); transferList.push(origCopy);
                 const slowData = slowBuf.getChannelData(i);
                 const slowCopy = slowData.buffer.slice(slowData.byteOffset, slowData.byteOffset + slowData.byteLength);
                 slowChannelData.push(slowCopy); transferList.push(slowCopy);
             }
             postWorkletMessage({ type: 'load-audio', originalChannels, slowChannels }, transferList);
             console.log(`Transferred ${numChannels} channel pairs of audio buffers.`);
             // Mark audio as ready *after* posting the message (worklet confirms load internally)
             // Let's not set audioReady here, but rather when worklet confirms or based on pipeline stage.
             // Setting it truly ready only after visualization might be safer.
          } catch (error) {
              console.error("Error preparing audio data for transfer:", error);
              AudioApp.uiManager.showError("Failed to send audio data to engine.");
              throw error;
          }
     }


    // =========================================================================
    // SECTION: UI Event Handlers
    // =========================================================================

    /** Handles play/pause button click. @private */
    async function handlePlayPause() {
        // ... (Implementation remains the same - includes context resume) ...
         if (!audioReady || !workletReady || !audioCtx) { console.warn("Cannot play/pause."); return; }
         if (audioCtx.state === 'suspended') { try { await audioCtx.resume(); if (audioCtx.state !== 'running') throw new Error("Context resume failed."); } catch (e) { AudioApp.uiManager.showError(`Audio Error: ${e.message}`, true); return; } }
         isPlaying = !isPlaying; postWorkletMessage({ type: isPlaying ? 'play' : 'pause' }); AudioApp.uiManager.setPlayButtonState(isPlaying); console.log(`Playback ${isPlaying ? 'requested' : 'paused'}.`);
    }

    /** Handles jump button clicks. @private */
    function handleJump(e) {
        // ... (Implementation remains the same) ...
         if (!audioReady || !workletReady) return; console.log(`Jump ${e.detail.seconds}s requested.`); postWorkletMessage({ type: 'jump', seconds: e.detail.seconds });
    }

    /** Handles seek requests from visualizer clicks. @private */
    function handleSeek(e) {
        // ... (Implementation remains the same - includes optimistic UI update) ...
          if (!audioReady || !workletReady || !originalBuffer) return; const targetTime = e.detail.fraction * originalBuffer.duration; console.log(`Seek to ${targetTime.toFixed(2)}s requested.`); postWorkletMessage({ type: 'seek', positionSeconds: targetTime }); AudioApp.uiManager.updateTimeDisplay(targetTime, originalBuffer.duration); AudioApp.visualizer.updateProgressIndicator(targetTime, originalBuffer.duration);
    }

    /** Handles changes from parameter sliders/selectors. Sends all params. @private */
    function handleParameterChange(e) {
        // ... (Implementation remains the same) ...
          if (!audioReady || !workletReady) return; const params = AudioApp.uiManager.getCurrentParams(); postWorkletMessage({ type: 'set-params', params: params });
    }

    /** Handles changes from VAD tuning sliders. Triggers VAD recalc and visual update. @private */
    function handleVadThresholdChange(e) {
        // ... (Implementation remains the same) ...
          if (!vadResults || !originalBuffer) { console.warn("Cannot handle VAD threshold: No results."); return; } const { type, value } = e.detail; const newRegions = AudioApp.vadAnalyzer.handleThresholdUpdate(type, value); AudioApp.uiManager.setSpeechRegionsText(newRegions); AudioApp.visualizer.redrawWaveformHighlight(originalBuffer, newRegions);
    }

    /** Handles keyboard shortcuts. @private */
     function handleKeyPress(e) {
        // ... (Implementation remains the same) ...
          if (!audioReady) return; const key = e.detail.key; const jumpTime = AudioApp.uiManager.getCurrentConfig().jumpTime;
          switch (key) { case 'Space': handlePlayPause(); break; case 'ArrowLeft': if (workletReady) postWorkletMessage({ type: 'jump', seconds: -jumpTime }); break; case 'ArrowRight': if (workletReady) postWorkletMessage({ type: 'jump', seconds: jumpTime }); break; }
     }


    // =========================================================================
    // SECTION: Window Event Handlers
    // =========================================================================

    /** Handles window resize, redraws visuals. @private */
    function handleWindowResize() {
        // ... (Implementation remains the same) ...
          const currentRegions = AudioApp.vadAnalyzer.getCurrentRegions(); AudioApp.visualizer.resizeAndRedraw(originalBuffer, currentRegions); if (originalBuffer) { const times = AudioApp.uiManager.getCurrentTimes(); AudioApp.visualizer.updateProgressIndicator(times.currentTime, times.duration); }
    }

    /** Handles page unload, triggers cleanup. @private */
    function handleBeforeUnload() {
        // ... (Implementation remains the same) ...
         if (!cleanupScheduled) { console.log("Initiating cleanup on page unload..."); cleanupScheduled = true; cleanupCurrentAudio(true); }
    }


    // =========================================================================
    // SECTION: Worklet Communication Helper
    // =========================================================================

    /**
     * Sends a message to the AudioWorkletNode, handling potential errors.
     * @param {object} message - The message object.
     * @param {Transferable[]} [transferList=[]] - Array of transferable objects.
     * @private
     */
    function postWorkletMessage(message, transferList = []) {
        // ... (Implementation remains the same) ...
         if (workletNode && workletNode.port && workletNode.port instanceof MessagePort) { try { workletNode.port.postMessage(message, transferList); } catch (error) { console.error(`Error posting message ${message.type}:`, error); AudioApp.uiManager.showError(`Comms Error: ${error.message}`, true); } }
         else { if (workletReady && workletNode) { console.warn(`Cannot post ${message.type}: Port unavailable?`); } }
    }


    // =========================================================================
    // SECTION: Cleanup Logic
    // =========================================================================

    /**
     * Cleans up resources associated with the current audio file, worklet, and optionally context.
     * Does NOT nullify currentFile itself.
     * @param {boolean} [closeContext=false] - If true, also closes the main AudioContext.
     * @private
     */
    async function cleanupCurrentAudio(closeContext = false) {
        // ... (Implementation remains the same as previous version - keeps currentFile) ...
        console.log(`AudioApp: Cleaning up audio resources... (Close Context: ${closeContext})`);
        isPlaying = false; audioReady = false;
        await cleanupWorkletNode();
        originalBuffer = null; slowBuffer = null; pcm16k = null; vadResults = null;
        AudioApp.visualizer?.clearVisuals();
        // Avoid full reset if called during new file load
        // AudioApp.uiManager?.resetUI();
        if (closeContext && audioCtx && audioCtx.state !== 'closed') { try { await audioCtx.close(); console.log("AudioContext closed."); } catch (e) { console.warn("Error closing AC:", e); } finally { audioCtx = null; } }
        console.log("AudioApp: Resource cleanup finished.");
    }

    /**
     * Safely cleans up the worklet node by sending a cleanup message,
     * closing the port, and disconnecting.
     * @private
     */
     async function cleanupWorkletNode() {
        // ... (Implementation remains the same as previous version) ...
         if (workletNode) {
             const nodeToClean = workletNode; workletNode = null; workletReady = false;
             console.log("Cleaning up worklet node...");
             try { if (nodeToClean.port && nodeToClean.port instanceof MessagePort) { nodeToClean.port.postMessage({ type: 'cleanup' }); nodeToClean.port.close(); } nodeToClean.disconnect(); console.log("Worklet node cleaned up."); }
             catch (e) { console.warn("Error during worklet cleanup:", e); }
         }
     }


    // =========================================================================
    // SECTION: Public Interface
    // =========================================================================
    return {
        init: init // Only expose the init function
    };

})(); // End of AudioApp IIFE

// --- /vibe-player/main.js ---
