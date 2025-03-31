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

    // === Module Dependencies ===
    // Assuming other modules (uiManager, audioEngine, visualizers, VAD modules, constants, utils)
    // are loaded and attached to AudioApp before init() is called.
    // We'll access them via the AudioApp namespace.

    // --- Application State ---
    /** @type {AudioBuffer|null} */ let currentAudioBuffer = null;
    /** @type {VadResult|null} */ let currentVadResults = null;
    /** @type {File|null} */ let currentFile = null;
    /** @type {boolean} */ let vadModelReady = false; // VAD model itself
    /** @type {boolean} */ let workletPlaybackReady = false; // Audio engine ready for playback
    /** @type {boolean} */ let isVadProcessing = false; // If VAD analysis task is running

    // --- Main Thread Playback Time State ---
    /** @type {number|null} */ let playbackStartTimeContext = null;
    /** @type {number} */ let playbackStartSourceTime = 0.0;
    /** @type {boolean} */ let isActuallyPlaying = false;
    /** @type {number|null} */ let rAFUpdateHandle = null;
    /** @type {number} */ let currentSpeedForUpdate = 1.0;

    // --- Initialization ---
    /** @public */
    function init() {
        console.log("AudioApp: Initializing...");

        // Check for critical module dependencies
        if (!AudioApp.uiManager || !AudioApp.audioEngine || !AudioApp.waveformVisualizer || !AudioApp.spectrogramVisualizer || !AudioApp.vadAnalyzer || !AudioApp.sileroWrapper || !AudioApp.Constants || !AudioApp.Utils) {
             console.error("AudioApp: CRITICAL - One or more required modules/constants/utils not found on AudioApp namespace! Check script loading order.");
             // Optionally display a user-facing error
             AudioApp.uiManager?.setFileInfo("Initialization Error: Missing modules. Check console.");
             return;
        }

        // Initialize modules
        AudioApp.uiManager.init();
        AudioApp.audioEngine.init();
        AudioApp.waveformVisualizer.init(); // Init new waveform visualizer
        AudioApp.spectrogramVisualizer.init(); // Init new spectrogram visualizer
        // VAD modules don't have explicit init functions currently
        setupAppEventListeners();
        console.log("AudioApp: Initialized. Waiting for file...");
    }

    // --- Event Listener Setup ---
    /** @private */
    function setupAppEventListeners() {
        // UI -> App
        document.addEventListener('audioapp:fileSelected', handleFileSelected);
        document.addEventListener('audioapp:playPauseClicked', handlePlayPause);
        document.addEventListener('audioapp:jumpClicked', handleJump);
        document.addEventListener('audioapp:seekRequested', handleSeek);
        document.addEventListener('audioapp:seekBarInput', handleSeekBarInput);
        document.addEventListener('audioapp:speedChanged', handleSpeedChange);
        document.addEventListener('audioapp:pitchChanged', handlePitchChange);
        document.addEventListener('audioapp:gainChanged', handleGainChange);
        document.addEventListener('audioapp:thresholdChanged', handleThresholdChange);
        document.addEventListener('audioapp:keyPressed', handleKeyPress);
        // AudioEngine -> App
        document.addEventListener('audioapp:audioLoaded', handleAudioLoaded);
        document.addEventListener('audioapp:workletReady', handleWorkletReady);
        document.addEventListener('audioapp:decodingError', handleAudioError);
        document.addEventListener('audioapp:resamplingError', handleAudioError);
        document.addEventListener('audioapp:playbackError', handleAudioError);
        document.addEventListener('audioapp:engineError', handleAudioError);
        document.addEventListener('audioapp:playbackEnded', handlePlaybackEnded);
        document.addEventListener('audioapp:playbackStateChanged', handlePlaybackStateChange);
        document.addEventListener('audioapp:internalSpeedChanged', handleInternalSpeedChange);
        // Window Events
        window.addEventListener('resize', handleWindowResize);
        window.addEventListener('beforeunload', handleBeforeUnload);
    }

    // --- Event Handler Functions ---

    /** @param {CustomEvent<{file: File}>} e @private */
    async function handleFileSelected(e) {
        const file = e.detail.file; if (!file) return;
        currentFile = file;
        console.log("App: File selected -", file.name);

        // Reset state
        stopUIUpdateLoop();
        isActuallyPlaying = false; isVadProcessing = false;
        playbackStartTimeContext = null; playbackStartSourceTime = 0.0;
        currentSpeedForUpdate = 1.0; currentAudioBuffer = null;
        currentVadResults = null; workletPlaybackReady = false;

        // Reset UI & Visuals
        AudioApp.uiManager.resetUI();
        AudioApp.uiManager.setFileInfo(`Loading: ${file.name}...`);
        AudioApp.waveformVisualizer.clearVisuals(); // Use specific visualizer
        AudioApp.spectrogramVisualizer.clearVisuals(); // Use specific visualizer
        AudioApp.spectrogramVisualizer.showSpinner(true); // Show spectrogram spinner

        try { await AudioApp.audioEngine.loadAndProcessFile(file); }
        catch (error) {
            console.error("App: Error initiating file processing -", error);
            AudioApp.uiManager.setFileInfo(`Error loading: ${error.message}`);
            AudioApp.uiManager.resetUI();
            AudioApp.spectrogramVisualizer.showSpinner(false); // Hide spinner on error
            stopUIUpdateLoop();
        }
    }

    /**
     * Handles audio decoding completion. Stores buffer, draws initial visuals, starts background VAD.
     * @param {CustomEvent<{audioBuffer: AudioBuffer}>} e @private
     */
    async function handleAudioLoaded(e) {
        currentAudioBuffer = e.detail.audioBuffer;
        console.log(`App: Audio decoded (${currentAudioBuffer.duration.toFixed(2)}s)`);

        // Update UI time/seek state
        AudioApp.uiManager.updateTimeDisplay(0, currentAudioBuffer.duration);
        AudioApp.uiManager.updateSeekBar(0);
        AudioApp.waveformVisualizer.updateProgressIndicator(0, currentAudioBuffer.duration); // Use specific visualizer
        AudioApp.spectrogramVisualizer.updateProgressIndicator(0, currentAudioBuffer.duration); // Use specific visualizer
        playbackStartSourceTime = 0.0;

        // Draw initial waveform (gray)
        console.log("App: Drawing initial waveform...");
        // Pass empty array [] for speechRegions to trigger loading color
        await AudioApp.waveformVisualizer.computeAndDrawWaveform(currentAudioBuffer, []);

        // Draw spectrogram (shows spinner internally)
        console.log("App: Starting spectrogram computation/drawing...");
        // No need to hide spinner here, spectrogramVisualizer handles it
        await AudioApp.spectrogramVisualizer.computeAndDrawSpectrogram(currentAudioBuffer);

        console.log("App: Initial visuals initiated.");
        AudioApp.uiManager.setFileInfo(`Processing VAD: ${currentFile ? currentFile.name : 'Unknown File'}`);

        // Trigger background VAD processing
        console.log("App: Starting background VAD processing...");
        runVadInBackground(currentAudioBuffer); // Fire and forget
    }

    /** @param {CustomEvent} e @private */
    function handleWorkletReady(e) {
        console.log("App: AudioWorklet processor is ready.");
        workletPlaybackReady = true;
        AudioApp.uiManager.enablePlaybackControls(true);
        AudioApp.uiManager.enableSeekBar(true);
        // Spectrogram spinner is handled by spectrogramVisualizer
        AudioApp.uiManager.setFileInfo(`Ready: ${currentFile ? currentFile.name : 'Unknown File'}`);
    }

    /**
     * Runs VAD analysis in the background. Handles resampling, analysis, and UI updates.
     * @param {AudioBuffer} audioBuffer
     * @private
     */
     async function runVadInBackground(audioBuffer) {
        if (!audioBuffer || !AudioApp.vadAnalyzer || !AudioApp.sileroWrapper || !AudioApp.audioEngine || !AudioApp.uiManager || !AudioApp.waveformVisualizer) {
             console.error("App (VAD Task): Missing dependencies for VAD task.");
             isVadProcessing = false; // Ensure flag is reset
             return;
        }
        if (isVadProcessing) { console.warn("App: VAD processing already running."); return; }
        isVadProcessing = true;
        let pcm16k = null; let vadSucceeded = false;

        try {
            // 1. Init VAD Model
            if (!vadModelReady) {
                console.log("App (VAD Task): Creating/loading VAD model...");
                vadModelReady = await AudioApp.sileroWrapper.create(AudioApp.Constants.VAD_SAMPLE_RATE); // Use Constant
                if (!vadModelReady) throw new Error("Failed to create Silero VAD model.");
                console.log("App (VAD Task): VAD model ready.");
            }

            // 2. Show VAD Progress UI
            AudioApp.uiManager.showVadProgress(true);
            AudioApp.uiManager.updateVadProgress(0);

            // 3. Resample Audio
            console.log("App (VAD Task): Resampling audio...");
            pcm16k = await AudioApp.audioEngine.resampleTo16kMono(audioBuffer);
            if (!pcm16k || pcm16k.length === 0) {
                 console.log("App (VAD Task): No audio data after resampling.");
                 AudioApp.uiManager.setSpeechRegionsText("No VAD data (empty audio?)");
                 AudioApp.uiManager.updateVadProgress(100);
                 AudioApp.uiManager.enableVadControls(false);
                 isVadProcessing = false; return;
            }

            // 4. Perform VAD Analysis
            console.log("App (VAD Task): Starting VAD analysis...");
            const vadProgressCallback = (progress) => { /* ... progress update logic ... */
                 if (!AudioApp.uiManager) return;
                 if (progress.totalFrames > 0) { const percentage = (progress.processedFrames / progress.totalFrames) * 100; AudioApp.uiManager.updateVadProgress(percentage); }
                 else { AudioApp.uiManager.updateVadProgress(0); }
            };
            const analysisOptions = { onProgress: vadProgressCallback }; // frameSamples uses default in vadAnalyzer
            currentVadResults = await AudioApp.vadAnalyzer.analyze(pcm16k, analysisOptions); // Use VAD module

            // 5. Update UI on Success
            const speechRegions = currentVadResults.regions || [];
            console.log(`App (VAD Task): VAD analysis complete. Found ${speechRegions.length} regions.`);
            AudioApp.uiManager.updateVadDisplay(currentVadResults.initialPositiveThreshold, currentVadResults.initialNegativeThreshold);
            AudioApp.uiManager.setSpeechRegionsText(speechRegions);
            AudioApp.uiManager.enableVadControls(true);
            AudioApp.waveformVisualizer.redrawWaveformHighlight(audioBuffer, speechRegions); // Use specific visualizer
            AudioApp.uiManager.updateVadProgress(100);
            vadSucceeded = true;

        } catch (error) {
            // 6. Handle Errors
            console.error("App (VAD Task): Error during background VAD processing -", error);
            const errorType = error.message.includes("resampling") ? "Resampling Error" : error.message.includes("VAD") ? "VAD Error" : "Processing Error";
            AudioApp.uiManager.setSpeechRegionsText(`${errorType}: ${error.message}`);
            AudioApp.uiManager.enableVadControls(false);
            AudioApp.uiManager.updateVadProgress(0);
            currentVadResults = null;
        } finally {
            // 7. Cleanup Task State
            isVadProcessing = false;
        }
    }

    /** @param {CustomEvent<{type?: string, error: Error}>} e @private */
    function handleAudioError(e) {
        const errorType = e.detail.type || 'Unknown';
        const errorMessage = e.detail.error ? e.detail.error.message : 'An unknown error occurred';
        console.error(`App: Audio Error - Type: ${errorType}, Message: ${errorMessage}`, e.detail.error);
        stopUIUpdateLoop();
        AudioApp.uiManager.setFileInfo(`Error (${errorType}): ${errorMessage.substring(0, 100)}`);
        AudioApp.uiManager.resetUI();
        AudioApp.waveformVisualizer?.clearVisuals(); // Use optional chaining
        AudioApp.spectrogramVisualizer?.clearVisuals();
        AudioApp.spectrogramVisualizer?.showSpinner(false);
        // Clear internal state
        currentAudioBuffer = null; currentVadResults = null; currentFile = null;
        workletPlaybackReady = false; isActuallyPlaying = false; isVadProcessing = false;
        playbackStartTimeContext = null; playbackStartSourceTime = 0.0; currentSpeedForUpdate = 1.0;
    }

    // --- Playback/Seek/Parameter Handlers (Largely Unchanged, verify AudioEngine calls) ---

    /** @private */
    function handlePlayPause() {
        if (!workletPlaybackReady || !AudioApp.audioEngine) { console.warn("App: Play/Pause ignored - Engine/Worklet not ready."); return; }
        const audioCtx = AudioApp.audioEngine.getAudioContext();
        if (!audioCtx) { console.error("App: Cannot play/pause, AudioContext not available."); return; }
        const aboutToPlay = !isActuallyPlaying;
        AudioApp.audioEngine.togglePlayPause();
        if (aboutToPlay) {
            const engineTime = AudioApp.audioEngine.getCurrentTime();
            playbackStartSourceTime = engineTime.currentTime;
            playbackStartTimeContext = audioCtx.currentTime;
            startUIUpdateLoop();
        } else {
            stopUIUpdateLoop(); playbackStartTimeContext = null;
        }
    }

    /** @param {CustomEvent<{seconds: number}>} e @private */
    function handleJump(e) {
        if (!workletPlaybackReady || !currentAudioBuffer || !AudioApp.audioEngine) return;
        const audioCtx = AudioApp.audioEngine.getAudioContext(); if (!audioCtx) return;
        const duration = currentAudioBuffer.duration; if (isNaN(duration) || duration <= 0) return;
        const currentTime = calculateEstimatedSourceTime();
        const targetTime = Math.max(0, Math.min(currentTime + e.detail.seconds, duration));
        AudioApp.audioEngine.seek(targetTime);
        playbackStartSourceTime = targetTime;
        if (isActuallyPlaying) { playbackStartTimeContext = audioCtx.currentTime; }
        else { playbackStartTimeContext = null; updateUIWithTime(targetTime); }
    }

    /** @param {CustomEvent<{fraction: number}>} e @private */
    function handleSeek(e) {
        if (!workletPlaybackReady || !currentAudioBuffer || isNaN(currentAudioBuffer.duration) || currentAudioBuffer.duration <= 0 || !AudioApp.audioEngine) return;
        const audioCtx = AudioApp.audioEngine.getAudioContext(); if (!audioCtx) return;
        const targetTime = e.detail.fraction * currentAudioBuffer.duration;
        AudioApp.audioEngine.seek(targetTime);
        playbackStartSourceTime = targetTime;
        if (isActuallyPlaying) { playbackStartTimeContext = audioCtx.currentTime; }
        else { playbackStartTimeContext = null; updateUIWithTime(targetTime); }
    }
    const handleSeekBarInput = handleSeek; // Alias remains

    /** @param {CustomEvent<{speed: number}>} e @private */
    function handleSpeedChange(e) { AudioApp.audioEngine?.setSpeed(e.detail.speed); }
    /** @param {CustomEvent<{pitch: number}>} e @private */
    function handlePitchChange(e) { AudioApp.audioEngine?.setPitch(e.detail.pitch); }
    /** @param {CustomEvent<{gain: number}>} e @private */
    function handleGainChange(e) { AudioApp.audioEngine?.setGain(e.detail.gain); }

     /** @param {CustomEvent<{speed: number}>} e @private */
    function handleInternalSpeedChange(e) {
        const newSpeed = e.detail.speed; console.log(`App: Internal speed updated to ${newSpeed.toFixed(2)}x`);
        const oldSpeed = currentSpeedForUpdate; currentSpeedForUpdate = newSpeed;
        const audioCtx = AudioApp.audioEngine?.getAudioContext();
        if (isActuallyPlaying && playbackStartTimeContext !== null && audioCtx) {
            const elapsedContextTime = audioCtx.currentTime - playbackStartTimeContext;
            const elapsedSourceTime = elapsedContextTime * oldSpeed;
            const previousSourceTime = playbackStartSourceTime + elapsedSourceTime;
            playbackStartSourceTime = previousSourceTime; playbackStartTimeContext = audioCtx.currentTime;
        }
    }

    /** @param {CustomEvent<{type: string, value: number}>} e @private */
    function handleThresholdChange(e) {
        if (!currentVadResults || isVadProcessing || !AudioApp.vadAnalyzer || !AudioApp.waveformVisualizer) return;
        const { type, value } = e.detail;
        const newRegions = AudioApp.vadAnalyzer.handleThresholdUpdate(type, value); // Use VAD module
        AudioApp.uiManager.setSpeechRegionsText(newRegions);
        if(currentAudioBuffer) { AudioApp.waveformVisualizer.redrawWaveformHighlight(currentAudioBuffer, newRegions); } // Use waveform visualizer
    }

    /** @private */
    function handlePlaybackEnded() {
        console.log("App: Playback ended event received.");
        isActuallyPlaying = false; stopUIUpdateLoop(); playbackStartTimeContext = null;
        if (currentAudioBuffer) { updateUIWithTime(currentAudioBuffer.duration); }
        AudioApp.uiManager.setPlayButtonState(false);
    }

    /** @param {CustomEvent<{isPlaying: boolean}>} e @private */
     function handlePlaybackStateChange(e) {
        const workletIsPlaying = e.detail.isPlaying; console.log(`App: Playback state confirmed by worklet: ${workletIsPlaying}`);
        if (isActuallyPlaying !== workletIsPlaying) {
            console.log(`App: Syncing internal state to ${workletIsPlaying}.`);
            isActuallyPlaying = workletIsPlaying; AudioApp.uiManager.setPlayButtonState(isActuallyPlaying);
        } else { AudioApp.uiManager.setPlayButtonState(isActuallyPlaying); }
        const audioCtx = AudioApp.audioEngine?.getAudioContext();
        if (isActuallyPlaying) {
            if (playbackStartTimeContext === null && audioCtx) {
                console.log("App: Playback active, ensuring context start time is set.");
                const engineTime = AudioApp.audioEngine.getCurrentTime();
                playbackStartSourceTime = engineTime.currentTime; playbackStartTimeContext = audioCtx.currentTime;
            }
            startUIUpdateLoop();
        } else {
            stopUIUpdateLoop(); playbackStartTimeContext = null;
            const engineTime = AudioApp.audioEngine?.getCurrentTime() || { currentTime: playbackStartSourceTime }; // Fallback if engine missing
            updateUIWithTime(engineTime.currentTime);
        }
    }

    /** @param {CustomEvent<{key: string}>} e @private */
    function handleKeyPress(e) {
        if (!workletPlaybackReady) return;
        const key = e.detail.key; const jumpTimeValue = AudioApp.uiManager.getJumpTime();
        switch (key) {
            case 'Space': handlePlayPause(); break;
            case 'ArrowLeft': handleJump({ detail: { seconds: -jumpTimeValue } }); break;
            case 'ArrowRight': handleJump({ detail: { seconds: jumpTimeValue } }); break;
        }
    }

    /** @private */
    function handleWindowResize() {
        const regions = AudioApp.vadAnalyzer ? AudioApp.vadAnalyzer.getCurrentRegions() : [];
        // Resize both visualizers
        AudioApp.waveformVisualizer?.resizeAndRedraw(currentAudioBuffer, regions); // Use waveform visualizer
        AudioApp.spectrogramVisualizer?.resizeAndRedraw(currentAudioBuffer); // Use spectrogram visualizer (doesn't need regions)
    }

    /** @private */
    function handleBeforeUnload() {
        console.log("App: Unloading - Cleaning up...");
        stopUIUpdateLoop();
        AudioApp.audioEngine?.cleanup();
    }

    // --- Main Thread Time Calculation & UI Update ---

    /** @private */
    function startUIUpdateLoop() { /* ... unchanged ... */ if (rAFUpdateHandle === null) { rAFUpdateHandle = requestAnimationFrame(updateUIBasedOnContextTime); } }
    /** @private */
    function stopUIUpdateLoop() { /* ... unchanged ... */ if (rAFUpdateHandle !== null) { cancelAnimationFrame(rAFUpdateHandle); rAFUpdateHandle = null; } }

    /** @private @returns {number} */
    function calculateEstimatedSourceTime() {
        const audioCtx = AudioApp.audioEngine?.getAudioContext();
        const duration = currentAudioBuffer ? currentAudioBuffer.duration : 0;
        if (!isActuallyPlaying || playbackStartTimeContext === null || !audioCtx || !currentAudioBuffer || duration <= 0 || currentSpeedForUpdate <= 0) {
            const engineTime = AudioApp.audioEngine?.getCurrentTime() || { currentTime: playbackStartSourceTime };
            return engineTime.currentTime;
        }
        const elapsedContextTime = audioCtx.currentTime - playbackStartTimeContext;
        const elapsedSourceTime = elapsedContextTime * currentSpeedForUpdate;
        let estimatedCurrentSourceTime = playbackStartSourceTime + elapsedSourceTime;
        return Math.max(0, Math.min(estimatedCurrentSourceTime, duration));
    }

    /** @private @param {number} time */
    function updateUIWithTime(time) {
        const duration = currentAudioBuffer ? currentAudioBuffer.duration : 0;
        if (isNaN(duration) || duration <= 0) return;
        const clampedTime = Math.max(0, Math.min(time, duration));
        const fraction = duration > 0 ? clampedTime / duration : 0;
        // Update UI elements
        AudioApp.uiManager.updateTimeDisplay(clampedTime, duration);
        AudioApp.uiManager.updateSeekBar(fraction);
        // Update BOTH visualizer progress indicators
        AudioApp.waveformVisualizer?.updateProgressIndicator(clampedTime, duration);
        AudioApp.spectrogramVisualizer?.updateProgressIndicator(clampedTime, duration);
    }

    /** @private @param {DOMHighResTimeStamp} timestamp */
    function updateUIBasedOnContextTime(timestamp) {
        if (!isActuallyPlaying) { rAFUpdateHandle = null; return; }
        const estimatedTime = calculateEstimatedSourceTime();
        updateUIWithTime(estimatedTime);
        rAFUpdateHandle = requestAnimationFrame(updateUIBasedOnContextTime);
    }

    // --- Public Interface ---
    return {
        init: init
    };
})(); // End of AudioApp IIFE
// --- /vibe-player/js/app.js ---
