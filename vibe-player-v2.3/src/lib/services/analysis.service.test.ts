// vibe-player-v2.3/src/lib/services/analysis.service.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, type Writable } from "svelte/store";
import type { AnalysisState } from "$lib/types/analysis.types";
import { VAD_WORKER_MSG_TYPE } from "$lib/types/worker.types";

// --- START: CORRECTED STORE MOCKING (No changes here, this part is correct) ---

let mockAnalysisStoreInstance: Writable<AnalysisState>;

vi.mock("$lib/stores/analysis.store", async () => {
  const { writable } = await vi.importActual<typeof import("svelte/store")>("svelte/store");
  const initialAnalysisStateForMock: AnalysisState = {
    vadStatus: "idle", lastVadResult: null, isSpeaking: undefined, vadStateResetted: undefined,
    vadError: null, vadInitialized: false, vadPositiveThreshold: 0.5, vadNegativeThreshold: 0.35,
    vadProbabilities: null, vadRegions: null, spectrogramStatus: "idle", spectrogramError: null,
    spectrogramData: null, spectrogramInitialized: false, isLoading: false,
  };
  mockAnalysisStoreInstance = writable(initialAnalysisStateForMock);
  return { analysisStore: mockAnalysisStoreInstance };
});

const mockVadWorkerInstance = {
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((event: ErrorEvent) => void) | null,
};

vi.mock("$lib/workers/sileroVad.worker?worker&inline", () => ({
  default: vi.fn().mockImplementation(() => mockVadWorkerInstance),
}));

// --- END: CORRECTED STORE MOCKING ---


