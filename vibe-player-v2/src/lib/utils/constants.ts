// vibe-player-v2/src/lib/utils/constants.ts
export interface AudioEngineConstants {
  PROCESSOR_SCRIPT_URL: string;
  PROCESSOR_NAME: string;
  WASM_BINARY_URL: string;
  LOADER_SCRIPT_URL: string;
}
export const AUDIO_ENGINE_CONSTANTS: AudioEngineConstants = {
  PROCESSOR_SCRIPT_URL: "js/player/rubberbandProcessor.js",
  PROCESSOR_NAME: "rubberband-processor",
  WASM_BINARY_URL: "/rubberband.wasm",
  LOADER_SCRIPT_URL: "/rubberband-loader.js",
};
export interface VadConstants {
  SAMPLE_RATE: number;
  DEFAULT_FRAME_SAMPLES: number;
  PROGRESS_REPORT_INTERVAL: number;
  YIELD_INTERVAL: number;
  DEFAULT_POSITIVE_THRESHOLD: number;
  DEFAULT_NEGATIVE_THRESHOLD: number;
}
export const VAD_CONSTANTS: VadConstants = {
  SAMPLE_RATE: 16000,
  DEFAULT_FRAME_SAMPLES: 1536,
  PROGRESS_REPORT_INTERVAL: 20,
  YIELD_INTERVAL: 5,
  DEFAULT_POSITIVE_THRESHOLD: 0.5,
  DEFAULT_NEGATIVE_THRESHOLD: 0.35,
};
export interface UiConstants {
  DEBOUNCE_HASH_UPDATE_MS: number;
  SYNC_DEBOUNCE_WAIT_MS: number;
}
export const UI_CONSTANTS: UiConstants = {
  DEBOUNCE_HASH_UPDATE_MS: 500,
  SYNC_DEBOUNCE_WAIT_MS: 300,
};
export interface VisualizerConstants {
  WAVEFORM_HEIGHT_SCALE: number;
  WAVEFORM_COLOR_LOADING: string;
  WAVEFORM_COLOR_DEFAULT: string;
  WAVEFORM_COLOR_SPEECH: string;
  SPEC_NORMAL_FFT_SIZE: number;
  SPEC_SHORT_FFT_SIZE: number;
  SPEC_SHORT_FILE_FFT_THRESHOLD_S: number;
  SPEC_MAX_FREQS: number[];
  SPEC_DEFAULT_MAX_FREQ_INDEX: number;
  SPEC_FIXED_WIDTH: number;
  SPEC_SHORT_FILE_HOP_THRESHOLD_S: number;
  SPEC_NORMAL_HOP_DIVISOR: number;
  SPEC_SHORT_HOP_DIVISOR: number;
  SPEC_CENTER_WINDOWS: boolean;
}
export const VISUALIZER_CONSTANTS: VisualizerConstants = {
  WAVEFORM_HEIGHT_SCALE: 0.8,
  WAVEFORM_COLOR_LOADING: "#888888",
  WAVEFORM_COLOR_DEFAULT: "#26828E",
  WAVEFORM_COLOR_SPEECH: "#FDE725",
  SPEC_NORMAL_FFT_SIZE: 8192,
  SPEC_SHORT_FFT_SIZE: 2048,
  SPEC_SHORT_FILE_FFT_THRESHOLD_S: 10.0,
  SPEC_MAX_FREQS: [5000, 16000],
  SPEC_DEFAULT_MAX_FREQ_INDEX: 0,
  SPEC_FIXED_WIDTH: 2048,
  SPEC_SHORT_FILE_HOP_THRESHOLD_S: 5.0,
  SPEC_NORMAL_HOP_DIVISOR: 4,
  SPEC_SHORT_HOP_DIVISOR: 8,
  SPEC_CENTER_WINDOWS: true,
};
export interface UrlHashKeys {
  SPEED: string;
  PITCH: string;
  GAIN: string;
  VAD_POSITIVE: string;
  VAD_NEGATIVE: string;
  AUDIO_URL: string;
  TIME: string;
}
export const URL_HASH_KEYS: UrlHashKeys = {
  SPEED: "speed",
  PITCH: "pitch",
  GAIN: "gain",
  VAD_POSITIVE: "vadPositive",
  VAD_NEGATIVE: "vadNegative",
  AUDIO_URL: "url",
  TIME: "time",
};
export interface DtmfConstants {
  SAMPLE_RATE: number;
  BLOCK_SIZE: number;
}
export const DTMF_CONSTANTS: DtmfConstants = {
  SAMPLE_RATE: 16000,
  BLOCK_SIZE: 410,
};
