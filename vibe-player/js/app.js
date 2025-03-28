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
    // Design Decision: Keep minimal state here. Modules manage their own internal state.
    /** @type {AudioBuffer|null} The fully decoded *original* audio buffer */
    let currentAudioBuffer = null;
    /** @type {Float32Array|null} The 16kHz mono resampled audio for VAD */
    let currentPcm16k = null;
    /** @type {object|null} Stores VAD results: { regions, probabilities, frameSamples, sampleRate, initialPositiveThreshold, initialNegativeThreshold, redemptionFrames } */
    let currentVadResults = null;
     /** @type {File|null} The currently loaded audio file object */
    let currentFile = null;
    /**
     * Flag to track if the VAD model creation has been attempted and succeeded at least once.
     * Prevents redundant attempts to load the model.
     * @type {boolean}
     */
    let vadModelReady = false;

    // --- Initialization ---

    /**
     * Initializes the entire Vibe Player application.
     * Sets up modules and event listeners.
     * @public
     */
    function init() {
        console.log("AudioApp: Initializing...");

        // Initialize modules in a logical order
        AudioApp.uiManager.init();
        AudioApp.audioEngine.init();
        AudioApp.visualizer.init();
        // VAD modules (sileroWrapper, sileroProcessor, vadAnalyzer) don't need explicit init before analysis

        // Setup event listeners for communication between modules
        // Design Decision: Use Custom DOM Events for loose coupling between modules.
        // 'app.js' acts as the central listener and coordinator.
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
        document.addEventListener('audioapp:seekRequested', handleSeek); // From Visualizer clicks
        document.addEventListener('audioapp:speedChanged', handleSpeedChange);
        document.addEventListener('audioapp:gainChanged', handleGainChange);
        document.addEventListener('audioapp:thresholdChanged', handleThresholdChange);
        document.addEventListener('audioapp:keyPressed', handleKeyPress); // From uiManager

        // --- AudioEngine -> App Event Listeners ---
        document.addEventListener('audioapp:audioLoaded', handleAudioLoaded);
        document.addEventListener('audioapp:resamplingComplete', handleResamplingComplete);
        document.addEventListener('audioapp:decodingError', handleAudioError);
        document.addEventListener('audioapp:resamplingError', handleAudioError);
        document.addEventListener('audioapp:playbackError', handleAudioError); // Handle generic playback errors
        document.addEventListener('audioapp:timeUpdated', handleTimeUpdate);
        document.addEventListener('audioapp:playbackEnded', handlePlaybackEnded);
        document.addEventListener('audioapp:playbackStateChanged', handlePlaybackStateChange);
        document.addEventListener('audioapp:engineError', handleAudioError); // Handle context/connect errors

        // --- Window Event Listeners ---
        window.addEventListener('resize', handleWindowResize);
        window.addEventListener('beforeunload', handleBeforeUnload);
    }

    // --- Event Handler Functions ---

    /**
     * Handles the 'audioapp:fileSelected' event from uiManager.
     * Resets state, starts the audio loading/processing pipeline.
     * @param {CustomEvent} e - The event object.
     * @param {File} e.detail.file - The selected audio file.
     * @private
     */
    async function handleFileSelected(e) {
        const file = e.detail.file;
        if (!file) return;

        currentFile = file;
        console.log("App: File selected -", file.name);

        // Reset application state and UI
        currentAudioBuffer = null;
        currentPcm16k = null;
        currentVadResults = null;
        // vadModelReady flag persists across file loads unless the page is refreshed.
        AudioApp.uiManager.resetUI();
        AudioApp.uiManager.setFileInfo(`Loading: ${file.name}...`);
        AudioApp.visualizer.clearVisuals();
        AudioApp.visualizer.showSpinner(true);

        try {
            // Delegate loading, decoding, and resampling to the Audio Engine
            await AudioApp.audioEngine.loadAndProcessFile(file);
            // Subsequent processing steps are triggered by events from AudioEngine
        } catch (error) {
            // Catch errors during the initial load trigger phase
            console.error("App: Error initiating file processing -", error);
            AudioApp.uiManager.setFileInfo(`Error loading: ${error.message}`);
            AudioApp.uiManager.resetUI();
            AudioApp.visualizer.showSpinner(false);
        }
    }

    /**
     * Handles the 'audioapp:audioLoaded' event from audioEngine.
     * Stores the original decoded buffer and updates UI.
     * @param {CustomEvent} e - The event object.
     * @param {AudioBuffer} e.detail.audioBuffer - The decoded original audio buffer.
     * @private
     */
    function handleAudioLoaded(e) {
        currentAudioBuffer = e.detail.audioBuffer;
        console.log(`App: Audio decoded (${currentAudioBuffer.duration.toFixed(2)}s)`);
        // Update total time display immediately
        AudioApp.uiManager.updateTimeDisplay(0, currentAudioBuffer.duration);
        // AudioEngine will proceed with resampling and dispatch 'resamplingComplete'
    }

    /**
     * Handles the 'audioapp:resamplingComplete' event from audioEngine.
     * Stores the 16kHz PCM data, ensures VAD model is created (once per page load),
     * triggers VAD analysis, then visualization.
     * @param {CustomEvent} e - The event object.
     * @param {Float32Array} e.detail.pcmData - The 16kHz mono PCM data.
     * @private
     */
    async function handleResamplingComplete(e) { // Still async
        currentPcm16k = e.detail.pcmData;
        console.log(`App: Audio resampled (${currentPcm16k.length} samples @ 16kHz)`);

        // --- Ensure VAD Model is Created (Once per Page Load) ---
        let vadCreationSuccess = vadModelReady;
        if (!vadModelReady) {
            console.log("App: Attempting to create/load VAD model for the first time...");
            try {
                vadCreationSuccess = await AudioApp.sileroWrapper.create(16000);
                if (vadCreationSuccess) {
                    vadModelReady = true;
                    console.log("App: VAD model created successfully.");
                } else {
                    console.error("App: Failed to create VAD model via wrapper (returned false).");
                    AudioApp.uiManager.setFileInfo("Error: Could not load VAD model.");
                    AudioApp.uiManager.enableVadControls(false);
                }
            } catch (creationError) {
                console.error("App: Error during VAD model creation:", creationError);
                vadCreationSuccess = false;
                AudioApp.uiManager.setFileInfo(`Error: Could not load VAD model. ${creationError.message}`);
                AudioApp.uiManager.enableVadControls(false);
            }
        } else {
            console.log("App: VAD model already initialized.");
            // Processor calls wrapper.reset_state() internally now
        }
        // --- End VAD Model Creation Check ---

        // --- VAD Analysis Stage ---
        if (vadCreationSuccess) {
            console.log("App: Starting VAD analysis...");
            AudioApp.uiManager.setSpeechRegionsText("Analyzing VAD..."); // Update status
            try {
                currentVadResults = await AudioApp.vadAnalyzer.analyze(currentPcm16k); // Line ~197
                console.log(`App: VAD analysis complete. ${currentVadResults.regions.length} initial regions found.`);

                // Update UI with VAD results
                AudioApp.uiManager.updateVadDisplay( // Line ~201
                    currentVadResults.initialPositiveThreshold,
                    currentVadResults.initialNegativeThreshold
                );
                // --- THIS IS THE FIX: Change 'updateSpeechRegionsText' to 'setSpeechRegionsText' ---
                AudioApp.uiManager.setSpeechRegionsText(currentVadResults.regions); // Line ~204 (CORRECTED)
                // --- END FIX ---
                AudioApp.uiManager.enableVadControls(true); // Line ~205
                AudioApp.uiManager.enablePlaybackControls(true); // Enable playback after successful VAD

                // --- Visualization Stage ---
                console.log("App: Computing and drawing visualizations...");
                await AudioApp.visualizer.computeAndDrawVisuals(currentAudioBuffer, currentVadResults.regions);
                console.log("App: Visualizations complete.");
                handleThresholdChange({ detail: { type: 'positive', value: currentVadResults.initialPositiveThreshold } });

            } catch (analysisError) { // Line ~219 context (catch block entry)
                // Catch errors specifically from the analysis stage (e.g., inference error)
                console.error("App: VAD Analysis failed -", analysisError); // <<< This was the error context
                AudioApp.uiManager.setSpeechRegionsText(`VAD Error: ${analysisError.message}`);
                if (currentAudioBuffer) AudioApp.uiManager.enablePlaybackControls(true);
                AudioApp.uiManager.enableVadControls(false);
                if (currentAudioBuffer) {
                     console.log("App: Drawing visuals without VAD highlighting due to analysis error..."); // Line ~226 context
                     await AudioApp.visualizer.computeAndDrawVisuals(currentAudioBuffer, []); // Empty regions
                }
            } finally {
                 AudioApp.visualizer.showSpinner(false);
                 AudioApp.uiManager.setFileInfo(`File: ${currentFile ? currentFile.name : 'Ready'}`);
            }
        } else {
            // Handle case where VAD model failed to load/create
            console.warn("App: Skipping VAD analysis due to model creation failure.");
            AudioApp.uiManager.setSpeechRegionsText("VAD Model Error");
            AudioApp.uiManager.enableVadControls(false);
            if (currentAudioBuffer) AudioApp.uiManager.enablePlaybackControls(true);
            if (currentAudioBuffer) {
                console.log("App: Computing/drawing visuals without VAD highlighting...");
                 AudioApp.visualizer.computeAndDrawVisuals(currentAudioBuffer, [])
                    .catch(visError => console.error("App: Visualization failed after VAD model error:", visError))
                    .finally(() => AudioApp.visualizer.showSpinner(false));
            } else {
                 AudioApp.visualizer.showSpinner(false);
            }
             AudioApp.uiManager.setFileInfo(`File: ${currentFile ? currentFile.name : 'Ready (VAD Error)'}`);
        }
    } // --- End of handleResamplingComplete ---

    /**
     * Handles various audio error events from audioEngine or processing stages.
     * @param {CustomEvent} e - The event object.
     * @param {string} [e.detail.type] - Type of error (e.g., 'decode', 'resample', 'playback', 'context', 'load', 'engine').
     * @param {Error} e.detail.error - The error object.
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
        // Reset state variables
        currentAudioBuffer = null;
        currentPcm16k = null;
        currentVadResults = null;
        currentFile = null;
        // Don't reset vadModelReady automatically on all errors
    }

    /**
     * Handles 'audioapp:playPauseClicked' event. Toggles playback.
     * @private
     */
    function handlePlayPause() {
        if (!currentAudioBuffer) return;
        AudioApp.audioEngine.togglePlayPause();
    }

    /**
     * Handles 'audioapp:jumpClicked' event. Jumps playback time.
     * @param {CustomEvent} e - The event object.
     * @param {number} e.detail.seconds - Seconds to jump (positive or negative).
     * @private
     */
    function handleJump(e) {
        if (!currentAudioBuffer) return;
        AudioApp.audioEngine.jumpBy(e.detail.seconds);
    }

    /**
     * Handles 'audioapp:seekRequested' event (from visualizer click). Seeks playback time.
     * @param {CustomEvent} e - The event object.
     * @param {number} e.detail.fraction - The fraction of the duration to seek to (0.0 to 1.0).
     * @private
     */
    function handleSeek(e) {
        if (!currentAudioBuffer || isNaN(currentAudioBuffer.duration) || currentAudioBuffer.duration <= 0) return;
        const targetTime = e.detail.fraction * currentAudioBuffer.duration;
        AudioApp.audioEngine.seek(targetTime);
    }

    /**
     * Handles 'audioapp:speedChanged' event. Sets playback speed.
     * @param {CustomEvent} e - The event object.
     * @param {number} e.detail.speed - The new playback speed.
     * @private
     */
    function handleSpeedChange(e) {
        AudioApp.audioEngine.setSpeed(e.detail.speed);
    }

    /**
     * Handles 'audioapp:gainChanged' event. Sets audio gain (volume).
     * @param {CustomEvent} e - The event object.
     * @param {number} e.detail.gain - The new gain value.
     * @private
     */
    function handleGainChange(e) {
        AudioApp.audioEngine.setGain(e.detail.gain);
    }

    /**
     * Handles 'audioapp:thresholdChanged' event (from uiManager sliders).
     * Triggers VAD recalculation and waveform highlight redraw.
     * @param {CustomEvent} e - The event object.
     * @param {string} e.detail.type - 'positive' or 'negative'.
     * @param {number} e.detail.value - The new threshold value.
     * @private
     */
    function handleThresholdChange(e) {
        if (!currentVadResults || !currentAudioBuffer) return; // Need VAD results and buffer

        const { type, value } = e.detail;

        // Update VAD Analyzer's internal thresholds and get recalculated regions
        const newRegions = AudioApp.vadAnalyzer.handleThresholdUpdate(type, value);

        // Update the text display for speech regions using the CORRECT function name
        AudioApp.uiManager.setSpeechRegionsText(newRegions);

        // Redraw *only* the waveform highlighting using the new regions
        AudioApp.visualizer.redrawWaveformHighlight(currentAudioBuffer, newRegions);
    }

    /**
     * Handles 'audioapp:timeUpdated' event from audioEngine.
     * Updates UI time display and visualizer progress indicators.
     * @param {CustomEvent} e - The event object.
     * @param {number} e.detail.currentTime - The current playback time in seconds.
     * @param {number} e.detail.duration - The total audio duration in seconds.
     * @private
     */
    function handleTimeUpdate(e) {
        const { currentTime, duration } = e.detail;
        AudioApp.uiManager.updateTimeDisplay(currentTime, duration);
        AudioApp.visualizer.updateProgressIndicator(currentTime, duration);
    }

    /**
     * Handles 'audioapp:playbackEnded' event from audioEngine.
     * (Currently just logs, UI state changes handled by playbackStateChanged)
     * @private
     */
    function handlePlaybackEnded() {
        console.log("App: Playback ended");
    }

    /**
     * Handles 'audioapp:playbackStateChanged' event from audioEngine.
     * Updates the play/pause button state in the UI.
     * @param {CustomEvent} e - The event object.
     * @param {boolean} e.detail.isPlaying - True if playing, false if paused/stopped.
     * @private
     */
     function handlePlaybackStateChange(e) {
        AudioApp.uiManager.setPlayButtonState(e.detail.isPlaying);
    }

    /**
     * Handles 'audioapp:keyPressed' event from uiManager.
     * Executes playback actions based on keyboard shortcuts.
     * @param {CustomEvent} e - The event object.
     * @param {string} e.detail.key - The key code ('Space', 'ArrowLeft', 'ArrowRight').
     * @private
     */
    function handleKeyPress(e) {
        if (!currentAudioBuffer) return; // Ignore keys if no audio loaded

        const key = e.detail.key;
        // Get jump time dynamically from UI manager in case user changed it
        const jumpTime = AudioApp.uiManager.getJumpTime();

        switch (key) {
            case 'Space':
                AudioApp.audioEngine.togglePlayPause();
                break;
            case 'ArrowLeft':
                AudioApp.audioEngine.jumpBy(-jumpTime);
                break;
            case 'ArrowRight':
                AudioApp.audioEngine.jumpBy(jumpTime);
                break;
        }
    }

    /**
     * Handles the window 'resize' event.
     * Triggers redraw of visualizations and updates progress indicators.
     * @private
     */
    function handleWindowResize() {
        // Design Decision: Debouncing could be added here for performance on rapid resizing,
        // but for simplicity, call directly for now.
        AudioApp.visualizer.resizeAndRedraw(currentAudioBuffer, AudioApp.vadAnalyzer.getCurrentRegions());
         // Update progress immediately after resize ensures indicator is positioned correctly
         const { currentTime, duration } = AudioApp.audioEngine.getCurrentTime();
         AudioApp.visualizer.updateProgressIndicator(currentTime, duration);
         AudioApp.uiManager.updateTimeDisplay(currentTime, duration); // Also update text time display
    }

    /**
     * Handles the window 'beforeunload' event.
     * Performs cleanup tasks like revoking Object URLs and closing AudioContext.
     * @private
     */
    function handleBeforeUnload() {
        AudioApp.audioEngine.cleanup();
    }


    // --- Public Interface ---
    // Design Decision: Only expose the `init` function publicly.
    return {
        init: init
    };
})(); // End of AudioApp IIFE
