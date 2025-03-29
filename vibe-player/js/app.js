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

        // Initialize modules
        AudioApp.uiManager.init();
        AudioApp.audioEngine.init();
        AudioApp.visualizer.init();

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
        document.addEventListener('audioapp:pitchChanged', handlePitchChange); // New
        document.addEventListener('audioapp:formantChanged', handleFormantChange); // New
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
        document.addEventListener('audioapp:timeUpdated', handleTimeUpdate);
        document.addEventListener('audioapp:playbackEnded', handlePlaybackEnded);
        document.addEventListener('audioapp:playbackStateChanged', handlePlaybackStateChange);


        // --- Window Event Listeners ---
        window.addEventListener('resize', handleWindowResize);
        window.addEventListener('beforeunload', handleBeforeUnload);
    }

    // --- Event Handler Functions ---

    /**
     * Handles file selection.
     * @param {CustomEvent<{file: File}>} e
     * @private
     */
    async function handleFileSelected(e) {
        // ... (File handling logic remains the same) ...
        const file = e.detail.file; if (!file) return; currentFile = file; console.log("App: File selected -", file.name); currentAudioBuffer = null; currentPcm16k = null; currentVadResults = null; workletPlaybackReady = false; AudioApp.uiManager.resetUI(); AudioApp.uiManager.setFileInfo(`Loading: ${file.name}...`); AudioApp.visualizer.clearVisuals(); AudioApp.visualizer.showSpinner(true); try { await AudioApp.audioEngine.loadAndProcessFile(file); } catch (error) { console.error("App: Error initiating file processing -", error); AudioApp.uiManager.setFileInfo(`Error loading: ${error.message}`); AudioApp.uiManager.resetUI(); AudioApp.visualizer.showSpinner(false); }
    }

    /**
     * Handles audio loaded event.
     * @param {CustomEvent<{audioBuffer: AudioBuffer}>} e
     * @private
     */
    function handleAudioLoaded(e) {
        // ... (Audio loaded logic remains the same) ...
        currentAudioBuffer = e.detail.audioBuffer; console.log(`App: Audio decoded (${currentAudioBuffer.duration.toFixed(2)}s)`); AudioApp.uiManager.updateTimeDisplay(0, currentAudioBuffer.duration);
    }

    /**
     * Handles resampling complete, triggers VAD analysis and visualization.
     * @param {CustomEvent<{pcmData: Float32Array}>} e
     * @private
     */
    async function handleResamplingComplete(e) {
        // ... (Resampling and VAD analysis logic remains the same) ...
        currentPcm16k = e.detail.pcmData; console.log(`App: Audio resampled (${currentPcm16k.length} samples @ 16kHz)`); let vadCreationSuccess = vadModelReady; if (!vadModelReady) { console.log("App: Attempting to create/load VAD model..."); try { vadCreationSuccess = await AudioApp.sileroWrapper.create(16000); if (vadCreationSuccess) { vadModelReady = true; console.log("App: VAD model created."); } else { console.error("App: Failed to create VAD model."); AudioApp.uiManager.setSpeechRegionsText("VAD Model Error"); AudioApp.uiManager.enableVadControls(false); } } catch (creationError) { console.error("App: VAD model creation error:", creationError); vadCreationSuccess = false; AudioApp.uiManager.setSpeechRegionsText(`VAD Load Error: ${creationError.message}`); AudioApp.uiManager.enableVadControls(false); } } if (vadCreationSuccess) { console.log("App: Starting VAD analysis..."); AudioApp.uiManager.setSpeechRegionsText("Analyzing VAD..."); try { currentVadResults = await AudioApp.vadAnalyzer.analyze(currentPcm16k); console.log(`App: VAD analysis complete. ${currentVadResults.regions.length} regions.`); AudioApp.uiManager.updateVadDisplay(currentVadResults.initialPositiveThreshold, currentVadResults.initialNegativeThreshold); AudioApp.uiManager.setSpeechRegionsText(currentVadResults.regions); AudioApp.uiManager.enableVadControls(true); if (currentAudioBuffer) { console.log("App: Computing/drawing visuals (after VAD success)..."); AudioApp.visualizer.computeAndDrawVisuals(currentAudioBuffer, currentVadResults.regions) .catch(visError => console.error("App: Vis failed after VAD success:", visError)) .finally(() => { if (workletPlaybackReady) AudioApp.visualizer.showSpinner(false); }); } } catch (analysisError) { console.error("App: VAD Analysis failed -", analysisError); AudioApp.uiManager.setSpeechRegionsText(`VAD Error: ${analysisError.message}`); AudioApp.uiManager.enableVadControls(false); if (currentAudioBuffer) { console.log("App: Drawing visuals (VAD analysis error)..."); AudioApp.visualizer.computeAndDrawVisuals(currentAudioBuffer, []) .catch(visError => console.error("App: Vis failed after VAD error:", visError)) .finally(() => AudioApp.visualizer.showSpinner(false)); } else { AudioApp.visualizer.showSpinner(false); } } } else { AudioApp.uiManager.setSpeechRegionsText("VAD Model Error"); AudioApp.uiManager.enableVadControls(false); if (currentAudioBuffer) { console.log("App: Computing/drawing visuals (VAD init failed)..."); AudioApp.visualizer.computeAndDrawVisuals(currentAudioBuffer, []) .catch(visError => console.error("App: Vis failed after VAD init error:", visError)) .finally(() => AudioApp.visualizer.showSpinner(false)); } else { AudioApp.visualizer.showSpinner(false); } }
    }

    /**
     * Handles worklet ready event, enables playback controls.
     * @param {CustomEvent} e
     * @private
     */
    function handleWorkletReady(e) {
        // ... (Worklet ready logic remains the same) ...
        console.log("App: AudioWorklet processor is ready."); workletPlaybackReady = true; AudioApp.uiManager.enablePlaybackControls(true); AudioApp.visualizer.showSpinner(false); AudioApp.uiManager.setFileInfo(`Ready: ${currentFile ? currentFile.name : 'Unknown File'}`);
    }


    /**
     * Handles various audio error events.
     * @param {CustomEvent<{type?: string, error: Error}>} e
     * @private
     */
    function handleAudioError(e) {
        // ... (Error handling remains the same) ...
        const errorType = e.detail.type || 'Unknown'; const errorMessage = e.detail.error ? e.detail.error.message : 'An unknown error'; console.error(`App: Audio Error - ${errorType}:`, e.detail.error || errorMessage); AudioApp.uiManager.setFileInfo(`Error (${errorType}): ${errorMessage}`); AudioApp.uiManager.resetUI(); AudioApp.visualizer.clearVisuals(); AudioApp.visualizer.showSpinner(false); currentAudioBuffer = null; currentPcm16k = null; currentVadResults = null; currentFile = null; workletPlaybackReady = false;
    }

    /**
     * Handles play/pause click event.
     * @private
     */
    function handlePlayPause() {
        // ... (Play/pause logic remains the same) ...
        if (!workletPlaybackReady) { console.warn("App: Play/Pause ignored - Worklet not ready."); return; } AudioApp.audioEngine.togglePlayPause();
    }

    /**
     * Handles jump button click event.
     * @param {CustomEvent<{seconds: number}>} e
     * @private
     */
    function handleJump(e) {
        // ... (Jump logic remains the same) ...
        if (!workletPlaybackReady) return; AudioApp.audioEngine.jumpBy(e.detail.seconds);
    }

    /**
     * Handles seek request from visualizer click.
     * @param {CustomEvent<{fraction: number}>} e
     * @private
     */
    function handleSeek(e) {
        // ... (Seek logic remains the same) ...
        if (!workletPlaybackReady || !currentAudioBuffer || isNaN(currentAudioBuffer.duration) || currentAudioBuffer.duration <= 0) return; const targetTime = e.detail.fraction * currentAudioBuffer.duration; AudioApp.audioEngine.seek(targetTime);
    }

    /**
     * Handles speed slider change event.
     * @param {CustomEvent<{speed: number}>} e
     * @private
     */
    function handleSpeedChange(e) {
        // ... (Speed change logic remains the same) ...
        AudioApp.audioEngine.setSpeed(e.detail.speed);
    }

    /**
     * Handles pitch slider change event.
     * @param {CustomEvent<{pitch: number}>} e
     * @private
     */
    function handlePitchChange(e) { // New Handler
        AudioApp.audioEngine.setPitch(e.detail.pitch);
    }

    /**
     * Handles formant slider change event.
     * @param {CustomEvent<{formant: number}>} e
     * @private
     */
    function handleFormantChange(e) { // New Handler
        AudioApp.audioEngine.setFormant(e.detail.formant);
    }

    /**
     * Handles gain slider change event.
     * @param {CustomEvent<{gain: number}>} e
     * @private
     */
    function handleGainChange(e) {
        // ... (Gain change logic remains the same) ...
        AudioApp.audioEngine.setGain(e.detail.gain);
    }

    /**
     * Handles VAD threshold slider change event.
     * @param {CustomEvent<{type: string, value: number}>} e
     * @private
     */
    function handleThresholdChange(e) {
        // ... (Threshold change logic remains the same) ...
        if (!currentVadResults || !currentAudioBuffer) return; const { type, value } = e.detail; const newRegions = AudioApp.vadAnalyzer.handleThresholdUpdate(type, value); AudioApp.uiManager.setSpeechRegionsText(newRegions); AudioApp.visualizer.redrawWaveformHighlight(currentAudioBuffer, newRegions);
    }

    /**
     * Handles time update event from engine.
     * @param {CustomEvent<{currentTime: number, duration: number}>} e
     * @private
     */
    function handleTimeUpdate(e) {
        // ... (Time update logic remains the same) ...
        const { currentTime, duration } = e.detail; AudioApp.uiManager.updateTimeDisplay(currentTime, duration); AudioApp.visualizer.updateProgressIndicator(currentTime, duration);
    }

    /**
     * Handles playback ended event.
     * @private
     */
    function handlePlaybackEnded() {
        // ... (Playback ended logic remains the same) ...
        console.log("App: Playback ended event received.");
    }

    /**
     * Handles playback state change event.
     * @param {CustomEvent<{isPlaying: boolean}>} e
     * @private
     */
     function handlePlaybackStateChange(e) {
        // ... (Playback state change logic remains the same) ...
        AudioApp.uiManager.setPlayButtonState(e.detail.isPlaying);
    }

    /**
     * Handles key press event.
     * @param {CustomEvent<{key: string}>} e
     * @private
     */
    function handleKeyPress(e) {
        // ... (Key press logic remains the same) ...
        if (!workletPlaybackReady) { /* console.warn(`App: Key press '${e.detail.key}' ignored - Worklet not ready.`); */ return; } const key = e.detail.key; const jumpTime = AudioApp.uiManager.getJumpTime(); switch (key) { case 'Space': AudioApp.audioEngine.togglePlayPause(); break; case 'ArrowLeft': AudioApp.audioEngine.jumpBy(-jumpTime); break; case 'ArrowRight': AudioApp.audioEngine.jumpBy(jumpTime); break; }
    }

    /**
     * Handles window resize event.
     * @private
     */
    function handleWindowResize() {
        // ... (Resize logic remains the same) ...
        AudioApp.visualizer.resizeAndRedraw(currentAudioBuffer, AudioApp.vadAnalyzer.getCurrentRegions()); const { currentTime, duration } = AudioApp.audioEngine.getCurrentTime(); AudioApp.visualizer.updateProgressIndicator(currentTime, duration); AudioApp.uiManager.updateTimeDisplay(currentTime, duration);
    }

    /**
     * Handles window beforeunload event.
     * @private
     */
    function handleBeforeUnload() {
        // ... (Unload logic remains the same) ...
        AudioApp.audioEngine.cleanup();
    }


    // --- Public Interface ---
    return {
        init: init
    };
})(); // End of AudioApp IIFE
// --- /vibe-player/js/app.js ---
