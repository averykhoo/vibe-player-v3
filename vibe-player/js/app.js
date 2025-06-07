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

    /** @type {HashSettings} Stores settings parsed from the URL hash. */
    let initialHashSettings = {};
    /** @type {number} Timestamp of the last URL hash update. */
    let lastHashUpdateTime = 0;

    // Constants for URL hash parameters
    /** @const @private @type {string} */ const HASH_PARAM_SPEED = 's';
    /** @const @private @type {string} */ const HASH_PARAM_PITCH = 'p';
    /** @const @private @type {string} */ const HASH_PARAM_VAD_POSITIVE = 'vp';
    /** @const @private @type {string} */ const HASH_PARAM_VAD_NEGATIVE = 'vn';
    /** @const @private @type {string} */ const HASH_PARAM_VOLUME = 'v';
    /** @const @private @type {string} */ const HASH_PARAM_AUDIO_URL = 'url';
    /** @const @private @type {string} */ const HASH_PARAM_POSITION = 't';

    /**
     * @private
     * @type {AudioApp.Utils} Reference to the Utils module.
     */
    const Utils = AudioApp.Utils;

    // --- Application State ---
    /** @type {AudioBuffer|null} The currently loaded and decoded audio buffer. */
    let currentAudioBuffer = null;
    /** @type {string|null} The URL to display in the input field (can be a remote URL or a "file:///" local path). */
    let currentDisplayUrl = null;
    /** @type {'default'|'success'|'error'|'file'|'modified'} The style to apply to the URL input field. */
    let currentUrlStyle = 'default';
    /** @type {VadResult|null} Results from the VAD analysis. */
    let currentVadResults = null;
    /** @type {File|null} The currently loaded audio file object (if loaded from disk or drag-and-drop). */
    let currentFile = null;
    /** @type {boolean} Flag indicating if the Silero VAD model is loaded and ready. */
    let vadModelReady = false;
    /** @type {boolean} Flag indicating if the AudioWorklet processor is loaded and ready for playback commands. */
    let workletPlaybackReady = false;
    /** @type {boolean} Flag indicating if the background VAD task is currently running. */
    let isVadProcessing = false;
    /** @type {number} Counter for drag enter/leave events to manage drop zone visibility. */
    let dragCounter = 0;
    /** @type {AudioApp.DTMFParser|null} The DTMF parser instance. */
    let dtmfParser = null;
    /** @type {AudioApp.CallProgressToneParser|null} The Call Progress Tone parser instance. */
    let cptParser = null;

    // --- Main Thread Playback Time State ---
    /** @type {number|null} AudioContext time (in seconds) when playback/seek started. Null if paused. */
    let playbackStartTimeContext = null;
    /** @type {number} Source time (in seconds within the audioBuffer) when playback/seek started. */
    let playbackStartSourceTime = 0.0;
    /** @type {boolean} Tracks if the audio engine is confirmed to be in a playing state. */
    let isActuallyPlaying = false;
    /** @type {number|null} Handle for the requestAnimationFrame UI update loop. Null if not running. */
    let rAFUpdateHandle = null;
    /** @type {number} Current playback speed factor used for UI time estimation. */
    let currentSpeedForUpdate = 1.0;
    /** @type {boolean} Flag indicating if playback ended naturally (reached end of audio). */
    let playbackNaturallyEnded = false;

    // --- Debounced Functions ---
    /** @type {Function|null} Debounced function for synchronizing the audio engine after speed changes. */
    let debouncedSyncEngine = null;
    /** @const @private @type {number} Debounce wait time in milliseconds for engine sync. */
    const SYNC_DEBOUNCE_WAIT_MS = 300;

    /** @const @private @type {number} Debounce wait time in milliseconds for URL hash updates. */
    const DEBOUNCE_HASH_UPDATE_MS = 500;
    /** @type {Function|null} Debounced function for updating the URL hash from current settings. */
    let debouncedUpdateHashFromSettings = null;

    /**
     * Parses application settings from the URL hash.
     * @private
     * @returns {HashSettings} An object containing the parsed settings.
     */
    function parseSettingsFromHash() {
        /** @type {HashSettings} */
        const settings = {};
        const hash = window.location.hash.substring(1);
        if (!hash) return settings;

        const params = new URLSearchParams(hash);

        const speed = params.get(HASH_PARAM_SPEED);
        if (speed !== null && !isNaN(parseFloat(speed))) settings.speed = parseFloat(speed);

        const pitch = params.get(HASH_PARAM_PITCH);
        if (pitch !== null && !isNaN(parseFloat(pitch))) settings.pitch = parseFloat(pitch);

        const vadPositive = params.get(HASH_PARAM_VAD_POSITIVE);
        if (vadPositive !== null && !isNaN(parseFloat(vadPositive))) settings.vadPositive = parseFloat(vadPositive);

        const vadNegative = params.get(HASH_PARAM_VAD_NEGATIVE);
        if (vadNegative !== null && !isNaN(parseFloat(vadNegative))) settings.vadNegative = parseFloat(vadNegative);

        const volume = params.get(HASH_PARAM_VOLUME);
        if (volume !== null && !isNaN(parseFloat(volume))) settings.volume = parseFloat(volume);

        const audioUrl = params.get(HASH_PARAM_AUDIO_URL);
        if (audioUrl !== null && audioUrl !== '') settings.audioUrl = audioUrl;

        const position = params.get(HASH_PARAM_POSITION);
        if (position !== null && !isNaN(parseFloat(position))) settings.position = parseFloat(position);

        console.log('App: Parsed settings from hash:', settings);
        return settings;
    }

    /**
     * Updates the URL hash based on the current application settings.
     * @private
     */
    function updateHashFromSettings() {
        if (!AudioApp.uiManager) return;

        const params = new URLSearchParams();
        let newHash = '';

        try {
            const speed = AudioApp.uiManager.getPlaybackSpeedValue();
            if (speed !== 1.0) params.set(HASH_PARAM_SPEED, speed.toFixed(2));

            const pitch = AudioApp.uiManager.getPitchValue();
            if (pitch !== 1.0) params.set(HASH_PARAM_PITCH, pitch.toFixed(2));

            const vadPositive = AudioApp.uiManager.getVadPositiveThresholdValue();
            if (vadPositive !== 0.5) params.set(HASH_PARAM_VAD_POSITIVE, vadPositive.toFixed(2));

            const vadNegative = AudioApp.uiManager.getVadNegativeThresholdValue();
            if (vadNegative !== 0.35) params.set(HASH_PARAM_VAD_NEGATIVE, vadNegative.toFixed(2));

            const volume = AudioApp.uiManager.getGainValue();
            if (volume !== 1.0) params.set(HASH_PARAM_VOLUME, volume.toFixed(2));

            if (currentDisplayUrl !== null && currentDisplayUrl !== '') {
                params.set(HASH_PARAM_AUDIO_URL, currentDisplayUrl);
            }

            const position = calculateEstimatedSourceTime();
            if (position > 0) { // Save position if it's greater than 0
                params.set(HASH_PARAM_POSITION, position.toFixed(2));
            }

            newHash = params.toString();

            if (newHash) {
                // Using replaceState to avoid flooding browser history during playback.
                // For more persistent hash updates (e.g., on pause or explicit share),
                // window.location.hash might be preferred.
                history.replaceState(null, '', `#${newHash}`);
            } else {
                history.replaceState(null, '', window.location.pathname + window.location.search);
            }
        } catch (e) {
            console.warn('App: Error updating hash from settings.', e);
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
            !AudioApp.spectrogramVisualizer || !AudioApp.vadAnalyzer ||
            !AudioApp.Constants || !AudioApp.Utils || !AudioApp.DTMFParser || !AudioApp.CallProgressToneParser) {
            console.error("AudioApp: CRITICAL - One or more required modules not found! Check script loading order.");
            AudioApp.uiManager?.setFileInfo("Initialization Error: Missing modules. Check console.");
            return;
        }

        debouncedSyncEngine = AudioApp.Utils.debounce(syncEngineToEstimatedTime, SYNC_DEBOUNCE_WAIT_MS);
        debouncedUpdateHashFromSettings = AudioApp.Utils.debounce(updateHashFromSettings, DEBOUNCE_HASH_UPDATE_MS);

        AudioApp.uiManager.init();
        setupAppEventListeners();
        initialHashSettings = parseSettingsFromHash();

        // Apply settings from hash before loading audio
        if (initialHashSettings.speed !== undefined) AudioApp.uiManager.setPlaybackSpeedValue(initialHashSettings.speed);
        if (initialHashSettings.pitch !== undefined) AudioApp.uiManager.setPitchValue(initialHashSettings.pitch);
        if (initialHashSettings.volume !== undefined) AudioApp.uiManager.setGainValue(initialHashSettings.volume);
        if (initialHashSettings.vadPositive !== undefined) AudioApp.uiManager.setVadPositiveThresholdValue(initialHashSettings.vadPositive);
        if (initialHashSettings.vadNegative !== undefined) AudioApp.uiManager.setVadNegativeThresholdValue(initialHashSettings.vadNegative);
        // Engine speed/pitch/gain will be set after audio is loaded or worklet is ready.

        if (initialHashSettings.audioUrl) {
            console.log("App: Applying audioUrl from hash:", initialHashSettings.audioUrl);
            currentDisplayUrl = initialHashSettings.audioUrl; // Store it
            AudioApp.uiManager.setAudioUrlInputValue(currentDisplayUrl);

            if (initialHashSettings.audioUrl.startsWith('file:///')) {
                currentUrlStyle = 'error'; // Cannot auto-reload local files
                AudioApp.uiManager.setUrlInputStyle(currentUrlStyle);
                AudioApp.uiManager.setUrlLoadingError("Local files cannot be automatically reloaded from the URL. Please re-select the file.");
            } else {
                AudioApp.uiManager.setUrlInputStyle('modified'); // Indicate it's from hash, about to load
                document.dispatchEvent(new CustomEvent('audioapp:urlSelected', {detail: {url: currentDisplayUrl}}));
            }
        }

        setTimeout(() => {
            AudioApp.uiManager?.unfocusUrlInput();
        }, 100);

        AudioApp.audioEngine.init();
        AudioApp.waveformVisualizer.init();
        AudioApp.spectrogramVisualizer.init(() => currentAudioBuffer);

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

        const previousDisplayUrl = currentDisplayUrl;
        const newDisplayUrl = 'file:///' + file.name; // For display purposes

        currentFile = file;
        currentDisplayUrl = newDisplayUrl;
        currentUrlStyle = 'file';

        console.log("App: File selected -", file.name);
        resetAudioStateAndUI(file.name, newDisplayUrl !== previousDisplayUrl);

        try {
            await AudioApp.audioEngine.loadAndProcessFile(file);
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
        const previousDisplayUrl = currentDisplayUrl;

        currentDisplayUrl = newUrlFromEvent;
        currentUrlStyle = 'default'; // Initial style while loading

        if (!currentDisplayUrl) {
            console.warn("App: URL selected event received, but URL is empty.");
            AudioApp.uiManager.setAudioUrlInputValue("");
            AudioApp.uiManager.setUrlInputStyle('error');
            AudioApp.uiManager.setFileInfo("Error: No URL provided.");
            return;
        }
        console.log("App: URL selected -", currentDisplayUrl);
        AudioApp.uiManager.setUrlLoadingError("");

        let filename = "loaded_from_url";
        try {
            const urlPath = new URL(currentDisplayUrl).pathname;
            const lastSegment = urlPath.substring(urlPath.lastIndexOf('/') + 1);
            if (lastSegment) filename = decodeURIComponent(lastSegment);
        } catch (urlError) {
            filename = currentDisplayUrl; // Use full URL if parsing fails
        }

        resetAudioStateAndUI(filename, newUrlFromEvent !== previousDisplayUrl, true);
        AudioApp.uiManager.setAudioUrlInputValue(currentDisplayUrl); // Ensure input shows the URL being loaded

        try {
            AudioApp.uiManager.setFileInfo(`Fetching: ${filename}...`);
            const response = await fetch(currentDisplayUrl);
            if (!response.ok) throw new Error(`Network response was not ok: ${response.status} ${response.statusText}`);

            const arrayBuffer = await response.arrayBuffer();
            AudioApp.uiManager.setFileInfo(`Processing: ${filename}...`);

            let mimeType = response.headers.get('Content-Type')?.split(';')[0] || 'audio/*';
            // Fallback or refine mimeType based on extension if necessary
            const ext = filename.substring(filename.lastIndexOf('.') + 1).toLowerCase();
            if (mimeType === 'application/octet-stream' || mimeType === 'audio/*') { // Common generic types
                if (ext === 'mp3') mimeType = 'audio/mpeg';
                else if (ext === 'wav') mimeType = 'audio/wav';
                else if (ext === 'ogg') mimeType = 'audio/ogg';
            }

            const newFileObject = new File([arrayBuffer], filename, {type: mimeType});
            currentFile = newFileObject; // Store the fetched content as a File object

            await AudioApp.audioEngine.loadAndProcessFile(newFileObject);
            currentUrlStyle = 'success';
            AudioApp.uiManager.setUrlInputStyle(currentUrlStyle);
            debouncedUpdateHashFromSettings();
        } catch (error) {
            console.error(`App: Error fetching/processing URL ${currentDisplayUrl}:`, error);
            AudioApp.uiManager.resetUI(); // Full UI reset
            currentUrlStyle = 'error';
            AudioApp.uiManager.setAudioUrlInputValue(currentDisplayUrl);
            AudioApp.uiManager.setUrlInputStyle(currentUrlStyle);
            AudioApp.uiManager.setUrlLoadingError(`Error loading from URL. (${error?.message?.substring(0, 100) || 'Unknown error'})`);
            AudioApp.uiManager.setFileInfo("Failed to load audio from URL.");
            AudioApp.spectrogramVisualizer.showSpinner(false);
            stopUIUpdateLoop();
            currentFile = null;
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
        isActuallyPlaying = false;
        playbackNaturallyEnded = false;
        isVadProcessing = false;
        playbackStartTimeContext = null;
        playbackStartSourceTime = 0.0;
        currentSpeedForUpdate = 1.0;
        currentAudioBuffer = null;
        currentVadResults = null;
        workletPlaybackReady = false;
        if (!isUrl) currentFile = null; // Clear file object only if not a URL load (URL load will set it)

        if (fullUIRestart) {
            AudioApp.uiManager.resetUI();
        } else {
            // Partial reset: preserve speed/pitch/gain, reset time, VAD, etc.
            AudioApp.uiManager.updateTimeDisplay(0, 0);
            AudioApp.uiManager.updateSeekBar(0);
            AudioApp.uiManager.setSpeechRegionsText("None");
            AudioApp.uiManager.showVadProgress(false);
            AudioApp.uiManager.updateVadProgress(0);
            AudioApp.uiManager.setUrlLoadingError("");
        }
        AudioApp.uiManager.updateFileName(displayName);
        AudioApp.uiManager.setFileInfo(`Loading: ${displayName}...`);
        AudioApp.uiManager.setAudioUrlInputValue(currentDisplayUrl || ""); // currentDisplayUrl might be set by caller
        AudioApp.uiManager.setUrlInputStyle(currentUrlStyle); // currentUrlStyle might be set by caller

        AudioApp.waveformVisualizer.clearVisuals();
        AudioApp.spectrogramVisualizer.clearVisuals();
        AudioApp.spectrogramVisualizer.showSpinner(true); // Spinner shown during load

        debouncedUpdateHashFromSettings();
    }


    /**
     * Handles audio decoding completion.
     * This is the central point for kicking off all parallel analysis tasks.
     * @private
     * @param {CustomEvent<{audioBuffer: AudioBuffer}>} e - The event object.
     */
    async function handleAudioLoaded(e) {
        currentAudioBuffer = e.detail.audioBuffer;
        console.log(`App: Audio decoded (${currentAudioBuffer.duration.toFixed(2)}s). Starting parallel analysis.`);

        // --- 1. Basic UI Setup (Instant) ---
        AudioApp.uiManager.updateTimeDisplay(0, currentAudioBuffer.duration);
        AudioApp.uiManager.updateSeekBar(0);
        AudioApp.waveformVisualizer.updateProgressIndicator(0, currentAudioBuffer.duration);
        AudioApp.spectrogramVisualizer.updateProgressIndicator(0, currentAudioBuffer.duration);
        playbackStartSourceTime = 0.0;

        // Apply current UI settings to the engine
        if (AudioApp.audioEngine && AudioApp.uiManager) {
            AudioApp.audioEngine.setSpeed(AudioApp.uiManager.getPlaybackSpeedValue());
            AudioApp.audioEngine.setPitch(AudioApp.uiManager.getPitchValue());
            AudioApp.audioEngine.setGain(AudioApp.uiManager.getGainValue());
        }

        // --- 2. Draw Waveform First (Fastest visual feedback) ---
        // We can await this as it's quick and provides the first visual confirmation.
        await AudioApp.waveformVisualizer.computeAndDrawWaveform(currentAudioBuffer, []);

        // --- 3. Launch All Long-Running Tasks Concurrently ---
        // We DO NOT await these calls. We want them to start immediately and run in the background.
        // The main thread is now free to handle user input.

        console.log("App: Kicking off Spectrogram, VAD, and Tone analysis in parallel.");

        // A. Start Spectrogram Worker
        AudioApp.spectrogramVisualizer.computeAndDrawSpectrogram(currentAudioBuffer);

        // B. Start VAD Analysis
        runVadInBackground(currentAudioBuffer);

        // C. Start Tone Detection Analysis
        if (dtmfParser || cptParser) {
            processAudioForTones(currentAudioBuffer);
        }

        // --- 4. Update File Info ---
        // The UI now shows "Processing..." while the background tasks run.
        AudioApp.uiManager.setFileInfo(`Processing Analyses: ${currentFile?.name || currentDisplayUrl || 'Loaded Audio'}`);

        // If a local file was loaded, ensure its "file:///" URL is displayed correctly.
        if (currentFile && currentDisplayUrl && currentUrlStyle === 'file') {
            AudioApp.uiManager.setAudioUrlInputValue(currentDisplayUrl);
            AudioApp.uiManager.setUrlInputStyle(currentUrlStyle);
        }
    }

    /**
     * Handles the 'audioapp:workletReady' event. Enables playback controls.
     * @private
     * @param {CustomEvent} e - The event object.
     */
    function handleWorkletReady(e) {
        console.log("App: AudioWorklet processor is ready.");
        workletPlaybackReady = true;
        AudioApp.uiManager.enablePlaybackControls(true);
        AudioApp.uiManager.enableSeekBar(true);
        AudioApp.uiManager.setFileInfo(`Ready: ${currentFile?.name || currentDisplayUrl || 'Loaded Audio'}`);
        AudioApp.uiManager.unfocusUrlInput();

        // Re-affirm engine parameters from UI (might have changed or from hash)
        if (AudioApp.audioEngine && AudioApp.uiManager) {
            AudioApp.audioEngine.setSpeed(AudioApp.uiManager.getPlaybackSpeedValue());
            AudioApp.audioEngine.setPitch(AudioApp.uiManager.getPitchValue());
            AudioApp.audioEngine.setGain(AudioApp.uiManager.getGainValue());
        }

        // Apply position from hash settings if available and audio buffer exists
        if (initialHashSettings.position !== undefined && currentAudioBuffer) {
            const targetTime = Math.max(0, Math.min(initialHashSettings.position, currentAudioBuffer.duration));
            console.log(`App: Restoring position from hash: ${targetTime.toFixed(3)}s`);
            AudioApp.audioEngine.seek(targetTime);
            playbackStartSourceTime = targetTime;
            playbackStartTimeContext = null; // Not playing yet
            updateUIWithTime(targetTime);
        }
        initialHashSettings = {}; // Clear after use
    }

    /**
     * Runs VAD analysis in the background. (REFACTORED)
     * @private
     * @param {AudioBuffer} audioBuffer - The audio buffer to analyze.
     * @returns {Promise<void>}
     */
    async function runVadInBackground(audioBuffer) {
        if (!audioBuffer || !AudioApp.vadAnalyzer || !AudioApp.audioEngine || !AudioApp.uiManager || !AudioApp.waveformVisualizer) {
            console.error("App (VAD): Missing dependencies for VAD task.");
            isVadProcessing = false;
            return;
        }
        if (isVadProcessing) {
            console.warn("App (VAD): Processing already running.");
            return;
        }

        isVadProcessing = true;

        try {
            // 1. Initialize the VAD analyzer (this creates the worker).
            await AudioApp.vadAnalyzer.init();

            // 2. Show progress bar and resample the audio.
            AudioApp.uiManager.showVadProgress(true);
            AudioApp.uiManager.updateVadProgress(0);
            const pcm16k = await AudioApp.audioEngine.resampleTo16kMono(audioBuffer);

            if (!pcm16k || pcm16k.length === 0) {
                AudioApp.uiManager.setSpeechRegionsText("No VAD data (empty audio?)");
                AudioApp.uiManager.updateVadProgress(100);
                isVadProcessing = false;
                return;
            }

            // 3. Define the progress callback and start analysis.
            const vadProgressCallback = (progress) => {
                if (!AudioApp.uiManager) return;
                const percentage = progress.totalFrames > 0 ? (progress.processedFrames / progress.totalFrames) * 100 : 0;
                AudioApp.uiManager.updateVadProgress(percentage);
            };

            // 4. The `analyze` call now returns a promise with the final result.
            const vadResults = await AudioApp.vadAnalyzer.analyze(pcm16k, {onProgress: vadProgressCallback});
            currentVadResults = vadResults; // Store the final results

            // 5. Update the UI with the final results.
            const speechRegions = currentVadResults.regions || [];
            AudioApp.uiManager.updateVadDisplay(currentVadResults.initialPositiveThreshold, currentVadResults.initialNegativeThreshold);
            AudioApp.uiManager.setSpeechRegionsText(speechRegions);
            // The `handleThresholdChange` logic can be re-integrated later if needed,
            // but for now this completes the core analysis.
            AudioApp.waveformVisualizer.redrawWaveformHighlight(audioBuffer, speechRegions);
            AudioApp.uiManager.updateVadProgress(100);

        } catch (error) {
            console.error("App (VAD): Error during VAD processing -", error);
            AudioApp.uiManager.setSpeechRegionsText(`VAD Error: ${error?.message || 'Unknown error'}`);
            AudioApp.uiManager.updateVadProgress(0);
            currentVadResults = null;
        } finally {
            isVadProcessing = false;
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
        const pcmSampleRate = AudioApp.DTMFParser.DTMF_SAMPLE_RATE || 16000; // Use constant from parser
        const pcmBlockSize = AudioApp.DTMFParser.DTMF_BLOCK_SIZE || 410;   // Use constant from parser
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
        AudioApp.uiManager.setFileInfo(`Error (${errorType}): ${errorMessage.substring(0, 100)}`);
        AudioApp.uiManager.resetUI(); // Full UI reset
        AudioApp.waveformVisualizer?.clearVisuals();
        AudioApp.spectrogramVisualizer?.clearVisuals();
        AudioApp.spectrogramVisualizer?.showSpinner(false);
        currentAudioBuffer = null;
        currentVadResults = null;
        currentFile = null;
        workletPlaybackReady = false;
        isActuallyPlaying = false;
        isVadProcessing = false;
        playbackStartTimeContext = null;
        playbackStartSourceTime = 0.0;
        currentSpeedForUpdate = 1.0;
    }

    /**
     * Handles play/pause button clicks. Manages playback state and UI synchronization.
     * @private
     */
    function handlePlayPause() {
        if (!workletPlaybackReady || !AudioApp.audioEngine) {
            console.warn("App: Play/Pause ignored - Engine/Worklet not ready.");
            return;
        }
        const audioCtx = AudioApp.audioEngine.getAudioContext();
        if (!audioCtx) {
            console.error("App: Cannot play/pause, AudioContext not available.");
            return;
        }

        const aboutToPlay = !isActuallyPlaying;

        if (!aboutToPlay) { // Requesting Pause
            playbackNaturallyEnded = false;
            const finalEstimatedTime = calculateEstimatedSourceTime();
            AudioApp.audioEngine.seek(finalEstimatedTime); // Sync engine to precise time
            playbackStartSourceTime = finalEstimatedTime; // Update our base time
            playbackStartTimeContext = null; // Mark as paused for time calculation
            stopUIUpdateLoop();
            updateUIWithTime(finalEstimatedTime); // Update UI immediately
            debouncedUpdateHashFromSettings(); // Update hash on pause
        }
        // For play, time base and UI loop are handled in 'playbackStateChanged'
        AudioApp.audioEngine.togglePlayPause(); // Request engine to toggle state
    }

    /**
     * Handles jump (forward/backward) button clicks.
     * @private
     * @param {CustomEvent<{seconds: number}>} e - The event object.
     */
    function handleJump(e) {
        playbackNaturallyEnded = false;
        if (!workletPlaybackReady || !currentAudioBuffer || !AudioApp.audioEngine) return;
        const audioCtx = AudioApp.audioEngine.getAudioContext();
        if (!audioCtx) return;
        const duration = currentAudioBuffer.duration;
        if (isNaN(duration) || duration <= 0) return;

        const currentTime = calculateEstimatedSourceTime();
        const targetTime = Math.max(0, Math.min(currentTime + e.detail.seconds, duration));
        AudioApp.audioEngine.seek(targetTime);
        playbackStartSourceTime = targetTime;
        if (isActuallyPlaying) {
            playbackStartTimeContext = audioCtx.currentTime;
        } else {
            playbackStartTimeContext = null;
            updateUIWithTime(targetTime);
        }
        debouncedUpdateHashFromSettings();
    }

    /**
     * Handles seek requests from UI elements (e.g., spectrogram click, seek bar input).
     * @private
     * @param {CustomEvent<{fraction: number}>} e - The event object.
     */
    function handleSeek(e) {
        playbackNaturallyEnded = false;
        if (!workletPlaybackReady || !currentAudioBuffer || isNaN(currentAudioBuffer.duration) || currentAudioBuffer.duration <= 0 || !AudioApp.audioEngine) return;
        const audioCtx = AudioApp.audioEngine.getAudioContext();
        if (!audioCtx) return;

        const targetTime = e.detail.fraction * currentAudioBuffer.duration;
        AudioApp.audioEngine.seek(targetTime);
        playbackStartSourceTime = targetTime;
        if (isActuallyPlaying) {
            playbackStartTimeContext = audioCtx.currentTime;
        } else {
            playbackStartTimeContext = null;
            updateUIWithTime(targetTime);
        }
        debouncedUpdateHashFromSettings();
    }

    /** Alias for handleSeek, used by seek bar 'input' event. @private */
    const handleSeekBarInput = handleSeek;

    /**
     * Handles speed changes from the UI slider.
     * @private
     * @param {CustomEvent<{speed: number}>} e - The event object.
     */
    function handleSpeedChange(e) {
        if (!AudioApp.audioEngine) return;
        AudioApp.audioEngine.setSpeed(e.detail.speed);
        if (debouncedSyncEngine) debouncedSyncEngine(); // Sync engine after a short delay
        debouncedUpdateHashFromSettings();
    }

    /**
     * Handles pitch changes from the UI slider.
     * @private
     * @param {CustomEvent<{pitch: number}>} e - The event object.
     */
    function handlePitchChange(e) {
        if (!AudioApp.audioEngine) return;
        AudioApp.audioEngine.setPitch(e.detail.pitch);
        debouncedUpdateHashFromSettings();
    }

    /**
     * Handles gain changes from the UI slider.
     * @private
     * @param {CustomEvent<{gain: number}>} e - The event object.
     */
    function handleGainChange(e) {
        if (!AudioApp.audioEngine) return;
        AudioApp.audioEngine.setGain(e.detail.gain);
        debouncedUpdateHashFromSettings();
    }

    /**
     * Synchronizes the audio engine's current time to the main thread's estimated time.
     * Called debounced after speed changes.
     * @private
     */
    function syncEngineToEstimatedTime() {
        if (!workletPlaybackReady || !currentAudioBuffer || !AudioApp.audioEngine) return;
        const audioCtx = AudioApp.audioEngine.getAudioContext();
        if (!audioCtx) return;

        const targetTime = calculateEstimatedSourceTime();
        AudioApp.audioEngine.seek(targetTime);
        playbackStartSourceTime = targetTime;
        if (isActuallyPlaying) {
            playbackStartTimeContext = audioCtx.currentTime;
        } else {
            playbackStartTimeContext = null;
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
        const oldSpeed = currentSpeedForUpdate;
        currentSpeedForUpdate = newSpeed;

        const audioCtx = AudioApp.audioEngine?.getAudioContext();
        if (isActuallyPlaying && playbackStartTimeContext !== null && audioCtx) {
            const elapsedContextTime = audioCtx.currentTime - playbackStartTimeContext;
            const elapsedSourceTime = elapsedContextTime * oldSpeed;
            const previousSourceTime = playbackStartSourceTime + elapsedSourceTime;
            playbackStartSourceTime = previousSourceTime;
            playbackStartTimeContext = audioCtx.currentTime;
        }
    }

    /**
     * Handles VAD threshold changes from the UI.
     * @private
     * @param {CustomEvent<{type: string, value: number}>} e - The event object.
     */
    function handleThresholdChange(e) {
        if (!currentVadResults || isVadProcessing || !AudioApp.vadAnalyzer || !AudioApp.waveformVisualizer || !currentAudioBuffer) return;
        const {type, value} = e.detail;
        const newRegions = AudioApp.vadAnalyzer.handleThresholdUpdate(type, value);
        AudioApp.uiManager.setSpeechRegionsText(newRegions);
        AudioApp.waveformVisualizer.redrawWaveformHighlight(currentAudioBuffer, newRegions);
        debouncedUpdateHashFromSettings();
    }

    /**
     * Handles the 'audioapp:playbackEnded' event from the audio engine.
     * @private
     */
    function handlePlaybackEnded() {
        console.log("App: Playback ended event received.");
        isActuallyPlaying = false;
        stopUIUpdateLoop();
        playbackStartTimeContext = null;
        if (currentAudioBuffer) {
            playbackStartSourceTime = currentAudioBuffer.duration;
            updateUIWithTime(currentAudioBuffer.duration);
        }
        playbackNaturallyEnded = true;
        AudioApp.uiManager.setPlayButtonState(false);
        debouncedUpdateHashFromSettings();
    }

    /**
     * Handles playback state changes confirmed by the audio engine.
     * @private
     * @param {CustomEvent<{isPlaying: boolean}>} e - The event object.
     */
    function handlePlaybackStateChange(e) {
        const workletIsPlaying = e.detail.isPlaying;
        const wasPlaying = isActuallyPlaying;
        isActuallyPlaying = workletIsPlaying;
        AudioApp.uiManager.setPlayButtonState(isActuallyPlaying);

        if (isActuallyPlaying) {
            const audioCtx = AudioApp.audioEngine?.getAudioContext();
            if (!wasPlaying && audioCtx) { // Transitioned from not playing to playing
                if (playbackNaturallyEnded && currentAudioBuffer) {
                    playbackStartSourceTime = 0; // Restart from beginning
                    playbackNaturallyEnded = false;
                } else {
                    // Resuming or starting normally, use engine's current time
                    playbackStartSourceTime = AudioApp.audioEngine.getCurrentTime().currentTime;
                }
                playbackStartTimeContext = audioCtx.currentTime;
                updateUIWithTime(playbackStartSourceTime); // Update UI immediately
            }
            startUIUpdateLoop();
        } else { // Transitioned to not playing
            stopUIUpdateLoop();
            playbackStartTimeContext = null; // Mark as paused for time calculation
            // UI time sync for pause is handled in handlePlayPause
        }
    }

    /**
     * Handles global key press events for shortcuts.
     * @private
     * @param {CustomEvent<{key: string}>} e - The event object.
     */
    function handleKeyPress(e) {
        if (!workletPlaybackReady) return;
        const key = e.detail.key;
        const jumpTimeValue = AudioApp.uiManager.getJumpTime();
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
        const regions = AudioApp.vadAnalyzer ? AudioApp.vadAnalyzer.getCurrentRegions() : [];
        AudioApp.waveformVisualizer?.resizeAndRedraw(currentAudioBuffer, regions);
        AudioApp.spectrogramVisualizer?.resizeAndRedraw(currentAudioBuffer);
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
        const duration = currentAudioBuffer ? currentAudioBuffer.duration : 0;

        if (!isActuallyPlaying || playbackStartTimeContext === null || !audioCtx || !currentAudioBuffer || duration <= 0 || currentSpeedForUpdate <= 0) {
            return playbackStartSourceTime; // Return base time if not playing, speed is zero/negative, or essential info missing
        }

        const elapsedContextTime = audioCtx.currentTime - playbackStartTimeContext;
        const elapsedSourceTime = elapsedContextTime * currentSpeedForUpdate;
        let estimatedCurrentSourceTime = playbackStartSourceTime + elapsedSourceTime;
        return Math.max(0, Math.min(estimatedCurrentSourceTime, duration)); // Clamp to valid range
    }

    /**
     * Updates UI elements related to time (display, seek bar, visualizer progress).
     * @private
     * @param {number} time - The current source time to display.
     */
    function updateUIWithTime(time) {
        const duration = currentAudioBuffer ? currentAudioBuffer.duration : 0;
        if (isNaN(duration)) return;
        const clampedTime = Math.max(0, Math.min(time, duration));
        const fraction = duration > 0 ? clampedTime / duration : 0;
        AudioApp.uiManager.updateTimeDisplay(clampedTime, duration);
        AudioApp.uiManager.updateSeekBar(fraction);
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
        if (!isActuallyPlaying) {
            rAFUpdateHandle = null;
            return; // Stop loop if not playing
        }
        const estimatedTime = calculateEstimatedSourceTime();
        updateUIWithTime(estimatedTime);

        const currentTime = performance.now();
        if (currentTime - lastHashUpdateTime > 3000 && debouncedUpdateHashFromSettings) { // Update hash roughly every 3 seconds
            debouncedUpdateHashFromSettings();
            lastHashUpdateTime = currentTime;
        }
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
