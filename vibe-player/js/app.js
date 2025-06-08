// --- /vibe-player/js/app.js ---
// Creates the global namespace and orchestrates the application flow.
// MUST be loaded FIRST after libraries.

/**
 * @namespace AudioApp
 * @description Main application namespace for Vibe Player.
 */
var AudioApp = AudioApp || {};

/**
 * @fileoverview Main application logic for Vibe Player.
 * Orchestrates UI, audio engine, visualizers, and VAD processing.
 * Handles user interactions and manages application state.
 * @version 1.0.0
 */

/**
 * @typedef {Object} VadResultRegion
 * @property {number} start - Start time of the speech region in seconds.
 * @property {number} end - End time of the speech region in seconds.
 */

/**
 * @typedef {Object} VadResult
 * @property {VadResultRegion[]} regions - Array of detected speech regions.
 * @property {number} initialPositiveThreshold - The positive VAD threshold used for this result.
 * @property {number} initialNegativeThreshold - The negative VAD threshold used for this result.
 */

/**
 * @typedef {Object} HashSettings
 * @property {number} [speed] - Playback speed.
 * @property {number} [pitch] - Playback pitch.
 * @property {number} [vadPositive] - VAD positive threshold.
 * @property {number} [vadNegative] - VAD negative threshold.
 * @property {number} [volume] - Playback volume/gain.
 * @property {string} [audioUrl] - URL of the audio file to load.
 * @property {number} [position] - Playback position in seconds.
 */


