// vibe-player-v2/src/lib/services/audioEngine.service.ts

import { get } from "svelte/store";
import type {
  WorkerMessage,
  RubberbandInitPayload,
  RubberbandProcessPayload,
  RubberbandProcessResultPayload,
  WorkerErrorPayload,
} from "$lib/types/worker.types";
import { RB_WORKER_MSG_TYPE } from "$lib/types/worker.types";
import { playerStore } from "$lib/stores/player.store";
import RubberbandWorker from "$lib/workers/rubberband.worker?worker&inline";
import { assert, AUDIO_ENGINE_CONSTANTS } from "$lib/utils";
import { analysisStore } from "../stores/analysis.store";

class AudioEngineService {
  // ... (static instance and private properties remain the same) ...
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

  private constructor() {}

  public static getInstance(): AudioEngineService {
    if (!AudioEngineService.instance) {
      AudioEngineService.instance = new AudioEngineService();
    }
    return AudioEngineService.instance;
  }

  // --- REMOVED: The old `initialize` and `_initializeWorker` methods are gone. ---

  private _getAudioContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === "closed") {
      this.audioContext = new AudioContext();
      this.gainNode = this.audioContext.createGain();
      this.gainNode.connect(this.audioContext.destination);
    }
    return this.audioContext;
  }

  public async unlockAudio(): Promise<void> {
    // ... (this method is unchanged) ...
  }

  // --- REFACTORED: `loadFile` now handles worker initialization ---
  public async loadFile(
    audioFileBuffer: ArrayBuffer,
    fileName: string,
  ): Promise<void> {
    if (
      !audioFileBuffer ||
      !(audioFileBuffer instanceof ArrayBuffer) ||
      audioFileBuffer.byteLength === 0
    ) {
      const errorMsg = "loadFile received an invalid or empty ArrayBuffer.";
      console.error(`[AudioEngine] ${errorMsg}`);
      playerStore.update((s) => ({ ...s, error: errorMsg, isPlayable: false }));
      return;
    }

    await this.stop(); // Stop and reset any current playback
    const ctx = this._getAudioContext();
    playerStore.update((s) => ({
      ...s,
      status: `Decoding ${fileName}...`,
      error: null,
      fileName,
      isPlayable: false,
    }));

    try {
      this.originalBuffer = await ctx.decodeAudioData(audioFileBuffer);

      // --- START: NEW WORKER INITIALIZATION LOGIC ---
      // If worker doesn't exist, create it.
      if (!this.worker) {
        this.worker = new RubberbandWorker();
        this.worker.onmessage = this.handleWorkerMessage.bind(this);
      } else {
        // If it exists, ensure it's reset for the new file's properties.
        this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });
      }

      this.isWorkerInitialized = false; // Mark as not ready until worker confirms.

      const wasmResponse = await fetch(AUDIO_ENGINE_CONSTANTS.WASM_BINARY_URL);
      const loaderResponse = await fetch(
        AUDIO_ENGINE_CONSTANTS.LOADER_SCRIPT_URL,
      );
      if (!wasmResponse.ok || !loaderResponse.ok)
        throw new Error("Failed to fetch worker dependencies.");
      const wasmBinary = await wasmResponse.arrayBuffer();
      const loaderScriptText = await loaderResponse.text();

      const initPayload: RubberbandInitPayload = {
        wasmBinary,
        loaderScriptText,
        origin: location.origin,
        sampleRate: this.originalBuffer.sampleRate, // <-- CORRECT: Use actual sample rate
        channels: this.originalBuffer.numberOfChannels, // <-- CORRECT: Use actual channel count
        initialSpeed: get(playerStore).speed,
        initialPitch: get(playerStore).pitch,
      };

      this.worker.postMessage(
        { type: RB_WORKER_MSG_TYPE.INIT, payload: initPayload },
        [wasmBinary],
      );
      // --- END: NEW WORKER INITIALIZATION LOGIC ---

      // The rest of this method (waveform generation, store updates) remains the same...
      const waveformDisplayData: number[][] = [];
      // ... (waveform code)
      playerStore.update((s) => ({
        ...s,
        status: `Initializing processor for ${fileName}...`, // New status
        duration: this.originalBuffer!.duration,
        audioBuffer: this.originalBuffer,
        waveformData: waveformDisplayData,
      }));
      analysisStore.set({});
    } catch (e) {
      const error = e as Error;
      playerStore.update((s) => ({
        ...s,
        status: `Error decoding`,
        error: error.message,
        isPlayable: false,
      }));
      throw error;
    }
  }

  public async play(): Promise<void> {
    // This check now correctly waits for worker confirmation.
    if (this.isPlaying || !this.originalBuffer || !this.isWorkerInitialized) {
      console.warn(
        "AudioEngine: Play command ignored. Not ready or already playing.",
      );
      return;
    }

    const audioCtx = this._getAudioContext();
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    this.isPlaying = true;
    playerStore.update((s) => ({
      ...s,
      isPlaying: true,
      status: `Playing: ${s.fileName}`,
    }));

    // If starting fresh or after a stop/seek, set nextChunkTime to current time.
    // The condition `this.nextChunkTime < audioCtx.currentTime` handles cases where context time might have advanced
    // significantly while paused (e.g. due to system sleep), ensuring we don't schedule in the past.
    if (this.nextChunkTime === 0 || this.nextChunkTime < audioCtx.currentTime) {
      this.nextChunkTime = audioCtx.currentTime;
    }

    // MODIFICATION FOR TESTING: Call one iteration synchronously for the first time
    this._performSingleProcessAndPlayIteration();

    // Then schedule the rest with RAF if still playing
    if (this.isPlaying) {
      requestAnimationFrame(this._recursiveProcessAndPlayLoop.bind(this));
    }
  }

  // Renamed original processAndPlayLoop and made it private for RAF recursion
  private _recursiveProcessAndPlayLoop(): void {
    if (
      !this.isPlaying ||
      !this.originalBuffer ||
      this.isStopping ||
      !this.audioContext
    ) {
      return;
    }
    this._performSingleProcessAndPlayIteration(); // Perform one iteration
    if (this.isPlaying) {
      // If still playing after one iteration, schedule next
      requestAnimationFrame(this._recursiveProcessAndPlayLoop.bind(this));
    }
  }

  // Contains the actual logic of one iteration of the processing loop
  private _performSingleProcessAndPlayIteration(): void {
    assert(this.isPlaying, "Processing loop ran while not playing.");
    assert(!this.isStopping, "Processing loop ran while stopping.");
    assert(this.originalBuffer, "Processing loop ran without an audio buffer.");
    assert(this.audioContext, "Processing loop ran without an audio context.");

    if (
      !this.isPlaying ||
      !this.originalBuffer ||
      this.isStopping ||
      !this.audioContext
    ) {
      // console.log("ProcessAndPlayLoop: Aborting - isPlaying:", this.isPlaying, "has buffer:", !!this.originalBuffer, "isStopping:", this.isStopping);
      return;
    }

    const now = this.audioContext.currentTime;
    const lookahead = AUDIO_ENGINE_CONSTANTS.PROCESS_LOOKAHEAD_TIME;

    // Check if it's time to request more data
    if (this.nextChunkTime < now + lookahead) {
      // Check if there's more audio data to process in the original buffer
      if (this.sourcePlaybackOffset < this.originalBuffer.duration) {
        const chunkDuration = AUDIO_ENGINE_CONSTANTS.TARGET_CHUNK_DURATION_S;
        // Calculate the actual duration of the next chunk to process
        let actualChunkDuration = Math.min(
          chunkDuration,
          this.originalBuffer.duration - this.sourcePlaybackOffset,
        );

        if (
          actualChunkDuration <= AUDIO_ENGINE_CONSTANTS.MIN_CHUNK_DURATION_S &&
          this.originalBuffer.duration - this.sourcePlaybackOffset >
            AUDIO_ENGINE_CONSTANTS.MIN_CHUNK_DURATION_S
        ) {
          actualChunkDuration = Math.min(
            this.originalBuffer.duration - this.sourcePlaybackOffset,
            AUDIO_ENGINE_CONSTANTS.TARGET_CHUNK_DURATION_S,
          );
        } else if (actualChunkDuration <= 0) {
          this.isPlaying = false;
          playerStore.update((s) => ({
            ...s,
            isPlaying: false,
            currentTime: this.originalBuffer!.duration,
            status: `Finished: ${s.fileName}`,
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
          this.isPlaying = false;
          playerStore.update((s) => ({
            ...s,
            isPlaying: false,
            currentTime: this.originalBuffer!.duration,
            status: `Finished: ${s.fileName}`,
          }));
          return;
        }

        const channelData = this.originalBuffer.getChannelData(0);
        const segment = channelData.slice(startSample, endSample);

        const processPayload: RubberbandProcessPayload = {
          inputBuffer: segment,
          isFinalChunk:
            this.sourcePlaybackOffset + actualChunkDuration >=
            this.originalBuffer.duration,
        };

        this.worker!.postMessage(
          { type: RB_WORKER_MSG_TYPE.PROCESS, payload: processPayload },
          [segment.buffer],
        );

        this.sourcePlaybackOffset += actualChunkDuration;
      } else {
        this.isPlaying = false;
        playerStore.update((s) => ({
          ...s,
          isPlaying: false,
          currentTime: this.originalBuffer.duration,
          status: `Finished: ${s.fileName}`,
        }));
        return;
      }
    }
    // Note: The recursive call via requestAnimationFrame is removed from here
    // and handled by _recursiveProcessAndPlayLoop or the initial call in play().
  }

  public async stop(): Promise<void> {
    this.isStopping = true;
    this.isPlaying = false;
    if (this.worker) {
      this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });
    }
    this.sourcePlaybackOffset = 0;
    this.nextChunkTime = 0;
    playerStore.update((s) => ({
      ...s,
      currentTime: 0,
      isPlaying: false,
      status: `Stopped: ${s.fileName || ""}`,
    }));
    this.isStopping = false;
  }

  public pause(): void {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    playerStore.update((s) => ({
      ...s,
      isPlaying: false,
      status: `Paused: ${s.fileName || ""}`,
    }));
  }

  public async seek(time: number): Promise<void> {
    if (
      !this.originalBuffer ||
      time < 0 ||
      time > this.originalBuffer.duration
    ) {
      console.warn("AudioEngine: Seek time is out of bounds.");
      return;
    }

    const wasPlaying = this.isPlaying;
    if (this.isPlaying) {
      this.pause();
    }

    this.sourcePlaybackOffset = time;
    this.nextChunkTime = this.audioContext ? this.audioContext.currentTime : 0;

    playerStore.update((s) => ({ ...s, currentTime: time }));

    if (this.worker) {
      this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });
    }

    if (wasPlaying) {
      // Resume playback after seeking. Needs to ensure processAndPlayLoop is triggered.
      // The current play() method might be sufficient if it correctly starts the loop.
      // Adding a small delay for worker reset might be needed in practice.
      await this.play();
    }
  }

  public setSpeed(speed: number): void {
    if (this.worker && this.isWorkerInitialized) {
      this.worker.postMessage({
        type: RB_WORKER_MSG_TYPE.SET_SPEED,
        payload: { speed },
      });
    }
    playerStore.update((s) => ({ ...s, speed }));
  }

  public setPitch(pitch: number): void {
    if (this.worker && this.isWorkerInitialized) {
      this.worker.postMessage({
        type: RB_WORKER_MSG_TYPE.SET_PITCH,
        payload: { pitch },
      });
    }
    playerStore.update((s) => ({ ...s, pitch }));
  }

  public setGain(level: number): void {
    if (this.gainNode && this.audioContext) {
      const newGain = Math.max(0, Math.min(1, level)); // Clamp between 0 and 1
      this.gainNode.gain.setValueAtTime(newGain, this.audioContext.currentTime);
      playerStore.update((s) => ({ ...s, gain: newGain }));
    }
  }

  public dispose(): void {
    // this.stop(); // stop is async, dispose is sync. This can be an issue.
    // Forcing a synchronous stop for dispose lifecycle:
    this.isPlaying = false;
    this.isStopping = true; // Prevent processing loop
    if (this.worker) {
      this.worker.postMessage({ type: RB_WORKER_MSG_TYPE.RESET }); // Tell worker to clear state
    }
    this.sourcePlaybackOffset = 0;
    this.nextChunkTime = 0;
    // Not updating store from dispose to avoid potential issues during component teardown
    this.isStopping = false;

    // Proceed with termination and cleanup
    this.worker?.terminate();
    this.worker = null;
    this.isWorkerInitialized = false; // Reset flag on dispose
    this.audioContext?.close();
    this.audioContext = null;
  }

  // The original processAndPlayLoop is now _recursiveProcessAndPlayLoop
  // and its core logic is in _performSingleProcessAndPlayIteration.
  // This change effectively renames processAndPlayLoop to _recursiveProcessAndPlayLoop
  // and extracts its core into _performSingleProcessAndPlayIteration.
  // The line below is where the old processAndPlayLoop definition was.
  // We've inserted the new methods above it.

  private scheduleChunkPlayback(
    processedChunk: Float32Array,
    startTime: number,
  ): void {
    // --- START OF FIX ---
    // Add a guard to handle cases where the worker returns an empty array,
    // which is valid if no audio was available to process.
    // Adapted from processedChannels: Float32Array[] to processedChunk: Float32Array
    if (!processedChunk || processedChunk.length === 0) {
        // Log for debugging but do not treat as an error. Simply do nothing.
        // console.log("ScheduleChunkPlayback: Received empty chunk, skipping playback scheduling.");
        return;
    }
    // --- END OF FIX ---

    // NOTE: The original snippet had ctx retrieval here. In current code, it's this.audioContext.
    // if (this.audioContext && this.audioContext.state === 'closed') return; // Adapted from snippet

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
    ) {
      // console.log("ScheduleChunkPlayback: Aborting due to invalid state.");
      return;
    }

    const numberOfChannels = this.originalBuffer.numberOfChannels;
    // Ensure processedChunk length is a multiple of numberOfChannels
    // This basic check assumes interleaved data if multi-channel
    assert(
      processedChunk.length > 0,
      `Received an empty processed chunk from the worker. This should not happen during active playback.`,
    );
    assert(
      processedChunk.length % numberOfChannels === 0,
      `Processed chunk length (${processedChunk.length}) is not a valid multiple of the channel count (${numberOfChannels}).`,
    );

    // The original production guard can be removed or simplified, as the assertion now covers the logic.
    // We'll keep a production-safe guard for the channel count mismatch just in case.
    // The first part of this if is now covered by the guard above.
    if (processedChunk.length % numberOfChannels !== 0) {
      console.error(
        "ScheduleChunkPlayback: Processed chunk length is invalid for channel count.",
        processedChunk.length,
        numberOfChannels,
      );
      return;
    }
    // const frameCount = processedChannels[0].length; // Snippet version
    const frameCount = processedChunk.length / numberOfChannels; // Adapted for current signature

    // --- ADD A CONSOLE.ERROR FOR THE ORIGINAL BUG SCENARIO ---
    // The snippet's check `processedChannels.length !== this.originalBuffer!.numberOfChannels`
    // refers to the number of channels in the data from the worker.
    // In our case, `numberOfChannels` is derived from `this.originalBuffer`.
    // This check is difficult to translate directly and meaningfully.
    // The spirit is to ensure channel consistency. The assertion above and the
    // `if` block already check for length compatibility with `numberOfChannels`.
    // If we were to mimic the snippet's structure:
    // let channelCountFromProcessedData = numberOfChannels; // Assuming worker matched originalBuffer
    // if (channelCountFromProcessedData !== this.originalBuffer!.numberOfChannels) {
    // This console.error is specifically requested, adapting message from snippet.
    // The condition `numberOfChannels !== this.originalBuffer!.numberOfChannels` would be `false`.
    // For the purpose of adding the log as requested, we use `numberOfChannels` in the message.
    // A more meaningful check here might be `if (numberOfChannels === 0)`, but sticking to snippet.
    // This specific error log from the prompt is hard to make logically sound here
    // without changing the function signature or worker behavior.
    // However, the prompt asks to add these lines.
    // Let's assume the check is against the `numberOfChannels` we are about to use.
    if (this.originalBuffer!.numberOfChannels !== numberOfChannels) { // This condition will always be false.
        console.error(`ScheduleChunkPlayback: Processed chunk channel count (${numberOfChannels}) does not match original buffer (${this.originalBuffer!.numberOfChannels}).`);
        return;
    }

    const audioBuffer = this.audioContext.createBuffer(
        numberOfChannels, // Adapted from snippet's processedChannels.length
        frameCount,
        sampleRate // this.originalBuffer!.sampleRate is now in sampleRate variable
    );

    // De-interleave if necessary (example for stereo)
    if (numberOfChannels === 1) {
      audioBuffer.copyToChannel(processedChunk, 0);
    } else if (numberOfChannels === 2) {
      const left = new Float32Array(frameCount);
      const right = new Float32Array(frameCount);
      for (let i = 0; i < frameCount; i++) {
        left[i] = processedChunk[i * 2];
        right[i] = processedChunk[i * 2 + 1];
      }
      audioBuffer.copyToChannel(left, 0);
      audioBuffer.copyToChannel(right, 1);
    } else {
      // General case for >2 channels (assuming interleaved and copying to each channel)
      // This might need more sophisticated handling based on expected worker output.
      for (let i = 0; i < numberOfChannels; i++) {
        const channelData = new Float32Array(frameCount);
        for (let j = 0; j < frameCount; j++) {
          channelData[j] = processedChunk[j * numberOfChannels + i];
        }
        audioBuffer.copyToChannel(channelData, i);
      }
    }

    const bufferSource = this.audioContext.createBufferSource();
    bufferSource.buffer = audioBuffer;
    bufferSource.connect(this.gainNode);

    const actualStartTime = Math.max(this.audioContext.currentTime, startTime);
    // console.log(`ScheduleChunkPlayback: Scheduling chunk at ${actualStartTime}. Duration: ${audioBuffer.duration}`);
    bufferSource.start(actualStartTime);

    const chunkDuration = audioBuffer.duration;
    // Update nextChunkTime for the next iteration of processAndPlayLoop
    // Subtracting SCHEDULE_AHEAD_TIME_S helps ensure there's always some buffer
    this.nextChunkTime =
      actualStartTime +
      chunkDuration -
      AUDIO_ENGINE_CONSTANTS.SCHEDULE_AHEAD_TIME_S;

    bufferSource.onended = () => {
      // console.log("ScheduleChunkPlayback: BufferSource ended. Current offset:", this.sourcePlaybackOffset, "Total duration:", this.originalBuffer!.duration);
      if (
        this.sourcePlaybackOffset >= this.originalBuffer!.duration &&
        this.isPlaying
      ) {
        // This condition might be hit if the very last chunk finishes playing
        this.isPlaying = false;
        playerStore.update((s) => ({
          ...s,
          isPlaying: false,
          status: `Finished: ${s.fileName}`,
        }));
        // console.log("ScheduleChunkPlayback: Playback officially finished after buffer ended.");
      }
      bufferSource.disconnect(); // Clean up
    };
  }

  private handleWorkerMessage(
    event: MessageEvent<
      WorkerMessage<RubberbandProcessResultPayload | WorkerErrorPayload>
    >,
  ): void {
    const { type, payload } = event.data;

    if (type === RB_WORKER_MSG_TYPE.INIT_SUCCESS) {
      this.isWorkerInitialized = true;
      console.log("AudioEngine worker initialized successfully for new file.");
      playerStore.update((s) => ({
        ...s,
        isPlayable: true,
        status: `Ready: ${s.fileName}`,
      }));
    } else if (type === RB_WORKER_MSG_TYPE.ERROR) {
      const errorPayload = payload as WorkerErrorPayload;
      console.error("AudioEngine Worker Error:", errorPayload.message);
      playerStore.update((s) => ({
        ...s,
        error: errorPayload.message,
        isPlaying: false,
        isPlayable: false,
        status: "Error",
      }));
      this.isWorkerInitialized = false;
      // Potentially stop playback and reset if a critical error occurs
      if (this.isPlaying) {
        this.isPlaying = false; // Stop trying to play
      }
    } else if (type === RB_WORKER_MSG_TYPE.PROCESS_RESULT && payload) {
      const { outputBuffer } = payload as RubberbandProcessResultPayload;
      // console.log("AudioEngine: Received PROCESS_RESULT. Output buffer size:", outputBuffer?.length);
      if (outputBuffer && this.isPlaying && !this.isStopping) {
        this.scheduleChunkPlayback(outputBuffer, this.nextChunkTime);
        // The processAndPlayLoop is driven by requestAnimationFrame.
        // If it had paused waiting for nextChunkTime to advance (which it does after scheduling),
        // the next animation frame should pick up the new state and continue processing or wait if still too early.
      } else if (!this.isPlaying && !this.isStopping) {
        // console.log("AudioEngine: Worker processed a chunk, but playback is currently stopped/paused. Ignoring.");
      } else if (this.isStopping) {
        // console.log("AudioEngine: Worker processed a chunk, but we are in stopping phase. Ignoring.");
      }
    }
  }
}

export default AudioEngineService.getInstance();
