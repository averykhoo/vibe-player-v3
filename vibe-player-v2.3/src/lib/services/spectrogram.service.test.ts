// vibe-player-v2.3/src/lib/services/spectrogram.service.test.ts
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mocked,
  vi,
} from "vitest";
import SpectrogramWorker from "$lib/workers/spectrogram.worker?worker&inline";
import spectrogramService from "./spectrogram.service";
import { analysisStore } from "$lib/stores/analysis.store";
import { SPEC_WORKER_MSG_TYPE } from "$lib/types/worker.types";

// Mock Svelte stores
vi.mock("$lib/stores/analysis.store", () => ({
  analysisStore: {
    subscribe: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
  },
}));

// Mock Web Workers
const mockSpecWorkerInstance = {
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((event: ErrorEvent | Event | string) => void) | null, // Adjusted to match service
};

vi.mock("$lib/workers/spectrogram.worker?worker&inline", () => ({
  default: vi.fn().mockImplementation(() => mockSpecWorkerInstance),
}));

const mockAudioData = new Float32Array(16000); // Sample audio data

describe("SpectrogramService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Mock global fetch
    vi.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("fft.js")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve("// Mock FFT script content"),
        } as Response);
      }
      return Promise.reject(new Error(`Unhandled fetch in test: ${url}`));
    });

    // Reset worker instance mocks
    mockSpecWorkerInstance.postMessage.mockClear();
    mockSpecWorkerInstance.terminate.mockClear();
    mockSpecWorkerInstance.onmessage = null;
    mockSpecWorkerInstance.onerror = null;

    // Reset store mocks
    (analysisStore.update as Mocked<any>).mockClear();
    (analysisStore.set as Mocked<any>).mockClear();

    spectrogramService.dispose();
  });

  afterEach(() => {
    spectrogramService.dispose();
    vi.useRealTimers();
  });

  describe("initialize", () => {
    it("should create Spectrogram worker, post INIT message, and update store", async () => {
      const initializePromise = spectrogramService.initialize({
        sampleRate: 16000,
      });

      expect(SpectrogramWorker).toHaveBeenCalledTimes(1);
      expect(analysisStore.update).toHaveBeenCalledWith(expect.any(Function));
      await vi.runAllTimersAsync();

      // --- FIX: Check the INIT call without the transfer list ---
      expect(mockSpecWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: SPEC_WORKER_MSG_TYPE.INIT }),
        expect.any(Array), // This is the fix
      );
      // --- END OF FIX ---

      if (mockSpecWorkerInstance.postMessage.mock.calls.length === 0) {
        throw new Error(
          "mockSpecWorkerInstance.postMessage was not called by initialize().",
        );
      }
      const initMessageId =
        mockSpecWorkerInstance.postMessage.mock.calls[0][0].messageId;

      if (mockSpecWorkerInstance.onmessage) {
        mockSpecWorkerInstance.onmessage({
          data: {
            type: SPEC_WORKER_MSG_TYPE.INIT_SUCCESS,
            payload: {},
            messageId: initMessageId,
          },
        } as MessageEvent);
      } else {
        throw new Error(
          "mockSpecWorkerInstance.onmessage is not set up for INIT_SUCCESS simulation.",
        );
      }

      await initializePromise;
      await Promise.resolve();

      const updateCalls = (analysisStore.update as Mocked<any>).mock.calls;
      let initializedUpdateCall = null;
      for (let i = updateCalls.length - 1; i >= 0; i--) {
        const mockStatePreview = {
          spectrogramStatus: "",
          spectrogramInitialized: false,
          spectrogramError: "previous error",
        };
        const resultingState = updateCalls[i][0](mockStatePreview);
        if (
          resultingState.spectrogramStatus === "Initialized" &&
          resultingState.spectrogramInitialized === true
        ) {
          initializedUpdateCall = updateCalls[i][0];
          break;
        }
      }

      expect(initializedUpdateCall).not.toBeNull(
        "Could not find store update setting status to 'Initialized'.",
      );

      if (initializedUpdateCall) {
        const mockState = {
          spectrogramStatus: "Initializing",
          spectrogramInitialized: false,
          spectrogramError: "some error",
        };
        const newState = initializedUpdateCall(mockState);
        expect(newState.spectrogramStatus).toBe("Initialized");
        expect(newState.spectrogramInitialized).toBe(true);
        expect(newState.spectrogramError).toBeNull();
      }
    });

    // ... other initialize tests remain the same ...
    it("should update analysisStore on INIT_ERROR from worker message", async () => {
      const initPromise = spectrogramService.initialize({ sampleRate: 16000 });
      await vi.runAllTimersAsync();
      const initMessageId =
        mockSpecWorkerInstance.postMessage.mock.calls[0][0].messageId;
      if (mockSpecWorkerInstance.onmessage) {
        mockSpecWorkerInstance.onmessage({
          data: {
            type: SPEC_WORKER_MSG_TYPE.INIT_ERROR,
            error: "Init failed in worker",
            messageId: initMessageId,
          },
        } as MessageEvent);
      }
      await expect(initPromise).rejects.toMatch("Init failed in worker");
      const lastUpdateCall = (
        analysisStore.update as Mocked<any>
      ).mock.calls.pop();
      const newState = lastUpdateCall[0]({
        spectrogramError: null,
        spectrogramInitialized: true,
      });
      expect(newState.spectrogramError).toContain("Init failed in worker");
      expect(newState.spectrogramInitialized).toBe(false);
    });
  });

  describe("process", () => {
    beforeEach(async () => {
      const initPromise = spectrogramService.initialize({ sampleRate: 16000 });
      await vi.runAllTimersAsync();
      const initMessageId =
        mockSpecWorkerInstance.postMessage.mock.calls[0][0].messageId;
      if (mockSpecWorkerInstance.onmessage) {
        mockSpecWorkerInstance.onmessage({
          data: {
            type: SPEC_WORKER_MSG_TYPE.INIT_SUCCESS,
            payload: {},
            messageId: initMessageId,
          },
        } as MessageEvent);
      }
      await initPromise;
      (analysisStore.update as Mocked<any>).mockClear();
    });

    it("should post PROCESS message and update store on success", async () => {
      const processPromise = spectrogramService.process(mockAudioData);
      await vi.runAllTimersAsync();

      // --- FIX: This is the key change to fix the giant log ---
      // We verify the structure of the payload without comparing the huge array by reference.
      expect(mockSpecWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: SPEC_WORKER_MSG_TYPE.PROCESS,
          payload: expect.objectContaining({
            audioData: expect.any(Float32Array),
          }),
        }),
        // Also check that the transfer list is being used correctly.
        [expect.any(ArrayBuffer)],
      );
      // --- END OF FIX ---

      const processCall = mockSpecWorkerInstance.postMessage.mock.calls.find(
        (call) => call[0].type === SPEC_WORKER_MSG_TYPE.PROCESS,
      );
      if (!processCall)
        throw new Error("PROCESS message not found in postMessage calls");
      const processMessageId = processCall[0].messageId;

      const mockResultPayload = { magnitudes: [new Float32Array([1, 2, 3])] };
      if (mockSpecWorkerInstance.onmessage) {
        mockSpecWorkerInstance.onmessage({
          data: {
            type: SPEC_WORKER_MSG_TYPE.PROCESS_RESULT,
            payload: mockResultPayload,
            messageId: processMessageId,
          },
        } as MessageEvent);
      }
      await processPromise;
      await Promise.resolve();

      const updateCalls = (analysisStore.update as Mocked<any>).mock.calls;
      expect(updateCalls.length).toBeGreaterThanOrEqual(2);

      const dataUpdateState = updateCalls[updateCalls.length - 2][0]({
        spectrogramData: null,
      });
      expect(dataUpdateState.spectrogramData).toEqual(
        mockResultPayload.magnitudes,
      );

      const statusUpdateState = updateCalls[updateCalls.length - 1][0]({});
      expect(statusUpdateState.spectrogramStatus).toBe("Processing complete.");
    });

    // ... other process tests remain the same ...
    it("should update store on PROCESS_ERROR from worker", async () => {
      const processPromise = spectrogramService.process(mockAudioData);
      await vi.runAllTimersAsync();
      const processCall = mockSpecWorkerInstance.postMessage.mock.calls.find(
        (call) => call[0].type === SPEC_WORKER_MSG_TYPE.PROCESS,
      );
      const processMessageId = processCall[0].messageId;
      if (mockSpecWorkerInstance.onmessage) {
        mockSpecWorkerInstance.onmessage({
          data: {
            type: SPEC_WORKER_MSG_TYPE.PROCESS_ERROR,
            error: "Processing failed in worker",
            messageId: processMessageId,
          },
        } as MessageEvent);
      }
      await expect(processPromise).rejects.toMatch(
        "Processing failed in worker",
      );
      const lastUpdateCall = (
        analysisStore.update as Mocked<any>
      ).mock.calls.pop();
      const newState = lastUpdateCall[0]({
        spectrogramStatus: "",
        spectrogramError: null,
      });
      expect(newState.spectrogramStatus).toBe("Processing failed.");
      expect(newState.spectrogramError).toContain(
        "Processing failed in worker",
      );
    });
  });

  // ... dispose tests remain the same ...
  describe("dispose", () => {
    it("should terminate worker and update store", async () => {
      const initPromise = spectrogramService.initialize({ sampleRate: 16000 });
      await vi.runAllTimersAsync();
      const initMessageId =
        mockSpecWorkerInstance.postMessage.mock.calls[0][0].messageId;
      if (mockSpecWorkerInstance.onmessage) {
        mockSpecWorkerInstance.onmessage({
          data: {
            type: SPEC_WORKER_MSG_TYPE.INIT_SUCCESS,
            payload: {},
            messageId: initMessageId,
          },
        } as MessageEvent);
      }
      await initPromise;
      (analysisStore.update as Mocked<any>).mockClear();

      spectrogramService.dispose();

      expect(mockSpecWorkerInstance.terminate).toHaveBeenCalledTimes(1);
      expect(analysisStore.update).toHaveBeenCalledTimes(1);
      const newState = (analysisStore.update as Mocked<any>).mock.calls[0][0](
        {},
      );
      expect(newState.spectrogramStatus).toBe("Disposed");
    });
  });
});
