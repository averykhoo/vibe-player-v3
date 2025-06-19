// vibe-player-v2/src/lib/services/AudioOrchestrator.service.ts
import { get } from "svelte/store";
import { playerStore } from "$lib/stores/player.store";
import { statusStore } from "$lib/stores/status.store";
import type { StatusState } from "$lib/types/status.types"; // Added this import
import { analysisStore } from "$lib/stores/analysis.store";
import audioEngine from "./audioEngine.service"; // Changed to default import
import dtmfService from "./dtmf.service"; // Changed to default import
import spectrogramService from "./spectrogram.service"; // Changed to default import
import { debounce } from "$lib/utils/async";
import { updateUrlWithParams } from "$lib/utils/urlState";
import { UI_CONSTANTS, URL_HASH_KEYS } from "$lib/utils/constants";

export class AudioOrchestrator {
  private static instance: AudioOrchestrator;

  private constructor() {
    // Private constructor for singleton
  }

  public static getInstance(): AudioOrchestrator {
    if (!AudioOrchestrator.instance) {
      AudioOrchestrator.instance = new AudioOrchestrator();
    }
    return AudioOrchestrator.instance;
  }

  public async loadFileAndAnalyze(file: File): Promise<void> {
    console.log(`[Orchestrator] === Starting New File Load: ${file.name} ===`);
    statusStore.set({
      message: `Loading ${file.name}...`,
      type: "info",
      isLoading: true,
      details: null,
      progress: null,
    });
    // Ensure other relevant stores are reset if that's current behavior (e.g., analysisStore, waveformStore)
    playerStore.update((s) => ({
      ...s,
      error: null,
      status: "Loading",
      isPlayable: false,
      fileName: file.name,
      duration: 0,
      currentTime: 0,
    })); // Added fileName and reset duration/currentTime
    analysisStore.update((store) => ({
      ...store,
      dtmfResults: [],
      spectrogramData: null,
    }));

    try {
      await audioEngine.unlockAudio();
      const audioBuffer = await audioEngine.loadFile(file);
      // audioEngine.decodeAudioData() is usually part of loadFile or handled by the browser's AudioContext directly

      const duration = audioBuffer.duration;
      const sampleRate = audioBuffer.sampleRate;
      const channels = audioBuffer.numberOfChannels; // Assuming this property exists

      // --- ADD THIS BLOCK to initialize the playback engine's worker ---
      console.log("[Orchestrator] Initializing Audio Engine Worker...");
      await audioEngine.initializeWorker(audioBuffer);
      console.log("[Orchestrator] Audio Engine Worker initialized.");
      // --- END OF ADDED BLOCK ---
      playerStore.update((s) => ({
        ...s,
        duration,
        sampleRate,
        channels, // Added channels
        isPlayable: true,
        status: "Ready", // Updated status here
      }));
      statusStore.set({ message: "Ready", type: "success", isLoading: false });

      spectrogramService.initialize({ sampleRate: audioBuffer.sampleRate });
      dtmfService.initialize(audioBuffer.sampleRate);

      console.log("AudioOrchestrator: Starting background analysis tasks.");
      const analysisPromises = [
        dtmfService.process(audioBuffer),
        spectrogramService.process(audioBuffer.getChannelData(0)),
      ];

      const results = await Promise.allSettled(analysisPromises);
      console.log(
        "AudioOrchestrator: All background analysis tasks settled.",
        results,
      );

      results.forEach((result, index) => {
        if (result.status === "rejected") {
          console.error(
            `AudioOrchestrator: Analysis task ${index} failed:`,
            result.reason,
          );
          // Optionally, update a specific error state in analysisStore or playerStore
        }
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[Orchestrator] !!! CRITICAL ERROR during file load:`,
        error,
      );
      statusStore.set({
        message: "File processing failed.",
        type: "error",
        isLoading: false,
        details: message,
      });
      // Update playerStore to reflect the error state specifically for the player
      playerStore.update((s) => ({
        ...s,
        status: "Error",
        error: message,
        isPlayable: false,
        duration: 0,
        currentTime: 0,
      }));
    }
  }

  /**
   * Sets up debounced URL serialization based on player and analysis store changes.
   * @public
   */
  public setupUrlSerialization(): void {
    console.log("[Orchestrator] Setting up URL serialization.");

    const debouncedUpdater = debounce(() => {
      const pStore = get(playerStore);
      // const aStore = get(analysisStore); // Keep this commented out if analysisStore part is not for this step yet

      const params: Record<string, string> = {
        [URL_HASH_KEYS.SPEED]: pStore.speed.toFixed(2),
        [URL_HASH_KEYS.PITCH]: pStore.pitch.toFixed(1), // Assuming pitch is semitones
        [URL_HASH_KEYS.GAIN]: pStore.gain.toFixed(2),
        // [URL_HASH_KEYS.VAD_THRESHOLD]: aStore.vadPositiveThreshold.toFixed(2), // Keep commented
        // ... any other relevant params from playerStore that should be serialized
      };

      console.log(
        `[Orchestrator/URL] Debounced update triggered. New params:`,
        params,
      );
      updateUrlWithParams(params); // Make sure updateUrlWithParams is correctly imported/defined
    }, UI_CONSTANTS.DEBOUNCE_TIME_MS_URL_UPDATE);

    playerStore.subscribe(debouncedUpdater);
    // analysisStore.subscribe(debouncedUpdater); // Only subscribe if aStore is used in params
  }
}

export const audioOrchestrator = AudioOrchestrator.getInstance();
