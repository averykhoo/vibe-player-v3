// vibe-player-v2.3/src/lib/components/FileLoader/FileLoader.test.ts
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FileLoader from "../FileLoader.svelte"; // Corrected path
import { writable, type Writable, get } from "svelte/store";
import type { PlayerState } from "$lib/types/player.types";
import type { StatusState } from "$lib/types/status.types";

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
  const { writable: actualWritable } =
    await vi.importActual<typeof import("svelte/store")>("svelte/store");
  // Define initial state INSIDE the factory
  const initialPlayerStateInFactory: PlayerState = {
    status: "idle", // This should be 'idle' if matching PlayerState type strictly
    fileName: null,
    duration: 0,
    currentTime: 0,
    isPlaying: false,
    isPlayable: false,
    speed: 1.0,
    // pitch: 0.0, // Removed if not in PlayerState type, assuming pitchShift is used
    pitchShift: 0.0,
    gain: 1.0,
    waveformData: undefined,
    error: null,
    audioBuffer: undefined,
    audioContextResumed: false,
    channels: undefined, // Changed from 0
    sampleRate: undefined, // Changed from 0
    lastProcessedChunk: undefined,
  };
  const storeInstance = actualWritable(initialPlayerStateInFactory);
  return {
    playerStore: storeInstance,
    getStore: () => storeInstance,
    __initialState: initialPlayerStateInFactory,
  };
});

vi.mock("$lib/stores/status.store", async () => {
  const { writable: actualWritable } =
    await vi.importActual<typeof import("svelte/store")>("svelte/store");
  // Define initial state INSIDE the factory
  const initialStatusStateInFactory: StatusState = {
    message: null,
    type: null,
    isLoading: false,
    details: null,
    progress: null,
  };
  const storeInstance = actualWritable(initialStatusStateInFactory);
  return {
    statusStore: storeInstance,
    getStore: () => storeInstance,
    __initialState: initialStatusStateInFactory,
  };
});

describe("FileLoader.svelte", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    const playerStoreModule = await import("$lib/stores/player.store");
    mockPlayerStoreInstance = playerStoreModule.getStore();
    const statusStoreModule = await import("$lib/stores/status.store");
    mockStatusStoreInstance = statusStoreModule.getStore();

    act(() => {
      mockPlayerStoreInstance.set({ ...playerStoreModule.__initialState });
      mockStatusStoreInstance.set({ ...statusStoreModule.__initialState });
    });

    mockLoadFileAndAnalyze.mockReset();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("renders the file input and label", () => {
    render(FileLoader);
    const label = screen.getByText("Load Audio File");
    expect(label).toBeInTheDocument();
    const fileInput = screen.getByLabelText("Load Audio File");
    expect(fileInput).toBeInTheDocument();
    expect(fileInput).toHaveAttribute("id", "fileInput");
  });

  it("calls AudioOrchestrator.loadFileAndAnalyze on file selection and updates selectedFileDisplay", async () => {
    mockLoadFileAndAnalyze.mockResolvedValue(undefined);
    render(FileLoader);
    const fileInput = screen.getByLabelText("Load Audio File");

    const mockFile = new File(["dummy content"], "test.mp3", {
      type: "audio/mpeg",
    });
    Object.defineProperty(mockFile, "size", { value: 1024 * 500 }); // 0.5 MB

    await fireEvent.change(fileInput, { target: { files: [mockFile] } });

    await act(async () => { // Ensure store update is processed for UI reaction
      mockStatusStoreInstance.set({
        isLoading: false,
        message: null,
        type: null,
        details: null,
        progress: null,
      });
    });

    expect(
      await screen.findByText(`Selected: ${mockFile.name} (0.49 MB)`),
    ).toBeInTheDocument();
    expect(mockLoadFileAndAnalyze).toHaveBeenCalledTimes(1);
    expect(mockLoadFileAndAnalyze).toHaveBeenCalledWith(mockFile);
  });

  it("shows loading message and disables input based on statusStore", async () => {
    const loadingMessageText = "Processing file...";
    mockLoadFileAndAnalyze.mockImplementation(() => {
      act(() => {
        mockStatusStoreInstance.set({
          isLoading: true,
          message: loadingMessageText, // Use variable here
          type: "info",
          details: null,
          progress: null, // Progress removed from component display
        });
      });
      return new Promise((resolve) => setTimeout(resolve, 100));
    });

    render(FileLoader);
    const fileInput = screen.getByLabelText(
      "Load Audio File",
    ) as HTMLInputElement;
    const mockFile = new File(["dummy"], "loading_test.mp3", {
      type: "audio/mpeg",
    });

    await fireEvent.change(fileInput, { target: { files: [mockFile] } });

    await waitFor(() => {
      // Adjusted assertion for loading message text
      const loadingMessageElement = screen.getByTestId("file-loading-message");
      expect(loadingMessageElement).toHaveTextContent(loadingMessageText); // Check against the message set
      expect(fileInput.disabled).toBe(true);
    });

    // Test case where statusStore.message is null, should default to "Loading..."
     act(() => {
        mockStatusStoreInstance.set({
          isLoading: true,
          message: null, // Set message to null
          type: "info",
          details: null,
          progress: null,
        });
      });

    await waitFor(() => {
      const loadingMessageElement = screen.getByTestId("file-loading-message");
      expect(loadingMessageElement).toHaveTextContent("Loading..."); // Check default message
      expect(fileInput.disabled).toBe(true);
    });


    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      mockStatusStoreInstance.set({
        isLoading: false,
        message: "Ready",
        type: "success",
        details: null,
        progress: 1, // Though progress is not displayed, it's part of state
      });
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("file-loading-message"),
      ).not.toBeInTheDocument();
      expect(fileInput.disabled).toBe(false);
    });
  });

  it("displays error message from statusStore if loadFileAndAnalyze fails", async () => {
    const errorMessage = "Failed to decode audio.";
    // errorDetails is no longer displayed by the component.

    mockLoadFileAndAnalyze.mockImplementation(async () => {
      act(() => {
        mockStatusStoreInstance.set({
          message: errorMessage,
          type: "error",
          isLoading: false,
          details: "Some details not to be shown", // Details set but not displayed
          progress: null,
        });
      });
      // Simulate actual error for component's potential catch block, though orchestrator handles status.
      // throw new Error(errorMessage);
    });

    render(FileLoader);
    const fileInput = screen.getByLabelText("Load Audio File");
    const mockFile = new File(["dummy"], "error_test.mp3", {
      type: "audio/mpeg",
    });

    await fireEvent.change(fileInput, { target: { files: [mockFile] } });

    await waitFor(() => {
      const errorDisplay = screen.getByTestId("file-error-message");
      expect(errorDisplay).toBeInTheDocument();
      // Adjusted assertion for error message text
      expect(errorDisplay).toHaveTextContent(`Error: ${errorMessage}`);
      // Removed assertion for errorDetails
    });
  });

  it("clears file input value after processing attempt", async () => {
    mockLoadFileAndAnalyze.mockResolvedValue(undefined);
    render(FileLoader);
    const fileInput = screen.getByLabelText(
      "Load Audio File",
    ) as HTMLInputElement;
    const mockFile = new File(["dummy"], "test-clear.mp3", {
      type: "audio/mpeg",
    });

    expect(fileInput.value).toBe("");

    await fireEvent.change(fileInput, { target: { files: [mockFile] } });

    await act(async () => {
      await Promise.resolve();
    });

    expect(fileInput.value).toBe("");
  });
});
