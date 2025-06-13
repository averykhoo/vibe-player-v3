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
import { VAD_CONSTANTS, VISUALIZER_CONSTANTS } from "$lib/utils"; // Assuming VAD_CONSTANTS is in utils/index
import { VAD_WORKER_MSG_TYPE, SPEC_WORKER_MSG_TYPE } from "$lib/types/worker.types";
import { analysisStore } from "$lib/stores/analysis.store"; // Assuming analysisStore exists

import SpectrogramWorker from '$lib/workers/spectrogram.worker?worker&inline';
import SileroVadWorker from '$lib/workers/sileroVad.worker?worker&inline';

interface AnalysisServiceState {
  isInitialized: boolean;
  isInitializing: boolean;
  error: string | null;
  // Add other relevant state properties
}

const initialServiceState: AnalysisServiceState = {
  isInitialized: false,
  isInitializing: false,
  error: null,
};

const serviceState = writable<AnalysisServiceState>(initialServiceState);

class AnalysisService {
  private static instance: AnalysisService;
  private worker: Worker | null = null;
  private nextMessageId = 0;
  private pendingRequests = new Map<
    string,
    { resolve: (value: any) => void; reject: (reason?: any) => void }
  >();

  // Add to AnalysisService class:
  private spectrogramWorker: Worker | null = null;
  private spectrogramInitialized = writable(false);
  private nextSpecMessageId = 0;
  private pendingSpecRequests = new Map<
    string,
    { resolve: (value: any) => void; reject: (reason?: any) => void }
  >();

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

  private postMessageToWorker<T>(message: WorkerMessage<T>): Promise<any> {
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

  public async initialize(options?: {
    positiveThreshold?: number;
    negativeThreshold?: number;
  }): Promise<void> {
    if (get(serviceState).isInitialized || get(serviceState).isInitializing) {
      console.warn("AnalysisService already initialized or initializing.");
      return;
    }
    serviceState.update((s) => ({ ...s, isInitializing: true, error: null }));
    analysisStore.update((s) => ({
      ...s,
      status: "VAD service initializing...",
    }));

    this.worker = new SileroVadWorker();

    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const { type, payload, error, messageId } = event.data;
      const request = messageId
        ? this.pendingRequests.get(messageId)
        : undefined;

      if (error) {
        console.error(`AnalysisService Worker Error (type ${type}):`, error);
        serviceState.update((s) => ({
          ...s,
          error: `VAD Worker error: ${error}`,
        }));
        if (request) {
          request.reject(error);
          this.pendingRequests.delete(messageId!);
        }
        if (type === VAD_WORKER_MSG_TYPE.INIT_ERROR) {
          serviceState.update((s) => ({
            ...s,
            isInitialized: false,
            isInitializing: false,
          }));
          analysisStore.update((s) => ({
            ...s,
            status: "Error initializing VAD service.",
          }));
        }
        return;
      }

      switch (type) {
        case VAD_WORKER_MSG_TYPE.INIT_SUCCESS:
          serviceState.update((s) => ({
            ...s,
            isInitialized: true,
            isInitializing: false,
          }));
          analysisStore.update((s) => ({
            ...s,
            status: "VAD service initialized.",
          }));
          if (request) request.resolve(payload);
          break;

        case VAD_WORKER_MSG_TYPE.PROCESS_RESULT:
          const resultPayload = payload as SileroVadProcessResultPayload;
          analysisStore.update((s) => ({
            ...s,
            lastVadResult: resultPayload,
            isSpeaking: resultPayload.isSpeech, // Example update
          }));
          if (request) request.resolve(resultPayload);
          break;

        case `${VAD_WORKER_MSG_TYPE.RESET}_SUCCESS`:
          analysisStore.update((s) => ({ ...s, vadStateResetted: true }));
          if (request) request.resolve(payload);
          break;

        default:
          console.log(
            "AnalysisService received message from VAD worker:",
            event.data,
          );
          if (request) request.resolve(payload); // Generic resolve
      }
      if (messageId && request) this.pendingRequests.delete(messageId);
    };

    this.worker.onerror = (err) => {
      console.error("Unhandled error in SileroVadWorker:", err);
      serviceState.update((s) => ({
        ...s,
        error: `VAD Worker onerror: ${err.message}`,
        isInitialized: false,
        isInitializing: false,
      }));
      analysisStore.update((s) => ({
        ...s,
        status: "Critical VAD worker error.",
      }));
      this.pendingRequests.forEach((req) =>
        req.reject(new Error("VAD Worker failed critically.")),
      );
      this.pendingRequests.clear();
    };

    const initPayload: SileroVadInitPayload = {
      origin: location.origin, // Added for dynamic WASM path resolution
      onnxModelPath: "/silero_vad.onnx", // Assuming model is in static root
      sampleRate: VAD_CONSTANTS.SAMPLE_RATE,
      frameSamples: VAD_CONSTANTS.DEFAULT_FRAME_SAMPLES,
      positiveThreshold:
        options?.positiveThreshold || VAD_CONSTANTS.DEFAULT_POSITIVE_THRESHOLD,
      negativeThreshold:
        options?.negativeThreshold || VAD_CONSTANTS.DEFAULT_NEGATIVE_THRESHOLD,
    };

    try {
      await this.postMessageToWorker({
        type: VAD_WORKER_MSG_TYPE.INIT,
        payload: initPayload,
      });
    } catch (err: any) {
      serviceState.update((s) => ({
        ...s,
        error: err.message || "VAD Initialization failed",
        isInitialized: false,
        isInitializing: false,
      }));
      analysisStore.update((s) => ({
        ...s,
        status: "Error sending VAD init to worker.",
      }));
    }
  }

