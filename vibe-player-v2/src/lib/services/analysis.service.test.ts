// vibe-player-v2/src/lib/services/analysis.service.test.ts

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// --- Mock Dependencies ---
// By mocking at the top level, we ensure any import of these modules gets our fake version.

vi.mock("$lib/stores/analysis.store", () => ({
  analysisStore: {
    subscribe: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
  },
}));

// Create a single, controllable mock worker instance for all tests.
const mockVadWorkerInstance = {
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((event: ErrorEvent) => void) | null,
};

vi.mock("$lib/workers/sileroVad.worker?worker&inline", () => ({
  default: vi.fn().mockImplementation(() => mockVadWorkerInstance),
}));


// --- Test Suite ---
// We can now import the service, knowing its dependencies are mocked.
import analysisService from "./analysis.service";
import { analysisStore } from "$lib/stores/analysis.store";
import SileroVadWorker from '$lib/workers/sileroVad.worker?worker&inline';
import { VAD_CONSTANTS } from "$lib/utils";

describe("AnalysisService (VAD Only)", () => {

  // Intercept and mock the global `fetch` API.
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)), // Return a dummy buffer
    } as Response);
  });

  afterEach(() => {
    // This is crucial: it resets all mock call history and restores `fetch`.
    vi.restoreAllMocks();
    // Manually dispose the singleton to reset its internal state for the next test.
    analysisService.dispose();
  });

  describe("initialize (VAD)", () => {
    it("should successfully initialize the VAD worker", async () => {
      // Act: Call the async initialize method.
      const initPromise = analysisService.initialize();

      // Assert (Immediate): Check that a worker was created and a message was posted.
      expect(SileroVadWorker).toHaveBeenCalledTimes(1);
      expect(mockVadWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "vad_init" }),
        expect.any(Array)
      );
      
      // Simulate (Completion): The worker responds with success.
      // This is the key to resolving the promise and preventing a timeout.
      mockVadWorkerInstance.onmessage!({
        data: { type: "vad_init_success", messageId: "vad_msg_0" },
      } as MessageEvent);

      // Await the promise to ensure all internal logic has completed.
      await initPromise;

      // Assert (Final State): Check that the service is now in an initialized state.
      // We can infer this by checking if it's ready to process a frame.
      expect(() => analysisService.analyzeAudioFrame(new Float32Array(1536))).not.toThrow();
    });

    it("should handle initialization failure from the worker", async () => {
      const initPromise = analysisService.initialize();

      // Simulate: The worker responds with an error.
      mockVadWorkerInstance.onmessage!({
        data: { type: "vad_init_error", error: "Model load failed", messageId: "vad_msg_0" },
      } as MessageEvent);

      // Assert: The promise should reject with the worker's error message.
      await expect(initPromise).rejects.toThrow("Model load failed");

      // Assert: The service should update the store with the error.
      expect(analysisStore.update).toHaveBeenCalledWith(
        expect.any(Function)
      );
    });
  });

  describe("dispose", () => {
    it("should terminate the worker if it was initialized", async () => {
      // Arrange: Ensure the service is fully initialized.
      const initPromise = analysisService.initialize();
      mockVadWorkerInstance.onmessage!({
        data: { type: "vad_init_success", messageId: "vad_msg_0" },
      } as MessageEvent);
      await initPromise;

      // Act: Call the method under test.
      analysisService.dispose();

      // Assert: The worker's terminate method should have been called.
      expect(mockVadWorkerInstance.terminate).toHaveBeenCalledTimes(1);
    });

    it("should not throw an error if called before initialization", () => {
      // Act & Assert: Call dispose on a clean instance and ensure no errors are thrown.
      expect(() => analysisService.dispose()).not.toThrow();
      expect(mockVadWorkerInstance.terminate).not.toHaveBeenCalled();
    });
  });
});