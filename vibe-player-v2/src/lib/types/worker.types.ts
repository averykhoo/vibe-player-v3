// vibe-player-v2/src/lib/types/worker.types.ts

// General message structure for worker communication
export interface WorkerMessage<T = unknown> {
    type: string;
    payload?: T;
    error?: string | Error; // Allow Error object
    messageId?: string;
}

// --- Rubberband Worker ---
export const RB_WORKER_MSG_TYPE = {
    INIT: "rb_init",
    PROCESS: "rb_process",
    FLUSH: "rb_flush",
    RESET: "rb_reset",
    SET_PITCH: "rb_set_pitch",
    SET_SPEED: "rb_set_speed",
    INIT_SUCCESS: "rb_init_success",
    INIT_ERROR: "rb_init_error",
    PROCESS_RESULT: "rb_process_result",
    PROCESS_ERROR: "rb_process_error",
    FLUSH_RESULT: "rb_flush_result",
    STATUS: "rb_status",
};

export interface RubberbandInitPayload {
    wasmBinary: ArrayBuffer; // CHANGED
    loaderScriptText: string; // CHANGED
    origin: string;
    sampleRate: number;
    channels: number;
    initialSpeed: number;
    initialPitch: number;
}

export interface RubberbandProcessPayload {
    inputBuffer: Float32Array[];
}

export interface RubberbandProcessResultPayload {
    outputBuffer: Float32Array[];
}

export interface RubberbandStatusPayload {
    message: string;
    progress?: number;
}

// --- Silero VAD Worker ---
export const VAD_WORKER_MSG_TYPE = {
    INIT: "vad_init",
    PROCESS: "vad_process",
    RESET: "vad_reset",
    INIT_SUCCESS: "vad_init_success",
    INIT_ERROR: "vad_init_error",
    PROCESS_RESULT: "vad_process_result",
    PROCESS_ERROR: "vad_process_error",
    STATUS: "vad_status",
};

export interface SileroVadInitPayload {
    origin: string; // <-- ADDED
    modelBuffer: ArrayBuffer;
    sampleRate: number;
    frameSamples: number;
    positiveThreshold?: number;
    negativeThreshold?: number;
}

export interface SileroVadProcessPayload {
    audioFrame: Float32Array;
    timestamp?: number;
}

export interface SileroVadProcessResultPayload {
    isSpeech: boolean;
    timestamp: number;
    score: number;
    audioFrame?: Float32Array;
}

export interface SileroVadStatusPayload {
    message: string;
}

// --- Spectrogram Worker ---
export const SPEC_WORKER_MSG_TYPE = {
    INIT: "spec_init",
    PROCESS: "spec_process",
    CONFIG_UPDATE: "spec_config_update",
    INIT_SUCCESS: "spec_init_success",
    INIT_ERROR: "spec_init_error",
    PROCESS_RESULT: "spec_process_result",
    PROCESS_ERROR: "spec_process_error",
};

export interface SpectrogramInitPayload {
    origin: string;
    fftScriptText: string;
    sampleRate: number;
    fftSize: number;
    hopLength: number;
}

export interface SpectrogramProcessPayload {
    audioData: Float32Array;
}

export interface SpectrogramResultPayload {
    magnitudes: Float32Array[];
}
