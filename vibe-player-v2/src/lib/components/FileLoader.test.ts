// vibe-player-v2/src/lib/components/FileLoader.test.ts
import { act, fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FileLoader from "./FileLoader.svelte";
import { writable, type Writable, get } from "svelte/store";
import type { PlayerState } from "$lib/types/player.types"; // Assuming PlayerState is used by the store value
import { AudioOrchestrator as ActualAudioOrchestrator } from '$lib/services/AudioOrchestrator.service'; // Import the actual class for type hints if needed

// Mock AudioOrchestrator
const mockLoadFileAndAnalyze = vi.fn(() => Promise.resolve());
vi.mock('$lib/services/AudioOrchestrator.service', () => {
  // This is the mock for the class AudioOrchestrator
  const MockAudioOrchestrator = vi.fn().mockImplementation(() => ({
    loadFileAndAnalyze: mockLoadFileAndAnalyze,
    // Mock other methods if FileLoader ever calls them
  }));

  // Mock the static getInstance method on the class
  MockAudioOrchestrator.getInstance = vi.fn().mockReturnValue({
    loadFileAndAnalyze: mockLoadFileAndAnalyze,
  });

  return {
    AudioOrchestrator: MockAudioOrchestrator,
    // If the service also exports the instance as default (audioOrchestrator), mock that too.
    // Based on AudioOrchestrator.service.ts, it exports `audioOrchestrator = AudioOrchestrator.getInstance();`
    // However, FileLoader.svelte imports `{ AudioOrchestrator }` so the class mock with static getInstance is key.
  };
});


// Mock playerStore
const initialMockPlayerStoreValues: PlayerState = {
  status: "idle",
  fileName: null,
  duration: 0,
  currentTime: 0,
  isPlaying: false,
  isPlayable: false,
  speed: 1.0,
  pitch: 0.0,
  gain: 1.0,
  waveformData: undefined,
  error: null,
  audioBuffer: undefined,
  audioContextResumed: false,
  channels: undefined,
  sampleRate: undefined,
  lastProcessedChunk: undefined,
};

let mockPlayerStoreWritable: Writable<PlayerState>;
// Mock errorStore (assuming simple structure, adjust if complex)
let mockErrorStoreWritable: Writable<{ message: string | null } | null>;


vi.mock("$lib/stores/player.store", async (importOriginal) => {
  const original = await importOriginal() as any; // Import to get Writable type if needed
  mockPlayerStoreWritable = writable(initialMockPlayerStoreValues);
  return {
    playerStore: mockPlayerStoreWritable, // Export the writable instance
    ...original, // Spread other exports if any
  };
});

vi.mock("$lib/stores/error.store", async (importOriginal) => {
    const original = await importOriginal() as any;
    mockErrorStoreWritable = writable(null); // Initial error store state
    return {
        errorStore: mockErrorStoreWritable,
        ...original,
    };
});


describe("FileLoader.svelte", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Reset stores to initial state before each test
    act(() => {
        mockPlayerStoreWritable.set(initialMockPlayerStoreValues);
        mockErrorStoreWritable.set(null);
    });

    // Clear all mocks, including the call counts for mockLoadFileAndAnalyze
    vi.clearAllMocks();

    // Re-initialize the mock for getInstance if it was cleared or to ensure fresh state
    // This is crucial because vi.clearAllMocks() can affect static method mocks too.
    const { AudioOrchestrator: MockedAudioOrchestrator } = await import('$lib/services/AudioOrchestrator.service');
    (MockedAudioOrchestrator as any).getInstance.mockReturnValue({
        loadFileAndAnalyze: mockLoadFileAndAnalyze,
    });


    // Spy on console.log
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Polyfill/mock File.prototype.arrayBuffer if it doesn't exist in JSDOM
    if (!File.prototype.arrayBuffer) {
      File.prototype.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(10));
    }
  });

  it("renders the file input", () => {
    render(FileLoader);
    const fileInput = screen.getByLabelText("Load Audio File"); // More accessible query
    expect(fileInput).toBeInTheDocument();
  });

  it("calls AudioOrchestrator.loadFileAndAnalyze and logs on file selection", async () => {
    render(FileLoader);
    const fileInput = screen.getByLabelText("Load Audio File");

    const mockFile = new File(["dummy content"], "test.mp3", { type: "audio/mpeg" });

    // Simulate file selection
    await fireEvent.change(fileInput, { target: { files: [mockFile] } });

    // Check console.log spy
    expect(consoleLogSpy).toHaveBeenCalledWith(
      `[FileLoader] User selected file: '${mockFile.name}'. Calling AudioOrchestrator.loadFileAndAnalyze.`
    );

    // Check that the orchestrator method was called
    expect(mockLoadFileAndAnalyze).toHaveBeenCalledTimes(1);
    expect(mockLoadFileAndAnalyze).toHaveBeenCalledWith(mockFile);
  });

  it("displays selected file name and size", async () => {
    render(FileLoader);
    const fileInput = screen.getByLabelText("Load Audio File");

    const mockFile = new File(["dummy content"], "example.wav", { type: "audio/wav" });
    Object.defineProperty(mockFile, "size", { value: 1024 * 500 }); // 0.5 MB

    await fireEvent.change(fileInput, { target: { files: [mockFile] } });

    // Wait for DOM updates triggered by the file selection
    await act(() => Promise.resolve());

    expect(screen.getByText(`Selected: ${mockFile.name} (0.49 MB)`)).toBeInTheDocument();
  });

  it("shows loading indicator text while isLoading (local component state) is true", async () => {
    // Make the mock function take time to resolve
    mockLoadFileAndAnalyze.mockImplementationOnce(() => new Promise(resolve => setTimeout(resolve, 100)));

    render(FileLoader);
    const fileInput = screen.getByLabelText("Load Audio File");
    const mockFile = new File(["dummy"], "loading_test.mp3", { type: "audio/mpeg" });

    // Don't await this, to check intermediate loading state
    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    // Check for loading text
    expect(await screen.findByText("Loading audio...")).toBeInTheDocument();

    // Advance timers to resolve the promise
    await act(() => vi.advanceTimersByTimeAsync(100));

    expect(screen.queryByText("Loading audio...")).not.toBeInTheDocument();
  });

  it("disables file input when isLoading (local component state) is true", async () => {
    mockLoadFileAndAnalyze.mockImplementationOnce(() => new Promise(resolve => setTimeout(resolve, 100)));

    render(FileLoader);
    const fileInput = screen.getByLabelText("Load Audio File") as HTMLInputElement;
    const mockFile = new File(["dummy"], "test.mp3", { type: "audio/mpeg" });

    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    expect(await screen.findByText("Loading audio...")).toBeInTheDocument(); // Wait for loading state
    expect(fileInput.disabled).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(100)); // Resolve promise

    expect(fileInput.disabled).toBe(false);
  });

  it("displays status from playerStore when not loading", async () => {
    render(FileLoader);

    act(() => {
      mockPlayerStoreWritable.set({ ...get(mockPlayerStoreWritable), status: "Test Status" });
    });

    // Ensure isLoading is false for this test
    const fileInput = screen.getByLabelText("Load Audio File") as HTMLInputElement;
    expect(fileInput.disabled).toBe(false); // Indirectly checks isLoading

    expect(await screen.findByText("Status: Test Status")).toBeInTheDocument();
  });

  it("displays error from playerStore when status is Error", async () => {
    render(FileLoader);

    act(() => {
      mockPlayerStoreWritable.set({
        ...get(mockPlayerStoreWritable),
        status: "Error",
        error: "Test Player Error"
      });
    });

    expect(await screen.findByText("Status: Error : Test Player Error")).toBeInTheDocument();
  });

  it("clears file input value after processing", async () => {
    mockLoadFileAndAnalyze.mockResolvedValue(undefined); // Ensure it resolves

    render(FileLoader);
    const fileInput = screen.getByLabelText("Load Audio File") as HTMLInputElement;
    const mockFile = new File(["dummy content"], "test.mp3", { type: "audio/mpeg" });

    await fireEvent.change(fileInput, { target: { files: [mockFile] } });

    // Wait for the .finally() block in handleFileSelect
    await act(() => Promise.resolve().then(() => Promise.resolve())); // Ensure microtasks run

    expect(fileInput.value).toBe("");
  });
});

// Helper to advance timers and flush microtasks
const flushPromises = () => new Promise(setImmediate);

vi.useRealTimers(); // Restore real timers after tests if fake timers were used
