// vibe-player-v2/src/lib/workers/spectrogram.worker.ts
// Add to imports:
// Option 1: If dsp.ts is simple and can be imported directly (Vite might make this work)
// import { hannWindow as generateHannWindow } from '../utils/dsp';

// Option 2: If dsp.ts is part of a larger utils/index.ts bundle that's hard to tree-shake for worker
// Or if importScripts is more reliable for fft.js, we might need a separate hann.js or include source here.
// For now, assume we can load it via importScripts if it's a separate utility, or define it here.

// To ensure hannWindow is available, let's define a basic version here or ensure it's loaded.
// For simplicity in this step, let's copy a basic hannWindow here.
// A better long-term solution is modular import or `importScripts` for a dedicated DSP util file.

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

// Existing imports:
import type {
  WorkerMessage,
  SpectrogramInitPayload,
  SpectrogramProcessPayload,
  SpectrogramResultPayload,
} from "../types/worker.types";
import { SPEC_WORKER_MSG_TYPE } from "../types/worker.types";
declare var FFT: any;

// Add:
let hannWindow: number[] | null = null;

// let fftInstance: any = null; // Already declared in previous version
// let sampleRate: number = 44100; // Already declared
// let fftSize: number = 2048; // Already declared
// let hopLength: number = 512; // Already declared

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, payload, messageId } = event.data;

  try {
    switch (type) {
      case SPEC_WORKER_MSG_TYPE.INIT:
        const initPayload = payload as SpectrogramInitPayload;
        sampleRate = initPayload.sampleRate; // These were implicitly global, ensure they are correctly scoped if not already
        fftSize = initPayload.fftSize || fftSize;
        hopLength = initPayload.hopLength || Math.floor(fftSize / 4);

        self.importScripts("../fft.js");
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
          const resultPayload: SpectrogramResultPayload = { magnitudes };
          self.postMessage({
            type: SPEC_WORKER_MSG_TYPE.PROCESS_RESULT,
            payload: resultPayload,
            messageId,
          });
        } else {
          self.postMessage({
            type: SPEC_WORKER_MSG_TYPE.PROCESS_RESULT,
            payload: { magnitudes: [] },
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
  } catch (error: any) {
    console.error(`Error in SpectrogramWorker (type: ${type}):`, error);
    self.postMessage({
      type: `${type}_ERROR` as string,
      error: error.message,
      messageId,
    });
  }
};
