import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mocked,
} from "vitest";
import RubberbandWorker from '$lib/workers/rubberband.worker?worker';
import audioEngineService from "./audioEngine.service"; // Assuming default export
import { playerStore } from "$lib/stores/player.store";
import analysisService from "$lib/services/analysis.service";
import { AUDIO_ENGINE_CONSTANTS } from "$lib/utils"; // For message types
import { RB_WORKER_MSG_TYPE } from "$lib/types/worker.types";
import { writable } from "svelte/store"; // Import writable

// Mock Svelte stores
const initialPlayerStoreState = {
  status: "Initial",
  fileName: null,
  duration: 0,
  currentTime: 0, // Ensure currentTime is part of the initial state
  isPlaying: false,
  isPlayable: false,
  speed: 1,
  pitch: 0,
  gain: 1,
  waveformData: undefined,
  error: null,
  // Add any other properties expected by the service or tests
};
const mockPlayerStore = writable(initialPlayerStoreState); // This line is fine

vi.mock("$lib/stores/player.store", () => ({
  // Use a getter to ensure the test always gets the current instance, esp. after beforeEach reset
  get playerStore() { return mockPlayerStore; }
}));

vi.mock("$lib/stores/analysis.store", () => {
  // For analysisStore, if it's not directly read by get() with specific state needs in these tests,
  // the simpler mock might be okay. If it also needs state for get(), apply similar writable pattern.
  return {
    analysisStore: {
      subscribe: vi.fn(() => vi.fn()), // Must return an unsubscribe function
      set: vi.fn(),
      update: vi.fn(),
    },
  };
});

// Mock analysisService
vi.mock("$lib/services/analysis.service", () => ({
  default: {
    initialize: vi.fn(),
    startSpectrogramProcessing: vi.fn(),
    // Add other methods if needed
  },
}));

// Mock Web Workers
const mockWorkerInstance = {
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((event: ErrorEvent) => void) | null,
};
// global.Worker = vi.fn(() => mockWorkerInstance); // This mocks the constructor
// For Vite worker imports (?worker), we need to mock the module
vi.mock("$lib/workers/rubberband.worker?worker", () => ({
  default: vi.fn().mockImplementation(() => mockWorkerInstance),
}));

// Mock AudioContext
const mockBufferSourceNode = {
  buffer: null,
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  disconnect: vi.fn(), // Added missing disconnect mock
  onended: null as (() => void) | null,
};
const mockGainNode = {
  gain: { value: 1, setValueAtTime: vi.fn() },
  connect: vi.fn(),
};
const mockAudioContextInstance = {
  decodeAudioData: vi.fn(),
  createBufferSource: vi.fn(() => mockBufferSourceNode),
  createGain: vi.fn(() => mockGainNode),
  resume: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
  state: "running" as AudioContextState,
  currentTime: 0,
  destination: {}, // Minimal mock for destination
  sampleRate: 44100,
};
global.AudioContext = vi.fn(() => mockAudioContextInstance);

