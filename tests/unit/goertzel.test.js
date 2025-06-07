// tests/unit/goertzel.test.js

describe('AudioApp.GoertzelFilter', () => {
  const sampleRate = 8000; // Common for voice
  const blockSize = 205; // A typical block size for DTMF at 8kHz

  test('should correctly initialize coefficients', () => {
    const targetFrequency = 697;
    const filter = new AudioApp.GoertzelFilter(targetFrequency, sampleRate, blockSize);
    expect(filter.targetFrequency).toBe(targetFrequency);
    expect(filter.sampleRate).toBe(sampleRate);
    expect(filter.N).toBe(blockSize);
    // Coefficients k, omega, cosine, sine, coeff are internal but crucial
    // We can check if coeff is reasonable, e.g., between -2 and 2
    expect(filter.coeff).toBeGreaterThanOrEqual(-2);
    expect(filter.coeff).toBeLessThanOrEqual(2);
  });

  test('should reset internal state (q1, q2)', () => {
    const filter = new AudioApp.GoertzelFilter(697, sampleRate, blockSize);
    filter.q1 = 10;
    filter.q2 = 20;
    filter.reset();
    expect(filter.q1).toBe(0);
    expect(filter.q2).toBe(0);
  });

  test('processSample should update internal state', () => {
    const filter = new AudioApp.GoertzelFilter(697, sampleRate, blockSize);
    filter.reset();
    filter.processSample(0.5);
    // q1 and q2 will change based on the sample and coeff
    // Exact values depend on coeff, this is a basic check it's not zero
    expect(filter.q1).not.toBe(0);
    // q2 will be 0 after one sample if reset correctly
    expect(filter.q2).toBe(0);
    filter.processSample(-0.2);
    expect(filter.q1).not.toBe(0);
    expect(filter.q2).not.toBe(0);
  });

  test('getMagnitudeSquared should return a positive value', () => {
    const filter = new AudioApp.GoertzelFilter(697, sampleRate, blockSize);
    filter.reset();
    // Process a simple sine wave at the target frequency
    // For a perfect match and N samples, magnitude should be high
    const targetFrequency = 697;
    const amplitude = 0.5;
    const samples = [];
    for (let i = 0; i < blockSize; i++) {
      samples.push(amplitude * Math.sin(2 * Math.PI * targetFrequency * i / sampleRate));
    }
    filter.processBlock(samples);
    const magnitudeSquared = filter.getMagnitudeSquared();
    expect(magnitudeSquared).toBeGreaterThan(0);
    // A more precise assertion would require calculating expected magnitude,
    // which is complex. For now, just ensure it's positive and significant.
    // console.log(`MagSq for ${targetFrequency}Hz: ${magnitudeSquared}`);
  });

  test('getMagnitudeSquared should be low for off-target frequency', () => {
    const targetFrequency = 697;
    const offTargetFrequency = 1209; // A different DTMF frequency
    const filter = new AudioApp.GoertzelFilter(targetFrequency, sampleRate, blockSize);
    filter.reset();

    const amplitude = 0.5;
    const samples = [];
    for (let i = 0; i < blockSize; i++) {
      samples.push(amplitude * Math.sin(2 * Math.PI * offTargetFrequency * i / sampleRate));
    }
    filter.processBlock(samples);
    const magnitudeSquaredOnTarget = filter.getMagnitudeSquared();

    // For comparison, create a filter for the actual signal frequency
    const offTargetFilter = new AudioApp.GoertzelFilter(offTargetFrequency, sampleRate, blockSize);
    offTargetFilter.reset();
    offTargetFilter.processBlock(samples);
    const magnitudeSquaredOffTarget = offTargetFilter.getMagnitudeSquared();

    // Magnitude for the filter's target (697Hz) should be much lower than
    // the magnitude if the filter was tuned to the signal's actual freq (1209Hz)
    expect(magnitudeSquaredOnTarget).toBeLessThan(magnitudeSquaredOffTarget * 0.1); // Arbitrary factor, implies good selectivity
    // console.log(`MagSq for ${targetFrequency}Hz (signal ${offTargetFrequency}Hz): ${magnitudeSquaredOnTarget}`);
    // console.log(`MagSq for ${offTargetFrequency}Hz (signal ${offTargetFrequency}Hz): ${magnitudeSquaredOffTarget}`);
  });
});

