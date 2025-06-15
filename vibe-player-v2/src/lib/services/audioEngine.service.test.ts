// vibe-player-v2/src/lib/services/audioEngine.service.test.ts

import { vi, describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";

vi.resetModules();

import { writable, get, type Writable } from "svelte/store";
import { RB_WORKER_MSG_TYPE } from "$lib/types/worker.types";

// --- START: Mock Declarations ---
const initialPlayerStoreStateForReset = {
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

let storeSingletonRefForTestControl: Writable<typeof initialPlayerStoreStateForReset>;

var mockWorkerObject = {
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((event: ErrorEvent) => void) | null,
};

var mockGainNode = {
  gain: { value: 1, setValueAtTime: vi.fn() },
  connect: vi.fn(),
  disconnect: vi.fn(),
};

var mockAudioContextInstance = {
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
vi.mock("$lib/stores/player.store", () => {
  const factoryInitialState = {
    status: "Initial", fileName: null, duration: 0, currentTime: 0,
    isPlaying: false, isPlayable: false, speed: 1, pitch: 0, gain: 1,
    waveformData: undefined, error: null, audioBuffer: undefined,
    audioContextResumed: false, channels: undefined, sampleRate: undefined,
    lastProcessedChunk: undefined,
  };
  const storeInstance = writable(JSON.parse(JSON.stringify(factoryInitialState)));

  return {
    playerStore: storeInstance,
    _getTestControlledInstance: () => storeInstance
  };
});

vi.mock("$lib/stores/analysis.store", () => ({
  analysisStore: {
    subscribe: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("$lib/workers/rubberband.worker?worker&inline", () => ({
  default: vi.fn(() => ({
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  }))
}));

global.AudioContext = vi.fn(() => mockAudioContextInstance);
// --- END: vi.mock() calls ---


// --- START: Service and Mocked Store Instance Import ---
import audioEngineService from "./audioEngine.service";
import { _getTestControlledInstance as getPlayerStoreTestInstance } from '$lib/stores/player.store';


describe("AudioEngineService", () => {
  beforeAll(() => {
    storeSingletonRefForTestControl = getPlayerStoreTestInstance();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    storeSingletonRefForTestControl.set(JSON.parse(JSON.stringify(initialPlayerStoreStateForReset)));

// --- START of CHANGE ---
// Mock the global fetch API to prevent network errors in the Node.js test environment.
vi.spyOn(global, 'fetch').mockImplementation((url) => {
    // Based on the URL, we can return different mock responses.
    // For this test, both WASM and the loader script can return simple, empty data.
    if (typeof url === 'string' && url.includes('rubberband.wasm')) {
        return Promise.resolve({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)), // Return a dummy ArrayBuffer
        } as Response);
    }
    if (typeof url === 'string' && url.includes('rubberband-loader.js')) {
        return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve('// Mock loader script'), // Return a dummy script text
        } as Response);
    }
    // Fallback for any other fetch calls
    return Promise.reject(new Error(`Unhandled fetch request in test: ${url}`));
});
// --- END of CHANGE ---

    mockWorkerObject.postMessage = vi.fn();
    mockWorkerObject.terminate = vi.fn();
    mockWorkerObject.onmessage = null;
    mockWorkerObject.onerror = null;

    (audioEngineService as any).worker = mockWorkerObject;
    if ((audioEngineService as any).worker) {
      (audioEngineService as any).worker.onmessage = (audioEngineService as any).handleWorkerMessage.bind(audioEngineService);
    }
    (audioEngineService as any).isWorkerInitialized = false;

    mockAudioContextInstance.currentTime = 0;
    mockAudioContextInstance.state = "running";
    mockAudioContextInstance.decodeAudioData.mockReset();
    mockAudioContextInstance.createBufferSource.mockReset().mockImplementation(() => ({
        buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), onended: null,
    }));
    mockAudioContextInstance.createGain.mockReset().mockImplementation(() => mockGainNode);
    mockAudioContextInstance.resume.mockReset().mockResolvedValue(undefined);
    mockAudioContextInstance.close.mockReset().mockResolvedValue(undefined);

    mockGainNode.gain.setValueAtTime.mockClear();
    mockGainNode.connect.mockClear();
    mockGainNode.disconnect.mockClear();
  });

  afterEach(() => {
    audioEngineService.dispose();
    (audioEngineService as any).worker = null;
  });

  it("should decode a file and update the store", async () => {
    const mockArrayBuffer = new ArrayBuffer(8);
    const mockDecodedBuffer = {
      duration: 1.0, numberOfChannels: 1, sampleRate: 44100, getChannelData: vi.fn(() => new Float32Array(1))
    };
    mockAudioContextInstance.decodeAudioData.mockResolvedValue(mockDecodedBuffer as any);

    mockWorkerObject.postMessage.mockImplementation((message: any) => {
      if (message.type === RB_WORKER_MSG_TYPE.INIT) {
        if (mockWorkerObject.onmessage) {
          mockWorkerObject.onmessage({ data: { type: RB_WORKER_MSG_TYPE.INIT_SUCCESS } } as MessageEvent);
        }
      }
    });

    mockWorkerObject.postMessage.mockClear();
    await audioEngineService.loadFile(mockArrayBuffer, "test.wav");

    expect(mockAudioContextInstance.decodeAudioData).toHaveBeenCalledWith(mockArrayBuffer);

    // Explicitly check calls after loadFile
    // loadFile calls stop(), which sends a RESET.
    // The INIT message is now sent by _initializeWorker when the service is initialized,
    // not directly by loadFile.
    expect(mockWorkerObject.postMessage).toHaveBeenCalledTimes(1);
    expect(mockWorkerObject.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: RB_WORKER_MSG_TYPE.RESET })
    );
    // Ensure no INIT call was made *by loadFile* to the mockWorkerObject
    expect(mockWorkerObject.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: RB_WORKER_MSG_TYPE.INIT })
    );

    const finalState = get(storeSingletonRefForTestControl);
    expect(finalState.isPlayable).toBe(true);
    expect(finalState.duration).toBe(1.0);
    expect(finalState.waveformData).toBeDefined();
    expect(finalState.waveformData?.[0].length).toBeGreaterThan(0);
  });

  it("should correctly start the processing loop on play", async () => {
    const mockArrayBuffer = new ArrayBuffer(44100 * 4);
    const mockDecodedBuffer = {
      length: 44100, duration: 1.0, numberOfChannels: 1, sampleRate: 44100,
      getChannelData: vi.fn(() => new Float32Array(44100).fill(0.1)),
    };
    mockAudioContextInstance.decodeAudioData.mockResolvedValue(mockDecodedBuffer as any);

    mockWorkerObject.postMessage.mockImplementation((message: any) => {
      if (message.type === RB_WORKER_MSG_TYPE.INIT) {
         if (mockWorkerObject.onmessage) {
            mockWorkerObject.onmessage({ data: { type: RB_WORKER_MSG_TYPE.INIT_SUCCESS } } as MessageEvent);
        }
      }
    });

    // Simulate that the worker has been initialized via _initializeWorker
    // This would have been called when the service was initialized.
    (audioEngineService as any).isWorkerInitialized = true;

    await audioEngineService.loadFile(mockArrayBuffer, "test.wav");

    // Clear any calls made during loadFile (e.g., the RESET from stop())
    // before checking calls made by play().
    mockWorkerObject.postMessage.mockClear();

    await audioEngineService.play();

    expect(mockWorkerObject.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: RB_WORKER_MSG_TYPE.PROCESS }),
        expect.any(Array)
    );
    const playStoreState = get(storeSingletonRefForTestControl);
    expect(playStoreState.isPlaying).toBe(true);
  });
});
