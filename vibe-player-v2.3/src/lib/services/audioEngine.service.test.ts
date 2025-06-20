// vibe-player-v2.3/src/lib/services/audioEngine.service.test.ts
import { writable, type Writable } from "svelte/store";
import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import type { PlayerState } from "$lib/types/player.types";
import { act } from "@testing-library/svelte"; // For wrapping state updates

// --- Mocks ---

const initialPlayerState: PlayerState = {
  status: "idle",
  fileName: null,
  duration: 0,
  currentTime: 0,
  isPlaying: false, // Ensured false
  isPlayable: false,
  speed: 1.0,
  pitchShift: 0.0,
  gain: 1.0,
  waveformData: undefined,
  error: null,
  audioBuffer: undefined,
  audioContextResumed: false,
  channels: undefined,
  sampleRate: undefined,
  lastProcessedChunk: undefined,
};
const playerStoreWritable: Writable<PlayerState> = writable({ ...initialPlayerState });
vi.mock("$lib/stores/player.store", () => ({ playerStore: playerStoreWritable }));

// Added time.store.ts mock
const timeStoreWritable: Writable<number> = writable(0);
vi.mock('$lib/stores/time.store', () => ({ timeStore: timeStoreWritable }));

// Added AudioOrchestrator.service.ts mock
const mockUpdateUrlFromState = vi.fn();
const mockHandleErrorFromOrchestrator = vi.fn();
vi.mock('./AudioOrchestrator.service', () => {
    return {
        AudioOrchestrator: {
            getInstance: vi.fn(() => ({
                updateUrlFromState: mockUpdateUrlFromState,
                handleError: mockHandleErrorFromOrchestrator
            }))
        }
    };
});


vi.mock("$lib/utils/constants", async (importOriginal) => {
  const originalConstants = (await importOriginal()) as any;
  return {
    ...originalConstants,
    AUDIO_ENGINE_CONSTANTS: {
      ...(originalConstants.AUDIO_ENGINE_CONSTANTS || {}),
      MAX_GAIN: 2.0,
      PROCESS_LOOKAHEAD_TIME_S: 0.1, // Added for playback loop tests
    },
  };
});

const mockWorkerInstance = {
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((event: ErrorEvent) => void) | null,
};
vi.mock("$lib/workers/rubberband.worker?worker&inline", () => ({
  default: vi.fn().mockImplementation(() => mockWorkerInstance),
}));

const mockAudioContextInstance = {
  decodeAudioData: vi.fn(),
  createGain: vi.fn(() => ({ connect: vi.fn(), gain: { setValueAtTime: vi.fn(), value: 1.0 } })),
  resume: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  state: "running" as AudioContextState,
  currentTime: 0,
  destination: {} as AudioDestinationNode,
  sampleRate: 48000,
  createBufferSource: vi.fn(() => ({
    buffer: null as AudioBuffer | null, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null, disconnect: vi.fn(),
  })),
  createBuffer: vi.fn((channels, length, sampleRate) => ({
    numberOfChannels: channels, length: length, sampleRate: sampleRate, duration: length / sampleRate,
    getChannelData: vi.fn(() => new Float32Array(length)), copyToChannel: vi.fn(), copyFromChannel: vi.fn(),
  })),
};
global.AudioContext = vi.fn().mockImplementation(() => mockAudioContextInstance);
const globalFetchSpy = vi.spyOn(global, "fetch");

// --- End Mocks ---

import RubberbandWorker from "$lib/workers/rubberband.worker?worker&inline";
import audioEngineService from "./audioEngine.service"; // REAL service
import { RB_WORKER_MSG_TYPE } from "$lib/types/worker.types";
import { AUDIO_ENGINE_CONSTANTS } from "$lib/utils/constants";
import { timeStore } from '$lib/stores/time.store'; // Import mocked store for spy

