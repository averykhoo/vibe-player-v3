// In vibe-player/js/state/appState.js
class AppState {
    constructor() {
        // --- State Categories ---
        this.params = {
            speed: 1.0,
            pitch: 1.0,
            gain: 1.0,
            vadPositive: typeof Constants !== 'undefined' ? Constants.VAD.DEFAULT_POSITIVE_THRESHOLD : 0.5,
            vadNegative: typeof Constants !== 'undefined' ? Constants.VAD.DEFAULT_NEGATIVE_THRESHOLD : 0.35,
            audioUrl: "", // Default to empty string for consistency
            jumpTime: 5,
            initialSeekTime: null // Added for deserializing time parameter
        };
        this.runtime = {
            currentAudioBuffer: null,
            currentVadResults: null,
            currentFile: null,
            // For playback time tracking (might be simplified later)
            playbackStartTimeContext: null,
            playbackStartSourceTime: 0.0,
            currentSpeedForUpdate: 1.0 // Tracks speed for UI time calculation
        };
        this.status = {
            isActuallyPlaying: false,
            vadModelReady: false,       // Assuming VAD model readiness is tracked
            workletPlaybackReady: false,
            isVadProcessing: false,
            playbackNaturallyEnded: false,
            urlInputStyle: 'default', // For uiManager.setUrlInputStyle
            fileInfoMessage: "No file selected.", // For uiManager.setFileInfo
            urlLoadingErrorMessage: "" // For uiManager.setUrlLoadingError
        };

        // --- Pub/Sub ---
        this._subscribers = {}; // Example: { "param:speed:changed": [callback1, callback2] }
    }

    // --- Public Methods ---
    updateParam(param, value) {
        if (this.params.hasOwnProperty(param)) {
            if (this.params[param] !== value) {
                this.params[param] = value;
                this._notify('param:' + param + ':changed', value);
                this._notify('param:changed', { param: param, value: value }); // Generic notification
            }
        } else {
            console.warn(`AppState: Attempted to update unknown param "${param}"`);
        }
    }

    updateRuntime(property, value) {
        if (this.runtime.hasOwnProperty(property)) {
            // For objects like currentAudioBuffer or currentVadResults, a shallow inequality check is often sufficient,
            // but for deep changes within these objects, the caller might need to ensure a new object reference is passed
            // or this method might need a more sophisticated deep comparison if granular notifications are not used.
            if (this.runtime[property] !== value) {
                this.runtime[property] = value;
                this._notify('runtime:' + property + ':changed', value);
            }
        } else {
            console.warn(`AppState: Attempted to update unknown runtime property "${property}"`);
        }
    }

    updateStatus(flag, value) {
        if (this.status.hasOwnProperty(flag)) {
            if (this.status[flag] !== value) {
                this.status[flag] = value;
                this._notify('status:' + flag + ':changed', value);
            }
        } else {
            console.warn(`AppState: Attempted to update unknown status flag "${flag}"`);
        }
    }

    subscribe(event, callback) {
        if (typeof callback !== 'function') {
            console.error(`AppState: Attempted to subscribe with non-function callback for event "${event}"`);
            return;
        }
        if (!this._subscribers[event]) {
            this._subscribers[event] = [];
        }
        if (!this._subscribers[event].includes(callback)) {
            this._subscribers[event].push(callback);
        }
    }

    unsubscribe(event, callback) {
        if (this._subscribers[event]) {
            this._subscribers[event] = this._subscribers[event].filter(cb => cb !== callback);
            if (this._subscribers[event].length === 0) {
                delete this._subscribers[event];
            }
        }
    }

