// vibe-player-v2.3/src/lib/services/AudioOrchestrator.service.ts
import { get } from "svelte/store";
import { playerStore } from "$lib/stores/player.store";
import { timeStore } from "$lib/stores/time.store"; // NEW
import { statusStore } from "$lib/stores/status.store";
import { analysisStore } from "$lib/stores/analysis.store";
import audioEngine from "./audioEngine.service";
import dtmfService from "./dtmf.service";
import spectrogramService from "./spectrogram.service";
import { debounce } from "$lib/utils/async";
import { updateUrlWithParams } from "$lib/utils/urlState";
import { UI_CONSTANTS, URL_HASH_KEYS, type Status } from "$lib/utils/constants"; // Added Status type

export class AudioOrchestrator {
  private static instance: AudioOrchestrator;
  private isBusy = false; // Prevents re-entrancy

  private constructor() {}

  public static getInstance(): AudioOrchestrator {
    if (!AudioOrchestrator.instance) {
      AudioOrchestrator.instance = new AudioOrchestrator();
    }
    return AudioOrchestrator.instance;
  }

  private async _processAudioBuffer(
    buffer: ArrayBuffer,
    name: string,
  ): Promise<void> {
    statusStore.set({
      message: `Decoding audio: ${name}...`,
      type: "info",
      isLoading: true,
    });
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await audioEngine.decodeAudioData(buffer);
    } catch (e: any) {
      console.error("Error decoding audio data:", e);
      this.handleError(
        new Error(
          `Failed to decode audio: ${e.message || "Unknown decoding error"}`,
        ),
      );
      throw e; // Re-throw to be caught by loadFileAndAnalyze
    }

    statusStore.set({
      message: `Initializing audio engine for ${name}...`,
      type: "info",
      isLoading: true,
    });
    try {
      await audioEngine.initializeWorker(audioBuffer);
    } catch (e: any) {
      console.error("Error initializing worker:", e);
      this.handleError(
        new Error(
          `Failed to initialize audio engine: ${e.message || "Unknown worker init error"}`,
        ),
      );
      throw e; // Re-throw to be caught by loadFileAndAnalyze
    }

    playerStore.update((s) => ({
      ...s,
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      channels: audioBuffer.numberOfChannels,
      fileName: name,
      isPlayable: true,
      audioBuffer: audioBuffer, // Store the buffer if needed for direct use later (e.g. re-analysis)
      error: null, // Clear previous errors
    }));
    timeStore.set(0); // Reset time for the new audio

    statusStore.set({
      isLoading: false,
      message: `Ready: ${name}`,
      type: "success",
    });

