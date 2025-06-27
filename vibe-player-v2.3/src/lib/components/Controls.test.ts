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
    vadProbabilities: null, // Required by AnalysisState
    vadRegions: null, // Required by AnalysisState
    // Add other non-optional fields from AnalysisState with default/mock values
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
    getMockAnalysisStore: () => storeInstance, // Helper for tests
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
  },
}));

// Mock analysisService
vi.mock("$lib/services/analysis.service", () => ({
  default: {
    recalculateVadRegions: vi.fn(),
    // Mock other methods if Controls.svelte starts using them
  },
}));

describe("Controls.svelte", () => {
  let mockPlayerStore: Writable<PlayerState>;
  let mockAnalysisStore: Writable<AnalysisState>; // Updated type
  let initialPlayerState: PlayerState;
  let initialAnalysisState: AnalysisState; // Updated type
  let analysisService: typeof import("$lib/services/analysis.service").default;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers(); // Use fake timers for all tests in this suite for debounce

    const playerStoreModule = await import("$lib/stores/player.store");
    mockPlayerStore = playerStoreModule.getMockStore();
    initialPlayerState = JSON.parse(
      JSON.stringify(playerStoreModule.__initialState),
    ); // Deep copy
    mockPlayerStore.set({ ...initialPlayerState, isPlayable: false }); // Start disabled for some tests

    const analysisStoreModule = await import("$lib/stores/analysis.store");
    mockAnalysisStore = analysisStoreModule.getMockAnalysisStore();
    initialAnalysisState = JSON.parse(
      JSON.stringify(analysisStoreModule.__initialAnalysisState),
    ); // Deep copy
    mockAnalysisStore.set({ ...initialAnalysisState });

    // Import the mocked analysisService
    const analysisServiceModule = await import(
      "$lib/services/analysis.service"
    );
    analysisService = analysisServiceModule.default;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers(); // Clear any pending timers
    vi.useRealTimers(); // Restore real timers
  });

  it("calls audioEngine.togglePlayPause() on play/pause button click", async () => {
    render(Controls);
    act(() => {
      mockPlayerStore.update((s) => ({ ...s, isPlayable: true }));
    });
    await tick(); // allow component to react to store change

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
      })); // Stop button is enabled if playing
    });
    await tick();

    const stopButton = screen.getByRole("button", { name: /Stop audio/i });
    await fireEvent.click(stopButton);
    expect(audioEngineService.stop).toHaveBeenCalledTimes(1);
  });

  it("updates UI reactively when playerStore changes for speed, pitch, gain", async () => {
    render(Controls);
    const speedSlider =
      screen.getByTestId<HTMLInputElement>("speed-slider-input");
    const pitchSlider =
      screen.getByTestId<HTMLInputElement>("pitch-slider-input");
    const gainSlider =
      screen.getByTestId<HTMLInputElement>("gain-slider-input");

    expect(speedSlider.value).toBe(initialPlayerState.speed.toString());
    expect(pitchSlider.value).toBe(initialPlayerState.pitchShift.toString());
    expect(gainSlider.value).toBe(initialPlayerState.gain.toString());

    act(() => {
      mockPlayerStore.update((s) => ({
        ...s,
        speed: 1.75,
        pitchShift: 5.5,
        gain: 0.5,
      }));
    });
    await tick();

    expect(speedSlider.value).toBe("1.75");
    expect(screen.getByTestId("speed-value")).toHaveTextContent("Speed: 1.75x");
    expect(pitchSlider.value).toBe("5.5");
    expect(screen.getByTestId("pitch-value")).toHaveTextContent(
      "Pitch: 5.5 semitones",
    );
    expect(gainSlider.value).toBe("0.5");
    expect(screen.getByTestId("gain-value")).toHaveTextContent("Gain: 0.50");
  });

  it("updates VAD UI reactively when analysisStore changes", async () => {
    render(Controls);
    const vadPositiveSlider = screen.getByTestId<HTMLInputElement>(
      "vad-positive-slider-input",
    );
    const vadNegativeSlider = screen.getByTestId<HTMLInputElement>(
      "vad-negative-slider-input",
    );

    expect(vadPositiveSlider.value).toBe(
      initialAnalysisState.vadPositiveThreshold.toString(),
    );
    expect(vadNegativeSlider.value).toBe(
      initialAnalysisState.vadNegativeThreshold.toString(),
    );

    act(() => {
      mockAnalysisStore.update((s) => ({
        ...s,
        vadPositiveThreshold: 0.95,
        vadNegativeThreshold: 0.15,
      }));
    });
    await tick();

    expect(vadPositiveSlider.value).toBe("0.95");
    expect(screen.getByTestId("vad-positive-value")).toHaveTextContent(
      "VAD Positive Threshold: 0.95",
    );
    expect(vadNegativeSlider.value).toBe("0.15");
    expect(screen.getByTestId("vad-negative-value")).toHaveTextContent(
      "VAD Negative Threshold: 0.15",
    );
  });

  it("calls audioEngine.setSpeed with debounce when speed slider is moved", async () => {
    render(Controls);
    act(() => {
      mockPlayerStore.update((s) => ({ ...s, isPlayable: true }));
    });
    await tick();
    const speedSlider =
      screen.getByTestId<HTMLInputElement>("speed-slider-input");

    await fireEvent.input(speedSlider, { target: { value: "0.8" } });
    await fireEvent.input(speedSlider, { target: { value: "0.9" } });
    expect(audioEngineService.setSpeed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(audioEngineService.setSpeed).toHaveBeenCalledTimes(1);
    expect(audioEngineService.setSpeed).toHaveBeenCalledWith(0.9);
  });

  it("calls audioEngine.setPitch with debounce when pitch slider is moved", async () => {
    render(Controls);
    act(() => {
      mockPlayerStore.update((s) => ({ ...s, isPlayable: true }));
    });
    await tick();
    const pitchSlider =
      screen.getByTestId<HTMLInputElement>("pitch-slider-input");
    await fireEvent.input(pitchSlider, { target: { value: "-5" } });
    await fireEvent.input(pitchSlider, { target: { value: "-6" } });
    expect(audioEngineService.setPitch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(audioEngineService.setPitch).toHaveBeenCalledTimes(1);
    expect(audioEngineService.setPitch).toHaveBeenCalledWith(-6);
  });

  it("calls audioEngine.setGain with debounce when gain slider is moved", async () => {
    render(Controls);
    act(() => {
      mockPlayerStore.update((s) => ({ ...s, isPlayable: true }));
    });
    await tick();
    const gainSlider =
      screen.getByTestId<HTMLInputElement>("gain-slider-input");
    await fireEvent.input(gainSlider, { target: { value: "1.2" } });
    await fireEvent.input(gainSlider, { target: { value: "1.3" } });
    expect(audioEngineService.setGain).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(audioEngineService.setGain).toHaveBeenCalledTimes(1);
    expect(audioEngineService.setGain).toHaveBeenCalledWith(1.3);
  });

  it("updates analysisStore with debounce when VAD positive threshold slider is moved", async () => {
    render(Controls);
    act(() => {
      mockPlayerStore.update((s) => ({ ...s, isPlayable: true }));
    });
    await tick();
    const vadPositiveSlider = screen.getByTestId<HTMLInputElement>(
      "vad-positive-slider-input",
    );

    await fireEvent.input(vadPositiveSlider, { target: { value: "0.7" } });
    await fireEvent.input(vadPositiveSlider, { target: { value: "0.75" } });

    const initialStoreValue = get(mockAnalysisStore).vadPositiveThreshold;
    expect(get(mockAnalysisStore).vadPositiveThreshold).toBe(initialStoreValue); // Not updated yet

    await vi.advanceTimersByTimeAsync(250); // VAD debounce is 250ms

    expect(get(mockAnalysisStore).vadPositiveThreshold).toBe(0.75);
    expect(get(mockAnalysisStore).vadNegativeThreshold).toBe(
      initialAnalysisState.vadNegativeThreshold,
    ); // Ensure other value didn't change
    expect(analysisService.recalculateVadRegions).toHaveBeenCalled();
  });

  it("updates analysisStore and calls recalculateVadRegions when VAD negative threshold slider is moved", async () => {
    render(Controls);
    act(() => {
      mockPlayerStore.update((s) => ({ ...s, isPlayable: true }));
    });
    await tick();
    const vadNegativeSlider = screen.getByTestId<HTMLInputElement>(
      "vad-negative-slider-input",
    );

    await fireEvent.input(vadNegativeSlider, { target: { value: "0.3" } });
    await fireEvent.input(vadNegativeSlider, { target: { value: "0.35" } });

    const initialStoreValue = get(mockAnalysisStore).vadNegativeThreshold;
    expect(get(mockAnalysisStore).vadNegativeThreshold).toBe(initialStoreValue); // Not updated yet

    await vi.advanceTimersByTimeAsync(250); // VAD debounce is 250ms

    expect(get(mockAnalysisStore).vadNegativeThreshold).toBe(0.35);
    expect(get(mockAnalysisStore).vadPositiveThreshold).toBe(
      initialAnalysisState.vadPositiveThreshold,
    ); // Ensure other value didn't change
    expect(analysisService.recalculateVadRegions).toHaveBeenCalled();
  });

  it("disables all controls when not playable", async () => {
    act(() => {
      mockPlayerStore.set({ ...initialPlayerState, isPlayable: false });
    });
    render(Controls);
    await tick();

    expect(screen.getByRole("button", { name: /Play audio/i })).toBeDisabled();
    // Stop button is disabled if not playable AND not currently playing.
    // If it was playing and became not playable (e.g. file error), it should still be stoppable.
    // For this test, isPlaying is false by default in initialPlayerState or set so.
    expect(screen.getByRole("button", { name: /Stop audio/i })).toBeDisabled();
    expect(screen.getByTestId("speed-slider-input")).toBeDisabled();
    expect(screen.getByTestId("pitch-slider-input")).toBeDisabled();
    expect(screen.getByTestId("gain-slider-input")).toBeDisabled();
    expect(screen.getByTestId("vad-positive-slider-input")).toBeDisabled();
    expect(screen.getByTestId("vad-negative-slider-input")).toBeDisabled();
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
});
