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
import { updateUrlWithParams } from "$lib/utils/urlState"; // Corrected import

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
  let consoleWarnSpy: SpyInstance;
  let consoleErrorSpy: SpyInstance;

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
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    if (!File.prototype.arrayBuffer) {
      File.prototype.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new ArrayBuffer(100));
    }

    // --- FIX: Reset the actual store instances before each test ---
    playerStore.set({ ...initialPlayerState });
    timeStore.set(0);
    statusStore.set({ message: "", type: "idle", isLoading: false });
    analysisStore.set({ dtmfResults: [], spectrogramData: null });

    // --- FIX: Re-mock service methods that might have been cleared ---
    vi.mocked(audioEngine.decodeAudioData).mockResolvedValue({
      duration: 10,
      sampleRate: 44100,
      numberOfChannels: 2,
      getChannelData: vi.fn(() => new Float32Array(0)),
    } as unknown as AudioBuffer);
    vi.mocked(audioEngine.initializeWorker).mockResolvedValue(undefined);
    vi.mocked(audioEngine.stop).mockResolvedValue(undefined);
    vi.mocked(audioEngine.unlockAudio).mockResolvedValue(undefined); // Added for the new test
    vi.mocked(dtmfService.initialize).mockResolvedValue(undefined);
    vi.mocked(spectrogramService.initialize).mockResolvedValue(undefined);
    vi.mocked(dtmfService.process).mockResolvedValue(undefined);
    vi.mocked(spectrogramService.process).mockResolvedValue(undefined);
    vi.mocked(updateUrlWithParams).mockImplementation(() => {});

    orchestrator = AudioOrchestratorService;
    // Reset internal state of the singleton if necessary, or re-instantiate
    // For simplicity here, we'll assume the singleton nature is handled or reset if needed by tests.
    // AudioOrchestratorService.reset(); // Hypothetical reset method
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
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
    (orchestrator as any).isBusy = true;

    await orchestrator.loadFromFile(mockFile, undefined);

    // --- FIX: Update assertion to match new log message ---
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[AO-LOG] Orchestrator is busy, skipping file load.",
    );
    // --- END OF FIX ---

    expect(audioEngine.stop).not.toHaveBeenCalled();
    (orchestrator as any).isBusy = false; // Reset for other tests
  });

  it("should handle a CRITICAL failure if audioEngine.initializeWorker rejects", async () => {
    const criticalError = new Error("Core engine failure");
    vi.mocked(audioEngine.decodeAudioData).mockResolvedValue(mockAudioBuffer);
    vi.mocked(audioEngine.initializeWorker).mockRejectedValue(criticalError);
    // Ensure other service initializations are mocked if they might be called before the error
    vi.mocked(dtmfService.initialize).mockResolvedValue(undefined);
    vi.mocked(spectrogramService.initialize).mockResolvedValue(undefined);

    await orchestrator.loadFromFile(mockFile, undefined);
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
    vi.mocked(audioEngine.decodeAudioData).mockResolvedValue(mockAudioBuffer);
    vi.mocked(audioEngine.initializeWorker).mockResolvedValue(undefined);
    vi.mocked(dtmfService.initialize).mockResolvedValue(undefined); // Ensure DTMF service resolves
    vi.mocked(spectrogramService.initialize).mockRejectedValue(
      new Error("Spectrogram failed"),
    );

    await orchestrator.loadFromFile(mockFile, undefined);
    await tick();

    const finalPlayerState = get(playerStore);
    expect(finalPlayerState.isPlayable).toBe(true); // Should still be playable

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      `A non-critical analysis service failed to initialize.`,
      expect.any(Error),
    );
  });

  it("should apply initialState and call seek if currentTime is provided", async () => {
    const seekTime = 5.5;
    const initialState: Partial<PlayerState> = {
      // Ensure initialState type matches Partial<PlayerState>
      speed: 1.5,
      pitchShift: -2,
      gain: 0.75,
      currentTime: seekTime,
    };
    vi.mocked(audioEngine.decodeAudioData).mockResolvedValue(mockAudioBuffer);
    vi.mocked(audioEngine.initializeWorker).mockResolvedValue(undefined);
    vi.mocked(dtmfService.initialize).mockResolvedValue(undefined);
    vi.mocked(spectrogramService.initialize).mockResolvedValue(undefined);

    await orchestrator.loadFromFile(mockFile, initialState);
    await tick(); // Ensure all promises resolve and state updates complete

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
    const unlockAudioSpy = vi
      .mocked(audioEngine.unlockAudio)
      .mockResolvedValue(undefined); // Mock it to resolve immediately

    await orchestrator.loadFromFile(mockFile, undefined);
    await tick(); // Allow any immediate microtasks to clear

    expect(unlockAudioSpy).toHaveBeenCalledTimes(1);
  });
});
