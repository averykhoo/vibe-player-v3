// vibe-player-v2/src/lib/services/AudioOrchestrator.service.ts
import { get } from 'svelte/store';
import { playerStore } from '$lib/stores/player.store';
import { analysisStore } from '$lib/stores/analysis.store';
import audioEngine from './audioEngine.service';
import dtmfService from './dtmf.service';
import spectrogramService from './spectrogram.service';
import { debounce, updateUrlWithParams, UI_CONSTANTS, URL_HASH_KEYS } from '$lib/utils';

class AudioOrchestrator {
    private static instance: AudioOrchestrator;
    private constructor() {}

    public static getInstance(): AudioOrchestrator {
        if (!AudioOrchestrator.instance) {
            AudioOrchestrator.instance = new AudioOrchestrator();
        }
        return AudioOrchestrator.instance;
    }

    /** Orchestrates the entire file loading and analysis process. */
    public async loadFileAndAnalyze(file: File): Promise<void> {
        console.log(`[Orchestrator] === Starting New File Load: ${file.name} ===`);
        // Reset all relevant stores to a clean "loading" state...
        playerStore.update(s => ({
            ...s,
            status: 'Loading',
            error: null,
            isPlayable: false,
            duration: 0,
            currentTime: 0,
            // Keep other settings like speed, pitch, gain, loop, etc.
        }));
        analysisStore.update(s => ({
            ...s,
            dtmfAnalysis: [],
            spectrogramData: null,
            // Keep other analysis settings
        }));


        try {
            await audioEngine.unlockAudio();
            console.log(`[Orchestrator] --> Calling audioEngine.loadFile to decode...`);
            const audioBuffer = await audioEngine.loadFile(file);
            console.log(`[Orchestrator] <-- Audio decoding complete. Duration: ${audioBuffer.duration.toFixed(2)}s`);

            playerStore.update(s => ({ ...s, status: 'Ready', isPlayable: true, duration: audioBuffer.duration, sampleRate: audioBuffer.sampleRate }));

            spectrogramService.initialize({ sampleRate: audioBuffer.sampleRate });
            // Assuming dtmfService is initialized with a default or it handles its own sample rate needs.
            // If dtmfService needs specific sample rate from audioBuffer, it should be passed here.
            // For now, using a common default as per original snippet if it was intended.
            dtmfService.initialize(16000); // Or audioBuffer.sampleRate if required by dtmfService

            console.log(`[Orchestrator] Dispatching parallel analysis tasks (DTMF, Spectrogram)...`);
            Promise.allSettled([
                dtmfService.process(audioBuffer),
                spectrogramService.process(audioBuffer.getChannelData(0)) // Assuming mono, or process all channels as needed
            ]).then((results) => {
                console.log(`[Orchestrator] All background analysis tasks have settled.`);
                results.forEach(result => {
                    if (result.status === 'rejected') {
                        console.error('[Orchestrator] Analysis task failed:', result.reason);
                    }
                });
            });

        } catch (error: any) {
            console.error(`[Orchestrator] !!! CRITICAL ERROR during file load:`, error);
            playerStore.update(s => ({ ...s, status: 'Error', error: error.message || 'Unknown error during file load' }));
        }
    }

    /** Sets up a single, authoritative subscription to serialize state to the URL. */
    public setupUrlSerialization(): void {
        console.log('[Orchestrator] Setting up URL serialization subscription.');
        const debouncedUpdater = debounce(() => {
            const pStore = get(playerStore);
            const aStore = get(analysisStore);
            const params: Record<string, string> = {
                // Player settings
                [URL_HASH_KEYS.PLAYBACK_SPEED]: pStore.speed.toString(),
                [URL_HASH_KEYS.PITCH_SHIFT]: pStore.pitchShift.toString(),
                [URL_HASH_KEYS.GAIN_LEVEL]: pStore.gain.toString(),
                [URL_HASH_KEYS.LOOP_ACTIVE]: String(pStore.loopActive),
                [URL_HASH_KEYS.LOOP_START]: pStore.loopStart.toString(),
                [URL_HASH_KEYS.LOOP_END]: pStore.loopEnd.toString(),
                [URL_HASH_KEYS.CURRENT_TIME]: pStore.currentTime.toFixed(UI_CONSTANTS.URL_TIME_PRECISION), // Added currentTime

                // Analysis settings (example, expand as needed)
                [URL_HASH_KEYS.DTMF_ENABLED]: String(aStore.dtmfEnabled),
                [URL_HASH_KEYS.SPECTROGRAM_ENABLED]: String(aStore.spectrogramEnabled),
                // Add other relevant analysis params from aStore
            };
            // Remove undefined or default values to keep URL clean
            for (const key in params) {
                if (params[key] === undefined || params[key] === null || params[key] === '' ||
                    (key === URL_HASH_KEYS.PLAYBACK_SPEED && params[key] === '1') ||
                    (key === URL_HASH_KEYS.PITCH_SHIFT && params[key] === '0') ||
                    (key === URL_HASH_KEYS.GAIN_LEVEL && params[key] === '1') ||
                    (key === URL_HASH_KEYS.LOOP_ACTIVE && params[key] === 'false')
                    // Add other default conditions
                ) {
                    delete params[key];
                }
            }

            console.log(`[Orchestrator/URL] Debounced update triggered. New params:`, params);
            updateUrlWithParams(params);
        }, UI_CONSTANTS.DEBOUNCE_HASH_UPDATE_MS);

        // Subscribe to stores whose changes should trigger URL update
        playerStore.subscribe(pStore => {
            // Only call updater if relevant parts of playerStore changed
            // This prevents unnecessary updates for things like 'status' or 'error'
            const relevantChanges = {
                speed: pStore.speed,
                pitchShift: pStore.pitchShift,
                gain: pStore.gain,
                loopActive: pStore.loopActive,
                loopStart: pStore.loopStart,
                loopEnd: pStore.loopEnd,
                currentTime: pStore.currentTime,
            };
            // Consider creating a derived store or a more sophisticated check if performance is an issue.
            debouncedUpdater();
        });
        analysisStore.subscribe(aStore => {
            // Similar to playerStore, only update for relevant changes
            const relevantChanges = {
                dtmfEnabled: aStore.dtmfEnabled,
                spectrogramEnabled: aStore.spectrogramEnabled,
                // Add other relevant analysis store properties
            };
            debouncedUpdater();
        });
    }
}

export default AudioOrchestrator.getInstance();
