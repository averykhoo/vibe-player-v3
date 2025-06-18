// vibe-player-v2/src/lib/services/audioEngine.service.ts

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION: Imports
// ─────────────────────────────────────────────────────────────────────────────

import { get } from "svelte/store";
import type {
  RubberbandInitPayload,
  RubberbandProcessPayload,
  RubberbandProcessResultPayload,
  WorkerErrorPayload,
  WorkerMessage,
} from "$lib/types/worker.types";
import { RB_WORKER_MSG_TYPE } from "$lib/types/worker.types";
import { playerStore } from "$lib/stores/player.store";
import RubberbandWorker from "$lib/workers/rubberband.worker?worker&inline";
import { assert, AUDIO_ENGINE_CONSTANTS } from "$lib/utils";
import { analysisStore } from "../stores/analysis.store";

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION: Class Definition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @class AudioEngineService
 * @description A singleton service that manages all Web Audio API interactions. It handles
 * audio decoding, playback scheduling, and communication with the Rubberband Web Worker
 * for time-stretching and pitch-shifting.
 */
class AudioEngineService {
  // ---------------------------------------------------------------------------
  //  SUB-SECTION: Singleton and Private Properties
  // ---------------------------------------------------------------------------

  private static instance: AudioEngineService;

  private worker: Worker | null = null;
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private originalBuffer: AudioBuffer | null = null;

  private isPlaying = false;
  private isWorkerInitialized = false;
  private isStopping = false;

  private sourcePlaybackOffset = 0;
  private nextChunkTime = 0;

  /** The ID of the current requestAnimationFrame loop, used to cancel it. */
  private animationFrameId: number | null = null;

  private constructor() {}

  /**
   * Gets the singleton instance of the AudioEngineService.
   * @returns {AudioEngineService} The singleton instance.
   */
  public static getInstance(): AudioEngineService {
    if (!AudioEngineService.instance) {
      AudioEngineService.instance = new AudioEngineService();
    }
    return AudioEngineService.instance;
  }

  // ---------------------------------------------------------------------------
  //  SUB-SECTION: Public API Methods (Defined as Arrow Functions)
  // ---------------------------------------------------------------------------

  /**
   * Ensures the AudioContext is created. It must be called after a user
   * interaction (e.g., a click) to comply with browser autoplay policies.
   * @returns {Promise<void>}
   */
  public unlockAudio = async (): Promise<void> => {
    const ctx = this._getAudioContext();
    if (ctx.state === "suspended") {
      console.log(
        "[AudioEngineService] AudioContext is suspended, attempting to resume...",
      );
      await ctx.resume();
      console.log(
        `[AudioEngineService] AudioContext state is now: ${ctx.state}`,
      );
    }
  };

