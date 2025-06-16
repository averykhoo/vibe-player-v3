// vibe-player-v2/src/lib/components/FileLoader.test.ts
import { render, fireEvent, screen, act } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, type Mocked } from "vitest";
import FileLoader from "./FileLoader.svelte"; // Adjust path
import audioEngineService from "$lib/services/audioEngine.service";
import { playerStore } from "$lib/stores/player.store";
import { writable, type Writable } from "svelte/store";

// Hoisted Mocks for store structure
vi.mock('$lib/stores/player.store', () => ({
  playerStore: {
    subscribe: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
  },
}));

// Mock services
vi.mock("$lib/services/audioEngine.service", () => ({
  default: {
    unlockAudio: vi.fn(() => Promise.resolve()),
    loadFile: vi.fn(() => Promise.resolve()),
    initialize: vi.fn(),
    dispose: vi.fn(),
  },
}));

// Declare types for store values
type PlayerStoreValues = {
  fileName: string | null;
  error: string | null;
  status: string;
  isPlayable: boolean;
  isLoadingViaStore?: boolean;
};

// Original initial values
const initialMockPlayerStoreValues: PlayerStoreValues = {
  fileName: null,
  error: null,
  status: "Ready",
  isPlayable: false,
  isLoadingViaStore: false,
};

// This will hold the actual writable store instance, created in beforeEach
let mockPlayerStoreWritable: Writable<PlayerStoreValues>;

describe("FileLoader.svelte", () => {
  beforeEach(async () => {
    vi.useFakeTimers(); // Add fake timers
    // Polyfill/mock File.prototype.arrayBuffer if it doesn't exist in JSDOM
    if (!File.prototype.arrayBuffer) {
      File.prototype.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(10));
    }
    mockPlayerStoreWritable = writable(initialMockPlayerStoreValues);

    const playerStoreMocks = await import('$lib/stores/player.store');
    vi.mocked(playerStoreMocks.playerStore.subscribe).mockImplementation(mockPlayerStoreWritable.subscribe);
    vi.mocked(playerStoreMocks.playerStore.update).mockImplementation(mockPlayerStoreWritable.update);
    vi.mocked(playerStoreMocks.playerStore.set).mockImplementation(mockPlayerStoreWritable.set);

    // Reset store state
    act(() => {
      mockPlayerStoreWritable.set(initialMockPlayerStoreValues);
    });

    vi.clearAllMocks(); // Clear service mocks etc.

    // Re-apply store mock implementations after vi.clearAllMocks()
    vi.mocked(playerStoreMocks.playerStore.subscribe).mockImplementation(mockPlayerStoreWritable.subscribe);
    vi.mocked(playerStoreMocks.playerStore.update).mockImplementation(mockPlayerStoreWritable.update);
    vi.mocked(playerStoreMocks.playerStore.set).mockImplementation(mockPlayerStoreWritable.set);
  });

  it("renders the file input", () => {
    const { container } = render(FileLoader);
    const fileInput = container.querySelector('#fileInput');
    expect(fileInput).toBeInTheDocument();
  });

  it("calls audioEngine.unlockAudio and loadFile on file selection", async () => {
    const { container } = render(FileLoader);
    const fileInput = container.querySelector('#fileInput');
    if (!fileInput) throw new Error("File input with ID 'fileInput' not found");

    const mockFile = new File(["dummy content"], "test.mp3", {
      type: "audio/mpeg",
    });
    const mockArrayBuffer = new ArrayBuffer(10);
    // Spy on the potentially polyfilled/mocked arrayBuffer
    vi.spyOn(File.prototype, "arrayBuffer").mockResolvedValue(mockArrayBuffer);

    await fireEvent.change(fileInput, { target: { files: [mockFile] } });

    expect(audioEngineService.unlockAudio).toHaveBeenCalledTimes(1);
    // Wait for promises in handleFileSelect to resolve
    await act(() => Promise.resolve());
    expect(audioEngineService.loadFile).toHaveBeenCalledWith(
      mockArrayBuffer,
      mockFile.name,
    );
  });

  it("displays selected file name and size", async () => {
    const { container } = render(FileLoader);
    const fileInput = container.querySelector('#fileInput');
    if (!fileInput) throw new Error("File input with ID 'fileInput' not found");

    const mockFile = new File(["dummy content"], "example.wav", {
      type: "audio/wav",
      lastModified: Date.now(),
    });
    Object.defineProperty(mockFile, "size", { value: 1024 * 500 }); // 0.5 MB

    await fireEvent.change(fileInput, { target: { files: [mockFile] } });
    await act(() => Promise.resolve()); // allow store updates and component reactions

    expect(
      screen.getByText(`Selected: ${mockFile.name} (0.49 MB)`), // Corrected size
    ).toBeInTheDocument();
  });

  it("shows loading indicator text while isLoading is true (component internal state)", async () => {
    (audioEngineService.loadFile as Mocked<any>).mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 100)), // Simulate delay
    );
    const { container } = render(FileLoader);
    const fileInput = container.querySelector('#fileInput');
    if (!fileInput) throw new Error("File input with ID 'fileInput' not found");

    const mockFile = new File(["dummy"], "loading_test.mp3", {
      type: "audio/mpeg",
    });
    // Spy on the potentially polyfilled/mocked arrayBuffer
    vi.spyOn(File.prototype, "arrayBuffer").mockResolvedValue(new ArrayBuffer(8));

    // Don't await this, to check intermediate loading state
    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    await screen.findByText("Loading..."); // Component's internal isLoading state
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(100)); // Resolve the loadFile promise
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("disables file input when isLoading (component internal state) is true", async () => {
    (audioEngineService.loadFile as Mocked<any>).mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 100)),
    );
    const { container } = render(FileLoader);
    const fileInput = container.querySelector('#fileInput');
    if (!fileInput) throw new Error("File input with ID 'fileInput' not found");

    const mockFile = new File(["dummy"], "test.mp3", { type: "audio/mpeg" });
    // Spy on the potentially polyfilled/mocked arrayBuffer
    vi.spyOn(File.prototype, "arrayBuffer").mockResolvedValue(new ArrayBuffer(8));

    fireEvent.change(fileInput, { target: { files: [mockFile] } });
    await screen.findByText("Loading..."); // Wait for loading state to be true
    expect(fileInput).toBeDisabled();

    await act(() => vi.advanceTimersByTimeAsync(100)); // Resolve promise
    expect(fileInput).not.toBeDisabled();
  });

  it("displays status and error messages from playerStore", async () => {
    render(FileLoader);

    act(() => {
      mockPlayerStoreWritable.update((s) => ({
        ...s,
        status: "Test Status Message",
      }));
    });
    // Use findByText to wait for potential DOM updates after store change
    expect(await screen.findByText("Status: Test Status Message")).toBeInTheDocument();

    act(() => {
      mockPlayerStoreWritable.update((s) => ({
        ...s,
        error: "Test Error Message",
      }));
    });
    expect(await screen.findByText("Error: Test Error Message")).toBeInTheDocument();
  });
});
