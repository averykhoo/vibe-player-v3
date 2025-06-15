// vibe-player-v2/src/lib/components/Controls.test.ts

import { render, fireEvent, screen, act } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, type Mocked } from "vitest";
import Controls from "./Controls.svelte";
import audioEngineService from "$lib/services/audioEngine.service";
import { playerStore } from "$lib/stores/player.store";
import { analysisStore } from "$lib/stores/analysis.store";
import { writable, type Writable, get } from "svelte/store";

// --- Hoisted Mocks ---
vi.mock('$lib/stores/player.store', () => ({
  playerStore: {
    subscribe: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
  },
}));
vi.mock('$lib/stores/analysis.store', () => ({
  analysisStore: {
    subscribe: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
  },
}));
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

// --- Test State Setup ---
type PlayerStoreValues = ReturnType<typeof get<Writable<any>>>;
const initialMockPlayerStoreValues: PlayerStoreValues = {
  speed: 1.0, pitch: 0.0, gain: 1.0, isPlaying: false, isPlayable: false
};
const initialMockAnalysisStoreValues = {
  vadPositiveThreshold: 0.5, vadNegativeThreshold: 0.35,
};
let mockPlayerStoreWritable: Writable<PlayerStoreValues>;
let mockAnalysisStoreWritable: Writable<any>;


describe("Controls.svelte", () => {
  beforeEach(async () => {
    mockPlayerStoreWritable = writable({ ...initialMockPlayerStoreValues });
    mockAnalysisStoreWritable = writable({ ...initialMockAnalysisStoreValues });

    const playerStoreMocks = await import('$lib/stores/player.store');
    vi.mocked(playerStoreMocks.playerStore.subscribe).mockImplementation(mockPlayerStoreWritable.subscribe);
    vi.mocked(playerStoreMocks.playerStore.update).mockImplementation(mockPlayerStoreWritable.update);

    const analysisStoreMocks = await import('$lib/stores/analysis.store');
    vi.mocked(analysisStoreMocks.analysisStore.subscribe).mockImplementation(mockAnalysisStoreWritable.subscribe);
    vi.mocked(analysisStoreMocks.analysisStore.update).mockImplementation(mockAnalysisStoreWritable.update);

    vi.clearAllMocks();

    // Re-apply mocks after clearing
    vi.mocked(playerStoreMocks.playerStore.subscribe).mockImplementation(mockPlayerStoreWritable.subscribe);
    vi.mocked(playerStoreMocks.playerStore.update).mockImplementation(mockPlayerStoreWritable.update);
    vi.mocked(analysisStoreMocks.analysisStore.subscribe).mockImplementation(mockAnalysisStoreWritable.subscribe);
    vi.mocked(analysisStoreMocks.analysisStore.update).mockImplementation(mockAnalysisStoreWritable.update);
  });

  // --- FIXED TEST ---
  it("renders all control buttons and sliders", () => {
    render(Controls);
    // Assert the toggle button is present (initially shows "Play")
    expect(screen.getByRole("button", { name: /Play/i })).toBeInTheDocument();
    // Assert the Stop button is present
    expect(screen.getByRole("button", { name: /Stop/i })).toBeInTheDocument();

    // Assert sliders are present
    expect(screen.getByLabelText(/Speed/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Pitch/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Gain/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/VAD Positive Threshold/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/VAD Negative Threshold/i)).toBeInTheDocument();
  });

  // --- FIXED TEST ---
  it("calls audioEngine.play() when play button is clicked and not playing", async () => {
    // Arrange: Ensure component is rendered and playable
    render(Controls);
    act(() => {
        mockPlayerStoreWritable.update(s => ({ ...s, isPlayable: true, isPlaying: false }));
    });

    // Act
    const playButton = screen.getByTestId("play-button");
    await fireEvent.click(playButton);

    // Assert
    expect(audioEngineService.play).toHaveBeenCalledTimes(1);
    expect(audioEngineService.pause).not.toHaveBeenCalled();
  });

    // --- NEW TEST to replace the old pause test ---
  it("calls audioEngine.pause() when pause button is clicked and is playing", async () => {
    // Arrange: Ensure component is rendered and in a "playing" state
    render(Controls);
    act(() => {
      mockPlayerStoreWritable.update(s => ({ ...s, isPlayable: true, isPlaying: true }));
    });

    // The button text should now be "Pause"
    const pauseButton = screen.getByRole("button", { name: /Pause/i });
    expect(pauseButton).toBeInTheDocument();

    // Act
    await fireEvent.click(pauseButton);

    // Assert
    expect(audioEngineService.pause).toHaveBeenCalledTimes(1);
    expect(audioEngineService.play).not.toHaveBeenCalled();
  });


  // This test remains valid
  it("calls audioEngine.stop() on Stop button click", async () => {
    render(Controls);
    act(() => {
      mockPlayerStoreWritable.update(s => ({ ...s, isPlayable: true }));
    });
    await fireEvent.click(screen.getByRole("button", { name: /Stop/i }));
    expect(audioEngineService.stop).toHaveBeenCalledTimes(1);
  });

  // The rest of the slider tests are still valid and do not need to be changed.
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
    render(Controls);
    const vadSlider = screen.getByLabelText<HTMLInputElement>(
      /VAD Positive Threshold/i,
    );
    await fireEvent.input(vadSlider, { target: { value: "0.85" } });
    expect(analysisStore.update).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/VAD Positive Threshold: 0.85/i)).toBeInTheDocument();
  });

  it("updates analysisStore when VAD Negative Threshold slider changes", async () => {
    render(Controls);
    const vadSlider = screen.getByLabelText<HTMLInputElement>(
      /VAD Negative Threshold/i,
    );
    await fireEvent.input(vadSlider, { target: { value: "0.25" } });
    expect(analysisStore.update).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/VAD Negative Threshold: 0.25/i)).toBeInTheDocument();
  });

  it("slider values update if store changes externally", async () => {
    render(Controls);
    act(() => {
      mockPlayerStoreWritable.set({ ...initialMockPlayerStoreValues, speed: 1.8, pitch: 3.0, gain: 0.5 });
    });
    await screen.findByLabelText(/Speed: 1.80x/i);
    expect(screen.getByLabelText<HTMLInputElement>(/Speed/i).value).toBe("1.8");
    expect(screen.getByLabelText<HTMLInputElement>(/Pitch/i).value).toBe("3");
    expect(screen.getByLabelText<HTMLInputElement>(/Gain/i).value).toBe("0.5");

    act(() => {
      mockAnalysisStoreWritable.set({ ...initialMockAnalysisStoreValues, vadPositiveThreshold: 0.9, vadNegativeThreshold: 0.1 });
    });
    await screen.findByLabelText(/VAD Positive Threshold: 0.90/i);
    expect(screen.getByLabelText<HTMLInputElement>(/VAD Positive Threshold/i).value).toBe("0.9");
    expect(screen.getByLabelText<HTMLInputElement>(/VAD Negative Threshold/i).value).toBe("0.1");
  });
});
