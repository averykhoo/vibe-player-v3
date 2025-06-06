// --- goertzel.js ---
// Pure JavaScript Goertzel Algorithm Implementation for Vibe Player
// Attaches GoertzelFilter to AudioApp.

var AudioApp = AudioApp || {}; // Ensure AudioApp namespace exists

const GoertzelModule = (function() {
    'use strict';

    // --- DTMF Constants ---
    const DTMF_SAMPLE_RATE = 16000; // Standard sample rate for DTMF processing
    const DTMF_BLOCK_SIZE = 410;   // Common block size for 16kHz sample rate (205 * 2)
    // Relative magnitude threshold: dominant tone must be X times stronger than others in its group
    const DTMF_RELATIVE_THRESHOLD_FACTOR = 2.0; // Example: Dominant tone must be 2x stronger
    // Absolute magnitude threshold: minimum energy for a tone to be considered
    const DTMF_ABSOLUTE_MAGNITUDE_THRESHOLD = 1e3;   // Needs tuning based on input levels and N

    const DTMF_FREQUENCIES_LOW = [697, 770, 852, 941]; // Hz
    const DTMF_FREQUENCIES_HIGH = [1209, 1336, 1477, 1633]; // Hz (including A,B,C,D for completeness)

    const DTMF_CHARACTERS = {
        "697,1209": "1", "697,1336": "2", "697,1477": "3", "697,1633": "A",
        "770,1209": "4", "770,1336": "5", "770,1477": "6", "770,1633": "B",
        "852,1209": "7", "852,1336": "8", "852,1477": "9", "852,1633": "C",
        "941,1209": "*", "941,1336": "0", "941,1477": "#", "941,1633": "D"
    };

    /**
     * Implements the Goertzel algorithm to detect the magnitude of a specific frequency
     * in a block of audio samples.
     */
    class GoertzelFilter {
        /**
         * Creates an instance of GoertzelFilter.
         * @param {number} targetFrequency - The specific frequency (in Hz) this filter will detect.
         * @param {number} sampleRate - The sample rate (in Hz) of the audio signal.
         * @param {number} N - The block size (number of samples) for one analysis window.
         *                   Coefficients are calculated based on this N, and for the most
         *                   straightforward interpretation of getMagnitudeSquared(), exactly
         *                   N samples should be processed after a reset.
         */
        constructor(targetFrequency, sampleRate, N) {
            if (N <= 0) {
                throw new Error("GoertzelFilter: Block size N must be positive.");
            }
            if (sampleRate <= 0) {
                throw new Error("GoertzelFilter: Sample rate must be positive.");
            }
            if (targetFrequency <= 0 || targetFrequency >= sampleRate / 2) {
                // Technically can work, but typically target is < Nyquist
                console.warn("GoertzelFilter: Target frequency is very low or near/above Nyquist frequency. Results may be suboptimal.");
            }

            this.targetFrequency = targetFrequency;
            this.sampleRate = sampleRate;
            this.N = N; // Store N for reference, though it's primarily used for coefficient calculation

            // Precompute coefficients
            // k is the normalized frequency, effectively the DFT bin index we're targeting
            const k = Math.floor(0.5 + (this.N * this.targetFrequency) / this.sampleRate);
            this.omega = (2 * Math.PI * k) / this.N;
            this.cosine = Math.cos(this.omega);
            this.sine = Math.sin(this.omega);
            this.coeff = 2 * this.cosine;

            this.q1 = 0; // Represents s[n-1] state variable
            this.q2 = 0; // Represents s[n-2] state variable
        }

        /**
         * Resets the internal state of the filter (q1 and q2).
         * Call this before processing a new independent block of N samples.
         */
        reset() {
            this.q1 = 0;
            this.q2 = 0;
        }

        /**
         * Processes a single audio sample through the filter.
         * This updates the internal state variables q1 and q2.
         * @param {number} sample - The audio sample value.
         */
        processSample(sample) {
            const q0 = sample + this.coeff * this.q1 - this.q2;
            this.q2 = this.q1;
            this.q1 = q0;
        }

        /**
         * Processes a block (array or Float32Array) of audio samples.
         * Each sample in the block is run through processSample.
         * For the most direct interpretation of getMagnitudeSquared(), this block
         * should contain exactly N samples (where N is from the constructor),
         * and reset() should have been called before processing this block.
         * @param {number[] | Float32Array} samples - The block of audio samples.
         */
        processBlock(samples) {
            for (let i = 0; i < samples.length; i++) {
                // Inline processSample for minor optimization in a loop
                const q0 = samples[i] + this.coeff * this.q1 - this.q2;
                this.q2 = this.q1;
                this.q1 = q0;
            }
        }

        /**
         * Calculates the squared magnitude of the target frequency component.
         * This formula is most directly interpretable as the magnitude of the k-th DFT coefficient
         * if exactly N samples (where N was used to calculate k and omega in the constructor)
         * have been processed since the last call to reset().
         *
         * The value is proportional to the power of the signal at the target frequency.
         * It does not reset the filter's internal state.
         * @returns {number} The squared magnitude.
         */
        getMagnitudeSquared() {
            // Formula for the squared magnitude of the DFT coefficient X(k)
            // after N samples have been processed by the IIR filter stage:
            // |X(k)|^2 = q1^2 + q2^2 - (2 * cos(omega)) * q1 * q2
            //           = q1^2 + q2^2 - coeff * q1 * q2
            //
            // Alternatively, using real and imaginary parts:
            // Real part of X(k) = q1 - q2 * cos(omega)
            // Imaginary part of X(k) = q2 * sin(omega)  (for W_N^{-k} convention in DFT def.)
            // Magnitude^2 = Real^2 + Imag^2
            const realPart = this.q1 - this.q2 * this.cosine;
            const imagPart = this.q2 * this.sine;

            return realPart * realPart + imagPart * imagPart;
        }
    }

    class DTMFParser {
        constructor(sampleRate = DTMF_SAMPLE_RATE, blockSize = DTMF_BLOCK_SIZE, threshold = DTMF_ABSOLUTE_MAGNITUDE_THRESHOLD, relativeThresholdFactor = DTMF_RELATIVE_THRESHOLD_FACTOR) {
            this.sampleRate = sampleRate;
            this.blockSize = blockSize;
            this.threshold = threshold;
            this.relativeThresholdFactor = relativeThresholdFactor;

            this.lowGroupFilters = DTMF_FREQUENCIES_LOW.map(freq =>
                new AudioApp.GoertzelFilter(freq, this.sampleRate, this.blockSize)
            );
            this.highGroupFilters = DTMF_FREQUENCIES_HIGH.map(freq =>
                new AudioApp.GoertzelFilter(freq, this.sampleRate, this.blockSize)
            );
            this.processedBlocksCounter = 0;
        }

        processAudioBlock(audioBlock) {
            this.processedBlocksCounter++;
            if (audioBlock.length !== this.blockSize) {
                // console.warn(`DTMFParser: Audio block length (${audioBlock.length}) does not match expected block size (${this.blockSize}). Results may be inaccurate.`);
                // For now, we'll proceed, but in a real scenario, buffering/windowing would be needed.
            }

            let maxLowMag = -1, detectedLowFreq = -1, totalLowMag = 0;
            const lowMagnitudes = {};

            this.lowGroupFilters.forEach(filter => {
                filter.reset();
                filter.processBlock(audioBlock);
                const magSq = filter.getMagnitudeSquared();
                lowMagnitudes[filter.targetFrequency] = magSq;
                totalLowMag += magSq;
                if (magSq > maxLowMag) {
                    maxLowMag = magSq;
                    detectedLowFreq = filter.targetFrequency;
                }
            });

            let maxHighMag = -1, detectedHighFreq = -1, totalHighMag = 0;
            const highMagnitudes = {};

            this.highGroupFilters.forEach(filter => {
                filter.reset();
                filter.processBlock(audioBlock);
                const magSq = filter.getMagnitudeSquared();
                highMagnitudes[filter.targetFrequency] = magSq;
                totalHighMag += magSq;
                if (magSq > maxHighMag) {
                    maxHighMag = magSq;
                    detectedHighFreq = filter.targetFrequency;
                }
            });

            console.log(`DTMF Raw Detect: Block Time: ${(this.processedBlocksCounter !== undefined ? this.processedBlocksCounter * this.blockSize / this.sampleRate : 'N/A').toFixed(3)}s, Low Freq: ${detectedLowFreq} (MagSq: ${maxLowMag.toExponential(2)}), High Freq: ${detectedHighFreq} (MagSq: ${maxHighMag.toExponential(2)})`);
            // Check absolute threshold
            if (maxLowMag < this.threshold || maxHighMag < this.threshold) {
                return null; // Below absolute threshold
            }

            // Check relative threshold for low group
            for (const freq in lowMagnitudes) {
                if (parseInt(freq) !== detectedLowFreq) {
                    if (lowMagnitudes[freq] * this.relativeThresholdFactor > maxLowMag) {
                        // console.log(`DTMF rejected: Low freq ${detectedLowFreq} not dominant enough over ${freq}`);
                        return null; // Detected low frequency is not dominant enough
                    }
                }
            }

            // Check relative threshold for high group
            for (const freq in highMagnitudes) {
                if (parseInt(freq) !== detectedHighFreq) {
                    if (highMagnitudes[freq] * this.relativeThresholdFactor > maxHighMag) {
                        // console.log(`DTMF rejected: High freq ${detectedHighFreq} not dominant enough over ${freq}`);
                        return null; // Detected high frequency is not dominant enough
                    }
                }
            }

            const dtmfKey = `${detectedLowFreq},${detectedHighFreq}`;
            const detectedChar = DTMF_CHARACTERS[dtmfKey];

            if (detectedChar) {
                // console.log(`DTMF Detected: ${detectedChar} (Low: ${detectedLowFreq}Hz, High: ${detectedHighFreq}Hz, LowMag: ${maxLowMag.toExponential(2)}, HighMag: ${maxHighMag.toExponential(2)})`);
                return detectedChar;
            }

            return null;
        }
    }

    return {
        GoertzelFilter: GoertzelFilter,
        DTMFParser: DTMFParser,
        // Expose constants for external use if needed
        DTMF_SAMPLE_RATE: DTMF_SAMPLE_RATE,
        DTMF_BLOCK_SIZE: DTMF_BLOCK_SIZE
    };
})();

