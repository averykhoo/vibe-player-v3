// vibe-player-v2.3/src/lib/utils/waveform.ts

/**
 * Creates downsampled waveform data from a full AudioBuffer.
 * This is a port of the logic from the original V1 implementation, adapted for the V2.3 architecture.
 * It does not require a worker as it's a fast, synchronous operation.
 *
 * @param audioBuffer The full-resolution AudioBuffer.
 * @param targetPoints The number of data points desired for the final waveform.
 * @returns A 2D array where each sub-array represents a channel's waveform data.
 */
export function createWaveformData(
  audioBuffer: AudioBuffer,
  targetPoints: number = 1024,
): number[][] {
  const numChannels = audioBuffer.numberOfChannels;
  const numSamples = audioBuffer.length;
  const downsampledData: number[][] = Array.from({ length: numChannels }, () =>
    new Array(targetPoints).fill(0),
  );

  // The number of original samples that will be consolidated into a single downsampled point.
  const bucketSize = Math.floor(numSamples / targetPoints);

  if (bucketSize < 1) {
    console.warn(
      "Audio file is shorter than target waveform points. Full resolution will be used.",
    );
    // In this case, we can't downsample. We could implement a more complex resampling,
    // but for now, we'll just return an empty array to prevent errors.
    return [[]];
  }

  // Process each channel separately.
  for (let c = 0; c < numChannels; c++) {
    const channelData = audioBuffer.getChannelData(c);

    // Process each downsampled point.
    for (let i = 0; i < targetPoints; i++) {
      const bucketStart = i * bucketSize;
      const bucketEnd = bucketStart + bucketSize;
      let maxAmplitude = 0;

      // Find the peak amplitude within the current bucket.
      for (let j = bucketStart; j < bucketEnd; j++) {
        const sample = Math.abs(channelData[j]);
        if (sample > maxAmplitude) {
          maxAmplitude = sample;
        }
      }
      downsampledData[c][i] = maxAmplitude;
    }
  }

  return downsampledData;
}