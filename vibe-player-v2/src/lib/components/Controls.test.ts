// vibe-player-v2/src/lib/components/Controls.test.ts
import { act, fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Controls from "./Controls.svelte";
import audioEngineService from "$lib/services/audioEngine.service";
import { get, writable, type Writable } from "svelte/store"; // Import writable directly

// --- True Store Mocks ---
// Create actual writable stores for testing
const initialPlayerState = {
  speed: 1.0,
  pitch: 0.0,
  gain: 1.0,
  isPlaying: false,
  isPlayable: false,
  duration: 100, // For seek slider if it were part of this
  currentTime: 0, // For seek slider
  // other properties if Controls depends on them via $playerStore.
};
let mockPlayerStore: Writable<typeof initialPlayerState>;

const initialAnalysisState = {
  vadPositiveThreshold: 0.5,
  vadNegativeThreshold: 0.35,
  // other properties if Controls depends on them via $analysisStore.
};
let mockAnalysisStore: Writable<typeof initialAnalysisState>;


vi.mock("$lib/stores/player.store", async () => {
  // This factory is called once when the module is imported.
  // We create the store here and then can access it in tests.
  const { writable: actualWritable } = await vi.importActual<typeof import("svelte/store")>("svelte/store");
  mockPlayerStore = actualWritable(initialPlayerState); // Initialize with default
  return { playerStore: mockPlayerStore };
});

vi.mock("$lib/stores/analysis.store", async () => {
  const { writable: actualWritable } = await vi.importActual<typeof import("svelte/store")>("svelte/store");
  mockAnalysisStore = actualWritable(initialAnalysisState);
  return { analysisStore: mockAnalysisStore };
});

vi.mock("$lib/services/audioEngine.service", () => ({
  default: {
    // No need for unlockAudio, initialize, dispose in Controls unit tests
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    setSpeed: vi.fn(),
    setPitch: vi.fn(),
    setGain: vi.fn(),
    // seek: vi.fn(), // If seek controls were part of this component directly
  },
}));


describe("Controls.svelte", () => {
  beforeEach(() => {
    // Reset mocks and store states before each test
    vi.clearAllMocks();
    act(() => {
        mockPlayerStore.set({ ...initialPlayerState });
        mockAnalysisStore.set({ ...initialAnalysisState });
    });
  });

  it("renders all control buttons and sliders", () => {
    render(Controls);
    expect(screen.getByRole("button", { name: /Play/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stop/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Speed/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Pitch/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Gain/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/VAD Positive Threshold/i),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/VAD Negative Threshold/i),
    ).toBeInTheDocument();
  });

  it("calls audioEngine.play() when play button is clicked and not playing", async () => {
    render(Controls); // Initial render with default store values
    act(() => {
      mockPlayerStore.update((s) => ({ ...s, isPlayable: true, isPlaying: false }));
    });
    // Ensure DOM updates after store change
    await act();
    const playButton = screen.getByRole("button", { name: /Play/i });
    await fireEvent.click(playButton);
    expect(audioEngineService.play).toHaveBeenCalledTimes(1);
  });

  it("calls audioEngine.pause() when pause button is clicked and is playing", async () => {
    render(Controls);
    act(() => {
      mockPlayerStore.update((s) => ({ ...s, isPlayable: true, isPlaying: true }));
    });
    await act();
    const pauseButton = screen.getByRole("button", { name: /Pause/i });
    expect(pauseButton.textContent).toContain("Pause");
    await fireEvent.click(pauseButton);
    expect(audioEngineService.pause).toHaveBeenCalledTimes(1);
  });

  it("calls audioEngine.stop() on Stop button click", async () => {
    render(Controls);
    act(() => {
      mockPlayerStore.update((s) => ({ ...s, isPlayable: true }));
    });
    await act();
    const stopButton = screen.getByRole("button", { name: /Stop/i });
    await fireEvent.click(stopButton);
    expect(audioEngineService.stop).toHaveBeenCalledTimes(1);
  });

  describe("Slider Value Reflection (Store -> UI)", () => {
    it("reflects playerStore.speed in speed slider and label", async () => {
      act(() => {
        mockPlayerStore.set({ ...get(mockPlayerStore), speed: 1.75, isPlayable: true });
      });
      render(Controls); // Render after store is set, or re-render if already rendered

      const speedSlider = screen.getByLabelText<HTMLInputElement>(/Speed: 1.75x/i);
      expect(speedSlider.value).toBe("1.75");
      expect(screen.getByTestId("speed-value")).toHaveTextContent("Speed: 1.75x");
    });

    it("reflects playerStore.pitch in pitch slider and label", async () => {
      act(() => {
        mockPlayerStore.set({ ...get(mockPlayerStore), pitch: -6.5, isPlayable: true });
      });
      render(Controls);
      const pitchSlider = screen.getByLabelText<HTMLInputElement>(/Pitch: -6.5 semitones/i);
      expect(pitchSlider.value).toBe("-6.5");
      expect(screen.getByTestId("pitch-value")).toHaveTextContent("Pitch: -6.5 semitones");
    });

    it("reflects playerStore.gain in gain slider and label", async () => {
       act(() => {
        mockPlayerStore.set({ ...get(mockPlayerStore), gain: 0.25, isPlayable: true });
      });
      render(Controls);
      const gainSlider = screen.getByLabelText<HTMLInputElement>(/Gain: 0.25/i);
      expect(gainSlider.value).toBe("0.25");
      expect(screen.getByTestId("gain-value")).toHaveTextContent("Gain: 0.25");
    });
  });

  describe("Event Handling and Service Calls (UI -> Store -> Service)", () => {
     beforeEach(() => {
        // Ensure controls are playable for these interaction tests
        act(() => {
            mockPlayerStore.set({ ...get(mockPlayerStore), isPlayable: true });
        });
    });

    it("updates speed in store and calls audioEngine.setSpeed on slider input", async () => {
      render(Controls);
      const speedSlider = screen.getByTestId<HTMLInputElement>("speed-slider-input");

      // Simulate user dragging slider to new value
      await fireEvent.input(speedSlider, { target: { value: "1.5" } });
      // Due to bind:value, store is updated, then on:input handler fires.
      // The handler reads from the already updated store.
      expect(get(mockPlayerStore).speed).toBe(1.5); // Check store was updated
      expect(audioEngineService.setSpeed).toHaveBeenCalledWith(1.5); // Engine called with new store value
      expect(screen.getByTestId("speed-value")).toHaveTextContent("Speed: 1.50x"); // Label updated
    });

    it("updates pitch in store and calls audioEngine.setPitch on slider input", async () => {
      render(Controls);
      const pitchSlider = screen.getByTestId<HTMLInputElement>("pitch-slider-input");
      await fireEvent.input(pitchSlider, { target: { value: "-5.5" } });

      expect(get(mockPlayerStore).pitch).toBe(-5.5);
      expect(audioEngineService.setPitch).toHaveBeenCalledWith(-5.5);
      expect(screen.getByTestId("pitch-value")).toHaveTextContent("Pitch: -5.5 semitones");
    });

    it("updates gain in store and calls audioEngine.setGain on slider input", async () => {
      render(Controls);
      const gainSlider = screen.getByTestId<HTMLInputElement>("gain-slider-input");
      await fireEvent.input(gainSlider, { target: { value: "0.75" } });

      expect(get(mockPlayerStore).gain).toBe(0.75);
      expect(audioEngineService.setGain).toHaveBeenCalledWith(0.75);
      expect(screen.getByTestId("gain-value")).toHaveTextContent("Gain: 0.75");
    });
  });

  describe("Control Disabling based on isPlayable", () => {
    it("disables controls when playerStore.isPlayable is false", () => {
      act(() => {
        mockPlayerStore.set({ ...initialPlayerState, isPlayable: false });
      });
      render(Controls);

      expect(screen.getByRole("button", { name: /Play/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /Stop/i })).toBeDisabled();
      expect(screen.getByTestId("speed-slider-input")).toBeDisabled();
      expect(screen.getByTestId("pitch-slider-input")).toBeDisabled();
      expect(screen.getByTestId("gain-slider-input")).toBeDisabled();
      // VAD sliders are not part of this refactor's scope for disabling
    });

    it("enables controls when playerStore.isPlayable is true", () => {
      act(() => {
        mockPlayerStore.set({ ...initialPlayerState, isPlayable: true });
      });
      render(Controls);

      expect(screen.getByRole("button", { name: /Play/i })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: /Stop/i })).not.toBeDisabled();
      expect(screen.getByTestId("speed-slider-input")).not.toBeDisabled();
      expect(screen.getByTestId("pitch-slider-input")).not.toBeDisabled();
      expect(screen.getByTestId("gain-slider-input")).not.toBeDisabled();
    });
  });
});
