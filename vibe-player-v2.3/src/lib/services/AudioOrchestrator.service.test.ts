// vibe-player-v2.3/src/lib/services/AudioOrchestrator.service.test.ts
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
import AudioOrchestratorService from "./AudioOrchestrator.service";
import audioEngine from "./audioEngine.service";
import dtmfService from "./dtmf.service";
import spectrogramService from "./spectrogram.service";
import { playerStore } from "$lib/stores/player.store";
import { timeStore } from "$lib/stores/time.store";
import { statusStore } from "$lib/stores/status.store";
import { analysisStore } from "$lib/stores/analysis.store";
import * as urlState from "$lib/utils/urlState";
import { URL_HASH_KEYS } from "$lib/utils/constants";
import { tick } from "svelte"; // --- FIX: Import tick ---

// Mock services and stores
vi.mock("./audioEngine.service", () => ({
  default: {
    decodeAudioData: vi.fn(),
    initializeWorker: vi.fn(),
    stop: vi.fn(),
    unlockAudio: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn(),
  },
}));

vi.mock("./dtmf.service", () => ({
  default: {
    initialize: vi.fn(),
    process: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("./spectrogram.service", () => ({
  default: {
    initialize: vi.fn(),
    process: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("$lib/stores/player.store");
vi.mock("$lib/stores/time.store");
vi.mock("$lib/stores/status.store");
vi.mock("$lib/stores/analysis.store");
vi.mock("$lib/utils/urlState");

describe("AudioOrchestratorService", () => {
  let orchestrator: typeof AudioOrchestratorService;
  let statusStoreSpy: SpyInstance;
  let playerStoreSpy: SpyInstance;
  
  beforeEach(() => {
    vi.clearAllMocks();

    if (!File.prototype.arrayBuffer) {
      File.prototype.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(100));
    }

    vi.mocked(playerStore).set({
      status: "idle", fileName: null, duration: 0, currentTime: 0,
      isPlaying: false, isPlayable: false, speed: 1.0, pitchShift: 0.0, gain: 1.0,
      waveformData: undefined, error: null, audioBuffer: undefined, audioContextResumed: false,
      channels: undefined, sampleRate: undefined, lastProcessedChunk: undefined,
    });
    vi.mocked(timeStore).set(0);
    vi.mocked(statusStore).set({ message: "", type: "idle", isLoading: false });
    vi.mocked(analysisStore).set({ dtmfResults: [], spectrogramData: null });

    statusStoreSpy = vi.spyOn(statusStore, "set");
    playerStoreSpy = vi.spyOn(playerStore, "update");
    
    orchestrator = AudioOrchestratorService;
  });

  const mockFile = new File([new ArrayBuffer(100)], "test.mp3", { type: "audio/mp3" });
  const mockAudioBuffer = {
    duration: 10, sampleRate: 44100, numberOfChannels: 2,
    getChannelData: vi.fn(() => new Float32Array(0)),
  } as unknown as AudioBuffer;

  it("should not proceed if isBusy is true", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    (orchestrator as any).isBusy = true;

    await orchestrator.loadFileAndAnalyze(mockFile, undefined);
    
    // --- FIX: Update assertion to match new log message ---
    expect(consoleWarnSpy).toHaveBeenCalledWith("[Orchestrator] Orchestrator is busy, skipping file load.");
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
    expect(finalStatus.message).toContain("Failed to initialize core audio engine.");
    // --- END OF FIX ---
  });

  it("should succeed with a NON-CRITICAL failure if spectrogramService.initialize rejects", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(audioEngine.decodeAudioData).mockResolvedValue(mockAudioBuffer);
    vi.mocked(audioEngine.initializeWorker).mockResolvedValue(undefined);
    vi.mocked(spectrogramService.initialize).mockRejectedValue(new Error("Spectrogram failed"));

    await orchestrator.loadFileAndAnalyze(mockFile, undefined);
    await tick(); // --- FIX: Wait for async updates ---

    const finalPlayerState = get(playerStore);
    // --- FIX: Check the final state correctly ---
    expect(finalPlayerState.isPlayable).toBe(true);
    // --- END OF FIX ---
    
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("NON-CRITICAL FAILURE: Spectrogram service could not initialize."),
      expect.any(Error)
    );
    consoleWarnSpy.mockRestore();
  });

  it("should apply initialState and call seek if currentTime is provided", async () => {
    const seekTime = 5.5;
    const initialState = { speed: 1.5, pitchShift: -2, gain: 0.75, currentTime: seekTime };
    vi.mocked(audioEngine.decodeAudioData).mockResolvedValue(mockAudioBuffer);

    await orchestrator.loadFileAndAnalyze(mockFile, initialState);
    await tick(); // --- FIX: Wait for async updates from state application ---

    const finalPlayerState = get(playerStore);
    // --- FIX: Check the final state correctly ---
    expect(finalPlayerState.speed).toBe(initialState.speed);
    // --- END OF FIX ---
    
    expect(audioEngine.seek).toHaveBeenCalledTimes(1);
    expect(audioEngine.seek).toHaveBeenCalledWith(seekTime);
  });
});