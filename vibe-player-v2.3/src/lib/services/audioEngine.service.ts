// vibe-player-v2.3/src/lib/services/audioEngine.service.ts
import { get } from "svelte/store";
import { playerStore } from "$lib/stores/player.store";
import { timeStore } from "$lib/stores/time.store";
import RubberbandWorker from "$lib/workers/rubberband.worker?worker&inline";
import type {
  RubberbandInitPayload,
  RubberbandProcessPayload,
  RubberbandProcessResultPayload,
  WorkerErrorPayload,
  WorkerMessage,
} from "$lib/types/worker.types";
import { RB_WORKER_MSG_TYPE } from "$lib/types/worker.types";
import { assert, AUDIO_ENGINE_CONSTANTS } from "$lib/utils";
import { AudioOrchestrator } from "./AudioOrchestrator.service";

class AudioEngineService {
  private static instance: AudioEngineService;
  public readonly instanceId: number;

  private worker: Worker | null = null;
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private originalBuffer: AudioBuffer | null = null;

  private isPlaying = false;
  private isWorkerReady = false;
  private isStopping = false;

  private sourcePlaybackOffset = 0;

  // --- START: ADDED FOR DIAGNOSTICS ---
  // private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  // private loopCounter = 0;
  // --- END: ADDED FOR DIAGNOSTICS ---

  private workerInitPromiseCallbacks: {
    resolve: () => void;
    reject: (reason?: any) => void;
  } | null = null;

  private constructor() {
    this.instanceId = Math.floor(Math.random() * 10000);
  }

  public static getInstance(): AudioEngineService {
    if (!AudioEngineService.instance) {
      AudioEngineService.instance = new AudioEngineService();
    }
    return AudioEngineService.instance;
  }

  public async unlockAudio(): Promise<void> {
    const ctx = this._getAudioContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
  }

