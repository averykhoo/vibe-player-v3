// vibe-player-v2.3/src/lib/services/audioEngine.service.ts
import { get } from "svelte/store";
import { playerStore } from "$lib/stores/player.store";
import { timeStore } from "$lib/stores/time.store"; // NEW
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
import { AudioOrchestrator } from "./AudioOrchestrator.service"; // NEW

class AudioEngineService {
  private static instance: AudioEngineService;

  private worker: Worker | null = null;
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private originalBuffer: AudioBuffer | null = null;

  private isPlaying = false;
  private isWorkerReady = false;
  private isStopping = false;

  private sourcePlaybackOffset = 0;

  private workerInitPromiseCallbacks: {
    resolve: () => void;
    reject: (reason?: any) => void;
  } | null = null;

  private constructor() {
    // ADD THIS LOG
    console.log(
      `[LOG-VIBE-341] AudioEngineService CONSTRUCTOR called. A new instance is being created.`,
    );
  }

  public static getInstance(): AudioEngineService {
    if (!AudioEngineService.instance) {
      AudioEngineService.instance = new AudioEngineService();
    }
    // ADD THIS LOG
    console.log(`[LOG-VIBE-341] AudioEngineService.getInstance() called.`);
    return AudioEngineService.instance;
  }

  public unlockAudio = async (): Promise<void> => {
    const ctx = this._getAudioContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
  };

  public togglePlayPause = (): void => {
    // ADD THIS LOG
    console.log(
      `[LOG-VIBE-341] audioEngine.togglePlayPause() entered. isPlaying=${this.isPlaying}`,
    );
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  };

  /**
   * Decodes an ArrayBuffer into an AudioBuffer. This is its only responsibility.
   * @param buffer The ArrayBuffer containing the audio data.
   * @returns A promise that resolves with the decoded AudioBuffer.
   */
  public async decodeAudioData(buffer: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this._getAudioContext();
    try {
      this.originalBuffer = await ctx.decodeAudioData(buffer);
      this.isWorkerReady = false; // Worker needs re-initialization with new buffer
      return this.originalBuffer;
    } catch (e) {
      this.originalBuffer = null;
      this.isWorkerReady = false;
      throw e;
    }
  }

