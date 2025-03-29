// --- /vibe-player/js/config.js ---
/**
 * @namespace AudioApp.config
 * @description Holds application-wide constants and default settings for Vibe Player.
 * This module centralizes configuration to make adjustments easier.
 * It uses an IIFE to create an immutable configuration object attached to AudioApp.
 */
var AudioApp = AudioApp || {}; // Ensure namespace exists

AudioApp.config = (function() {
    'use strict';

    // --- Core Paths ---
    // Assumes all paths are relative to the index.html file location.
    const BASE_PATH = './';
    const LIB_PATH = `${BASE_PATH}lib/`;
    const MODEL_PATH = `${BASE_PATH}model/`;
    const WASM_PATH = `${BASE_PATH}wasm/`;
    const JS_PATH = `${BASE_PATH}js/`;
    const AUDIO_PATH = `${BASE_PATH}audio/`;
    const VAD_PATH = `${BASE_PATH}vad/`;

    // --- Web Audio / Worklet ---
    const PROCESSOR_NAME = 'hybrid-audio-processor'; // Name for the AudioWorkletProcessor
    const HYBRID_PROCESSOR_PATH = `${AUDIO_PATH}hybrid-processor.js`; // Path to the processor script

    // --- Rubberband Configuration ---
    const RUBBERBAND_WASM_PATH = `${WASM_PATH}rubberband.wasm`; // Path to the WASM binary
    const RUBBERBAND_LOADER_PATH = `${AUDIO_PATH}rubberband-loader.js`; // Path to the *custom* loader script

    // --- VAD (Silero) Configuration ---
    const VAD_MODEL_PATH = `${MODEL_PATH}silero_vad.onnx`; // Path to the ONNX model
    const VAD_SAMPLE_RATE = 16000; // Required sample rate by the Silero model (Hz)
    // Default VAD thresholds (can be overridden by UI)
    const DEFAULT_VAD_POSITIVE_THRESHOLD = 0.5; // Probability to start/continue speech
    const DEFAULT_VAD_NEGATIVE_THRESHOLD = 0.35; // Probability to consider ending speech (below this)
    // VAD processing parameters
    const DEFAULT_VAD_REDEMPTION_FRAMES = 7; // Consecutive frames below negative threshold to end segment
    const DEFAULT_VAD_FRAME_SAMPLES = 1536; // Frame size in samples (~96ms @ 16kHz)

    // --- Playback Parameter Defaults ---
    const DEFAULT_GAIN = 1.0;                 // Initial volume multiplier
    const DEFAULT_SPEED = 1.0;                // Initial playback speed multiplier
    const DEFAULT_PITCH_SEMITONES = 0.0;      // Initial pitch shift in semitones
    const DEFAULT_FORMANT_SCALE = 1.0;        // Initial formant shift multiplier (1.0 = no shift)
    const DEFAULT_JUMP_SECONDS = 5.0;         // Default time jump amount

    // --- Hybrid Processing Defaults ---
    const DEFAULT_INITIAL_SLOW_SPEED = 0.25;  // Speed for the offline pre-processed "slow" version
    const DEFAULT_HYBRID_THRESHOLD = 0.8;     // Playback speed below which the slow buffer is used
    // Enum-like object for switching behaviors
    const SWITCH_BEHAVIOR = Object.freeze({
        ABRUPT: 'abrupt',           // Instant switch, may cause clicks
        MUTE: 'mute',               // Silence briefly during switch
        MICROFADE: 'microfade'      // Very short crossfade (implemented as ramp down/up)
    });
    const DEFAULT_SWITCH_BEHAVIOR = SWITCH_BEHAVIOR.MICROFADE; // Default transition type
    // Enum-like object for source override (for testing/comparison)
    const SOURCE_OVERRIDE = Object.freeze({
        AUTO: 'auto',               // Automatic hybrid selection based on threshold
        ORIGINAL: 'original',       // Force using the original buffer
        SLOW: 'slow'                // Force using the pre-processed slow buffer
    });
    const DEFAULT_SOURCE_OVERRIDE = SOURCE_OVERRIDE.AUTO; // Default behavior
    const MICROFADE_DURATION_MS = 5; // Duration for the micro-fade transition in milliseconds

    // --- Visualizer Defaults ---
    const WAVEFORM_HEIGHT_SCALE = 0.8;    // Vertical scaling for waveform display (0 to 1)
    const SPECTROGRAM_FFT_SIZE = 8192;    // FFT window size (power of 2) for spectrogram
    const SPECTROGRAM_MAX_FREQ = 12000;   // Max frequency (Hz) to display on spectrogram Y-axis
    const SPEC_FIXED_WIDTH = 2048;      // Fixed internal width for spectrogram calculation/caching

    // --- Public Interface ---
    // Freeze the returned object to make the configuration effectively immutable at runtime.
    return Object.freeze({
        // Paths
        LIB_PATH,
        MODEL_PATH,
        WASM_PATH,
        JS_PATH,
        AUDIO_PATH,
        VAD_PATH,
        // Worklet
        PROCESSOR_NAME,
        HYBRID_PROCESSOR_PATH,
        // Rubberband
        RUBBERBAND_WASM_PATH,
        RUBBERBAND_LOADER_PATH,
        // VAD
        VAD_MODEL_PATH,
        VAD_SAMPLE_RATE,
        DEFAULT_VAD_POSITIVE_THRESHOLD,
        DEFAULT_VAD_NEGATIVE_THRESHOLD,
        DEFAULT_VAD_REDEMPTION_FRAMES,
        DEFAULT_VAD_FRAME_SAMPLES,
        // Playback Defaults
        DEFAULT_GAIN,
        DEFAULT_SPEED,
        DEFAULT_PITCH_SEMITONES,
        DEFAULT_FORMANT_SCALE,
        DEFAULT_JUMP_SECONDS,
        // Hybrid Defaults
        DEFAULT_INITIAL_SLOW_SPEED,
        DEFAULT_HYBRID_THRESHOLD,
        SWITCH_BEHAVIOR,
        DEFAULT_SWITCH_BEHAVIOR,
        SOURCE_OVERRIDE,
        DEFAULT_SOURCE_OVERRIDE,
        MICROFADE_DURATION_MS,
        // Visualizer Defaults
        WAVEFORM_HEIGHT_SCALE,
        SPECTROGRAM_FFT_SIZE,
        SPECTROGRAM_MAX_FREQ,
        SPEC_FIXED_WIDTH
    });

})(); // Immediately invoke the IIFE

// --- /vibe-player/js/config.js ---