describe("AudioEngineService", () => {
  const MOCK_RAF_ID = 12345;
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let cafSpy: ReturnType<typeof vi.spyOn>;
  let mockAudioBuffer: AudioBuffer;
  let timeStoreSetSpy: ReturnType<typeof vi.spyOn>;


  const simulateWorkerMessage = (message: any) => {
    if (mockWorkerInstance.onmessage) {
      act(() => { mockWorkerInstance.onmessage!({ data: message } as MessageEvent); });
    }
  };
  const simulateWorkerError = (errorEvent: ErrorEvent) => {
    if (mockWorkerInstance.onerror) {
      act(() => { mockWorkerInstance.onerror!(errorEvent); });
    }
  };

  let mockGainSetValueAtTime: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    act(() => { // Use act for store resets
      playerStoreWritable.set({ ...initialPlayerState });
      timeStoreWritable.set(0); // Reset timeStore
    });

    timeStoreSetSpy = vi.spyOn(timeStoreWritable, 'set'); // Spy on the mocked timeStore's set method

    globalFetchSpy.mockImplementation(() =>
      Promise.resolve({
        ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)), text: () => Promise.resolve("// Mock loader script"),
      } as Response),
    );

    mockAudioContextInstance.state = "running";
    mockAudioContextInstance.currentTime = 0;
    vi.spyOn(mockAudioContextInstance, "decodeAudioData").mockReset();
    mockGainSetValueAtTime = vi.fn();
    vi.spyOn(mockAudioContextInstance, "createGain").mockImplementation(() => ({
      connect: vi.fn(), gain: { setValueAtTime: mockGainSetValueAtTime, value: 1.0 },
    }));
    vi.spyOn(mockAudioContextInstance, "resume").mockResolvedValue(undefined);
    vi.spyOn(mockAudioContextInstance, "close").mockResolvedValue(undefined);
    vi.spyOn(mockAudioContextInstance, "createBufferSource").mockImplementation(() => ({
      buffer: null as AudioBuffer | null, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null, disconnect: vi.fn(),
    }));
    vi.spyOn(mockAudioContextInstance, "createBuffer").mockImplementation(
      (channels, length, sampleRate) => ({
        numberOfChannels: channels, length: length, sampleRate: sampleRate, duration: length / sampleRate,
        getChannelData: vi.fn(() => new Float32Array(length)), copyToChannel: vi.fn(), copyFromChannel: vi.fn(),
      }),
    );
    global.AudioContext = vi.fn().mockImplementation(() => mockAudioContextInstance);
    vi.mocked(RubberbandWorker).mockImplementation(() => mockWorkerInstance);
    vi.spyOn(mockWorkerInstance, "postMessage").mockClear();
    vi.spyOn(mockWorkerInstance, "terminate").mockClear();

    rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(cb => { cb(performance.now()); return MOCK_RAF_ID; });
    cafSpy = vi.spyOn(window, "cancelAnimationFrame");

    mockAudioBuffer = {
      duration: 10.0, numberOfChannels: 1, sampleRate: 44100,
      getChannelData: vi.fn(() => new Float32Array(441000).fill(0.1)), length: 441000,
      copyToChannel: vi.fn(), copyFromChannel: vi.fn(),
    } as unknown as AudioBuffer;

    // Ensure internal state of service is reset for relevant tests
    (audioEngineService as any).originalBuffer = null;
    (audioEngineService as any).isWorkerReady = false;
    (audioEngineService as any).isPlaying = false;
    (audioEngineService as any).sourcePlaybackOffset = 0;
    (audioEngineService as any).nextChunkTime = 0;
  });

  afterEach(() => {
    audioEngineService.dispose(); // Calls stop, terminates worker, closes context
    timeStoreSetSpy.mockRestore();
  });

  // Refactored decodeAudioData Tests
  describe("decodeAudioData", () => {
    it("should successfully decode an ArrayBuffer and return an AudioBuffer", async () => {
        const mockArrayBuffer = new ArrayBuffer(1024);
        mockAudioContextInstance.decodeAudioData.mockResolvedValue(mockAudioBuffer);

        const resultBuffer = await audioEngineService.decodeAudioData(mockArrayBuffer);

        expect(mockAudioContextInstance.decodeAudioData).toHaveBeenCalledWith(mockArrayBuffer);
        expect(resultBuffer).toBe(mockAudioBuffer);
        expect((audioEngineService as any).originalBuffer).toBe(mockAudioBuffer);
        expect((audioEngineService as any).isWorkerReady).toBe(false);
    });

    it("should throw if decoding fails and reset internal state", async () => {
        const mockArrayBuffer = new ArrayBuffer(1024);
        const decodeError = new Error("Decode Error");
        mockAudioContextInstance.decodeAudioData.mockRejectedValue(decodeError);

        await expect(audioEngineService.decodeAudioData(mockArrayBuffer)).rejects.toThrow(decodeError);
        expect((audioEngineService as any).originalBuffer).toBeNull();
        expect((audioEngineService as any).isWorkerReady).toBe(false);
    });
  });

  // Refactored initializeWorker Tests
  describe("initializeWorker", () => {
    beforeEach(() => {
      act(() => {
        playerStoreWritable.set({ ...initialPlayerState, speed: 1.2, pitchShift: -2.0 });
      });
    });

    it("should initialize the worker, post INIT message, and set isWorkerReady on success", async () => {
        (audioEngineService as any).originalBuffer = mockAudioBuffer; // Ensure originalBuffer is set for initializeWorker
        const initPromise = audioEngineService.initializeWorker(mockAudioBuffer);
        simulateWorkerMessage({ type: RB_WORKER_MSG_TYPE.INIT_SUCCESS });
        await expect(initPromise).resolves.toBeUndefined();

        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: RB_WORKER_MSG_TYPE.INIT,
                payload: expect.objectContaining({
                    sampleRate: mockAudioBuffer.sampleRate, channels: mockAudioBuffer.numberOfChannels,
                    initialSpeed: 1.2, initialPitch: -2.0,
                }),
            }),
            [expect.any(ArrayBuffer)]
        );
        expect((audioEngineService as any).isWorkerReady).toBe(true);
        // NO playerStore assertions here for isPlayable or error
    });

    it("should handle worker initialization failure (worker sends ERROR message) and set isWorkerReady to false", async () => {
      (audioEngineService as any).originalBuffer = mockAudioBuffer;
      const initPromise = audioEngineService.initializeWorker(mockAudioBuffer);
      const workerErrorMessage = "Worker init crashed";
      simulateWorkerMessage({ type: RB_WORKER_MSG_TYPE.INIT_ERROR, payload: { message: workerErrorMessage } });

      await expect(initPromise).rejects.toThrow(workerErrorMessage);
      expect((audioEngineService as any).isWorkerReady).toBe(false);
    });
  });

  describe("Playback Controls (after successful decodeAudioData and initializeWorker)", () => {
    beforeEach(async () => {
      mockAudioContextInstance.decodeAudioData.mockResolvedValue(mockAudioBuffer);
      await audioEngineService.decodeAudioData(new ArrayBuffer(1024)); // Sets this.originalBuffer
      const initPromise = audioEngineService.initializeWorker(mockAudioBuffer);
      simulateWorkerMessage({ type: RB_WORKER_MSG_TYPE.INIT_SUCCESS });
      await initPromise; // Sets this.isWorkerReady = true
      vi.clearAllMocks(); // Clear mocks from setup
      // Re-setup spies that might be cleared if they are global or on modules
      rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(cb => { cb(performance.now()); return MOCK_RAF_ID; });
      cafSpy = vi.spyOn(window, "cancelAnimationFrame");
      timeStoreSetSpy = vi.spyOn(timeStoreWritable, 'set'); // Re-spy after clearAllMocks
    });

    it("play: should start the animation loop, update timeStore and set playerStore.isPlaying to true", async () => {
        const playerStoreUpdateSpy = vi.spyOn(playerStoreWritable, 'update');
        (audioEngineService as any).sourcePlaybackOffset = 1.23; // Set a mock offset for timeStore assertion

        let rAFCallback: FrameRequestCallback | undefined;
        rafSpy.mockImplementationOnce((cb) => { rAFCallback = cb; return MOCK_RAF_ID; });

        await audioEngineService.play();

        expect((audioEngineService as any).isPlaying).toBe(true);
        expect(playerStoreUpdateSpy).toHaveBeenCalledWith(expect.any(Function));
        expect(get(playerStoreWritable).isPlaying).toBe(true);
        expect(rafSpy).toHaveBeenCalledTimes(1); // Initial call to start the loop

        if (rAFCallback) {
            act(() => { rAFCallback!(performance.now()); }); // Execute the rAF callback
            expect(timeStoreSetSpy).toHaveBeenCalledWith(1.23); // Uses the sourcePlaybackOffset
        } else {
            throw new Error("rAF callback not captured for play test");
        }
        playerStoreUpdateSpy.mockRestore();
    });

    it("pause: should stop the animation loop and set playerStore.isPlaying to false", async () => {
      const playerStoreUpdateSpy = vi.spyOn(playerStoreWritable, 'update');
      await audioEngineService.play(); // Start playing first
      const currentRafId = rafSpy.mock.results[0].value; // Assuming play results in one rAF call immediately

      audioEngineService.pause();

      expect(cafSpy).toHaveBeenCalledWith(currentRafId);
      expect((audioEngineService as any).isPlaying).toBe(false);
      expect(playerStoreUpdateSpy).toHaveBeenCalledWith(expect.any(Function)); // For isPlaying: false
      expect(get(playerStoreWritable).isPlaying).toBe(false);
      playerStoreUpdateSpy.mockRestore();
    });

    it("stop: should cancel loop, reset worker, reset internal time, update timeStore and set playerStore.isPlaying to false", async () => {
      const playerStoreUpdateSpy = vi.spyOn(playerStoreWritable, 'update');
      await audioEngineService.play();
      (audioEngineService as any).sourcePlaybackOffset = 5.0;

      await audioEngineService.stop();

      expect(cafSpy).toHaveBeenCalled();
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({ type: RB_WORKER_MSG_TYPE.RESET });
      expect((audioEngineService as any).isPlaying).toBe(false);
      expect((audioEngineService as any).sourcePlaybackOffset).toBe(0);
      expect(timeStoreSetSpy).toHaveBeenCalledWith(0); // timeStore set to 0 on stop
      expect(playerStoreUpdateSpy).toHaveBeenCalledWith(expect.any(Function)); // For isPlaying: false
      expect(get(playerStoreWritable).isPlaying).toBe(false);
      playerStoreUpdateSpy.mockRestore();
    });

    // Updated seek tests
    describe("seek", () => {
        it("should update internal time, reset worker, update timeStore, call orchestrator, and keep paused state if paused", async () => {
            (audioEngineService as any).isPlaying = false; // Ensure paused
            act(() => { playerStoreWritable.update(s => ({...s, isPlaying: false})); }); // also update store state
            vi.clearAllMocks(); // Clear postMessage calls from init
            rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(cb => { cb(performance.now()); return MOCK_RAF_ID; });
            timeStoreSetSpy = vi.spyOn(timeStoreWritable, 'set'); // Re-spy after clearAllMocks


            const seekTime = 5.0;
            audioEngineService.seek(seekTime); // seek is synchronous

            expect(rafSpy).not.toHaveBeenCalled();
            expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({ type: RB_WORKER_MSG_TYPE.RESET });
            expect((audioEngineService as any).sourcePlaybackOffset).toBe(seekTime);
            expect(timeStoreSetSpy).toHaveBeenCalledWith(seekTime);
            expect(mockUpdateUrlFromState).toHaveBeenCalled();
            expect((audioEngineService as any).isPlaying).toBe(false);
            expect(get(playerStoreWritable).isPlaying).toBe(false); // Ensure store reflects this
        });

        it("should pause, update times, call orchestrator, and resume playing if was playing", async () => {
            await audioEngineService.play(); // Start playing, sets isPlaying to true and updates store
            vi.clearAllMocks();
            rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { cb(performance.now()); return MOCK_RAF_ID; });
            cafSpy = vi.spyOn(window, 'cancelAnimationFrame');
            timeStoreSetSpy = vi.spyOn(timeStoreWritable, 'set');
            const playerStoreUpdateSpy = vi.spyOn(playerStoreWritable, 'update');

            const seekTime = 3.0;
            audioEngineService.seek(seekTime);

            expect(cafSpy).toHaveBeenCalled();
            expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({ type: RB_WORKER_MSG_TYPE.RESET });
            expect((audioEngineService as any).sourcePlaybackOffset).toBe(seekTime);
            expect(timeStoreSetSpy).toHaveBeenCalledWith(seekTime);
            expect(mockUpdateUrlFromState).toHaveBeenCalled();
            expect(rafSpy).toHaveBeenCalled();
            expect((audioEngineService as any).isPlaying).toBe(true);

            // Check playerStore updates for isPlaying: false (on pause) then isPlaying: true (on play)
            // The exact number of calls can be tricky due to internal logic. Check final state.
            expect(get(playerStoreWritable).isPlaying).toBe(true);
            playerStoreUpdateSpy.mockRestore();
        });
    });

    // Tests for playerStore.isPlaying updates in setSpeed, setPitch, setGain are not needed
    // as these methods in the new code don't directly change isPlaying status.
    // isPlaying is managed by play/pause/stop.

    it("setSpeed: should post SET_SPEED to worker and update playerStore.speed", () => {
      const playerStoreUpdateSpy = vi.spyOn(playerStoreWritable, 'update');
      audioEngineService.setSpeed(1.5);
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: RB_WORKER_MSG_TYPE.SET_SPEED, payload: { speed: 1.5 } }),
      );
      expect(playerStoreUpdateSpy).toHaveBeenCalledWith(expect.any(Function));
      expect(get(playerStoreWritable).speed).toBe(1.5);
      playerStoreUpdateSpy.mockRestore();
    });

    it("setPitch: should post SET_PITCH to worker and update playerStore.pitchShift", () => {
      const playerStoreUpdateSpy = vi.spyOn(playerStoreWritable, 'update');
      audioEngineService.setPitch(2.0);
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: RB_WORKER_MSG_TYPE.SET_PITCH, payload: { pitch: 2.0 } }),
      );
      expect(playerStoreUpdateSpy).toHaveBeenCalledWith(expect.any(Function));
      expect(get(playerStoreWritable).pitchShift).toBe(2.0);
      playerStoreUpdateSpy.mockRestore();
    });

    it("setGain: should update gainNode value and playerStore.gain", () => {
      const playerStoreUpdateSpy = vi.spyOn(playerStoreWritable, 'update');
      audioEngineService.setGain(0.5);
      expect(mockGainSetValueAtTime).toHaveBeenCalledWith(0.5, mockAudioContextInstance.currentTime);
      expect(playerStoreUpdateSpy).toHaveBeenCalledWith(expect.any(Function));
      expect(get(playerStoreWritable).gain).toBe(0.5);
      playerStoreUpdateSpy.mockRestore();
    });
  });
});
