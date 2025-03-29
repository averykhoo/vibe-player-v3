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
    /** @type {boolean} Flag indicating all audio buffers are loaded/processed and ready for playback */
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
            // *** CORRECTED: Return object with view property ***
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
            // *** CORRECTED: Return object with view property ***
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
                fileInfo.textContent = "ERROR: Web Audio API not supported or failed to initialize.";
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
             // Use optional chaining as uiManager might not be fully init
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
                  const fileInfoEl = document.getElementById('fileInfo');
                  if (!fileInfoEl?.style.color) { // Check if error style was already set
                      AudioApp.uiManager?.setFileInfo("Ready. Select an audio file.");
                  }
             }
             // Error state is handled by handleAssetLoadError which updates UI
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
         if (audioCtx && audioCtx.state !== 'closed') {
             // console.log("AudioApp: AudioContext already exists.");
             return true; // Already setup
         }
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
         console.log(`AudioApp: Fetching ${assetName} from ${path}...`);
         try {
             const response = await fetch(path);
             if (!response.ok) {
                 throw new Error(`Fetch failed ${response.status} for ${assetName} at ${path}`);
             }
             const data = await (type === 'text' ? response.text() : response.arrayBuffer());
             console.log(`AudioApp: Fetched ${assetName} (${type === 'text' ? data.length + ' chars' : data.byteLength + ' bytes'}).`);
             return data;
         } catch (error) {
              console.error(`AudioApp: Failed to fetch ${assetName}:`, error);
              // Re-throw to be handled by Promise.all catch block
              throw error;
         }
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
             // Disable file input as app is likely broken
             const fileInput = document.getElementById('audioFile');
             if(fileInput) fileInput.disabled = true;
         } else { // Fallback if uiManager failed to init
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
            const decodedBuffer = await decodeAudioFile(currentFile);
            originalBuffer = decodedBuffer;
            console.log(`AudioApp: Decoded ${originalBuffer.duration.toFixed(2)}s @ ${originalBuffer.sampleRate}Hz`);
            AudioApp.uiManager.updateTimeDisplay(0, originalBuffer.duration);

            // --- Stage 2: Resample for VAD ---
            AudioApp.uiManager.setFileInfo(`Resampling for VAD...`);
            pcm16k = await resampleForVAD(originalBuffer);
            console.log(`AudioApp: Resampled to ${pcm16k.length} samples @ 16kHz`);

            // --- Stage 3: VAD Analysis ---
            AudioApp.uiManager.setFileInfo(`Analyzing VAD (loading model if needed)...`);
            const vadModelReady = await AudioApp.sileroWrapper.create(AudioApp.config.VAD_SAMPLE_RATE, AudioApp.config.VAD_MODEL_PATH);
            if (!vadModelReady) throw new Error("VAD Model could not be loaded/created. Check console for details.");

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

            // --- Stage 5 (REVISED): Setup Worklet, Transfer Data, THEN Wait ---
            AudioApp.uiManager.setFileInfo(`Initializing audio engine...`);
            // 5a. Setup the worklet node (adds module, creates node, connects, sets up listener)
            await setupAndStartWorklet();
            // At this point, the worklet constructor has run, but WASM init hasn't started yet.

            // 5b. Transfer audio data IMMEDIATELY. This will trigger WASM init inside the worklet.
            transferAudioDataToWorklet(originalBuffer, slowBuffer);

            // 5c. NOW wait for the worklet to signal it's ready (after processing load-audio & init WASM)
            AudioApp.uiManager.setFileInfo(`Waiting for audio engine...`); // Update status
            await waitForWorkletReady(5000); // Wait up to 5 seconds
            // If waitForWorkletReady throws an error (timeout), the main catch block will handle it.
            console.log("AudioApp: Audio engine reported ready.");

            // --- Stage 6: Draw Visualizations ---
            // Proceed only after worklet is confirmed ready and data is sent
            AudioApp.uiManager.setFileInfo(`Generating visuals...`);
            await AudioApp.visualizer.computeAndDrawVisuals(originalBuffer, vadResults.regions);

            // --- Final Ready State ---
            audioReady = true; // Mark app as fully ready for playback
            const endTime = performance.now();
            console.log(`AudioApp: Total file processing time: ${((endTime - startTime) / 1000).toFixed(2)}s`);
            AudioApp.uiManager.setFileInfo(`Ready: ${currentFileName}`);
            AudioApp.uiManager.enableControls(true); // Enable playback and parameter controls

        } catch (error) {
            const endTime = performance.now();
            console.error(`AudioApp: Error during file processing pipeline after ${((endTime - startTime) / 1000).toFixed(2)}s:`, error);
            AudioApp.uiManager.showError(`Processing failed: ${error.message}`, true);
            await cleanupCurrentAudio(false); // Cleanup without closing context
            AudioApp.uiManager.resetUI(); // Reset fully
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
         if (!audioCtx) throw new Error("AudioContext not available for decoding."); // Added check
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
          console.log("AudioApp: Resampling audio for VAD...");
          const targetSR = AudioApp.config.VAD_SAMPLE_RATE;
          if (!buffer) throw new Error("Invalid buffer provided for resampling."); // Added check
          if (buffer.sampleRate === targetSR && buffer.numberOfChannels === 1) {
              console.log("AudioApp: Audio already 16kHz mono, skipping resampling.");
              return buffer.getChannelData(0).slice();
          }
          try {
              // Check if OfflineAudioContext is supported
              if (typeof OfflineAudioContext === "undefined") {
                    throw new Error("OfflineAudioContext is not supported in this browser environment.");
              }
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
        console.log(`AudioApp: Preprocessing slow version at ${targetSlowSpeed}x...`);
        if (!rubberbandWasmBinary || !rubberbandLoaderText) {
             throw new Error("Rubberband WASM components not loaded for preprocessing.");
        }
        if (!buffer || typeof buffer.getChannelData !== 'function' || targetSlowSpeed <= 0) {
             throw new Error("Invalid input buffer or target speed for preprocessing.");
        }

        const RBLib = await loadRubberbandLibraryDirectly(rubberbandWasmBinary, rubberbandLoaderText);
        if (!RBLib) throw new Error("Failed to load Rubberband library instance for preprocessing.");

        const stretchRatio = 1.0 / targetSlowSpeed;
        const sampleRate = buffer.sampleRate;
        const channels = buffer.numberOfChannels;
        const inputLength = buffer.length;

        const rbFlags = RBLib.RubberBandOptionFlag.ProcessOffline |
                      RBLib.RubberBandOptionFlag.EngineFiner |
                      RBLib.RubberBandOptionFlag.PitchHighQuality |
                      RBLib.RubberBandOptionFlag.FormantPreserved |
                      RBLib.RubberBandOptionFlag.SmoothingOn |
                      RBLib.RubberBandOptionFlag.WindowLong;

        let statePtr = 0; // Initialize pointer
        let processedBuffer = null;
        let wasmMemory = null;
        // **** FIX: Declare totalOutputFrames and outputChunks OUTSIDE the try block ****
        let totalOutputFrames = 0;
        const outputChunks = Array.from({ length: channels }, () => []);

        try {
            statePtr = RBLib._rubberband_new(sampleRate, channels, rbFlags, 1.0, 1.0);
            if (!statePtr) throw new Error("_rubberband_new failed during preprocessing.");

            RBLib._rubberband_set_time_ratio(statePtr, stretchRatio);
            RBLib._rubberband_set_pitch_scale(statePtr, 1.0); // Keep pitch original
            RBLib._rubberband_set_expected_input_duration(statePtr, inputLength);

            const latency = RBLib._rubberband_get_latency(statePtr);
            const blockSize = Math.max(1024, latency > 0 ? latency * 2 : 4096);
            // console.log(`AudioApp (Preprocess): BlockSize=${blockSize}, Latency=${latency}`);

            wasmMemory = new WasmMemoryManager(RBLib); // Instantiate the helper

            // --- Allocate WASM Memory ---
            const inputPtrsRef = wasmMemory.allocUint32Array(channels);
            const outputPtrsRef = wasmMemory.allocUint32Array(channels);
            const inputBufRefs = Array.from({ length: channels }, () => wasmMemory.allocFloat32Array(blockSize));
            const outputBufRefs = Array.from({ length: channels }, () => wasmMemory.allocFloat32Array(blockSize));
            for (let i = 0; i < channels; ++i) {
                if (!inputBufRefs[i]?.address || !outputBufRefs[i]?.address) throw new Error("Buffer allocation failed internally.");
                inputPtrsRef.view[i] = inputBufRefs[i].address;
                outputPtrsRef.view[i] = outputBufRefs[i].address;
            }

            // --- Study Pass ---
            console.time("Rubberband Preprocess Study");
            let framesLeftStudy = inputLength;
            let offsetStudy = 0;
            while (framesLeftStudy > 0) {
                const processNow = Math.min(blockSize, framesLeftStudy);
                const isFinal = (processNow === framesLeftStudy);
                for (let i = 0; i < channels; ++i) {
                     if (!inputBufRefs[i]?.view) throw new Error(`Input buffer view missing for channel ${i} in study`);
                     inputBufRefs[i].view.set(buffer.getChannelData(i).subarray(offsetStudy, offsetStudy + processNow));
                }
                RBLib._rubberband_study(statePtr, inputPtrsRef.address, processNow, isFinal ? 1 : 0);
                framesLeftStudy -= processNow;
                offsetStudy += processNow;
            }
            console.timeEnd("Rubberband Preprocess Study");

            // --- Process Pass ---
            console.time("Rubberband Preprocess Process");
            let framesLeftProcess = inputLength;
            let offsetProcess = 0;
            // outputChunks and totalOutputFrames declared outside try
            let finalSent = false;
            let available = 0;

            while (framesLeftProcess > 0 || !finalSent) {
                // Feed Input
                const processNow = Math.min(blockSize, framesLeftProcess);
                const isFinal = (processNow > 0 && processNow === framesLeftProcess) || (processNow === 0 && !finalSent);
                 if (processNow > 0) {
                    for (let i = 0; i < channels; ++i) {
                        if (!inputBufRefs[i]?.view) throw new Error(`Input buffer view missing for channel ${i} in process`);
                        inputBufRefs[i].view.set(buffer.getChannelData(i).subarray(offsetProcess, offsetProcess + processNow));
                    }
                    framesLeftProcess -= processNow;
                    offsetProcess += processNow;
                 }
                 // Call Process
                 RBLib._rubberband_process(statePtr, inputPtrsRef.address, processNow, isFinal ? 1 : 0);
                 if (isFinal) finalSent = true;

                 // Retrieve ALL Available Output
                 do {
                     available = RBLib._rubberband_available(statePtr);
                     if (available > 0) {
                         const retrieveNow = Math.min(available, blockSize);
                         const retrieved = RBLib._rubberband_retrieve(statePtr, outputPtrsRef.address, retrieveNow);
                         if (retrieved > 0) {
                             totalOutputFrames += retrieved; // Use variable declared outside try
                             for (let i = 0; i < channels; ++i) {
                                 if (!outputBufRefs[i]?.view) throw new Error(`Output buffer view missing for channel ${i}`);
                                 outputChunks[i].push(outputBufRefs[i].view.slice(0, retrieved)); // Create copy
                             }
                         } else if (retrieved === 0 && available > 0) {
                              console.warn("AudioApp (Preprocess): Retrieve returned 0 despite available > 0. Breaking retrieve loop.");
                              available = 0; // Force break
                         } else if (retrieved < 0) {
                              throw new Error(`_rubberband_retrieve failed with error code ${retrieved}`);
                         }
                     }
                 } while (available > 0);

                 // Check Exit Condition
                 if (finalSent && available <= 0) break; // Exit while loop
            }
            console.timeEnd("Rubberband Preprocess Process");

            // --- Combine Output Chunks ---
            if (totalOutputFrames > 0) {
                 if (!audioCtx) throw new Error("AudioContext not available to create output buffer."); // Added check
                 processedBuffer = audioCtx.createBuffer(channels, totalOutputFrames, sampleRate);
                 for (let i = 0; i < channels; ++i) {
                     const targetChannel = processedBuffer.getChannelData(i);
                     let currentOffset = 0;
                     for (const chunk of outputChunks[i]) {
                         targetChannel.set(chunk, currentOffset);
                         currentOffset += chunk.length;
                     }
                      if (currentOffset !== totalOutputFrames) {
                         console.error(`Channel ${i} combined length mismatch: ${currentOffset} vs ${totalOutputFrames}`);
                      }
                 }
                 const expectedFrames = Math.round(inputLength * stretchRatio);
                 console.log(`AudioApp (Preprocess): Output ${totalOutputFrames} frames. Expected ~${expectedFrames}.`);
                 if (Math.abs(totalOutputFrames - expectedFrames) > blockSize * 2) {
                     console.warn("AudioApp (Preprocess): Output length differs significantly from expected length.");
                 }
            } else {
                 if (inputLength > 0) {
                     throw new Error("Offline Rubberband processing yielded zero output frames for non-empty input.");
                 } else {
                     console.log("AudioApp (Preprocess): Input was empty, creating empty output buffer.");
                      if (!audioCtx) throw new Error("AudioContext not available to create empty buffer."); // Added check
                     processedBuffer = audioCtx.createBuffer(channels, 0, sampleRate);
                 }
            }

        } catch(e) {
            console.error("AudioApp: Error during offline Rubberband processing:", e);
            // Ensure cleanup happens even if error occurred mid-process
             if (statePtr && RBLib?._rubberband_delete) { try { RBLib._rubberband_delete(statePtr); } catch(delErr){} }
             wasmMemory?.freeAll();
             statePtr = 0; // Prevent double delete in finally
             wasmMemory = null;
            throw new Error(`Failed to preprocess slow audio: ${e.message}`); // Re-throw original error reason
        } finally {
            // --- Cleanup WASM Resources ---
            if (statePtr && RBLib?._rubberband_delete) {
                try { RBLib._rubberband_delete(statePtr); } catch (delErr) { console.error("Error deleting Rubberband instance in finally:", delErr); }
            }
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
         console.log("AudioApp: Loading Rubberband library directly for offline use...");
         try {
             const getLoaderFactory = new Function(`${loaderText}; return Rubberband;`);
             const moduleFactory = getLoaderFactory();
             if (typeof moduleFactory !== 'function') {
                 throw new Error("Loader script did not define 'Rubberband' async function factory.");
             }
             const instantiateWasmDirect = (imports, successCallback) => {
                 WebAssembly.instantiate(wasmBinary, imports)
                    .then(output => successCallback(output.instance, output.module))
                    .catch(e => { console.error("Direct WASM instantiation failed:", e); throw e; }); // Propagate error
                 return {};
             };
             const loadedModule = await moduleFactory({ instantiateWasm: instantiateWasmDirect });
             if (!loadedModule || typeof loadedModule._malloc !== 'function' || typeof loadedModule._free !== 'function') {
                 throw new Error("Loaded Rubberband module is invalid or missing expected exports.");
             }
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
         if (!audioCtx || audioCtx.state === 'closed') throw new Error("AudioContext not ready for worklet setup.");
         if (!originalBuffer || !slowBuffer) throw new Error("Audio buffers not ready for worklet setup.");
         if (!rubberbandWasmBinary || !rubberbandLoaderText) throw new Error("Rubberband WASM assets not ready.");

         await cleanupWorkletNode(); // Ensure previous node is gone

         try {
             console.log(`AudioApp: Adding AudioWorklet module: ${AudioApp.config.HYBRID_PROCESSOR_PATH}`);
             // Ensure path is correct relative to the HTML file's location
             await audioCtx.audioWorklet.addModule(AudioApp.config.HYBRID_PROCESSOR_PATH);
             console.log("AudioApp: AudioWorklet module added.");

             const wasmBinaryTransfer = rubberbandWasmBinary.slice(0); // Transferable copy
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

             setupWorkletMessageListener(); // Attach message handler
             workletNode.connect(audioCtx.destination); // Connect to output
             console.log("AudioApp: AudioWorkletNode created and connected.");
             workletReady = false; // Reset ready flag, wait for 'processor-ready' message

         } catch (error) {
             console.error("AudioApp: Error setting up AudioWorklet:", error);
             await cleanupWorkletNode();
             throw new Error(`Failed to initialize audio engine: ${error.message}`);
         }
    }

    /**
     * Helper to wait for the worklet 'processor-ready' message with a timeout.
     * @param {number} timeoutMs - Maximum time to wait in milliseconds.
     * @returns {Promise<void>} Resolves when ready, rejects on timeout or if workletNode becomes null.
     * @private
     */
     function waitForWorkletReady(timeoutMs) {
         return new Promise((resolve, reject) => {
             if (workletReady) { resolve(); return; }
             if (!workletNode) { reject(new Error("Worklet node is null, cannot wait for ready.")); return; }

             const startTime = Date.now();
             let intervalId = null; // Store interval ID for cleanup

             const checkReady = () => {
                 if (!workletNode) { // Check if node was cleaned up during wait
                     clearInterval(intervalId);
                     reject(new Error("Worklet node was cleaned up while waiting for ready state."));
                     return;
                 }
                 if (workletReady) {
                     clearInterval(intervalId);
                     resolve();
                 } else if (Date.now() - startTime > timeoutMs) {
                     clearInterval(intervalId);
                     reject(new Error(`Worklet processor did not report ready within ${timeoutMs}ms.`));
                 }
             };
             intervalId = setInterval(checkReady, 50); // Check every 50ms
         });
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
                         workletReady = true; // Set flag when message received
                         console.log("AudioApp: Worklet processor reported ready.");
                     } else if (data.message === 'Playback ended') { /* ... handle end ... */ if (isPlaying) { isPlaying = false; AudioApp.uiManager.setPlayButtonState(false); /* ... update time display ... */ } }
                     else if (data.message === 'Processor cleaned up') { workletReady = false; } // Mark not ready on cleanup
                     break;
                 case 'error': /* ... handle error, cleanupWorkletNode ... */ console.error(`[WorkletError] ${data.message}`); AudioApp.uiManager.showError(`Audio Engine Error: ${data.message}`, true); isPlaying = false; audioReady = false; workletReady = false; AudioApp.uiManager.enableControls(false); cleanupWorkletNode(); break;
                 case 'playback-state': /* ... handle state sync ... */ if (isPlaying !== data.isPlaying) { console.warn("Desync", data.isPlaying); isPlaying = data.isPlaying; AudioApp.uiManager.setPlayButtonState(isPlaying); } break;
                 case 'time-update': /* ... handle time update ... */
                     if(audioReady && originalBuffer && !isNaN(data.currentTime)) { const currentTime = Math.max(0, Math.min(data.currentTime, originalBuffer.duration)); AudioApp.uiManager.updateTimeDisplay(currentTime, originalBuffer.duration); AudioApp.visualizer.updateProgressIndicator(currentTime, originalBuffer.duration); }
                     break;
                 default: console.warn("[Main] Unhandled message from worklet:", data);
             }
         };
         workletNode.onprocessorerror = (event) => { /* ... handle fatal processor error, cleanupWorkletNode ... */ console.error("[Main] Unrecoverable Worklet error:", event); AudioApp.uiManager.showError("Critical Audio Engine Failure!", true); isPlaying = false; audioReady = false; workletReady = false; AudioApp.uiManager.enableControls(false); cleanupWorkletNode(); };
    }


    /**
     * Transfers audio buffer data (original and slow) to the worklet via postMessage.
     * Uses Transferable objects for efficiency.
     * Assumes workletNode exists, but does NOT wait for workletReady flag here.
     * @param {AudioBuffer} origBuf
     * @param {AudioBuffer} slowBuf
     * @private
     * @throws {Error} If transfer preparation fails.
     */
     function transferAudioDataToWorklet(origBuf, slowBuf) {
          // --- REMOVED THE workletReady CHECK ---
          // Sending this message IS the trigger for the worklet to start init.
          if (!workletNode) {
              console.error("AudioApp: Cannot transfer audio data - Worklet node not available.");
              // Optionally throw an error if this state is unexpected
              throw new Error("Worklet node missing during audio data transfer attempt.");
              // return; // Or just return if throwing is too harsh
          }
          // if (audioReady) { // Keep check to prevent accidental re-transfer? Maybe less critical now.
          //    console.warn("AudioApp: Audio data already marked ready or previously transferred, skipping transfer.");
          //    return;
          // }
          if (!origBuf || !slowBuf) {
              console.error("AudioApp: Cannot transfer audio data - Buffers missing.");
              throw new Error("Audio buffers missing during transfer attempt.");
              // return;
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

              console.log(`AudioApp: Posted 'load-audio' message with ${numChannels} channel pairs to worklet.`);
              // The audioReady flag should be set later in the pipeline AFTER worklet confirms readiness and visuals are done.

         } catch (error) {
             console.error("AudioApp: Error preparing audio data for transfer:", error);
             AudioApp.uiManager?.showError(`Failed to send audio data to engine: ${error.message}`);
             throw error; // Re-throw to be caught by pipeline handler
         }
     }


    // =========================================================================
    // SECTION: UI Event Handlers
    // =========================================================================

    /** Handles play/pause button click. @private */
    async function handlePlayPause() {
        if (!audioReady || !workletReady || !audioCtx) { console.warn("Cannot play/pause: Not ready."); return; }
        if (audioCtx.state === 'suspended') { try { await audioCtx.resume(); if (audioCtx.state !== 'running') throw new Error("Context resume failed."); } catch (e) { AudioApp.uiManager.showError(`Audio Error: ${e.message}`, true); return; } }
        isPlaying = !isPlaying; postWorkletMessage({ type: isPlaying ? 'play' : 'pause' }); AudioApp.uiManager.setPlayButtonState(isPlaying); console.log(`Playback ${isPlaying ? 'requested' : 'paused'}.`);
    }

    /** Handles jump button clicks. @private */
    function handleJump(e) {
        if (!audioReady || !workletReady) return; console.log(`Jump ${e.detail.seconds}s requested.`); postWorkletMessage({ type: 'jump', seconds: e.detail.seconds });
    }

    /** Handles seek requests from visualizer clicks. @private */
    function handleSeek(e) {
        if (!audioReady || !workletReady || !originalBuffer) return; const targetTime = e.detail.fraction * originalBuffer.duration; console.log(`Seek to ${targetTime.toFixed(2)}s requested.`); postWorkletMessage({ type: 'seek', positionSeconds: targetTime }); AudioApp.uiManager.updateTimeDisplay(targetTime, originalBuffer.duration); AudioApp.visualizer.updateProgressIndicator(targetTime, originalBuffer.duration);
    }

    /** Handles changes from parameter sliders/selectors. Sends all params. @private */
    function handleParameterChange(e) {
        if (!audioReady || !workletReady) return; const params = AudioApp.uiManager.getCurrentParams(); postWorkletMessage({ type: 'set-params', params: params });
    }

    /** Handles changes from VAD tuning sliders. Triggers VAD recalc and visual update. @private */
    function handleVadThresholdChange(e) {
        if (!vadResults || !originalBuffer) { console.warn("Cannot handle VAD threshold: No results."); return; } const { type, value } = e.detail; const newRegions = AudioApp.vadAnalyzer.handleThresholdUpdate(type, value); AudioApp.uiManager.setSpeechRegionsText(newRegions); AudioApp.visualizer.redrawWaveformHighlight(originalBuffer, newRegions);
    }

    /** Handles keyboard shortcuts. @private */
     function handleKeyPress(e) {
        if (!audioReady) return; const key = e.detail.key; const jumpTime = AudioApp.uiManager.getCurrentConfig().jumpTime;
        switch (key) { case 'Space': handlePlayPause(); break; case 'ArrowLeft': if (workletReady) postWorkletMessage({ type: 'jump', seconds: -jumpTime }); break; case 'ArrowRight': if (workletReady) postWorkletMessage({ type: 'jump', seconds: jumpTime }); break; }
     }


    // =========================================================================
    // SECTION: Window Event Handlers
    // =========================================================================

    /** Handles window resize, redraws visuals. @private */
    function handleWindowResize() {
        const currentRegions = AudioApp.vadAnalyzer?.getCurrentRegions() ?? []; // Use optional chaining
        AudioApp.visualizer?.resizeAndRedraw(originalBuffer, currentRegions);
        if (originalBuffer && AudioApp.uiManager) { const times = AudioApp.uiManager.getCurrentTimes(); AudioApp.visualizer?.updateProgressIndicator(times.currentTime, times.duration); }
    }

    /** Handles page unload, triggers cleanup. @private */
    function handleBeforeUnload() {
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
         if (workletNode && workletNode.port && workletNode.port instanceof MessagePort) { try { workletNode.port.postMessage(message, transferList); } catch (error) { console.error(`Error posting message ${message.type}:`, error); AudioApp.uiManager?.showError(`Comms Error: ${error.message}`, true); } }
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
        console.log(`AudioApp: Cleaning up audio resources... (Close Context: ${closeContext})`);
        isPlaying = false; audioReady = false;
        await cleanupWorkletNode(); // Ensure worklet is stopped/cleaned first
        originalBuffer = null; slowBuffer = null; pcm16k = null; vadResults = null;
        // currentFile is intentionally NOT nulled here
        AudioApp.visualizer?.clearVisuals();
        // Don't call resetUI() here if called during new file load, handle in caller
        if (closeContext && audioCtx && audioCtx.state !== 'closed') { try { await audioCtx.close(); console.log("AudioContext closed."); } catch (e) { console.warn("Error closing AC:", e); } finally { audioCtx = null; } }
        console.log("AudioApp: Resource cleanup finished.");
    }

    /**
     * Safely cleans up the worklet node by sending a cleanup message,
     * closing the port, and disconnecting.
     * @private
     */
     async function cleanupWorkletNode() {
         if (workletNode) {
             const nodeToClean = workletNode; workletNode = null; workletReady = false;
             console.log("AudioApp: Cleaning up existing AudioWorkletNode...");
             try {
                 // Only post message/close port if it exists and seems valid
                 if (nodeToClean.port && nodeToClean.port instanceof MessagePort) {
                      nodeToClean.port.postMessage({ type: 'cleanup' });
                      // Optional short delay? Often not needed if disconnect is called.
                      // await new Promise(resolve => setTimeout(resolve, 10));
                      nodeToClean.port.close();
                 }
                 nodeToClean.disconnect(); // Disconnect from graph
                 console.log("AudioApp: Worklet node cleaned up.");
             } catch (e) { console.warn("AudioApp: Error during worklet node cleanup:", e); }
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
