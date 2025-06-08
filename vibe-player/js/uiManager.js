// --- /vibe-player/js/uiManager.js ---
// Handles DOM manipulation, UI event listeners, and dispatches UI events.

/** @namespace AudioApp */
var AudioApp = AudioApp || {}; // Ensure namespace exists

/**
 * @namespace AudioApp.uiManager
 * @description Manages UI elements, interactions, and events for the Vibe Player.
 */
AudioApp.uiManager = (function() {
    'use strict';

    // === Module Dependencies ===
    /**
     * @private
     * @type {AudioApp.Utils} Reference to the Utils module.
     */
    const Utils = AudioApp.Utils;

    // --- DOM Element References ---
    // File/Info
    /** @type {HTMLButtonElement|null} Button to trigger file selection. */
    let chooseFileButton = null;
    /** @type {HTMLInputElement|null} Hidden input element for file selection. */
    let hiddenAudioFile = null;
    /** @type {HTMLInputElement|null} Input element for audio URL. */
    let audioUrlInput = null;
    /** @type {HTMLButtonElement|null} Button to load audio from URL. */
    let loadUrlButton = null;
    /** @type {HTMLSpanElement|null} Span to display URL loading errors. */
    let urlLoadingErrorDisplay = null;
    /** @type {HTMLSpanElement|null} Span to display the current file name. */
    let fileNameDisplay = null;
    /** @type {HTMLParagraphElement|null} Paragraph to display file information or status messages. */
    let fileInfo = null;
    /** @type {HTMLDivElement|null} Container for the VAD progress bar. */
    let vadProgressContainer = null;
    /** @type {HTMLSpanElement|null} The VAD progress bar element itself. */
    let vadProgressBar = null;
    /** @type {HTMLDivElement|null} Div to display detected DTMF tones. */
    let dtmfDisplay = null;
    /** @type {HTMLDivElement|null} Div to display detected Call Progress Tones. */
    let cptDisplayElement = null;

    // Drop Zone
    /** @type {HTMLDivElement|null} Overlay for drag-and-drop functionality. */
    let dropZoneOverlay = null;
    /** @type {HTMLDivElement|null} Message displayed within the drop zone. */
    let dropZoneMessage = null;

    // Buttons
    /** @type {HTMLButtonElement|null} Button to play or pause audio. */
    let playPauseButton = null;
    /** @type {HTMLButtonElement|null} Button to jump backward in audio. */
    let jumpBackButton = null;
    /** @type {HTMLButtonElement|null} Button to jump forward in audio. */
    let jumpForwardButton = null;
    /** @type {HTMLInputElement|null} Input for specifying jump time in seconds. */
    let jumpTimeInput = null;

    // Time & Seek
    /** @type {HTMLDivElement|null} Div to display current time and duration. */
    let timeDisplay = null;
    /** @type {HTMLInputElement|null} Seek bar (slider) for audio playback. */
    let seekBar = null;

    // Sliders & Displays & Markers
    /** @type {HTMLInputElement|null} Slider for playback speed control. */
    let playbackSpeedControl = null;
    /** @type {HTMLSpanElement|null} Span to display current playback speed value. */
    let speedValueDisplay = null;
    /** @type {HTMLDivElement|null} Container for speed slider markers. */
    let speedMarkers = null;
    /** @type {HTMLInputElement|null} Slider for pitch control. */
    let pitchControl = null;
    /** @type {HTMLSpanElement|null} Span to display current pitch value. */
    let pitchValueDisplay = null;
    /** @type {HTMLDivElement|null} Container for pitch slider markers. */
    let pitchMarkers = null;
    // Formant controls are referenced but not actively used in current logic, kept for potential future use.
    /** @type {HTMLInputElement|null} */ let formantControl = null;
    /** @type {HTMLSpanElement|null} */ let formantValueDisplay = null;
    /** @type {HTMLDivElement|null} */ let formantMarkers = null;
    /** @type {HTMLInputElement|null} Slider for gain (volume) control. */
    let gainControl = null;
    /** @type {HTMLSpanElement|null} Span to display current gain value. */
    let gainValueDisplay = null;
    /** @type {HTMLDivElement|null} Container for gain slider markers. */
    let gainMarkers = null;
    /** @type {HTMLInputElement|null} Slider for VAD positive threshold. */
    let vadThresholdSlider = null;
    /** @type {HTMLSpanElement|null} Span to display current VAD positive threshold value. */
    let vadThresholdValueDisplay = null;
    /** @type {HTMLInputElement|null} Slider for VAD negative threshold. */
    let vadNegativeThresholdSlider = null;
    /** @type {HTMLSpanElement|null} Span to display current VAD negative threshold value. */
    let vadNegativeThresholdValueDisplay = null;

    // VAD Output
    /** @type {HTMLPreElement|null} Element to display detected speech regions. */
    let speechRegionsDisplay = null;

    /**
     * Initializes the UI Manager. Assigns DOM elements, sets up event listeners, and resets the UI.
     * @public
     */
    function init() {
        console.log("UIManager: Initializing...");
        if (!Utils || typeof AudioApp === 'undefined' || !AudioApp.state || typeof Constants === 'undefined') {
            console.error("UIManager: CRITICAL - Missing dependencies (Utils, AudioApp.state, or Constants)! UI might not function correctly.");
            return;
        }
        assignDOMElements();
        initializeSliderMarkers();
        setupEventListeners();
        // Initial UI setup based on AppState defaults, before subscriptions might override them
        resetUI();

        // Subscribe to AppState changes
        AudioApp.state.subscribe('param:speed:changed', (newSpeed) => { setPlaybackSpeedValue(newSpeed); });
        AudioApp.state.subscribe('param:pitch:changed', (newPitch) => { setPitchValue(newPitch); });
        AudioApp.state.subscribe('param:gain:changed', (newGain) => { setGainValue(newGain); });
        AudioApp.state.subscribe('param:vadPositive:changed', (newThreshold) => { setVadPositiveThresholdValue(newThreshold); });
        AudioApp.state.subscribe('param:vadNegative:changed', (newThreshold) => { setVadNegativeThresholdValue(newThreshold); });
        AudioApp.state.subscribe('param:audioUrl:changed', (newUrl) => { if (getAudioUrlInputValue() !== newUrl) { setAudioUrlInputValue(newUrl); } });
        AudioApp.state.subscribe('param:jumpTime:changed', (newJumpTime) => { setJumpTimeValue(newJumpTime); });

        AudioApp.state.subscribe('runtime:currentAudioBuffer:changed', (audioBuffer) => {
            // Update duration part of timeDisplay
            const duration = audioBuffer ? audioBuffer.duration : 0;
            const currentTime = seekBar ? parseFloat(seekBar.value) * duration : 0; // Maintain current time if possible
            updateTimeDisplay(currentTime, duration); // Will update both current time and duration
            enableSeekBar(!!audioBuffer);
        });
        AudioApp.state.subscribe('runtime:currentVadResults:changed', (vadResults) => {
            const regions = vadResults ? vadResults.regions || [] : [];
            setSpeechRegionsText(regions);
            // Waveform highlight will be handled by waveformVisualizer subscribing separately
        });

        AudioApp.state.subscribe('status:isActuallyPlaying:changed', (isPlaying) => { setPlayButtonState(isPlaying); });
        AudioApp.state.subscribe('status:workletPlaybackReady:changed', (isReady) => {
            enablePlaybackControls(isReady);
            if (!isReady) { enableSeekBar(false); } // Also disable seekbar if worklet not ready
        });
        AudioApp.state.subscribe('status:urlInputStyle:changed', (style) => { setUrlInputStyle(style); });
        AudioApp.state.subscribe('status:fileInfoMessage:changed', (message) => { setFileInfo(message); });
        AudioApp.state.subscribe('status:urlLoadingErrorMessage:changed', (message) => { setUrlLoadingError(message); });
        AudioApp.state.subscribe('status:isVadProcessing:changed', (isProcessing) => {
            showVadProgress(isProcessing);
            if (!isProcessing) {
                // Check if VAD results are present to determine if progress should be 100% or reset
                const vadResults = AudioApp.state.runtime.currentVadResults;
                updateVadProgress(vadResults ? 100 : 0);
            } else {
                updateVadProgress(0);
            }
        });

        console.log("UIManager: Initialized and subscribed to AppState.");
    }

    /**
     * @private
     * @const {Object<string, string>}
     * @description Conceptual mapping of functional names to DOM element IDs.
     */
    const DOM_ELEMENT_IDS = {
        DTMF_DISPLAY: 'dtmfDisplay',
        CPT_DISPLAY: 'cpt-display-content'
    };

    /**
     * Assigns DOM elements to module-level variables.
     * @private
     */
    function assignDOMElements() {
        chooseFileButton = /** @type {HTMLButtonElement|null} */ (document.getElementById('chooseFileButton'));
        hiddenAudioFile = /** @type {HTMLInputElement|null} */ (document.getElementById('hiddenAudioFile'));
        audioUrlInput = /** @type {HTMLInputElement|null} */ (document.getElementById('audioUrlInput'));
        loadUrlButton = /** @type {HTMLButtonElement|null} */ (document.getElementById('loadUrlButton'));
        urlLoadingErrorDisplay = /** @type {HTMLSpanElement|null} */ (document.getElementById('urlLoadingErrorDisplay'));
        fileNameDisplay = /** @type {HTMLSpanElement|null} */ (document.getElementById('fileNameDisplay'));
        fileInfo = /** @type {HTMLParagraphElement|null} */ (document.getElementById('fileInfo'));
        vadProgressContainer = /** @type {HTMLDivElement|null} */ (document.getElementById('vadProgressContainer'));
        vadProgressBar = /** @type {HTMLSpanElement|null} */ (document.getElementById('vadProgressBar'));

        dropZoneOverlay = /** @type {HTMLDivElement|null} */ (document.getElementById('dropZoneOverlay'));
        dropZoneMessage = /** @type {HTMLDivElement|null} */ (document.getElementById('dropZoneMessage'));

        playPauseButton = /** @type {HTMLButtonElement|null} */ (document.getElementById('playPause'));
        jumpBackButton = /** @type {HTMLButtonElement|null} */ (document.getElementById('jumpBack'));
        jumpForwardButton = /** @type {HTMLButtonElement|null} */ (document.getElementById('jumpForward'));
        jumpTimeInput = /** @type {HTMLInputElement|null} */ (document.getElementById('jumpTime'));

        seekBar = /** @type {HTMLInputElement|null} */ (document.getElementById('seekBar'));
        timeDisplay = /** @type {HTMLDivElement|null} */ (document.getElementById('timeDisplay'));

        playbackSpeedControl = /** @type {HTMLInputElement|null} */ (document.getElementById('playbackSpeed'));
        speedValueDisplay = /** @type {HTMLSpanElement|null} */ (document.getElementById('speedValue'));
        speedMarkers = /** @type {HTMLDivElement|null} */ (document.getElementById('speedMarkers'));
        pitchControl = /** @type {HTMLInputElement|null} */ (document.getElementById('pitchControl'));
        pitchValueDisplay = /** @type {HTMLSpanElement|null} */ (document.getElementById('pitchValue'));
        pitchMarkers = /** @type {HTMLDivElement|null} */ (document.getElementById('pitchMarkers'));
        gainControl = /** @type {HTMLInputElement|null} */ (document.getElementById('gainControl'));
        gainValueDisplay = /** @type {HTMLSpanElement|null} */ (document.getElementById('gainValue'));
        gainMarkers = /** @type {HTMLDivElement|null} */ (document.getElementById('gainMarkers'));

        vadThresholdSlider = /** @type {HTMLInputElement|null} */ (document.getElementById('vadThreshold'));
        vadThresholdValueDisplay = /** @type {HTMLSpanElement|null} */ (document.getElementById('vadThresholdValue'));
        vadNegativeThresholdSlider = /** @type {HTMLInputElement|null} */ (document.getElementById('vadNegativeThreshold'));
        vadNegativeThresholdValueDisplay = /** @type {HTMLSpanElement|null} */ (document.getElementById('vadNegativeThresholdValue'));

        speechRegionsDisplay = /** @type {HTMLPreElement|null} */ (document.getElementById('speechRegionsDisplay'));
        dtmfDisplay = /** @type {HTMLDivElement|null} */ (document.getElementById(DOM_ELEMENT_IDS.DTMF_DISPLAY));
        cptDisplayElement = /** @type {HTMLDivElement|null} */ (document.getElementById(DOM_ELEMENT_IDS.CPT_DISPLAY));

        // Basic checks for critical elements
        if (!chooseFileButton || !playPauseButton || !seekBar) {
            console.warn("UIManager: Some critical UI elements (chooseFile, playPause, seekBar) not found.");
        }
        if (!dtmfDisplay) console.warn("UIManager: DTMF display element not found.");
        if (!cptDisplayElement) console.warn(`UIManager: CPT display element (ID: ${DOM_ELEMENT_IDS.CPT_DISPLAY}) not found.`);
    }

    /**
     * Initializes positions of markers (like 0.5x, 1x, 2x) for sliders.
     * @private
     */
    function initializeSliderMarkers() {
        /** @type {Array<{slider: HTMLInputElement|null, markersDiv: HTMLDivElement|null}>} */
        const markerConfigs = [
            { slider: playbackSpeedControl, markersDiv: speedMarkers },
            { slider: pitchControl, markersDiv: pitchMarkers },
            { slider: gainControl, markersDiv: gainMarkers }
        ];
        markerConfigs.forEach(config => {
            const { slider, markersDiv } = config;
            if (!slider || !markersDiv) return;
            const min = parseFloat(slider.min);
            const max = parseFloat(slider.max);
            const range = max - min;
            if (range <= 0) return; // Avoid division by zero or negative range
            /** @type {NodeListOf<HTMLSpanElement>} */
            const markers = markersDiv.querySelectorAll('span[data-value]');
            markers.forEach(span => {
                const value = parseFloat(span.dataset.value || "");
                if (!isNaN(value)) {
                    const percent = ((value - min) / range) * 100;
                    span.style.left = `${percent}%`;
                }
            });
        });
    }

    /**
     * Sets up all general UI event listeners.
     * @private
     */
    function setupEventListeners() {
        chooseFileButton?.addEventListener('click', () => { hiddenAudioFile?.click(); });
        hiddenAudioFile?.addEventListener('change', (e) => {
            const target = /** @type {HTMLInputElement} */ (e.target);
            const file = target.files?.[0];
            if (file) {
                updateFileName(file.name);
                dispatchUIEvent('audioapp:fileSelected', { file: file });
            } else {
                updateFileName("");
            }
        });

        loadUrlButton?.addEventListener('click', () => {
            const audioUrl = audioUrlInput?.value.trim();
            if (audioUrl) {
                dispatchUIEvent('audioapp:urlSelected', { url: audioUrl });
            } else {
                console.warn("UIManager: Load URL button clicked, but URL is empty.");
                if (audioUrlInput) {
                    audioUrlInput.focus();
                    setUrlInputStyle('error');
                }
            }
        });

        audioUrlInput?.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                const audioUrl = audioUrlInput?.value.trim();
                if (audioUrl) {
                    dispatchUIEvent('audioapp:urlSelected', { url: audioUrl });
                } else {
                    console.warn("UIManager: Enter pressed in URL input, but URL is empty.");
                    if (audioUrlInput) {
                        audioUrlInput.focus();
                        setUrlInputStyle('error');
                    }
                }
            }
        });

        audioUrlInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                unfocusUrlInput();
            }
        });

        audioUrlInput?.addEventListener('input', () => {
            if (!audioUrlInput) return;
            const currentStyles = audioUrlInput.classList;
            if (currentStyles.contains('url-style-success') || currentStyles.contains('url-style-file')) {
                setUrlInputStyle('modified');
            } else if (currentStyles.contains('url-style-error')) {
                setUrlInputStyle('default');
            } else if (currentStyles.contains('url-style-default')) {
                setUrlInputStyle('modified');
            }
        });

        seekBar?.addEventListener('input', (e) => {
            const target = /** @type {HTMLInputElement} */ (e.target);
            const fraction = parseFloat(target.value);
            if (!isNaN(fraction)) { dispatchUIEvent('audioapp:seekBarInput', { fraction: fraction }); }
        });
        playPauseButton?.addEventListener('click', () => dispatchUIEvent('audioapp:playPauseClicked'));
        jumpBackButton?.addEventListener('click', () => dispatchUIEvent('audioapp:jumpClicked', { seconds: -getJumpTime() }));
        jumpForwardButton?.addEventListener('click', () => dispatchUIEvent('audioapp:jumpClicked', { seconds: getJumpTime() }));

        setupSliderListeners(playbackSpeedControl, speedValueDisplay, 'audioapp:speedChanged', 'speed', 'x');
        setupSliderListeners(pitchControl, pitchValueDisplay, 'audioapp:pitchChanged', 'pitch', 'x');
        setupSliderListeners(gainControl, gainValueDisplay, 'audioapp:gainChanged', 'gain', 'x');

        speedMarkers?.addEventListener('click', (e) => handleMarkerClick(/** @type {MouseEvent} */ (e), playbackSpeedControl));
        pitchMarkers?.addEventListener('click', (e) => handleMarkerClick(/** @type {MouseEvent} */ (e), pitchControl));
        gainMarkers?.addEventListener('click', (e) => handleMarkerClick(/** @type {MouseEvent} */ (e), gainControl));

        vadThresholdSlider?.addEventListener('input', handleVadSliderInput);
        vadNegativeThresholdSlider?.addEventListener('input', handleVadSliderInput);

        document.addEventListener('keydown', handleKeyDown);
    }

    /**
     * Sets up an event listener for a slider control.
     * @private
     * @param {HTMLInputElement|null} slider - The slider element.
     * @param {HTMLSpanElement|null} valueDisplay - The element to display the slider's value.
     * @param {string} eventName - The name of the custom event to dispatch.
     * @param {string} detailKey - The key for the value in the event detail object.
     * @param {string} [suffix=''] - Suffix to append to the displayed value.
     */
    function setupSliderListeners(slider, valueDisplay, eventName, detailKey, suffix = '') {
        if (!slider || !valueDisplay) return;
        slider.addEventListener('input', () => {
            const value = parseFloat(slider.value);
            valueDisplay.textContent = value.toFixed(2) + suffix;
            dispatchUIEvent(eventName, { [detailKey]: value });
        });
    }

    /**
     * Handles keydown events for global shortcuts.
     * @private
     * @param {KeyboardEvent} e - The keyboard event.
     */
    function handleKeyDown(e) {
        const target = /** @type {HTMLElement} */ (e.target);
        // Ignore key events if the target is an input field where typing is expected.
        const isTextInput = target instanceof HTMLInputElement && ['text', 'number', 'search', 'email', 'password', 'url'].includes(target.type);
        const isTextArea = target instanceof HTMLTextAreaElement;
        if (isTextInput || isTextArea) return;

        let handled = false;
        /** @type {string|null} */ let eventKey = null;
        switch (e.code) {
            case 'Space': eventKey = 'Space'; handled = true; break;
            case 'ArrowLeft': eventKey = 'ArrowLeft'; handled = true; break;
            case 'ArrowRight': eventKey = 'ArrowRight'; handled = true; break;
        }
        if (eventKey) { dispatchUIEvent('audioapp:keyPressed', { key: eventKey }); }
        if (handled) { e.preventDefault(); } // Prevent default browser action (e.g., scrolling on space)
    }

    /**
     * Updates the DTMF display box with detected tones.
     * @public
     * @param {string | string[]} tones - The detected DTMF tone(s). Can be a single string or an array of strings.
     */
    function updateDtmfDisplay(tones) {
        if (!dtmfDisplay) return;
        if (Array.isArray(tones) && tones.length > 0) {
            dtmfDisplay.textContent = tones.join(', ');
        } else if (typeof tones === 'string' && tones.length > 0 && tones.trim() !== "") {
            dtmfDisplay.textContent = tones;
        } else if (Array.isArray(tones) && tones.length === 0) {
            dtmfDisplay.textContent = "No DTMF detected.";
        } else {
            dtmfDisplay.textContent = "N/A";
        }
    }

    /**
     * Updates the Call Progress Tones display box.
     * @public
     * @param {string[]} tones - An array of detected CPT names.
     */
    function updateCallProgressTonesDisplay(tones) {
        if (!cptDisplayElement) {
            console.error("UIManager: CPT display element not found.");
            return;
        }
        if (Array.isArray(tones) && tones.length > 0) {
            cptDisplayElement.textContent = tones.join(', ');
        } else if (Array.isArray(tones) && tones.length === 0) {
            cptDisplayElement.textContent = "No ringtone detected.";
        } else {
            cptDisplayElement.textContent = "N/A";
        }
    }

    /**
     * Handles input events from VAD threshold sliders.
     * @private
     * @param {Event} e - The input event.
     */
    function handleVadSliderInput(e) {
        const slider = /** @type {HTMLInputElement} */ (e.target);
        const value = parseFloat(slider.value);
        /** @type {string|null} */ let type = null;
        if (slider === vadThresholdSlider && vadThresholdValueDisplay) {
            vadThresholdValueDisplay.textContent = value.toFixed(2); type = 'positive';
        } else if (slider === vadNegativeThresholdSlider && vadNegativeThresholdValueDisplay) {
            vadNegativeThresholdValueDisplay.textContent = value.toFixed(2); type = 'negative';
        }
        if (type) { dispatchUIEvent('audioapp:thresholdChanged', { type: type, value: value }); }
    }

    /**
     * Handles clicks on slider markers to set the slider value.
     * @private
     * @param {MouseEvent} event - The click event.
     * @param {HTMLInputElement|null} sliderElement - The slider element associated with the markers.
     */
     function handleMarkerClick(event, sliderElement) {
        if (!sliderElement || sliderElement.disabled) return;
        const target = /** @type {HTMLElement} */ (event.target);
        if (target.tagName === 'SPAN' && target.dataset.value) {
            const value = parseFloat(target.dataset.value);
            if (!isNaN(value)) {
                sliderElement.value = String(value);
                // Dispatch 'input' event to trigger associated listeners (e.g., value display update, app logic)
                sliderElement.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    }

    /**
     * Gets the current gain value from the gain control slider.
     * @public
     * @returns {number} The current gain value (default is 1.0).
     */
    function getGainValue() {
        return gainControl ? parseFloat(gainControl.value) : 1.0;
    }

    /**
     * Sets the gain value on the UI slider and display.
     * @public
     * @param {number} value - The gain value to set.
     */
    function setGainValue(value) {
        if (gainControl) {
            gainControl.value = String(value);
        }
        if (gainValueDisplay) {
            const numericValue = parseFloat(String(value)); // Ensure it's a number
            gainValueDisplay.textContent = numericValue.toFixed(2) + 'x';
        }
    }

    /**
     * Gets the current value of the audio URL input field.
     * @public
     * @returns {string} The current value of the audio URL input.
     */
    function getAudioUrlInputValue() {
        return audioUrlInput ? audioUrlInput.value : "";
    }

    /**
     * Sets the value of the audio URL input field.
     * @public
     * @param {string} text The text to set as the value.
     */
    function setAudioUrlInputValue(text) {
        if (audioUrlInput) {
            audioUrlInput.value = text;
        }
    }

    /**
     * Sets the value of the jump time input field.
     * @public
     * @param {number|string} value The jump time value to set.
     */
    function setJumpTimeValue(value) {
        if (jumpTimeInput) {
            jumpTimeInput.value = String(value);
        }
    }

    /**
     * Removes focus from the audio URL input field.
     * @public
     */
    function unfocusUrlInput() {
        if (audioUrlInput) {
            audioUrlInput.blur();
        }
    }

    /**
     * Dispatches a custom UI event.
     * @private
     * @param {string} eventName - The name of the event.
     * @param {Object<string, any>} [detail={}] - The detail object for the event.
     */
    function dispatchUIEvent(eventName, detail = {}) {
        document.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
    }

    // --- Public Methods for Updating UI ---
    /**
     * Sets the error message for URL loading.
     * @public
     * @param {string} message - The error message to display.
     */
    function setUrlLoadingError(message) {
        if (urlLoadingErrorDisplay) {
            urlLoadingErrorDisplay.textContent = message;
        }
    }

    /**
     * Sets the visual style of the URL input field.
     * @public
     * @param {'success' | 'error' | 'file' | 'default' | 'modified'} styleType - The style to apply.
     */
    function setUrlInputStyle(styleType) {
        if (!audioUrlInput) return;
        audioUrlInput.classList.remove('url-style-success', 'url-style-error', 'url-style-file', 'url-style-default', 'url-style-modified');
        audioUrlInput.classList.add(`url-style-${styleType}`);
    }

    /**
     * Resets the entire UI to its initial state.
     * @public
     */
    function resetUI() {
        console.log("UIManager: Resetting UI");
        updateFileName("");
        setFileInfo("No file selected.");
        setPlayButtonState(false);
        updateTimeDisplay(0, 0);
        updateSeekBar(0);
        setSpeechRegionsText("None");
        updateVadDisplay(Constants.VAD.DEFAULT_POSITIVE_THRESHOLD, Constants.VAD.DEFAULT_NEGATIVE_THRESHOLD, true); // Reset VAD sliders and mark as N/A
        showVadProgress(false);
        updateVadProgress(0);
        if (dtmfDisplay) dtmfDisplay.textContent = "N/A";
        if (cptDisplayElement) cptDisplayElement.textContent = "N/A";
        if (urlLoadingErrorDisplay) urlLoadingErrorDisplay.textContent = "";
        setAudioUrlInputValue("");
        setUrlInputStyle('default');

        if (playbackSpeedControl && speedValueDisplay) { playbackSpeedControl.value = "1.0"; speedValueDisplay.textContent = "1.00x"; }
        if (pitchControl && pitchValueDisplay) { pitchControl.value = "1.0"; pitchValueDisplay.textContent = "1.00x"; }
        if (gainControl && gainValueDisplay) { gainControl.value = "1.0"; gainValueDisplay.textContent = "1.00x"; }
        if (jumpTimeInput) jumpTimeInput.value = "5";

        enableSeekBar(false);
        // Playback controls are typically enabled/disabled based on worklet readiness, not full reset.
    }

    /**
     * Updates the displayed file name.
     * @public
     * @param {string} text - The file name to display.
     */
    function updateFileName(text) { if (fileNameDisplay) { fileNameDisplay.textContent = text; fileNameDisplay.title = text; } }

    /**
     * Sets the general file information/status message.
     * @public
     * @param {string} text - The message to display.
     */
    function setFileInfo(text) { if (fileInfo) { fileInfo.textContent = text; fileInfo.title = text; } }

    /**
     * Sets the state of the play/pause button.
     * @public
     * @param {boolean} isPlaying - True if audio is playing, false otherwise.
     */
    function setPlayButtonState(isPlaying) { if (playPauseButton) playPauseButton.textContent = isPlaying ? 'Pause' : 'Play'; }

    /**
     * Updates the time display (current time / duration).
     * @public
     * @param {number} currentTime - The current playback time in seconds.
     * @param {number} duration - The total duration of the audio in seconds.
     */
    function updateTimeDisplay(currentTime, duration) {
        if (timeDisplay && Utils) {
            timeDisplay.textContent = `${Utils.formatTime(currentTime)} / ${Utils.formatTime(duration)}`;
        } else if (timeDisplay) {
             timeDisplay.textContent = `Err / Err`; // Fallback if Utils is not available
        }
    }

    /**
     * Updates the position of the seek bar.
     * @public
     * @param {number} fraction - The progress fraction (0 to 1).
     */
    function updateSeekBar(fraction) {
        if (seekBar) {
            const clampedFraction = Math.max(0, Math.min(1, fraction));
            // Only update if significantly different to avoid fighting with user input
            if (Math.abs(parseFloat(seekBar.value) - clampedFraction) > 1e-6 ) {
                seekBar.value = String(clampedFraction);
            }
        }
    }

    /**
     * Sets the text content for the speech regions display.
     * @public
     * @param {string | Array<{start: number, end: number}>} regionsOrText - Either a string message or an array of speech region objects.
     */
    function setSpeechRegionsText(regionsOrText) {
        if (!speechRegionsDisplay) return;
        if (typeof regionsOrText === 'string') {
            speechRegionsDisplay.textContent = regionsOrText;
        } else if (Array.isArray(regionsOrText)) {
             if (regionsOrText.length > 0) {
                 speechRegionsDisplay.textContent = regionsOrText.map(r => `Start: ${r.start.toFixed(2)}s, End: ${r.end.toFixed(2)}s`).join('\n');
             } else {
                 speechRegionsDisplay.textContent = "No speech detected.";
             }
        } else {
            speechRegionsDisplay.textContent = "None"; // Default fallback
        }
    }

    /**
     * Updates the VAD threshold sliders and their value displays.
     * @public
     * @param {number} positive - The positive VAD threshold value.
     * @param {number} negative - The negative VAD threshold value.
     * @param {boolean} [isNA=false] - If true, sets displays to "N/A" and resets sliders to default.
     */
    function updateVadDisplay(positive, negative, isNA = false) {
        if (isNA) {
            if (vadThresholdValueDisplay) vadThresholdValueDisplay.textContent = "N/A";
            if (vadNegativeThresholdValueDisplay) vadNegativeThresholdValueDisplay.textContent = "N/A";
            if (vadThresholdSlider) vadThresholdSlider.value = String(Constants.VAD.DEFAULT_POSITIVE_THRESHOLD); // Default value
            if (vadNegativeThresholdSlider) vadNegativeThresholdSlider.value = String(Constants.VAD.DEFAULT_NEGATIVE_THRESHOLD); // Default value
        } else {
            if (vadThresholdSlider) vadThresholdSlider.value = String(positive);
            if (vadThresholdValueDisplay) vadThresholdValueDisplay.textContent = positive.toFixed(2);
            if (vadNegativeThresholdSlider) vadNegativeThresholdSlider.value = String(negative);
            if (vadNegativeThresholdValueDisplay) vadNegativeThresholdValueDisplay.textContent = negative.toFixed(2);
        }
    }

    /**
     * Enables or disables main playback controls.
     * @public
     * @param {boolean} enable - True to enable, false to disable.
     */
    function enablePlaybackControls(enable) {
        if (playPauseButton) playPauseButton.disabled = !enable;
        if (jumpBackButton) jumpBackButton.disabled = !enable;
        if (jumpForwardButton) jumpForwardButton.disabled = !enable;
        if (playbackSpeedControl) playbackSpeedControl.disabled = !enable;
        if (pitchControl) pitchControl.disabled = !enable;
        // Note: Gain control is typically always enabled.
    }

    /**
     * Enables or disables the seek bar.
     * @public
     * @param {boolean} enable - True to enable, false to disable.
     */
     function enableSeekBar(enable) { if (seekBar) seekBar.disabled = !enable; }

    /**
     * Enables or disables VAD threshold controls.
     * @public
     * @param {boolean} enable - True to enable, false to disable.
     */
    function enableVadControls(enable) {
        if (vadThresholdSlider) vadThresholdSlider.disabled = !enable;
        if (vadNegativeThresholdSlider) vadNegativeThresholdSlider.disabled = !enable;
        if (!enable) {
            updateVadDisplay(Constants.VAD.DEFAULT_POSITIVE_THRESHOLD, Constants.VAD.DEFAULT_NEGATIVE_THRESHOLD, true); // Reset display values to N/A and sliders to default if disabling
        }
    }

    /**
     * Gets the current jump time value from the input field.
     * @public
     * @returns {number} The jump time in seconds (default is 5).
     */
    function getJumpTime() { return parseFloat(jumpTimeInput?.value || "5") || 5; }

    /**
     * Updates the VAD progress bar percentage.
     * @public
     * @param {number} percentage - The progress percentage (0 to 100).
     */
    function updateVadProgress(percentage) {
        if (!vadProgressBar) return;
        const clampedPercentage = Math.max(0, Math.min(100, percentage));
        vadProgressBar.style.width = `${clampedPercentage}%`;
    }

    /**
     * Shows or hides the VAD progress bar container.
     * @public
     * @param {boolean} show - True to show, false to hide.
     */
    function showVadProgress(show) {
        if (!vadProgressContainer) return;
        vadProgressContainer.style.display = show ? 'block' : 'none';
    }

    /**
     * Shows the drop zone overlay with file information.
     * @public
     * @param {File} file The file being dragged over.
     */
    function showDropZone(file) {
        if (dropZoneOverlay && dropZoneMessage) {
            dropZoneOverlay.style.display = 'flex';
            // Assuming Utils.formatBytes is not available or moved, displaying size in bytes.
            dropZoneMessage.textContent = `File: ${file.name}, Size: ${file.size} bytes`;
            document.body.classList.add('blurred-background');
        }
    }

    /**
     * Hides the drop zone overlay.
     * @public
     */
    function hideDropZone() {
        if (dropZoneOverlay && dropZoneMessage) {
            dropZoneOverlay.style.display = 'none';
            dropZoneMessage.textContent = '';
            document.body.classList.remove('blurred-background');
        }
    }

    /**
     * Gets the current playback speed value.
     * @public
     * @returns {number} The current playback speed.
     */
    function getPlaybackSpeedValue() {
        return playbackSpeedControl ? parseFloat(playbackSpeedControl.value) : 1.0;
    }

    /**
     * Sets the playback speed value on the UI.
     * @public
     * @param {number} value - The playback speed to set.
     */
    function setPlaybackSpeedValue(value) {
        if (playbackSpeedControl) {
            playbackSpeedControl.value = String(value);
        }
        if (speedValueDisplay) {
            speedValueDisplay.textContent = parseFloat(String(value)).toFixed(2) + 'x';
        }
    }

    /**
     * Gets the current pitch value.
     * @public
     * @returns {number} The current pitch value.
     */
    function getPitchValue() {
        return pitchControl ? parseFloat(pitchControl.value) : 1.0;
    }

    /**
     * Sets the pitch value on the UI.
     * @public
     * @param {number} value - The pitch value to set.
     */
    function setPitchValue(value) {
        if (pitchControl) {
            pitchControl.value = String(value);
        }
        if (pitchValueDisplay) {
            pitchValueDisplay.textContent = parseFloat(String(value)).toFixed(2) + 'x';
        }
    }

    /**
     * Gets the current VAD positive threshold value.
     * @public
     * @returns {number} The current VAD positive threshold.
     */
    function getVadPositiveThresholdValue() {
        return vadThresholdSlider ? parseFloat(vadThresholdSlider.value) : Constants.VAD.DEFAULT_POSITIVE_THRESHOLD; // Default based on HTML
    }

    /**
     * Sets the VAD positive threshold value on the UI.
     * @public
     * @param {number} value - The VAD positive threshold to set.
     */
    function setVadPositiveThresholdValue(value) {
        if (vadThresholdSlider) {
            vadThresholdSlider.value = String(value);
        }
        if (vadThresholdValueDisplay) {
            vadThresholdValueDisplay.textContent = parseFloat(String(value)).toFixed(2);
        }
    }

    /**
     * Gets the current VAD negative threshold value.
     * @public
     * @returns {number} The current VAD negative threshold.
     */
    function getVadNegativeThresholdValue() {
        return vadNegativeThresholdSlider ? parseFloat(vadNegativeThresholdSlider.value) : Constants.VAD.DEFAULT_NEGATIVE_THRESHOLD; // Default based on HTML
    }

    /**
     * Sets the VAD negative threshold value on the UI.
     * @public
     * @param {number} value - The VAD negative threshold to set.
     */
    function setVadNegativeThresholdValue(value) {
        if (vadNegativeThresholdSlider) {
            vadNegativeThresholdSlider.value = String(value);
        }
        if (vadNegativeThresholdValueDisplay) {
            vadNegativeThresholdValueDisplay.textContent = parseFloat(String(value)).toFixed(2);
        }
    }

    /**
     * @typedef {Object} UIManagerPublicInterface
     * @property {function(): void} init
     * @property {function(): void} resetUI
     * @property {function(string): void} setFileInfo
     * @property {function(string): void} updateFileName
     * @property {function(boolean): void} setPlayButtonState
     * @property {function(number, number): void} updateTimeDisplay
     * @property {function(string|string[]): void} updateDtmfDisplay
     * @property {function(string[]): void} updateCallProgressTonesDisplay
     * @property {function(number): void} updateSeekBar
     * @property {function(string|Array<{start: number, end: number}>): void} setSpeechRegionsText
     * @property {function(number, number, boolean=): void} updateVadDisplay
     * @property {function(boolean): void} enablePlaybackControls
     * @property {function(boolean): void} enableSeekBar
     * @property {function(boolean): void} enableVadControls
     * @property {function(): number} getJumpTime
     * @property {function(number): void} updateVadProgress
     * @property {function(boolean): void} showVadProgress
     * @property {function(string): void} setUrlLoadingError
     * @property {function('success'|'error'|'file'|'default'|'modified'): void} setUrlInputStyle
     * @property {function(): void} unfocusUrlInput
     * @property {function(string): void} setAudioUrlInputValue
     * @property {function(): string} getAudioUrlInputValue
     * @property {function(number|string): void} setJumpTimeValue
     * @property {function(File): void} showDropZone
     * @property {function(): void} hideDropZone
     * @property {function(): number} getPlaybackSpeedValue
     * @property {function(): number} getPitchValue
     * @property {function(): number} getVadPositiveThresholdValue
     * @property {function(): number} getVadNegativeThresholdValue
     * @property {function(): number} getGainValue
     * @property {function(number): void} setPlaybackSpeedValue
     * @property {function(number): void} setPitchValue
     * @property {function(number): void} setVadPositiveThresholdValue
     * @property {function(number): void} setVadNegativeThresholdValue
     * @property {function(number): void} setGainValue
     */

    /** @type {UIManagerPublicInterface} */
    return {
        init: init,
        resetUI: resetUI,
        setFileInfo: setFileInfo,
        updateFileName: updateFileName,
        setPlayButtonState: setPlayButtonState,
        updateTimeDisplay: updateTimeDisplay,
        updateDtmfDisplay: updateDtmfDisplay,
        updateCallProgressTonesDisplay: updateCallProgressTonesDisplay,
        updateSeekBar: updateSeekBar,
        setSpeechRegionsText: setSpeechRegionsText,
        updateVadDisplay: updateVadDisplay,
        enablePlaybackControls: enablePlaybackControls,
        enableSeekBar: enableSeekBar,
        enableVadControls: enableVadControls,
        getJumpTime: getJumpTime,
        updateVadProgress: updateVadProgress,
        showVadProgress: showVadProgress,
        setUrlLoadingError: setUrlLoadingError,
        setUrlInputStyle: setUrlInputStyle,
        unfocusUrlInput: unfocusUrlInput,
        setAudioUrlInputValue: setAudioUrlInputValue,
        getAudioUrlInputValue: getAudioUrlInputValue,
        setJumpTimeValue: setJumpTimeValue,
        showDropZone: showDropZone,
        hideDropZone: hideDropZone,
        // New Getters
        getPlaybackSpeedValue: getPlaybackSpeedValue,
        getPitchValue: getPitchValue,
        getVadPositiveThresholdValue: getVadPositiveThresholdValue,
        getVadNegativeThresholdValue: getVadNegativeThresholdValue,
        getGainValue: getGainValue,
        // New Setters
        setPlaybackSpeedValue: setPlaybackSpeedValue,
        setPitchValue: setPitchValue,
        setVadPositiveThresholdValue: setVadPositiveThresholdValue,
        setVadNegativeThresholdValue: setVadNegativeThresholdValue,
        setGainValue: setGainValue
    };
})();
// --- /vibe-player/js/uiManager.js ---
