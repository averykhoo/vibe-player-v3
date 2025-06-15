// vibe-player-v2/src/lib/workers/sileroVad.worker.ts
import * as ort from "onnxruntime-web";
import type {
  WorkerMessage,
  SileroVadInitPayload,
  SileroVadProcessPayload,
  SileroVadProcessResultPayload,
} from "../types/worker.types";
import { VAD_WORKER_MSG_TYPE } from "../types/worker.types";

let vadSession: ort.InferenceSession | null = null;
let sampleRate: number = 16000; // Default, set by init
let frameSamples: number = 1536; // Default, set by init
let positiveThreshold: number = 0.5; // Default
let negativeThreshold: number = 0.35; // Default

// Silero VAD model specific state (h, c tensors)
let _h: ort.Tensor | null = null;
let _c: ort.Tensor | null = null;

// Pre-allocate sr tensor (sample rate)
const srData = new Int32Array(1);
let srTensor: ort.Tensor | null = null;

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, payload, messageId } = event.data;

  try {
    switch (type) {
      case VAD_WORKER_MSG_TYPE.INIT:
        const initPayload = payload as SileroVadInitPayload;
        sampleRate = initPayload.sampleRate;
        frameSamples = initPayload.frameSamples; // Make sure this matches model expectations
        positiveThreshold = initPayload.positiveThreshold || positiveThreshold;
        negativeThreshold = initPayload.negativeThreshold || negativeThreshold;

        // FIX: Explicitly set the path for the ONNX runtime WASM files.
        ort.env.wasm.wasmPaths = '/';

        // It's crucial that ORT WASM files are served from the expected path.
        // vite-plugin-static-copy in vite.config.js should copy them to the root of the build output.
        // ort.env.wasm.wasmPaths should be set globally if needed or ORT will fetch from CDN.
        // We are now passing the model as an ArrayBuffer, so path resolution for the model itself is not needed here.
        // ort.env.wasm.numThreads = 1; // Optional: Adjust based on performance testing

        if (!initPayload.modelBuffer) { // Ensure modelBuffer is provided
          throw new Error("SileroVadWorker INIT: modelBuffer is missing in payload");
        }

        vadSession = await ort.InferenceSession.create(
          initPayload.modelBuffer, // Use modelBuffer directly
        );

        // Initialize h, c, sr tensors
        _h = new ort.Tensor(
          "float32",
          new Float32Array(2 * 1 * 64),
          [2, 1, 64],
        ); // 2 layers, 1 batch, 64 hidden_size
        _c = new ort.Tensor(
          "float32",
          new Float32Array(2 * 1 * 64),
          [2, 1, 64],
        );
        srData[0] = sampleRate;
        srTensor = new ort.Tensor("int32", srData, [1]);

        self.postMessage({ type: VAD_WORKER_MSG_TYPE.INIT_SUCCESS, messageId });
        break;

      case VAD_WORKER_MSG_TYPE.PROCESS:
        if (!vadSession || !_h || !_c || !srTensor) {
          throw new Error("VAD worker not initialized or tensors not ready.");
        }
        const processPayload = payload as SileroVadProcessPayload;
        const audioFrame = processPayload.audioFrame; // Should be Float32Array of frameSamples length

        if (audioFrame.length !== frameSamples) {
          throw new Error(
            `Input audio frame size ${audioFrame.length} does not match expected frameSamples ${frameSamples}`,
          );
        }

        const inputTensor = new ort.Tensor("float32", audioFrame, [
          1,
          audioFrame.length,
        ]);
        const feeds: Record<string, ort.Tensor> = {
          input: inputTensor,
          sr: srTensor,
          h: _h,
          c: _c,
        };

        const results = await vadSession.run(feeds);
        const outputScore = (results.output.data as Float32Array)[0];
        _h = results.hn; // Update state for next frame
        _c = results.cn;

        const isSpeech = outputScore >= positiveThreshold;
        // Could add hysteresis logic here using negativeThreshold if needed

        const resultPayload: SileroVadProcessResultPayload = {
          isSpeech: isSpeech,
          timestamp: payload.timestamp || 0, // Pass through timestamp if provided
          score: outputScore,
        };
        self.postMessage({
          type: VAD_WORKER_MSG_TYPE.PROCESS_RESULT,
          payload: resultPayload,
          messageId,
        });
        break;

      case VAD_WORKER_MSG_TYPE.RESET:
        if (_h && _c) {
          _h.data.fill(0); // Reset tensor data
          _c.data.fill(0);
        }
        self.postMessage({
          type: `${VAD_WORKER_MSG_TYPE.RESET}_SUCCESS`,
          messageId,
        });
        break;

      default:
        console.warn(`SileroVadWorker: Unknown message type: ${type}`);
        self.postMessage({
          type: "unknown_message",
          error: `Unknown message type: ${type}`,
          messageId,
        });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error(
      `Error in SileroVadWorker (type: ${type}):`,
      error,
      errorStack,
    );
    self.postMessage({
      type: `${type}_ERROR` as string,
      error: errorMessage,
      messageId,
    });
  }
};
