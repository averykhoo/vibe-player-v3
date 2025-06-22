// vibe-player-v2.3/src/lib/components/Controls.test.ts
import { act, fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import Controls from "./Controls.svelte";
import audioEngineService from "$lib/services/audioEngine.service";
import { get, writable, type Writable } from "svelte/store";
import type { PlayerState } from "$lib/types/player.types";

// Mock the entire module to control the store instance
vi.mock("$lib/stores/player.store", async () => {
  const { writable } =
    await vi.importActual<typeof import("svelte/store")>("svelte/store");
  const initialPlayerStateForMock: PlayerState = {
    /* ... initial state ... */
  }; // Full state here
  const storeInstance = writable(initialPlayerStateForMock);
  return {
    playerStore: storeInstance,
    getMockStore: () => storeInstance, // Helper for tests
    __initialState: initialPlayerStateForMock,
  };
});

vi.mock("$lib/services/audioEngine.service", () => ({
  default: {
    togglePlayPause: vi.fn(),
    stop: vi.fn(),
    setSpeed: vi.fn(),
    setPitch: vi.fn(),
    setGain: vi.fn(),
    jump: vi.fn(), // Added for the new jump functionality
  },
}));

describe("Controls.svelte (Unidirectional)", () => {
  let mockPlayerStore: Writable<PlayerState>;

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const playerStoreModule = await import("$lib/stores/player.store");
    mockPlayerStore = playerStoreModule.getMockStore();
    mockPlayerStore.set({
      status: "idle",
      fileName: "test.wav",
      duration: 10,
      currentTime: 0,
      isPlaying: false,
      isPlayable: false, // Start disabled
      speed: 1.0,
      pitchShift: 0.0,
      gain: 1.0,
    });
  });

  it("calls audioEngine.togglePlayPause() on play/pause button click", async () => {
    render(Controls);
    act(() => {
      mockPlayerStore.update((s) => ({ ...s, isPlayable: true }));
    });

    const playButton = screen.getByRole("button", { name: /Play audio/i });
    await fireEvent.click(playButton);
    expect(audioEngineService.togglePlayPause).toHaveBeenCalledTimes(1);
  });

  it("calls audioEngine.stop() on stop button click", async () => {
    render(Controls);
    act(() => {
      mockPlayerStore.update((s) => ({ ...s, isPlayable: true }));
    });

    const stopButton = screen.getByRole("button", { name: /Stop audio/i });
    await fireEvent.click(stopButton);
    expect(audioEngineService.stop).toHaveBeenCalledTimes(1);
  });

  it("updates UI reactively when playerStore changes", async () => {
    render(Controls);
    const speedSlider =
      screen.getByTestId<HTMLInputElement>("speed-slider-input");
    expect(speedSlider.value).toBe("1");

    act(() => {
      mockPlayerStore.update((s) => ({ ...s, speed: 1.75 }));
    });

    // --- THIS IS THE FIX ---
    // Wait for Svelte to flush the DOM updates before asserting.
    await tick();
    // --- END OF FIX ---

    // Now this assertion will pass because the DOM has been updated.
    expect(speedSlider.value).toBe("1.75");
    expect(screen.getByTestId("speed-value")).toHaveTextContent("Speed: 1.75x");
  });

  it("calls audioEngine.setSpeed with debounce when speed slider is moved", async () => {
    vi.useFakeTimers(); // Enable fake timers for this test
    render(Controls);
    act(() => {
      mockPlayerStore.update((s) => ({ ...s, isPlayable: true }));
    });

    const speedSlider =
      screen.getByTestId<HTMLInputElement>("speed-slider-input");

    // Simulate multiple rapid inputs
    await fireEvent.input(speedSlider, { target: { value: "0.8" } });
    await fireEvent.input(speedSlider, { target: { value: "0.9" } });

    // Assert service has not been called yet
    expect(audioEngineService.setSpeed).not.toHaveBeenCalled();

    // Advance timers past the debounce delay
    await vi.advanceTimersByTimeAsync(150);

    // Assert the service was called once with the latest value
    expect(audioEngineService.setSpeed).toHaveBeenCalledTimes(1);
    expect(audioEngineService.setSpeed).toHaveBeenCalledWith(0.9);
  });

  it("calls audioEngine.setPitch with debounce when pitch slider is moved", async () => {
    vi.useFakeTimers();
    render(Controls);
    act(() => {
      mockPlayerStore.update((s) => ({ ...s, isPlayable: true }));
    });

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
    vi.useFakeTimers();
    render(Controls);
    act(() => {
      mockPlayerStore.update((s) => ({ ...s, isPlayable: true }));
    });

    const gainSlider =
      screen.getByTestId<HTMLInputElement>("gain-slider-input");
    await fireEvent.input(gainSlider, { target: { value: "1.2" } });
    await fireEvent.input(gainSlider, { target: { value: "1.3" } });

    expect(audioEngineService.setGain).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(audioEngineService.setGain).toHaveBeenCalledTimes(1);
    expect(audioEngineService.setGain).toHaveBeenCalledWith(1.3);
  });

  it("disables all controls when not playable", () => {
    render(Controls); // isPlayable is false by default in beforeEach
    expect(screen.getByRole("button", { name: /Play audio/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Stop audio/i })).toBeDisabled();
    expect(screen.getByTestId("speed-slider-input")).toBeDisabled();
    expect(screen.getByTestId("pitch-slider-input")).toBeDisabled();
    expect(screen.getByTestId("gain-slider-input")).toBeDisabled();
  });
});
