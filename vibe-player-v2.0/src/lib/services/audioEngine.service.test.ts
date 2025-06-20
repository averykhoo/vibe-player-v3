// vibe-player-v2.3/src/lib/services/audioEngine.service.test.ts
import { writable, type Writable } from "svelte/store";
import { vi } from "vitest";

// --- Mocks ---
// All vi.mock calls are hoisted to the top. They must come before other imports.

// Mock the Svelte store with a real writable instance created inside the factory.
// This solves the "Cannot access before initialization" ReferenceError.
vi.mock("$lib/stores/player.store", async () => {
  const { writable: actualWritable } =
    await vi.importActual<typeof import("svelte/store")>("svelte/store");
  const initialPlayerState = {
    speed: 1.0,
    pitch: 0.0,
    gain: 1.0,
    isPlayable: false,
    isPlaying: false,
    error: null,
    fileName: "",
    status: "",
    duration: 0,
    currentTime: 0,
    audioBuffer: null,
  };
  const internalPlayerStoreInstance = actualWritable({ ...initialPlayerState });

  return {
    playerStore: internalPlayerStoreInstance,
    // Provide an "accessor" function so our tests can get a handle to the mock instance.
    __test__getPlayerStoreInstance: () => internalPlayerStoreInstance,
    __test__getInitialPlayerState: () => ({ ...initialPlayerState }),
  };
});

// Mock the web worker dependency.
const mockWorkerInstance = {
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((event: ErrorEvent) => void) | null,
};
vi.mock("$lib/workers/rubberband.worker?worker&inline", () => ({
  default: vi.fn().mockImplementation(() => mockWorkerInstance),
}));

// Mock AudioContext and its methods.
const mockDecodeAudioData = vi.fn();
global.AudioContext = vi.fn(() => ({
  decodeAudioData: mockDecodeAudioData,
  createGain: vi.fn(() => ({
    connect: vi.fn(),
    gain: { setValueAtTime: vi.fn() },
  })),
  resume: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  state: "running",
  currentTime: 0,
  destination: {},
  sampleRate: 48000,
})) as any;

// Mock fetch for worker dependencies.
vi.spyOn(global, "fetch").mockImplementation(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    text: () => Promise.resolve("// Mock loader script"),
  } as Response),
);
// --- End Mocks ---

// Now, we can safely import everything else.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { updateUrlWithCurrentTime } from "$lib/stores/url.store";
import audioEngineService from "./audioEngine.service"; // We import the REAL service.
import { RB_WORKER_MSG_TYPE } from "$lib/types/worker.types";
import {
  __test__getPlayerStoreInstance,
  __test__getInitialPlayerState,
} from "$lib/stores/player.store"; // Import the test accessors.

// Mock the new import
vi.mock("$lib/stores/url.store", () => ({
  updateUrlWithCurrentTime: vi.fn(),
}));

