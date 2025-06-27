// vibe-player-v2.3/src/lib/components/Controls.test.ts
import { act, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import Controls from "./Controls.svelte";
import audioEngineService from "$lib/services/audioEngine.service";
import { get, writable, type Writable } from "svelte/store";
import type { PlayerState } from "$lib/types/player.types";

import type { AnalysisState } from "$lib/types/analysis.types";

// Mock playerStore
vi.mock("$lib/stores/player.store", async () => {
  const { writable } =
    await vi.importActual<typeof import("svelte/store")>("svelte/store");
  const initialPlayerStateForMock: PlayerState = {
    status: "idle",
    fileName: "test.wav",
    duration: 100,
    currentTime: 0,
    isPlaying: false,
    isPlayable: true,
    speed: 1.0,
    pitchShift: 0.0,
    gain: 1.0,
    jumpSeconds: 5, // Added for jump controls
    // Ensure all required fields from PlayerState are here
  };
  const storeInstance = writable(initialPlayerStateForMock);
  return {
    playerStore: storeInstance,
    getMockStore: () => storeInstance,
    __initialState: initialPlayerStateForMock,
  };
});

// Mock analysisStore
vi.mock("$lib/stores/analysis.store", async () => {
  const { writable } =
    await vi.importActual<typeof import("svelte/store")>("svelte/store");
  const initialAnalysisStateForMock: AnalysisState = {
    vadPositiveThreshold: 0.8,
    vadNegativeThreshold: 0.2,
    vadProbabilities: null,
    vadRegions: null,
    vadStatus: undefined,
    lastVadResult: null,
    isSpeaking: undefined,
    vadStateResetted: undefined,
    vadError: null,
    vadInitialized: false,
    spectrogramStatus: undefined,
    spectrogramError: null,
    spectrogramData: null,
    spectrogramInitialized: false,
    isLoading: false,
  };
  const storeInstance = writable(initialAnalysisStateForMock);
  return {
    analysisStore: storeInstance,
    getMockAnalysisStore: () => storeInstance,
    __initialAnalysisState: initialAnalysisStateForMock,
  };
});

vi.mock("$lib/services/audioEngine.service", () => ({
  default: {
    togglePlayPause: vi.fn(),
    stop: vi.fn(),
    setSpeed: vi.fn(),
    setPitch: vi.fn(),
    setGain: vi.fn(),
    jump: vi.fn(),
  },
}));

// Mock analysisService
vi.mock("$lib/services/analysis.service", () => ({
  default: {
    recalculateVadRegions: vi.fn(),
  },
}));

describe("Controls.svelte", () => {
  let mockPlayerStore: Writable<PlayerState>;
  let mockAnalysisStore: Writable<AnalysisState>;
  let initialPlayerState: PlayerState;
  // let initialAnalysisState: AnalysisState; // No longer needed as VAD controls are removed
  // let analysisService: typeof import("$lib/services/analysis.service").default; // No longer needed

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    const playerStoreModule = await import("$lib/stores/player.store");
    mockPlayerStore = playerStoreModule.getMockStore();
    initialPlayerState = JSON.parse(
      JSON.stringify(playerStoreModule.__initialState),
    );
    mockPlayerStore.set({ ...initialPlayerState, isPlayable: false });

    const analysisStoreModule = await import("$lib/stores/analysis.store");
    mockAnalysisStore = analysisStoreModule.getMockAnalysisStore();
    // initialAnalysisState = JSON.parse( // No longer needed
    //   JSON.stringify(analysisStoreModule.__initialAnalysisState),
    // );
    mockAnalysisStore.set({ ...analysisStoreModule.__initialAnalysisState });

    // const analysisServiceModule = await import( // No longer needed
    //   "$lib/services/analysis.service"
    // );
    // analysisService = analysisServiceModule.default;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("calls audioEngine.togglePlayPause() on play/pause button click", async () => {
    render(Controls);
    act(() => {
      mockPlayerStore.update((s) => ({ ...s, isPlayable: true }));
    });
    await tick();

    const playButton = screen.getByRole("button", { name: /Play audio/i });
    await fireEvent.click(playButton);
    expect(audioEngineService.togglePlayPause).toHaveBeenCalledTimes(1);
  });

  it("calls audioEngine.stop() on stop button click", async () => {
    render(Controls);
    act(() => {
      mockPlayerStore.update((s) => ({
        ...s,
        isPlayable: true,
        isPlaying: true,
      }));
    });
    await tick();

    const stopButton = screen.getByRole("button", { name: /Stop audio/i });
    await fireEvent.click(stopButton);
    expect(audioEngineService.stop).toHaveBeenCalledTimes(1);
  });

  // Removed tests for speed, pitch, gain, and VAD sliders as they are not in the new Controls.svelte

  it("disables all controls when not playable", async () => {
    act(() => {
      mockPlayerStore.set({ ...initialPlayerState, isPlayable: false });
    });
    render(Controls);
    await tick();

    expect(screen.getByRole("button", { name: /Play audio/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Stop audio/i })).toBeDisabled();
    // expect(screen.getByTestId("speed-slider-input")).toBeDisabled(); // Removed as per VIBE-392 changes
    // expect(screen.getByTestId("pitch-slider-input")).toBeDisabled(); // Removed as per VIBE-392 changes
    // expect(screen.getByTestId("gain-slider-input")).toBeDisabled(); // Removed as per VIBE-392 changes
    // expect(screen.getByTestId("vad-positive-slider-input")).toBeDisabled(); // Removed as per VIBE-392 changes
    // expect(screen.getByTestId("vad-negative-slider-input")).toBeDisabled(); // Removed as per VIBE-392 changes
    expect(screen.getByRole("button", { name: /Jump back/i })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Jump forward/i }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Jump duration in seconds")).toBeDisabled();
  });

  it("enables stop button even if not playable but is playing (e.g. during an error state change)", async () => {
    act(() => {
      mockPlayerStore.set({
        ...initialPlayerState,
        isPlayable: false,
        isPlaying: true,
      });
    });
    render(Controls);
    await tick();
    expect(
      screen.getByRole("button", { name: /Stop audio/i }),
    ).not.toBeDisabled();
  });

  // Jump Controls tests remain as they are relevant to the new functionality
  describe("Jump Controls", () => {
    beforeEach(async () => {
      act(() => {
        mockPlayerStore.update((s) => ({ ...s, isPlayable: true }));
      });
      render(Controls);
      await tick();
    });

    it("calls audioEngine.jump(-1) when the back button is clicked", async () => {
      const backButton = screen.getByRole("button", { name: /Jump back/i });
      await fireEvent.click(backButton);
      expect(audioEngineService.jump).toHaveBeenCalledWith(-1);
    });

    it("calls audioEngine.jump(1) when the forward button is clicked", async () => {
      const forwardButton = screen.getByRole("button", { name: /Jump forward/i });
      await fireEvent.click(forwardButton);
      expect(audioEngineService.jump).toHaveBeenCalledWith(1);
    });

    it("updates the playerStore when the jump duration input is changed", async () => {
      const jumpInput = screen.getByLabelText("Jump duration in seconds");

      await fireEvent.input(jumpInput, { target: { value: "10" } });
      await tick();

      const storeState = get(mockPlayerStore);
      expect(storeState.jumpSeconds).toBe(10);
    });
  });
});
