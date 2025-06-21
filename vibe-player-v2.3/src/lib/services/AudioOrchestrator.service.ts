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
import { UI_CONSTANTS, URL_HASH_KEYS } from "$lib/utils/constants";
import type { PlayerState } from "$lib/types/player.types";

export class AudioOrchestrator {
  private static instance: AudioOrchestrator;
  private isBusy = false;

  private constructor() {}

  public static getInstance(): AudioOrchestrator {
    if (!AudioOrchestrator.instance) {
      AudioOrchestrator.instance = new AudioOrchestrator();
    }
    return AudioOrchestrator.instance;
  }

  // Add the new parameter to the method signature
  public async loadFileAndAnalyze(
    file: File,
    initialState?: Partial<PlayerState>,
  ): Promise<void> {
    if (this.isBusy) {
      console.warn("Orchestrator is busy, skipping file load.");
      return;
    }
    this.isBusy = true;
    statusStore.set({
      message: `Loading ${file.name}...`,
      type: "info",
      isLoading: true,
    });

    try {
      // --- STAGE 1: PRE-PROCESSING & STATE RESET ---
      await audioEngine.stop();
      playerStore.update((s) => ({
        ...initialPlayerState,
        fileName: file.name,
        status: "loading",
      }));
      analysisStore.update((s) => ({
        ...s,
        dtmfResults: [],
        spectrogramData: null,
      }));
      timeStore.set(0);
      await audioEngine.unlockAudio();

      // --- STAGE 2: CORE AUDIO SETUP (with Promise.allSettled) ---
      statusStore.set({
        message: `Processing ${file.name}...`,
        type: "info",
        isLoading: true,
      });
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioEngine.decodeAudioData(arrayBuffer);

      // Use Promise.allSettled to allow for partial failures.
      const initResults = await Promise.allSettled([
        audioEngine.initializeWorker(audioBuffer), // Critical for playback
        dtmfService.initialize(16000), // Non-critical
        spectrogramService.initialize({ sampleRate: audioBuffer.sampleRate }), // Non-critical
      ]);

      // Check if the CRITICAL service (AudioEngine) failed.
      if (initResults[0].status === "rejected") {
        // If the audio engine itself fails, we cannot proceed. This is a critical error.
        console.error(
          "Critical failure: AudioEngine worker could not initialize.",
          initResults[0].reason,
        );
        throw new Error("Failed to initialize core audio engine."); // This will be caught by the outer catch block.
      }

      // Log non-critical failures but continue.
      if (initResults[1].status === "rejected") {
        console.warn(
          "Non-critical failure: DTMF service could not initialize.",
          initResults[1].reason,
        );
      }
      if (initResults[2].status === "rejected") {
        console.warn(
          "Non-critical failure: Spectrogram service could not initialize.",
          initResults[2].reason,
        );
      }

      // --- STAGE 3: FINALIZE PLAYER STATE ---
      // Since the critical AudioEngine is ready, the player is playable.
      playerStore.update((s) => ({
        ...s,
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        channels: audioBuffer.numberOfChannels,
        isPlayable: true,
        audioBuffer: audioBuffer,
        error: null,
        status: "ready", // <-- THE FIX: Update the status to a non-loading state.
      }));

      // --- START: NEW INITIAL STATE LOGIC ---
      // Apply initial state from URL after buffer is loaded but before analysis
      if (initialState) {
        playerStore.update((s) => ({ ...s, ...initialState }));
        if (initialState.currentTime) {
          // Must call seek to correctly set the engine's internal offset
          audioEngine.seek(initialState.currentTime);
        }
      }
      // --- END: NEW INITIAL STATE LOGIC ---

      statusStore.set({
        isLoading: false,
        message: `Ready: ${file.name}`,
        type: "success",
      });
      this.updateUrlFromState();

      // --- STAGE 4: BACKGROUND ANALYSIS (with checks) ---
      // Now, only run analysis for services that initialized successfully.
      const analysisPromises = [];
      if (initResults[1].status === "fulfilled") {
        analysisPromises.push(dtmfService.process(audioBuffer));
      }
      if (initResults[2].status === "fulfilled") {
        analysisPromises.push(
          spectrogramService.process(audioBuffer.getChannelData(0)),
        );
      }
      this._runBackgroundAnalysis(analysisPromises);
    } catch (e: any) {
      this.handleError(e);
    } finally {
      this.isBusy = false;
    }
  }

  private _runBackgroundAnalysis(analysisPromises: Promise<any>[]) {
    if (analysisPromises.length === 0) {
      console.log(
        "No analysis services were successfully initialized. Skipping background analysis.",
      );
      return;
    }

    console.log(
      `Starting background analysis for ${analysisPromises.length} service(s)...`,
    );
    Promise.allSettled(analysisPromises).then((results) => {
      console.log(`Background analysis finished.`);
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          // This mapping is fragile, but sufficient for this example.
          // A better implementation might pass service names along with promises.
          const serviceName = index === 0 ? "DTMF" : "Spectrogram";
          console.error(`${serviceName} analysis failed:`, result.reason);
        }
      });
    });
  }

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
      isPlaying: false,
      isPlayable: false,
      status: "error",
    }));

    audioEngine.stop();
    this.updateUrlFromState();
  }

  private debouncedUrlUpdate = debounce(() => {
    this.updateUrlFromState();
  }, UI_CONSTANTS.DEBOUNCE_HASH_UPDATE_MS);

  public setupUrlSerialization(): void {
    if (typeof window === "undefined") return;
    playerStore.subscribe((s) => {
      if (s.isPlayable) {
        this.debouncedUrlUpdate();
      }
    });
  }

  public updateUrlFromState = (): void => {
    if (typeof window === "undefined") return;

    const pStore = get(playerStore);
    const tStore = get(timeStore);
    const params: Record<string, string> = {};

    if (!pStore.isPlayable) {
      updateUrlWithParams({});
      return;
    }

    if (pStore.speed !== 1.0)
      params[URL_HASH_KEYS.SPEED] = pStore.speed.toFixed(2);
    if (pStore.pitchShift !== 0.0)
      params[URL_HASH_KEYS.PITCH] = pStore.pitchShift.toFixed(2);
    if (pStore.gain !== 1.0)
      params[URL_HASH_KEYS.GAIN] = pStore.gain.toFixed(2);

    if (tStore > 0.1 && tStore < pStore.duration - 0.1) {
      params[URL_HASH_KEYS.TIME] = tStore.toFixed(2);
    }

    updateUrlWithParams(params);
  };
}

const initialPlayerState: PlayerState = {
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

export default AudioOrchestrator.getInstance();