AudioApp.GoertzelFilter = GoertzelModule.GoertzelFilter;
AudioApp.DTMFParser = GoertzelModule.DTMFParser;
// Make constants available on DTMFParser (or a dedicated constants object)
AudioApp.DTMFParser.DTMF_SAMPLE_RATE = GoertzelModule.DTMF_SAMPLE_RATE;
AudioApp.DTMFParser.DTMF_BLOCK_SIZE = GoertzelModule.DTMF_BLOCK_SIZE;

// Example Usage (for testing or a DTMF detector module):
/*
if (typeof AudioApp.GoertzelFilter !== 'undefined') {
    const SAMPLE_RATE = 8000; // Example
    const N_SAMPLES_PER_BLOCK = 205; // Common for DTMF at 8kHz

    // DTMF Frequencies
    const dtmfLowFreqs = [697, 770, 852, 941];
    const dtmfHighFreqs = [1209, 1336, 1477]; // Excluding 1633 for A,B,C,D for now

    const lowGroupFilters = dtmfLowFreqs.map(freq =>
        new AudioApp.GoertzelFilter(freq, SAMPLE_RATE, N_SAMPLES_PER_BLOCK)
    );
    const highGroupFilters = dtmfHighFreqs.map(freq =>
        new AudioApp.GoertzelFilter(freq, SAMPLE_RATE, N_SAMPLES_PER_BLOCK)
    );

    // Assume `audioBlock` is a Float32Array of N_SAMPLES_PER_BLOCK audio data
    function detectDTMF(audioBlock) {
        if (audioBlock.length !== N_SAMPLES_PER_BLOCK) {
            console.warn("Audio block length does not match N_SAMPLES_PER_BLOCK for Goertzel filters.");
            // Handle this case: either pad/truncate, or re-initialize filters with audioBlock.length
            // For simplicity here, we'll assume it matches.
        }

        let maxLowMag = -1, detectedLowFreq = -1;
        lowGroupFilters.forEach(filter => {
            filter.reset();
            filter.processBlock(audioBlock);
            const magSq = filter.getMagnitudeSquared();
            if (magSq > maxLowMag) {
                maxLowMag = magSq;
                detectedLowFreq = filter.targetFrequency;
            }
        });

        let maxHighMag = -1, detectedHighFreq = -1;
        highGroupFilters.forEach(filter => {
            filter.reset();
            filter.processBlock(audioBlock);
            const magSq = filter.getMagnitudeSquared();
            if (magSq > maxHighMag) {
                maxHighMag = magSq;
                detectedHighFreq = filter.targetFrequency;
            }
        });

        // Example thresholds (these need careful tuning!)
        const dtmfThreshold = 1e5; // Arbitrary, depends on N, input signal level, etc.
        const relativeThresholdFactor = 5; // Dominant tone should be X times stronger

        // Basic check if dominant tones are strong enough
        if (maxLowMag > dtmfThreshold && maxHighMag > dtmfThreshold) {
            // Add more checks: e.g., ensure the detected freqs are significantly stronger
            // than other freqs in their group.
            // For now, just log:
            console.log(`Potential DTMF: Low Freq ${detectedLowFreq} (MagSq ${maxLowMag.toExponential(2)}), High Freq ${detectedHighFreq} (MagSq ${maxHighMag.toExponential(2)})`);
            // Map (detectedLowFreq, detectedHighFreq) to a digit here
            return { low: detectedLowFreq, high: detectedHighFreq };
        }
        return null;
    }

    // To test:
    // const testSignal = new Float32Array(N_SAMPLES_PER_BLOCK);
    // // Fill testSignal with, e.g., sin(2*pi*697*t/8000) + sin(2*pi*1209*t/8000)
    // // detectDTMF(testSignal);
}
*/