// vibe-player-v2/src/lib/services/dtmf.service.test.ts
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mocked,
  vi,
} from "vitest";
import DtmfWorker from "$lib/workers/dtmf.worker?worker&inline";
import dtmfService from "./dtmf.service";
import { type DtmfState, dtmfStore } from "$lib/stores/dtmf.store";

// Mock Svelte stores
vi.mock("$lib/stores/dtmf.store", () => {
  const actual = vi.importActual("$lib/stores/dtmf.store");
  return {
    ...actual, // Import and retain actual DtmfState, initialState if needed by service
    dtmfStore: {
      subscribe: vi.fn(),
      set: vi.fn(),
      update: vi.fn(),
    },
  };
});

// Mock Web Workers
const mockDtmfWorkerInstance = {
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((event: ErrorEvent) => void) | null, // Though service uses onmessage for errors
};

vi.mock("$lib/workers/dtmf.worker?worker&inline", () => ({
  default: vi.fn().mockImplementation(() => mockDtmfWorkerInstance),
}));

// Mock OfflineAudioContext
const mockGetChannelData = vi.fn();
const mockStartRendering = vi.fn();
const mockOfflineAudioContext = vi.fn(() => ({
  createBufferSource: vi.fn(() => ({
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
  })),
  startRendering: mockStartRendering,
}));
global.OfflineAudioContext = mockOfflineAudioContext as any;

// Create a mock AudioBuffer that is an instance of the globally mocked AudioBuffer
// and has a non-zero length.
const mockAudioBuffer = new global.AudioBuffer();
Object.defineProperty(mockAudioBuffer, "length", {
  value: 48000,
  writable: false,
  configurable: true,
});
Object.defineProperty(mockAudioBuffer, "sampleRate", {
  value: 48000,
  writable: false,
  configurable: true,
});
Object.defineProperty(mockAudioBuffer, "duration", {
  value: 1.0,
  writable: false,
  configurable: true,
});
Object.defineProperty(mockAudioBuffer, "numberOfChannels", {
  value: 1,
  writable: false,
  configurable: true,
});
(mockAudioBuffer as any).getChannelData = vi.fn(() => new Float32Array(48000));

const resampledAudioBuffer = {
  sampleRate: 16000,
  duration: 1.0,
  numberOfChannels: 1,
  getChannelData: mockGetChannelData,
} as unknown as AudioBuffer;

