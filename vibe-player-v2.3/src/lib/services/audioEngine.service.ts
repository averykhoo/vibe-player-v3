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
  private animationFrameId: number | null = null;

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
      console.log(
        `[AudioEngineService.unlockAudio] Context is suspended. Calling resume(). Current time: ${ctx.currentTime.toFixed(3)}`,
      );
      try {
        await ctx.resume(); // This await is internal to unlockAudio's own logic
        console.log(
          `[AudioEngineService.unlockAudio] resume() promise resolved. Context state: ${ctx.state}. Current time: ${ctx.currentTime.toFixed(3)}`,
        );
      } catch (err) {
        console.error(
          `[AudioEngineService.unlockAudio] Error during ctx.resume():`,
          err,
        );
        // Update store with error, but do not re-throw if callers are not awaiting unlockAudio directly.
        playerStore.update((s) => ({
          ...s,
          error: `AudioContext resume failed: ${(err as Error).message}`,
          audioContextResumed: false,
        }));
        // If resume failed, the error is set and we should not proceed to clear it.
        return;
      }
    } else {
      console.log(
        `[AudioEngineService.unlockAudio] Context already in state: ${ctx.state}. Current time: ${ctx.currentTime.toFixed(3)}`,
      );
    }
    // Always update the store with the potentially new state AFTER resume attempt or if it was already running
    // If we've reached here, it means resume() either succeeded or wasn't needed (already running).
    // In either successful case, we clear any pre-existing error.
    const isNowRunning = ctx.state === "running";
    playerStore.update((s) => ({
      ...s,
      audioContextResumed: isNowRunning,
      error: null,
    }));

    if (
      isNowRunning &&
      ctx.state !== "suspended" &&
      !get(playerStore).audioContextResumed
    ) {
      // This log helps if the store was out of sync and context was already running.
      console.log(
        "[AudioEngineService.unlockAudio] Context was already running or just resumed successfully.",
      );
    } else if (
      ctx.state === "suspended" &&
      get(playerStore).audioContextResumed
    ) {
      // This indicates a potential issue or race condition if the store thought it was resumed but context is suspended.
      console.warn(
        "[AudioEngineService.unlockAudio] Warning: Store indicated resumed, but context is suspended.",
      );
    }
  }

  public togglePlayPause(): void {
    console.log(
      `[AudioEngineService.togglePlayPause] Called. Current internal this.isPlaying: ${this.isPlaying}`,
    );
    if (this.isPlaying) {
      console.log(
        `[AudioEngineService.togglePlayPause] Condition 'this.isPlaying' is true. Calling pause().`,
      );
      this.pause();
    } else {
      console.log(
        `[AudioEngineService.togglePlayPause] Condition 'this.isPlaying' is false. Calling play().`,
      );
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
    console.log(
      `[AudioEngineService.play ENTRY] Current internal this.isPlaying: ${this.isPlaying}, isWorkerReady: ${this.isWorkerReady}, originalBuffer exists: ${!!this.originalBuffer}`,
    );
    if (this.isPlaying || !this.originalBuffer || !this.isWorkerReady) {
      console.log(
        `[AudioEngineService.play] PRE-CONDITION FAIL: Returning early. this.isPlaying=${this.isPlaying}, originalBuffer=${!!this.originalBuffer}, isWorkerReady=${this.isWorkerReady}`,
      );
      return;
    }

    // await this.unlockAudio(); // Old awaited call
    this.unlockAudio(); // Make NON-AWAITED (fire and forget)
    console.log(
      `[AudioEngineService.play] unlockAudio attempt initiated (not awaited).`,
    );
    this.isPlaying = true;
    console.log(
      `[AudioEngineService.play] SET internal this.isPlaying = true.`,
    );
    playerStore.update((s) => {
      console.log(
        `[AudioEngineService.play] playerStore.update: Setting isPlaying to true. Previous store state s.isPlaying: ${s.isPlaying}`,
      );
      return { ...s, isPlaying: true, error: null };
    });
    console.log(
      `[AudioEngineService.play] playerStore.update call completed. Current $playerStore.isPlaying (via get): ${get(playerStore).isPlaying}`,
    );

    // --- START: ADDED FOR DIAGNOSTICS ---
    // this.loopCounter = 0;
    // this.heartbeatInterval = setInterval(() => {
    //   console.log(
    //     `[HEARTBEAT] Main thread is alive. Timestamp: ${performance.now().toFixed(0)}`,
    //   );
    // }, 250);
    // --- END: ADDED FOR DIAGNOSTICS ---

    // --- START OF FIX ---
    // Start the new requestAnimationFrame loop instead of a single iteration.
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this._playbackLoop();
    // --- END OF FIX ---
  }

  public pause(): void {
    console.log(
      `[AudioEngineService.pause ENTRY] Current internal this.isPlaying: ${this.isPlaying}`,
    );
    if (!this.isPlaying) {
      console.log(
        `[AudioEngineService.pause] PRE-CONDITION FAIL: Returning early as not currently playing (internal this.isPlaying is false).`,
      );
      return;
    }

    // --- START OF FIX ---
    // Cancel the animation frame to stop the loop.
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    // --- END OF FIX ---

    this.isPlaying = false;
    console.log(
      `[AudioEngineService.pause] SET internal this.isPlaying = false.`,
    );
    playerStore.update((s) => {
      console.log(
        `[AudioEngineService.pause] playerStore.update: Setting isPlaying to false. Previous store state s.isPlaying: ${s.isPlaying}`,
      );
      return { ...s, isPlaying: false };
    });
    console.log(
      `[AudioEngineService.pause] playerStore.update call completed. Current $playerStore.isPlaying (via get): ${get(playerStore).isPlaying}`,
    );

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
    console.log(
      `[AudioEngineService] seek() called with time: ${time.toFixed(3)}`,
    );
    if (!this.originalBuffer) {
      console.warn("Seek called without an originalBuffer.");
      return;
    }
    // --- ADD THIS LOG ---
    console.log(
      `[AudioEngineService] seek(): Clamping against duration: ${this.originalBuffer.duration.toFixed(3)}`,
    );
    // --- END LOG ---
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
    console.log(
      `[AudioEngineService] seek() updated timeStore to: ${clampedTime.toFixed(3)}, playerStore.currentTime to: ${clampedTime.toFixed(3)}`,
    );
  }

  public jump(seconds: number): void {
    if (!this.originalBuffer) return;
    const wasPlaying = this.isPlaying;
    const currentTime = get(timeStore);
    const newTime = currentTime + seconds;
    this.seek(newTime);
    if (wasPlaying) {
      this.play();
    }
  }

  public setSpeed(speed: number): void {
    console.log(`[AudioEngineService] setSpeed() called with speed: ${speed}`);
    if (this.worker && this.isWorkerReady) {
      this.worker.postMessage({
        type: RB_WORKER_MSG_TYPE.SET_SPEED,
        payload: { speed },
      });
    }
    playerStore.update((s) => ({ ...s, speed }));
    console.log(
      `[AudioEngineService] setSpeed() updated playerStore.speed to: ${speed}`,
    );
  }

  public setPitch(pitch: number): void {
    console.log(
      `[AudioEngineService] setPitch() called with pitchShift: ${pitch}`,
    );
    if (this.worker && this.isWorkerReady) {
      this.worker.postMessage({
        type: RB_WORKER_MSG_TYPE.SET_PITCH,
        payload: { pitch },
      });
    }
    playerStore.update((s) => ({ ...s, pitchShift: pitch }));
    console.log(
      `[AudioEngineService] setPitch() updated playerStore.pitchShift to: ${pitch}`,
    );
  }

  public setGain(level: number): void {
    console.log(`[AudioEngineService] setGain() called with level: ${level}`);
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
    console.log(
      `[AudioEngineService] setGain() updated playerStore.gain to: ${newGain}`,
    );
  }

  private _playbackLoop = (): void => {
    if (!this.isPlaying) {
      this.animationFrameId = null;
      return; // Stop the loop if not playing
    }

    // Continuously process chunks. The iteration function handles advancing the offset.
    this._performSingleProcessAndPlayIteration();

    // Schedule the next frame.
    this.animationFrameId = requestAnimationFrame(this._playbackLoop);
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
        // --- START OF FIX ---
        // REMOVE the following line. The rAF loop handles continuing.
        // this._performSingleProcessAndPlayIteration();
        // --- END OF FIX ---
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
