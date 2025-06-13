// vibe-player-v2/src/lib/services/analysis.service.ts
import { writable, get } from "svelte/store";
import type {
  WorkerMessage,
  SileroVadInitPayload,
  SileroVadProcessResultPayload,
  SileroVadProcessPayload,
  SpectrogramInitPayload,
  SpectrogramResultPayload,
  SpectrogramProcessPayload,
} from "$lib/types/worker.types";
import { VAD_CONSTANTS, VISUALIZER_CONSTANTS } from "$lib/utils";
import { VAD_WORKER_MSG_TYPE, SPEC_WORKER_MSG_TYPE } from "$lib/types/worker.types";
import { analysisStore, type AnalysisState } from "$lib/stores/analysis.store";
// import type { PlayerState } from '$lib/types/player.types'; // AudioBuffer is used

import SpectrogramWorker from '$lib/workers/spectrogram.worker?worker&inline';
import SileroVadWorker from '$lib/workers/sileroVad.worker?worker&inline';

interface AnalysisServiceState {
  isInitialized: boolean; // For VAD worker
  isInitializing: boolean; // For VAD worker
  error: string | null; // For VAD worker
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

interface AnalysisServiceInitializeOptions {
  positiveThreshold?: number;
  negativeThreshold?: number;
}

interface SpectrogramWorkerInitializeOptions {
  sampleRate: number;
  fftSize?: number;
  hopLength?: number;
}

const initialServiceState: AnalysisServiceState = {
  isInitialized: false,
  isInitializing: false,
  error: null,
};

const serviceState = writable<AnalysisServiceState>(initialServiceState);

class AnalysisService {
  private static instance: AnalysisService;
  private worker: Worker | null = null; // SileroVadWorker
  private nextMessageId = 0;
  private pendingRequests = new Map<string, PendingRequest>();

  private spectrogramWorker: Worker | null = null;
  private spectrogramInitialized = writable<boolean>(false);
  private nextSpecMessageId = 0;
  private pendingSpecRequests = new Map<string, PendingRequest>();

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

