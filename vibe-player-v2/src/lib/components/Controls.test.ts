import { render, fireEvent, screen, act } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, type Mocked } from "vitest";
import Controls from "./Controls.svelte";
import audioEngineService from "$lib/services/audioEngine.service";
import analysisService from "$lib/services/analysis.service"; // Mocked, though not directly called in current Controls
import { playerStore } from "$lib/stores/player.store";
import { analysisStore } from "$lib/stores/analysis.store";
import { writable, type Writable } from "svelte/store";

// Mock Skeleton UI components
// Ensure this path is correct relative to this test file
// vi.mock('@skeletonlabs/skeleton', async (importOriginal) => {
//   const original = await importOriginal(); // Import actual to allow spread of other exports
//   return {
//     ...original, // Spread all other exports from skeleton
//     Button: (await import('./__mocks__/Button.svelte')).default,
//     RangeSlider: (await import('./__mocks__/RangeSlider.svelte')).default,
//     // If other specific components from Skeleton are used in Controls.svelte, mock them here too.
//   };
// });

// Hoisted Mocks for store structure
vi.mock('$lib/stores/player.store', () => ({
  playerStore: {
    subscribe: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
  },
  // any other named exports from player.store that might be used by the component
}));

vi.mock('$lib/stores/analysis.store', () => ({
  analysisStore: {
    subscribe: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
  },
  // any other named exports from analysis.store
}));

// Mock services (can remain as they are if not causing hoisting issues)
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
    initialize: vi.fn(),
    dispose: vi.fn(),
  },
}));


// Declare types for store values (optional but good practice)
type PlayerStoreValues = { speed: number; pitch: number; gain: number; [key: string]: any };
type AnalysisStoreValues = { vadPositiveThreshold: number; vadNegativeThreshold: number; [key: string]: any };

// Original initial values
const initialMockPlayerStoreValues: PlayerStoreValues = { speed: 1.0, pitch: 0.0, gain: 1.0 };
const initialMockAnalysisStoreValues: AnalysisStoreValues = {
  vadPositiveThreshold: 0.5,
  vadNegativeThreshold: 0.35,
};

// These will hold the actual writable store instances, created in beforeEach
let mockPlayerStoreWritable: Writable<PlayerStoreValues>;
let mockAnalysisStoreWritable: Writable<AnalysisStoreValues>;


describe("Controls.svelte", () => {
  beforeEach(async () => {
    // Dynamically import the mocked stores here to get access to the vi.fn() mocks
    // We need to do this *after* vi.mock has run but *before* tests use the stores.
    // This is a bit advanced; simpler might be to re-assign within beforeEach if tests allow.
    // For this strategy, we create writables and then assign their methods to the vi.fn() mocks.

    mockPlayerStoreWritable = writable(initialMockPlayerStoreValues);
    mockAnalysisStoreWritable = writable(initialMockAnalysisStoreValues);

    // Now, link the vi.fn() mocks to the methods of these writable instances
    // This requires playerStore and analysisStore to be imported *after* vi.mock has set them up as objects with vi.fn()
    // This is tricky. A more direct approach:
    // Instead of vi.mocking with simple vi.fn(), then re-assigning,
    // the getter approach in the previous attempt was better if it could be made to work.

    // Let's try re-importing the mocked store objects to assign their mocked methods.
    // This is complex due to ESM module caching.

    // Simpler approach for this strategy:
    // The vi.mock calls above already set up playerStore.subscribe etc. as vi.fn().
    // In beforeEach, we configure what these vi.fn() mocks do by linking them to our writable instances.
    const playerStoreMocks = await import('$lib/stores/player.store');
    vi.mocked(playerStoreMocks.playerStore.subscribe).mockImplementation(mockPlayerStoreWritable.subscribe);
    vi.mocked(playerStoreMocks.playerStore.update).mockImplementation(mockPlayerStoreWritable.update);
    vi.mocked(playerStoreMocks.playerStore.set).mockImplementation(mockPlayerStoreWritable.set);

    const analysisStoreMocks = await import('$lib/stores/analysis.store');
    vi.mocked(analysisStoreMocks.analysisStore.subscribe).mockImplementation(mockAnalysisStoreWritable.subscribe);
    vi.mocked(analysisStoreMocks.analysisStore.update).mockImplementation(mockAnalysisStoreWritable.update);
    vi.mocked(analysisStoreMocks.analysisStore.set).mockImplementation(mockAnalysisStoreWritable.set);

    // Reset store states to initial values for each test
    act(() => {
      mockPlayerStoreWritable.set(initialMockPlayerStoreValues);
      mockAnalysisStoreWritable.set(initialMockAnalysisStoreValues);
    });

    vi.clearAllMocks(); // Clear call history for service mocks etc.
    // Note: vi.clearAllMocks() will also clear the .mockImplementation above.
    // So, mock implementations must be re-applied *after* vi.clearAllMocks if needed,
    // or clear mocks more selectively.

    // Re-apply implementations after clearAllMocks:
    vi.mocked(playerStoreMocks.playerStore.subscribe).mockImplementation(mockPlayerStoreWritable.subscribe);
    vi.mocked(playerStoreMocks.playerStore.update).mockImplementation(mockPlayerStoreWritable.update);
    vi.mocked(playerStoreMocks.playerStore.set).mockImplementation(mockPlayerStoreWritable.set);
    vi.mocked(analysisStoreMocks.analysisStore.subscribe).mockImplementation(mockAnalysisStoreWritable.subscribe);
    vi.mocked(analysisStoreMocks.analysisStore.update).mockImplementation(mockAnalysisStoreWritable.update);
    vi.mocked(analysisStoreMocks.analysisStore.set).mockImplementation(mockAnalysisStoreWritable.set);


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
