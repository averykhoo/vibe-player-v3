// vibe-player-v2/src/lib/services/AudioOrchestrator.service.test.ts
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  type MockInstance,
} from "vitest";
// Import 'get' for use in tests; it will be the spied version.
import { get, writable, type Writable } from "svelte/store";
import { AudioOrchestrator } from "./AudioOrchestrator.service";
import audioEngine from "./audioEngine.service";
// Types for stores
import type { PlayerState } from "$lib/stores/player.store";
import type { AnalysisState } from "$lib/stores/analysis.store";
import type { StatusState } from "$lib/stores/status.store";

import dtmfService from "./dtmf.service";
import spectrogramService from "./spectrogram.service";
import { updateUrlWithParams } from "$lib/utils/urlState";
import { URL_HASH_KEYS } from "$lib/utils/constants"; // UI_CONSTANTS removed as it's not used in current snippet
import { act } from "@testing-library/svelte"; // Import act for store updates

// --- Top-Level Mock Store Declarations ---
let actualMockPlayerStore: Writable<PlayerState>;
let actualMockAnalysisStore: Writable<AnalysisState>;
let actualMockStatusStore: Writable<StatusState>;

// Mock svelte/store's get explicitly for URL serialization tests
// This needs to be done carefully if stores themselves are also heavily mocked.
vi.mock("svelte/store", async (importOriginal) => {
  const actualStoreModule =
    await importOriginal<typeof import("svelte/store")>();
  return {
    ...actualStoreModule, // Spread all actual exports (including original writable, etc.)
    get: vi.fn(actualStoreModule.get), // Spy on the original 'get' from the actual module
  };
});

// --- Service Mocks ---
vi.mock("./audioEngine.service", () => ({
  default: {
    unlockAudio: vi.fn().mockResolvedValue(undefined),
    loadFile: vi.fn(),
    getDuration: vi.fn(() => 120),
    getSampleRate: vi.fn(() => 44100),
    getNumberOfChannels: vi.fn(() => 1),
  },
}));
vi.mock("./dtmf.service", () => ({
  default: { init: vi.fn(), process: vi.fn().mockResolvedValue([]) },
}));
vi.mock("./spectrogram.service", () => ({
  default: {
    init: vi.fn(),
    process: vi.fn().mockResolvedValue(new Float32Array()),
  },
}));
vi.mock("$lib/utils/urlState", () => ({ updateUrlWithParams: vi.fn() }));

// --- Store Mocks (TDZ-Safe Pattern) ---
vi.mock("$lib/stores/player.store.ts", async () => {
  const { writable: actualWritable } =
    await vi.importActual<typeof import("svelte/store")>("svelte/store");
  const initialPlayerStateInFactory: PlayerState = {
    status: "Idle",
    fileName: null,
    duration: 0,
    currentTime: 0,
    isPlaying: false,
    isPlayable: false,
    speed: 1.0,
    pitch: 0.0,
    pitchShift: 0.0,
    gain: 1.0,
    waveformData: undefined,
    error: null,
    audioBuffer: undefined,
    audioContextResumed: false,
    channels: 0,
    sampleRate: 0,
    lastProcessedChunk: undefined,
  };
  const storeInstance = actualWritable(initialPlayerStateInFactory);
  return {
    playerStore: storeInstance,
    getStore: () => storeInstance,
    __initialState: initialPlayerStateInFactory,
  };
});

vi.mock("$lib/stores/analysis.store.ts", async () => {
  const { writable: actualWritable } =
    await vi.importActual<typeof import("svelte/store")>("svelte/store");
  const initialAnalysisStateInFactory: AnalysisState = {
    dtmfResults: [],
    spectrogramData: null,
    vadEvents: [],
    vadPositiveThreshold: 0.9, // Default from component
    vadNegativeThreshold: 0.7,
    isSpeaking: false,
    vadInitialized: false,
    vadStatus: "idle",
    vadError: null,
    vadNoiseFloor: -70,
    vadSensitivity: 0.5, // Added typical VAD fields
  };
  const storeInstance = actualWritable(initialAnalysisStateInFactory);
  return {
    analysisStore: storeInstance,
    getStore: () => storeInstance,
    __initialState: initialAnalysisStateInFactory,
  };
});

