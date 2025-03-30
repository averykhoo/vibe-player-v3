// --- /vibe-player/js/uiManager.js ---
// Handles DOM manipulation, UI event listeners, and dispatches UI events.

var AudioApp = AudioApp || {}; // Ensure namespace exists

AudioApp.uiManager = (function() {
    'use strict';

    // --- DOM Element References ---
    // File/Info
    /** @type {HTMLButtonElement|null} */ let chooseFileButton;
    /** @type {HTMLInputElement|null} */ let hiddenAudioFile;
    /** @type {HTMLSpanElement|null} */ let fileNameDisplay;
    /** @type {HTMLParagraphElement|null} */ let fileInfo;
    /** @type {HTMLDivElement|null} */ let vadProgressContainer; // Reference to the outer div
    /** @type {HTMLSpanElement|null} */ let vadProgressBar;      // Reference to the inner span

    // Buttons
    /** @type {HTMLButtonElement|null} */ let playPauseButton;
    /** @type {HTMLButtonElement|null} */ let jumpBackButton;
    /** @type {HTMLButtonElement|null} */ let jumpForwardButton;
    /** @type {HTMLInputElement|null} */ let jumpTimeInput;
    // Time & Seek
    /** @type {HTMLDivElement|null} */ let timeDisplay;
    /** @type {HTMLInputElement|null} */ let seekBar;
    // Sliders & Displays & Markers
    /** @type {HTMLInputElement|null} */ let playbackSpeedControl;
    /** @type {HTMLSpanElement|null} */ let speedValueDisplay;
    /** @type {HTMLDivElement|null} */ let speedMarkers;
    /** @type {HTMLInputElement|null} */ let pitchControl;
    /** @type {HTMLSpanElement|null} */ let pitchValueDisplay;
    /** @type {HTMLDivElement|null} */ let pitchMarkers;
    /** @type {HTMLInputElement|null} */ let formantControl; // Keep reference if needed later
    /** @type {HTMLSpanElement|null} */ let formantValueDisplay; // Keep reference if needed later
    /** @type {HTMLDivElement|null} */ let formantMarkers; // Keep reference if needed later
    /** @type {HTMLInputElement|null} */ let gainControl;
    /** @type {HTMLSpanElement|null} */ let gainValueDisplay;
    /** @type {HTMLDivElement|null} */ let gainMarkers;
    /** @type {HTMLInputElement|null} */ let vadThresholdSlider;
    /** @type {HTMLSpanElement|null} */ let vadThresholdValueDisplay;
    /** @type {HTMLInputElement|null} */ let vadNegativeThresholdSlider;
    /** @type {HTMLSpanElement|null} */ let vadNegativeThresholdValueDisplay;
    // Visuals
    /** @type {HTMLCanvasElement|null} */ let waveformCanvas;
    /** @type {CanvasRenderingContext2D|null} */ let waveformCtx;
    /** @type {HTMLCanvasElement|null} */ let spectrogramCanvas;
    /** @type {CanvasRenderingContext2D|null} */ let spectrogramCtx;
    /** @type {HTMLSpanElement|null} */ let spectrogramSpinner;
    /** @type {HTMLDivElement|null} */ let waveformProgressIndicator; // Refers to the RED line overlay, not VAD bar
    /** @type {HTMLDivElement|null} */ let spectrogramProgressIndicator; // Refers to the RED line overlay, not VAD bar
    // VAD Output
    /** @type {HTMLPreElement|null} */ let speechRegionsDisplay;

    // --- Initialization ---
    /** @public */
    function init() {
        console.log("UIManager: Initializing...");
        assignDOMElements();
        initializeSliderMarkers();
        setupEventListeners();
        resetUI();
        console.log("UIManager: Initialized.");
    }

    // --- DOM Element Assignment ---
    /** @private */
    function assignDOMElements() {
        // File Handling
        chooseFileButton = document.getElementById('chooseFileButton');
        hiddenAudioFile = document.getElementById('hiddenAudioFile');
        fileNameDisplay = document.getElementById('fileNameDisplay');
        fileInfo = document.getElementById('fileInfo');
        vadProgressContainer = document.getElementById('vadProgressContainer'); // Get container
        vadProgressBar = document.getElementById('vadProgressBar');          // Get inner bar span

        // Playback
        playPauseButton = document.getElementById('playPause');
        jumpBackButton = document.getElementById('jumpBack');
        jumpForwardButton = document.getElementById('jumpForward');
        jumpTimeInput = document.getElementById('jumpTime');

        // Seek & Time
        seekBar = document.getElementById('seekBar');
        timeDisplay = document.getElementById('timeDisplay');

        // Slider groups
        playbackSpeedControl = document.getElementById('playbackSpeed');
        speedValueDisplay = document.getElementById('speedValue');
        speedMarkers = document.getElementById('speedMarkers');
        pitchControl = document.getElementById('pitchControl');
        pitchValueDisplay = document.getElementById('pitchValue');
        pitchMarkers = document.getElementById('pitchMarkers');
        // formantControl = document.getElementById('formantControl'); // Keep commented if not used
        // formantValueDisplay = document.getElementById('formantValue'); // Keep commented if not used
        // formantMarkers = document.getElementById('formantMarkers'); // Keep commented if not used
        gainControl = document.getElementById('gainControl');
        gainValueDisplay = document.getElementById('gainValue');
        gainMarkers = document.getElementById('gainMarkers');

        // VAD sliders
        vadThresholdSlider = document.getElementById('vadThreshold');
        vadThresholdValueDisplay = document.getElementById('vadThresholdValue');
        vadNegativeThresholdSlider = document.getElementById('vadNegativeThreshold');
        vadNegativeThresholdValueDisplay = document.getElementById('vadNegativeThresholdValue');

        // Visuals
        waveformCanvas = document.getElementById('waveformCanvas');
        if (waveformCanvas) waveformCtx = waveformCanvas.getContext('2d');
        spectrogramCanvas = document.getElementById('spectrogramCanvas');
         if (spectrogramCanvas) spectrogramCtx = spectrogramCanvas.getContext('2d');
        spectrogramSpinner = document.getElementById('spectrogramSpinner');
        waveformProgressIndicator = document.getElementById('waveformProgressIndicator');
        spectrogramProgressIndicator = document.getElementById('spectrogramProgressIndicator');
        // waveformVadIndicator removed ref

        // Speech Info
        speechRegionsDisplay = document.getElementById('speechRegionsDisplay');

        // Check essential elements for the new progress bar
        if (!vadProgressContainer || !vadProgressBar ) {
             console.warn("UIManager: Could not find VAD progress bar elements!");
        }
        // Check other essential elements
        if (!chooseFileButton || !hiddenAudioFile || !playPauseButton || !seekBar || !playbackSpeedControl) {
             console.warn("UIManager: Could not find all required UI elements!");
        }
    }

    // --- Slider Marker Positioning ---
    /** @private */
    function initializeSliderMarkers() {
        const markerConfigs = [
            { slider: playbackSpeedControl, markersDiv: speedMarkers },
            { slider: pitchControl, markersDiv: pitchMarkers },
            // { slider: formantControl, markersDiv: formantMarkers }, // Keep commented if not used
            { slider: gainControl, markersDiv: gainMarkers }
        ];
        markerConfigs.forEach(config => {
            const { slider, markersDiv } = config;
            if (!slider || !markersDiv) return;
            const min = parseFloat(slider.min);
            const max = parseFloat(slider.max);
            const range = max - min;
            if (range <= 0) return;
            const markers = markersDiv.querySelectorAll('span[data-value]');
            markers.forEach(span => {
                const value = parseFloat(span.dataset.value);
                if (!isNaN(value)) {
                    const percent = ((value - min) / range) * 100;
                    span.style.left = `${percent}%`;
                }
            });
        });
    }

    // --- Event Listener Setup ---
    /** @private */
    function setupEventListeners() {
        chooseFileButton?.addEventListener('click', () => {
            hiddenAudioFile?.click();
        });
        hiddenAudioFile?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) {
                updateFileName(file.name);
                dispatchUIEvent('audioapp:fileSelected', { file: file });
            } else {
                updateFileName("");
            }
        });
        seekBar?.addEventListener('input', (e) => {
            const target = /** @type {HTMLInputElement} */ (e.target);
            const fraction = parseFloat(target.value);
            if (!isNaN(fraction)) {
                dispatchUIEvent('audioapp:seekBarInput', { fraction: fraction });
            }
        });
        playPauseButton?.addEventListener('click', () => dispatchUIEvent('audioapp:playPauseClicked'));
        jumpBackButton?.addEventListener('click', () => dispatchUIEvent('audioapp:jumpClicked', { seconds: -getJumpTime() }));
        jumpForwardButton?.addEventListener('click', () => dispatchUIEvent('audioapp:jumpClicked', { seconds: getJumpTime() }));

        setupSliderListeners(playbackSpeedControl, speedValueDisplay, 'audioapp:speedChanged', 'speed', 'x');
        setupSliderListeners(pitchControl, pitchValueDisplay, 'audioapp:pitchChanged', 'pitch', 'x');
        // setupSliderListeners(formantControl, formantValueDisplay, 'audioapp:formantChanged', 'formant', 'x'); // Keep commented
        setupSliderListeners(gainControl, gainValueDisplay, 'audioapp:gainChanged', 'gain', 'x');

        speedMarkers?.addEventListener('click', (e) => handleMarkerClick(e, playbackSpeedControl));
        pitchMarkers?.addEventListener('click', (e) => handleMarkerClick(e, pitchControl));
        // formantMarkers?.addEventListener('click', (e) => handleMarkerClick(e, formantControl)); // Keep commented
        gainMarkers?.addEventListener('click', (e) => handleMarkerClick(e, gainControl));

        vadThresholdSlider?.addEventListener('input', handleVadSliderInput);
        vadNegativeThresholdSlider?.addEventListener('input', handleVadSliderInput);

        document.addEventListener('keydown', handleKeyDown);
    }
    /** @private */
    function setupSliderListeners(slider, valueDisplay, eventName, detailKey, suffix = '') {
        if (!slider || !valueDisplay) return;
        slider.addEventListener('input', () => {
            const value = parseFloat(slider.value);
            valueDisplay.textContent = value.toFixed(2) + suffix;
            dispatchUIEvent(eventName, { [detailKey]: value });
        });
    }
    /** @private */
    function handleKeyDown(e) {
        const target = e.target;
        const isTextInput = target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'number' || target.type === 'search' || target.type === 'email' || target.type === 'password' || target.type === 'url');
        const isTextArea = target instanceof HTMLTextAreaElement;
        if (isTextInput || isTextArea) return; // Ignore inputs in text fields

        let handled = false;
        let eventKey = null;

        switch (e.code) {
            case 'Space':
                eventKey = 'Space';
                handled = true;
                break;
            case 'ArrowLeft':
                eventKey = 'ArrowLeft';
                handled = true;
                break;
            case 'ArrowRight':
                eventKey = 'ArrowRight';
                handled = true;
                break;
        }

        if (eventKey) {
            dispatchUIEvent('audioapp:keyPressed', { key: eventKey });
        }
        if (handled) {
            e.preventDefault();
        }
    }
    /** @private */
    function handleVadSliderInput(e) {
        const slider = /** @type {HTMLInputElement} */ (e.target);
        const value = parseFloat(slider.value);
        let type = null;

        if (slider === vadThresholdSlider && vadThresholdValueDisplay) {
            vadThresholdValueDisplay.textContent = value.toFixed(2);
            type = 'positive';
        } else if (slider === vadNegativeThresholdSlider && vadNegativeThresholdValueDisplay) {
            vadNegativeThresholdValueDisplay.textContent = value.toFixed(2);
            type = 'negative';
        }

        if (type) {
            dispatchUIEvent('audioapp:thresholdChanged', { type: type, value: value });
        }
    }
    /** @private */
     function handleMarkerClick(event, sliderElement) {
        if (!sliderElement || sliderElement.disabled) return;
        const target = event.target;
        if (target instanceof HTMLElement && target.tagName === 'SPAN' && target.dataset.value) {
            const value = parseFloat(target.dataset.value);
            if (!isNaN(value)) {
                sliderElement.value = String(value);
                // Trigger the 'input' event manually to update display and dispatch change
                sliderElement.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    }
    /** @private */
    function dispatchUIEvent(eventName, detail = {}) {
        document.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
    }

    // --- Public Methods for Updating UI ---
    /** @public */
    function resetUI() {
        console.log("UIManager: Resetting UI");
        updateFileName("");
        setFileInfo("No file selected.");
        setPlayButtonState(false);
        updateTimeDisplay(0, 0);
        updateSeekBar(0);
        setSpeechRegionsText("None");
        updateVadDisplay(0.5, 0.35, true); // Reset VAD slider displays to N/A
        showVadProgress(false); // Hide the bar initially (will be shown during VAD)
        updateVadProgress(0);   // Reset bar width

        // Reset sliders to default values and update their displays
        if (playbackSpeedControl) playbackSpeedControl.value = "1.0"; if (speedValueDisplay) speedValueDisplay.textContent = "1.00x";
        if (pitchControl) pitchControl.value = "1.0"; if (pitchValueDisplay) pitchValueDisplay.textContent = "1.00x";
        // if (formantControl) formantControl.value = "1.0"; if (formantValueDisplay) formantValueDisplay.textContent = "1.00x"; // Keep commented
        if (gainControl) gainControl.value = "1.0"; if (gainValueDisplay) gainValueDisplay.textContent = "1.00x";
        if (jumpTimeInput) jumpTimeInput.value = "5";

        // Disable controls that require audio
        enablePlaybackControls(false);
        enableSeekBar(false);
        enableVadControls(false); // VAD sliders disabled initially
    }
    /** @public @param {string} text */
    function updateFileName(text) {
        if (fileNameDisplay) {
            fileNameDisplay.textContent = text;
            fileNameDisplay.title = text; // Set title for hover tooltip on long names
        }
    }
    /** @public @param {string} text */
    function setFileInfo(text) {
        if (fileInfo) {
            fileInfo.textContent = text;
            fileInfo.title = text; // Set title for hover tooltip
        }
    }
    /** @public @param {boolean} isPlaying */
    function setPlayButtonState(isPlaying) {
        if (playPauseButton) playPauseButton.textContent = isPlaying ? 'Pause' : 'Play';
    }
    /** @public @param {number} currentTime @param {number} duration */
    function updateTimeDisplay(currentTime, duration) {
        if (timeDisplay) timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    }
    /** @public @param {number} fraction */
    function updateSeekBar(fraction) {
        if (seekBar) {
            const clampedFraction = Math.max(0, Math.min(1, fraction));
            // Only update if the value changes significantly (prevents feedback loops)
            if (Math.abs(parseFloat(seekBar.value) - clampedFraction) > 1e-6 ) { // Use a small tolerance
                 seekBar.value = String(clampedFraction);
            }
        }
    }
    /** @public @param {string | Array<{start: number, end: number}>} regionsOrText */
    function setSpeechRegionsText(regionsOrText) {
        if (!speechRegionsDisplay) return;
        if (typeof regionsOrText === 'string') {
            speechRegionsDisplay.textContent = regionsOrText;
        } else if (Array.isArray(regionsOrText)) {
             if (regionsOrText.length > 0) {
                 speechRegionsDisplay.textContent = regionsOrText
                    .map(r => `Start: ${r.start.toFixed(2)}s, End: ${r.end.toFixed(2)}s`)
                    .join('\n');
             } else {
                 speechRegionsDisplay.textContent = "No speech detected.";
             }
        } else {
             speechRegionsDisplay.textContent = "None";
        }
    }
    /** @public @param {number} positive @param {number} negative @param {boolean} [isNA=false] */
    function updateVadDisplay(positive, negative, isNA = false) {
        if (isNA) {
            if (vadThresholdValueDisplay) vadThresholdValueDisplay.textContent = "N/A";
            if (vadNegativeThresholdValueDisplay) vadNegativeThresholdValueDisplay.textContent = "N/A";
            // Optionally reset sliders to default visual position when N/A
            if (vadThresholdSlider) vadThresholdSlider.value = "0.5";
            if (vadNegativeThresholdSlider) vadNegativeThresholdSlider.value = "0.35";
        } else {
            if (vadThresholdSlider) vadThresholdSlider.value = String(positive);
            if (vadThresholdValueDisplay) vadThresholdValueDisplay.textContent = positive.toFixed(2);
            if (vadNegativeThresholdSlider) vadNegativeThresholdSlider.value = String(negative);
            if (vadNegativeThresholdValueDisplay) vadNegativeThresholdValueDisplay.textContent = negative.toFixed(2);
        }
    }
    /** @public @param {boolean} enable */
    function enablePlaybackControls(enable) {
        if (playPauseButton) playPauseButton.disabled = !enable;
        if (jumpBackButton) jumpBackButton.disabled = !enable;
        if (jumpForwardButton) jumpForwardButton.disabled = !enable;
        if (playbackSpeedControl) playbackSpeedControl.disabled = !enable;
        if (pitchControl) pitchControl.disabled = !enable;
        // if (formantControl) formantControl.disabled = !enable; // Keep commented
        // Gain control is usually always enabled, manage separately if needed
        // if (gainControl) gainControl.disabled = !enable;
    }
    /** @public @param {boolean} enable */
     function enableSeekBar(enable) {
        if (seekBar) seekBar.disabled = !enable;
    }
    /** @public @param {boolean} enable */
    function enableVadControls(enable) {
        if (vadThresholdSlider) vadThresholdSlider.disabled = !enable;
        if (vadNegativeThresholdSlider) vadNegativeThresholdSlider.disabled = !enable;
         // Reset display to N/A if disabling
        if (!enable) { updateVadDisplay(0.5, 0.35, true); }
    }
    /** @public @returns {number} */
    function getJumpTime() {
        return parseFloat(jumpTimeInput?.value) || 5;
    }
    /** @private @param {number} sec @returns {string} */
    function formatTime(sec) {
        if (isNaN(sec) || sec < 0) sec = 0;
        const minutes = Math.floor(sec / 60);
        const seconds = Math.floor(sec % 60);
        return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
    }


    // --- MODIFIED: VAD Progress Bar Functions ---

    /**
     * Updates the 98.css VAD progress bar width.
     * @param {number} percentage - The progress percentage (0 to 100).
     * @public
     */
    function updateVadProgress(percentage) {
        if (!vadProgressBar) {
             // console.error("[uiManager] updateVadProgress: vadProgressBar is null!"); // Keep console cleaner
             return;
        }
        const clampedPercentage = Math.max(0, Math.min(100, percentage)); // Ensure 0-100
        // console.log(`[uiManager] updateVadProgress: Setting width to ${clampedPercentage.toFixed(1)}%`); // Debug log
        vadProgressBar.style.width = `${clampedPercentage}%`;
    }

    /**
     * Shows or hides the VAD progress bar container.
     * NOTE: CSS currently keeps it visible (`display: block`), this function can override that if needed.
     * @param {boolean} show - True to show, false to hide.
     * @public
     */
    function showVadProgress(show) {
        if (!vadProgressContainer) {
            // console.error("[uiManager] showVadProgress: vadProgressContainer is null!"); // Keep console cleaner
            return;
        }
        // Let CSS control visibility primarily, but allow JS override if needed
        // vadProgressContainer.style.display = show ? 'block' : 'none';
        // For now, just ensure it's visible when explicitly asked to show
        if (show) {
             vadProgressContainer.style.display = 'block';
        } else {
             // If hiding is needed later, uncomment the line below or adjust CSS
             // vadProgressContainer.style.display = 'none';
        }
    }


    // --- Public Interface ---
    return {
        init: init,
        resetUI: resetUI,
        setFileInfo: setFileInfo,
        updateFileName: updateFileName,
        setPlayButtonState: setPlayButtonState,
        updateTimeDisplay: updateTimeDisplay,
        updateSeekBar: updateSeekBar,
        setSpeechRegionsText: setSpeechRegionsText,
        updateVadDisplay: updateVadDisplay,
        enablePlaybackControls: enablePlaybackControls,
        enableSeekBar: enableSeekBar,
        enableVadControls: enableVadControls,
        getJumpTime: getJumpTime,
        // Expose VAD progress functions
        updateVadProgress: updateVadProgress,
        showVadProgress: showVadProgress
    };
})();
// --- /vibe-player/js/uiManager.js ---
