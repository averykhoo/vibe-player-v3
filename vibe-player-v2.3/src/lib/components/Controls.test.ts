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
  },
}));

describe("Controls.svelte (Unidirectional)", () => {
  let mockPlayerStore: Writable<PlayerState>;

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

  it("calls audioEngine.setSpeed when speed slider is moved", async () => {
    render(Controls);
    act(() => {
      mockPlayerStore.update((s) => ({ ...s, isPlayable: true }));
    });

    const speedSlider =
      screen.getByTestId<HTMLInputElement>("speed-slider-input");
    await fireEvent.input(speedSlider, { target: { value: "0.8" } });

    expect(audioEngineService.setSpeed).toHaveBeenCalledWith(0.8);
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
