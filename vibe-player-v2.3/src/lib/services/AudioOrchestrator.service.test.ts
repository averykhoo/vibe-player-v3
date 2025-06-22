// vibe-player-v2.3/src/lib/services/AudioOrchestrator.service.test.ts

import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type SpyInstance,
} from "vitest";
// --- FIX: Import 'get', 'writable', 'tick' and type definitions ---
import { get, writable } from "svelte/store";
import { tick } from "svelte";
import type { StatusState } from "$lib/types/status.types";
import type { PlayerState } from "$lib/types/player.types";
import type { AnalysisState } from "$lib/types/analysis.types";

import AudioOrchestratorService from "./AudioOrchestrator.service";
import audioEngine from "./audioEngine.service";
import dtmfService from "./dtmf.service";
import spectrogramService from "./spectrogram.service";

// --- FIX: Directly import the stores to be mocked ---
import { playerStore } from "$lib/stores/player.store";
import { timeStore } from "$lib/stores/time.store";
import { statusStore } from "$lib/stores/status.store";
import { analysisStore } from "$lib/stores/analysis.store";
import * as urlState from "$lib/utils/urlState";

// Mock services and external utilities
vi.mock("./audioEngine.service");
vi.mock("./dtmf.service");
vi.mock("./spectrogram.service");
vi.mock("$lib/utils/urlState");

// --- FIX: Replace simple vi.mock() with mocks that provide real writable stores ---
vi.mock("$lib/stores/player.store", () => ({
  playerStore: writable<PlayerState>(),
}));
vi.mock("$lib/stores/time.store", () => ({ timeStore: writable<number>(0) }));
vi.mock("$lib/stores/status.store", () => ({
  statusStore: writable<StatusState>(),
}));
vi.mock("$lib/stores/analysis.store", () => ({
  analysisStore: writable<AnalysisState>({
    dtmfResults: [],
    spectrogramData: null,
  }),
}));

