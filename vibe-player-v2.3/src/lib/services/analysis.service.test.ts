// vibe-player-v2.3/src/lib/services/analysis.service.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, type Writable } from "svelte/store";
import type { AnalysisState } from "$lib/types/analysis.types";
import { VAD_WORKER_MSG_TYPE } from "$lib/types/worker.types";

// --- START: CORRECTED STORE MOCKING ---

// 1. Hoist a variable to hold our real, writable store instance.
let mockAnalysisStoreInstance: Writable<AnalysisState>;

// 2. Mock the store module. This factory function will be called by Vitest.
vi.mock("$lib/stores/analysis.store", async () => {
  // Import the REAL `writable` function from the actual svelte/store library.
  const { writable } = await vi.importActual<typeof import("svelte/store")>("svelte/store");

  // Define a complete initial state that matches the AnalysisState type.
  const initialAnalysisStateForMock: AnalysisState = {
    vadStatus: "idle",
    lastVadResult: null,
    isSpeaking: undefined,
    vadStateResetted: undefined,
    vadError: null,
    vadInitialized: false,
    vadPositiveThreshold: 0.5,
    vadNegativeThreshold: 0.35,
    vadProbabilities: null,
    vadRegions: null,
    spectrogramStatus: "idle",
    spectrogramError: null,
    spectrogramData: null,
    spectrogramInitialized: false,
    isLoading: false,
  };

  // Create a genuine writable store. This instance will be used by the service.
  mockAnalysisStoreInstance = writable(initialAnalysisStateForMock);

  // Spy on the .update method so we can check if it was called.
  vi.spyOn(mockAnalysisStoreInstance, 'update');

  // The mock module must export an object with the same shape as the real module.
  return {
    analysisStore: mockAnalysisStoreInstance,
  };
});

// 3. Mock the worker.
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


// Import the service *after* all mocks are defined.
describe("AnalysisService", () => {
  let analysisService: typeof import("./analysis.service").default;
  let analysisStore: typeof import("../stores/analysis.store").analysisStore;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers(); // Use fake timers for controlling debounce

    // Re-import the service to get a fresh instance with our mocks.
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
    // Restore real timers after each test to prevent pollution.
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe("initialize", () => {
    // This test was already passing but is kept for completeness.
    it("should handle concurrent initialization calls correctly", async () => {
      console.log("[TEST LOG] Running: should handle concurrent initialization calls correctly");
      let initPromise1, initPromise2;

      initPromise1 = analysisService.initialize();
      initPromise2 = analysisService.initialize();

      expect(initPromise1).toBe(initPromise2);

      await new Promise(resolve => setImmediate(resolve));

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(mockVadWorkerInstance.postMessage).toHaveBeenCalledTimes(1);

      const initMessageId = mockVadWorkerInstance.postMessage.mock.calls[0][0].messageId;
      mockVadWorkerInstance.onmessage!({
        data: { type: VAD_WORKER_MSG_TYPE.INIT_SUCCESS, messageId: initMessageId },
      } as MessageEvent);

      await expect(initPromise1).resolves.toBeUndefined();
      await expect(initPromise2).resolves.toBeUndefined();
      console.log("[TEST LOG] PASSED: should handle concurrent initialization calls correctly");
    });

    // This test was also passing.
    it("should handle initialization failure from the worker", async () => {
      console.log("[TEST LOG] Running: should handle initialization failure from the worker");
      const initPromise = analysisService.initialize();
      await new Promise(resolve => setImmediate(resolve));
      const initMessageId = mockVadWorkerInstance.postMessage.mock.calls[0][0].messageId;

      mockVadWorkerInstance.onmessage!({
        data: {
          type: VAD_WORKER_MSG_TYPE.INIT_ERROR,
          error: "Model load failed",
          messageId: initMessageId,
        },
      } as MessageEvent);

      await expect(initPromise).rejects.toThrow("Model load failed");
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
      mockVadWorkerInstance.onmessage!({
        data: {
          type: VAD_WORKER_MSG_TYPE.PROCESS_RESULT,
          payload: { probabilities: mockProbs },
          messageId: processMessageId
        },
      } as MessageEvent);

      await processPromise;

      // FIX: The `analysisStore.update` has been spied upon. We check its calls.
      const updateCalls = (analysisStore.update as vi.Mock).mock.calls;
      // The service calls `update` multiple times. We are interested in the final states.
      // 1. "Analyzing...", 2. Probabilities set, 3. Regions recalculated.
      expect(updateCalls.length).toBeGreaterThanOrEqual(2);

      // Get the updater function from the call where probabilities were set
      const probabilitiesUpdateFn = updateCalls[1][0];
      // Test this updater function with a known state
      const stateAfterProbs = probabilitiesUpdateFn({ vadProbabilities: null });
      expect(stateAfterProbs.vadProbabilities).toEqual(mockProbs);

      console.log("[TEST LOG] PASSED: should send PCM data to worker and update store");
    });
  });

  describe("recalculateVadRegions", () => {
    it("should correctly calculate and merge speech regions", () => {
      console.log("[TEST LOG] Running: should correctly calculate and merge speech regions");
      const probabilities = new Float32Array([0.1, 0.8, 0.9, 0.2, 0.1, 0.85, 0.95, 0.3]);

      // FIX: Set the state on the real store mock instead of trying to mock `get`.
      const state: AnalysisState = {
        vadProbabilities: probabilities,
        vadPositiveThreshold: 0.5,
        vadNegativeThreshold: 0.35,
        vadRegions: null,
        vadInitialized: true,
        spectrogramData: null,
        // Fill other required fields from the type
        vadStatus: 'idle',
        lastVadResult: null,
        isSpeaking: false,
        vadStateResetted: false,
        vadError: null,
        spectrogramStatus: 'idle',
        spectrogramError: null,
        spectrogramInitialized: false,
        isLoading: false
      };
      console.log("[TEST LOG] Setting mock store state before calling recalculateVadRegions");
      mockAnalysisStoreInstance.set(state);

      analysisService.recalculateVadRegions();

      console.log("[TEST LOG] Advancing timers to trigger debounced function");
      vi.runAllTimers();

      // Assert that the store's `update` method was called.
      expect(analysisStore.update).toHaveBeenCalled();
      const lastUpdateCall = (analysisStore.update as vi.Mock).mock.calls.pop()[0];
      const newState = lastUpdateCall(state); // Pass a known state to the updater function

      expect(newState.vadRegions.length).toBe(1);
      expect(newState.vadRegions[0].start).toBeCloseTo(0);
      expect(newState.vadRegions[0].end).toBeCloseTo(0.768);
      console.log("[TEST LOG] PASSED: should correctly calculate and merge speech regions");
    });
  });

  describe("dispose", () => {
    it("should terminate worker and reset state", async () => {
      console.log("[TEST LOG] Running: should terminate worker and reset state");
      await analysisService.initialize();
      analysisService.dispose();

      expect(mockVadWorkerInstance.terminate).toHaveBeenCalledTimes(1);

      // Check the final state update from the dispose method
      const lastUpdateCall = (analysisStore.update as vi.Mock).mock.calls.pop()[0];
      const finalState = lastUpdateCall({}); // Call updater with empty state to see what it sets

      expect(finalState.vadInitialized).toBe(false);
      expect(finalState.vadStatus).toBe("VAD service disposed.");
      console.log("[TEST LOG] PASSED: should terminate worker and reset state");
    });
  });
});