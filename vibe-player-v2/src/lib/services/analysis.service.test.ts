// vibe-player-v2/src/lib/services/analysis.service.test.ts

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// --- START: Mock Dependencies (Hoisted) ---
// These mocks MUST come before any other imports to ensure they are applied first.

// Mock the Svelte store that the service updates.
vi.mock("$lib/stores/analysis.store", () => ({
  analysisStore: {
    subscribe: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
  },
}));

// Create a single, controllable mock worker instance that all tests will use.
const mockVadWorkerInstance = {
  postMessage: vi.fn(),
  terminate: vi.fn(), // The missing terminate function.
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((event: ErrorEvent) => void) | null,
};

// Mock the worker constructor to return our mock instance.
vi.mock("$lib/workers/sileroVad.worker?worker&inline", () => ({
  default: vi.fn().mockImplementation(() => mockVadWorkerInstance),
}));
// --- END: Mock Dependencies ---


describe("AnalysisService (VAD Only)", () => {
  // This variable will hold the fresh instance of the service for each test.
  let analysisService: any;

  beforeEach(async () => {
    // 1. Reset all modules to ensure we get a fresh, non-singleton instance of the service.
    vi.resetModules();
    
    // 2. Mock the global `fetch` API before the service is imported.
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as Response);

    // 3. Dynamically import the service. This guarantees it gets our fresh mocks.
    const { default: service } = await import("./analysis.service");
    analysisService = service;

    // 4. Clear any previous mock call history.
    vi.clearAllMocks();
  });

  afterEach(() => {
    // 5. Restore all mocks to their original state after each test.
    vi.restoreAllMocks();
  });

  describe("initialize (VAD)", () => {
    it("should successfully initialize the VAD worker", async () => {
      // Dynamically import dependencies to check against the fresh mocks.
      const { default: SileroVadWorker } = await import('$lib/workers/sileroVad.worker?worker&inline');
      const { VAD_CONSTANTS } = await import('$lib/utils/constants');

      // Act: Call the async initialize method.
      const initPromise = analysisService.initialize();
      
      // Assert (Immediate): Check that the service tried to create a worker and fetch the model.
      expect(SileroVadWorker).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(VAD_CONSTANTS.ONNX_MODEL_URL);

      // Simulate (Completion): The worker sends a "success" message back.
      // This is the crucial step that resolves the promise and prevents the timeout.
      mockVadWorkerInstance.onmessage!({
        data: { type: "vad_init_success", messageId: "vad_msg_0" },
      } as MessageEvent);

      // Await the promise to ensure all internal `then()` blocks in the service have completed.
      await initPromise;

      // Assert (Final): Check that the worker was sent the correct initialization message.
      expect(mockVadWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "vad_init" }),
        expect.any(Array)
      );
    });

    it("should handle initialization failure from the worker", async () => {
      const initPromise = analysisService.initialize();

      // Simulate: The worker responds with an error message.
      mockVadWorkerInstance.onmessage!({
        data: { type: "vad_init_error", error: "Model load failed" },
      } as MessageEvent);

      // Assert: The promise from the service should now reject with the worker's error.
      await expect(initPromise).rejects.toMatch("Model load failed");
    });
  });

  describe("dispose", () => {
    it("should terminate the worker if it was initialized", async () => {
      // Arrange: Ensure the service is fully initialized first.
      const initPromise = analysisService.initialize();
      mockVadWorkerInstance.onmessage!({
        data: { type: "vad_init_success", messageId: "vad_msg_0" },
      } as MessageEvent);
      await initPromise;

      // Act
      analysisService.dispose();

      // Assert
      expect(mockVadWorkerInstance.terminate).toHaveBeenCalledTimes(1);
    });

    it("should not throw an error if called before initialization", () => {
      // Act & Assert: Simply call dispose on a clean instance and ensure no crash.
      expect(() => analysisService.dispose()).not.toThrow();
      expect(mockVadWorkerInstance.terminate).not.toHaveBeenCalled();
    });
  });
});