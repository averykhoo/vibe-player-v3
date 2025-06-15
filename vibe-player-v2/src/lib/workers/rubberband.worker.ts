// vibe-player-v2/src/lib/workers/rubberband.worker.ts
import type { RubberbandInitPayload, WorkerMessage, RubberbandProcessPayload, RubberbandProcessResultPayload } from "../types/worker.types";
import { RB_WORKER_MSG_TYPE } from "../types/worker.types";

// --- Type definitions for the Emscripten/WASM Module ---
interface RubberbandModule {
    _malloc: (size: number) => number;
    _free: (ptr: number) => void;
    _rubberband_new: (sampleRate: number, channels: number, options: number, timeRatio: number, pitchScale: number) => number;
    _rubberband_delete: (stretcher: number) => void;
    _rubberband_set_time_ratio: (stretcher: number, ratio: number) => void;
    _rubberband_set_pitch_scale: (stretcher: number, scale: number) => void;
    _rubberband_reset: (stretcher: number) => void;
    _rubberband_process: (stretcher: number, inputPtrs: number, samples: number, final: number) => void;
    _rubberband_available: (stretcher: number) => number;
    _rubberband_retrieve: (stretcher: number, outputPtrs: number, samples: number) => number;
    HEAPU32: Uint32Array;
    HEAPF32: Float32Array;
    RubberBandOptionFlag?: { [key: string]: number };
}

declare function Rubberband(moduleArg: { instantiateWasm: Function }): Promise<RubberbandModule>;

// --- Worker State ---
let wasmModule: RubberbandModule | null = null;
let stretcher: number = 0; // Opaque pointer to the C++ RubberbandStretcher object

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
                const result = handleProcess(payload as RubberbandProcessPayload);
                self.postMessage({ type: RB_WORKER_MSG_TYPE.PROCESS_RESULT, payload: result, messageId }, result.outputBuffer.map(b => b.buffer));
                break;

            case RB_WORKER_MSG_TYPE.FLUSH:
                // This would be used to get the last remaining samples from the stretcher.
                // For simplicity in this fix, we are not fully implementing a separate flush logic.
                // The main loop stops when it runs out of source samples.
                self.postMessage({ type: RB_WORKER_MSG_TYPE.PROCESS_RESULT, payload: { outputBuffer: [] }, messageId });
                break;
        }
    } catch (e) {
        const error = e as Error;
        self.postMessage({ type: `${type}_ERROR`, error: error.message, messageId });
    }
};

async function handleInit(payload: RubberbandInitPayload) {
    if (stretcher && wasmModule) {
        wasmModule._rubberband_delete(stretcher);
    }

    // --- START of CHANGE ---
    const { wasmBinary, loaderScriptText } = payload;
    if (!wasmBinary || !loaderScriptText) {
        throw new Error("Worker handleInit: Missing wasmBinary or loaderScriptText in payload.");
    }

    // The loader script is designed to be executed to produce a factory function.
    // We use new Function() to safely evaluate the text we received and get the factory.
    const getRubberbandFactory = new Function(loaderScriptText + "\nreturn Rubberband;")(); // MODIFIED LINE
    const Rubberband = getRubberbandFactory; // Ensure Rubberband is the factory itself
    // --- END of CHANGE ---

    // The loader script expects an `instantiateWasm` function to be provided.
    const instantiateWasm = (imports: WebAssembly.Imports, cb: (instance: WebAssembly.Instance) => void) => {
        WebAssembly.instantiate(wasmBinary, imports).then(output => cb(output.instance));
        return {};
    };

    wasmModule = await Rubberband({ instantiateWasm });

    const RBOptions = wasmModule.RubberBandOptionFlag || {};
    const options = (RBOptions.ProcessRealTime ?? 0) | (RBOptions.PitchHighQuality ?? 0);

    stretcher = wasmModule._rubberband_new(
        payload.sampleRate,
        payload.channels,
        options,
        1.0 / payload.initialSpeed,
        Math.pow(2, payload.initialPitch / 12.0)
    );
    if (!stretcher) throw new Error("Failed to create Rubberband stretcher instance.");
}

function handleProcess(payload: RubberbandProcessPayload): RubberbandProcessResultPayload {
    if (!wasmModule || !stretcher) throw new Error("Worker not initialized for processing.");

    const { inputBuffer } = payload;
    const channels = inputBuffer.length;
    if (channels === 0) return { outputBuffer: [] };
    const frameCount = inputBuffer[0].length;

    // 1. Allocate memory in the WASM heap for an array of pointers (one for each channel).
    const inputPtrs = wasmModule._malloc(channels * 4);

    // 2. For each channel, allocate memory and copy the audio data into the WASM heap.
    //    Store the pointer to this memory in the pointers array.
    for (let i = 0; i < channels; i++) {
        const bufferPtr = wasmModule._malloc(frameCount * 4);
        wasmModule.HEAPF32.set(inputBuffer[i], bufferPtr / 4);
        wasmModule.HEAPU32[inputPtrs / 4 + i] = bufferPtr;
    }

    // 3. Call the C++ `rubberband_process` function.
    wasmModule._rubberband_process(stretcher, inputPtrs, frameCount, 0);

    // 4. Free the memory we allocated for the input buffers and the pointer array.
    for (let i = 0; i < channels; i++) {
        wasmModule._free(wasmModule.HEAPU32[inputPtrs / 4 + i]);
    }
    wasmModule._free(inputPtrs);

    // 5. Retrieve the processed audio from Rubberband's internal buffers.
    const available = wasmModule._rubberband_available(stretcher);
    const outputBuffer: Float32Array[] = [];
    if (available > 0) {
        const outputPtrs = wasmModule._malloc(channels * 4);
        const retrievedPtrs: number[] = [];
        for (let i = 0; i < channels; i++) {
            const bufferPtr = wasmModule._malloc(available * 4);
            wasmModule.HEAPU32[outputPtrs / 4 + i] = bufferPtr;
            retrievedPtrs.push(bufferPtr);
        }

        const retrievedCount = wasmModule._rubberband_retrieve(stretcher, outputPtrs, available);

        for (let i = 0; i < channels; i++) {
            const channelData = new Float32Array(retrievedCount);
            channelData.set(wasmModule.HEAPF32.subarray(retrievedPtrs[i] / 4, retrievedPtrs[i] / 4 + retrievedCount));
            outputBuffer.push(channelData);
            wasmModule._free(retrievedPtrs[i]);
        }
        wasmModule._free(outputPtrs);
    }

    return { outputBuffer };
}