  public async analyzeAudioFrame(
    audioFrame: Float32Array,
    timestamp?: number,
  ): Promise<SileroVadProcessResultPayload | null> {
    if (!get(serviceState).isInitialized || !this.worker) {
      // console.error('VAD Service not initialized.');
      // throw new Error('VAD Service not initialized.');
      // Silently fail or queue if not initialized? For now, throw.
      throw new Error("VAD Service not initialized.");
    }
    const payload: SileroVadProcessPayload = { audioFrame, timestamp };
    try {
      const result = await this.postMessageToWorker({
        type: VAD_WORKER_MSG_TYPE.PROCESS,
        payload,
      });
      return result as SileroVadProcessResultPayload;
    } catch (error) {
      console.error("Error processing VAD frame:", error);
      analysisStore.update((s) => ({
        ...s,
        error: "Error processing VAD frame",
      }));
      return null;
    }
  }

  public async resetVadState(): Promise<void> {
    if (!get(serviceState).isInitialized || !this.worker)
      throw new Error("VAD Service not initialized.");
    try {
      await this.postMessageToWorker({ type: VAD_WORKER_MSG_TYPE.RESET });
    } catch (error) {
      console.error("Error resetting VAD state:", error);
      analysisStore.update((s) => ({
        ...s,
        error: "Error resetting VAD state",
      }));
    }
  }

  // Placeholder for Goertzel DTMF detection logic
  // This would likely operate on raw audio frames or chunks
  public detectDTMF(
    audioFrame: Float32Array,
    sampleRate: number,
  ): string | null {
    // TODO: Implement Goertzel algorithm for DTMF frequencies
    // This is a highly simplified placeholder
    console.log("DTMF detection not yet implemented.");
    return null;
  }

