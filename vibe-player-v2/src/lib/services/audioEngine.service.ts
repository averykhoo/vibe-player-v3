// vibe-player-v2/src/lib/services/audioEngine.service.ts
import { writable, get } from "svelte/store";
import type {
  WorkerMessage,
  RubberbandInitPayload,
  RubberbandProcessResultPayload,
} from "$lib/types/worker.types";
import { AUDIO_ENGINE_CONSTANTS } from "$lib/utils"; // Assuming AUDIO_ENGINE_CONSTANTS is in utils/index
import { RB_WORKER_MSG_TYPE } from "$lib/types/worker.types";
import { playerStore } from "$lib/stores/player.store"; // Assuming playerStore exists
import analysisService from "$lib/services/analysis.service";

// Import worker using Vite's ?worker syntax
import RubberbandWorker from "$lib/workers/rubberband.worker?worker&inline";

interface AudioEngineState {
  isInitialized: boolean;
  isInitializing: boolean;
  error: string | null;
  audioContext: AudioContext | null;
  // Add other relevant state properties: gainNode, sourceNode, etc.
}

const initialAudioEngineState: AudioEngineState = {
  isInitialized: false,
  isInitializing: false,
  error: null,
  audioContext: null,
};

// Internal store for the service's own state, not directly exposed but can update public stores.
const serviceState = writable<AudioEngineState>(initialAudioEngineState);

class AudioEngineService {
  private static instance: AudioEngineService;
  private worker: Worker | null = null;
  private audioContextInternal: AudioContext | null = null; // Renamed to avoid conflict with serviceState property
  private gainNode: GainNode | null = null;
  private originalAudioBuffer: AudioBuffer | null = null;
  private decodedAudioPlayerNode: AudioBufferSourceNode | null = null; // For playing original/decoded audio
  private isPlaying = writable(false); // Internal state for playback
  private nextMessageId = 0;
  private pendingRequests = new Map<
    string,
    { resolve: (value: any) => void; reject: (reason?: any) => void }
  >();

  private constructor() {
    // Initialize serviceState if needed, or rely on default
  }

  public static getInstance(): AudioEngineService {
    if (!AudioEngineService.instance) {
      AudioEngineService.instance = new AudioEngineService();
    }
    return AudioEngineService.instance;
  }

  private _getAudioContext(): AudioContext {
    if (!this.audioContextInternal) {
      this.audioContextInternal = new AudioContext();
      // Create main gain node
      this.gainNode = this.audioContextInternal.createGain();
      this.gainNode.connect(this.audioContextInternal.destination);
    }
    return this.audioContextInternal;
  }

