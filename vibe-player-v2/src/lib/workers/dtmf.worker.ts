// vibe-player-v2/src/lib/workers/dtmf.worker.ts

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION: Constants
// ─────────────────────────────────────────────────────────────────────────────

// --- DTMF Constants directly ported from V1's goertzel.js ---
const DTMF_SAMPLE_RATE = 16000;
const DTMF_BLOCK_SIZE = 410;
const DTMF_RELATIVE_THRESHOLD_FACTOR = 2.0;
const DTMF_ABSOLUTE_MAGNITUDE_THRESHOLD = 4e2;
const DTMF_FREQUENCIES_LOW = [697, 770, 852, 941];
const DTMF_FREQUENCIES_HIGH = [1209, 1336, 1477, 1633];
export const DTMF_CHARACTERS: { [key: string]: string } = {
  "697_1209": "1",
  "697_1336": "2",
  "697_1477": "3",
  "697_1633": "A",
  "770_1209": "4",
  "770_1336": "5",
  "770_1477": "6",
  "770_1633": "B",
  "852_1209": "7",
  "852_1336": "8",
  "852_1477": "9",
  "852_1633": "C",
  "941_1209": "*",
  "941_1336": "0",
  "941_1477": "#",
  "941_1633": "D",
};
// NOTE: CPT constants and classes would be ported here as well for a full implementation.
// For this step, we will focus on DTMF.

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION: DSP Algorithm Implementations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Implements the Goertzel algorithm to detect the magnitude of a specific frequency.
 * This is the corrected version ported from the original, working V1 implementation.
 */
class GoertzelFilter {
  private q1: number = 0;
  private q2: number = 0;
  private N: number;
  private cosine: number;
  private sine: number; // Correctly includes the sine component
  private coeff: number;

  constructor(
    public targetFrequency: number,
    public sampleRate: number,
    N: number,
  ) {
    this.N = N;
    const k = Math.floor(
      0.5 + (this.N * this.targetFrequency) / this.sampleRate,
    );
    const omega = (2 * Math.PI * k) / this.N;
    this.cosine = Math.cos(omega);
    this.sine = Math.sin(omega); // Sine is required for the correct magnitude calculation
    this.coeff = 2 * this.cosine;
  }

  /** Resets the internal state of the filter. */
  public reset(): void {
    this.q1 = 0;
    this.q2 = 0;
  }

  /** Processes a block of audio samples. */
  public processBlock(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      const q0 = samples[i] + this.coeff * this.q1 - this.q2;
      this.q2 = this.q1;
      this.q1 = q0;
    }
  }

  /**
   * Calculates the squared magnitude of the target frequency.
   * This is the mathematically correct formula.
   * @returns {number} The squared magnitude (power) of the signal at the target frequency.
   */
  public getMagnitudeSquared(): number {
    const realPart = this.q1 - this.q2 * this.cosine;
    const imagPart = this.q2 * this.sine;
    return realPart * realPart + imagPart * imagPart;
  }
}

/**
 * Parses DTMF tones from audio blocks using a collection of Goertzel filters.
 */
class DTMFParser {
  private lowGroupFilters: GoertzelFilter[];
  private highGroupFilters: GoertzelFilter[];

  constructor(
    private sampleRate: number,
    private blockSize: number,
  ) {
    this.lowGroupFilters = DTMF_FREQUENCIES_LOW.map(
      (freq) => new GoertzelFilter(freq, this.sampleRate, this.blockSize),
    );
    this.highGroupFilters = DTMF_FREQUENCIES_HIGH.map(
      (freq) => new GoertzelFilter(freq, this.sampleRate, this.blockSize),
    );
  }

