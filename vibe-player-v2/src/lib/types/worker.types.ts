// vibe-player-v2/src/lib/types/worker.types.ts

// General message structure for worker communication
export interface WorkerMessage<T = any> {
    type: string;
    payload?: T;
    error?: string;
    messageId?: string; // Optional: for tracking request-response pairs
}

// --- Rubberband Worker ---
export const RB_WORKER_MSG_TYPE = {
    INIT: 'rb_init',
    PROCESS: 'rb_process',
    FLUSH: 'rb_flush', // For final processing
    RESET: 'rb_reset', // To reset internal state
    SET_PITCH: 'rb_set_pitch',
    SET_SPEED: 'rb_set_speed',
    INIT_SUCCESS: 'rb_init_success',
    INIT_ERROR: 'rb_init_error',
    PROCESS_RESULT: 'rb_process_result',
    PROCESS_ERROR: 'rb_process_error',
    FLUSH_RESULT: 'rb_flush_result',
    STATUS: 'rb_status' // For general status or progress updates
};

export interface RubberbandInitPayload {
    wasmPath: string;         // Path to rubberband.wasm
    loaderPath: string;       // Path to rubberband-loader.js
    sampleRate: number;
    channels: number;
    initialSpeed: number;
    initialPitch: number;
    // Add other necessary initialization parameters
}

export interface RubberbandProcessPayload {
    inputBuffer: Float32Array[]; // Array of channels, each a Float32Array
}

export interface RubberbandProcessResultPayload {
    outputBuffer: Float32Array[]; // Array of channels
}

export interface RubberbandStatusPayload {
    message: string;
    progress?: number; // Optional progress indicator (0-1)
}


// --- Silero VAD Worker ---
export const VAD_WORKER_MSG_TYPE = {
    INIT: 'vad_init',
    PROCESS: 'vad_process',
    RESET: 'vad_reset',
    INIT_SUCCESS: 'vad_init_success',
    INIT_ERROR: 'vad_init_error',
    PROCESS_RESULT: 'vad_process_result',
    PROCESS_ERROR: 'vad_process_error',
    STATUS: 'vad_status'
};

export interface SileroVadInitPayload {
    onnxModelPath: string; // Path to silero_vad.onnx
    // onnxWasmPath: string; // Path to ORT WASM files (usually handled by ORT itself if copied to static root)
    sampleRate: number; // e.g., 16000
    frameSamples: number; // e.g., 1536
    positiveThreshold?: number;
    negativeThreshold?: number;
}

export interface SileroVadProcessPayload {
    audioFrame: Float32Array; // Single audio frame
}

export interface SileroVadProcessResultPayload {
    isSpeech: boolean;
    timestamp: number; // Start time of the frame being processed
    // Potentially include probabilities or other metadata
}

export interface SileroVadStatusPayload {
    message: string;
    // progress?: number;
}


// --- Spectrogram Worker (if needed as a separate worker from visualizer component) ---
export const SPEC_WORKER_MSG_TYPE = {
    INIT: 'spec_init',
    PROCESS: 'spec_process',
    CONFIG_UPDATE: 'spec_config_update', // e.g., FFT size change
    INIT_SUCCESS: 'spec_init_success',
    INIT_ERROR: 'spec_init_error',
    PROCESS_RESULT: 'spec_process_result',
    PROCESS_ERROR: 'spec_process_error'
};

export interface SpectrogramInitPayload {
    sampleRate: number;
    // initial FFT size, hop length etc.
}

export interface SpectrogramProcessPayload {
    audioData: Float32Array;
}

export interface SpectrogramResultPayload {
    magnitudes: Float32Array[]; // Array of magnitude arrays (bins) for each frame
    // Or could be Uint8Array if values are scaled to 0-255 for image display
}

// Type guards for narrowing down message types (examples)
export function isRubberbandInitPayload(payload: any): payload is RubberbandInitPayload {
    return payload && typeof payload.wasmPath === 'string' && typeof payload.sampleRate === 'number';
}

export function isSileroVadInitPayload(payload: any): payload is SileroVadInitPayload {
    return payload && typeof payload.onnxModelPath === 'string' && typeof payload.sampleRate === 'number';
}
