// --- /vibe-player/js/uiManager.js ---
// Handles DOM manipulation, UI event listeners, and dispatches UI events.
// Interacts with the DOM but does not contain application logic (playback, analysis).

var AudioApp = AudioApp || {}; // Ensure namespace exists

// Design Decision: Use IIFE to encapsulate UI logic.
AudioApp.uiManager = (function() {
    'use strict';

    // --- DOM Element References ---
    /** @type {HTMLInputElement|null} */ let fileInput;
    /** @type {HTMLParagraphElement|null} */ let fileInfo;
    /** @type {HTMLButtonElement|null} */ let playPauseButton;
    /** @type {HTMLButtonElement|null} */ let jumpBackButton;
    /** @type {HTMLButtonElement|null} */ let jumpForwardButton;
    /** @type {HTMLInputElement|null} */ let jumpTimeInput;
    /** @type {HTMLInputElement|null} */ let playbackSpeedControl;
    /** @type {HTMLSpanElement|null} */ let speedValueDisplay;
    /** @type {HTMLInputElement|null} */ let pitchControl; // New
    /** @type {HTMLSpanElement|null} */ let pitchValueDisplay; // New
    /** @type {HTMLInputElement|null} */ let formantControl; // New
    /** @type {HTMLSpanElement|null} */ let formantValueDisplay; // New
    /** @type {HTMLInputElement|null} */ let gainControl;
    /** @type {HTMLSpanElement|null} */ let gainValueDisplay;
    /** @type {HTMLDivElement|null} */ let timeDisplay;
    /** @type {HTMLCanvasElement|null} */ let waveformCanvas;
    /** @type {HTMLCanvasElement|null} */ let spectrogramCanvas;
    /** @type {HTMLSpanElement|null} */ let spectrogramSpinner;
    /** @type {HTMLDivElement|null} */ let waveformProgressIndicator;
    /** @type {HTMLDivElement|null} */ let spectrogramProgressIndicator;
    /** @type {HTMLPreElement|null} */ let speechRegionsDisplay;
    /** @type {HTMLInputElement|null} */ let vadThresholdSlider;
    /** @type {HTMLSpanElement|null} */ let vadThresholdValueDisplay;
    /** @type {HTMLInputElement|null} */ let vadNegativeThresholdSlider;
    /** @type {HTMLSpanElement|null} */ let vadNegativeThresholdValueDisplay;

    // --- Initialization ---

    /**
     * Initializes the UI Manager: finds elements, sets up listeners.
     * @public
     */
    function init() {
        console.log("UIManager: Initializing...");
        assignDOMElements();
        setupEventListeners();
        resetUI(); // Start with a clean state
        console.log("UIManager: Initialized.");
    }

    // --- DOM Element Assignment ---

    /**
     * Gets references to all needed DOM elements by their ID.
     * @private
     */
    function assignDOMElements() {
        fileInput = document.getElementById('audioFile');
        fileInfo = document.getElementById('fileInfo');
        playPauseButton = document.getElementById('playPause');
        jumpBackButton = document.getElementById('jumpBack');
        jumpForwardButton = document.getElementById('jumpForward');
        jumpTimeInput = document.getElementById('jumpTime');
        playbackSpeedControl = document.getElementById('playbackSpeed');
        speedValueDisplay = document.getElementById('speedValue');
        pitchControl = document.getElementById('pitchControl'); // New
        pitchValueDisplay = document.getElementById('pitchValue'); // New
        formantControl = document.getElementById('formantControl'); // New
        formantValueDisplay = document.getElementById('formantValue'); // New
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

        // Basic check including new elements
        if (!fileInput || !playPauseButton || !waveformCanvas || !pitchControl || !formantControl) {
             console.warn("UIManager: Could not find all required UI elements!");
        }
    }

    // --- Event Listener Setup ---

    /**
     * Sets up event listeners for user interactions on UI elements.
     * Dispatches custom events for the App controller to handle.
     * @private
     */
    function setupEventListeners() {
        // File Input
        fileInput?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) {
                dispatchUIEvent('audioapp:fileSelected', { file: file });
            }
            fileInput.blur();
        });

        // Playback Buttons
        playPauseButton?.addEventListener('click', () => dispatchUIEvent('audioapp:playPauseClicked'));
        jumpBackButton?.addEventListener('click', () => dispatchUIEvent('audioapp:jumpClicked', { seconds: -getJumpTime() }));
        jumpForwardButton?.addEventListener('click', () => dispatchUIEvent('audioapp:jumpClicked', { seconds: getJumpTime() }));

        // Sliders
        playbackSpeedControl?.addEventListener('input', () => {
            const speed = parseFloat(playbackSpeedControl.value);
            if (speedValueDisplay) speedValueDisplay.textContent = speed.toFixed(2) + "x";
            dispatchUIEvent('audioapp:speedChanged', { speed: speed });
        });
        pitchControl?.addEventListener('input', () => { // New
            const pitch = parseFloat(pitchControl.value);
            if (pitchValueDisplay) pitchValueDisplay.textContent = pitch.toFixed(2) + "x";
            dispatchUIEvent('audioapp:pitchChanged', { pitch: pitch });
        });
        formantControl?.addEventListener('input', () => { // New
            const formant = parseFloat(formantControl.value);
            if (formantValueDisplay) formantValueDisplay.textContent = formant.toFixed(2) + "x";
            dispatchUIEvent('audioapp:formantChanged', { formant: formant });
        });
        gainControl?.addEventListener('input', () => {
            const gain = parseFloat(gainControl.value);
            if (gainValueDisplay) gainValueDisplay.textContent = gain.toFixed(2) + "x";
            dispatchUIEvent('audioapp:gainChanged', { gain: gain });
        });

        // VAD Tuning Sliders
        vadThresholdSlider?.addEventListener('input', handleVadSliderInput);
        vadNegativeThresholdSlider?.addEventListener('input', handleVadSliderInput);

        // Global Keyboard Shortcuts
        document.addEventListener('keydown', handleKeyDown);
    }

     // --- Specific Event Handlers ---

    /**
     * Handles keydown events for keyboard shortcuts.
     * @param {KeyboardEvent} e - The keyboard event.
     * @private
     */
     function handleKeyDown(e) {
        // Ignore shortcuts if user is typing in relevant input fields
        const target = e.target;
        const isTextInput = target.tagName === 'INPUT' && (target.type === 'text' || target.type === 'number' || target.type === 'search' || target.type === 'email' || target.type === 'password' || target.type === 'url');
        const isTextArea = target.tagName === 'TEXTAREA';
        if (isTextInput || isTextArea) return;

        let handled = false; let eventKey = null;
        switch (e.code) {
            case 'Space': eventKey = 'Space'; handled = true; break;
            case 'ArrowLeft': eventKey = 'ArrowLeft'; handled = true; break;
            case 'ArrowRight': eventKey = 'ArrowRight'; handled = true; break;
        }
        if (eventKey) dispatchUIEvent('audioapp:keyPressed', { key: eventKey });
        if (handled) e.preventDefault();
    }

    /**
     * Handles input events from VAD threshold sliders.
     * @param {Event} e - The input event.
     * @private
     */
    function handleVadSliderInput(e) {
        const slider = /** @type {HTMLInputElement} */ (e.target);
        const value = parseFloat(slider.value);
        let type = null;
        if (slider === vadThresholdSlider && vadThresholdValueDisplay) { vadThresholdValueDisplay.textContent = value.toFixed(2); type = 'positive'; }
        else if (slider === vadNegativeThresholdSlider && vadNegativeThresholdValueDisplay) { vadNegativeThresholdValueDisplay.textContent = value.toFixed(2); type = 'negative'; }
        if (type) dispatchUIEvent('audioapp:thresholdChanged', { type: type, value: value });
    }


    // --- Helper to Dispatch Custom Events ---

    /**
     * Dispatches a custom event on the document.
     * @param {string} eventName
     * @param {object} [detail={}]
     * @private
     */
    function dispatchUIEvent(eventName, detail = {}) {
        document.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
    }

    // --- Public Methods for Updating UI ---

    /**
     * Resets all UI elements to their initial state.
     * @public
     */
    function resetUI() {
        console.log("UIManager: Resetting UI");
        setFileInfo("No file selected.");
        setPlayButtonState(false);
        updateTimeDisplay(0, 0);
        setSpeechRegionsText("None");
        updateVadDisplay(0.5, 0.35, true);
        // Reset sliders and displays
        if (playbackSpeedControl) playbackSpeedControl.value = "1.0";
        if (speedValueDisplay) speedValueDisplay.textContent = "1.00x";
        if (pitchControl) pitchControl.value = "1.0"; // New
        if (pitchValueDisplay) pitchValueDisplay.textContent = "1.00x"; // New
        if (formantControl) formantControl.value = "1.0"; // New
        if (formantValueDisplay) formantValueDisplay.textContent = "1.00x"; // New
        if (gainControl) gainControl.value = "1.0";
        if (gainValueDisplay) gainValueDisplay.textContent = "1.00x";
        if (jumpTimeInput) jumpTimeInput.value = "5";
        // Disable controls
        enablePlaybackControls(false); // This now includes pitch/formant
        enableVadControls(false);
    }

    /**
     * Sets the text content of the file info display.
     * @param {string} text
     * @public
     */
    function setFileInfo(text) {
        if (fileInfo) fileInfo.textContent = text;
    }

    /**
     * Sets the text of the play/pause button.
     * @param {boolean} isPlaying
     * @public
     */
    function setPlayButtonState(isPlaying) {
        if (playPauseButton) playPauseButton.textContent = isPlaying ? 'Pause' : 'Play';
    }

    /**
     * Updates the time display string.
     * @param {number} currentTime
     * @param {number} duration
     * @public
     */
    function updateTimeDisplay(currentTime, duration) {
        if (timeDisplay) timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    }

    /**
     * Sets the text content of the speech regions display area.
     * @param {string | Array<{start: number, end: number}>} regionsOrText
     * @public
     */
    function setSpeechRegionsText(regionsOrText) {
        if (!speechRegionsDisplay) return;
        if (typeof regionsOrText === 'string') { speechRegionsDisplay.textContent = regionsOrText; }
        else if (Array.isArray(regionsOrText)) {
            if (regionsOrText.length > 0) { speechRegionsDisplay.textContent = regionsOrText.map(r => `Start: ${r.start.toFixed(2)}s, End: ${r.end.toFixed(2)}s`).join('\n'); }
            else { speechRegionsDisplay.textContent = "No speech detected (at current threshold)."; }
        } else { speechRegionsDisplay.textContent = "None"; }
    }

    /**
     * Updates the VAD threshold sliders and displays.
     * @param {number} positive
     * @param {number} negative
     * @param {boolean} [isNA=false]
     * @public
     */
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

    /**
     * Enables or disables playback-related controls (Play/Pause, Jump, Speed, Pitch, Formant).
     * @param {boolean} enable - True to enable, false to disable.
     * @public
     */
    function enablePlaybackControls(enable) {
        if (playPauseButton) playPauseButton.disabled = !enable;
        if (jumpBackButton) jumpBackButton.disabled = !enable;
        if (jumpForwardButton) jumpForwardButton.disabled = !enable;
        if (playbackSpeedControl) playbackSpeedControl.disabled = !enable;
        if (pitchControl) pitchControl.disabled = !enable; // New
        if (formantControl) formantControl.disabled = !enable; // New
        // gainControl remains enabled
    }

    /**
     * Enables or disables VAD tuning sliders.
     * @param {boolean} enable - True to enable, false to disable.
     * @public
     */
    function enableVadControls(enable) {
        if (vadThresholdSlider) vadThresholdSlider.disabled = !enable;
        if (vadNegativeThresholdSlider) vadNegativeThresholdSlider.disabled = !enable;
    }

    /**
     * Gets the current jump time value from the input field.
     * @returns {number}
     * @public
     */
    function getJumpTime() {
        return parseFloat(jumpTimeInput?.value) || 5;
    }

    // --- Utility Functions ---

    /**
     * Formats time in seconds to a "MM:SS" string.
     * @param {number} sec
     * @returns {string}
     * @private
     */
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
        setSpeechRegionsText: setSpeechRegionsText,
        updateVadDisplay: updateVadDisplay,
        enablePlaybackControls: enablePlaybackControls,
        enableVadControls: enableVadControls,
        getJumpTime: getJumpTime
    };
})(); // End of uiManager IIFE
// --- /vibe-player/js/uiManager.js ---
