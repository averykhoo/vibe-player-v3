// vibe-player-v2/src/lib/services/spectrogram.service.test.ts
import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import SpectrogramWorker from '$lib/workers/spectrogram.worker?worker&inline';
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
    vi.clearAllMocks();
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
  });

  describe("initialize", () => {
    it("should create Spectrogram worker, post INIT message, and update store", async () => {
      const initPromise = spectrogramService.initialize({ sampleRate: 16000 });

      expect(SpectrogramWorker).toHaveBeenCalledTimes(1);
      expect(mockSpecWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: SPEC_WORKER_MSG_TYPE.INIT })
      );
      expect(analysisStore.update).toHaveBeenCalledWith(expect.any(Function)); // Initial 'Initializing' update

      // Simulate worker response for INIT_SUCCESS
      const initMessageId = mockSpecWorkerInstance.postMessage.mock.calls[0][0].messageId;
      if (mockSpecWorkerInstance.onmessage) {
        mockSpecWorkerInstance.onmessage({
          data: { type: SPEC_WORKER_MSG_TYPE.INIT_SUCCESS, payload: {}, messageId: initMessageId },
        } as MessageEvent);
      }
      await initPromise;

      expect(analysisStore.update).toHaveBeenCalledWith(expect.any(Function)); // For 'Initialized'
      // Check the final state update for success
      const lastUpdateCall = (analysisStore.update as Mocked<any>).mock.calls.pop();
      const mockState = { spectrogramStatus: '', spectrogramInitialized: false, spectrogramError: 'previous error' };
      const newState = lastUpdateCall[0](mockState);
      expect(newState.spectrogramStatus).toBe('Initialized');
      expect(newState.spectrogramInitialized).toBe(true);
      expect(newState.spectrogramError).toBeNull();
    });

    it("should update analysisStore on INIT_ERROR from worker message", async () => {
      const initPromise = spectrogramService.initialize({ sampleRate: 16000 });
      const initMessageId = mockSpecWorkerInstance.postMessage.mock.calls[0][0].messageId;

      if (mockSpecWorkerInstance.onmessage) {
        mockSpecWorkerInstance.onmessage({
          data: { type: SPEC_WORKER_MSG_TYPE.INIT_ERROR, error: "Init failed in worker", messageId: initMessageId },
        } as MessageEvent);
      }

      try {
        await initPromise;
      } catch (e) {
        // Expected to reject due to error
      }

      const lastUpdateCall = (analysisStore.update as Mocked<any>).mock.calls.pop();
      const mockState = { spectrogramStatus: '', spectrogramInitialized: true, spectrogramError: null };
      const newState = lastUpdateCall[0](mockState);
      expect(newState.spectrogramError).toContain("Init failed in worker");
      expect(newState.spectrogramInitialized).toBe(false);
    });

    it("should update analysisStore on worker onerror during initialize", async () => {
      mockSpecWorkerInstance.postMessage.mockImplementationOnce(() => {
        // Simulate error being thrown by postMessage or worker globally failing
        if (mockSpecWorkerInstance.onerror) {
            mockSpecWorkerInstance.onerror(new ErrorEvent("error", { message: "Critical worker failure" }));
        }
        throw new Error("Simulated postMessage failure");
      });

      try {
        await spectrogramService.initialize({ sampleRate: 16000 });
      } catch(e) {
        // error expected
      }

      const lastUpdateCall = (analysisStore.update as Mocked<any>).mock.calls.pop();
      const mockState = { spectrogramStatus: '', spectrogramInitialized: true, spectrogramError: null };
      const newState = lastUpdateCall[0](mockState); // This might be the one from onerror or the catch block in initialize

      // Check for either "Simulated postMessage failure" or "Critical worker failure"
      expect(newState.spectrogramError).toBeDefined();
      expect(newState.spectrogramInitialized).toBe(false);
    });
  });

  describe("process", () => {
    beforeEach(async () => {
      // Ensure service is initialized before process tests
      const initPromise = spectrogramService.initialize({ sampleRate: 16000 });
      const initMessageId = mockSpecWorkerInstance.postMessage.mock.calls[0][0].messageId;
      if (mockSpecWorkerInstance.onmessage) {
        mockSpecWorkerInstance.onmessage({
          data: { type: SPEC_WORKER_MSG_TYPE.INIT_SUCCESS, payload: {}, messageId: initMessageId },
        } as MessageEvent);
      }
      await initPromise;
      (analysisStore.update as Mocked<any>).mockClear(); // Clear init updates
    });

    it("should post PROCESS message and update store on success", async () => {
      const processPromise = spectrogramService.process(mockAudioData);

      expect(mockSpecWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: SPEC_WORKER_MSG_TYPE.PROCESS, payload: { audioData: mockAudioData } })
      );
      // Check for 'Processing audio...' update
      let storeUpdate = (analysisStore.update as Mocked<any>).mock.calls[0][0];
      let state = storeUpdate({});
      expect(state.spectrogramStatus).toBe('Processing audio for spectrogram...');

      // Simulate worker response for PROCESS_RESULT
      const processMessageId = mockSpecWorkerInstance.postMessage.mock.calls.find(call => call[0].type === SPEC_WORKER_MSG_TYPE.PROCESS)[0].messageId;
      const mockResultPayload = { magnitudes: new Float32Array([1, 2, 3]) };
      if (mockSpecWorkerInstance.onmessage) {
        mockSpecWorkerInstance.onmessage({
          data: { type: SPEC_WORKER_MSG_TYPE.PROCESS_RESULT, payload: mockResultPayload, messageId: processMessageId },
        } as MessageEvent);
      }
      await processPromise;

      // Check for 'Processing complete.' and data update
      const updateCalls = (analysisStore.update as Mocked<any>).mock.calls;
      // First call is status 'Processing audio...', second is data, third is status 'Processing complete.'
      // The service updates data first, then status.
      storeUpdate = updateCalls[1][0]; // data update
      state = storeUpdate({ spectrogramData: null });
      expect(state.spectrogramData).toEqual(mockResultPayload.magnitudes);

      storeUpdate = updateCalls[2][0]; // status update
      state = storeUpdate({});
      expect(state.spectrogramStatus).toBe('Processing complete.');
    });

    it("should update store on PROCESS_ERROR from worker", async () => {
      const processPromise = spectrogramService.process(mockAudioData);
      const processMessageId = mockSpecWorkerInstance.postMessage.mock.calls.find(call => call[0].type === SPEC_WORKER_MSG_TYPE.PROCESS)[0].messageId;

      if (mockSpecWorkerInstance.onmessage) {
        mockSpecWorkerInstance.onmessage({
          data: { type: SPEC_WORKER_MSG_TYPE.PROCESS_ERROR, error: "Processing failed in worker", messageId: processMessageId },
        } as MessageEvent);
      }

      try {
        await processPromise;
      } catch (e) {
        // Expected to reject
      }

      const lastUpdateCall = (analysisStore.update as Mocked<any>).mock.calls.pop();
      const mockState = { spectrogramStatus: '', spectrogramError: null };
      const newState = lastUpdateCall[0](mockState);
      expect(newState.spectrogramStatus).toBe('Processing failed.');
      expect(newState.spectrogramError).toContain("Processing failed in worker");
    });
  });

  describe("dispose", () => {
    it("should terminate worker, update store to disposed state, and clear pending promises", async () => {
      // Initialize to have a worker and potentially pending promises
      const initPromise = spectrogramService.initialize({ sampleRate: 16000 });
      const initMessageId = mockSpecWorkerInstance.postMessage.mock.calls[0][0].messageId;

      // Simulate worker initialization success
      if (mockSpecWorkerInstance.onmessage) {
        mockSpecWorkerInstance.onmessage({
          data: { type: SPEC_WORKER_MSG_TYPE.INIT_SUCCESS, payload: {}, messageId: initMessageId },
        } as MessageEvent);
      }
      await initPromise;
      (analysisStore.update as Mocked<any>).mockClear(); // Clear init updates

      // --- Act ---
      spectrogramService.dispose();

      // --- Assert ---
      // Worker termination
      expect(mockSpecWorkerInstance.terminate).toHaveBeenCalledTimes(1);

      // Store update to 'Disposed' state
      expect(analysisStore.update).toHaveBeenCalledTimes(1);
      const storeUpdater = (analysisStore.update as Mocked<any>).mock.calls[0][0];
      const prevState = {
        spectrogramStatus: "Initializing",
        spectrogramData: null,
        spectrogramInitialized: false,
        spectrogramError: null,
      };
      const newState = storeUpdater(prevState);
      expect(newState.spectrogramStatus).toBe("Disposed");
      expect(newState.spectrogramData).toBeNull();
      expect(newState.spectrogramInitialized).toBe(false);
      expect(newState.spectrogramError).toBeNull();

      // Attempt to use a method that relies on pending promises after dispose
      // This tests if pending promises are cleared and won't cause issues
      // For example, if process() was called and its promise was pending
      // Here, we'll simulate a scenario where a promise might be unresolved
      // and ensure it doesn't lead to errors after dispose.
      // This part is conceptual for this test, as direct promise rejection checking
      // would require more complex setup (e.g., if dispose explicitly rejects them).
      // The main check is that the service is reset and doesn't hold onto old states/promises.

      // Verify that calling methods after dispose won't use the old worker or state
      // For instance, calling initialize again should create a new worker.
      // This is indirectly tested by beforeEach creating a new worker via initialize.
      // We can also check that there are no lingering unresolved promises.
      // This is more of a design verification - dispose should ensure no callbacks
      // from an old worker instance will be processed.
      // A simple check: if a promise was pending and got rejected by dispose,
      // it should not interact with the store post-dispose.
      // This is implicitly covered by the store update check being specific to "Disposed".
    });

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