  public togglePlayPause(): void {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  public async decodeAudioData(buffer: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this._getAudioContext();
    try {
      this.originalBuffer = await ctx.decodeAudioData(buffer);
      this.isWorkerReady = false;
      return this.originalBuffer;
    } catch (e) {
      this.originalBuffer = null;
      this.isWorkerReady = false;
      throw e;
    }
  }

  public initializeWorker(audioBuffer: AudioBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!audioBuffer) {
        this.workerInitPromiseCallbacks = null;
        return reject(
          new Error("initializeWorker called with no AudioBuffer."),
        );
      }
      this.workerInitPromiseCallbacks = { resolve, reject };

      if (this.worker) this.worker.terminate();
      this.worker = new RubberbandWorker();

      this.worker.onmessage = this.handleWorkerMessage.bind(this);

      this.worker.onerror = (err: ErrorEvent) => {
        const errorMsg =
          "Worker crashed or encountered an unrecoverable error.";
        console.error("[AudioEngineService] Worker onerror:", err);
        if (this.workerInitPromiseCallbacks) {
          this.workerInitPromiseCallbacks.reject(
            new Error(err.message || errorMsg),
          );
          this.workerInitPromiseCallbacks = null;
        }
        AudioOrchestrator.getInstance().handleError(
          new Error(err.message || errorMsg),
        );
      };

      this.isWorkerReady = false;

      Promise.all([
        fetch(AUDIO_ENGINE_CONSTANTS.WASM_BINARY_URL),
        fetch(AUDIO_ENGINE_CONSTANTS.LOADER_SCRIPT_URL),
      ])
        .then(async ([wasmResponse, loaderResponse]) => {
          if (!wasmResponse.ok || !loaderResponse.ok) {
            throw new Error(
              `Failed to fetch worker dependencies. WASM: ${wasmResponse.status}, Loader: ${loaderResponse.status}`,
            );
          }
          const wasmBinary = await wasmResponse.arrayBuffer();
          const loaderScriptText = await loaderResponse.text();
          const { speed, pitchShift } = get(playerStore);

          const initPayload: RubberbandInitPayload = {
            wasmBinary,
            loaderScriptText,
            origin: location.origin,
            sampleRate: audioBuffer.sampleRate,
            channels: audioBuffer.numberOfChannels,
            initialSpeed: speed,
            initialPitch: pitchShift,
          };
          assert(this.worker, "Worker should exist at this point");
          this.worker.postMessage(
            { type: RB_WORKER_MSG_TYPE.INIT, payload: initPayload },
            [wasmBinary],
          );
        })
        .catch((e) => {
          if (this.workerInitPromiseCallbacks) {
            this.workerInitPromiseCallbacks.reject(e);
            this.workerInitPromiseCallbacks = null;
          }
          AudioOrchestrator.getInstance().handleError(e);
        });
    });
  }

  public async play(): Promise<void> {
    if (this.isPlaying || !this.originalBuffer || !this.isWorkerReady) {
      return;
    }

    await this.unlockAudio();
    this.isPlaying = true;
    playerStore.update((s) => ({ ...s, isPlaying: true, error: null }));

    // --- START: ADDED FOR DIAGNOSTICS ---
    // this.loopCounter = 0;
    // this.heartbeatInterval = setInterval(() => {
    //   console.log(
    //     `[HEARTBEAT] Main thread is alive. Timestamp: ${performance.now().toFixed(0)}`,
    //   );
    // }, 250);
    // --- END: ADDED FOR DIAGNOSTICS ---

    this._performSingleProcessAndPlayIteration();
  }

  public pause(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    playerStore.update((s) => ({ ...s, isPlaying: false }));

    // --- START: ADDED FOR DIAGNOSTICS ---
    // if (this.heartbeatInterval) {
    //   clearInterval(this.heartbeatInterval);
    //   this.heartbeatInterval = null;
    //   console.log("[HEARTBEAT] Heartbeat timer cleared.");
    // }
    // --- END: ADDED FOR DIAGNOSTICS ---
  }

  public async stop(): Promise<void> {
    this.isStopping = true;
    this.pause();

    if (this.worker && this.isWorkerReady) {
      this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });
    }

    this.sourcePlaybackOffset = 0;
    timeStore.set(0);
    playerStore.update((s) => ({ ...s, currentTime: 0, isPlaying: false }));

    await new Promise((resolve) => setTimeout(resolve, 50));
    this.isStopping = false;
  }

  public seek(time: number): void {
    if (!this.originalBuffer) {
      console.warn("Seek called without an originalBuffer.");
      return;
    }
    if (this.isPlaying) {
      this.pause();
    }
    const clampedTime = Math.max(
      0,
      Math.min(time, this.originalBuffer.duration),
    );
    this.sourcePlaybackOffset = clampedTime;
    if (this.worker && this.isWorkerReady) {
      this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });
    }
    timeStore.set(clampedTime);
    playerStore.update((s) => ({ ...s, currentTime: clampedTime }));
  }

  public setSpeed(speed: number): void {
    if (this.worker && this.isWorkerReady) {
      this.worker.postMessage({
        type: RB_WORKER_MSG_TYPE.SET_SPEED,
        payload: { speed },
      });
    }
    playerStore.update((s) => ({ ...s, speed }));
  }

  public setPitch(pitch: number): void {
    if (this.worker && this.isWorkerReady) {
      this.worker.postMessage({
        type: RB_WORKER_MSG_TYPE.SET_PITCH,
        payload: { pitch },
      });
    }
    playerStore.update((s) => ({ ...s, pitchShift: pitch }));
  }

  public setGain(level: number): void {
    const newGain = Math.max(
      0,
      Math.min(AUDIO_ENGINE_CONSTANTS.MAX_GAIN, level),
    );
    if (this.gainNode) {
      this.gainNode.gain.setValueAtTime(
        newGain,
        this._getAudioContext().currentTime,
      );
    }
    playerStore.update((s) => ({ ...s, gain: newGain }));
  }

  private _getAudioContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === "closed") {
      this.audioContext = new AudioContext();
      this.gainNode = this.audioContext.createGain();
      this.gainNode.connect(this.audioContext.destination);
      playerStore.update((s) => ({
        ...s,
        audioContextResumed: this.audioContext!.state === "running",
      }));
    }
    return this.audioContext;
  }

  private _performSingleProcessAndPlayIteration(): void {
    // --- START: ADDED FOR DIAGNOSTICS ---
    // this.loopCounter++;
    // console.log(
    //   `[LOOP-TRACE] Iteration #${this.loopCounter}: Posting chunk. Offset: ${this.sourcePlaybackOffset.toFixed(3)}s`,
    // );
    // --- END: ADDED FOR DIAGNOSTICS ---

    if (!this.worker || !this.isWorkerReady || !this.originalBuffer) return;
    if (this.sourcePlaybackOffset >= this.originalBuffer.duration) {
      if (this.isPlaying) this.pause();
      return;
    }

    const frameSize = AUDIO_ENGINE_CONSTANTS.PROCESS_FRAME_SIZE;
    const startSample = Math.floor(
      this.sourcePlaybackOffset * this.originalBuffer.sampleRate,
    );
    const endSample = Math.min(
      startSample + frameSize,
      this.originalBuffer.length,
    );
    const chunkSamples = endSample - startSample;

    if (chunkSamples <= 0) {
      if (this.isPlaying) this.pause();
      return;
    }

    const numChannels = this.originalBuffer.numberOfChannels;
    const inputBuffer: Float32Array[] = [];
    const transferableObjects: Transferable[] = [];
    const currentGain = get(playerStore).gain;

    for (let i = 0; i < numChannels; i++) {
      // --- THE FIX IS HERE ---
      // .slice() creates a true copy of the data with its own underlying ArrayBuffer.
      // .subarray() created a "view" on the same original buffer, which caused the
      // original buffer to be detached and made inaccessible after the first transfer.
      const segment = this.originalBuffer
        .getChannelData(i)
        .slice(startSample, endSample);
      // --- END OF FIX ---

      if (currentGain !== 1.0) {
        for (let j = 0; j < segment.length; j++) {
          segment[j] *= currentGain;
        }
      }
      inputBuffer.push(segment);
      transferableObjects.push(segment.buffer);
    }

    const isLastChunk = endSample >= this.originalBuffer.length;
    this.sourcePlaybackOffset += chunkSamples / this.originalBuffer.sampleRate;
    const processPayload: RubberbandProcessPayload = {
      inputBuffer,
      isLastChunk,
    };
    this.worker.postMessage(
      { type: RB_WORKER_MSG_TYPE.PROCESS, payload: processPayload },
      transferableObjects,
    );
  }

  private scheduleChunkPlayback(channelData: Float32Array[]): void {
    if (!this.audioContext || !this.gainNode || this.isStopping) return;
    const frameCount = channelData[0]?.length;
    if (!frameCount) return;
    const chunkBuffer = this.audioContext.createBuffer(
      channelData.length,
      frameCount,
      this.audioContext.sampleRate,
    );
    for (let i = 0; i < channelData.length; i++) {
      chunkBuffer.copyToChannel(channelData[i], i);
    }
    const source = this.audioContext.createBufferSource();
    source.buffer = chunkBuffer;
    source.connect(this.gainNode);
    source.start(this.audioContext.currentTime);
  }

  private handleWorkerMessage = (
    event: MessageEvent<WorkerMessage<any>>,
  ): void => {
    // --- START: ADDED FOR DIAGNOSTICS ---
    // console.log(
    //   `[LOOP-TRACE] Iteration #${this.loopCounter}: Message received from worker. Type: ${event.data.type}`,
    // );
    // --- END: ADDED FOR DIAGNOSTICS ---

    const { type, payload } = event.data;

    switch (type) {
      case RB_WORKER_MSG_TYPE.INIT_SUCCESS:
        this.isWorkerReady = true;
        if (this.workerInitPromiseCallbacks) {
          this.workerInitPromiseCallbacks.resolve();
          this.workerInitPromiseCallbacks = null;
        }
        break;
      case RB_WORKER_MSG_TYPE.INIT_ERROR:
        this.isWorkerReady = false;
        const initErrorMsg = payload?.message || "Worker initialization failed";
        if (this.workerInitPromiseCallbacks) {
          this.workerInitPromiseCallbacks.reject(new Error(initErrorMsg));
          this.workerInitPromiseCallbacks = null;
        }
        AudioOrchestrator.getInstance().handleError(new Error(initErrorMsg));
        break;
      case RB_WORKER_MSG_TYPE.PROCESS_RESULT:
        const result = payload as RubberbandProcessResultPayload;
        if (this.isStopping || !this.isPlaying) break;
        if (
          result.outputBuffer?.length > 0 &&
          result.outputBuffer[0].length > 0
        ) {
          this.scheduleChunkPlayback(result.outputBuffer);
        }
        timeStore.set(this.sourcePlaybackOffset);
        this._performSingleProcessAndPlayIteration();
        break;
      case RB_WORKER_MSG_TYPE.ERROR:
        const workerErrorMsg =
          (payload as WorkerErrorPayload)?.message || "Unknown worker error";
        console.error("[AudioEngineService] Worker error:", workerErrorMsg);
        AudioOrchestrator.getInstance().handleError(new Error(workerErrorMsg));
        this.pause();
        break;
      default:
        console.warn("[AudioEngineService] Unknown worker message type:", type);
    }
  };

  public async dispose(): Promise<void> {
    await this.stop();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.audioContext && this.audioContext.state !== "closed") {
      try {
        await this.audioContext.close();
      } catch (e) {
        console.error("Error closing audio context:", e);
      } finally {
        this.audioContext = null;
        this.gainNode = null;
      }
    } else {
      this.audioContext = null;
      this.gainNode = null;
    }
    this.originalBuffer = null;
    this.isWorkerReady = false;
    this.isPlaying = false;
    this.sourcePlaybackOffset = 0;

    // --- START: ADDED FOR DIAGNOSTICS ---
    // if (this.heartbeatInterval) {
    //   clearInterval(this.heartbeatInterval);
    //   this.heartbeatInterval = null;
    // }
    // --- END: ADDED FOR DIAGNOSTICS ---

    console.log("[AudioEngineService] Disposed");
  }
}

export default AudioEngineService.getInstance();
