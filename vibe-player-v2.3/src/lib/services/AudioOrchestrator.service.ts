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

// Initial player state (consider if this needs to be exactly like playerStore's initial for reset logic)
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
  waveformData: undefined,
  error: null,
  audioBuffer: undefined,
  audioContextResumed: false,
  channels: undefined,
  sampleRate: undefined,
  lastProcessedChunk: undefined,
};

export class AudioOrchestrator {
  private static instance: AudioOrchestrator;
  private isBusy = false;

  private constructor() {
    console.log("[AO-LOG] AudioOrchestrator constructor: Instance created.");
  }

  public static getInstance(): AudioOrchestrator {
    if (!AudioOrchestrator.instance) {
      console.log(
        "[AO-LOG] AudioOrchestrator.getInstance: Creating new instance.",
      );
      AudioOrchestrator.instance = new AudioOrchestrator();
    }
    return AudioOrchestrator.instance;
  }

  public async loadFileAndAnalyze(
    file: File,
    initialState?: Partial<PlayerState>, // This comes from +page.ts -> +page.svelte
  ): Promise<void> {
    console.log(
      `[AO-LOG] loadFileAndAnalyze: Entered. File: ${file?.name}, Received initialState:`,
      JSON.stringify(initialState),
    );

    if (this.isBusy) {
      console.warn(
        "[AO-LOG] loadFileAndAnalyze: Orchestrator is busy, skipping file load.",
      );
      return;
    }
    this.isBusy = true;
    console.log(
      `[AO-LOG] loadFileAndAnalyze: Orchestrator is now BUSY. Loading file: ${file.name}`,
    );

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
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 1 - Resetting state and stopping audio.",
      );
      await audioEngine.stop();
      console.log("[AO-LOG] loadFileAndAnalyze: audioEngine.stop() completed.");

      playerStore.update((s) => {
        console.log(
          "[AO-LOG] loadFileAndAnalyze: playerStore.update (resetting). Current state before reset:",
          JSON.stringify(s),
        );
        const newState = {
          ...initialPlayerStateSnapshot, // Use the snapshot for a clean reset
          fileName: file.name,
          status: "loading", // Keep status as loading
          waveformData: undefined, // Ensure waveform is cleared
        };
        console.log(
          "[AO-LOG] loadFileAndAnalyze: playerStore.update (resetting). New state after reset:",
          JSON.stringify(newState),
        );
        return newState;
      });

      analysisStore.update((s) => {
        console.log(
          "[AO-LOG] loadFileAndAnalyze: analysisStore.update (resetting).",
        );
        return { ...s, dtmfResults: [], spectrogramData: null }; // Assuming dtmfResults exists
      });
      timeStore.set(0);
      console.log("[AO-LOG] loadFileAndAnalyze: timeStore set to 0.");

