// --- /vibe-player/js/uiManager.js ---
// Handles DOM manipulation, UI event listeners, and dispatches UI events.

var AudioApp = AudioApp || {}; // Ensure namespace exists

AudioApp.uiManager = (function() {
    'use strict';

    // --- DOM Element References ---
    // File/Info (Updated)
    /** @type {HTMLButtonElement|null} */ let chooseFileButton;
    /** @type {HTMLInputElement|null} */ let hiddenAudioFile; // Renamed from fileInput
    /** @type {HTMLSpanElement|null} */ let fileNameDisplay;
    /** @type {HTMLParagraphElement|null} */ let fileInfo;
    // Buttons
    /** @type {HTMLButtonElement|null} */ let playPauseButton;
    /** @type {HTMLButtonElement|null} */ let jumpBackButton;
    /** @type {HTMLButtonElement|null} */ let jumpForwardButton;
    /** @type {HTMLInputElement|null} */ let jumpTimeInput;
    // Time & Seek (Updated)
    /** @type {HTMLDivElement|null} */ let timeDisplay;
    /** @type {HTMLInputElement|null} */ let seekBar; // New seek bar
    // Sliders & Displays & Markers
    /** @type {HTMLInputElement|null} */ let playbackSpeedControl;
    /** @type {HTMLSpanElement|null} */ let speedValueDisplay;
    /** @type {HTMLDivElement|null} */ let speedMarkers;
    /** @type {HTMLInputElement|null} */ let pitchControl;
    /** @type {HTMLSpanElement|null} */ let pitchValueDisplay;
    /** @type {HTMLDivElement|null} */ let pitchMarkers;
    /** @type {HTMLInputElement|null} */ let formantControl;
    /** @type {HTMLSpanElement|null} */ let formantValueDisplay;
    /** @type {HTMLDivElement|null} */ let formantMarkers;
    /** @type {HTMLInputElement|null} */ let gainControl;
    /** @type {HTMLSpanElement|null} */ let gainValueDisplay;
    /** @type {HTMLDivElement|null} */ let gainMarkers;
    /** @type {HTMLInputElement|null} */ let vadThresholdSlider;
    /** @type {HTMLSpanElement|null} */ let vadThresholdValueDisplay;
    /** @type {HTMLInputElement|null} */ let vadNegativeThresholdSlider;
    /** @type {HTMLSpanElement|null} */ let vadNegativeThresholdValueDisplay;
    // Visuals
    /** @type {HTMLCanvasElement|null} */ let waveformCanvas;
    /** @type {HTMLCanvasElement|null} */ let spectrogramCanvas;
    /** @type {HTMLSpanElement|null} */ let spectrogramSpinner;
    /** @type {HTMLDivElement|null} */ let waveformProgressIndicator;
    /** @type {HTMLDivElement|null} */ let spectrogramProgressIndicator;
    // VAD Output
    /** @type {HTMLPreElement|null} */ let speechRegionsDisplay; // Still referenced even if hidden

    // --- Initialization ---

    /**
     * Initializes the UI Manager: finds elements, sets up listeners, positions markers.
     * @public
     */
    function init() {
        console.log("UIManager: Initializing...");
        assignDOMElements();
        initializeSliderMarkers(); // Position the markers based on slider range
        setupEventListeners();
        resetUI();
        console.log("UIManager: Initialized.");
    }

    // --- DOM Element Assignment ---

    /**
     * Gets references to all needed DOM elements by their ID.
     * @private
     */
    function assignDOMElements() {
        // File Handling
        chooseFileButton = document.getElementById('chooseFileButton');
        hiddenAudioFile = document.getElementById('hiddenAudioFile');
        fileNameDisplay = document.getElementById('fileNameDisplay');
        fileInfo = document.getElementById('fileInfo');

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

        formantControl = document.getElementById('formantControl');
        formantValueDisplay = document.getElementById('formantValue');
        formantMarkers = document.getElementById('formantMarkers');

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
        spectrogramCanvas = document.getElementById('spectrogramCanvas');
        spectrogramSpinner = document.getElementById('spectrogramSpinner');
        waveformProgressIndicator = document.getElementById('waveformProgressIndicator');
        spectrogramProgressIndicator = document.getElementById('spectrogramProgressIndicator');

        // Speech Info (even if hidden, might be needed for debugging later)
        speechRegionsDisplay = document.getElementById('speechRegionsDisplay');

        // Simple check
        if (!chooseFileButton || !hiddenAudioFile || !playPauseButton || !seekBar || !playbackSpeedControl ) {
             console.warn("UIManager: Could not find all required UI elements!");
        }
    }

    // --- Slider Marker Positioning ---

    /**
     * Calculates and sets the absolute position of slider markers based on their value.
     * @private
     */
    function initializeSliderMarkers() {
        const markerConfigs = [
            { slider: playbackSpeedControl, markersDiv: speedMarkers },
            { slider: pitchControl, markersDiv: pitchMarkers },
            { slider: formantControl, markersDiv: formantMarkers },
            { slider: gainControl, markersDiv: gainMarkers }
            // Note: VAD sliders don't have markers in this setup
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

    /**
     * Sets up event listeners for user interactions on UI elements.
     * @private
     */
    function setupEventListeners() {
        // --- File Input (New Logic) ---
        chooseFileButton?.addEventListener('click', () => {
            hiddenAudioFile?.click(); // Trigger click on hidden input
        });

        hiddenAudioFile?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) {
                updateFileName(file.name); // Update display span
                dispatchUIEvent('audioapp:fileSelected', { file: file });
            } else {
                updateFileName("No file chosen");
            }
            // Optional: Blur button after selection?
            // chooseFileButton?.blur();
        });

        // --- Seek Bar Input ---
        seekBar?.addEventListener('input', (e) => {
            const target = e.target;
            const fraction = parseFloat(target.value);
            if (!isNaN(fraction)) {
                dispatchUIEvent('audioapp:seekBarInput', { fraction: fraction });
            }
        });


        // Playback Buttons
        playPauseButton?.addEventListener('click', () => dispatchUIEvent('audioapp:playPauseClicked'));
        jumpBackButton?.addEventListener('click', () => dispatchUIEvent('audioapp:jumpClicked', { seconds: -getJumpTime() }));
        jumpForwardButton?.addEventListener('click', () => dispatchUIEvent('audioapp:jumpClicked', { seconds: getJumpTime() }));

        // Sliders
        setupSliderListeners(playbackSpeedControl, speedValueDisplay, 'audioapp:speedChanged', 'speed', 'x');
        setupSliderListeners(pitchControl, pitchValueDisplay, 'audioapp:pitchChanged', 'pitch', 'x');
        setupSliderListeners(formantControl, formantValueDisplay, 'audioapp:formantChanged', 'formant', 'x');
        setupSliderListeners(gainControl, gainValueDisplay, 'audioapp:gainChanged', 'gain', 'x');

        // Marker Clicks
        speedMarkers?.addEventListener('click', (e) => handleMarkerClick(e, playbackSpeedControl));
        pitchMarkers?.addEventListener('click', (e) => handleMarkerClick(e, pitchControl));
        formantMarkers?.addEventListener('click', (e) => handleMarkerClick(e, formantControl));
        gainMarkers?.addEventListener('click', (e) => handleMarkerClick(e, gainControl));

        // VAD Tuning Sliders
        vadThresholdSlider?.addEventListener('input', handleVadSliderInput);
        vadNegativeThresholdSlider?.addEventListener('input', handleVadSliderInput);

        // Global Keyboard Shortcuts
        document.addEventListener('keydown', handleKeyDown);
    }

    /**
     * Helper to set up input listener for a slider.
     * @param {HTMLInputElement | null} slider
     * @param {HTMLSpanElement | null} valueDisplay
     * @param {string} eventName
     * @param {string} detailKey
     * @param {string} [suffix=''] - Suffix for the value display (e.g., 'x')
     */
    function setupSliderListeners(slider, valueDisplay, eventName, detailKey, suffix = '') {
        if (!slider || !valueDisplay) return;

        slider.addEventListener('input', () => {
            const value = parseFloat(slider.value);
            valueDisplay.textContent = value.toFixed(2) + suffix;
            dispatchUIEvent(eventName, { [detailKey]: value });
        });
    }

     // --- Specific Event Handlers ---
    /** Handles keydown. @param {KeyboardEvent} e @private */
     function handleKeyDown(e) {
         const target = e.target;
         // Ignore keydowns if focused on an input/textarea
         const isTextInput = target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'number' || target.type === 'search' || target.type === 'email' || target.type === 'password' || target.type === 'url');
         const isTextArea = target instanceof HTMLTextAreaElement;
         if (isTextInput || isTextArea) return;

         let handled = false;
         let eventKey = null;
         switch (e.code) {
             case 'Space':
                 eventKey = 'Space'; handled = true; break;
             case 'ArrowLeft':
                 eventKey = 'ArrowLeft'; handled = true; break;
             case 'ArrowRight':
                 eventKey = 'ArrowRight'; handled = true; break;
         }
         if (eventKey) {
             dispatchUIEvent('audioapp:keyPressed', { key: eventKey });
         }
         if (handled) {
             e.preventDefault(); // Prevent space scrolling, arrow key moving range inputs etc.
         }
     }
    /** Handles VAD slider input. @param {Event} e @private */
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
    /** Handles marker clicks. @param {MouseEvent} event @param {HTMLInputElement | null} sliderElement @private */
    function handleMarkerClick(event, sliderElement) {
        if (!sliderElement || sliderElement.disabled) return;
        const target = event.target;
        if (target instanceof HTMLElement && target.tagName === 'SPAN' && target.dataset.value) {
            const value = parseFloat(target.dataset.value);
            if (!isNaN(value)) {
                sliderElement.value = String(value);
                // Dispatch input event to trigger slider logic and event dispatch
                sliderElement.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    }

    // --- Helper to Dispatch Custom Events ---
    /** Dispatches event. @param {string} eventName @param {object} [detail={}] @private */
    function dispatchUIEvent(eventName, detail = {}) {
        // console.log(`UIManager: Dispatching ${eventName}`, detail); // Debug logging
        document.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
    }

    // --- Public Methods for Updating UI ---

    /**
     * Resets UI elements to their initial state.
     * @public
     */
    function resetUI() {
        console.log("UIManager: Resetting UI");
        updateFileName("No file chosen"); // Reset file name display
        setFileInfo("No file selected.");
        setPlayButtonState(false);
        updateTimeDisplay(0, 0);
        updateSeekBar(0); // Reset seek bar position
        setSpeechRegionsText("None");
        updateVadDisplay(0.5, 0.35, true);

        // Reset sliders to default values and update displays
        if (playbackSpeedControl) playbackSpeedControl.value = "1.0";
        if (speedValueDisplay) speedValueDisplay.textContent = "1.00x";
        if (pitchControl) pitchControl.value = "1.0";
        if (pitchValueDisplay) pitchValueDisplay.textContent = "1.00x";
        if (formantControl) formantControl.value = "1.0";
        if (formantValueDisplay) formantValueDisplay.textContent = "1.00x";
        if (gainControl) gainControl.value = "1.0";
        if (gainValueDisplay) gainValueDisplay.textContent = "1.00x";
        if (jumpTimeInput) jumpTimeInput.value = "5";

        enablePlaybackControls(false);
        enableSeekBar(false); // Disable seek bar initially
        enableVadControls(false);
    }

    /**
     * Sets the text in the file name display span.
     * @param {string} text
     * @public
     */
    function updateFileName(text) {
        if (fileNameDisplay) {
            fileNameDisplay.textContent = text;
        }
    }

    /** Sets file info text. @param {string} text @public */
    function setFileInfo(text) {
        if (fileInfo) fileInfo.textContent = text;
    }
    /** Sets play/pause button text. @param {boolean} isPlaying @public */
    function setPlayButtonState(isPlaying) {
        if (playPauseButton) playPauseButton.textContent = isPlaying ? 'Pause' : 'Play';
    }
    /** Updates time display. @param {number} currentTime @param {number} duration @public */
    function updateTimeDisplay(currentTime, duration) {
        if (timeDisplay) timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    }

    /**
     * Updates the seek bar's position.
     * @param {number} fraction - Playback progress fraction (0.0 to 1.0).
     * @public
     */
    function updateSeekBar(fraction) {
        if (seekBar) {
             // Ensure value is within range [0, 1]
             const clampedFraction = Math.max(0, Math.min(1, fraction));
             // Only update if the value actually changes to avoid feedback loops
             if (parseFloat(seekBar.value) !== clampedFraction) {
                seekBar.value = String(clampedFraction);
             }
        }
    }

    /** Sets speech regions text (in hidden pre element). @param {string | Array<{start: number, end: number}>} regionsOrText @public */
    function setSpeechRegionsText(regionsOrText) {
        if (!speechRegionsDisplay) return; // Element might be removed if never used
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

    /** Updates VAD displays. @param {number} positive @param {number} negative @param {boolean} [isNA=false] @public */
    function updateVadDisplay(positive, negative, isNA = false) {
        if (isNA) {
            if (vadThresholdValueDisplay) vadThresholdValueDisplay.textContent = "N/A";
            if (vadNegativeThresholdValueDisplay) vadNegativeThresholdValueDisplay.textContent = "N/A";
            if (vadThresholdSlider) vadThresholdSlider.value = "0.5";
            if (vadNegativeThresholdSlider) vadNegativeThresholdSlider.value = "0.35";
        } else {
            if (vadThresholdSlider) vadThresholdSlider.value = String(positive);
            if (vadThresholdValueDisplay) vadThresholdValueDisplay.textContent = positive.toFixed(2);
            if (vadNegativeThresholdSlider) vadNegativeThresholdSlider.value = String(negative);
            if (vadNegativeThresholdValueDisplay) vadNegativeThresholdValueDisplay.textContent = negative.toFixed(2);
        }
    }

    /** Enables/disables playback controls. @param {boolean} enable @public */
    function enablePlaybackControls(enable) {
        if (playPauseButton) playPauseButton.disabled = !enable;
        if (jumpBackButton) jumpBackButton.disabled = !enable;
        if (jumpForwardButton) jumpForwardButton.disabled = !enable;
        if (playbackSpeedControl) playbackSpeedControl.disabled = !enable;
        if (pitchControl) pitchControl.disabled = !enable;
        if (formantControl) formantControl.disabled = !enable;
        // Gain is always enabled
    }

    /**
     * Enables/disables the seek bar.
     * @param {boolean} enable
     * @public
     */
     function enableSeekBar(enable) {
         if (seekBar) seekBar.disabled = !enable;
     }

    /** Enables/disables VAD controls. @param {boolean} enable @public */
    function enableVadControls(enable) {
        if (vadThresholdSlider) vadThresholdSlider.disabled = !enable;
        if (vadNegativeThresholdSlider) vadNegativeThresholdSlider.disabled = !enable;
    }

    /** Gets jump time value. @returns {number} @public */
    function getJumpTime() {
        return parseFloat(jumpTimeInput?.value) || 5;
    }

    /** Formats time. @param {number} sec @returns {string} @private */
    function formatTime(sec) {
        if (isNaN(sec) || sec < 0) sec = 0;
        const minutes = Math.floor(sec / 60);
        const seconds = Math.floor(sec % 60);
        return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
    }

    // --- Public Interface ---
    return {
        init: init,
        resetUI: resetUI,
        setFileInfo: setFileInfo,
        setPlayButtonState: setPlayButtonState,
        updateTimeDisplay: updateTimeDisplay,
        setSpeechRegionsText: setSpeechRegionsText, // Keep even if hidden, for debug
        updateVadDisplay: updateVadDisplay,
        enablePlaybackControls: enablePlaybackControls,
        enableVadControls: enableVadControls,
        getJumpTime: getJumpTime,
        // New exports:
        updateSeekBar: updateSeekBar,
        updateFileName: updateFileName,
        enableSeekBar: enableSeekBar
    };
})(); // End of uiManager IIFE
// --- /vibe-player/js/uiManager.js ---
