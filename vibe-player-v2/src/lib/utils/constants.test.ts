import { describe, it, expect } from "vitest";
import * as AllConstants from "./constants";

describe("Constants", () => {
  it("AUDIO_ENGINE_CONSTANTS should be defined and have expected properties", () => {
    expect(AllConstants.AUDIO_ENGINE_CONSTANTS).toBeDefined();
    expect(AllConstants.AUDIO_ENGINE_CONSTANTS.PROCESSOR_NAME).toBe(
      "rubberband-processor",
    );
    expect(AllConstants.AUDIO_ENGINE_CONSTANTS.WASM_BINARY_URL).toBe(
      "/rubberband.wasm",
    );
  });

  it("VAD_CONSTANTS should be defined and have expected properties", () => {
    expect(AllConstants.VAD_CONSTANTS).toBeDefined();
    expect(AllConstants.VAD_CONSTANTS.SAMPLE_RATE).toBe(16000);
    expect(AllConstants.VAD_CONSTANTS.DEFAULT_FRAME_SAMPLES).toBe(1536);
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
