// --- START OF FILE ui-controller.js ---
'use strict';

/**
 * Main UI Controller for the Web Audio Player.
 * Initializes modules, handles user interactions, updates the UI,
 * and orchestrates the overall application flow.
 * Depends on PlayerCore, VADManager, WaveformVisualizer, SpectrogramVisualizer, Utils.
 */
(function() {

    // --- DOM Element References ---
    let fileInput, fileInfo, playPauseButton, jumpBackButton, jumpForwardButton,
        jumpTimeInput, playbackSpeedControl, speedValueDisplay, gainControl,
        gainValueDisplay, timeDisplay, waveformCanvas, spectrogramCanvas,
        spectrogramSpinner, waveformProgressIndicator, spectrogramProgressIndicator,
        speechRegionsDisplay, vadThresholdSlider, vadThresholdValueDisplay,
        vadNegativeThresholdSlider, vadNegativeThresholdValueDisplay;
    // Note: audioEl is managed internally by PlayerCore

    // --- Module References ---
    // Assume PlayerCore, VADManager, etc. are available globally via window.*
    const PCore = window.PlayerCore;
    const VADM = window.VADManager;
    const WV = window.WaveformVisualizer;
    const SV = window.SpectrogramVisualizer;
    const U = window.Utils;

    // --- State ---
    let decodedBuffer = null; // Store the original decoded AudioBuffer
    let currentObjectURL = null; // Manage Blob URL

    // =============================================
    // == INITIALIZATION & SETUP ==
    // =============================================

    function init() {
        console.log("UIController: Initializing...");
        if (!assignDOMElements()) {
             console.error("UIController: Failed to find critical DOM elements. Aborting.");
             alert("Error: Could not initialize player UI elements.");
             return;
        }
        if (!checkDependencies()) {
             console.error("UIController: Missing required modules (PlayerCore, VADManager, etc.). Aborting.");
             alert("Error: Required player modules not loaded.");
             return;
        }

        PCore.init(document.getElementById('player')); // Initialize PlayerCore with the audio element
        setupEventListeners();
        resetUIState(); // Set initial UI state (disabled buttons etc.)
        window.addEventListener('resize', handleResize);
        console.log("UIController: Initialized.");
    }

    function checkDependencies() {
        return PCore && VADM && WV && SV && U;
    }

    function assignDOMElements() {
        // Select all elements needed for UI interaction
        fileInput = document.getElementById('audioFile');
        fileInfo = document.getElementById('fileInfo');
        playPauseButton = document.getElementById('playPause');
        jumpBackButton = document.getElementById('jumpBack');
        jumpForwardButton = document.getElementById('jumpForward');
        jumpTimeInput = document.getElementById('jumpTime');
        playbackSpeedControl = document.getElementById('playbackSpeed');
        speedValueDisplay = document.getElementById('speedValue');
        gainControl = document.getElementById('gainControl');
        gainValueDisplay = document.getElementById('gainValue');
        timeDisplay = document.getElementById('timeDisplay');
        waveformCanvas = document.getElementById('waveformCanvas');
        spectrogramCanvas = document.getElementById('spectrogramCanvas');
        spectrogramSpinner = document.getElementById('spectrogramSpinner');
        waveformProgressIndicator = document.getElementById('waveformProgressIndicator');
        spectrogramProgressIndicator = document.getElementById('spectrogramProgressIndicator');
        speechRegionsDisplay = document.getElementById('speechRegionsDisplay');
        vadThresholdSlider = document.getElementById('vadThreshold');
        vadThresholdValueDisplay = document.getElementById('vadThresholdValue');
        vadNegativeThresholdSlider = document.getElementById('vadNegativeThreshold');
        vadNegativeThresholdValueDisplay = document.getElementById('vadNegativeThresholdValue');

        // Check if critical elements were found
        return fileInput && playPauseButton && waveformCanvas && spectrogramCanvas && timeDisplay;
    }

    function setupEventListeners() {
        // File loading
        fileInput.addEventListener('change', handleFileLoad);

        // Playback Controls
        playPauseButton.addEventListener('click', handlePlayPauseClick);
        jumpBackButton.addEventListener('click', () => handleJumpClick(-getJumpTime()));
        jumpForwardButton.addEventListener('click', () => handleJumpClick(getJumpTime()));
        playbackSpeedControl.addEventListener('input', handleSpeedChange);
        gainControl.addEventListener('input', handleGainChange);

        // Canvas Seeking
        [waveformCanvas, spectrogramCanvas].forEach(canvas => {
            if (canvas) canvas.addEventListener('click', handleCanvasClick);
        });

        // VAD Controls
        if (vadThresholdSlider) vadThresholdSlider.addEventListener('input', handleVADThresholdChange);
        if (vadNegativeThresholdSlider) vadNegativeThresholdSlider.addEventListener('input', handleVADThresholdChange);
        if (speechRegionsDisplay) speechRegionsDisplay.addEventListener('click', handleRegionClick);
        if (speechRegionsDisplay) speechRegionsDisplay.addEventListener('keydown', handleRegionKeydown);


        // Keyboard Shortcuts
        document.addEventListener('keydown', handleKeyDown);

        // Listen to PlayerCore events
        PCore.on('timeupdate', handleTimeUpdate);
        PCore.on('statechange', handlePlayerStateChange);
        PCore.on('ready', handlePlayerReady);
        PCore.on('loadstart', handlePlayerLoadStart);
        PCore.on('error', handlePlayerError);

        // Cleanup
        window.addEventListener('beforeunload', () => {
            if (currentObjectURL) {
                URL.revokeObjectURL(currentObjectURL);
            }
            PCore.cleanup(); // Ask PlayerCore to clean up
        });
    }

    // =============================================
    // == EVENT HANDLERS ==
    // =============================================

    // --- File Loading Handler ---
    async function handleFileLoad(e) {
        const file = e.target.files[0];
        if (!file) return;

        console.log("UIController: File selected:", file.name);
        fileInfo.textContent = `File: ${file.name}`;

        // Reset everything
        resetAppStateAndUI();
        showSpinner(true); // Show spectrogram spinner

        // Manage Object URL
        if (currentObjectURL) URL.revokeObjectURL(currentObjectURL);
        currentObjectURL = URL.createObjectURL(file);

        // Load into PlayerCore
        PCore.load(currentObjectURL); // PlayerCore will emit 'loadstart', 'ready', 'error'

        // Unfocus input
        if (fileInput) fileInput.blur();

        // --- Decoding and Analysis (happens *after* PlayerCore signals readiness, or independently?)
        // Let's decode independently to get buffer for visuals/VAD ASAP.
        try {
            const arrayBuffer = await file.arrayBuffer();
            // Use AudioContext directly for decoding (PlayerCore doesn't expose this)
            const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
            decodedBuffer = await tempCtx.decodeAudioData(arrayBuffer);
            await tempCtx.close(); // Close temporary context
            console.log(`UIController: Decoded ${decodedBuffer.duration.toFixed(2)}s audio.`);

            // Now perform VAD analysis
            fileInfo.textContent = `Analyzing VAD...`;
            const pcm16kMono = await U.convertAudioBufferTo16kHzMonoFloat32(decodedBuffer);
            const vadSuccess = await VADM.analyze(pcm16kMono); // Use default options initially

            if (vadSuccess) {
                updateVADControlsState(); // Update slider values/enable based on VADM state
                updateSpeechRegionsDisplay(); // Update region list
                fileInfo.textContent = `File: ${file.name}`; // Restore file info
            } else {
                 fileInfo.textContent = `File: ${file.name} (VAD Analysis Failed)`;
            }

            // Initial draw of visuals now that we have buffer and VAD results
            drawWaveform();
            await drawSpectrogram(); // This is async

        } catch (err) {
            console.error('UIController: Error processing file:', err);
            const errorMsg = `Error processing file: ${err.message || err}`;
            fileInfo.textContent = errorMsg;
            alert(`Could not process audio file: ${errorMsg}`);
            resetAppStateAndUI();
            if (currentObjectURL) { URL.revokeObjectURL(currentObjectURL); currentObjectURL = null; }
        } finally {
             showSpinner(false);
        }
    }


    // --- PlayerCore Event Handlers ---
    function handleTimeUpdate({ currentTime, duration }) {
        // Update time display
        if (timeDisplay) timeDisplay.textContent = `${U.formatTime(currentTime)} / ${U.formatTime(duration)}`;
        // Update progress bars
        const fraction = duration > 0 ? currentTime / duration : 0;
        updateProgressIndicator(waveformProgressIndicator, waveformCanvas, fraction);
        updateProgressIndicator(spectrogramProgressIndicator, spectrogramCanvas, fraction);
    }

    function handlePlayerStateChange({ state }) {
        console.log("UIController: Player state change -", state);
        // Update Play/Pause button text
        if (playPauseButton) {
            playPauseButton.textContent = (state === 'playing') ? 'Pause' : 'Play';
        }
    }

    function handlePlayerReady({ duration }) {
        console.log("UIController: Player ready, duration =", duration);
        // Enable playback controls if buffer also decoded (safety check)
        if (decodedBuffer) {
             enablePlaybackControls(true);
        }
        // Update UI with final duration
        handleTimeUpdate({ currentTime: PCore.getCurrentTime(), duration: duration });
        // Trigger initial waveform draw if buffer ready but visuals not drawn yet?
        // Usually handleFileLoad coordinates this.
    }

    function handlePlayerLoadStart() {
        console.log("UIController: Player load start.");
        // Reset time display, disable controls (part of resetAppStateAndUI)
        timeDisplay.textContent = "0:00 / 0:00";
        updateProgressIndicator(waveformProgressIndicator, waveformCanvas, 0);
        updateProgressIndicator(spectrogramProgressIndicator, spectrogramCanvas, 0);
    }

    function handlePlayerError({ message, details }) {
        console.error("UIController: PlayerCore reported error:", message, details);
        fileInfo.textContent = `Playback Error: ${message}`;
        resetAppStateAndUI(); // Reset state on playback error
    }

    // --- UI Control Handlers ---
    function handlePlayPauseClick() {
        if (PCore.getIsPlaying()) {
            PCore.pause();
        } else {
            PCore.play();
        }
    }

    function handleJumpClick(seconds) {
        const currentTime = PCore.getCurrentTime();
        PCore.seek(currentTime + seconds);
    }

    function handleSpeedChange(e) {
        const speed = parseFloat(e.target.value);
        PCore.setSpeed(speed);
        if (speedValueDisplay) speedValueDisplay.textContent = speed.toFixed(2) + "x";
    }

    function handleGainChange(e) {
        const volume = parseFloat(e.target.value);
        PCore.setVolume(volume);
        if (gainValueDisplay) gainValueDisplay.textContent = volume.toFixed(2) + "x";
    }

    function handleCanvasClick(e) {
        if (!PCore.getIsReady() || PCore.getDuration() <= 0) return;
        const canvas = e.target;
        const rect = canvas.getBoundingClientRect();
        const clickXRelative = e.clientX - rect.left;
        const fraction = clickXRelative / rect.width;
        const newTime = fraction * PCore.getDuration();
        PCore.seek(newTime);
    }

    // --- VAD UI Handlers ---
    function handleVADThresholdChange(e) {
        if (!VADM.getHasAnalyzed()) return; // Only if VAD ran

        const slider = e.target;
        const newValue = parseFloat(slider.value);
        let needsRecalc = false;

        if (slider.id === 'vadThreshold') {
            if (vadThresholdValueDisplay) vadThresholdValueDisplay.textContent = newValue.toFixed(2);
            // Use VADM.setThresholds which handles update and triggers recalc
             needsRecalc = VADM.setThresholds(newValue, VADM.getCurrentNegativeThreshold());
        } else if (slider.id === 'vadNegativeThreshold') {
            if (vadNegativeThresholdValueDisplay) vadNegativeThresholdValueDisplay.textContent = newValue.toFixed(2);
             needsRecalc = VADM.setThresholds(VADM.getCurrentPositiveThreshold(), newValue);
        }

        if (needsRecalc) {
            // Update UI based on new regions from VADM
            updateSpeechRegionsDisplay();
            // Redraw waveform with new regions
            drawWaveform();
        }
    }

     function handleRegionClick(e) {
        const targetElement = e.target;
        if (targetElement.classList.contains('speech-region-link')) {
            const startTime = parseFloat(targetElement.dataset.startTime);
            if (!isNaN(startTime)) {
                PCore.seek(startTime);
            }
        }
    }

    function handleRegionKeydown(e) {
        if (e.code === 'Enter' || e.code === 'Space') {
            const targetElement = e.target;
            if (targetElement.classList.contains('speech-region-link')) {
                e.preventDefault();
                const startTime = parseFloat(targetElement.dataset.startTime);
                if (!isNaN(startTime)) {
                    PCore.seek(startTime);
                }
            }
        }
    }


    // --- Keyboard Shortcut Handler ---
    function handleKeyDown(e) {
        // Ignore if typing in input fields (allow range/number)
        if (e.target.tagName === 'INPUT' && !['range', 'number'].includes(e.target.type)) return;
        if (!PCore.getIsReady()) return; // Ignore if player not ready

        let handled = false;
        switch (e.code) {
            case 'Space':
                if (e.target.tagName !== 'INPUT') { handlePlayPauseClick(); handled = true; }
                break;
            case 'ArrowLeft':
                handleJumpClick(-getJumpTime()); handled = true;
                break;
            case 'ArrowRight':
                 handleJumpClick(getJumpTime()); handled = true;
                break;
        }
        if (handled) e.preventDefault();
    }

    // --- Resize Handler ---
    function handleResize() {
        // Debounce resize? For now, simple immediate resize.
        console.log("UIController: Window resized.");
        // Resize canvases based on CSS
        let waveformResized = resizeCanvas(waveformCanvas);
        let spectrogramResized = resizeCanvas(spectrogramCanvas);

        // Redraw based on new size
        if (waveformResized && decodedBuffer) {
            drawWaveform(); // Redraw waveform
        }
        if (spectrogramResized) {
             SV.redrawFromCache(spectrogramCanvas); // Redraw spectrogram from cache
        }
        // Update progress bars for new size
        handleTimeUpdate({currentTime: PCore.getCurrentTime(), duration: PCore.getDuration()});
    }


    // =============================================
    // == UI UPDATE & HELPER FUNCTIONS ==
    // =============================================

    function getJumpTime() {
        return parseFloat(jumpTimeInput.value) || 5;
    }

    function resizeCanvas(canvas) {
        if (!canvas) return false;
        const { width, height } = canvas.getBoundingClientRect();
        const roundedWidth = Math.max(10, Math.round(width));
        const roundedHeight = Math.max(10, Math.round(height));
        if (canvas.width !== roundedWidth || canvas.height !== roundedHeight) {
            canvas.width = roundedWidth;
            canvas.height = roundedHeight;
            console.log(`UIController: Resized ${canvas.id} to ${canvas.width}x${canvas.height}`);
            return true;
        }
        return false;
    }

    function updateProgressIndicator(indicator, canvas, fraction) {
        if (indicator && canvas) {
            const canvasWidth = canvas.clientWidth;
            if (canvasWidth > 0) {
                indicator.style.left = (fraction * canvasWidth) + "px";
            } else {
                indicator.style.left = "0px";
            }
        }
    }

    function showSpinner(show) {
         if (spectrogramSpinner) {
             spectrogramSpinner.style.display = show ? 'inline' : 'none';
         }
    }

    function enablePlaybackControls(enable) {
         playPauseButton.disabled = !enable;
         jumpBackButton.disabled = !enable;
         jumpForwardButton.disabled = !enable;
         playbackSpeedControl.disabled = !enable;
         // Gain control might always be enabled?
         // gainControl.disabled = !enable;
    }

    function enableVADControls(enable) {
        if(vadThresholdSlider) vadThresholdSlider.disabled = !enable;
        if(vadNegativeThresholdSlider) vadNegativeThresholdSlider.disabled = !enable;
    }

    function resetUIState() {
        // Reset displays
        timeDisplay.textContent = "0:00 / 0:00";
        fileInfo.textContent = "No file selected.";
        if (speedValueDisplay) speedValueDisplay.textContent = (1.0).toFixed(2) + "x";
        if (gainValueDisplay) gainValueDisplay.textContent = (1.0).toFixed(2) + "x";
        if (playbackSpeedControl) playbackSpeedControl.value = 1.0;
        if (gainControl) gainControl.value = 1.0;

        // Reset progress
        updateProgressIndicator(waveformProgressIndicator, waveformCanvas, 0);
        updateProgressIndicator(spectrogramProgressIndicator, spectrogramCanvas, 0);

        // Reset VAD UI
        if (vadThresholdValueDisplay) vadThresholdValueDisplay.textContent = "N/A";
        if (vadNegativeThresholdValueDisplay) vadNegativeThresholdValueDisplay.textContent = "N/A";
        if (speechRegionsDisplay) {
             speechRegionsDisplay.innerHTML = '<p>None</p>';
             speechRegionsDisplay.removeEventListener('keydown', handleRegionKeydown);
        }

        // Clear visuals
        if (waveformCanvas) WV.draw(waveformCanvas, [], [], 0); // Clear waveform
        if (spectrogramCanvas) SV.clear(spectrogramCanvas); // Clear spectrogram display

        // Disable controls
        enablePlaybackControls(false);
        enableVADControls(false);
    }

    function resetAppStateAndUI() {
         // Reset modules
         PCore.cleanup(); // Important to clean up old audio source/context if reloading
         PCore.init(document.getElementById('player')); // Re-init PlayerCore
         VADM.reset();
         SV.clear(spectrogramCanvas); // Clear spectrogram cache & display

         // Reset state variables
         decodedBuffer = null;
         if (currentObjectURL) { URL.revokeObjectURL(currentObjectURL); currentObjectURL = null; }

         // Reset UI
         resetUIState();
    }

    function updateVADControlsState() {
         if (VADM.getHasAnalyzed()) {
             const pos = VADM.getCurrentPositiveThreshold();
             const neg = VADM.getCurrentNegativeThreshold();
             if (vadThresholdSlider) { vadThresholdSlider.value = pos; vadThresholdSlider.disabled = false; }
             if (vadThresholdValueDisplay) vadThresholdValueDisplay.textContent = pos.toFixed(2);
             if (vadNegativeThresholdSlider) { vadNegativeThresholdSlider.value = neg; vadNegativeThresholdSlider.disabled = false; }
             if (vadNegativeThresholdValueDisplay) vadNegativeThresholdValueDisplay.textContent = neg.toFixed(2);
         } else {
             enableVADControls(false);
             if (vadThresholdValueDisplay) vadThresholdValueDisplay.textContent = "N/A";
             if (vadNegativeThresholdValueDisplay) vadNegativeThresholdValueDisplay.textContent = "N/A";
         }
    }

     function updateSpeechRegionsDisplay() {
        if (!speechRegionsDisplay) return;
        speechRegionsDisplay.innerHTML = ''; // Clear previous
        speechRegionsDisplay.removeEventListener('keydown', handleRegionKeydown); // Remove old listener

        const regions = VADM.getRegions(); // Get current regions from VADManager

        if (regions.length > 0) {
            regions.forEach(region => {
                const el = document.createElement('span');
                el.classList.add('speech-region-link');
                el.textContent = `Start: ${region.start.toFixed(2)}s, End: ${region.end.toFixed(2)}s`;
                el.dataset.startTime = region.start;
                el.setAttribute('role', 'button');
                el.setAttribute('tabindex', '0');
                speechRegionsDisplay.appendChild(el);
            });
            speechRegionsDisplay.addEventListener('keydown', handleRegionKeydown); // Add listener back
        } else {
            const placeholder = document.createElement('p');
            placeholder.textContent = "No speech detected (at current thresholds).";
            speechRegionsDisplay.appendChild(placeholder);
        }
    }

    // --- Drawing Functions ---
    function drawWaveform() {
        if (!decodedBuffer || !waveformCanvas) return;
        const waveformData = WV.computeData(decodedBuffer, waveformCanvas.width);
        WV.draw(waveformCanvas, waveformData, VADM.getRegions(), decodedBuffer.duration);
    }

    async function drawSpectrogram() {
         if (!decodedBuffer || !spectrogramCanvas) return;
         showSpinner(true);
         try {
            // Check cache first? SV handles caching internally now.
            // Compute data (potentially slow)
            const specData = SV.computeData(decodedBuffer);
            if (specData) {
                 // Draw async (also potentially slow, updates cache)
                 await SV.drawAsync(spectrogramCanvas, specData, decodedBuffer.sampleRate);
            } else {
                 console.warn("UIController: Spectrogram data computation failed.");
                 // Optionally display error on canvas
            }
         } catch (error) {
             console.error("UIController: Error drawing spectrogram", error);
         } finally {
              showSpinner(false);
         }
    }


    // --- Run Initialization ---
    document.addEventListener('DOMContentLoaded', init);

})();
// --- END OF FILE ui-controller.js ---