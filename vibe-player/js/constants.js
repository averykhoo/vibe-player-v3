// --- /vibe-player/js/constants.js ---
// Defines shared constants for the Vibe Player application.

var AudioApp = AudioApp || {}; // Ensure main namespace exists

AudioApp.Constants = (function() {
    'use strict';

    // === Audio Engine Constants ===
    const PROCESSOR_SCRIPT_URL = 'js/player/rubberbandProcessor.js'; // Updated Path
    const PROCESSOR_NAME = 'rubberband-processor';
    const WASM_BINARY_URL = 'lib/rubberband.wasm';
    const LOADER_SCRIPT_URL = 'lib/rubberband-loader.js';

    // === VAD Constants ===
    const VAD_SAMPLE_RATE = 16000; // Required by Silero model
    const DEFAULT_VAD_FRAME_SAMPLES = 1536; // Default samples per VAD frame (e.g., 96ms @ 16kHz)
    const VAD_PROGRESS_REPORT_INTERVAL = 20; // Report progress every N frames
    const VAD_YIELD_INTERVAL = 5; // Yield main thread every N frames during VAD

    // === Visualizer Constants ===
    // --- General ---
    const WAVEFORM_HEIGHT_SCALE = 0.8; // Vertical space used by waveform (0-1)
    // --- Waveform Colors ---
    const WAVEFORM_COLOR_LOADING = '#888888'; // Initial gray before VAD
    const WAVEFORM_COLOR_DEFAULT = '#26828E'; // Non-speech color (Teal)
    const WAVEFORM_COLOR_SPEECH = '#FDE725'; // Speech highlight color (Yellow)
    // --- Spectrogram ---
    const SPEC_NORMAL_FFT_SIZE = 8192;
    const SPEC_SHORT_FFT_SIZE = 2048;
    const SPEC_SHORT_FILE_FFT_THRESHOLD_S = 10.0; // Use short FFT for files shorter than this
    const SPEC_MAX_FREQ = 8000; // Max frequency (Hz) to display
    const SPEC_FIXED_WIDTH = 2048; // Internal calculation width (slices)
    const SPEC_SHORT_FILE_HOP_THRESHOLD_S = 5.0; // Use smaller hop for files shorter than this
    const SPEC_NORMAL_HOP_DIVISOR = 4; // Hop size = fftSize / N (75% overlap)
    const SPEC_SHORT_HOP_DIVISOR = 8; // Smaller hop for short files (87.5% overlap)
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
        SPEC_MAX_FREQ,
        SPEC_FIXED_WIDTH,
        SPEC_SHORT_FILE_HOP_THRESHOLD_S,
        SPEC_NORMAL_HOP_DIVISOR,
        SPEC_SHORT_HOP_DIVISOR,
        SPEC_CENTER_WINDOWS
    };

})(); // End of AudioApp.Constants IIFE
// --- /vibe-player/js/constants.js ---
