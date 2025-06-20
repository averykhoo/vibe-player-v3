// vibe-player-v2.3/src/lib/services/AudioOrchestrator.service.test.ts
import { vi, describe, it, expect, beforeEach, afterEach, SpyInstance } from 'vitest';
import { get, writable } from 'svelte/store';
import AudioOrchestratorService from './AudioOrchestrator.service'; // Assuming default export
import audioEngine from './audioEngine.service';
import dtmfService from './dtmf.service';
import spectrogramService from './spectrogram.service';
import { playerStore } from '$lib/stores/player.store';
import { timeStore } from '$lib/stores/time.store';
import { statusStore } from '$lib/stores/status.store';
import { analysisStore } from '$lib/stores/analysis.store';
import * as urlState from '$lib/utils/urlState'; // To mock updateUrlWithParams
import { URL_HASH_KEYS } from '$lib/utils/constants'; // Import for use in tests

// Mock services and stores
vi.mock('./audioEngine.service', () => ({
    default: {
        decodeAudioData: vi.fn(),
        initializeWorker: vi.fn(),
        stop: vi.fn(),
        unlockAudio: vi.fn().mockResolvedValue(undefined), // Mock unlockAudio
        // Add any other methods called by AudioOrchestrator if necessary
    }
}));

vi.mock('./dtmf.service', () => ({
    default: {
        initialize: vi.fn(),
        process: vi.fn().mockResolvedValue([]), // Mock process to return empty results
    }
}));

vi.mock('./spectrogram.service', () => ({
    default: {
        initialize: vi.fn(),
        process: vi.fn().mockResolvedValue(null), // Mock process
    }
}));

// Mock stores
vi.mock('$lib/stores/player.store', () => ({
    playerStore: writable({ /* initial player state */
        status: 'idle', fileName: null, duration: 0, currentTime: 0, isPlaying: false,
        isPlayable: false, speed: 1.0, pitchShift: 0.0, gain: 1.0, waveformData: undefined,
        error: null, audioBuffer: undefined, audioContextResumed: false, channels: undefined,
        sampleRate: undefined, lastProcessedChunk: undefined,
    })
}));
vi.mock('$lib/stores/time.store', () => ({ timeStore: writable(0) }));
vi.mock('$lib/stores/status.store', () => ({ statusStore: writable({ message: '', type: 'idle', isLoading: false }) }));
vi.mock('$lib/stores/analysis.store', () => ({
    analysisStore: writable({ dtmfResults: [], spectrogramData: null })
}));

// Mock utility functions
vi.mock('$lib/utils/urlState', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        updateUrlWithParams: vi.fn(),
    };
});


