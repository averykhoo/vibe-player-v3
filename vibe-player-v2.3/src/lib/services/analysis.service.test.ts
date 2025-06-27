// vibe-player-v2.3/src/lib/services/analysis.service.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { AnalysisState } from "$lib/types/analysis.types";
import { VAD_CONSTANTS } from "$lib/utils";
import { VAD_WORKER_MSG_TYPE } from "$lib/types/worker.types";

const mockVadWorkerInstance = {
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((event: ErrorEvent) => void) | null,
};

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

describe("AnalysisService", () => {
  let analysisService: typeof import("./analysis.service").default;
  let analysisStore: typeof import("../stores/analysis.store").analysisStore;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    const serviceModule = await import("./analysis.service");
    analysisService = serviceModule.default;
    const storeModule = await import("../stores/analysis.store");
    analysisStore = storeModule.analysisStore;

    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as Response);

    analysisService.dispose();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initialize", () => {
    // --- START OF FIX: This test is now async ---
    it("should handle concurrent initialization calls correctly", async () => {
      let initPromise1, initPromise2;
      
      // Call initialize twice, concurrently
      initPromise1 = analysisService.initialize();
      initPromise2 = analysisService.initialize();

      // Assert that both calls return the exact same promise object,
      // proving the idempotency logic is working.
      expect(initPromise1).toBe(initPromise2);
      
      // Allow microtasks to run (i.e., let the async _doInitialize method execute)
      await new Promise(resolve => setImmediate(resolve));
      
      // Now that the async work has started, check that the underlying
      // initialization logic was only triggered once.
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(mockVadWorkerInstance.postMessage).toHaveBeenCalledTimes(1);

      // Simulate the worker responding with success
      const initMessageId = mockVadWorkerInstance.postMessage.mock.calls[0][0].messageId;
      mockVadWorkerInstance.onmessage!({
        data: { type: VAD_WORKER_MSG_TYPE.INIT_SUCCESS, messageId: initMessageId },
      } as MessageEvent);

      // Both original promises should now resolve successfully.
      await expect(initPromise1).resolves.toBeUndefined();
      await expect(initPromise2).resolves.toBeUndefined();
    });
    // --- END OF FIX ---

    it("should handle initialization failure from the worker", async () => {
      const initPromise = analysisService.initialize();

      // Allow async tasks to run so postMessage is called
      await new Promise(resolve => setImmediate(resolve));

      const initMessageId = mockVadWorkerInstance.postMessage.mock.calls[0][0].messageId;

      // Simulate worker failure
      mockVadWorkerInstance.onmessage!({
        data: {
          type: VAD_WORKER_MSG_TYPE.INIT_ERROR,
          error: "Model load failed",
          messageId: initMessageId,
        },
      } as MessageEvent);

      await expect(initPromise).rejects.toThrow("Model load failed");
    });
  });

  describe("processVad", () => {
    async function initializeService() {
      const initPromise = analysisService.initialize();
      // Allow async tasks to run
      await new Promise(resolve => setImmediate(resolve));
      const initMessageId = mockVadWorkerInstance.postMessage.mock.calls[0][0].messageId;
      mockVadWorkerInstance.onmessage!({
        data: { type: VAD_WORKER_MSG_TYPE.INIT_SUCCESS, messageId: initMessageId },
      } as MessageEvent);
      await initPromise;
    }

    it("should send PCM data to worker and update store with probabilities", async () => {
      await initializeService();
      const pcmData = new Float32Array([0.1, 0.2, 0.3]);
      const mockProbs = new Float32Array([0.9, 0.8, 0.7]);
      const processPromise = analysisService.processVad(pcmData);
      
      // Allow async tasks to run
      await new Promise(resolve => setImmediate(resolve));

      const processMessageId = mockVadWorkerInstance.postMessage.mock.calls[1][0].messageId;

      mockVadWorkerInstance.onmessage!({
        data: {
          type: VAD_WORKER_MSG_TYPE.PROCESS_RESULT,
          payload: { probabilities: mockProbs },
          messageId: processMessageId
        },
      } as MessageEvent);

      await processPromise;
      
      const lastUpdateCall = (analysisStore.update as vi.Mock).mock.calls.pop()[0];
      const finalState = lastUpdateCall(get(analysisStore));

      expect(finalState.vadProbabilities).toEqual(mockProbs);
      expect(finalState.vadStatus).toBe("VAD analysis complete.");
    });
  });

  describe("recalculateVadRegions", () => {
    it("should correctly calculate and merge speech regions", () => {
      vi.useFakeTimers();
      const probabilities = new Float32Array([0.1, 0.8, 0.9, 0.2, 0.1, 0.85, 0.95, 0.3]);
      const state: AnalysisState = {
        vadProbabilities: probabilities,
        vadPositiveThreshold: 0.5,
        vadNegativeThreshold: 0.35,
        vadRegions: null,
        vadInitialized: true, // Assuming it's initialized
        spectrogramData: null,
      };
      (get as vi.Mock).mockReturnValue(state);

      analysisService.recalculateVadRegions();
      vi.runAllTimers();

      const updateCall = (analysisStore.update as vi.Mock).mock.calls[0][0];
      const newState = updateCall(state);
      
      expect(newState.vadRegions.length).toBe(1);
      expect(newState.vadRegions[0].start).toBeCloseTo(0);
      expect(newState.vadRegions[0].end).toBeCloseTo(0.768);
    });
  });

  describe("dispose", () => {
    it("should terminate worker and reset state", async () => {
      await analysisService.initialize();
      analysisService.dispose();
      expect(mockVadWorkerInstance.terminate).toHaveBeenCalledTimes(1);
      const lastUpdate = (analysisStore.update as vi.Mock).mock.calls.pop()[0];
      const finalState = lastUpdate({});
      expect(finalState.vadInitialized).toBe(false);
      expect(finalState.vadStatus).toBe("VAD service disposed.");
    });
  });
});