  /**
   * Loads an audio file from a File object and decodes it.
   * Its only responsibility is to decode the file and return a Promise<AudioBuffer>.
   * It does not interact with stores or perform worker initialization.
   * @param {File} audioFile - The audio file to load.
   * @returns {Promise<AudioBuffer>} A promise that resolves with the decoded AudioBuffer.
   * @throws {Error} If the file is invalid or decoding fails.
   */
  public loadFile = async (audioFile: File): Promise<AudioBuffer> => {
    console.log(`[AudioEngineService] loadFile called for: ${audioFile.name}`);
    if (!audioFile || audioFile.size === 0) {
      const errorMsg = "loadFile received an invalid or empty File object.";
      console.error(`[AudioEngine] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    const ctx = this._getAudioContext();
    let audioFileBuffer: ArrayBuffer;

    try {
      audioFileBuffer = await audioFile.arrayBuffer();
    } catch (e) {
      const error = e as Error;
      console.error(
        `[AudioEngineService] Error reading ArrayBuffer from file: ${error.message}`,
      );
      throw new Error(`Failed to read file: ${error.message}`);
    }

    try {
      console.log(`[AudioEngineService] Decoding audio data for ${audioFile.name}...`);
      // Stop any existing playback before decoding new buffer.
      // This is a minimal side-effect, could be moved out if strictness is paramount.
      await this.stop();
      this.originalBuffer = await ctx.decodeAudioData(audioFileBuffer);
      console.log(
        `[AudioEngineService] Audio decoded successfully for ${audioFile.name}. Duration: ${this.originalBuffer.duration.toFixed(2)}s, Channels: ${this.originalBuffer.numberOfChannels}, Sample Rate: ${this.originalBuffer.sampleRate}Hz`,
      );
      // Clear any previous analysis data tied to the old buffer
      analysisStore.set({});
      return this.originalBuffer;
    } catch (e) {
      const error = e as Error;
      console.error(
        `[AudioEngineService] Error during audio decoding: ${error.message}`,
      );
      this.originalBuffer = null; // Ensure buffer is cleared on error
      throw new Error(`Error decoding audio: ${error.message}`);
    }
  };

  /**
   * Initializes the Rubberband Web Worker with the provided AudioBuffer's properties.
   * This should be called after `loadFile` successfully decodes an audio file.
   * @param {AudioBuffer} audioBuffer - The AudioBuffer to initialize the worker with.
   * @returns {Promise<void>} A promise that resolves when the worker signals initialization success, or rejects on error.
   */
  public initializeWorker = async (audioBuffer: AudioBuffer): Promise<void> => {
    return new Promise((resolve, reject) => {
      console.log(`[AudioEngineService] Initializing worker...`);
      if (!audioBuffer) {
        const errorMsg = "initializeWorker called with no AudioBuffer.";
        console.error(`[AudioEngine] ${errorMsg}`);
        reject(new Error(errorMsg));
        return;
      }

      if (!this.worker) {
        this.worker = new RubberbandWorker();
        this.worker.onmessage = (event) => {
          // Modify handleWorkerMessage to use the promise's resolve/reject
          this.handleWorkerMessage(event, { resolve, reject });
        };
        this.worker.onerror = (err) => {
          console.error("[AudioEngineService] Unhandled worker error:", err);
          this.isWorkerInitialized = false;
          playerStore.update((s) => ({ ...s, error: "Worker failed to initialize or crashed.", isPlayable: false, isPlaying: false }));
          reject(new Error("Worker error: " + (err.message || "Unknown worker error")));
        };
      } else {
        this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });
      }
      this.isWorkerInitialized = false; // Set to false until INIT_SUCCESS is received

      Promise.all([
        fetch(AUDIO_ENGINE_CONSTANTS.WASM_BINARY_URL),
        fetch(AUDIO_ENGINE_CONSTANTS.LOADER_SCRIPT_URL),
      ])
        .then(async ([wasmResponse, loaderResponse]) => {
          if (!wasmResponse.ok || !loaderResponse.ok) {
            throw new Error("Failed to fetch worker dependencies (WASM or loader script).");
          }
          const wasmBinary = await wasmResponse.arrayBuffer();
          const loaderScriptText = await loaderResponse.text();

          const initPayload: RubberbandInitPayload = {
            wasmBinary,
            loaderScriptText,
            origin: location.origin,
            sampleRate: audioBuffer.sampleRate,
            channels: audioBuffer.numberOfChannels,
            initialSpeed: get(playerStore).speed,
            initialPitch: get(playerStore).pitch,
          };

          console.log(
            `[AudioEngineService] Posting INIT message to worker with payload:`,
            { ...initPayload, wasmBinary: `[${wasmBinary.byteLength} bytes]`, loaderScriptText: `[${loaderScriptText.length} chars]` },
          );
          this.worker!.postMessage(
            { type: RB_WORKER_MSG_TYPE.INIT, payload: initPayload },
            [wasmBinary],
          );
          // The actual resolution/rejection will happen in handleWorkerMessage
        })
        .catch((e) => {
          const error = e as Error;
          console.error(`[AudioEngineService] Error fetching worker dependencies: ${error.message}`);
          playerStore.update((s) => ({ ...s, error: `Worker init failed: ${error.message}`, isPlayable: false }));
          this.isWorkerInitialized = false;
          reject(error);
        });
    });
  };

  /**
   * Starts or resumes playback.
   * Requires `loadFile` and `initializeWorker` to have been successfully called.
   */
  public play = async (): Promise<void> => {
    console.log(
      `[AudioEngineService] PLAY called. State: isPlaying=${this.isPlaying}, isWorkerInitialized=${this.isWorkerInitialized}, originalBuffer: ${!!this.originalBuffer}`,
    );
    if (this.isPlaying || !this.originalBuffer || !this.isWorkerInitialized) {
      console.warn(
        "AudioEngine: Play command ignored. Not ready or already playing.",
      );
      return;
    }

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    const audioCtx = this._getAudioContext();
    if (audioCtx.state === "suspended") await audioCtx.resume();

    this.isPlaying = true;
    playerStore.update((s) => ({
      ...s,
      isPlaying: true,
      status: `Playing: ${s.fileName}`,
    }));

    if (this.nextChunkTime === 0 || this.nextChunkTime < audioCtx.currentTime) {
      this.nextChunkTime = audioCtx.currentTime;
    }

    if (this.isPlaying) {
      this.animationFrameId = requestAnimationFrame(
        this._recursiveProcessAndPlayLoop,
      );
    }
  };

  /**
   * Pauses playback.
   */
  public pause = (): void => {
    console.log(`[AudioEngineService] PAUSE called.`);
    if (!this.isPlaying) return;
    this.isPlaying = false;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    playerStore.update((s) => ({
      ...s,
      isPlaying: false,
      status: `Paused: ${s.fileName || ""}`,
    }));
  };

  /**
   * Stops playback and resets position.
   */
  public stop = async (): Promise<void> => {
    console.log(`[AudioEngineService] STOP called.`);
    this.isStopping = true;
    this.isPlaying = false;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.worker)
      this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });

    this.sourcePlaybackOffset = 0;
    this.nextChunkTime = 0;
    playerStore.update((s) => ({
      ...s,
      currentTime: 0,
      isPlaying: false,
      status: `Stopped: ${s.fileName || ""}`,
    }));
    this.isStopping = false;
  };

  /**
   * Seeks to a specific time in the audio.
   * This method now ONLY sets the time and leaves the player in a paused state.
   * The caller is responsible for resuming playback.
   */
  public seek = async (time: number): Promise<void> => {
    console.log(
      `[AudioEngineService] SEEK called. Target time: ${time.toFixed(2)}s`,
    );
    if (
      !this.originalBuffer ||
      time < 0 ||
      time > this.originalBuffer.duration
    ) {
      console.warn(`AudioEngine: Seek time ${time} is out of bounds.`);
      return;
    }

    // Always pause when seeking.
    if (this.isPlaying) {
      this.pause();
    }

    // Reset the worker to clear its internal buffers for the new position.
    if (this.worker)
      this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });

    // Update the internal state and the store's time.
    this.sourcePlaybackOffset = time;
    this.nextChunkTime = this.audioContext ? this.audioContext.currentTime : 0;
    playerStore.update((s) => ({ ...s, currentTime: time }));
  };

  /**
   * Sets playback speed.
   */
  public setSpeed = (speed: number): void => {
    console.log(`[AudioEngineService] setSpeed called with: ${speed}`);
    if (this.worker && this.isWorkerInitialized) {
      this.worker.postMessage({
        type: RB_WORKER_MSG_TYPE.SET_SPEED,
        payload: { speed },
      });
    }
    playerStore.update((s) => ({ ...s, speed }));
  };

  /**
   * Sets playback pitch.
   */
  public setPitch = (pitch: number): void => {
    console.log(`[AudioEngineService] setPitch called with: ${pitch}`);
    if (this.worker && this.isWorkerInitialized) {
      this.worker.postMessage({
        type: RB_WORKER_MSG_TYPE.SET_PITCH,
        payload: { pitch },
      });
    }
    playerStore.update((s) => ({ ...s, pitch }));
  };

  /**
   * Sets master gain.
   */
  public setGain = (level: number): void => {
    console.log(`[AudioEngineService] setGain called with: ${level}`);
    if (this.gainNode && this.audioContext) {
      const newGain = Math.max(0, Math.min(2, level));
      this.gainNode.gain.setValueAtTime(newGain, this.audioContext.currentTime);
      playerStore.update((s) => ({ ...s, gain: newGain }));
    }
  };

  /**
   * Cleans up all resources.
   */
  public dispose = (): void => {
    console.log("[AudioEngineService] Disposing all resources...");
    this.isPlaying = false;
    this.isStopping = true;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.worker?.terminate();
    this.worker = null;
    this.isWorkerInitialized = false;
    this.audioContext?.close();
    this.audioContext = null;
    console.log("[AudioEngineService] Dispose complete.");
  };

  // ---------------------------------------------------------------------------
  //  SUB-SECTION: Private Helper Methods
  // ---------------------------------------------------------------------------

  private _getAudioContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === "closed") {
      this.audioContext = new AudioContext();
      this.gainNode = this.audioContext.createGain();
      this.gainNode.connect(this.audioContext.destination);
    }
    return this.audioContext;
  }

  private _recursiveProcessAndPlayLoop = (): void => {
    if (
      !this.isPlaying ||
      !this.originalBuffer ||
      this.isStopping ||
      !this.audioContext
    ) {
      this.animationFrameId = null;
      return;
    }

    playerStore.update((s) => ({
      ...s,
      currentTime: this.sourcePlaybackOffset,
    }));
    this._performSingleProcessAndPlayIteration();

    if (this.isPlaying) {
      this.animationFrameId = requestAnimationFrame(
        this._recursiveProcessAndPlayLoop,
      );
    } else {
      this.animationFrameId = null;
    }
  };

  private _performSingleProcessAndPlayIteration = (): void => {
    assert(this.isPlaying, "Processing loop ran while not playing.");
    assert(!this.isStopping, "Processing loop ran while stopping.");
    assert(this.originalBuffer, "Processing loop ran without an audio buffer.");
    assert(this.audioContext, "Processing loop ran without an audio context.");

    if (
      !this.isPlaying ||
      !this.originalBuffer ||
      this.isStopping ||
      !this.audioContext
    )
      return;

    const now = this.audioContext.currentTime;
    const lookahead = AUDIO_ENGINE_CONSTANTS.PROCESS_LOOKAHEAD_TIME;

    if (this.nextChunkTime < now + lookahead) {
      if (this.sourcePlaybackOffset < this.originalBuffer.duration) {
        const chunkDuration = AUDIO_ENGINE_CONSTANTS.TARGET_CHUNK_DURATION_S;
        let actualChunkDuration = Math.min(
          chunkDuration,
          this.originalBuffer.duration - this.sourcePlaybackOffset,
        );

        if (
          actualChunkDuration <= AUDIO_ENGINE_CONSTANTS.MIN_CHUNK_DURATION_S
        ) {
          actualChunkDuration = Math.min(
            this.originalBuffer.duration - this.sourcePlaybackOffset,
            AUDIO_ENGINE_CONSTANTS.TARGET_CHUNK_DURATION_S,
          );
        }

        if (actualChunkDuration <= 0) {
          this.pause();
          playerStore.update((s) => ({
            ...s,
            currentTime: this.originalBuffer!.duration,
          }));
          return;
        }

        const startSample = Math.floor(
          this.sourcePlaybackOffset * this.originalBuffer.sampleRate,
        );
        const endSample = Math.floor(
          Math.min(
            this.sourcePlaybackOffset + actualChunkDuration,
            this.originalBuffer.duration,
          ) * this.originalBuffer.sampleRate,
        );

        if (startSample >= endSample) {
          this.pause();
          return;
        }

        const channelData = this.originalBuffer.getChannelData(0);
        const segment = channelData.slice(startSample, endSample);
        const isFinalChunk =
          this.sourcePlaybackOffset + actualChunkDuration >=
          this.originalBuffer.duration;

        console.log(
          `[AudioEngineService] Processing chunk. Offset: ${this.sourcePlaybackOffset.toFixed(2)}s, Duration: ${actualChunkDuration.toFixed(3)}s, Final: ${isFinalChunk}`,
        );

        const processPayload: RubberbandProcessPayload = {
          inputBuffer: [segment],
          isFinalChunk,
        };
        this.worker!.postMessage(
          { type: RB_WORKER_MSG_TYPE.PROCESS, payload: processPayload },
          [segment.buffer],
        );
        this.sourcePlaybackOffset += actualChunkDuration;
      } else {
        this.pause();
        playerStore.update((s) => ({
          ...s,
          currentTime: this.originalBuffer!.duration,
          status: `Finished: ${s.fileName}`,
        }));
      }
    }
  };

  private scheduleChunkPlayback = (
    processedChannels: Float32Array[],
    startTime: number,
  ): void => {
    if (
      !processedChannels ||
      processedChannels.length === 0 ||
      processedChannels[0].length === 0
    )
      return;

    assert(
      this.audioContext,
      "Attempted to schedule chunk without an audio context.",
    );
    assert(this.gainNode, "Attempted to schedule chunk without a gain node.");
    assert(
      this.originalBuffer,
      "Attempted to schedule chunk without an original buffer.",
    );
    assert(!this.isStopping, "Attempted to schedule chunk while stopping.");

    if (
      !this.audioContext ||
      !this.gainNode ||
      this.isStopping ||
      !this.originalBuffer
    )
      return;

    const numberOfChannels = this.originalBuffer.numberOfChannels;
    if (processedChannels.length !== numberOfChannels) {
      console.error(
        `ScheduleChunkPlayback: Mismatch in channel count. Expected ${numberOfChannels}, got ${processedChannels.length}.`,
      );
      return;
    }

    const frameCount = processedChannels[0].length;
    if (frameCount === 0) return;

    const audioBuffer = this.audioContext.createBuffer(
      numberOfChannels,
      frameCount,
      this.originalBuffer.sampleRate,
    );
    for (let i = 0; i < numberOfChannels; i++) {
      audioBuffer.copyToChannel(processedChannels[i], i);
    }

    const bufferSource = this.audioContext.createBufferSource();
    bufferSource.buffer = audioBuffer;
    bufferSource.connect(this.gainNode);

    const actualStartTime = Math.max(this.audioContext.currentTime, startTime);
    console.log(
      `[AudioEngineService] Scheduling chunk playback at ${actualStartTime.toFixed(2)}s. Duration: ${audioBuffer.duration.toFixed(3)}s.`,
    );
    bufferSource.start(actualStartTime);

    const chunkDuration = audioBuffer.duration;
    this.nextChunkTime =
      actualStartTime +
      chunkDuration -
      AUDIO_ENGINE_CONSTANTS.SCHEDULE_AHEAD_TIME_S;

    bufferSource.onended = () => bufferSource.disconnect();
  };

  private handleWorkerMessage = (
    event: MessageEvent<WorkerMessage<RubberbandProcessResultPayload | WorkerErrorPayload>>,
    promiseCallbacks?: { resolve: () => void; reject: (reason?: any) => void },
  ): void => {
    const { type, payload } = event.data;

    switch (type) {
      case RB_WORKER_MSG_TYPE.INIT_SUCCESS:
        this.isWorkerInitialized = true;
        console.log("[AudioEngineService] Worker initialized successfully.");
        // No direct store update here for status, consumer should handle UI based on promise resolution.
        // However, isPlayable is an important internal state for the engine related to worker.
        playerStore.update((s) => ({ ...s, isPlayable: true, error: null }));
        promiseCallbacks?.resolve();
        break;

      case RB_WORKER_MSG_TYPE.ERROR:
        const errorPayload = payload as WorkerErrorPayload;
        console.error("[AudioEngineService] Worker Error:", errorPayload.message);
        playerStore.update((s) => ({
          ...s,
          error: errorPayload.message,
          isPlaying: false,
          isPlayable: false,
        }));
        this.isWorkerInitialized = false;
        if (this.isPlaying) this.pause(); // Stop playback if an error occurs
        promiseCallbacks?.reject(new Error(errorPayload.message));
        break;

      case RB_WORKER_MSG_TYPE.PROCESS_RESULT:
        const { outputBuffer } = payload as RubberbandProcessResultPayload;
        if (outputBuffer && this.isPlaying && !this.isStopping) {
          this.scheduleChunkPlayback(outputBuffer, this.nextChunkTime);
        }
        break;

      default:
        console.warn(
          `[AudioEngineService] Received unknown message type from worker: ${type}`,
        );
    }
  };
}

export default AudioEngineService.getInstance();
