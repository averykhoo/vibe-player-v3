// --- /vibe-player/js/uiManager.js ---
// Handles DOM manipulation, UI event listeners, and dispatches UI events.
// Interacts with the DOM but does not contain application logic (playback, analysis).

var AudioApp = AudioApp || {}; // Ensure namespace exists

// Design Decision: Use IIFE to encapsulate UI logic.
// Takes no arguments as it interacts directly with the DOM based on IDs.
AudioApp.uiManager = (function() {
    'use strict';

    // --- DOM Element References ---
    // Design Decision: Cache element references on init for performance.
    /** @type {HTMLInputElement|null} */ let fileInput;
    /** @type {HTMLParagraphElement|null} */ let fileInfo;
    /** @type {HTMLButtonElement|null} */ let playPauseButton;
    /** @type {HTMLButtonElement|null} */ let jumpBackButton;
    /** @type {HTMLButtonElement|null} */ let jumpForwardButton;
    /** @type {HTMLInputElement|null} */ let jumpTimeInput;
    /** @type {HTMLInputElement|null} */ let playbackSpeedControl;
    /** @type {HTMLSpanElement|null} */ let speedValueDisplay;
    /** @type {HTMLInputElement|null} */ let gainControl;
    /** @type {HTMLSpanElement|null} */ let gainValueDisplay;
    /** @type {HTMLDivElement|null} */ let timeDisplay;
    /** @type {HTMLCanvasElement|null} */ let waveformCanvas; // Referenced mainly for context, drawing handled by Visualizer
    /** @type {HTMLCanvasElement|null} */ let spectrogramCanvas; // Referenced mainly for context
    /** @type {HTMLSpanElement|null} */ let spectrogramSpinner;
    /** @type {HTMLDivElement|null} */ let waveformProgressIndicator; // Referenced mainly for context
    /** @type {HTMLDivElement|null} */ let spectrogramProgressIndicator; // Referenced mainly for context
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
        gainControl = document.getElementById('gainControl');
        gainValueDisplay = document.getElementById('gainValue');
        timeDisplay = document.getElementById('timeDisplay');
        waveformCanvas = document.getElementById('waveformCanvas'); // For potential size calculation if needed
        spectrogramCanvas = document.getElementById('spectrogramCanvas'); // For potential size calculation if needed
        spectrogramSpinner = document.getElementById('spectrogramSpinner');
        waveformProgressIndicator = document.getElementById('waveformProgressIndicator'); // Referenced by Visualizer
        spectrogramProgressIndicator = document.getElementById('spectrogramProgressIndicator'); // Referenced by Visualizer
        speechRegionsDisplay = document.getElementById('speechRegionsDisplay');
        vadThresholdSlider = document.getElementById('vadThreshold');
        vadThresholdValueDisplay = document.getElementById('vadThresholdValue');
        vadNegativeThresholdSlider = document.getElementById('vadNegativeThreshold');
        vadNegativeThresholdValueDisplay = document.getElementById('vadNegativeThresholdValue');

        // Basic check
        if (!fileInput || !playPauseButton || !waveformCanvas) {
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
            fileInput.blur(); // Unfocus to allow keyboard shortcuts immediately after selection
        });

        // Playback Buttons
        playPauseButton?.addEventListener('click', () => {
            dispatchUIEvent('audioapp:playPauseClicked');
        });
        jumpBackButton?.addEventListener('click', () => {
            dispatchUIEvent('audioapp:jumpClicked', { seconds: -getJumpTime() });
        });
        jumpForwardButton?.addEventListener('click', () => {
            dispatchUIEvent('audioapp:jumpClicked', { seconds: getJumpTime() });
        });

        // Sliders
        playbackSpeedControl?.addEventListener('input', () => {
            const speed = parseFloat(playbackSpeedControl.value);
            if (speedValueDisplay) speedValueDisplay.textContent = speed.toFixed(2) + "x";
            dispatchUIEvent('audioapp:speedChanged', { speed: speed });
        });
        gainControl?.addEventListener('input', () => {
            const gain = parseFloat(gainControl.value);
            if (gainValueDisplay) gainValueDisplay.textContent = gain.toFixed(2) + "x";
            dispatchUIEvent('audioapp:gainChanged', { gain: gain });
        });

        // VAD Tuning Sliders
        vadThresholdSlider?.addEventListener('input', handleVadSliderInput);
        vadNegativeThresholdSlider?.addEventListener('input', handleVadSliderInput);

        // Canvas clicks are handled by Visualizer module which dispatches 'audioapp:seekRequested'

        // Global Keyboard Shortcuts
        document.addEventListener('keydown', handleKeyDown);
    }

     // --- Specific Event Handlers ---

    /**
     * Handles keydown events for keyboard shortcuts.
     * Ignores events if focus is on input fields that accept text.
     * Dispatches 'audioapp:keyPressed' event.
     * @param {KeyboardEvent} e - The keyboard event.
     * @private
     */
     function handleKeyDown(e) {
        // Ignore shortcuts if user is typing in text/number input fields
        const target = e.target;
        const isTextInput = target.tagName === 'INPUT' && (
            target.type === 'text' ||
            target.type === 'number' ||
            target.type === 'search' ||
            target.type === 'email' ||
            target.type === 'password' ||
            target.type === 'url'
        );
        const isTextArea = target.tagName === 'TEXTAREA';

        if (isTextInput || isTextArea) {
            return; // Don't interfere with typing
        }

        let handled = false;
        let eventKey = null;

        switch (e.code) {
            case 'Space':
                // Space often scrolls, prevent if we handle it
                eventKey = 'Space';
                handled = true;
                break;
            case 'ArrowLeft':
                eventKey = 'ArrowLeft';
                handled = true; // Assume jump is always available if controls are enabled
                break;
            case 'ArrowRight':
                eventKey = 'ArrowRight';
                handled = true;
                break;
        }

        if (eventKey) {
             // Let app.js decide if action is valid based on current state (e.g., audio loaded)
             dispatchUIEvent('audioapp:keyPressed', { key: eventKey });
        }

        if (handled) {
            e.preventDefault(); // Prevent default browser action (scrolling, moving cursor in number input)
        }
    }

    /**
     * Handles input events from either VAD threshold slider.
     * Updates the corresponding value display and dispatches 'audioapp:thresholdChanged'.
     * @param {Event} e - The input event from the slider.
     * @private
     */
    function handleVadSliderInput(e) {
        const slider = /** @type {HTMLInputElement} */ (e.target);
        const value = parseFloat(slider.value);
        let type = null; // 'positive' or 'negative'

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


    // --- Helper to Dispatch Custom Events ---

    /**
     * Dispatches a custom event on the document.
     * @param {string} eventName - The name of the custom event (e.g., 'audioapp:playClicked').
     * @param {object} [detail={}] - Data to pass with the event in `event.detail`.
     * @private
     */
    function dispatchUIEvent(eventName, detail = {}) {
        // Design Decision: Dispatch events on `document` for global listening by `app.js`.
        document.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
    }

    // --- Public Methods for Updating UI (called by app.js) ---

    /**
     * Resets all UI elements to their initial state (e.g., on file load or error).
     * @public
     */
    function resetUI() {
        console.log("UIManager: Resetting UI");
        setFileInfo("No file selected.");
        setPlayButtonState(false); // Show 'Play'
        updateTimeDisplay(0, 0);
        setSpeechRegionsText("None");
        updateVadDisplay(0.5, 0.35, true); // Reset display text, mark as N/A
        // Reset slider visual positions and displays
        if (playbackSpeedControl) playbackSpeedControl.value = "1.0";
        if (speedValueDisplay) speedValueDisplay.textContent = "1.00x";
        if (gainControl) gainControl.value = "1.0";
        if (gainValueDisplay) gainValueDisplay.textContent = "1.00x";
        if (jumpTimeInput) jumpTimeInput.value = "5"; // Reset jump time input
        // Disable controls that depend on loaded audio
        enablePlaybackControls(false);
        enableVadControls(false);
        // Visualizer module handles clearing canvases and resetting progress bars
    }

    /**
     * Sets the text content of the file info display.
     * @param {string} text - The text to display.
     * @public
     */
    function setFileInfo(text) {
        if (fileInfo) fileInfo.textContent = text;
    }

    /**
     * Sets the text of the play/pause button.
     * @param {boolean} isPlaying - True to show 'Pause', false to show 'Play'.
     * @public
     */
    function setPlayButtonState(isPlaying) {
        if (playPauseButton) playPauseButton.textContent = isPlaying ? 'Pause' : 'Play';
    }

    /**
     * Updates the time display string (e.g., "1:23 / 4:56").
     * @param {number} currentTime - Current playback time in seconds.
     * @param {number} duration - Total audio duration in seconds.
     * @public
     */
    function updateTimeDisplay(currentTime, duration) {
        if (timeDisplay) timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    }

    /**
     * Sets the text content of the speech regions display area.
     * Can accept a string directly or an array of region objects.
     * @param {string | Array<{start: number, end: number}>} regionsOrText - Text or region array.
     * @public
     */
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
                speechRegionsDisplay.textContent = "No speech detected (at current threshold).";
            }
        } else {
             speechRegionsDisplay.textContent = "None"; // Default fallback
        }
    }

    /**
     * Updates the VAD threshold sliders and their value displays.
     * @param {number} positive - The positive threshold value.
     * @param {number} negative - The negative threshold value.
     * @param {boolean} [isNA=false] - If true, display "N/A" instead of values (used on reset).
     * @public
     */
    function updateVadDisplay(positive, negative, isNA = false) {
        if (isNA) {
            if (vadThresholdValueDisplay) vadThresholdValueDisplay.textContent = "N/A";
            if (vadNegativeThresholdValueDisplay) vadNegativeThresholdValueDisplay.textContent = "N/A";
            // Optionally reset slider positions visually, though disabled state is primary
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
     * Enables or disables playback-related controls.
     * @param {boolean} enable - True to enable, false to disable.
     * @public
     */
    function enablePlaybackControls(enable) {
        if (playPauseButton) playPauseButton.disabled = !enable;
        if (jumpBackButton) jumpBackButton.disabled = !enable;
        if (jumpForwardButton) jumpForwardButton.disabled = !enable;
        if (playbackSpeedControl) playbackSpeedControl.disabled = !enable;
        // gainControl is usually always enabled unless explicitly disabled
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
     * @returns {number} The jump time in seconds (defaults to 5 if invalid).
     * @public
     */
    function getJumpTime() {
        return parseFloat(jumpTimeInput?.value) || 5;
    }

    // --- Utility Functions ---

    /**
     * Formats time in seconds to a "MM:SS" string.
     * @param {number} sec - Time in seconds.
     * @returns {string} Formatted time string.
     * @private
     */
    function formatTime(sec) {
        if (isNaN(sec) || sec < 0) sec = 0;
        const minutes = Math.floor(sec / 60);
        const seconds = Math.floor(sec % 60);
        // Pad seconds with a leading zero if less than 10
        return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
    }

    // --- Public Interface ---
    // Expose methods needed by app.js to control the UI.
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
        // Spinner control delegated to Visualizer module as it relates to drawing computation
    };
})();
