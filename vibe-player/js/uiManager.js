// --- /vibe-player/js/uiManager.js ---
// Handles DOM manipulation, UI event listeners, and dispatches UI events.

var AudioApp = AudioApp || {}; // Ensure namespace exists

AudioApp.uiManager = (function() {
    'use strict';

    // --- DOM Element References ---
    // File/Info
    /** @type {HTMLButtonElement|null} */ let chooseFileButton;
    /** @type {HTMLInputElement|null} */ let hiddenAudioFile; // Renamed from fileInput
    /** @type {HTMLSpanElement|null} */ let fileNameDisplay;
    /** @type {HTMLParagraphElement|null} */ let fileInfo;
    /** @type {HTMLDivElement|null} */ let vadProgressContainer; // VAD Progress Bar

    // Buttons
    /** @type {HTMLButtonElement|null} */ let playPauseButton;
    /** @type {HTMLButtonElement|null} */ let jumpBackButton;
    /** @type {HTMLButtonElement|null} */ let jumpForwardButton;
    /** @type {HTMLInputElement|null} */ let jumpTimeInput;
    // Time & Seek
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
    /** @type {CanvasRenderingContext2D|null} */ let waveformCtx; // Context reference
    /** @type {HTMLCanvasElement|null} */ let spectrogramCanvas;
    /** @type {CanvasRenderingContext2D|null} */ let spectrogramCtx; // Context reference
    /** @type {HTMLSpanElement|null} */ let spectrogramSpinner;
    /** @type {HTMLDivElement|null} */ let waveformProgressIndicator;
    /** @type {HTMLDivElement|null} */ let spectrogramProgressIndicator;
    /** @type {HTMLSpanElement|null} */ let waveformVadIndicator; // Indicator on waveform canvas
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
        vadProgressContainer = document.getElementById('vadProgressContainer'); // Get progress bar

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
        if (waveformCanvas) waveformCtx = waveformCanvas.getContext('2d'); // Get context
        spectrogramCanvas = document.getElementById('spectrogramCanvas');
         if (spectrogramCanvas) spectrogramCtx = spectrogramCanvas.getContext('2d'); // Get context
        spectrogramSpinner = document.getElementById('spectrogramSpinner');
        waveformProgressIndicator = document.getElementById('waveformProgressIndicator');
        spectrogramProgressIndicator = document.getElementById('spectrogramProgressIndicator');
        waveformVadIndicator = document.getElementById('waveformVadIndicator'); // Get waveform overlay

        // Speech Info (even if hidden, might be needed for debugging later)
        speechRegionsDisplay = document.getElementById('speechRegionsDisplay');

        // Simple check including new element
        if (!chooseFileButton || !hiddenAudioFile || !playPauseButton || !seekBar || !playbackSpeedControl || !vadProgressContainer) {
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
        // File Input
        chooseFileButton?.addEventListener('click', () => {
            hiddenAudioFile?.click();
        });
        hiddenAudioFile?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) {
                updateFileName(file.name);
                dispatchUIEvent('audioapp:fileSelected', { file: file });
            } else {
                updateFileName(""); // Use empty string if no file chosen
            }
        });

        // Seek Bar Input
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
     * @private
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
    /** Handles keydown for shortcuts. @param {KeyboardEvent} e @private */
     function handleKeyDown(e) {
         const target = e.target;
         // Ignore keydowns if focused on an input/textarea
         const isTextInput = target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'number' || target.type === 'search' || target.type === 'email' || target.type === 'password' || target.type === 'url');
         const isTextArea = target instanceof HTMLTextAreaElement;
         if (isTextInput || isTextArea) return;

         let handled = false;
         let eventKey = null;
         switch (e.code) {
             case 'Space': eventKey = 'Space'; handled = true; break;
             case 'ArrowLeft': eventKey = 'ArrowLeft'; handled = true; break;
             case 'ArrowRight': eventKey = 'ArrowRight'; handled = true; break;
         }
         if (eventKey) {
             dispatchUIEvent('audioapp:keyPressed', { key: eventKey });
         }
         if (handled) {
             e.preventDefault(); // Prevent default actions like space scrolling
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
                sliderElement.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    }

    // --- Helper to Dispatch Custom Events ---
    /** Dispatches event on document. @param {string} eventName @param {object} [detail={}] @private */
    function dispatchUIEvent(eventName, detail = {}) {
        document.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
    }

    // --- Public Methods for Updating UI ---

    /**
     * Resets UI elements to their initial state (e.g., on file load or error).
     * @public
     */
    function resetUI() {
        console.log("UIManager: Resetting UI");
        updateFileName(""); // Clear file name
        setFileInfo("No file selected.");
        setPlayButtonState(false);
        updateTimeDisplay(0, 0);
        updateSeekBar(0); // Reset seek bar position
        setSpeechRegionsText("None");
        updateVadDisplay(0.5, 0.35, true); // Reset VAD display
        showWaveformVadIndicator(false); // Hide VAD overlay
        showVadProgress(false); // Hide VAD progress bar
        if (vadProgressContainer) vadProgressContainer.innerHTML = ''; // Clear progress segments

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

        // Disable controls that require loaded audio
        enablePlaybackControls(false);
        enableSeekBar(false);
        enableVadControls(false);
    }

    /**
     * Sets the text in the file name display span.
     * @param {string} text - The file name or status text.
     * @public
     */
    function updateFileName(text) {
        if (fileNameDisplay) {
            fileNameDisplay.textContent = text;
            fileNameDisplay.title = text; // Add tooltip for long names
        }
    }

    /**
     * Sets the file info/status text paragraph.
     * @param {string} text - The status message.
     * @public
     */
    function setFileInfo(text) {
        if (fileInfo) {
            fileInfo.textContent = text;
            fileInfo.title = text; // Add tooltip for potentially clipped text
        }
    }

    /**
     * Sets the text of the play/pause button.
     * @param {boolean} isPlaying - True if audio is currently playing.
     * @public
     */
    function setPlayButtonState(isPlaying) {
        if (playPauseButton) {
            playPauseButton.textContent = isPlaying ? 'Pause' : 'Play';
        }
    }

    /**
     * Updates the time display (e.g., "0:15 / 1:30").
     * @param {number} currentTime - The current playback time in seconds.
     * @param {number} duration - The total audio duration in seconds.
     * @public
     */
    function updateTimeDisplay(currentTime, duration) {
        if (timeDisplay) {
            timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
        }
    }

    /**
     * Updates the visual position of the seek bar.
     * @param {number} fraction - Playback progress fraction (0.0 to 1.0).
     * @public
     */
    function updateSeekBar(fraction) {
        if (seekBar) {
             const clampedFraction = Math.max(0, Math.min(1, fraction));
             // Only update if the value actually changes significantly to avoid feedback loops
             if (Math.abs(parseFloat(seekBar.value) - clampedFraction) > 1e-6 ) {
                 seekBar.value = String(clampedFraction);
             }
        }
    }

    /**
     * Sets the text content of the speech regions display element.
     * @param {string | Array<{start: number, end: number}>} regionsOrText - Text or array of regions.
     * @public
     */
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

    /**
     * Updates the VAD threshold sliders and their value displays.
     * @param {number} positive - The positive threshold value.
     * @param {number} negative - The negative threshold value.
     * @param {boolean} [isNA=false] - If true, displays "N/A" instead of values.
     * @public
     */
    function updateVadDisplay(positive, negative, isNA = false) {
        if (isNA) {
            if (vadThresholdValueDisplay) vadThresholdValueDisplay.textContent = "N/A";
            if (vadNegativeThresholdValueDisplay) vadNegativeThresholdValueDisplay.textContent = "N/A";
            // Reset sliders to default visually even if displaying N/A
            if (vadThresholdSlider) vadThresholdSlider.value = "0.5";
            if (vadNegativeThresholdSlider) vadNegativeThresholdSlider.value = "0.35";
        } else {
            if (vadThresholdSlider) vadThresholdSlider.value = String(positive);
            if (vadThresholdValueDisplay) vadThresholdValueDisplay.textContent = positive.toFixed(2);
            if (vadNegativeThresholdSlider) vadNegativeThresholdSlider.value = String(negative);
            if (vadNegativeThresholdValueDisplay) vadNegativeThresholdValueDisplay.textContent = negative.toFixed(2);
        }
    }

    /**
     * Enables or disables main playback control buttons and sliders.
     * @param {boolean} enable - True to enable, false to disable.
     * @public
     */
    function enablePlaybackControls(enable) {
        if (playPauseButton) playPauseButton.disabled = !enable;
        if (jumpBackButton) jumpBackButton.disabled = !enable;
        if (jumpForwardButton) jumpForwardButton.disabled = !enable;
        if (playbackSpeedControl) playbackSpeedControl.disabled = !enable;
        if (pitchControl) pitchControl.disabled = !enable;
        if (formantControl) formantControl.disabled = !enable;
        // Note: Gain control is usually always enabled.
    }

    /**
     * Enables or disables the main seek bar.
     * @param {boolean} enable - True to enable, false to disable.
     * @public
     */
     function enableSeekBar(enable) {
         if (seekBar) seekBar.disabled = !enable;
     }

    /**
     * Enables or disables the VAD threshold sliders.
     * @param {boolean} enable - True to enable, false to disable.
     * @public
     */
    function enableVadControls(enable) {
        if (vadThresholdSlider) vadThresholdSlider.disabled = !enable;
        if (vadNegativeThresholdSlider) vadNegativeThresholdSlider.disabled = !enable;
    }

    /**
     * Gets the current jump time value from the input field.
     * @returns {number} The jump time in seconds.
     * @public
     */
    function getJumpTime() {
        return parseFloat(jumpTimeInput?.value) || 5; // Default to 5s if input is invalid
    }

    /**
     * Formats time in seconds to a "M:SS" string.
     * @param {number} sec - Time in seconds.
     * @returns {string} Formatted time string.
     * @private
     */
    function formatTime(sec) {
        if (isNaN(sec) || sec < 0) sec = 0;
        const minutes = Math.floor(sec / 60);
        const seconds = Math.floor(sec % 60);
        return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`; // Add leading zero to seconds if needed
    }

    /**
     * Shows or hides the VAD analysis indicator on the waveform canvas.
     * @param {boolean} show - True to show, false to hide.
     * @public
     */
    function showWaveformVadIndicator(show) {
        if (waveformVadIndicator) {
            waveformVadIndicator.style.display = show ? 'inline-block' : 'none';
        }
    }


    // --- VAD Segmented Progress Bar Functions ---

    /**
     * Initializes the VAD progress bar by creating the segment elements.
     * @param {number} totalSegments - The total number of segments to display.
     * @public
     */
    function initVadProgress(totalSegments) {
        if (!vadProgressContainer) return;
        vadProgressContainer.innerHTML = ''; // Clear previous segments
        const count = Math.max(0, Math.floor(totalSegments));
        const fragment = document.createDocumentFragment(); // Use fragment for efficiency
        for (let i = 0; i < count; i++) {
            const segment = document.createElement('div');
            segment.className = 'vad-progress-segment';
            fragment.appendChild(segment);
        }
        vadProgressContainer.appendChild(fragment);
    }

    /**
     * Updates the VAD progress bar to show a certain number of filled segments.
     * @param {number} filledSegments - The number of segments that should appear filled.
     * @public
     */
    function updateVadProgress(filledSegments) {
        if (!vadProgressContainer) return;
        const segments = vadProgressContainer.children;
        const count = segments.length;
        if (count === 0) return; // Avoid errors if not initialized
        const filledCount = Math.max(0, Math.min(Math.floor(filledSegments), count)); // Clamp value

        // Optimize by only changing classes if needed
        for (let i = 0; i < count; i++) {
            const segment = segments[i];
            const shouldBeFilled = i < filledCount;
            const isFilled = segment.classList.contains('filled');
            if (shouldBeFilled && !isFilled) {
                segment.classList.add('filled');
            } else if (!shouldBeFilled && isFilled) {
                segment.classList.remove('filled');
            }
        }
    }

    /**
     * Shows or hides the VAD progress bar container.
     * @param {boolean} show - True to show, false to hide.
     * @public
     */
    function showVadProgress(show) {
        if (vadProgressContainer) {
            vadProgressContainer.style.display = show ? 'block' : 'none';
        }
    }


    // --- Public Interface ---
    return {
        init: init,
        resetUI: resetUI,
        setFileInfo: setFileInfo,
        updateFileName: updateFileName, // Expose filename update
        setPlayButtonState: setPlayButtonState,
        updateTimeDisplay: updateTimeDisplay,
        updateSeekBar: updateSeekBar,
        setSpeechRegionsText: setSpeechRegionsText,
        updateVadDisplay: updateVadDisplay,
        enablePlaybackControls: enablePlaybackControls,
        enableSeekBar: enableSeekBar,
        enableVadControls: enableVadControls,
        getJumpTime: getJumpTime,
        showWaveformVadIndicator: showWaveformVadIndicator, // Keep overlay indicator function for now
        // Expose VAD progress functions
        initVadProgress: initVadProgress,
        updateVadProgress: updateVadProgress,
        showVadProgress: showVadProgress
    };
})(); // End of uiManager IIFE
// --- /vibe-player/js/uiManager.js ---
