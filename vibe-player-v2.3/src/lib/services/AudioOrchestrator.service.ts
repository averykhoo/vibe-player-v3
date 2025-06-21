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
import { UI_CONSTANTS, URL_HASH_KEYS, VISUALIZER_CONSTANTS } from "$lib/utils/constants";
import type { PlayerState } from "$lib/types/player.types";
import { createWaveformData } from "$lib/utils/waveform";

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

  public async loadFileAndAnalyze(
    file: File,
    initialState?: Partial<PlayerState>,
  ): Promise<void> {
    if (this.isBusy) {
      console.warn("[Orchestrator] Orchestrator is busy, skipping file load.");
      return;
    }
    this.isBusy = true;
    console.log(`[Orchestrator] Orchestrator is now BUSY. Loading file: ${file.name}`);

    statusStore.set({
      message: `Loading ${file.name}...`,
      type: "info",
      isLoading: true,
    });

    try {
      // --- STAGE 1: PRE-PROCESSING & STATE RESET ---
      console.log("[Orchestrator|S1] Resetting state and stopping previous audio.");
      await audioEngine.stop();
      playerStore.update((s) => ({
        ...initialPlayerState,
        fileName: file.name,
        status: "loading",
        waveformData: undefined,
      }));
      analysisStore.update((s) => ({
        ...s,
        dtmfResults: [],
        spectrogramData: null,
      }));
      timeStore.set(0);
      await audioEngine.unlockAudio();
      console.log("[Orchestrator|S1] State reset complete.");

      // --- STAGE 2: CORE AUDIO DECODING & VISUALS ---
      console.log("[Orchestrator|S2] Decoding audio data...");
      statusStore.set({
        message: `Processing ${file.name}...`,
        type: "info",
        isLoading: true,
      });
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioEngine.decodeAudioData(arrayBuffer);
      console.log(`[Orchestrator|S2] Audio decoded. Duration: ${audioBuffer.duration.toFixed(2)}s`);
      
      console.log("[Orchestrator|S2] Generating waveform data...");
      const waveformData = createWaveformData(audioBuffer, VISUALIZER_CONSTANTS.SPEC_FIXED_WIDTH);
      console.log(`[Orchestrator|S2] Waveform data generated with ${waveformData[0]?.length || 0} points.`);

      // --- STAGE 3: INITIALIZE ALL SERVICES IN PARALLEL ---
      console.log("[Orchestrator|S3] Initializing all services in parallel...");
      const initResults = await Promise.allSettled([
        audioEngine.initializeWorker(audioBuffer),
        dtmfService.initialize(16000),
        spectrogramService.initialize({ sampleRate: audioBuffer.sampleRate }),
      ]);
      console.log("[Orchestrator|S3] All service initializations have settled.");

      if (initResults[0].status === "rejected") {
        console.error("[Orchestrator|S3] CRITICAL FAILURE: AudioEngine worker could not initialize.", initResults[0].reason);
        throw new Error("Failed to initialize core audio engine.");
      } else {
        console.log("[Orchestrator|S3] SUCCESS: AudioEngine worker initialized.");
      }

      if (initResults[1].status === "rejected") {
        console.warn("[Orchestrator|S3] NON-CRITICAL FAILURE: DTMF service could not initialize.", initResults[1].reason);
      } else {
        console.log("[Orchestrator|S3] SUCCESS: DTMF service initialized.");
      }
      
      if (initResults[2].status === "rejected") {
        console.warn("[Orchestrator|S3] NON-CRITICAL FAILURE: Spectrogram service could not initialize.", initResults[2].reason);
      } else {
        console.log("[Orchestrator|S3] SUCCESS: Spectrogram service initialized.");
      }

      // --- STAGE 4: FINALIZE PLAYER STATE & APPLY URL PARAMS ---
      console.log("[Orchestrator|S4] Finalizing player state.");
      playerStore.update((s) => ({
        ...s,
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        channels: audioBuffer.numberOfChannels,
        isPlayable: true,
        audioBuffer: audioBuffer,
        error: null,
        status: "ready",
        waveformData: waveformData,
      }));

      if (initialState) {
        console.log("[Orchestrator|S4] Applying initial state from URL:", initialState);
        playerStore.update((s) => ({ ...s, ...initialState }));
        if (initialState.currentTime) {
          console.log(`[Orchestrator|S4] Seeking to initial time: ${initialState.currentTime.toFixed(2)}s`);
          audioEngine.seek(initialState.currentTime);
        }
      }

      statusStore.set({
        isLoading: false,
        message: `Ready: ${file.name}`,
        type: "success",
      });
      this.updateUrlFromState();
      console.log("[Orchestrator|S4] Player is ready.");

      // --- STAGE 5: KICK OFF BACKGROUND ANALYSIS ---
      console.log("[Orchestrator|S5] Starting background analysis tasks.");
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
      console.log("[Orchestrator|S5] Background analysis tasks dispatched.");

    } catch (e: any) {
      this.handleError(e);
    } finally {
      this.isBusy = false;
      console.log("[Orchestrator] Orchestrator is no longer busy.");
    }
  }

  private _runBackgroundAnalysis(analysisPromises: Promise<any>[]) {
    if (analysisPromises.length === 0) {
      console.log(
        "[Orchestrator] No analysis services were successfully initialized. Skipping background analysis.",
      );
      return;
    }

    Promise.allSettled(analysisPromises).then((results) => {
      console.log(`[Orchestrator] Background analysis finished.`);
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          const serviceName = index === 0 ? "DTMF" : "Spectrogram";
          console.error(`[Orchestrator] ${serviceName} analysis failed:`, result.reason);
        }
      });
    });
  }

  public handleError(error: Error | string): void {
    const errorMessage = typeof error === "string" ? error : error.message;
    console.error("[Orchestrator] Handling error:", errorMessage, error);

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