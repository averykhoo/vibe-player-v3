// vibe-player-v2/src/lib/services/audioEngine.service.test.ts
import { writable, type Writable } from "svelte/store";
import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import type { PlayerState } from "$lib/types/player.types";

// --- Mocks ---
// Mock stores first
const initialPlayerState: PlayerState = {
  status: "idle",
  fileName: null,
  duration: 0,
  currentTime: 0,
  isPlaying: false,
  isPlayable: false,
  speed: 1.0,
  pitchShift: 0.0, // Corrected from pitch to pitchShift to match PlayerState
  gain: 1.0,
  waveformData: undefined,
  error: null,
  audioBuffer: undefined, // Corrected to be undefined initially
  audioContextResumed: false,
  channels: undefined,
  sampleRate: undefined,
  lastProcessedChunk: undefined,
};
const playerStoreWritable: Writable<PlayerState> = writable({ ...initialPlayerState });

vi.mock("$lib/stores/player.store", () => ({
  playerStore: playerStoreWritable,
}));

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
const mockAudioContextInstance = {
  decodeAudioData: vi.fn(),
  createGain: vi.fn(() => ({
    connect: vi.fn(),
    gain: { setValueAtTime: vi.fn(), value: 1.0 },
  })),
  resume: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  state: "running" as AudioContextState,
  currentTime: 0,
  destination: {} as AudioDestinationNode,
  sampleRate: 48000,
  createBufferSource: vi.fn(() => ({
    buffer: null as AudioBuffer | null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as (() => void) | null,
    disconnect: vi.fn(),
  })),
  createBuffer: vi.fn((channels, length, sampleRate) => ({
    numberOfChannels: channels,
    length: length,
    sampleRate: sampleRate,
    duration: length / sampleRate,
    getChannelData: vi.fn(() => new Float32Array(length)),
    copyToChannel: vi.fn(),
    copyFromChannel: vi.fn(),
  })),
};
global.AudioContext = vi.fn().mockImplementation(() => mockAudioContextInstance);

// Mock fetch for worker dependencies.
const globalFetchSpy = vi.spyOn(global, "fetch");
// --- End Mocks ---

import audioEngineService from "./audioEngine.service"; // We import the REAL service.
import { RB_WORKER_MSG_TYPE } from "$lib/types/worker.types";
import { AUDIO_ENGINE_CONSTANTS } from "$lib/utils/constants"; // For MAX_GAIN
import { act } from "@testing-library/svelte"; // For wrapping state updates