describe('AudioOrchestratorService', () => {
    let orchestrator: typeof AudioOrchestratorService;
    let statusStoreSpy: SpyInstance<[unknown], void>;
    let playerStoreSpy: SpyInstance<[unknown], void>;
    let timeStoreSpy: SpyInstance<[number], void>;
    let analysisStoreSpy: SpyInstance<[unknown], void>;

    beforeEach(() => {
        vi.clearAllMocks(); // Clear mocks before each test

        // Reset stores to initial-like states if needed, or ensure mocks handle it
        playerStore.set({
            status: 'idle', fileName: null, duration: 0, currentTime: 0, isPlaying: false,
            isPlayable: false, speed: 1.0, pitchShift: 0.0, gain: 1.0, waveformData: undefined,
            error: null, audioBuffer: undefined, audioContextResumed: false, channels: undefined,
            sampleRate: undefined, lastProcessedChunk: undefined,
        });
        timeStore.set(0);
        statusStore.set({ message: '', type: 'idle', isLoading: false });
        analysisStore.set({ dtmfResults: [], spectrogramData: null });

        statusStoreSpy = vi.spyOn(statusStore, 'set');
        playerStoreSpy = vi.spyOn(playerStore, 'update');
        timeStoreSpy = vi.spyOn(timeStore, 'set');
        analysisStoreSpy = vi.spyOn(analysisStore, 'update');

        orchestrator = AudioOrchestratorService; // Get the singleton instance

        // Mock AudioEngine methods
        (audioEngine.decodeAudioData as vi.Mock).mockResolvedValue({ duration: 10, sampleRate: 44100, numberOfChannels: 2 });
        (audioEngine.initializeWorker as vi.Mock).mockResolvedValue(undefined);
        (audioEngine.stop as vi.Mock).mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('loadFileAndAnalyze', () => {
        const mockFile = new File([new ArrayBuffer(100)], 'test.mp3', { type: 'audio/mp3' });
        const mockAudioBuffer = { duration: 10, sampleRate: 44100, numberOfChannels: 2, getChannelData: vi.fn(() => new Float32Array(0)) } as unknown as AudioBuffer;

        it('should follow the full sequence for successful file loading and analysis', async () => {
            (audioEngine.decodeAudioData as vi.Mock).mockResolvedValue(mockAudioBuffer);

            await orchestrator.loadFileAndAnalyze(mockFile);

            // 1. audioEngine.stop is called
            expect(audioEngine.stop).toHaveBeenCalledTimes(1);

            // 2. Initial statusStore update (loading)
            expect(statusStoreSpy).toHaveBeenCalledWith(expect.objectContaining({
                message: `Loading ${mockFile.name}...`, type: 'info', isLoading: true
            }));

            // 3. playerStore reset (update)
            expect(playerStoreSpy).toHaveBeenCalledWith(expect.any(Function));
            // Check specific initial state values after reset (inside the update function)
            // This is tricky as the update function is internal. We check the resulting state later.

            // 4. analysisStore reset (update)
            expect(analysisStoreSpy).toHaveBeenCalledWith(expect.any(Function));

            // 5. timeStore reset
            expect(timeStoreSpy).toHaveBeenCalledWith(0);

            // 6. audioEngine.unlockAudio called
            expect(audioEngine.unlockAudio).toHaveBeenCalledTimes(1);

            // 7. audioEngine.decodeAudioData called
            expect(audioEngine.decodeAudioData).toHaveBeenCalledWith(await mockFile.arrayBuffer());

            // 8. statusStore update (decoding) - this is internal to _processAudioBuffer
            expect(statusStoreSpy).toHaveBeenCalledWith(expect.objectContaining({
                message: `Decoding audio: ${mockFile.name}...`, type: 'info', isLoading: true
            }));

            // 9. audioEngine.initializeWorker called
            expect(audioEngine.initializeWorker).toHaveBeenCalledWith(mockAudioBuffer);

            // 10. statusStore update (initializing engine) - internal to _processAudioBuffer
             expect(statusStoreSpy).toHaveBeenCalledWith(expect.objectContaining({
                message: `Initializing audio engine for ${mockFile.name}...`, type: 'info', isLoading: true
            }));

            // 11. playerStore update (playable state)
            expect(playerStoreSpy).toHaveBeenCalledWith(expect.any(Function));
            const finalPlayerState = get(playerStore);
            expect(finalPlayerState.isPlayable).toBe(true);
            expect(finalPlayerState.duration).toBe(mockAudioBuffer.duration);
            expect(finalPlayerState.sampleRate).toBe(mockAudioBuffer.sampleRate);
            expect(finalPlayerState.fileName).toBe(mockFile.name);
            expect(finalPlayerState.audioBuffer).toBe(mockAudioBuffer);


            // 12. timeStore set to 0 (after processing within _processAudioBuffer)
            // This call might be redundant if the earlier reset to 0 is the one we care about.
            // Let's ensure it's called at least once with 0 after decode.
            expect(timeStoreSpy).toHaveBeenCalledWith(0);


            // 13. statusStore update (ready)
            expect(statusStoreSpy).toHaveBeenCalledWith(expect.objectContaining({
                isLoading: false, message: `Ready: ${mockFile.name}`, type: 'success'
            }));

            // 14. Background analysis initiated
            expect(dtmfService.initialize).toHaveBeenCalledWith(mockAudioBuffer.sampleRate);
            expect(spectrogramService.initialize).toHaveBeenCalledWith({ sampleRate: mockAudioBuffer.sampleRate });
            expect(dtmfService.process).toHaveBeenCalledWith(mockAudioBuffer);
            expect(spectrogramService.process).toHaveBeenCalledWith(mockAudioBuffer.getChannelData(0));

            // 15. URL update
            expect(urlState.updateUrlWithParams).toHaveBeenCalled();
        });

        it('should handle error during decodeAudioData', async () => {
            const decodeError = new Error('Decode failed');
            (audioEngine.decodeAudioData as vi.Mock).mockRejectedValue(decodeError);

            await orchestrator.loadFileAndAnalyze(mockFile);

            expect(audioEngine.stop).toHaveBeenCalledTimes(1);
            expect(statusStoreSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'info', isLoading: true, message: `Loading ${mockFile.name}...`})); // Initial
            expect(statusStoreSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'info', isLoading: true, message: `Decoding audio: ${mockFile.name}...`})); // Decoding attempt
            expect(statusStoreSpy).toHaveBeenCalledWith(expect.objectContaining({
                message: `Error: Failed to decode audio: ${decodeError.message}`, type: 'error', isLoading: false
            }));
            const finalPlayerState = get(playerStore);
            expect(finalPlayerState.isPlayable).toBe(false);
            expect(finalPlayerState.error).toBe(`Failed to decode audio: ${decodeError.message}`);
            expect(finalPlayerState.status).toBe('error');
        });

        it('should handle error during initializeWorker', async () => {
            const workerError = new Error('Worker init failed');
            (audioEngine.initializeWorker as vi.Mock).mockRejectedValue(workerError);
             (audioEngine.decodeAudioData as vi.Mock).mockResolvedValue(mockAudioBuffer);


            await orchestrator.loadFileAndAnalyze(mockFile);

            expect(audioEngine.stop).toHaveBeenCalledTimes(1);
            expect(statusStoreSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'info', isLoading: true, message: `Initializing audio engine for ${mockFile.name}...`}));
            expect(statusStoreSpy).toHaveBeenCalledWith(expect.objectContaining({
                message: `Error: Failed to initialize audio engine: ${workerError.message}`, type: 'error', isLoading: false
            }));
            const finalPlayerState = get(playerStore);
            expect(finalPlayerState.isPlayable).toBe(false);
            expect(finalPlayerState.error).toBe(`Failed to initialize audio engine: ${workerError.message}`);
            expect(finalPlayerState.status).toBe('error');
        });

        it('should not proceed if isBusy is true', async () => {
            // Manually set isBusy for the test, as the internal state is not easily controlled otherwise for a singleton.
            // This requires a way to inspect or control 'isBusy' or mock it.
            // For this test, we'll assume a simplified scenario where the first call makes it busy.
            // A better approach would be to spy on console.warn or statusStore for the busy message.

            (orchestrator as any).isBusy = true; // Forcefully set isBusy for testing this scenario

            await orchestrator.loadFileAndAnalyze(mockFile);

            expect(audioEngine.stop).not.toHaveBeenCalled();
            expect(statusStoreSpy).toHaveBeenCalledWith(expect.objectContaining({
                 message: 'Player is busy. Please wait.', type: 'warning', isLoading: true
            }));

            (orchestrator as any).isBusy = false; // Reset for other tests
        });
    });

    describe('updateUrlFromState', () => {
        it('should call updateUrlWithParams with correct parameters', () => {
            playerStore.set({
                fileName: 'test.mp3',
                isPlayable: true,
                speed: 1.5,
                pitchShift: 2.0,
                gain: 0.8,
                duration: 120,
                status: 'playing', // ensure other properties are set to satisfy type
                currentTime: 30.5,
                waveformData: undefined, error: null, audioBuffer: undefined, audioContextResumed: true,
                channels: 1, sampleRate: 44100, lastProcessedChunk: undefined
            });
            timeStore.set(30.5);

            orchestrator.updateUrlFromState();

            expect(urlState.updateUrlWithParams).toHaveBeenCalledWith({
                [URL_HASH_KEYS.SPEED]: '1.50',
                [URL_HASH_KEYS.PITCH]: '2.00',
                [URL_HASH_KEYS.GAIN]: '0.80',
                [URL_HASH_KEYS.TIME]: '30.50',
            });
        });

        it('should not include time if near start or end', () => {
             playerStore.set({
                fileName: 'test.mp3', isPlayable: true, duration: 100, speed: 1, pitchShift: 0, gain: 1,
                status: 'playing', currentTime: 0, waveformData: undefined, error: null, audioBuffer: undefined,
                audioContextResumed: true, channels: 1, sampleRate: 44100, lastProcessedChunk: undefined
            });

            timeStore.set(0.05); // Near start
            orchestrator.updateUrlFromState();
            expect(urlState.updateUrlWithParams).toHaveBeenCalledWith(expect.not.objectContaining({ [URL_HASH_KEYS.TIME]: '0.05' }));

            timeStore.set(99.95); // Near end
            orchestrator.updateUrlFromState();
            expect(urlState.updateUrlWithParams).toHaveBeenCalledWith(expect.not.objectContaining({ [URL_HASH_KEYS.TIME]: '99.95' }));

            timeStore.set(0);
            orchestrator.updateUrlFromState();
            expect(urlState.updateUrlWithParams).toHaveBeenCalledWith(expect.not.objectContaining({ [URL_HASH_KEYS.TIME]: '0.00' }));
        });

        it('should clear params if not playable by calling with empty object', () => {
            playerStore.set({
                isPlayable: false, duration: 100, speed: 1, pitchShift: 0, gain: 1,
                status: 'idle', currentTime: 0, fileName: null, waveformData: undefined, error: null,
                audioBuffer: undefined, audioContextResumed: false, channels: undefined, sampleRate: undefined,
                lastProcessedChunk: undefined
            });
            orchestrator.updateUrlFromState();
            // If not playable, and other params are at default, it should result in an empty params object.
            expect(urlState.updateUrlWithParams).toHaveBeenCalledWith({});
        });
    });

    describe('handleError', () => {
        it('should update statusStore and playerStore correctly and call audioEngine.stop', () => {
            const errorMessage = "Test error message";
            orchestrator.handleError(new Error(errorMessage));

            expect(statusStoreSpy).toHaveBeenCalledWith({
                message: `Error: ${errorMessage}`,
                type: 'error',
                isLoading: false,
            });

            const playerState = get(playerStore);
            expect(playerState.error).toBe(errorMessage);
            expect(playerState.isPlaying).toBe(false);
            expect(playerState.isPlayable).toBe(false);
            expect(playerState.status).toBe('error');

            expect(audioEngine.stop).toHaveBeenCalledTimes(1);
            expect(urlState.updateUrlWithParams).toHaveBeenCalled();
        });
    });
});
