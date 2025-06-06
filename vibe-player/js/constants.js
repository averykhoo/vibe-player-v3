// --- /vibe-player/js/constants.js ---
// Defines shared constants for the Vibe Player application.

/** @namespace AudioApp */
var AudioApp = AudioApp || {}; // Ensure main namespace exists

/**
 * @namespace AudioApp.Constants
 * @description Shared constants for the Vibe Player application.
 * @property {string} PROCESSOR_SCRIPT_URL - Path to the Rubberband processor script.
 * @property {string} PROCESSOR_NAME - Name of the AudioWorklet processor.
 * @property {string} WASM_BINARY_URL - Path to the WebAssembly binary for Rubberband.
 * @property {string} LOADER_SCRIPT_URL - Path to the Rubberband loader script.
 * @property {number} VAD_SAMPLE_RATE - Sample rate required by the Silero VAD model (Hz).
 * @property {number} DEFAULT_VAD_FRAME_SAMPLES - Default number of samples per VAD frame.
 * @property {number} VAD_PROGRESS_REPORT_INTERVAL - Interval (in frames) for reporting VAD progress.
 * @property {number} VAD_YIELD_INTERVAL - Interval (in frames) to yield the main thread during VAD.
 * @property {number} WAVEFORM_HEIGHT_SCALE - Vertical space (0-1) used by the waveform.
 * @property {string} WAVEFORM_COLOR_LOADING - Waveform color before VAD analysis.
 * @property {string} WAVEFORM_COLOR_DEFAULT - Waveform color for non-speech segments.
 * @property {string} WAVEFORM_COLOR_SPEECH - Waveform color for speech segments.
 * @property {number} SPEC_NORMAL_FFT_SIZE - Default FFT size for spectrograms.
 * @property {number} SPEC_SHORT_FFT_SIZE - FFT size for short audio files in spectrograms.
 * @property {number} SPEC_SHORT_FILE_FFT_THRESHOLD_S - Threshold (seconds) to use shorter FFT size.
 * @property {number[]} SPEC_MAX_FREQS - Array of maximum frequencies (Hz) for spectrogram display.
 * @property {number} SPEC_DEFAULT_MAX_FREQ_INDEX - Default index for SPEC_MAX_FREQS array.
 * @property {number} SPEC_FIXED_WIDTH - Internal calculation width (slices) for spectrograms.
 * @property {number} SPEC_SHORT_FILE_HOP_THRESHOLD_S - Threshold (seconds) to use smaller hop size for short files.
 * @property {number} SPEC_NORMAL_HOP_DIVISOR - Divisor for hop size calculation (e.g., 4 for 75% overlap).
 * @property {number} SPEC_SHORT_HOP_DIVISOR - Divisor for hop size for short files (e.g., 8 for 87.5% overlap).
 * @property {boolean} SPEC_CENTER_WINDOWS - Whether to use conceptual window centering for spectrogram FFT.
 */