describe("AudioEngineService", () => {
  const MOCK_RAF_ID = 12345;
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let cafSpy: ReturnType<typeof vi.spyOn>;
  let mockAudioBuffer: AudioBuffer;
  let playerStoreInstance: Writable<any>;
  let mockFile: File;

  // Helper to simulate the worker becoming ready after INIT.
  const makeWorkerReady = () => {
    if (mockWorkerInstance.onmessage) {
      mockWorkerInstance.onmessage({
        data: { type: RB_WORKER_MSG_TYPE.INIT_SUCCESS },
      } as MessageEvent);
    }
  };

  beforeEach(() => {
    // Reset mocks and state before each test.
    vi.clearAllMocks();
    global.fetch.mockClear(); // Clear fetch mock specifically if needed

    // Get the handle to our mocked store instance and reset it.
    playerStoreInstance = __test__getPlayerStoreInstance();
    playerStoreInstance.set({ ...__test__getInitialPlayerState() });

    // Dispose the service to ensure a clean state from the previous test.
    // Note: This also clears the worker instance if it was created.
    audioEngineService.dispose();

    // Spy on animation frame methods.
    rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockReturnValue(MOCK_RAF_ID);
    cafSpy = vi.spyOn(window, "cancelAnimationFrame");

    // Create a mock AudioBuffer for tests.
    mockAudioBuffer = {
      duration: 10.0,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: vi.fn(() => new Float32Array(441000).fill(0.1)),
      length: 441000,
    } as unknown as AudioBuffer;
    mockDecodeAudioData.mockResolvedValue(mockAudioBuffer); // Default successful decode

    mockFile = new File([new ArrayBuffer(8)], "test.wav", {
      type: "audio/wav",
    });

    // Polyfill/mock File.prototype.arrayBuffer if it doesn't exist in JSDOM
    if (!File.prototype.arrayBuffer) {
      File.prototype.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new ArrayBuffer(8));
    } else {
      vi.spyOn(File.prototype, "arrayBuffer").mockResolvedValue(
        new ArrayBuffer(8),
      );
    }
  });

  afterEach(() => {
    audioEngineService.dispose(); // Clean up service state
    rafSpy.mockRestore();
    cafSpy.mockRestore();
  });

  describe("loadFile", () => {
    it("should update store status to 'Decoding...' and return AudioBuffer on successful load", async () => {
      const returnedBuffer = await audioEngineService.loadFile(mockFile);
      expect(get(playerStoreInstance).status).toBe(
        `Decoding ${mockFile.name}...`,
      );
      expect(returnedBuffer).toBe(mockAudioBuffer);
      // isPlayable is false until worker init
      expect(get(playerStoreInstance).isPlayable).toBe(false);
    });

    it("should call _initializeWorker internally, which posts an INIT message to the worker", async () => {
      await audioEngineService.loadFile(mockFile);
      // _initializeWorker is private, so we check its side effect: posting INIT to worker
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: RB_WORKER_MSG_TYPE.INIT,
          payload: expect.objectContaining({
            channels: mockAudioBuffer.numberOfChannels,
            sampleRate: mockAudioBuffer.sampleRate,
            initialSpeed: get(playerStoreInstance).speed, // Ensure these are from store
            initialPitch: get(playerStoreInstance).pitch,
          }),
        }),
        expect.any(Array), // For wasmBinary
      );
    });

    it("should update store and re-throw error if decodeAudioData fails", async () => {
      const decodeError = new Error("Failed to decode");
      mockDecodeAudioData.mockRejectedValueOnce(decodeError);
      const errorFile = new File([new ArrayBuffer(8)], "error.wav", {
        type: "audio/wav",
      });

      try {
        await audioEngineService.loadFile(errorFile);
      } catch (e) {
        expect(e).toBe(decodeError);
      }
      expect(get(playerStoreInstance).status).toBe(
        `Error decoding ${errorFile.name}`,
      );
      expect(get(playerStoreInstance).error).toBe(decodeError.message);
      expect(get(playerStoreInstance).isPlayable).toBe(false);
    });

    it("should re-throw error if fetching worker dependencies fails", async () => {
      global.fetch.mockImplementationOnce(() =>
        Promise.resolve({ ok: false, status: 500 } as Response),
      );
      const fetchErrorFile = new File([new ArrayBuffer(8)], "fetch_error.wav", {
        type: "audio/wav",
      });
      let errorThrown;
      try {
        await audioEngineService.loadFile(fetchErrorFile);
      } catch (e) {
        errorThrown = e;
      }
      expect(errorThrown).toBeInstanceOf(Error);
      expect((errorThrown as Error).message).toContain(
        "Failed to fetch worker dependencies",
      );
      expect(get(playerStoreInstance).status).toBe(
        `Error decoding ${fetchErrorFile.name}`,
      ); // loadFile's catch block will set this
    });
  });

  describe("handleWorkerMessage (INIT_SUCCESS)", () => {
    it("should update the player store to be playable but not change status from 'Ready'", async () => {
      // Load file first to set up the worker interaction path
      await audioEngineService.loadFile(mockFile);

      // Simulate a different status set by Orchestrator before worker init completes
      playerStoreInstance.update((s) => ({
        ...s,
        status: "OrchestratorIsReady",
      }));

      makeWorkerReady(); // Simulates worker sending INIT_SUCCESS

      expect(get(playerStoreInstance).isPlayable).toBe(true);
      expect(get(playerStoreInstance).status).toBe("OrchestratorIsReady"); // Status should not be overridden to "Ready..."
    });
  });

  describe("play", () => {
    // Re-initialize service for these tests as loadFile in outer beforeEach might not be desired for all.
    beforeEach(async () => {
      await audioEngineService.loadFile(mockFile);
      makeWorkerReady();
    });

    it("should start the animation loop by calling requestAnimationFrame", async () => {
      // audioEngineService.play() is now synchronous and returns void.
      audioEngineService.play();

      // --- ADD THIS YIELD ---
      // Give the event loop a chance to process the .then() callback inside play().
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Now the assertion will correctly find the call.
      expect(rafSpy).toHaveBeenCalledTimes(1);
    });

    it("should not play if worker is not initialized", async () => {
      audioEngineService.dispose(); // Reset service, worker is not initialized by removing it
      // Re-mock worker instance as dispose clears it
      vi.mocked(global.AudioContext).mockImplementationOnce(
        () =>
          ({
            decodeAudioData: mockDecodeAudioData,
            createGain: vi.fn(() => ({
              connect: vi.fn(),
              gain: { setValueAtTime: vi.fn() },
            })),
            resume: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
            state: "running",
            currentTime: 0,
            destination: {},
            sampleRate: 48000,
          }) as any,
      );
      await audioEngineService.loadFile(mockFile); // loadFile now creates worker but we won't call makeWorkerReady

      await audioEngineService.play();
      expect(rafSpy).not.toHaveBeenCalled();
    });
  });

  describe("pause", () => {
    beforeEach(async () => {
      (updateUrlWithCurrentTime as vi.Mock).mockClear();
      await audioEngineService.loadFile(mockFile);
      makeWorkerReady();
    });
    it("should stop animation, call updateUrlWithCurrentTime, and update store", async () => {
      // Simulate it was playing
      playerStoreInstance.update((s) => ({ ...s, isPlaying: true }));
      // Ensure animationFrameId is set within the service, if pause() logic depends on it for cancelAnimationFrame
      // This might require setting it indirectly via play() or directly if service internals are exposed/mocked
      audioEngineService.play(); // This sets animationFrameId internally then pauses.
      audioEngineService.pause(); // The actual call to test

      expect(cafSpy).toHaveBeenCalled(); // Check if cancelAnimationFrame was called
      expect(updateUrlWithCurrentTime).toHaveBeenCalled();
      expect(get(playerStoreInstance).isPlaying).toBe(false);
    });
  });

  describe("stop", () => {
    beforeEach(async () => {
      (updateUrlWithCurrentTime as vi.Mock).mockClear();
      await audioEngineService.loadFile(mockFile);
      makeWorkerReady();
    });
    it("should reset time, update store, then call updateUrlWithCurrentTime", async () => {
      await audioEngineService.play(); // Start playing to have something to stop
      playerStoreInstance.update((s) => ({ ...s, currentTime: 5.0 }));

      await audioEngineService.stop();

      expect(get(playerStoreInstance).currentTime).toBe(0);
      expect(get(playerStoreInstance).isPlaying).toBe(false);
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({
        type: RB_WORKER_MSG_TYPE.RESET,
      });
      expect(updateUrlWithCurrentTime).toHaveBeenCalled();
    });
  });

  describe("seek", () => {
    beforeEach(async () => {
      (updateUrlWithCurrentTime as vi.Mock).mockClear();
      await audioEngineService.loadFile(mockFile);
      makeWorkerReady();
    });
    it("should update time, call updateUrlWithCurrentTime, and reset worker (if paused)", async () => {
      playerStoreInstance.update((s) => ({ ...s, isPlaying: false }));
      expect(get(playerStoreInstance).isPlaying).toBe(false); // Pre-condition

      const seekTime = 5.0;
      await audioEngineService.seek(seekTime);

      expect(get(playerStoreInstance).currentTime).toBe(seekTime);
      expect(updateUrlWithCurrentTime).toHaveBeenCalled();
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({
        type: RB_WORKER_MSG_TYPE.RESET,
      });
      expect(get(playerStoreInstance).isPlaying).toBe(false); // Stays paused
    });

    it("should pause, update time, call updateUrlWithCurrentTime, and reset worker (if playing)", async () => {
      await audioEngineService.play(); // Start playing
      expect(get(playerStoreInstance).isPlaying).toBe(true); // Pre-condition
      // Clear calls from play()
      vi.mocked(updateUrlWithCurrentTime).mockClear();
      vi.mocked(mockWorkerInstance.postMessage).mockClear();

      const seekTime = 3.0;
      await audioEngineService.seek(seekTime);

      expect(get(playerStoreInstance).isPlaying).toBe(false); // Should be paused after seek
      expect(get(playerStoreInstance).currentTime).toBe(seekTime);
      expect(updateUrlWithCurrentTime).toHaveBeenCalled();
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({
        type: RB_WORKER_MSG_TYPE.RESET,
      });
    });
  });

  describe("Pre-Worker Gain Application", () => {
    let originalChannelData: Float32Array;

    beforeEach(async () => {
      // Use a small, distinct array for easier verification
      originalChannelData = new Float32Array([0.1, 0.2, -0.1, -0.2, 0.5]);
      mockAudioBuffer = {
        duration: originalChannelData.length / 44100, // Short duration
        numberOfChannels: 1,
        sampleRate: 44100,
        getChannelData: vi.fn(() => new Float32Array(originalChannelData)), // Return a copy
        length: originalChannelData.length,
      } as unknown as AudioBuffer;
      mockDecodeAudioData.mockResolvedValue(mockAudioBuffer);

      // Re-initialize playerStore with the new (mocked) gain from constants if needed,
      // though we will override it in tests.
      // The global mock setup already uses 1.0 as initial gain.
      playerStoreInstance = __test__getPlayerStoreInstance();
      playerStoreInstance.set({
        ...__test__getInitialPlayerState(),
        // Ensure gain is initially 1.0 or some known default before test overrides
        gain: 1.0, // Explicitly set for clarity before test-specific override
      });

      await audioEngineService.loadFile(mockFile);
      makeWorkerReady();
    });

    it("should apply gain to audio samples before sending them to the worker", async () => {
      const testGain = 0.5;
      playerStoreInstance.update((s) => ({ ...s, gain: testGain }));

      // Clear any previous calls to postMessage (like INIT)
      vi.mocked(mockWorkerInstance.postMessage).mockClear();

      // Call play, which should trigger _recursiveProcessAndPlayLoop via rAF
      audioEngineService.play(); // isPlaying is now true

      // Give the event loop a chance to process the async play method
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Get the callback passed to requestAnimationFrame and execute it once
      // This simulates the browser calling our loop function
      const processLoopCallback = rafSpy.mock.calls[0][0];
      processLoopCallback(0); // timestamp argument is not used in the current loop logic

      expect(mockWorkerInstance.postMessage).toHaveBeenCalledTimes(1);
      const messagePayload = mockWorkerInstance.postMessage.mock.calls[0][0];

      expect(messagePayload.type).toBe(RB_WORKER_MSG_TYPE.PROCESS);
      const sentBuffer = messagePayload.payload.inputBuffer[0] as Float32Array;

      // Verify that the gain was applied to each sample
      // The actual chunking logic might send a part of the originalChannelData,
      // so we need to find out what segment was actually processed.
      // The _performSingleProcessAndPlayIteration uses TARGET_CHUNK_DURATION_S.
      // Let's assume AUDIO_ENGINE_CONSTANTS.TARGET_CHUNK_DURATION_S = 0.1s (default from constants.ts)
      // Sample rate is 44100. Chunk size = 0.1 * 44100 = 4410 samples.
      // Our originalChannelData is very short (5 samples). So, it should process all of it.

      expect(sentBuffer.length).toBe(originalChannelData.length);
      for (let i = 0; i < sentBuffer.length; i++) {
        expect(sentBuffer[i]).toBeCloseTo(originalChannelData[i] * testGain);
      }
    });

    it("should handle multichannel audio by applying gain to all channels", async () => {
      const channel1Data = new Float32Array([0.1, 0.2, 0.3]);
      const channel2Data = new Float32Array([0.4, 0.5, 0.6]);
      mockAudioBuffer = {
        duration: channel1Data.length / 44100,
        numberOfChannels: 2,
        sampleRate: 44100,
        getChannelData: vi.fn((channelIndex) => {
          if (channelIndex === 0) return new Float32Array(channel1Data);
          if (channelIndex === 1) return new Float32Array(channel2Data);
          return new Float32Array(0);
        }),
        length: channel1Data.length,
      } as unknown as AudioBuffer;
      mockDecodeAudioData.mockResolvedValue(mockAudioBuffer);

      // Reload file with new multi-channel buffer
      await audioEngineService.loadFile(mockFile);
      makeWorkerReady(); // Re-initialize worker for the new buffer props

      const testGain = 0.7;
      playerStoreInstance.update((s) => ({ ...s, gain: testGain }));
      vi.mocked(mockWorkerInstance.postMessage).mockClear();

      audioEngineService.play();
      // Give the event loop a chance to process the async play method
      await new Promise((resolve) => setTimeout(resolve, 0));
      const processLoopCallback = rafSpy.mock.calls[0][0];
      processLoopCallback(0);

      expect(mockWorkerInstance.postMessage).toHaveBeenCalledTimes(1);
      const messagePayload = mockWorkerInstance.postMessage.mock.calls[0][0];
      expect(messagePayload.type).toBe(RB_WORKER_MSG_TYPE.PROCESS);

      const sentBufferChannel1 = messagePayload.payload
        .inputBuffer[0] as Float32Array;
      const sentBufferChannel2 = messagePayload.payload
        .inputBuffer[1] as Float32Array;

      expect(sentBufferChannel1.length).toBe(channel1Data.length);
      for (let i = 0; i < sentBufferChannel1.length; i++) {
        expect(sentBufferChannel1[i]).toBeCloseTo(channel1Data[i] * testGain);
      }

      expect(sentBufferChannel2.length).toBe(channel2Data.length);
      for (let i = 0; i < sentBufferChannel2.length; i++) {
        expect(sentBufferChannel2[i]).toBeCloseTo(channel2Data[i] * testGain);
      }
    });
  });
});