describe('AudioApp.DTMFParser', () => {
  // DTMF_SAMPLE_RATE and DTMF_BLOCK_SIZE are available on AudioApp.DTMFParser itself
  // let sampleRate = AudioApp.DTMFParser.DTMF_SAMPLE_RATE; // 16000
  // let blockSize = AudioApp.DTMFParser.DTMF_BLOCK_SIZE;   // 410
  // For simplicity in generating test tones, let's use a slightly different setup
  // that's easier to manage for precise tone generation if needed, or stick to defaults.
  // The Goertzel setup uses AudioApp.DTMFParser.DTMF_SAMPLE_RATE etc. internally.
  // So we should use those constants for generating test data.
  const sampleRate = AudioApp.DTMFParser.DTMF_SAMPLE_RATE; // 16000 Hz
  const blockSize = AudioApp.DTMFParser.DTMF_BLOCK_SIZE;   // 410 samples

  let parser;

  beforeEach(() => {
    // Ensure AudioApp.GoertzelFilter is available as DTMFParser depends on it.
    // jest.setup.js should have loaded goertzel.js, making AudioApp.GoertzelFilter available.
    if (!AudioApp.GoertzelFilter) {
        throw new Error("AudioApp.GoertzelFilter is not loaded. Check jest.setup.js and script load order.");
    }
    parser = new AudioApp.DTMFParser(sampleRate, blockSize);
  });

  function generateTone(freq1, freq2, durationSeconds, amplitude = 0.5) {
    const numSamples = Math.floor(durationSeconds * sampleRate);
    const samples = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      samples[i] = amplitude * (Math.sin(2 * Math.PI * freq1 * t) + Math.sin(2 * Math.PI * freq2 * t)) / 2;
    }
    return samples;
  }

  function generateSilence(durationSeconds) {
    const numSamples = Math.floor(durationSeconds * sampleRate);
    return new Float32Array(numSamples);
  }

  test('should correctly identify DTMF digit "1"', () => {
    const toneSamples = generateTone(697, 1209, blockSize / sampleRate);
    expect(parser.processAudioBlock(toneSamples.slice(0, blockSize))).toBe('1');
  });

  test('should correctly identify DTMF digit "5"', () => {
    const toneSamples = generateTone(770, 1336, blockSize / sampleRate);
    expect(parser.processAudioBlock(toneSamples.slice(0, blockSize))).toBe('5');
  });

  test('should correctly identify DTMF digit "#"', () => {
    const toneSamples = generateTone(941, 1477, blockSize / sampleRate);
    expect(parser.processAudioBlock(toneSamples.slice(0, blockSize))).toBe('#');
  });

  test('should return null for silence', () => {
    const silenceSamples = generateSilence(blockSize / sampleRate);
    expect(parser.processAudioBlock(silenceSamples.slice(0, blockSize))).toBeNull();
  });

  test('should return null for a single tone (not a pair)', () => {
    const singleToneSamples = generateTone(697, 697, blockSize / sampleRate); // Effectively just 697 Hz
    expect(parser.processAudioBlock(singleToneSamples.slice(0, blockSize))).toBeNull();
  });

  test('should handle block size mismatch (though it might warn or be less accurate)', () => {
    // This test is more about ensuring it doesn't crash. Accuracy is not guaranteed by spec.
    const toneSamples = generateTone(697, 1209, (blockSize * 2) / sampleRate);
    // parser.processAudioBlock will use its configured blockSize internally for Goertzel
    // but the input here is different. The current DTMFParser does not internally slice/pad.
    // It processes the given block. If we give a block of different size, Goertzel N is mismatched.
    // The original code in DTMFParser does not enforce audioBlock.length === this.blockSize strictly for processing
    // but Goertzel filters are initialized with this.blockSize.
    // For this test to be meaningful according to how Goertzel is used,
    // we should pass a block of the configured size.
    expect(parser.processAudioBlock(toneSamples.slice(0, blockSize))).toBe('1');

    // Test with a smaller block - this will likely fail or give null as not enough data for filters
    const shortBlock = toneSamples.slice(0, blockSize / 2);
    expect(parser.processAudioBlock(shortBlock)).toBeNull();
  });
});
