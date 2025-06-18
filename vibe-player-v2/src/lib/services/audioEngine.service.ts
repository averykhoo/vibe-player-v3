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
// import { analysisStore } from "../stores/analysis.store"; // Not used directly in this file after refactor

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION: Class Definition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @class AudioEngineService
 * @description A singleton service that manages Web Audio API interactions. It handles
 * audio decoding, playback scheduling, and communication with the Rubberband Web Worker
 * for time-stretching and pitch-shifting. Worker initialization is now separated.
 */
class AudioEngineService {
  // ---------------------------------------------------------------------------
  //  SUB-SECTION: Singleton and Private Properties
  // ---------------------------------------------------------------------------

  private static instance: AudioEngineService;

  private worker: Worker | null = null;
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  /** The original, unmodified AudioBuffer loaded from the user's file. */
  private originalBuffer: AudioBuffer | null = null;

  private isPlaying = false;
  /** Indicates if the worker has successfully initialized and is ready for processing. */
  private isWorkerReady = false;
  private isStopping = false; // Flag to manage state during stop operation

  /** Current playback position in seconds, relative to the originalBuffer. */
  private sourcePlaybackOffset = 0;
  /** The AudioContext's currentTime when the next chunk of audio should be scheduled. */
  private nextChunkTime = 0;

  /** The ID of the current requestAnimationFrame loop, used to cancel it. */
  private animationFrameId: number | null = null;

  /** Used to resolve/reject the promise returned by initializeWorker */
  private workerInitPromiseCallbacks: { resolve: () => void; reject: (reason?: any) => void } | null = null;

  private wasPlayingBeforeSeek = false;

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
  //  SUB-SECTION: Public API Methods
  // ---------------------------------------------------------------------------

