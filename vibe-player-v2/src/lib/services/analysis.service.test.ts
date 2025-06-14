// vibe-player-v2/src/lib/services/analysis.service.test.ts

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// --- Mock Dependencies ---

// Define the mock worker instance here, so it's available for the mock factory.
const mockVadWorkerInstance = {
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((event: ErrorEvent) => void) | null,
};

// Hoisted mocks must use the variables defined above.
vi.mock("$lib/stores/analysis.store", () => ({
  analysisStore: {
    subscribe: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("$lib/workers/sileroVad.worker?worker&inline", () => ({
  default: vi.fn().mockImplementation(() => mockVadWorkerInstance),
}));

// --- Test Suite ---
import analysisService from "./analysis.service";
import { VAD_CONSTANTS } from "$lib/utils";

describe("AnalysisService (VAD Only)", () => {
  beforeEach(() => {
    // Reset all mock history before each test.
    vi.clearAllMocks();

    // Mock the global `fetch` API.
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as Response);
  });

  afterEach(() => {
    // Restore original implementations after each test.
    vi.restoreAllMocks();
  });

  describe("initialize (VAD)", () => {
    it("should successfully initialize the VAD worker", async () => {
      // Act: Call initialize, which returns a promise that now waits for a response.
      const initPromise = analysisService.initialize();

      // Assert (Immediate): Check that a worker was created.
      expect(mockVadWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "vad_init" }),
        expect.any(Array)
      );

      // Simulate (Completion): The worker sends a "success" message back.
      mockVadWorkerInstance.onmessage!({
        data: { type: "vad_init_success", messageId: "vad_msg_0" },
      } as MessageEvent);

      // Assert: Now await the promise. It should resolve without timing out.
      await expect(initPromise).resolves.toBeUndefined();
      
      // Assert (Final): You can check post-conditions here.
      expect(global.fetch).toHaveBeenCalledWith(VAD_CONSTANTS.ONNX_MODEL_URL);
    });

    it("should handle initialization failure from the worker", async () => {
      // Act
      const initPromise = analysisService.initialize();

      // Simulate: The worker responds with an error message.
      mockVadWorkerInstance.onmessage!({
        data: { type: "vad_init_error", error: "Model load failed", messageId: "vad_msg_0" },
      } as MessageEvent);
      
      // Assert: The promise should reject with the worker's error.
      await expect(initPromise).rejects.toMatch("Model load failed");
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

      // Act
      analysisService.dispose();

      // Assert
      expect(mockVadWorkerInstance.terminate).toHaveBeenCalledTimes(1);
    });

    it("should not throw an error if called before initialization", () => {
      // We must reset the service's internal state to simulate this.
      analysisService.dispose(); 
      
      // Act & Assert
      expect(() => analysisService.dispose()).not.toThrow();
      expect(mockVadWorkerInstance.terminate).not.toHaveBeenCalled();
    });
  });
});