  public processAudioBlock(
    audioBlock: Float32Array,
    timestamp: number,
  ): string | null {
    let maxLowMag = -1,
      detectedLowFreq = -1;
    const lowMagnitudes: { [key: number]: number } = {};
    this.lowGroupFilters.forEach((filter) => {
      filter.reset();
      filter.processBlock(audioBlock);
      const magSq = filter.getMagnitudeSquared();
      lowMagnitudes[filter.targetFrequency] = magSq;
      if (magSq > maxLowMag) {
        maxLowMag = magSq;
        detectedLowFreq = filter.targetFrequency;
      }
    });

    let maxHighMag = -1,
      detectedHighFreq = -1;
    const highMagnitudes: { [key: number]: number } = {};
    this.highGroupFilters.forEach((filter) => {
      filter.reset();
      filter.processBlock(audioBlock);
      const magSq = filter.getMagnitudeSquared();
      highMagnitudes[filter.targetFrequency] = magSq;
      if (magSq > maxHighMag) {
        maxHighMag = magSq;
        detectedHighFreq = filter.targetFrequency;
      }
    });

    // Apply absolute threshold check
    if (
      maxLowMag < DTMF_ABSOLUTE_MAGNITUDE_THRESHOLD ||
      maxHighMag < DTMF_ABSOLUTE_MAGNITUDE_THRESHOLD
    ) {
      return null;
    }

    // Apply relative threshold check to ensure one dominant tone per group
    for (const freq in lowMagnitudes) {
      if (
        Number(freq) !== detectedLowFreq &&
        lowMagnitudes[freq] * DTMF_RELATIVE_THRESHOLD_FACTOR > maxLowMag
      )
        return null;
    }
    for (const freq in highMagnitudes) {
      if (
        Number(freq) !== detectedHighFreq &&
        highMagnitudes[freq] * DTMF_RELATIVE_THRESHOLD_FACTOR > maxHighMag
      )
        return null;
    }

    const dtmfKey = `${detectedLowFreq}_${detectedHighFreq}`;
    return (DTMF_CHARACTERS as Record<string, string>)[dtmfKey] || null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION: Worker Logic
// ─────────────────────────────────────────────────────────────────────────────

let dtmfParser: DTMFParser | null = null;

/**
 * Main message handler for the DTMF Web Worker.
 * Responds to 'init' and 'process' messages from the main thread.
 */
self.onmessage = (event: MessageEvent) => {
  const { type, payload } = event.data;

  try {
    if (type === "init") {
      dtmfParser = new DTMFParser(payload.sampleRate, DTMF_BLOCK_SIZE);
      self.postMessage({ type: "init_complete" });
    } else if (type === "process") {
      if (!dtmfParser) throw new Error("DTMF worker has not been initialized.");

      const { pcmData } = payload;
      const detectedDtmf: string[] = [];

      // --- START: CORRECTED V1 PROCESSING LOGIC ---
      let lastDetectedDtmf: string | null = null;
      let consecutiveDtmfDetections = 0;
      const minConsecutiveDtmf = 2; // A tone must be stable for 2 blocks to be registered
      // --- END: CORRECTED V1 PROCESSING LOGIC ---

      // Ported processing loop from V1's app.js (simplified for DTMF only)
      for (
        let i = 0;
        i + DTMF_BLOCK_SIZE <= pcmData.length;
        i += DTMF_BLOCK_SIZE
      ) {
        const audioBlock = pcmData.subarray(i, i + DTMF_BLOCK_SIZE);
        const timestamp = i / DTMF_SAMPLE_RATE;
        const tone = dtmfParser.processAudioBlock(audioBlock, timestamp);

        // --- START: CORRECTED V1 CONFIRMATION LOGIC ---
        if (tone) {
          if (tone === lastDetectedDtmf) {
            consecutiveDtmfDetections++;
          } else {
            lastDetectedDtmf = tone;
            consecutiveDtmfDetections = 1;
          }

          if (
            consecutiveDtmfDetections === minConsecutiveDtmf &&
            (detectedDtmf.length === 0 ||
              detectedDtmf[detectedDtmf.length - 1] !== tone)
          ) {
            detectedDtmf.push(tone);
          }
        } else {
          lastDetectedDtmf = null;
          consecutiveDtmfDetections = 0;
        }
      }

      // For now, CPT is not implemented, so we send an empty array.
      self.postMessage({
        type: "result",
        payload: { dtmf: detectedDtmf, cpt: [] },
      });
    }
  } catch (e) {
    const error = e as Error;
    self.postMessage({ type: "error", payload: error.message });
  }
};
