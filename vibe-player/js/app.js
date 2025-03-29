// --- /vibe-player/js/app.js ---
// Creates the global namespace and orchestrates the application flow.
// MUST be loaded FIRST after libraries.

/**
 * @namespace AudioApp
 * @description Main application namespace for Vibe Player.
 */
var AudioApp = AudioApp || {}; // Create the main application namespace

// Design Decision: Use an IIFE to encapsulate the main application logic
// and expose only the `init` function via the AudioApp namespace.
AudioApp = (function() {
    'use strict';

    // --- Application State ---
    /** @type {AudioBuffer|null} The fully decoded *original* audio buffer */
    let currentAudioBuffer = null;
    /** @type {Float32Array|null} The 16kHz mono resampled audio for VAD */
    let currentPcm16k = null;
    /** @type {object|null} Stores VAD results: { regions, probabilities, frameSamples, sampleRate, initialPositiveThreshold, initialNegativeThreshold, redemptionFrames } */
    let currentVadResults = null;
     /** @type {File|null} The currently loaded audio file object */
    let currentFile = null;
    /** @type {boolean} Flag indicating the VAD model ONNX session is ready */
    let vadModelReady = false;
    /** @type {boolean} Flag indicating the AudioWorklet processor is ready for playback commands */
    let workletPlaybackReady = false;


    // --- Initialization ---

    /**
     * Initializes the entire Vibe Player application.
     * Sets up modules and event listeners.
     * @public
     */
    function init() {
        console.log("AudioApp: Initializing...");

        // Initialize modules
        AudioApp.uiManager.init();
        AudioApp.audioEngine.init(); // Will fetch WASM/Loader in background now
        AudioApp.visualizer.init();
        // VAD modules init implicitly when used

        // Setup event listeners
        setupAppEventListeners();

        console.log("AudioApp: Initialized. Waiting for file...");
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
        document.addEventListener('audioapp:seekRequested', handleSeek);
        document.addEventListener('audioapp:speedChanged', handleSpeedChange);
        document.addEventListener('audioapp:gainChanged', handleGainChange);
        document.addEventListener('audioapp:thresholdChanged', handleThresholdChange);
        document.addEventListener('audioapp:keyPressed', handleKeyPress);

        // --- AudioEngine -> App Event Listeners ---
        document.addEventListener('audioapp:audioLoaded', handleAudioLoaded);
        document.addEventListener('audioapp:resamplingComplete', handleResamplingComplete);
        // *** NEW EVENT LISTENER ***
        document.addEventListener('audioapp:workletReady', handleWorkletReady); // Listen for worklet readiness
        document.addEventListener('audioapp:decodingError', handleAudioError);
        document.addEventListener('audioapp:resamplingError', handleAudioError);
        document.addEventListener('audioapp:playbackError', handleAudioError); // From <audio> (now less likely) or worklet
        document.addEventListener('audioapp:engineError', handleAudioError); // For context, connect, resource errors
        document.addEventListener('audioapp:timeUpdated', handleTimeUpdate);
        document.addEventListener('audioapp:playbackEnded', handlePlaybackEnded);
        document.addEventListener('audioapp:playbackStateChanged', handlePlaybackStateChange);


        // --- Window Event Listeners ---
        window.addEventListener('resize', handleWindowResize);
        window.addEventListener('beforeunload', handleBeforeUnload);
    }

    // --- Event Handler Functions ---

    /**
     * Handles the 'audioapp:fileSelected' event.
     * Resets state and initiates the loading pipeline via AudioEngine.
     * @param {CustomEvent<{file: File}>} e
     * @private
     */
    async function handleFileSelected(e) {
        const file = e.detail.file;
        if (!file) return;

        currentFile = file;
        console.log("App: File selected -", file.name);

        // Reset application state
        currentAudioBuffer = null;
        currentPcm16k = null;
        currentVadResults = null;
        workletPlaybackReady = false; // Reset worklet ready state
        // vadModelReady persists across file loads

        // Reset UI
        AudioApp.uiManager.resetUI(); // This should disable controls initially
        AudioApp.uiManager.setFileInfo(`Loading: ${file.name}...`);
        AudioApp.visualizer.clearVisuals();
        AudioApp.visualizer.showSpinner(true); // Show spinner early

        try {
            // Delegate loading, decoding, resampling, and worklet setup to AudioEngine
            await AudioApp.audioEngine.loadAndProcessFile(file);
            // Subsequent processing (VAD, visualization) is triggered by events
            // like 'resamplingComplete' and 'workletReady'.
        } catch (error) {
            console.error("App: Error initiating file processing -", error);
            AudioApp.uiManager.setFileInfo(`Error loading: ${error.message}`);
            AudioApp.uiManager.resetUI();
            AudioApp.visualizer.showSpinner(false);
        }
    }

    /**
     * Handles the 'audioapp:audioLoaded' event. Stores the buffer.
     * @param {CustomEvent<{audioBuffer: AudioBuffer}>} e
     * @private
     */
    function handleAudioLoaded(e) {
        currentAudioBuffer = e.detail.audioBuffer;
        console.log(`App: Audio decoded (${currentAudioBuffer.duration.toFixed(2)}s)`);
        AudioApp.uiManager.updateTimeDisplay(0, currentAudioBuffer.duration);
        // AudioEngine proceeds with resampling...
    }

    /**
     * Handles the 'audioapp:resamplingComplete' event. Stores 16k PCM, triggers VAD model check/analysis.
     * @param {CustomEvent<{pcmData: Float32Array}>} e
     * @private
     */
    async function handleResamplingComplete(e) {
        currentPcm16k = e.detail.pcmData;
        console.log(`App: Audio resampled (${currentPcm16k.length} samples @ 16kHz)`);

        // --- VAD Model Check & Analysis ---
        let vadCreationSuccess = vadModelReady;
        if (!vadModelReady) {
            console.log("App: Attempting to create/load VAD model...");
            try {
                vadCreationSuccess = await AudioApp.sileroWrapper.create(16000);
                if (vadCreationSuccess) {
                    vadModelReady = true;
                    console.log("App: VAD model created successfully.");
                } else {
                    console.error("App: Failed to create VAD model.");
                    AudioApp.uiManager.setSpeechRegionsText("VAD Model Error"); // Update UI
                    AudioApp.uiManager.enableVadControls(false);
                }
            } catch (creationError) {
                console.error("App: Error during VAD model creation:", creationError);
                vadCreationSuccess = false;
                AudioApp.uiManager.setSpeechRegionsText(`VAD Load Error: ${creationError.message}`);
                AudioApp.uiManager.enableVadControls(false);
            }
        }

        if (vadCreationSuccess) {
            console.log("App: Starting VAD analysis...");
            AudioApp.uiManager.setSpeechRegionsText("Analyzing VAD...");
            try {
                currentVadResults = await AudioApp.vadAnalyzer.analyze(currentPcm16k);
                console.log(`App: VAD analysis complete. ${currentVadResults.regions.length} regions.`);
                AudioApp.uiManager.updateVadDisplay(
                    currentVadResults.initialPositiveThreshold,
                    currentVadResults.initialNegativeThreshold
                );
                AudioApp.uiManager.setSpeechRegionsText(currentVadResults.regions);
                AudioApp.uiManager.enableVadControls(true);
                // NOTE: Playback controls are NOT enabled here anymore. They wait for workletReady.

                // Trigger initial visualization compute *after* VAD analysis completes
                // but *before* necessarily waiting for the worklet (visuals don't depend on worklet)
                if (currentAudioBuffer) {
                     console.log("App: Computing and drawing visualizations...");
                     AudioApp.visualizer.computeAndDrawVisuals(currentAudioBuffer, currentVadResults.regions)
                         .catch(visError => console.error("App: Visualization failed after VAD success:", visError))
                         .finally(() => {
                             // Spinner hiding is now primarily tied to worklet readiness or final error handling
                             if (workletPlaybackReady || !vadCreationSuccess) { // Hide if worklet is already ready OR VAD failed
                                 AudioApp.visualizer.showSpinner(false);
                             }
                         });
                }

            } catch (analysisError) {
                console.error("App: VAD Analysis failed -", analysisError);
                AudioApp.uiManager.setSpeechRegionsText(`VAD Error: ${analysisError.message}`);
                AudioApp.uiManager.enableVadControls(false);
                // If VAD failed, still try to draw visuals without regions
                 if (currentAudioBuffer) {
                     console.log("App: Drawing visuals without VAD highlighting due to analysis error...");
                     AudioApp.visualizer.computeAndDrawVisuals(currentAudioBuffer, [])
                         .catch(visError => console.error("App: Visualization failed after VAD error:", visError))
                         .finally(() => AudioApp.visualizer.showSpinner(false));
                 } else {
                      AudioApp.visualizer.showSpinner(false);
                 }
            }
        } else {
            // VAD model failed to load
            AudioApp.uiManager.setSpeechRegionsText("VAD Model Error");
            AudioApp.uiManager.enableVadControls(false);
            // If VAD failed, still try to draw visuals without regions
            if (currentAudioBuffer) {
                console.log("App: Computing/drawing visuals without VAD highlighting (VAD init failed)...");
                 AudioApp.visualizer.computeAndDrawVisuals(currentAudioBuffer, [])
                    .catch(visError => console.error("App: Visualization failed after VAD model init error:", visError))
                    .finally(() => AudioApp.visualizer.showSpinner(false));
            } else {
                 AudioApp.visualizer.showSpinner(false);
            }
        }
        // Final file info update might happen after worklet is ready
    } // --- End handleResamplingComplete ---


    /**
     * Handles the 'audioapp:workletReady' event from audioEngine.
     * Enables playback controls and updates the file info status.
     * @param {CustomEvent} e - The event object.
     * @private
     */
    function handleWorkletReady(e) {
        console.log("App: AudioWorklet processor is ready.");
        workletPlaybackReady = true;
        AudioApp.uiManager.enablePlaybackControls(true); // Enable play/pause, jump, speed
        AudioApp.visualizer.showSpinner(false); // Hide spinner now that everything is ready
        AudioApp.uiManager.setFileInfo(`Ready: ${currentFile ? currentFile.name : 'Unknown File'}`);
    }


    /**
     * Handles various audio error events.
     * @param {CustomEvent<{type?: string, error: Error}>} e
     * @private
     */
    function handleAudioError(e) {
        const errorType = e.detail.type || 'Unknown';
        const errorMessage = e.detail.error ? e.detail.error.message : 'An unknown error occurred';
        console.error(`App: Audio Error - ${errorType}:`, e.detail.error || errorMessage);
        AudioApp.uiManager.setFileInfo(`Error (${errorType}): ${errorMessage}`);
        AudioApp.uiManager.resetUI();
        AudioApp.visualizer.clearVisuals();
        AudioApp.visualizer.showSpinner(false);
        // Reset state
        currentAudioBuffer = null;
        currentPcm16k = null;
        currentVadResults = null;
        currentFile = null;
        workletPlaybackReady = false;
        // Consider if vadModelReady should be reset on certain critical errors
    }

    /**
     * Handles 'audioapp:playPauseClicked' event. Calls audioEngine.
     * @private
     */
    function handlePlayPause() {
        if (!workletPlaybackReady) { // Check if the worklet is ready, not just buffer loaded
             console.warn("App: Play/Pause ignored - Worklet not ready.");
             return;
        }
        AudioApp.audioEngine.togglePlayPause();
    }

    /**
     * Handles 'audioapp:jumpClicked' event. Calls audioEngine.
     * @param {CustomEvent<{seconds: number}>} e
     * @private
     */
    function handleJump(e) {
        if (!workletPlaybackReady) return;
        AudioApp.audioEngine.jumpBy(e.detail.seconds);
    }

    /**
     * Handles 'audioapp:seekRequested' event. Calls audioEngine.
     * @param {CustomEvent<{fraction: number}>} e
     * @private
     */
    function handleSeek(e) {
        if (!workletPlaybackReady || !currentAudioBuffer || isNaN(currentAudioBuffer.duration) || currentAudioBuffer.duration <= 0) return;
        const targetTime = e.detail.fraction * currentAudioBuffer.duration;
        AudioApp.audioEngine.seek(targetTime);
    }

    /**
     * Handles 'audioapp:speedChanged' event. Calls audioEngine.
     * @param {CustomEvent<{speed: number}>} e
     * @private
     */
    function handleSpeedChange(e) {
        // Speed can be changed even if worklet isn't fully ready, engine will pass it on later
        AudioApp.audioEngine.setSpeed(e.detail.speed);
    }

    /**
     * Handles 'audioapp:gainChanged' event. Calls audioEngine.
     * @param {CustomEvent<{gain: number}>} e
     * @private
     */
    function handleGainChange(e) {
        AudioApp.audioEngine.setGain(e.detail.gain);
    }

    /**
     * Handles 'audioapp:thresholdChanged' event. Triggers VAD recalculation.
     * @param {CustomEvent<{type: string, value: number}>} e
     * @private
     */
    function handleThresholdChange(e) {
        if (!currentVadResults || !currentAudioBuffer) return; // Need VAD results and buffer

        const { type, value } = e.detail;
        const newRegions = AudioApp.vadAnalyzer.handleThresholdUpdate(type, value);
        AudioApp.uiManager.setSpeechRegionsText(newRegions);
        AudioApp.visualizer.redrawWaveformHighlight(currentAudioBuffer, newRegions);
    }

    /**
     * Handles 'audioapp:timeUpdated' event. Updates UI.
     * @param {CustomEvent<{currentTime: number, duration: number}>} e
     * @private
     */
    function handleTimeUpdate(e) {
        const { currentTime, duration } = e.detail;
        AudioApp.uiManager.updateTimeDisplay(currentTime, duration);
        AudioApp.visualizer.updateProgressIndicator(currentTime, duration);
    }

    /**
     * Handles 'audioapp:playbackEnded' event. (Logs for now).
     * @private
     */
    function handlePlaybackEnded() {
        console.log("App: Playback ended event received.");
        // UI state (button to 'Play') should be handled by playbackStateChanged
    }

    /**
     * Handles 'audioapp:playbackStateChanged' event. Updates UI.
     * @param {CustomEvent<{isPlaying: boolean}>} e
     * @private
     */
     function handlePlaybackStateChange(e) {
        AudioApp.uiManager.setPlayButtonState(e.detail.isPlaying);
    }

    /**
     * Handles 'audioapp:keyPressed' event. Executes actions.
     * @param {CustomEvent<{key: string}>} e
     * @private
     */
    function handleKeyPress(e) {
        // Check worklet readiness *before* sending commands
        if (!workletPlaybackReady) {
             console.warn(`App: Key press '${e.detail.key}' ignored - Worklet not ready.`);
             return;
        }

        const key = e.detail.key;
        const jumpTime = AudioApp.uiManager.getJumpTime();

        switch (key) {
            case 'Space':
                AudioApp.audioEngine.togglePlayPause(); // Will check worklet readiness internally too
                break;
            case 'ArrowLeft':
                AudioApp.audioEngine.jumpBy(-jumpTime); // Will check worklet readiness internally too
                break;
            case 'ArrowRight':
                AudioApp.audioEngine.jumpBy(jumpTime); // Will check worklet readiness internally too
                break;
        }
    }

    /**
     * Handles window 'resize' event. Updates visuals.
     * @private
     */
    function handleWindowResize() {
        AudioApp.visualizer.resizeAndRedraw(currentAudioBuffer, AudioApp.vadAnalyzer.getCurrentRegions());
        const { currentTime, duration } = AudioApp.audioEngine.getCurrentTime();
        AudioApp.visualizer.updateProgressIndicator(currentTime, duration);
        AudioApp.uiManager.updateTimeDisplay(currentTime, duration);
    }

    /**
     * Handles window 'beforeunload' event. Cleans up engine.
     * @private
     */
    function handleBeforeUnload() {
        AudioApp.audioEngine.cleanup();
    }


    // --- Public Interface ---
    return {
        init: init
    };
})(); // End of AudioApp IIFE
// --- /vibe-player/js/app.js ---