describe("AudioEngineService", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset worker instance mocks
    mockWorkerInstance.postMessage.mockClear();
    mockWorkerInstance.terminate.mockClear();
    mockWorkerInstance.onmessage = null;
    mockWorkerInstance.onerror = null;
    // Reset the mock store state before each test
    mockPlayerStore.set(initialPlayerStoreState); // initialPlayerStoreState is defined above mockPlayerStore

    // Spy on the actual store methods for each test, after resetting state
    // Important: Clear previous spies if any, or ensure this is the first time they are spied on in this scope.
    // vi.clearAllMocks() handles clearing general mock call history.
    // If we need to re-spy or ensure spies are fresh:
    vi.spyOn(mockPlayerStore, 'subscribe').mockClear(); // Clear specific spy history
    vi.spyOn(mockPlayerStore, 'update').mockClear();
    vi.spyOn(mockPlayerStore, 'set').mockClear();

    (analysisService.startSpectrogramProcessing as Mocked<any>).mockClear();

    // Reset AudioContext instance mocks
    mockAudioContextInstance.decodeAudioData.mockReset();
    mockAudioContextInstance.createBufferSource.mockClear();
    mockGainNode.gain.setValueAtTime.mockClear();
    mockBufferSourceNode.start.mockClear();
    mockBufferSourceNode.stop.mockClear();

    // Reset service state by calling dispose, then re-enable for next test
    // This is a bit of a hack; true singleton reset is harder.
    // audioEngineService.dispose(); // dispose might clear stores we want to check
    // Re-getting instance or specific re-init for test might be needed if state persists badly
  });

  afterEach(() => {
    audioEngineService.dispose(); // Clean up after each test
  });

  describe("initialize", () => {
    it("should create a worker and post an INIT message", async () => {
      const initPromise = audioEngineService.initialize({
        sampleRate: 44100,
        channels: 1,
        initialSpeed: 1,
        initialPitch: 0,
      });
      // Simulate worker response to allow initialization to complete
      if (mockWorkerInstance.onmessage) {
        mockWorkerInstance.onmessage({
          data: { type: RB_WORKER_MSG_TYPE.INIT_SUCCESS, messageId: "rb_msg_0" },
        } as MessageEvent);
      }
      await initPromise;
      expect(RubberbandWorker).toHaveBeenCalledTimes(1); // Check if Worker constructor was called via the mock
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: RB_WORKER_MSG_TYPE.INIT }),
      );
    });

    it("should update playerStore on INIT_SUCCESS", async () => {
      const promise = audioEngineService.initialize({
        sampleRate: 44100,
        channels: 1,
        initialSpeed: 1,
        initialPitch: 0,
      });
      expect(mockWorkerInstance.onmessage).not.toBeNull();

      const mockEvent = {
        data: { type: RB_WORKER_MSG_TYPE.INIT_SUCCESS, messageId: "rb_msg_0" },
      } as MessageEvent;
      if (mockWorkerInstance.onmessage) mockWorkerInstance.onmessage(mockEvent);

      await promise;
      expect(mockPlayerStore.update).toHaveBeenCalledWith(expect.any(Function));
    });

    it("should update playerStore on INIT_ERROR", async () => {
      const promise = audioEngineService.initialize({
        sampleRate: 44100,
        channels: 1,
        initialSpeed: 1,
        initialPitch: 0,
      });
      expect(mockWorkerInstance.onmessage).not.toBeNull();

      const mockErrorEvent = {
        data: {
          type: RB_WORKER_MSG_TYPE.INIT_ERROR,
          error: "Test init error",
          messageId: "rb_msg_0",
        },
      } as MessageEvent;
      if (mockWorkerInstance.onmessage) mockWorkerInstance.onmessage(mockErrorEvent);

      await promise;
      expect(mockPlayerStore.update).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe("loadFile", () => {
    const mockArrayBuffer = new ArrayBuffer(8);
    const mockFileName = "test.wav";
    const mockDecodedBuffer = {
      duration: 1.0,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: vi.fn(() => new Float32Array([0, 0, 0])),
    };

    beforeEach(async () => {
      // Ensure service is initialized before loading a file
      const initPromise = audioEngineService.initialize({
        sampleRate: 44100,
        channels: 1,
        initialSpeed: 1,
        initialPitch: 0,
      });
      if (mockWorkerInstance.onmessage) {
        mockWorkerInstance.onmessage({
          data: {
            type: RB_WORKER_MSG_TYPE.INIT_SUCCESS,
            messageId: "rb_msg_0",
          },
        } as MessageEvent);
      }
      await initPromise;
      mockAudioContextInstance.decodeAudioData.mockResolvedValue(
        mockDecodedBuffer as unknown as AudioBuffer,
      );
    });

    it("should call decodeAudioData with the provided ArrayBuffer", async () => {
      await audioEngineService.loadFile(mockArrayBuffer, mockFileName);
      expect(mockAudioContextInstance.decodeAudioData).toHaveBeenCalledWith(
        mockArrayBuffer,
      );
    });

    it("should update playerStore with decoded audio information", async () => {
      await audioEngineService.loadFile(mockArrayBuffer, mockFileName);
      expect(mockPlayerStore.update).toHaveBeenCalledWith(expect.any(Function));
    });

    it("should call analysisService.startSpectrogramProcessing with the decoded buffer", async () => {
      await audioEngineService.loadFile(mockArrayBuffer, mockFileName);
      expect(analysisService.startSpectrogramProcessing).toHaveBeenCalledWith(
        mockDecodedBuffer,
      );
    });

    it("should update playerStore on decoding error", async () => {
      const decodeError = new Error("Test decoding error");
      mockAudioContextInstance.decodeAudioData.mockRejectedValue(decodeError);

      await expect(
        audioEngineService.loadFile(mockArrayBuffer, mockFileName),
      ).rejects.toThrow(decodeError.message);
      expect(mockPlayerStore.update).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe("play/pause/stop", () => {
    // ... (loadFile setup from above)
    const mockArrayBuffer = new ArrayBuffer(8);
    const mockFileName = "test.wav";
    const mockDecodedBuffer = {
      duration: 1.0,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: vi.fn(() => new Float32Array([0, 0, 0])),
    };

    beforeEach(async () => {
      const initPromise = audioEngineService.initialize({
        sampleRate: 44100,
        channels: 1,
        initialSpeed: 1,
        initialPitch: 0,
      });
      if (mockWorkerInstance.onmessage) {
        mockWorkerInstance.onmessage({
          data: {
            type: RB_WORKER_MSG_TYPE.INIT_SUCCESS,
            messageId: "rb_msg_0",
          },
        } as MessageEvent);
      }
      await initPromise;
      mockAudioContextInstance.decodeAudioData.mockResolvedValue(
        mockDecodedBuffer as unknown as AudioBuffer,
      );
      await audioEngineService.loadFile(mockArrayBuffer, mockFileName); // Load a file so there's something to play
    });

    it("play should start playback and update store", () => {
      audioEngineService.play();
      expect(mockAudioContextInstance.createBufferSource).toHaveBeenCalledTimes(
        1,
      );
      expect(mockBufferSourceNode.start).toHaveBeenCalledTimes(1);
      expect(mockPlayerStore.update).toHaveBeenCalledWith(expect.any(Function));
    });

    it("pause should stop playback (effectively) and update store", () => {
      audioEngineService.play(); // Start playing first
      audioEngineService.pause();
      expect(mockBufferSourceNode.stop).toHaveBeenCalledTimes(1); // Stop is called
      expect(mockPlayerStore.update).toHaveBeenCalledWith(expect.any(Function));
    });

    it("stop should stop playback, reset currentTime and update store", () => {
      audioEngineService.play(); // Start playing first
      audioEngineService.stop();
      // play() calls stop() once, then stop() calls stop() again.
      expect(mockBufferSourceNode.stop).toHaveBeenCalledTimes(2);
      expect(mockPlayerStore.update).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe("dispose", () => {
    it("should terminate the worker and close AudioContext", async () => {
      const initPromise = audioEngineService.initialize({
        sampleRate: 44100,
        channels: 1,
        initialSpeed: 1,
        initialPitch: 0,
      });
      // Simulate worker init success to allow initialize() to complete
      if (mockWorkerInstance.onmessage) {
        mockWorkerInstance.onmessage({
          data: { type: RB_WORKER_MSG_TYPE.INIT_SUCCESS, messageId: "rb_msg_0" },
        } as MessageEvent);
      }
      await initPromise; // Ensure initialization is complete before disposing

      audioEngineService.dispose();
      expect(mockWorkerInstance.terminate).toHaveBeenCalled();
      expect(mockAudioContextInstance.close).toHaveBeenCalled();
      expect(mockPlayerStore.update).toHaveBeenCalledWith(expect.any(Function));
    });
  });
});