describe("AudioEngineService", () => {
  const MOCK_RAF_ID = 12345;
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let cafSpy: ReturnType<typeof vi.spyOn>;
  let mockAudioBuffer: AudioBuffer;

  const simulateWorkerMessage = (message: any) => {
    if (mockWorkerInstance.onmessage) {
        act(() => {
            mockWorkerInstance.onmessage!({ data: message } as MessageEvent);
        });
    }
  };
  const simulateWorkerError = (errorEvent: ErrorEvent) => {
    if (mockWorkerInstance.onerror) {
        act(() => {
            mockWorkerInstance.onerror!(errorEvent);
        });
    }
  };

  beforeEach(() => {
    vi.resetAllMocks();
    playerStoreWritable.set({ ...initialPlayerState });

    globalFetchSpy.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        text: () => Promise.resolve("// Mock loader script"),
      } as Response),
    );

    mockAudioContextInstance.decodeAudioData.mockReset();
    mockAudioContextInstance.state = "running"; // Reset state
    mockAudioContextInstance.currentTime = 0; // Reset time


    rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(MOCK_RAF_ID);
    cafSpy = vi.spyOn(window, "cancelAnimationFrame");

    mockAudioBuffer = {
      duration: 10.0,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: vi.fn(() => new Float32Array(441000).fill(0.1)),
      length: 441000,
      copyToChannel: vi.fn(),
      copyFromChannel: vi.fn(),
    } as unknown as AudioBuffer; // Type assertion for mock
  });

  afterEach(() => {
    audioEngineService.dispose();
  });

  describe("loadFile", () => {
    let mockFile: File;

    beforeEach(() => {
      mockFile = new File(["dummy content"], "test.mp3", { type: "audio/mpeg" });
      // Explicitly set originalBuffer to null before each loadFile test
      (audioEngineService as any).originalBuffer = null;
      (audioEngineService as any).isWorkerReady = false; // Reset worker ready state
    });

    it("should successfully load and decode a file, returning an AudioBuffer", async () => {
      mockAudioContextInstance.decodeAudioData.mockImplementation((_arrayBuffer, successCallback) => {
        successCallback(mockAudioBuffer); // Call success callback with mock AudioBuffer
        return Promise.resolve(mockAudioBuffer); // decodeAudioData often returns a Promise-like structure or the buffer directly
      });

      const buffer = await audioEngineService.loadFile(mockFile);

      expect(mockAudioContextInstance.decodeAudioData).toHaveBeenCalledOnce();
      expect(buffer).toBe(mockAudioBuffer);
      expect((audioEngineService as any).originalBuffer).toBe(mockAudioBuffer);
      // Assert no unintended side-effects that were removed
      expect(mockWorkerInstance.postMessage).not.toHaveBeenCalled(); // Should not try to init worker
      expect(get(playerStoreWritable).isPlayable).toBe(initialPlayerState.isPlayable); // Should not set isPlayable
      expect((audioEngineService as any).isWorkerReady).toBe(false); // isWorkerReady should remain false
    });

    it("should throw an error for an invalid file (e.g., empty file)", async () => {
      const emptyFile = new File([], "empty.mp3", { type: "audio/mpeg" });
      await expect(audioEngineService.loadFile(emptyFile)).rejects.toThrow(
        /invalid or empty File object/i,
      );
      expect((audioEngineService as any).originalBuffer).toBeNull();
    });

    it("should throw an error if decoding fails", async () => {
      const decodeError = new DOMException("Decoding failed", "EncodingError");
      mockAudioContextInstance.decodeAudioData.mockImplementation((_arrayBuffer, _successCallback, errorCallback) => {
        if (errorCallback) errorCallback(decodeError); // Call error callback
        return Promise.reject(decodeError); // decodeAudioData often returns a Promise
      });

      await expect(audioEngineService.loadFile(mockFile)).rejects.toThrow(
        `Error decoding audio data: ${decodeError.message}`,
      );
      expect((audioEngineService as any).originalBuffer).toBeNull();
      expect((audioEngineService as any).isWorkerReady).toBe(false);
    });
  });

  describe("initializeWorker", () => {
    beforeEach(() => {
        // Reset playerStore to ensure initialSpeed and initialPitch are from a clean state
        playerStoreWritable.set({ ...initialPlayerState, speed: 1.2, pitchShift: -2.0 });
    });

    it("should initialize the worker, post INIT message, and update store on success", async () => {
      const initPromise = audioEngineService.initializeWorker(mockAudioBuffer);
      // Simulate worker sending INIT_SUCCESS
      simulateWorkerMessage({ type: RB_WORKER_MSG_TYPE.INIT_SUCCESS });
      await expect(initPromise).resolves.toBeUndefined();

      expect(global.fetch).toHaveBeenCalledTimes(2); // For WASM and loader script
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: RB_WORKER_MSG_TYPE.INIT,
          payload: expect.objectContaining({
            sampleRate: mockAudioBuffer.sampleRate,
            channels: mockAudioBuffer.numberOfChannels,
            initialSpeed: 1.2, // Value from playerStoreWritable set in beforeEach
            initialPitch: -2.0, // Value from playerStoreWritable set in beforeEach
          }),
        }),
        [expect.any(ArrayBuffer)], // For wasmBinary
      );
      expect(get(playerStoreWritable).isPlayable).toBe(true);
      expect(get(playerStoreWritable).error).toBeNull();
      expect((audioEngineService as any).isWorkerReady).toBe(true);
    });

    it("should handle worker initialization failure (worker sends ERROR message)", async () => {
      const initPromise = audioEngineService.initializeWorker(mockAudioBuffer);
      simulateWorkerMessage({ type: RB_WORKER_MSG_TYPE.ERROR, payload: { message: "Worker init crashed" } });

      await expect(initPromise).rejects.toThrow("Worker init crashed");
      expect(get(playerStoreWritable).isPlayable).toBe(false);
      expect(get(playerStoreWritable).error).toBe("Worker init crashed");
      expect((audioEngineService as any).isWorkerReady).toBe(false);
    });

    it("should handle worker initialization failure (worker.onerror callback)", async () => {
      const initPromise = audioEngineService.initializeWorker(mockAudioBuffer);
      // Directly trigger the worker's onerror
      const mockErrorEvent = new ErrorEvent("error", { message: "Critical worker failure from onerror" });
      simulateWorkerError(mockErrorEvent);

      await expect(initPromise).rejects.toThrow("Critical worker failure from onerror");
      expect(get(playerStoreWritable).isPlayable).toBe(false);
      expect(get(playerStoreWritable).error).toBe("Worker crashed or encountered an unrecoverable error."); // Generic message set by service's onerror
      expect((audioEngineService as any).isWorkerReady).toBe(false);
    });

    it("should handle failure when fetching worker dependencies", async () => {
      globalFetchSpy.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server Error" } as Response);

      await expect(audioEngineService.initializeWorker(mockAudioBuffer)).rejects.toThrow(
        /Failed to fetch worker dependencies/i,
      );
      expect(get(playerStoreWritable).isPlayable).toBe(false);
      expect(get(playerStoreWritable).error).toMatch(/Error fetching worker dependencies: Failed to fetch worker dependencies/i);
      expect((audioEngineService as any).isWorkerReady).toBe(false);
    });

    it("should reject if no AudioBuffer is provided", async () => {
        await expect(audioEngineService.initializeWorker(null as any)).rejects.toThrow(
            "initializeWorker called with no AudioBuffer."
        );
        expect(get(playerStoreWritable).isPlayable).toBe(false);
        expect(get(playerStoreWritable).error).toBe("initializeWorker called with no AudioBuffer.");
    });
  });

  describe("Playback Controls (after successful loadFile and initializeWorker)", () => {
    beforeEach(async () => {
      // Simulate successful load and init
      mockAudioContextInstance.decodeAudioData.mockImplementation((_, successCb) => { successCb(mockAudioBuffer); return Promise.resolve(mockAudioBuffer); });
      const mockFile = new File(["dummy"], "test.wav", { type: "audio/wav" });
      await audioEngineService.loadFile(mockFile); // This sets this.originalBuffer

      const initPromise = audioEngineService.initializeWorker(mockAudioBuffer);
      simulateWorkerMessage({ type: RB_WORKER_MSG_TYPE.INIT_SUCCESS });
      await initPromise; // This sets this.isWorkerReady = true

      // Clear mocks that might have been called during setup
      vi.clearAllMocks();
      // Re-apply fetch mock if cleared
      globalFetchSpy.mockImplementation(() => Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)), text: () => Promise.resolve("// Mock loader script")} as Response));
      rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(MOCK_RAF_ID);
      cafSpy = vi.spyOn(window, "cancelAnimationFrame");
    });

    it("play: should start the animation loop if worker is ready", async () => {
      await audioEngineService.play();
      expect(rafSpy).toHaveBeenCalledTimes(1);
      expect((audioEngineService as any).isPlaying).toBe(true);
      // playerStore.isPlaying is updated by UI/Orchestrator
    });

    it("play: should not start if worker is not ready", async () => {
      (audioEngineService as any).isWorkerReady = false; // Manually set worker to not ready
      await audioEngineService.play();
      expect(rafSpy).not.toHaveBeenCalled();
      expect((audioEngineService as any).isPlaying).toBe(false);
    });

    it("play: should resume AudioContext if suspended", async () => {
      mockAudioContextInstance.state = "suspended";
      await audioEngineService.play();
      expect(mockAudioContextInstance.resume).toHaveBeenCalled();
      expect(rafSpy).toHaveBeenCalledTimes(1);
      mockAudioContextInstance.state = "running"; // Reset for other tests
    });

    it("pause: should stop the animation loop", async () => {
      await audioEngineService.play(); // Start playing first
      const currentRafId = rafSpy.mock.results[0].value;
      audioEngineService.pause();
      expect(cafSpy).toHaveBeenCalledWith(currentRafId);
      expect((audioEngineService as any).isPlaying).toBe(false);
    });

    it("stop: should cancel loop, reset worker, reset internal time", async () => {
      await audioEngineService.play();
      (audioEngineService as any).sourcePlaybackOffset = 5.0; // Simulate some playback
      const currentRafId = rafSpy.mock.results[0].value;

      await audioEngineService.stop();

      expect(cafSpy).toHaveBeenCalledWith(currentRafId);
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({ type: RB_WORKER_MSG_TYPE.RESET });
      expect((audioEngineService as any).isPlaying).toBe(false);
      expect((audioEngineService as any).sourcePlaybackOffset).toBe(0);
    });

    describe("seek", () => {
      it("should update internal time, reset worker, and keep paused state if paused", async () => {
        (audioEngineService as any).isPlaying = false; // Ensure paused
        vi.clearAllMocks(); // Clear postMessage calls from init
        rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(MOCK_RAF_ID);

        await audioEngineService.seek(5.0);

        expect(rafSpy).not.toHaveBeenCalled(); // Should not start playing
        expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({ type: RB_WORKER_MSG_TYPE.RESET });
        expect((audioEngineService as any).sourcePlaybackOffset).toBe(5.0);
        expect((audioEngineService as any).isPlaying).toBe(false);
      });

      it("should pause playback, update internal time, reset worker if playing", async () => {
        await audioEngineService.play(); // Start playing
        const currentRafId = rafSpy.mock.results[0].value;
        vi.clearAllMocks(); // Clear postMessage calls
        rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(MOCK_RAF_ID);
        cafSpy = vi.spyOn(window, "cancelAnimationFrame");


        await audioEngineService.seek(3.0);

        expect(cafSpy).toHaveBeenCalledWith(currentRafId); // Should have paused
        expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({ type: RB_WORKER_MSG_TYPE.RESET });
        expect((audioEngineService as any).sourcePlaybackOffset).toBe(3.0);
        expect((audioEngineService as any).isPlaying).toBe(false); // Should be paused after seek
      });
    });

    it("setSpeed: should post SET_SPEED to worker if worker is ready", () => {
      audioEngineService.setSpeed(1.5);
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: RB_WORKER_MSG_TYPE.SET_SPEED, payload: { speed: 1.5 } })
      );
      // No direct store update expected here for playerStore.speed
    });

    it("setSpeed: should NOT post SET_SPEED if worker is not ready", () => {
        (audioEngineService as any).isWorkerReady = false;
        audioEngineService.setSpeed(1.5);
        expect(mockWorkerInstance.postMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: RB_WORKER_MSG_TYPE.SET_SPEED })
        );
    });

    it("setPitch: should post SET_PITCH to worker if worker is ready", () => {
      audioEngineService.setPitch(2.0);
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: RB_WORKER_MSG_TYPE.SET_PITCH, payload: { pitch: 2.0 } })
      );
      // No direct store update expected here for playerStore.pitchShift
    });

    it("setGain: should update gainNode value", () => {
      audioEngineService.setGain(0.5);
      // audioEngine gets a new gainNode on _getAudioContext, so we check the mock directly
      expect(mockAudioContextInstance.createGain().gain.setValueAtTime).toHaveBeenCalledWith(0.5, mockAudioContextInstance.currentTime);
      // No direct store update expected here for playerStore.gain
    });

    it("setGain: should clamp gain value to MAX_GAIN", () => {
        const maxGain = AUDIO_ENGINE_CONSTANTS.MAX_GAIN; // e.g. 2.0
        audioEngineService.setGain(maxGain + 0.5);
        expect(mockAudioContextInstance.createGain().gain.setValueAtTime).toHaveBeenCalledWith(maxGain, mockAudioContextInstance.currentTime);
    });
  });
});