describe("AnalysisService", () => {
  let analysisService: typeof import("./analysis.service").default;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // IMPORTANT: Keep real timers for this test file. The async nature of promises
    // and message passing works better without faking timers. The debounce in
    // `recalculateVadRegions` can be tested by waiting with `tick()`.
    // We will use fake timers only within the one test that needs it.

    const serviceModule = await import("./analysis.service");
    analysisService = serviceModule.default;

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

  // --- START: CORRECTED TESTS ---

  describe("initialize", () => {
    it("should handle concurrent initialization calls correctly", async () => {
      console.log("[TEST LOG] Running: should handle concurrent initialization calls correctly");
      let initPromise1, initPromise2;

      initPromise1 = analysisService.initialize();
      initPromise2 = analysisService.initialize();

      expect(initPromise1).toBe(initPromise2);

      // Let the promise chain start
      await new Promise(resolve => setImmediate(resolve));

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(mockVadWorkerInstance.postMessage).toHaveBeenCalledTimes(1);

      // FIX: Trigger the ACTUAL onmessage handler assigned by the service
      const initMessageId = mockVadWorkerInstance.postMessage.mock.calls[0][0].messageId;
      mockVadWorkerInstance.onmessage!({ // The `!` asserts that onmessage is not null
        data: { type: VAD_WORKER_MSG_TYPE.INIT_SUCCESS, messageId: initMessageId },
      } as MessageEvent);

      await expect(initPromise1).resolves.toBeUndefined();
      await expect(initPromise2).resolves.toBeUndefined();

      const finalState = get(mockAnalysisStoreInstance);
      expect(finalState.vadInitialized).toBe(true);
      expect(finalState.vadStatus).toBe("VAD service initialized.");
      console.log("[TEST LOG] PASSED: should handle concurrent initialization calls correctly");
    });

    it("should handle initialization failure from the worker", async () => {
      console.log("[TEST LOG] Running: should handle initialization failure from the worker");
      const initPromise = analysisService.initialize();
      await new Promise(resolve => setImmediate(resolve));
      const initMessageId = mockVadWorkerInstance.postMessage.mock.calls[0][0].messageId;

      // FIX: Trigger the ACTUAL onmessage handler
      mockVadWorkerInstance.onmessage!({
        data: {
          type: VAD_WORKER_MSG_TYPE.INIT_ERROR,
          error: "Model load failed",
          messageId: initMessageId,
        },
      } as MessageEvent);

      await expect(initPromise).rejects.toThrow("Model load failed");

      const finalState = get(mockAnalysisStoreInstance);
      expect(finalState.vadInitialized).toBe(false);
      expect(finalState.vadError).toContain("Model load failed");
      console.log("[TEST LOG] PASSED: should handle initialization failure from the worker");
    });
  });

  describe("processVad", () => {
    async function initializeService() {
      const initPromise = analysisService.initialize();
      await new Promise(resolve => setImmediate(resolve));
      const initMessageId = mockVadWorkerInstance.postMessage.mock.calls[0][0].messageId;
      mockVadWorkerInstance.onmessage!({
        data: { type: VAD_WORKER_MSG_TYPE.INIT_SUCCESS, messageId: initMessageId },
      } as MessageEvent);
      await initPromise;
    }

    it("should send PCM data to worker and update store with probabilities", async () => {
      console.log("[TEST LOG] Running: should send PCM data to worker and update store");
      await initializeService();
      const pcmData = new Float32Array([0.1, 0.2, 0.3]);
      const mockProbs = new Float32Array([0.9, 0.8, 0.7]);
      const processPromise = analysisService.processVad(pcmData);

      await new Promise(resolve => setImmediate(resolve));

      const processMessageId = mockVadWorkerInstance.postMessage.mock.calls[1][0].messageId;

      console.log("[TEST LOG] Simulating worker response for PROCESS_RESULT");
      // FIX: Trigger the ACTUAL onmessage handler
      mockVadWorkerInstance.onmessage!({
        data: {
          type: VAD_WORKER_MSG_TYPE.PROCESS_RESULT,
          payload: { probabilities: mockProbs },
          messageId: processMessageId
        },
      } as MessageEvent);

      await processPromise;

      // Let the debounced recalculateVadRegions run. We need fake timers for this one part.
      vi.useFakeTimers();
      vi.runAllTimers();
      vi.useRealTimers();

      const finalState = get(mockAnalysisStoreInstance);
      expect(finalState.vadProbabilities).toEqual(mockProbs);
      expect(finalState.vadStatus).toBe("VAD analysis complete.");
      console.log("[TEST LOG] PASSED: should send PCM data to worker and update store");
    });
  });

  describe("recalculateVadRegions", () => {
    it("should correctly calculate and merge speech regions", async () => {
      console.log("[TEST LOG] Running: should correctly calculate and merge speech regions");
      // Use fake timers ONLY for this test.
      vi.useFakeTimers();

      const probabilities = new Float32Array([0.1, 0.8, 0.9, 0.2, 0.1, 0.85, 0.95, 0.3]);

      const initialState: AnalysisState = {
        ...get(mockAnalysisStoreInstance),
        vadProbabilities: probabilities,
        vadPositiveThreshold: 0.5,
        vadNegativeThreshold: 0.35,
        vadInitialized: true,
      };
      console.log("[TEST LOG] Setting mock store state before calling recalculateVadRegions");
      mockAnalysisStoreInstance.set(initialState);

      analysisService.recalculateVadRegions();

      console.log("[TEST LOG] Advancing timers to trigger debounced function");
      vi.runAllTimers();

      const finalState = get(mockAnalysisStoreInstance);
      expect(finalState.vadRegions).not.toBeNull();
      expect(finalState.vadRegions!.length).toBe(1);
      expect(finalState.vadRegions![0].start).toBeCloseTo(0);
      expect(finalState.vadRegions![0].end).toBeCloseTo(0.768);
      console.log("[TEST LOG] PASSED: should correctly calculate and merge speech regions");
    });
  });

  describe("dispose", () => {
    it("should terminate worker and reset state", async () => {
      console.log("[TEST LOG] Running: should terminate worker and reset state");
      // Initialize the service so there's a worker to terminate.
      const initPromise = analysisService.initialize();
      await new Promise(resolve => setImmediate(resolve));
      const initMessageId = mockVadWorkerInstance.postMessage.mock.calls[0][0].messageId;
      mockVadWorkerInstance.onmessage!({
        data: { type: VAD_WORKER_MSG_TYPE.INIT_SUCCESS, messageId: initMessageId },
      } as MessageEvent);
      await initPromise;

      analysisService.dispose();

      expect(mockVadWorkerInstance.terminate).toHaveBeenCalledTimes(1);

      const finalState = get(mockAnalysisStoreInstance);
      expect(finalState.vadInitialized).toBe(false);
      expect(finalState.vadStatus).toBe("VAD service disposed.");
      console.log("[TEST LOG] PASSED: should terminate worker and reset state");
    });
  });
});