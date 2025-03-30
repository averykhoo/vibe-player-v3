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
    /** @type {AudioBuffer|null} The currently loaded and decoded audio buffer. */
    let currentAudioBuffer = null;
    /** @type {Float32Array|null} The 16kHz mono PCM data for VAD analysis. */
    let currentPcm16k = null;
    /** @type {VadResult|null} Results from the VAD analysis (see vadAnalyzer). */
    let currentVadResults = null;
    /** @type {File|null} The currently loaded audio file object. */
    let currentFile = null;
    /** @type {boolean} Flag indicating if the Silero VAD model is loaded and ready. */
    let vadModelReady = false;
    /** @type {boolean} Flag indicating if the AudioWorklet processor is loaded and ready for playback commands. */
    let workletPlaybackReady = false;

    // --- Main Thread Playback Time State (for accurate UI updates) ---
    /** @type {number|null} */ let playbackStartTimeContext = null;
    /** @type {number} */ let playbackStartSourceTime = 0.0;
    /** @type {boolean} */ let isActuallyPlaying = false;
    /** @type {number|null} */ let rAFUpdateHandle = null;
    /** @type {number} */ let currentSpeedForUpdate = 1.0;

    // VAD_PROGRESS_BAR_SEGMENTS constant is removed

    // --- Initialization ---
    /** @public */
    function init() {
        console.log("AudioApp: Initializing...");
        AudioApp.uiManager.init();
        AudioApp.audioEngine.init();
        AudioApp.visualizer.init();
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
        // document.addEventListener('audioapp:formantChanged', handleFormantChange); // Keep commented
        document.addEventListener('audioapp:gainChanged', handleGainChange);
        document.addEventListener('audioapp:thresholdChanged', handleThresholdChange);
        document.addEventListener('audioapp:keyPressed', handleKeyPress);
        // AudioEngine -> App
        document.addEventListener('audioapp:audioLoaded', handleAudioLoaded);
        document.addEventListener('audioapp:resamplingComplete', handleResamplingComplete);
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
        const file = e.detail.file;
        if (!file) return;

        currentFile = file;
        console.log("App: File selected -", file.name);

        // Reset state for the new file
        stopUIUpdateLoop();
        isActuallyPlaying = false;
        playbackStartTimeContext = null;
        playbackStartSourceTime = 0.0;
        currentSpeedForUpdate = 1.0;
        currentAudioBuffer = null;
        currentPcm16k = null;
        currentVadResults = null;
        workletPlaybackReady = false; // Reset worklet state as well

        // Reset UI (including VAD progress bar)
        AudioApp.uiManager.resetUI();
        AudioApp.uiManager.setFileInfo(`Loading: ${file.name}...`);
        AudioApp.visualizer.clearVisuals();
        AudioApp.visualizer.showSpinner(true);

        try {
            // Start processing pipeline in AudioEngine
            await AudioApp.audioEngine.loadAndProcessFile(file);
        } catch (error) {
            // Handle errors during the initial loading phase
            console.error("App: Error initiating file processing -", error);
            AudioApp.uiManager.setFileInfo(`Error loading: ${error.message}`);
            AudioApp.uiManager.resetUI(); // Ensure UI is fully reset on error
            AudioApp.visualizer.showSpinner(false);
            stopUIUpdateLoop(); // Ensure loop is stopped on error
        }
    }

    /** @param {CustomEvent<{audioBuffer: AudioBuffer}>} e @private */
    function handleAudioLoaded(e) {
        currentAudioBuffer = e.detail.audioBuffer;
        console.log(`App: Audio decoded (${currentAudioBuffer.duration.toFixed(2)}s)`);
        AudioApp.uiManager.updateTimeDisplay(0, currentAudioBuffer.duration);
        AudioApp.uiManager.updateSeekBar(0);
        AudioApp.visualizer.updateProgressIndicator(0, currentAudioBuffer.duration);
        playbackStartSourceTime = 0.0; // Reset source time tracking
    }

    /** @param {CustomEvent<{pcmData: Float32Array}>} e @private */
    async function handleResamplingComplete(e) {
        currentPcm16k = e.detail.pcmData;
        console.log(`App: Audio resampled (${currentPcm16k.length} samples @ 16kHz)`);

        // --- VAD Model Initialization ---
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
                    AudioApp.uiManager.setSpeechRegionsText("VAD Model Error");
                    AudioApp.uiManager.enableVadControls(false);
                }
            } catch (creationError) {
                console.error("App: VAD model creation error:", creationError);
                vadCreationSuccess = false;
                AudioApp.uiManager.setSpeechRegionsText(`VAD Load Error: ${creationError.message}`);
                AudioApp.uiManager.enableVadControls(false);
            }
        }

        // --- VAD Analysis & Progress ---
        let speechRegionsForVisualizer = [];
        if (vadCreationSuccess && currentPcm16k && currentPcm16k.length > 0) {
            console.log("App: Starting VAD analysis...");

            // --- Setup and Show Progress Bar ---
            AudioApp.uiManager.showVadProgress(true); // Ensure container is visible
            AudioApp.uiManager.updateVadProgress(0); // Reset bar to 0% initially

            // Define the progress callback function to update UI
            const vadProgressCallback = (progress) => {
                if (progress.totalFrames > 0) {
                    // Calculate percentage (0-100)
                    const percentage = (progress.processedFrames / progress.totalFrames) * 100;
                    // *** ADDED LOGGING ***
                    console.log('[App] vadProgressCallback: calculated percentage:', percentage.toFixed(1));
                    // Call uiManager to update the bar width
                    AudioApp.uiManager.updateVadProgress(percentage);
                } else {
                    // *** ADDED LOGGING (for else case) ***
                    console.log('[App] vadProgressCallback: calculated percentage: 0 (no total frames)');
                    AudioApp.uiManager.updateVadProgress(0); // Show 0% if no frames
                }
            };
            // --- End Progress Bar Setup ---

            try {
                // Get frame size for accurate calculation if needed elsewhere,
                // but analyzer uses its default or the one from results if available.
                const frameSamples = AudioApp.vadAnalyzer.getFrameSamples();

                // Prepare options for analyzer, including the callback
                const analysisOptions = {
                    onProgress: vadProgressCallback,
                    frameSamples: frameSamples // Pass frame size used for analysis
                };

                // Start analysis via the analyzer, passing the options
                currentVadResults = await AudioApp.vadAnalyzer.analyze(currentPcm16k, analysisOptions);

                speechRegionsForVisualizer = currentVadResults.regions || [];
                console.log(`App: VAD analysis complete. Found ${speechRegionsForVisualizer.length} regions.`);
                AudioApp.uiManager.updateVadDisplay(currentVadResults.initialPositiveThreshold, currentVadResults.initialNegativeThreshold);
                AudioApp.uiManager.setSpeechRegionsText(speechRegionsForVisualizer);
                AudioApp.uiManager.enableVadControls(true);
            } catch (analysisError) {
                console.error("App: VAD Analysis failed -", analysisError);
                AudioApp.uiManager.setSpeechRegionsText(`VAD Error: ${analysisError.message}`);
                AudioApp.uiManager.enableVadControls(false);
                speechRegionsForVisualizer = [];
                AudioApp.uiManager.updateVadProgress(0); // Reset progress on error
            } finally {
                // Ensure progress bar shows 100% on completion (success or handled error)
                // unless it was reset above due to error
                if (speechRegionsForVisualizer !== null) { // Check if reset didn't happen
                     // *** ADDED LOGGING (for finally block) ***
                     console.log('[App] vadProgressCallback: forcing 100% in finally block');
                    AudioApp.uiManager.updateVadProgress(100);
                }
                // Do NOT hide the progress bar container here, as per requirement
            }
        } else {
             // Handle cases where VAD didn't run
             if (!vadCreationSuccess) { AudioApp.uiManager.setSpeechRegionsText("VAD Model Error"); }
             else if (!currentPcm16k || currentPcm16k.length === 0) { AudioApp.uiManager.setSpeechRegionsText("No VAD data (empty audio?)"); }
             else { AudioApp.uiManager.setSpeechRegionsText("VAD skipped"); }
             AudioApp.uiManager.enableVadControls(false);
             AudioApp.uiManager.updateVadProgress(0); // Reset progress if skipped
             // Do NOT hide the container
             speechRegionsForVisualizer = [];
        }

        // --- Trigger Visualizations ---
        if (currentAudioBuffer) {
            console.log("App: Computing/drawing visuals...");
            // Pass the calculated speech regions to the visualizer
            await AudioApp.visualizer.computeAndDrawVisuals(currentAudioBuffer, speechRegionsForVisualizer);
        }

        // Hide general spinner only if worklet is already ready (otherwise wait for worklet)
        if (workletPlaybackReady) { AudioApp.visualizer.showSpinner(false); }
    }

    // handleVadProgress function removed

    /** @param {CustomEvent} e @private */
    function handleWorkletReady(e) {
        console.log("App: AudioWorklet processor is ready.");
        workletPlaybackReady = true;
        AudioApp.uiManager.enablePlaybackControls(true);
        AudioApp.uiManager.enableSeekBar(true);
        AudioApp.visualizer.showSpinner(false); // Now safe to hide spinner
        AudioApp.uiManager.setFileInfo(`Ready: ${currentFile ? currentFile.name : 'Unknown File'}`);
    }

    /** @param {CustomEvent<{type?: string, error: Error}>} e @private */
    function handleAudioError(e) {
        const errorType = e.detail.type || 'Unknown';
        const errorMessage = e.detail.error ? e.detail.error.message : 'An unknown error occurred';
        console.error(`App: Audio Error - Type: ${errorType}, Message: ${errorMessage}`, e.detail.error);

        // Stop playback and UI updates
        stopUIUpdateLoop();

        // Reset UI to initial state
        AudioApp.uiManager.setFileInfo(`Error (${errorType}): ${errorMessage.substring(0, 100)}`);
        AudioApp.uiManager.resetUI(); // Resets sliders, buttons, VAD progress etc.
        AudioApp.visualizer.clearVisuals();
        AudioApp.visualizer.showSpinner(false);

        // Clear internal state
        currentAudioBuffer = null;
        currentPcm16k = null;
        currentVadResults = null;
        currentFile = null;
        workletPlaybackReady = false;
        isActuallyPlaying = false;
        playbackStartTimeContext = null;
        playbackStartSourceTime = 0.0;
        currentSpeedForUpdate = 1.0;
    }

    /** @private */
    function handlePlayPause() {
        if (!workletPlaybackReady) { console.warn("App: Play/Pause ignored - Worklet not ready."); return; }
        const audioCtx = AudioApp.audioEngine.getAudioContext();
        if (!audioCtx) { console.error("App: Cannot play/pause, AudioContext not available."); return; }

        const aboutToPlay = !isActuallyPlaying; // Check *before* toggling engine
        AudioApp.audioEngine.togglePlayPause(); // Tell engine to toggle

        // Adjust main thread time tracking state *after* telling engine
        if (aboutToPlay) {
            // If we are starting playback, sync times and start UI loop
             const engineTime = AudioApp.audioEngine.getCurrentTime();
             playbackStartSourceTime = engineTime.currentTime; // Sync source time
             playbackStartTimeContext = audioCtx.currentTime; // Record context time NOW
            startUIUpdateLoop();
        } else {
            // If we are stopping playback, stop UI loop and clear context time
            stopUIUpdateLoop();
            playbackStartTimeContext = null; // Clear context time
        }
        // UI button state update will happen based on 'playbackStateChanged' event from engine
    }

    /** @param {CustomEvent<{seconds: number}>} e @private */
    function handleJump(e) {
        if (!workletPlaybackReady || !currentAudioBuffer) return;
        const audioCtx = AudioApp.audioEngine.getAudioContext();
        if (!audioCtx) return;
        const duration = currentAudioBuffer.duration;
        if (isNaN(duration) || duration <= 0) return;

        const currentTime = calculateEstimatedSourceTime(); // Get current estimated time
        const targetTime = Math.max(0, Math.min(currentTime + e.detail.seconds, duration)); // Calculate target

        AudioApp.audioEngine.seek(targetTime); // Tell engine to seek

        // Update main thread time tracking immediately
        playbackStartSourceTime = targetTime;
        if (isActuallyPlaying) {
            // If playing, reset context start time relative to the new source time
            playbackStartTimeContext = audioCtx.currentTime;
        } else {
            // If paused, update UI directly, context time remains null
            playbackStartTimeContext = null;
            updateUIWithTime(targetTime); // Manually update UI while paused
        }
    }

    /** @param {CustomEvent<{fraction: number}>} e @private */
    function handleSeek(e) {
        if (!workletPlaybackReady || !currentAudioBuffer || isNaN(currentAudioBuffer.duration) || currentAudioBuffer.duration <= 0) return;
        const audioCtx = AudioApp.audioEngine.getAudioContext();
        if (!audioCtx) return;

        const targetTime = e.detail.fraction * currentAudioBuffer.duration; // Calculate target
        AudioApp.audioEngine.seek(targetTime); // Tell engine to seek

        // Update main thread time tracking immediately
        playbackStartSourceTime = targetTime;
        if (isActuallyPlaying) {
            // If playing, reset context start time relative to the new source time
            playbackStartTimeContext = audioCtx.currentTime;
        } else {
             // If paused, update UI directly, context time remains null
             playbackStartTimeContext = null;
            updateUIWithTime(targetTime); // Manually update UI while paused
        }
    }

    // SeekBar 'input' event triggers handleSeek
    const handleSeekBarInput = handleSeek;

    /** @param {CustomEvent<{speed: number}>} e @private */
    function handleSpeedChange(e) {
        AudioApp.audioEngine.setSpeed(e.detail.speed);
        // Speed change effect on time is handled by 'internalSpeedChanged' event
    }

    /** @param {CustomEvent<{speed: number}>} e @private */
    function handleInternalSpeedChange(e) {
        const newSpeed = e.detail.speed;
        console.log(`App: Internal speed updated to ${newSpeed.toFixed(2)}x`);

        const oldSpeed = currentSpeedForUpdate;
        currentSpeedForUpdate = newSpeed; // Update speed used for UI calculation

        const audioCtx = AudioApp.audioEngine.getAudioContext();
        // If playing, recalculate base times to prevent jump in UI display
        if (isActuallyPlaying && playbackStartTimeContext !== null && audioCtx) {
            // Calculate where we *were* just before the speed change
            const elapsedContextTime = audioCtx.currentTime - playbackStartTimeContext;
            const elapsedSourceTime = elapsedContextTime * oldSpeed; // Use OLD speed
            const previousSourceTime = playbackStartSourceTime + elapsedSourceTime;

            // Set the new base source time to where we were
            playbackStartSourceTime = previousSourceTime;
            // Reset the context start time to NOW
            playbackStartTimeContext = audioCtx.currentTime;
        }
    }

    /** @param {CustomEvent<{pitch: number}>} e @private */
    function handlePitchChange(e) { AudioApp.audioEngine.setPitch(e.detail.pitch); }
    /** @param {CustomEvent<{formant: number}>} e @private */
    // function handleFormantChange(e) { AudioApp.audioEngine.setFormant(e.detail.formant); } // Keep commented
    /** @param {CustomEvent<{gain: number}>} e @private */
    function handleGainChange(e) { AudioApp.audioEngine.setGain(e.detail.gain); }

    /** @param {CustomEvent<{type: string, value: number}>} e @private */
    function handleThresholdChange(e) {
        if (!currentVadResults || !currentAudioBuffer) return;
        const { type, value } = e.detail;
        // Delegate threshold update and recalculation to vadAnalyzer
        const newRegions = AudioApp.vadAnalyzer.handleThresholdUpdate(type, value);
        // Update UI displays based on the recalculated regions
        AudioApp.uiManager.setSpeechRegionsText(newRegions);
        AudioApp.visualizer.redrawWaveformHighlight(currentAudioBuffer, newRegions);
    }

    /** @private */
    function handlePlaybackEnded() {
        console.log("App: Playback ended event received.");
        isActuallyPlaying = false;
        stopUIUpdateLoop();
        playbackStartTimeContext = null;
        // Ensure UI shows the exact end time
        if (currentAudioBuffer) {
            updateUIWithTime(currentAudioBuffer.duration);
        }
        AudioApp.uiManager.setPlayButtonState(false); // Update button state
    }

    /** @param {CustomEvent<{isPlaying: boolean}>} e @private */
     function handlePlaybackStateChange(e) {
        const workletIsPlaying = e.detail.isPlaying;
        console.log(`App: Playback state confirmed by worklet: ${workletIsPlaying}`);

        // Sync internal state ONLY if it differs from worklet confirmation
        if (isActuallyPlaying !== workletIsPlaying) {
            console.log(`App: Discrepancy detected. Syncing internal state to ${workletIsPlaying}.`);
            isActuallyPlaying = workletIsPlaying; // Sync internal state
            AudioApp.uiManager.setPlayButtonState(isActuallyPlaying); // Update button
        } else {
            // If state already matches, just ensure button is correct
            AudioApp.uiManager.setPlayButtonState(isActuallyPlaying);
        }

        const audioCtx = AudioApp.audioEngine.getAudioContext();
        if (isActuallyPlaying) {
            // If starting to play (or confirming play state)
            if (playbackStartTimeContext === null && audioCtx) {
                // If context time wasn't set (e.g., play started right after load/seek), set it now
                console.log("App: Playback active, ensuring context start time is set.");
                const engineTime = AudioApp.audioEngine.getCurrentTime();
                playbackStartSourceTime = engineTime.currentTime; // Sync source time
                playbackStartTimeContext = audioCtx.currentTime; // Set context time
            }
            startUIUpdateLoop(); // Ensure UI loop is running
        } else {
            // If stopping play (or confirming stopped state)
            stopUIUpdateLoop(); // Stop UI loop
            playbackStartTimeContext = null; // Clear context time
            // Update UI one last time with the engine's final reported time
            const engineTime = AudioApp.audioEngine.getCurrentTime();
            updateUIWithTime(engineTime.currentTime);
        }
    }

    /** @param {CustomEvent<{key: string}>} e @private */
    function handleKeyPress(e) {
        if (!workletPlaybackReady) return; // Ignore if not ready
        const key = e.detail.key;
        const jumpTimeValue = AudioApp.uiManager.getJumpTime();

        switch (key) {
            case 'Space':
                handlePlayPause();
                break;
            case 'ArrowLeft':
                handleJump({ detail: { seconds: -jumpTimeValue } });
                break;
            case 'ArrowRight':
                handleJump({ detail: { seconds: jumpTimeValue } });
                break;
        }
    }

    /** @private */
    function handleWindowResize() {
        // Get current regions from the analyzer
        const regions = AudioApp.vadAnalyzer ? AudioApp.vadAnalyzer.getCurrentRegions() : [];
        AudioApp.visualizer.resizeAndRedraw(currentAudioBuffer, regions);
    }

    /** @private */
    function handleBeforeUnload() {
        console.log("App: Unloading - Cleaning up...");
        stopUIUpdateLoop();
        AudioApp.audioEngine.cleanup(); // Clean up Web Audio resources
    }

    // --- Main Thread Time Calculation & UI Update ---
    /** @private */
    function startUIUpdateLoop() {
        if (rAFUpdateHandle === null) {
            // console.log("App: Starting UI update loop (rAF)."); // Less verbose
            rAFUpdateHandle = requestAnimationFrame(updateUIBasedOnContextTime);
        }
    }

    /** @private */
    function stopUIUpdateLoop() {
        if (rAFUpdateHandle !== null) {
            // console.log("App: Stopping UI update loop (rAF)."); // Less verbose
            cancelAnimationFrame(rAFUpdateHandle);
            rAFUpdateHandle = null;
        }
    }

    /**
     * Calculates the estimated current source time based on AudioContext time.
     * @private
     * @returns {number} The estimated current time in seconds within the audio source.
     */
    function calculateEstimatedSourceTime() {
        const audioCtx = AudioApp.audioEngine.getAudioContext();
        const duration = currentAudioBuffer ? currentAudioBuffer.duration : 0;

        // If not playing, or state is inconsistent, return the last known time from the engine
        if (!isActuallyPlaying || playbackStartTimeContext === null || !audioCtx || !currentAudioBuffer || duration <= 0 || currentSpeedForUpdate <= 0) {
            const engineTime = AudioApp.audioEngine.getCurrentTime();
            return engineTime.currentTime;
        }

        // Calculate elapsed time based on context and speed
        const elapsedContextTime = audioCtx.currentTime - playbackStartTimeContext;
        const elapsedSourceTime = elapsedContextTime * currentSpeedForUpdate;
        let estimatedCurrentSourceTime = playbackStartSourceTime + elapsedSourceTime;

        // Clamp to valid duration range
        estimatedCurrentSourceTime = Math.max(0, Math.min(estimatedCurrentSourceTime, duration));
        return estimatedCurrentSourceTime;
    }

    /**
     * Updates the time display, seek bar, and visualization progress indicator.
     * @param {number} time - The current source time to display.
     * @private
     */
    function updateUIWithTime(time) {
        const duration = currentAudioBuffer ? currentAudioBuffer.duration : 0;
        if (isNaN(duration) || duration <= 0) return; // Avoid updates if duration invalid

        const clampedTime = Math.max(0, Math.min(time, duration));
        const fraction = clampedTime / duration;

        // Update UI elements
        AudioApp.uiManager.updateTimeDisplay(clampedTime, duration);
        AudioApp.uiManager.updateSeekBar(fraction); // uiManager handles check to prevent loops
        AudioApp.visualizer.updateProgressIndicator(clampedTime, duration);
    }

    /**
     * The main UI update loop function, called via requestAnimationFrame.
     * @param {DOMHighResTimeStamp} timestamp - The timestamp provided by rAF.
     * @private
     */
    function updateUIBasedOnContextTime(timestamp) {
        if (!isActuallyPlaying) {
            rAFUpdateHandle = null; // Ensure handle is cleared if stopped externally
            return; // Stop the loop if not playing
        }

        const estimatedTime = calculateEstimatedSourceTime();
        updateUIWithTime(estimatedTime);

        // Request the next frame
        rAFUpdateHandle = requestAnimationFrame(updateUIBasedOnContextTime);
    }


    // --- Public Interface ---
    return {
        init: init
        // Other methods are private or event handlers
    };
})(); // End of AudioApp IIFE
// --- /vibe-player/js/app.js ---
