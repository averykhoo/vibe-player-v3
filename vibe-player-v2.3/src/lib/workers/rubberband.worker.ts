// vibe-player-v2.3/src/lib/workers/rubberband.worker.ts
import type {
  RubberbandInitPayload,
  RubberbandProcessPayload,
  RubberbandProcessResultPayload,
  WorkerMessage,
} from "../types/worker.types";
import { RB_WORKER_MSG_TYPE } from "../types/worker.types";

// --- Type definitions for the Emscripten/WASM Module ---
interface RubberbandModule {
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  _rubberband_new: (
    sampleRate: number,
    channels: number,
    options: number,
    timeRatio: number,
    pitchScale: number,
  ) => number;
  _rubberband_delete: (stretcher: number) => void;
  _rubberband_set_time_ratio: (stretcher: number, ratio: number) => void;
  _rubberband_set_pitch_scale: (stretcher: number, scale: number) => void;
  _rubberband_reset: (stretcher: number) => void;
  _rubberband_process: (
    stretcher: number,
    inputPtrs: number,
    samples: number,
    final: number,
  ) => void;
  _rubberband_available: (stretcher: number) => number;
  _rubberband_retrieve: (
    stretcher: number,
    outputPtrs: number,
    samples: number,
  ) => number;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  RubberBandOptionFlag?: { [key: string]: number };
}

declare function Rubberband(moduleArg: {
  instantiateWasm: Function;
}): Promise<RubberbandModule>;

// --- Worker State ---
let wasmModule: RubberbandModule | null = null;
let stretcher: number = 0; // Opaque pointer to the C++ RubberbandStretcher object
let sampleRate: number = 44100; // ADD THIS with a default

// --- Main Worker Logic ---
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, payload, messageId } = event.data;

  try {
    switch (type) {
      case RB_WORKER_MSG_TYPE.INIT:
        await handleInit(payload as RubberbandInitPayload);
        self.postMessage({ type: RB_WORKER_MSG_TYPE.INIT_SUCCESS, messageId });
        break;

      case RB_WORKER_MSG_TYPE.SET_SPEED:
        if (stretcher && wasmModule && payload?.speed) {
          wasmModule._rubberband_set_time_ratio(stretcher, 1.0 / payload.speed);
        }
        break;

      case RB_WORKER_MSG_TYPE.SET_PITCH:
        if (stretcher && wasmModule && payload?.pitch !== undefined) {
          const pitchScale = Math.pow(2, payload.pitch / 12.0);
          wasmModule._rubberband_set_pitch_scale(stretcher, pitchScale);
        }
        break;

      case RB_WORKER_MSG_TYPE.RESET:
        if (stretcher && wasmModule) {
          wasmModule._rubberband_reset(stretcher);
        }
        break;

      case RB_WORKER_MSG_TYPE.PROCESS:
        const { inputBuffer, isLastChunk, playbackTime } =
          payload as RubberbandProcessPayload;
        const result = handleProcess(inputBuffer, isLastChunk, playbackTime);
        self.postMessage(
          {
            type: RB_WORKER_MSG_TYPE.PROCESS_RESULT,
            payload: result,
            messageId,
          },
          result.outputBuffer.map((b) => b.buffer),
        );
        break;

      case RB_WORKER_MSG_TYPE.FLUSH:
        // This would be used to get the last remaining samples from the stretcher.
        // For simplicity in this fix, we are not fully implementing a separate flush logic.
        // The main loop stops when it runs out of source samples.
        self.postMessage({
          type: RB_WORKER_MSG_TYPE.PROCESS_RESULT,
          payload: { outputBuffer: [] },
          messageId,
        });
        break;
    }
  } catch (e) {
    const error = e as Error;
    console.error(
      `[RubberbandWorker] Error during operation '${type}':`,
      error,
    ); // Add explicit worker-side log
    self.postMessage({
      type: RB_WORKER_MSG_TYPE.ERROR, // THE FIX
      error: error.message,
      messageId,
    });
  }
};