AudioApp = (function () {
    'use strict';

    // Instantiate AppState and expose it on the AudioApp namespace
    const appState = new AppState();
    AudioApp.state = appState;

    /** @type {HashSettings} Stores settings parsed from the URL hash. */
    let initialHashSettings = {};
    /** @type {number} Timestamp of the last URL hash update. */
    let lastHashUpdateTime = 0;

    // Constants for URL hash parameters are now sourced from Constants.URLHashKeys

    /**
     * @private
     * @type {AudioApp.Utils} Reference to the Utils module.
     */
    const Utils = AudioApp.Utils;

    // --- Application State ---
    // Most local state variables are now managed by AudioApp.state (AppState instance)
    // e.g., currentAudioBuffer -> AudioApp.state.runtime.currentAudioBuffer
    //       isActuallyPlaying  -> AudioApp.state.status.isActuallyPlaying

    /** @type {number} Counter for drag enter/leave events to manage drop zone visibility. */
    let dragCounter = 0; // This remains local as it's purely a UI interaction detail
    /** @type {AudioApp.DTMFParser|null} The DTMF parser instance. */
    let dtmfParser = null;
    /** @type {AudioApp.CallProgressToneParser|null} The Call Progress Tone parser instance. */
    let cptParser = null;

    // --- Main Thread Playback Time State ---
    // playbackStartTimeContext, playbackStartSourceTime, isActuallyPlaying, currentSpeedForUpdate, playbackNaturallyEnded
    // are now primarily managed in AppState.status and AppState.runtime.

    /** @type {number|null} Handle for the requestAnimationFrame UI update loop. Null if not running. */
    let rAFUpdateHandle = null; // Remains local for managing the rAF loop itself.

    // --- Debounced Functions ---
    /** @type {Function|null} Debounced function for synchronizing the audio engine after speed changes. */
    let debouncedSyncEngine = null;
    // SYNC_DEBOUNCE_WAIT_MS is now Constants.UI.SYNC_DEBOUNCE_WAIT_MS

    // DEBOUNCE_HASH_UPDATE_MS is now Constants.UI.DEBOUNCE_HASH_UPDATE_MS
    /** @type {Function|null} Debounced function for updating the URL hash from current settings. */
    let debouncedUpdateUrlHash = null; // Renamed from debouncedUpdateHashFromSettings

    /**
     * Parses application settings from the URL hash and updates AppState.
     * @private
     */
    function parseSettingsFromHashAndUpdateState() {
        const hash = window.location.hash.substring(1);
        if (!hash) return;

        const params = new URLSearchParams(hash);

        const speedStr = params.get(Constants.URLHashKeys.SPEED);
        if (speedStr !== null) AudioApp.state.updateParam('speed', parseFloat(speedStr));

        const pitchStr = params.get(Constants.URLHashKeys.PITCH);
        if (pitchStr !== null) AudioApp.state.updateParam('pitch', parseFloat(pitchStr));

        const vadPositiveStr = params.get(Constants.URLHashKeys.VAD_POSITIVE);
        if (vadPositiveStr !== null) AudioApp.state.updateParam('vadPositive', parseFloat(vadPositiveStr));

        const vadNegativeStr = params.get(Constants.URLHashKeys.VAD_NEGATIVE);
        if (vadNegativeStr !== null) AudioApp.state.updateParam('vadNegative', parseFloat(vadNegativeStr));

        const gainStr = params.get(Constants.URLHashKeys.GAIN); // Note: 'volume' from old hash becomes 'gain'
        if (gainStr !== null) AudioApp.state.updateParam('gain', parseFloat(gainStr));

        const audioUrl = params.get(Constants.URLHashKeys.AUDIO_URL);
        if (audioUrl !== null) AudioApp.state.updateParam('audioUrl', audioUrl);

        const timeStr = params.get(Constants.URLHashKeys.TIME);
        if (timeStr !== null) {
            // This time will be applied when the worklet is ready and audio loaded
            initialHashSettings.position = parseFloat(timeStr);
        }
        console.log('App: Parsed initial settings from hash and updated AppState.');
    }


    /**
     * Generates a URL hash string from the current AppState and playback position.
     * @private
     */
    function updateUrlHashFromState() {
        if (!AudioApp.state || !AudioApp.audioEngine) return;

        const newHash = AudioApp.state.serialize(AudioApp.audioEngine.getCurrentTime().currentTime);

        if (newHash) {
            history.replaceState(null, '', `#${newHash}`);
        } else {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    }


    /**
     * Initializes the main application.
     * Sets up modules, event listeners, and applies initial settings from URL hash.
     * @public
     * @memberof AudioApp
     */
    function init() {
        console.log("AudioApp: Initializing...");

        if (!AudioApp.uiManager || !AudioApp.audioEngine || !AudioApp.waveformVisualizer ||
            !AudioApp.spectrogramVisualizer || !AudioApp.vadAnalyzer || /* !AudioApp.Constants || */ // Constants is now global
            !AudioApp.Utils || !AudioApp.DTMFParser || !AudioApp.CallProgressToneParser || typeof Constants === 'undefined') {
            console.error("AudioApp: CRITICAL - One or more required modules not found! Check script loading order.");
            AudioApp.uiManager?.setFileInfo("Initialization Error: Missing modules. Check console.");
            return;
        }

        debouncedSyncEngine = AudioApp.Utils.debounce(syncEngineToEstimatedTime, Constants.UI.SYNC_DEBOUNCE_WAIT_MS);
        debouncedUpdateUrlHash = AudioApp.Utils.debounce(updateUrlHashFromState, Constants.UI.DEBOUNCE_HASH_UPDATE_MS);

        AudioApp.uiManager.init(); // Initializes UI elements and their default states

        // Parse hash and update AppState. This might trigger UI updates if AppState is already connected to UI.
        initialHashSettings = {}; // Reset before parsing
        parseSettingsFromHashAndUpdateState();

        // Apply AppState params to UI elements that were not set by hash
        // This ensures UI reflects AppState's defaults if no hash overrides were present.
        AudioApp.uiManager.setPlaybackSpeedValue(AudioApp.state.params.speed);
        AudioApp.uiManager.setPitchValue(AudioApp.state.params.pitch);
        AudioApp.uiManager.setGainValue(AudioApp.state.params.gain);
        AudioApp.uiManager.setVadPositiveThresholdValue(AudioApp.state.params.vadPositive);
        AudioApp.uiManager.setVadNegativeThresholdValue(AudioApp.state.params.vadNegative);

        setupAppEventListeners(); // Setup listeners that might depend on initial state being set

        // Handle audioUrl from AppState (which might have been populated by hash)
        const initialAudioUrl = AudioApp.state.params.audioUrl;
        if (initialAudioUrl) {
            console.log("App: Applying audioUrl from AppState (potentially from hash):", initialAudioUrl);
            AudioApp.uiManager.setAudioUrlInputValue(initialAudioUrl);

            if (initialAudioUrl.startsWith('file:///')) {
                AudioApp.state.updateStatus('urlInputStyle', 'error');
                AudioApp.uiManager.setUrlInputStyle(AudioApp.state.status.urlInputStyle);
                AudioApp.uiManager.setUrlLoadingError("Local files cannot be automatically reloaded from the URL. Please re-select the file.");
            } else {
                AudioApp.state.updateStatus('urlInputStyle', 'modified');
                AudioApp.uiManager.setUrlInputStyle(AudioApp.state.status.urlInputStyle);
                // Trigger loading of the URL
                document.dispatchEvent(new CustomEvent('audioapp:urlSelected', {detail: {url: initialAudioUrl}}));
            }
        }

        setTimeout(() => {
            AudioApp.uiManager?.unfocusUrlInput();
        }, 100);

        AudioApp.audioEngine.init();
        AudioApp.waveformVisualizer.init();
        AudioApp.spectrogramVisualizer.init(() => AudioApp.state.runtime.currentAudioBuffer);

        if (AudioApp.DTMFParser) dtmfParser = new AudioApp.DTMFParser();
        if (AudioApp.CallProgressToneParser) cptParser = new AudioApp.CallProgressToneParser();

        console.log("AudioApp: Initialized. Waiting for file...");
    }

    /**
     * Sets up global event listeners for the application.
     * @private
     */
    function setupAppEventListeners() {
        document.addEventListener('audioapp:fileSelected', /** @type {EventListener} */ (handleFileSelected));
        document.addEventListener('audioapp:urlSelected', /** @type {EventListener} */ (handleUrlSelected));
        document.addEventListener('audioapp:playPauseClicked', handlePlayPause);
        document.addEventListener('audioapp:jumpClicked', /** @type {EventListener} */ (handleJump));
        document.addEventListener('audioapp:seekRequested', /** @type {EventListener} */ (handleSeek));
        document.addEventListener('audioapp:seekBarInput', /** @type {EventListener} */ (handleSeekBarInput));
        document.addEventListener('audioapp:speedChanged', /** @type {EventListener} */ (handleSpeedChange));
        document.addEventListener('audioapp:pitchChanged', /** @type {EventListener} */ (handlePitchChange));
        document.addEventListener('audioapp:gainChanged', /** @type {EventListener} */ (handleGainChange));
        document.addEventListener('audioapp:thresholdChanged', /** @type {EventListener} */ (handleThresholdChange));
        document.addEventListener('audioapp:keyPressed', /** @type {EventListener} */ (handleKeyPress));

        document.addEventListener('audioapp:audioLoaded', /** @type {EventListener} */ (handleAudioLoaded));
        document.addEventListener('audioapp:workletReady', /** @type {EventListener} */ (handleWorkletReady));
        document.addEventListener('audioapp:decodingError', /** @type {EventListener} */ (handleAudioError));
        document.addEventListener('audioapp:resamplingError', /** @type {EventListener} */ (handleAudioError));
        document.addEventListener('audioapp:playbackError', /** @type {EventListener} */ (handleAudioError));
        document.addEventListener('audioapp:engineError', /** @type {EventListener} */ (handleAudioError));
        document.addEventListener('audioapp:playbackEnded', handlePlaybackEnded);
        document.addEventListener('audioapp:playbackStateChanged', /** @type {EventListener} */ (handlePlaybackStateChange));
        document.addEventListener('audioapp:internalSpeedChanged', /** @type {EventListener} */ (handleInternalSpeedChange));

        window.addEventListener('resize', handleWindowResize);
        window.addEventListener('beforeunload', handleBeforeUnload);
        window.addEventListener('dragenter', handleDragEnter);
        window.addEventListener('dragover', handleDragOver);
        window.addEventListener('dragleave', handleDragLeave);
        window.addEventListener('drop', handleDrop);
    }


    // --- Drag and Drop Event Handlers ---
    /**
     * Handles the dragenter event for file drag-and-drop.
     * @private
     * @param {DragEvent} event - The drag event.
     */
    function handleDragEnter(event) {
        event.preventDefault();
        event.stopPropagation();
        dragCounter++;
        if (dragCounter === 1 && event.dataTransfer?.items) {
            let filePresent = false;
            for (let i = 0; i < event.dataTransfer.items.length; i++) {
                if (event.dataTransfer.items[i].kind === 'file') {
                    filePresent = true;
                    break;
                }
            }
            if (filePresent && event.dataTransfer.files.length > 0) {
                AudioApp.uiManager.showDropZone(event.dataTransfer.files[0]);
            }
        }
    }

    /**
     * Handles the dragover event for file drag-and-drop.
     * @private
     * @param {DragEvent} event - The drag event.
     */
    function handleDragOver(event) {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    }

    /**
     * Handles the dragleave event for file drag-and-drop.
     * @private
     * @param {DragEvent} event - The drag event.
     */
    function handleDragLeave(event) {
        event.preventDefault();
        event.stopPropagation();
        dragCounter--;
        if (dragCounter === 0) {
            AudioApp.uiManager.hideDropZone();
        }
    }

    /**
     * Handles the drop event for file drag-and-drop.
     * @private
     * @param {DragEvent} event - The drop event.
     */
    function handleDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        AudioApp.uiManager.hideDropZone();
        dragCounter = 0;

        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
            const file = files[0];
            if (file.type.startsWith('audio/')) {
                console.log("App: File dropped -", file.name);
                document.dispatchEvent(new CustomEvent('audioapp:fileSelected', {detail: {file: file}}));
            } else {
                console.warn("App: Invalid file type dropped -", file.name, file.type);
                AudioApp.uiManager.setFileInfo("Invalid file type. Please drop an audio file.");
            }
        }
    }

    /**
     * Handles the 'audioapp:fileSelected' event.
     * Resets application state and initiates loading of the selected file.
     * @private
     * @param {CustomEvent<{file: File}>} e - The event object.
     */
    async function handleFileSelected(e) {
        const file = e.detail.file;
        if (!file) return;

        const newDisplayUrl = 'file:///' + file.name;
        const previousDisplayUrl = AudioApp.state.params.audioUrl;

        AudioApp.state.updateRuntime('currentFile', file);
        AudioApp.state.updateParam('audioUrl', newDisplayUrl);
        AudioApp.state.updateStatus('urlInputStyle', 'file');
        AudioApp.uiManager.setAudioUrlInputValue(newDisplayUrl); // Keep UI in sync
        AudioApp.uiManager.setUrlInputStyle('file');


        console.log("App: File selected -", file.name);
        resetAudioStateAndUI(file.name, newDisplayUrl !== previousDisplayUrl);

        try {
            await AudioApp.audioEngine.loadAndProcessFile(file); // audioEngine will get currentFile from AppState if needed
        } catch (error) {
            console.error("App: Error initiating file processing -", error);
            AudioApp.uiManager.setFileInfo(`Error loading: ${error?.message || 'Unknown error'}`);
            AudioApp.uiManager.resetUI(); // Full UI reset on critical load error
            AudioApp.spectrogramVisualizer.showSpinner(false);
            stopUIUpdateLoop();
        }
    }

    /**
     * Handles the 'audioapp:urlSelected' event.
     * Resets application state and initiates loading of the audio from the URL.
     * @private
     * @param {CustomEvent<{url: string}>} e - The event object.
     */
    async function handleUrlSelected(e) {
        const newUrlFromEvent = e.detail.url;
        const previousDisplayUrl = AudioApp.state.params.audioUrl;

        AudioApp.state.updateParam('audioUrl', newUrlFromEvent);
        AudioApp.state.updateStatus('urlInputStyle', 'default');
        AudioApp.uiManager.setUrlInputStyle('default');


        if (!newUrlFromEvent) {
            console.warn("App: URL selected event received, but URL is empty.");
            AudioApp.uiManager.setAudioUrlInputValue("");
            AudioApp.state.updateStatus('urlInputStyle', 'error');
            AudioApp.uiManager.setUrlInputStyle('error');
            AudioApp.state.updateStatus('fileInfoMessage', "Error: No URL provided.");
            // uiManager will pick up fileInfoMessage via subscription or direct call if needed
            return;
        }
        console.log("App: URL selected -", newUrlFromEvent);
        AudioApp.state.updateStatus('urlLoadingErrorMessage', "");
        // uiManager will pick up urlLoadingErrorMessage

        let filename = "loaded_from_url";
        try {
            const urlPath = new URL(newUrlFromEvent).pathname;
            const lastSegment = urlPath.substring(urlPath.lastIndexOf('/') + 1);
            if (lastSegment) filename = decodeURIComponent(lastSegment);
        } catch (urlError) {
            filename = newUrlFromEvent; // Use full URL if parsing fails
        }

        resetAudioStateAndUI(filename, newUrlFromEvent !== previousDisplayUrl, true);
        AudioApp.uiManager.setAudioUrlInputValue(newUrlFromEvent);

        try {
            AudioApp.state.updateStatus('fileInfoMessage', `Fetching: ${filename}...`);
            const response = await fetch(newUrlFromEvent);
            if (!response.ok) throw new Error(`Network response was not ok: ${response.status} ${response.statusText}`);

            const arrayBuffer = await response.arrayBuffer();
            AudioApp.state.updateStatus('fileInfoMessage', `Processing: ${filename}...`);

            let mimeType = response.headers.get('Content-Type')?.split(';')[0] || 'audio/*';
            const ext = filename.substring(filename.lastIndexOf('.') + 1).toLowerCase();
            if (mimeType === 'application/octet-stream' || mimeType === 'audio/*') {
                if (ext === 'mp3') mimeType = 'audio/mpeg';
                else if (ext === 'wav') mimeType = 'audio/wav';
                else if (ext === 'ogg') mimeType = 'audio/ogg';
            }

            const newFileObject = new File([arrayBuffer], filename, {type: mimeType});
            AudioApp.state.updateRuntime('currentFile', newFileObject);

            await AudioApp.audioEngine.loadAndProcessFile(newFileObject); // audioEngine will get currentFile from AppState
            AudioApp.state.updateStatus('urlInputStyle', 'success');
            AudioApp.uiManager.setUrlInputStyle('success'); // Keep UI in sync immediately
            if(debouncedUpdateUrlHash) debouncedUpdateUrlHash();
        } catch (error) {
            console.error(`App: Error fetching/processing URL ${newUrlFromEvent}:`, error);
            AudioApp.uiManager.resetUI();
            AudioApp.state.updateStatus('urlInputStyle', 'error');
            AudioApp.uiManager.setAudioUrlInputValue(newUrlFromEvent);
            AudioApp.uiManager.setUrlInputStyle('error');
            AudioApp.state.updateStatus('urlLoadingErrorMessage', `Error loading from URL. (${error?.message?.substring(0, 100) || 'Unknown error'})`);
            AudioApp.state.updateStatus('fileInfoMessage', "Failed to load audio from URL.");
            AudioApp.spectrogramVisualizer.showSpinner(false);
            stopUIUpdateLoop();
            AudioApp.state.updateRuntime('currentFile', null);
        }
    }

    /**
     * Resets audio-related state and parts of the UI.
     * @private
     * @param {string} displayName - The name to display for the file/URL.
     * @param {boolean} fullUIRestart - Whether to perform a full UI reset or a partial one.
     * @param {boolean} [isUrl=false] - Indicates if loading from a URL.
     */
    function resetAudioStateAndUI(displayName, fullUIRestart, isUrl = false) {
        stopUIUpdateLoop();
        AudioApp.state.updateStatus('isActuallyPlaying', false);
        AudioApp.state.updateStatus('playbackNaturallyEnded', false);
        AudioApp.state.updateStatus('isVadProcessing', false); // Should also cancel any ongoing VAD
        AudioApp.state.updateRuntime('playbackStartTimeContext', null);
        AudioApp.state.updateRuntime('playbackStartSourceTime', 0.0);
        AudioApp.state.updateRuntime('currentSpeedForUpdate', 1.0);
        AudioApp.state.updateRuntime('currentAudioBuffer', null);
        AudioApp.state.updateRuntime('currentVadResults', null);
        AudioApp.state.updateStatus('workletPlaybackReady', false);

        if (!isUrl) AudioApp.state.updateRuntime('currentFile', null);

        if (fullUIRestart) {
            AudioApp.uiManager.resetUI(); // This will reset UI to AppState defaults eventually
        } else {
            // Partial reset: preserve speed/pitch/gain from AppState, reset time, VAD text, etc.
            AudioApp.uiManager.updateTimeDisplay(0, 0);
            AudioApp.uiManager.updateSeekBar(0);
            AudioApp.uiManager.setSpeechRegionsText("None"); // Or derive from state if needed
            AudioApp.uiManager.showVadProgress(false);
            AudioApp.uiManager.updateVadProgress(0);
            AudioApp.state.updateStatus('urlLoadingErrorMessage', "");
        }
        // These UI updates should eventually be driven by AppState subscriptions
        AudioApp.uiManager.updateFileName(displayName);
        AudioApp.state.updateStatus('fileInfoMessage', `Loading: ${displayName}...`);
        AudioApp.uiManager.setAudioUrlInputValue(AudioApp.state.params.audioUrl || "");
        AudioApp.uiManager.setUrlInputStyle(AudioApp.state.status.urlInputStyle);

        AudioApp.waveformVisualizer.clearVisuals();
        AudioApp.spectrogramVisualizer.clearVisuals();
        AudioApp.spectrogramVisualizer.showSpinner(true);

        if(debouncedUpdateUrlHash) debouncedUpdateUrlHash();
    }


    /**
     * Handles audio decoding completion.
     * This is the central point for kicking off all parallel analysis tasks.
     * @private
     * @param {CustomEvent<{audioBuffer: AudioBuffer}>} e - The event object.
     */
    async function handleAudioLoaded(e) {
        AudioApp.state.updateRuntime('currentAudioBuffer', e.detail.audioBuffer);
        const audioBuffer = AudioApp.state.runtime.currentAudioBuffer;
        console.log(`App: Audio decoded (${audioBuffer.duration.toFixed(2)}s). Starting parallel analysis.`);

        // --- 1. Basic UI Setup (Instant) ---
        AudioApp.uiManager.updateTimeDisplay(0, audioBuffer.duration);
        AudioApp.uiManager.updateSeekBar(0);
        AudioApp.waveformVisualizer.updateProgressIndicator(0, audioBuffer.duration);
        AudioApp.spectrogramVisualizer.updateProgressIndicator(0, audioBuffer.duration);
        AudioApp.state.updateRuntime('playbackStartSourceTime', 0.0);


        // Apply current AppState params to the engine
        if (AudioApp.audioEngine) {
            AudioApp.audioEngine.setSpeed(AudioApp.state.params.speed);
            AudioApp.audioEngine.setPitch(AudioApp.state.params.pitch);
            AudioApp.audioEngine.setGain(AudioApp.state.params.gain);
        }

        // --- 2. Draw Waveform First (Fastest visual feedback) ---
        await AudioApp.waveformVisualizer.computeAndDrawWaveform(audioBuffer, []);

        // --- 3. Launch All Long-Running Tasks Concurrently ---
        console.log("App: Kicking off Spectrogram, VAD, and Tone analysis in parallel.");

        // A. Start Spectrogram Worker
        AudioApp.spectrogramVisualizer.computeAndDrawSpectrogram(audioBuffer);

        // B. Start VAD Analysis
        runVadInBackground(audioBuffer);

        // C. Start Tone Detection Analysis
        if (dtmfParser || cptParser) {
            processAudioForTones(audioBuffer);
        }

        // --- 4. Update File Info ---
        AudioApp.state.updateStatus('fileInfoMessage', `Processing Analyses: ${AudioApp.state.runtime.currentFile?.name || AudioApp.state.params.audioUrl || 'Loaded Audio'}`);


        // If a local file was loaded, ensure its "file:///" URL is displayed correctly.
        if (AudioApp.state.runtime.currentFile && AudioApp.state.params.audioUrl && AudioApp.state.status.urlInputStyle === 'file') {
            AudioApp.uiManager.setAudioUrlInputValue(AudioApp.state.params.audioUrl);
            AudioApp.uiManager.setUrlInputStyle('file');
        }
    }

    /**
     * Handles the 'audioapp:workletReady' event. Enables playback controls.
     * @private
     * @param {CustomEvent} e - The event object.
     */
    function handleWorkletReady(e) {
        console.log("App: AudioWorklet processor is ready.");
        AudioApp.state.updateStatus('workletPlaybackReady', true);
        AudioApp.uiManager.enablePlaybackControls(true);
        AudioApp.uiManager.enableSeekBar(true);
        AudioApp.state.updateStatus('fileInfoMessage', `Ready: ${AudioApp.state.runtime.currentFile?.name || AudioApp.state.params.audioUrl || 'Loaded Audio'}`);
        AudioApp.uiManager.unfocusUrlInput();

        // Re-affirm engine parameters from AppState
        if (AudioApp.audioEngine) {
            AudioApp.audioEngine.setSpeed(AudioApp.state.params.speed);
            AudioApp.audioEngine.setPitch(AudioApp.state.params.pitch);
            AudioApp.audioEngine.setGain(AudioApp.state.params.gain);
        }

        // Apply position from hash settings if available and audio buffer exists
        const audioBuffer = AudioApp.state.runtime.currentAudioBuffer;
        if (initialHashSettings.position !== undefined && audioBuffer) {
            const targetTime = Math.max(0, Math.min(initialHashSettings.position, audioBuffer.duration));
            console.log(`App: Restoring position from hash: ${targetTime.toFixed(3)}s`);
            AudioApp.audioEngine.seek(targetTime);
            AudioApp.state.updateRuntime('playbackStartSourceTime', targetTime);
            AudioApp.state.updateRuntime('playbackStartTimeContext', null); // Not playing yet
            updateUIWithTime(targetTime); // Update UI immediately
        }
        initialHashSettings = {}; // Clear after use, AppState now holds the applied values
    }

    /**
     * Runs VAD analysis in the background. (REFACTORED)
     * @private
     * @param {AudioBuffer} audioBuffer - The audio buffer to analyze.
     * @returns {Promise<void>}
     */
    async function runVadInBackground(audioBuffer) { // audioBuffer is from AppState.runtime.currentAudioBuffer
        if (!audioBuffer || !AudioApp.vadAnalyzer || !AudioApp.audioEngine || !AudioApp.uiManager || !AudioApp.waveformVisualizer) {
            console.error("App (VAD): Missing dependencies for VAD task.");
            AudioApp.state.updateStatus('isVadProcessing', false);
            return;
        }
        if (AudioApp.state.status.isVadProcessing) {
            console.warn("App (VAD): Processing already running.");
            return;
        }

        AudioApp.state.updateStatus('isVadProcessing', true);

        try {
            await AudioApp.vadAnalyzer.init(); // Ensures worker is ready

            AudioApp.uiManager.showVadProgress(true); // Immediate UI feedback
            AudioApp.uiManager.updateVadProgress(0);
            const pcm16k = await AudioApp.audioEngine.resampleTo16kMono(audioBuffer);

            if (!pcm16k || pcm16k.length === 0) {
                AudioApp.uiManager.setSpeechRegionsText("No VAD data (empty audio?)"); // UI feedback
                AudioApp.uiManager.updateVadProgress(100);
                AudioApp.state.updateStatus('isVadProcessing', false);
                return;
            }

            const vadProgressCallback = (progress) => {
                if (!AudioApp.uiManager) return;
                const percentage = progress.totalFrames > 0 ? (progress.processedFrames / progress.totalFrames) * 100 : 0;
                AudioApp.uiManager.updateVadProgress(percentage);
            };

            const vadResults = await AudioApp.vadAnalyzer.analyze(pcm16k, {
                onProgress: vadProgressCallback,
                // Pass current thresholds from AppState
                positiveSpeechThreshold: AudioApp.state.params.vadPositive,
                negativeSpeechThreshold: AudioApp.state.params.vadNegative
            });
            AudioApp.state.updateRuntime('currentVadResults', vadResults);

            const speechRegions = vadResults.regions || [];
            AudioApp.uiManager.updateVadDisplay(vadResults.initialPositiveThreshold, vadResults.initialNegativeThreshold);
            AudioApp.uiManager.setSpeechRegionsText(speechRegions);
            AudioApp.waveformVisualizer.redrawWaveformHighlight(audioBuffer, speechRegions); // audioBuffer is still valid here
            AudioApp.uiManager.updateVadProgress(100);

        } catch (error) {
            console.error("App (VAD): Error during VAD processing -", error);
            AudioApp.state.updateStatus('fileInfoMessage', `VAD Error: ${error?.message || 'Unknown error'}`);
            AudioApp.uiManager.updateVadProgress(0);
            AudioApp.state.updateRuntime('currentVadResults', null);
        } finally {
            AudioApp.state.updateStatus('isVadProcessing', false);
        }
    }

    /**
     * Resamples audio and processes it for DTMF and Call Progress Tones.
     * @private
     * @param {AudioBuffer} audioBuffer - The audio buffer to process.
     * @returns {Promise<void>}
     */
    async function processAudioForTones(audioBuffer) {
        if (!audioBuffer || !AudioApp.audioEngine || !AudioApp.uiManager || (!dtmfParser && !cptParser)) {
            console.warn("App (Tones): Missing dependencies or parsers for tone processing.");
            return;
        }
        const pcmSampleRate = Constants.DTMF.SAMPLE_RATE; // Use new Constants
        const pcmBlockSize = Constants.DTMF.BLOCK_SIZE;   // Use new Constants
        /** @type {Float32Array|null} */ let pcmData = null;

        try {
            pcmData = await AudioApp.audioEngine.resampleTo16kMono(audioBuffer);
            if (!pcmData || pcmData.length === 0) {
                if (dtmfParser) AudioApp.uiManager.updateDtmfDisplay("DTMF: No audio data.");
                if (cptParser) AudioApp.uiManager.updateCallProgressTonesDisplay(["CPT: No audio data."]);
                return;
            }
        } catch (error) {
            if (dtmfParser) AudioApp.uiManager.updateDtmfDisplay(`DTMF Error: ${error?.message?.substring(0, 100) || 'Resample error'}`);
            if (cptParser) AudioApp.uiManager.updateCallProgressTonesDisplay([`CPT Error: ${error?.message?.substring(0, 100) || 'Resample error'}`]);
            return;
        }

        if (dtmfParser) {
            AudioApp.uiManager.updateDtmfDisplay("Processing DTMF...");
            try {
                /** @type {string[]} */ const detectedDtmfTones = [];
                /** @type {string|null} */ let lastDetectedDtmf = null;
                let consecutiveDtmfDetections = 0;
                const minConsecutiveDtmf = 2; // Require a tone to be present for at least 2 blocks

                for (let i = 0; (i + pcmBlockSize) <= pcmData.length; i += pcmBlockSize) {
                    const audioBlock = pcmData.subarray(i, i + pcmBlockSize);
                    const tone = dtmfParser.processAudioBlock(audioBlock);
                    if (tone) {
                        if (tone === lastDetectedDtmf) {
                            consecutiveDtmfDetections++;
                        } else {
                            lastDetectedDtmf = tone;
                            consecutiveDtmfDetections = 1;
                        }
                        if (consecutiveDtmfDetections === minConsecutiveDtmf) {
                            // Add tone only once when it's confirmed, and only if it's different from the last added tone
                            if (detectedDtmfTones.length === 0 || detectedDtmfTones[detectedDtmfTones.length - 1] !== tone) {
                                detectedDtmfTones.push(tone);
                            }
                        }
                    } else {
                        lastDetectedDtmf = null; // Reset if no tone or different tone
                        consecutiveDtmfDetections = 0;
                    }
                }
                AudioApp.uiManager.updateDtmfDisplay(detectedDtmfTones.length > 0 ? detectedDtmfTones : "No DTMF detected.");
            } catch (error) {
                AudioApp.uiManager.updateDtmfDisplay(`DTMF Error: ${error?.message?.substring(0, 100) || 'Processing error'}`);
            }
        }

        if (cptParser) {
            AudioApp.uiManager.updateCallProgressTonesDisplay(["Processing CPTs..."]);
            try {
                /** @type {Set<string>} */ const detectedCptSet = new Set();
                for (let i = 0; (i + pcmBlockSize) <= pcmData.length; i += pcmBlockSize) {
                    const audioBlock = pcmData.subarray(i, i + pcmBlockSize);
                    const toneName = cptParser.processAudioBlock(audioBlock);
                    if (toneName) detectedCptSet.add(toneName);
                }
                AudioApp.uiManager.updateCallProgressTonesDisplay(detectedCptSet.size > 0 ? Array.from(detectedCptSet) : ["No CPTs detected."]);
            } catch (error) {
                AudioApp.uiManager.updateCallProgressTonesDisplay([`CPT Error: ${error?.message?.substring(0, 100) || 'Processing error'}`]);
            }
        }
    }

    /**
     * Handles generic audio errors from the engine or processing stages.
     * @private
     * @param {CustomEvent<{type?: string, error: Error}>} e - The event object.
     */
    function handleAudioError(e) {
        const errorType = e.detail.type || 'Unknown Error';
        const errorMessage = e.detail.error?.message || 'An unknown error occurred';
        console.error(`App: Audio Error - Type: ${errorType}, Message: ${errorMessage}`, e.detail.error);
        stopUIUpdateLoop();
        AudioApp.state.updateStatus('fileInfoMessage', `Error (${errorType}): ${errorMessage.substring(0, 100)}`);
        AudioApp.uiManager.resetUI(); // Resets UI components
        AudioApp.waveformVisualizer?.clearVisuals();
        AudioApp.spectrogramVisualizer?.clearVisuals();
        AudioApp.spectrogramVisualizer?.showSpinner(false);

        AudioApp.state.updateRuntime('currentAudioBuffer', null);
        AudioApp.state.updateRuntime('currentVadResults', null);
        AudioApp.state.updateRuntime('currentFile', null);
        AudioApp.state.updateStatus('workletPlaybackReady', false);
        AudioApp.state.updateStatus('isActuallyPlaying', false);
        AudioApp.state.updateStatus('isVadProcessing', false);
        AudioApp.state.updateRuntime('playbackStartTimeContext', null);
        AudioApp.state.updateRuntime('playbackStartSourceTime', 0.0);
        AudioApp.state.updateRuntime('currentSpeedForUpdate', 1.0);
    }

    /**
     * Handles play/pause button clicks. Manages playback state and UI synchronization.
     * @private
     */
    function handlePlayPause() {
        if (!AudioApp.state.status.workletPlaybackReady || !AudioApp.audioEngine) {
            console.warn("App: Play/Pause ignored - Engine/Worklet not ready.");
            return;
        }
        const audioCtx = AudioApp.audioEngine.getAudioContext();
        if (!audioCtx) {
            console.error("App: Cannot play/pause, AudioContext not available.");
            return;
        }

        const aboutToPlay = !AudioApp.state.status.isActuallyPlaying;

        if (!aboutToPlay) { // Requesting Pause
            AudioApp.state.updateStatus('playbackNaturallyEnded', false);
            const finalEstimatedTime = calculateEstimatedSourceTime();
            AudioApp.audioEngine.seek(finalEstimatedTime);
            AudioApp.state.updateRuntime('playbackStartSourceTime', finalEstimatedTime);
            AudioApp.state.updateRuntime('playbackStartTimeContext', null);
            stopUIUpdateLoop();
            updateUIWithTime(finalEstimatedTime);
            if(debouncedUpdateUrlHash) debouncedUpdateUrlHash();
        }
        // For play, time base and UI loop are handled in 'playbackStateChanged' (event from audioEngine)
        AudioApp.audioEngine.togglePlayPause(); // Request engine to toggle state
        // Note: isActuallyPlaying status will be updated by 'playbackStateChanged' event from audioEngine
    }

    /**
     * Handles jump (forward/backward) button clicks.
     * @private
     * @param {CustomEvent<{seconds: number}>} e - The event object.
     */
    function handleJump(e) {
        AudioApp.state.updateStatus('playbackNaturallyEnded', false);
        const audioBuffer = AudioApp.state.runtime.currentAudioBuffer;
        if (!AudioApp.state.status.workletPlaybackReady || !audioBuffer || !AudioApp.audioEngine) return;

        const audioCtx = AudioApp.audioEngine.getAudioContext();
        if (!audioCtx) return;
        const duration = audioBuffer.duration;
        if (isNaN(duration) || duration <= 0) return;

        const currentTime = calculateEstimatedSourceTime();
        const targetTime = Math.max(0, Math.min(currentTime + e.detail.seconds, duration));
        AudioApp.audioEngine.seek(targetTime);
        AudioApp.state.updateRuntime('playbackStartSourceTime', targetTime);
        if (AudioApp.state.status.isActuallyPlaying) {
            AudioApp.state.updateRuntime('playbackStartTimeContext', audioCtx.currentTime);
        } else {
            AudioApp.state.updateRuntime('playbackStartTimeContext', null);
            updateUIWithTime(targetTime);
        }
        if(debouncedUpdateUrlHash) debouncedUpdateUrlHash();
    }

    /**
     * Handles seek requests from UI elements (e.g., spectrogram click, seek bar input).
     * @private
     * @param {CustomEvent<{fraction: number}>} e - The event object.
     */
    function handleSeek(e) {
        AudioApp.state.updateStatus('playbackNaturallyEnded', false);
        const audioBuffer = AudioApp.state.runtime.currentAudioBuffer;
        if (!AudioApp.state.status.workletPlaybackReady || !audioBuffer || isNaN(audioBuffer.duration) || audioBuffer.duration <= 0 || !AudioApp.audioEngine) return;

        const audioCtx = AudioApp.audioEngine.getAudioContext();
        if (!audioCtx) return;

        const targetTime = e.detail.fraction * audioBuffer.duration;
        AudioApp.audioEngine.seek(targetTime);
        AudioApp.state.updateRuntime('playbackStartSourceTime', targetTime);
        if (AudioApp.state.status.isActuallyPlaying) {
            AudioApp.state.updateRuntime('playbackStartTimeContext', audioCtx.currentTime);
        } else {
            AudioApp.state.updateRuntime('playbackStartTimeContext', null);
            updateUIWithTime(targetTime);
        }
        if(debouncedUpdateUrlHash) debouncedUpdateUrlHash();
    }

    /** Alias for handleSeek, used by seek bar 'input' event. @private */
    const handleSeekBarInput = handleSeek;

    /**
     * Handles speed changes from the UI slider.
     * @private
     * @param {CustomEvent<{speed: number}>} e - The event object.
     */
    function handleSpeedChange(e) {
        AudioApp.state.updateParam('speed', e.detail.speed);
        // audioEngine will subscribe to 'param:speed:changed'
        if (debouncedSyncEngine) debouncedSyncEngine(); // Sync engine after a short delay if still needed
        if(debouncedUpdateUrlHash) debouncedUpdateUrlHash();
    }

    /**
     * Handles pitch changes from the UI slider.
     * @private
     * @param {CustomEvent<{pitch: number}>} e - The event object.
     */
    function handlePitchChange(e) {
        AudioApp.state.updateParam('pitch', e.detail.pitch);
        // audioEngine will subscribe to 'param:pitch:changed'
        if(debouncedUpdateUrlHash) debouncedUpdateUrlHash();
    }

    /**
     * Handles gain changes from the UI slider.
     * @private
     * @param {CustomEvent<{gain: number}>} e - The event object.
     */
    function handleGainChange(e) {
        AudioApp.state.updateParam('gain', e.detail.gain);
        // audioEngine will subscribe to 'param:gain:changed'
        if(debouncedUpdateUrlHash) debouncedUpdateUrlHash();
    }

    /**
     * Synchronizes the audio engine's current time to the main thread's estimated time.
     * Called debounced after speed changes.
     * @private
     */
    function syncEngineToEstimatedTime() { // This logic might need re-evaluation with AppState
        const audioBuffer = AudioApp.state.runtime.currentAudioBuffer;
        if (!AudioApp.state.status.workletPlaybackReady || !audioBuffer || !AudioApp.audioEngine) return;

        const audioCtx = AudioApp.audioEngine.getAudioContext();
        if (!audioCtx) return;

        const targetTime = calculateEstimatedSourceTime();
        AudioApp.audioEngine.seek(targetTime);
        AudioApp.state.updateRuntime('playbackStartSourceTime', targetTime);
        if (AudioApp.state.status.isActuallyPlaying) {
            AudioApp.state.updateRuntime('playbackStartTimeContext', audioCtx.currentTime);
        } else {
            AudioApp.state.updateRuntime('playbackStartTimeContext', null);
            updateUIWithTime(targetTime);
        }
    }

    /**
     * Handles internal speed changes confirmed by the audio engine.
     * Adjusts time tracking base to prevent UI jumps.
     * @private
     * @param {CustomEvent<{speed: number}>} e - The event object.
     */
    function handleInternalSpeedChange(e) {
        const newSpeed = e.detail.speed;
        const oldSpeed = AudioApp.state.runtime.currentSpeedForUpdate;
        AudioApp.state.updateRuntime('currentSpeedForUpdate', newSpeed);

        const audioCtx = AudioApp.audioEngine?.getAudioContext();
        if (AudioApp.state.status.isActuallyPlaying && AudioApp.state.runtime.playbackStartTimeContext !== null && audioCtx) {
            const elapsedContextTime = audioCtx.currentTime - AudioApp.state.runtime.playbackStartTimeContext;
            const elapsedSourceTime = elapsedContextTime * oldSpeed;
            const previousSourceTime = AudioApp.state.runtime.playbackStartSourceTime + elapsedSourceTime;
            AudioApp.state.updateRuntime('playbackStartSourceTime', previousSourceTime);
            AudioApp.state.updateRuntime('playbackStartTimeContext', audioCtx.currentTime);
        }
    }

    /**
     * Handles VAD threshold changes from the UI.
     * @private
     * @param {CustomEvent<{type: string, value: number}>} e - The event object.
     */
    function handleThresholdChange(e) {
        const {type, value} = e.detail;
        if (type === 'positive') {
            AudioApp.state.updateParam('vadPositive', value);
        } else if (type === 'negative') {
            AudioApp.state.updateParam('vadNegative', value);
        }

        // Re-drawing waveform highlights based on new VAD thresholds (if results exist)
        const currentVadResults = AudioApp.state.runtime.currentVadResults;
        const currentAudioBuffer = AudioApp.state.runtime.currentAudioBuffer;
        if (currentVadResults && !AudioApp.state.status.isVadProcessing && AudioApp.vadAnalyzer && AudioApp.waveformVisualizer && currentAudioBuffer) {
            const newRegions = AudioApp.vadAnalyzer.recalculateSpeechRegions(currentVadResults.probabilities, {
                frameSamples: currentVadResults.frameSamples,
                sampleRate: currentVadResults.sampleRate,
                positiveSpeechThreshold: AudioApp.state.params.vadPositive,
                negativeSpeechThreshold: AudioApp.state.params.vadNegative,
                redemptionFrames: currentVadResults.redemptionFrames
            });
            AudioApp.uiManager.setSpeechRegionsText(newRegions);
            AudioApp.waveformVisualizer.redrawWaveformHighlight(currentAudioBuffer, newRegions);
        }
        if(debouncedUpdateUrlHash) debouncedUpdateUrlHash();
    }

    /**
     * Handles the 'audioapp:playbackEnded' event from the audio engine.
     * @private
     */
    function handlePlaybackEnded() {
        console.log("App: Playback ended event received.");
        AudioApp.state.updateStatus('isActuallyPlaying', false);
        stopUIUpdateLoop();
        AudioApp.state.updateRuntime('playbackStartTimeContext', null);
        const audioBuffer = AudioApp.state.runtime.currentAudioBuffer;
        if (audioBuffer) {
            AudioApp.state.updateRuntime('playbackStartSourceTime', audioBuffer.duration);
            updateUIWithTime(audioBuffer.duration);
        }
        AudioApp.state.updateStatus('playbackNaturallyEnded', true);
        AudioApp.uiManager.setPlayButtonState(false); // Keep UI in sync
        if(debouncedUpdateUrlHash) debouncedUpdateUrlHash();
    }

    /**
     * Handles playback state changes confirmed by the audio engine.
     * @private
     * @param {CustomEvent<{isPlaying: boolean}>} e - The event object.
     */
    function handlePlaybackStateChange(e) {
        const workletIsPlaying = e.detail.isPlaying;
        const wasPlaying = AudioApp.state.status.isActuallyPlaying;
        AudioApp.state.updateStatus('isActuallyPlaying', workletIsPlaying);
        AudioApp.uiManager.setPlayButtonState(workletIsPlaying); // Keep UI in sync

        if (workletIsPlaying) {
            const audioCtx = AudioApp.audioEngine?.getAudioContext();
            if (!wasPlaying && audioCtx) { // Transitioned from not playing to playing
                const audioBuffer = AudioApp.state.runtime.currentAudioBuffer;
                if (AudioApp.state.status.playbackNaturallyEnded && audioBuffer) {
                    AudioApp.state.updateRuntime('playbackStartSourceTime', 0); // Restart from beginning
                    AudioApp.state.updateStatus('playbackNaturallyEnded', false);
                } else {
                    // Resuming or starting normally, use engine's current time
                    AudioApp.state.updateRuntime('playbackStartSourceTime', AudioApp.audioEngine.getCurrentTime().currentTime);
                }
                AudioApp.state.updateRuntime('playbackStartTimeContext', audioCtx.currentTime);
                updateUIWithTime(AudioApp.state.runtime.playbackStartSourceTime); // Update UI immediately
            }
            startUIUpdateLoop();
        } else { // Transitioned to not playing
            stopUIUpdateLoop();
            AudioApp.state.updateRuntime('playbackStartTimeContext', null);
            // UI time sync for pause is handled in handlePlayPause
        }
    }

    /**
     * Handles global key press events for shortcuts.
     * @private
     * @param {CustomEvent<{key: string}>} e - The event object.
     */
    function handleKeyPress(e) {
        if (!AudioApp.state.status.workletPlaybackReady) return;
        const key = e.detail.key;
        const jumpTimeValue = AudioApp.uiManager.getJumpTime(); // Or AudioApp.state.params.jumpTime
        switch (key) {
            case 'Space':
                handlePlayPause();
                break;
            case 'ArrowLeft':
                handleJump({detail: {seconds: -jumpTimeValue}});
                break;
            case 'ArrowRight':
                handleJump({detail: {seconds: jumpTimeValue}});
                break;
        }
    }

    /**
     * Handles window resize events to redraw visualizations.
     * @private
     */
    function handleWindowResize() {
        const regions = AudioApp.state.runtime.currentVadResults?.regions || [];
        AudioApp.waveformVisualizer?.resizeAndRedraw(AudioApp.state.runtime.currentAudioBuffer, regions);
        AudioApp.spectrogramVisualizer?.resizeAndRedraw(AudioApp.state.runtime.currentAudioBuffer);
    }

    /**
     * Handles the 'beforeunload' event to clean up resources.
     * @private
     */
    function handleBeforeUnload() {
        console.log("App: Unloading...");
        stopUIUpdateLoop();
        AudioApp.audioEngine?.cleanup();
    }


    /**
     * Starts the UI update loop using requestAnimationFrame.
     * @private
     */
    function startUIUpdateLoop() {
        if (rAFUpdateHandle === null) {
            rAFUpdateHandle = requestAnimationFrame(updateUIBasedOnContextTime);
        }
    }

    /**
     * Stops the UI update loop.
     * @private
     */
    function stopUIUpdateLoop() {
        if (rAFUpdateHandle !== null) {
            cancelAnimationFrame(rAFUpdateHandle);
            rAFUpdateHandle = null;
        }
    }

    /**
     * Calculates the estimated current source time based on AudioContext time and playback speed.
     * @private
     * @returns {number} The estimated current time in seconds within the audio source.
     */
    function calculateEstimatedSourceTime() {
        const audioCtx = AudioApp.audioEngine?.getAudioContext();
        const audioBuffer = AudioApp.state.runtime.currentAudioBuffer;
        const duration = audioBuffer ? audioBuffer.duration : 0;

        if (!AudioApp.state.status.isActuallyPlaying || AudioApp.state.runtime.playbackStartTimeContext === null ||
            !audioCtx || !audioBuffer || duration <= 0 || AudioApp.state.runtime.currentSpeedForUpdate <= 0) {
            return AudioApp.state.runtime.playbackStartSourceTime;
        }

        const elapsedContextTime = audioCtx.currentTime - AudioApp.state.runtime.playbackStartTimeContext;
        const elapsedSourceTime = elapsedContextTime * AudioApp.state.runtime.currentSpeedForUpdate;
        let estimatedCurrentSourceTime = AudioApp.state.runtime.playbackStartSourceTime + elapsedSourceTime;
        return Math.max(0, Math.min(estimatedCurrentSourceTime, duration));
    }

    /**
     * Updates UI elements related to time (display, seek bar, visualizer progress).
     * @private
     * @param {number} time - The current source time to display.
     */
    function updateUIWithTime(time) {
        const audioBuffer = AudioApp.state.runtime.currentAudioBuffer;
        const duration = audioBuffer ? audioBuffer.duration : 0;
        if (isNaN(duration)) return;

        const clampedTime = Math.max(0, Math.min(time, duration));
        const fraction = duration > 0 ? clampedTime / duration : 0;

        AudioApp.uiManager.updateTimeDisplay(clampedTime, duration);
        AudioApp.uiManager.updateSeekBar(fraction); // SeekBar input will dispatch seekRequested
        AudioApp.waveformVisualizer?.updateProgressIndicator(clampedTime, duration);
        AudioApp.spectrogramVisualizer?.updateProgressIndicator(clampedTime, duration);
    }

    /**
     * The main UI update loop function, called via requestAnimationFrame.
     * Calculates estimated time and updates UI elements. Also handles periodic hash updates.
     * @private
     * @param {DOMHighResTimeStamp} timestamp - The timestamp provided by requestAnimationFrame.
     */
    function updateUIBasedOnContextTime(timestamp) {
        if (!AudioApp.state.status.isActuallyPlaying) {
            rAFUpdateHandle = null;
            return; // Stop loop if not playing
        }
        const estimatedTime = calculateEstimatedSourceTime();
        updateUIWithTime(estimatedTime);

        // Debounced hash update is handled by specific actions (play, pause, seek, param change)
        // The periodic update might be less necessary or adjusted. For now, let debounced calls handle it.
        // const currentTime = performance.now();
        // if (currentTime - lastHashUpdateTime > 3000 && debouncedUpdateUrlHash) {
        //     debouncedUpdateUrlHash();
        //     lastHashUpdateTime = currentTime;
        // }
        rAFUpdateHandle = requestAnimationFrame(updateUIBasedOnContextTime);
    }

    /**
     * @typedef {Object} AppPublicInterface
     * @property {function(): void} init - Initializes the application.
     */

    /** @type {AppPublicInterface} */
    return {
        init: init
    };
})();
// --- /vibe-player/js/app.js ---
