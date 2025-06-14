// vibe-player-v2/src/lib/services/audioEngine.service.test.ts

import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import { writable, get } from "svelte/store"; // Added 'get' import

// --- START: Mock Declarations (MOVED TO TOP) ---

// Mock the Svelte store instance that the service will interact with.
const initialPlayerStoreState = {
  status: "Initial",
  fileName: null,
  duration: 0,
  currentTime: 0,
  isPlaying: false,
  isPlayable: false,
  speed: 1,
  pitch: 0,
  gain: 1,
  waveformData: undefined,
  error: null,
  audioBuffer: undefined,
  audioContextResumed: false,
  channels: undefined,
  sampleRate: undefined,
  lastProcessedChunk: undefined,
};
const mockPlayerStore = writable(initialPlayerStoreState);

// Mock the Web Worker instance that the service will create.
const mockWorkerInstance = {
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((event: ErrorEvent) => void) | null,
};

// Mock the Web Audio API objects that the service will create.
const mockGainNode = {
  gain: { value: 1, setValueAtTime: vi.fn() },
  connect: vi.fn(),
  disconnect: vi.fn(),
};
const mockAudioContextInstance = {
  decodeAudioData: vi.fn(),
  createBufferSource: vi.fn(() => ({
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
    onended: null,
  })),
  createGain: vi.fn(() => mockGainNode),
  resume: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
  state: "running" as AudioContextState,
  currentTime: 0,
  destination: {},
  sampleRate: 44100,
};
// --- END: Mock Declarations ---


// --- START: vi.mock() calls ---
// Now that the mocks are declared, we can use them in the vi.mock factory functions.

vi.mock("$lib/stores/player.store", () => ({
  playerStore: mockPlayerStore,
}));

vi.mock("$lib/stores/analysis.store", () => ({
  analysisStore: {
    subscribe: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
  },
}));

// This mock for analysis.service.ts was removed as it's not used in the provided test suite
// and could cause issues if not correctly defined or if the path is incorrect.
// vi.mock("$lib/services/analysis.service", () => ({
//   default: {
//     initialize: vi.fn(),
//     startSpectrogramProcessing: vi.fn(),
//   },
// }));

vi.mock("$lib/workers/rubberband.worker?worker&inline", () => ({
  default: vi.fn().mockImplementation(() => mockWorkerInstance),
}));

// We can now assign the mock to the global AudioContext
global.AudioContext = vi.fn(() => mockAudioContextInstance);
// --- END: vi.mock() calls ---


// --- START: Service Import and Test Suite ---
// Import the service *after* all mocks are set up.
import audioEngineService from "./audioEngine.service";
import { RB_WORKER_MSG_TYPE } from "$lib/types/worker.types";

describe("AudioEngineService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to initial state before each test
    mockPlayerStore.set(JSON.parse(JSON.stringify(initialPlayerStoreState)));
    // Reset AudioContext currentTime for consistent tests
    mockAudioContextInstance.currentTime = 0;
    // Reset worker instance mocks
    mockWorkerInstance.postMessage.mockClear();
    mockWorkerInstance.terminate.mockClear();
    mockWorkerInstance.onmessage = null;
    mockWorkerInstance.onerror = null;
    // Reset AudioContext mocks
    mockAudioContextInstance.decodeAudioData.mockClear();
    mockAudioContextInstance.createBufferSource.mockClear();
    mockAudioContextInstance.createGain.mockClear();
    mockAudioContextInstance.resume.mockClear();
    mockAudioContextInstance.close.mockClear();
    mockGainNode.gain.setValueAtTime.mockClear();
    mockGainNode.connect.mockClear();
    mockGainNode.disconnect.mockClear();

  });

  afterEach(() => {
    audioEngineService.dispose();
  });

  // This test was removed as 'initialize' is not a method on AudioEngineService
  // it("should initialize the worker and update store on success", async () => {
  //   const promise = audioEngineService.initialize();
  //
  //   // Simulate worker responding
  //   mockWorkerInstance.onmessage!({ data: { type: RB_WORKER_MSG_TYPE.INIT_SUCCESS } } as MessageEvent);
  //
  //   await promise;
  //
  //   expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
  //       expect.objectContaining({ type: RB_WORKER_MSG_TYPE.INIT })
  //   );
  // });

  it("should decode a file and update the store", async () => {
    const mockArrayBuffer = new ArrayBuffer(8);
    const mockDecodedBuffer = {
      duration: 1.0,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: vi.fn(() => new Float32Array(1))
    };
    mockAudioContextInstance.decodeAudioData.mockResolvedValue(mockDecodedBuffer as any);

    // Ensure worker is marked as initialized before loadFile calls postMessage
    // This happens inside loadFile in the actual code now, so we simulate it.
    // We'll trigger the INIT_SUCCESS after the INIT message is sent by loadFile.
    mockWorkerInstance.postMessage.mockImplementationOnce((message: any) => {
      if (message.type === RB_WORKER_MSG_TYPE.INIT) {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: RB_WORKER_MSG_TYPE.INIT_SUCCESS } } as MessageEvent);
        }
      }
    });

    await audioEngineService.loadFile(mockArrayBuffer, "test.wav");

    expect(mockAudioContextInstance.decodeAudioData).toHaveBeenCalledWith(mockArrayBuffer);

    // Check that INIT message was sent
    expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: RB_WORKER_MSG_TYPE.INIT }),
      undefined // No transferable objects for INIT
    );

    const finalState = get(mockPlayerStore);
    expect(finalState.isPlayable).toBe(true);
    expect(finalState.duration).toBe(1.0);
    expect(finalState.waveformData).toBeDefined();
    expect(finalState.waveformData?.[0].length).toBeGreaterThan(0);
  });

  it("should correctly start the processing loop on play", async () => {
    const mockArrayBuffer = new ArrayBuffer(44100 * 4); // 1 second of audio
    const mockDecodedBuffer = {
      length: 44100,
      duration: 1.0,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: vi.fn(() => new Float32Array(44100).fill(0.1)), // Fill with non-zero data
    };
    mockAudioContextInstance.decodeAudioData.mockResolvedValue(mockDecodedBuffer as any);

    // Simulate worker initialization sequence during loadFile
    mockWorkerInstance.postMessage.mockImplementationOnce((message: any) => {
      if (message.type === RB_WORKER_MSG_TYPE.INIT) {
         if (mockWorkerInstance.onmessage) {
            mockWorkerInstance.onmessage({ data: { type: RB_WORKER_MSG_TYPE.INIT_SUCCESS } } as MessageEvent);
        }
      }
    });

    await audioEngineService.loadFile(mockArrayBuffer, "test.wav");

    // Ensure isPlayable is true and worker is initialized
    const storeState = get(mockPlayerStore);
    expect(storeState.isPlayable).toBe(true);
    // audioEngineService's internal isWorkerInitialized flag should be true
    // We can infer this if play() proceeds to post a PROCESS message.

    await audioEngineService.play();

    // The first call to the loop should post a 'PROCESS' message
    expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: RB_WORKER_MSG_TYPE.PROCESS }),
        expect.any(Array) // for transferable objects
    );
    const playStoreState = get(mockPlayerStore);
    expect(playStoreState.isPlaying).toBe(true);
  });
});
