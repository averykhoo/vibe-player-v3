// vibe-player-v2/src/lib/services/AudioOrchestrator.service.ts
import { get } from 'svelte/store';
import { playerStore } from '$lib/stores/player.store';
import { analysisStore } from '$lib/stores/analysis.store';
import { audioEngine } from './audioEngine.service';
import { dtmfService } from './dtmf.service';
import { spectrogramService } from './spectrogram.service';
import { debounce } from '$lib/utils/async';
import { updateUrlWithParams } from '$lib/utils/urlState';
import { UI_CONSTANTS, URL_HASH_KEYS } from '$lib/utils/constants';

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
    console.log('AudioOrchestrator: Starting new file load.');
    playerStore.set({
      ...get(playerStore),
      status: 'Loading',
      error: null,
      isPlayable: false,
    });
    analysisStore.update(store => ({
      ...store,
      // Reset analysis-specific data
      dtmfResults: [],
      spectrogramData: null, // Or appropriate initial value
      // Reset other analysis fields as needed
    }));

    try {
      await audioEngine.unlockAudio();
      const audioBuffer = await audioEngine.loadFile(file);

      playerStore.update(store => ({
        ...store,
        status: 'Ready',
        isPlayable: true,
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
      }));

      spectrogramService.init(audioBuffer.sampleRate);
      dtmfService.init(audioBuffer.sampleRate);

      console.log('AudioOrchestrator: Starting background analysis tasks.');
      const analysisPromises = [
        dtmfService.process(audioBuffer),
        spectrogramService.process(audioBuffer.getChannelData(0)),
      ];

      const results = await Promise.allSettled(analysisPromises);
      console.log('AudioOrchestrator: All background analysis tasks settled.', results);

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(`AudioOrchestrator: Analysis task ${index} failed:`, result.reason);
          // Optionally, update a specific error state in analysisStore or playerStore
        }
      });

    } catch (error: any) {
      console.error('AudioOrchestrator: Error loading or analyzing file.', error);
      playerStore.update(store => ({
        ...store,
        status: 'Error',
        error: error.message || 'Unknown error during file processing.',
        isPlayable: false,
      }));
    }
  }

  public setupUrlSerialization(): void {
    console.log('AudioOrchestrator: Setting up URL serialization.');

    const debouncedUpdater = debounce(() => {
      const currentPlayerState = get(playerStore);
      const currentAnalysisState = get(analysisStore);

      const params: Record<string, string | number | boolean> = {
        [URL_HASH_KEYS.SPEED]: currentPlayerState.playbackSpeed,
        [URL_HASH_KEYS.PITCH]: currentPlayerState.pitchShift,
        [URL_HASH_KEYS.GAIN]: currentPlayerState.gain,
        [URL_HASH_KEYS.VAD_THRESHOLD]: currentAnalysisState.vadSensitivity,
        [URL_HASH_KEYS.VAD_NOISE_FLOOR]: currentAnalysisState.vadNoiseFloor,
        // Add other relevant parameters from playerStore and analysisStore
        // Example:
        // [URL_HASH_KEYS.FILTER_LOW_PASS]: currentPlayerState.filterLowPass,
        // [URL_HASH_KEYS.FILTER_HIGH_PASS]: currentPlayerState.filterHighPass,
      };

      console.log('AudioOrchestrator: Debounced URL update. New params:', params);
      updateUrlWithParams(params);
    }, UI_CONSTANTS.DEBOUNCE_TIME_MS_URL_UPDATE);

    playerStore.subscribe(debouncedUpdater);
    analysisStore.subscribe(debouncedUpdater);
  }
}

export const audioOrchestrator = AudioOrchestrator.getInstance();
