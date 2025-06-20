// vibe-player-v2.3/src/lib/services/AudioOrchestrator.service.test.ts
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll, // Keep beforeAll for useFakeTimers
  type MockInstance,
} from "vitest";
import { get, writable, type Writable } from "svelte/store";
import { act } from "@testing-library/svelte"; // Import act for store updates

import { AudioOrchestrator } from "./AudioOrchestrator.service";
import type { PlayerState } from "$lib/types/player.types"; // Corrected path if necessary
import type { StatusState } from "$lib/types/status.types";   // Corrected path if necessary
import type { AnalysisState } from "$lib/types/analysis.types"; // Corrected path if necessary
import { URL_HASH_KEYS, UI_CONSTANTS } from "$lib/utils/constants"; // UI_CONSTANTS needed for debounce

// --- Mocking Services ---
// Updated audioEngine.service mock
const mockAudioEngineService = {
  unlockAudio: vi.fn().mockResolvedValue(undefined),
  decodeAudioData: vi.fn(), // Changed from loadFile
  initializeWorker: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(), // Added
  play: vi.fn(), // Keep other methods if they might be called indirectly or by future tests
  pause: vi.fn(),
  seek: vi.fn(),
  setSpeed: vi.fn(),
  setPitch: vi.fn(),
  setGain: vi.fn(),
  dispose: vi.fn(),
  // handleError: vi.fn(), // Removed as per plan, unless orchestrator calls it on engine
};
vi.mock("$lib/services/audioEngine.service", () => ({
  default: mockAudioEngineService,
}));

const mockDtmfService = {
  initialize: vi.fn(),
  process: vi.fn().mockResolvedValue([]),
  dispose: vi.fn(), // Keep dispose if used in other tests or setup
};
vi.mock("$lib/services/dtmf.service", () => ({ default: mockDtmfService }));

const mockSpectrogramService = {
  initialize: vi.fn(),
  process: vi.fn().mockResolvedValue(new Float32Array()),
  dispose: vi.fn(), // Keep dispose
};
vi.mock("$lib/services/spectrogram.service", () => ({ default: mockSpectrogramService }));

// analysis.service mock can remain if other parts of orchestrator use it.
// If not, it could be removed. For now, keeping it as plan didn't specify removal.
const mockAnalysisService = {
  processWithVAD: vi.fn().mockResolvedValue({ voicedSegments: [], noiseProfile: [], error: null }),
  dispose: vi.fn(),
};
vi.mock("$lib/services/analysis.service", () => ({ default: mockAnalysisService }));

// --- Mocking Stores ---
let actualWritableSingleton: typeof import("svelte/store").writable; // To ensure same writable is used

