// vibe-player-v2.3/src/lib/services/audioEngine.service.test.ts

import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  SpyInstance,
} from "vitest";
import { get, writable } from "svelte/store";
import type { PlayerState } from "$lib/types/player.types";
import AudioEngineService from "./audioEngine.service";
import { playerStore } from "$lib/stores/player.store";
import { timeStore } from "$lib/stores/time.store";
import { AudioOrchestrator } from "./AudioOrchestrator.service";
import RubberbandWorker from "$lib/workers/rubberband.worker?worker&inline";
import { RB_WORKER_MSG_TYPE } from "$lib/types/worker.types";
import { AUDIO_ENGINE_CONSTANTS } from "$lib/utils";

// --- Mocks ---

// Step 1: Hoist the raw initial state data.
const { hoistedData } = vi.hoisted(() => {
  const initialPlayerStateData: PlayerState = {
    isPlayable: true,
    isPlaying: false,
    currentTime: 0,
    duration: 10.0,
    speed: 1.0,
    pitchShift: 0.0,
    gain: 1.0,
    isLoading: false,
    isBusy: false,
    error: null,
    fileName: "",
    fileSize: 0,
    fileType: "",
    audioContextResumed: false,
    audioBuffer: null,
  };
  const initialTimeData = 0;
  return {
    hoistedData: {
      initialPlayerState: initialPlayerStateData,
      initialTime: initialTimeData,
    },
  };
});

// Step 2: Create writable store instances at module scope, using the hoisted data.
// This happens after `writable` is imported and before mock factories need these instances.
const __mockPlayerStoreInstance = writable<PlayerState>({
  ...hoistedData.initialPlayerState,
  gain: 1.0, // <-- ADDED gain to match PlayerState type (already present in hoistedData, ensuring it here if not)
});
const __mockTimeStoreInstance = writable<number>(hoistedData.initialTime);

// Step 3: Mock the store modules using get() accessors to defer instance access.
vi.mock("$lib/stores/player.store", () => {
  return {
    get playerStore() {
      return __mockPlayerStoreInstance;
    },
  };
});
vi.mock("$lib/stores/time.store", () => {
  return {
    get timeStore() {
      return __mockTimeStoreInstance;
    },
  };
});

// Step 4: Mock other modules.
vi.mock("./AudioOrchestrator.service");
vi.mock("$lib/workers/rubberband.worker?worker&inline");

import AudioEngineService from "./audioEngine.service"; // Service under test