describe("AudioOrchestratorService", () => {
  let orchestrator: typeof AudioOrchestratorService;

  const initialPlayerState: PlayerState = {
    status: "idle",
    fileName: null,
    duration: 0,
    currentTime: 0,
    isPlaying: false,
    isPlayable: false,
    speed: 1.0,
    pitchShift: 0.0,
    gain: 1.0,
    waveformData: undefined,
    error: null,
    audioBuffer: undefined,
    audioContextResumed: false,
    channels: undefined,
    sampleRate: undefined,
    lastProcessedChunk: undefined,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    if (!File.prototype.arrayBuffer) {
      File.prototype.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new ArrayBuffer(100));
    }

    // --- FIX: Reset the actual store instances before each test ---
    vi.mocked(playerStore).set(initialPlayerState);
    vi.mocked(timeStore).set(0);
    vi.mocked(statusStore).set({ message: "", type: "idle", isLoading: false });
    vi.mocked(analysisStore).set({ dtmfResults: [], spectrogramData: null });

    // --- FIX: Re-mock service methods that might have been cleared ---
    vi.mocked(audioEngine.decodeAudioData).mockReset();
    vi.mocked(audioEngine.initializeWorker).mockReset();
    vi.mocked(audioEngine.stop).mockReset();
    vi.mocked(audioEngine.unlockAudio).mockReset(); // Added for the new test
    vi.mocked(spectrogramService.initialize).mockReset();

    orchestrator = AudioOrchestratorService;
  });

  const mockFile = new File([new ArrayBuffer(100)], "test.mp3", {
    type: "audio/mp3",
  });
  const mockAudioBuffer = {
    duration: 10,
    sampleRate: 44100,
    numberOfChannels: 2,
    getChannelData: vi.fn(() => new Float32Array(0)),
  } as unknown as AudioBuffer;

  it("should not proceed if isBusy is true", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    (orchestrator as any).isBusy = true;

    await orchestrator.loadFileAndAnalyze(mockFile, undefined);

    // --- FIX: Update assertion to match new log message ---
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[Orchestrator] Orchestrator is busy, skipping file load.",
    );
    // --- END OF FIX ---

    expect(audioEngine.stop).not.toHaveBeenCalled();
    (orchestrator as any).isBusy = false;
    consoleWarnSpy.mockRestore();
  });

  it("should handle a CRITICAL failure if audioEngine.initializeWorker rejects", async () => {
    const criticalError = new Error("Core engine failure");
    vi.mocked(audioEngine.decodeAudioData).mockResolvedValue(mockAudioBuffer);
    vi.mocked(audioEngine.initializeWorker).mockRejectedValue(criticalError);

    await orchestrator.loadFileAndAnalyze(mockFile, undefined);
    await tick(); // --- FIX: Wait for async error handling ---

    const finalStatus = get(statusStore);
    // --- FIX: Check the final status correctly ---
    expect(finalStatus.type).toBe("error");
    expect(finalStatus.message).toContain(
      "Failed to initialize core audio engine.",
    );
    // --- END OF FIX ---
  });

  it("should succeed with a NON-CRITICAL failure if spectrogramService.initialize rejects", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    vi.mocked(audioEngine.decodeAudioData).mockResolvedValue(mockAudioBuffer);
    vi.mocked(audioEngine.initializeWorker).mockResolvedValue(undefined);
    vi.mocked(spectrogramService.initialize).mockRejectedValue(
      new Error("Spectrogram failed"),
    );

    await orchestrator.loadFileAndAnalyze(mockFile, undefined);

    // Wait for the asynchronous error handling to complete and stores to update
    await tick();

    // Assert against the store's value directly
    const finalPlayerState = get(playerStore);
    expect(finalPlayerState.isPlayable).toBe(true);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "NON-CRITICAL FAILURE: Spectrogram service could not initialize.",
      ),
      expect.any(Error),
    );
    consoleWarnSpy.mockRestore();
  });

  it("should apply initialState and call seek if currentTime is provided", async () => {
    const seekTime = 5.5;
    const initialState = {
      speed: 1.5,
      pitchShift: -2,
      gain: 0.75,
      currentTime: seekTime,
    };
    vi.mocked(audioEngine.decodeAudioData).mockResolvedValue(mockAudioBuffer);

    await orchestrator.loadFileAndAnalyze(mockFile, initialState);

    // Wait for the asynchronous error handling to complete and stores to update
    await tick();

    // Assert against the store's value directly
    const finalPlayerState = get(playerStore);
    expect(finalPlayerState.speed).toBe(initialState.speed);
    expect(finalPlayerState.pitchShift).toBe(initialState.pitchShift);
    expect(finalPlayerState.gain).toBe(initialState.gain);
    expect(finalPlayerState.currentTime).toBe(initialState.currentTime);

    expect(audioEngine.seek).toHaveBeenCalledTimes(1);
    expect(audioEngine.seek).toHaveBeenCalledWith(seekTime);
  });

  it("should call audioEngine.unlockAudio (non-awaited) during loadFileAndAnalyze", async () => {
    vi.mocked(audioEngine.decodeAudioData).mockResolvedValue(mockAudioBuffer);
    vi.mocked(audioEngine.initializeWorker).mockResolvedValue(undefined); // Ensure other critical parts resolve
    vi.mocked(dtmfService.initialize).mockResolvedValue(undefined);
    vi.mocked(spectrogramService.initialize).mockResolvedValue(undefined);
    // Spy on unlockAudio but let it resolve normally (as it's fire-and-forget)
    const unlockAudioSpy = vi
      .mocked(audioEngine.unlockAudio)
      .mockImplementation(() => Promise.resolve());

    // We don't await loadFileAndAnalyze fully if we are testing a non-awaited call within it,
    // but we need to ensure the call to unlockAudio happens.
    // The nature of not awaiting means we can't easily sequence it with await tick()
    // against the *end* of loadFileAndAnalyze if unlockAudio itself is async.
    // However, since unlockAudio is called early in stage 1, we can check it directly.

    orchestrator.loadFileAndAnalyze(mockFile, undefined); // Fire off the method

    // Since unlockAudio is called synchronously (the promise it returns is not awaited),
    // it should have been called by the time loadFileAndAnalyze returns (or shortly after).
    // Vitest's mock tracking should capture this.
    // We might need a very short tick if there's any microtask queueing before it.
    await tick(); // Allow any immediate microtasks to clear

    expect(unlockAudioSpy).toHaveBeenCalledTimes(1);

    // To be absolutely sure the test doesn't hang if loadFileAndAnalyze has an issue,
    // we can await it here, after the specific check for unlockAudio.
    await vi.mocked(audioEngine.decodeAudioData).mock.results[0]?.value; // wait for decode
    await vi.mocked(audioEngine.initializeWorker).mock.results[0]?.value; // wait for worker init
  });
});