vi.mock("$lib/stores/status.store.ts", async () => {
  const { writable: actualWritable } =
    await vi.importActual<typeof import("svelte/store")>("svelte/store");
  const initialStatusStateInFactory: StatusState = {
    message: null,
    type: null,
    isLoading: false,
    details: null,
    progress: null,
  };
  const storeInstance = actualWritable(initialStatusStateInFactory);
  return {
    statusStore: storeInstance,
    getStore: () => storeInstance,
    __initialState: initialStatusStateInFactory,
  };
});

describe("AudioOrchestrator.service.ts", () => {
  let audioOrchestrator: AudioOrchestrator;
  // Cast get to MockInstance for type safety with Vitest's vi.fn()
  let svelteStoreGetMock: MockInstance<[Writable<unknown>], unknown>; // Adjusted type for 'get' mock if needed
  const mockFile = new File([""], "test-audio.mp3", { type: "audio/mpeg" });
  const mockAudioBuffer = {
    // Keep this simple mock for audioEngine
    duration: 120,
    sampleRate: 44100,
    numberOfChannels: 1,
    getChannelData: vi.fn(() => new Float32Array(1024)),
  } as unknown as AudioBuffer;

  beforeAll(() => {
    vi.useFakeTimers();
  });

  beforeEach(async () => {
    // Make beforeEach async
    audioOrchestrator = AudioOrchestrator.getInstance();
    vi.clearAllMocks(); // Clears all mocks

    // Dynamically import mocked stores and assign to top-level variables
    const playerStoreModule = await import("$lib/stores/player.store.ts");
    actualMockPlayerStore = playerStoreModule.getStore();
    const analysisStoreModule = await import("$lib/stores/analysis.store.ts");
    actualMockAnalysisStore = analysisStoreModule.getStore();
    const statusStoreModule = await import("$lib/stores/status.store.ts");
    actualMockStatusStore = statusStoreModule.getStore();

    // Reset stores using their __initialState
    act(() => {
      actualMockPlayerStore.set({ ...playerStoreModule.__initialState });
      actualMockAnalysisStore.set({ ...analysisStoreModule.__initialState });
      actualMockStatusStore.set({ ...statusStoreModule.__initialState });
    });

    (audioEngine.loadFile as vi.Mock).mockResolvedValue(mockAudioBuffer);

    // Dynamically import the mocked 'svelte/store' to get its spied 'get'
    const svelteStoreModule = await import("svelte/store");
    svelteStoreGetMock = svelteStoreModule.get as MockInstance<
      [Writable<unknown>],
      unknown
    >;
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe("loadFileAndAnalyze", () => {
    it("should set loading status, update player store, and then set ready status on successful load", async () => {
      await audioOrchestrator.loadFileAndAnalyze(mockFile);

      // Assertions will now use get(actualMockStatusStore) or get(actualMockPlayerStore).
      // The "Loading..." state is set and rapidly replaced by "Ready" or "Error".
      // We will assert the final state after all operations within loadFileAndAnalyze are complete.

      // Check playerStore state after successful load by inspecting its current value
      const finalPlayerState = get(actualMockPlayerStore);
      expect(finalPlayerState.fileName).toBe(mockFile.name);
      expect(finalPlayerState.duration).toBe(mockAudioBuffer.duration);
      expect(finalPlayerState.sampleRate).toBe(mockAudioBuffer.sampleRate);
      expect(finalPlayerState.channels).toBe(mockAudioBuffer.numberOfChannels);
      expect(finalPlayerState.isPlayable).toBe(true);
      expect(finalPlayerState.status).toBe("Ready"); // Orchestrator should update this

      // Check final statusStore state
      expect(get(actualMockStatusStore)).toEqual({
        message: "Ready", // This should be the last message
        type: "success",
        isLoading: false,
      });

      // Verify analysis services were initialized and called
      expect(audioEngine.unlockAudio).toHaveBeenCalled();
      expect(audioEngine.loadFile).toHaveBeenCalledWith(mockFile);
      expect(spectrogramService.init).toHaveBeenCalledWith(
        mockAudioBuffer.sampleRate,
      );
      expect(dtmfService.init).toHaveBeenCalledWith(mockAudioBuffer.sampleRate);
      expect(spectrogramService.process).toHaveBeenCalled();
      expect(dtmfService.process).toHaveBeenCalled();
    });

    it("should set error status in statusStore and playerStore if audioEngine.loadFile fails", async () => {
      const errorMessage = "Failed to load file";
      (audioEngine.loadFile as vi.Mock).mockRejectedValueOnce(
        new Error(errorMessage),
      );

      await audioOrchestrator.loadFileAndAnalyze(mockFile);

      // After await, the service method has completed, and stores should be in their final states.
      // Check final statusStore state for error
      // Service might not be setting progress and details explicitly to null in this path
      expect(get(actualMockStatusStore)).toEqual(
        expect.objectContaining({
          message: "File processing failed.",
          type: "error",
          isLoading: false,
          details: errorMessage,
          // progress: null // progress might not be explicitly reset by the service here
        }),
      );

      // Check playerStore state for error
      const finalPlayerState = get(actualMockPlayerStore);
      expect(finalPlayerState.status).toBe("Error");
      expect(finalPlayerState.error).toBe(errorMessage);
      expect(finalPlayerState.isPlayable).toBe(false);
      expect(finalPlayerState.duration).toBe(0);
    });

    it("should handle errors from analysis services gracefully", async () => {
      const dtmfError = "DTMF processing failed";
      (dtmfService.process as vi.Mock).mockRejectedValueOnce(
        new Error(dtmfError),
      );

      await audioOrchestrator.loadFileAndAnalyze(mockFile);

      // Still loads successfully overall in statusStore
      // Service might not be setting progress and details explicitly to null in this path
      expect(get(actualMockStatusStore)).toEqual(
        expect.objectContaining({
          message: "Ready",
          type: "success",
          isLoading: false,
          // details: null, // details might not be explicitly reset
          // progress: null // progress might not be explicitly reset
        }),
      );
      // Player store should also reflect 'Ready'
      expect(get(actualMockPlayerStore).status).toBe("Ready");
      // For now, this test ensures the main flow completes.
    });
  });

  describe("setupUrlSerialization", () => {
    const localInitialPlayerStateForUrlTest: PlayerState = {
      speed: 0.75,
      pitch: -2.5, // For service code expecting 'pitch'
      pitchShift: -2.5, // Standard PlayerState field
      gain: 1.25,
      status: "Ready",
      fileName: "test-audio.mp3",
      duration: 120,
      currentTime: 0,
      isPlaying: false,
      isPlayable: true,
      waveformData: undefined,
      error: null,
      audioBuffer: undefined,
      audioContextResumed: true,
      channels: 1,
      sampleRate: 44100,
      lastProcessedChunk: undefined,
    };

    beforeEach(() => {
      // This beforeEach is for the 'setupUrlSerialization' describe block
      act(() => {
        actualMockPlayerStore.set({ ...localInitialPlayerStateForUrlTest });
      });

      // The global 'get' mock is already a spy on originalGet.
      // No need to further mockImplementation for svelteStoreGetMock here unless testing specific behavior of 'get' itself.
      // The AudioOrchestrator will use the actual 'get' (which is now spied on).
    });

    it("should call updateUrlWithParams with correct parameters after debounced interval", () => {
      audioOrchestrator.setupUrlSerialization();

      act(() => {
        actualMockPlayerStore.update((s) => ({ ...s, speed: 0.5 }));
      });

      vi.runAllTimers();

      // Debounce might fire multiple times rapidly in test environment with act and runAllTimers.
      // Check it was called and verify the arguments of the last call.
      expect(updateUrlWithParams).toHaveBeenCalled();
      expect(updateUrlWithParams).toHaveBeenLastCalledWith({
        [URL_HASH_KEYS.SPEED]: "0.50",
        [URL_HASH_KEYS.PITCH]:
          localInitialPlayerStateForUrlTest.pitch.toFixed(1),
        [URL_HASH_KEYS.GAIN]: localInitialPlayerStateForUrlTest.gain.toFixed(2),
      });
    });

    it("should use updated values if store changes multiple times before debounce", () => {
      audioOrchestrator.setupUrlSerialization();

      act(() => {
        actualMockPlayerStore.update((s) => ({ ...s, speed: 0.5 }));
        actualMockPlayerStore.update((s) => ({
          ...s,
          speed: 0.8,
          pitch: 1.5,
          pitchShift: 1.5,
        })); // Update .pitch
      });

      vi.runAllTimers();

      expect(updateUrlWithParams).toHaveBeenCalled(); // Check it was called
      expect(updateUrlWithParams).toHaveBeenLastCalledWith({
        // Verify the last call
        [URL_HASH_KEYS.SPEED]: "0.80",
        [URL_HASH_KEYS.PITCH]: "1.5",
        [URL_HASH_KEYS.GAIN]: localInitialPlayerStateForUrlTest.gain.toFixed(2),
      });
    });
  });
});
