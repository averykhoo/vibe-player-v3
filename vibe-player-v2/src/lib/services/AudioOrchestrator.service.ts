// vibe-player-v2/src/lib/services/AudioOrchestrator.service.ts

import { PUBLIC_AUDIO_FILE_NAME_PARAM_KEY, PUBLIC_AUDIO_FILE_URL_PARAM_KEY, PUBLIC_DEFAULT_AUDIO_FILE_URL } from '$env/static/public';
import { goto } from '$app/navigation';
import { browser } from '$app/environment';
import { Logger } from '$lib/utils/Logger.utils';
import { debounce } from 'lodash-es';
import { get } from 'svelte/store';

// Stores
import {
  audioSourceNodeStore,
  audioBufferStore,
  // historyStore, // Not used directly by AudioOrchestrator in current logic
  analysisCompletedStore,
  fileDataStore,
  metaDataStore,
  waveformDataStore,
  playerStore, // Used for playerStore.actions.reset()
  errorStore
} from '$lib/stores';

const log = new Logger('AudioOrchestrator');

export class AudioOrchestrator {
  private static instance: AudioOrchestrator;
  private audioContext: AudioContext | null = null;

  private constructor() {
    log.info('AudioOrchestrator initialized');
    if (browser) {
      this.audioContext = new AudioContext();
      // TODO: Initialize other services like AudioAnalyzer here if needed
    }
  }

  public static getInstance(): AudioOrchestrator {
    if (!AudioOrchestrator.instance) {
      AudioOrchestrator.instance = new AudioOrchestrator();
    }
    return AudioOrchestrator.instance;
  }

