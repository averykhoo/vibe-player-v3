// vibe-player-v2.3/src/lib/services/AudioOrchestrator.service.ts
import { get } from "svelte/store";
import { playerStore } from "$lib/stores/player.store";
import { timeStore } from "$lib/stores/time.store";
import { statusStore } from "$lib/stores/status.store";
import { analysisStore } from "$lib/stores/analysis.store";
import audioEngine from "./audioEngine.service";
import dtmfService from "./dtmf.service";
import spectrogramService from "./spectrogram.service";
import { debounce } from "$lib/utils/async";
import { updateUrlWithParams } from "$lib/utils/urlState";
import {
  UI_CONSTANTS,
  URL_HASH_KEYS,
  VISUALIZER_CONSTANTS,
} from "$lib/utils/constants";
import type { PlayerState } from "$lib/types/player.types";
import { createWaveformData } from "$lib/utils/waveform";

// A snapshot of the initial player state.
// Used to reset the playerStore to a clean slate when a new file is loaded.
const initialPlayerStateSnapshot: PlayerState = {
  status: "idle",
  fileName: null,
  duration: 0,
  currentTime: 0,
  isPlaying: false,
  isPlayable: false,
  speed: 1.0,
  pitchShift: 0.0,
  gain: 1.0,
  waveformData: undefined, // Waveform data is cleared on new file load
  error: null,
  audioBuffer: undefined, // AudioBuffer is cleared on new file load
  audioContextResumed: false,
  channels: undefined,
  sampleRate: undefined,
  lastProcessedChunk: undefined, // Cleared on new file load
};

/**
 * Helper function to prepare a state object for logging.
 * It omits or summarizes large data fields like waveformData and audioBuffer
 * to prevent cluttering the console.
 * @param state The state object to prepare.
 * @returns A new object with large fields summarized.
 */
const prepareStateForLog = (state: any) => {
  // Destructure to separate large fields from the rest of the state
  const { waveformData, audioBuffer, lastProcessedChunk, ...rest } = state;
  return {
    ...rest, // Keep all other properties
    // Summarize waveformData: show number of channels and points if it exists
    waveformData: waveformData
      ? `[${waveformData.length}ch, ${waveformData[0]?.length || 0}pts]`
      : undefined,
    // Indicate if an AudioBuffer is present without logging its content
    audioBuffer: audioBuffer ? `[AudioBuffer Present]` : undefined,
    // Indicate if a lastProcessedChunk is present
    lastProcessedChunk: lastProcessedChunk ? `[Chunk Present]` : undefined,
  };
};

/**
 * @class AudioOrchestrator
 * @description A singleton service that orchestrates the entire audio loading,
 * analysis, and playback pipeline. It coordinates interactions between various
 * stores and services (AudioEngine, DTMF, Spectrogram).
 */
export class AudioOrchestrator {
  private static instance: AudioOrchestrator;
  private isBusy = false; // Flag to prevent concurrent loading operations

  private constructor() {
    console.log("[AO-LOG] AudioOrchestrator constructor: Instance created.");
  }

  /**
   * Gets the singleton instance of the AudioOrchestrator.
   * @returns {AudioOrchestrator} The singleton instance.
   */
  public static getInstance(): AudioOrchestrator {
    if (!AudioOrchestrator.instance) {
      console.log(
        "[AO-LOG] AudioOrchestrator.getInstance: Creating new instance.",
      );
      AudioOrchestrator.instance = new AudioOrchestrator();
    }
    return AudioOrchestrator.instance;
  }