    _notify(event, data) {
        if (this._subscribers[event]) {
            this._subscribers[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in subscriber for event "${event}":`, error);
                }
            });
        }
    }

    // --- Serialization / Deserialization ---
    deserialize(hashString) {
        if (!hashString) {
            return;
        }
        // Ensure Constants and its nested properties are available
        if (typeof Constants === 'undefined' || !Constants.URLHashKeys) {
            console.error("AppState.deserialize: Constants or Constants.URLHashKeys are not defined. Cannot deserialize.");
            return;
        }
        const searchParams = new URLSearchParams(hashString);
        const C_URL_KEYS = Constants.URLHashKeys; // Alias

        const speedStr = searchParams.get(C_URL_KEYS.SPEED);
        if (speedStr) {
            const speed = parseFloat(speedStr);
            if (!isNaN(speed)) this.updateParam('speed', speed);
        }

        const pitchStr = searchParams.get(C_URL_KEYS.PITCH);
        if (pitchStr) {
            const pitch = parseFloat(pitchStr);
            if (!isNaN(pitch)) this.updateParam('pitch', pitch);
        }

        const gainStr = searchParams.get(C_URL_KEYS.GAIN);
        if (gainStr) {
            const gain = parseFloat(gainStr);
            if (!isNaN(gain)) this.updateParam('gain', gain);
        }

        const vadPositiveStr = searchParams.get(C_URL_KEYS.VAD_POSITIVE);
        if (vadPositiveStr) {
            const vadPositive = parseFloat(vadPositiveStr);
            if (!isNaN(vadPositive)) this.updateParam('vadPositive', vadPositive);
        }

        const vadNegativeStr = searchParams.get(C_URL_KEYS.VAD_NEGATIVE);
        if (vadNegativeStr) {
            const vadNegative = parseFloat(vadNegativeStr);
            if (!isNaN(vadNegative)) this.updateParam('vadNegative', vadNegative);
        }

        const audioUrl = searchParams.get(C_URL_KEYS.AUDIO_URL);
        if (audioUrl) { // No parsing needed for string
            this.updateParam('audioUrl', audioUrl);
        }

        const timeStr = searchParams.get(C_URL_KEYS.TIME);
        if (timeStr) {
            const time = parseFloat(timeStr);
            if (!isNaN(time) && time >= 0) { // Allow t=0
                this.updateParam('initialSeekTime', time);
            }
        }
        // console.log("AppState.deserialize: Processed hash string.");
    }

    serialize(currentPosition) {
        const searchParams = new URLSearchParams();

        // Ensure Constants and its nested properties are available
        if (typeof Constants === 'undefined' || !Constants.URLHashKeys || !Constants.VAD) {
            console.error("AppState.serialize: Constants or required sub-properties (URLHashKeys, VAD) are not defined. Cannot serialize.");
            return ""; // Return empty string or handle error as appropriate
        }

        const C_URL_KEYS = Constants.URLHashKeys;
        const C_VAD_DEFAULTS = Constants.VAD;

        if (this.params.speed !== 1.0) {
            searchParams.set(C_URL_KEYS.SPEED, this.params.speed.toFixed(2));
        }
        if (this.params.pitch !== 1.0) {
            searchParams.set(C_URL_KEYS.PITCH, this.params.pitch.toFixed(2));
        }
        if (this.params.gain !== 1.0) {
            searchParams.set(C_URL_KEYS.GAIN, this.params.gain.toFixed(2));
        }
        // Check against undefined for VAD defaults in case Constants was loaded but VAD part is missing (defensive)
        if (C_VAD_DEFAULTS.DEFAULT_POSITIVE_THRESHOLD !== undefined && this.params.vadPositive !== C_VAD_DEFAULTS.DEFAULT_POSITIVE_THRESHOLD) {
            searchParams.set(C_URL_KEYS.VAD_POSITIVE, this.params.vadPositive.toFixed(2));
        }
        if (C_VAD_DEFAULTS.DEFAULT_NEGATIVE_THRESHOLD !== undefined && this.params.vadNegative !== C_VAD_DEFAULTS.DEFAULT_NEGATIVE_THRESHOLD) {
            searchParams.set(C_URL_KEYS.VAD_NEGATIVE, this.params.vadNegative.toFixed(2));
        }
        if (this.params.audioUrl) { // Check for truthiness (not null or empty string)
            searchParams.set(C_URL_KEYS.AUDIO_URL, this.params.audioUrl);
        }
        // Using a small threshold like 0.1s to avoid writing 't=0.00' for very start.
        if (typeof currentPosition === 'number' && currentPosition > 0.1) {
            searchParams.set(C_URL_KEYS.TIME, currentPosition.toFixed(2));
        }
        // console.log("AppState.serialize: generated hash params:", searchParams.toString());
        return searchParams.toString();
    }
}
