// --- /vibe-player/js/vad/vadAnalyzer.js --- (REFACTORED)
// Manages the VAD strategy. The rest of the app talks to this module.

/** @namespace AudioApp */
var AudioApp = AudioApp || {};

AudioApp.vadAnalyzer = (function () {
    'use strict';

    // --- CONFIGURATION ---
    // To switch to the API, you will only have to change this line to 'api'.
    const VAD_MODE = 'local';

    let currentStrategy = null;

    // Initializes the chosen VAD strategy.
    function init() {
        if (currentStrategy?.terminate) {
            currentStrategy.terminate();
        }

        console.log(`VadAnalyzer: Initializing VAD with '${VAD_MODE}' strategy.`);
        if (VAD_MODE === 'local') {
            currentStrategy = new AudioApp.LocalWorkerStrategy();
        } else if (VAD_MODE === 'api') {
            currentStrategy = new AudioApp.RemoteApiStrategy();
        } else {
            console.error(`Unknown VAD_MODE: ${VAD_MODE}`);
            return;
        }
        currentStrategy.init();
    }

    // Delegates the analysis call to whatever strategy is active.
    async function analyze(pcmData, options = {}) {
        if (!currentStrategy) {
            throw new Error("VAD Analyzer not initialized. Call init() first.");
        }
        return currentStrategy.analyze(pcmData, options);
    }

    // The rest of the public methods have been removed for simplicity, as they were
    // tied to the old, stateful implementation. The `app.js` logic will be updated
    // to handle results directly from the `analyze` promise.

    return {
        init: init,
        analyze: analyze
    };
})();
