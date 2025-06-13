// vibe-player-v2/src/lib/workers/rubberband.worker.ts
import type {
  WorkerMessage,
  RubberbandInitPayload,
  RubberbandProcessPayload,
  RubberbandProcessResultPayload,
} from "../types/worker.types";
import { RB_WORKER_MSG_TYPE } from "../types/worker.types";

declare var RubberBand: any; // Assuming RubberBand is loaded via importScripts

let rubberbandInstance: any = null;
let sampleRate = 44100; // Default, will be set by init
let channels = 1; // Default

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, payload, messageId } = event.data;

  try {
    switch (type) {
      case RB_WORKER_MSG_TYPE.INIT:
        const initPayload = payload as RubberbandInitPayload;
        sampleRate = initPayload.sampleRate;
        channels = initPayload.channels;

        // Construct loaderUrl from origin
        if (!initPayload.origin) {
          throw new Error("RubberbandWorker INIT: origin is missing in payload");
        }
        const loaderUrl = `${initPayload.origin}/rubberband-loader.js`;

        if (self.importScripts) {
          self.importScripts(loaderUrl); // Load rubberband-loader.js
        } else {
          // For environments where importScripts might not be available directly in module workers (less common for Vite ?worker)
          // Consider alternative loading or ensure build process handles it.
          // For now, assume importScripts works as Vite usually bundles it correctly.
          await import(loaderUrl);
        }

        rubberbandInstance = new RubberBand(
          initPayload.sampleRate,
          initPayload.channels,
          RubberBand.OptionProcessRealTime |
            RubberBand.OptionTransientsSmooth |
            RubberBand.OptionDetectorCompound,
          initPayload.initialSpeed,
          initPayload.initialPitch,
        );
        // TODO: Set other options if necessary, e.g., formants, crispness
        // rubberbandInstance.setExpectedInputDuration(someValue);
        // rubberbandInstance.setMaxProcessSize(someValue);

        self.postMessage({ type: RB_WORKER_MSG_TYPE.INIT_SUCCESS, messageId });
        break;

      case RB_WORKER_MSG_TYPE.SET_SPEED:
        if (rubberbandInstance && payload?.speed !== undefined) {
          rubberbandInstance.setSpeed(payload.speed);
        }
        break;

      case RB_WORKER_MSG_TYPE.SET_PITCH:
        if (rubberbandInstance && payload?.pitch !== undefined) {
          rubberbandInstance.setPitch(payload.pitch);
        }
        break;

      case RB_WORKER_MSG_TYPE.PROCESS:
        if (!rubberbandInstance) {
          throw new Error("Rubberband not initialized before process call.");
        }
        const processPayload = payload as RubberbandProcessPayload;
        // Assuming processPayload.inputBuffer is [channel0Data, channel1Data,...]
        // RubberbandJS process method expects a flat array for stereo if that's how it's implemented
        // or separate calls. Check RubberbandJS documentation for exact usage.
        // This is a simplified placeholder.

        // The C++ RubberBand::process takes Float **input, int nframes, bool final
        // Rubberband.js likely adapts this. Common pattern:
        // 1. study(): analyze the input (optional, often done internally by process)
        // 2. process(): process the input
        // For simplicity, assuming inputBuffer is correctly formatted for RubberbandJS.
        // This might involve interleaving channels if RubberbandJS expects that.

        // Placeholder for actual processing logic:
        // This example assumes inputBuffer[0] for mono, or needs adjustment for multi-channel
        const processedFrames = rubberbandInstance.process(
          processPayload.inputBuffer[0],
          false,
        ); // false = not final chunk

        // Rubberband.js retrieve/available methods
        const available = rubberbandInstance.available();
        if (available > 0) {
          const outputBuffer: Float32Array[] = new Array(channels);
          const retrieved = rubberbandInstance.retrieve(
            outputBuffer[0],
            available,
          ); // Assuming outputBuffer[0] is where data is put for mono

          // If multi-channel, might need to retrieve each channel separately or handle interleaved data
          // For now, assuming mono and outputBuffer[0] is populated.
          // outputBuffer[0] = retrievedSamples; // This depends on how retrieve works
          // If retrieve fills the passed buffer:
          const resultPayload: RubberbandProcessResultPayload = {
            outputBuffer: [
              new Float32Array(outputBuffer[0].buffer, 0, retrieved),
            ],
          };
          self.postMessage({
            type: RB_WORKER_MSG_TYPE.PROCESS_RESULT,
            payload: resultPayload,
            messageId,
          });
        }
        break;

      case RB_WORKER_MSG_TYPE.FLUSH:
        if (!rubberbandInstance) {
          throw new Error("Rubberband not initialized.");
        }
        // Process a final empty buffer to get remaining samples
        rubberbandInstance.process(new Float32Array(0), true); // true = final chunk
        const finalAvailable = rubberbandInstance.available();
        if (finalAvailable > 0) {
          const finalOutput: Float32Array[] = new Array(channels);
          // finalOutput[0] = new Float32Array(finalAvailable); // Allocate
          // const finalRetrieved = rubberbandInstance.retrieve(finalOutput[0], finalAvailable);
          // For now, simple placeholder:
          const finalRetrievedSamples = rubberbandInstance.retrieve(
            new Float32Array(finalAvailable),
          );
          const flushResult: RubberbandProcessResultPayload = {
            outputBuffer: [finalRetrievedSamples],
          };
          self.postMessage({
            type: RB_WORKER_MSG_TYPE.FLUSH_RESULT,
            payload: flushResult,
            messageId,
          });
        } else {
          self.postMessage({
            type: RB_WORKER_MSG_TYPE.FLUSH_RESULT,
            payload: { outputBuffer: [] },
            messageId,
          });
        }
        rubberbandInstance.reset(); // Reset for next use
        break;

      case RB_WORKER_MSG_TYPE.RESET:
        if (rubberbandInstance) rubberbandInstance.reset();
        break;

      default:
        console.warn(`RubberbandWorker: Unknown message type: ${type}`);
        self.postMessage({
          type: "unknown_message",
          error: `Unknown message type: ${type}`,
          messageId,
        });
    }
  } catch (error: any) {
    console.error(`Error in RubberbandWorker (type: ${type}):`, error);
    self.postMessage({
      type: `${type}_ERROR` as string,
      error: error.message,
      messageId,
    });
  }
};
