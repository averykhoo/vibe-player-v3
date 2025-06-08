// --- /vibe-player/js/app.js ---
// Creates the global namespace and orchestrates the application flow.
// MUST be loaded AFTER all its dependency modules.

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

// REFACTORED: Pass AudioApp as an argument 'app' to the IIFE.
// This prevents overwriting the namespace and allows this script
// to correctly augment the existing AudioApp object.
(function (app) {
    'use strict';

    // Instantiate AppState and expose it on the AudioApp namespace
    const appState = new AppState();
    app.state = appState; // Use the passed-in 'app' object

    /** @type {AudioApp.Utils} Reference to the Utils module. */
    const Utils = app.Utils; // Use the passed-in 'app' object

    // --- Application State ---
    /** @type {number} Counter for drag enter/leave events to manage drop zone visibility. */
    let dragCounter = 0;
    /** @type {AudioApp.DTMFParser|null} The DTMF parser instance. */
    let dtmfParser = null;
    /** @type {AudioApp.CallProgressToneParser|null} The Call Progress Tone parser instance. */
    let cptParser = null;

    /** @type {number|null} Handle for the requestAnimationFrame UI update loop. Null if not running. */
    let rAFUpdateHandle = null;

    // --- Debounced Functions ---
    /** @type {Function|null} Debounced function for synchronizing the audio engine after speed changes. */
    let debouncedSyncEngine = null;
    /** @type {Function|null} Debounced function for updating the URL hash from current settings. */
    let debouncedUpdateUrlHash = null;

    /**
     * Generates a URL hash string from the current AppState and playback position.
     * @private
     */
    function updateUrlHashFromState() {
        if (!app.state || !app.audioEngine) return;

        const newHash = app.state.serialize(app.audioEngine.getCurrentTime().currentTime);

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

        if (!app.uiManager || !app.audioEngine || !app.waveformVisualizer ||
            !app.spectrogramVisualizer || !app.vadAnalyzer ||
            !app.Utils || !app.DTMFParser || !app.CallProgressToneParser || typeof Constants === 'undefined') {
            console.error("AudioApp: CRITICAL - One or more required modules not found! Check script loading order.");
            app.uiManager?.setFileInfo("Initialization Error: Missing modules. Check console.");
            return;
        }

        debouncedSyncEngine = app.Utils.debounce(syncEngineToEstimatedTime, Constants.UI.SYNC_DEBOUNCE_WAIT_MS);
        debouncedUpdateUrlHash = app.Utils.debounce(updateUrlHashFromState, Constants.UI.DEBOUNCE_HASH_UPDATE_MS);

        app.uiManager.init();

        if (app.state && typeof app.state.deserialize === 'function') {
            app.state.deserialize(window.location.hash.substring(1));
        }

        setupAppEventListeners();

        const initialAudioUrlFromState = app.state.params.audioUrl;
        if (initialAudioUrlFromState) {
            console.log("App: Applying audioUrl from AppState (from hash):", initialAudioUrlFromState);
            if (initialAudioUrlFromState.startsWith('file:///')) {
                app.state.updateStatus('urlInputStyle', 'error');
                app.uiManager.setUrlLoadingError("Local files cannot be automatically reloaded from the URL. Please re-select the file.");
            } else {
                app.state.updateStatus('urlInputStyle', 'modified');
                document.dispatchEvent(new CustomEvent('audioapp:urlSelected', {detail: {url: initialAudioUrlFromState}}));
            }
        }

        setTimeout(() => {
            app.uiManager?.unfocusUrlInput();
        }, 100);

        app.audioEngine.init();
        app.waveformVisualizer.init();
        app.spectrogramVisualizer.init(() => app.state.runtime.currentAudioBuffer);

        // EAGER LOAD VAD MODEL
        app.vadAnalyzer.init();

        if (app.DTMFParser) dtmfParser = new app.DTMFParser();
        if (app.CallProgressToneParser) cptParser = new app.CallProgressToneParser();

        console.log("AudioApp: Initialized. Waiting for file...");
    }

    /**
     * Sets up global event listeners for the application.
     * @private
     */
    function setupAppEventListeners() {
        document.addEventListener('audioapp:fileSelected', (handleFileSelected));
        document.addEventListener('audioapp:urlSelected', (handleUrlSelected));
        document.addEventListener('audioapp:playPauseClicked', handlePlayPause);
        document.addEventListener('audioapp:jumpClicked', (handleJump));
        document.addEventListener('audioapp:seekRequested', (handleSeek));
        document.addEventListener('audioapp:seekBarInput', (handleSeekBarInput));
        document.addEventListener('audioapp:speedChanged', (handleSpeedChange));
        document.addEventListener('audioapp:pitchChanged', (handlePitchChange));
        document.addEventListener('audioapp:gainChanged', (handleGainChange));
        document.addEventListener('audioapp:thresholdChanged', (handleThresholdChange));
        document.addEventListener('audioapp:keyPressed', (handleKeyPress));
        document.addEventListener('audioapp:jumpTimeChanged', (handleJumpTimeChange)); // New listener
        document.addEventListener('audioapp:audioLoaded', (handleAudioLoaded));
        document.addEventListener('audioapp:workletReady', (handleWorkletReady));
        document.addEventListener('audioapp:decodingError', (handleAudioError));
        document.addEventListener('audioapp:resamplingError', (handleAudioError));
        document.addEventListener('audioapp:playbackError', (handleAudioError));
        document.addEventListener('audioapp:engineError', (handleAudioError));
        document.addEventListener('audioapp:playbackEnded', handlePlaybackEnded);
        document.addEventListener('audioapp:playbackStateChanged', (handlePlaybackStateChange));
        document.addEventListener('audioapp:internalSpeedChanged', (handleInternalSpeedChange));
        window.addEventListener('resize', handleWindowResize);
        window.addEventListener('beforeunload', handleBeforeUnload);
        window.addEventListener('dragenter', handleDragEnter);
        window.addEventListener('dragover', handleDragOver);
        window.addEventListener('dragleave', handleDragLeave);
        window.addEventListener('drop', handleDrop);
    }

    /**
     * Handles changes to the jump time from the UI.
     * @param {CustomEvent<{value: number}>} e - The event containing the new jump time.
     * @private
     */
    function handleJumpTimeChange(e) {
        const newJumpTime = e.detail.value;
        if (typeof newJumpTime === 'number' && newJumpTime > 0) {
            app.state.updateParam('jumpTime', newJumpTime);
            if (debouncedUpdateUrlHash) debouncedUpdateUrlHash(); // Update URL hash if jump time changes
        }
    }

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
                app.uiManager.showDropZone(event.dataTransfer.files[0]);
            }
        }
    }

    function handleDragOver(event) {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    }

    function handleDragLeave(event) {
        event.preventDefault();
        event.stopPropagation();
        dragCounter--;
        if (dragCounter === 0) {
            app.uiManager.hideDropZone();
        }
    }

    function handleDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        app.uiManager.hideDropZone();
        dragCounter = 0;
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
            const file = files[0];
            if (file.type.startsWith('audio/')) {
                console.log("App: File dropped -", file.name);
                document.dispatchEvent(new CustomEvent('audioapp:fileSelected', {detail: {file: file}}));
            } else {
                console.warn("App: Invalid file type dropped -", file.name, file.type);
                app.uiManager.setFileInfo("Invalid file type. Please drop an audio file.");
            }
        }
    }

    async function handleFileSelected(e) {
        const file = e.detail.file;
        if (!file) return;
        const newDisplayUrl = 'file:///' + file.name;
        const previousDisplayUrl = app.state.params.audioUrl;
        app.state.updateRuntime('currentFile', file);
        app.state.updateParam('audioUrl', newDisplayUrl);
        app.state.updateStatus('urlInputStyle', 'file');
        app.uiManager.setAudioUrlInputValue(newDisplayUrl);
        app.uiManager.setUrlInputStyle('file');
        console.log("App: File selected -", file.name);
        resetAudioStateAndUI(file.name, newDisplayUrl !== previousDisplayUrl);
        try {
            await app.audioEngine.loadAndProcessFile(file);
        } catch (error) {
            console.error("App: Error initiating file processing -", error);
            app.uiManager.setFileInfo(`Error loading: ${error?.message || 'Unknown error'}`);
            app.uiManager.resetUI();
            app.spectrogramVisualizer.showSpinner(false);
            stopUIUpdateLoop();
        }
    }

    async function handleUrlSelected(e) {
        const newUrlFromEvent = e.detail.url;
        const previousDisplayUrl = app.state.params.audioUrl;
        app.state.updateParam('audioUrl', newUrlFromEvent);
        app.state.updateStatus('urlInputStyle', 'default');
        app.uiManager.setUrlInputStyle('default');
        if (!newUrlFromEvent) {
            console.warn("App: URL selected event received, but URL is empty.");
            app.uiManager.setAudioUrlInputValue("");
            app.state.updateStatus('urlInputStyle', 'error');
            app.uiManager.setUrlInputStyle('error');
            app.state.updateStatus('fileInfoMessage', "Error: No URL provided.");
            return;
        }
        console.log("App: URL selected -", newUrlFromEvent);
        app.state.updateStatus('urlLoadingErrorMessage', "");
        let filename = "loaded_from_url";
        try {
            const urlPath = new URL(newUrlFromEvent).pathname;
            const lastSegment = urlPath.substring(urlPath.lastIndexOf('/') + 1);
            if (lastSegment) filename = decodeURIComponent(lastSegment);
        } catch (urlError) {
            filename = newUrlFromEvent;
        }
        resetAudioStateAndUI(filename, newUrlFromEvent !== previousDisplayUrl, true);
        app.uiManager.setAudioUrlInputValue(newUrlFromEvent);
        try {
            app.state.updateStatus('fileInfoMessage', `Fetching: ${filename}...`);
            const response = await fetch(newUrlFromEvent);
            if (!response.ok) throw new Error(`Network response was not ok: ${response.status} ${response.statusText}`);
            const arrayBuffer = await response.arrayBuffer();
            app.state.updateStatus('fileInfoMessage', `Processing: ${filename}...`);
            let mimeType = response.headers.get('Content-Type')?.split(';')[0] || 'audio/*';
            const ext = filename.substring(filename.lastIndexOf('.') + 1).toLowerCase();
            if (mimeType === 'application/octet-stream' || mimeType === 'audio/*') {
                if (ext === 'mp3') mimeType = 'audio/mpeg';
                else if (ext === 'wav') mimeType = 'audio/wav';
                else if (ext === 'ogg') mimeType = 'audio/ogg';
            }
            const newFileObject = new File([arrayBuffer], filename, {type: mimeType});
            app.state.updateRuntime('currentFile', newFileObject);
            await app.audioEngine.loadAndProcessFile(newFileObject);
            app.state.updateStatus('urlInputStyle', 'success');
            app.uiManager.setUrlInputStyle('success');
            if (debouncedUpdateUrlHash) debouncedUpdateUrlHash();
        } catch (error) {
            console.error(`App: Error fetching/processing URL ${newUrlFromEvent}:`, error);
            app.uiManager.resetUI();
            app.state.updateStatus('urlInputStyle', 'error');
            app.uiManager.setAudioUrlInputValue(newUrlFromEvent);
            app.uiManager.setUrlInputStyle('error');
            app.state.updateStatus('urlLoadingErrorMessage', `Error loading from URL. (${error?.message?.substring(0, 100) || 'Unknown error'})`);
            app.state.updateStatus('fileInfoMessage', "Failed to load audio from URL.");
            app.spectrogramVisualizer.showSpinner(false);
            stopUIUpdateLoop();
            app.state.updateRuntime('currentFile', null);
        }
    }

    function resetAudioStateAndUI(displayName, fullUIRestart, isUrl = false) {
        stopUIUpdateLoop();
        app.state.updateStatus('isActuallyPlaying', false);
        app.state.updateStatus('playbackNaturallyEnded', false);
        app.state.updateStatus('isVadProcessing', false);
        app.state.updateRuntime('playbackStartTimeContext', null);
        app.state.updateRuntime('playbackStartSourceTime', 0.0);
        app.state.updateRuntime('currentSpeedForUpdate', 1.0);
        app.state.updateRuntime('currentAudioBuffer', null);
        app.state.updateRuntime('currentVadResults', null);
        app.state.updateStatus('workletPlaybackReady', false);
        if (!isUrl) app.state.updateRuntime('currentFile', null);
        if (fullUIRestart) {
            app.uiManager.resetUI();
        } else {
            app.uiManager.updateTimeDisplay(0, 0);
            app.uiManager.updateSeekBar(0);
            app.uiManager.setSpeechRegionsText("None");
            app.uiManager.showVadProgress(false);
            app.uiManager.updateVadProgress(0);
            app.state.updateStatus('urlLoadingErrorMessage', "");
        }
        app.uiManager.updateFileName(displayName);
        app.state.updateStatus('fileInfoMessage', `Loading: ${displayName}...`);
        app.uiManager.setAudioUrlInputValue(app.state.params.audioUrl || "");
        app.uiManager.setUrlInputStyle(app.state.status.urlInputStyle);
        app.waveformVisualizer.clearVisuals();
        app.spectrogramVisualizer.clearVisuals();
        app.spectrogramVisualizer.showSpinner(true);
        if (debouncedUpdateUrlHash) debouncedUpdateUrlHash();
    }

    async function handleAudioLoaded(e) {
        app.state.updateRuntime('currentAudioBuffer', e.detail.audioBuffer);
        const audioBuffer = app.state.runtime.currentAudioBuffer;
        console.log(`App: Audio decoded (${audioBuffer.duration.toFixed(2)}s). Starting parallel analysis.`);
        app.uiManager.updateTimeDisplay(0, audioBuffer.duration);
        app.uiManager.updateSeekBar(0);
        app.waveformVisualizer.updateProgressIndicator(0, audioBuffer.duration);
        app.spectrogramVisualizer.updateProgressIndicator(0, audioBuffer.duration);
        app.state.updateRuntime('playbackStartSourceTime', 0.0);
        if (app.audioEngine) {
            app.audioEngine.setSpeed(app.state.params.speed);
            app.audioEngine.setPitch(app.state.params.pitch);
            app.audioEngine.setGain(app.state.params.gain);
        }
        await app.waveformVisualizer.computeAndDrawWaveform(audioBuffer, []);
        console.log("App: Kicking off Spectrogram, VAD, and Tone analysis in parallel.");
        app.spectrogramVisualizer.computeAndDrawSpectrogram(audioBuffer);
        runVadInBackground(audioBuffer);
        if (dtmfParser || cptParser) {
            processAudioForTones(audioBuffer);
        }
        app.state.updateStatus('fileInfoMessage', `Processing Analyses: ${app.state.runtime.currentFile?.name || app.state.params.audioUrl || 'Loaded Audio'}`);
        if (app.state.runtime.currentFile && app.state.params.audioUrl && app.state.status.urlInputStyle === 'file') {
            app.uiManager.setAudioUrlInputValue(app.state.params.audioUrl);
            app.uiManager.setUrlInputStyle('file');
        }
    }

    function handleWorkletReady(e) {
        console.log("App: AudioWorklet processor is ready.");
        app.state.updateStatus('workletPlaybackReady', true);
        app.uiManager.enablePlaybackControls(true);
        app.uiManager.enableSeekBar(true);
        app.state.updateStatus('fileInfoMessage', `Ready: ${app.state.runtime.currentFile?.name || app.state.params.audioUrl || 'Loaded Audio'}`);
        app.uiManager.unfocusUrlInput();
        if (app.audioEngine) {
            app.audioEngine.setSpeed(app.state.params.speed);
            app.audioEngine.setPitch(app.state.params.pitch);
            app.audioEngine.setGain(app.state.params.gain);
        }
        const audioBuffer = app.state.runtime.currentAudioBuffer;
        if (app.state.params.initialSeekTime !== null && audioBuffer) {
            const targetTime = Math.max(0, Math.min(app.state.params.initialSeekTime, audioBuffer.duration));
            console.log(`App: Applying initialSeekTime from AppState: ${targetTime.toFixed(3)}s`);
            app.audioEngine.seek(targetTime);
            app.state.updateRuntime('playbackStartSourceTime', targetTime);
            app.state.updateRuntime('playbackStartTimeContext', null);
            updateUIWithTime(targetTime);
            app.state.updateParam('initialSeekTime', null);
        }
    }

    async function runVadInBackground(audioBuffer) {
        if (!audioBuffer || !app.vadAnalyzer || !app.audioEngine || !app.uiManager || !app.waveformVisualizer) {
            console.error("App (VAD): Missing dependencies for VAD task.");
            app.state.updateStatus('isVadProcessing', false);
            return;
        }
        if (app.state.status.isVadProcessing) {
            console.warn("App (VAD): Processing already running.");
            return;
        }

        app.state.updateStatus('isVadProcessing', true);

        try {
            // REMOVED: await app.vadAnalyzer.init(); -- This is now done at startup.
            app.uiManager.showVadProgress(true);
            app.uiManager.updateVadProgress(0);
            const pcm16k = await app.audioEngine.resampleTo16kMono(audioBuffer);
            if (!pcm16k || pcm16k.length === 0) {
                app.uiManager.setSpeechRegionsText("No VAD data (empty audio?)");
                app.uiManager.updateVadProgress(100);
                app.state.updateStatus('isVadProcessing', false);
                return;
            }
            const vadProgressCallback = (progress) => {
                if (!app.uiManager) return;
                const percentage = progress.totalFrames > 0 ? (progress.processedFrames / progress.totalFrames) * 100 : 0;
                app.uiManager.updateVadProgress(percentage);
            };
            const vadResults = await app.vadAnalyzer.analyze(pcm16k, {
                onProgress: vadProgressCallback,
                positiveSpeechThreshold: app.state.params.vadPositive,
                negativeSpeechThreshold: app.state.params.vadNegative
            });
            app.state.updateRuntime('currentVadResults', vadResults);
            const speechRegions = vadResults.regions || [];
            app.uiManager.updateVadDisplay(vadResults.initialPositiveThreshold, vadResults.initialNegativeThreshold);
            app.uiManager.setSpeechRegionsText(speechRegions);
            app.waveformVisualizer.redrawWaveformHighlight(audioBuffer, speechRegions);
            app.uiManager.updateVadProgress(100);
        } catch (error) {
            console.error("App (VAD): Error during VAD processing -", error);
            app.state.updateStatus('fileInfoMessage', `VAD Error: ${error?.message || 'Unknown error'}`);
            app.uiManager.updateVadProgress(0);
            app.state.updateRuntime('currentVadResults', null);
        } finally {
            app.state.updateStatus('isVadProcessing', false);
        }
    }

    async function processAudioForTones(audioBuffer) {
        if (!audioBuffer || !app.audioEngine || !app.uiManager || (!dtmfParser && !cptParser)) {
            console.warn("App (Tones): Missing dependencies or parsers for tone processing.");
            return;
        }
        const pcmSampleRate = Constants.DTMF.SAMPLE_RATE;
        const pcmBlockSize = Constants.DTMF.BLOCK_SIZE;
        let pcmData = null;
        try {
            pcmData = await app.audioEngine.resampleTo16kMono(audioBuffer);
            if (!pcmData || pcmData.length === 0) {
                if (dtmfParser) app.uiManager.updateDtmfDisplay("DTMF: No audio data.");
                if (cptParser) app.uiManager.updateCallProgressTonesDisplay(["CPT: No audio data."]);
                return;
            }
        } catch (error) {
            if (dtmfParser) app.uiManager.updateDtmfDisplay(`DTMF Error: ${error?.message?.substring(0, 100) || 'Resample error'}`);
            if (cptParser) app.uiManager.updateCallProgressTonesDisplay([`CPT Error: ${error?.message?.substring(0, 100) || 'Resample error'}`]);
            return;
        }
        if (dtmfParser) {
            app.uiManager.updateDtmfDisplay("Processing DTMF...");
            try {
                const detectedDtmfTones = [];
                let lastDetectedDtmf = null;
                let consecutiveDtmfDetections = 0;
                const minConsecutiveDtmf = 2;
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
                            if (detectedDtmfTones.length === 0 || detectedDtmfTones[detectedDtmfTones.length - 1] !== tone) {
                                detectedDtmfTones.push(tone);
                            }
                        }
                    } else {
                        lastDetectedDtmf = null;
                        consecutiveDtmfDetections = 0;
                    }
                }
                app.uiManager.updateDtmfDisplay(detectedDtmfTones.length > 0 ? detectedDtmfTones : "No DTMF detected.");
            } catch (error) {
                app.uiManager.updateDtmfDisplay(`DTMF Error: ${error?.message?.substring(0, 100) || 'Processing error'}`);
            }
        }
        if (cptParser) {
            app.uiManager.updateCallProgressTonesDisplay(["Processing CPTs..."]);
            try {
                const detectedCptSet = new Set();
                for (let i = 0; (i + pcmBlockSize) <= pcmData.length; i += pcmBlockSize) {
                    const audioBlock = pcmData.subarray(i, i + pcmBlockSize);
                    const toneName = cptParser.processAudioBlock(audioBlock);
                    if (toneName) detectedCptSet.add(toneName);
                }
                app.uiManager.updateCallProgressTonesDisplay(detectedCptSet.size > 0 ? Array.from(detectedCptSet) : ["No CPTs detected."]);
            } catch (error) {
                app.uiManager.updateCallProgressTonesDisplay([`CPT Error: ${error?.message?.substring(0, 100) || 'Processing error'}`]);
            }
        }
    }

    function handleAudioError(e) {
        const errorType = e.detail.type || 'Unknown Error';
        const errorMessage = e.detail.error?.message || 'An unknown error occurred';
        console.error(`App: Audio Error - Type: ${errorType}, Message: ${errorMessage}`, e.detail.error);
        stopUIUpdateLoop();
        app.state.updateStatus('fileInfoMessage', `Error (${errorType}): ${errorMessage.substring(0, 100)}`);
        app.uiManager.resetUI();
        app.waveformVisualizer?.clearVisuals();
        app.spectrogramVisualizer?.clearVisuals();
        app.spectrogramVisualizer?.showSpinner(false);
        app.state.updateRuntime('currentAudioBuffer', null);
        app.state.updateRuntime('currentVadResults', null);
        app.state.updateRuntime('currentFile', null);
        app.state.updateStatus('workletPlaybackReady', false);
        app.state.updateStatus('isActuallyPlaying', false);
        app.state.updateStatus('isVadProcessing', false);
        app.state.updateRuntime('playbackStartTimeContext', null);
        app.state.updateRuntime('playbackStartSourceTime', 0.0);
        app.state.updateRuntime('currentSpeedForUpdate', 1.0);
    }

    function handlePlayPause() {
        if (!app.state.status.workletPlaybackReady || !app.audioEngine) {
            console.warn("App: Play/Pause ignored - Engine/Worklet not ready.");
            return;
        }
        const audioCtx = app.audioEngine.getAudioContext();
        if (!audioCtx) {
            console.error("App: Cannot play/pause, AudioContext not available.");
            return;
        }
        const aboutToPlay = !app.state.status.isActuallyPlaying;
        if (!aboutToPlay) {
            app.state.updateStatus('playbackNaturallyEnded', false);
            const finalEstimatedTime = calculateEstimatedSourceTime();
            app.audioEngine.seek(finalEstimatedTime);
            app.state.updateRuntime('playbackStartSourceTime', finalEstimatedTime);
            app.state.updateRuntime('playbackStartTimeContext', null);
            stopUIUpdateLoop();
            updateUIWithTime(finalEstimatedTime);
            if (debouncedUpdateUrlHash) debouncedUpdateUrlHash();
        }
        app.audioEngine.togglePlayPause();
    }

    function handleJump(e) {
        app.state.updateStatus('playbackNaturallyEnded', false);
        const audioBuffer = app.state.runtime.currentAudioBuffer;
        if (!app.state.status.workletPlaybackReady || !audioBuffer || !app.audioEngine) return;
        const audioCtx = app.audioEngine.getAudioContext();
        if (!audioCtx) return;
        const duration = audioBuffer.duration;
        if (isNaN(duration) || duration <= 0) return;
        const currentTime = calculateEstimatedSourceTime();
        const direction = e.detail.direction; // Get direction
        const jumpTime = app.state.params.jumpTime; // Get jumpTime from state
        const jumpAmount = jumpTime * direction; // Calculate jumpAmount
        const targetTime = Math.max(0, Math.min(currentTime + jumpAmount, duration)); // Use jumpAmount
        app.audioEngine.seek(targetTime);
        app.state.updateRuntime('playbackStartSourceTime', targetTime);
        if (app.state.status.isActuallyPlaying) {
            app.state.updateRuntime('playbackStartTimeContext', audioCtx.currentTime);
        } else {
            app.state.updateRuntime('playbackStartTimeContext', null);
            updateUIWithTime(targetTime);
        }
        if (debouncedUpdateUrlHash) debouncedUpdateUrlHash();
    }

    function handleSeek(e) {
        app.state.updateStatus('playbackNaturallyEnded', false);
        const audioBuffer = app.state.runtime.currentAudioBuffer;
        if (!app.state.status.workletPlaybackReady || !audioBuffer || isNaN(audioBuffer.duration) || audioBuffer.duration <= 0 || !app.audioEngine) return;
        const audioCtx = app.audioEngine.getAudioContext();
        if (!audioCtx) return;
        const targetTime = e.detail.fraction * audioBuffer.duration;
        app.audioEngine.seek(targetTime);
        app.state.updateRuntime('playbackStartSourceTime', targetTime);
        if (app.state.status.isActuallyPlaying) {
            app.state.updateRuntime('playbackStartTimeContext', audioCtx.currentTime);
        } else {
            app.state.updateRuntime('playbackStartTimeContext', null);
            updateUIWithTime(targetTime);
        }
        if (debouncedUpdateUrlHash) debouncedUpdateUrlHash();
    }

    const handleSeekBarInput = handleSeek;

    function handleSpeedChange(e) {
        app.state.updateParam('speed', e.detail.speed);
        if (debouncedSyncEngine) debouncedSyncEngine();
        if (debouncedUpdateUrlHash) debouncedUpdateUrlHash();
    }

    function handlePitchChange(e) {
        app.state.updateParam('pitch', e.detail.pitch);
        if (debouncedUpdateUrlHash) debouncedUpdateUrlHash();
    }

    function handleGainChange(e) {
        app.state.updateParam('gain', e.detail.gain);
        if (debouncedUpdateUrlHash) debouncedUpdateUrlHash();
    }

    function syncEngineToEstimatedTime() {
        const audioBuffer = app.state.runtime.currentAudioBuffer;
        if (!app.state.status.workletPlaybackReady || !audioBuffer || !app.audioEngine) return;
        const audioCtx = app.audioEngine.getAudioContext();
        if (!audioCtx) return;
        const targetTime = calculateEstimatedSourceTime();
        app.audioEngine.seek(targetTime);
        app.state.updateRuntime('playbackStartSourceTime', targetTime);
        if (app.state.status.isActuallyPlaying) {
            app.state.updateRuntime('playbackStartTimeContext', audioCtx.currentTime);
        } else {
            app.state.updateRuntime('playbackStartTimeContext', null);
            updateUIWithTime(targetTime);
        }
    }

    function handleInternalSpeedChange(e) {
        const newSpeed = e.detail.speed;
        const oldSpeed = app.state.runtime.currentSpeedForUpdate;
        app.state.updateRuntime('currentSpeedForUpdate', newSpeed);
        const audioCtx = app.audioEngine?.getAudioContext();
        if (app.state.status.isActuallyPlaying && app.state.runtime.playbackStartTimeContext !== null && audioCtx) {
            const elapsedContextTime = audioCtx.currentTime - app.state.runtime.playbackStartTimeContext;
            const elapsedSourceTime = elapsedContextTime * oldSpeed;
            const previousSourceTime = app.state.runtime.playbackStartSourceTime + elapsedSourceTime;
            app.state.updateRuntime('playbackStartSourceTime', previousSourceTime);
            app.state.updateRuntime('playbackStartTimeContext', audioCtx.currentTime);
        }
    }

    function handleThresholdChange(e) {
        const {type, value} = e.detail;
        if (type === 'positive') {
            app.state.updateParam('vadPositive', value);
        } else if (type === 'negative') {
            app.state.updateParam('vadNegative', value);
        }
        const currentVadResults = app.state.runtime.currentVadResults;
        const currentAudioBuffer = app.state.runtime.currentAudioBuffer;
        if (currentVadResults && !app.state.status.isVadProcessing && app.vadAnalyzer && app.waveformVisualizer && currentAudioBuffer) {
            const newRegions = app.vadAnalyzer.recalculateSpeechRegions(currentVadResults.probabilities, {
                frameSamples: currentVadResults.frameSamples,
                sampleRate: currentVadResults.sampleRate,
                positiveSpeechThreshold: app.state.params.vadPositive,
                negativeSpeechThreshold: app.state.params.vadNegative,
                redemptionFrames: currentVadResults.redemptionFrames
            });
            app.uiManager.setSpeechRegionsText(newRegions);
            app.waveformVisualizer.redrawWaveformHighlight(currentAudioBuffer, newRegions);
        }
        if (debouncedUpdateUrlHash) debouncedUpdateUrlHash();
    }

    function handlePlaybackEnded() {
        console.log("App: Playback ended event received.");
        app.state.updateStatus('isActuallyPlaying', false);
        stopUIUpdateLoop();
        app.state.updateRuntime('playbackStartTimeContext', null);
        const audioBuffer = app.state.runtime.currentAudioBuffer;
        if (audioBuffer) {
            app.state.updateRuntime('playbackStartSourceTime', audioBuffer.duration);
            updateUIWithTime(audioBuffer.duration);
        }
        app.state.updateStatus('playbackNaturallyEnded', true);
        app.uiManager.setPlayButtonState(false);
        if (debouncedUpdateUrlHash) debouncedUpdateUrlHash();
    }

    function handlePlaybackStateChange(e) {
        const workletIsPlaying = e.detail.isPlaying;
        const wasPlaying = app.state.status.isActuallyPlaying;
        app.state.updateStatus('isActuallyPlaying', workletIsPlaying);
        app.uiManager.setPlayButtonState(workletIsPlaying);
        if (workletIsPlaying) {
            const audioCtx = app.audioEngine?.getAudioContext();
            if (!wasPlaying && audioCtx) {
                const audioBuffer = app.state.runtime.currentAudioBuffer;
                if (app.state.status.playbackNaturallyEnded && audioBuffer) {
                    app.state.updateRuntime('playbackStartSourceTime', 0);
                    app.state.updateStatus('playbackNaturallyEnded', false);
                } else {
                    app.state.updateRuntime('playbackStartSourceTime', app.audioEngine.getCurrentTime().currentTime);
                }
                app.state.updateRuntime('playbackStartTimeContext', audioCtx.currentTime);
                updateUIWithTime(app.state.runtime.playbackStartSourceTime);
            }
            startUIUpdateLoop();
        } else {
            stopUIUpdateLoop();
            app.state.updateRuntime('playbackStartTimeContext', null);
        }
    }

    function handleKeyPress(e) {
        if (!app.state.status.workletPlaybackReady) return;
        const key = e.detail.key;
        // const jumpTimeValue = app.uiManager.getJumpTime(); // Removed
        switch (key) {
            case 'Space':
                handlePlayPause();
                break;
            // ArrowLeft and ArrowRight cases are removed as they are handled by uiManager
            // and dispatch 'audioapp:jumpClicked' directly.
        }
    }

    function handleWindowResize() {
        const regions = app.state.runtime.currentVadResults?.regions || [];
        app.waveformVisualizer?.resizeAndRedraw(app.state.runtime.currentAudioBuffer, regions);
        app.spectrogramVisualizer?.resizeAndRedraw(app.state.runtime.currentAudioBuffer);
    }

    function handleBeforeUnload() {
        console.log("App: Unloading...");
        stopUIUpdateLoop();
        app.audioEngine?.cleanup();
    }

    function startUIUpdateLoop() {
        if (rAFUpdateHandle === null) {
            rAFUpdateHandle = requestAnimationFrame(updateUIBasedOnContextTime);
        }
    }

    function stopUIUpdateLoop() {
        if (rAFUpdateHandle !== null) {
            cancelAnimationFrame(rAFUpdateHandle);
            rAFUpdateHandle = null;
        }
    }

    function calculateEstimatedSourceTime() {
        const audioCtx = app.audioEngine?.getAudioContext();
        const audioBuffer = app.state.runtime.currentAudioBuffer;
        const duration = audioBuffer ? audioBuffer.duration : 0;
        if (!app.state.status.isActuallyPlaying || app.state.runtime.playbackStartTimeContext === null ||
            !audioCtx || !audioBuffer || duration <= 0 || app.state.runtime.currentSpeedForUpdate <= 0) {
            return app.state.runtime.playbackStartSourceTime;
        }
        const elapsedContextTime = audioCtx.currentTime - app.state.runtime.playbackStartTimeContext;
        const elapsedSourceTime = elapsedContextTime * app.state.runtime.currentSpeedForUpdate;
        let estimatedCurrentSourceTime = app.state.runtime.playbackStartSourceTime + elapsedSourceTime;
        return Math.max(0, Math.min(estimatedCurrentSourceTime, duration));
    }

    function updateUIWithTime(time) {
        const audioBuffer = app.state.runtime.currentAudioBuffer;
        const duration = audioBuffer ? audioBuffer.duration : 0;
        if (isNaN(duration)) return;
        const clampedTime = Math.max(0, Math.min(time, duration));
        const fraction = duration > 0 ? clampedTime / duration : 0;
        app.uiManager.updateTimeDisplay(clampedTime, duration);
        app.uiManager.updateSeekBar(fraction);
        app.waveformVisualizer?.updateProgressIndicator(clampedTime, duration);
        app.spectrogramVisualizer?.updateProgressIndicator(clampedTime, duration);
    }

    function updateUIBasedOnContextTime(timestamp) {
        if (!app.state.status.isActuallyPlaying) {
            rAFUpdateHandle = null;
            return;
        }
        const estimatedTime = calculateEstimatedSourceTime();
        updateUIWithTime(estimatedTime);
        rAFUpdateHandle = requestAnimationFrame(updateUIBasedOnContextTime);
    }

    // --- REFACTORED: Attach init function to the passed-in 'app' object ---
    app.init = init;

})(AudioApp); // Immediately execute, passing the global AudioApp object.
// --- /vibe-player/js/app.js ---