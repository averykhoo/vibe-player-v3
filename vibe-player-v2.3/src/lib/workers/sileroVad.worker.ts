// vibe-player-v2.3/src/lib/workers/sileroVad.worker.ts
import * as ort from "onnxruntime-web";
import type {
  SileroVadInitPayload,
  SileroVadProcessPayload,
  SileroVadProcessResultPayload,
  WorkerMessage,
} from "../types/worker.types";
import { VAD_WORKER_MSG_TYPE } from "../types/worker.types";
import { assert } from "../utils/assert";

let vadSession: ort.InferenceSession | null = null;
let sampleRate: number = 16000;
let frameSamples: number = 1536;
let positiveThreshold: number = 0.5;
let negativeThreshold: number = 0.35;
let _h: ort.Tensor | null = null;
let _c: ort.Tensor | null = null;
const srData = new Int32Array(1);
let srTensor: ort.Tensor | null = null;

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, payload, messageId } = event.data;

  try {
    switch (type) {
      case VAD_WORKER_MSG_TYPE.INIT:
        const initPayload = payload as SileroVadInitPayload;

        // --- ADD THESE ASSERTIONS ---
        assert(
          initPayload && typeof initPayload === "object",
          "INIT payload is missing or not an object.",
        );
        assert(initPayload.origin, "INIT payload is missing `origin`.");
        assert(
          initPayload.modelBuffer &&
            initPayload.modelBuffer instanceof ArrayBuffer,
          "INIT payload is missing a valid `modelBuffer`.",
        );
        assert(
          typeof initPayload.sampleRate === "number",
          "INIT payload is missing `sampleRate`.",
        );
        // --- END ASSERTIONS ---

        sampleRate = initPayload.sampleRate;
        frameSamples = initPayload.frameSamples;
        positiveThreshold = initPayload.positiveThreshold || positiveThreshold;
        negativeThreshold = initPayload.negativeThreshold || negativeThreshold;

        // --- THE FIX ---
        if (!initPayload.origin) {
          throw new Error(
            "SileroVadWorker INIT: `origin` is missing in payload.",
          );
        }
        // Ensure the path has a trailing slash before ORT uses it.
        ort.env.wasm.wasmPaths = `${initPayload.origin}/`;
        // --- END FIX ---

        if (!initPayload.modelBuffer) {
          throw new Error(
            "SileroVadWorker INIT: modelBuffer is missing in payload",
          );
        }

        try {
          vadSession = await ort.InferenceSession.create(
            initPayload.modelBuffer,
            { executionProviders: ["wasm"] },
          );
        } catch (e) {
          const ortError = e as Error;
          throw new Error(
            `ONNX session creation failed: ${ortError.message}. Check WASM paths and model buffer.`,
          );
        }

        _h = new ort.Tensor(
          "float32",
          new Float32Array(2 * 1 * 64).fill(0),
          [2, 1, 64],
        );
        _c = new ort.Tensor(
          "float32",
          new Float32Array(2 * 1 * 64).fill(0),
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
        // This payload is now the full PCM data, not just a frame
        const { pcmData } = payload as { pcmData: Float32Array };
        const allProbabilities: number[] = [];

        // Loop through the entire audio data, frame by frame
        for (let i = 0; i + frameSamples <= pcmData.length; i += frameSamples) {
          const audioFrame = pcmData.subarray(i, i + frameSamples);
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
          allProbabilities.push((results.output.data as Float32Array)[0]);
          _h = results.hn;
          _c = results.cn;
        }

        const resultPayload = {
          probabilities: new Float32Array(allProbabilities),
        };

        self.postMessage(
          {
            type: VAD_WORKER_MSG_TYPE.PROCESS_RESULT,
            payload: resultPayload,
            messageId,
          },
          [resultPayload.probabilities.buffer],
        ); // Transfer the buffer back
        break;

      case VAD_WORKER_MSG_TYPE.RESET:
        if (_h && _c) {
          _h.data.fill(0);
          _c.data.fill(0);
        }
        self.postMessage({
          type: `${VAD_WORKER_MSG_TYPE.RESET}_SUCCESS`,
          messageId,
        });
        break;

      default:
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
      errorMessage,
      errorStack,
    );
    self.postMessage({
      type: `${type}_ERROR` as string,
      error: errorMessage,
      messageId,
    });
  }
};
