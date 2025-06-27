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
import { get, writable } from "svelte/store";
import { tick } from "svelte";
import type { StatusState } from "$lib/types/status.types";
import type { PlayerState } from "$lib/types/player.types";
import type { AnalysisState } from "$lib/types/analysis.types";

import AudioOrchestratorService from "./AudioOrchestrator.service";
import audioEngine from "./audioEngine.service";
import dtmfService from "./dtmf.service";
import spectrogramService from "./spectrogram.service";
import analysisService from "./analysis.service"; // Import analysis service for mocking

import { playerStore } from "$lib/stores/player.store";
import { timeStore } from "$lib/stores/time.store";
import { statusStore } from "$lib/stores/status.store";
import { analysisStore } from "$lib/stores/analysis.store";
import { updateUrlWithParams } from "$lib/utils/urlState";

// --- START: FIX FOR OfflineAudioContext ---
// Mock OfflineAudioContext because it doesn't exist in the JSDOM test environment.
const mockOfflineAudioContext = vi.fn(() => ({
  createBufferSource: vi.fn(() => ({
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
  })),
  startRendering: vi.fn().mockResolvedValue({
    getChannelData: vi.fn(() => new Float32Array(0)),
  }),
}));
global.OfflineAudioContext = mockOfflineAudioContext as any;
// --- END: FIX FOR OfflineAudioContext ---

// Mock services and external utilities
vi.mock("./audioEngine.service");
vi.mock("./dtmf.service");
vi.mock("./spectrogram.service");
vi.mock("./analysis.service"); // Mock the analysis service as well
vi.mock("$lib/utils/urlState");

vi.mock("$lib/stores/player.store", () => ({
  playerStore: writable<PlayerState>(),
}));
vi.mock("$lib/stores/time.store", () => ({ timeStore: writable<number>(0) }));
vi.mock("$lib/stores/status.store", () => ({
  statusStore: writable<StatusState>(),
}));
vi.mock("$lib/stores/analysis.store", () => ({
  analysisStore: writable<AnalysisState>({
    vadProbabilities: null,
    vadRegions: null,
    vadPositiveThreshold: 0.5,
    vadNegativeThreshold: 0.35,
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
    jumpSeconds: 5,
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

    playerStore.set({ ...initialPlayerState });
    timeStore.set(0);
    statusStore.set({ message: "", type: "idle", isLoading: false });
    analysisStore.set({
        vadProbabilities: null,
        vadRegions: null,
        vadPositiveThreshold: 0.5,
        vadNegativeThreshold: 0.35,
        dtmfResults: [],
        spectrogramData: null,
    });

    vi.mocked(audioEngine.decodeAudioData).mockResolvedValue({
      duration: 10,
      sampleRate: 44100,
      numberOfChannels: 2,
      getChannelData: vi.fn(() => new Float32Array(0)),
    } as unknown as AudioBuffer);
    vi.mocked(audioEngine.initializeWorker).mockResolvedValue(undefined);
    vi.mocked(audioEngine.stop).mockResolvedValue(undefined);
    vi.mocked(audioEngine.unlockAudio).mockResolvedValue(undefined);
    vi.mocked(dtmfService.initialize).mockResolvedValue(undefined);
    vi.mocked(spectrogramService.initialize).mockResolvedValue(undefined);
    vi.mocked(analysisService.initialize).mockResolvedValue(undefined); // Mock VAD init
    vi.mocked(dtmfService.process).mockResolvedValue(undefined);
    vi.mocked(spectrogramService.process).mockResolvedValue(undefined);
    vi.mocked(analysisService.processVad).mockResolvedValue(undefined); // Mock VAD process
    vi.mocked(updateUrlWithParams).mockImplementation(() => {});

    orchestrator = AudioOrchestratorService;
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

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[AO-LOG] Orchestrator is busy, skipping file load.",
    );

    expect(audioEngine.stop).not.toHaveBeenCalled();
    (orchestrator as any).isBusy = false;
  });

  it("should handle a CRITICAL failure if audioEngine.initializeWorker rejects", async () => {
    const criticalError = new Error("Core engine failure");
    vi.mocked(audioEngine.decodeAudioData).mockResolvedValue(mockAudioBuffer);
    vi.mocked(audioEngine.initializeWorker).mockRejectedValue(criticalError);
    vi.mocked(dtmfService.initialize).mockResolvedValue(undefined);
    vi.mocked(spectrogramService.initialize).mockResolvedValue(undefined);
    vi.mocked(analysisService.initialize).mockResolvedValue(undefined); // VAD should not block

    await orchestrator.loadFromFile(mockFile, undefined);
    await tick();

    const finalStatus = get(statusStore);
    expect(finalStatus.type).toBe("error");
    expect(finalStatus.message).toContain(
      "Failed to initialize core audio engine.",
    );
  });

  it("should succeed with a NON-CRITICAL failure if spectrogramService.initialize rejects", async () => {
    vi.mocked(audioEngine.decodeAudioData).mockResolvedValue(mockAudioBuffer);
    vi.mocked(audioEngine.initializeWorker).mockResolvedValue(undefined);
    vi.mocked(dtmfService.initialize).mockResolvedValue(undefined);
    vi.mocked(analysisService.initialize).mockResolvedValue(undefined);
    vi.mocked(spectrogramService.initialize).mockRejectedValue(
      new Error("Spectrogram failed"),
    );

    await orchestrator.loadFromFile(mockFile, undefined);
    await tick();

    const finalPlayerState = get(playerStore);
    expect(finalPlayerState.isPlayable).toBe(true);

    // --- START: FIX for console.warn assertion ---
    // The test now correctly checks for the more specific log message.
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      `[AO-LOG] A non-critical analysis service (Spectrogram) failed to initialize.`,
      expect.any(Error),
    );
    // --- END: FIX ---
  });

  it("should apply initialState and call seek if currentTime is provided", async () => {
    const seekTime = 5.5;
    const initialState: Partial<PlayerState> = {
      speed: 1.5,
      pitchShift: -2,
      gain: 0.75,
      currentTime: seekTime,
    };
    vi.mocked(audioEngine.decodeAudioData).mockResolvedValue(mockAudioBuffer);
    vi.mocked(audioEngine.initializeWorker).mockResolvedValue(undefined);
    vi.mocked(dtmfService.initialize).mockResolvedValue(undefined);
    vi.mocked(spectrogramService.initialize).mockResolvedValue(undefined);
    vi.mocked(analysisService.initialize).mockResolvedValue(undefined);

    await orchestrator.loadFromFile(mockFile, initialState);
    await tick();

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
    vi.mocked(audioEngine.initializeWorker).mockResolvedValue(undefined);
    vi.mocked(dtmfService.initialize).mockResolvedValue(undefined);
    vi.mocked(spectrogramService.initialize).mockResolvedValue(undefined);
    vi.mocked(analysisService.initialize).mockResolvedValue(undefined);
    const unlockAudioSpy = vi
      .mocked(audioEngine.unlockAudio)
      .mockResolvedValue(undefined);

    await orchestrator.loadFromFile(mockFile, undefined);
    await tick();

    expect(unlockAudioSpy).toHaveBeenCalledTimes(1);
  });
});