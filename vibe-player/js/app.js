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
    // Assuming other modules are loaded and attached to AudioApp
    const Utils = AudioApp.Utils; // Now using Utils

    // --- Application State ---
    /** @type {AudioBuffer|null} The currently loaded and decoded audio buffer. */
    let currentAudioBuffer = null;
    /** @type {string|null} The URL to display in the input field. */
    let currentDisplayUrl = null;
    /** @type {string} The style to apply to the URL input field. */
    let currentUrlStyle = 'default';
    /** @type {VadResult|null} Results from the VAD analysis (see vadAnalyzer). Only populated after background VAD. */
    let currentVadResults = null;
    /** @type {File|null} The currently loaded audio file object. */
    let currentFile = null;
    /** @type {boolean} Flag indicating if the Silero VAD model is loaded and ready. */
    let vadModelReady = false;
    /** @type {boolean} Flag indicating if the AudioWorklet processor is loaded and ready for playback commands. */
    let workletPlaybackReady = false;
    /** @type {boolean} Flag indicating if the background VAD task is currently running. */
    let isVadProcessing = false;
    /** @type {number} Counter for drag enter/leave events. */
    let dragCounter = 0;

    // --- Main Thread Playback Time State (Preserved) ---
    /** @type {number|null} AudioContext time when playback/seek started */ let playbackStartTimeContext = null;
    /** @type {number} Source time (in seconds) when playback/seek started */ let playbackStartSourceTime = 0.0;
    /** @type {boolean} */ let isActuallyPlaying = false; // Tracks confirmed playback state
    /** @type {number|null} */ let rAFUpdateHandle = null; // requestAnimationFrame handle
    /** @type {number} Playback speed used for main thread time estimation */ let currentSpeedForUpdate = 1.0;
    let playbackNaturallyEnded = false;

    // --- Debounced Function (NEW) ---
    /** @type {Function|null} Debounced function for engine synchronization after speed change. */
    let debouncedSyncEngine = null;
    const SYNC_DEBOUNCE_WAIT_MS = 300; // Wait 300ms after last speed change before syncing

    // --- Initialization ---
    /** @public */
    function init() {
        console.log("AudioApp: Initializing...");

        // Check for critical module dependencies (including Utils)
        if (!AudioApp.uiManager || !AudioApp.audioEngine || !AudioApp.waveformVisualizer || !AudioApp.spectrogramVisualizer || !AudioApp.vadAnalyzer || !AudioApp.sileroWrapper || !AudioApp.Constants || !AudioApp.Utils) {
             console.error("AudioApp: CRITICAL - One or more required modules/constants/utils not found on AudioApp namespace! Check script loading order.");
             // Optionally display a user-facing error
             AudioApp.uiManager?.setFileInfo("Initialization Error: Missing modules. Check console.");
             return;
        }

        // Create debounced function instance using AudioApp.Utils directly (CORRECTED)
        debouncedSyncEngine = AudioApp.Utils.debounce(syncEngineToEstimatedTime, SYNC_DEBOUNCE_WAIT_MS);

        // Initialize modules
        AudioApp.uiManager.init();
        setTimeout(() => {
            if (AudioApp.uiManager && typeof AudioApp.uiManager.unfocusUrlInput === 'function') {
                AudioApp.uiManager.unfocusUrlInput();
            }
        }, 100); // 100ms delay to ensure UI is ready
        AudioApp.audioEngine.init();
        AudioApp.waveformVisualizer.init();
        AudioApp.spectrogramVisualizer.init();
        // VAD modules don't have explicit init functions currently
        setupAppEventListeners();
        console.log("AudioApp: Initialized. Waiting for file...");
    }

    // --- Event Listener Setup ---
    /** @private */
    function setupAppEventListeners() {
        // UI -> App
        document.addEventListener('audioapp:fileSelected', handleFileSelected);
        document.addEventListener('audioapp:urlSelected', handleUrlSelected); // New listener
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

        // Drag and Drop Listeners
        window.addEventListener('dragenter', handleDragEnter);
        window.addEventListener('dragover', handleDragOver);
        window.addEventListener('dragleave', handleDragLeave);
        window.addEventListener('drop', handleDrop);
    }

    // --- Event Handler Functions ---

    // --- Drag and Drop Event Handlers ---
    /** @param {DragEvent} event @private */
    function handleDragEnter(event) {
        event.preventDefault();
        event.stopPropagation();
        dragCounter++;
        // Show drop zone only on the first enter
        if (dragCounter === 1 && event.dataTransfer?.items) {
            // Check if any item is a file
            let filePresent = false;
            for (let i = 0; i < event.dataTransfer.items.length; i++) {
                if (event.dataTransfer.items[i].kind === 'file') {
                    filePresent = true;
                    break;
                }
            }
            if (filePresent && event.dataTransfer.files.length > 0) {
                AudioApp.uiManager.showDropZone(event.dataTransfer.files[0]);
            } else {
                // If no file is part of the drag (e.g., dragging text), don't show drop zone
                // or show a different message. For now, just don't show.
            }
        }
    }

    /** @param {DragEvent} event @private */
    function handleDragOver(event) {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy'; // Show copy cursor
    }

    /** @param {DragEvent} event @private */
    function handleDragLeave(event) {
        event.preventDefault();
        event.stopPropagation();
        dragCounter--;
        // Hide drop zone only when the counter reaches 0
        if (dragCounter === 0) {
            AudioApp.uiManager.hideDropZone();
        }
    }

    /** @param {DragEvent} event @private */
    function handleDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        AudioApp.uiManager.hideDropZone();
        dragCounter = 0;

        const files = event.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            // Optional: Check file type
            if (file.type.startsWith('audio/')) {
                console.log("App: File dropped -", file.name);
                // Dispatch the existing fileSelected event to reuse the loading pathway
                document.dispatchEvent(new CustomEvent('audioapp:fileSelected', { detail: { file: file } }));
            } else {
                console.warn("App: Invalid file type dropped -", file.name, file.type);
                AudioApp.uiManager.setFileInfo("Invalid file type. Please drop an audio file.");
                // Optionally, display this error for a few seconds then clear, or let next action clear it.
            }
        }
    }

    // --- Other Event Handler Functions ---
    /** @param {CustomEvent<{file: File}>} e @private */
    async function handleFileSelected(e) {
        const file = e.detail.file; if (!file) return;
        currentFile = file;
        currentDisplayUrl = 'file:///' + file.name;
        currentUrlStyle = 'file';
        AudioApp.uiManager.setAudioUrlInputValue(currentDisplayUrl);
        AudioApp.uiManager.setUrlInputStyle(currentUrlStyle);
        console.log("App: File selected -", file.name);

        // Reset state
        stopUIUpdateLoop();
        isActuallyPlaying = false; playbackNaturallyEnded = false; isVadProcessing = false;
        playbackStartTimeContext = null; playbackStartSourceTime = 0.0;
        currentSpeedForUpdate = 1.0; currentAudioBuffer = null;
        currentVadResults = null; workletPlaybackReady = false;

        // Reset UI & Visuals
        AudioApp.uiManager.resetUI();
        AudioApp.uiManager.setAudioUrlInputValue(currentDisplayUrl);
        AudioApp.uiManager.setUrlInputStyle(currentUrlStyle);
        AudioApp.uiManager.setFileInfo(`Loading: ${file.name}...`);
        AudioApp.waveformVisualizer.clearVisuals(); // Use specific visualizer
        AudioApp.spectrogramVisualizer.clearVisuals(); // Use specific visualizer
        AudioApp.spectrogramVisualizer.showSpinner(true); // Show spectrogram spinner

        try { await AudioApp.audioEngine.loadAndProcessFile(file); }
        catch (error) {
            console.error("App: Error initiating file processing -", error);
            AudioApp.uiManager.setFileInfo(`Error loading: ${error.message}`); AudioApp.uiManager.resetUI();
            AudioApp.spectrogramVisualizer.showSpinner(false); stopUIUpdateLoop();
        }
    }


    /** @param {CustomEvent<{url: string}>} e @private */
    async function handleUrlSelected(e) {
        const url = e.detail.url;
        currentDisplayUrl = url;
        currentUrlStyle = 'default'; // Represents "loading" or "modified before load"
        AudioApp.uiManager.setAudioUrlInputValue(currentDisplayUrl);
        AudioApp.uiManager.setUrlInputStyle(currentUrlStyle);
        if (!url) {
            console.warn("App: URL selected event received, but URL is empty.");
            AudioApp.uiManager.setFileInfo("Error: No URL provided.");
            // Potentially set error style for URL input if it was briefly shown
            currentUrlStyle = 'error';
            AudioApp.uiManager.setUrlInputStyle(currentUrlStyle);
            return;
        }
        console.log("App: URL selected -", url);
        AudioApp.uiManager.setUrlLoadingError(""); // Clear previous URL errors
        // The style is already 'default' from above, so no need to set it again here explicitly
        // unless a specific condition requires it.

        // Attempt to derive a filename from the URL
        let filename = "loaded_from_url";
        try {
            const urlPath = new URL(url).pathname;
            const lastSegment = urlPath.substring(urlPath.lastIndexOf('/') + 1);
            if (lastSegment) {
                filename = decodeURIComponent(lastSegment);
            }
        } catch (urlError) {
            console.warn("App: Could not parse URL to extract filename, using default.", urlError);
            filename = url; // Fallback to using the full URL if parsing fails or no path segment
        }

        // Update UI to show the URL is being loaded
        AudioApp.uiManager.updateFileName(filename); // Show derived filename or full URL

        // Reset state (similar to handleFileSelected)
        stopUIUpdateLoop();
        isActuallyPlaying = false; playbackNaturallyEnded = false; isVadProcessing = false;
        playbackStartTimeContext = null; playbackStartSourceTime = 0.0;
        currentSpeedForUpdate = 1.0; currentAudioBuffer = null;
        currentVadResults = null; workletPlaybackReady = false;
        currentFile = null; // Clear previous file object

        // Reset UI & Visuals
        AudioApp.uiManager.resetUI(); // Resets most things, including file name if we want that behaviour
        AudioApp.uiManager.setAudioUrlInputValue(currentDisplayUrl);
        AudioApp.uiManager.setUrlInputStyle(currentUrlStyle); // currentUrlStyle is 'default' here
        AudioApp.uiManager.updateFileName(filename); // Re-apply filename after resetUI
        AudioApp.uiManager.setFileInfo(`Loading from URL: ${filename}...`);
        AudioApp.waveformVisualizer.clearVisuals();
        AudioApp.spectrogramVisualizer.clearVisuals();
        AudioApp.spectrogramVisualizer.showSpinner(true);

        try {
            AudioApp.uiManager.setFileInfo(`Fetching: ${filename}...`);
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Network response was not ok: ${response.status} ${response.statusText}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            AudioApp.uiManager.setFileInfo(`Processing: ${filename}...`);

            // Determine MIME type from URL extension if possible, otherwise default
            let mimeType = 'audio/*';
            const extension = filename.substring(filename.lastIndexOf('.') + 1).toLowerCase();
            if (extension === 'mp3') mimeType = 'audio/mpeg';
            else if (extension === 'wav') mimeType = 'audio/wav';
            else if (extension === 'ogg') mimeType = 'audio/ogg';
            // Add more types as needed

            const newFileObject = new File([arrayBuffer], filename, { type: mimeType });
            currentFile = newFileObject; // Store the new File object

            await AudioApp.audioEngine.loadAndProcessFile(newFileObject);
            // currentDisplayUrl is already set to the remote URL
            currentUrlStyle = 'success';
            AudioApp.uiManager.setUrlInputStyle(currentUrlStyle);
            // Ensure the input value is still the remote URL after potential background processing
            AudioApp.uiManager.setAudioUrlInputValue(currentDisplayUrl);

        } catch (error) {
            console.error("App: Error fetching or processing URL -", error);
            AudioApp.uiManager.resetUI(); // Call this first

            currentUrlStyle = 'error';
            AudioApp.uiManager.setAudioUrlInputValue(currentDisplayUrl); // Set the URL to the one that failed
            AudioApp.uiManager.setUrlInputStyle(currentUrlStyle); // Set style to error

            AudioApp.uiManager.updateFileName(filename); // Then update filename
            AudioApp.uiManager.setUrlLoadingError(`Error: Could not load audio from the provided URL. Please verify the URL and try again. (${error.message.substring(0,100)})`); // Then set specific error
            AudioApp.uiManager.setFileInfo("Failed to load audio from URL."); // Then set general file info

            AudioApp.spectrogramVisualizer.showSpinner(false);
            stopUIUpdateLoop();
            currentFile = null;
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

        // If a file was loaded (not a URL), and we have display URL info, ensure it's shown.
        // This primarily ensures that if resetUI was called during processing, the file URL is restored.
        if (currentFile && currentDisplayUrl && currentUrlStyle === 'file') {
            AudioApp.uiManager.setAudioUrlInputValue(currentDisplayUrl);
            AudioApp.uiManager.setUrlInputStyle(currentUrlStyle);
        }
    }

    /** @param {CustomEvent} e @private */
    function handleWorkletReady(e) {
        console.log("App: AudioWorklet processor is ready.");
        workletPlaybackReady = true;
        AudioApp.uiManager.enablePlaybackControls(true);
        AudioApp.uiManager.enableSeekBar(true);
        // Spectrogram spinner is handled by spectrogramVisualizer
        AudioApp.uiManager.setFileInfo(`Ready: ${currentFile ? currentFile.name : 'Unknown File'}`);
        AudioApp.uiManager.unfocusUrlInput();
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

    /**
     * Handles play/pause button clicks.
     * If pausing, calculates the current estimated time and seeks the engine
     * to that exact position *before* telling the engine to pause.
     * Also updates the main thread state and UI immediately on pause.
     * @private
     */
    function handlePlayPause() {
        if (!workletPlaybackReady || !AudioApp.audioEngine) { console.warn("App: Play/Pause ignored - Engine/Worklet not ready."); return; }
        const audioCtx = AudioApp.audioEngine.getAudioContext(); if (!audioCtx) { console.error("App: Cannot play/pause, AudioContext not available."); return; }

        const aboutToPlay = !isActuallyPlaying;

        // --- Corrected Pause Logic ---
        if (!aboutToPlay) {
            playbackNaturallyEnded = false;
            // Calculate the precise time based on main thread estimation *now*
            const finalEstimatedTime = calculateEstimatedSourceTime();
            console.log(`App: Pausing requested. Seeking engine to estimated time: ${finalEstimatedTime.toFixed(3)} before pausing.`);

            // Seek the engine to this exact spot *before* sending the pause command
            AudioApp.audioEngine.seek(finalEstimatedTime);

            // Update main thread state immediately to reflect the seek target
            // This ensures consistency even before the worklet confirms the pause state
            playbackStartSourceTime = finalEstimatedTime; // Set the source time base to the calculated pause time
            playbackStartTimeContext = null; // Clear context time as we are stopping

            // Stop the UI loop immediately
            stopUIUpdateLoop();

            // Update UI immediately to the precise pause time
            updateUIWithTime(finalEstimatedTime);
        }
        // --- End Corrected Pause Logic ---

        // Tell engine to toggle its internal state (play or pause)
        // The engine will eventually dispatch 'playbackStateChanged' to confirm
        AudioApp.audioEngine.togglePlayPause();

        // If starting playback, main thread time markers and UI loop
        // will be set/started in handlePlaybackStateChange when the engine confirms it's playing.
    }

    /** @param {CustomEvent<{seconds: number}>} e @private */
    function handleJump(e) {
        playbackNaturallyEnded = false;
        if (!workletPlaybackReady || !currentAudioBuffer || !AudioApp.audioEngine) return;
        const audioCtx = AudioApp.audioEngine.getAudioContext(); if (!audioCtx) return;
        const duration = currentAudioBuffer.duration; if (isNaN(duration) || duration <= 0) return;

        // Use main thread calculation for current time
        const currentTime = calculateEstimatedSourceTime();
        const targetTime = Math.max(0, Math.min(currentTime + e.detail.seconds, duration));

        AudioApp.audioEngine.seek(targetTime); // Tell engine to seek

        // Update main thread time tracking immediately
        playbackStartSourceTime = targetTime; // Update the base source time
        if (isActuallyPlaying) { // If playing, reset context start time relative to the new source time
            playbackStartTimeContext = audioCtx.currentTime;
        } else { // If paused, update UI directly, context time remains null
             playbackStartTimeContext = null;
            updateUIWithTime(targetTime); // Manually update UI while paused
        }
    }

    /** @param {CustomEvent<{fraction: number}>} e @private */
    function handleSeek(e) {
        playbackNaturallyEnded = false;
        if (!workletPlaybackReady || !currentAudioBuffer || isNaN(currentAudioBuffer.duration) || currentAudioBuffer.duration <= 0 || !AudioApp.audioEngine) return;
        const audioCtx = AudioApp.audioEngine.getAudioContext(); if (!audioCtx) return;

        const targetTime = e.detail.fraction * currentAudioBuffer.duration; // Calculate target
        AudioApp.audioEngine.seek(targetTime); // Tell engine to seek

        // Update main thread time tracking immediately
        playbackStartSourceTime = targetTime; // Update the base source time
        if (isActuallyPlaying) { // If playing, reset context start time relative to the new source time
            playbackStartTimeContext = audioCtx.currentTime;
        } else { // If paused, update UI directly, context time remains null
             playbackStartTimeContext = null;
            updateUIWithTime(targetTime); // Manually update UI while paused
        }
    }
    const handleSeekBarInput = handleSeek; // Alias remains

    /**
     * Handles the 'input' event from the speed slider (via uiManager).
     * Sends the new speed target to the audio engine immediately.
     * Calls the debounced synchronization function.
     * @param {CustomEvent<{speed: number}>} e @private
     */
    function handleSpeedChange(e) { // Preserved Debounce Logic
        if (!debouncedSyncEngine) {
             console.warn("App: Debounced sync function not ready for speed change.");
             // Still update the engine speed even if debounce isn't ready
             AudioApp.audioEngine?.setSpeed(e.detail.speed);
             return;
         }
        // Send speed update immediately to engine
        AudioApp.audioEngine?.setSpeed(e.detail.speed);
        // Trigger the debounced sync function (resets timer on each input)
        debouncedSyncEngine();
    }

    // handleSpeedChangeEnd REMOVED (Logic moved to debouncedSyncEngine call)

    /** @param {CustomEvent<{pitch: number}>} e @private */
    function handlePitchChange(e) { AudioApp.audioEngine?.setPitch(e.detail.pitch); }
    /** @param {CustomEvent<{gain: number}>} e @private */
    function handleGainChange(e) { AudioApp.audioEngine?.setGain(e.detail.gain); }

    /**
     * Performs the actual seek operation to synchronize the engine
     * after a short delay following speed slider changes.
     * This function is intended to be called via the debounced wrapper.
     * @private
     */
    function syncEngineToEstimatedTime() { // NEW function
        if (!workletPlaybackReady || !currentAudioBuffer || !AudioApp.audioEngine) {
            console.log("App (Debounced Sync): Skipping sync - not ready or no buffer.");
            return;
        }
        const audioCtx = AudioApp.audioEngine.getAudioContext();
        if (!audioCtx) {
            console.log("App (Debounced Sync): Skipping sync - no AudioContext.");
            return;
        }

        // Calculate the precise time based on main thread estimation NOW
        const targetTime = calculateEstimatedSourceTime();
        console.log(`App: Debounced sync executing. Seeking engine to estimated time: ${targetTime.toFixed(3)}.`);

        // Seek the engine to this exact spot
        AudioApp.audioEngine.seek(targetTime);

        // Update main thread state immediately to reflect the seek target
        playbackStartSourceTime = targetTime;
        if (isActuallyPlaying) { // If playing, reset context start time too
             playbackStartTimeContext = audioCtx.currentTime;
        } else { // If paused, ensure context time is null and update UI
            playbackStartTimeContext = null;
             // Update UI immediately since rAF loop isn't running
            updateUIWithTime(targetTime);
        }
    }


    /**
     * Handles the internal speed change confirmed by the engine.
     * Updates the main thread's time tracking base to prevent UI jumps.
     * @param {CustomEvent<{speed: number}>} e @private
     */
    function handleInternalSpeedChange(e) { // RESTORED function
        const newSpeed = e.detail.speed;
        console.log(`App: Internal speed updated by engine to ${newSpeed.toFixed(2)}x`);

        const oldSpeed = currentSpeedForUpdate;
        currentSpeedForUpdate = newSpeed; // Update speed used for UI calculation

        const audioCtx = AudioApp.audioEngine.getAudioContext();
        // If playing, recalculate base times to prevent jump in UI display
        if (isActuallyPlaying && playbackStartTimeContext !== null && audioCtx) {
            // Calculate where we *were* just before the speed change event was processed
            const elapsedContextTime = audioCtx.currentTime - playbackStartTimeContext;
            const elapsedSourceTime = elapsedContextTime * oldSpeed; // Use OLD speed
            const previousSourceTime = playbackStartSourceTime + elapsedSourceTime;

            // Set the new base source time to where we were
            playbackStartSourceTime = previousSourceTime;
            // Reset the context start time to NOW
            playbackStartTimeContext = audioCtx.currentTime;
            console.log(`App: Adjusted time tracking base for speed change. New base source time: ${playbackStartSourceTime.toFixed(3)}`);
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
        if (currentAudioBuffer) { // Ensure UI shows exact end time
             playbackStartSourceTime = currentAudioBuffer.duration; // Set base time to end
             updateUIWithTime(currentAudioBuffer.duration);
        }
        playbackNaturallyEnded = true;
        AudioApp.uiManager.setPlayButtonState(false);
    }

    /**
     * Handles playback state confirmation from the worklet.
     * Manages UI loop state and sets initial time base when starting.
     * No longer performs seek-on-pause sync here (handled in handlePlayPause).
     * @param {CustomEvent<{isPlaying: boolean}>} e @private
     */
     function handlePlaybackStateChange(e) {
        const workletIsPlaying = e.detail.isPlaying;
        console.log(`App: Playback state confirmed by worklet: ${workletIsPlaying}`);

        const wasPlaying = isActuallyPlaying; // Store previous state
        isActuallyPlaying = workletIsPlaying; // Update internal state

        AudioApp.uiManager.setPlayButtonState(isActuallyPlaying); // Update button

        if (isActuallyPlaying) {
            // --- Starting Playback ---
            const audioCtx = AudioApp.audioEngine?.getAudioContext();
            // If transitioning from not playing to playing, reset time base
            if (wasPlaying === false && audioCtx) {
                if (playbackNaturallyEnded && currentAudioBuffer) { // Ensure buffer exists for duration
                    playbackStartSourceTime = 0;
                    playbackNaturallyEnded = false; // Reset the flag
                    playbackStartTimeContext = audioCtx.currentTime;
                    console.log("App: Playback started from beginning due to playbackNaturallyEnded flag.");
                    // Ensure UI reflects this starting time immediately
                    updateUIWithTime(playbackStartSourceTime);
                } else {
                    // This is the existing logic
                    const engineTime = AudioApp.audioEngine.getCurrentTime();
                    playbackStartSourceTime = engineTime.currentTime;
                    playbackStartTimeContext = audioCtx.currentTime; // Mark context time NOW
                    console.log(`App: Playback confirmed started/resumed. Setting time base: src=${playbackStartSourceTime.toFixed(3)}, ctx=${playbackStartTimeContext.toFixed(3)}`);
                    // Ensure UI reflects this starting time immediately
                    updateUIWithTime(playbackStartSourceTime);
                }
            }
            startUIUpdateLoop(); // Ensure UI loop is running
        } else {
            // --- Stopping Playback ---
            stopUIUpdateLoop(); // Stop UI loop
            playbackStartTimeContext = null; // Clear context time marker

            // UI time and engine sync were already handled in handlePlayPause
            // Just ensure the state is consistent
            console.log(`App: Playback confirmed stopped/paused. Base source time: ${playbackStartSourceTime.toFixed(3)}`);
        }
    }

    /** @param {CustomEvent<{key: string}>} e @private */
    function handleKeyPress(e) { /* ... unchanged ... */ if (!workletPlaybackReady) return; const key = e.detail.key; const jumpTimeValue = AudioApp.uiManager.getJumpTime(); switch (key) { case 'Space': handlePlayPause(); break; case 'ArrowLeft': handleJump({ detail: { seconds: -jumpTimeValue } }); break; case 'ArrowRight': handleJump({ detail: { seconds: jumpTimeValue } }); break; } }
    /** @private */
    function handleWindowResize() { /* ... unchanged ... */ const regions = AudioApp.vadAnalyzer ? AudioApp.vadAnalyzer.getCurrentRegions() : []; AudioApp.waveformVisualizer?.resizeAndRedraw(currentAudioBuffer, regions); AudioApp.spectrogramVisualizer?.resizeAndRedraw(currentAudioBuffer); }
    /** @private */
    function handleBeforeUnload() { /* ... unchanged ... */ console.log("App: Unloading..."); stopUIUpdateLoop(); AudioApp.audioEngine?.cleanup(); }

    // --- Main Thread Time Calculation & UI Update (RESTORED / MODIFIED) ---

    /** @private */
    function startUIUpdateLoop() { if (rAFUpdateHandle === null) { rAFUpdateHandle = requestAnimationFrame(updateUIBasedOnContextTime); } } // Use context time function
    /** @private */
    function stopUIUpdateLoop() { if (rAFUpdateHandle !== null) { cancelAnimationFrame(rAFUpdateHandle); rAFUpdateHandle = null; } }

    /**
     * Calculates the estimated current source time based on AudioContext time. RESTORED.
     * @private
     * @returns {number} The estimated current time in seconds within the audio source.
     */
    function calculateEstimatedSourceTime() { // RESTORED function
        const audioCtx = AudioApp.audioEngine?.getAudioContext();
        const duration = currentAudioBuffer ? currentAudioBuffer.duration : 0;

        // If not playing, return the base source time (set by play/seek/pause)
        if (!isActuallyPlaying || playbackStartTimeContext === null || !audioCtx || !currentAudioBuffer || duration <= 0) {
            return playbackStartSourceTime;
        }
         // If speed is zero or negative, time doesn't advance.
         if (currentSpeedForUpdate <= 0) {
              return playbackStartSourceTime;
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
    function updateUIWithTime(time) { /* ... unchanged ... */ const duration = currentAudioBuffer ? currentAudioBuffer.duration : 0; if (isNaN(duration)) return; const clampedTime = Math.max(0, Math.min(time, duration)); const fraction = duration > 0 ? clampedTime / duration : 0; AudioApp.uiManager.updateTimeDisplay(clampedTime, duration); AudioApp.uiManager.updateSeekBar(fraction); AudioApp.waveformVisualizer?.updateProgressIndicator(clampedTime, duration); AudioApp.spectrogramVisualizer?.updateProgressIndicator(clampedTime, duration); }

    /**
     * The main UI update loop function, called via requestAnimationFrame.
     * Uses main thread calculation (AudioContext time) for estimation.
     * @param {DOMHighResTimeStamp} timestamp - The timestamp provided by rAF.
     * @private
     */
    function updateUIBasedOnContextTime(timestamp) { // Renamed back
        if (!isActuallyPlaying) { rAFUpdateHandle = null; return; } // Stop loop if not playing

        // Calculate time based on main thread context time and speed
        const estimatedTime = calculateEstimatedSourceTime();
        updateUIWithTime(estimatedTime);

        // Request the next frame
        rAFUpdateHandle = requestAnimationFrame(updateUIBasedOnContextTime);
    }


    // --- Public Interface ---
    return {
        init: init
    };
})(); // End of AudioApp IIFE
// --- /vibe-player/js/app.js ---
