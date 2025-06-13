// vibe-player-v2/src/lib/workers/spectrogram.worker.ts
import type {
    SpectrogramInitPayload,
    SpectrogramProcessPayload,
    SpectrogramResultPayload,
    WorkerMessage,
} from "../types/worker.types";
import {SPEC_WORKER_MSG_TYPE} from "../types/worker.types";

interface FFTClass {
    new (size: number): FFTInstance;
}

interface FFTInstance {
    createComplexArray(): Float32Array;
    realTransform(output: Float32Array, input: Float32Array): void;
}

declare var FFT: FFTClass;

function generateHannWindow(length: number): number[] | null {
    if (length <= 0 || !Number.isInteger(length)) return null;
    const windowArr: number[] = new Array(length);
    if (length === 1) {
        windowArr[0] = 1;
        return windowArr;
    }
    const denom = length - 1;
    for (let i = 0; i < length; i++) {
        windowArr[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
    }
    return windowArr;
}

let fftInstance: FFTInstance | null = null;
let sampleRate: number;
let fftSize: number;
let hopLength: number;
let hannWindow: number[] | null = null;

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
    const {type, payload, messageId} = event.data;

    try {
        switch (type) {
            case SPEC_WORKER_MSG_TYPE.INIT:
                const initPayload = payload as SpectrogramInitPayload;

                // --- MODIFIED: Direct assignment, no fallback logic needed ---
                // The service is responsible for providing these values.
                sampleRate = initPayload.sampleRate;
                fftSize = initPayload.fftSize;
                hopLength = initPayload.hopLength;

                // --- FIX START ---
                // Construct the full, absolute URL for the FFT script
                if (!initPayload.origin) {
                    throw new Error("SpectrogramWorker INIT: origin is missing in payload.");
                }
                // NOTE: The worker itself is at `.../src/lib/workers/spectrogram.worker.ts`
                // So `new URL('../fft.js', ...)` resolves correctly relative to the worker's own location.
                const fftUrl = new URL(initPayload.fftPath, initPayload.origin).href;
                self.importScripts(fftUrl);
                // --- FIX END ---

                if (typeof FFT === "undefined") {
                    throw new Error("FFT class not loaded. Check path to fft.js.");
                }
                fftInstance = new FFT(fftSize);

                // --- BEGIN NEW: Generate Hann Window ---
                hannWindow = generateHannWindow(fftSize);
                if (!hannWindow) {
                    console.warn(
                        "SpectrogramWorker: Failed to generate Hann window, proceeding without windowing.",
                    );
                }
                // --- END NEW: Generate Hann Window ---

                self.postMessage({
                    type: SPEC_WORKER_MSG_TYPE.INIT_SUCCESS,
                    messageId,
                });
                break;

            case SPEC_WORKER_MSG_TYPE.PROCESS:
                if (!fftInstance) {
                    throw new Error("Spectrogram worker not initialized.");
                }
                const processPayload = payload as SpectrogramProcessPayload;
                const audioData = processPayload.audioData;
                const magnitudes: Float32Array[] = [];

                for (let i = 0; i + fftSize <= audioData.length; i += hopLength) {
                    const frame = audioData.subarray(i, i + fftSize);
                    let windowedFrame = new Float32Array(fftSize);

                    // --- BEGIN NEW: Apply Hann Window ---
                    if (hannWindow && hannWindow.length === fftSize) {
                        for (let j = 0; j < fftSize; j++) {
                            windowedFrame[j] = frame[j] * hannWindow[j];
                        }
                    } else {
                        // If no window, copy frame directly
                        windowedFrame.set(frame);
                    }
                    // --- END NEW: Apply Hann Window ---

                    const complexSpectrum = fftInstance.createComplexArray();
                    // Use windowedFrame for transform
                    fftInstance.realTransform(complexSpectrum, windowedFrame);

                    const frameMagnitudes = new Float32Array(fftSize / 2 + 1);
                    for (let k = 0; k < frameMagnitudes.length; k++) {
                        const real = complexSpectrum[k * 2];
                        const imag = complexSpectrum[k * 2 + 1];
                        frameMagnitudes[k] = Math.sqrt(real * real + imag * imag) / fftSize;
                    }
                    magnitudes.push(frameMagnitudes);
                }
                if (magnitudes.length > 0) {
                    const resultPayload: SpectrogramResultPayload = {magnitudes};
                    self.postMessage({
                        type: SPEC_WORKER_MSG_TYPE.PROCESS_RESULT,
                        payload: resultPayload,
                        messageId,
                    });
                } else {
                    self.postMessage({
                        type: SPEC_WORKER_MSG_TYPE.PROCESS_RESULT,
                        payload: {magnitudes: []},
                        messageId,
                    }); // Send empty if no frames
                }
                break;
            default:
                console.warn(`SpectrogramWorker: Unknown message type: ${type}`);
                self.postMessage({
                    type: "unknown_message",
                    error: `Unknown message type: ${type}`,
                    messageId,
                });
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error in SpectrogramWorker (type: ${type}):`, error);
        self.postMessage({
            type: `${type}_ERROR` as string,
            error: errorMessage,
            messageId,
        });
    }
};