  public async loadFileAndAnalyze(file: File | URL, fileName?: string): Promise<void> {
    log.info(`Loading file: ${file instanceof File ? file.name : file.href}`);
    errorStore.set(null); // Clear previous errors
    analysisCompletedStore.set(false);
    playerStore.actions.reset(); // Reset player state

    try {
      let audioBuffer: AudioBuffer;
      let fileData: ArrayBuffer;
      let nameToUse = fileName || (file instanceof File ? file.name : 'audio_file_from_url');

      if (file instanceof File) {
        fileData = await file.arrayBuffer();
        fileDataStore.set(fileData); // Store ArrayBuffer
        metaDataStore.set({ name: file.name, type: file.type, size: file.size });
        nameToUse = file.name;
      } else { // URL
        const response = await fetch(file.href);
        if (!response.ok) {
          throw new Error(`Failed to fetch audio from URL: ${response.statusText}`);
        }
        fileData = await response.arrayBuffer();
        fileDataStore.set(fileData); // Store ArrayBuffer
        // Extract filename from URL if not provided
        if (!fileName) {
            const urlPath = new URL(file.href).pathname;
            nameToUse = urlPath.substring(urlPath.lastIndexOf('/') + 1) || 'audio_file_from_url';
        }
        metaDataStore.set({ name: nameToUse, type: response.headers.get('content-type') || 'application/octet-stream', size: fileData.byteLength });
      }

      if (!this.audioContext) {
        throw new Error('AudioContext not initialized');
      }
      audioBuffer = await this.audioContext.decodeAudioData(fileData.slice(0)); // Use slice(0) to create a copy for decodeAudioData
      audioBufferStore.set(audioBuffer);

      // Simulate analysis for now
      // TODO: Replace with actual analysis call to AudioAnalyzer service which should update waveformDataStore
      log.info('Simulating audio analysis...');
      await new Promise(resolve => setTimeout(resolve, 500)); // Simulate async analysis
      waveformDataStore.set(new Float32Array(audioBuffer.length)); // Dummy waveform data
      log.info('Audio analysis complete (simulated).');

      analysisCompletedStore.set(true);
      this.updateUrl(file instanceof URL ? file.href : undefined, nameToUse);

      // Create and set AudioBufferSourceNode (but don't start it)
      const sourceNode = this.audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      audioSourceNodeStore.set(sourceNode);
      // Connect to destination or other nodes as needed by playerStore or effects chain
      // e.g., sourceNode.connect(this.audioContext.destination);

      log.info(`File "${nameToUse}" loaded and analyzed successfully.`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('Error loading or analyzing file:', errorMessage, error);
      errorStore.set({ message: `Failed to load audio: ${errorMessage}` });
      analysisCompletedStore.set(false);
      this.clearAudio(false); // Clear partially loaded data, don't update URL as it might be the source of error
    }
  }

  private updateUrl = debounce((audioFileUrl?: string, audioFileName?: string) => {
    if (!browser) return;
    log.info(`Updating URL with: URL=${audioFileUrl}, Name=${audioFileName}`);

    const currentUrl = new URL(window.location.href);

    if (audioFileUrl) {
      currentUrl.searchParams.set(PUBLIC_AUDIO_FILE_URL_PARAM_KEY, audioFileUrl);
    } else {
      currentUrl.searchParams.delete(PUBLIC_AUDIO_FILE_URL_PARAM_KEY);
    }

    if (audioFileName) {
      currentUrl.searchParams.set(PUBLIC_AUDIO_FILE_NAME_PARAM_KEY, audioFileName);
    } else {
      currentUrl.searchParams.delete(PUBLIC_AUDIO_FILE_NAME_PARAM_KEY);
    }

    goto(currentUrl, { keepFocus: true, noScroll: true, replaceState: true })
      .then(() => log.info('URL updated successfully.'))
      .catch(err => log.error('Failed to update URL:', err));
  }, 300);


  public setupUrlSerialization(): void {
    log.info('URL serialization setup called.');
    // This method is now more of a conceptual placeholder.
    // The actual URL update is triggered by loadFileAndAnalyze and clearAudio.
    // We might use this to listen to store changes if direct URL manipulation is needed elsewhere.
    // For example, if a store could change the audio file path directly.
    // For now, direct calls to this.updateUrl() from relevant methods handle serialization.
  }

  public async loadUrlOrDefault(): Promise<void> {
    if (!browser) return;
    log.info('Attempting to load audio from URL or default...');

    const urlParams = new URLSearchParams(window.location.search);
    const audioUrlFromParam = urlParams.get(PUBLIC_AUDIO_FILE_URL_PARAM_KEY);
    const audioNameFromParam = urlParams.get(PUBLIC_AUDIO_FILE_NAME_PARAM_KEY);

    if (audioUrlFromParam) {
      try {
        log.info(`Loading from URL parameter: ${audioUrlFromParam}`);
        await this.loadFileAndAnalyze(new URL(audioUrlFromParam), audioNameFromParam || undefined);
      } catch (error) {
        log.error(`Failed to load audio from URL parameter: ${audioUrlFromParam}. Falling back.`, error);
        errorStore.set({ message: `Failed to load from provided URL. ${error instanceof Error ? error.message : ''}`});
        // Fallback to default if URL loading fails
        await this.loadDefaultAudio();
      }
    } else if (PUBLIC_DEFAULT_AUDIO_FILE_URL) {
      log.info(`No audio URL in params, loading default: ${PUBLIC_DEFAULT_AUDIO_FILE_URL}`);
      await this.loadDefaultAudio();
    } else {
      log.info('No audio URL in params and no default URL configured.');
      // Optionally, clear any existing audio or set a specific state
      this.clearAudio();
    }
  }

  private async loadDefaultAudio(): Promise<void> {
    if (!PUBLIC_DEFAULT_AUDIO_FILE_URL) {
      log.warn('No default audio file URL configured.');
      return;
    }
    try {
      log.info(`Loading default audio file: ${PUBLIC_DEFAULT_AUDIO_FILE_URL}`);
      // Extract filename from default URL
      const urlPath = new URL(PUBLIC_DEFAULT_AUDIO_FILE_URL).pathname;
      const defaultFileName = urlPath.substring(urlPath.lastIndexOf('/') + 1) || 'default_audio.mp3';
      await this.loadFileAndAnalyze(new URL(PUBLIC_DEFAULT_AUDIO_FILE_URL), defaultFileName);
    } catch (error) {
      log.error('Failed to load default audio file:', error);
      errorStore.set({ message: `Failed to load default audio. ${error instanceof Error ? error.message : ''}` });
      this.clearAudio(false);
    }
  }

  public clearAudio(updateHistory: boolean = true): void {
    log.info('Clearing audio data.');
    audioSourceNodeStore.set(null);
    audioBufferStore.set(null);
    metaDataStore.set(null);
    waveformDataStore.set(null);
    fileDataStore.set(null);
    analysisCompletedStore.set(false);
    playerStore.actions.reset();
    errorStore.set(null); // Clear any existing errors

    if (updateHistory) {
      this.updateUrl(undefined, undefined); // Clear URL params
    }
    log.info('Audio data cleared.');
  }
}
