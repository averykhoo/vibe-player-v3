// vibe-player-v2.3/src/lib/services/analysis.service.test.ts

import { afterEach, beforeEach, describe, expect, it, vi, type Mocked } from "vitest";
import { get, writable, type Writable } from "svelte/store";
import type { AnalysisState } from "$lib/types/analysis.types";
import { VAD_WORKER_MSG_TYPE } from "$lib/types/worker.types";

// --- START: MOCK SETUP ---

// Define the mock worker instance at the top level
const mockVadWorkerInstance = {
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((event: ErrorEvent) => void) | null,
};

// Create a real writable store instance for mocking
const mockAnalysisStore: Writable<AnalysisState> = writable({
    vadProbabilities: null,
    vadRegions: null,
    vadPositiveThreshold: 0.5,
    vadNegativeThreshold: 0.35,
});

// Mock the modules
vi.mock("$lib/stores/analysis.store", () => ({
  analysisStore: mockAnalysisStore,
}));

vi.mock("$lib/workers/sileroVad.worker?worker&inline", () => ({
  default: vi.fn().mockImplementation(() => mockVadWorkerInstance),
}));

// --- END: MOCK SETUP ---


describe("AnalysisService", () => {
  let analysisService: typeof import("./analysis.service").default;

  // Helper to simulate a response from the worker
  const simulateWorkerResponse = (messageId: string, type: string, payload: any, isError: boolean = false) => {
    if (mockVadWorkerInstance.onmessage) {
      mockVadWorkerInstance.onmessage({
        data: {
          type,
          payload: isError ? undefined : payload,
          error: isError ? payload : undefined,
          messageId,
        },
      } as MessageEvent);
    }
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    
    // Dynamically import the service to get a fresh instance with mocks applied
    const serviceModule = await import("./analysis.service");
    analysisService = serviceModule.default;

    // Set up global fetch mock for every test
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as Response);
    
    // Reset store to a clean state
    mockAnalysisStore.set({
        vadProbabilities: null, vadRegions: null, vadPositiveThreshold: 0.5, vadNegativeThreshold: 0.35,
    });

    // We must dispose to clear any state from previous tests (like initPromise)
    analysisService.dispose(); 
  });

  afterEach(() => {
    analysisService.dispose();
  });


  describe("initialize", () => {
    
    it("should handle concurrent initialization calls correctly", async () => {
      // Start two initializations. They should both get the same promise.
      const initPromise1 = analysisService.initialize();
      const initPromise2 = analysisService.initialize();
      expect(initPromise1).toBe(initPromise2);

      // Only one fetch and one postMessage should have been called
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(mockVadWorkerInstance.postMessage).toHaveBeenCalledTimes(1);

      // Simulate the worker responding with success
      const initMessageId = mockVadWorkerInstance.postMessage.mock.calls[0][0].messageId;
      simulateWorkerResponse(initMessageId, VAD_WORKER_MSG_TYPE.INIT_SUCCESS, {});
      
      // Await both promises, they should now resolve.
      await expect(initPromise1).resolves.toBeUndefined();
      await expect(initPromise2).resolves.toBeUndefined();
    });

    it("should handle initialization failure from the worker", async () => {
      const initPromise = analysisService.initialize();
      
      // Wait for the postMessage call to happen before trying to access its details
      await vi.waitFor(() => {
          expect(mockVadWorkerInstance.postMessage).toHaveBeenCalled();
      });

      const initMessageId = mockVadWorkerInstance.postMessage.mock.calls[0][0].messageId;
      simulateWorkerResponse(initMessageId, VAD_WORKER_MSG_TYPE.INIT_ERROR, "Model load failed", true);

      await expect(initPromise).rejects.toThrow("Model load failed");
    });
  });


  describe("processVad", () => {
    // Helper to initialize the service before each test in this block
    beforeEach(async () => {
      const initPromise = analysisService.initialize();
      await vi.waitFor(() => expect(mockVadWorkerInstance.postMessage).toHaveBeenCalled());
      const initMessageId = mockVadWorkerInstance.postMessage.mock.calls[0][0].messageId;
      simulateWorkerResponse(initMessageId, VAD_WORKER_MSG_TYPE.INIT_SUCCESS, {});
      await initPromise;
    });

    it("should send PCM data to worker and update store with probabilities", async () => {
      const pcmData = new Float32Array([0.1, 0.2, 0.3]);
      const mockProbs = new Float32Array([0.9, 0.8, 0.7]);
      
      const processPromise = analysisService.processVad(pcmData);

      await vi.waitFor(() => {
          // The first call was INIT, the second should be PROCESS
          expect(mockVadWorkerInstance.postMessage).toHaveBeenCalledTimes(2);
      });
      const processMessageId = mockVadWorkerInstance.postMessage.mock.calls[1][0].messageId;
      
      // Simulate the worker responding with the processed data
      simulateWorkerResponse(processMessageId, VAD_WORKER_MSG_TYPE.PROCESS_RESULT, { probabilities: mockProbs });
      
      await processPromise;

      const finalState = get(mockAnalysisStore);
      expect(finalState.vadProbabilities).toEqual(mockProbs);
      expect(finalState.vadStatus).toBe("VAD analysis complete.");
    });
  });


  describe("recalculateVadRegions", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should correctly calculate and merge speech regions", () => {
      const probabilities = new Float32Array([0.1, 0.8, 0.9, 0.2, 0.1, 0.85, 0.95, 0.3]);
      // Set the store state directly
      mockAnalysisStore.set({
        vadProbabilities: probabilities,
        vadPositiveThreshold: 0.5,
        vadNegativeThreshold: 0.35,
        vadRegions: null
      });

      analysisService.recalculateVadRegions();
      vi.runAllTimers(); // Trigger the debounced function

      const finalState = get(mockAnalysisStore);

      expect(finalState.vadRegions?.length).toBe(1);
      // Recalculate the expected end time more precisely:
      // Last positive frame is at index 6. The end is after this frame.
      // End time = (last_positive_index + 1) * frame_size / sample_rate + padding
      // End time = (6 + 1) * 1536 / 16000 + 0.100 = 7 * 0.096 + 0.1 = 0.672 + 0.1 = 0.772
      expect(finalState.vadRegions?.[0]?.start).toBeCloseTo(0);
      expect(finalState.vadRegions?.[0]?.end).toBeCloseTo(0.772);
    });
  });


  describe("dispose", () => {
    it("should terminate worker and reset state", async () => {
      // Initialize first to ensure there's a worker to terminate
      const initPromise = analysisService.initialize();
      await vi.waitFor(() => expect(mockVadWorkerInstance.postMessage).toHaveBeenCalled());
      const initMessageId = mockVadWorkerInstance.postMessage.mock.calls[0][0].messageId;
      simulateWorkerResponse(initMessageId, VAD_WORKER_MSG_TYPE.INIT_SUCCESS, {});
      await initPromise;

      analysisService.dispose();
      
      expect(mockVadWorkerInstance.terminate).toHaveBeenCalledTimes(1);
      const finalState = get(mockAnalysisStore);
      expect(finalState.vadInitialized).toBe(false);
      expect(finalState.vadStatus).toBe("VAD service disposed.");
    });
  });
});