describe("unlockAudio", () => {
  // Variable to hold the playerStore instance, similar to how it's done in other tests in this file
  let playerStoreInstance: Writable<any>;
  let initialPlayerState: any;

  beforeEach(() => {
    // Get the handle to our mocked store instance and reset it.
    playerStoreInstance = __test__getPlayerStoreInstance();
    initialPlayerState = __test__getInitialPlayerState(); // Get initial state structure
    playerStoreInstance.set({
      ...initialPlayerState,
      audioContextResumed: false,
    });

    // Reset the mock for AudioContext for each test
    // vi.mocked(global.AudioContext).mockClear(); // Clears call counts etc.
    // Ensure AudioContext is reset to a default mock implementation before each test if needed,
    // or use mockImplementationOnce within each test for specific behaviors.
    // The global mock might be enough if its default state is 'running' and resume is a simple spy.
    // For unlockAudio, we often need to control the 'state' and 'resume' behavior specifically.
    vi.mocked(global.AudioContext).mockReset(); // Resets the mock itself, not just calls.

    // Dispose service to reset its internal state like `this.audioContextResumed`
    // and to ensure a fresh AudioContext instance is created by _getAudioContext()
    audioEngineService.dispose();
  });

  it("should call resume() on a suspended context and set flag after promise resolves", async () => {
    const resumeSpy = vi.fn().mockResolvedValue(undefined);
    vi.mocked(global.AudioContext).mockImplementationOnce(
      () =>
        ({
          state: "suspended",
          resume: resumeSpy,
          // Minimal required properties for this test path in _getAudioContext and unlockAudio
          createGain: vi.fn(() => ({
            connect: vi.fn(),
            gain: { setValueAtTime: vi.fn() },
          })),
          destination: {},
          currentTime: 0,
          sampleRate: 48000,
          close: vi.fn().mockResolvedValue(undefined), // for dispose
          decodeAudioData: vi.fn(), // for dispose/reset that might happen via loadFile path
        }) as any,
    );

    audioEngineService.unlockAudio(); // Call the non-blocking version

    expect(resumeSpy).toHaveBeenCalledTimes(1);
    // Allow microtask queue to flush for the .then() callback in unlockAudio
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(get(playerStoreInstance).audioContextResumed).toBe(true);
  });

  it("should not call resume() if context is already running but still set flag and update store", () => {
    const resumeSpy = vi.fn();
    vi.mocked(global.AudioContext).mockImplementationOnce(
      () =>
        ({
          state: "running",
          resume: resumeSpy,
          createGain: vi.fn(() => ({
            connect: vi.fn(),
            gain: { setValueAtTime: vi.fn() },
          })),
          destination: {},
          currentTime: 0,
          sampleRate: 48000,
          close: vi.fn().mockResolvedValue(undefined),
          decodeAudioData: vi.fn(),
        }) as any,
    );

    // Ensure store is false before call
    playerStoreInstance.update((s) => ({ ...s, audioContextResumed: false }));
    expect(get(playerStoreInstance).audioContextResumed).toBe(false);

    audioEngineService.unlockAudio();

    expect(resumeSpy).not.toHaveBeenCalled();
    expect(get(playerStoreInstance).audioContextResumed).toBe(true);
  });

  it("should be idempotent, call resume() only once for suspended, and update flag correctly", async () => {
    const resumeSpy = vi.fn().mockResolvedValue(undefined);
    vi.mocked(global.AudioContext).mockImplementationOnce(
      () =>
        ({
          state: "suspended",
          resume: resumeSpy,
          createGain: vi.fn(() => ({
            connect: vi.fn(),
            gain: { setValueAtTime: vi.fn() },
          })),
          destination: {},
          currentTime: 0,
          sampleRate: 48000,
          close: vi.fn().mockResolvedValue(undefined),
          decodeAudioData: vi.fn(),
        }) as any,
    );

    // First call
    audioEngineService.unlockAudio();
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    // Allow .then() to complete and set internal audioContextResumed = true
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(get(playerStoreInstance).audioContextResumed).toBe(true);

    // Second call
    // For the second call, _getAudioContext() might be called again.
    // If dispose() wasn't called, it might reuse the old context instance from the first call.
    // If dispose() was called, it needs a new mock.
    // The beforeEach calls dispose(), so AudioContext mock will be fresh if not for mockImplementationOnce.
    // To be safe, if the same AudioContext instance is expected to be reused by the service logic
    // (i.e. service doesn't nullify its context instance), then we should not mockImplementationOnce
    // or we should provide a more general mock in beforeEach.
    // Given our dispose in beforeEach, the AudioContext is new.
    // However, the internal `this.audioContextResumed` flag in the service instance is the key here.
    // If it's true, it should return early.

    // Let's assume the service's internal `this.audioContextResumed` is now true.
    // We need to ensure the mock for AudioContext for the *second* call (if it happens)
    // also has a resumeSpy, though it shouldn't be called.
    // The critical part is that `audioEngineService.audioContextResumed` is true.

    const resumeSpy2 = vi.fn().mockResolvedValue(undefined); // A new spy for a potentially new context
    vi.mocked(global.AudioContext).mockImplementationOnce(
      () =>
        ({
          // This mock might not even be hit if the early return works
          state: "suspended", // or 'running', behavior should be same (no resume call)
          resume: resumeSpy2,
          createGain: vi.fn(() => ({
            connect: vi.fn(),
            gain: { setValueAtTime: vi.fn() },
          })),
          destination: {},
          currentTime: 0,
          sampleRate: 48000,
          close: vi.fn().mockResolvedValue(undefined),
          decodeAudioData: vi.fn(),
        }) as any,
    );

    audioEngineService.unlockAudio(); // Second call

    expect(resumeSpy).toHaveBeenCalledTimes(1); // Original spy still 1
    expect(resumeSpy2).not.toHaveBeenCalled(); // New spy not called
    expect(get(playerStoreInstance).audioContextResumed).toBe(true); // Flag remains true
  });
});
