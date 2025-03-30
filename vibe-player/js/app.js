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
    /** @type {VadResult|null} Results from the VAD analysis (see vadProcessor). */
    let currentVadResults = null;
    /** @type {File|null} The currently loaded audio file object. */
    let currentFile = null;
    /** @type {boolean} Flag indicating if the Silero VAD model is loaded and ready. */
    let vadModelReady = false;
    /** @type {boolean} Flag indicating if the AudioWorklet processor is loaded and ready for playback commands. */
    let workletPlaybackReady = false;

    // --- Main Thread Playback Time State (for accurate UI updates) ---
    /**
     * Stores the AudioContext's `currentTime` when playback was last started or resumed after a seek/pause.
     * Used as the reference point for calculating elapsed time on the main thread.
     * @type {number|null}
     */
    let playbackStartTimeContext = null;
    /**
     * Stores the corresponding position (in seconds) within the *source* audio
     * at the moment `playbackStartTimeContext` was recorded.
     * @type {number}
     */
    let playbackStartSourceTime = 0.0;
    /**
     * Tracks the *actual* confirmed playback state received from the AudioWorklet processor.
     * This might lag slightly behind the desired state (`AudioApp.audioEngine.isPlaying`).
     * @type {boolean}
     */
    let isActuallyPlaying = false;
    /**
     * Stores the handle returned by `requestAnimationFrame` for the UI update loop.
     * Used to cancel the loop when playback stops or the app unloads.
     * @type {number|null}
     */
    let rAFUpdateHandle = null;
    /**
     * Stores the current playback speed (rate) confirmed by the `audioEngine`.
     * Used in the `requestAnimationFrame` loop to scale elapsed context time to elapsed source time.
     * @type {number}
     */
    let currentSpeedForUpdate = 1.0;


    // --- Initialization ---

    /**
     * Initializes the entire Vibe Player application.
     * Sets up modules and event listeners.
     * @public
     */
    function init() {
        console.log("AudioApp: Initializing...");

        // Initialize modules in a sensible order
        AudioApp.uiManager.init();       // Handles DOM manipulation & UI events
        AudioApp.audioEngine.init();     // Handles Web Audio, Worklet, playback control
        AudioApp.visualizer.init();      // Handles Canvas drawing (Waveform, Spectrogram)
        // Note: sileroWrapper, sileroProcessor, vadAnalyzer are dependencies used by others, no explicit init needed here.

        // Setup event listeners for communication between modules and window events
        setupAppEventListeners();

        console.log("AudioApp: Initialized. Waiting for file...");
    }

    // --- Event Listener Setup ---

    /**
     * Sets up listeners for custom events dispatched by other modules
     * (UI actions, audio engine state changes) and global window events.
     * @private
     */
    function setupAppEventListeners() {
        // --- UI Manager -> App Event Listeners ---
        document.addEventListener('audioapp:fileSelected', handleFileSelected);
        document.addEventListener('audioapp:playPauseClicked', handlePlayPause);
        document.addEventListener('audioapp:jumpClicked', handleJump);
        document.addEventListener('audioapp:seekRequested', handleSeek); // From canvas clicks
        document.addEventListener('audioapp:seekBarInput', handleSeekBarInput); // From seek bar interaction
        document.addEventListener('audioapp:speedChanged', handleSpeedChange);
        document.addEventListener('audioapp:pitchChanged', handlePitchChange);
        document.addEventListener('audioapp:formantChanged', handleFormantChange);
        document.addEventListener('audioapp:gainChanged', handleGainChange);
        document.addEventListener('audioapp:thresholdChanged', handleThresholdChange); // VAD slider changes
        document.addEventListener('audioapp:keyPressed', handleKeyPress); // Keyboard shortcuts

        // --- Audio Engine -> App Event Listeners ---
        document.addEventListener('audioapp:audioLoaded', handleAudioLoaded);
        document.addEventListener('audioapp:resamplingComplete', handleResamplingComplete);
        document.addEventListener('audioapp:workletReady', handleWorkletReady);
        document.addEventListener('audioapp:decodingError', handleAudioError);
        document.addEventListener('audioapp:resamplingError', handleAudioError);
        document.addEventListener('audioapp:playbackError', handleAudioError); // Generic playback errors
        document.addEventListener('audioapp:engineError', handleAudioError); // Other engine/context errors
        // document.addEventListener('audioapp:timeUpdated', handleTimeUpdate); // No longer needed for UI timing
        document.addEventListener('audioapp:playbackEnded', handlePlaybackEnded); // Worklet reports end of stream
        document.addEventListener('audioapp:playbackStateChanged', handlePlaybackStateChange); // Worklet confirms play/pause state
        document.addEventListener('audioapp:internalSpeedChanged', handleInternalSpeedChange); // Engine confirms applied speed


        // --- Window Event Listeners ---
        window.addEventListener('resize', handleWindowResize); // Handle canvas redraws
        window.addEventListener('beforeunload', handleBeforeUnload); // Cleanup resources
    }

    // --- Event Handler Functions ---

    /**
     * Handles the 'audioapp:fileSelected' event.
     * Resets application state, stops any existing playback, clears UI,
     * and initiates the loading process via the audioEngine.
     * @param {CustomEvent<{file: File}>} e - Event detail contains the selected file.
     * @private
     */
    async function handleFileSelected(e) {
        const file = e.detail.file;
        if (!file) return; // Ignore if no file selected
        currentFile = file;
        console.log("App: File selected -", file.name);

        // Stop existing playback and UI updates immediately
        stopUIUpdateLoop();
        isActuallyPlaying = false;
        playbackStartTimeContext = null;
        playbackStartSourceTime = 0.0;
        currentSpeedForUpdate = 1.0; // Reset speed

        // Reset core application state variables
        currentAudioBuffer = null;
        currentPcm16k = null;
        currentVadResults = null;
        workletPlaybackReady = false; // Worklet needs new audio data

        // Reset UI elements to initial state
        AudioApp.uiManager.resetUI(); // Handles controls, text displays, sliders
        AudioApp.uiManager.setFileInfo(`Loading: ${file.name}...`);
        AudioApp.visualizer.clearVisuals(); // Clear canvases
        AudioApp.visualizer.showSpinner(true); // Show spectrogram spinner

        try {
            // Initiate the file loading, decoding, resampling, and worklet setup pipeline
            await AudioApp.audioEngine.loadAndProcessFile(file);
        } catch (error) {
            // Handle errors during the initial loading process
            console.error("App: Error initiating file processing -", error);
            AudioApp.uiManager.setFileInfo(`Error loading: ${error.message}`);
            AudioApp.uiManager.resetUI(); // Ensure UI is fully reset
            AudioApp.visualizer.showSpinner(false);
            stopUIUpdateLoop(); // Ensure loop is stopped if loading fails
        }
    }

    /**
     * Handles the 'audioapp:audioLoaded' event from the audioEngine.
     * Stores the decoded AudioBuffer and updates the UI time display.
     * @param {CustomEvent<{audioBuffer: AudioBuffer}>} e - Event detail contains the decoded buffer.
     * @private
     */
    function handleAudioLoaded(e) {
        currentAudioBuffer = e.detail.audioBuffer;
        console.log(`App: Audio decoded (${currentAudioBuffer.duration.toFixed(2)}s)`);
        // Reset UI time display and seek bar for the new file's duration
        AudioApp.uiManager.updateTimeDisplay(0, currentAudioBuffer.duration);
        AudioApp.uiManager.updateSeekBar(0);
        AudioApp.visualizer.updateProgressIndicator(0, currentAudioBuffer.duration);
        playbackStartSourceTime = 0.0; // Reset source time tracking for the new file
    }

    /**
     * Handles the 'audioapp:resamplingComplete' event.
     * Stores the resampled PCM data, triggers VAD model creation (if needed) and analysis,
     * and initiates visualization rendering.
     * @param {CustomEvent<{pcmData: Float32Array}>} e - Event detail contains the 16kHz PCM data.
     * @private
     */
    async function handleResamplingComplete(e) {
        currentPcm16k = e.detail.pcmData;
        console.log(`App: Audio resampled (${currentPcm16k.length} samples @ 16kHz)`);

        // --- VAD Model Initialization & Analysis ---
        let vadCreationSuccess = vadModelReady; // Assume ready if previously loaded
        // Attempt to create/load the VAD model only if it's not already ready
        if (!vadModelReady) {
            console.log("App: Attempting to create/load VAD model...");
            try {
                // Use the Silero wrapper to create the ONNX session
                vadCreationSuccess = await AudioApp.sileroWrapper.create(16000); // VAD requires 16kHz
                if (vadCreationSuccess) {
                    vadModelReady = true;
                    console.log("App: VAD model created successfully.");
                } else {
                    // Handle model creation failure
                    console.error("App: Failed to create VAD model.");
                    AudioApp.uiManager.setSpeechRegionsText("VAD Model Error"); // Update UI status
                    AudioApp.uiManager.enableVadControls(false);
                }
            } catch (creationError) {
                // Handle errors during model creation process
                console.error("App: VAD model creation error:", creationError);
                vadCreationSuccess = false;
                AudioApp.uiManager.setSpeechRegionsText(`VAD Load Error: ${creationError.message}`);
                AudioApp.uiManager.enableVadControls(false);
            }
        }

        // Proceed with VAD analysis only if the model is ready
        let speechRegionsForVisualizer = []; // Default to empty array
        if (vadCreationSuccess) {
            console.log("App: Starting VAD analysis...");
            try {
                // Use the VAD analyzer module to process the PCM data
                currentVadResults = await AudioApp.vadAnalyzer.analyze(currentPcm16k);
                speechRegionsForVisualizer = currentVadResults.regions || [];
                console.log(`App: VAD analysis complete. Found ${speechRegionsForVisualizer.length} regions.`);
                // Update VAD UI elements with initial thresholds
                AudioApp.uiManager.updateVadDisplay(
                    currentVadResults.initialPositiveThreshold,
                    currentVadResults.initialNegativeThreshold
                );
                AudioApp.uiManager.setSpeechRegionsText(speechRegionsForVisualizer); // Update debug display
                AudioApp.uiManager.enableVadControls(true); // Enable VAD sliders

            } catch (analysisError) {
                // Handle errors during VAD analysis
                console.error("App: VAD Analysis failed -", analysisError);
                AudioApp.uiManager.setSpeechRegionsText(`VAD Error: ${analysisError.message}`);
                AudioApp.uiManager.enableVadControls(false);
                // Keep speechRegionsForVisualizer as empty array
            }
        } else {
             // VAD model failed to initialize earlier
             AudioApp.uiManager.setSpeechRegionsText("VAD Model Error");
             AudioApp.uiManager.enableVadControls(false);
             // Keep speechRegionsForVisualizer as empty array
        }

        // --- Trigger Visualizations ---
        // Draw visuals regardless of VAD success, passing the (potentially empty) regions
        if (currentAudioBuffer) {
            console.log("App: Computing/drawing visuals...");
            // Pass the determined speech regions (or empty array) to the visualizer
            await AudioApp.visualizer.computeAndDrawVisuals(currentAudioBuffer, speechRegionsForVisualizer);
        }

        // Hide spinner only after VAD and visuals are attempted, *if* worklet isn't ready yet
        // If worklet *is* ready, the spinner is hidden in handleWorkletReady
        if (!workletPlaybackReady) {
             AudioApp.visualizer.showSpinner(false);
        }
    }

    /**
     * Handles the 'audioapp:workletReady' event from the audioEngine.
     * Enables playback controls and hides the loading spinner.
     * @param {CustomEvent} e - Event object.
     * @private
     */
    function handleWorkletReady(e) {
        console.log("App: AudioWorklet processor is ready.");
        workletPlaybackReady = true;
        AudioApp.uiManager.enablePlaybackControls(true); // Enable Play/Pause, Jump, Speed, etc.
        AudioApp.uiManager.enableSeekBar(true); // Enable the seek bar for interaction
        AudioApp.visualizer.showSpinner(false); // Hide loading spinner
        // Update file info text to indicate readiness
        AudioApp.uiManager.setFileInfo(`Ready: ${currentFile ? currentFile.name : 'Unknown File'}`);
    }


    /**
     * Handles various audio error events from the audioEngine.
     * Logs the error, stops playback, resets the UI, and clears relevant state.
     * @param {CustomEvent<{type?: string, error: Error}>} e - Event detail contains error info.
     * @private
     */
    function handleAudioError(e) {
        const errorType = e.detail.type || 'Unknown';
        const errorMessage = e.detail.error ? e.detail.error.message : 'An unknown error occurred';
        console.error(`App: Audio Error - Type: ${errorType}, Message: ${errorMessage}`, e.detail.error);

        stopUIUpdateLoop(); // Stop UI updates immediately
        AudioApp.uiManager.setFileInfo(`Error (${errorType}): ${errorMessage.substring(0, 100)}`); // Show clipped error
        AudioApp.uiManager.resetUI(); // Reset controls, disable seekbar, etc.
        AudioApp.visualizer.clearVisuals(); // Clear waveform/spectrogram
        AudioApp.visualizer.showSpinner(false); // Ensure spinner is hidden

        // Reset critical application state
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

    /**
     * Handles the 'audioapp:playPauseClicked' event from the UI.
     * Tells the audioEngine to toggle playback and manages the start/stop
     * of the main thread UI update loop.
     * @private
     */
    function handlePlayPause() {
        if (!workletPlaybackReady) {
            console.warn("App: Play/Pause ignored - Worklet not ready."); return;
        }
        const audioCtx = AudioApp.audioEngine.getAudioContext();
        if (!audioCtx) { console.error("App: Cannot play/pause, AudioContext not available."); return; }

        // Determine the *intended* action based on the *current actual* playback state
        const aboutToPlay = !isActuallyPlaying;

        // Tell the audio engine to perform the toggle action
        AudioApp.audioEngine.togglePlayPause();

        // If the intention is to start playing:
        if (aboutToPlay) {
            // Record the current source time (from engine, might have been seeked while paused)
            // and the current context time as the starting point for the main thread calculation.
            const engineTime = AudioApp.audioEngine.getCurrentTime();
            playbackStartSourceTime = engineTime.currentTime;
            playbackStartTimeContext = audioCtx.currentTime;
            startUIUpdateLoop(); // Start the requestAnimationFrame loop
        } else {
            // If the intention is to pause:
            stopUIUpdateLoop(); // Stop the requestAnimationFrame loop
            playbackStartTimeContext = null; // Clear the context start time reference
            // The source start time (`playbackStartSourceTime`) is kept, representing the pause position.
        }
        // The UI button text ('Play'/'Pause') will be updated when the 'playbackStateChanged' event is received.
    }

    /**
     * Handles the 'audioapp:jumpClicked' event from the UI buttons.
     * Calculates the target time based on the *current estimated* source time,
     * tells the audioEngine to seek, and updates the main thread time tracking state.
     * @param {CustomEvent<{seconds: number}>} e - Event detail contains jump amount in seconds.
     * @private
     */
    function handleJump(e) {
        if (!workletPlaybackReady || !currentAudioBuffer) return; // Need worklet and buffer
        const audioCtx = AudioApp.audioEngine.getAudioContext();
        if (!audioCtx) { console.error("App: Cannot jump, AudioContext not available."); return; }
        const duration = currentAudioBuffer.duration;
        if (isNaN(duration) || duration <= 0) return; // Need valid duration

        // Calculate the current position using the main thread's estimation
        const currentTime = calculateEstimatedSourceTime();
        // Calculate the target position, clamped to the audio duration
        const targetTime = Math.max(0, Math.min(currentTime + e.detail.seconds, duration));

        // Tell the audio engine to perform the seek
        AudioApp.audioEngine.seek(targetTime);

        // Update main thread tracking state *immediately* after sending seek command
        playbackStartSourceTime = targetTime; // This is the new source time reference
        if (isActuallyPlaying) {
            // If currently playing, reset the context start time to *now*
            // so the rAF loop calculates correctly from the new position.
            playbackStartTimeContext = audioCtx.currentTime;
        } else {
            // If paused, clear the context start time.
            // Manually update the UI once to reflect the jump immediately.
            playbackStartTimeContext = null;
            updateUIWithTime(targetTime);
        }
        // The rAF loop (if running) will now calculate elapsed time relative to the new start times.
    }

    /**
     * Handles seek requests originating from canvas clicks ('audioapp:seekRequested')
     * or seek bar interaction ('audioapp:seekBarInput').
     * Calculates the target time based on the fraction, tells the audioEngine to seek,
     * and updates the main thread time tracking state.
     * @param {CustomEvent<{fraction: number}>} e - Event detail contains target position as fraction (0-1).
     * @private
     */
    function handleSeek(e) {
        // Ensure prerequisites are met
        if (!workletPlaybackReady || !currentAudioBuffer || isNaN(currentAudioBuffer.duration) || currentAudioBuffer.duration <= 0) return;
        const audioCtx = AudioApp.audioEngine.getAudioContext();
        if (!audioCtx) { console.error("App: Cannot seek, AudioContext not available."); return; }

        // Calculate the target time in seconds from the fraction
        const targetTime = e.detail.fraction * currentAudioBuffer.duration;

        // Tell the audio engine to perform the seek
        AudioApp.audioEngine.seek(targetTime);

        // Update main thread tracking state *immediately*
        playbackStartSourceTime = targetTime; // New source time reference
        if (isActuallyPlaying) {
            // If playing, reset context start time to *now* for accurate rAF calculation
            playbackStartTimeContext = audioCtx.currentTime;
        } else {
            // If paused, clear context start time and update UI manually once
            playbackStartTimeContext = null;
            updateUIWithTime(targetTime); // Show the seeked position immediately
        }
        // The rAF loop (if running) will continue from the new start times.
        // If the event came from the seek bar ('seekBarInput'), the bar's visual position
        // is already updated by the user interaction, so no need to call uiManager.updateSeekBar again here.
        // If it came from a canvas click ('seekRequested'), the UI update (including seek bar)
        // will happen either manually (if paused) or via the next rAF loop (if playing).
    }

    /** Alias handleSeekBarInput to handleSeek as the core logic is identical */
    const handleSeekBarInput = handleSeek;

    /**
     * Handles the 'audioapp:speedChanged' event from the UI slider.
     * Tells the audioEngine to set the new speed.
     * The actual speed value used for calculations is updated via 'internalSpeedChanged'.
     * @param {CustomEvent<{speed: number}>} e - Event detail contains the new speed value.
     * @private
     */
    function handleSpeedChange(e) {
        AudioApp.audioEngine.setSpeed(e.detail.speed);
    }

    /**
     * Handles the 'audioapp:internalSpeedChanged' event from the audioEngine.
     * Stores the confirmed speed value and resets the time calculation reference points
     * if currently playing to prevent visual jumps due to the speed change.
     * @param {CustomEvent<{speed: number}>} e - Event detail contains the applied speed.
     * @private
     */
    function handleInternalSpeedChange(e) {
         const newSpeed = e.detail.speed;
         console.log(`App: Internal speed updated to ${newSpeed.toFixed(2)}x`);
         currentSpeedForUpdate = newSpeed; // Store the speed for the rAF calculation

         // If playing, reset the start time references to avoid visual time jumps
         // when the speed changes mid-playback.
         const audioCtx = AudioApp.audioEngine.getAudioContext();
         if (isActuallyPlaying && playbackStartTimeContext !== null && audioCtx) {
            // Set the new source time reference to the *current* estimated source time
            playbackStartSourceTime = calculateEstimatedSourceTime();
            // Set the new context time reference to *now*
            playbackStartTimeContext = audioCtx.currentTime;
         }
    }

    /**
     * Handles the 'audioapp:pitchChanged' event from the UI slider.
     * Tells the audioEngine to set the new pitch scale.
     * @param {CustomEvent<{pitch: number}>} e - Event detail contains the new pitch value.
     * @private
     */
    function handlePitchChange(e) {
        AudioApp.audioEngine.setPitch(e.detail.pitch);
    }

    /**
     * Handles the 'audioapp:formantChanged' event from the UI slider.
     * Tells the audioEngine to set the new formant scale.
     * @param {CustomEvent<{formant: number}>} e - Event detail contains the new formant value.
     * @private
     */
    function handleFormantChange(e) {
        AudioApp.audioEngine.setFormant(e.detail.formant);
    }

    /**
     * Handles the 'audioapp:gainChanged' event from the UI slider.
     * Tells the audioEngine to set the new gain level.
     * @param {CustomEvent<{gain: number}>} e - Event detail contains the new gain value.
     * @private
     */
    function handleGainChange(e) {
        AudioApp.audioEngine.setGain(e.detail.gain);
    }

    /**
     * Handles the 'audioapp:thresholdChanged' event from the VAD UI sliders.
     * Uses the vadAnalyzer module to recalculate speech regions based on the new threshold
     * and triggers a redraw of the waveform highlighting.
     * @param {CustomEvent<{type: string, value: number}>} e - Event detail contains threshold type and value.
     * @private
     */
    function handleThresholdChange(e) {
        // Ignore if VAD analysis hasn't run or no audio buffer loaded
        if (!currentVadResults || !currentAudioBuffer) return;

        const { type, value } = e.detail;
        // Delegate threshold update and recalculation to the VAD analyzer module
        const newRegions = AudioApp.vadAnalyzer.handleThresholdUpdate(type, value);

        // Update UI elements based on the recalculated regions
        AudioApp.uiManager.setSpeechRegionsText(newRegions); // Update hidden debug display
        AudioApp.visualizer.redrawWaveformHighlight(currentAudioBuffer, newRegions); // Redraw waveform highlights
    }

    /**
     * Handles the 'audioapp:playbackEnded' event from the audioEngine.
     * Updates the application state, stops the UI update loop, and ensures
     * the UI reflects the stopped state at the end of the audio.
     * @private
     */
    function handlePlaybackEnded() {
        console.log("App: Playback ended event received.");
        isActuallyPlaying = false; // Update actual playback state
        stopUIUpdateLoop(); // Stop the rAF loop
        playbackStartTimeContext = null; // Clear context start time reference

        // Ensure UI shows the final state (time at duration, progress bar full)
        if (currentAudioBuffer) {
             updateUIWithTime(currentAudioBuffer.duration);
        }
        AudioApp.uiManager.setPlayButtonState(false); // Ensure button shows 'Play'
    }

    /**
     * Handles the 'audioapp:playbackStateChanged' event from the audioEngine.
     * This event confirms the actual playback state within the worklet.
     * Updates the `isActuallyPlaying` flag, manages the rAF loop, and updates the UI button.
     * @param {CustomEvent<{isPlaying: boolean}>} e - Event detail contains the confirmed state.
     * @private
     */
     function handlePlaybackStateChange(e) {
        const workletIsPlaying = e.detail.isPlaying;
        console.log(`App: Playback state confirmed by worklet: ${workletIsPlaying}`);

        // Update the reliable state tracker
        isActuallyPlaying = workletIsPlaying;

        // Update the Play/Pause button text
        AudioApp.uiManager.setPlayButtonState(isActuallyPlaying);

        // Manage the UI update loop based on the confirmed state
        if (isActuallyPlaying) {
            // If worklet confirms playing:
            // Ensure the rAF loop is running. It should have been started by handlePlayPause,
            // but this acts as a safeguard if the state got desynchronized.
            const audioCtx = AudioApp.audioEngine.getAudioContext();
            if (playbackStartTimeContext === null && audioCtx) {
                // If the context start time isn't set (e.g., playback started programmatically),
                // set the reference points now based on the engine's current source time.
                console.warn("App: Worklet playing but context start time not set. Setting now.");
                const engineTime = AudioApp.audioEngine.getCurrentTime();
                playbackStartSourceTime = engineTime.currentTime;
                playbackStartTimeContext = audioCtx.currentTime;
            }
            startUIUpdateLoop(); // Ensure loop is started/running
        } else {
            // If worklet confirms not playing:
            stopUIUpdateLoop(); // Ensure loop is stopped
            playbackStartTimeContext = null; // Clear context start time
            // Update the UI one last time to reflect the exact position reported by the engine when it stopped/paused.
            const engineTime = AudioApp.audioEngine.getCurrentTime();
            updateUIWithTime(engineTime.currentTime);
        }
    }

    /**
     * Handles the 'audioapp:keyPressed' event for keyboard shortcuts.
     * Triggers corresponding actions like play/pause or jump.
     * @param {CustomEvent<{key: string}>} e - Event detail contains the pressed key identifier.
     * @private
     */
    function handleKeyPress(e) {
        // Ignore key presses if the worklet isn't ready for playback commands
        if (!workletPlaybackReady) return;

        const key = e.detail.key;
        const jumpTimeValue = AudioApp.uiManager.getJumpTime(); // Get jump amount from UI input

        switch (key) {
            case 'Space':
                handlePlayPause(); // Use the same handler as the button click
                break;
            case 'ArrowLeft':
                // Trigger jump using the same logic as the button click
                handleJump({ detail: { seconds: -jumpTimeValue } });
                break;
            case 'ArrowRight':
                 // Trigger jump using the same logic as the button click
                 handleJump({ detail: { seconds: jumpTimeValue } });
                break;
        }
    }

    /**
     * Handles the window 'resize' event.
     * Tells the visualizer to resize its canvases and redraw, updating progress indicators.
     * @private
     */
    function handleWindowResize() {
        // Get current regions for redraw highlighting
        const regions = AudioApp.vadAnalyzer ? AudioApp.vadAnalyzer.getCurrentRegions() : [];
        // Tell visualizer to handle resize and redraw
        // It will internally get the current time via calculateEstimatedSourceTime
        AudioApp.visualizer.resizeAndRedraw(currentAudioBuffer, regions);
    }

    /**
     * Handles the window 'beforeunload' event.
     * Stops the UI update loop and cleans up audio engine resources.
     * @private
     */
    function handleBeforeUnload() {
        console.log("App: Unloading - Cleaning up...");
        stopUIUpdateLoop(); // Stop UI updates
        AudioApp.audioEngine.cleanup(); // Release AudioContext and other resources
    }

    // --- Main Thread Time Calculation & UI Update ---

    /**
     * Starts the `requestAnimationFrame` loop for continuous UI updates during playback.
     * Avoids starting multiple loops if one is already running.
     * @private
     */
    function startUIUpdateLoop() {
        // Only start if the loop isn't already running
        if (rAFUpdateHandle === null) {
            console.log("App: Starting UI update loop (rAF).");
            // Schedule the first call to the update function
            rAFUpdateHandle = requestAnimationFrame(updateUIBasedOnContextTime);
        }
    }

    /**
     * Stops the `requestAnimationFrame` loop.
     * @private
     */
    function stopUIUpdateLoop() {
        // Only stop if the loop is actually running
        if (rAFUpdateHandle !== null) {
            console.log("App: Stopping UI update loop (rAF).");
            cancelAnimationFrame(rAFUpdateHandle);
            rAFUpdateHandle = null; // Clear the handle
        }
    }

    /**
     * Calculates the estimated current position in the *source* audio based on
     * the elapsed time in the AudioContext since playback started/resumed,
     * scaled by the current playback speed.
     * @returns {number} The estimated current source time in seconds. Returns last known
     *                   source time if not currently playing or references are missing.
     * @private
     */
    function calculateEstimatedSourceTime() {
        const audioCtx = AudioApp.audioEngine.getAudioContext();
        const duration = currentAudioBuffer ? currentAudioBuffer.duration : 0;

        // Conditions under which we cannot calculate based on elapsed time:
        // - Not actually playing
        // - Haven't recorded a context start time (e.g., paused, or just loaded)
        // - Missing audio context or buffer
        // - Invalid duration or speed
        if (!isActuallyPlaying || playbackStartTimeContext === null || !audioCtx || !currentAudioBuffer || duration <= 0 || currentSpeedForUpdate <= 0) {
            // In these cases, return the last known source time from the engine state
            const engineTime = AudioApp.audioEngine.getCurrentTime();
            return engineTime.currentTime;
        }

        // Calculate elapsed time in the AudioContext clock
        const elapsedContextTime = audioCtx.currentTime - playbackStartTimeContext;
        // Scale this elapsed time by the playback speed to get elapsed *source* time
        const elapsedSourceTime = elapsedContextTime * currentSpeedForUpdate;
        // Add the elapsed source time to the source time recorded when playback started/resumed
        let estimatedCurrentSourceTime = playbackStartSourceTime + elapsedSourceTime;

        // Clamp the estimated time to the valid range [0, duration] to prevent over/undershoot
        estimatedCurrentSourceTime = Math.max(0, Math.min(estimatedCurrentSourceTime, duration));

        return estimatedCurrentSourceTime;
    }

    /**
     * Updates all relevant UI elements (time display, seek bar, visual progress indicators)
     * based on a given source time.
     * @param {number} time - The source time (in seconds) to display.
     * @private
     */
    function updateUIWithTime(time) {
        const duration = currentAudioBuffer ? currentAudioBuffer.duration : 0;
         // Avoid updates if duration is invalid (prevents NaN/Infinity issues)
         if (isNaN(duration) || duration <= 0) return;

        // Clamp time to ensure it's within bounds [0, duration]
        const clampedTime = Math.max(0, Math.min(time, duration));
        // Calculate the progress fraction
        const fraction = clampedTime / duration;

        // Update UI elements via the UI Manager
        AudioApp.uiManager.updateTimeDisplay(clampedTime, duration);
        AudioApp.uiManager.updateSeekBar(fraction); // Update seek bar position
        AudioApp.visualizer.updateProgressIndicator(clampedTime, duration); // Update canvas overlays
    }


    /**
     * The core function executed by `requestAnimationFrame`.
     * Calculates the estimated source time and updates the UI.
     * Schedules the next frame if still playing.
     * @param {DOMHighResTimeStamp} timestamp - The timestamp provided by rAF (not directly used here).
     * @private
     */
    function updateUIBasedOnContextTime(timestamp) {
        // Primary guard: If playback stopped (e.g., by pause or end event), clear the handle and exit.
        if (!isActuallyPlaying) {
            rAFUpdateHandle = null;
            return;
        }

        // Calculate the current estimated source time
        const estimatedTime = calculateEstimatedSourceTime();
        // Update all relevant UI elements
        updateUIWithTime(estimatedTime);

        // Schedule the next call to this function for the next frame
        rAFUpdateHandle = requestAnimationFrame(updateUIBasedOnContextTime);
    }


    // --- Public Interface ---
    // Expose only the main initialization function to the global scope
    return {
        init: init
        // Other methods are kept private within the IIFE scope
    };
})(); // End of AudioApp IIFE
// --- /vibe-player/js/app.js ---
