// vibe-player-v2.3/src/lib/services/analysis.service.ts
import { browser } from "$app/environment";
import { get } from "svelte/store";
import type { WorkerMessage } from "$lib/types/worker.types";
import { VAD_WORKER_MSG_TYPE } from "$lib/types/worker.types";
import { VAD_CONSTANTS, UI_CONSTANTS } from "$lib/utils";
import { analysisStore } from "$lib/stores/analysis.store";
import SileroVadWorker from "$lib/workers/sileroVad.worker?worker&inline";
import type { VadRegion } from "$lib/types/analysis.types";
import { debounce } from "$lib/utils/async";

interface AnalysisServiceInitializeOptions {
  positiveThreshold?: number;
  negativeThreshold?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: any) => void;
}

class AnalysisService {
  private static instance: AnalysisService;
  private worker: Worker | null = null;
  private isInitialized = false;
  private isInitializing = false;
  private initPromise: Promise<void> | null = null; // <-- FIX: To handle concurrent calls

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

  public initialize(
    options?: AnalysisServiceInitializeOptions,
  ): Promise<void> {
    // --- START OF FIX: Robust Idempotency ---
    console.log(
      `[AnalysisService-INIT] Call received. isInitialized: ${this.isInitialized}, isInitializing: ${this.isInitializing}`,
    );

    if (!browser) {
      console.log("[AnalysisService-INIT] Not in browser, returning resolved promise.");
      return Promise.resolve();
    }

    // If already initialized, return immediately.
    if (this.isInitialized) {
      console.log("[AnalysisService-INIT] Already initialized. Returning resolved promise.");
      return Promise.resolve();
    }

    // If an initialization is already in progress, return the existing promise to wait on.
    if (this.isInitializing && this.initPromise) {
      console.log("[AnalysisService-INIT] Initialization in progress. Returning existing promise.");
      return this.initPromise;
    }

    // This is the first call, so create the initialization promise.
    console.log("[AnalysisService-INIT] Starting new initialization process.");
    this.isInitializing = true;
    this.initPromise = this._doInitialize(options)
      .then(() => {
        console.log("[AnalysisService-INIT] _doInitialize resolved successfully.");
        this.isInitialized = true;
        this.isInitializing = false;
        this.initPromise = null; // Clear promise after success
      })
      .catch((err) => {
        console.error("[AnalysisService-INIT] _doInitialize rejected with error:", err);
        this.isInitialized = false;
        this.isInitializing = false;
        this.initPromise = null; // Clear promise after failure
        throw err; // Re-throw the error so callers can handle it
      });

    return this.initPromise;
    // --- END OF FIX ---
  }

