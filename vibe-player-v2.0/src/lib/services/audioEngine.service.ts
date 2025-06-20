// vibe-player-v2.3/src/lib/services/audioEngine.service.ts

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
import { updateUrlWithCurrentTime } from "$lib/stores/url.store";
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
  private audioContextResumed = false;
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
   * [REFACTORED] Ensures the AudioContext is created and resumed. This method is now
   * idempotent and can be safely called multiple times.
   * @returns {void}
   */
  public unlockAudio = (): void => {
    // If we've already resumed, do nothing.
    if (this.audioContextResumed) {
      playerStore.update((s) => ({ ...s, audioContextResumed: true }));
      return;
    }

    const ctx = this._getAudioContext();
    if (ctx.state === "suspended") {
      console.log(
        "[AudioEngineService] AudioContext is suspended, attempting to resume...",
      );
      ctx
        .resume()
        .then(() => {
          console.log(
            `[AudioEngineService] AudioContext state is now: ${ctx.state}`,
          );
          this.audioContextResumed = true;
          playerStore.update((s) => ({ ...s, audioContextResumed: true }));
        })
        .catch((err) => {
          console.error(
            "[AudioEngineService] Error resuming AudioContext:",
            err,
          );
          // Optionally update playerStore with an error state here if needed
        });
    } else {
      // If context is already running, just update our state and store
      this.audioContextResumed = true;
      playerStore.update((s) => ({ ...s, audioContextResumed: true }));
    }
  };

  /**
   * Loads an audio file, decodes it, and initializes the processing worker.
   * This is the primary entry point for loading new audio.
   * @param {File} file - The audio file to load.
   * @returns {Promise<AudioBuffer>} The decoded audio buffer.
   * @throws Will re-throw errors from decoding or worker initialization.
   */
  public loadFile = async (file: File): Promise<AudioBuffer> => {
    console.log(`[AudioEngineService] loadFile called for: ${file.name}`);

    const audioFileBuffer = await file.arrayBuffer();

    if (!audioFileBuffer || audioFileBuffer.byteLength === 0) {
      const errorMsg = "loadFile received an invalid or empty ArrayBuffer.";
      console.error(`[AudioEngine] ${errorMsg}`);
      playerStore.update((s) => ({
        ...s,
        status: `Error loading ${file.name}`,
        error: errorMsg,
        isPlayable: false,
      }));
      console.log(
        "[AudioEngineService] playerStore updated by loadFile (invalid buffer). New state:",
        get(playerStore),
      );
      throw new Error(errorMsg);
    }

    await this.stop(); // Ensure any previous playback is stopped

    const ctx = this._getAudioContext();
    playerStore.update((s) => ({
      ...s,
      status: `Decoding ${file.name}...`,
      fileName: file.name,
      error: null,
      isPlayable: false,
    }));
    console.log(
      "[AudioEngineService] playerStore updated by loadFile (before decoding). New state:",
      get(playerStore),
    );

    try {
      console.log(
        `[AudioEngineService] Decoding audio data for ${file.name}...`,
      );
      this.originalBuffer = await ctx.decodeAudioData(audioFileBuffer);
      console.log(
        `[AudioEngineService] Audio decoded successfully for ${file.name}. Duration: ${this.originalBuffer.duration.toFixed(2)}s, Channels: ${this.originalBuffer.numberOfChannels}, Sample Rate: ${this.originalBuffer.sampleRate}Hz`,
      );

      // Initialize the worker with the decoded buffer
      await this._initializeWorker(this.originalBuffer);

      // Return the decoded buffer for the orchestrator
      return this.originalBuffer;
    } catch (error: any) {
      console.error(
        `[AudioEngineService] Error during loadFile for ${file.name}: ${error.message}`,
      );
      playerStore.update((s) => ({
        ...s,
        status: `Error decoding ${file.name}`,
        error: error.message,
        isPlayable: false,
      }));
      console.log(
        "[AudioEngineService] playerStore updated by loadFile (decode error). New state:",
        get(playerStore),
      );
      throw error; // Re-throw for the orchestrator
    }
  };

  /**
   * Initializes or resets the Rubberband Web Worker.
   * @param {AudioBuffer} audioBuffer - The decoded audio buffer to initialize the worker with.
   * @returns {Promise<void>}
   * @private
   */
  private _initializeWorker = async (
    audioBuffer: AudioBuffer,
  ): Promise<void> => {
    console.log(`[AudioEngineService] Initializing worker...`);
    if (!this.worker) {
      this.worker = new RubberbandWorker();
      this.worker.onmessage = this.handleWorkerMessage;
      this.worker.onerror = (err) => {
        console.error("[AudioEngineService] Unhandled worker error:", err);
        // Potentially update store here if a generic worker error occurs not tied to a specific operation
        playerStore.update((s) => ({
          ...s,
          status: "Error in worker",
          error: "Worker encountered an unhandled error",
          isPlayable: false,
        }));
        console.log(
          "[AudioEngineService] playerStore updated by _initializeWorker (worker.onerror). New state:",
          get(playerStore),
        );
      };
    } else {
      console.log("[AudioEngineService] Resetting existing worker.");
      this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });
    }
    this.isWorkerInitialized = false;

    try {
      const wasmResponse = await fetch(AUDIO_ENGINE_CONSTANTS.WASM_BINARY_URL);
      const loaderResponse = await fetch(
        AUDIO_ENGINE_CONSTANTS.LOADER_SCRIPT_URL,
      );

      if (!wasmResponse.ok || !loaderResponse.ok) {
        const errorMsg =
          "Failed to fetch worker dependencies (WASM or loader script).";
        console.error(`[AudioEngineService] ${errorMsg}`);
        playerStore.update((s) => ({
          ...s,
          status: "Error initializing",
          error: errorMsg,
          isPlayable: false,
        }));
        console.log(
          "[AudioEngineService] playerStore updated by _initializeWorker (dependency fetch error). New state:",
          get(playerStore),
        );
        throw new Error(errorMsg);
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
        {
          ...initPayload,
          wasmBinary: `[${wasmBinary.byteLength} bytes]`,
          loaderScriptText: `[${loaderScriptText.length} chars]`,
        },
      );
      this.worker.postMessage(
        { type: RB_WORKER_MSG_TYPE.INIT, payload: initPayload },
        [wasmBinary],
      );
      // Note: Actual readiness (isPlayable=true) is set by handleWorkerMessage on INIT_SUCCESS
    } catch (error: any) {
      console.error(
        `[AudioEngineService] Error during worker initialization: ${error.message}`,
      );
      playerStore.update((s) => ({
        ...s,
        status: "Error initializing worker",
        error: error.message,
        isPlayable: false,
      }));
      console.log(
        "[AudioEngineService] playerStore updated by _initializeWorker (init error). New state:",
        get(playerStore),
      );
      throw error; // Re-throw for the orchestrator or loadFile to catch
    }
  };

  /**
   * Starts or resumes playback. This method also acts as a gatekeeper for audio
   * playback, ensuring the AudioContext is resumed if it's in a suspended state,
   * which is crucial for browsers that require user interaction to start audio.
   * Starts or resumes playback. This method is now synchronous to give immediate
  /**
   * [MODIFIED] Starts or resumes playback. This method assumes the audio context
   * is already unlocked or will be by the time playback needs to produce sound.
   */
  public play = (): void => {
    console.log(
      `[AudioEngineService] PLAY called. State: isPlaying=${this.isPlaying}, isWorkerInitialized=${this.isWorkerInitialized}`,
    );
    if (this.isPlaying || !this.originalBuffer || !this.isWorkerInitialized) {
      console.warn(
        "AudioEngine: Play command ignored. Not ready or already playing.",
      );
      return;
    }

    // Set UI state immediately for responsiveness.
    this.isPlaying = true;
    playerStore.update((s) => ({
      ...s,
      isPlaying: true,
      status: `Playing: ${s.fileName}`,
    }));
    console.log(
      "[AudioEngineService] playerStore updated by play. New state:",
      get(playerStore),
    );

    const audioCtx = this._getAudioContext();

    // Define the function that starts the actual audio processing loop.
    const startPlaybackLoop = () => {
      // Re-check isPlaying in case the user paused immediately after playing.
      if (this.isPlaying) {
        if (
          this.nextChunkTime === 0 ||
          this.nextChunkTime < audioCtx.currentTime
        ) {
          this.nextChunkTime = audioCtx.currentTime;
        }
        this.animationFrameId = requestAnimationFrame(
          this._recursiveProcessAndPlayLoop,
        );
      }
    };

    startPlaybackLoop();
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
    updateUrlWithCurrentTime();
    playerStore.update((s) => ({
      ...s,
      isPlaying: false,
      status: `Paused: ${s.fileName || ""}`,
    }));
    console.log(
      "[AudioEngineService] playerStore updated by pause. New state:",
      get(playerStore),
    );
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
    updateUrlWithCurrentTime();
    console.log(
      "[AudioEngineService] playerStore updated by stop. New state:",
      get(playerStore),
    );
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
    updateUrlWithCurrentTime();
    console.log(
      "[AudioEngineService] playerStore updated by seek. New state:",
      get(playerStore),
    );
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
    console.log(
      "[AudioEngineService] playerStore updated by setSpeed. New state:",
      get(playerStore),
    );
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
    console.log(
      "[AudioEngineService] playerStore updated by setPitch. New state:",
      get(playerStore),
    );
  };

  /**
   * Sets master gain.
   */
  public setGain = (level: number): void => {
    console.log(`[AudioEngineService] setGain called with: ${level}`);
    // The gain is now applied pre-worker.
    // The actual gain application happens in _performSingleProcessAndPlayIteration.
    // We still store it in the playerStore for UI and state management.
    const newGain = Math.max(0, Math.min(2, level)); // Assuming gain is clamped 0-2
    playerStore.update((s) => ({ ...s, gain: newGain }));
    console.log(
      "[AudioEngineService] playerStore updated by setGain. New state:",
      get(playerStore),
    );
  }; // Ensures this is the end of setGain

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
    this.audioContextResumed = false; // Reset this flag
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
      // Set post-worker gain node to 1.0 (neutral) as gain is now applied pre-worker.
      this.gainNode.gain.setValueAtTime(1.0, this.audioContext.currentTime);
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
    console.log(
      "[AudioEngineService] playerStore updated by _recursiveProcessAndPlayLoop. New state:",
      get(playerStore),
    );
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
          console.log(
            "[AudioEngineService] playerStore updated by _performSingleProcessAndPlayIteration (chunk duration zero). New state:",
            get(playerStore),
          );
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

        const currentGain = get(playerStore).gain;
        const numberOfChannels = this.originalBuffer.numberOfChannels;
        const inputSamples: Float32Array[] = [];
        const transferableObjects: Transferable[] = [];

        for (let i = 0; i < numberOfChannels; i++) {
          const channelData = this.originalBuffer.getChannelData(i);
          const segment = channelData.slice(startSample, endSample);

          // Apply pre-worker gain
          for (let j = 0; j < segment.length; j++) {
            segment[j] *= currentGain;
          }
          inputSamples.push(segment);
          transferableObjects.push(segment.buffer);
        }

        const isFinalChunk =
          this.sourcePlaybackOffset + actualChunkDuration >=
          this.originalBuffer.duration;

        console.log(
          `[AudioEngineService] Processing chunk. Offset: ${this.sourcePlaybackOffset.toFixed(2)}s, Duration: ${actualChunkDuration.toFixed(3)}s, Final: ${isFinalChunk}, Gain: ${currentGain.toFixed(2)}`,
        );

        const processPayload: RubberbandProcessPayload = {
          inputBuffer: inputSamples,
          isFinalChunk,
        };
        this.worker!.postMessage(
          { type: RB_WORKER_MSG_TYPE.PROCESS, payload: processPayload },
          transferableObjects,
        );
        this.sourcePlaybackOffset += actualChunkDuration;
      } else {
        this.pause();
        playerStore.update((s) => ({
          ...s,
          currentTime: this.originalBuffer!.duration,
          status: `Finished: ${s.fileName}`,
        }));
        console.log(
          "[AudioEngineService] playerStore updated by _performSingleProcessAndPlayIteration (finished playing). New state:",
          get(playerStore),
        );
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
    event: MessageEvent<
      WorkerMessage<RubberbandProcessResultPayload | WorkerErrorPayload>
    >,
  ): void => {
    const { type, payload } = event.data;

    switch (type) {
      case RB_WORKER_MSG_TYPE.INIT_SUCCESS:
        this.isWorkerInitialized = true;
        console.log("[AudioEngineService] Worker initialized successfully.");
        playerStore.update((s) => ({
          ...s,
          isPlayable: true,
          // Keep status as is, Orchestrator handles "Ready"
        }));
        console.log(
          "[AudioEngineService] playerStore updated by handleWorkerMessage (INIT_SUCCESS). New state:",
          get(playerStore),
        );
        break;

      case RB_WORKER_MSG_TYPE.ERROR:
        const errorPayload = payload as WorkerErrorPayload;
        console.error(
          "[AudioEngineService] Worker Error:",
          errorPayload.message,
        );
        playerStore.update((s) => ({
          ...s,
          error: errorPayload.message,
          isPlaying: false,
          isPlayable: false,
          status: "Error",
        }));
        console.log(
          "[AudioEngineService] playerStore updated by handleWorkerMessage (ERROR). New state:",
          get(playerStore),
        );
        this.isWorkerInitialized = false;
        if (this.isPlaying) this.pause();
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
