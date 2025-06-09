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
      // Clear mocks again AFTER all setup to ensure assertions in tests are clean
      vi.clearAllMocks();
    });

    it("should call initializeSpectrogramWorker if not already initialized", async () => {
      const initSpy = vi.spyOn(analysisService, "initializeSpectrogramWorker");
      const processSpy = vi.spyOn(
        analysisService,
        "processAudioForSpectrogram",
      );

      // Simulate spectrogram worker successfully initializing after being called by startSpectrogramProcessing
      initSpy.mockImplementation(async () => {
        if (mockSpecWorkerInstance.onmessage)
          mockSpecWorkerInstance.onmessage!({
            data: {
              type: SPEC_WORKER_MSG_TYPE.INIT_SUCCESS,
              messageId: "spec_msg_0",
            },
          } as MessageEvent);
        // Directly set spectrogramInitialized to true for test purposes
        // This is a bit of a hack; ideally, the store itself would be mocked/controlled.
        // For now, we assume the internal writable 'spectrogramInitialized' gets set.
        // To properly test this, we'd need to export spectrogramInitialized or use other means.
      });
      // Mock processAudioForSpectrogram to resolve immediately
      processSpy.mockResolvedValue(null);

      await analysisService.startSpectrogramProcessing(
        mockAudioBuffer as unknown as AudioBuffer,
      );

      expect(initSpy).toHaveBeenCalledWith({
        sampleRate: mockAudioBuffer.sampleRate,
      });
      // Need to ensure the internal state `spectrogramInitialized` is true before processAudioForSpectrogram is called.
      // The above mock of initSpy should handle the message passing to set it.
      // If the internal state isn't directly testable, we check the effect: processAudioForSpectrogram called.
      // This requires careful handling of the async nature and message passing.
      // For this test, we'll assume the mockImplementation of initSpy leads to spectrogramInitialized=true
    });

    it("should call processAudioForSpectrogram with PCM data", async () => {
      // Spectrogram worker is now initialized in beforeEach of this describe block
      const pcmData = mockAudioBuffer.getChannelData(0);
      await analysisService.startSpectrogramProcessing(
        mockAudioBuffer as unknown as AudioBuffer,
      );

      expect(mockSpecWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: SPEC_WORKER_MSG_TYPE.PROCESS,
          payload: { audioData: pcmData },
        }),
      );
    });
  });

  describe("dispose", () => {
    it("should terminate both VAD and Spectrogram workers", async () => {
      // Initialize both
      const vadInitPromise = analysisService.initialize();
      if (mockVadWorkerInstance.onmessage)
        mockVadWorkerInstance.onmessage!({
          data: {
            type: VAD_WORKER_MSG_TYPE.INIT_SUCCESS,
            messageId: "vad_msg_0",
          },
        } as MessageEvent);
      await vadInitPromise;

      const specInitPromise = analysisService.initializeSpectrogramWorker({
        sampleRate: 16000,
      });
      if (mockSpecWorkerInstance.onmessage)
        mockSpecWorkerInstance.onmessage!({
          data: {
            type: SPEC_WORKER_MSG_TYPE.INIT_SUCCESS,
            messageId: "spec_msg_0",
          },
        } as MessageEvent);
      await specInitPromise;

      const vadTerminateSpy = vi.spyOn(mockVadWorkerInstance, 'terminate');
      const specTerminateSpy = vi.spyOn(mockSpecWorkerInstance, 'terminate');

      analysisService.dispose();
      expect(vadTerminateSpy).toHaveBeenCalled();
      expect(specTerminateSpy).toHaveBeenCalled();
      // The status update for "VAD service disposed" is in the main dispose() method
      // The status update for "Spectrogram worker disposed." is in disposeSpectrogramWorker()
      // Both call analysisStore.update with a function.
      expect(analysisStore.update).toHaveBeenCalledWith(expect.any(Function));
      // This will be called multiple times, check for specific calls if needed,
      // or use .toHaveBeenCalledTimes() if the number of calls is predictable.
      // For this case, there are two distinct updates from dispose paths.
      expect(analysisStore.update).toHaveBeenCalledTimes(2); // VAD dispose + Spectrogram dispose
    });
  });
});