  // --- NEW PRIVATE METHOD for the actual initialization logic ---
  private async _doInitialize(
    options?: AnalysisServiceInitializeOptions,
  ): Promise<void> {
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
          analysisStore.update((s) => ({
            ...s,
            vadStatus: "Error initializing VAD service.",
            vadInitialized: false,
          }));
        }
      } else {
        switch (type) {
          case VAD_WORKER_MSG_TYPE.INIT_SUCCESS:
            analysisStore.update((s) => ({
              ...s,
              vadStatus: "VAD service initialized.",
              vadInitialized: true,
              vadError: null,
            }));
            if (request) request.resolve(payload);
            break;
          case VAD_WORKER_MSG_TYPE.PROCESS_RESULT:
            if (request) request.resolve(payload);
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
    };

    try {
      console.log("[AnalysisService-INIT] Fetching ONNX model...");
      const modelResponse = await fetch(VAD_CONSTANTS.ONNX_MODEL_URL);
      if (!modelResponse.ok) {
        throw new Error(
          `Failed to fetch ONNX model: ${modelResponse.statusText}`,
        );
      }
      const modelBuffer = await modelResponse.arrayBuffer();
      console.log("[AnalysisService-INIT] Model fetched. Posting INIT message to worker.");
      const initPayload = {
        origin: location.origin,
        modelBuffer,
        sampleRate: VAD_CONSTANTS.SAMPLE_RATE,
        frameSamples: VAD_CONSTANTS.DEFAULT_FRAME_SAMPLES,
      };
      await this.postMessageToWorker(
        { type: VAD_WORKER_MSG_TYPE.INIT, payload: initPayload },
        [initPayload.modelBuffer],
      );
      console.log("[AnalysisService-INIT] INIT message sent to worker, awaiting response.");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      analysisStore.update((s) => ({
        ...s,
        vadStatus: "Error sending VAD init to worker.",
        vadError: errorMessage,
        vadInitialized: false,
      }));
      throw err;
    }
  }

  public async processVad(pcmData: Float32Array): Promise<void> {
    if (!this.worker || !this.isInitialized) {
      throw new Error("VAD Service not initialized or worker unavailable.");
    }

    analysisStore.update((s) => ({
      ...s,
      vadStatus: "Analyzing voice activity...",
      isLoading: true,
      vadProbabilities: null,
      vadRegions: null,
    }));

    const payload = { pcmData };
    const result = (await this.postMessageToWorker(
      { type: VAD_WORKER_MSG_TYPE.PROCESS, payload },
      [payload.pcmData.buffer],
    )) as { probabilities: Float32Array };

    analysisStore.update((s) => ({
      ...s,
      vadProbabilities: result.probabilities,
      isLoading: false,
      vadStatus: "VAD analysis complete.",
    }));

    this.recalculateVadRegions();
  }

  public recalculateVadRegions = debounce((): void => {
    const state = get(analysisStore);
    if (!state.vadProbabilities) return;

    const { vadProbabilities, vadPositiveThreshold, vadNegativeThreshold } =
      state;
    const {
      SAMPLE_RATE,
      DEFAULT_FRAME_SAMPLES,
      MIN_SPEECH_DURATION_MS,
      SPEECH_PAD_MS,
      REDEMPTION_FRAMES,
    } = VAD_CONSTANTS;

    const newRegions: VadRegion[] = [];
    let inSpeech = false;
    let regionStart = 0.0;
    let redemptionCounter = 0;
    let lastPositiveFrameIndex = -1;

    for (let i = 0; i < vadProbabilities.length; i++) {
      const probability = vadProbabilities[i];
      const frameStartTime = (i * DEFAULT_FRAME_SAMPLES) / SAMPLE_RATE;

      if (probability >= vadPositiveThreshold) {
        if (!inSpeech) {
          inSpeech = true;
          regionStart = frameStartTime;
        }
        redemptionCounter = 0;
        lastPositiveFrameIndex = i;
      } else if (inSpeech) {
        if (probability < vadNegativeThreshold) {
          redemptionCounter++;
          if (redemptionCounter >= REDEMPTION_FRAMES) {
            const firstBadFrameIndex = i - REDEMPTION_FRAMES + 1;
            const actualEnd =
              (firstBadFrameIndex * DEFAULT_FRAME_SAMPLES) / SAMPLE_RATE;
            newRegions.push({
              start: regionStart,
              end: Math.max(regionStart, actualEnd),
            });
            inSpeech = false;
            redemptionCounter = 0;
            lastPositiveFrameIndex = -1;
          }
        } else {
          redemptionCounter = 0;
        }
      }
    }

    if (inSpeech) {
      const endFrameIndexPlusOne =
        lastPositiveFrameIndex !== -1 &&
        lastPositiveFrameIndex < vadProbabilities.length
          ? lastPositiveFrameIndex + 1
          : vadProbabilities.length;
      const finalEnd =
        (endFrameIndexPlusOne * DEFAULT_FRAME_SAMPLES) / SAMPLE_RATE;
      newRegions.push({
        start: regionStart,
        end: Math.max(regionStart, finalEnd),
      });
    }

    const minSpeechDuration = MIN_SPEECH_DURATION_MS / 1000.0;
    const speechPad = SPEECH_PAD_MS / 1000.0;

    const paddedAndFilteredRegions: VadRegion[] = [];
    for (const region of newRegions) {
      const start = Math.max(0, region.start - speechPad);
      const end = region.end + speechPad;

      if (end - start >= minSpeechDuration) {
        paddedAndFilteredRegions.push({ start: start, end: end });
      }
    }

    const mergedRegions: VadRegion[] = [];
    if (paddedAndFilteredRegions.length > 0) {
      let currentRegion = { ...paddedAndFilteredRegions[0] };
      for (let i = 1; i < paddedAndFilteredRegions.length; i++) {
        const nextRegion = paddedAndFilteredRegions[i];
        if (nextRegion.start < currentRegion.end) {
          currentRegion.end = Math.max(currentRegion.end, nextRegion.end);
        } else {
          mergedRegions.push(currentRegion);
          currentRegion = { ...nextRegion };
        }
      }
      mergedRegions.push(currentRegion);
    }

    const maxProbTime =
      (vadProbabilities.length * DEFAULT_FRAME_SAMPLES) / SAMPLE_RATE;
    const finalRegions = mergedRegions.map((region) => ({
      start: region.start,
      end: Math.min(region.end, maxProbTime),
    }));

    analysisStore.update((s) => ({ ...s, vadRegions: finalRegions }));
  }, UI_CONSTANTS.DEBOUNCE_HASH_UPDATE_MS);

  public dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
    this.nextMessageId = 0;
    this.isInitialized = false;
    this.isInitializing = false;
    this.initPromise = null;
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