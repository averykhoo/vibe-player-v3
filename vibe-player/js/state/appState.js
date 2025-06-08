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
            jumpTime: 5
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
    deserialize(hash) {
        // Placeholder for now.
        // Will parse keys like 'speed', 'pitch', 'time'.
        console.log("AppState.deserialize called with hash:", hash);
        // Example future implementation:
        // const params = new URLSearchParams(hash);
        // if (params.has(Constants.URLHashKeys.SPEED)) this.updateParam('speed', parseFloat(params.get(Constants.URLHashKeys.SPEED)));
        // ... and so on for other params ...
        // if (params.has(Constants.URLHashKeys.TIME)) this.updateRuntime('playbackStartSourceTime', parseFloat(params.get(Constants.URLHashKeys.TIME)))
    }

    serialize(currentPosition) {
        // Placeholder for now.
        // Will generate a string with keys like 'speed', 'pitch', 'time'.
        console.log("AppState.serialize called with currentPosition:", currentPosition);
        // Example future implementation:
        // const params = new URLSearchParams();
        // if (this.params.speed !== 1.0) params.set(Constants.URLHashKeys.SPEED, this.params.speed.toFixed(2));
        // ... and so on for other params ...
        // if (currentPosition > 0) params.set(Constants.URLHashKeys.TIME, currentPosition.toFixed(2));
        // return params.toString();
        return "";
    }
}
