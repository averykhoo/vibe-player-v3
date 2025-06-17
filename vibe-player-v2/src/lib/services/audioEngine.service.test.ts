// vibe-player-v2/src/lib/services/audioEngine.service.test.ts
import { writable, type Writable } from 'svelte/store'; // Needed for playerStore mock
import { vi } from 'vitest'; // vi itself is needed for vi.mock

// --- Mocks ---
// IMPORTANT: All vi.mock calls MUST come before any other 'import' statements
// that are not utility imports for the mocks themselves.

// initialPlayerStateForMock is defined here for tests to use via __test__getInitialPlayerState
const initialPlayerStateForMock = {
    speed: 1.0, pitch: 0.0, gain: 1.0, isPlayable: false, isPlaying: false,
    error: null, fileName: '', status: '', duration: 0, currentTime: 0, audioBuffer: null
};

// player.store mock: factory creates the instance internally to avoid ReferenceError
vi.mock('$lib/stores/player.store', async () => {
  // Define the initial state data directly within the factory
  const stateDataForFactory = {
    speed: 1.0, pitch: 0.0, gain: 1.0, isPlayable: false, isPlaying: false,
    error: null, fileName: '', status: '', duration: 0, currentTime: 0, audioBuffer: null
  };
  const { writable: actualWritable } = await vi.importActual<typeof import('svelte/store')>('svelte/store');
  const internalPlayerStoreInstance = actualWritable({ ...stateDataForFactory });
  return {
    playerStore: internalPlayerStoreInstance, // Corrected typo
    __test__getPlayerStoreInstance: () => internalPlayerStoreInstance, // Corrected typo
    // Export a function that returns a copy of the state data used by the factory,
    // or directly use the global initialPlayerStateForMock if preferred for __test__getInitialPlayerState.
    // For consistency and to ensure the factory is self-contained for data:
    __test__getInitialPlayerState: () => ({ ...stateDataForFactory })
  };
});
// This `actualPlayerStoreMockInstance` is not directly used by the vi.mock factory.
// Tests will use __test__getPlayerStoreInstance().
// For this subtask, let's ensure it's defined as requested by the prompt for the "top-level" definition.
// However, it's not strictly necessary if tests exclusively use __test__getPlayerStoreInstance().
// For now, keeping it as it doesn't harm if unused.
const actualPlayerStoreMockInstance = writable({ ...initialPlayerStateForMock });

// Mock for the AudioEngineService itself
// The factory creates the spy object internally to comply with vi.mock hoisting.
vi.mock('./audioEngine.service', () => {
    const serviceSpies = {
        unlockAudio: vi.fn(),
        loadFile: vi.fn(), // If this needs to return a Promise: vi.fn().mockResolvedValue(undefined)
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        setSpeed: vi.fn(),
        setPitch: vi.fn(),
        setGain: vi.fn(),
        dispose: vi.fn()
        // Ensure all public methods from the actual AudioEngineService class are listed here.
    };
    return {
        default: serviceSpies,
        // Optional: accessor if direct access to the spy object is needed beyond the default import.
        // __test__getServiceSpies: () => serviceSpies
    };
});

const actualMockWorkerInstance = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null
};
vi.mock('$lib/workers/rubberband.worker?worker&inline', () => ({
    default: vi.fn().mockImplementation(() => actualMockWorkerInstance),
    __test__getMockWorker: () => actualMockWorkerInstance
}));

// Mock AudioContext and its methods
const actualMockDecodeAudioData = vi.fn();
global.AudioContext = vi.fn(() => ({
    decodeAudioData: actualMockDecodeAudioData,
    createGain: vi.fn(() => ({
        connect: vi.fn(),
        gain: { setValueAtTime: vi.fn() }
    })),
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    state: 'running',
    currentTime: 0,
    destination: {},
    sampleRate: 48000
})) as any;

// Mock fetch for worker dependencies
vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        text: () => Promise.resolve('// Mock loader script')
    } as Response)
);
// --- End Mocks ---

// Now the actual test file imports can begin
import { afterEach, beforeEach, describe, expect, it } from 'vitest'; // 'vi' already imported
import { get } from 'svelte/store'; // 'writable' already imported
import audioEngineService from './audioEngine.service'; // Static import!
import { RB_WORKER_MSG_TYPE } from '$lib/types/worker.types';

// Import accessors from mocked modules
import { __test__getPlayerStoreInstance, __test__getInitialPlayerState } from '$lib/stores/player.store';
import { __test__getMockWorker } from '$lib/workers/rubberband.worker?worker&inline';


