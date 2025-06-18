// vibe-player-v2/src/lib/components/FileLoader/FileLoader.test.ts
import { act, fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FileLoader from "./FileLoader.svelte";
import { writable, type Writable, get } from "svelte/store"; // Added get
import type { ErrorStoreState } from "$lib/stores/error.store"; // Assuming type definition

// Mock AudioOrchestrator
const mockLoadFileAndAnalyze = vi.fn(() => Promise.resolve());
vi.mock("$lib/services/AudioOrchestrator.service", () => {
  return {
    AudioOrchestrator: class {
      static getInstance = vi.fn(() => ({
        loadFileAndAnalyze: mockLoadFileAndAnalyze,
        // setupUrlSerialization: vi.fn(), // Not directly tested here but part of orchestrator
        // loadUrlOrDefault: vi.fn() // Not directly tested here
      }));
    },
  };
});

// Hoisted Mocks for store structures
vi.mock("$lib/stores/player.store", () => ({
  playerStore: {
    subscribe: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("$lib/stores/error.store", () => ({
  errorStore: {
    subscribe: vi.fn(),
    set: vi.fn(),
    // update: vi.fn(), // Add if error store has an update method
  },
}));


// Declare types for store values
type PlayerStoreValues = {
  // Define only what FileLoader uses for display, if anything
  status: string;
  // error: string | null; // Error display is now from errorStore
};

// Original initial values
const initialMockPlayerStoreValues: PlayerStoreValues = {
  status: "Ready",
};

const initialMockErrorStoreValues: ErrorStoreState = {
  message: null,
};

// This will hold the actual writable store instances, created in beforeEach
let mockPlayerStoreWritable: Writable<PlayerStoreValues>;
let mockErrorStoreWritable: Writable<ErrorStoreState>;


describe("FileLoader.svelte", () => {
  beforeEach(async () => {
    // Enable fake timers if any component or service relies on them for async ops post-orchestrator
    vi.useFakeTimers();

    mockPlayerStoreWritable = writable(initialMockPlayerStoreValues);
    mockErrorStoreWritable = writable(initialMockErrorStoreValues);

    // Setup playerStore mock
    const playerStoreMocks = await import("$lib/stores/player.store");
    vi.mocked(playerStoreMocks.playerStore.subscribe).mockImplementation(
      mockPlayerStoreWritable.subscribe,
    );
    vi.mocked(playerStoreMocks.playerStore.update).mockImplementation(
      mockPlayerStoreWritable.update,
    );
    vi.mocked(playerStoreMocks.playerStore.set).mockImplementation(
      mockPlayerStoreWritable.set,
    );
     act(() => { // Reset store state
      mockPlayerStoreWritable.set(initialMockPlayerStoreValues);
    });

    // Setup errorStore mock
    const errorStoreMocks = await import("$lib/stores/error.store");
    vi.mocked(errorStoreMocks.errorStore.subscribe).mockImplementation(
      mockErrorStoreWritable.subscribe,
    );
    vi.mocked(errorStoreMocks.errorStore.set).mockImplementation(
      mockErrorStoreWritable.set,
    );
    act(() => { // Reset store state
      mockErrorStoreWritable.set(initialMockErrorStoreValues);
    });

    vi.clearAllMocks(); // Clear service mocks etc.

    // Re-apply store mock implementations after vi.clearAllMocks() for playerStore
     vi.mocked(playerStoreMocks.playerStore.subscribe).mockImplementation(
      mockPlayerStoreWritable.subscribe,
    );
    vi.mocked(playerStoreMocks.playerStore.update).mockImplementation(
      mockPlayerStoreWritable.update,
    );
    vi.mocked(playerStoreMocks.playerStore.set).mockImplementation(
      mockPlayerStoreWritable.set,
    );
    // Re-apply store mock implementations after vi.clearAllMocks() for errorStore
    vi.mocked(errorStoreMocks.errorStore.subscribe).mockImplementation(
      mockErrorStoreWritable.subscribe,
    );
    vi.mocked(errorStoreMocks.errorStore.set).mockImplementation(
      mockErrorStoreWritable.set,
    );
  });

  it("renders the file input", () => {
    const { container } = render(FileLoader);
    const fileInput = container.querySelector("#fileInput");
    expect(fileInput).toBeInTheDocument();
  });

  it("calls AudioOrchestrator.loadFileAndAnalyze on file selection", async () => {
    const { container } = render(FileLoader);
    const fileInput = container.querySelector("#fileInput");
    if (!fileInput) throw new Error("File input with ID 'fileInput' not found");

    const mockFile = new File(["dummy content"], "test.mp3", { type: "audio/mpeg" });

    await fireEvent.change(fileInput, { target: { files: [mockFile] } });

    await act(() => Promise.resolve());

    expect(mockLoadFileAndAnalyze).toHaveBeenCalledTimes(1);
    expect(mockLoadFileAndAnalyze).toHaveBeenCalledWith(mockFile);
  });

  it("displays selected file name and size", async () => {
    const { container } = render(FileLoader);
    const fileInput = container.querySelector("#fileInput");
    if (!fileInput) throw new Error("File input with ID 'fileInput' not found");

    const mockFile = new File(["dummy content"], "example.wav", { type: "audio/wav" });
    Object.defineProperty(mockFile, "size", { value: 1024 * 500 }); // 0.5 MB

    await fireEvent.change(fileInput, { target: { files: [mockFile] } });
    await act(() => Promise.resolve()); // allow component reactions

    expect(screen.getByText(`Selected: ${mockFile.name} (0.49 MB)`)).toBeInTheDocument();
  });

  it("shows loading indicator text while isLoading is true (component internal state)", async () => {
    mockLoadFileAndAnalyze.mockImplementationOnce(() => new Promise(resolve => setTimeout(resolve, 100)));

    const { container } = render(FileLoader);
    const fileInput = container.querySelector("#fileInput");
    if (!fileInput) throw new Error("File input with ID 'fileInput' not found");

    const mockFile = new File(["dummy"], "loading_test.mp3", { type: "audio/mpeg" });

    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    await screen.findByText("Loading (handing off to orchestrator)...");
    expect(screen.getByText("Loading (handing off to orchestrator)...")).toBeInTheDocument();

    await act(async () => { // Ensure timer advancement is within act
      await vi.advanceTimersByTimeAsync(100);
    });

    await vi.waitFor(() => {
        expect(screen.queryByText("Loading (handing off to orchestrator)...")).not.toBeInTheDocument();
    });
  });

  it("disables file input when isLoading (component internal state) is true", async () => {
    mockLoadFileAndAnalyze.mockImplementationOnce(() => new Promise(resolve => setTimeout(resolve, 100)));
    const { container } = render(FileLoader);
    const fileInput = container.querySelector("#fileInput");
    if (!fileInput) throw new Error("File input with ID 'fileInput' not found");

    const mockFile = new File(["dummy"], "test.mp3", { type: "audio/mpeg" });

    fireEvent.change(fileInput, { target: { files: [mockFile] } });
    await screen.findByText("Loading (handing off to orchestrator)...");
    expect(fileInput).toBeDisabled();

    await act(async () => { // Ensure timer advancement is within act
      await vi.advanceTimersByTimeAsync(100);
    });

    await vi.waitFor(() => {
      expect(fileInput).not.toBeDisabled();
    });
  });

  it("displays status from playerStore and errors from errorStore", async () => {
    render(FileLoader);

    // Test status display from playerStore
    act(() => {
      mockPlayerStoreWritable.set({ status: "Playing audio..." });
    });
    expect(await screen.findByText("Player Status: Playing audio...")).toBeInTheDocument();

    // Test error display from errorStore
    act(() => {
      mockErrorStoreWritable.set({ message: "A test error occurred." });
    });
    expect(await screen.findByText("Error: A test error occurred.")).toBeInTheDocument();

    // Test clearing error
    act(() => {
      mockErrorStoreWritable.set({ message: null });
    });
    expect(screen.queryByText("Error: A test error occurred.")).not.toBeInTheDocument();

     act(() => {
      mockPlayerStoreWritable.set({ status: "Ready" });
    });
    expect(screen.queryByText(/Player Status:/)).not.toBeInTheDocument();
     act(() => {
      mockPlayerStoreWritable.set({ status: "Stopped" });
    });
    expect(screen.queryByText(/Player Status:/)).not.toBeInTheDocument();
  });
});
