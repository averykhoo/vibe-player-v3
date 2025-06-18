// vibe-player-v2/src/lib/components/Controls.test.ts
import { act, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Controls from "./Controls.svelte";
import audioEngineService from "$lib/services/audioEngine.service";
import { get, writable, type Writable } from "svelte/store"; // Import writable directly
import type { PlayerState } from "$lib/types/player.types";
import type { AnalysisState } from "$lib/types/analysis.types";

// --- True Store Mocks ---
const initialPlayerState: PlayerState = {
  status: "idle",
  fileName: null,
  duration: 100, // For seek slider if it were part of this
  currentTime: 0, // For seek slider
  isPlaying: false,
  isPlayable: false,
  speed: 1.0,
  pitchShift: 0.0, // Corrected: PlayerState uses pitchShift
  gain: 1.0,
  waveformData: undefined,
  error: null,
  audioBuffer: undefined,
  audioContextResumed: false,
  channels: undefined,
  sampleRate: undefined,
  lastProcessedChunk: undefined,
};
let mockPlayerStore: Writable<PlayerState>;

const initialAnalysisState: AnalysisState = {
  // Based on AnalysisStore interface, ensure all required fields are present
  dtmfResults: [],
  spectrogramData: null,
  vadPositiveThreshold: 0.5, // From original test
  vadNegativeThreshold: 0.35, // From original test
  vadEvents: [],
  isSpeaking: false, // Added: Assuming it's part of AnalysisState
  vadInitialized: false, // Added
  vadStatus: "idle", // Added
  vadError: null, // Added
  vadNoiseFloor: 0.1, // Added
  vadSensitivity: 0.5, // Added
  // Add other properties as defined in AnalysisState
};
let mockAnalysisStore: Writable<AnalysisState>;


vi.mock("$lib/stores/player.store", async () => {
  const { writable: actualWritable } = await vi.importActual<typeof import("svelte/store")>("svelte/store");
  mockPlayerStore = actualWritable(initialPlayerState);
  return { playerStore: mockPlayerStore };
});

vi.mock("$lib/stores/analysis.store", async () => {
  const { writable: actualWritable } = await vi.importActual<typeof import("svelte/store")>("svelte/store");
  mockAnalysisStore = actualWritable(initialAnalysisState);
  return { analysisStore: mockAnalysisStore };
});

vi.mock("$lib/services/audioEngine.service", () => ({
  default: {
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    setSpeed: vi.fn(),
    setPitch: vi.fn(),
    setGain: vi.fn(),
  },
}));

// Mock analysis.service if Controls ever calls it directly (currently it doesn't)
// vi.mock("$lib/services/analysis.service", () => ({ ... }));


describe("Controls.svelte", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.clearAllMocks();
    act(() => {
        mockPlayerStore.set({ ...initialPlayerState }); // Reset to a deep copy
        mockAnalysisStore.set({ ...initialAnalysisState }); // Reset to a deep copy
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("renders all control buttons and sliders", () => {
    render(Controls);
    expect(screen.getByRole("button", { name: /Play/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stop/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Speed/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Pitch/i)).toBeInTheDocument(); // Will check for "Pitch: 0.0 semitones"
    expect(screen.getByLabelText(/Gain/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/VAD Positive Threshold/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/VAD Negative Threshold/i)).toBeInTheDocument();
  });

  it("calls audioEngine.play() when play button is clicked and not playing", async () => {
    render(Controls);
    act(() => {
      mockPlayerStore.update((s) => ({ ...s, isPlayable: true, isPlaying: false }));
    });
    await act(); // Wait for Svelte to react to store changes
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
      render(Controls); // Render with initial state
      act(() => { // Update store after rendering
        mockPlayerStore.set({ ...get(mockPlayerStore), speed: 1.75, isPlayable: true });
      });
      await act(); // Ensure DOM updates
      const speedSlider = screen.getByTestId<HTMLInputElement>("speed-slider-input");
      expect(speedSlider.value).toBe("1.75");
      expect(screen.getByTestId("speed-value")).toHaveTextContent("Speed: 1.75x");
    });

    it("reflects playerStore.pitchShift in pitch slider and label", async () => {
      render(Controls);
      act(() => {
        mockPlayerStore.set({ ...get(mockPlayerStore), pitchShift: -6.5, isPlayable: true });
      });
      await act();
      const pitchSlider = screen.getByTestId<HTMLInputElement>("pitch-slider-input");
      expect(pitchSlider.value).toBe("-6.5");
      expect(screen.getByTestId("pitch-value")).toHaveTextContent("Pitch: -6.5 semitones");
    });

    it("reflects playerStore.gain in gain slider and label", async () => {
      render(Controls);
      act(() => {
        mockPlayerStore.set({ ...get(mockPlayerStore), gain: 0.25, isPlayable: true });
      });
      await act();
      const gainSlider = screen.getByTestId<HTMLInputElement>("gain-slider-input");
      expect(gainSlider.value).toBe("0.25");
      expect(screen.getByTestId("gain-value")).toHaveTextContent("Gain: 0.25");
    });

    it("reflects analysisStore.vadPositiveThreshold in VAD positive slider and label", async () => {
        render(Controls);
        act(() => {
            mockAnalysisStore.set({ ...get(mockAnalysisStore), vadPositiveThreshold: 0.88 });
        });
        await act();
        const vadSlider = screen.getByTestId<HTMLInputElement>("vad-positive-slider-input");
        expect(vadSlider.value).toBe("0.88");
        expect(screen.getByTestId("vad-positive-value")).toHaveTextContent("VAD Positive Threshold: 0.88");
    });

    it("reflects analysisStore.vadNegativeThreshold in VAD negative slider and label", async () => {
        render(Controls);
        act(() => {
            mockAnalysisStore.set({ ...get(mockAnalysisStore), vadNegativeThreshold: 0.22 });
        });
        await act();
        const vadSlider = screen.getByTestId<HTMLInputElement>("vad-negative-slider-input");
        expect(vadSlider.value).toBe("0.22");
        expect(screen.getByTestId("vad-negative-value")).toHaveTextContent("VAD Negative Threshold: 0.22");
    });
  });

  describe("Event Handling and Service Calls (UI -> Store -> Service/Log)", () => {
     beforeEach(() => {
        act(() => {
            mockPlayerStore.set({ ...get(mockPlayerStore), isPlayable: true });
        });
    });

    it("updates speed, calls audioEngine.setSpeed, and logs on slider input", async () => {
      render(Controls);
      const speedSlider = screen.getByTestId<HTMLInputElement>("speed-slider-input");
      const testValue = 1.5;

      await fireEvent.input(speedSlider, { target: { value: testValue.toString() } });

      expect(get(mockPlayerStore).speed).toBe(testValue);
      expect(audioEngineService.setSpeed).toHaveBeenCalledWith(testValue);
      expect(consoleLogSpy).toHaveBeenCalledWith(`[Controls] User set speed to: ${testValue.toFixed(2)}`);
      expect(screen.getByTestId("speed-value")).toHaveTextContent(`Speed: ${testValue.toFixed(2)}x`);
    });

    it("updates pitchShift, calls audioEngine.setPitch, and logs on slider input", async () => {
      render(Controls);
      const pitchSlider = screen.getByTestId<HTMLInputElement>("pitch-slider-input");
      const testValue = -5.5;

      await fireEvent.input(pitchSlider, { target: { value: testValue.toString() } });

      expect(get(mockPlayerStore).pitchShift).toBe(testValue); // Corrected to pitchShift
      expect(audioEngineService.setPitch).toHaveBeenCalledWith(testValue);
      expect(consoleLogSpy).toHaveBeenCalledWith(`[Controls] User set pitch to: ${testValue.toFixed(1)}`);
      expect(screen.getByTestId("pitch-value")).toHaveTextContent(`Pitch: ${testValue.toFixed(1)} semitones`);
    });

    it("updates gain, calls audioEngine.setGain, and logs on slider input", async () => {
      render(Controls);
      const gainSlider = screen.getByTestId<HTMLInputElement>("gain-slider-input");
      const testValue = 0.75;

      await fireEvent.input(gainSlider, { target: { value: testValue.toString() } });

      expect(get(mockPlayerStore).gain).toBe(testValue);
      expect(audioEngineService.setGain).toHaveBeenCalledWith(testValue);
      expect(consoleLogSpy).toHaveBeenCalledWith(`[Controls] User set gain to: ${testValue.toFixed(2)}`);
      expect(screen.getByTestId("gain-value")).toHaveTextContent(`Gain: ${testValue.toFixed(2)}`);
    });

    it("updates VAD positive threshold in store and logs on slider input", async () => {
        render(Controls);
        const vadSlider = screen.getByTestId<HTMLInputElement>("vad-positive-slider-input");
        const testValue = 0.91; // New distinct value

        // Update analysisStore to have different initial values for negative to ensure positive is what changes
        act(() => {
            mockAnalysisStore.set({ ...get(mockAnalysisStore), vadNegativeThreshold: 0.30 });
        });
        await act();

        await fireEvent.input(vadSlider, { target: { value: testValue.toString() } });

        expect(get(mockAnalysisStore).vadPositiveThreshold).toBe(testValue);
        expect(consoleLogSpy).toHaveBeenCalledWith(
            `[Controls.svelte] updateVadThresholds() called. Positive: ${testValue.toFixed(2)}, Negative: ${0.30.toFixed(2)}`
        );
        expect(screen.getByTestId("vad-positive-value")).toHaveTextContent(`VAD Positive Threshold: ${testValue.toFixed(2)}`);
    });

    it("updates VAD negative threshold in store and logs on slider input", async () => {
        render(Controls);
        const vadSlider = screen.getByTestId<HTMLInputElement>("vad-negative-slider-input");
        const testValue = 0.11; // New distinct value

        // Update analysisStore to have different initial values for positive
        act(() => {
            mockAnalysisStore.set({ ...get(mockAnalysisStore), vadPositiveThreshold: 0.80 });
        });
        await act();

        await fireEvent.input(vadSlider, { target: { value: testValue.toString() } });

        expect(get(mockAnalysisStore).vadNegativeThreshold).toBe(testValue);
        expect(consoleLogSpy).toHaveBeenCalledWith(
            `[Controls.svelte] updateVadThresholds() called. Positive: ${0.80.toFixed(2)}, Negative: ${testValue.toFixed(2)}`
        );
        expect(screen.getByTestId("vad-negative-value")).toHaveTextContent(`VAD Negative Threshold: ${testValue.toFixed(2)}`);
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
      // VAD sliders are not disabled by isPlayable in the component
      expect(screen.getByTestId("vad-positive-slider-input")).not.toBeDisabled();
      expect(screen.getByTestId("vad-negative-slider-input")).not.toBeDisabled();

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