      // Non-awaited call to unlockAudio
      audioEngine.unlockAudio();
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 1 - audioEngine.unlockAudio() attempt initiated (not awaited).",
      );
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 1 - State reset complete.",
      );

      // --- STAGE 2: CORE AUDIO DECODING & VISUALS ---
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 2 - Decoding audio data...",
      );
      statusStore.set({
        message: `Processing ${file.name}...`,
        type: "info",
        isLoading: true,
      });
      const arrayBuffer = await file.arrayBuffer();
      console.log(
        `[AO-LOG] loadFileAndAnalyze: STAGE 2 - file.arrayBuffer() completed. Byte length: ${arrayBuffer.byteLength}`,
      );
      const audioBuffer = await audioEngine.decodeAudioData(arrayBuffer);
      console.log(
        `[AO-LOG] loadFileAndAnalyze: STAGE 2 - Audio decoded. Duration: ${audioBuffer.duration.toFixed(2)}s`,
      );

      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 2 - Generating waveform data...",
      );
      const waveformData = createWaveformData(
        audioBuffer,
        VISUALIZER_CONSTANTS.SPEC_FIXED_WIDTH,
      );
      console.log(
        `[AO-LOG] loadFileAndAnalyze: STAGE 2 - Waveform data generated with ${waveformData[0]?.length || 0} points.`,
      );

      // --- STAGE 3: INITIALIZE ALL SERVICES IN PARALLEL ---
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 3 - Initializing all services in parallel...",
      );
      const initResults = await Promise.allSettled([
        audioEngine.initializeWorker(audioBuffer),
        dtmfService.initialize(16000), // Standard DTMF sample rate
        spectrogramService.initialize({ sampleRate: audioBuffer.sampleRate }),
      ]);
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 3 - All service initializations have settled.",
      );

      if (initResults[0].status === "rejected") {
        console.error(
          "[AO-LOG] loadFileAndAnalyze: STAGE 3 - CRITICAL FAILURE: AudioEngine worker could not initialize.",
          initResults[0].reason,
        );
        throw new Error("Failed to initialize core audio engine.");
      } else {
        console.log(
          "[AO-LOG] loadFileAndAnalyze: STAGE 3 - SUCCESS: AudioEngine worker initialized.",
        );
      }

      if (initResults[1].status === "rejected") {
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
        console.warn(
          "[AO-LOG] loadFileAndAnalyze: STAGE 3 - NON-CRITICAL FAILURE: Spectrogram service could not initialize.",
          initResults[2].reason,
        );
      } else {
        console.log(
          "[AO-LOG] loadFileAndAnalyze: STAGE 3 - SUCCESS: Spectrogram service initialized.",
        );
      }

      // --- STAGE 4: FINALIZE PLAYER STATE & APPLY URL PARAMS ---
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 4 - Finalizing player state.",
      );
      playerStore.update((s) => {
        console.log(
          "[AO-LOG] loadFileAndAnalyze: playerStore.update (finalizing). Current state before finalization:",
          JSON.stringify(s),
        );
        const finalState = {
          ...s,
          duration: audioBuffer.duration,
          sampleRate: audioBuffer.sampleRate,
          channels: audioBuffer.numberOfChannels,
          isPlayable: true,
          audioBuffer: audioBuffer, // Keep a reference if needed elsewhere, careful with memory
          error: null,
          status: "ready",
          waveformData: waveformData,
        };
        console.log(
          "[AO-LOG] loadFileAndAnalyze: playerStore.update (finalizing). New state after finalization:",
          JSON.stringify(finalState),
        );
        return finalState;
      });

      if (initialState && Object.keys(initialState).length > 0) {
        console.log(
          "[AO-LOG] loadFileAndAnalyze: STAGE 4 - Applying received initialState from URL/data.load:",
          JSON.stringify(initialState),
        );
        playerStore.update((s) => {
          console.log(
            "[AO-LOG] loadFileAndAnalyze: playerStore.update (applying initialState). Current state before applying initialState:",
            JSON.stringify(s),
          );
          const mergedState = { ...s, ...initialState };
          console.log(
            "[AO-LOG] loadFileAndAnalyze: playerStore.update (applying initialState). New state after merging initialState:",
            JSON.stringify(mergedState),
          );
          return mergedState;
        });
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

      statusStore.set({
        isLoading: false,
        message: `Ready: ${file.name}`,
        type: "success",
      });
      console.log(
        `[AO-LOG] loadFileAndAnalyze: StatusStore updated to ready for ${file.name}.`,
      );

      this.updateUrlFromState(); // Initial URL update after load based on (potentially merged) state
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 4 - Player is ready, initial URL update called.",
      );

      // --- STAGE 5: KICK OFF BACKGROUND ANALYSIS ---
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 5 - Starting background analysis tasks.",
      );
      const analysisPromises = [];
      if (initResults[1].status === "fulfilled") {
        analysisPromises.push(dtmfService.process(audioBuffer));
        console.log(
          "[AO-LOG] loadFileAndAnalyze: STAGE 5 - Queued DTMF process.",
        );
      }
      if (initResults[2].status === "fulfilled") {
        analysisPromises.push(
          spectrogramService.process(audioBuffer.getChannelData(0)),
        );
        console.log(
          "[AO-LOG] loadFileAndAnalyze: STAGE 5 - Queued Spectrogram process.",
        );
      }
      this._runBackgroundAnalysis(analysisPromises);
      console.log(
        "[AO-LOG] loadFileAndAnalyze: STAGE 5 - Background analysis tasks dispatched.",
      );
    } catch (e: any) {
      console.error(
        "[AO-LOG] loadFileAndAnalyze: Error during main try block.",
        e,
      );
      this.handleError(e);
    } finally {
      this.isBusy = false;
      console.log(
        "[AO-LOG] loadFileAndAnalyze: Orchestrator is no longer busy. Method exit.",
      );
    }
  }

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

    Promise.allSettled(analysisPromises).then((results) => {
      console.log(
        `[AO-LOG] _runBackgroundAnalysis: All background analysis promises settled.`,
      );
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          const serviceName = index === 0 ? "DTMF" : "Spectrogram"; // Adjust if more services
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

  public handleError(error: Error | string): void {
    const errorMessage = typeof error === "string" ? error : error.message;
    console.error("[AO-LOG] handleError: Entered.", errorMessage, error);

    statusStore.set({
      message: `Error: ${errorMessage}`,
      type: "error",
      isLoading: false,
    });

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

    audioEngine.stop();
    this.updateUrlFromState(); // Update URL to clear params on error
    console.log("[AO-LOG] handleError: Completed.");
  }

  private debouncedUrlUpdate = debounce(() => {
    console.log(
      `[AO-LOG] debouncedUrlUpdate: Debounced function EXECUTED. Calling updateUrlFromState.`,
    );
    this.updateUrlFromState();
  }, UI_CONSTANTS.DEBOUNCE_HASH_UPDATE_MS);

  public setupUrlSerialization(): void {
    console.log("[AO-LOG] setupUrlSerialization: Entered.");
    if (typeof window === "undefined") {
      console.log("[AO-LOG] setupUrlSerialization: Not in browser, returning.");
      return;
    }
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
        console.log(
          "[AO-LOG] setupUrlSerialization: Condition s.isPlayable is false. NOT calling debouncedUrlUpdate.",
        );
      }
    });
    // Also subscribe to timeStore for more frequent time updates to URL if needed,
    // but be careful as this can be very chatty. The current logic in updateUrlFromState uses get(timeStore).
    console.log(
      "[AO-LOG] setupUrlSerialization: Subscribed to playerStore for URL updates.",
    );
  }

  public updateUrlFromState = (): void => {
    console.log(`[AO-LOG] updateUrlFromState: Entered.`);
    if (typeof window === "undefined") {
      console.log(`[AO-LOG] updateUrlFromState: Not in browser, returning.`);
      return;
    }

    const pStore = get(playerStore);
    const tStore = get(timeStore); // Time is taken from timeStore for URL
    const params: Record<string, string> = {};

    console.log(
      `[AO-LOG] updateUrlFromState: Current pStore.isPlayable: ${pStore.isPlayable}, pStore.status: ${pStore.status}`,
    );

    if (!pStore.isPlayable && pStore.status !== "loading") {
      // Allow URL update during loading if params are set
      console.log(
        `[AO-LOG] updateUrlFromState: Player not playable and not loading. Clearing URL params.`,
      );
      updateUrlWithParams({}); // Clear all params if not playable (e.g., after error or initial state before load)
      return;
    }

    // Serialize relevant player state to URL params
    if (pStore.speed !== 1.0)
      params[URL_HASH_KEYS.SPEED] = pStore.speed.toFixed(2);
    if (pStore.pitchShift !== 0.0)
      params[URL_HASH_KEYS.PITCH] = pStore.pitchShift.toFixed(2); // Ensure it's pitchShift
    if (pStore.gain !== 1.0)
      params[URL_HASH_KEYS.GAIN] = pStore.gain.toFixed(2);

    // Only add time if it's meaningful (not at the very start or end if those are defaults)
    if (tStore > 0.1 && (!pStore.duration || tStore < pStore.duration - 0.1)) {
      params[URL_HASH_KEYS.TIME] = tStore.toFixed(
        UI_CONSTANTS.URL_TIME_PRECISION,
      );
    }

    // Add VAD thresholds from analysisStore if they differ from defaults
    // const aStore = get(analysisStore);
    // if (aStore.vadPositiveThreshold && aStore.vadPositiveThreshold !== VAD_CONSTANTS.DEFAULT_POSITIVE_THRESHOLD) {
    //     params[URL_HASH_KEYS.VAD_POSITIVE] = aStore.vadPositiveThreshold.toFixed(2);
    // }
    // if (aStore.vadNegativeThreshold && aStore.vadNegativeThreshold !== VAD_CONSTANTS.DEFAULT_NEGATIVE_THRESHOLD) {
    //     params[URL_HASH_KEYS.VAD_NEGATIVE] = aStore.vadNegativeThreshold.toFixed(2);
    // }
    // Note: VAD params are not currently loaded from URL in +page.ts, this is for future if needed.

    console.log(
      `[AO-LOG] updateUrlFromState: Calculated params for URL:`,
      JSON.stringify(params),
    );
    updateUrlWithParams(params);
    console.log(`[AO-LOG] updateUrlFromState: updateUrlWithParams called.`);
  };
}

// const initialPlayerState: PlayerState = { ... } // This should be PlayerState from types
// Re-define initialPlayerStateSnapshot to match PlayerState type correctly if it's used for resetting.
// It's defined at the top of the file now.

export default AudioOrchestrator.getInstance();