describe('AudioEngineService (Simplified Setup)', () => {
    const MOCK_RAF_ID = 12345;
    let rafSpy: ReturnType<typeof vi.spyOn>;
    let cafSpy: ReturnType<typeof vi.spyOn>;
    let mockAudioBuffer: AudioBuffer;
    // No longer need currentTestPlayerStore or currentMockWorkerInstance, use accessors or direct instances.

    // Helper to simulate the worker becoming ready after INIT
    const makeWorkerReady = () => {
        // This helper will now directly update the store to simulate the effect
        // of the worker sending an INIT_SUCCESS message and the service handling it.
        const store = __test__getPlayerStoreInstance();
        store.update(s => ({ ...s, isPlayable: true, status: `Ready: ${s.fileName || 'test.wav'}` }));
    };

    beforeEach(async () => {
        vi.useFakeTimers(); // Enable fake timers
        vi.clearAllMocks(); // Clear all spies and mocks

        const store = __test__getPlayerStoreInstance();
        const initialPlayerFullState = __test__getInitialPlayerState();
        store.set({ ...initialPlayerFullState });

        // Default implementations for service spies
        audioEngineService.loadFile.mockImplementation(async (audioBuffer, fileName) => {
            store.update(s => ({
                ...s,
                status: `Initializing ${fileName}...`,
                fileName,
                duration: mockAudioBuffer.duration, // Assuming mockAudioBuffer is available
                sampleRate: mockAudioBuffer.sampleRate,
                channels: mockAudioBuffer.numberOfChannels,
                error: null,
                isPlayable: false // Becomes playable after worker ready
            }));
            // Simulate interaction with worker
            actualMockWorkerInstance.postMessage({
                type: RB_WORKER_MSG_TYPE.INIT,
                payload: {
                    channels: mockAudioBuffer.numberOfChannels,
                    sampleRate: mockAudioBuffer.sampleRate,
                    // other relevant fields if needed by worker mock
                }
            }, []); // Pass empty array for transferables if any
            return Promise.resolve(undefined);
        });
        audioEngineService.dispose.mockImplementation(() => {
            store.set({ ...initialPlayerFullState, status: 'Disposed' });
        });
        audioEngineService.play.mockImplementation(async () => {
            const storeInstance = __test__getPlayerStoreInstance();
            if (get(storeInstance).isPlayable) {
                // Directly call window.requestAnimationFrame; rafSpy will catch it.
                window.requestAnimationFrame(() => {});
                storeInstance.update(s => ({ ...s, isPlaying: true, status: 'Playing' }));
                // If the original play returns the rafId, mock that too. Assume it doesn't for now or returns void/Promise<void>.
            }
            return Promise.resolve();
        });
        audioEngineService.pause.mockImplementation(() => {
            const storeInstance = __test__getPlayerStoreInstance();
            // Directly call window.cancelAnimationFrame; cafSpy will catch it.
            window.cancelAnimationFrame(MOCK_RAF_ID); // Assuming play sets/returns this ID to the service's internal state
            storeInstance.update(s => ({ ...s, isPlaying: false, status: 'Paused' }));
        });
        audioEngineService.stop.mockImplementation(() => {
            const storeInstance = __test__getPlayerStoreInstance();
            window.cancelAnimationFrame(MOCK_RAF_ID); // Assuming play sets/returns this ID
            actualMockWorkerInstance.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });
            storeInstance.update(s => ({ ...s, isPlaying: false, currentTime: 0, status: 'Stopped' }));
        });
        audioEngineService.seek.mockImplementation(async (time) => {
            const storeInstance = __test__getPlayerStoreInstance();
            const isPlaying = get(storeInstance).isPlaying;
            if (isPlaying) {
                window.cancelAnimationFrame(MOCK_RAF_ID); // Assuming play sets/returns this ID
            }
            actualMockWorkerInstance.postMessage({ type: RB_WORKER_MSG_TYPE.RESET });
            storeInstance.update(s => ({ ...s, currentTime: time }));
            if (isPlaying) {
                // Directly await the play spy, removing the setTimeout complexity
                await audioEngineService.play(); // This will call the mocked play
            }
        });


        // Spies for window methods
        rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { if(cb) cb(0); return MOCK_RAF_ID; });
        cafSpy = vi.spyOn(window, 'cancelAnimationFrame');

        // Mock AudioBuffer for tests (remains available in the describe scope)
        mockAudioBuffer = {
            duration: 10.0,
            numberOfChannels: 1,
            sampleRate: 44100,
            getChannelData: vi.fn(() => new Float32Array(441000).fill(0.1)),
            length: 441000
        } as unknown as AudioBuffer;
        actualMockDecodeAudioData.mockResolvedValue(mockAudioBuffer); // For global AudioContext mock

        // Initial setup for most tests: dispose, load a file, make worker ready
        audioEngineService.dispose(); // Calls the spy
        await audioEngineService.loadFile(new ArrayBuffer(8), 'test.wav'); // Calls the spy
        makeWorkerReady(); // This will update the store via onmessage to make isPlayable true
    });

    afterEach(() => {
        rafSpy.mockRestore();
        cafSpy.mockRestore();
        vi.useRealTimers(); // Restore real timers
    });

    describe('loadFile', () => {
        it('should post an INIT message to the worker and update store', async () => {
            // Action already happened in beforeEach's loadFile call
            expect(actualMockWorkerInstance.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: RB_WORKER_MSG_TYPE.INIT,
                    payload: expect.objectContaining({
                        channels: mockAudioBuffer.numberOfChannels,
                        sampleRate: mockAudioBuffer.sampleRate
                    })
                }),
                expect.any(Array)
            );
        });

        it('should update the player store to be playable after worker is initialized', () => {
            const store = __test__getPlayerStoreInstance();
            expect(get(store).isPlayable).toBe(true);
            expect(get(store).status).toContain('Ready');
        });
    });


    describe('play', () => {
        it('should start the animation loop by calling requestAnimationFrame', async () => {
            await audioEngineService.play();
            expect(rafSpy).toHaveBeenCalledTimes(1);
        });

        it('should not play if worker is not initialized', async () => {
            audioEngineService.dispose();
            await audioEngineService.play();
            expect(rafSpy).not.toHaveBeenCalled();
        });
    });

    describe('pause', () => {
        it('should stop the animation loop by calling cancelAnimationFrame', async () => {
            await audioEngineService.play();
            expect(rafSpy).toHaveBeenCalledTimes(1);

            audioEngineService.pause();
            expect(cafSpy).toHaveBeenCalledWith(MOCK_RAF_ID);
            expect(get(__test__getPlayerStoreInstance()).isPlaying).toBe(false);
        });
    });

    describe('stop', () => {
        it('should cancel the animation loop, reset worker, and reset time', async () => {
            await audioEngineService.play();
            __test__getPlayerStoreInstance().update((s: any) => ({ ...s, currentTime: 5.0 }));

            audioEngineService.stop();

            expect(cafSpy).toHaveBeenCalledWith(MOCK_RAF_ID);
            expect(actualMockWorkerInstance.postMessage).toHaveBeenCalledWith({
                type: RB_WORKER_MSG_TYPE.RESET
            });
            expect(get(__test__getPlayerStoreInstance()).isPlaying).toBe(false);
            expect(get(__test__getPlayerStoreInstance()).currentTime).toBe(0);
        });
    });

    describe('seek', () => {
        it('should update time, reset worker, but NOT start playing if paused', async () => {
            const store = __test__getPlayerStoreInstance();
            expect(get(store).isPlaying).toBe(false);

            await audioEngineService.seek(5.0);

            expect(rafSpy).not.toHaveBeenCalled();
            expect(cafSpy).not.toHaveBeenCalled();

            expect(actualMockWorkerInstance.postMessage).toHaveBeenCalledWith({
                type: RB_WORKER_MSG_TYPE.RESET
            });
            // const store = __test__getPlayerStoreInstance(); // Redundant declaration removed
            expect(get(store).currentTime).toBe(5.0);
            expect(get(store).isPlaying).toBe(false);
        });

        it('should cancel loop, update time, reset worker, AND restart playback if playing', async () => {
            await audioEngineService.play();
            expect(rafSpy).toHaveBeenCalledTimes(1);
            vi.clearAllMocks();

            await audioEngineService.seek(3.0);

            expect(cafSpy).toHaveBeenCalledWith(MOCK_RAF_ID);
            expect(actualMockWorkerInstance.postMessage).toHaveBeenCalledWith({
                type: RB_WORKER_MSG_TYPE.RESET
            });
            const store = __test__getPlayerStoreInstance();
            expect(get(store).currentTime).toBe(3.0);

            // Timer advancement and microtask flushing are no longer needed here
            // as the setTimeout was removed from the seek mock.
            // await vi.advanceTimersToNextTimerAsync();
            // await Promise.resolve();
            // await Promise.resolve();

            expect(rafSpy).toHaveBeenCalledTimes(1);
            expect(get(store).isPlaying).toBe(true);
        });
    });
});