describe("DtmfService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDtmfWorkerInstance.postMessage.mockClear();
    mockDtmfWorkerInstance.terminate.mockClear();
    mockDtmfWorkerInstance.onmessage = null;
    mockDtmfWorkerInstance.onerror = null;

    (dtmfStore.update as Mocked<any>).mockClear();
    (dtmfStore.set as Mocked<any>).mockClear();

    dtmfService.dispose(); // Clean up previous state
  });

  afterEach(() => {
    dtmfService.dispose(); // Clean up
  });

  describe("initialize", () => {
    it("should create DTMF worker, post INIT message, and update store on init_complete", () => {
      dtmfService.initialize(16000); // targetSampleRate for worker

      expect(DtmfWorker).toHaveBeenCalledTimes(1);
      expect(mockDtmfWorkerInstance.postMessage).toHaveBeenCalledWith({
        type: "init",
        payload: { sampleRate: 16000 },
      });

      // Simulate worker response for init_complete
      if (mockDtmfWorkerInstance.onmessage) {
        mockDtmfWorkerInstance.onmessage({
          data: { type: "init_complete" },
        } as MessageEvent);
      }

      expect(dtmfStore.update).toHaveBeenCalledTimes(1);
      const lastUpdateCall = (dtmfStore.update as Mocked<any>).mock.calls[0][0];
      const mockState: DtmfState = {
        status: "processing",
        dtmf: [],
        cpt: [],
        error: "old error",
      };
      const newState = lastUpdateCall(mockState);
      expect(newState.status).toBe("idle");
      expect(newState.error).toBeNull();
    });

    it("should update dtmfStore on 'error' message from worker during init", () => {
      dtmfService.initialize(16000);

      if (mockDtmfWorkerInstance.onmessage) {
        mockDtmfWorkerInstance.onmessage({
          data: { type: "error", payload: "Init failed" },
        } as MessageEvent);
      }

      expect(dtmfStore.update).toHaveBeenCalledTimes(1);
      const lastUpdateCall = (dtmfStore.update as Mocked<any>).mock.calls[0][0];
      const mockState: DtmfState = {
        status: "processing",
        dtmf: [],
        cpt: [],
        error: null,
      };
      const newState = lastUpdateCall(mockState);
      expect(newState.status).toBe("error");
      expect(newState.error).toBe("Init failed");
    });
  });

  describe("process", () => {
    beforeEach(() => {
      // Ensure service is initialized
      dtmfService.initialize(16000);
      if (mockDtmfWorkerInstance.onmessage) {
        mockDtmfWorkerInstance.onmessage({
          data: { type: "init_complete" },
        } as MessageEvent);
      }
      (dtmfStore.update as Mocked<any>).mockClear(); // Clear init updates

      // Setup resampling mock
      mockGetChannelData.mockReturnValue(new Float32Array(16000)); // Resampled data
      mockStartRendering.mockResolvedValue(resampledAudioBuffer);
    });

    it("should update store to 'processing', resample audio, and post 'process' message", async () => {
      await dtmfService.process(mockAudioBuffer);

      expect(dtmfStore.update).toHaveBeenCalledWith(expect.any(Function));
      const processingUpdateCall = (dtmfStore.update as Mocked<any>).mock
        .calls[0][0];
      const processingState = processingUpdateCall({
        status: "idle",
        dtmf: ["old"],
        cpt: ["old"],
        error: "yes",
      });
      expect(processingState.status).toBe("processing");
      expect(processingState.dtmf).toEqual([]);
      expect(processingState.cpt).toEqual([]);

      expect(mockOfflineAudioContext).toHaveBeenCalledWith(
        1,
        mockAudioBuffer.duration * 16000,
        16000,
      );
      expect(mockStartRendering).toHaveBeenCalled();

      // Wait for resampling to complete
      await mockStartRendering();

      expect(mockDtmfWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "process",
          payload: { pcmData: new Float32Array(16000) },
        }),
      );
    });

    it("should update store with results on 'result' message from worker", async () => {
      const processPromise = dtmfService.process(mockAudioBuffer);

      // Simulate worker response for result
      if (mockDtmfWorkerInstance.onmessage) {
        mockDtmfWorkerInstance.onmessage({
          data: {
            type: "result",
            payload: { dtmf: ["1", "2"], cpt: ["busy"] },
          },
        } as MessageEvent);
      }
      await processPromise; // Ensure all async operations complete

      // The first update is 'processing', the second is the result
      const resultUpdateCall = (dtmfStore.update as Mocked<any>).mock
        .calls[1][0];
      const mockState: DtmfState = {
        status: "processing",
        dtmf: [],
        cpt: [],
        error: null,
      };
      const newState = resultUpdateCall(mockState);
      expect(newState.status).toBe("complete");
      expect(newState.dtmf).toEqual(["1", "2"]);
      expect(newState.cpt).toEqual(["busy"]);
    });

    it("should update store with error if worker not initialized", () => {
      dtmfService.dispose(); // Ensure worker is null
      (dtmfStore.update as Mocked<any>).mockClear();

      dtmfService.process(mockAudioBuffer);

      expect(dtmfStore.update).toHaveBeenCalledTimes(1);
      const errorUpdateCall = (dtmfStore.update as Mocked<any>).mock
        .calls[0][0];
      const newState = errorUpdateCall({
        status: "idle",
        dtmf: [],
        cpt: [],
        error: null,
      });
      expect(newState.status).toBe("error");
      expect(newState.error).toBe("DTMF Worker not initialized.");
    });

    it("should update store with error if resampling fails", async () => {
      // Arrange: Mock the resampling process to fail
      const resamplingError = new Error("Resampling failed");
      mockStartRendering.mockRejectedValueOnce(resamplingError);

      // Act: Call the process method and await its expected rejection
      await expect(dtmfService.process(mockAudioBuffer)).rejects.toThrow(
        resamplingError,
      );

      // Assert:
      // The store should be updated twice: once for 'processing', once for 'error'.
      expect(dtmfStore.update).toHaveBeenCalledTimes(2);

      // Get the second update call (the error one) and test its logic.
      const errorUpdateCall = (dtmfStore.update as Mocked<any>).mock
        .calls[1][0];
      const mockState: DtmfState = {
        status: "processing",
        dtmf: [],
        cpt: [],
        error: null,
      };
      const newState = errorUpdateCall(mockState);

      expect(newState.status).toBe("error");
      expect(newState.error).toContain("Resampling failed");
    });
  });

  describe("dispose", () => {
    it("should terminate worker", () => {
      dtmfService.initialize(16000); // Initialize first
      if (mockDtmfWorkerInstance.onmessage) {
        // Simulate init complete
        mockDtmfWorkerInstance.onmessage({
          data: { type: "init_complete" },
        } as MessageEvent);
      }
      (dtmfStore.update as Mocked<any>).mockClear();

      dtmfService.dispose();

      expect(mockDtmfWorkerInstance.terminate).toHaveBeenCalledTimes(1);
      // Check if worker is set to null (not directly testable for private prop, but terminate is a good indicator)
    });

    it("should do nothing if worker already null", () => {
      dtmfService.dispose(); // Call dispose once to ensure worker is null
      // Since the worker is mocked at the module level and dtmfService is a singleton,
      // the first dispose() call will set its internal worker to null.
      // The DtmfWorker constructor mock won't be called again unless initialize is called.
      // So, the first dispose makes the internal worker null.
      mockDtmfWorkerInstance.terminate.mockClear(); // Clear any calls from previous dispose if any test didn't clean up

      dtmfService.dispose(); // Call again

      expect(mockDtmfWorkerInstance.terminate).not.toHaveBeenCalled();
    });
  });
});