describe("AudioEngineService (Robust Loop)", () => {
  let engine: typeof AudioEngineService;
  let mockOrchestrator: {
    handleError: SpyInstance;
    updateUrlFromState: SpyInstance;
  };
  let mockWorker: { postMessage: SpyInstance; terminate: SpyInstance };
  let mockAudioContext: any;

  const mockAudioBuffer = {
    duration: 10.0,
    sampleRate: 44100,
    numberOfChannels: 1,
    length: 441000,
    getChannelData: vi.fn(() => new Float32Array(441000).fill(0.1)),
  } as unknown as AudioBuffer;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset the state of the module-scoped store instances for each test
    __mockPlayerStoreInstance.set({ ...hoistedData.initialPlayerState });
    __mockTimeStoreInstance.set(hoistedData.initialTime);

    // Ensure AudioOrchestrator mock is fresh for each test
    mockOrchestrator = { handleError: vi.fn(), updateUrlFromState: vi.fn() };
    (AudioOrchestrator.getInstance as vi.Mock).mockReturnValue(
      mockOrchestrator,
    );

    mockWorker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null }; // Add null handlers
    (RubberbandWorker as vi.Mock).mockReturnValue(mockWorker);

    mockAudioContext = {
      currentTime: 0,
      state: "running",
      createGain: vi.fn(() => ({
        connect: vi.fn(),
        gain: { setValueAtTime: vi.fn() },
      })),
      createBufferSource: vi.fn(() => ({ connect: vi.fn(), start: vi.fn() })),
      createBuffer: vi.fn(() => ({ copyToChannel: vi.fn() })),
    };
    (globalThis as any).AudioContext = vi.fn(() => mockAudioContext);

    (globalThis as any).requestAnimationFrame = vi.fn();
    (globalThis as any).cancelAnimationFrame = vi.fn();

    engine = AudioEngineService; // Reverted: AudioEngineService is already the instance
    // --- START OF FIX ---
    // Manually instantiate the worker and assign it to the service instance for tests.
    // This simulates the state after `initializeWorker` has been successfully called.
    (engine as any).worker = new (RubberbandWorker as any)();
    // --- END OF FIX ---
    (engine as any).originalBuffer = mockAudioBuffer;
    (engine as any).isWorkerReady = true;
    (engine as any).isPlaying = false;
    (engine as any).sourcePlaybackOffset = 0;
    (engine as any)._getAudioContext(); // Restored
    (engine as any).worker = mockWorker; // Restored
  });

  describe("seek", () => {
    it("should update offsets, stores, and reset worker when called while not playing", () => {
      const seekTime = 3.0;
      // Ensure isPlaying is false initially for this test case
      playerStore.update((s) => ({ ...s, isPlaying: false }));
      (engine as any).isPlaying = false;

      engine.seek(seekTime);

      expect((engine as any).sourcePlaybackOffset).toBe(seekTime);
      expect(get(timeStore)).toBe(seekTime);
      expect(get(playerStore).currentTime).toBe(seekTime);
      expect(mockWorker.postMessage).toHaveBeenCalledWith({
        type: RB_WORKER_MSG_TYPE.RESET,
      });
      expect(get(playerStore).isPlaying).toBe(false); // Should remain not playing
    });

    it("should pause, update offsets, stores, and reset worker when called while playing", () => {
      const seekTime = 4.0;
      // Ensure isPlaying is true initially for this test case
      playerStore.update((s) => ({ ...s, isPlaying: true }));
      (engine as any).isPlaying = true;

      const pauseSpy = vi.spyOn(engine, "pause").mockImplementation(() => {
        playerStore.update((s) => ({ ...s, isPlaying: false }));
        (engine as any).isPlaying = false;
      });

      engine.seek(seekTime);

      expect(pauseSpy).toHaveBeenCalledTimes(1);
      expect((engine as any).sourcePlaybackOffset).toBe(seekTime);
      expect(get(timeStore)).toBe(seekTime);
      expect(get(playerStore).currentTime).toBe(seekTime);
      expect(mockWorker.postMessage).toHaveBeenCalledWith({
        type: RB_WORKER_MSG_TYPE.RESET,
      });
      expect(get(playerStore).isPlaying).toBe(false); // Should be paused

      pauseSpy.mockRestore();
    });

    it("should not reset worker if worker is not ready", () => {
      (engine as any).isWorkerReady = false;
      const seekTime = 2.0;
      playerStore.update((s) => ({ ...s, isPlaying: false }));
      (engine as any).isPlaying = false;

      engine.seek(seekTime);
      // Check that postMessage was not called for RESET specifically
      const resetCall = mockWorker.postMessage.mock.calls.find(
        (call) => call[0].type === RB_WORKER_MSG_TYPE.RESET,
      );
      expect(resetCall).toBeUndefined();
    });
    it("should clamp seek time to buffer duration", () => {
      const seekTime = mockAudioBuffer.duration + 5.0; // Time beyond duration
      engine.seek(seekTime);
      expect((engine as any).sourcePlaybackOffset).toBe(
        mockAudioBuffer.duration,
      );
      expect(get(timeStore)).toBe(mockAudioBuffer.duration);
      expect(get(playerStore).currentTime).toBe(mockAudioBuffer.duration);
    });

    it("should clamp seek time to 0 if negative time is given", () => {
      const seekTime = -5.0; // Negative time
      engine.seek(seekTime);
      expect((engine as any).sourcePlaybackOffset).toBe(0);
      expect(get(timeStore)).toBe(0);
      expect(get(playerStore).currentTime).toBe(0);
    });
  });

  it("play() should start the animation loop", async () => {
    await engine.play();
    expect(get(playerStore).isPlaying).toBe(true);
    expect(requestAnimationFrame).toHaveBeenCalledWith(expect.any(Function));
  });

  it("pause() should stop the animation loop", () => {
    (engine as any).isPlaying = true;
    (engine as any).animationFrameId = 123;
    engine.pause();
    expect(get(playerStore).isPlaying).toBe(false);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(123);
  });

  it("_recursiveProcessAndPlayLoop should update timeStore and call iteration", () => {
    const iterationSpy = vi
      .spyOn(engine as any, "_performSingleProcessAndPlayIteration")
      .mockImplementation(() => {});
    (engine as any).isPlaying = true;
    (engine as any).sourcePlaybackOffset = 5.0;
    (engine as any).audioContext = mockAudioContext;

    (engine as any)._recursiveProcessAndPlayLoop();

    expect(get(timeStore)).toBe(5.0);
    expect(iterationSpy).toHaveBeenCalledTimes(1);
  });

  it("_performSingleProcessAndPlayIteration should post a chunk to the worker and advance offset", () => {
    (engine as any).isPlaying = true;
    (engine as any).audioContext = mockAudioContext;
    (engine as any).worker = mockWorker; // ADDED: Ensure engine's worker is our mock
    (engine as any).sourcePlaybackOffset = 2.0;
    const expectedChunkSize = AUDIO_ENGINE_CONSTANTS.PROCESS_FRAME_SIZE;

    (engine as any)._performSingleProcessAndPlayIteration();

    expect(mockWorker.postMessage).toHaveBeenCalledTimes(1);
    const payload = mockWorker.postMessage.mock.calls[0][0].payload;
    expect(payload.inputBuffer[0].length).toBe(expectedChunkSize);
    expect(payload.isLastChunk).toBe(false);

    const expectedOffset = 2.0 + expectedChunkSize / mockAudioBuffer.sampleRate;
    expect((engine as any).sourcePlaybackOffset).toBeCloseTo(expectedOffset);
  });

  it("_performSingleProcessAndPlayIteration should stop at the end of the buffer", () => {
    (engine as any).isPlaying = true;
    (engine as any).audioContext = mockAudioContext;
    (engine as any).worker = mockWorker; // ADDED: Ensure engine's worker is our mock (though not strictly needed for this path, good for consistency)
    const pauseSpy = vi.spyOn(engine, "pause");
    (engine as any).sourcePlaybackOffset = mockAudioBuffer.duration; // Set to the end

    // --- THIS IS THE FIX ---
    // Set the precondition that the engine is actively playing.
    (engine as any).isPlaying = true;
    // --- END OF FIX ---

    (engine as any)._performSingleProcessAndPlayIteration();

    expect(mockWorker.postMessage).not.toHaveBeenCalled();
    expect(pauseSpy).toHaveBeenCalled();
  });

  it("handleWorkerMessage should schedule playback for PROCESS_RESULT", () => {
    const scheduleSpy = vi
      .spyOn(engine as any, "scheduleChunkPlayback")
      .mockImplementation(() => {});
    const mockResult = {
      outputBuffer: [new Float32Array(1024)],
      isLastChunk: false,
    };

    (engine as any).handleWorkerMessage({
      data: { type: RB_WORKER_MSG_TYPE.PROCESS_RESULT, payload: mockResult },
    });

    expect(scheduleSpy).toHaveBeenCalledWith(mockResult.outputBuffer);
  });
});