  /**
   * Initializes the Rubberband Web Worker.
   * @param audioBuffer The AudioBuffer to initialize the worker with.
   * @returns A promise that resolves on successful worker initialization.
   */
  public initializeWorker = (audioBuffer: AudioBuffer): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!audioBuffer) {
        // It's important to clear callbacks if an early error occurs.
        this.workerInitPromiseCallbacks = null;
        return reject(
          new Error("initializeWorker called with no AudioBuffer."),
        );
      }
      this.workerInitPromiseCallbacks = { resolve, reject };

      if (this.worker) this.worker.terminate();
      this.worker = new RubberbandWorker();
      this.worker.onmessage = this.handleWorkerMessage;
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
        // Communicate error to Orchestrator
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
          // Communicate error to Orchestrator
          AudioOrchestrator.getInstance().handleError(e);
        });
    });
  };

  public play = async (): Promise<void> => {
    if (this.isPlaying || !this.originalBuffer || !this.isWorkerReady) {
      return;
    }

    await this.unlockAudio();
    this.isPlaying = true;
    playerStore.update((s) => ({ ...s, isPlaying: true, error: null }));

    // Kick off the deterministic loop by processing the FIRST chunk.
    // The loop will perpetuate itself from here.
    this._performSingleProcessAndPlayIteration();
  };

  public pause = (): void => {
    if (!this.isPlaying) return;

    // Simply flipping this flag will break the loop when the next
    // result comes back from the worker. No timers to clear.
    this.isPlaying = false;
    playerStore.update((s) => ({ ...s, isPlaying: false }));
  };

  public stop = async (): Promise<void> => {
    this.isStopping = true; // Signal that a stop operation is in progress
    this.pause(); // This will cancel animationFrame and set isPlaying to false

    if (this.worker && this.isWorkerReady) {
      this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });
    }

    this.sourcePlaybackOffset = 0;
    // this.nextChunkTime = 0; // nextChunkTime removed
    timeStore.set(0); // Reset time store to 0
    playerStore.update((s) => ({ ...s, currentTime: 0, isPlaying: false }));

    // Short delay to allow any in-flight operations to cease
    // This might need adjustment or a more robust mechanism if race conditions persist
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.isStopping = false;
  };

  public seek = (time: number): void => {
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
  };

  public setSpeed = (speed: number): void => {
    if (this.worker && this.isWorkerReady) {
      this.worker.postMessage({
        type: RB_WORKER_MSG_TYPE.SET_SPEED,
        payload: { speed },
      });
    }
    playerStore.update((s) => ({ ...s, speed }));
  };

  public setPitch = (pitch: number): void => {
    if (this.worker && this.isWorkerReady) {
      this.worker.postMessage({
        type: RB_WORKER_MSG_TYPE.SET_PITCH,
        payload: { pitch },
      });
    }
    playerStore.update((s) => ({ ...s, pitchShift: pitch }));
  };

  public setGain = (level: number): void => {
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
  };

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
    if (!this.worker || !this.isWorkerReady || !this.originalBuffer) return;

    // Check if we have processed the entire source buffer.
    if (this.sourcePlaybackOffset >= this.originalBuffer.duration) {
      if (this.isPlaying) this.pause(); // All done, pause playback.
      return;
    }

    // This is the core logic: send a fixed-size chunk to the worker.
    const frameSize = AUDIO_ENGINE_CONSTANTS.PROCESS_FRAME_SIZE;
    const startSample = Math.floor(
      this.sourcePlaybackOffset * this.originalBuffer.sampleRate,
    );

    // Ensure we don't read past the end of the buffer.
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
    const currentGain = get(playerStore).gain; // <-- ADD THIS LINE

    for (let i = 0; i < numChannels; i++) {
      const segment = this.originalBuffer
        .getChannelData(i)
        .subarray(startSample, endSample);

      // --- START: NEW GAIN APPLICATION LOGIC ---
      if (currentGain !== 1.0) {
        // Only process if gain is not neutral
        for (let j = 0; j < segment.length; j++) {
          segment[j] *= currentGain;
        }
      }
      // --- END: NEW GAIN APPLICATION LOGIC ---

      inputBuffer.push(segment);
      transferableObjects.push(segment.buffer);
    }

    const isLastChunk = endSample >= this.originalBuffer.length;

    // Immediately advance the source offset. The engine is now self-driven.
    this.sourcePlaybackOffset += chunkSamples / this.originalBuffer.sampleRate;

    // Update the UI with the latest time. This was moved to handleWorkerMessage
    // timeStore.set(this.sourcePlaybackOffset);

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
    source.start(this.audioContext.currentTime); // Play immediately
  }

  private handleWorkerMessage = (
    event: MessageEvent<WorkerMessage<any>>,
  ): void => {
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

        // --- START: NEW LOGIC ---
        // If we are stopping or paused, discard the result and break the loop.
        if (this.isStopping || !this.isPlaying) break;

        // Schedule the chunk we just received for immediate playback.
        if (
          result.outputBuffer?.length > 0 &&
          result.outputBuffer[0].length > 0
        ) {
          this.scheduleChunkPlayback(result.outputBuffer);
        }

        // Update the UI with the latest time.
        timeStore.set(this.sourcePlaybackOffset);

        // Immediately process the next chunk. This self-perpetuates the loop.
        this._performSingleProcessAndPlayIteration();
        // --- END: NEW LOGIC ---
        break;
      case RB_WORKER_MSG_TYPE.ERROR:
        const workerErrorMsg =
          (payload as WorkerErrorPayload)?.message || "Unknown worker error";
        console.error("[AudioEngineService] Worker error:", workerErrorMsg);
        AudioOrchestrator.getInstance().handleError(new Error(workerErrorMsg));
        // Optionally, pause or stop playback here.
        this.pause(); // Good practice to pause on worker error
        break;
      default:
        console.warn("[AudioEngineService] Unknown worker message type:", type);
    }
  };

  public async dispose(): Promise<void> {
    // Made async
    await this.stop(); // Ensure playback is stopped and resources are potentially released by stop()
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.audioContext && this.audioContext.state !== "closed") {
      try {
        await this.audioContext.close(); // Await closing
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
    // this.nextChunkTime = 0; // nextChunkTime removed
    // animationFrameId was removed, so no need to check or cancel it here.
    console.log("[AudioEngineService] Disposed");
  }
}

export default AudioEngineService.getInstance();