  /**
   * Main method to load an audio file and initiate analysis.
   * This method manages the entire lifecycle from file selection to readiness for playback and analysis.
   * @param file The audio File object selected by the user.
   * @param initialState Optional initial player state values, typically from URL parameters.
   */
  public async loadFileAndAnalyze(
    file: File,
    initialState?: Partial<PlayerState>,
  ): Promise<void> {
    console.log(
      `[AO-LOG] loadFileAndAnalyze: Entered. File: ${file?.name}, Received initialState:`,
      // Use helper to log initial state without large data
      initialState
        ? JSON.stringify(prepareStateForLog(initialState))
        : "undefined",
    );

    // Prevent processing if already busy with another file
    if (this.isBusy) {
      console.warn(
        "[AO-LOG] loadFileAndAnalyze: Orchestrator is busy, skipping file load.",
      );
      return;
    }
    this.isBusy = true; // Set busy flag
    console.log(
      `[AO-LOG] loadFileAndAnalyze: Orchestrator is now BUSY. Loading file: ${file.name}`,
    );

    // Update global status store to indicate loading
    statusStore.set({
      message: `Loading ${file.name}...`,
      type: "info",
      isLoading: true,
    });
    console.log(
      `[AO-LOG] loadFileAndAnalyze: StatusStore updated to loading for ${file.name}.`,
    );

    try {
      // --- STAGE 1: PRE-PROCESSING & STATE RESET ---
      // Ensures a clean state before processing the new file.
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 1 - Resetting state and stopping audio.",
      );
      await audioEngine.stop(); // Stop any ongoing playback
      console.log("[AO-LOG] loadFileAndAnalyze: audioEngine.stop() completed.");

      // Reset playerStore to its initial state, keeping the new file name and loading status
      playerStore.update((s) => {
        console.log(
          "[AO-LOG] loadFileAndAnalyze: playerStore.update (resetting). Current state before reset:",
          JSON.stringify(prepareStateForLog(s)), // Log summarized state
        );
        const newState = {
          ...initialPlayerStateSnapshot, // Use the clean snapshot
          fileName: file.name,
          status: "loading",
          waveformData: undefined,
        };
        console.log(
          "[AO-LOG] loadFileAndAnalyze: playerStore.update (resetting). New state after reset:",
          JSON.stringify(prepareStateForLog(newState)), // Log summarized state
        );
        return newState;
      });

      // Reset analysisStore and timeStore
      analysisStore.update((s) => {
        console.log(
          "[AO-LOG] loadFileAndAnalyze: analysisStore.update (resetting).",
        );
        return { ...s, dtmfResults: [], spectrogramData: null };
      });
      timeStore.set(0);
      console.log("[AO-LOG] loadFileAndAnalyze: timeStore set to 0.");

      // Attempt to unlock the AudioContext (fire-and-forget, doesn't block loading)
      // This is crucial for browsers that require user interaction to start audio.
      audioEngine.unlockAudio();
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 1 - audioEngine.unlockAudio() attempt initiated (not awaited).",
      );
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 1 - State reset complete.",
      );

      // --- STAGE 2: CORE AUDIO DECODING & VISUALS PREPARATION ---
      // Decode the audio file into an AudioBuffer and prepare initial visual data.
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 2 - Decoding audio data...",
      );
      statusStore.set({
        message: `Processing ${file.name}...`, // Update status message
        type: "info",
        isLoading: true,
      });
      const arrayBuffer = await file.arrayBuffer(); // Get file content as ArrayBuffer
      console.log(
        `[AO-LOG] loadFileAndAnalyze: STAGE 2 - file.arrayBuffer() completed. Byte length: ${arrayBuffer.byteLength}`,
      );
      const audioBuffer = await audioEngine.decodeAudioData(arrayBuffer); // Decode using AudioEngine
      console.log(
        `[AO-LOG] loadFileAndAnalyze: STAGE 2 - Audio decoded. Duration: ${audioBuffer.duration.toFixed(2)}s`,
      );

      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 2 - Generating waveform data...",
      );
      const waveformData = createWaveformData(
        // Generate downsampled waveform data
        audioBuffer,
        VISUALIZER_CONSTANTS.SPEC_FIXED_WIDTH, // Target number of points for the waveform
      );
      console.log(
        `[AO-LOG] loadFileAndAnalyze: STAGE 2 - Waveform data generated with ${waveformData[0]?.length || 0} points.`,
      );

      // --- STAGE 3: INITIALIZE ALL BACKGROUND SERVICES IN PARALLEL ---
      // Services like audio processing (Rubberband) and analysis (DTMF, Spectrogram) are initialized.
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 3 - Initializing all services in parallel...",
      );
      // Promise.allSettled allows all initializations to attempt, even if some fail.
      const initResults = await Promise.allSettled([
        audioEngine.initializeWorker(audioBuffer), // Initialize Rubberband worker
        dtmfService.initialize(16000), // Initialize DTMF worker (16kHz standard)
        spectrogramService.initialize({ sampleRate: audioBuffer.sampleRate }), // Initialize Spectrogram worker
      ]);
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 3 - All service initializations have settled.",
      );

      // Check results of service initializations
      if (initResults[0].status === "rejected") {
        // AudioEngine is critical
        console.error(
          "[AO-LOG] loadFileAndAnalyze: STAGE 3 - CRITICAL FAILURE: AudioEngine worker could not initialize.",
          initResults[0].reason,
        );
        throw new Error("Failed to initialize core audio engine."); // This will be caught by the main catch block
      } else {
        console.log(
          "[AO-LOG] loadFileAndAnalyze: STAGE 3 - SUCCESS: AudioEngine worker initialized.",
        );
      }

      if (initResults[1].status === "rejected") {
        // DTMF is non-critical for basic playback
        console.warn(
          "[AO-LOG] loadFileAndAnalyze: STAGE 3 - NON-CRITICAL FAILURE: DTMF service could not initialize.",
          initResults[1].reason,
        );
      } else {
        console.log(
          "[AO-LOG] loadFileAndAnalyze: STAGE 3 - SUCCESS: DTMF service initialized.",
        );
      }

      if (initResults[2].status === "rejected") {
        // Spectrogram is non-critical
        console.warn(
          "[AO-LOG] loadFileAndAnalyze: STAGE 3 - NON-CRITICAL FAILURE: Spectrogram service could not initialize.",
          initResults[2].reason,
        );
      } else {
        console.log(
          "[AO-LOG] loadFileAndAnalyze: STAGE 3 - SUCCESS: Spectrogram service initialized.",
        );
      }

      // --- STAGE 4: FINALIZE PLAYER STATE & APPLY URL/INITIAL PARAMETERS ---
      // Update the playerStore with all decoded info and mark as playable.
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 4 - Finalizing player state.",
      );
      playerStore.update((s) => {
        console.log(
          "[AO-LOG] loadFileAndAnalyze: playerStore.update (finalizing). Current state before finalization:",
          JSON.stringify(prepareStateForLog(s)), // Log summarized state
        );
        const finalState = {
          ...s,
          duration: audioBuffer.duration,
          sampleRate: audioBuffer.sampleRate,
          channels: audioBuffer.numberOfChannels,
          isPlayable: true, // Core engine is ready, so mark as playable
          audioBuffer: audioBuffer, // Store the buffer (consider if this is too large for store long-term)
          error: null,
          status: "ready",
          waveformData: waveformData, // Add the generated waveform data
        };
        console.log(
          "[AO-LOG] loadFileAndAnalyze: playerStore.update (finalizing). New state after finalization:",
          JSON.stringify(prepareStateForLog(finalState)), // Log summarized state
        );
        return finalState;
      });

      // If initialState (from URL) was provided, merge it into the playerStore
      if (initialState && Object.keys(initialState).length > 0) {
        console.log(
          "[AO-LOG] loadFileAndAnalyze: STAGE 4 - Applying received initialState from URL/data.load:",
          JSON.stringify(prepareStateForLog(initialState)), // Log summarized initial state
        );
        playerStore.update((s) => {
          console.log(
            "[AO-LOG] loadFileAndAnalyze: playerStore.update (applying initialState). Current state before applying initialState:",
            JSON.stringify(prepareStateForLog(s)), // Log summarized current state
          );
          const mergedState = { ...s, ...initialState }; // Merge, initialState overrides
          console.log(
            "[AO-LOG] loadFileAndAnalyze: playerStore.update (applying initialState). New state after merging initialState:",
            JSON.stringify(prepareStateForLog(mergedState)), // Log summarized merged state
          );
          return mergedState;
        });
        // If a currentTime was provided in initialState, seek to it
        if (initialState.currentTime) {
          console.log(
            `[AO-LOG] loadFileAndAnalyze: STAGE 4 - Seeking to initial time: ${initialState.currentTime.toFixed(2)}s`,
          );
          audioEngine.seek(initialState.currentTime);
        }
      } else {
        console.log(
          "[AO-LOG] loadFileAndAnalyze: STAGE 4 - No initialState provided or it was empty.",
        );
      }

      // Update status store to indicate readiness
      statusStore.set({
        isLoading: false,
        message: `Ready: ${file.name}`,
        type: "success",
      });
      console.log(
        `[AO-LOG] loadFileAndAnalyze: StatusStore updated to ready for ${file.name}.`,
      );

      // Update the URL with the current player settings
      this.updateUrlFromState();
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 4 - Player is ready, initial URL update called.",
      );

      // --- STAGE 5: KICK OFF BACKGROUND ANALYSIS TASKS ---
      // These run in parallel and update their respective stores upon completion.
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 5 - Starting background analysis tasks.",
      );
      const analysisPromises = [];
      if (initResults[1].status === "fulfilled") {
        // If DTMF service initialized
        analysisPromises.push(dtmfService.process(audioBuffer));
        console.log(
          "[AO-LOG] loadFileAndAnalyze: STAGE 5 - Queued DTMF process.",
        );
      }
      if (initResults[2].status === "fulfilled") {
        // If Spectrogram service initialized
        analysisPromises.push(
          // Process only the first channel for spectrogram for simplicity
          spectrogramService.process(audioBuffer.getChannelData(0)),
        );
        console.log(
          "[AO-LOG] loadFileAndAnalyze: STAGE 5 - Queued Spectrogram process.",
        );
      }
      // Run analysis without awaiting, they operate in the background
      this._runBackgroundAnalysis(analysisPromises);
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 5 - Background analysis tasks dispatched.",
      );
    } catch (e: any) {
      // Catch any error from the stages above
      console.error(
        "[AO-LOG] loadFileAndAnalyze: Error during main try block.",
        e,
      );
      this.handleError(e); // Centralized error handling
    } finally {
      this.isBusy = false; // Release busy flag
      console.log(
        "[AO-LOG] loadFileAndAnalyze: Orchestrator is no longer busy. Method exit.",
      );
    }
  }

  /**
   * Helper to run background analysis tasks and log their outcomes.
   * @param analysisPromises Array of promises for analysis tasks.
   * @private
   */
  private _runBackgroundAnalysis(analysisPromises: Promise<any>[]) {
    console.log(
      `[AO-LOG] _runBackgroundAnalysis: Entered. Number of promises: ${analysisPromises.length}`,
    );
    if (analysisPromises.length === 0) {
      console.log(
        "[AO-LOG] _runBackgroundAnalysis: No analysis services were successfully initialized. Skipping background analysis.",
      );
      return;
    }

    // Log results of analysis tasks once they all settle
    Promise.allSettled(analysisPromises).then((results) => {
      console.log(
        `[AO-LOG] _runBackgroundAnalysis: All background analysis promises settled.`,
      );
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          // Determine service name based on order (adjust if more services added)
          const serviceName = index === 0 ? "DTMF" : "Spectrogram";
          console.error(
            `[AO-LOG] _runBackgroundAnalysis: ${serviceName} analysis failed:`,
            result.reason,
          );
        } else {
          const serviceName = index === 0 ? "DTMF" : "Spectrogram";
          console.log(
            `[AO-LOG] _runBackgroundAnalysis: ${serviceName} analysis successfully completed.`,
          );
        }
      });
    });
  }

  /**
   * Centralized error handler for critical loading/processing failures.
   * Updates stores to reflect the error state.
   * @param error The error object or message.
   */
  public handleError(error: Error | string): void {
    const errorMessage = typeof error === "string" ? error : error.message;
    console.error("[AO-LOG] handleError: Entered.", errorMessage, error);

    // Update status store to show error
    statusStore.set({
      message: `Error: ${errorMessage}`,
      type: "error",
      isLoading: false,
    });

    // Update player store to reflect error state
    playerStore.update((s) => {
      console.log("[AO-LOG] handleError: playerStore.update (on error).");
      return {
        ...s,
        error: errorMessage,
        isPlaying: false,
        isPlayable: false,
        status: "error",
      };
    });

    audioEngine.stop(); // Ensure playback is stopped
    this.updateUrlFromState(); // Update URL, likely to clear parameters on error
    console.log("[AO-LOG] handleError: Completed.");
  }

  /**
   * Debounced function to update the URL from the current application state.
   * This prevents excessive URL updates during rapid state changes (e.g., slider dragging).
   */
  private debouncedUrlUpdate = debounce(() => {
    console.log(
      `[AO-LOG] debouncedUrlUpdate: Debounced function EXECUTED. Calling updateUrlFromState.`,
    );
    this.updateUrlFromState();
  }, UI_CONSTANTS.DEBOUNCE_HASH_UPDATE_MS); // Debounce time from constants

  /**
   * Sets up subscriptions to relevant stores to trigger URL serialization
   * when their state changes.
   */
  public setupUrlSerialization(): void {
    console.log("[AO-LOG] setupUrlSerialization: Entered.");
    if (typeof window === "undefined") {
      // Guard for server-side rendering environments
      console.log("[AO-LOG] setupUrlSerialization: Not in browser, returning.");
      return;
    }
    // Subscribe to playerStore. When it changes and player is playable, trigger debounced URL update.
    playerStore.subscribe((s) => {
      console.log(
        `[AO-LOG] setupUrlSerialization: playerStore subscribed. Player playable: ${s.isPlayable}, Speed: ${s.speed}, Pitch: ${s.pitchShift}, Gain: ${s.gain}, CurrentTime (from playerStore): ${s.currentTime}. Debouncing URL update.`,
      );
      if (s.isPlayable) {
        console.log(
          "[AO-LOG] setupUrlSerialization: Condition s.isPlayable is true. Calling debouncedUrlUpdate.",
        );
        this.debouncedUrlUpdate();
      } else {
        // If not playable (e.g., initial state or after an error), still update URL to clear params.
        // This is handled more directly in updateUrlFromState logic.
        console.log(
          "[AO-LOG] setupUrlSerialization: Condition s.isPlayable is false. URL update will be handled by updateUrlFromState if called.",
        );
      }
    });
    // Note: VAD threshold changes in analysisStore would also need to trigger debouncedUrlUpdate
    // if they are to be serialized. This is not currently implemented in the subscription.
    console.log(
      "[AO-LOG] setupUrlSerialization: Subscribed to playerStore for URL updates.",
    );
  }

  /**
   * Collects current state from playerStore and timeStore, then updates
   * the browser URL search parameters.
   * This is the core function for serializing state to the URL.
   */
  public updateUrlFromState = (): void => {
    console.log(`[AO-LOG] updateUrlFromState: Entered.`);
    if (typeof window === "undefined") {
      // Guard for SSR
      console.log(`[AO-LOG] updateUrlFromState: Not in browser, returning.`);
      return;
    }

    const pStore = get(playerStore); // Get current player state
    const tStore = get(timeStore); // Get current time from dedicated timeStore
    const params: Record<string, string> = {}; // Initialize empty params object

    console.log(
      `[AO-LOG] updateUrlFromState: Current pStore.isPlayable: ${pStore.isPlayable}, pStore.status: ${pStore.status}`,
    );

    // If player is not playable and not in a loading state (e.g., after an error or before any file load),
    // clear all URL parameters.
    if (!pStore.isPlayable && pStore.status !== "loading") {
      console.log(
        `[AO-LOG] updateUrlFromState: Player not playable and not loading. Clearing URL params.`,
      );
      updateUrlWithParams({}); // Call utility to update URL with empty params
      return;
    }

    // Serialize player settings to URL parameters if they differ from defaults
    if (pStore.speed !== 1.0) {
      params[URL_HASH_KEYS.SPEED] = pStore.speed.toFixed(2);
    }
    if (pStore.pitchShift !== 0.0) {
      params[URL_HASH_KEYS.PITCH] = pStore.pitchShift.toFixed(2); // Using pitchShift
    }
    if (pStore.gain !== 1.0) {
      params[URL_HASH_KEYS.GAIN] = pStore.gain.toFixed(2);
    }

    // Serialize current time if it's meaningful (not at the very start or end, if those are default implicit states)
    if (tStore > 0.1 && (!pStore.duration || tStore < pStore.duration - 0.1)) {
      params[URL_HASH_KEYS.TIME] = tStore.toFixed(
        UI_CONSTANTS.URL_TIME_PRECISION,
      );
    }

    // Example for VAD parameters (currently not loaded from URL in +page.ts but shows how)
    // const aStore = get(analysisStore);
    // if (aStore.vadPositiveThreshold && aStore.vadPositiveThreshold !== VAD_CONSTANTS.DEFAULT_POSITIVE_THRESHOLD) {
    //     params[URL_HASH_KEYS.VAD_POSITIVE] = aStore.vadPositiveThreshold.toFixed(2);
    // }
    // if (aStore.vadNegativeThreshold && aStore.vadNegativeThreshold !== VAD_CONSTANTS.DEFAULT_NEGATIVE_THRESHOLD) {
    //     params[URL_HASH_KEYS.VAD_NEGATIVE] = aStore.vadNegativeThreshold.toFixed(2);
    // }

    console.log(
      `[AO-LOG] updateUrlFromState: Calculated params for URL:`,
      JSON.stringify(params), // Log the params being sent to the URL
    );
    updateUrlWithParams(params); // Call utility to update the browser's URL
    console.log(`[AO-LOG] updateUrlFromState: updateUrlWithParams called.`);
  };
}

export default AudioOrchestrator.getInstance();
