// vibe-player-v2/src/lib/workers/dtmf.worker.ts

// --- Constants directly ported from V1's goertzel.js ---
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

// --- Ported GoertzelFilter Class with TypeScript ---
class GoertzelFilter {
  private q1: number = 0;
  private q2: number = 0;
  private N: number;
  private cosine: number;
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
    this.coeff = 2 * this.cosine;
  }

  public reset(): void {
    this.q1 = 0;
    this.q2 = 0;
  }

  public processBlock(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      const q0 = samples[i] + this.coeff * this.q1 - this.q2;
      this.q2 = this.q1;
      this.q1 = q0;
    }
  }

  public getMagnitudeSquared(): number {
    return (
      this.q1 * this.q1 + this.q2 * this.q2 - this.q1 * this.q2 * this.coeff
    );
  }
}

// --- Ported DTMFParser Class with TypeScript ---
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

  public processAudioBlock(audioBlock: Float32Array): string | null {
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

    if (
      maxLowMag < DTMF_ABSOLUTE_MAGNITUDE_THRESHOLD ||
      maxHighMag < DTMF_ABSOLUTE_MAGNITUDE_THRESHOLD
    ) {
      return null;
    }

    // Check relative threshold
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

// --- Worker Logic ---
let dtmfParser: DTMFParser | null = null;

self.onmessage = (event: MessageEvent) => {
  const { type, payload } = event.data;

  try {
    if (type === "init") {
      dtmfParser = new DTMFParser(payload.sampleRate, DTMF_BLOCK_SIZE);
      self.postMessage({ type: "init_complete" });
    } else if (type === "process") {
      if (!dtmfParser) throw new Error("Worker not initialized.");

      const { pcmData } = payload;
      const detectedDtmf: string[] = [];
      let lastDetectedDtmf: string | null = null;

      // Ported processing loop from V1's app.js (simplified for DTMF only)
      for (
        let i = 0;
        i + DTMF_BLOCK_SIZE <= pcmData.length;
        i += DTMF_BLOCK_SIZE
      ) {
        const audioBlock = pcmData.subarray(i, i + DTMF_BLOCK_SIZE);
        const tone = dtmfParser.processAudioBlock(audioBlock);

        if (tone) {
          // A simple logic to avoid adding the same tone for every single block it's detected in
          if (lastDetectedDtmf !== tone) {
            detectedDtmf.push(tone);
          }
          lastDetectedDtmf = tone;
        } else {
          lastDetectedDtmf = null;
        }
      }

      self.postMessage({ type: "result", payload: { dtmf: detectedDtmf } });
    }
  } catch (e) {
    const error = e as Error;
    self.postMessage({ type: "error", payload: error.message });
  }
};
