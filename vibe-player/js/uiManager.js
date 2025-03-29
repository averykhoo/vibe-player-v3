// /vibe-player/js/uiManager.js

/**
 * Manages all interactions with the DOM, updates UI elements,
 * and dispatches events based on user actions.
 */
const uiManager = (() => {
    // --- Private Module State ---
    let config = null;

    // Cached DOM Elements
    const elements = {
        // File Loader
        audioFile: null,
        fileInfo: null,
        // Controls
        playPause: null,
        jumpBack: null,
        jumpTime: null,
        jumpForward: null,
        playbackSpeed: null,
        speedValue: null,
        gainControl: null,
        gainValue: null,
        timeDisplay: null,
        controlsSection: null, // Parent div for enabling/disabling all controls
        // VAD Tuning
        vadTuningSection: null,
        vadThreshold: null,
        vadThresholdValue: null,
        vadNegativeThreshold: null,
        vadNegativeThresholdValue: null,
        // Speech Info
        speechRegionsDisplay: null,
        // Visualizations (Containers/Spinners)
        spectrogramSpinner: null,
        // Status/Error display area (use fileInfo for now, or add a dedicated div)
        statusDisplay: null, // Using fileInfo as status/error display
    };

    // --- Private Methods ---

    /** Caches references to frequently used DOM elements. */
    function cacheDomElements() {
        elements.audioFile = document.getElementById('audioFile');
        elements.fileInfo = document.getElementById('fileInfo'); // Used for status/errors too
        elements.statusDisplay = elements.fileInfo; // Alias for clarity

        elements.playPause = document.getElementById('playPause');
        elements.jumpBack = document.getElementById('jumpBack');
        elements.jumpTime = document.getElementById('jumpTime');
        elements.jumpForward = document.getElementById('jumpForward');
        elements.playbackSpeed = document.getElementById('playbackSpeed');
        elements.speedValue = document.getElementById('speedValue');
        elements.gainControl = document.getElementById('gainControl');
        elements.gainValue = document.getElementById('gainValue');
        elements.timeDisplay = document.getElementById('timeDisplay');
        elements.controlsSection = document.getElementById('controls'); // The whole section

        elements.vadTuningSection = document.getElementById('vad-tuning');
        elements.vadThreshold = document.getElementById('vadThreshold');
        elements.vadThresholdValue = document.getElementById('vadThresholdValue');
        elements.vadNegativeThreshold = document.getElementById('vadNegativeThreshold');
        elements.vadNegativeThresholdValue = document.getElementById('vadNegativeThresholdValue');

        elements.speechRegionsDisplay = document.getElementById('speechRegionsDisplay');
        elements.spectrogramSpinner = document.getElementById('spectrogramSpinner');

        // Initial state: Disable controls until audio is loaded
        enableControls(false);
        disableFileInput(false); // File input starts enabled
    }

    /** Attaches event listeners to UI elements. */
    function attachEventListeners() {
        // File Input
        elements.audioFile?.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                dispatchEvent('audioapp:fileSelected', { file: file });
                // Optionally reset the input value to allow reloading the same file
                // event.target.value = null;
            }
        });

        // Playback Controls
        elements.playPause?.addEventListener('click', () => {
            dispatchEvent('audioapp:playPauseClicked');
        });
        elements.jumpBack?.addEventListener('click', () => {
            const seconds = parseFloat(elements.jumpTime?.value ?? config?.playback?.jumpSeconds ?? 5);
            dispatchEvent('audioapp:jumpClicked', { seconds: -seconds });
        });
        elements.jumpForward?.addEventListener('click', () => {
            const seconds = parseFloat(elements.jumpTime?.value ?? config?.playback?.jumpSeconds ?? 5);
            dispatchEvent('audioapp:jumpClicked', { seconds: seconds });
        });
        elements.jumpTime?.addEventListener('change', () => {
            // Optional: Validate input? Ensure it's positive?
            const seconds = Math.max(1, parseFloat(elements.jumpTime.value));
            elements.jumpTime.value = seconds; // Correct invalid values
        });

        // Sliders (use 'input' for real-time updates)
        elements.playbackSpeed?.addEventListener('input', (event) => {
            const speed = parseFloat(event.target.value);
            updateSpeedDisplay(speed); // Update display immediately
            dispatchEvent('audioapp:speedChanged', { value: speed });
        });
        elements.gainControl?.addEventListener('input', (event) => {
            const gain = parseFloat(event.target.value);
            updateGainDisplay(gain); // Update display immediately
            dispatchEvent('audioapp:gainChanged', { value: gain });
        });

        // VAD Tuning Sliders
        elements.vadThreshold?.addEventListener('input', handleVadSliderChange);
        elements.vadNegativeThreshold?.addEventListener('input', handleVadSliderChange);

        // Keyboard Shortcuts
        document.addEventListener('keydown', handleKeyDown);
    }

    /** Handles VAD slider changes and dispatches a single event. */
    function handleVadSliderChange() {
         const threshold = parseFloat(elements.vadThreshold.value);
         const negative_threshold = parseFloat(elements.vadNegativeThreshold.value);
         updateVadThresholdDisplay(threshold, negative_threshold); // Update display immediately

         // Dispatch a single event with both values
         dispatchEvent('audioapp:vadThresholdChanged', {
             threshold: threshold,
             negative_threshold: negative_threshold
         });
     }

    /** Handles keyboard shortcuts for playback. */
    function handleKeyDown(event) {
        // Ignore keypresses if modifier keys are held, or if typing in an input field
        if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
        const targetTagName = event.target.tagName.toLowerCase();
        if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
            return; // Don't interfere with form inputs
        }

        // Check if controls are enabled before dispatching actions
        const controlsEnabled = !(elements.playPause?.disabled ?? true);

        switch (event.code) {
            case 'Space':
                event.preventDefault(); // Prevent page scrolling
                if (controlsEnabled) dispatchEvent('audioapp:playPauseClicked');
                break;
            case 'ArrowLeft':
                event.preventDefault();
                if (controlsEnabled) {
                     const seconds = parseFloat(elements.jumpTime?.value ?? config?.playback?.jumpSeconds ?? 5);
                     dispatchEvent('audioapp:jumpClicked', { seconds: -seconds });
                }
                break;
            case 'ArrowRight':
                event.preventDefault();
                 if (controlsEnabled) {
                     const seconds = parseFloat(elements.jumpTime?.value ?? config?.playback?.jumpSeconds ?? 5);
                     dispatchEvent('audioapp:jumpClicked', { seconds: seconds });
                 }
                break;
            // Add more shortcuts if needed (e.g., speed up/down)
        }
    }

    /** Helper to dispatch custom events. */
    function dispatchEvent(eventName, detail = {}) {
        // console.log(`[UIEvent] Dispatching: ${eventName}`, detail); // Debugging events
        document.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
    }

    /** Formats time in seconds to M:SS.ms format. */
    function formatTime(seconds) {
        const min = Math.floor(seconds / 60);
        const sec = Math.floor(seconds % 60);
        const ms = Math.floor((seconds * 1000) % 1000);
        return `${min}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }

    // --- Public Methods (Called by other modules) ---

    /**
     * Sets the text content of the file info display area.
     * @param {string} text
     */
    function setFileInfo(text) {
        if (elements.fileInfo) {
            elements.fileInfo.textContent = text;
            elements.fileInfo.style.color = 'black'; // Reset color
        }
    }

    /**
     * Displays a status message (uses fileInfo area).
     * @param {string} text
     */
     function showStatus(text) {
        if (elements.statusDisplay) {
            elements.statusDisplay.textContent = `Status: ${text}`;
            elements.statusDisplay.style.color = '#555'; // Neutral color
        }
     }

    /**
     * Displays an error message (uses fileInfo area).
     * @param {string} message The error message.
     * @param {boolean} [isCritical=false] If true, might add extra styling.
     */
    function showError(message, isCritical = false) {
        console.error(`[UIError] ${message}`); // Log error to console too
        if (elements.statusDisplay) {
            elements.statusDisplay.textContent = `Error: ${message}`;
            elements.statusDisplay.style.color = 'red';
        }
    }

    /**
     * Shows or hides a loading indicator (uses spectrogram spinner for now).
     * @param {boolean} show True to show, false to hide.
     * @param {string} [text='Loading...'] Optional text for the spinner.
     */
    function showLoading(show, text = 'Loading...') {
        if (elements.spectrogramSpinner) {
            elements.spectrogramSpinner.style.display = show ? 'inline' : 'none';
            // elements.spectrogramSpinner.textContent = show ? `(${text})` : '';
             // Update general status as well
             if(show) showStatus(text);
        }
    }

    /**
     * Sets the state of the Play/Pause button.
     * @param {'Play' | 'Pause'} state
     */
    function setPlayButtonState(state) {
        if (elements.playPause) {
            elements.playPause.textContent = state;
        }
    }

    /**
     * Updates the time display.
     * @param {number} currentTime Current playback time in seconds.
     * @param {number} duration Total duration in seconds.
     */
    function updateTimeDisplay(currentTime, duration) {
        if (elements.timeDisplay) {
            const currentStr = formatTime(currentTime);
            const durationStr = formatTime(duration);
            elements.timeDisplay.textContent = `${currentStr} / ${durationStr}`;
        }
    }

    /**
     * Updates the gain slider value and text display.
     * @param {number} gain Gain value (0 to maxGain).
     */
    function updateGainDisplay(gain) {
        if (elements.gainValue) {
            elements.gainValue.textContent = `${gain.toFixed(2)}x`;
        }
        // Note: Slider value might be set externally via setGain method if needed
    }
     /**
      * Sets the gain slider value programmatically.
      * @param {number} gain Gain value (0 to maxGain).
      */
     function setGain(gain) {
         if (elements.gainControl) {
             elements.gainControl.value = gain;
         }
         updateGainDisplay(gain); // Also update the text display
     }

    /**
     * Updates the speed slider value and text display.
     * @param {number} speed Speed value (minSpeed to maxSpeed).
     */
    function updateSpeedDisplay(speed) {
        if (elements.speedValue) {
            elements.speedValue.textContent = `${speed.toFixed(2)}x`;
        }
         // Note: Slider value might be set externally via setSpeed method if needed
    }
    /**
     * Sets the speed slider value programmatically.
     * @param {number} speed Speed value.
     */
     function setSpeed(speed) {
         if (elements.playbackSpeed) {
             elements.playbackSpeed.value = speed;
         }
         updateSpeedDisplay(speed);
     }

    /**
     * Updates the VAD threshold slider text displays.
     * @param {number} threshold
     * @param {number} negative_threshold
     */
    function updateVadThresholdDisplay(threshold, negative_threshold) {
        if (elements.vadThresholdValue) {
             elements.vadThresholdValue.textContent = threshold.toFixed(2);
        }
        if (elements.vadNegativeThresholdValue) {
            elements.vadNegativeThresholdValue.textContent = negative_threshold.toFixed(2);
        }
    }
    /**
     * Sets the VAD threshold sliders programmatically.
     * @param {number} threshold
     * @param {number} negative_threshold
     */
    function setVadThresholds(threshold, negative_threshold) {
         if (elements.vadThreshold) {
              elements.vadThreshold.value = threshold;
         }
         if (elements.vadNegativeThreshold) {
             elements.vadNegativeThreshold.value = negative_threshold;
         }
         updateVadThresholdDisplay(threshold, negative_threshold);
    }

    /**
     * Updates the display area showing detected speech regions.
     * @param {object | null} vadResults Object containing { regions, stats } or null.
     */
    function updateVadDisplay(vadResults) {
        if (elements.speechRegionsDisplay) {
            if (!vadResults || !vadResults.regions || vadResults.regions.length === 0) {
                elements.speechRegionsDisplay.textContent = 'None';
            } else {
                const regionsText = vadResults.regions.map(r =>
                    `  ${formatTime(r.start)} - ${formatTime(r.end)} (Duration: ${(r.end - r.start).toFixed(3)}s)`
                ).join('\n');
                // const statsText = `Total Speech: ${formatTime(vadResults.stats?.totalSpeechTime ?? 0)}, Segments: ${vadResults.regions.length}`;
                // elements.speechRegionsDisplay.textContent = `${statsText}\n${regionsText}`;
                elements.speechRegionsDisplay.textContent = regionsText;
            }
        }
    }

    /**
     * Enables or disables playback controls and VAD tuning.
     * @param {boolean} enable True to enable, false to disable.
     */
    function enableControls(enable) {
        const elementsToToggle = [
            elements.playPause,
            elements.jumpBack,
            elements.jumpTime,
            elements.jumpForward,
            elements.playbackSpeed,
            elements.vadThreshold, // Enable VAD tuning along with playback
            elements.vadNegativeThreshold
        ];
        elementsToToggle.forEach(el => {
            if (el) el.disabled = !enable;
        });
        // Keep gain enabled even if not playing? Yes, typically volume works anytime.
        // if (elements.gainControl) elements.gainControl.disabled = !enable;

        // Initially set VAD displays based on config
        if(enable && config) {
            setVadThresholds(config.vad.threshold, config.vad.negative_threshold);
        } else if (!enable) {
             if(elements.vadThresholdValue) elements.vadThresholdValue.textContent = 'N/A';
             if(elements.vadNegativeThresholdValue) elements.vadNegativeThresholdValue.textContent = 'N/A';
        }

        console.log(`[UIManager] Controls ${enable ? 'enabled' : 'disabled'}`);
    }

     /**
      * Enables or disables the file input element.
      * @param {boolean} disable True to disable, false to enable.
      */
     function disableFileInput(disable) {
         if (elements.audioFile) {
             elements.audioFile.disabled = disable;
         }
     }


// --- Public API ---
    return {
        /**
         * Initializes the UIManager. Caches elements and attaches listeners.
         * @param {AudioAppConfig} appConfig The application configuration.
         */
        init(appConfig) {
            if (!appConfig) throw new Error("UIManager requires config.");
            config = appConfig;
            cacheDomElements();
            attachEventListeners();
            // Set initial UI states based on config
            setGain(config.playback.defaultGain);
            setSpeed(config.playback.defaultSpeed);
            if (elements.jumpTime) elements.jumpTime.value = config.playback.jumpSeconds;
            updateTimeDisplay(0, 0); // Initial time display
            setVadThresholds(config.vad.threshold, config.vad.negative_threshold); // Set initial VAD slider values
            setFileInfo("Please load an audio file.");
            console.log("UIManager initialized.");
        },

        // Expose necessary update methods
        setFileInfo,
        showStatus,
        showError,
        showLoading,
        setPlayButtonState,
        updateTimeDisplay,
        updateGainDisplay,
        updateSpeedDisplay,
        updateVadThresholdDisplay,
        updateVadDisplay,
        enableControls,
        disableFileInput,
        // Expose methods to programmatically set slider values if needed
        setGain,
        setSpeed,
        setVadThresholds
    };
})();

// Attach to the global AudioApp namespace
if (typeof window.AudioApp === 'undefined') {
    window.AudioApp = {};
}
window.AudioApp.uiManager = uiManager;
console.log("UIManager module loaded.");

// /vibe-player/js/uiManager.js
