// vibe-player-v2.0/src/lib/services/AudioOrchestrator.service.ts
import { playerStore } from "$lib/stores/player.store";
import { dtmfStore } from "$lib/stores/dtmf.store";
import audioEngine from "./audioEngine.service";
import dtmfService from "./dtmf.service";
import spectrogramService from "./spectrogram.service";
// Import other analysis services (e.g., VAD) as needed.

class AudioOrchestrator {
  private static instance: AudioOrchestrator;
  private constructor() {}

  public static getInstance(): AudioOrchestrator {
    if (!AudioOrchestrator.instance) {
      AudioOrchestrator.instance = new AudioOrchestrator();
    }
    return AudioOrchestrator.instance;
  }

  /**
   * The main entry point for loading and processing an audio file.
   * This function orchestrates the entire flow in a clear, synchronous manner.
   * @param file The audio file selected by the user.
   */
  public async loadFileAndAnalyze(file: File): Promise<void> {
    if (!file) return;

    console.log("[Orchestrator] Starting file load...");

    // Reset stores to a clean loading state
    playerStore.update((currentState) => ({
      ...currentState, // <-- Preserve existing state (speed, pitch, etc.)
      // Now, only overwrite the properties that need to be reset for a new file load.
      status: "loading",
      fileName: file.name,
      duration: 0,
      currentTime: 0,
      isPlaying: false,
      isPlayable: false,
      waveformData: undefined,
      error: null,
      audioBuffer: undefined,
      channels: undefined,
      sampleRate: undefined,
      lastProcessedChunk: undefined,
    }));
    dtmfStore.set({ status: "idle", dtmf: [], cpt: [], error: null });

    try {
      // Step 1: Unlock the AudioContext. This is the crucial fix.
      // It must happen as part of the user gesture chain (file selection).

      // Step 2: Decode the audio. We must wait for this to complete.
      // audioEngine.loadFile will be modified to accept a File and return AudioBuffer
      const audioBuffer = await audioEngine.loadFile(file);
      console.log("[Orchestrator] Audio decoded.");

      // Step 2: Update the store with the decoded audio info
      playerStore.update((s) => ({
        ...s,
        status: "Ready",
        // isPlayable is now managed by the AudioEngineService
        duration: audioBuffer.duration,
        audioBuffer: audioBuffer,
        sampleRate: audioBuffer.sampleRate,
        fileName: file.name, // Ensure fileName is set
      }));

      // Step 3: Initialize other services that depend on the audioBuffer's properties
      // Assuming spectrogramService.initialize takes an object with sampleRate
      dtmfService.initialize(16000); // Target sample rate for DTMF
      // Correctly wait for the async initialization to complete.
      await spectrogramService.initialize({
        sampleRate: audioBuffer.sampleRate,
      });

      // Step 4: Kick off all analyses in parallel. We DON'T await these,
      // allowing the UI to remain responsive. They update their own stores upon completion.
      console.log(
        "[Orchestrator] Starting parallel analyses now that services are ready...",
      );
      Promise.allSettled([
        dtmfService.process(audioBuffer),
        // Assuming spectrogramService.process takes the channel data
        spectrogramService.process(audioBuffer.getChannelData(0)),
        // VAD service would be called here too
      ]).then((results) => {
        console.log(
          "[Orchestrator] All background analysis tasks have settled.",
        );
        results.forEach((result) => {
          if (result.status === "rejected") {
            console.error(
              "[Orchestrator] Analysis task failed:",
              result.reason,
            );
          }
        });
      });
    } catch (error: any) {
      console.error("[Orchestrator] Critical error during file load:", error);
      playerStore.update((s) => ({
        ...s,
        status: "Error",
        error: error.message || "Unknown error during file load",
      }));
    }
  }
}

export default AudioOrchestrator.getInstance();
