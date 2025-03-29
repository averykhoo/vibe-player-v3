// /vibe-player/js/config.js

/**
 * @typedef {object} AudioAppConfig
 * @property {object} paths Configuration for file paths.
 * @property {string} paths.onnxModel Path to the Silero VAD ONNX model file.
 * @property {string} paths.onnxWasmRoot Path to the directory containing ONNX Runtime WASM files (relative to HTML).
 * @property {string} paths.rubberbandWasm Path to the Rubberband WASM binary file.
 * @property {string} paths.rubberbandLoader Path to the custom Rubberband WASM loader script.
 * @property {object} vad Default VAD parameters.
 * @property {number} vad.threshold Default positive threshold for speech detection.
 * @property {number} vad.negative_threshold Default negative threshold for speech detection.
 * @property {number} vad.min_speech_duration_ms Minimum duration for a speech segment.
 * @property {number} vad.min_silence_duration_ms Minimum duration for a silence segment.
 * @property {number} vad.sampleRate Target sample rate for VAD processing.
 * @property {number} vad.window_size_samples VAD model window size.
 * @property {number} vad.speech_pad_ms Padding added to speech segments.
 * @property {object} playback Default playback parameters.
 * @property {number} playback.defaultSpeed Initial playback speed.
 * @property {number} playback.minSpeed Minimum playback speed.
 * @property {number} playback.maxSpeed Maximum playback speed.
 * @property {number} playback.speedStep Step for speed slider.
 * @property {number} playback.defaultGain Initial gain (volume).
 * @property {number} playback.minGain Minimum gain.
 * @property {number} playback.maxGain Maximum gain.
 * @property {number} playback.gainStep Step for gain slider.
 * @property {number} playback.jumpSeconds Default time jump amount.
 * @property {object} visualization Visualization parameters.
 * @property {string} visualization.waveformColor Color for the main waveform.
 * @property {string} visualization.waveformHighlightColor Color for highlighted (VAD) regions.
 * @property {string} visualization.progressColor Color for the progress indicator line.
 * @property {number} visualization.waveformHeight Default height for waveform canvas.
 * @property {number} visualization.spectrogramHeight Default height for spectrogram canvas.
 * @property {number} visualization.fftSize FFT size for spectrogram calculation.
 * @property {number} visualization.hopLength Hop length for spectrogram calculation.
 * @property {number} visualization.timeUpdateFrequencyHz Target frequency for time updates from worklet (approx).
 */

/**
 * Vibe Player Configuration
 * @type {AudioAppConfig}
 */
const config = {
    paths: {
        onnxModel: 'model/silero_vad.onnx',
        onnxWasmRoot: 'lib/', // Directory containing ort-wasm*.wasm
        rubberbandWasm: 'wasm/rubberband.wasm',
        rubberbandLoader: 'audio/rubberband-loader.js',
    },
    vad: {
        threshold: 0.5,
        negative_threshold: 0.35,
        min_speech_duration_ms: 250, // From Silero example
        min_silence_duration_ms: 100, // From Silero example
        sampleRate: 16000,            // Silero VAD expects 16kHz
        window_size_samples: 512,     // Common window size for this model
        speech_pad_ms: 30,            // From Silero example
    },
    playback: {
        defaultSpeed: 1.0,
        minSpeed: 0.25,
        maxSpeed: 2.0,
        speedStep: 0.01,
        defaultGain: 1.0,
        minGain: 0.0,
        maxGain: 2.0, // Allow boosting volume slightly
        gainStep: 0.01,
        jumpSeconds: 5,
    },
    visualization: {
        waveformColor: '#3498db', // Blue
        waveformHighlightColor: '#e67e22', // Orange
        progressColor: 'rgba(255, 0, 0, 0.7)', // Semi-transparent red
        waveformHeight: 120,
        spectrogramHeight: 200,
        fftSize: 1024,       // Common value for FFT
        hopLength: 256,       // Overlap for smoother spectrogram (fftSize / 4)
        timeUpdateFrequencyHz: 15, // How often worklet should aim to send time updates
    },
};

// Make the config object immutable
Object.freeze(config);
Object.freeze(config.paths);
Object.freeze(config.vad);
Object.freeze(config.playback);
Object.freeze(config.visualization);

// Attach to the global AudioApp namespace if it exists,
// otherwise, create it (useful for modular loading without strict build tools).
// In a real module system, you'd use `export default config;`
if (typeof window.AudioApp === 'undefined') {
    window.AudioApp = {};
}
window.AudioApp.config = config;

// Add a console log to confirm loading
console.log("Configuration loaded:", window.AudioApp.config);

// /vibe-player/js/config.js
