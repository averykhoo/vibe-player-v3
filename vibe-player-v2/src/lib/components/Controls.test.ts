import { render, fireEvent, screen, act } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, type Mocked } from "vitest";
import Controls from "./Controls.svelte";
import audioEngineService from "$lib/services/audioEngine.service";
import analysisService from "$lib/services/analysis.service"; // Mocked, though not directly called in current Controls
import { playerStore } from "$lib/stores/player.store";
import { analysisStore } from "$lib/stores/analysis.store";
import { writable, type Writable } from "svelte/store";

// Mock services
vi.mock("$lib/services/audioEngine.service", () => ({
  default: {
    unlockAudio: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    setSpeed: vi.fn(),
    setPitch: vi.fn(),
    setGain: vi.fn(),
    initialize: vi.fn(),
    dispose: vi.fn(),
  },
}));

vi.mock("$lib/services/analysis.service", () => ({
  default: {
    // Mock methods if Controls directly calls them. Currently, it updates analysisStore.
    initialize: vi.fn(),
    dispose: vi.fn(),
    // setVadThresholds: vi.fn(), // Example if it were called directly
  },
}));

// Mock stores
let mockPlayerStoreValues: {
  speed: number;
  pitch: number;
  gain: number;
  [key: string]: any;
};
let mockPlayerStoreWritable: Writable<typeof mockPlayerStoreValues>;
vi.mock("$lib/stores/player.store", async () => {
  const { writable: actualWritable } = await import("svelte/store");
  mockPlayerStoreValues = { speed: 1.0, pitch: 0.0, gain: 1.0 }; // Default initial values
  mockPlayerStoreWritable = actualWritable(mockPlayerStoreValues);
  return { playerStore: mockPlayerStoreWritable };
});

let mockAnalysisStoreValues: {
  vadPositiveThreshold: number;
  vadNegativeThreshold: number;
  [key: string]: any;
};
let mockAnalysisStoreWritable: Writable<typeof mockAnalysisStoreValues>;
vi.mock("$lib/stores/analysis.store", async () => {
  const { writable: actualWritable } = await import("svelte/store");
  mockAnalysisStoreValues = {
    vadPositiveThreshold: 0.5,
    vadNegativeThreshold: 0.35,
  }; // Default initial values
  mockAnalysisStoreWritable = actualWritable(mockAnalysisStoreValues);
  return { analysisStore: mockAnalysisStoreWritable };
});

describe("Controls.svelte", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => {
      mockPlayerStoreWritable.set({ speed: 1.0, pitch: 0.0, gain: 1.0 });
      mockAnalysisStoreWritable.set({
        vadPositiveThreshold: 0.5,
        vadNegativeThreshold: 0.35,
      });
    });
  });

  it("renders all control buttons and sliders", () => {
    render(Controls);
    expect(screen.getByRole("button", { name: /Play/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pause/i })).toBeInTheDocument();
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

  it("calls audioEngine.play() on Play button click", async () => {
    render(Controls);
    await fireEvent.click(screen.getByRole("button", { name: /Play/i }));
    expect(audioEngineService.play).toHaveBeenCalledTimes(1);
  });

  it("calls audioEngine.pause() on Pause button click", async () => {
    render(Controls);
    await fireEvent.click(screen.getByRole("button", { name: /Pause/i }));
    expect(audioEngineService.pause).toHaveBeenCalledTimes(1);
  });

  it("calls audioEngine.stop() on Stop button click", async () => {
    render(Controls);
    await fireEvent.click(screen.getByRole("button", { name: /Stop/i }));
    expect(audioEngineService.stop).toHaveBeenCalledTimes(1);
  });

  it("calls audioEngine.setSpeed() when speed slider changes", async () => {
    render(Controls);
    const speedSlider = screen.getByLabelText<HTMLInputElement>(/Speed/i);
    await fireEvent.input(speedSlider, { target: { value: "1.5" } });
    expect(audioEngineService.setSpeed).toHaveBeenCalledWith(1.5);
    expect(screen.getByLabelText(/Speed: 1.50x/i)).toBeInTheDocument();
  });

  it("calls audioEngine.setPitch() when pitch slider changes", async () => {
    render(Controls);
    const pitchSlider = screen.getByLabelText<HTMLInputElement>(/Pitch/i);
    await fireEvent.input(pitchSlider, { target: { value: "-5.0" } });
    expect(audioEngineService.setPitch).toHaveBeenCalledWith(-5.0);
    expect(screen.getByLabelText(/Pitch: -5.0 semitones/i)).toBeInTheDocument();
  });

  it("calls audioEngine.setGain() when gain slider changes", async () => {
    render(Controls);
    const gainSlider = screen.getByLabelText<HTMLInputElement>(/Gain/i);
    await fireEvent.input(gainSlider, { target: { value: "0.7" } });
    expect(audioEngineService.setGain).toHaveBeenCalledWith(0.7);
    expect(screen.getByLabelText(/Gain: 0.70/i)).toBeInTheDocument();
  });

  it("updates analysisStore when VAD Positive Threshold slider changes", async () => {
    const mockUpdate = vi.spyOn(mockAnalysisStoreWritable, "update");
    render(Controls);
    const vadSlider = screen.getByLabelText<HTMLInputElement>(
      /VAD Positive Threshold/i,
    );
    await fireEvent.input(vadSlider, { target: { value: "0.85" } });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    // Check that the update function sets the value correctly
    act(() => {
      const updater = mockUpdate.mock.calls[0][0];
      updater({ vadPositiveThreshold: 0.5, vadNegativeThreshold: 0.35 }); // Simulate current store state
    });
    // Value is updated in component state first due to bind:value, then store is updated
    // The component's local `vadPositive` will be 0.85.
    // The store update will be called with a function that, when executed, sets vadPositiveThreshold to 0.85.
    expect(
      screen.getByLabelText(/VAD Positive Threshold: 0.85/i),
    ).toBeInTheDocument();
  });

  it("updates analysisStore when VAD Negative Threshold slider changes", async () => {
    const mockUpdate = vi.spyOn(mockAnalysisStoreWritable, "update");
    render(Controls);
    const vadSlider = screen.getByLabelText<HTMLInputElement>(
      /VAD Negative Threshold/i,
    );
    await fireEvent.input(vadSlider, { target: { value: "0.25" } });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(
      screen.getByLabelText(/VAD Negative Threshold: 0.25/i),
    ).toBeInTheDocument();
  });

  it("slider values update if store changes externally", async () => {
    render(Controls);
    act(() => {
      mockPlayerStoreWritable.set({ speed: 1.8, pitch: 3.0, gain: 0.5 });
    });
    await screen.findByLabelText(/Speed: 1.80x/i); // Wait for DOM update
    expect(screen.getByLabelText<HTMLInputElement>(/Speed/i).value).toBe("1.8");
    expect(screen.getByLabelText<HTMLInputElement>(/Pitch/i).value).toBe("3");
    expect(screen.getByLabelText<HTMLInputElement>(/Gain/i).value).toBe("0.5");

    act(() => {
      mockAnalysisStoreWritable.set({
        vadPositiveThreshold: 0.9,
        vadNegativeThreshold: 0.1,
      });
    });
    await screen.findByLabelText(/VAD Positive Threshold: 0.90/i);
    expect(
      screen.getByLabelText<HTMLInputElement>(/VAD Positive Threshold/i).value,
    ).toBe("0.9");
    expect(
      screen.getByLabelText<HTMLInputElement>(/VAD Negative Threshold/i).value,
    ).toBe("0.1");
  });
});
