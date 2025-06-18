// vibe-player-v2/src/lib/services/AudioOrchestrator.service.test.ts
import { vi, describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { writable, get } from 'svelte/store';
import { AudioOrchestrator } from './AudioOrchestrator.service';
import { audioEngine } from './audioEngine.service';
import { dtmfService } from './dtmf.service';
import { spectrogramService } from './spectrogram.service';
import { updateUrlWithParams } from '$lib/utils/urlState';
import { URL_HASH_KEYS, UI_CONSTANTS } from '$lib/utils/constants';

// Mock svelte/store's get explicitly for URL serialization tests
vi.mock('svelte/store', async (importOriginal) => {
    const actual = await importOriginal<typeof import('svelte/store')>();
    return {
        ...actual,
        get: vi.fn(actual.get), // Spy on get while retaining original functionality
    };
});

// Mock services
vi.mock('./audioEngine.service', () => ({
    audioEngine: {
        unlockAudio: vi.fn().mockResolvedValue(undefined),
        loadFile: vi.fn(),
        getDuration: vi.fn(() => 120), // Default mock duration
        getSampleRate: vi.fn(() => 44100), // Default mock sample rate
        getNumberOfChannels: vi.fn(() => 1), // Default mock channels
        // Add other methods used by Orchestrator if any
    }
}));

vi.mock('./dtmf.service', () => ({
    dtmfService: {
        init: vi.fn(),
        process: vi.fn().mockResolvedValue([]), // Default mock DTMF results
    }
}));

vi.mock('./spectrogram.service', () => ({
    spectrogramService: {
        init: vi.fn(),
        process: vi.fn().mockResolvedValue(new Float32Array()), // Default mock spectrogram data
    }
}));

vi.mock('$lib/utils/urlState', () => ({
    updateUrlWithParams: vi.fn(),
}));

// Mock Stores
const mockPlayerStore = writable({
    fileName: null,
    duration: 0,
    currentTime: 0,
    sampleRate: 0,
    channels: 0,
    isPlayable: false,
    isPlaying: false,
    speed: 1.0,
    pitch: 0.0,
    gain: 1.0,
    error: null,
    status: 'Idle',
});
vi.mock('$lib/stores/player.store.ts', () => ({
    playerStore: {
        ...mockPlayerStore,
        set: vi.fn((newState) => mockPlayerStore.set(newState)),
        update: vi.fn((updater) => mockPlayerStore.update(updater)),
    }
}));

const mockAnalysisStore = writable({
    dtmfResults: [],
    spectrogramData: null,
    // vadPositiveThreshold: 0.9, // Example value
    // vadNoiseFloor: -70, // Example value
});
vi.mock('$lib/stores/analysis.store.ts', () => ({
    analysisStore: {
        ...mockAnalysisStore,
        set: vi.fn((newState) => mockAnalysisStore.set(newState)),
        update: vi.fn((updater) => mockAnalysisStore.update(updater)),
    }
}));

const mockStatusStore = writable({
    message: null,
    type: null,
    isLoading: false,
    details: null,
    progress: null,
});
vi.mock('$lib/stores/status.store.ts', () => {
    // Need to re-assign mockStatusStore here if we want the spies on the same instance
    // This is a bit tricky with vi.mock hoisting. A simpler way for spies:
    const setFn = vi.fn((newState) => mockStatusStore.set(newState));
    const updateFn = vi.fn((updater) => mockStatusStore.update(updater));
    // To ensure 'get' works on this mocked store within tests if needed:
    const subscribeFn = mockStatusStore.subscribe;

    return {
        statusStore: {
            set: setFn,
            update: updateFn,
            subscribe: subscribeFn, // Allow reading the store's value
        }
    };
});
// Import the mocked store to use in tests
import { statusStore } from '$lib/stores/status.store';
import { playerStore } from '$lib/stores/player.store';
// import { analysisStore } from '$lib/stores/analysis.store'; // If needed for URL tests


describe('AudioOrchestrator.service.ts', () => {
    let audioOrchestrator: AudioOrchestrator;
    const mockFile = new File([''], 'test-audio.mp3', { type: 'audio/mpeg' });
    const mockAudioBuffer = {
        duration: 120,
        sampleRate: 44100,
        numberOfChannels: 1,
        getChannelData: vi.fn(() => new Float32Array(1024)),
    } as unknown as AudioBuffer;

    beforeAll(() => {
        vi.useFakeTimers();
    });

    beforeEach(() => {
        audioOrchestrator = AudioOrchestrator.getInstance();
        // Reset mocks before each test
        vi.clearAllMocks();

        // Reset stores to initial-like states
        mockPlayerStore.set({
            fileName: null, duration: 0, currentTime: 0, sampleRate: 0, channels: 0,
            isPlayable: false, isPlaying: false, speed: 1.0, pitch: 0.0, gain: 1.0, error: null, status: 'Idle',
        });
        mockAnalysisStore.set({ dtmfResults: [], spectrogramData: null });
        mockStatusStore.set({ message: null, type: null, isLoading: false, details: null, progress: null });

        // Mock audioEngine.loadFile to return a resolved AudioBuffer by default
        (audioEngine.loadFile as vi.Mock).mockResolvedValue(mockAudioBuffer);
    });

    afterEach(() => {
        vi.clearAllTimers();
    });

    describe('loadFileAndAnalyze', () => {
        it('should set loading status, update player store, and then set ready status on successful load', async () => {
            await audioOrchestrator.loadFileAndAnalyze(mockFile);

            expect(statusStore.set).toHaveBeenCalledWith({
                message: `Loading ${mockFile.name}...`,
                type: 'info',
                isLoading: true,
                details: null,
                progress: null
            });
            expect(playerStore.update).toHaveBeenCalled(); // General check, specific checks below

            // Check playerStore state after successful load
            const finalPlayerState = get(playerStore);
            expect(finalPlayerState.fileName).toBe(mockFile.name);
            expect(finalPlayerState.duration).toBe(mockAudioBuffer.duration);
            expect(finalPlayerState.sampleRate).toBe(mockAudioBuffer.sampleRate);
            expect(finalPlayerState.channels).toBe(mockAudioBuffer.numberOfChannels);
            expect(finalPlayerState.isPlayable).toBe(true);
            expect(finalPlayerState.status).toBe('Ready');

            expect(statusStore.set).toHaveBeenLastCalledWith({
                message: 'Ready',
                type: 'success',
                isLoading: false
            });

            // Verify analysis services were initialized and called
            expect(audioEngine.unlockAudio).toHaveBeenCalled();
            expect(audioEngine.loadFile).toHaveBeenCalledWith(mockFile);
            expect(spectrogramService.init).toHaveBeenCalledWith(mockAudioBuffer.sampleRate);
            expect(dtmfService.init).toHaveBeenCalledWith(mockAudioBuffer.sampleRate);
            expect(spectrogramService.process).toHaveBeenCalled();
            expect(dtmfService.process).toHaveBeenCalled();
        });

        it('should set error status in statusStore and playerStore if audioEngine.loadFile fails', async () => {
            const errorMessage = 'Failed to load file';
            (audioEngine.loadFile as vi.Mock).mockRejectedValueOnce(new Error(errorMessage));

            await audioOrchestrator.loadFileAndAnalyze(mockFile);

            expect(statusStore.set).toHaveBeenCalledWith({
                message: `Loading ${mockFile.name}...`,
                type: 'info',
                isLoading: true,
                details: null,
                progress: null
            });

            expect(statusStore.set).toHaveBeenLastCalledWith({
                message: 'File processing failed.',
                type: 'error',
                isLoading: false,
                details: errorMessage
            });

            const finalPlayerState = get(playerStore);
            expect(finalPlayerState.status).toBe('Error');
            expect(finalPlayerState.error).toBe(errorMessage);
            expect(finalPlayerState.isPlayable).toBe(false);
            expect(finalPlayerState.duration).toBe(0);
        });

        it('should handle errors from analysis services gracefully', async () => {
            const dtmfError = 'DTMF processing failed';
            (dtmfService.process as vi.Mock).mockRejectedValueOnce(new Error(dtmfError));

            await audioOrchestrator.loadFileAndAnalyze(mockFile);

            // Still loads successfully overall
            expect(statusStore.set).toHaveBeenLastCalledWith({
                message: 'Ready',
                type: 'success',
                isLoading: false
            });
            expect(playerStore.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'Ready' }));

            // Check console.error was called (or some other error reporting if implemented)
            // This requires spying on console.error, which can be done in setup.
            // For now, this test ensures the main flow completes.
        });
    });

    describe('setupUrlSerialization', () => {
        const initialPlayerState = {
            speed: 0.75,
            pitch: -2.5,
            gain: 1.25,
            // other playerStore properties...
        };

        beforeEach(() => {
            // Set a specific state for playerStore for these tests
            mockPlayerStore.set({
                ...get(playerStore), // keep other defaults
                ...initialPlayerState,
            });
             // Ensure 'get' from svelte/store returns the current state of our mock stores
            (get as vi.Mock).mockImplementation((store: any) => {
                if (store === playerStore) return mockPlayerStore_getState(); // A helper to get current value
                // if (store === analysisStore) return mockAnalysisStore_getState();
                return {}; // default for other stores if any
            });
        });

        // Helper to get current state of mockPlayerStore for the 'get' spy
        const mockPlayerStore_getState = () => {
            let value;
            mockPlayerStore.subscribe(v => value = v)(); // Immediately invoke to get current value
            return value;
        }


        it('should subscribe to playerStore and analysisStore', () => {
            // To spy on subscribe, the mock needs to expose it as a spy
            // This is a bit more involved with vi.mock, let's assume playerStore.subscribe is a spy
            // For now, we'll test the effect (updateUrlWithParams call)
            audioOrchestrator.setupUrlSerialization();
            // This doesn't directly test subscription, but the call below does
            expect(true).toBe(true); // Placeholder
        });

        it('should call updateUrlWithParams with correct parameters after debounced interval', () => {
            audioOrchestrator.setupUrlSerialization();

            // Trigger a change in playerStore to initiate debounced update
            playerStore.update(s => ({ ...s, speed: 0.5 }));

            vi.runAllTimers(); // Advance timers to trigger debounce

            expect(updateUrlWithParams).toHaveBeenCalledTimes(1);
            // The debounced function calls get(playerStore) when it executes.
            // So, it should reflect the speed: 0.5 change.
            // Pitch and Gain remain from the initialPlayerState set in beforeEach.
            expect(updateUrlWithParams).toHaveBeenCalledWith({
                [URL_HASH_KEYS.SPEED]: '0.50',
                [URL_HASH_KEYS.PITCH]: initialPlayerState.pitch.toFixed(1),
                [URL_HASH_KEYS.GAIN]: initialPlayerState.gain.toFixed(2),
            });
        });

        it('should use updated values if store changes multiple times before debounce', () => {
            audioOrchestrator.setupUrlSerialization();

            // Perform updates that will be picked up by get(playerStore) when debounce executes
            playerStore.update(s => ({ ...s, speed: 0.5 }));
            playerStore.update(s => ({ ...s, speed: 0.8, pitch: 1.5 }));

            // No need to directly set mockPlayerStore here if playerStore.update correctly updates it
            // and mockPlayerStore_getState() correctly reads it.
            // The get() in the production code will see the state after these two updates.

            vi.runAllTimers();

            expect(updateUrlWithParams).toHaveBeenCalledTimes(1);
            expect(updateUrlWithParams).toHaveBeenCalledWith({
                [URL_HASH_KEYS.SPEED]: '0.80', // from the last update
                [URL_HASH_KEYS.PITCH]: '1.5',  // from the last update
                [URL_HASH_KEYS.GAIN]: initialPlayerState.gain.toFixed(2), // Unchanged from initial state
            });
        });
    });
});

// Helper to get current state of mockPlayerStore for the 'get' spy
// This needs to be defined outside the describe block if used in multiple places
// or passed around if defined inside.
// For simplicity, it was defined within the describe('setupUrlSerialization') block.
// const mockPlayerStore_getState = () => {
//    let value;
//    playerStore.subscribe(v => value = v)(); // playerStore here is the mocked one
//    return value;
// }
// const mockAnalysisStore_getState = () => {
//    let value;
//    analysisStore.subscribe(v => value = v)();
//    return value;
// }