  /**
   * Ensures the AudioContext is created and resumed if suspended.
   * Must be called after a user interaction to comply with browser autoplay policies.
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
   * Loads an audio file, decodes it, and stores it as the originalBuffer.
   * Its primary responsibility is to decode the audioFile and return a Promise<AudioBuffer>.
   * It does NOT initialize the worker or update playerStore directly.
   * @param {File} audioFile - The audio file to load.
   * @returns {Promise<AudioBuffer>} A promise that resolves with the decoded AudioBuffer.
   * @throws {Error} If the file is invalid or decoding fails.
   */
  public loadFile = async (audioFile: File): Promise<AudioBuffer> => {
    console.log(`[AudioEngineService] loadFile called for: ${audioFile.name}`);
    if (!audioFile || audioFile.size === 0) {
      const errorMsg = "loadFile received an invalid or empty File object.";
      console.error(`[AudioEngineService] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    const ctx = this._getAudioContext();
    let fileArrayBuffer: ArrayBuffer;

    try {
      fileArrayBuffer = await audioFile.arrayBuffer();
    } catch (e) {
      const error = e as Error;
      const errorMsg = `Error reading ArrayBuffer from file: ${error.message}`;
      console.error(`[AudioEngineService] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    try {
      console.log(`[AudioEngineService] Decoding audio data for ${audioFile.name}...`);
      // Note: Previous versions might have called this.stop() here.
      // This is now the responsibility of the AudioOrchestrator.
      this.originalBuffer = await ctx.decodeAudioData(fileArrayBuffer);
      console.log(
        `[AudioEngineService] Audio decoded successfully for ${audioFile.name}. Duration: ${this.originalBuffer.duration.toFixed(2)}s, Channels: ${this.originalBuffer.numberOfChannels}, Sample Rate: ${this.originalBuffer.sampleRate}Hz`,
      );
      // Worker initialization is explicitly separated. Orchestrator will call initializeWorker.
      this.isWorkerReady = false; // Reset worker ready state for the new buffer
      return this.originalBuffer;
    } catch (e) {
      const error = e as Error;
      const errorMsg = `Error decoding audio data: ${error.message}`;
      console.error(`[AudioEngineService] ${errorMsg}`);
      this.originalBuffer = null; // Ensure buffer is cleared on error
      this.isWorkerReady = false;
      throw new Error(errorMsg); // Re-throw for Orchestrator to handle
    }
  };

  /**
   * Initializes the Rubberband Web Worker with the provided AudioBuffer's properties.
   * Fetches WASM/loader scripts and posts the INIT message to the worker.
   * @param {AudioBuffer} audioBuffer - The AudioBuffer whose properties (sampleRate, channels) will be used for worker initialization.
   * @returns {Promise<void>} A promise that resolves upon successful worker initialization (INIT_SUCCESS) or rejects on error.
   * @public
   */
  public initializeWorker = async (audioBuffer: AudioBuffer): Promise<void> => {
    return new Promise((resolve, reject) => {
      console.log(`[AudioEngineService] Initializing worker...`);
      if (!audioBuffer) {
        const errorMsg = "initializeWorker called with no AudioBuffer.";
        console.error(`[AudioEngineService] ${errorMsg}`);
        playerStore.update((s) => ({ ...s, error: errorMsg, isPlayable: false, isPlaying: false }));
        reject(new Error(errorMsg));
        return;
      }

      this.workerInitPromiseCallbacks = { resolve, reject };

      if (!this.worker) {
        this.worker = new RubberbandWorker();
        this.worker.onmessage = this.handleWorkerMessage; // Bound method
        this.worker.onerror = (err) => { // General worker error, not specific to init
          console.error("[AudioEngineService] Unhandled worker error event:", err);
          const errorMessage = "Worker crashed or encountered an unrecoverable error.";
          playerStore.update((s) => ({ ...s, error: errorMessage, isPlayable: false, isPlaying: false }));
          this.isWorkerReady = false;
          if (this.workerInitPromiseCallbacks) {
            this.workerInitPromiseCallbacks.reject(new Error(err.message || "Unknown worker error"));
            this.workerInitPromiseCallbacks = null;
          }
        };
      } else {
        // If worker exists, send RESET to clear its state before re-initializing
        console.log("[AudioEngineService] Worker exists. Sending RESET before INIT.");
        this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });
      }

      this.isWorkerReady = false; // Set to false until INIT_SUCCESS is received

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

          const {playbackSpeed, pitchShift} = get(playerStore);

          const initPayload: RubberbandInitPayload = {
            wasmBinary,
            loaderScriptText,
            origin: location.origin,
            sampleRate: audioBuffer.sampleRate,
            channels: audioBuffer.numberOfChannels,
            initialSpeed: playbackSpeed,
            initialPitch: pitchShift,
          };

          console.log(
            `[AudioEngineService] Posting INIT message to worker with payload:`,
            { ...initPayload, wasmBinary: `[${wasmBinary.byteLength} bytes]`, loaderScriptText: `[${loaderScriptText.length} chars]` },
          );
          this.worker!.postMessage(
            { type: RB_WORKER_MSG_TYPE.INIT, payload: initPayload },
            [wasmBinary],
          );
          // Resolution/rejection is handled by `handleWorkerMessage` via `this.workerInitPromiseCallbacks`
        })
        .catch((e) => {
          const error = e as Error;
          const errorMsg = `Error fetching worker dependencies: ${error.message}`;
          console.error(`[AudioEngineService] ${errorMsg}`);
          playerStore.update((s) => ({ ...s, error: errorMsg, isPlayable: false }));
          this.isWorkerReady = false;
          if (this.workerInitPromiseCallbacks) {
            this.workerInitPromiseCallbacks.reject(error);
            this.workerInitPromiseCallbacks = null;
          }
        });
    });
  };

  /**
   * Starts or resumes audio playback.
   * Requires `loadFile` and `initializeWorker` to have been successfully called.
   * @public
   */
  public play = async (): Promise<void> => {
    console.log(
      `[AudioEngineService] PLAY called. State: isPlaying=${this.isPlaying}, isWorkerReady=${this.isWorkerReady}, originalBuffer: ${!!this.originalBuffer}`,
    );
    if (this.isPlaying || !this.originalBuffer || !this.isWorkerReady) {
      console.warn(
        "[AudioEngineService] Play command ignored. Not ready (originalBuffer or worker not ready) or already playing.",
      );
      return;
    }

    if (this.animationFrameId) { // Clear any existing animation frame
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    const audioCtx = this._getAudioContext();
    if (audioCtx.state === "suspended") await audioCtx.resume();

    this.isPlaying = true;
    // Orchestrator will typically update store for 'Playing' status
    // playerStore.update((s) => ({ ...s, isPlaying: true }));

    // If starting from beginning or a seek, ensure nextChunkTime is current
    if (this.nextChunkTime === 0 || this.nextChunkTime < audioCtx.currentTime) {
      this.nextChunkTime = audioCtx.currentTime;
    }

    this.isStopping = false; // Ensure isStopping is false when play begins
    this.animationFrameId = requestAnimationFrame(this._recursiveProcessAndPlayLoop);
  };

  /**
   * Pauses audio playback.
   * @public
   */
  public pause = (): void => {
    console.log(`[AudioEngineService] PAUSE called.`);
    if (!this.isPlaying) return;
    this.isPlaying = false;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    // Orchestrator typically updates store for 'Paused' status
    // playerStore.update((s) => ({ ...s, isPlaying: false }));
  };

  /**
   * Stops audio playback, resets playback position, and resets the worker state.
   * @public
   */
  public stop = async (): Promise<void> => {
    console.log(`[AudioEngineService] STOP called.`);
    this.isStopping = true; // Signal that we are in the process of stopping
    this.isPlaying = false;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.worker && this.isWorkerReady) { // Only reset if worker is valid and was ready
      console.log("[AudioEngineService] Posting RESET to worker due to stop().");
      this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });
    }

    this.sourcePlaybackOffset = 0;
    this.nextChunkTime = 0;
    // PlayerStore updates (currentTime, isPlaying, status) are typically handled by Orchestrator or UI components
    // based on user actions. AudioEngine focuses on internal state.
    // playerStore.update((s) => ({ ...s, currentTime: 0, isPlaying: false }));

    // Small delay to allow any in-flight operations to cease before clearing isStopping
    await new Promise(resolve => setTimeout(resolve, 50));
    this.isStopping = false;
  };

  /**
   * Seeks to a specific time in the audio. Playback remains paused.
   * Resets the worker to handle the new position correctly.
   * @param {number} time - The time in seconds to seek to.
   * @public
   */
  public seek = async (time: number): Promise<void> => {
    console.log(`[AudioEngineService] SEEK called. Target time: ${time.toFixed(2)}s`);
    if (!this.originalBuffer) {
      console.warn("AudioEngine: Seek attempted without an audio buffer loaded.");
      return;
    }
    const clampedTime = Math.max(0, Math.min(time, this.originalBuffer.duration));

    if (this.isPlaying) {
      this.pause(); // Always pause on seek
    }

    if (this.worker && this.isWorkerReady) {
      console.log("[AudioEngineService] Posting RESET to worker due to seek().");
      this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });
    }

    this.sourcePlaybackOffset = clampedTime;
    // Ensure nextChunkTime is reset so playback doesn't use stale scheduling
    this.nextChunkTime = this.audioContext ? this.audioContext.currentTime : 0;

    // playerStore.update((s) => ({ ...s, currentTime: clampedTime })); // Orchestrator or UI component may handle this
  };

  /**
   * Sets the playback speed (rate).
   * @param {number} speed - The desired playback speed.
   * @public
   */
  public setSpeed = (speed: number): void => {
    console.log(`[AudioEngineService] setSpeed called with: ${speed}`);
    if (this.worker && this.isWorkerReady) {
      this.worker.postMessage({
        type: RB_WORKER_MSG_TYPE.SET_SPEED,
        payload: { speed },
      });
    }
    // playerStore.update((s) => ({ ...s, speed })); // UI component handles this store update
  };

  /**
   * Sets the playback pitch shift.
   * @param {number} pitch - The desired pitch shift value.
   * @public
   */
  public setPitch = (pitch: number): void => {
    console.log(`[AudioEngineService] setPitch called with: ${pitch}`);
    if (this.worker && this.isWorkerReady) {
      this.worker.postMessage({
        type: RB_WORKER_MSG_TYPE.SET_PITCH,
        payload: { pitch },
      });
    }
    // playerStore.update((s) => ({ ...s, pitchShift: pitch })); // UI component handles this
  };

  /**
   * Sets the master gain level.
   * @param {number} level - The desired gain level (0.0 to 2.0 typically).
   * @public
   */
  public setGain = (level: number): void => {
    console.log(`[AudioEngineService] setGain called with: ${level}`);
    if (this.gainNode && this.audioContext) {
      const newGain = Math.max(0, Math.min(AUDIO_ENGINE_CONSTANTS.MAX_GAIN, level));
      this.gainNode.gain.setValueAtTime(newGain, this.audioContext.currentTime);
      // playerStore.update((s) => ({ ...s, gain: newGain })); // UI component handles this
    }
  };

  /**
   * Cleans up all resources including terminating the worker and closing the AudioContext.
   * @public
   */
  public dispose = (): void => {
    console.log("[AudioEngineService] Disposing all resources...");
    this.isStopping = true; // Prevent any further processing during disposal
    this.isPlaying = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.worker?.terminate();
    this.worker = null;
    this.isWorkerReady = false;

    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close().then(() => console.log("[AudioEngineService] AudioContext closed."));
    }
    this.audioContext = null;
    this.gainNode = null;
    this.originalBuffer = null;
    this.workerInitPromiseCallbacks = null; // Clear any pending promise callbacks
    console.log("[AudioEngineService] Dispose complete.");
  };

  public startSeek = (): void => {
    if (!this.originalBuffer || !this.isWorkerReady) return;
    this.wasPlayingBeforeSeek = this.isPlaying;
    if (this.isPlaying) {
        this.pause();
    }
  };

  public updateSeek = (time: number): void => {
    if (!this.originalBuffer || !this.isWorkerReady) return;
    playerStore.update(s => ({ ...s, currentTime: time }));
  };

  public endSeek = (time: number): void => {
    if (!this.originalBuffer || !this.isWorkerReady) return;
    this.seek(time); // Use the internal seek method
    if (this.wasPlayingBeforeSeek) {
        this.play();
    }
    this.wasPlayingBeforeSeek = false;
  };

  // ---------------------------------------------------------------------------
  //  SUB-SECTION: Private Helper Methods
  // ---------------------------------------------------------------------------

  /**
   * Gets the AudioContext, creating it if necessary. Also creates the main gain node.
   * @returns {AudioContext} The active AudioContext.
   * @private
   */
  private _getAudioContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === "closed") {
      this.audioContext = new AudioContext();
      this.gainNode = this.audioContext.createGain();
      this.gainNode.connect(this.audioContext.destination);
      console.log("[AudioEngineService] New AudioContext and GainNode created.");
    }
    return this.audioContext;
  }

  /**
   * The main recursive loop for processing audio data from the worker and scheduling it for playback.
   * Uses `requestAnimationFrame` for timing.
   * @private
   */
  private _recursiveProcessAndPlayLoop = (): void => {
    if (!this.isPlaying || !this.originalBuffer || this.isStopping || !this.audioContext || !this.isWorkerReady) {
      if (this.isStopping) console.log("[AudioEngineService] Play loop aborted due to stopping flag.");
      else if (!this.isPlaying) console.log("[AudioEngineService] Play loop aborted, not playing.");
      else if (!this.isWorkerReady) console.log("[AudioEngineService] Play loop aborted, worker not ready.");

      this.animationFrameId = null;
      return;
    }

    // Update current time in store (can be handled by Orchestrator/UI if preferred)
    playerStore.update((s) => ({ ...s, currentTime: this.sourcePlaybackOffset }));

    this._performSingleProcessAndPlayIteration();

    if (this.isPlaying && !this.isStopping) { // Check flags again before scheduling next frame
      this.animationFrameId = requestAnimationFrame(this._recursiveProcessAndPlayLoop);
    } else {
      this.animationFrameId = null;
    }
  };

  /**
   * Performs a single iteration of fetching a chunk from the original buffer,
   * sending it to the worker for processing, and advancing playback offset.
   * @private
   */
  private _performSingleProcessAndPlayIteration = (): void => {
    // Assertions help catch unexpected states during development
    assert(this.isPlaying, "Processing iteration ran while not playing.");
    assert(!this.isStopping, "Processing iteration ran while stopping.");
    assert(this.originalBuffer, "Processing iteration ran without an audio buffer.");
    assert(this.audioContext, "Processing iteration ran without an audio context.");
    assert(this.isWorkerReady, "Processing iteration ran while worker not ready.");


    if (!this.isPlaying || !this.originalBuffer || this.isStopping || !this.audioContext || !this.isWorkerReady) return;

    const now = this.audioContext.currentTime;
    const lookahead = AUDIO_ENGINE_CONSTANTS.PROCESS_LOOKAHEAD_TIME;

    // Check if it's time to process the next chunk
    if (this.nextChunkTime < now + lookahead) {
      if (this.sourcePlaybackOffset < this.originalBuffer.duration) {
        let chunkDuration = AUDIO_ENGINE_CONSTANTS.TARGET_CHUNK_DURATION_S;
        // Ensure the chunk doesn't exceed the buffer's end
        chunkDuration = Math.min(chunkDuration, this.originalBuffer.duration - this.sourcePlaybackOffset);

        // If remaining duration is very small, process it all
        if (chunkDuration <= AUDIO_ENGINE_CONSTANTS.MIN_CHUNK_DURATION_S &&
            (this.originalBuffer.duration - this.sourcePlaybackOffset) > 0) {
          chunkDuration = this.originalBuffer.duration - this.sourcePlaybackOffset;
        }

        if (chunkDuration <= 0) { // Should not happen if previous checks are correct
          this.pause(); // Pause if we somehow have no duration left to process
          playerStore.update((s) => ({ ...s, currentTime: this.originalBuffer!.duration, isPlaying: false }));
          return;
        }

        const startSample = Math.floor(this.sourcePlaybackOffset * this.originalBuffer.sampleRate);
        const endSample = Math.floor(Math.min(this.sourcePlaybackOffset + chunkDuration, this.originalBuffer.duration) * this.originalBuffer.sampleRate);

        if (startSample >= endSample) { // If no samples to process, pause.
          this.pause();
          return;
        }

        // Assuming mono for simplicity in this example, or use channel 0.
        // Rubberband worker example handles multiple channels if input is multi-channel.
        const channelData = this.originalBuffer.getChannelData(0);
        const segment = channelData.slice(startSample, endSample);

        // Determine if this is the final chunk of the source audio
        const isFinalChunk = (this.sourcePlaybackOffset + chunkDuration) >= this.originalBuffer.duration;

        // console.log(
        //   `[AudioEngineService] Processing chunk. Offset: ${this.sourcePlaybackOffset.toFixed(2)}s, Duration: ${chunkDuration.toFixed(3)}s, Final: ${isFinalChunk}`,
        // );

        const processPayload: RubberbandProcessPayload = {
          inputBuffer: [segment], // Assuming mono processing for now based on `getChannelData(0)`
          isFinalChunk,
        };
        this.worker!.postMessage(
          { type: RB_WORKER_MSG_TYPE.PROCESS, payload: processPayload },
          [segment.buffer], // Transferable object
        );
        this.sourcePlaybackOffset += chunkDuration;
      } else { // Reached end of buffer
        this.pause();
        // Orchestrator can set 'Finished' status
        // playerStore.update((s) => ({ ...s, currentTime: this.originalBuffer!.duration, isPlaying: false }));
      }
    }
  };

  /**
   * Schedules a processed audio chunk (received from the worker) for playback.
   * @param {Float32Array[]} processedChannels - Array of Float32Array, each representing a channel of processed audio.
   * @param {number} startTime - The AudioContext time at which this chunk should ideally start playing.
   * @private
   */
  private scheduleChunkPlayback = (
    processedChannels: Float32Array[],
    startTime: number,
  ): void => {
    if (!processedChannels || processedChannels.length === 0 || processedChannels[0].length === 0) {
      console.warn("[AudioEngineService] scheduleChunkPlayback called with empty or invalid processedChannels.");
      return;
    }

    assert(this.audioContext, "Attempted to schedule chunk without an audio context.");
    assert(this.gainNode, "Attempted to schedule chunk without a gain node.");
    assert(this.originalBuffer, "Attempted to schedule chunk without an original buffer.");

    if (!this.audioContext || !this.gainNode || !this.originalBuffer || this.isStopping) {
        if(this.isStopping) console.log("[AudioEngineService] Playback scheduling skipped due to stopping flag.");
        return;
    }

    const numberOfChannels = this.originalBuffer.numberOfChannels;
    // This assertion should ideally check against the worker's output channel count,
    // but originalBuffer.numberOfChannels is a good proxy if worker preserves channel count.
    assert(processedChannels.length === numberOfChannels, "Channel count mismatch between original and processed buffer.");
    if (processedChannels.length !== numberOfChannels) {
        console.error(`[AudioEngineService] ScheduleChunkPlayback: Mismatch in channel count. Expected ${numberOfChannels}, got ${processedChannels.length}.`);
        return;
    }

    const frameCount = processedChannels[0].length;
    if (frameCount === 0) {
      console.warn("[AudioEngineService] scheduleChunkPlayback called with zero frameCount.");
      return;
    }

    const audioBufferForPlayback = this.audioContext.createBuffer(
      numberOfChannels,
      frameCount,
      this.originalBuffer.sampleRate, // Use original sample rate for playback context
    );

    for (let i = 0; i < numberOfChannels; i++) {
      audioBufferForPlayback.copyToChannel(processedChannels[i], i);
    }

    const bufferSource = this.audioContext.createBufferSource();
    bufferSource.buffer = audioBufferForPlayback;
    bufferSource.connect(this.gainNode);

    const actualStartTime = Math.max(this.audioContext.currentTime, startTime);
    // console.log(
    //   `[AudioEngineService] Scheduling chunk playback at ${actualStartTime.toFixed(2)}s. Duration: ${audioBufferForPlayback.duration.toFixed(3)}s. Context time: ${this.audioContext.currentTime.toFixed(2)}s`,
    // );
    bufferSource.start(actualStartTime);

    const chunkPlaybackDuration = audioBufferForPlayback.duration;
    // Adjust nextChunkTime based on when this chunk *actually* starts playing and its duration
    this.nextChunkTime = actualStartTime + chunkPlaybackDuration - AUDIO_ENGINE_CONSTANTS.SCHEDULE_AHEAD_TIME_S;

    bufferSource.onended = () => {
        bufferSource.disconnect();
        // console.log(`[AudioEngineService] Chunk playback ended. Context time: ${this.audioContext?.currentTime.toFixed(2)}s`);
    };
  };

  /**
   * Handles messages received from the Rubberband Web Worker.
   * @param {MessageEvent<WorkerMessage<RubberbandProcessResultPayload | WorkerErrorPayload>>} event - The message event from the worker.
   * @private
   */
  private handleWorkerMessage = ( // Defined as an arrow function to preserve `this` context if passed as callback directly
    event: MessageEvent<WorkerMessage<RubberbandProcessResultPayload | WorkerErrorPayload>>,
  ): void => {
    const { type, payload } = event.data;

    switch (type) {
      case RB_WORKER_MSG_TYPE.INIT_SUCCESS:
        this.isWorkerReady = true;
        console.log("[AudioEngineService] Worker initialized successfully (INIT_SUCCESS received).");
        playerStore.update((s) => ({ ...s, isPlayable: true, error: null })); // Update store on successful init
        if (this.workerInitPromiseCallbacks) {
          this.workerInitPromiseCallbacks.resolve();
          this.workerInitPromiseCallbacks = null;
        }
        break;

      case RB_WORKER_MSG_TYPE.ERROR:
        const errorPayload = payload as WorkerErrorPayload;
        console.error("[AudioEngineService] Worker Error Message:", errorPayload.message);
        playerStore.update((s) => ({
          ...s,
          error: errorPayload.message,
          isPlaying: false, // Stop playback on worker error
          isPlayable: false, // Worker is not in a playable state
        }));
        this.isWorkerReady = false;
        if (this.isPlaying) this.pause(); // Ensure playback stops

        if (this.workerInitPromiseCallbacks) {
          this.workerInitPromiseCallbacks.reject(new Error(errorPayload.message));
          this.workerInitPromiseCallbacks = null;
        }
        break;

      case RB_WORKER_MSG_TYPE.PROCESS_RESULT:
        if (this.isStopping) { // If stopping, discard any late-arriving processed data
            console.log("[AudioEngineService] PROCESS_RESULT received while stopping, discarding.");
            return;
        }
        const { outputBuffer } = payload as RubberbandProcessResultPayload;
        if (outputBuffer && this.isPlaying && this.isWorkerReady) { // Ensure still playing and worker is ready
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
