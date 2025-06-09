import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mocked,
} from "vitest";
import SileroVadWorker from '$lib/workers/sileroVad.worker?worker';
import SpectrogramWorker from '$lib/workers/spectrogram.worker?worker';
import analysisService from "./analysis.service"; // Assuming default export
import { analysisStore } from "$lib/stores/analysis.store";
import { VAD_CONSTANTS, VISUALIZER_CONSTANTS } from "$lib/utils";
import { VAD_WORKER_MSG_TYPE, SPEC_WORKER_MSG_TYPE } from "$lib/types/worker.types";

// Mock Svelte stores
vi.mock("$lib/stores/analysis.store", () => ({
  analysisStore: {
    subscribe: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
  },
}));

// Mock Web Workers
const mockVadWorkerInstance = {
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((event: ErrorEvent) => void) | null,
};
const mockSpecWorkerInstance = {
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((event: ErrorEvent) => void) | null,
};

vi.mock("$lib/workers/sileroVad.worker?worker", () => ({
  default: vi.fn().mockImplementation(() => mockVadWorkerInstance),
}));
vi.mock("$lib/workers/spectrogram.worker?worker", () => ({
  default: vi.fn().mockImplementation(() => mockSpecWorkerInstance),
}));

// Mock AudioBuffer
const mockAudioBuffer = {
  sampleRate: 16000,
  numberOfChannels: 1,
  duration: 1.0,
  getChannelData: vi.fn(() => new Float32Array(16000)), // 1 second of data at 16kHz
};