  private postMessageToWorker<T>(message: WorkerMessage<T>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("VAD Worker not initialized."));
        return;
      }
      const messageId = this.generateMessageId();
      this.pendingRequests.set(messageId, { resolve, reject });
      this.worker.postMessage({ ...message, messageId });
    });
  }

  public async initialize(options?: AnalysisServiceInitializeOptions): Promise<void> {
    if (get(serviceState).isInitialized || get(serviceState).isInitializing) {
      console.warn("AnalysisService (VAD) already initialized or initializing.");
      return;
    }
    serviceState.update((s: AnalysisServiceState) => ({ ...s, isInitializing: true, error: null }));
    analysisStore.update((s: AnalysisState) => ({
      ...s,
      vadStatus: "VAD service initializing...",
      vadInitialized: false, // Explicitly set during init start
    }));

    this.worker = new SileroVadWorker();

    this.worker.onmessage = (event: MessageEvent<WorkerMessage<unknown>>) => {
      const { type, payload, error, messageId } = event.data;
      const request = messageId
        ? this.pendingRequests.get(messageId)
        : undefined;

      if (error) {
        const errorMsg = typeof error === 'string' ? error : (error as Error).message || 'Unknown VAD worker message error';
        console.error(`AnalysisService VAD Worker Error (type ${type}):`, errorMsg);
        serviceState.update((s: AnalysisServiceState) => ({
          ...s,
          error: `VAD Worker error: ${errorMsg}`,
        }));
        if (request) {
          request.reject(errorMsg);
          if (messageId) this.pendingRequests.delete(messageId);
        }
        if (type === VAD_WORKER_MSG_TYPE.INIT_ERROR) {
          serviceState.update((s: AnalysisServiceState) => ({
            ...s,
            isInitialized: false,
            isInitializing: false,
          }));
          analysisStore.update((s: AnalysisState) => ({
            ...s,
            vadStatus: "Error initializing VAD service.",
            vadError: errorMsg,
            vadInitialized: false,
          }));
        }
        return;
      }

      switch (type) {
        case VAD_WORKER_MSG_TYPE.INIT_SUCCESS:
          serviceState.update((s: AnalysisServiceState) => ({
            ...s,
            isInitialized: true,
            isInitializing: false,
          }));
          analysisStore.update((s: AnalysisState) => ({
            ...s,
            vadStatus: "VAD service initialized.",
            vadInitialized: true,
            vadError: null,
          }));
          if (request) request.resolve(payload);
          break;

        case VAD_WORKER_MSG_TYPE.PROCESS_RESULT:
          const resultPayload = payload as SileroVadProcessResultPayload;
          analysisStore.update((s: AnalysisState) => ({
            ...s,
            lastVadResult: resultPayload,
            isSpeaking: resultPayload.isSpeech,
          }));
          if (request) request.resolve(resultPayload);
          break;

        case `${VAD_WORKER_MSG_TYPE.RESET}_SUCCESS`:
          analysisStore.update((s: AnalysisState) => ({ ...s, vadStateResetted: true, lastVadResult: null, isSpeaking: false }));
          if (request) request.resolve(payload);
          break;

        default:
          console.log(
            "AnalysisService received message from VAD worker:",
            event.data,
          );
          if (request) request.resolve(payload);
      }
      if (messageId && request) this.pendingRequests.delete(messageId);
    };

    this.worker.onerror = (err: Event | string) => {
      const errorMsg = typeof err === 'string' ? err : (err instanceof ErrorEvent ? err.message : 'Unknown VAD worker error');
      console.error("Unhandled error in SileroVadWorker:", errorMsg);
      serviceState.update((s: AnalysisServiceState) => ({
        ...s,
        error: `VAD Worker onerror: ${errorMsg}`,
        isInitialized: false,
        isInitializing: false,
      }));
      analysisStore.update((s: AnalysisState) => ({
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

    const initPayload: SileroVadInitPayload = {
      origin: location.origin,
      onnxModelPath: VAD_CONSTANTS.ONNX_MODEL_URL, // Use constant
      sampleRate: VAD_CONSTANTS.SAMPLE_RATE,
      frameSamples: VAD_CONSTANTS.DEFAULT_FRAME_SAMPLES,
      positiveThreshold:
        options?.positiveThreshold || VAD_CONSTANTS.DEFAULT_POSITIVE_THRESHOLD,
      negativeThreshold:
        options?.negativeThreshold || VAD_CONSTANTS.DEFAULT_NEGATIVE_THRESHOLD,
    };

    try {
      await this.postMessageToWorker<SileroVadInitPayload>({
        type: VAD_WORKER_MSG_TYPE.INIT,
        payload: initPayload,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      serviceState.update((s: AnalysisServiceState) => ({
        ...s,
        error: errorMessage || "VAD Initialization failed",
        isInitialized: false,
        isInitializing: false,
      }));
      analysisStore.update((s: AnalysisState) => ({
        ...s,
        vadStatus: "Error sending VAD init to worker.",
        vadError: errorMessage,
        vadInitialized: false,
      }));
    }
  }

  public async analyzeAudioFrame(
    audioFrame: Float32Array,
    timestamp?: number,
  ): Promise<SileroVadProcessResultPayload | null> {
    if (!this.worker || !get(serviceState).isInitialized) {
      const errorMsg = "VAD Service not initialized or worker unavailable.";
      console.error(errorMsg);
      analysisStore.update((s: AnalysisState) => ({ ...s, vadError: errorMsg }));
      throw new Error(errorMsg);
    }
    const payload: SileroVadProcessPayload = { audioFrame, timestamp };
    try {
      const result = await this.postMessageToWorker<SileroVadProcessPayload>({
        type: VAD_WORKER_MSG_TYPE.PROCESS,
        payload,
      });
      return result as SileroVadProcessResultPayload;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Error processing VAD frame:", errorMessage);
      analysisStore.update((s: AnalysisState) => ({
        ...s,
        vadError: `Error processing VAD frame: ${errorMessage}`,
      }));
      return null;
    }
  }

  public async resetVadState(): Promise<void> {
    if (!this.worker || !get(serviceState).isInitialized) {
      const errorMsg = "VAD Service not initialized or worker unavailable for reset.";
      console.error(errorMsg);
      analysisStore.update((s: AnalysisState) => ({ ...s, vadError: errorMsg }));
      throw new Error(errorMsg);
    }
    try {
      await this.postMessageToWorker<undefined>({ type: VAD_WORKER_MSG_TYPE.RESET });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Error resetting VAD state:", errorMessage);
      analysisStore.update((s: AnalysisState) => ({
        ...s,
        vadError: `Error resetting VAD state: ${errorMessage}`,
      }));
    }
  }

  public detectDTMF(
    audioFrame: Float32Array, // eslint-disable-line @typescript-eslint/no-unused-vars
    sampleRate: number, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): string | null {
    // TODO: Implement Goertzel algorithm for DTMF frequencies
    console.log("DTMF detection not yet implemented.");
    return null;
  }

  public dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
    this.nextMessageId = 0;
    serviceState.set(initialServiceState); // Reset VAD specific state
    analysisStore.update((s: AnalysisState) => ({
      ...s,
      vadStatus: "VAD service disposed.",
      vadInitialized: false,
      lastVadResult: null,
      isSpeaking: undefined,
      vadError: null,
    }));
    this.disposeSpectrogramWorker(); // Ensure spec worker is also disposed
    console.log("AnalysisService (VAD and Spectrogram workers) disposed.");
  }

  private generateSpecMessageId(): string {
    return `spec_msg_${this.nextSpecMessageId++}`;
  }

  private postMessageToSpecWorker<T>(message: WorkerMessage<T>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.spectrogramWorker) {
        reject(new Error("Spectrogram Worker not initialized."));
        return;
      }
      const messageId = this.generateSpecMessageId();
      this.pendingSpecRequests.set(messageId, { resolve, reject });
      this.spectrogramWorker.postMessage({ ...message, messageId });
    });
  }

  public async initializeSpectrogramWorker(options: SpectrogramWorkerInitializeOptions): Promise<void> {
    if (get(this.spectrogramInitialized)) {
      console.warn("Spectrogram worker already initialized.");
      return;
    }

    this.spectrogramWorker = new SpectrogramWorker();
    analysisStore.update((s: AnalysisState) => ({
      ...s,
      spectrogramStatus: "Spectrogram worker initializing...",
      spectrogramInitialized: false,
    }));

    this.spectrogramWorker.onmessage = (event: MessageEvent<WorkerMessage<unknown>>) => {
      const { type, payload, error, messageId } = event.data;
      const request = messageId
        ? this.pendingSpecRequests.get(messageId)
        : undefined;

      if (error) {
        const errorMsg = typeof error === 'string' ? error : (error as Error).message || 'Unknown Spectrogram worker message error';
        console.error(`Spectrogram Worker Error (type ${type}):`, errorMsg);
        analysisStore.update((s: AnalysisState) => ({
          ...s,
          spectrogramError: `Worker error: ${errorMsg}`,
          spectrogramInitialized: false,
        }));
        if (request) {
          request.reject(errorMsg);
          if (messageId) this.pendingSpecRequests.delete(messageId);
        }
        if (type === SPEC_WORKER_MSG_TYPE.INIT_ERROR) {
          this.spectrogramInitialized.set(false); // Already set in analysisStore update
        }
        return;
      }

      switch (type) {
        case SPEC_WORKER_MSG_TYPE.INIT_SUCCESS:
          this.spectrogramInitialized.set(true);
          analysisStore.update((s: AnalysisState) => ({
            ...s,
            spectrogramStatus: "Spectrogram worker initialized.",
            spectrogramInitialized: true,
            spectrogramError: null,
          }));
          if (request) request.resolve(payload);
          break;
        case SPEC_WORKER_MSG_TYPE.PROCESS_RESULT:
          const specResult = payload as SpectrogramResultPayload;
          analysisStore.update((s: AnalysisState) => ({
            ...s,
            spectrogramData: specResult.magnitudes,
          }));
          if (request) request.resolve(specResult);
          break;
        default:
          if (request) request.resolve(payload);
      }
      if (messageId && request) this.pendingSpecRequests.delete(messageId);
    };

    this.spectrogramWorker.onerror = (err: Event | string) => {
      const errorMsg = typeof err === 'string' ? err : (err instanceof ErrorEvent ? err.message : 'Unknown Spectrogram worker error');
      console.error("Unhandled error in SpectrogramWorker:", errorMsg);
      analysisStore.update((s: AnalysisState) => ({
        ...s,
        spectrogramError: `Worker onerror: ${errorMsg}`,
        spectrogramInitialized: false,
        spectrogramStatus: "Spectrogram worker error."
      }));
      this.pendingSpecRequests.forEach((req) =>
        req.reject(new Error(`Spectrogram Worker failed critically: ${errorMsg}`)),
      );
      this.pendingSpecRequests.clear();
      this.spectrogramInitialized.set(false);
    };

    const initPayload: SpectrogramInitPayload = {
      origin: location.origin,
      fftPath: VISUALIZER_CONSTANTS.FFT_WORKER_SCRIPT_URL,
      sampleRate: options.sampleRate,
      fftSize: options.fftSize || VISUALIZER_CONSTANTS.SPEC_NORMAL_FFT_SIZE,
      hopLength:
        options.hopLength ||
        Math.floor(
          (options.fftSize || VISUALIZER_CONSTANTS.SPEC_NORMAL_FFT_SIZE) / 4,
        ),
    };
    try {
      await this.postMessageToSpecWorker<SpectrogramInitPayload>({
        type: SPEC_WORKER_MSG_TYPE.INIT,
        payload: initPayload,
      });
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      analysisStore.update((s: AnalysisState) => ({
        ...s,
        spectrogramError: errorMessage || "Spectrogram init failed",
        spectrogramInitialized: false,
        spectrogramStatus: "Error sending Spectrogram init to worker."
      }));
      this.spectrogramInitialized.set(false); // Ensure internal writable is also false
    }
  }

  public async processAudioForSpectrogram(
    audioData: Float32Array,
  ): Promise<SpectrogramResultPayload | null> {
    if (!this.spectrogramWorker || !get(this.spectrogramInitialized)) {
      const errorMsg = "Spectrogram worker not initialized or unavailable.";
      console.error(errorMsg);
      analysisStore.update((s: AnalysisState) => ({ ...s, spectrogramError: errorMsg }));
      throw new Error(errorMsg);
    }
    const payload: SpectrogramProcessPayload = { audioData };
    try {
      const result = await this.postMessageToSpecWorker<SpectrogramProcessPayload>({
        type: SPEC_WORKER_MSG_TYPE.PROCESS,
        payload,
      });
      return result as SpectrogramResultPayload;
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.error("Error processing audio for spectrogram:", errorMessage);
      analysisStore.update((s: AnalysisState) => ({ ...s, spectrogramError: `Error processing for spectrogram: ${errorMessage}` }));
      return null;
    }
  }

  public disposeSpectrogramWorker(): void {
    if (this.spectrogramWorker) {
      this.spectrogramWorker.terminate();
      this.spectrogramWorker = null;
    }
    this.spectrogramInitialized.set(false);
    this.pendingSpecRequests.clear();
    this.nextSpecMessageId = 0;
    analysisStore.update((s: AnalysisState) => ({
      ...s,
      spectrogramStatus: "Spectrogram worker disposed.",
      spectrogramData: null,
      spectrogramInitialized: false,
      spectrogramError: null,
    }));
  }

  public async startSpectrogramProcessing(
    audioBuffer: AudioBuffer, // AudioBuffer is a web Audio API type, not from player.types
  ): Promise<void> {
    if (!audioBuffer) {
      console.warn(
        "AnalysisService: No audio buffer provided for spectrogram processing.",
      );
      analysisStore.update((s: AnalysisState) => ({...s, spectrogramError: "No audio buffer for spectrogram."}));
      return;
    }

    // Re-initialize if needed (e.g. sample rate change) or not initialized
    if (!get(this.spectrogramInitialized) || get(analysisStore).spectrogramStatus?.includes("disposed")) {
      analysisStore.update((s: AnalysisState) => ({
        ...s,
        spectrogramStatus: "Initializing spectrogram worker for new file...",
      }));
      await this.initializeSpectrogramWorker({
        sampleRate: audioBuffer.sampleRate,
      });
    }

    if (!get(this.spectrogramInitialized)) {
      const errorMsg = "AnalysisService: Spectrogram worker failed to initialize for processing.";
      console.error(errorMsg);
      analysisStore.update((s: AnalysisState) => ({
        ...s,
        spectrogramError: errorMsg,
        spectrogramStatus: "Spectrogram worker initialization failed."
      }));
      return;
    }

    const pcmData = audioBuffer.getChannelData(0); // Process first channel
    if (pcmData && pcmData.length > 0) {
      analysisStore.update((s: AnalysisState) => ({
        ...s,
        spectrogramStatus: "Processing audio for spectrogram...",
      }));
      try {
        await this.processAudioForSpectrogram(pcmData);
        analysisStore.update((s: AnalysisState) => ({
          ...s,
          spectrogramStatus: "Spectrogram processing complete.", // Or "initiated" if it's async in worker
        }));
      } catch (error: unknown) {
         const errorMessage = error instanceof Error ? error.message : String(error);
         analysisStore.update((s: AnalysisState) => ({
          ...s,
          spectrogramStatus: "Spectrogram processing failed.",
          spectrogramError: errorMessage,
        }));
      }
    } else {
      console.warn("AnalysisService: No PCM data to process for spectrogram.");
      analysisStore.update((s: AnalysisState) => ({
        ...s,
        spectrogramStatus: "No data for spectrogram.",
        spectrogramData: null, // Clear any old data
      }));
    }
  }
}

export default AnalysisService.getInstance();
