// vibe-player-v2.3/src/lib/utils/waveform.test.ts
import { describe, it, expect, vi } from "vitest";
import { createWaveformData } from "./waveform";

// Mock a simple AudioBuffer interface for our tests
const createMockAudioBuffer = (
  channelData: number[][],
  sampleRate: number = 44100,
): AudioBuffer => {
  const numberOfChannels = channelData.length;
  const length = channelData[0]?.length || 0;
  return {
    numberOfChannels,
    length,
    duration: length / sampleRate,
    sampleRate,
    getChannelData: vi.fn(
      (channel: number) => new Float32Array(channelData[channel]),
    ),
    // Add other AudioBuffer properties/methods if needed, but they are not used by the function under test.
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  };
};

describe("createWaveformData", () => {
  it("should correctly downsample a single-channel buffer to find peak amplitudes", () => {
    // 8 samples, target 4 points. Each bucket of 2 samples should yield its max absolute value.
    const mockChannelData = [[0.1, -0.2, 0.9, 0.5, -0.8, -0.3, 0.4, 0.0]];
    const mockBuffer = createMockAudioBuffer(mockChannelData);

    const waveform = createWaveformData(mockBuffer, 4);

    expect(waveform).toHaveLength(1); // 1 channel
    expect(waveform[0]).toHaveLength(4); // 4 downsampled points
    expect(waveform[0][0]).toBeCloseTo(0.2); // max(abs(0.1), abs(-0.2))
    expect(waveform[0][1]).toBeCloseTo(0.9); // max(abs(0.9), abs(0.5))
    expect(waveform[0][2]).toBeCloseTo(0.8); // max(abs(-0.8), abs(-0.3))
    expect(waveform[0][3]).toBeCloseTo(0.4); // max(abs(0.4), abs(0.0))
  });

  it("should handle multi-channel (stereo) audio buffers correctly", () => {
    const mockStereoData = [
      [0.1, -0.2, 0.3, -0.4], // Channel 1
      [0.5, -0.6, 0.7, -0.8], // Channel 2
    ];
    const mockBuffer = createMockAudioBuffer(mockStereoData);

    const waveform = createWaveformData(mockBuffer, 2);

    expect(waveform).toHaveLength(2); // 2 channels
    expect(waveform[0]).toHaveLength(2);
    expect(waveform[1]).toHaveLength(2);

    // Check Channel 1 peaks
    expect(waveform[0][0]).toBeCloseTo(0.2);
    expect(waveform[0][1]).toBeCloseTo(0.4);

    // Check Channel 2 peaks
    expect(waveform[1][0]).toBeCloseTo(0.6);
    expect(waveform[1][1]).toBeCloseTo(0.8);
  });

  it("should return an empty nested array if the audio buffer is shorter than the target points", () => {
    // 4 samples, but we ask for 8 points. Downsampling is not possible.
    const mockShortChannelData = [[0.1, 0.2, 0.3, 0.4]];
    const mockBuffer = createMockAudioBuffer(mockShortChannelData);

    const waveform = createWaveformData(mockBuffer, 8);

    expect(waveform).toEqual([[]]);
  });

  it("should handle an empty audio buffer gracefully", () => {
    const mockEmptyChannelData = [[]];
    const mockBuffer = createMockAudioBuffer(mockEmptyChannelData);
    const waveform = createWaveformData(mockBuffer, 1024);
    expect(waveform[0]).toHaveLength(1024);
    // All values should be 0 since there are no samples
    expect(waveform[0].every((v) => v === 0)).toBe(true);
  });
});