// Player Store - Updated initial state
const initialPlayerStateInFactory: PlayerState = {
  status: 'idle',
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
let mockPlayerStoreInstance: Writable<PlayerState>;
vi.mock("$lib/stores/player.store.ts", async () => {
  const { writable: actualWritableImport } = await vi.importActual<typeof import("svelte/store")>("svelte/store");
  if (!actualWritableSingleton) actualWritableSingleton = actualWritableImport;
  mockPlayerStoreInstance = actualWritableSingleton(initialPlayerStateInFactory);
  return { playerStore: mockPlayerStoreInstance, getStore: () => mockPlayerStoreInstance, __initialState: initialPlayerStateInFactory };
});

// Status Store - Assuming initial state is fine as per existing or simple default
const initialStatusStateInFactory: StatusState = {
  isLoading: false,
  message: "", // Or null as per original
  type: "idle",  // Or null
  progress: null,
  details: undefined, // Or null
};
let mockStatusStoreInstance: Writable<StatusState>;
vi.mock("$lib/stores/status.store.ts", async () => {
  const { writable: actualWritableImport } = await vi.importActual<typeof import("svelte/store")>("svelte/store");
  if (!actualWritableSingleton) actualWritableSingleton = actualWritableImport;
  mockStatusStoreInstance = actualWritableSingleton(initialStatusStateInFactory);
  return { statusStore: mockStatusStoreInstance, getStore: () => mockStatusStoreInstance, __initialState: initialStatusStateInFactory };
});

// Analysis Store - Assuming initial state is fine
const initialAnalysisStateInFactory: AnalysisState = {
  dtmfResults: [],
  spectrogramData: null,
  // vadResults: undefined, // These were in existing file, remove if not in type
  // vadPositiveThreshold: 0.6,
  // vadNegativeThreshold: 0.3,
};
let mockAnalysisStoreInstance: Writable<AnalysisState>;
vi.mock("$lib/stores/analysis.store.ts", async () => {
  const { writable: actualWritableImport } = await vi.importActual<typeof import("svelte/store")>("svelte/store");
  if (!actualWritableSingleton) actualWritableSingleton = actualWritableImport;
  mockAnalysisStoreInstance = actualWritableSingleton(initialAnalysisStateInFactory);
  return { analysisStore: mockAnalysisStoreInstance, getStore: () => mockAnalysisStoreInstance, __initialState: initialAnalysisStateInFactory };
});

// Added time.store.ts mock
vi.mock("$lib/stores/time.store.ts", async () => {
  const { writable: actualWritableImport } = await vi.importActual<typeof import("svelte/store")>("svelte/store");
  if (!actualWritableSingleton) actualWritableSingleton = actualWritableImport;
  const storeInstance = actualWritableSingleton(0);
  return { timeStore: storeInstance, getStore: () => storeInstance, __initialState: 0 };
});

// --- Mocking Utils ---
const mockUpdateUrlWithParams = vi.fn();
vi.mock("$lib/utils/urlState", () => ({
  updateUrlWithParams: mockUpdateUrlWithParams,
}));

// --- Test Suite ---
describe("AudioOrchestrator.service.ts", () => {
  let audioOrchestrator: AudioOrchestrator;
  let actualMockPlayerStore: Writable<PlayerState>;
  let actualMockStatusStore: Writable<StatusState>;
  let actualMockAnalysisStore: Writable<AnalysisState>;
  let actualMockTimeStore: Writable<number>; // Added

  const mockFile = new File(["dummy audio data"], "test-audio.mp3", { type: "audio/mpeg" });
  const mockArrayBuffer = new ArrayBuffer(8);
  const mockDecodedAudioBuffer = {
    duration: 120,
    sampleRate: 44100,
    numberOfChannels: 2, // Keep consistent with playerStore.channels if possible
    getChannelData: vi.fn().mockReturnValue(new Float32Array()),
  } as unknown as AudioBuffer;

  beforeAll(() => { // Keep for useFakeTimers
    vi.useFakeTimers();
  });

  beforeEach(async () => {
    // Get actual store instances
    const playerStoreModule = await import("$lib/stores/player.store.ts");
    actualMockPlayerStore = playerStoreModule.getStore();
    act(() => { actualMockPlayerStore.set(playerStoreModule.__initialState); });

    const statusStoreModule = await import("$lib/stores/status.store.ts");
    actualMockStatusStore = statusStoreModule.getStore();
    act(() => { actualMockStatusStore.set(statusStoreModule.__initialState); });

    const analysisStoreModule = await import("$lib/stores/analysis.store.ts");
    actualMockAnalysisStore = analysisStoreModule.getStore();
    act(() => { actualMockAnalysisStore.set(analysisStoreModule.__initialState); });

    // Added for timeStore
    const timeStoreModule = await import("$lib/stores/time.store.ts");
    actualMockTimeStore = timeStoreModule.getStore();
    act(() => { actualMockTimeStore.set(timeStoreModule.__initialState); });

    vi.clearAllMocks();

    // Mock specific service method implementations for general cases
    // Removed audioEngine.loadFile mock
    mockAudioEngineService.decodeAudioData.mockResolvedValue(mockDecodedAudioBuffer); // Default success
    mockAudioEngineService.unlockAudio.mockResolvedValue(undefined);
    mockAudioEngineService.initializeWorker.mockResolvedValue(undefined); // Default success
    mockAudioEngineService.stop.mockReset(); // Reset stop mock

    audioOrchestrator = AudioOrchestrator.getInstance();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers(); // Or vi.runAllTimers();
    vi.useRealTimers(); // Restore real timers
    vi.resetModules();
  });

  it("should be a singleton", () => {
    const instance1 = AudioOrchestrator.getInstance();
    const instance2 = AudioOrchestrator.getInstance();
    expect(instance1).toBe(instance2);
  });

  describe("loadFileAndAnalyze", () => {
    beforeEach(() => {
      (mockFile.arrayBuffer as vi.Mock) = vi.fn().mockResolvedValue(mockArrayBuffer);
    });

    // Refactored success test
    it("should set loading states, decode, init worker, update stores, run analysis, call URL update, and set ready state on success", async () => {
      const statusStoreSetSpy = vi.spyOn(actualMockStatusStore, "set");
      // Player store is updated, not set directly for the final state.
      const playerStoreUpdateSpy = vi.spyOn(actualMockPlayerStore, "update");
      const timeStoreSetSpy = vi.spyOn(actualMockTimeStore, "set");


      await audioOrchestrator.loadFileAndAnalyze(mockFile);

      expect(statusStoreSetSpy).toHaveBeenCalledWith(expect.objectContaining({ message: `Loading ${mockFile.name}...`, type: "info", isLoading: true }));
      expect(statusStoreSetSpy).toHaveBeenCalledWith(expect.objectContaining({ message: "Decoding audio...", type: "info", isLoading: true }));
      expect(statusStoreSetSpy).toHaveBeenCalledWith(expect.objectContaining({ message: "Initializing audio engine...", type: "info", isLoading: true }));
      expect(statusStoreSetSpy).toHaveBeenCalledWith(expect.objectContaining({ isLoading: false, message: "Ready", type: "success" }));

      expect(mockAudioEngineService.stop).toHaveBeenCalledOnce();
      expect(mockAudioEngineService.unlockAudio).toHaveBeenCalledOnce();
      expect(mockFile.arrayBuffer).toHaveBeenCalledOnce();
      expect(mockAudioEngineService.decodeAudioData).toHaveBeenCalledWith(mockArrayBuffer);
      expect(mockAudioEngineService.initializeWorker).toHaveBeenCalledWith(mockDecodedAudioBuffer);

      const finalPlayerState = get(actualMockPlayerStore);
      expect(finalPlayerState.fileName).toBe(mockFile.name);
      expect(finalPlayerState.duration).toBe(mockDecodedAudioBuffer.duration);
      expect(finalPlayerState.sampleRate).toBe(mockDecodedAudioBuffer.sampleRate);
      expect(finalPlayerState.isPlayable).toBe(true);
      expect(finalPlayerState.audioBuffer).toBe(mockDecodedAudioBuffer);
      expect(finalPlayerState.currentTime).toBe(0);
      expect(finalPlayerState.error).toBeNull();
      // No assertion for playerStore.status as it's not in the target PlayerState

      expect(timeStoreSetSpy).toHaveBeenCalledWith(0); // Check timeStore reset

      expect(mockDtmfService.initialize).toHaveBeenCalledWith(mockDecodedAudioBuffer.sampleRate);
      expect(mockSpectrogramService.initialize).toHaveBeenCalledWith({ sampleRate: mockDecodedAudioBuffer.sampleRate });
      expect(mockDtmfService.process).toHaveBeenCalledWith(mockDecodedAudioBuffer);
      expect(mockSpectrogramService.process).toHaveBeenCalledWith(expect.any(Float32Array));

      expect(updateUrlWithParams).toHaveBeenCalled();
    });

    // New failure test for decodeAudioData
    it("should set error status if decodeAudioData fails", async () => {
      const decodeError = new Error("Simulated decode error");
      mockAudioEngineService.decodeAudioData.mockRejectedValueOnce(decodeError);

      await audioOrchestrator.loadFileAndAnalyze(mockFile);

      expect(get(actualMockStatusStore)).toEqual(expect.objectContaining({
        message: `Failed to load file: ${decodeError.message}`,
        type: 'error',
        isLoading: false,
      }));
      expect(get(actualMockPlayerStore)).toEqual(expect.objectContaining({
        error: decodeError.message,
        isPlayable: false,
      }));
    });

    // New failure test for initializeWorker
    it("should set error status if initializeWorker fails", async () => {
      const workerError = new Error("Simulated worker init error");
      mockAudioEngineService.initializeWorker.mockRejectedValueOnce(workerError);

      await audioOrchestrator.loadFileAndAnalyze(mockFile);

      expect(get(actualMockStatusStore)).toEqual(expect.objectContaining({
        message: `Failed to load file: ${workerError.message}`,
        type: 'error',
        isLoading: false,
      }));
      expect(get(actualMockPlayerStore)).toEqual(expect.objectContaining({
        error: workerError.message,
        isPlayable: false,
      }));
    });

    // Keeping re-entrancy test from existing file as plan didn't say to remove
     it("should prevent re-entrancy if already busy", async () => {
        let releaseFirstCall: () => void;
        const firstCallPromise = new Promise<void>(resolve => { releaseFirstCall = resolve; });
        // Mock decodeAudioData for the re-entrancy test
        mockAudioEngineService.decodeAudioData.mockImplementationOnce(async () => {
            await firstCallPromise;
            return mockDecodedAudioBuffer;
        });

        const firstLoadPromise = audioOrchestrator.loadFileAndAnalyze(mockFile);

        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        await audioOrchestrator.loadFileAndAnalyze(mockFile);

        expect(consoleWarnSpy).toHaveBeenCalledWith(
            "AudioOrchestrator is busy, skipping loadFileAndAnalyze for:",
            mockFile.name
        );

        releaseFirstCall!();
        await firstLoadPromise;
        consoleWarnSpy.mockRestore();
    });
  });

  describe("setupUrlSerialization", () => {
    const initialTimeForUrlTest = 0; // Defined in describe block
    // Updated localInitialPlayerStateForUrlTest
    const localInitialPlayerStateForUrlTest: PlayerState = {
      status: 'idle',
      fileName: "test-audio.mp3",
      duration: 120,
      currentTime: 0, // This specific field isn't used by orchestrator for URL, timeStore is
      isPlaying: false,
      isPlayable: true, // Ensure isPlayable for TIME to be included
      speed: 0.75,
      pitchShift: -2.5,
      gain: 1.25,
      waveformData: undefined,
      error: null,
      audioBuffer: undefined,
      audioContextResumed: true,
      channels: undefined,
      sampleRate: 44100,
      lastProcessedChunk: undefined,
    };

    beforeEach(() => {
      act(() => {
        actualMockPlayerStore.set(localInitialPlayerStateForUrlTest);
        actualMockTimeStore.set(initialTimeForUrlTest); // Set timeStore in beforeEach
      });
      vi.clearAllMocks(); // Clear mocks, especially updateUrlWithParams
    });

    it("should call updateUrlWithParams with fileName, speed, pitch, gain but not time if time is 0 and isPlayable is true", () => {
      act(() => { actualMockTimeStore.set(0); }); // Ensure time is 0
      audioOrchestrator.setupUrlSerialization();
      act(() => {
          actualMockPlayerStore.update(s => ({ ...s, speed: 0.5, isPlayable: true }));
      });
      vi.runAllTimers(); // Uses UI_CONSTANTS.DEBOUNCE_HASH_UPDATE_MS from AudioOrchestrator

      expect(updateUrlWithParams).toHaveBeenLastCalledWith({
          [URL_HASH_KEYS.FILE_NAME]: encodeURIComponent(localInitialPlayerStateForUrlTest.fileName!),
          [URL_HASH_KEYS.SPEED]: "0.50",
          [URL_HASH_KEYS.PITCH]: localInitialPlayerStateForUrlTest.pitchShift.toFixed(2),
          [URL_HASH_KEYS.GAIN]: localInitialPlayerStateForUrlTest.gain.toFixed(2),
      });
       const lastCallArgs = (updateUrlWithParams as vi.Mock).mock.lastCall[0];
       expect(lastCallArgs).not.toHaveProperty(URL_HASH_KEYS.TIME);
    });

    it("should include TIME in URL if timeStore > 0.1 and player is playable", () => {
      const testTime = 15.5;
      act(() => { actualMockTimeStore.set(testTime); });
      audioOrchestrator.setupUrlSerialization();
      act(() => {
          actualMockPlayerStore.update(s => ({ ...s, isPlayable: true }));
      });
      vi.runAllTimers();

      expect(updateUrlWithParams).toHaveBeenLastCalledWith(
          expect.objectContaining({
              [URL_HASH_KEYS.FILE_NAME]: encodeURIComponent(localInitialPlayerStateForUrlTest.fileName!),
              [URL_HASH_KEYS.TIME]: testTime.toFixed(2),
              [URL_HASH_KEYS.SPEED]: localInitialPlayerStateForUrlTest.speed.toFixed(2),
              [URL_HASH_KEYS.PITCH]: localInitialPlayerStateForUrlTest.pitchShift.toFixed(2),
              [URL_HASH_KEYS.GAIN]: localInitialPlayerStateForUrlTest.gain.toFixed(2),
          })
      );
    });

    it("should not include TIME if player is not playable, even if timeStore > 0.1", () => {
        act(() => {
            actualMockTimeStore.set(15.5); // Set a time that would normally be included
            actualMockPlayerStore.update(s => ({ ...s, isPlayable: false })); // Make player not playable
        });
        audioOrchestrator.setupUrlSerialization();
        act(() => {
            actualMockPlayerStore.update(s => ({ ...s, speed: 0.9 })); // Trigger an update
        });
        vi.runAllTimers();

        const lastCallArgs = (updateUrlWithParams as vi.Mock).mock.lastCall[0];
        expect(lastCallArgs).not.toHaveProperty(URL_HASH_KEYS.TIME);
        expect(lastCallArgs[URL_HASH_KEYS.SPEED]).toBe("0.90"); // Ensure other params are there
    });

    it("should not include optional params if they are at default values (speed 1.0, pitchShift 0.0, gain 1.0)", () => {
        const testTime = 20.5; // A non-zero time to ensure TIME is included if playable
        act(() => {
            actualMockTimeStore.set(testTime);
            actualMockPlayerStore.update(s => ({
                ...s,
                speed: 1.0, // Default
                pitchShift: 0.0, // Default
                gain: 1.0, // Default
                isPlayable: true,
            }));
        });
        audioOrchestrator.setupUrlSerialization();
         act(() => {
            actualMockPlayerStore.update(s => ({ ...s, duration: 121 })); // Trigger update
        });
        vi.runAllTimers();

        expect(updateUrlWithParams).toHaveBeenLastCalledWith({
            [URL_HASH_KEYS.FILE_NAME]: encodeURIComponent(localInitialPlayerStateForUrlTest.fileName!),
            [URL_HASH_KEYS.TIME]: testTime.toFixed(2),
            // SPEED, PITCH, GAIN should not be present
        });
        const lastCallArgs = (updateUrlWithParams as vi.Mock).mock.lastCall[0];
        expect(lastCallArgs).not.toHaveProperty(URL_HASH_KEYS.SPEED);
        expect(lastCallArgs).not.toHaveProperty(URL_HASH_KEYS.PITCH);
        expect(lastCallArgs).not.toHaveProperty(URL_HASH_KEYS.GAIN);
    });
  });

  describe("handleError", () => {
    it("should update statusStore and playerStore correctly, and stop audio engine", () => {
      const testError = new Error("Test worker error");
      audioOrchestrator.handleError(testError);

      const statusState = get(actualMockStatusStore);
      expect(statusState.message).toBe(`Error: ${testError.message}`);
      expect(statusState.type).toBe("error");
      expect(statusState.isLoading).toBe(false);

      const playerState = get(actualMockPlayerStore);
      expect(playerState.error).toBe(testError.message);
      expect(playerState.isPlaying).toBe(false);
      expect(playerState.isPlayable).toBe(false);

      expect(mockAudioEngineService.stop).toHaveBeenCalledOnce();
    });
  });
});