  public async unlockAudio(): Promise<void> {
    const ctx = this._getAudioContext();
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
        console.log("AudioContext resumed successfully.");
        playerStore.update((s) => ({ ...s, audioContextResumed: true }));
      } catch (e) {
        console.error("Error resuming AudioContext:", e);
        playerStore.update((s) => ({
          ...s,
          error: "Failed to resume audio context.",
        }));
      }
    }
  }

  private generateMessageId(): string {
    return `rb_msg_${this.nextMessageId++}`;
  }

  private postMessageToWorker<T>(message: WorkerMessage<T>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker not initialized."));
        return;
      }
      const messageId = this.generateMessageId();
      this.pendingRequests.set(messageId, { resolve, reject });
      this.worker.postMessage({ ...message, messageId });
    });
  }

  public async initialize(options: {
    sampleRate: number;
    channels: number;
    initialSpeed: number;
    initialPitch: number;
    gain?: number;
  }): Promise<void> {
    if (get(serviceState).isInitialized || get(serviceState).isInitializing) {
      console.warn("AudioEngineService already initialized or initializing.");
      return;
    }

    serviceState.update((s) => ({ ...s, isInitializing: true, error: null }));
    playerStore.update((s) => ({
      ...s,
      status: "Audio engine initializing...",
    }));

    this.worker = new RubberbandWorker();

    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const { type, payload, error, messageId } = event.data;
      const request = messageId
        ? this.pendingRequests.get(messageId)
        : undefined;

      if (error) {
        console.error(`AudioEngineService Worker Error (type ${type}):`, error);
        serviceState.update((s) => ({ ...s, error: `Worker error: ${error}` }));
        if (request) {
          request.reject(error);
          this.pendingRequests.delete(messageId!);
        }
        if (type === RB_WORKER_MSG_TYPE.INIT_ERROR) {
          serviceState.update((s) => ({
            ...s,
            isInitialized: false,
            isInitializing: false,
          }));
          playerStore.update((s) => ({
            ...s,
            status: "Error initializing audio engine.",
          }));
        }
        return;
      }

      switch (type) {
        case RB_WORKER_MSG_TYPE.INIT_SUCCESS:
          serviceState.update((s) => ({
            ...s,
            isInitialized: true,
            isInitializing: false,
          }));
          playerStore.update((s) => ({
            ...s,
            status: "Audio engine initialized.",
          }));
          if (request) request.resolve(payload);
          break;

        case RB_WORKER_MSG_TYPE.PROCESS_RESULT:
          const resultPayload = payload as RubberbandProcessResultPayload;
          // TODO: Handle processed audio - e.g., play it, send to visualizer, update store
          // For now, just log it
          console.log(
            "Received processed audio chunk:",
            resultPayload.outputBuffer,
          );
          playerStore.update((s) => ({
            ...s,
            lastProcessedChunk: resultPayload.outputBuffer,
          }));
          if (request) request.resolve(resultPayload);
          break;

        case RB_WORKER_MSG_TYPE.FLUSH_RESULT:
          console.log("Received flushed audio:", payload);
          if (request) request.resolve(payload);
          break;

        default:
          console.log(
            "AudioEngineService received message from worker:",
            event.data,
          );
          if (request) request.resolve(payload); // Generic resolve for other messages
      }
      if (messageId && request) this.pendingRequests.delete(messageId);
    };

    this.worker.onerror = (err) => {
      console.error("Unhandled error in RubberbandWorker:", err);
      serviceState.update((s) => ({
        ...s,
        error: `Worker onerror: ${err.message}`,
        isInitialized: false,
        isInitializing: false,
      }));
      playerStore.update((s) => ({ ...s, status: "Critical worker error." }));
      // Reject all pending requests on a critical worker error
      this.pendingRequests.forEach((req) =>
        req.reject(new Error("Worker failed critically.")),
      );
      this.pendingRequests.clear();
    };

    const initPayload: RubberbandInitPayload = {
      wasmPath: AUDIO_ENGINE_CONSTANTS.WASM_BINARY_URL, // e.g., '/rubberband.wasm'
      loaderPath: AUDIO_ENGINE_CONSTANTS.LOADER_SCRIPT_URL,
      origin: location.origin,
      sampleRate: options.sampleRate,
      channels: options.channels,
      initialSpeed: options.initialSpeed,
      initialPitch: options.initialPitch,
    };

    try {
      await this.postMessageToWorker({
        type: RB_WORKER_MSG_TYPE.INIT,
        payload: initPayload,
      });
      this._getAudioContext(); // Ensure AudioContext is created after worker init
      if (options.gain !== undefined) this.setGain(options.gain);
    } catch (err: any) {
      serviceState.update((s) => ({
        ...s,
        error: err.message || "Initialization failed",
        isInitialized: false,
        isInitializing: false,
      }));
      playerStore.update((s) => ({
        ...s,
        status: "Error sending init to worker.",
      }));
    }
  }

  // New method: loadFile
  public async loadFile(
    audioFileBuffer: ArrayBuffer,
    fileName: string,
  ): Promise<void> {
    if (!this.audioContextInternal) {
      this._getAudioContext(); // Ensure AudioContext exists
      await this.unlockAudio(); // And try to resume it
    }
    if (!this.audioContextInternal) {
      playerStore.update((s) => ({
        ...s,
        error: "AudioContext not available for decoding.",
      }));
      throw new Error("AudioContext not available for decoding.");
    }

    playerStore.update((s) => ({
      ...s,
      status: `Decoding ${fileName}...`,
      error: null,
      fileName,
    }));
    try {
      this.originalAudioBuffer =
        await this.audioContextInternal.decodeAudioData(audioFileBuffer);

      // --- BEGIN NEW WAVEFORM EXTRACTION ---
      let waveformDisplayData: number[][] = [];
      if (this.originalAudioBuffer) {
        const targetPoints = 1000; // Or make configurable
        for (let i = 0; i < this.originalAudioBuffer.numberOfChannels; i++) {
          const pcmData = this.originalAudioBuffer.getChannelData(i);
          const channelWaveform: number[] = [];
          const step = Math.max(1, Math.floor(pcmData.length / targetPoints));
          for (let j = 0; j < pcmData.length; j += step) {
            // Simple approach: take the sample value directly (max value in block is better for peaks)
            // More advanced: find min/max in the block [j, j+step-1]
            let blockMax = -1.0;
            for (let k = 0; k < step && j + k < pcmData.length; k++) {
              if (Math.abs(pcmData[j + k]) > blockMax) {
                blockMax = Math.abs(pcmData[j + k]);
              }
            }
            // For simplicity, let's just push the first sample of the block, scaled by its sign for drawing
            // A better approach is to push a value that represents the envelope (e.g. max absolute value)
            channelWaveform.push(pcmData[j]);
            // Or, to show positive/negative envelope:
            // let min = pcmData[j];
            // let max = pcmData[j];
            // for (let k = 1; k < step && (j + k) < pcmData.length; k++) {
            //     if (pcmData[j + k] < min) min = pcmData[j + k];
            //     if (pcmData[j + k] > max) max = pcmData[j + k];
            // }
            // channelWaveform.push(min);
            // channelWaveform.push(max);
          }
          waveformDisplayData.push(channelWaveform);
        }
      }
      // --- END NEW WAVEFORM EXTRACTION ---

      playerStore.update((s) => ({
        ...s,
        status: `${fileName} decoded. Duration: ${this.originalAudioBuffer.duration.toFixed(2)}s`,
        duration: this.originalAudioBuffer.duration,
        channels: this.originalAudioBuffer.numberOfChannels,
        sampleRate: this.originalAudioBuffer.sampleRate,
        waveformData: waveformDisplayData, // Add waveform data to store
        isPlayable: true,
        audioBuffer: this.originalAudioBuffer, // Key addition
      }));
      console.log(
        "Decoded audio and extracted waveform data:",
        this.originalAudioBuffer,
      );

      // --- BEGIN NEW: Trigger Spectrogram Processing ---
      // --- END NEW: Trigger Spectrogram Processing ---

      // Auto-initialize worker if sample rate or channels change, or if not initialized
      // This is a basic example; robust logic would compare with current worker settings
      // Ensure options are available or passed if needed for re-initialization
      // For example, if your initialize method signature needs specific options:
      // const currentSpeed = get(playerStore).speed || 1.0;
      // const currentPitch = get(playerStore).pitch || 0.0;
      // if (!get(serviceState).isInitialized /* || check against current worker settings */) {
      //     await this.initialize({
      //        sampleRate: this.originalAudioBuffer.sampleRate,
      //        channels: this.originalAudioBuffer.numberOfChannels,
      //        initialSpeed: currentSpeed,
      //        initialPitch: currentPitch
      //     });
      // }
      console.warn(
        "AudioEngine not re-initialized with new file parameters automatically yet. Manual re-init might be needed if SR/channels change.",
      );
    } catch (e: any) {
      console.error("Error decoding audio data:", e);
      playerStore.update((s) => ({
        ...s,
        status: `Error decoding ${fileName}.`,
        error: e.message,
        isPlayable: false,
        waveformData: undefined,
      })); // Clear waveform data on error
      throw e;
    }
  }

  // New method: setGain
  public setGain(level: number): void {
    if (this.gainNode) {
      this.gainNode.gain.setValueAtTime(
        level,
        this.audioContextInternal?.currentTime || 0,
      );
      playerStore.update((s) => ({ ...s, gain: level }));
    }
  }

  // New method stubs: play, pause, stop
  public play(): void {
    if (this.isPlaying && get(this.isPlaying)) {
      console.log("AudioEngine: Already playing.");
      return;
    }
    // For now, let's try to play the original decoded buffer
    if (
      this.originalAudioBuffer &&
      this.audioContextInternal &&
      this.gainNode
    ) {
      // Stop any existing player node
      if (this.decodedAudioPlayerNode) {
        this.decodedAudioPlayerNode.stop();
        this.decodedAudioPlayerNode.disconnect();
      }

      this.decodedAudioPlayerNode =
        this.audioContextInternal.createBufferSource();
      this.decodedAudioPlayerNode.buffer = this.originalAudioBuffer;
      this.decodedAudioPlayerNode.connect(this.gainNode);
      this.decodedAudioPlayerNode.onended = () => {
        this.isPlaying.set(false);
        playerStore.update((s) => ({
          ...s,
          status: "Playback ended.",
          isPlaying: false,
        }));
        this.decodedAudioPlayerNode = null; // Clear the node
      };
      this.decodedAudioPlayerNode.start(0, get(playerStore).currentTime || 0); // Start from current time or 0
      this.isPlaying.set(true);
      playerStore.update((s) => ({
        ...s,
        status: "Playing original audio...",
        isPlaying: true,
      }));
      console.log("AudioEngine: Play called. Playing original buffer.");
    } else {
      playerStore.update((s) => ({
        ...s,
        status: "No audio loaded or engine not ready.",
        error: "Cannot play: No audio loaded.",
      }));
      console.log(
        "AudioEngine: Play called, but no original audio buffer or audio context.",
      );
    }
  }

  public pause(): void {
    if (!get(this.isPlaying)) {
      console.log("AudioEngine: Not playing.");
      return;
    }
    if (this.decodedAudioPlayerNode && this.audioContextInternal) {
      // Store current time before stopping
      // This is tricky with AudioBufferSourceNode as it can't truly "pause"
      // We effectively stop it and will restart from a stored currentTime.
      // A more complex setup would involve a ScriptProcessorNode or AudioWorklet for custom playback control.
      // FIXME: This currentTime is context time, not buffer position. Needs proper calculation.
      const currentTime =
        this.audioContextInternal.currentTime -
          (this.decodedAudioPlayerNode as any)._startTime || 0;

      playerStore.update((s) => ({
        ...s,
        currentTime: currentTime >= 0 ? currentTime : 0,
      }));
      this.decodedAudioPlayerNode.stop();
      // this.decodedAudioPlayerNode = null; // Don't nullify here if we want to "resume" by creating a new one
      this.isPlaying.set(false);
      playerStore.update((s) => ({
        ...s,
        status: "Playback paused.",
        isPlaying: false,
      }));
      console.log("AudioEngine: Pause called.");
    } else {
      console.log("AudioEngine: Pause called, but no active player node.");
    }
  }

  public stop(): void {
    if (this.decodedAudioPlayerNode) {
      this.decodedAudioPlayerNode.stop();
      this.decodedAudioPlayerNode.disconnect();
      this.decodedAudioPlayerNode = null;
    }
    this.isPlaying.set(false);
    playerStore.update((s) => ({
      ...s,
      status: "Playback stopped.",
      isPlaying: false,
      currentTime: 0,
    }));
    console.log("AudioEngine: Stop called.");
  }

  public async setSpeed(speed: number): Promise<void> {
    if (!get(serviceState).isInitialized || !this.worker)
      throw new Error("Service not initialized.");
    await this.postMessageToWorker({
      type: RB_WORKER_MSG_TYPE.SET_SPEED,
      payload: { speed },
    });
    playerStore.update((s) => ({ ...s, speed }));
  }

  public async setPitch(pitch: number): Promise<void> {
    if (!get(serviceState).isInitialized || !this.worker)
      throw new Error("Service not initialized.");
    await this.postMessageToWorker({
      type: RB_WORKER_MSG_TYPE.SET_PITCH,
      payload: { pitch },
    });
    playerStore.update((s) => ({ ...s, pitch }));
  }

  public async processAudioChunk(
    inputBuffer: Float32Array[],
  ): Promise<RubberbandProcessResultPayload | null> {
    if (!get(serviceState).isInitialized || !this.worker)
      throw new Error("Service not initialized.");
    try {
      const result = await this.postMessageToWorker({
        type: RB_WORKER_MSG_TYPE.PROCESS,
        payload: { inputBuffer },
      });
      return result as RubberbandProcessResultPayload;
    } catch (error) {
      console.error("Error processing audio chunk:", error);
      playerStore.update((s) => ({ ...s, error: "Error processing audio" }));
      return null;
    }
  }

  public async flush(): Promise<RubberbandProcessResultPayload | null> {
    if (!get(serviceState).isInitialized || !this.worker)
      throw new Error("Service not initialized.");
    try {
      const result = await this.postMessageToWorker({
        type: RB_WORKER_MSG_TYPE.FLUSH,
      });
      return result as RubberbandProcessResultPayload;
    } catch (error) {
      console.error("Error flushing audio:", error);
      playerStore.update((s) => ({ ...s, error: "Error flushing audio" }));
      return null;
    }
  }

  // Basic playback example - more sophisticated playback needed for real app
  public playAudioBuffer(buffer: Float32Array[], sampleRate: number) {
    const ctx = this._getAudioContext();
    if (!this.gainNode) {
      console.error("GainNode not initialized!");
      return;
    }

    const audioBuffer = ctx.createBuffer(
      buffer.length,
      buffer[0].length,
      sampleRate,
    );
    for (let i = 0; i < buffer.length; i++) {
      audioBuffer.copyToChannel(buffer[i], i);
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.gainNode); // Connect to the main gain node
    source.start();
  }

  public dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.audioContextInternal) {
      this.audioContextInternal.close().then(() => {
        this.audioContextInternal = null;
        this.gainNode = null;
      });
    }
    this.pendingRequests.clear();
    this.nextMessageId = 0; // Reset message ID counter
    serviceState.set(initialAudioEngineState); // Reset service state
    playerStore.update((s) => ({
      ...s,
      status: "Audio engine disposed.",
      isInitialized: false,
    }));
    console.log("AudioEngineService disposed.");
  }
}

export default AudioEngineService.getInstance();
