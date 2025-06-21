// vibe-player-v2.3/src/lib/components/FileLoader/FileLoader.test.ts
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  render,
  fireEvent,
  screen,
  cleanup,
  act,
} from "@testing-library/svelte";
import { tick } from "svelte";
import FileLoader from "../FileLoader.svelte";

// Mock svelte's createEventDispatcher
const mockDispatch = vi.fn();
vi.mock('svelte', async (importOriginal) => {
  const actualSvelte = await importOriginal<typeof import('svelte')>();
  return {
    ...actualSvelte,
    createEventDispatcher: vi.fn(() => mockDispatch), // Return the mockDispatch
  };
});

// Mock statusStore
vi.mock("$lib/stores/status.store", async () => {
  const svelteStore =
    await vi.importActual<typeof import("svelte/store")>("svelte/store");
  const actualWritable = svelteStore.writable;

  if (typeof actualWritable !== "function") {
    console.error(
      "Failed to obtain writable function from actual svelte/store for status.store.",
      svelteStore,
    );
    throw new Error(
      "actualWritable is not a function after importing actual svelte/store for status.store",
    );
  }
  const storeInstance = actualWritable({
    message: "",
    type: "idle" as any,
    isLoading: false,
  });
  return {
    statusStore: storeInstance,
    getMockStatusStore: () => storeInstance,
  };
});

describe("FileLoader.svelte", () => {
  beforeEach(async () => {
    vi.clearAllMocks(); // Clears mockDispatch calls too
    const { getMockStatusStore } = await import("$lib/stores/status.store");
    const mockStatusStoreWritable = getMockStatusStore();
    mockStatusStoreWritable.set({
      message: "",
      type: "idle",
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the file input and label", () => {
    render(FileLoader);
    expect(screen.getByText("Load Audio File")).toBeInTheDocument();
    const fileInput = screen.getByLabelText(
      "Load Audio File",
    ) as HTMLInputElement;
    expect(fileInput.type).toBe("file");
  });

  // MODIFIED TEST to check for dispatch call
  it('dispatches a "load" event with the file when a file is selected', async () => {
    render(FileLoader);

    const fileInput = screen.getByLabelText(
      "Load Audio File",
    ) as HTMLInputElement;
    const testFile = new File(["content"], "test.mp3", { type: "audio/mp3" });

    await fireEvent.change(fileInput, { target: { files: [testFile] } });

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith('load', { file: testFile });
    expect(fileInput.value).toBe("");
  });

  it("disables the file input when $statusStore.isLoading is true", async () => {
    const { getMockStatusStore } = await import("$lib/stores/status.store");
    const mockStatusStoreWritable = getMockStatusStore();
    render(FileLoader);
    const fileInput = screen.getByLabelText(
      "Load Audio File",
    ) as HTMLInputElement;
    expect(fileInput.disabled).toBe(false);

    await act(async () => {
      mockStatusStoreWritable.set({
        message: "Loading...",
        type: "info",
        isLoading: true,
      });
      await tick();
    });

    expect(fileInput.disabled).toBe(true);
  });

  it("shows a loading message when $statusStore.isLoading is true and a message is set", async () => {
    const { getMockStatusStore } = await import("$lib/stores/status.store");
    const mockStatusStoreWritable = getMockStatusStore();
    render(FileLoader);
    expect(
      screen.queryByTestId("file-loading-message"),
    ).not.toBeInTheDocument();

    await act(async () => {
      mockStatusStoreWritable.set({
        message: "Processing audio...",
        type: "info",
        isLoading: true,
      });
      await tick();
    });

    const loadingMessage = screen.getByTestId("file-loading-message");
    expect(loadingMessage).toBeInTheDocument();
    expect(loadingMessage.textContent).toContain("Processing audio...");
  });

  it("shows selected file info when a file is selected and not loading/error", async () => {
    const { getMockStatusStore } = await import("$lib/stores/status.store");
    const mockStatusStoreWritable = getMockStatusStore();
    render(FileLoader);
    const fileInput = screen.getByLabelText(
      "Load Audio File",
    ) as HTMLInputElement;
    const testFile = new File(["content"], "test.mp3", { type: "audio/mp3" });

    await fireEvent.change(fileInput, { target: { files: [testFile] } });

    await act(async () => {
      mockStatusStoreWritable.set({
        message: "",
        type: "idle",
        isLoading: false,
      });
      await tick();
    });

    const selectedInfo = screen.getByText(/Selected: test.mp3/);
    expect(selectedInfo).toBeInTheDocument();
    expect(selectedInfo.textContent).toContain("MB)");
  });

  it("does not show selected file info if isLoading is true", async () => {
    const { getMockStatusStore } = await import("$lib/stores/status.store");
    const mockStatusStoreWritable = getMockStatusStore();
    render(FileLoader);
    const fileInput = screen.getByLabelText(
      "Load Audio File",
    ) as HTMLInputElement;
    const testFile = new File(["content"], "test.mp3", { type: "audio/mp3" });
    await fireEvent.change(fileInput, { target: { files: [testFile] } });

    await act(async () => {
      mockStatusStoreWritable.set({
        message: "Loading...",
        type: "info",
        isLoading: true,
      });
      await tick();
    });

    expect(screen.queryByText(/Selected: test.mp3/)).not.toBeInTheDocument();
  });

  it('shows an error message when $statusStore.type is "error" and not loading', async () => {
    const { getMockStatusStore } = await import("$lib/stores/status.store");
    const mockStatusStoreWritable = getMockStatusStore();
    render(FileLoader);
    expect(screen.queryByTestId("file-error-message")).not.toBeInTheDocument();

    await act(async () => {
      mockStatusStoreWritable.set({
        message: "Failed to load.",
        type: "error",
        isLoading: false,
      });
      await tick();
    });

    const errorMessage = screen.getByTestId("file-error-message");
    expect(errorMessage).toBeInTheDocument();
    expect(errorMessage.textContent).toContain("Error: Failed to load.");
  });

  it('does not show error message if $statusStore.type is "error" but also isLoading', async () => {
    const { getMockStatusStore } = await import("$lib/stores/status.store");
    const mockStatusStoreWritable = getMockStatusStore();
    render(FileLoader);
    await act(async () => {
      mockStatusStoreWritable.set({
        message: "Error during load.",
        type: "error",
        isLoading: true,
      });
      await tick();
    });

    expect(screen.queryByTestId("file-error-message")).not.toBeInTheDocument();
    expect(screen.getByTestId("file-loading-message")).toBeInTheDocument();
  });
});
