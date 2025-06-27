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
