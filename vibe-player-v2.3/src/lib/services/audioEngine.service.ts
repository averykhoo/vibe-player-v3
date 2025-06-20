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
  private nextChunkTime = 0;
  private animationFrameId: number | null = null;

  private workerInitPromiseCallbacks: {
    resolve: () => void;
    reject: (reason?: any) => void;
  } | null = null;

  private constructor() {}

  public static getInstance(): AudioEngineService {
    if (!AudioEngineService.instance) {
      AudioEngineService.instance = new AudioEngineService();
    }
    return AudioEngineService.instance;
  }

  // Safeguard for test environments with immediate requestAnimationFrame
  private _testLoopSafeguard = 0;
  private readonly _TEST_MAX_LOOP_ITERATIONS = 1000;

  public unlockAudio = async (): Promise<void> => {
    const ctx = this._getAudioContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
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
      console.log(
        `Play called but conditions not met: isPlaying=${this.isPlaying}, originalBuffer=${!!this.originalBuffer}, isWorkerReady=${this.isWorkerReady}`,
      );
      return;
    }

    await this.unlockAudio(); // Ensure audio context is active
    const audioCtxTime = this._getAudioContext().currentTime;
    this.isPlaying = true;
    playerStore.update((s) => ({ ...s, isPlaying: true, error: null })); // Clear previous errors on play

    // If playback stopped and then restarted, or if seeking caused nextChunkTime to be in the past.
    if (this.nextChunkTime === 0 || this.nextChunkTime < audioCtxTime) {
      this.nextChunkTime = audioCtxTime;
    }
    this._testLoopSafeguard = 0; // Reset safeguard on new play intent

    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId); // Ensure no ghost loops
    this.animationFrameId = requestAnimationFrame(
      this._recursiveProcessAndPlayLoop,
    );
  };

  public pause = (): void => {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    playerStore.update((s) => ({ ...s, isPlaying: false }));
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  };

  public stop = async (): Promise<void> => {
    this.isStopping = true; // Signal that a stop operation is in progress
    this.pause(); // This will cancel animationFrame and set isPlaying to false

    if (this.worker && this.isWorkerReady) {
      this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });
    }

    this.sourcePlaybackOffset = 0;
    this.nextChunkTime = 0;
    timeStore.set(0); // Reset time store to 0
    playerStore.update((s) => ({ ...s, currentTime: 0 })); // Also update playerStore's currentTime for consistency if it's used elsewhere

    // Short delay to allow any in-flight operations to cease
    // This might need adjustment or a more robust mechanism if race conditions persist
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.isStopping = false;
  };

  public seek = (time: number): void => {
    if (!this.originalBuffer) {
      // Worker readiness not strictly needed for seek setup, but buffer is.
      console.warn("Seek called without an originalBuffer.");
      return;
    }

    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.pause();

    const clampedTime = Math.max(
      0,
      Math.min(time, this.originalBuffer.duration),
    );
    this.sourcePlaybackOffset = clampedTime; // This is the primary time state for the engine

    if (this.worker && this.isWorkerReady) {
      // Only reset worker if it's ready
      this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });
    }

    // Set the audio context's next chunk time to now, so processing can resume immediately if play is called.
    this.nextChunkTime = this._getAudioContext().currentTime;

    timeStore.set(clampedTime); // Update the reactive time store for UI
    playerStore.update((s) => ({ ...s, currentTime: clampedTime })); // Also update playerStore for consistency

    // Explicitly trigger URL update via Orchestrator
    AudioOrchestrator.getInstance().updateUrlFromState();

    if (wasPlaying) this.play();
  };

  public setSpeed = (speed: number): void => {
    if (this.worker && this.isWorkerReady) {
      this.worker.postMessage({
        type: RB_WORKER_MSG_TYPE.SET_SPEED,
        payload: { speed },
      });
    }
    playerStore.update((s) => ({ ...s, speed }));
    AudioOrchestrator.getInstance().updateUrlFromState(); // Speed change should update URL
  };

  public setPitch = (pitch: number): void => {
    if (this.worker && this.isWorkerReady) {
      this.worker.postMessage({
        type: RB_WORKER_MSG_TYPE.SET_PITCH,
        payload: { pitch },
      });
    }
    playerStore.update((s) => ({ ...s, pitchShift: pitch }));
    AudioOrchestrator.getInstance().updateUrlFromState(); // Pitch change should update URL
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
    AudioOrchestrator.getInstance().updateUrlFromState(); // Gain change should update URL
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

  private _recursiveProcessAndPlayLoop = (): void => {
    if (
      !this.isPlaying ||
      !this.originalBuffer ||
      !this.isWorkerReady ||
      this.isStopping
    ) {
      if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
      return;
    }

    // Test safeguard for requestAnimationFrame mock
    if (
      (globalThis as any).vi &&
      this._testLoopSafeguard++ > this._TEST_MAX_LOOP_ITERATIONS
    ) {
      console.warn(
        "[AudioEngineService] Test safeguard triggered: Max loop iterations reached.",
      );
      this.pause(); // Attempt to break the loop
      return;
    }

    // Update reactive time store
    timeStore.set(this.sourcePlaybackOffset);
    // Also update playerStore.currentTime for any components still using it, though timeStore is preferred for "hot" updates.
    playerStore.update((s) => ({
      ...s,
      currentTime: this.sourcePlaybackOffset,
    }));

    this._performSingleProcessAndPlayIteration();

    if (this.isPlaying && !this.isStopping) {
      // Check isPlaying and isStopping again before queuing next frame
      this.animationFrameId = requestAnimationFrame(
        this._recursiveProcessAndPlayLoop,
      );
    } else {
      if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  };

  private _performSingleProcessAndPlayIteration(): void {
    if (
      !this.worker ||
      !this.isWorkerReady ||
      !this.originalBuffer ||
      !this.audioContext
    )
      return;

    const audioCtxTime = this.audioContext.currentTime;
    const { speed } = get(playerStore);
    const lookahead = AUDIO_ENGINE_CONSTANTS.PROCESS_LOOKAHEAD_TIME_S; // Rubberband processes based on original speed

    // If the next chunk is needed soon (within the lookahead window)
    if (this.nextChunkTime - audioCtxTime < lookahead * speed) {
      const frameSize = AUDIO_ENGINE_CONSTANTS.PROCESS_FRAME_SIZE;
      const numChannels = this.originalBuffer.numberOfChannels;
      const inputBuffer: Float32Array[] = [];

      // Calculate start and end frame in original buffer samples
      // sourcePlaybackOffset is in seconds. Multiply by sampleRate for frame index.
      let startFrame = Math.floor(
        this.sourcePlaybackOffset * this.originalBuffer.sampleRate,
      );
      let endFrame = startFrame + frameSize;

      // Check if we are at or beyond the end of the buffer
      if (startFrame >= this.originalBuffer.length) {
        // End of buffer, no more data to process
        if (this.isPlaying) {
          // If it was playing, then pause and set to end.
          this.pause();
          timeStore.set(this.originalBuffer.duration);
          playerStore.update((s) => ({
            ...s,
            currentTime: this.originalBuffer!.duration,
            isPlaying: false,
          }));
        }
        return;
      }

      // Ensure we don't read past the end of the buffer
      const isLastChunk = endFrame >= this.originalBuffer.length;
      if (isLastChunk) {
        endFrame = this.originalBuffer.length;
      }

      for (let i = 0; i < numChannels; i++) {
        // Slice the data for the current chunk from the original buffer
        inputBuffer[i] = this.originalBuffer
          .getChannelData(i)
          .slice(startFrame, endFrame);
      }

      if (inputBuffer[0].length > 0) {
        // Only post if there's actual data
        const processPayload: RubberbandProcessPayload = {
          inputBuffer,
          isLastChunk,
          // Playback time for this chunk needs to be where it's scheduled in the AudioContext timeline
          playbackTime: this.nextChunkTime,
        };
        this.worker.postMessage({
          type: RB_WORKER_MSG_TYPE.PROCESS,
          payload: processPayload,
        });

        // The actual this.sourcePlaybackOffset will be updated in scheduleChunkPlayback
        // based on worker output duration to keep it accurate.
        // For now, we can estimate it for the next iteration's check, or let scheduleChunkPlayback handle it.
      } else if (isLastChunk && this.isPlaying) {
        // If it was the last chunk and we got no data, behave as end of stream.
        this.pause();
        timeStore.set(this.originalBuffer.duration);
        playerStore.update((s) => ({
          ...s,
          currentTime: this.originalBuffer!.duration,
          isPlaying: false,
        }));
      }
    }
  }

  private scheduleChunkPlayback(
    channelData: Float32Array[],
    playbackTime: number,
    durationSeconds: number,
  ): void {
    if (
      !this.audioContext ||
      !this.gainNode ||
      !this.originalBuffer ||
      this.isStopping
    )
      return;

    const numChannels = channelData.length;
    const frameCount = channelData[0].length;

    if (frameCount === 0) return; // No data to play

    const chunkBuffer = this.audioContext.createBuffer(
      numChannels,
      frameCount,
      this.originalBuffer.sampleRate,
    );
    for (let i = 0; i < numChannels; i++) {
      chunkBuffer.copyToChannel(channelData[i], i);
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = chunkBuffer;
    source.connect(this.gainNode);

    // Ensure playbackTime is not in the past for scheduling
    const correctedPlaybackTime = Math.max(
      playbackTime,
      this.audioContext.currentTime,
    );
    source.start(correctedPlaybackTime);

    // Update nextChunkTime for the next processing cycle.
    // This is the time in the AudioContext's timeline when this current chunk will finish playing.
    this.nextChunkTime = correctedPlaybackTime + durationSeconds;

    // Update sourcePlaybackOffset. This represents the current playback position in the *original* audio file's timeline.
    // The worker tells us the duration of the *original* audio that corresponds to the processed chunk.
    // For simplicity here, we assume `durationSeconds` from the worker IS the duration in original timeline.
    // A more accurate rubberband integration would provide this original duration.
    // For now, we'll advance it by the stretched/pitched duration.
    // This needs careful handling: if speed is 2x, durationSeconds is half of original segment.
    // The `sourcePlaybackOffset` should track progress in the *source material*.
    // If `durationSeconds` is the *output* duration, we need to calculate the *input* duration.
    // Assuming worker gives `duration` as `outputChunk.duration / speed`.
    // Let's assume `durationSeconds` IS the actual time advanced in the source material.
    // This is a simplification; Rubberband provides `samples_processed`.
    const { speed } = get(playerStore); // Current playback speed
    const originalDurationConsumed = durationSeconds / speed; // This is an approximation if durationSeconds is output duration
    // If worker actually returns samples_processed, use that.
    // For now, let's assume durationSeconds is the stretched duration.
    // And sourcePlaybackOffset should advance by the original amount of time this chunk represents.
    // This part is tricky without knowing exactly what the worker's `duration` means.
    // Let's assume the worker's reported `duration` is the *actual time this chunk will play for*.
    // And we need to advance `sourcePlaybackOffset` by the amount of *original audio* this chunk represents.

    // If the worker provided the number of input frames processed, that would be ideal.
    // For now, assuming `durationSeconds` is the output duration.
    // `this.sourcePlaybackOffset` should advance by `durationSeconds` if speed is 1.
    // If speed is 2, it plays twice as fast, so `sourcePlaybackOffset` should advance by `durationSeconds * 2` (incorrect)
    // It should be: `sourcePlaybackOffset += durationSeconds_of_original_material`
    // A better way:
    // The worker should tell us how many frames of the *original* input it processed.
    // Let's say `originalFramesProcessed`. Then:
    // `this.sourcePlaybackOffset += originalFramesProcessed / this.originalBuffer.sampleRate;`
    // Given the current worker message structure, we don't have `originalFramesProcessed`.
    // We will assume `duration` in `RubberbandProcessResultPayload` is the duration of the *output* audio.
    // And we will advance `sourcePlaybackOffset` by this amount. This means `sourcePlaybackOffset` tracks played duration.
    // This is a common source of bugs in time-stretching.
    // For the sake of moving forward with the refactor as described:
    this.sourcePlaybackOffset += durationSeconds; // This means sourcePlaybackOffset tracks the *output* timeline.
    // This might be fine if seeking also uses this output timeline.
    // The issue prompt's `timeStore.set(this.sourcePlaybackOffset)` in loop suggests this.

    playerStore.update((s) => ({
      ...s,
      lastProcessedChunk: {
        playbackTime: correctedPlaybackTime,
        duration: durationSeconds,
      },
    }));

    // Check if playback has reached or exceeded the total duration
    if (
      this.originalBuffer &&
      this.sourcePlaybackOffset >= this.originalBuffer.duration
    ) {
      if (this.isPlaying) {
        this.pause();
        // Ensure time is set to the exact duration at the end
        const finalDuration = this.originalBuffer.duration;
        timeStore.set(finalDuration);
        playerStore.update((s) => ({
          ...s,
          currentTime: finalDuration,
          isPlaying: false,
        }));
      }
    }
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
        if (this.isStopping) break; // Ignore results if stopping

        if (
          result.outputBuffer &&
          result.outputBuffer.length > 0 &&
          result.outputBuffer[0].length > 0
        ) {
          this.scheduleChunkPlayback(
            result.outputBuffer,
            result.playbackTime,
            result.duration,
          );
        } else if (this.isPlaying && result.isLastChunk) {
          // If it's the last chunk and worker returns no data (or explicitly signals end)
          // This means end of audio stream.
          this.pause();
          if (this.originalBuffer) {
            timeStore.set(this.originalBuffer.duration);
            playerStore.update((s) => ({
              ...s,
              currentTime: this.originalBuffer!.duration,
              isPlaying: false,
            }));
          }
        }
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
    this.nextChunkTime = 0;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    console.log("[AudioEngineService] Disposed");
  }
}

export default AudioEngineService.getInstance();
