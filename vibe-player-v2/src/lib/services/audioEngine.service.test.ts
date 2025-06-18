// vibe-player-v2/src/lib/services/audioEngine.service.test.ts
import { writable, type Writable } from "svelte/store";
import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";

// --- Mocks ---
// Mock stores first
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
const playerStoreWritable = writable({ ...initialPlayerState });

vi.mock("$lib/stores/player.store", () => ({
  playerStore: playerStoreWritable,
}));

const initialAnalysisState = {}; // Define as needed
const analysisStoreWritable = writable({ ...initialAnalysisState });
vi.mock("$lib/stores/analysis.store", () => ({
  analysisStore: analysisStoreWritable,
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
    gain: { setValueAtTime: vi.fn(), value: 1.0 }, // Added value for direct access if needed
  })),
  resume: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  state: "running",
  currentTime: 0,
  destination: {},
  sampleRate: 48000,
  createBufferSource: vi.fn(() => ({
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(), // Added stop mock for source nodes
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
global.AudioContext = vi.fn(() => mockAudioContextInstance) as any;

// Mock fetch for worker dependencies.
const globalFetchSpy = vi.spyOn(global, "fetch");
// --- End Mocks ---

import audioEngineService from "./audioEngine.service"; // We import the REAL service.
import { RB_WORKER_MSG_TYPE } from "$lib/types/worker.types";
import { act } from "@testing-library/svelte";


describe("AudioEngineService", () => {
  const MOCK_RAF_ID = 12345;
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let cafSpy: ReturnType<typeof vi.spyOn>;
  let mockAudioBuffer: AudioBuffer;

  // Helper to simulate the worker becoming ready after INIT.
  const simulateWorkerMessage = (message: any) => {
    if (mockWorkerInstance.onmessage) {
      act(() => { // Wrap state-changing callback invocation in act
        mockWorkerInstance.onmessage!({ data: message } as MessageEvent);
      });
    }
  };
   const simulateWorkerError = (errorEvent: ErrorEvent) => {
    if (mockWorkerInstance.onerror) {
      act(() => { // Wrap state-changing callback invocation in act
        mockWorkerInstance.onerror!(errorEvent);
      });
    }
  };


  beforeEach(() => {
    vi.resetAllMocks(); // Use resetAllMocks for a cleaner state
    playerStoreWritable.set({ ...initialPlayerState });
    analysisStoreWritable.set({ ...initialAnalysisState });

    // Re-apply default fetch mock for each test, can be overridden per test
    globalFetchSpy.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)), // Mock WASM
        text: () => Promise.resolve("// Mock loader script"),   // Mock loader
      } as Response),
    );

    // Reset AudioContext mocks specifically for decodeAudioData behavior per test
    mockAudioContextInstance.decodeAudioData.mockReset();


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
    } as unknown as AudioBuffer;
  });

  afterEach(() => {
    audioEngineService.dispose(); // Ensure cleanup
  });

  describe("loadFile", () => {
    let mockFile: File;

    beforeEach(() => {
      mockFile = new File(["dummy content"], "test.mp3", { type: "audio/mpeg" });
      vi.spyOn(analysisStoreWritable, 'set');
      (audioEngineService as any).originalBuffer = {} as AudioBuffer;
    });

    it("should successfully load and decode a file, call stop, and clear analysisStore", async () => {
      mockAudioContextInstance.decodeAudioData.mockImplementation((arrayBuffer, successCallback) => {
        successCallback(mockAudioBuffer);
      });

      const buffer = await audioEngineService.loadFile(mockFile);

      expect(buffer).toBe(mockAudioBuffer);
      expect((audioEngineService as any).originalBuffer).toBe(mockAudioBuffer);
      expect(analysisStoreWritable.set).toHaveBeenCalledWith({});
    });

    it("should throw an error for an invalid file (e.g., empty file)", async () => {
      const emptyFile = new File([], "empty.mp3", { type: "audio/mpeg" });
      await expect(audioEngineService.loadFile(emptyFile)).rejects.toThrow(
        /invalid or empty File object/i,
      );
    });

    it("should throw an error if decoding fails", async () => {
      const decodeError = new Error("Decoding failed");
      mockAudioContextInstance.decodeAudioData.mockImplementation((arrayBuffer, successCallback, errorCallback) => {
        errorCallback(decodeError);
      });

      await expect(audioEngineService.loadFile(mockFile)).rejects.toThrow(
        `Error decoding audio: ${decodeError.message}`,
      );
       expect((audioEngineService as any).originalBuffer).toBeNull();
    });
  });

  describe("initializeWorker", () => {
    it("should initialize the worker, post INIT message, and update store on success", async () => {
      const initPromise = audioEngineService.initializeWorker(mockAudioBuffer);
      simulateWorkerMessage({ type: RB_WORKER_MSG_TYPE.INIT_SUCCESS });
      await expect(initPromise).resolves.toBeUndefined();

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: RB_WORKER_MSG_TYPE.INIT,
          payload: expect.objectContaining({
            sampleRate: mockAudioBuffer.sampleRate,
            channels: mockAudioBuffer.numberOfChannels,
            initialSpeed: initialPlayerState.speed,
            initialPitch: initialPlayerState.pitch,
          }),
        }),
        [expect.any(ArrayBuffer)],
      );
      expect(get(playerStoreWritable).isPlayable).toBe(true);
      expect((audioEngineService as any).isWorkerInitialized).toBe(true);
    });

    it("should handle worker initialization failure (worker sends ERROR message)", async () => {
      const initPromise = audioEngineService.initializeWorker(mockAudioBuffer);
      simulateWorkerMessage({ type: RB_WORKER_MSG_TYPE.ERROR, payload: { message: "Worker init crashed" } });

      await expect(initPromise).rejects.toThrow("Worker init crashed");
      expect(get(playerStoreWritable).isPlayable).toBe(false);
      expect(get(playerStoreWritable).error).toBe("Worker init crashed");
      expect((audioEngineService as any).isWorkerInitialized).toBe(false);
    });

    it("should handle worker initialization failure (worker onerror)", async () => {
      const initPromise = audioEngineService.initializeWorker(mockAudioBuffer);
      const mockError = new ErrorEvent("error", { message: "Critical worker failure" });
      simulateWorkerError(mockError);

      await expect(initPromise).rejects.toThrow("Worker error: Critical worker failure");
      expect(get(playerStoreWritable).isPlayable).toBe(false);
      expect(get(playerStoreWritable).error).toContain("Worker failed to initialize or crashed");
      expect((audioEngineService as any).isWorkerInitialized).toBe(false);
    });

    it("should handle failure when fetching worker dependencies", async () => {
      globalFetchSpy.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server Error" } as Response);

      await expect(audioEngineService.initializeWorker(mockAudioBuffer)).rejects.toThrow(
        /Failed to fetch worker dependencies/i,
      );
      expect(get(playerStoreWritable).isPlayable).toBe(false);
      expect(get(playerStoreWritable).error).toMatch(/Worker init failed: Failed to fetch worker dependencies/i);
      expect((audioEngineService as any).isWorkerInitialized).toBe(false);
    });
  });

  describe("Playback Controls (after load and init)", () => {
    beforeEach(async () => {
      mockAudioContextInstance.decodeAudioData.mockImplementation((_, successCb) => successCb(mockAudioBuffer));
      const mockFile = new File(["dummy"], "test.wav", { type: "audio/wav" });
      await audioEngineService.loadFile(mockFile);

      const initPromise = audioEngineService.initializeWorker(mockAudioBuffer);
      simulateWorkerMessage({ type: RB_WORKER_MSG_TYPE.INIT_SUCCESS });
      await initPromise;
      vi.clearAllMocks();

       globalFetchSpy.mockImplementation(() =>
        Promise.resolve({
          ok: true, status: 200,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
          text: () => Promise.resolve("// Mock loader script"),
        } as Response),
      );
       // Ensure rafSpy is fresh for each playback control test
      rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(MOCK_RAF_ID);
      cafSpy = vi.spyOn(window, "cancelAnimationFrame");
    });

    it("play: should start the animation loop and update store", async () => {
      await audioEngineService.play();
      expect(rafSpy).toHaveBeenCalledTimes(1);
      expect(get(playerStoreWritable).isPlaying).toBe(true);
    });

    it("play: should resume AudioContext if suspended", async () => {
      mockAudioContextInstance.state = "suspended";
      await audioEngineService.play();
      expect(mockAudioContextInstance.resume).toHaveBeenCalled();
      expect(rafSpy).toHaveBeenCalledTimes(1);
      mockAudioContextInstance.state = "running";
    });

    it("play: should not play if worker is not initialized", async () => {
      (audioEngineService as any).isWorkerInitialized = false;
      await audioEngineService.play();
      expect(rafSpy).not.toHaveBeenCalled();
    });

    it("pause: should stop the animation loop and update store", async () => {
      await audioEngineService.play();
      const currentRafId = rafSpy.mock.results[0].value;

      audioEngineService.pause();
      expect(cafSpy).toHaveBeenCalledWith(currentRafId);
      expect(get(playerStoreWritable).isPlaying).toBe(false);
    });

    it("stop: should cancel loop, reset worker, reset time and update store", async () => {
      await audioEngineService.play();
      playerStoreWritable.update((s) => ({ ...s, currentTime: 5.0 }));
      const currentRafId = rafSpy.mock.results[0].value;

      await audioEngineService.stop();

      expect(cafSpy).toHaveBeenCalledWith(currentRafId);
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({ type: RB_WORKER_MSG_TYPE.RESET });
      expect(get(playerStoreWritable).isPlaying).toBe(false);
      expect(get(playerStoreWritable).currentTime).toBe(0);
    });

    describe("seek", () => {
        it("should update time, reset worker, and keep paused state if paused", async () => {
          playerStoreWritable.set({...get(playerStoreWritable), isPlaying: false });
          vi.clearAllMocks();
          rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(MOCK_RAF_ID); // Re-spy after clear

          await audioEngineService.seek(5.0);

          expect(rafSpy).not.toHaveBeenCalled();
          expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({ type: RB_WORKER_MSG_TYPE.RESET });
          expect(get(playerStoreWritable).currentTime).toBe(5.0);
          expect(get(playerStoreWritable).isPlaying).toBe(false);
        });

        it("should pause playback, update time, reset worker if playing", async () => {
          await audioEngineService.play();
          const currentRafId = rafSpy.mock.results[0].value;
          vi.clearAllMocks();
          rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(MOCK_RAF_ID); // Re-spy
          cafSpy = vi.spyOn(window, "cancelAnimationFrame"); // Re-spy

          await audioEngineService.seek(3.0);

          expect(cafSpy).toHaveBeenCalledWith(currentRafId);
          expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({ type: RB_WORKER_MSG_TYPE.RESET });
          expect(get(playerStoreWritable).currentTime).toBe(3.0);
          expect(rafSpy).not.toHaveBeenCalled();
          expect(get(playerStoreWritable).isPlaying).toBe(false);
        });
    });

    it("setSpeed: should post SET_SPEED message to worker and update store", () => {
        audioEngineService.setSpeed(1.5);
        expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: RB_WORKER_MSG_TYPE.SET_SPEED, payload: { speed: 1.5 } })
        );
        expect(get(playerStoreWritable).speed).toBe(1.5);
    });

    it("setPitch: should post SET_PITCH message to worker and update store", () => {
        audioEngineService.setPitch(2.0);
        expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: RB_WORKER_MSG_TYPE.SET_PITCH, payload: { pitch: 2.0 } })
        );
        expect(get(playerStoreWritable).pitch).toBe(2.0);
    });

    it("setGain: should update gainNode value and update store", () => {
        audioEngineService.setGain(0.5);
        expect(mockAudioContextInstance.createGain().gain.setValueAtTime).toHaveBeenCalledWith(0.5, mockAudioContextInstance.currentTime);
        expect(get(playerStoreWritable).gain).toBe(0.5);
    });
  });
});
