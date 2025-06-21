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
  // console.log(
  //   `[RubberbandWorker] Message received. Type: ${type}, MessageID: ${messageId}`,
  // );

  try {
    switch (type) {
      case RB_WORKER_MSG_TYPE.INIT:
        // console.log(`[RubberbandWorker] Initializing with payload...`);
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
        // console.log(`[RubberbandWorker] Entering PROCESS case.`);
        const { inputBuffer, isLastChunk } =
          payload as RubberbandProcessPayload;

        // --- START: ADDED LOGGING FOR CHUNK VALIDATION ---
        if (
          !inputBuffer ||
          !Array.isArray(inputBuffer) ||
          inputBuffer.length === 0
        ) {
          // console.error(
          //   `[RubberbandWorker] PROCESS received invalid inputBuffer: not an array or is empty.`,
          //   inputBuffer,
          // );
          throw new Error(
            "PROCESS received invalid inputBuffer: not an array or is empty.",
          );
        }
        if (inputBuffer[0].length === 0) {
          // console.warn(
          //   `[RubberbandWorker] PROCESS received a chunk with 0 samples. Skipping.`,
          // );
          // Send back an empty result to keep the loop going.
          self.postMessage({
            type: RB_WORKER_MSG_TYPE.PROCESS_RESULT,
            payload: { outputBuffer: [], isLastChunk: isLastChunk },
            messageId,
          });
          break; // Exit this case
        }
        // console.log(
        //   `[RubberbandWorker] Processing chunk. Channels: ${inputBuffer.length}, Samples: ${inputBuffer[0].length}, isLastChunk: ${isLastChunk}`,
        // );
        // console.log(
        //   `[RubberbandWorker] First 3 samples of channel 0:`,
        //   inputBuffer[0].slice(0, 3),
        // );
        // --- END: ADDED LOGGING FOR CHUNK VALIDATION ---

        const result = handleProcess(inputBuffer, isLastChunk); // Correctly call with new signature

        // console.log(
        //   `[RubberbandWorker] Processing complete. Output buffer has ${result.outputBuffer[0]?.length || 0} samples. Posting result to main thread.`,
        // );
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
        // console.log(`[RubberbandWorker] FLUSH command received.`);
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
      `[RubberbandWorker] CRITICAL ERROR in operation '${type}':`,
      error,
    );
    self.postMessage({
      type: RB_WORKER_MSG_TYPE.ERROR,
      error: error.message,
      messageId,
    });
  }
};

async function handleInit(payload: RubberbandInitPayload) {
  if (stretcher && wasmModule) {
    wasmModule._rubberband_delete(stretcher);
  }

  const { wasmBinary, loaderScriptText } = payload;
  if (!wasmBinary || !loaderScriptText) {
    throw new Error(
      "Worker handleInit: Missing wasmBinary or loaderScriptText in payload.",
    );
  }

  const getRubberbandFactory = new Function(
    loaderScriptText + "\nreturn Rubberband;",
  )();
  const Rubberband = getRubberbandFactory;

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

  // console.log(`[RubberbandWorker] Stretcher instance created successfully.`);
  sampleRate = payload.sampleRate;
}

function handleProcess(
  inputBuffer: Float32Array[],
  isLastChunk: boolean,
): RubberbandProcessResultPayload {
  if (!wasmModule || !stretcher) {
    throw new Error("Worker not initialized for processing.");
  }

  const channels = inputBuffer.length;
  if (channels === 0) {
    return { outputBuffer: [], isLastChunk: true };
  }

  const frameCount = inputBuffer[0].length;
  if (frameCount === 0) {
    return { outputBuffer: [], isLastChunk };
  }

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

  // console.log(
  //   `[RubberbandWorker/handleProcess] Samples available after processing: ${available}`,
  // );

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
      // console.log(
      //   `[RubberbandWorker/handleProcess] Retrieved ${retrievedCount} samples.`,
      // );

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
      // Free the temporary output pointers
      for (let i = 0; i < channels; i++) {
        const ptr = wasmModule.HEAPU32[outputPtrs / 4 + i];
        if (ptr) wasmModule._free(ptr);
      }
      wasmModule._free(outputPtrs);
    }
  }

  return { outputBuffer, isLastChunk };
}