  public dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
    this.nextMessageId = 0; // Reset message ID counter
    serviceState.set(initialServiceState);
    analysisStore.update((s) => ({
      ...s,
      status: "VAD service disposed.",
      isInitialized: false,
    }));
    // ... (existing VAD worker disposal) ...
    this.disposeSpectrogramWorker();
    // ... (rest of existing dispose) ...
    console.log("AnalysisService (and Spectrogram worker) disposed.");
  }

  private generateSpecMessageId(): string {
    return `spec_msg_${this.nextSpecMessageId++}`;
  }

  private postMessageToSpecWorker<T>(message: WorkerMessage<T>): Promise<any> {
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

  public async initializeSpectrogramWorker(options: {
    sampleRate: number;
    fftSize?: number;
    hopLength?: number;
  }): Promise<void> {
    if (get(this.spectrogramInitialized)) {
      console.warn("Spectrogram worker already initialized.");
      return;
    }

    this.spectrogramWorker = new SpectrogramWorker();
    analysisStore.update((s) => ({
      ...s,
      spectrogramStatus: "Spectrogram worker initializing...",
    }));

    this.spectrogramWorker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const { type, payload, error, messageId } = event.data;
      const request = messageId
        ? this.pendingSpecRequests.get(messageId)
        : undefined;

      if (error) {
        console.error(`Spectrogram Worker Error (type ${type}):`, error);
        analysisStore.update((s) => ({
          ...s,
          spectrogramError: `Worker error: ${error}`,
        }));
        if (request) {
          request.reject(error);
          this.pendingSpecRequests.delete(messageId!);
        }
        if (type === SPEC_WORKER_MSG_TYPE.INIT_ERROR) {
          this.spectrogramInitialized.set(false);
        }
        return;
      }

      switch (type) {
        case SPEC_WORKER_MSG_TYPE.INIT_SUCCESS:
          this.spectrogramInitialized.set(true);
          analysisStore.update((s) => ({
            ...s,
            spectrogramStatus: "Spectrogram worker initialized.",
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
      if (messageId && request) this.pendingSpecRequests.delete(messageId);
    };

    this.spectrogramWorker.onerror = (err) => {
      /* similar to vad worker onerror */
      console.error("Unhandled error in SpectrogramWorker:", err);
      analysisStore.update((s) => ({
        ...s,
        spectrogramError: `Worker onerror: ${err.message}`,
      }));
      this.pendingSpecRequests.forEach((req) =>
        req.reject(new Error("Spectrogram Worker failed critically.")),
      );
      this.pendingSpecRequests.clear();
      this.spectrogramInitialized.set(false);
    };

    const initPayload: SpectrogramInitPayload = {
      // --- ADD origin and fftPath ---
      origin: location.origin,
      fftPath: '../fft.js', // This path is relative from the worker file location in source
      // --- END ADD ---
      sampleRate: options.sampleRate,
      fftSize: options.fftSize || VISUALIZER_CONSTANTS.SPEC_NORMAL_FFT_SIZE,
      hopLength:
        options.hopLength ||
        Math.floor(
          (options.fftSize || VISUALIZER_CONSTANTS.SPEC_NORMAL_FFT_SIZE) / 4,
        ),
    };
    try {
      await this.postMessageToSpecWorker({
        type: SPEC_WORKER_MSG_TYPE.INIT,
        payload: initPayload,
      });
    } catch (e: any) {
      analysisStore.update((s) => ({
        ...s,
        spectrogramError: e.message || "Spectrogram init failed",
      }));
      this.spectrogramInitialized.set(false);
    }
  }

  public async processAudioForSpectrogram(
    audioData: Float32Array,
  ): Promise<SpectrogramResultPayload | null> {
    if (!get(this.spectrogramInitialized))
      throw new Error("Spectrogram worker not initialized.");
    const payload: SpectrogramProcessPayload = { audioData };
    try {
      // This sends the whole audio data at once. For large files, chunking would be better.
      const result = await this.postMessageToSpecWorker({
        type: SPEC_WORKER_MSG_TYPE.PROCESS,
        payload,
      });
      return result as SpectrogramResultPayload;
    } catch (e: any) {
      console.error("Error processing audio for spectrogram:", e);
      analysisStore.update((s) => ({ ...s, spectrogramError: e.message }));
      return null;
    }
  }

  public disposeSpectrogramWorker(): void {
    if (this.spectrogramWorker) {
      this.spectrogramWorker.terminate();
      this.spectrogramWorker = null;
      this.spectrogramInitialized.set(false);
      this.pendingSpecRequests.clear();
      this.nextSpecMessageId = 0; // Reset spec message ID counter
      analysisStore.update((s) => ({
        ...s,
        spectrogramStatus: "Spectrogram worker disposed.",
        spectrogramData: null,
      }));
    }
  }

  public async startSpectrogramProcessing(
    audioBuffer: AudioBuffer,
  ): Promise<void> {
    if (!audioBuffer) {
      console.warn(
        "AnalysisService: No audio buffer provided for spectrogram processing.",
      );
      return;
    }

    if (!get(this.spectrogramInitialized)) {
      analysisStore.update((s) => ({
        ...s,
        spectrogramStatus: "Initializing for new file...",
      }));
      await this.initializeSpectrogramWorker({
        sampleRate: audioBuffer.sampleRate,
        // fftSize and hopLength will use defaults from VISUALIZER_CONSTANTS if not specified
      });
    }

    // Ensure it's initialized after the await above
    if (!get(this.spectrogramInitialized)) {
      console.error(
        "AnalysisService: Spectrogram worker failed to initialize for processing.",
      );
      analysisStore.update((s) => ({
        ...s,
        spectrogramError: "Worker init failed before processing.",
      }));
      return;
    }

    // For simplicity, process the first channel for the spectrogram
    const pcmData = audioBuffer.getChannelData(0);
    if (pcmData && pcmData.length > 0) {
      analysisStore.update((s) => ({
        ...s,
        spectrogramStatus: "Processing audio for spectrogram...",
      }));
      await this.processAudioForSpectrogram(pcmData);
      analysisStore.update((s) => ({
        ...s,
        spectrogramStatus: "Spectrogram processing initiated.",
      }));
    } else {
      console.warn("AnalysisService: No PCM data to process for spectrogram.");
      analysisStore.update((s) => ({
        ...s,
        spectrogramStatus: "No data for spectrogram.",
      }));
    }
  }
}

export default AnalysisService.getInstance();
