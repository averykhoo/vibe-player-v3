// vibe-player-v2/src/lib/services/audioEngine.service.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { playerStore } from "$lib/stores/player.store";
import audioEngineService from "./audioEngine.service";
import { RB_WORKER_MSG_TYPE } from "$lib/types/worker.types";
import RubberbandWorker from "$lib/workers/rubberband.worker?worker&inline";
// writable is imported dynamically below
// import { writable } from 'svelte/store';

// --- Mocks ---

// Mock playerStore with an actual writable store
vi.mock("$lib/stores/player.store", async () => {
  const { writable } = await import("svelte/store"); // Dynamically import writable
  const initialMockPlayerStateInsideFactory = {
    // Define state inside factory
    speed: 1.0,
    pitch: 0.0,
    isPlayable: false,
    error: null,
    fileName: "",
    status: "",
    duration: 0,
    audioBuffer: null,
    waveformData: [],
    currentTime: 0,
    gain: 1.0,
    sampleRate: 44100,
  };
  const mockPlayerStoreInstance = writable(initialMockPlayerStateInsideFactory);
  return {
    playerStore: mockPlayerStoreInstance,
  };
});

vi.mock("$lib/workers/rubberband.worker?worker&inline");

const mockWorkerInstance = {
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
};

vi.mocked(RubberbandWorker).mockImplementation(
  () => mockWorkerInstance as unknown as Worker,
);

// Store the mock function so we can target it directly in tests
const mockDecodeAudioData = vi.fn();

global.AudioContext = vi.fn(() => ({
  decodeAudioData: mockDecodeAudioData, // Use the stored mock function
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

vi.spyOn(global, "fetch").mockImplementation((url) => {
  return Promise.resolve({
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    text: () => Promise.resolve("// Mock loader script"),
  } as Response);
});
// --- End Mocks ---

describe("AudioEngineService (Refactored)", () => {
  beforeEach(() => {
    vi.useFakeTimers(); // Use fake timers for RAF
    vi.clearAllMocks();
    // Reset the Svelte store to its initial state before each test
    // playerStore.set is not available directly on the vi.mocked import,
    // we need to import the actual instance if we want to .set() it here.
    // For now, the factory mock re-initializes it.
    // If tests need to modify then reset, we'd need direct access to mockPlayerStoreInstance.
    // Resetting the service's internal state
    audioEngineService.dispose();
  });

  afterEach(() => {
    vi.useRealTimers(); // Restore real timers
  });

  it("loadFile should initialize the worker with correct audio parameters", async () => {
    const mockArrayBuffer = new ArrayBuffer(8);
    const mockDecodedBuffer = {
      duration: 1.0,
      numberOfChannels: 1, // <-- Test with MONO
      sampleRate: 44100,
      getChannelData: vi.fn(() => new Float32Array(1)),
    };
    mockDecodeAudioData.mockResolvedValue(mockDecodedBuffer as any);

    // Act
    await audioEngineService.loadFile(mockArrayBuffer, "test-mono.wav");

    // Assert: Worker should have been created
    expect(RubberbandWorker).toHaveBeenCalledTimes(1);

    // Assert: INIT message was sent with the CORRECT parameters from the decoded buffer
    expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: RB_WORKER_MSG_TYPE.INIT,
        payload: expect.objectContaining({
          channels: 1, // <-- Crucial check
          sampleRate: 44100, // <-- Crucial check
        }),
      }),
      expect.any(Array), // for the transferable wasmBinary
    );
  });

  it("play should only work after the worker confirms initialization", async () => {
    const mockArrayBuffer = new ArrayBuffer(8);
    const mockDecodedBuffer = {
      duration: 1.0,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: vi.fn(() => new Float32Array(44100).fill(0.1)),
      length: 44100,
    };
    mockDecodeAudioData.mockResolvedValue(mockDecodedBuffer as any);

    // Act 1: Load the file, which sends the INIT message
    await audioEngineService.loadFile(mockArrayBuffer, "test.wav");

    // Assert 1: Playback is not yet possible because worker hasn't responded
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await audioEngineService.play();
    expect(console.warn).toHaveBeenCalledWith(
      "AudioEngine: Play command ignored. Not ready or already playing.",
    );
    expect(mockWorkerInstance.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: RB_WORKER_MSG_TYPE.PROCESS }),
    );
    vi.mocked(console.warn).mockRestore();

    // Act 2: Simulate the worker responding that it's ready
    mockWorkerInstance.onmessage!({
      data: { type: RB_WORKER_MSG_TYPE.INIT_SUCCESS },
    } as MessageEvent);

    // Assert 2: The store should now be updated to be playable
    // To check this, we need to get the actual instance of the mock store used by the service.
    // This requires importing it if the mock factory is self-contained.
    // For now, we rely on the fact that playerStore.update was called.
    // A more robust check would be:
    // import { playerStore as actualPlayerStore } from '$lib/stores/player.store'; // Get the mocked instance
    // expect(get(actualPlayerStore).isPlayable).toBe(true);
    // This currently might fail if the test setup doesn't re-export playerStore correctly for direct import.
    // The mock setup above makes playerStore available.
    expect(get(playerStore).isPlayable).toBe(true);

    // Act 3: Now, play should work
    await audioEngineService.play();

    // vi.advanceTimersByTime(100); // This should no longer be needed due to synchronous first iteration.

    // Assert 3: A PROCESS message should have been sent
    expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: RB_WORKER_MSG_TYPE.PROCESS }),
      expect.any(Array),
    );
  });
});