async function handleInit(payload: RubberbandInitPayload) {
  if (stretcher && wasmModule) {
    wasmModule._rubberband_delete(stretcher);
  }

  // --- START of CHANGE ---
  const { wasmBinary, loaderScriptText } = payload;
  if (!wasmBinary || !loaderScriptText) {
    throw new Error(
      "Worker handleInit: Missing wasmBinary or loaderScriptText in payload.",
    );
  }

  // The loader script is designed to be executed to produce a factory function.
  // We use new Function() to safely evaluate the text we received and get the factory.
  const getRubberbandFactory = new Function(
    loaderScriptText + "\nreturn Rubberband;",
  )(); // MODIFIED LINE
  const Rubberband = getRubberbandFactory; // Ensure Rubberband is the factory itself
  // --- END of CHANGE ---

  // The loader script expects an `instantiateWasm` function to be provided.
  const instantiateWasm = (
    imports: WebAssembly.Imports,
    cb: (instance: WebAssembly.Instance) => void,
  ) => {
    WebAssembly.instantiate(wasmBinary, imports).then((output) =>
      cb(output.instance),
    );
    return {};
  };

  wasmModule = await Rubberband({ instantiateWasm });

  const RBOptions = wasmModule.RubberBandOptionFlag || {};
  const options =
    (RBOptions.ProcessRealTime ?? 0) | (RBOptions.PitchHighQuality ?? 0);

  stretcher = wasmModule._rubberband_new(
    payload.sampleRate,
    payload.channels,
    options,
    1.0 / payload.initialSpeed,
    Math.pow(2, payload.initialPitch / 12.0),
  );
  if (!stretcher)
    throw new Error("Failed to create Rubberband stretcher instance.");

  sampleRate = payload.sampleRate; // ADD THIS LINE
}

function handleProcess(
  inputBuffer: Float32Array[],
  isLastChunk: boolean,
  playbackTime: number,
): RubberbandProcessResultPayload {
  if (!wasmModule || !stretcher) {
    throw new Error("Worker not initialized for processing.");
  }

  const channels = inputBuffer.length;
  if (channels === 0) {
    return { outputBuffer: [], playbackTime, duration: 0, isLastChunk: true };
  }

  const frameCount = inputBuffer[0].length;
  const inputPtrs = wasmModule._malloc(channels * 4);

  try {
    for (let i = 0; i < channels; i++) {
      const bufferPtr = wasmModule._malloc(frameCount * 4);
      wasmModule.HEAPF32.set(inputBuffer[i], bufferPtr / 4);
      wasmModule.HEAPU32[inputPtrs / 4 + i] = bufferPtr;
    }

    wasmModule._rubberband_process(
      stretcher,
      inputPtrs,
      frameCount,
      isLastChunk ? 1 : 0,
    );
  } finally {
    for (let i = 0; i < channels; i++) {
      const ptr = wasmModule.HEAPU32[inputPtrs / 4 + i];
      if (ptr) wasmModule._free(ptr);
    }
    wasmModule._free(inputPtrs);
  }

  const available = wasmModule._rubberband_available(stretcher);
  const outputBuffer: Float32Array[] = [];
  let duration = 0;

  if (available > 0) {
    const outputPtrs = wasmModule._malloc(channels * 4);
    try {
      const retrievedPtrs: number[] = [];
      for (let i = 0; i < channels; i++) {
        const bufferPtr = wasmModule._malloc(available * 4);
        wasmModule.HEAPU32[outputPtrs / 4 + i] = bufferPtr;
        retrievedPtrs.push(bufferPtr);
      }

      const retrievedCount = wasmModule._rubberband_retrieve(
        stretcher,
        outputPtrs,
        available,
      );
      duration = retrievedCount > 0 ? retrievedCount / sampleRate : 0;

      for (let i = 0; i < channels; i++) {
        const channelData = new Float32Array(retrievedCount);
        channelData.set(
          wasmModule.HEAPF32.subarray(
            retrievedPtrs[i] / 4,
            retrievedPtrs[i] / 4 + retrievedCount,
          ),
        );
        outputBuffer.push(channelData);
      }
    } finally {
      // Assuming retrievedPtrs is not needed outside the try block
      for (let i = 0; i < channels; i++) {
        const ptr = wasmModule.HEAPU32[outputPtrs / 4 + i];
        if (ptr) wasmModule._free(ptr);
      }
      wasmModule._free(outputPtrs);
    }
  }

  return { outputBuffer, playbackTime, duration, isLastChunk };
}