AudioApp.Constants = (function() {
    'use strict';

    // === Audio Engine Constants ===
    /** @type {string} Path to the Rubberband processor script. */
    const PROCESSOR_SCRIPT_URL = 'js/player/rubberbandProcessor.js'; // Updated Path
    /** @type {string} Name of the AudioWorklet processor. */
    const PROCESSOR_NAME = 'rubberband-processor';
    /** @type {string} Path to the WebAssembly binary for Rubberband. */
    const WASM_BINARY_URL = 'lib/rubberband.wasm';
    /** @type {string} Path to the Rubberband loader script. */
    const LOADER_SCRIPT_URL = 'lib/rubberband-loader.js';

    // === VAD Constants ===
    /** @type {number} Sample rate required by the Silero VAD model (Hz). */
    const VAD_SAMPLE_RATE = 16000; // Required by Silero model
    /** @type {number} Default number of samples per VAD frame (e.g., 96ms @ 16kHz). */
    const DEFAULT_VAD_FRAME_SAMPLES = 1536; // Default samples per VAD frame (e.g., 96ms @ 16kHz)
    /** @type {number} Interval (in frames) for reporting VAD progress. */
    const VAD_PROGRESS_REPORT_INTERVAL = 20; // Report progress every N frames
    /** @type {number} Interval (in frames) to yield the main thread during VAD. */
    const VAD_YIELD_INTERVAL = 5; // Yield main thread every N frames during VAD

    // === Visualizer Constants ===
    // --- General ---
    /** @type {number} Vertical space (0-1) used by the waveform. */
    const WAVEFORM_HEIGHT_SCALE = 0.8; // Vertical space used by waveform (0-1)
    // --- Waveform Colors ---
    /** @type {string} Waveform color before VAD analysis. */
    const WAVEFORM_COLOR_LOADING = '#888888'; // Initial gray before VAD
    /** @type {string} Waveform color for non-speech segments. */
    const WAVEFORM_COLOR_DEFAULT = '#26828E'; // Non-speech color (Teal)
    /** @type {string} Waveform color for speech segments. */
    const WAVEFORM_COLOR_SPEECH = '#FDE725'; // Speech highlight color (Yellow)
    // --- Spectrogram ---
    /** @type {number} Default FFT size for spectrograms. */
    const SPEC_NORMAL_FFT_SIZE = 8192;
    /** @type {number} FFT size for short audio files in spectrograms. */
    const SPEC_SHORT_FFT_SIZE = 2048;
    /** @type {number} Threshold (seconds) to use shorter FFT size. */
    const SPEC_SHORT_FILE_FFT_THRESHOLD_S = 10.0; // Use short FFT for files shorter than this
    /** @type {number[]} Array of maximum frequencies (Hz) for spectrogram display. */
    const SPEC_MAX_FREQS = [6000, 10000, 16000]; // maximum frequencies for spectrogram
    /** @type {number} Default index for SPEC_MAX_FREQS array. */
    const SPEC_DEFAULT_MAX_FREQ_INDEX = 0; // default max frequency index for spectrogram
    /** @type {number} Internal calculation width (slices) for spectrograms. */
    const SPEC_FIXED_WIDTH = 2048; // Internal calculation width (slices)
    /** @type {number} Threshold (seconds) to use smaller hop size for short files. */
    const SPEC_SHORT_FILE_HOP_THRESHOLD_S = 5.0; // Use smaller hop for files shorter than this
    /** @type {number} Divisor for hop size calculation (e.g., 4 for 75% overlap). */
    const SPEC_NORMAL_HOP_DIVISOR = 4; // Hop size = fftSize / N (75% overlap)
    /** @type {number} Divisor for hop size for short files (e.g., 8 for 87.5% overlap). */
    const SPEC_SHORT_HOP_DIVISOR = 8; // Smaller hop for short files (87.5% overlap)
    /** @type {boolean} Whether to use conceptual window centering for spectrogram FFT. */
    const SPEC_CENTER_WINDOWS = true; // Use conceptual window centering

    // === Public Interface ===
    return {
        // Audio Engine
        PROCESSOR_SCRIPT_URL,
        PROCESSOR_NAME,
        WASM_BINARY_URL,
        LOADER_SCRIPT_URL,
        // VAD
        VAD_SAMPLE_RATE,
        DEFAULT_VAD_FRAME_SAMPLES,
        VAD_PROGRESS_REPORT_INTERVAL,
        VAD_YIELD_INTERVAL,
        // Visualizer
        WAVEFORM_HEIGHT_SCALE,
        WAVEFORM_COLOR_LOADING,
        WAVEFORM_COLOR_DEFAULT,
        WAVEFORM_COLOR_SPEECH,
        SPEC_NORMAL_FFT_SIZE,
        SPEC_SHORT_FFT_SIZE,
        SPEC_SHORT_FILE_FFT_THRESHOLD_S,
        SPEC_MAX_FREQS,
        SPEC_DEFAULT_MAX_FREQ_INDEX,
        SPEC_FIXED_WIDTH,
        SPEC_SHORT_FILE_HOP_THRESHOLD_S,
        SPEC_NORMAL_HOP_DIVISOR,
        SPEC_SHORT_HOP_DIVISOR,
        SPEC_CENTER_WINDOWS
    };

})(); // End of AudioApp.Constants IIFE
// --- /vibe-player/js/constants.js ---
