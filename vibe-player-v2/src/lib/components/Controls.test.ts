// vibe-player-v2/src/lib/components/Controls.test.ts
import {act, fireEvent, render, screen} from "@testing-library/svelte";
import {beforeEach, describe, expect, it, vi} from "vitest";
import Controls from "./Controls.svelte";
import audioEngineService from "$lib/services/audioEngine.service";
import {get, type Writable, writable} from "svelte/store";

// --- Hoisted Mocks ---
vi.mock("$lib/stores/player.store", () => ({
    playerStore: {subscribe: vi.fn(), update: vi.fn(), set: vi.fn()},
}));
vi.mock("$lib/stores/analysis.store", () => ({
    analysisStore: {subscribe: vi.fn(), update: vi.fn(), set: vi.fn()},
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
    speed: 1.0,
    pitch: 0.0,
    gain: 1.0,
    isPlaying: false,
    isPlayable: false,
};
const initialMockAnalysisStoreValues = {
    vadPositiveThreshold: 0.5,
    vadNegativeThreshold: 0.35,
};
let mockPlayerStoreWritable: Writable<PlayerStoreValues>;
let mockAnalysisStoreWritable: Writable<any>;

describe("Controls.svelte", () => {
    beforeEach(async () => {
        mockPlayerStoreWritable = writable({...initialMockPlayerStoreValues});
        mockAnalysisStoreWritable = writable({...initialMockAnalysisStoreValues});

        const playerStoreMocks = await import("$lib/stores/player.store");
        vi.mocked(playerStoreMocks.playerStore.subscribe).mockImplementation(
            mockPlayerStoreWritable.subscribe,
        );
        vi.mocked(playerStoreMocks.playerStore.update).mockImplementation(
            mockPlayerStoreWritable.update,
        );

        const analysisStoreMocks = await import("$lib/stores/analysis.store");
        vi.mocked(analysisStoreMocks.analysisStore.subscribe).mockImplementation(
            mockAnalysisStoreWritable.subscribe,
        );
        vi.mocked(analysisStoreMocks.analysisStore.update).mockImplementation(
            mockAnalysisStoreWritable.update,
        );

        vi.clearAllMocks();

        vi.mocked(playerStoreMocks.playerStore.subscribe).mockImplementation(
            mockPlayerStoreWritable.subscribe,
        );
        vi.mocked(playerStoreMocks.playerStore.update).mockImplementation(
            mockPlayerStoreWritable.update,
        );
        vi.mocked(analysisStoreMocks.analysisStore.subscribe).mockImplementation(
            mockAnalysisStoreWritable.subscribe,
        );
        vi.mocked(analysisStoreMocks.analysisStore.update).mockImplementation(
            mockAnalysisStoreWritable.update,
        );
    });

    it("renders all control buttons and sliders", () => {
        render(Controls);
        expect(screen.getByRole("button", {name: /Play/i})).toBeInTheDocument();
        expect(screen.getByRole("button", {name: /Stop/i})).toBeInTheDocument();
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
        render(Controls);
        act(() => {
            mockPlayerStoreWritable.update((s) => ({
                ...s,
                isPlayable: true,
                isPlaying: false,
            }));
        });
        const playButton = await screen.findByRole("button", {name: /Play/i});
        await fireEvent.click(playButton);
        expect(audioEngineService.play).toHaveBeenCalledTimes(1);
        expect(audioEngineService.pause).not.toHaveBeenCalled();
    });

    it("calls audioEngine.pause() when pause button is clicked and is playing", async () => {
        render(Controls);
        act(() => {
            mockPlayerStoreWritable.update((s) => ({
                ...s,
                isPlayable: true,
                isPlaying: true,
            }));
        });
        const pauseButton = await screen.findByRole("button", {name: /Pause/i});
        await fireEvent.click(pauseButton);
        expect(audioEngineService.pause).toHaveBeenCalledTimes(1);
        expect(audioEngineService.play).not.toHaveBeenCalled();
    });

    it("calls audioEngine.stop() on Stop button click", async () => {
        render(Controls);
        act(() => {
            mockPlayerStoreWritable.update((s) => ({...s, isPlayable: true}));
        });
        const stopButton = await screen.findByRole("button", {name: /Stop/i});
        await fireEvent.click(stopButton);
        expect(audioEngineService.stop).toHaveBeenCalledTimes(1);
    });

    // Slider tests remain the same but use async queries for safety
    it("calls audioEngine.setSpeed() when speed slider changes", async () => {
        render(Controls);
        const speedSlider = screen.getByLabelText<HTMLInputElement>(/Speed/i);
        await fireEvent.input(speedSlider, {target: {value: "1.5"}});
        expect(audioEngineService.setSpeed).toHaveBeenCalledWith(1.5);
        expect(await screen.findByLabelText(/Speed: 1.50x/i)).toBeInTheDocument();
    });

    it("calls audioEngine.setPitch() when pitch slider changes", async () => {
        render(Controls);
        const pitchSlider = screen.getByLabelText<HTMLInputElement>(/Pitch/i);
        await fireEvent.input(pitchSlider, {target: {value: "-5.0"}});
        expect(audioEngineService.setPitch).toHaveBeenCalledWith(-5.0);
        expect(
            await screen.findByLabelText(/Pitch: -5.0 semitones/i),
        ).toBeInTheDocument();
    });

    it("calls audioEngine.setGain() when gain slider changes", async () => {
        render(Controls);
        const gainSlider = screen.getByLabelText<HTMLInputElement>(/Gain/i);
        await fireEvent.input(gainSlider, {target: {value: "0.7"}});
        expect(audioEngineService.setGain).toHaveBeenCalledWith(0.7);
        expect(await screen.findByLabelText(/Gain: 0.70/i)).toBeInTheDocument();
    });

    it("slider values update if store changes externally", async () => {
        render(Controls);
        act(() => {
            mockPlayerStoreWritable.set({
                ...initialMockPlayerStoreValues,
                speed: 1.8,
                pitch: 3.0,
                gain: 0.5,
            });
        });
        await screen.findByLabelText(/Speed: 1.80x/i);
        expect(
            (await screen.findByLabelText<HTMLInputElement>(/Speed/i)).value,
        ).toBe("1.8");
    });
});
