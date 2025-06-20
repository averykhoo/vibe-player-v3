// vibe-player-v2.0/src/lib/utils/constants.test.ts
import { describe, expect, it } from "vitest";
import * as AllConstants from "./constants";

describe("Constants", () => {
  it("AUDIO_ENGINE_CONSTANTS should be defined and have expected properties", () => {
    expect(AllConstants.AUDIO_ENGINE_CONSTANTS).toBeDefined();
    expect(AllConstants.AUDIO_ENGINE_CONSTANTS.PROCESSOR_NAME).toBe(
      "rubberband-processor",
    );
    // UPDATED TEST: Check for the new, organized path
    expect(AllConstants.AUDIO_ENGINE_CONSTANTS.WASM_BINARY_URL).toBe(
      "/vendor/rubberband/rubberband.wasm",
    );
  });

  it("VAD_CONSTANTS should be defined and have expected properties", () => {
    expect(AllConstants.VAD_CONSTANTS).toBeDefined();
    expect(AllConstants.VAD_CONSTANTS.SAMPLE_RATE).toBe(16000);
    // UPDATED TEST: Check for the new, organized path
    expect(AllConstants.VAD_CONSTANTS.ONNX_MODEL_URL).toBe(
      "/models/silero_vad.onnx",
    );
  });

  it("UI_CONSTANTS should be defined and have expected properties", () => {
    expect(AllConstants.UI_CONSTANTS).toBeDefined();
    expect(AllConstants.UI_CONSTANTS.DEBOUNCE_HASH_UPDATE_MS).toBe(500);
  });

  it("VISUALIZER_CONSTANTS should be defined and have expected properties", () => {
    expect(AllConstants.VISUALIZER_CONSTANTS).toBeDefined();
    expect(AllConstants.VISUALIZER_CONSTANTS.WAVEFORM_COLOR_DEFAULT).toBe(
      "#26828E",
    );
    expect(AllConstants.VISUALIZER_CONSTANTS.SPEC_NORMAL_FFT_SIZE).toBe(8192);
    // UPDATED TEST: Check for the new, organized path
    expect(AllConstants.VISUALIZER_CONSTANTS.FFT_WORKER_SCRIPT_URL).toBe(
      "/vendor/fft.js",
    );
  });

  it("URL_HASH_KEYS should be defined and have expected properties", () => {
    expect(AllConstants.URL_HASH_KEYS).toBeDefined();
    expect(AllConstants.URL_HASH_KEYS.SPEED).toBe("speed");
  });

  it("DTMF_CONSTANTS should be defined and have expected properties", () => {
    expect(AllConstants.DTMF_CONSTANTS).toBeDefined();
    expect(AllConstants.DTMF_CONSTANTS.SAMPLE_RATE).toBe(16000);
  });
});
