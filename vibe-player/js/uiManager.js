// --- /vibe-player/js/uiManager.js ---
/**
 * @namespace AudioApp.uiManager
 * @description Handles DOM manipulation, UI event listeners, and dispatches UI events for Vibe Player Pro.
 * Interacts with the DOM based on IDs defined in index.html. Does not contain application logic.
 * It is initialized by main.js and provides methods to update the UI and get current control values.
 */
var AudioApp = AudioApp || {}; // Ensure namespace exists

AudioApp.uiManager = (function() {
    'use strict';

    // --- Cached DOM Elements ---
    // This object will be populated by assignDOMElements()
    let elements = {};

    /**
     * Initializes the UI Manager: caches elements, sets initial UI states/values based on defaults, adds listeners.
     * Called by main.js after the DOM is ready.
     * @param {number} initialGain - Default gain value.
     * @param {number} initialSpeed - Default speed value.
     * @param {number} initialPitch - Default pitch value in semitones.
     * @param {number} initialFormant - Default formant scale value.
     * @param {number} initialHybridThreshold - Default hybrid threshold value.
     * @param {number} initialSlowSpeed - Default pre-processing slow speed value.
     * @public
     */
    function init(initialGain, initialSpeed, initialPitch, initialFormant, initialHybridThreshold, initialSlowSpeed) {
        console.log("UIManager: Initializing...");
        assignDOMElements();
        setupEventListeners();

        // Set initial display values for sliders/inputs using defaults from config (passed via main.js)
        // This ensures the UI reflects the starting state before any user interaction.
        updateParamDisplay('gainControl', initialGain);
        updateParamDisplay('speedControl', initialSpeed);
        updateParamDisplay('pitchControl', initialPitch);
        updateParamDisplay('formantControl', initialFormant);
        updateParamDisplay('hybridThreshold', initialHybridThreshold);
        if (elements.initialSlowSpeed) elements.initialSlowSpeed.value = initialSlowSpeed.toFixed(2); // For number input

        // Set initial select values (if they exist)
        if (elements.switchBehavior) elements.switchBehavior.value = AudioApp.config.DEFAULT_SWITCH_BEHAVIOR;
        if (elements.sourceToggle) elements.sourceToggle.value = AudioApp.config.DEFAULT_SOURCE_OVERRIDE;

        resetUI(); // Call reset to apply initial disabled states and default text content
        console.log("UIManager: Initialized.");
    }

    // --- DOM Element Caching ---
    /**
     * Finds and stores references to all required DOM elements based on their IDs.
     * @private
     */
    function assignDOMElements() {
        const ids = [
            // File & Info
            'audioFile', 'fileInfo',
            // Playback Controls
            'playPause', 'jumpBack', 'jumpForward', 'jumpTime', 'timeDisplay',
            // Real-time Parameters
            'speedControl', 'speedValue', 'pitchControl', 'pitchValue',
            'formantControl', 'formantValue', 'gainControl', 'gainValue',
            // Hybrid Settings
            'hybridThreshold', 'hybridThresholdValue', 'initialSlowSpeed',
            'switchBehavior', 'sourceToggle',
            // VAD Tuning
            'vadThreshold', 'vadThresholdValue', 'vadNegativeThreshold', 'vadNegativeThresholdValue',
            // VAD Info
            'speechRegionsDisplay',
            // Visualizations (References needed for context/size, drawing handled by Visualizer)
            'waveformCanvas', 'spectrogramCanvas', 'spectrogramSpinner',
            'waveformProgressBar', 'waveformProgressIndicator',
            'spectrogramProgressBar', 'spectrogramProgressIndicator'
        ];
        ids.forEach(id => {
            elements[id] = document.getElementById(id);
            // Optional: Check if element exists during assignment
            // if (!elements[id]) console.warn(`UIManager: Element not found: #${id}`);
        });

        // Perform a basic check for a few critical elements
         if (!elements.audioFile || !elements.playPause || !elements.waveformCanvas) {
             console.warn("UIManager: Could not find all required core UI elements! Check IDs in index.html.");
        }
    }

    // --- Event Listener Setup ---
    /**
     * Attaches event listeners to the cached DOM elements.
     * These listeners typically dispatch custom events for main.js to handle.
     * @private
     */
    function setupEventListeners() {
        // File Input: Dispatches 'audioapp:fileSelected'
        elements.audioFile?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) {
                dispatchUIEvent('audioapp:fileSelected', { file: file });
            }
            elements.audioFile.blur(); // Remove focus to enable keyboard shortcuts
        });

        // Playback Buttons: Dispatch respective events
        elements.playPause?.addEventListener('click', () => dispatchUIEvent('audioapp:playPauseClicked'));
        elements.jumpBack?.addEventListener('click', () => dispatchUIEvent('audioapp:jumpClicked', { seconds: -getCurrentConfigInternal().jumpTime }));
        elements.jumpForward?.addEventListener('click', () => dispatchUIEvent('audioapp:jumpClicked', { seconds: getCurrentConfigInternal().jumpTime }));

        // Parameter Sliders (Real-time & Hybrid Threshold): Dispatch 'audioapp:paramChanged'
        ['speedControl', 'pitchControl', 'formantControl', 'gainControl', 'hybridThreshold'].forEach(id => {
            elements[id]?.addEventListener('input', handleParamSliderInput);
        });

        // Other Parameter Inputs/Selects (Hybrid Settings): Dispatch 'audioapp:paramChanged'
        ['initialSlowSpeed', 'switchBehavior', 'sourceToggle'].forEach(id => {
             // Use 'change' event for <select> and <input type="number"> for better timing
             elements[id]?.addEventListener('change', handleParamInputChange);
        });

        // VAD Tuning Sliders: Dispatch 'audioapp:vadThresholdChanged'
        elements.vadThreshold?.addEventListener('input', handleVadSliderInput);
        elements.vadNegativeThreshold?.addEventListener('input', handleVadSliderInput);

        // Global Keyboard Shortcuts: Dispatch 'audioapp:keyPressed'
        document.addEventListener('keydown', handleKeyDown);

        // Note: Canvas click listeners are handled by the Visualizer module.
    }

    // --- Specific Event Handlers ---

    /**
     * Handles 'input' events from parameter sliders (range inputs).
     * Updates the associated display span and dispatches a generic parameter change event.
     * @param {Event} e - The input event object.
     * @private
     */
    function handleParamSliderInput(e) {
        const slider = /** @type {HTMLInputElement} */ (e.target);
        const value = parseFloat(slider.value);
        updateParamDisplay(slider.id, value); // Update the text display (e.g., "1.50x")
        // Dispatch a generic event; main.js will query all current parameters if needed.
        dispatchUIEvent('audioapp:paramChanged', { param: slider.id, value: value });
    }

    /**
     * Handles 'change' events from parameter inputs (number, select).
     * Dispatches a generic parameter change event.
     * @param {Event} e - The change event object.
     * @private
     */
    function handleParamInputChange(e) {
         const input = /** @type {HTMLInputElement | HTMLSelectElement} */ (e.target);
         const value = (input.type === 'number') ? parseFloat(input.value) : input.value;
         // No separate display update needed for these typically.
         dispatchUIEvent('audioapp:paramChanged', { param: input.id, value: value });
    }

    /**
     * Handles 'input' events from the VAD threshold sliders.
     * Updates the display and dispatches a specific VAD threshold change event.
     * @param {Event} e - The input event object.
     * @private
     */
    function handleVadSliderInput(e) {
        const slider = /** @type {HTMLInputElement} */ (e.target);
        const value = parseFloat(slider.value);
        let type = null; // 'positive' or 'negative'

        if (slider === elements.vadThreshold && elements.vadThresholdValue) {
            elements.vadThresholdValue.textContent = value.toFixed(2);
            type = 'positive';
        } else if (slider === elements.vadNegativeThreshold && elements.vadNegativeThresholdValue) {
            elements.vadNegativeThresholdValue.textContent = value.toFixed(2);
            type = 'negative';
        }

        // Dispatch a specific event for VAD changes, as this triggers recalculation, not playback param updates.
        if (type) {
             dispatchUIEvent('audioapp:vadThresholdChanged', { type: type, value: value });
        }
    }

    /**
     * Handles global keydown events for keyboard shortcuts.
     * Prevents interference with text inputs. Dispatches 'audioapp:keyPressed'.
     * @param {KeyboardEvent} e - The keyboard event object.
     * @private
     */
     function handleKeyDown(e) {
        // Ignore shortcuts if focus is on an element where typing is expected.
        const target = /** @type {HTMLElement} */ (e.target);
        const isTextInput = target.tagName === 'INPUT' && (
            target.type === 'text' || target.type === 'number' || target.type === 'search' ||
            target.type === 'email' || target.type === 'password' || target.type === 'url'
        );
        const isTextArea = target.tagName === 'TEXTAREA';
        const isContentEditable = target.isContentEditable;

        if (isTextInput || isTextArea || isContentEditable) {
            return; // Don't interfere with user typing
        }

        let handled = false;
        let eventKey = null;

        // Map key codes to actions
        switch (e.code) {
            case 'Space':
                eventKey = 'Space';
                handled = true; // We intend to handle Space for play/pause
                break;
            case 'ArrowLeft':
                eventKey = 'ArrowLeft';
                handled = true; // Handle jump back
                break;
            case 'ArrowRight':
                eventKey = 'ArrowRight';
                handled = true; // Handle jump forward
                break;
        }

        if (eventKey) {
             // Let main.js decide if the action is valid based on the current application state.
             dispatchUIEvent('audioapp:keyPressed', { key: eventKey });
        }

        // Prevent default browser action (e.g., scrolling page with spacebar) if we handled the key.
        if (handled) {
            e.preventDefault();
        }
    }

    // --- Helper to Update Parameter Displays ---
    /**
     * Updates the text content (span) associated with a control slider/input.
     * @param {string} controlId - The ID of the input/range element (e.g., 'speedControl').
     * @param {number} value - The numerical value to display.
     * @private
     */
    function updateParamDisplay(controlId, value) {
        let displayElement = null;
        let text = '';
        // Determine the correct display element and format the text based on the control ID.
        switch (controlId) {
            case 'speedControl':      displayElement = elements.speedValue; text = `${value.toFixed(2)}x`; break;
            case 'pitchControl':      displayElement = elements.pitchValue; text = `${value.toFixed(1)} ST`; break;
            case 'formantControl':    displayElement = elements.formantValue; text = `${value.toFixed(2)}x`; break;
            case 'gainControl':       displayElement = elements.gainValue; text = `${value.toFixed(2)}x`; break;
            case 'hybridThreshold':   displayElement = elements.hybridThresholdValue; text = `${value.toFixed(2)}x`; break;
            // VAD threshold displays are handled in handleVadSliderInput
            // Initial Slow Speed (number input) doesn't have a separate display span
        }
        if (displayElement) {
            displayElement.textContent = text;
        }
        // Also update the slider's value attribute visually if needed (though `value` property is the source of truth)
        // if (elements[controlId] && elements[controlId].type === 'range') {
        //     elements[controlId].value = value.toString();
        // }
    }

    // --- Event Dispatch Helper ---
    /**
     * Dispatches a custom event on the document object.
     * @param {string} eventName - The name of the event (e.g., 'audioapp:playClicked').
     * @param {object} [detail={}] - Data to include in event.detail.
     * @private
     */
    function dispatchUIEvent(eventName, detail = {}) {
        // Dispatch globally for main.js to catch.
        document.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
    }

    // --- Public Methods for Updating UI ---
    // These methods are called by main.js to reflect changes in application state.

    /**
     * Resets the UI to its initial state, typically called before loading a new file or on error.
     * Disables controls that depend on loaded audio.
     * @public
     */
    function resetUI() {
        console.log("UIManager: Resetting UI to initial state.");
        setFileInfo("No file selected."); // Reset file info message
        setPlayButtonState(false); // Show 'Play'
        updateTimeDisplay(0, 0); // Reset time display
        setSpeechRegionsText("None"); // Clear VAD regions display

        // Reset VAD slider displays to 'N/A' and their default positions
        updateVadDisplay(
            AudioApp.config.DEFAULT_VAD_POSITIVE_THRESHOLD,
            AudioApp.config.DEFAULT_VAD_NEGATIVE_THRESHOLD,
            true // Mark as N/A
        );

        // Disable controls that require loaded audio/processing
        enableControls(false);

        // Reset parameter displays/values to their initial defaults (set during init)
        // Query config for defaults to ensure consistency
        const cfg = AudioApp.config;
        const initialParams = {
            speedControl: cfg.DEFAULT_SPEED, pitchControl: cfg.DEFAULT_PITCH_SEMITONES,
            formantControl: cfg.DEFAULT_FORMANT_SCALE, gainControl: cfg.DEFAULT_GAIN,
            hybridThreshold: cfg.DEFAULT_HYBRID_THRESHOLD
        };
        Object.entries(initialParams).forEach(([id, value]) => {
             if (elements[id]) elements[id].value = value.toString();
             updateParamDisplay(id, value);
        });
        if (elements.initialSlowSpeed) elements.initialSlowSpeed.value = cfg.DEFAULT_INITIAL_SLOW_SPEED.toFixed(2);
        if (elements.switchBehavior) elements.switchBehavior.value = cfg.DEFAULT_SWITCH_BEHAVIOR;
        if (elements.sourceToggle) elements.sourceToggle.value = cfg.DEFAULT_SOURCE_OVERRIDE;
        if (elements.jumpTime) elements.jumpTime.value = cfg.DEFAULT_JUMP_SECONDS.toString();

        // Ensure error styling is reset
         if(elements.fileInfo) {
            elements.fileInfo.style.color = '';
            elements.fileInfo.style.fontWeight = '';
         }
    }

    /**
     * Resets the UI specifically for the loading/processing phase.
     * Disables controls and shows a loading message.
     * @param {string} loadingFileName - The name of the file being loaded.
     * @public
     */
    function resetUIForLoading(loadingFileName) {
         console.log("UIManager: Setting UI for loading state...");
         setFileInfo(`Loading: ${loadingFileName}...`); // Initial loading message
         setPlayButtonState(false);
         updateTimeDisplay(0, 0);
         setSpeechRegionsText("Processing..."); // Indicate VAD is pending
         updateVadDisplay( // Reset VAD display
             AudioApp.config.DEFAULT_VAD_POSITIVE_THRESHOLD,
             AudioApp.config.DEFAULT_VAD_NEGATIVE_THRESHOLD,
             true // Mark as N/A initially
         );
         enableControls(false); // Disable all interactive controls during load/process
          // Keep file input enabled to allow selecting a different file? Or disable?
         // elements.audioFile.disabled = true; // Example: Disable while processing
          if(elements.fileInfo) { // Reset error styles
             elements.fileInfo.style.color = '';
             elements.fileInfo.style.fontWeight = '';
          }
    }

    /**
     * Sets the text content of the file info display area.
     * @param {string} text - The text to display.
     * @param {boolean} [isError=false] - If true, style the text as an error.
     * @public
     */
    function setFileInfo(text, isError = false) {
        if (elements.fileInfo) {
            elements.fileInfo.textContent = text;
            elements.fileInfo.style.color = isError ? 'red' : '';
            elements.fileInfo.style.fontWeight = isError ? 'bold' : '';
        }
    }

    /**
     * Sets the text content of the play/pause button ('Play' or 'Pause').
     * @param {boolean} isPlaying - True to display 'Pause', false for 'Play'.
     * @public
     */
    function setPlayButtonState(isPlaying) {
        if (elements.playPause) {
            elements.playPause.textContent = isPlaying ? 'Pause' : 'Play';
        }
    }

    /**
     * Updates the time display string (e.g., "01:23 / 04:56").
     * @param {number} currentTime - Current playback time in seconds.
     * @param {number} duration - Total audio duration in seconds.
     * @public
     */
    function updateTimeDisplay(currentTime, duration) {
        if (elements.timeDisplay) {
            elements.timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
        }
    }

    /**
     * Sets the text content of the speech regions display area.
     * Formats an array of region objects or displays the given text directly.
     * @param {string | Array<{start: number, end: number}>} regionsOrText - Text or region array.
     * @public
     */
    function setSpeechRegionsText(regionsOrText) {
        if (!elements.speechRegionsDisplay) return;

        if (typeof regionsOrText === 'string') {
             elements.speechRegionsDisplay.textContent = regionsOrText;
        } else if (Array.isArray(regionsOrText)) {
            if (regionsOrText.length > 0) {
                // Format each region and join with newlines
                elements.speechRegionsDisplay.textContent = regionsOrText
                    .map(r => `Start: ${r.start.toFixed(2)}s, End: ${r.end.toFixed(2)}s`)
                    .join('\n');
            } else {
                elements.speechRegionsDisplay.textContent = "No speech detected (at current threshold).";
            }
        } else {
             // Fallback for invalid input
             elements.speechRegionsDisplay.textContent = "None";
        }
    }

    /**
     * Updates the VAD threshold sliders' positions and their value displays.
     * @param {number} positive - The positive threshold value (0.01-0.99).
     * @param {number} negative - The negative threshold value (0.01-0.99).
     * @param {boolean} [isNA=false] - If true, display "N/A" and reset sliders visually (used on reset/error).
     * @public
     */
    function updateVadDisplay(positive, negative, isNA = false) {
        if (isNA) {
            // Set display text to N/A
            if (elements.vadThresholdValue) elements.vadThresholdValue.textContent = "N/A";
            if (elements.vadNegativeThresholdValue) elements.vadNegativeThresholdValue.textContent = "N/A";
            // Optionally reset slider positions visually to their defaults
             if (elements.vadThreshold) elements.vadThreshold.value = AudioApp.config.DEFAULT_VAD_POSITIVE_THRESHOLD.toString();
             if (elements.vadNegativeThreshold) elements.vadNegativeThreshold.value = AudioApp.config.DEFAULT_VAD_NEGATIVE_THRESHOLD.toString();
        } else {
            // Update slider positions and display text with current values
            if (elements.vadThreshold) elements.vadThreshold.value = positive.toString();
            if (elements.vadThresholdValue) elements.vadThresholdValue.textContent = positive.toFixed(2);
            if (elements.vadNegativeThreshold) elements.vadNegativeThreshold.value = negative.toString();
            if (elements.vadNegativeThresholdValue) elements.vadNegativeThresholdValue.textContent = negative.toFixed(2);
        }
    }

    /**
     * Enables or disables interactive controls based on application state (e.g., audio loaded).
     * @param {boolean} enable - True to enable, false to disable.
     * @public
     */
    function enableControls(enable) {
        // Define which controls depend on audio being fully loaded and processed
        const requiresAudio = [
            'playPause', 'jumpBack', 'jumpForward', 'jumpTime',
            'speedControl', 'pitchControl', 'formantControl',
            'hybridThreshold', 'initialSlowSpeed', 'switchBehavior', 'sourceToggle',
            'vadThreshold', 'vadNegativeThreshold'
        ];

        requiresAudio.forEach(id => {
             if (elements[id]) {
                 elements[id].disabled = !enable;
             }
        });

        // Controls that might always be enabled (or have different logic)
        // elements.gainControl.disabled = false; // Volume potentially always enabled
        // elements.audioFile.disabled = enable; // Example: disable file input *after* successful load
    }

    /**
     * Displays an error message prominently in the file info area.
     * @param {string} message - The error message to display.
     * @param {boolean} [isFatal=false] - If true, indicates a more severe error.
     * @public
     */
    function showError(message, isFatal = false) {
        console.error(`UIManager: Displaying Error - ${message}`);
        // Use setFileInfo for consistent styling
        setFileInfo(`ERROR: ${message}`, true); // Pass true for error styling
        // Could add more visual cues for fatal errors if desired
    }

    // --- Getters for Current UI State --- (Used by main.js)

    /**
     * Gets all current parameter values relevant to audio processing from UI controls.
     * @returns {object} An object containing current parameter values.
     * @public
     */
    function getCurrentParams() {
        // Ensure defaults are returned if elements don't exist or values are invalid
        const safeParseFloat = (value, defaultValue) => {
            const parsed = parseFloat(value);
            return isNaN(parsed) ? defaultValue : parsed;
        };
        const cfg = AudioApp.config; // Alias defaults

        return {
            speed: safeParseFloat(elements.speedControl?.value, cfg.DEFAULT_SPEED),
            pitchSemitones: safeParseFloat(elements.pitchControl?.value, cfg.DEFAULT_PITCH_SEMITONES),
            formantScale: safeParseFloat(elements.formantControl?.value, cfg.DEFAULT_FORMANT_SCALE),
            gain: safeParseFloat(elements.gainControl?.value, cfg.DEFAULT_GAIN),
            hybridThreshold: safeParseFloat(elements.hybridThreshold?.value, cfg.DEFAULT_HYBRID_THRESHOLD),
            // Get non-numeric config values directly
            switchBehavior: elements.switchBehavior?.value ?? cfg.DEFAULT_SWITCH_BEHAVIOR,
            sourceOverride: elements.sourceToggle?.value ?? cfg.DEFAULT_SOURCE_OVERRIDE,
            // initialSlowSpeed is config, not typically sent as a real-time param
        };
    }

    /**
     * Gets configuration values set via UI elements (like jump time, initial slow speed).
     * @returns {object} An object containing current configuration values from the UI.
     * @public
     */
    function getCurrentConfig() {
        const safeParseFloat = (value, defaultValue) => {
            const parsed = parseFloat(value);
            return isNaN(parsed) ? defaultValue : parsed;
        };
         const cfg = AudioApp.config;

         return {
            jumpTime: safeParseFloat(elements.jumpTime?.value, cfg.DEFAULT_JUMP_SECONDS),
            // Get values needed for offline processing or worklet initialization
            initialSlowSpeed: safeParseFloat(elements.initialSlowSpeed?.value, cfg.DEFAULT_INITIAL_SLOW_SPEED),
            hybridThreshold: safeParseFloat(elements.hybridThreshold?.value, cfg.DEFAULT_HYBRID_THRESHOLD)
            // Add others here if needed by main.js for setup/processing
         };
    }

    /**
     * Gets the current playback time and duration currently displayed in the UI.
     * Useful for quick access (e.g., on resize) without querying the worklet.
     * @returns {{currentTime: number, duration: number}}
     * @public
     */
    function getCurrentTimes() {
         const text = elements.timeDisplay?.textContent || "0:00 / 0:00";
         const parts = text.split('/');
         return {
             currentTime: parseTime(parts[0]),
             duration: parseTime(parts[1])
         };
    }

    // --- Private Utility Functions ---

    /**
     * Formats time in seconds to a "MM:SS" string.
     * @param {number} sec - Time in seconds.
     * @returns {string} Formatted time string (e.g., "01:23").
     * @private
     */
    function formatTime(sec) {
        if (isNaN(sec) || sec < 0) sec = 0;
        const minutes = Math.floor(sec / 60);
        const seconds = Math.floor(sec % 60);
        // Pad seconds with a leading zero if less than 10
        return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
    }

    /**
     * Parses a "MM:SS" string back into seconds.
     * @param {string} timeStr - The formatted time string.
     * @returns {number} Time in seconds, or 0 on parsing error.
     * @private
     */
     function parseTime(timeStr) {
        try {
            const parts = (timeStr || "").trim().split(':');
            const minutes = parseInt(parts[0], 10);
            const seconds = parseInt(parts[1], 10);
            if (isNaN(minutes) || isNaN(seconds)) return 0;
            return (minutes * 60) + seconds;
         } catch {
            return 0; // Return 0 if parsing fails
         }
     }

    // --- Public Interface ---
    // Expose methods needed by main.js to interact with the UI.
    return {
        init,
        resetUI,
        resetUIForLoading,
        setFileInfo,
        setPlayButtonState,
        updateTimeDisplay,
        setSpeechRegionsText,
        updateVadDisplay,
        enableControls,
        showError,
        getCurrentParams,
        getCurrentConfig,
        getCurrentTimes
    };
})(); // End of uiManager IIFE

// --- /vibe-player/js/uiManager.js ---
