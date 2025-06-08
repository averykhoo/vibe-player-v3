// vibe-player/js/state/constants.js
class Constants {
    static get AudioEngine() {
        return {
            PROCESSOR_SCRIPT_URL: 'js/player/rubberbandProcessor.js',
            PROCESSOR_NAME: 'rubberband-processor',
            WASM_BINARY_URL: 'lib/rubberband.wasm',
            LOADER_SCRIPT_URL: 'lib/rubberband-loader.js'
        };
    }

    static get VAD() {
        return {
            SAMPLE_RATE: 16000,
            DEFAULT_FRAME_SAMPLES: 1536,
            PROGRESS_REPORT_INTERVAL: 20,
            YIELD_INTERVAL: 5,
            // Default thresholds (can be overridden by AppState or UI)
            DEFAULT_POSITIVE_THRESHOLD: 0.5,
            DEFAULT_NEGATIVE_THRESHOLD: 0.35
        };
    }

    static get UI() {
        return {
            // Example:
            // DEFAULT_JUMP_TIME_S: 5,
            // MAX_GAIN_VALUE: 5.0
            DEBOUNCE_HASH_UPDATE_MS: 500,
            SYNC_DEBOUNCE_WAIT_MS: 300
        };
    }

    static get Visualizer() {
        return {
            WAVEFORM_HEIGHT_SCALE: 0.8,
            WAVEFORM_COLOR_LOADING: '#888888',
            WAVEFORM_COLOR_DEFAULT: '#26828E',
            WAVEFORM_COLOR_SPEECH: '#FDE725',
            SPEC_NORMAL_FFT_SIZE: 8192,
            SPEC_SHORT_FFT_SIZE: 2048,
            SPEC_SHORT_FILE_FFT_THRESHOLD_S: 10.0,
            SPEC_MAX_FREQS: [6000, 10000, 16000],
            SPEC_DEFAULT_MAX_FREQ_INDEX: 0,
            SPEC_FIXED_WIDTH: 2048,
            SPEC_SHORT_FILE_HOP_THRESHOLD_S: 5.0,
            SPEC_NORMAL_HOP_DIVISOR: 4,
            SPEC_SHORT_HOP_DIVISOR: 8,
            SPEC_CENTER_WINDOWS: true
        };
    }

    static get URLHashKeys() {
        return {
            // Old keys for reference during transition if needed, though new ones are primary
            // OLD_SPEED: 's',
            // OLD_PITCH: 'p',
            // ...
            // New keys
            SPEED: 'speed',
            PITCH: 'pitch',
            GAIN: 'gain', // Assuming 'v' (volume) becomes 'gain'
            VAD_POSITIVE: 'vadPositive',
            VAD_NEGATIVE: 'vadNegative',
            AUDIO_URL: 'url',
            TIME: 'time' // For playback position
        };
    }

    static get DTMF() {
        return {
            SAMPLE_RATE: 16000, // Or whatever AudioApp.DTMFParser.DTMF_SAMPLE_RATE was
            BLOCK_SIZE: 410     // Or whatever AudioApp.DTMFParser.DTMF_BLOCK_SIZE was
        };
    }
}

// Export for Node.js/CommonJS for testing, or attach to window/global for browser/other environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Constants;
} else if (typeof window !== 'undefined') {
    window.Constants = Constants;
} else if (typeof global !== 'undefined') {
    // Fallback for environments like Jest's JSDOM where 'global' is the window-like object
    global.Constants = Constants;
}