describe("AnalysisService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVadWorkerInstance.postMessage.mockClear();
    mockVadWorkerInstance.terminate.mockClear();
    mockVadWorkerInstance.onmessage = null;
    mockVadWorkerInstance.onerror = null;

    mockSpecWorkerInstance.postMessage.mockClear();
    mockSpecWorkerInstance.terminate.mockClear();
    mockSpecWorkerInstance.onmessage = null;
    mockSpecWorkerInstance.onerror = null;

    (analysisStore.update as Mocked<any>).mockClear();
    (analysisStore.set as Mocked<any>).mockClear();

    // analysisService.dispose(); // Reset state
  });

  afterEach(() => {
    analysisService.dispose(); // Clean up
  });

  describe("initialize (VAD)", () => {
    it("should create VAD worker and post INIT message", async () => {
      const initPromise = analysisService.initialize();
      // Simulate worker response to allow initialization to complete
      if (mockVadWorkerInstance.onmessage) {
        mockVadWorkerInstance.onmessage({
          data: { type: VAD_WORKER_MSG_TYPE.INIT_SUCCESS, messageId: "vad_msg_0" },
        } as MessageEvent);
      }
      await initPromise;
      expect(SileroVadWorker).toHaveBeenCalledTimes(1);
      expect(mockVadWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: VAD_WORKER_MSG_TYPE.INIT }),
      );
    });

    it("should update analysisStore on VAD INIT_SUCCESS", async () => {
      const promise = analysisService.initialize();
      expect(mockVadWorkerInstance.onmessage).not.toBeNull();
      mockVadWorkerInstance.onmessage!({
        data: {
          type: VAD_WORKER_MSG_TYPE.INIT_SUCCESS,
          messageId: "vad_msg_0",
        },
      } as MessageEvent);
      await promise;
      expect(analysisStore.update).toHaveBeenCalledWith(expect.any(Function));
      // To verify the outcome of the update, you might need to check store's actual value
      // or spy on the store's $derived values if applicable and testable.
      // For now, just checking it's called with a function.
    });

    it("should update analysisStore on VAD INIT_ERROR", async () => {
      const promise = analysisService.initialize();
      expect(mockVadWorkerInstance.onmessage).not.toBeNull();
      mockVadWorkerInstance.onmessage!({
        data: {
          type: VAD_WORKER_MSG_TYPE.INIT_ERROR,
          error: "VAD init fail",
          messageId: "vad_msg_0",
        },
      } as MessageEvent);
      await promise;
      expect(analysisStore.update).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe("initializeSpectrogramWorker", () => {
    it("should create Spectrogram worker and post INIT message", async () => {
      const initPromise = analysisService.initializeSpectrogramWorker({ sampleRate: 16000 });
      // Simulate worker response to allow initialization to complete
      if (mockSpecWorkerInstance.onmessage) {
        mockSpecWorkerInstance.onmessage({
          data: { type: SPEC_WORKER_MSG_TYPE.INIT_SUCCESS, messageId: "spec_msg_0" },
        } as MessageEvent);
      }
      await initPromise;
      expect(SpectrogramWorker).toHaveBeenCalledTimes(1);
      expect(mockSpecWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: SPEC_WORKER_MSG_TYPE.INIT }),
      );
    });

    it("should update analysisStore on Spectrogram INIT_SUCCESS", async () => {
      const promise = analysisService.initializeSpectrogramWorker({
        sampleRate: 16000,
      });
      expect(mockSpecWorkerInstance.onmessage).not.toBeNull();
      mockSpecWorkerInstance.onmessage!({
        data: {
          type: SPEC_WORKER_MSG_TYPE.INIT_SUCCESS,
          messageId: "spec_msg_0",
        },
      } as MessageEvent);
      await promise;
      expect(analysisStore.update).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe("startSpectrogramProcessing", () => {
    beforeEach(async () => {
      // Ensure a clean state and full initialization for these tests
      analysisService.dispose(); // Dispose first to reset all internal states including messageIds
      vi.clearAllMocks(); // Clear mocks early before re-initializing

      // Re-initialize VAD
      const vadInitPromise = analysisService.initialize();
      if (mockVadWorkerInstance.onmessage) {
        mockVadWorkerInstance.onmessage!({
          data: { type: VAD_WORKER_MSG_TYPE.INIT_SUCCESS, messageId: "vad_msg_0" },
        } as MessageEvent);
      }
      await vadInitPromise;

      // Re-initialize Spectrogram Worker
      const specInitPromise = analysisService.initializeSpectrogramWorker({ sampleRate: 16000 });
      if (mockSpecWorkerInstance.onmessage) {
        mockSpecWorkerInstance.onmessage!({
          data: { type: SPEC_WORKER_MSG_TYPE.INIT_SUCCESS, messageId: "spec_msg_0" },
        } as MessageEvent);
      }
      await specInitPromise;
      // DO NOT Clear all mocks here as it clears spies needed for the tests in this block.
      // Specific mock clears should happen in the main beforeEach or per test if needed.
    });

    it("should NOT call initializeSpectrogramWorker again if already initialized", async () => {
      const initSpy = vi.spyOn(analysisService, "initializeSpectrogramWorker");
      // Mock processAudioForSpectrogram for this test to avoid it waiting for PROCESS_RESULT
      const processAudioSpy = vi.spyOn(analysisService, "processAudioForSpectrogram").mockResolvedValue(null);

      await analysisService.startSpectrogramProcessing(mockAudioBuffer as unknown as AudioBuffer);

      expect(initSpy).not.toHaveBeenCalled();
      // We expect processAudioForSpectrogram to have been called if initialization was skipped.
      expect(processAudioSpy).toHaveBeenCalled();

      processAudioSpy.mockRestore(); // Restore for other tests

      // Need to ensure the internal state `spectrogramInitialized` is true before processAudioForSpectrogram is called.
      // The above mock of initSpy should handle the message passing to set it.
      // If the internal state isn't directly testable, we check the effect: processAudioForSpectrogram called.
      // This requires careful handling of the async nature and message passing.
      // For this test, we'll assume the mockImplementation of initSpy leads to spectrogramInitialized=true
    });

    it("should call postMessage on spec worker with PROCESS type", async () => {
      // beforeEach of this describe block has initialized the spectrogram worker.
      // Ensure getChannelData mock is fresh if it's counting calls from beforeEach's load.
      vi.mocked(mockAudioBuffer.getChannelData).mockClear();
      const pcmData = mockAudioBuffer.getChannelData(0);

      const processingPromise = analysisService.startSpectrogramProcessing(mockAudioBuffer as unknown as AudioBuffer);

      expect(mockSpecWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: SPEC_WORKER_MSG_TYPE.PROCESS,
          // payload: { audioData: pcmData }, // Check exact payload if necessary
        }),
      );

      // Simulate worker response for the PROCESS message to allow promise to resolve
      if (mockSpecWorkerInstance.onmessage) {
        const calls = vi.mocked(mockSpecWorkerInstance.postMessage).mock.calls;
        // Ensure postMessage was called before trying to access its details
        if (calls.length > 0) {
          const lastCall = calls[calls.length - 1];
          // Check if lastCall[0] is defined and has a messageId property
          if (lastCall && lastCall[0] && typeof lastCall[0] === 'object' && 'messageId' in lastCall[0]) {
            const messageId = lastCall[0].messageId;
            mockSpecWorkerInstance.onmessage({
              data: { type: SPEC_WORKER_MSG_TYPE.PROCESS_RESULT, payload: { magnitudes: new Float32Array(0) }, messageId: messageId },
            } as MessageEvent);
          } else {
            // Handle cases where the call might not have the expected structure, or postMessage wasn't called as expected.
            // This could mean the test fails before this point, or the mock needs adjustment.
            console.warn("PROCESS message not found or malformed in postMessage mock calls for spec worker.");
          }
        }
      }
      await processingPromise; // Await for completion
    });
  });

  describe("dispose", () => {
    it("should terminate both VAD and Spectrogram workers", async () => {
      // Initialize VAD
      const vadInitPromise = analysisService.initialize();
      if (mockVadWorkerInstance.onmessage) {
        mockVadWorkerInstance.onmessage!({
          data: { type: VAD_WORKER_MSG_TYPE.INIT_SUCCESS, messageId: "vad_msg_0" },
        } as MessageEvent);
      }
      await vadInitPromise;

      // Initialize Spectrogram worker
      const specInitPromise = analysisService.initializeSpectrogramWorker({ sampleRate: 16000 });
      if (mockSpecWorkerInstance.onmessage) {
        mockSpecWorkerInstance.onmessage!({
          data: { type: SPEC_WORKER_MSG_TYPE.INIT_SUCCESS, messageId: "spec_msg_0" },
        } as MessageEvent);
      }
      await specInitPromise;

      const vadTerminateSpy = vi.spyOn(mockVadWorkerInstance, 'terminate');
      const specTerminateSpy = vi.spyOn(mockSpecWorkerInstance, 'terminate');

      analysisService.dispose();
      expect(vadTerminateSpy).toHaveBeenCalled();
      expect(specTerminateSpy).toHaveBeenCalled(); // This was the one failing
      // The status update for "VAD service disposed" is in the main dispose() method
      // The status update for "Spectrogram worker disposed." is in disposeSpectrogramWorker()
      // Both call analysisStore.update with a function.
      expect(analysisStore.update).toHaveBeenCalledWith(expect.any(Function));
      // This will be called multiple times, check for specific calls if needed,
      // or use .toHaveBeenCalledTimes() if the number of calls is predictable.
      // VAD Init (x2: initializing, initialized) = 2 calls
      // Spec Init (x2: initializing, initialized) = 2 calls
      // VAD Dispose (x1) = 1 call
      // Spec Dispose (x1) = 1 call
      // Total = 6 calls
      expect(analysisStore.update).toHaveBeenCalledTimes(6);
    });
  });
});
