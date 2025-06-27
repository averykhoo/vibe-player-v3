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
  VAD_CONSTANTS,
} from "$lib/utils/constants";
import type { PlayerState } from "$lib/types/player.types";
import { createWaveformData } from "$lib/utils/waveform";
import analysisService from "./analysis.service";

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
  jumpSeconds: 5,
  sourceUrl: null,
  waveformData: undefined,
  error: null,
  audioBuffer: undefined,
  audioContextResumed: false,
  channels: undefined,
  sampleRate: undefined,
  lastProcessedChunk: undefined,
};

const prepareStateForLog = (state: any) => {
  const { waveformData, audioBuffer, ...rest } = state;
  return {
    ...rest,
    waveformData: waveformData
      ? `[${waveformData.length}ch, ${waveformData[0]?.length || 0}pts]`
      : undefined,
    audioBuffer: audioBuffer ? `[AudioBuffer Present]` : undefined,
  };
};

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

  // --- NEW PUBLIC METHODS ---
  public async loadFromFile(file: File, initialState?: Partial<PlayerState>) {
    await this._initiateLoadingProcess(file, initialState);
  }

  public async loadFromUrl(url: string, initialState?: Partial<PlayerState>) {
    await this._initiateLoadingProcess(url, initialState);
  }

  // --- REFACTORED PRIVATE METHOD ---
  private async _initiateLoadingProcess(
    source: File | string,
    initialState?: Partial<PlayerState>,
  ): Promise<void> {
    const sourceName = typeof source === "string" ? source : source.name;
    console.log(
      `[AO-LOG] _initiateLoadingProcess: Entered. Source: ${sourceName}`,
    );

    if (this.isBusy) {
      console.warn("[AO-LOG] Orchestrator is busy, skipping file load.");
      return;
    }
    this.isBusy = true;
    statusStore.set({
      message: `Loading ${sourceName}...`,
      type: "info",
      isLoading: true,
    });

    try {
      await audioEngine.stop();
      playerStore.set({
        ...initialPlayerStateSnapshot,
        fileName: sourceName,
        status: "loading",
        sourceUrl: typeof source === "string" ? source : null,
      });
      analysisStore.update((s) => ({
        ...s,
        dtmfResults: [],
        spectrogramData: null,
      }));
      timeStore.set(0);
      audioEngine.unlockAudio();

      statusStore.set({
        message: `Processing ${sourceName}...`,
        type: "info",
        isLoading: true,
      });

      let arrayBuffer: ArrayBuffer;
      if (typeof source === "string") {
        const response = await fetch(source);
        if (!response.ok)
          throw new Error(`Failed to fetch URL: ${response.statusText}`);
        arrayBuffer = await response.arrayBuffer();
      } else {
        arrayBuffer = await source.arrayBuffer();
      }

      const audioBuffer = await audioEngine.decodeAudioData(arrayBuffer);
      const waveformData = createWaveformData(
        audioBuffer,
        VISUALIZER_CONSTANTS.SPEC_FIXED_WIDTH,
      );

      // --- START OF FIX ---
      // We now explicitly wait for all services, including analysisService, to initialize.
      console.log("[AO-LOG] Awaiting initialization of all services...");
      const initResults = await Promise.allSettled([
        audioEngine.initializeWorker(audioBuffer),
        dtmfService.initialize(16000),
        spectrogramService.initialize({ sampleRate: audioBuffer.sampleRate }),
        analysisService.initialize(), // <-- ADDED THIS LINE
      ]);
      console.log("[AO-LOG] Service initialization complete. Results:", initResults);

      // Check results. We now have 4 results to check.
      if (initResults[0].status === "rejected") {
        throw new Error("Failed to initialize core audio engine.");
      }
      // Log non-critical failures for analysis services (indices 1, 2, and 3)
      initResults.slice(1).forEach((result, index) => {
        if (result.status === "rejected") {
          const serviceName = ['DTMF', 'Spectrogram', 'VAD'][index];
          console.warn(
            `[AO-LOG] A non-critical analysis service (${serviceName}) failed to initialize.`,
            result.reason,
          );
        }
      });
      // --- END OF FIX ---


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

      if (initialState && Object.keys(initialState).length > 0) {
        playerStore.update((s) => ({ ...s, ...initialState }));
        if (initialState.currentTime) {
          audioEngine.seek(initialState.currentTime);
        }
      }

      statusStore.set({
        isLoading: false,
        message: `Ready: ${sourceName}`,
        type: "success",
      });
      this.updateUrlFromState();

      // --- START OF REVISED ANALYSIS BLOCK ---
      const analysisPromises = [];
      // Check for DTMF service readiness (index 1)
      if (initResults[1].status === "fulfilled") {
        console.log("[AO-LOG] DTMF service is ready. Queuing processing.");
        analysisPromises.push(dtmfService.process(audioBuffer));
      }

      // Check for Spectrogram service readiness (index 2)
      if (initResults[2].status === "fulfilled") {
        console.log("[AO-LOG] Spectrogram service is ready. Queuing processing.");
        analysisPromises.push(
          spectrogramService.process(audioBuffer.getChannelData(0)),
        );
      }

      // Check for VAD service readiness (index 3)
      if (initResults[3].status === "fulfilled") {
        console.log("[AO-LOG] VAD service is ready. Starting VAD processing flow.");
        // This is now the fire-and-forget block, but it's safe because we know the service is initialized.
        (async () => {
          try {
            console.log("[AO-LOG-VAD] Resampling audio for VAD...");
            const targetSampleRate = VAD_CONSTANTS.SAMPLE_RATE;
            const offlineCtx = new OfflineAudioContext(
              1,
              audioBuffer.duration * targetSampleRate,
              targetSampleRate,
            );
            const source = offlineCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(offlineCtx.destination);
            source.start();
            const resampled = await offlineCtx.startRendering();
            const pcmData = resampled.getChannelData(0);
            console.log("[AO-LOG-VAD] Resampling complete. Kicking off VAD processing.");
            await analysisService.processVad(pcmData);
            console.log("[AO-LOG-VAD] VAD processing successfully completed.");
          } catch (e) {
            console.warn("[AO-LOG] Background VAD analysis failed.", e);
          }
        })();
      } else {
        console.warn("[AO-LOG] VAD service failed to initialize, skipping VAD analysis.");
      }
      
      this._runBackgroundAnalysis(analysisPromises);
      // --- END OF REVISED ANALYSIS BLOCK ---

    } catch (e: any) {
      this.handleError(e);
    } finally {
      this.isBusy = false;
    }
  }

  // --- UNCHANGED PRIVATE/PUBLIC METHODS ---
  private _runBackgroundAnalysis(analysisPromises: Promise<any>[]) {
    Promise.allSettled(analysisPromises)
      .then((results) => {
        console.log("[AO-LOG] Background analysis tasks completed.", results);
        results.forEach((result) => {
          if (result.status === "rejected") {
            console.warn(
              "[AO-LOG] A background analysis task failed:",
              result.reason,
            );
          }
        });
      })
      .catch((error) => {
        console.error(
          "[AO-LOG] Unexpected error in background analysis coordination:",
          error,
        );
      });
  }
  public handleError(error: Error | string): void {
    const errorMessage = error instanceof Error ? error.message : error;
    console.error("[AO-LOG] Orchestrator Error:", error);
    statusStore.set({ message: errorMessage, type: "error", isLoading: false });
    playerStore.update((s) => ({
      ...s,
      error: errorMessage,
      status: "error",
      isPlayable: false,
    }));
  }
  private debouncedUrlUpdate = debounce(() => {
    this.updateUrlFromState();
  }, UI_CONSTANTS.DEBOUNCE_HASH_UPDATE_MS);
  public setupUrlSerialization(): void {
    // Subscribe to relevant stores and call debouncedUrlUpdate
    playerStore.subscribe(() => this.debouncedUrlUpdate());
    timeStore.subscribe(() => {
      // Only update URL due to time changes if a file is loaded and playable
      const pStore = get(playerStore);
      if (pStore.isPlayable && pStore.status !== "loading") {
        this.debouncedUrlUpdate();
      }
    });
  }

  public updateUrlFromState = (): void => {
    if (typeof window === "undefined") return;
    const pStore = get(playerStore);
    const tStore = get(timeStore);
    const params: Record<string, string> = {};

    if (!pStore.isPlayable && pStore.status !== "loading") {
      updateUrlWithParams({});
      return;
    }

    if (pStore.speed !== 1.0)
      params[URL_HASH_KEYS.SPEED] = pStore.speed.toFixed(2);
    if (pStore.pitchShift !== 0.0)
      params[URL_HASH_KEYS.PITCH] = pStore.pitchShift.toFixed(2);
    if (pStore.gain !== 1.0)
      params[URL_HASH_KEYS.GAIN] = pStore.gain.toFixed(2);
    if (pStore.jumpSeconds !== 5)
        params['jump'] = String(pStore.jumpSeconds);

    // ADD THIS for URL serialization
    if (pStore.sourceUrl) {
      params[URL_HASH_KEYS.AUDIO_URL] = pStore.sourceUrl;
    }

    if (tStore > 0.1 && (!pStore.duration || tStore < pStore.duration - 0.1)) {
      params[URL_HASH_KEYS.TIME] = tStore.toFixed(
        UI_CONSTANTS.URL_TIME_PRECISION,
      );
    }

    updateUrlWithParams(params);
  };

  // --- Passthrough methods to audioEngine ---
  public play(): void {
    console.log("[AO-LOG] play called");
    if (!get(playerStore).isPlayable) {
      console.warn("[AO-LOG] Play called but not playable.");
      return;
    }
    audioEngine.play();
  }

  public pause(): void {
    console.log("[AO-LOG] pause called");
    audioEngine.pause();
  }

  public stop(): void {
    // This might be redundant if stop just means pause and reset time
    console.log("[AO-LOG] stop called");
    audioEngine.stop(); // audioEngine.stop() should handle resetting time if that's the desired behavior
    timeStore.set(0); // Explicitly reset time in the store as well
    playerStore.update((s) => ({ ...s, isPlaying: false, currentTime: 0 }));
  }

  public seek(time: number): void {
    console.log(`[AO-LOG] seek called with time: ${time}`);
    if (!get(playerStore).isPlayable) return;
    audioEngine.seek(time);
  }

  public setSpeed(speed: number): void {
    console.log(`[AO-LOG] setSpeed called with speed: ${speed}`);
    if (!get(playerStore).isPlayable) return;
    audioEngine.setSpeed(speed);
  }

  public setPitchShift(pitch: number): void {
    console.log(`[AO-LOG] setPitchShift called with pitch: ${pitch}`);
    if (!get(playerStore).isPlayable) return;
    audioEngine.setPitch(pitch);
  }

  public setGain(gain: number): void {
    console.log(`[AO-LOG] setGain called with gain: ${gain}`);
    if (!get(playerStore).isPlayable) return;
    audioEngine.setGain(gain);
  }

  public jump(direction: 1 | -1): void {
    console.log(`[AO-LOG] jump called with direction: ${direction}`);
    if(!get(playerStore).isPlayable) return;
    audioEngine.jump(direction);
  }

  public toggleLoop(loop: boolean): void {
    console.log(`[AO-LOG] toggleLoop called with loop: ${loop}`);
    if (!get(playerStore).isPlayable) return;
    audioEngine.toggleLoop(loop);
  }
}

export default AudioOrchestrator.getInstance();