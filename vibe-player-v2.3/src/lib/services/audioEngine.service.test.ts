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
vi.mock("$lib/stores/player.store");
vi.mock("$lib/stores/time.store");
vi.mock("./AudioOrchestrator.service");
vi.mock("$lib/workers/rubberband.worker?worker&inline");

describe("AudioEngineService (Robust Loop)", () => {
  let engine: typeof AudioEngineService;
  let mockPlayerStore: ReturnType<typeof writable<PlayerState>>;
  let mockTimeStore: ReturnType<typeof writable<number>>;
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

    mockPlayerStore = writable({
      isPlayable: true,
      isPlaying: false,
      duration: 10.0,
      speed: 1.0,
      pitchShift: 0.0,
      // ... other initial state properties
    } as PlayerState);
    (playerStore as any) = mockPlayerStore;

    mockTimeStore = writable(0);
    (timeStore as any) = mockTimeStore;

    mockOrchestrator = { handleError: vi.fn(), updateUrlFromState: vi.fn() };
    (AudioOrchestrator.getInstance as vi.Mock).mockReturnValue(
      mockOrchestrator,
    );

    mockWorker = { postMessage: vi.fn(), terminate: vi.fn() };
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

    engine = AudioEngineService;
    (engine as any).originalBuffer = mockAudioBuffer;
    (engine as any).isWorkerReady = true;
    (engine as any).isPlaying = false;
    (engine as any).sourcePlaybackOffset = 0;
    // (engine as any).audioContext = null; // Let _getAudioContext create it
    (engine as any)._getAudioContext(); // Call it to ensure context and gainNode are created on the instance
    // We will still override engine.audioContext with mockAudioContext in specific tests if needed for timing control etc.
  });

  it("play() should start the animation loop", async () => {
    await engine.play();
    expect(get(mockPlayerStore).isPlaying).toBe(true);
    expect(requestAnimationFrame).toHaveBeenCalledWith(expect.any(Function));
  });

  it("pause() should stop the animation loop", () => {
    (engine as any).isPlaying = true; // ADDED: Set isPlaying to true
    (engine as any).animationFrameId = 123;
    engine.pause();
    expect(get(mockPlayerStore).isPlaying).toBe(false);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(123);
  });

  it("_recursiveProcessAndPlayLoop should update timeStore and call iteration", () => {
    const iterationSpy = vi
      .spyOn(engine as any, "_performSingleProcessAndPlayIteration")
      .mockImplementation(() => {});
    (engine as any).isPlaying = true;
    (engine as any).sourcePlaybackOffset = 5.0;
    (engine as any).audioContext = mockAudioContext; // ADDED: Ensure audioContext is set for potential deeper calls

    // Manually trigger one frame
    (engine as any)._recursiveProcessAndPlayLoop();

    expect(get(mockTimeStore)).toBe(5.0);
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
