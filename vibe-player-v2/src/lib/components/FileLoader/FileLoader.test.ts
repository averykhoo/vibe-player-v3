// vibe-player-v2/src/lib/components/FileLoader/FileLoader.test.ts
import { act, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FileLoader from "../FileLoader.svelte"; // Corrected path
import { writable, type Writable, get } from "svelte/store";
import type { PlayerState } from "$lib/stores/player.store"; // Assuming PlayerState is exported or defined here
import type { StatusState } from "$lib/stores/status.store"; // Assuming StatusState is exported or defined here

// --- Mock Declarations ---
let mockPlayerStoreInstance: Writable<PlayerState>;
let mockStatusStoreInstance: Writable<StatusState>;

// Mock AudioOrchestrator
const mockLoadFileAndAnalyze = vi.fn();
vi.mock("$lib/services/AudioOrchestrator.service", () => {
  return {
    AudioOrchestrator: class {
      static getInstance = vi.fn(() => ({
        loadFileAndAnalyze: mockLoadFileAndAnalyze,
      }));
    },
  };
});

// --- Store Mocks (TDZ-Safe Pattern) ---
vi.mock("$lib/stores/player.store", async () => {
    const { writable: actualWritable } = await vi.importActual<typeof import("svelte/store")>("svelte/store");
    // Define initial state INSIDE the factory
    const initialPlayerStateInFactory: PlayerState = {
        status: "Idle", fileName: null, duration: 0, currentTime: 0, isPlaying: false, isPlayable: false,
        speed: 1.0, pitch: 0.0, pitchShift: 0.0, gain: 1.0, waveformData: undefined, error: null, audioBuffer: undefined,
        audioContextResumed: false, channels: 0, sampleRate: 0, lastProcessedChunk: undefined,
    };
    const storeInstance = actualWritable(initialPlayerStateInFactory);
    return {
        playerStore: storeInstance,
        getStore: () => storeInstance,
        __initialState: initialPlayerStateInFactory
    };
});

vi.mock("$lib/stores/status.store", async () => { // Changed from error.store to status.store
    const { writable: actualWritable } = await vi.importActual<typeof import("svelte/store")>("svelte/store");
    // Define initial state INSIDE the factory
    const initialStatusStateInFactory: StatusState = {
        message: null, type: null, isLoading: false, details: null, progress: null
    };
    const storeInstance = actualWritable(initialStatusStateInFactory);
    return {
        statusStore: storeInstance,
        getStore: () => storeInstance,
        __initialState: initialStatusStateInFactory
    };
});


describe("FileLoader.svelte", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Initialize stores using the TDZ-safe pattern
    const playerStoreModule = await import("$lib/stores/player.store");
    mockPlayerStoreInstance = playerStoreModule.getStore();
    const statusStoreModule = await import("$lib/stores/status.store");
    mockStatusStoreInstance = statusStoreModule.getStore();

    // Reset stores to their initial states
    act(() => {
      mockPlayerStoreInstance.set({ ...playerStoreModule.__initialState });
      mockStatusStoreInstance.set({ ...statusStoreModule.__initialState });
    });

    mockLoadFileAndAnalyze.mockReset();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers(); // Exhaust any remaining timers
    vi.useRealTimers();
  });

  it("renders the file input and label", () => {
    render(FileLoader);
    const label = screen.getByText("Load Audio File"); // Check for label text
    expect(label).toBeInTheDocument();
    // Check if the input is associated with this label (e.g. by 'for' attribute if input has id)
    const fileInput = screen.getByLabelText("Load Audio File");
    expect(fileInput).toBeInTheDocument();
    expect(fileInput).toHaveAttribute("id", "fileInput"); // Assuming label has for="fileInput"
  });

  it("calls AudioOrchestrator.loadFileAndAnalyze on file selection and updates selectedFileDisplay", async () => {
    mockLoadFileAndAnalyze.mockResolvedValue(undefined);
    render(FileLoader);
    const fileInput = screen.getByLabelText("Load Audio File");

    const mockFile = new File(["dummy content"], "test.mp3", { type: "audio/mpeg" });
    Object.defineProperty(mockFile, "size", { value: 1024 * 500 }); // 0.5 MB

    await fireEvent.change(fileInput, { target: { files: [mockFile] } });

    // Orchestrator call is async, component updates store, UI reacts.
    // We need to ensure loading state becomes false for selectedFileDisplay to show as per component logic
    await act(() => { // Using await act for state change and subsequent UI update
        mockStatusStoreInstance.set({ isLoading: false, message: null, type: null, details: null, progress: null });
    });

    expect(await screen.findByText(`Selected: ${mockFile.name} (0.49 MB)`)).toBeInTheDocument();
    expect(mockLoadFileAndAnalyze).toHaveBeenCalledTimes(1);
    expect(mockLoadFileAndAnalyze).toHaveBeenCalledWith(mockFile);
  });

  it("shows loading message and disables input based on statusStore", async () => {
    mockLoadFileAndAnalyze.mockImplementation(() => {
      act(() => {
        mockStatusStoreInstance.set({ isLoading: true, message: "Processing file...", type: 'info', details: null, progress: 0.5 });
      });
      return new Promise(resolve => setTimeout(resolve, 100));
    });

    render(FileLoader);
    const fileInput = screen.getByLabelText("Load Audio File") as HTMLInputElement;
    const mockFile = new File(["dummy"], "loading_test.mp3", { type: "audio/mpeg" });

    // fireEvent.change is synchronous in terms of dispatching, async work follows
    await fireEvent.change(fileInput, { target: { files: [mockFile] } });

    await waitFor(() => {
        expect(screen.getByTestId("file-loading-message")).toHaveTextContent("Processing file... (50%)");
        expect(fileInput.disabled).toBe(true);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100); // Orchestrator's work finishes
      // Simulate orchestrator updating statusStore upon completion
      mockStatusStoreInstance.set({ isLoading: false, message: "Ready", type: 'success', details: null, progress: 1 });
    });

    await waitFor(() => {
      expect(screen.queryByTestId("file-loading-message")).not.toBeInTheDocument();
      expect(fileInput.disabled).toBe(false);
    });
  });

  it("displays error message from statusStore if loadFileAndAnalyze fails", async () => {
    const errorMessage = "Failed to decode audio.";
    const errorDetails = "The file format is not supported.";

    mockLoadFileAndAnalyze.mockImplementation(async () => {
      act(() => { // Simulate orchestrator updating the store upon failure
        mockStatusStoreInstance.set({
            message: errorMessage,
            type: 'error',
            isLoading: false,
            details: errorDetails,
            progress: null
        });
      });
      throw new Error(errorMessage); // Simulate actual error for component's catch block
    });

    render(FileLoader);
    const fileInput = screen.getByLabelText("Load Audio File");
    const mockFile = new File(["dummy"], "error_test.mp3", { type: "audio/mpeg" });

    await fireEvent.change(fileInput, { target: { files: [mockFile] } });

    await waitFor(() => {
        const errorDisplay = screen.getByTestId("file-error-message");
        expect(errorDisplay).toBeInTheDocument();
        expect(errorDisplay).toHaveTextContent(`Error: ${errorMessage}`);
        expect(errorDisplay).toHaveTextContent(`Details: ${errorDetails}`);
    });
  });

  it("clears file input value after processing attempt", async () => {
    mockLoadFileAndAnalyze.mockResolvedValue(undefined); // Simulate successful processing
    render(FileLoader);
    const fileInput = screen.getByLabelText("Load Audio File") as HTMLInputElement;
    const mockFile = new File(["dummy"], "test-clear.mp3", { type: "audio/mpeg" });

    expect(fileInput.value).toBe("");

    await fireEvent.change(fileInput, { target: { files: [mockFile] } });
    expect(fileInput.value).not.toBe("");

    // Ensure all async operations from handleFileSelect (including the finally block) complete
    await act(async () => {
      // Allow the mockLoadFileAndAnalyze promise to resolve if it hasn't already
      // For a mockResolvedValue, this ensures microtasks are flushed.
      // For mockImplementation with setTimeout, timers would need advancing.
      await Promise.resolve();
    });

    expect(fileInput.value).toBe("");
  });
});
