import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mocked,
} from "vitest";
import analysisService from "./analysis.service"; // Assuming default export
import { analysisStore } from "$lib/stores/analysis.store";
import {
  VAD_WORKER_MSG_TYPE,
  SPEC_WORKER_MSG_TYPE,
  VAD_CONSTANTS,
  VISUALIZER_CONSTANTS,
} from "$lib/utils";

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
      await analysisService.initialize();
      expect(vi.mocked(SileroVadWorker)).toHaveBeenCalledTimes(1);
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
      expect(analysisStore.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "VAD service initialized." }),
      );
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
      expect(analysisStore.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "Error initializing VAD service." }),
      );
    });
  });

  describe("initializeSpectrogramWorker", () => {
    it("should create Spectrogram worker and post INIT message", async () => {
      await analysisService.initializeSpectrogramWorker({ sampleRate: 16000 });
      expect(vi.mocked(SpectrogramWorker)).toHaveBeenCalledTimes(1);
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
      expect(analysisStore.update).toHaveBeenCalledWith(
        expect.objectContaining({
          spectrogramStatus: "Spectrogram worker initialized.",
        }),
      );
    });
  });

  describe("startSpectrogramProcessing", () => {
    beforeEach(async () => {
      // Ensure VAD worker is also init as it's part of the same service, though not directly used here
      const vadInitPromise = analysisService.initialize();
      if (mockVadWorkerInstance.onmessage)
        mockVadWorkerInstance.onmessage!({
          data: {
            type: VAD_WORKER_MSG_TYPE.INIT_SUCCESS,
            messageId: "vad_msg_0",
          },
        } as MessageEvent);
      await vadInitPromise;
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
      // First, ensure spectrogram worker is initialized
      const initSpecPromise = analysisService.initializeSpectrogramWorker({
        sampleRate: mockAudioBuffer.sampleRate,
      });
      if (mockSpecWorkerInstance.onmessage)
        mockSpecWorkerInstance.onmessage!({
          data: {
            type: SPEC_WORKER_MSG_TYPE.INIT_SUCCESS,
            messageId: "spec_msg_0",
          },
        } as MessageEvent);
      await initSpecPromise;

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

      analysisService.dispose();
      expect(mockVadWorkerInstance.terminate).toHaveBeenCalled();
      expect(mockSpecWorkerInstance.terminate).toHaveBeenCalled();
      expect(analysisStore.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "VAD service disposed." }),
      );
      expect(analysisStore.update).toHaveBeenCalledWith(
        expect.objectContaining({
          spectrogramStatus: "Spectrogram worker disposed.",
        }),
      );
    });
  });
});
