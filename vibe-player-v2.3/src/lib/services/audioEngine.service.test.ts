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

  beforeEach(async () => {
    // Make the hook async
    vi.resetAllMocks(); // Changed from clearAllMocks

    // Reset the state of the module-scoped store instances for each test
    __mockPlayerStoreInstance.set({ ...hoistedData.initialPlayerState });
    __mockTimeStoreInstance.set(hoistedData.initialTime);

    // Ensure AudioOrchestrator mock is fresh for each test
    mockOrchestrator = { handleError: vi.fn(), updateUrlFromState: vi.fn() };
    (AudioOrchestrator.getInstance as vi.Mock).mockReturnValue(
      mockOrchestrator,
    );

    mockWorker = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    }; // Add null handlers
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
      close: vi.fn(), // Added mock for close
    };
    (globalThis as any).AudioContext = vi.fn(() => mockAudioContext);

    (globalThis as any).requestAnimationFrame = vi.fn();
    (globalThis as any).cancelAnimationFrame = vi.fn();

    engine = AudioEngineService; // Reverted: AudioEngineService is already the instance

    // --- ADD THIS ASYNC DISPOSE CALL ---
    // This ensures the singleton is reset to a clean state before each test.
    await engine.dispose();
    // --- END OF ADDITION ---

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
    // (engine as any).worker = mockWorker; // Removed redundant assignment
  });

  describe("unlockAudio", () => {
    it("should call resume() when context is suspended and update store on success", async () => {
      mockAudioContext.state = "suspended";
      // Update mockAudioContext.state to 'running' when resume is called and resolves
      mockAudioContext.resume = vi.fn().mockImplementation(() => {
        mockAudioContext.state = "running";
        return Promise.resolve(undefined);
      });
      playerStore.update((s) => ({
        ...s,
        audioContextResumed: false,
        error: "some previous error",
      })); // Also test that error is cleared

      await engine.unlockAudio();

      expect(mockAudioContext.resume).toHaveBeenCalledTimes(1);
      expect(get(playerStore).audioContextResumed).toBe(true);
      expect(get(playerStore).error).toBeNull();
    });

    it("should update store with error and audioContextResumed: false if resume() fails", async () => {
      mockAudioContext.state = "suspended";
      const resumeError = new Error("Resume failed");
      mockAudioContext.resume = vi.fn().mockRejectedValue(resumeError);
      playerStore.update((s) => ({
        ...s,
        audioContextResumed: true,
        error: null,
      }));

      await engine.unlockAudio();

      expect(mockAudioContext.resume).toHaveBeenCalledTimes(1);
      expect(get(playerStore).audioContextResumed).toBe(false);
      expect(get(playerStore).error).toBe(
        `AudioContext resume failed: ${resumeError.message}`,
      );
    });

    it("should not call resume() if context is already running, but still update store", async () => {
      mockAudioContext.state = "running";
      mockAudioContext.resume = vi.fn();
      playerStore.update((s) => ({ ...s, audioContextResumed: false }));

      await engine.unlockAudio();

      expect(mockAudioContext.resume).not.toHaveBeenCalled();
      expect(get(playerStore).audioContextResumed).toBe(true);
    });
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

    it("should update offsets, stores, and reset worker when called (playback state managed by UI)", () => {
      const seekTime = 4.0;
      // Simulate playing state if needed for other logic within seek, though seek itself won't change it.
      playerStore.update((s) => ({ ...s, isPlaying: true, currentTime: 0 })); // Set a distinct currentTime before seek
      (engine as any).isPlaying = true;
      const initialIsPlaying = get(playerStore).isPlaying;

      engine.seek(seekTime);

      // audioEngine.seek no longer calls pause itself. UI layer handles it.
      // The isPlaying state in the store should remain as it was before seek was called,
      // as the UI is responsible for managing pause/play around seek.
      expect(get(playerStore).isPlaying).toBe(initialIsPlaying);
      expect((engine as any).sourcePlaybackOffset).toBe(seekTime);
      expect(get(timeStore)).toBe(seekTime);
      expect(get(playerStore).currentTime).toBe(seekTime); // This is updated by seek
      expect(mockWorker.postMessage).toHaveBeenCalledWith({
        type: RB_WORKER_MSG_TYPE.RESET,
      });
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

  describe("play", () => {
    let unlockAudioSpy: SpyInstance;
    let iterationSpy: SpyInstance;

    beforeEach(() => {
      // Ensure isPlaying is false and other relevant states are set before each play test
      (engine as any).isPlaying = false;
      playerStore.update((s) => ({ ...s, isPlaying: false, error: null }));
      (engine as any).originalBuffer = mockAudioBuffer; // Ensure buffer is available
      (engine as any).isWorkerReady = true; // Ensure worker is ready

      unlockAudioSpy = vi
        .spyOn(engine as any, "unlockAudio")
        .mockImplementation(() => Promise.resolve());
      iterationSpy = vi
        .spyOn(engine as any, "_performSingleProcessAndPlayIteration")
        .mockImplementation(() => {});
    });

    it("should call unlockAudio (non-awaited), set isPlaying, update store, and start iteration", () => {
      // No await on engine.play() as unlockAudio is not awaited internally by play
      engine.play();

      expect(unlockAudioSpy).toHaveBeenCalledTimes(1);
      expect((engine as any).isPlaying).toBe(true);
      expect(get(playerStore).isPlaying).toBe(true);
      expect(iterationSpy).toHaveBeenCalledTimes(1);
    });

    it("should not proceed if already playing", () => {
      (engine as any).isPlaying = true; // Simulate already playing
      playerStore.update((s) => ({ ...s, isPlaying: true }));

      engine.play();

      expect(unlockAudioSpy).not.toHaveBeenCalled();
      expect(iterationSpy).not.toHaveBeenCalled();
    });

    it("should not proceed if originalBuffer is null", () => {
      (engine as any).originalBuffer = null;

      engine.play();

      expect(unlockAudioSpy).not.toHaveBeenCalled();
      expect(iterationSpy).not.toHaveBeenCalled();
    });

    it("should not proceed if worker is not ready", () => {
      (engine as any).isWorkerReady = false;

      engine.play();

      expect(unlockAudioSpy).not.toHaveBeenCalled();
      expect(iterationSpy).not.toHaveBeenCalled();
    });
  });

  it("pause() should set the isPlaying flag to false", () => {
    // Set up the playing state first
    (engine as any).isPlaying = true;
    playerStore.update((s) => ({ ...s, isPlaying: true }));

    engine.pause();

    expect(get(playerStore).isPlaying).toBe(false);
    expect((engine as any).isPlaying).toBe(false);
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

    // --- ADD THIS LINE ---
    // Set the precondition that the engine is actively playing.
    (engine as any).isPlaying = true;
    // --- END OF ADDITION ---

    (engine as any).handleWorkerMessage({
      data: { type: RB_WORKER_MSG_TYPE.PROCESS_RESULT, payload: mockResult },
    });

    expect(scheduleSpy).toHaveBeenCalledWith(mockResult.outputBuffer);
  });
});
