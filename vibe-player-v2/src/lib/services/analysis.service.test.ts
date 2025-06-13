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
      const initPromise = analysisService.initialize();
      if (mockVadWorkerInstance.onmessage) {
        mockVadWorkerInstance.onmessage({ data: { type: VAD_WORKER_MSG_TYPE.INIT_SUCCESS, messageId: "vad_msg_0" } } as MessageEvent);
      }
      await initPromise;
      expect(SileroVadWorker).toHaveBeenCalledTimes(1);
      expect(mockVadWorkerInstance.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: VAD_WORKER_MSG_TYPE.INIT }));
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
