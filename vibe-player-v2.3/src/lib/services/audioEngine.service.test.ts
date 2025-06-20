// vibe-player-v2.3/src/lib/services/audioEngine.service.test.ts
import { vi, describe, it, expect, beforeEach, afterEach, SpyInstance } from 'vitest';
import { get, writable } from 'svelte/store'; // Corrected import
import AudioEngineService from './audioEngine.service'; // Assuming default export
import { playerStore } from '$lib/stores/player.store';
import { timeStore } from '$lib/stores/time.store';
import { AudioOrchestrator } from './AudioOrchestrator.service';
import RubberbandWorker from '$lib/workers/rubberband.worker?worker&inline'; // Actual import for type, but will be mocked
import { RB_WORKER_MSG_TYPE } from '$lib/types/worker.types'; // Import enum

// --- Global Mocks ---
const mockAudioContext = {
    decodeAudioData: vi.fn(),
    resume: vi.fn().mockResolvedValue(undefined),
    createGain: vi.fn(),
    createBufferSource: vi.fn(),
    createBuffer: vi.fn(), // Added mock for createBuffer
    currentTime: 0,
    state: 'suspended',
    destination: {}, // Mock destination object
    close: vi.fn().mockResolvedValue(undefined),
    sampleRate: 44100, // Added default sampleRate
};
const mockGainNode = {
    connect: vi.fn(),
    gain: { setValueAtTime: vi.fn(), value: 1.0 }, // Added value for gain
};
const mockAudioBufferSourceNode = {
    connect: vi.fn(),
    start: vi.fn(),
    buffer: null as AudioBuffer | null, // Ensure buffer property is typed
    loop: false, // Added loop property
    loopStart: 0, // Added loopStart
    loopEnd: 0, // Added loopEnd
    onended: null, // Added onended
    playbackRate: { value: 1.0, setValueAtTime: vi.fn() }, // Added playbackRate
    stop: vi.fn(), // Added stop method
    disconnect: vi.fn(), // Added disconnect
};
const mockWorkerInstance = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
};

vi.stubGlobal('AudioContext', vi.fn(() => mockAudioContext));
vi.stubGlobal('fetch', vi.fn());
vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => { cb(Date.now()); return 1; }));
vi.stubGlobal('cancelAnimationFrame', vi.fn());

vi.mock('$lib/workers/rubberband.worker?worker&inline', () => ({
    default: vi.fn(() => mockWorkerInstance)
}));

// Mock AudioOrchestrator using its actual structure if possible, or a simplified mock
let mockAudioOrchestratorInstanceSingleton: any;

vi.mock('./AudioOrchestrator.service', async (importOriginal) => {
    const originalModule = await importOriginal() as any;
    // Create a spy-able instance for tests to interact with
    mockAudioOrchestratorInstanceSingleton = {
        updateUrlFromState: vi.fn(),
        handleError: vi.fn(),
    };
    return {
        AudioOrchestrator: { // This mocks the class itself
            getInstance: vi.fn(() => mockAudioOrchestratorInstanceSingleton), // getInstance returns our spy-able object
        }
    };
});


// Actual stores are used and spied upon. Reset them in beforeEach.
let actualPlayerStoreData = {
    status: 'idle', fileName: null, duration: 0, currentTime: 0, isPlaying: false,
    isPlayable: true, speed: 1.0, pitchShift: 0.0, gain: 1.0, error: null, audioBuffer: undefined,
    audioContextResumed: false, channels: undefined, sampleRate: undefined, lastProcessedChunk: undefined,
};
let actualTimeStoreData = 0;

// Use writable for actual stores so spies can be attached in Vitest
const playerStoreWritable = writable(actualPlayerStoreData);
const timeStoreWritable = writable(actualTimeStoreData);


vi.mock('$lib/stores/player.store', () => ({ playerStore: playerStoreWritable }));
vi.mock('$lib/stores/time.store', () => ({ timeStore: timeStoreWritable }));


