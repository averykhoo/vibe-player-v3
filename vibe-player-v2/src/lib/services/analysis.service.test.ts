// vibe-player-v2/src/lib/services/analysis.service.test.ts (FIXED)

import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import SileroVadWorker from '$lib/workers/sileroVad.worker?worker&inline';
import analysisService from "./analysis.service";
import { analysisStore } from "$lib/stores/analysis.store";
import { VAD_WORKER_MSG_TYPE } from "$lib/types/worker.types";

// Mock Svelte stores
vi.mock("$lib/stores/analysis.store", () => ({
  analysisStore: { subscribe: vi.fn(), set: vi.fn(), update: vi.fn() },
}));

// Mock Web Workers
const mockVadWorkerInstance = {
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((event: ErrorEvent) => void) | null,
};

vi.mock("$lib/workers/sileroVad.worker?worker&inline", () => ({
  default: vi.fn().mockImplementation(() => mockVadWorkerInstance),
}));

describe("AnalysisService (VAD Only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVadWorkerInstance.postMessage.mockClear();
    mockVadWorkerInstance.terminate.mockClear();
    mockVadWorkerInstance.onmessage = null;
    mockVadWorkerInstance.onerror = null;
    (analysisStore.update as Mocked<any>).mockClear();
    (analysisStore.set as Mocked<any>).mockClear();
    analysisService.dispose();
  });

  afterEach(() => {
    analysisService.dispose();
  });

  describe("initialize (VAD)", () => {
    it("should create VAD worker and post INIT message", async () => {
        // Make the test function async and await the initialize method.
        // This will pause the test until the fetch() and arrayBuffer() promises resolve.
        // We also need to mock the global fetch
        global.fetch = vi.fn(() =>
          Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)), // Mock ArrayBuffer
          } as Response)
        );

        await analysisService.initialize();

        // Now that initialize() has completed, we can safely check the result.
        expect(SileroVadWorker).toHaveBeenCalledTimes(1);

        // Check that postMessage was called with the correct message type
        // and a payload containing the modelBuffer.
        expect(mockVadWorkerInstance.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: VAD_WORKER_MSG_TYPE.INIT,
            payload: expect.objectContaining({
              modelBuffer: expect.any(ArrayBuffer), // We just care that a buffer was passed.
            }),
          }),
          // Also check that the buffer was passed in the transfer list
          [expect.any(ArrayBuffer)]
        );
    });
  });

  describe("dispose", () => {
    it("should terminate the VAD worker and update store status", async () => {
      const initPromise = analysisService.initialize();
      if (mockVadWorkerInstance.onmessage) {
        mockVadWorkerInstance.onmessage!({ data: { type: VAD_WORKER_MSG_TYPE.INIT_SUCCESS, messageId: "vad_msg_0" } } as MessageEvent);
      }
      await initPromise;

      const vadTerminateSpy = vi.spyOn(mockVadWorkerInstance, 'terminate');
      analysisService.dispose();
      expect(vadTerminateSpy).toHaveBeenCalledTimes(1);
    });
  });
});
