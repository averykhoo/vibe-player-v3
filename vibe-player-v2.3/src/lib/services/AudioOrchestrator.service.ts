// vibe-player-v2.3/src/lib/services/AudioOrchestrator.service.ts
import { get } from 'svelte/store';
import { playerStore } from '$lib/stores/player.store';
import { timeStore } from '$lib/stores/time.store'; // NEW
import { statusStore } from '$lib/stores/status.store';
import { analysisStore } from '$lib/stores/analysis.store';
import audioEngine from './audioEngine.service';
import dtmfService from './dtmf.service';
import spectrogramService from './spectrogram.service';
import { debounce } from '$lib/utils/async';
import { updateUrlWithParams } from '$lib/utils/urlState';
import { UI_CONSTANTS, URL_HASH_KEYS } from '$lib/utils/constants';

export class AudioOrchestrator {
    private static instance: AudioOrchestrator;
    private isBusy = false; // Prevents re-entrancy

    private constructor() { }

    public static getInstance(): AudioOrchestrator {
        if (!AudioOrchestrator.instance) {
            AudioOrchestrator.instance = new AudioOrchestrator();
        }
        return AudioOrchestrator.instance;
    }

    private async _processAudioBuffer(buffer: ArrayBuffer, name: string): Promise<void> {
        statusStore.set({ message: `Decoding audio...`, type: 'info', isLoading: true });
        const audioBuffer = await audioEngine.decodeAudioData(buffer);

        statusStore.set({ message: `Initializing audio engine...`, type: 'info', isLoading: true });
        await audioEngine.initializeWorker(audioBuffer);

        playerStore.update(s => ({
            ...s,
            duration: audioBuffer.duration,
            sampleRate: audioBuffer.sampleRate,
            fileName: name,
            isPlayable: true,
            // Reset relevant state for new file
            audioBuffer: audioBuffer, // Store the original buffer if needed for re-processing
            currentTime: 0,
            error: null,
        }));
        timeStore.set(0); // Ensure timeStore is also reset

        statusStore.set({ isLoading: false, message: 'Ready', type: 'success' });

        this._runBackgroundAnalysis(audioBuffer);
    }

    private _runBackgroundAnalysis(audioBuffer: AudioBuffer) {
        // Ensure services are initialized before processing
        // This might be better handled in the respective services' getInstance or a dedicated init method
        // if they also have internal state that needs resetting.
        dtmfService.initialize(audioBuffer.sampleRate);
        spectrogramService.initialize({ sampleRate: audioBuffer.sampleRate });

        // Reset previous analysis results
        analysisStore.update(s => ({
            ...s,
            dtmfResults: [],
            spectrogramData: null,
            // Reset any other analysis-specific state here
        }));

        Promise.allSettled([
            dtmfService.process(audioBuffer),
            spectrogramService.process(audioBuffer.getChannelData(0)), // Assuming mono for now or first channel
        ]).then(results => {
            results.forEach((result, index) => {
                if (result.status === 'rejected') {
                    console.error(`Analysis task ${index} failed:`, result.reason);
                    // Optionally update statusStore or a dedicated analysisErrorStore
                }
            });
        });
    }

    public async loadFileAndAnalyze(file: File): Promise<void> {
        if (this.isBusy) {
            console.warn("AudioOrchestrator is busy, skipping loadFileAndAnalyze for:", file.name);
            return;
        }
        this.isBusy = true;

        statusStore.set({ message: `Loading ${file.name}...`, type: 'info', isLoading: true });
        // Reset player state more comprehensively
        playerStore.update(s => ({
            ...s,
            isPlayable: false,
            error: null,
            fileName: file.name,
            duration: 0,
            // waveformData: undefined, // if this is generated per file
            // audioBuffer: undefined, // Handled in _processAudioBuffer
            // channels: undefined,
            // sampleRate: undefined,
        }));
        analysisStore.update(s => ({ ...s, dtmfResults: [], spectrogramData: null }));
        timeStore.set(0);
        audioEngine.stop(); // Stop any ongoing playback before loading new file

        try {
            await audioEngine.unlockAudio(); // Ensure audio context is unlocked
            const arrayBuffer = await file.arrayBuffer();
            await this._processAudioBuffer(arrayBuffer, file.name);
            this.updateUrlFromState(); // Update URL after successful load
        } catch (e: any) {
            console.error("Error in loadFileAndAnalyze:", e);
            statusStore.set({ isLoading: false, message: `Failed to load file: ${e.message}`, type: 'error' });
            playerStore.update(s => ({ ...s, error: e.message, isPlayable: false }));
        } finally {
            this.isBusy = false;
        }
    }

    public updateUrlFromState = (): void => {
        if (typeof window === 'undefined') return;

        const pStore = get(playerStore);
        // const aStore = get(analysisStore); // analysisStore changes shouldn't trigger URL updates directly
        const tStore = get(timeStore);

        const params: Record<string, string> = {};

        if (pStore.fileName) params[URL_HASH_KEYS.FILE_NAME] = encodeURIComponent(pStore.fileName); // Add filename if desired
        if (pStore.speed !== 1.0) params[URL_HASH_KEYS.SPEED] = pStore.speed.toFixed(2);
        if (pStore.pitchShift !== 0.0) params[URL_HASH_KEYS.PITCH] = pStore.pitchShift.toFixed(2);
        if (pStore.gain !== 1.0) params[URL_HASH_KEYS.GAIN] = pStore.gain.toFixed(2);

        // Only include time if it's significantly different from 0, to avoid cluttering URL on initial load/stop
        if (tStore > 0.1 && pStore.isPlayable) { // Check isPlayable to avoid adding time for a non-loaded file
            params[URL_HASH_KEYS.TIME] = tStore.toFixed(2);
        }


        // Example for analysis params if needed in future:
        // if (aStore.someAnalysisParam) params['analysis_param'] = aStore.someAnalysisParam;

        updateUrlWithParams(params);
    };

    public setupUrlSerialization(): void {
        if (typeof window === 'undefined') return;

        const debouncedUpdater = debounce(this.updateUrlFromState, UI_CONSTANTS.DEBOUNCE_HASH_UPDATE_MS);

        // Subscribe to stores that should trigger URL updates
        playerStore.subscribe(state => {
            // Call updater only for relevant state changes to avoid unnecessary updates
            // e.g. isPlaying, isPlayable, error, fileName, duration, speed, pitch, gain
            // This is a common pattern, or can use a more sophisticated derived store if needed.
            debouncedUpdater();
        });

        // timeStore changes are handled by explicit calls in audioEngine.seek() and potentially play/pause
        // However, if we want live URL updates during playback (e.g. every few seconds), we might subscribe here too,
        // but that's generally not desired due to excessive history entries.
        // The current approach of updating on seek/load is usually sufficient.

        // analysisStore changes typically do not update the URL unless explicitly desired.
        // analysisStore.subscribe(debouncedUpdater);
    }

    /**
     * Handles errors reported by other services (e.g., AudioEngine worker).
     * @param error The error object.
     */
    public handleError(error: Error): void {
        console.error("[AudioOrchestrator] Handling error:", error);
        statusStore.set({
            message: `Error: ${error.message}`,
            type: 'error',
            isLoading: false,
        });
        playerStore.update(s => ({ ...s, error: error.message, isPlaying: false, isPlayable: false }));
        // Potentially stop audio engine as well
        audioEngine.stop();
    }
}

export default AudioOrchestrator.getInstance();