describe('AudioEngineService', () => {
    let engine: typeof AudioEngineService;

    let playerStoreUpdateSpy: SpyInstance;
    let timeStoreSetSpy: SpyInstance;

    const mockAudioBufferData = {
        duration: 10,
        sampleRate: 44100,
        numberOfChannels: 2,
        length: 441000,
        getChannelData: vi.fn(() => new Float32Array(1024)),
        copyToChannel: vi.fn(), // Mock for createBuffer
    } as unknown as AudioBuffer;

    beforeEach(() => {
        vi.clearAllMocks();

        // Reset store states to a clean slate for each test
        actualPlayerStoreData = {
            status: 'idle', fileName: 'test.wav', duration: mockAudioBufferData.duration, currentTime: 0, isPlaying: false,
            isPlayable: true, speed: 1.0, pitchShift: 0.0, gain: 1.0, error: null, audioBuffer: mockAudioBufferData,
            audioContextResumed: false, channels: 2, sampleRate: 44100, lastProcessedChunk: undefined,
        };
        playerStoreWritable.set(actualPlayerStoreData);

        actualTimeStoreData = 0;
        timeStoreWritable.set(actualTimeStoreData);

        playerStoreUpdateSpy = vi.spyOn(playerStoreWritable, 'update');
        timeStoreSetSpy = vi.spyOn(timeStoreWritable, 'set');

        (mockAudioContext.createGain as vi.Mock).mockReturnValue(mockGainNode);
        (mockAudioContext.createBufferSource as vi.Mock).mockReturnValue(mockAudioBufferSourceNode);
        (mockAudioContext.createBuffer as vi.Mock).mockImplementation((channels, length, sampleRate) => ({
            numberOfChannels: channels,
            length: length,
            sampleRate: sampleRate,
            duration: length / sampleRate,
            getChannelData: vi.fn(() => new Float32Array(length)),
            copyToChannel: vi.fn(),
            copyFromChannel: vi.fn(),
        }));
        mockAudioContext.currentTime = 0;
        mockAudioContext.state = 'suspended'; // Default to suspended

        engine = AudioEngineService;
        (engine as any).audioContext = null;
        (engine as any).originalBuffer = null;
        (engine as any).isWorkerReady = false;
        (engine as any).isPlaying = false;
        (engine as any).sourcePlaybackOffset = 0;
        (engine as any).nextChunkTime = 0;
        if((engine as any).animationFrameId) cancelAnimationFrame((engine as any).animationFrameId);
        (engine as any).animationFrameId = null;

        // Ensure the mocked AudioOrchestrator instance is used
        // AudioOrchestrator.getInstance() should return mockAudioOrchestratorInstanceSingleton from the mock setup
    });

    describe('decodeAudioData', () => {
        it('should call AudioContext.decodeAudioData and return an AudioBuffer', async () => {
            const arrayBuffer = new ArrayBuffer(100);
            (mockAudioContext.decodeAudioData as vi.Mock).mockResolvedValue(mockAudioBufferData);

            const result = await engine.decodeAudioData(arrayBuffer);

            expect(mockAudioContext.decodeAudioData).toHaveBeenCalledWith(arrayBuffer);
            expect(result).toBe(mockAudioBufferData);
            expect((engine as any).isWorkerReady).toBe(false);
        });

        it('should throw if AudioContext.decodeAudioData fails', async () => {
            const error = new Error('Decode error');
            (mockAudioContext.decodeAudioData as vi.Mock).mockRejectedValue(error);
            const arrayBuffer = new ArrayBuffer(100);

            await expect(engine.decodeAudioData(arrayBuffer)).rejects.toThrow('Decode error');
            expect((engine as any).originalBuffer).toBeNull();
            expect((engine as any).isWorkerReady).toBe(false);
        });
    });

    describe('initializeWorker', () => {
        const wasmBinary = new ArrayBuffer(10);
        const loaderScriptText = "loader script";

        beforeEach(() => {
            (global.fetch as vi.Mock)
                .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(wasmBinary) } as unknown as Response)
                .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(loaderScriptText) } as unknown as Response);
            (engine as any).originalBuffer = mockAudioBufferData;
        });

        it('should resolve on INIT_SUCCESS from worker', async () => {
            const promise = engine.initializeWorker(mockAudioBufferData);
            expect(RubberbandWorker).toHaveBeenCalledTimes(1);

            expect(mockWorkerInstance.onmessage).toBeTypeOf('function');
            if (mockWorkerInstance.onmessage) {
                 mockWorkerInstance.onmessage({ data: { type: RB_WORKER_MSG_TYPE.INIT_SUCCESS } } as MessageEvent);
            }

            await expect(promise).resolves.toBeUndefined();
            expect((engine as any).isWorkerReady).toBe(true);
            expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ type: RB_WORKER_MSG_TYPE.INIT }),
                [wasmBinary]
            );
        });

        it('should reject on INIT_ERROR from worker', async () => {
            const promise = engine.initializeWorker(mockAudioBufferData);
            const initError = { message: 'Worker init failed' };

            expect(mockWorkerInstance.onmessage).toBeTypeOf('function');
             if (mockWorkerInstance.onmessage) {
                mockWorkerInstance.onmessage({ data: { type: RB_WORKER_MSG_TYPE.INIT_ERROR, payload: initError } } as MessageEvent);
            }

            await expect(promise).rejects.toThrow(initError.message);
            expect((engine as any).isWorkerReady).toBe(false);
        });

        it('should reject if worker onerror is triggered during init', async () => {
            const promise = engine.initializeWorker(mockAudioBufferData);
            const criticalError = new ErrorEvent('error', { message: 'Critical worker failure' });

            expect(mockWorkerInstance.onerror).toBeTypeOf('function');
            if (mockWorkerInstance.onerror) {
                mockWorkerInstance.onerror(criticalError);
            }

            await expect(promise).rejects.toThrow(criticalError.message);
            expect((engine as any).isWorkerReady).toBe(false);
            expect(AudioOrchestrator.getInstance().handleError).toHaveBeenCalledWith(expect.any(Error));
        });


        it('should reject if audioBuffer is not provided', async () => {
            await expect(engine.initializeWorker(null as any)).rejects.toThrow("initializeWorker called with no AudioBuffer.");
        });

        it('should reject if fetch fails for dependencies', async () => {
            (global.fetch as vi.Mock).mockReset()
                .mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Response);

            await expect(engine.initializeWorker(mockAudioBufferData)).rejects.toThrow('Failed to fetch worker dependencies.');
            expect(AudioOrchestrator.getInstance().handleError).toHaveBeenCalled();
        });
    });

    describe('Playback', () => {
        beforeEach(async () => {
            (engine as any).originalBuffer = mockAudioBufferData;
            (engine as any).isWorkerReady = true;
            (engine as any).audioContext = mockAudioContext;
            (engine as any).gainNode = mockGainNode;
            mockAudioContext.state = 'running';
        });

        it('play should set isPlaying to true and update playerStore', async () => {
            await engine.play();
            expect(get(playerStoreWritable).isPlaying).toBe(true);
            expect(playerStoreUpdateSpy).toHaveBeenCalled();
            expect(requestAnimationFrame).toHaveBeenCalled();
        });

        it('pause should set isPlaying to false and update playerStore', async () => {
            await engine.play();
            engine.pause();
            expect(get(playerStoreWritable).isPlaying).toBe(false);
            expect(playerStoreUpdateSpy).toHaveBeenCalled();
            expect(cancelAnimationFrame).toHaveBeenCalled();
        });

        it('_recursiveProcessAndPlayLoop should call timeStore.set', () => {
            (engine as any).isPlaying = true;
            (engine as any)._recursiveProcessAndPlayLoop();
            expect(timeStoreSetSpy).toHaveBeenCalled();
        });

        it('stop should reset playback state and call timeStore.set(0)', async () => {
            await engine.play();
            await engine.stop(); // Make stop async if it involves async operations
            expect(get(playerStoreWritable).isPlaying).toBe(false);
            expect(timeStoreSetSpy).toHaveBeenCalledWith(0);
            expect(playerStoreUpdateSpy).toHaveBeenCalled();
            expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({ type: RB_WORKER_MSG_TYPE.RESET });
        });
    });

    describe('seek', () => {
        beforeEach(() => {
            (engine as any).originalBuffer = mockAudioBufferData;
            (engine as any).isWorkerReady = true;
            (engine as any).audioContext = mockAudioContext;
        });

        it('should call timeStore.set with clamped time and update URL', () => {
            const seekTime = 5;
            engine.seek(seekTime);
            expect(timeStoreSetSpy).toHaveBeenCalledWith(seekTime);
            expect(playerStoreUpdateSpy).toHaveBeenCalled();
            expect(AudioOrchestrator.getInstance().updateUrlFromState).toHaveBeenCalled();
            expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({ type: RB_WORKER_MSG_TYPE.RESET });
        });

        it('should clamp seek time to duration', () => {
            engine.seek(20);
            expect(timeStoreSetSpy).toHaveBeenCalledWith(mockAudioBufferData.duration);
        });

        it('should clamp seek time to 0 if negative', () => {
            engine.seek(-5);
            expect(timeStoreSetSpy).toHaveBeenCalledWith(0);
        });

        it('should pause and resume playback if was playing during seek', () => {
            playerStoreWritable.update(s => ({ ...s, isPlaying: true }));
            (engine as any).isPlaying = true;

            const pauseSpy = vi.spyOn(engine, 'pause');
            const playSpy = vi.spyOn(engine, 'play');

            engine.seek(3);

            expect(pauseSpy).toHaveBeenCalled();
            expect(playSpy).toHaveBeenCalled();
        });
    });

    describe('Parameter Controls (setSpeed, setPitch, setGain)', () => {
        beforeEach(() => {
            (engine as any).isWorkerReady = true;
            (engine as any).audioContext = mockAudioContext;
            (engine as any).gainNode = mockGainNode;
        });

        it('setSpeed should update playerStore, call worker and update URL', () => {
            engine.setSpeed(1.5);
            expect(get(playerStoreWritable).speed).toBe(1.5);
            expect(playerStoreUpdateSpy).toHaveBeenCalled();
            expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ type: RB_WORKER_MSG_TYPE.SET_SPEED, payload: { speed: 1.5 } })
            );
            expect(AudioOrchestrator.getInstance().updateUrlFromState).toHaveBeenCalled();
        });

        it('setPitch should update playerStore, call worker and update URL', () => {
            engine.setPitch(2.0);
            expect(get(playerStoreWritable).pitchShift).toBe(2.0);
            expect(playerStoreUpdateSpy).toHaveBeenCalled();
            expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ type: RB_WORKER_MSG_TYPE.SET_PITCH, payload: { pitch: 2.0 } })
            );
            expect(AudioOrchestrator.getInstance().updateUrlFromState).toHaveBeenCalled();
        });

        it('setGain should update playerStore, set gainNode value and update URL', () => {
            engine.setGain(0.8);
            expect(get(playerStoreWritable).gain).toBe(0.8);
            expect(playerStoreUpdateSpy).toHaveBeenCalled();
            expect(mockGainNode.gain.setValueAtTime).toHaveBeenCalledWith(0.8, mockAudioContext.currentTime);
            expect(AudioOrchestrator.getInstance().updateUrlFromState).toHaveBeenCalled();
        });
    });

    describe('handleWorkerMessage', () => {
        beforeEach(() => {
            (engine as any).originalBuffer = mockAudioBufferData;
            (engine as any).audioContext = mockAudioContext;
            (engine as any).gainNode = mockGainNode;
        });

        it('INIT_SUCCESS should set isWorkerReady and resolve promise', () => {
            const workerInitPromiseCallbacks = { resolve: vi.fn(), reject: vi.fn() };
            (engine as any).workerInitPromiseCallbacks = workerInitPromiseCallbacks;
            (engine as any).handleWorkerMessage({ data: { type: RB_WORKER_MSG_TYPE.INIT_SUCCESS } } as MessageEvent);
            expect((engine as any).isWorkerReady).toBe(true);
            expect(workerInitPromiseCallbacks.resolve).toHaveBeenCalled();
        });

        it('PROCESS_RESULT should schedule chunk playback', () => {
            const scheduleSpy = vi.spyOn(engine as any, 'scheduleChunkPlayback');
            const processResultPayload = { outputBuffer: [new Float32Array(10)], playbackTime: 1, duration: 0.5, isLastChunk: false };
            (engine as any).handleWorkerMessage({ data: { type: RB_WORKER_MSG_TYPE.PROCESS_RESULT, payload: processResultPayload } } as MessageEvent);
            expect(scheduleSpy).toHaveBeenCalledWith(processResultPayload.outputBuffer, processResultPayload.playbackTime, processResultPayload.duration);
        });

        it('PROCESS_RESULT with empty buffer and isLastChunk should pause if playing', () => {
            const pauseSpy = vi.spyOn(engine, 'pause');
            (engine as any).isPlaying = true;
            const processResultPayload = { outputBuffer: [new Float32Array(0)], playbackTime: 1, duration: 0, isLastChunk: true };
            (engine as any).handleWorkerMessage({ data: { type: RB_WORKER_MSG_TYPE.PROCESS_RESULT, payload: processResultPayload } } as MessageEvent);
            expect(pauseSpy).toHaveBeenCalled();
            expect(timeStoreSetSpy).toHaveBeenCalledWith(mockAudioBufferData.duration);
        });

        it('ERROR should call AudioOrchestrator.handleError and pause', () => {
            const pauseSpy = vi.spyOn(engine, 'pause');
            const errorPayload = { message: 'Worker processing error' };
            (engine as any).handleWorkerMessage({ data: { type: RB_WORKER_MSG_TYPE.ERROR, payload: errorPayload } } as MessageEvent);
            expect(AudioOrchestrator.getInstance().handleError).toHaveBeenCalledWith(new Error(errorPayload.message));
            expect(pauseSpy).toHaveBeenCalled();
        });
    });

    describe('dispose', () => {
        it('should stop playback, terminate worker, and close audio context', async () => {
            const stopSpy = vi.spyOn(engine, 'stop');
            (engine as any).worker = mockWorkerInstance;
            (engine as any).audioContext = mockAudioContext;

            engine.dispose();

            expect(stopSpy).toHaveBeenCalled();
            expect(mockWorkerInstance.terminate).toHaveBeenCalled();
            expect(mockAudioContext.close).toHaveBeenCalled();
            expect((engine as any).worker).toBeNull();
            expect((engine as any).audioContext).toBeNull();
        });
    });

});
