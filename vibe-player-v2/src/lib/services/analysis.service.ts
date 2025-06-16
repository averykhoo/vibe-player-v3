// vibe-player-v2/src/lib/services/analysis.service.ts
import { browser } from "$app/environment";
import type {
  SileroVadInitPayload,
  SileroVadProcessPayload,
  SileroVadProcessResultPayload,
  WorkerMessage,
} from "$lib/types/worker.types";
import { VAD_WORKER_MSG_TYPE } from "$lib/types/worker.types";
import { VAD_CONSTANTS } from "$lib/utils";
import { analysisStore } from "$lib/stores/analysis.store";
import SileroVadWorker from "$lib/workers/sileroVad.worker?worker&inline";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: any) => void;
}

interface AnalysisServiceInitializeOptions {
  positiveThreshold?: number;
  negativeThreshold?: number;
}

class AnalysisService {
  private static instance: AnalysisService;
  private worker: Worker | null = null;
  private isInitialized = false;
  private isInitializing = false;
  private nextMessageId = 0;
  private pendingRequests = new Map<string, PendingRequest>();

  private constructor() {}

  public static getInstance(): AnalysisService {
    if (!AnalysisService.instance) {
      AnalysisService.instance = new AnalysisService();
    }
    return AnalysisService.instance;
  }

  private generateMessageId(): string {
    return `vad_msg_${this.nextMessageId++}`;
  }

  private postMessageToWorker<T>(
    message: WorkerMessage<T>,
    transferList?: Transferable[],
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        return reject(new Error("VAD Worker not initialized."));
      }
      const messageId = this.generateMessageId();
      this.pendingRequests.set(messageId, { resolve, reject });
      this.worker.postMessage({ ...message, messageId }, transferList || []);
    });
  }

  public async initialize(
    options?: AnalysisServiceInitializeOptions,
  ): Promise<void> {
    if (!browser) return;
    if (this.isInitialized || this.isInitializing) {
      return;
    }
    this.isInitializing = true;
    analysisStore.update((s) => ({
      ...s,
      vadStatus: "VAD service initializing...",
      vadInitialized: false,
      vadError: null,
    }));

    this.worker = new SileroVadWorker();

    this.worker.onmessage = (event: MessageEvent<WorkerMessage<unknown>>) => {
      const { type, payload, error, messageId } = event.data;
      const request = messageId
        ? this.pendingRequests.get(messageId)
        : undefined;

      if (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        analysisStore.update((s) => ({
          ...s,
          vadError: `VAD Worker error: ${errorMsg}`,
        }));
        if (request) request.reject(new Error(errorMsg));
        if (type === VAD_WORKER_MSG_TYPE.INIT_ERROR) {
          this.isInitialized = false;
          this.isInitializing = false;
          analysisStore.update((s) => ({
            ...s,
            vadStatus: "Error initializing VAD service.",
            vadInitialized: false,
          }));
        }
      } else {
        switch (type) {
          case VAD_WORKER_MSG_TYPE.INIT_SUCCESS:
            this.isInitialized = true;
            this.isInitializing = false;
            analysisStore.update((s) => ({
              ...s,
              vadStatus: "VAD service initialized.",
              vadInitialized: true,
              vadError: null,
            }));
            if (request) request.resolve(payload);
            break;
          case VAD_WORKER_MSG_TYPE.PROCESS_RESULT:
            const resultPayload = payload as SileroVadProcessResultPayload;
            analysisStore.update((s) => ({
              ...s,
              lastVadResult: resultPayload,
              isSpeaking: resultPayload.isSpeech,
            }));
            if (request) request.resolve(resultPayload);
            break;
          case `${VAD_WORKER_MSG_TYPE.RESET}_SUCCESS`:
            analysisStore.update((s) => ({
              ...s,
              vadStateResetted: true,
              lastVadResult: null,
              isSpeaking: false,
            }));
            if (request) request.resolve(payload);
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
            : "Unknown VAD worker error";
      analysisStore.update((s) => ({
        ...s,
        vadStatus: "Critical VAD worker error.",
        vadError: errorMsg,
        vadInitialized: false,
      }));
      this.pendingRequests.forEach((req) =>
        req.reject(new Error(`VAD Worker failed critically: ${errorMsg}`)),
      );
      this.pendingRequests.clear();
      this.isInitialized = false;
      this.isInitializing = false;
    };

    try {
      const modelResponse = await fetch(VAD_CONSTANTS.ONNX_MODEL_URL);
      if (!modelResponse.ok) {
        throw new Error(
          `Failed to fetch ONNX model: ${modelResponse.statusText}`,
        );
      }
      const modelBuffer = await modelResponse.arrayBuffer();

      const initPayload: SileroVadInitPayload = {
        origin: location.origin, // <-- ADDED
        modelBuffer,
        sampleRate: VAD_CONSTANTS.SAMPLE_RATE,
        frameSamples: VAD_CONSTANTS.DEFAULT_FRAME_SAMPLES,
        positiveThreshold:
          options?.positiveThreshold ||
          VAD_CONSTANTS.DEFAULT_POSITIVE_THRESHOLD,
        negativeThreshold:
          options?.negativeThreshold ||
          VAD_CONSTANTS.DEFAULT_NEGATIVE_THRESHOLD,
      };

      await this.postMessageToWorker<SileroVadInitPayload>(
        { type: VAD_WORKER_MSG_TYPE.INIT, payload: initPayload },
        [initPayload.modelBuffer],
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.isInitialized = false;
      this.isInitializing = false;
      analysisStore.update((s) => ({
        ...s,
        vadStatus: "Error sending VAD init to worker.",
        vadError: errorMessage,
        vadInitialized: false,
      }));
      throw err;
    }
  }

  public async analyzeAudioFrame(
    audioFrame: Float32Array,
    timestamp?: number,
  ): Promise<SileroVadProcessResultPayload | null> {
    if (!this.worker || !this.isInitialized) {
      const errorMsg = "VAD Service not initialized or worker unavailable.";
      analysisStore.update((s) => ({ ...s, vadError: errorMsg }));
      throw new Error(errorMsg);
    }
    const payload: SileroVadProcessPayload = { audioFrame, timestamp };
    try {
      const result = await this.postMessageToWorker<SileroVadProcessPayload>(
        { type: VAD_WORKER_MSG_TYPE.PROCESS, payload },
        [payload.audioFrame.buffer],
      );
      return result as SileroVadProcessResultPayload;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      analysisStore.update((s) => ({
        ...s,
        vadError: `Error processing VAD frame: ${errorMessage}`,
      }));
      return null;
    }
  }

  public dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
    this.nextMessageId = 0;
    this.isInitialized = false;
    this.isInitializing = false;
    analysisStore.update((s) => ({
      ...s,
      vadStatus: "VAD service disposed.",
      vadInitialized: false,
      lastVadResult: null,
      isSpeaking: undefined,
      vadError: null,
    }));
    console.log("AnalysisService disposed.");
  }
}

export default AnalysisService.getInstance();
