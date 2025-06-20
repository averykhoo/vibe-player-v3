// vibe-player-v2.0/src/lib/services/spectrogram.service.ts
import { browser } from "$app/environment"; // <-- ADD THIS IMPORT
import type {
  SpectrogramInitPayload,
  SpectrogramProcessPayload,
  SpectrogramResultPayload,
  WorkerMessage,
} from "$lib/types/worker.types";
import { SPEC_WORKER_MSG_TYPE } from "$lib/types/worker.types";
import { VISUALIZER_CONSTANTS } from "$lib/utils/constants";
import { analysisStore } from "$lib/stores/analysis.store";
import SpectrogramWorker from "$lib/workers/spectrogram.worker?worker&inline";

class SpectrogramService {
  private static instance: SpectrogramService;
  private worker: Worker | null = null;
  private isInitialized = false;
  private nextMessageId = 0;
  private pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason?: any) => void }
  >();

  private constructor() {}

  public static getInstance(): SpectrogramService {
    if (!SpectrogramService.instance) {
      SpectrogramService.instance = new SpectrogramService();
    }
    return SpectrogramService.instance;
  }

  private generateMessageId(): string {
    return `spec_msg_${this.nextMessageId++}`;
  }

  private postMessageToWorker<T>(message: WorkerMessage<T>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        return reject(new Error("Spectrogram Worker not initialized."));
      }
      const messageId = this.generateMessageId();
      this.pendingRequests.set(messageId, { resolve, reject });
      this.worker.postMessage({ ...message, messageId });
    });
  }

  public async initialize(options: { sampleRate: number }): Promise<void> {
    if (!browser) return; // <-- ADD THIS GUARD

    if (this.isInitialized) {
      console.log(
        "SpectrogramService: Re-initializing. Disposing existing worker first.",
      );
      this.dispose();
    }

    analysisStore.update((s) => ({
      ...s,
      spectrogramStatus: "Initializing worker...",
      spectrogramInitialized: false,
    }));
    this.worker = new SpectrogramWorker();

    this.worker.onmessage = (event: MessageEvent<WorkerMessage<unknown>>) => {
      const { type, payload, error, messageId } = event.data;
      const request = messageId
        ? this.pendingRequests.get(messageId)
        : undefined;
      if (error) {
        const errorMsg =
          typeof error === "string" ? error : (error as Error).message;
        analysisStore.update((s) => ({
          ...s,
          spectrogramError: `Worker error: ${errorMsg}`,
          spectrogramInitialized: false,
        }));
        if (request) request.reject(errorMsg);
      } else {
        switch (type) {
          case SPEC_WORKER_MSG_TYPE.INIT_SUCCESS:
            this.isInitialized = true;
            analysisStore.update((s) => ({
              ...s,
              spectrogramStatus: "Initialized",
              spectrogramInitialized: true,
              spectrogramError: null,
            }));
            if (request) request.resolve(payload);
            break;
          case SPEC_WORKER_MSG_TYPE.PROCESS_RESULT:
            const specResult = payload as SpectrogramResultPayload;
            analysisStore.update((s) => ({
              ...s,
              spectrogramData: specResult.magnitudes,
            }));
            if (request) request.resolve(specResult);
            break;
          default:
            if (request) request.resolve(payload);
        }
      }
      if (messageId && request) this.pendingRequests.delete(messageId);
    };

    this.worker.onerror = (err: Event | string) => {
      const errorMsg =
        typeof err === "string"
          ? err
          : err instanceof ErrorEvent
            ? err.message
            : "Unknown error";
      analysisStore.update((s) => ({
        ...s,
        spectrogramError: `Worker onerror: ${errorMsg}`,
        spectrogramInitialized: false,
      }));
      this.pendingRequests.forEach((req) =>
        req.reject(
          new Error(`Spectrogram Worker failed critically: ${errorMsg}`),
        ),
      );
      this.pendingRequests.clear();
      this.isInitialized = false;
    };

    // Fetch the FFT script text
    let fftScriptText: string;
    try {
      const fftResponse = await fetch(
        VISUALIZER_CONSTANTS.FFT_WORKER_SCRIPT_URL,
      );
      if (!fftResponse.ok) {
        throw new Error(
          `Failed to fetch FFT script: ${fftResponse.status} ${fftResponse.statusText}`,
        );
      }
      fftScriptText = await fftResponse.text();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      analysisStore.update((s) => ({
        ...s,
        spectrogramError: `FFT script fetch error: ${errorMessage}`,
        spectrogramInitialized: false,
      }));
      this.isInitialized = false;
      return; // Stop initialization if script fetch fails
    }

    const initPayload: SpectrogramInitPayload = {
      origin: location.origin,
      fftScriptText, // Pass the fetched script content
      sampleRate: options.sampleRate,
      fftSize: VISUALIZER_CONSTANTS.SPEC_NORMAL_FFT_SIZE,
      hopLength: Math.floor(VISUALIZER_CONSTANTS.SPEC_NORMAL_FFT_SIZE / 4),
    };

    try {
      await this.postMessageToWorker({
        type: SPEC_WORKER_MSG_TYPE.INIT,
        payload: initPayload,
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      analysisStore.update((s) => ({
        ...s,
        spectrogramError: errorMessage,
        spectrogramInitialized: false,
      }));
      this.isInitialized = false;
    }
  }

  public async process(audioData: Float32Array): Promise<void> {
    if (!this.worker || !this.isInitialized) {
      throw new Error("Spectrogram worker not initialized or unavailable.");
    }
    analysisStore.update((s) => ({
      ...s,
      spectrogramStatus: "Processing audio for spectrogram...",
    }));
    try {
      await this.postMessageToWorker<SpectrogramProcessPayload>({
        type: SPEC_WORKER_MSG_TYPE.PROCESS,
        payload: { audioData },
      });
      analysisStore.update((s) => ({
        ...s,
        spectrogramStatus: "Processing complete.",
      }));
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      analysisStore.update((s) => ({
        ...s,
        spectrogramStatus: "Processing failed.",
        spectrogramError: errorMessage,
      }));
    }
  }

  public dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
    }
    this.pendingRequests.clear();
    analysisStore.update((s) => ({
      ...s,
      spectrogramStatus: "Disposed",
      spectrogramData: null,
      spectrogramInitialized: false,
      spectrogramError: null,
    }));
    console.log("SpectrogramService disposed.");
  }
}

export default SpectrogramService.getInstance();
