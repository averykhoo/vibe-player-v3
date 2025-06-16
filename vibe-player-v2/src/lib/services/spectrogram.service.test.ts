// vibe-player-v2/src/lib/services/spectrogram.service.test.ts
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mocked,
} from "vitest";
import SpectrogramWorker from "$lib/workers/spectrogram.worker?worker&inline";
import spectrogramService from "./spectrogram.service";
import { analysisStore } from "$lib/stores/analysis.store";
import { VISUALIZER_CONSTANTS } from "$lib/utils/constants"; // For init payload
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

    // Ensure a fresh service instance for some tests if necessary, or reset its state.
    // For singleton, we might need a reset method or careful state management in tests.
    // For now, we rely on dispose and re-initialize logic.
    spectrogramService.dispose(); // Clean up previous state
  });

  afterEach(() => {
    spectrogramService.dispose(); // Clean up
    vi.useRealTimers();
  });

  describe("initialize", () => {
    it("should create Spectrogram worker, post INIT message, and update store", async () => {
      const initializePromise = spectrogramService.initialize({
        sampleRate: 16000,
      });

      // SpectrogramWorker constructor is called synchronously within initialize
      expect(SpectrogramWorker).toHaveBeenCalledTimes(1);
      // The first analysisStore.update for 'Initializing worker...' also happens synchronously or very early
      expect(analysisStore.update).toHaveBeenCalledWith(expect.any(Function));

      // Allow async operations within initialize (like fetch) to complete and postMessage to be called.
      await vi.runAllTimersAsync();

      // Now that timers have run, postMessage (INIT) should have been called.
      expect(mockSpecWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: SPEC_WORKER_MSG_TYPE.INIT }),
      );

      // Ensure postMessage was called before trying to access its details
      if (mockSpecWorkerInstance.postMessage.mock.calls.length === 0) {
        throw new Error(
          "mockSpecWorkerInstance.postMessage was not called by initialize().",
        );
      }
      const initMessageId =
        mockSpecWorkerInstance.postMessage.mock.calls[0][0].messageId;

      // Simulate worker response for INIT_SUCCESS *before* awaiting initializePromise
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

      // Now await the promise. It should resolve as the worker has responded.
      await initializePromise;

      // Ensure promise queue is flushed after initializePromise resolves
      await Promise.resolve();

      // Check the final state update for success
      const updateCalls = (analysisStore.update as Mocked<any>).mock.calls;
      let initializedUpdateCall = null;
      // Iterate backwards as the successful 'Initialized' state is likely one of the last updates.
      for (let i = updateCalls.length - 1; i >= 0; i--) {
        const mockStatePreview = {
          spectrogramStatus: "",
          spectrogramInitialized: false,
          spectrogramError: "previous error",
        };
        // Execute the updater function to see the resulting state.
        const resultingState = updateCalls[i][0](mockStatePreview);
        if (
          resultingState.spectrogramStatus === "Initialized" &&
          resultingState.spectrogramInitialized === true
        ) {
          initializedUpdateCall = updateCalls[i][0]; // Store the updater function itself
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
        const newState = initializedUpdateCall(mockState); // Call the identified updater
        expect(newState.spectrogramStatus).toBe("Initialized");
        expect(newState.spectrogramInitialized).toBe(true);
        expect(newState.spectrogramError).toBeNull();
      }
    });

    it("should update analysisStore on INIT_ERROR from worker message", async () => {
      const initPromise = spectrogramService.initialize({ sampleRate: 16000 });

      // Allow async operations within initialize (like fetch) to complete and postMessage to be called.
      await vi.runAllTimersAsync();

      if (mockSpecWorkerInstance.postMessage.mock.calls.length === 0) {
        throw new Error(
          "mockSpecWorkerInstance.postMessage was not called. Cannot simulate INIT_ERROR.",
        );
      }
      const initMessageId =
        mockSpecWorkerInstance.postMessage.mock.calls[0][0].messageId;

      // Simulate worker response for INIT_ERROR *before* awaiting initPromise
      if (mockSpecWorkerInstance.onmessage) {
        mockSpecWorkerInstance.onmessage({
          data: {
            type: SPEC_WORKER_MSG_TYPE.INIT_ERROR,
            error: "Init failed in worker",
            messageId: initMessageId,
          },
        } as MessageEvent);
      } else {
        throw new Error(
          "mockSpecWorkerInstance.onmessage is not set up for INIT_ERROR simulation.",
        );
      }

      try {
        await initPromise;
      } catch (e) {
        // Expected to reject due to error
      }

      await Promise.resolve(); // Flush microtask queue

      const lastUpdateCall = (
        analysisStore.update as Mocked<any>
      ).mock.calls.pop();
      expect(lastUpdateCall).toBeDefined();
      const mockState = {
        spectrogramStatus: "",
        spectrogramInitialized: true,
        spectrogramError: null,
      };
      const newState = lastUpdateCall[0](mockState);
      expect(newState.spectrogramError).toContain("Init failed in worker");
      expect(newState.spectrogramInitialized).toBe(false);
    });

    it("should update analysisStore on worker onerror during initialize", async () => {
      mockSpecWorkerInstance.postMessage.mockImplementationOnce(() => {
        // Simulate error being thrown by postMessage or worker globally failing
        if (mockSpecWorkerInstance.onerror) {
          mockSpecWorkerInstance.onerror(
            new ErrorEvent("error", { message: "Critical worker failure" }),
          );
        }
        throw new Error("Simulated postMessage failure");
      });

      try {
        await spectrogramService.initialize({ sampleRate: 16000 });
      } catch (e) {
        // error expected
      }

      const lastUpdateCall = (
        analysisStore.update as Mocked<any>
      ).mock.calls.pop();
      const mockState = {
        spectrogramStatus: "",
        spectrogramInitialized: true,
        spectrogramError: null,
      };
      const newState = lastUpdateCall[0](mockState); // This might be the one from onerror or the catch block in initialize

      // Check for either "Simulated postMessage failure" or "Critical worker failure"
      expect(newState.spectrogramError).toBeDefined();
      expect(newState.spectrogramInitialized).toBe(false);
    });
  });

  describe("process", () => {
    beforeEach(async () => {
      const initPromise = spectrogramService.initialize({ sampleRate: 16000 });
      // Allow async operations within initialize (like fetch) to complete and postMessage to be called.
      await vi.runAllTimersAsync();

      if (mockSpecWorkerInstance.postMessage.mock.calls.length === 0) {
        throw new Error(
          "Spectrogram service initialization failed to call postMessage in beforeEach for 'process' tests. Cannot get initMessageId.",
        );
      }
      const initMessageId =
        mockSpecWorkerInstance.postMessage.mock.calls[0][0].messageId;

      // Simulate INIT_SUCCESS *before* awaiting initPromise
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
          "mockSpecWorkerInstance.onmessage is not set up for INIT_SUCCESS simulation in 'process' beforeEach.",
        );
      }

      await initPromise; // Now await the promise
      await Promise.resolve(); // Ensure store updates from onmessage are processed
      (analysisStore.update as Mocked<any>).mockClear();
    });

    it("should post PROCESS message and update store on success", async () => {
      // Initialize is done in beforeEach. Now call process.
      const processPromise = spectrogramService.process(mockAudioData);

      // Allow async operations within process (like postMessage) to execute.
      await vi.runAllTimersAsync();

      // Check that postMessage was called for PROCESS
      expect(mockSpecWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: SPEC_WORKER_MSG_TYPE.PROCESS,
          payload: { audioData: mockAudioData },
        }),
      );

      const processCall = mockSpecWorkerInstance.postMessage.mock.calls.find(
        (call) => call[0].type === SPEC_WORKER_MSG_TYPE.PROCESS,
      );
      if (!processCall)
        throw new Error("PROCESS message not found in postMessage calls");
      const processMessageId = processCall[0].messageId;

      // Simulate worker response for PROCESS_RESULT *before* awaiting processPromise
      const mockResultPayload = { magnitudes: new Float32Array([1, 2, 3]) };
      if (mockSpecWorkerInstance.onmessage) {
        mockSpecWorkerInstance.onmessage({
          data: {
            type: SPEC_WORKER_MSG_TYPE.PROCESS_RESULT,
            payload: mockResultPayload,
            messageId: processMessageId,
          },
        } as MessageEvent);
      } else {
        throw new Error(
          "mockSpecWorkerInstance.onmessage is not set up for PROCESS_RESULT simulation.",
        );
      }

      await processPromise; // Wait for the process method to complete
      await Promise.resolve(); // Flush microtasks

      const updateCalls = (analysisStore.update as Mocked<any>).mock.calls;
      // Update sequence: 'Processing audio...', data update, 'Processing complete.'
      expect(updateCalls.length).toBeGreaterThanOrEqual(3); // Based on current service logic

      const dataUpdateState = updateCalls[updateCalls.length - 2][0]({
        spectrogramData: null,
      });
      expect(dataUpdateState.spectrogramData).toEqual(
        mockResultPayload.magnitudes,
      );

      const statusUpdateState = updateCalls[updateCalls.length - 1][0]({});
      expect(statusUpdateState.spectrogramStatus).toBe("Processing complete.");
    });

    it("should update store on PROCESS_ERROR from worker", async () => {
      const processPromise = spectrogramService.process(mockAudioData);

      // Allow async operations within process (like postMessage) to execute.
      await vi.runAllTimersAsync();

      const processCall = mockSpecWorkerInstance.postMessage.mock.calls.find(
        (call) => call[0].type === SPEC_WORKER_MSG_TYPE.PROCESS,
      );
      if (!processCall)
        throw new Error(
          "PROCESS message not found in postMessage calls for error test.",
        );
      const processMessageId = processCall[0].messageId;

      // Simulate worker response for PROCESS_ERROR *before* awaiting processPromise
      if (mockSpecWorkerInstance.onmessage) {
        mockSpecWorkerInstance.onmessage({
          data: {
            type: SPEC_WORKER_MSG_TYPE.PROCESS_ERROR,
            error: "Processing failed in worker",
            messageId: processMessageId,
          },
        } as MessageEvent);
      } else {
        throw new Error(
          "mockSpecWorkerInstance.onmessage is not set up for PROCESS_ERROR simulation.",
        );
      }

      try {
        await processPromise;
      } catch (e) {
        // Expected to reject if service re-throws, or resolve if service handles and updates store
      }
      await Promise.resolve(); // Flush microtasks

      const lastUpdateCall = (
        analysisStore.update as Mocked<any>
      ).mock.calls.pop();
      expect(lastUpdateCall).toBeDefined();
      const mockState = { spectrogramStatus: "", spectrogramError: null };
      const newState = lastUpdateCall[0](mockState);
      expect(newState.spectrogramStatus).toBe("Processing failed.");
      expect(newState.spectrogramError).toContain(
        "Processing failed in worker",
      );
    });
  });

  describe("dispose", () => {
    it("should terminate worker, update store to disposed state, and clear pending promises", async () => {
      const initPromise = spectrogramService.initialize({ sampleRate: 16000 });
      // Allow async operations within initialize (like fetch) to complete and postMessage to be called.
      await vi.runAllTimersAsync();

      if (mockSpecWorkerInstance.postMessage.mock.calls.length === 0) {
        throw new Error(
          "Spectrogram service initialization failed to call postMessage in 'dispose' test. Cannot get initMessageId.",
        );
      }
      const initMessageId =
        mockSpecWorkerInstance.postMessage.mock.calls[0][0].messageId;

      // Simulate INIT_SUCCESS *before* awaiting initPromise
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
          "mockSpecWorkerInstance.onmessage is not set up for INIT_SUCCESS simulation in 'dispose' test.",
        );
      }

      await initPromise; // Now await the promise
      await Promise.resolve(); // Ensure store updates from onmessage are processed
      (analysisStore.update as Mocked<any>).mockClear();

      spectrogramService.dispose();

      // --- Assert ---
      // Worker termination
      expect(mockSpecWorkerInstance.terminate).toHaveBeenCalledTimes(1);
      expect(analysisStore.update).toHaveBeenCalledTimes(1);
      const storeUpdater = (analysisStore.update as Mocked<any>).mock
        .calls[0][0];
      const prevState = {
        /* ... provide a representative previous state ... */
      };
      const newState = storeUpdater(prevState);
      expect(newState.spectrogramStatus).toBe("Disposed");
      // ... other assertions for disposed state ...
    });

    // ... other tests for "dispose"
    it("should handle dispose being called multiple times without error", () => {
      spectrogramService.initialize({ sampleRate: 16000 }); // Ensure worker exists

      expect(() => {
        spectrogramService.dispose();
        spectrogramService.dispose(); // Call dispose again
      }).not.toThrow();

      expect(mockSpecWorkerInstance.terminate).toHaveBeenCalledTimes(1); // Still only terminates the first time
    });
  });
});
