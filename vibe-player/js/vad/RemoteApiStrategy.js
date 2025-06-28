// vibe-player/js/vad/RemoteApiStrategy.js
// This strategy will handle VAD by calling an external API.
// It is currently a placeholder.

/** @namespace AudioApp */
var AudioApp = AudioApp || {};

AudioApp.RemoteApiStrategy = class {
    init() {
        console.log("Remote VAD API Strategy Initialized.");
        // In the future, you might initialize API keys or settings here.
    }

    async analyze(pcmData, options) {
        console.log("RemoteApiStrategy: analyze called.");
        // In the future, this is where you would use `fetch` to send pcmData to your API.
        // For now, we return an empty result so the app doesn't break if you test it.
        alert('VAD is configured to use the Remote API, which is not yet implemented.');
        return Promise.resolve({
            regions: [],
            probabilities: new Float32Array(),
            // ... and other properties to match the VadResult structure
        });
    }

    terminate() {
        // In the future, you could use an AbortController here to cancel a `fetch` request.
        console.log("Remote VAD API Strategy Terminated.");
    }
};
