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
    it("should handle concurrent initialization calls correctly", async () => {
      vi.useFakeTimers();
      let initPromise1, initPromise2;
      let resolveWorkerInit;

      // Wrap the worker's onmessage to control when INIT_SUCCESS is sent
      mockVadWorkerInstance.onmessage = (event) => {
        if (event.data.type === VAD_WORKER_MSG_TYPE.INIT_SUCCESS) {
          resolveWorkerInit();
        }
      };

      // Call initialize twice, concurrently
      initPromise1 = analysisService.initialize();
      initPromise2 = analysisService.initialize();

      // Assert that only ONE initialization process was started
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Both promises should be the same instance
      expect(initPromise1).toBe(initPromise2);

      // Now, simulate the worker finishing its setup
      const workerInitSignal = new Promise<void>((res) => {
        resolveWorkerInit = res;
      });
      vi.runAllTimers(); // Let promises proceed
      await workerInitSignal;

      // Both promises should resolve
      await expect(initPromise1).resolves.toBeUndefined();
      await expect(initPromise2).resolves.toBeUndefined();
    });

    it("should handle initialization failure from the worker", async () => {
      const initPromise = analysisService.initialize();
      const initMessageId = mockVadWorkerInstance.postMessage.mock.calls[0][0].messageId;

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
    // Helper to fully initialize the service for these tests
    async function initializeService() {
      const initPromise = analysisService.initialize();
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
      };
      (get as vi.Mock).mockReturnValue(state);

      analysisService.recalculateVadRegions();
      vi.runAllTimers(); // Trigger the debounced function

      const updateCall = (analysisStore.update as vi.Mock).mock.calls[0][0];
      const newState = updateCall(state);
      
      // Explanation of expected result:
      // Frame 1 (0.8) and 2 (0.9) are speech.
      // Frame 5 (0.85) and 6 (0.95) are speech.
      // With padding (100ms = 1.66 frames at 16kHz/1536 samples), the two regions merge.
      // Let's assume a simplified frame time for clarity: frame time = index * (1536/16000) = index * 0.096s
      // Region 1: [1*0.096, 3*0.096] -> [0.096, 0.288]. Padded: [-0.004, 0.388] -> [0, 0.388]
      // Region 2: [5*0.096, 7*0.096] -> [0.480, 0.672]. Padded: [0.380, 0.772]
      // They overlap, so they merge into one region.
      // Final region should be approximately [0, 0.772]
      expect(newState.vadRegions.length).toBe(1);
      expect(newState.vadRegions[0].start).toBeCloseTo(0);
      expect(newState.vadRegions[0].end).toBeCloseTo(0.768); // (7 * 1536 / 16000) + 0.1
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