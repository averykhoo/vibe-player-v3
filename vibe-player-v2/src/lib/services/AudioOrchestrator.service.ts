// vibe-player-v2/src/lib/services/AudioOrchestrator.service.ts
import { get } from 'svelte/store';
import { playerStore } from '$lib/stores/player.store';
import { statusStore } from '$lib/stores/status.store';
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
    statusStore.set({ message: `Loading ${file.name}...`, type: 'info', isLoading: true });
    playerStore.update(s => ({ ...s, error: null, isPlayable: false, fileName: file.name }));
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
        isPlayable: true,
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
      }));
      statusStore.set({ message: 'Ready', type: 'success', isLoading: false });

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

    } catch (error: unknown) {
      console.error('AudioOrchestrator: Error loading or analyzing file.', error);
      const message = error instanceof Error ? error.message : String(error);
      statusStore.set({ message: 'File processing failed.', type: 'error', isLoading: false, details: message });
      playerStore.update(s => ({ ...s, status: 'Error', error: message, isPlayable: false }));
    }
  }

  public setupUrlSerialization(): void {
    console.log('AudioOrchestrator: Setting up URL serialization.');

    const debouncedUpdater = debounce(() => {
      const pStore = get(playerStore);
      const aStore = get(analysisStore); // Added as per issue, usage commented out

      const params: Record<string, string> = {
        [URL_HASH_KEYS.SPEED]: pStore.speed.toFixed(2),
        [URL_HASH_KEYS.PITCH]: pStore.pitch.toFixed(1),
        [URL_HASH_KEYS.GAIN]: pStore.gain.toFixed(2),
        // [URL_HASH_KEYS.VAD_THRESHOLD]: aStore.vadSensitivity.toFixed(2), // Ensure aStore.vadSensitivity is the correct property if uncommented
        // [URL_HASH_KEYS.VAD_NOISE_FLOOR]: aStore.vadNoiseFloor.toFixed(2), // Ensure aStore.vadNoiseFloor is the correct property if uncommented
      };

      console.log(`[Orchestrator/URL] Debounced update triggered. New params:`, params);
      updateUrlWithParams(params);
    }, UI_CONSTANTS.DEBOUNCE_TIME_MS_URL_UPDATE);

    playerStore.subscribe(debouncedUpdater);
    analysisStore.subscribe(debouncedUpdater);
  }
}

export const audioOrchestrator = AudioOrchestrator.getInstance();
