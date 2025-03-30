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
    /** @type {AudioBuffer|null} */ let currentAudioBuffer = null;
    /** @type {Float32Array|null} */ let currentPcm16k = null;
    /** @type {object|null} */ let currentVadResults = null;
    /** @type {File|null} */ let currentFile = null;
    /** @type {boolean} */ let vadModelReady = false;
    /** @type {boolean} */ let workletPlaybackReady = false;


    // --- Initialization ---

    /**
     * Initializes the entire Vibe Player application.
     * @public
     */
    function init() {
        console.log("AudioApp: Initializing...");

        // Initialize modules (order can matter)
        AudioApp.uiManager.init();       // Handles UI elements & events
        AudioApp.audioEngine.init();     // Handles Web Audio, Worklet, playback
        AudioApp.visualizer.init();      // Handles Canvas drawing

        // Setup event listeners for communication between modules
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
        document.addEventListener('audioapp:seekRequested', handleSeek); // From canvas clicks
        document.addEventListener('audioapp:seekBarInput', handleSeekBarInput); // From seek bar drag/input NEW
        document.addEventListener('audioapp:speedChanged', handleSpeedChange);
        document.addEventListener('audioapp:pitchChanged', handlePitchChange);
        document.addEventListener('audioapp:formantChanged', handleFormantChange);
        document.addEventListener('audioapp:gainChanged', handleGainChange);
        document.addEventListener('audioapp:thresholdChanged', handleThresholdChange);
        document.addEventListener('audioapp:keyPressed', handleKeyPress);

        // --- AudioEngine -> App Event Listeners ---
        document.addEventListener('audioapp:audioLoaded', handleAudioLoaded);
        document.addEventListener('audioapp:resamplingComplete', handleResamplingComplete);
        document.addEventListener('audioapp:workletReady', handleWorkletReady);
        document.addEventListener('audioapp:decodingError', handleAudioError);
        document.addEventListener('audioapp:resamplingError', handleAudioError);
        document.addEventListener('audioapp:playbackError', handleAudioError);
        document.addEventListener('audioapp:engineError', handleAudioError);
        document.addEventListener('audioapp:timeUpdated', handleTimeUpdate); // Updates seek bar & time display
        document.addEventListener('audioapp:playbackEnded', handlePlaybackEnded);
        document.addEventListener('audioapp:playbackStateChanged', handlePlaybackStateChange);


        // --- Window Event Listeners ---
        window.addEventListener('resize', handleWindowResize);
        window.addEventListener('beforeunload', handleBeforeUnload);
    }

    // --- Event Handler Functions ---

    /**
     * Handles file selection. Resets state, starts loading process.
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
        workletPlaybackReady = false; // Worklet needs new audio

        // Reset UI elements
        AudioApp.uiManager.resetUI(); // This now also resets filename, disables seek bar
        AudioApp.uiManager.setFileInfo(`Loading: ${file.name}...`);
        AudioApp.visualizer.clearVisuals();
        AudioApp.visualizer.showSpinner(true);

        try {
            // Start the loading/processing pipeline in AudioEngine
            await AudioApp.audioEngine.loadAndProcessFile(file);
        } catch (error) {
            console.error("App: Error initiating file processing -", error);
            AudioApp.uiManager.setFileInfo(`Error loading: ${error.message}`);
            AudioApp.uiManager.resetUI(); // Ensure UI is reset on error
            AudioApp.visualizer.showSpinner(false);
        }
    }

    /**
     * Handles audio decoded and loaded by AudioEngine.
     * @param {CustomEvent<{audioBuffer: AudioBuffer}>} e
     * @private
     */
    function handleAudioLoaded(e) {
        currentAudioBuffer = e.detail.audioBuffer;
        console.log(`App: Audio decoded (${currentAudioBuffer.duration.toFixed(2)}s)`);
        // Update total time display (current time is 0)
        AudioApp.uiManager.updateTimeDisplay(0, currentAudioBuffer.duration);
        // Seek bar max is always 1 (representing fraction)
        // AudioApp.uiManager.updateSeekBarMax(currentAudioBuffer.duration); // Not needed if using fraction
    }

    /**
     * Handles audio resampling completion, triggers VAD analysis and visualization.
     * @param {CustomEvent<{pcmData: Float32Array}>} e
     * @private
     */
    async function handleResamplingComplete(e) {
        currentPcm16k = e.detail.pcmData;
        console.log(`App: Audio resampled (${currentPcm16k.length} samples @ 16kHz)`);

        let vadCreationSuccess = vadModelReady;
        if (!vadModelReady) {
            console.log("App: Attempting to create/load VAD model...");
            try {
                vadCreationSuccess = await AudioApp.sileroWrapper.create(16000); // Use Silero wrapper
                if (vadCreationSuccess) {
                    vadModelReady = true;
                    console.log("App: VAD model created.");
                } else {
                    console.error("App: Failed to create VAD model.");
                    AudioApp.uiManager.setSpeechRegionsText("VAD Model Error"); // Update UI status
                    AudioApp.uiManager.enableVadControls(false);
                }
            } catch (creationError) {
                console.error("App: VAD model creation error:", creationError);
                vadCreationSuccess = false;
                AudioApp.uiManager.setSpeechRegionsText(`VAD Load Error: ${creationError.message}`);
                AudioApp.uiManager.enableVadControls(false);
            }
        }

        // Proceed with VAD analysis only if model is ready
        if (vadCreationSuccess) {
            console.log("App: Starting VAD analysis...");
            // AudioApp.uiManager.setSpeechRegionsText("Analyzing VAD..."); // Update status if needed
            try {
                currentVadResults = await AudioApp.vadAnalyzer.analyze(currentPcm16k); // Use VAD analyzer module
                console.log(`App: VAD analysis complete. ${currentVadResults.regions.length} regions.`);
                AudioApp.uiManager.updateVadDisplay(currentVadResults.initialPositiveThreshold, currentVadResults.initialNegativeThreshold);
                AudioApp.uiManager.setSpeechRegionsText(currentVadResults.regions); // Display results (even if hidden)
                AudioApp.uiManager.enableVadControls(true);

                // Draw visuals *after* VAD success
                if (currentAudioBuffer) {
                    console.log("App: Computing/drawing visuals (after VAD success)...");
                    await AudioApp.visualizer.computeAndDrawVisuals(currentAudioBuffer, currentVadResults.regions);
                }

            } catch (analysisError) {
                console.error("App: VAD Analysis failed -", analysisError);
                AudioApp.uiManager.setSpeechRegionsText(`VAD Error: ${analysisError.message}`);
                AudioApp.uiManager.enableVadControls(false);
                // Draw visuals *without* regions if VAD failed
                if (currentAudioBuffer) {
                    console.log("App: Drawing visuals (VAD analysis error)...");
                    await AudioApp.visualizer.computeAndDrawVisuals(currentAudioBuffer, []);
                }
            }
        } else {
             // VAD model failed to initialize
             AudioApp.uiManager.setSpeechRegionsText("VAD Model Error");
             AudioApp.uiManager.enableVadControls(false);
             // Draw visuals *without* regions if VAD init failed
             if (currentAudioBuffer) {
                 console.log("App: Computing/drawing visuals (VAD init failed)...");
                 await AudioApp.visualizer.computeAndDrawVisuals(currentAudioBuffer, []);
             }
        }

        // Hide spinner only after both VAD and visuals attempt are done (if worklet isn't ready yet)
        // If worklet IS ready, spinner is handled in handleWorkletReady
        if (!workletPlaybackReady) {
             AudioApp.visualizer.showSpinner(false);
        }
    }

    /**
     * Handles worklet ready event from AudioEngine. Enables playback controls and seek bar.
     * @param {CustomEvent} e
     * @private
     */
    function handleWorkletReady(e) {
        console.log("App: AudioWorklet processor is ready.");
        workletPlaybackReady = true;
        AudioApp.uiManager.enablePlaybackControls(true);
        AudioApp.uiManager.enableSeekBar(true); // Enable the seek bar
        AudioApp.visualizer.showSpinner(false); // Hide spinner now worklet is ready
        AudioApp.uiManager.setFileInfo(`Ready: ${currentFile ? currentFile.name : 'Unknown File'}`);
    }


    /**
     * Handles various audio error events from AudioEngine.
     * @param {CustomEvent<{type?: string, error: Error}>} e
     * @private
     */
    function handleAudioError(e) {
        const errorType = e.detail.type || 'Unknown';
        const errorMessage = e.detail.error ? e.detail.error.message : 'An unknown error';
        console.error(`App: Audio Error - ${errorType}:`, e.detail.error || errorMessage);

        AudioApp.uiManager.setFileInfo(`Error (${errorType}): ${errorMessage}`);
        AudioApp.uiManager.resetUI(); // Resets controls, file name, disables seek bar etc.
        AudioApp.visualizer.clearVisuals();
        AudioApp.visualizer.showSpinner(false);

        // Reset state
        currentAudioBuffer = null;
        currentPcm16k = null;
        currentVadResults = null;
        currentFile = null;
        workletPlaybackReady = false;
    }

    /** Handles play/pause click event. @private */
    function handlePlayPause() {
        if (!workletPlaybackReady) {
            console.warn("App: Play/Pause ignored - Worklet not ready."); return;
        }
        AudioApp.audioEngine.togglePlayPause();
    }

    /** Handles jump button click event. @param {CustomEvent<{seconds: number}>} e @private */
    function handleJump(e) {
        if (!workletPlaybackReady) return;
        AudioApp.audioEngine.jumpBy(e.detail.seconds);
    }

    /**
     * Handles seek request from visualizer click.
     * @param {CustomEvent<{fraction: number}>} e
     * @private
     */
    function handleSeek(e) {
        if (!workletPlaybackReady || !currentAudioBuffer || isNaN(currentAudioBuffer.duration) || currentAudioBuffer.duration <= 0) return;
        const targetTime = e.detail.fraction * currentAudioBuffer.duration;
        AudioApp.audioEngine.seek(targetTime);
        // Optimistically update UI immediately
        AudioApp.uiManager.updateTimeDisplay(targetTime, currentAudioBuffer.duration);
        AudioApp.uiManager.updateSeekBar(e.detail.fraction);
        AudioApp.visualizer.updateProgressIndicator(targetTime, currentAudioBuffer.duration);
    }

    /**
     * Handles seek request from the new seek bar input.
     * @param {CustomEvent<{fraction: number}>} e
     * @private
     */
    function handleSeekBarInput(e) {
         if (!workletPlaybackReady || !currentAudioBuffer || isNaN(currentAudioBuffer.duration) || currentAudioBuffer.duration <= 0) return;
         const targetTime = e.detail.fraction * currentAudioBuffer.duration;
         AudioApp.audioEngine.seek(targetTime);
         // Optimistically update UI immediately
         AudioApp.uiManager.updateTimeDisplay(targetTime, currentAudioBuffer.duration);
         // No need to updateSeekBar here, as the input event already changed its value
         AudioApp.visualizer.updateProgressIndicator(targetTime, currentAudioBuffer.duration);
    }

    /** Handles speed slider change event. @param {CustomEvent<{speed: number}>} e @private */
    function handleSpeedChange(e) {
        AudioApp.audioEngine.setSpeed(e.detail.speed);
    }

    /** Handles pitch slider change event. @param {CustomEvent<{pitch: number}>} e @private */
    function handlePitchChange(e) {
        AudioApp.audioEngine.setPitch(e.detail.pitch);
    }

    /** Handles formant slider change event. @param {CustomEvent<{formant: number}>} e @private */
    function handleFormantChange(e) {
        AudioApp.audioEngine.setFormant(e.detail.formant);
    }

    /** Handles gain slider change event. @param {CustomEvent<{gain: number}>} e @private */
    function handleGainChange(e) {
        AudioApp.audioEngine.setGain(e.detail.gain);
    }

    /** Handles VAD threshold slider change event. @param {CustomEvent<{type: string, value: number}>} e @private */
    function handleThresholdChange(e) {
        if (!currentVadResults || !currentAudioBuffer) return;
        const { type, value } = e.detail;
        // Use VAD Analyzer to handle update and recalculation
        const newRegions = AudioApp.vadAnalyzer.handleThresholdUpdate(type, value);
        AudioApp.uiManager.setSpeechRegionsText(newRegions); // Update hidden display if needed
        AudioApp.visualizer.redrawWaveformHighlight(currentAudioBuffer, newRegions); // Redraw waveform
    }

    /**
     * Handles time update event from AudioEngine. Updates UI time display and visual progress.
     * @param {CustomEvent<{currentTime: number, duration: number}>} e
     * @private
     */
    function handleTimeUpdate(e) {
        const { currentTime, duration } = e.detail;
        if (isNaN(duration) || duration <= 0) return; // Avoid division by zero

        const fraction = currentTime / duration;
        AudioApp.uiManager.updateTimeDisplay(currentTime, duration);
        AudioApp.uiManager.updateSeekBar(fraction); // Update seek bar position
        AudioApp.visualizer.updateProgressIndicator(currentTime, duration);
    }

    /** Handles playback ended event from AudioEngine. @private */
    function handlePlaybackEnded() {
        console.log("App: Playback ended event received.");
        // State change (isPlaying=false) is handled by playbackStateChanged event
        // Reset visual indicators? The timeUpdate should have set them to the end.
        // Maybe reset seek bar to 0 if desired?
        // AudioApp.uiManager.updateSeekBar(0); // Optional: Reset seek bar on end
    }

    /** Handles playback state change event from AudioEngine. @param {CustomEvent<{isPlaying: boolean}>} e @private */
     function handlePlaybackStateChange(e) {
        AudioApp.uiManager.setPlayButtonState(e.detail.isPlaying);
    }

    /** Handles key press event from UI Manager. @param {CustomEvent<{key: string}>} e @private */
    function handleKeyPress(e) {
        if (!workletPlaybackReady) return; // Ignore keys if not ready
        const key = e.detail.key;
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

    /** Handles window resize event. @private */
    function handleWindowResize() {
        // Redraw visuals and update progress indicators based on new size
        AudioApp.visualizer.resizeAndRedraw(currentAudioBuffer, AudioApp.vadAnalyzer.getCurrentRegions());
    }

    /** Handles window beforeunload event. @private */
    function handleBeforeUnload() {
        // Clean up audio resources
        AudioApp.audioEngine.cleanup();
    }


    // --- Public Interface ---
    return {
        init: init
        // Expose other methods if needed for debugging or extensions
    };
})(); // End of AudioApp IIFE
// --- /vibe-player/js/app.js ---