    // Run background analysis without awaiting it, as it's a secondary task.
    this._runBackgroundAnalysis(audioBuffer, name);
  }

  private _runBackgroundAnalysis(audioBuffer: AudioBuffer, fileName: string) {
    // Ensure services are initialized with the correct sample rate for the new audio.
    // This might involve re-initialization if sample rates can change between files.
    dtmfService.initialize(audioBuffer.sampleRate);
    spectrogramService.initialize({ sampleRate: audioBuffer.sampleRate });

    // Reset previous analysis results for the new file
    analysisStore.update((s) => ({
      ...s,
      dtmfResults: [],
      spectrogramData: null,
      // Potentially link analysis to the specific fileName if results are cached/compared
    }));

    console.log(`Starting background analysis for ${fileName}`);
    Promise.allSettled([
      dtmfService.process(audioBuffer),
      // Assuming spectrogram processes the first channel, or mono.
      // If stereo processing is needed, this might need adjustment.
      spectrogramService.process(audioBuffer.getChannelData(0)),
    ]).then((results) => {
      console.log(`Background analysis finished for ${fileName}`);
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          const serviceName =
            index === 0 ? "DTMF analysis" : "Spectrogram analysis";
          console.error(
            `${serviceName} for ${fileName} failed:`,
            result.reason,
          );
          // Optionally, update statusStore or a dedicated analysis error store here.
          // statusStore.set({
          //     message: `${serviceName} failed: ${result.reason?.message || 'Unknown error'}`,
          //     type: 'warning',
          //     isLoading: false
          // });
        }
      });
    });
  }

  public async loadFileAndAnalyze(file: File): Promise<void> {
    if (this.isBusy) {
      console.warn(
        `AudioOrchestrator is busy, skipping loadFileAndAnalyze for: ${file.name}`,
      );
      statusStore.set({
        message: `Player is busy. Please wait.`,
        type: "warning",
        isLoading: true,
      });
      return;
    }
    this.isBusy = true;

    statusStore.set({
      message: `Loading ${file.name}...`,
      type: "info",
      isLoading: true,
    });
    // Comprehensive reset of player and analysis states before loading a new file
    await audioEngine.stop(); // Stop any current playback immediately

    playerStore.update((s) => ({
      ...initialState, // Reset to initial state
      fileName: file.name, // Set the new file name
      status: "loading", // Set status to loading
    }));
    analysisStore.update((s) => ({
      ...s,
      dtmfResults: [],
      spectrogramData: null,
    })); // Clear analysis
    timeStore.set(0); // Reset time

    try {
      await audioEngine.unlockAudio(); // Ensure AudioContext is resumed
      const arrayBuffer = await file.arrayBuffer();
      await this._processAudioBuffer(arrayBuffer, file.name);
      this.updateUrlFromState(); // Update URL once successfully loaded
    } catch (e: any) {
      // Error handling is now more centralized in _processAudioBuffer or handleError
      // No need to set statusStore here if handleError already does it.
      // Ensure isPlayable is false on any critical load error.
      playerStore.update((s) => ({ ...s, isPlayable: false, status: "error" }));
    } finally {
      this.isBusy = false;
      // Final status update based on outcome
      const currentStatus = get(statusStore);
      if (currentStatus.isLoading && currentStatus.type !== "error") {
        // If still loading and no error, means something went wrong if not set by _processAudioBuffer
        // This case should ideally be handled by explicit error throws in _processAudioBuffer
      } else if (
        !get(playerStore).isPlayable &&
        currentStatus.type !== "error"
      ) {
        // If not playable and not already an error, set a generic error.
        // This might be redundant if errors are always propagated correctly.
        // statusStore.set({ isLoading: false, message: `Failed to prepare ${file.name}`, type: 'error' });
      }
    }
  }

  public updateUrlFromState = (): void => {
    if (typeof window === "undefined") return;

    const pStore = get(playerStore);
    // analysisStore is not used for URL params in this version
    // const aStore = get(analysisStore);
    const tStore = get(timeStore);

    const params: Record<string, string> = {};

    // Only add params if they are meaningful / non-default
    if (pStore.fileName && pStore.isPlayable) {
      // Only add file if playable
      // params[URL_HASH_KEYS.FILE_URL] = pStore.fileUrl; // Assuming you might have a direct URL in future
      // For now, we don't have a URL to store from local file.
      // If loading from URL becomes a feature, this would be relevant.
    }
    if (pStore.speed !== 1.0)
      params[URL_HASH_KEYS.SPEED] = pStore.speed.toFixed(2);
    if (pStore.pitchShift !== 0.0)
      params[URL_HASH_KEYS.PITCH] = pStore.pitchShift.toFixed(2);
    if (pStore.gain !== 1.0)
      params[URL_HASH_KEYS.GAIN] = pStore.gain.toFixed(2);

    // Only include time if it's significant and the track is playable
    if (pStore.isPlayable && tStore > 0.1 && tStore < pStore.duration - 0.1) {
      params[URL_HASH_KEYS.TIME] = tStore.toFixed(2);
    }

    updateUrlWithParams(params);
  };

  public setupUrlSerialization(): void {
    if (typeof window === "undefined") return;

    // Debounced updater to prevent rapid URL changes from store subscriptions
    const debouncedUpdater = debounce(
      this.updateUrlFromState,
      UI_CONSTANTS.DEBOUNCE_HASH_UPDATE_MS,
    );

    // Subscribe only to relevant changes in playerStore that should affect the URL
    playerStore.subscribe(
      ({ speed, pitchShift, gain, fileName, isPlayable, duration }) => {
        // Call the debounced updater. It will internally get the latest store values.
        // This ensures that any of these critical parameter changes trigger a URL update.
        // The actual check for default values is inside updateUrlFromState.
        if (isPlayable) {
          // Only update URL if a track is considered playable
          debouncedUpdater();
        } else {
          // If not playable (e.g., after stop or error), clear URL params or set to a base state
          updateUrlWithParams({}); // Clears all managed parameters
        }
      },
    );

    // timeStore updates are handled by explicit calls in audioEngine.seek() and when playback stops.
    // Subscribing directly to timeStore for URL updates would be too frequent during playback.
    // analysisStore changes do not affect the URL in this design.
  }

  /**
   * Centralized error handler for the orchestrator.
   * Updates status store and player store to reflect an error state.
   * @param error The error object or a string message.
   */
  public handleError(error: Error | string): void {
    const errorMessage = typeof error === "string" ? error : error.message;
    console.error("[AudioOrchestrator] Handling error:", errorMessage, error);

    statusStore.set({
      message: `Error: ${errorMessage}`,
      type: "error",
      isLoading: false,
    });

    playerStore.update((s) => ({
      ...s,
      error: errorMessage,
      isPlaying: false, // Stop playback on error
      isPlayable: false, // Mark as not playable
      status: "error",
    }));

    // It might be prudent to also call audioEngine.stop() here
    // to ensure all audio processes are halted.
    audioEngine.stop();
    this.updateUrlFromState(); // Update URL to reflect error state (e.g., remove time)
  }
}

// Adding the initial state for playerStore here for clarity, as it's used in loadFileAndAnalyze reset
const initialState: PlayerState = {
  status: "idle",
  fileName: null,
  duration: 0,
  currentTime: 0,
  isPlaying: false,
  isPlayable: false,
  speed: 1.0,
  pitchShift: 0.0,
  gain: 1.0,
  waveformData: undefined,
  error: null,
  audioBuffer: undefined,
  audioContextResumed: false,
  channels: undefined,
  sampleRate: undefined,
  lastProcessedChunk: undefined,
};

// Exporting PlayerState type if it's defined in player.types.ts and used here often
import type { PlayerState } from "$lib/types/player.types";

export default AudioOrchestrator.getInstance();
