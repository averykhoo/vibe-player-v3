// --- goertzel.js ---
// Pure JavaScript Goertzel Algorithm Implementation for Vibe Player
// Attaches GoertzelFilter to AudioApp.

/** @namespace AudioApp */
var AudioApp = AudioApp || {}; // Ensure AudioApp namespace exists

/**
 * @module GoertzelModule
 * @description Provides GoertzelFilter, DTMFParser, CallProgressToneParser classes and related constants.
 */
const GoertzelModule = (function() {
    'use strict';

    // --- DTMF Constants ---
    /** @type {number} Standard sample rate for DTMF processing (Hz). */
    const DTMF_SAMPLE_RATE = 16000;
    /** @type {number} Common block size for 16kHz sample rate (samples). */
    const DTMF_BLOCK_SIZE = 410;
    /** @type {number} Relative magnitude threshold factor: dominant tone must be X times stronger than others in its group. */
    const DTMF_RELATIVE_THRESHOLD_FACTOR = 2.0;
    /** @type {number} Absolute magnitude threshold: minimum energy for a tone to be considered. */
    const DTMF_ABSOLUTE_MAGNITUDE_THRESHOLD = 4e2;

    /** @type {number[]} Low frequency group for DTMF (Hz). */
    const DTMF_FREQUENCIES_LOW = [697, 770, 852, 941];
    /** @type {number[]} High frequency group for DTMF (Hz), including A,B,C,D. */
    const DTMF_FREQUENCIES_HIGH = [1209, 1336, 1477, 1633];

    /** @type {Object<string, string>} Maps DTMF frequency pairs to characters. Key: "lowFreq,highFreq". */
    const DTMF_CHARACTERS = {
        "697,1209": "1", "697,1336": "2", "697,1477": "3", "697,1633": "A",
        "770,1209": "4", "770,1336": "5", "770,1477": "6", "770,1633": "B",
        "852,1209": "7", "852,1336": "8", "852,1477": "9", "852,1633": "C",
        "941,1209": "*", "941,1336": "0", "941,1477": "#", "941,1633": "D"
    };

    // --- Call Progress Tone Frequencies (Hz) ---
    /** @type {number[]} Frequencies for Dial Tone. */
    const CPT_FREQ_DIAL_TONE = [350, 440];
    /** @type {number[]} Frequencies for Busy Signal. */
    const CPT_FREQ_BUSY_SIGNAL = [480, 620];
    /** @type {number[]} Frequencies for Reorder Tone (same as Busy). */
    const CPT_FREQ_REORDER_TONE = [480, 620];
    /** @type {number[]} Frequencies for Ringback Tone. */
    const CPT_FREQ_RINGBACK_TONE = [440, 480];
    /** @type {number[]} Frequencies for Off-Hook Warning Tone. */
    const CPT_FREQ_OFF_HOOK_WARNING = [1400, 2060, 2450, 2600];
    /** @type {number[]} Frequencies for Call Waiting Tone. */
    const CPT_FREQ_CALL_WAITING_TONE = [440];

    // --- Call Progress Tone Cadences (ms ON, ms OFF) ---
    /** @typedef {{on: number, off: number}} CadenceSpec */
    /** @type {CadenceSpec} Cadence for Busy Signal. */
    const CPT_CADENCE_BUSY_SIGNAL = { on: 500, off: 500 };
    /** @type {CadenceSpec} Cadence for Reorder Tone. */
    const CPT_CADENCE_REORDER_TONE = { on: 250, off: 250 };
    /** @type {CadenceSpec} Cadence for Ringback Tone. */
    const CPT_CADENCE_RINGBACK_TONE = { on: 2000, off: 4000 };
    /** @type {CadenceSpec} Cadence for Call Waiting Tone. */
    const CPT_CADENCE_CALL_WAITING_TONE = { on: 300, off: 9700 }; // Approximate

    // --- Call Progress Tone Parser Constants ---
    /** @type {number} Default sample rate for CPT parser (Hz). */
    const CPT_DEFAULT_SAMPLE_RATE = DTMF_SAMPLE_RATE;
    /** @type {number} Default block size for CPT parser (samples). */
    const CPT_DEFAULT_BLOCK_SIZE = DTMF_BLOCK_SIZE;
    /** @type {number} Default absolute magnitude threshold for CPT parser. */
    const CPT_DEFAULT_ABSOLUTE_MAGNITUDE_THRESHOLD = 2e2;
    /** @type {number} Default relative magnitude threshold factor for CPT parser. */
    const CPT_DEFAULT_RELATIVE_THRESHOLD_FACTOR = 1.5;
    /** @type {number} Tolerance (percentage) for CPT cadence timing. */
    const CPT_CADENCE_TOLERANCE_PERCENT = 0.25;
    /** @type {number} Minimum number of cycles for confirming a cadenced CPT. */
    const CPT_MIN_CYCLE_CONFIRMATION = 1.5;


    /**
     * @class GoertzelFilter
     * @memberof AudioApp
     * @description Implements the Goertzel algorithm to detect the magnitude of a specific frequency
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

            /** @type {number} The target frequency for this filter instance. */
            this.targetFrequency = targetFrequency;
            /** @type {number} The sample rate assumed by this filter instance. */
            this.sampleRate = sampleRate;
            /** @type {number} The block size (N) used for coefficient calculation. */
            this.N = N;

            // Precompute coefficients
            /** @private @type {number} Normalized frequency (DFT bin index). */
            const k = Math.floor(0.5 + (this.N * this.targetFrequency) / this.sampleRate);
            /** @private @type {number} Angular frequency. */
            this.omega = (2 * Math.PI * k) / this.N;
            /** @private @type {number} Cosine of omega. */
            this.cosine = Math.cos(this.omega);
            /** @private @type {number} Sine of omega. */
            this.sine = Math.sin(this.omega);
            /** @private @type {number} Filter coefficient (2 * cos(omega)). */
            this.coeff = 2 * this.cosine;

            /** @private @type {number} Represents s[n-1] state variable. */
            this.q1 = 0;
            /** @private @type {number} Represents s[n-2] state variable. */
            this.q2 = 0;
        }

        /**
         * Resets the internal state of the filter (q1 and q2).
         * Call this before processing a new independent block of N samples.
         * @public
         */
        reset() {
            this.q1 = 0;
            this.q2 = 0;
        }

        /**
         * Processes a single audio sample through the filter.
         * This updates the internal state variables q1 and q2.
         * @public
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
         * @public
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
         * This value is proportional to the power of the signal at the target frequency.
         * It does not reset the filter's internal state.
         * @public
         * @returns {number} The squared magnitude.
         */
        getMagnitudeSquared() {
            const realPart = this.q1 - this.q2 * this.cosine;
            const imagPart = this.q2 * this.sine;
            return realPart * realPart + imagPart * imagPart;
        }
    }

    /**
     * @class DTMFParser
     * @memberof AudioApp
     * @description Parses DTMF tones from audio blocks using Goertzel filters.
     * Note: This parser can be quite robust and may detect tones even if the provided
     * audioBlock is somewhat shorter than the configured blockSize, provided enough
     * characteristic signal is present.
     */
    class DTMFParser {
        /**
         * Creates an instance of DTMFParser.
         * @param {number} [sampleRate=DTMF_SAMPLE_RATE] - Sample rate of the audio.
         * @param {number} [blockSize=DTMF_BLOCK_SIZE] - Size of audio blocks to process.
         * @param {number} [threshold=DTMF_ABSOLUTE_MAGNITUDE_THRESHOLD] - Absolute magnitude threshold for tone detection.
         * @param {number} [relativeThresholdFactor=DTMF_RELATIVE_THRESHOLD_FACTOR] - Relative threshold factor for distinguishing tones.
         */
        constructor(sampleRate = DTMF_SAMPLE_RATE, blockSize = DTMF_BLOCK_SIZE, threshold = DTMF_ABSOLUTE_MAGNITUDE_THRESHOLD, relativeThresholdFactor = DTMF_RELATIVE_THRESHOLD_FACTOR) {
            /** @type {number} Sample rate in Hz. */
            this.sampleRate = sampleRate;
            /** @type {number} Block size in samples. */
            this.blockSize = blockSize;
            /** @type {number} Absolute magnitude detection threshold. */
            this.threshold = threshold;
            /** @type {number} Relative magnitude threshold factor. */
            this.relativeThresholdFactor = relativeThresholdFactor;

            /** @private @type {AudioApp.GoertzelFilter[]} Filters for low DTMF frequencies. */
            this.lowGroupFilters = DTMF_FREQUENCIES_LOW.map(freq =>
                new GoertzelFilter(freq, this.sampleRate, this.blockSize) // Changed: Use GoertzelFilter directly
            );
            /** @private @type {AudioApp.GoertzelFilter[]} Filters for high DTMF frequencies. */
            this.highGroupFilters = DTMF_FREQUENCIES_HIGH.map(freq =>
                new GoertzelFilter(freq, this.sampleRate, this.blockSize) // Changed: Use GoertzelFilter directly
            );
            /** @private @type {number} Counter for processed blocks (for debugging/logging). */
            this.processedBlocksCounter = 0;
        }

        /**
         * Processes a block of audio data to detect a DTMF tone.
         * @public
         * @param {Float32Array | number[]} audioBlock - The audio data to process. Must match blockSize.
         * @returns {string | null} The detected DTMF character ('0'-'9', '*', '#', 'A'-'D'), or null if no tone is detected.
         */
        processAudioBlock(audioBlock) {
            this.processedBlocksCounter++;
            if (audioBlock.length !== this.blockSize) {
                // console.warn(`DTMFParser: Audio block length (${audioBlock.length}) does not match expected block size (${this.blockSize}). Results may be inaccurate.`);
            }

            /** @type {number} */ let maxLowMag = -1;
            /** @type {number} */ let detectedLowFreq = -1;
            /** @type {Object<number, number>} */ const lowMagnitudes = {};

            this.lowGroupFilters.forEach(filter => {
                filter.reset();
                filter.processBlock(audioBlock);
                const magSq = filter.getMagnitudeSquared();
                lowMagnitudes[filter.targetFrequency] = magSq;
                if (magSq > maxLowMag) {
                    maxLowMag = magSq;
                    detectedLowFreq = filter.targetFrequency;
                }
            });

            /** @type {number} */ let maxHighMag = -1;
            /** @type {number} */ let detectedHighFreq = -1;
            /** @type {Object<number, number>} */ const highMagnitudes = {};

            this.highGroupFilters.forEach(filter => {
                filter.reset();
                filter.processBlock(audioBlock);
                const magSq = filter.getMagnitudeSquared();
                highMagnitudes[filter.targetFrequency] = magSq;
                if (magSq > maxHighMag) {
                    maxHighMag = magSq;
                    detectedHighFreq = filter.targetFrequency;
                }
            });

            if (maxLowMag < this.threshold || maxHighMag < this.threshold) {
                return null;
            }

            for (const freqStr in lowMagnitudes) {
                const freq = parseInt(freqStr);
                if (freq !== detectedLowFreq) {
                    if (lowMagnitudes[freq] * this.relativeThresholdFactor > maxLowMag) {
                        return null;
                    }
                }
            }

            for (const freqStr in highMagnitudes) {
                const freq = parseInt(freqStr);
                if (freq !== detectedHighFreq) {
                    if (highMagnitudes[freq] * this.relativeThresholdFactor > maxHighMag) {
                        return null;
                    }
                }
            }

            const dtmfKey = `${detectedLowFreq},${detectedHighFreq}`;
            const detectedChar = DTMF_CHARACTERS[dtmfKey];

            return detectedChar || null;
        }
    }

    /**
     * @typedef {Object} CadenceState
     * @property {CadenceSpec} spec - The ON/OFF duration specification.
     * @property {number[]} frequencies - The frequencies that constitute the tone.
     * @property {'ON' | 'OFF'} phase - Current phase of the cadence ('ON' or 'OFF').
     * @property {number} timerBlocks - Number of blocks spent in the current phase.
     * @property {number} cyclesDetected - Number of full ON/OFF cycles detected.
     * @property {any[]} history - Optional history for complex pattern matching.
     * @property {number} onBlocksTarget - Target number of blocks for the ON phase.
     * @property {number} offBlocksTarget - Target number of blocks for the OFF phase.
     */

    /**
     * @typedef {Object} ContinuousToneState
     * @property {number[]} requiredFreqs - Frequencies that must be present.
     * @property {number} presentBlocks - Number of consecutive blocks the tone has been present.
     * @property {number} neededBlocks - Number of consecutive blocks needed to confirm the tone.
     */

    /**
     * @class CallProgressToneParser
     * @memberof AudioApp
     * @description Parses call progress tones (e.g., busy, ringback) from audio blocks.
     */
    class CallProgressToneParser {
        /**
         * Creates an instance of CallProgressToneParser.
         * @param {number} [sampleRate=CPT_DEFAULT_SAMPLE_RATE] - Sample rate of the audio.
         * @param {number} [blockSize=CPT_DEFAULT_BLOCK_SIZE] - Size of audio blocks to process.
         * @param {number} [absoluteMagnitudeThreshold=CPT_DEFAULT_ABSOLUTE_MAGNITUDE_THRESHOLD] - Absolute magnitude threshold.
         * @param {number} [relativeThresholdFactor=CPT_DEFAULT_RELATIVE_THRESHOLD_FACTOR] - Relative threshold factor.
         */
        constructor(
            sampleRate = CPT_DEFAULT_SAMPLE_RATE,
            blockSize = CPT_DEFAULT_BLOCK_SIZE,
            absoluteMagnitudeThreshold = CPT_DEFAULT_ABSOLUTE_MAGNITUDE_THRESHOLD,
            relativeThresholdFactor = CPT_DEFAULT_RELATIVE_THRESHOLD_FACTOR
        ) {
            /** @type {number} Sample rate in Hz. */
            this.sampleRate = sampleRate;
            /** @type {number} Block size in samples. */
            this.blockSize = blockSize;
            /** @type {number} Absolute magnitude detection threshold. */
            this.absoluteMagnitudeThreshold = absoluteMagnitudeThreshold;
            /** @type {number} Relative magnitude threshold factor for multi-frequency tones. */
            this.relativeThresholdFactor = relativeThresholdFactor;

            /** @type {number} Duration of one audio block in milliseconds. */
            this.blockDurationMs = (this.blockSize / this.sampleRate) * 1000;

            /** @private @type {Set<number>} Unique frequencies used by CPTs. */
            const allCptFrequencies = new Set([
                ...CPT_FREQ_DIAL_TONE, ...CPT_FREQ_BUSY_SIGNAL,
                ...CPT_FREQ_RINGBACK_TONE, ...CPT_FREQ_OFF_HOOK_WARNING,
                ...CPT_FREQ_CALL_WAITING_TONE
            ]);

            /** @private @type {Object<number, AudioApp.GoertzelFilter>} Goertzel filters for each CPT frequency. */
            this.filters = {};
            allCptFrequencies.forEach(freq => {
                this.filters[freq] = new GoertzelFilter(freq, this.sampleRate, this.blockSize); // Changed: Use GoertzelFilter directly
            });

            /**
             * @private
             * @type {Object<string, CadenceState>} State for cadenced tones.
             */
            this.cadenceStates = {
                Busy: this._initCadenceState(CPT_CADENCE_BUSY_SIGNAL, CPT_FREQ_BUSY_SIGNAL),
                Reorder: this._initCadenceState(CPT_CADENCE_REORDER_TONE, CPT_FREQ_REORDER_TONE),
                Ringback: this._initCadenceState(CPT_CADENCE_RINGBACK_TONE, CPT_FREQ_RINGBACK_TONE),
                CallWaiting: this._initCadenceState(CPT_CADENCE_CALL_WAITING_TONE, CPT_FREQ_CALL_WAITING_TONE),
            };

            /**
             * @private
             * @type {Object<string, ContinuousToneState>} State for continuous tones.
             */
            this.continuousToneStates = {
                DialTone: { requiredFreqs: CPT_FREQ_DIAL_TONE, presentBlocks: 0, neededBlocks: 2 },
                OffHookWarning: { requiredFreqs: CPT_FREQ_OFF_HOOK_WARNING, presentBlocks: 0, neededBlocks: 2 }
            };
        }

        /**
         * Initializes the state object for a cadenced tone.
         * @private
         * @param {CadenceSpec} cadenceSpec - The ON/OFF duration specification.
         * @param {number[]} frequencies - The frequencies that constitute the tone.
         * @returns {CadenceState} The initialized state object.
         */
        _initCadenceState(cadenceSpec, frequencies) {
            return {
                spec: cadenceSpec,
                frequencies: frequencies,
                phase: 'OFF',
                timerBlocks: 0,
                cyclesDetected: 0,
                history: [],
                onBlocksTarget: Math.round(cadenceSpec.on / this.blockDurationMs),
                offBlocksTarget: Math.round(cadenceSpec.off / this.blockDurationMs),
            };
        }

        /**
         * Checks if a single frequency is present based on its magnitude.
         * @private
         * @param {number} freq - The frequency to check.
         * @param {Object<number, number>} magnitudes - Object mapping frequencies to their magnitudes.
         * @returns {boolean} True if the frequency is considered present.
         */
        _checkFrequencyPresence(freq, magnitudes) {
            return magnitudes[freq] >= this.absoluteMagnitudeThreshold;
        }

        /**
         * Checks if multiple required frequencies are present.
         * @private
         * @param {number[]} requiredFreqs - Array of frequencies that should be present.
         * @param {Object<number, number>} magnitudes - Object mapping frequencies to their magnitudes.
         * @param {boolean} [allowSingleComponent=false] - If true, allows detection if at least one component of a multi-frequency tone is present.
         * @returns {boolean} True if the required frequencies are considered present according to the criteria.
         */
        _checkMultiFrequencyPresence(requiredFreqs, magnitudes, allowSingleComponent = false) {
            let detectedCount = 0;
            for (const freq of requiredFreqs) {
                if (magnitudes[freq] && magnitudes[freq] >= this.absoluteMagnitudeThreshold) {
                    detectedCount++;
                } else {
                    if (!allowSingleComponent && requiredFreqs.length > 1) return false;
                }
            }
            if (requiredFreqs.length === 1) return detectedCount === 1;
            return allowSingleComponent ? detectedCount > 0 : detectedCount === requiredFreqs.length;
        }

        /**
         * Updates the cadence state for a given tone based on current activity.
         * @private
         * @param {string} toneName - The name of the tone (key in this.cadenceStates).
         * @param {boolean} isToneActiveNow - Whether the tone's frequencies are currently detected.
         * @returns {boolean} True if the cadence for this tone is confirmed.
         */
        _updateCadenceState(toneName, isToneActiveNow) {
            const state = this.cadenceStates[toneName];
            const toleranceOn = Math.ceil(state.onBlocksTarget * CPT_CADENCE_TOLERANCE_PERCENT);
            const toleranceOff = Math.ceil(state.offBlocksTarget * CPT_CADENCE_TOLERANCE_PERCENT);

            if (isToneActiveNow) {
                if (state.phase === 'OFF') {
                    if (state.timerBlocks >= state.offBlocksTarget - toleranceOff || state.cyclesDetected === 0) {
                        state.cyclesDetected += 0.5;
                    } else {
                        state.cyclesDetected = 0;
                    }
                    state.phase = 'ON';
                    state.timerBlocks = 0;
                }
                state.timerBlocks++;
            } else {
                if (state.phase === 'ON') {
                    if (state.timerBlocks >= state.onBlocksTarget - toleranceOn) {
                        state.cyclesDetected += 0.5;
                    } else {
                        state.cyclesDetected = 0;
                    }
                    state.phase = 'OFF';
                    state.timerBlocks = 0;
                }
                state.timerBlocks++;
                if (state.timerBlocks > state.offBlocksTarget + toleranceOff && state.cyclesDetected < CPT_MIN_CYCLE_CONFIRMATION) {
                    state.cyclesDetected = 0;
                }
            }
            return state.cyclesDetected >= CPT_MIN_CYCLE_CONFIRMATION;
        }

        /**
         * Processes a block of audio data to detect call progress tones.
         * @public
         * @param {Float32Array | number[]} audioBlock - The audio data to process. Must match blockSize.
         * @returns {string | null} The name of the detected CPT (e.g., "Dial Tone", "Busy Signal"), or null if no tone is confirmed.
         */
        processAudioBlock(audioBlock) {
            if (audioBlock.length !== this.blockSize) {
                console.warn(`CallProgressToneParser: Audio block length (${audioBlock.length}) does not match expected block size (${this.blockSize}).`);
                return null;
            }

            /** @type {Object<number, number>} */ const magnitudes = {};
            for (const freq in this.filters) {
                this.filters[freq].reset();
                this.filters[freq].processBlock(audioBlock);
                magnitudes[freq] = this.filters[freq].getMagnitudeSquared();
            }

            const dialTonePresent = this._checkMultiFrequencyPresence(CPT_FREQ_DIAL_TONE, magnitudes);
            if (dialTonePresent) {
                this.continuousToneStates.DialTone.presentBlocks++;
                if (this.continuousToneStates.DialTone.presentBlocks >= this.continuousToneStates.DialTone.neededBlocks) {
                    for (const tone in this.cadenceStates) this.cadenceStates[tone].cyclesDetected = 0;
                    return "Dial Tone";
                }
            } else {
                this.continuousToneStates.DialTone.presentBlocks = 0;
            }

            const offHookPresent = this._checkMultiFrequencyPresence(CPT_FREQ_OFF_HOOK_WARNING, magnitudes);
            if (offHookPresent) {
                this.continuousToneStates.OffHookWarning.presentBlocks++;
                 if (this.continuousToneStates.OffHookWarning.presentBlocks >= this.continuousToneStates.OffHookWarning.neededBlocks) {
                    for (const tone in this.cadenceStates) this.cadenceStates[tone].cyclesDetected = 0;
                    return "Off-Hook Warning";
                }
            } else {
                 this.continuousToneStates.OffHookWarning.presentBlocks = 0;
            }

            if (this.continuousToneStates.DialTone.presentBlocks >= this.continuousToneStates.DialTone.neededBlocks ||
                this.continuousToneStates.OffHookWarning.presentBlocks >= this.continuousToneStates.OffHookWarning.neededBlocks) {
                // Return early if a continuous tone is confirmed
            }

            const busyToneActive = this._checkMultiFrequencyPresence(CPT_FREQ_BUSY_SIGNAL, magnitudes);
            if (this._updateCadenceState('Busy', busyToneActive)) {
                return "Busy Signal";
            }

            const reorderToneActive = this._checkMultiFrequencyPresence(CPT_FREQ_REORDER_TONE, magnitudes);
            if (this._updateCadenceState('Reorder', reorderToneActive)) {
                return "Fast Busy / Reorder Tone";
            }

            const ringbackToneActive = this._checkMultiFrequencyPresence(CPT_FREQ_RINGBACK_TONE, magnitudes);
            if (this._updateCadenceState('Ringback', ringbackToneActive)) {
                return "Ringback Tone";
            }

            const callWaitingToneActive = this._checkMultiFrequencyPresence(CPT_FREQ_CALL_WAITING_TONE, magnitudes, true);
            if (this._updateCadenceState('CallWaiting', callWaitingToneActive)) {
                return "Call Waiting Tone";
            }

            return null;
        }
    }

    /**
     * @typedef {Object} GoertzelModuleReturn
     * @property {typeof GoertzelFilter} GoertzelFilter
     * @property {typeof DTMFParser} DTMFParser
     * @property {typeof CallProgressToneParser} CallProgressToneParser
     * @property {number} DTMF_SAMPLE_RATE
     * @property {number} DTMF_BLOCK_SIZE
     * @property {number[]} CPT_FREQ_DIAL_TONE
     * @property {number[]} CPT_FREQ_BUSY_SIGNAL
     * @property {number[]} CPT_FREQ_REORDER_TONE
     * @property {number[]} CPT_FREQ_RINGBACK_TONE
     * @property {number[]} CPT_FREQ_OFF_HOOK_WARNING
     * @property {number[]} CPT_FREQ_CALL_WAITING_TONE
     * @property {CadenceSpec} CPT_CADENCE_BUSY_SIGNAL
     * @property {CadenceSpec} CPT_CADENCE_REORDER_TONE
     * @property {CadenceSpec} CPT_CADENCE_RINGBACK_TONE
     * @property {CadenceSpec} CPT_CADENCE_CALL_WAITING_TONE
     * @property {number} CPT_DEFAULT_SAMPLE_RATE
     * @property {number} CPT_DEFAULT_BLOCK_SIZE
     * @property {number} CPT_DEFAULT_ABSOLUTE_MAGNITUDE_THRESHOLD
     * @property {number} CPT_DEFAULT_RELATIVE_THRESHOLD_FACTOR
     * @property {number} CPT_CADENCE_TOLERANCE_PERCENT
     * @property {number} CPT_MIN_CYCLE_CONFIRMATION
     */

    /** @type {GoertzelModuleReturn} */
    return {
        GoertzelFilter: GoertzelFilter,
        DTMFParser: DTMFParser,
        CallProgressToneParser: CallProgressToneParser,
        DTMF_SAMPLE_RATE: DTMF_SAMPLE_RATE,
        DTMF_BLOCK_SIZE: DTMF_BLOCK_SIZE,

        CPT_FREQ_DIAL_TONE: CPT_FREQ_DIAL_TONE,
        CPT_FREQ_BUSY_SIGNAL: CPT_FREQ_BUSY_SIGNAL,
        CPT_FREQ_REORDER_TONE: CPT_FREQ_REORDER_TONE,
        CPT_FREQ_RINGBACK_TONE: CPT_FREQ_RINGBACK_TONE,
        CPT_FREQ_OFF_HOOK_WARNING: CPT_FREQ_OFF_HOOK_WARNING,
        CPT_FREQ_CALL_WAITING_TONE: CPT_FREQ_CALL_WAITING_TONE,
        CPT_CADENCE_BUSY_SIGNAL: CPT_CADENCE_BUSY_SIGNAL,
        CPT_CADENCE_REORDER_TONE: CPT_CADENCE_REORDER_TONE,
        CPT_CADENCE_RINGBACK_TONE: CPT_CADENCE_RINGBACK_TONE,
        CPT_CADENCE_CALL_WAITING_TONE: CPT_CADENCE_CALL_WAITING_TONE,

        CPT_DEFAULT_SAMPLE_RATE: CPT_DEFAULT_SAMPLE_RATE,
        CPT_DEFAULT_BLOCK_SIZE: CPT_DEFAULT_BLOCK_SIZE,
        CPT_DEFAULT_ABSOLUTE_MAGNITUDE_THRESHOLD: CPT_DEFAULT_ABSOLUTE_MAGNITUDE_THRESHOLD,
        CPT_DEFAULT_RELATIVE_THRESHOLD_FACTOR: CPT_DEFAULT_RELATIVE_THRESHOLD_FACTOR,
        CPT_CADENCE_TOLERANCE_PERCENT: CPT_CADENCE_TOLERANCE_PERCENT,
        CPT_MIN_CYCLE_CONFIRMATION: CPT_MIN_CYCLE_CONFIRMATION
    };
})();

/** @type {typeof GoertzelModule.GoertzelFilter} */
AudioApp.GoertzelFilter = GoertzelModule.GoertzelFilter;
/** @type {typeof GoertzelModule.DTMFParser} */
AudioApp.DTMFParser = GoertzelModule.DTMFParser;
/** @type {typeof GoertzelModule.CallProgressToneParser} */
AudioApp.CallProgressToneParser = GoertzelModule.CallProgressToneParser;

/** @type {number} Standard sample rate for DTMF processing (Hz). */
AudioApp.DTMFParser.DTMF_SAMPLE_RATE = GoertzelModule.DTMF_SAMPLE_RATE;
/** @type {number} Common block size for DTMF processing (samples). */
AudioApp.DTMFParser.DTMF_BLOCK_SIZE = GoertzelModule.DTMF_BLOCK_SIZE;

/**
 * @namespace AudioApp.CPT_CONSTANTS
 * @description Constants related to Call Progress Tones.
 * @property {number[]} CPT_FREQ_DIAL_TONE
 * @property {number[]} CPT_FREQ_BUSY_SIGNAL
 * @property {number[]} CPT_FREQ_REORDER_TONE
 * @property {number[]} CPT_FREQ_RINGBACK_TONE
 * @property {number[]} CPT_FREQ_OFF_HOOK_WARNING
 * @property {number[]} CPT_FREQ_CALL_WAITING_TONE
 * @property {CadenceSpec} CPT_CADENCE_BUSY_SIGNAL
 * @property {CadenceSpec} CPT_CADENCE_REORDER_TONE
 * @property {CadenceSpec} CPT_CADENCE_RINGBACK_TONE
 * @property {CadenceSpec} CPT_CADENCE_CALL_WAITING_TONE
 * @property {number} CPT_DEFAULT_SAMPLE_RATE
 * @property {number} CPT_DEFAULT_BLOCK_SIZE
 * @property {number} CPT_DEFAULT_ABSOLUTE_MAGNITUDE_THRESHOLD
 * @property {number} CPT_DEFAULT_RELATIVE_THRESHOLD_FACTOR
 * @property {number} CPT_CADENCE_TOLERANCE_PERCENT
 * @property {number} CPT_MIN_CYCLE_CONFIRMATION
 */
AudioApp.CPT_CONSTANTS = {
    CPT_FREQ_DIAL_TONE: GoertzelModule.CPT_FREQ_DIAL_TONE,
    CPT_FREQ_BUSY_SIGNAL: GoertzelModule.CPT_FREQ_BUSY_SIGNAL,
    CPT_FREQ_REORDER_TONE: GoertzelModule.CPT_FREQ_REORDER_TONE,
    CPT_FREQ_RINGBACK_TONE: GoertzelModule.CPT_FREQ_RINGBACK_TONE,
    CPT_FREQ_OFF_HOOK_WARNING: GoertzelModule.CPT_FREQ_OFF_HOOK_WARNING,
    CPT_FREQ_CALL_WAITING_TONE: GoertzelModule.CPT_FREQ_CALL_WAITING_TONE,
    CPT_CADENCE_BUSY_SIGNAL: GoertzelModule.CPT_CADENCE_BUSY_SIGNAL,
    CPT_CADENCE_REORDER_TONE: GoertzelModule.CPT_CADENCE_REORDER_TONE,
    CPT_CADENCE_RINGBACK_TONE: GoertzelModule.CPT_CADENCE_RINGBACK_TONE,
    CPT_CADENCE_CALL_WAITING_TONE: GoertzelModule.CPT_CADENCE_CALL_WAITING_TONE,

    CPT_DEFAULT_SAMPLE_RATE: GoertzelModule.CPT_DEFAULT_SAMPLE_RATE,
    CPT_DEFAULT_BLOCK_SIZE: GoertzelModule.CPT_DEFAULT_BLOCK_SIZE,
    CPT_DEFAULT_ABSOLUTE_MAGNITUDE_THRESHOLD: GoertzelModule.CPT_DEFAULT_ABSOLUTE_MAGNITUDE_THRESHOLD,
    CPT_DEFAULT_RELATIVE_THRESHOLD_FACTOR: GoertzelModule.CPT_DEFAULT_RELATIVE_THRESHOLD_FACTOR,
    CPT_CADENCE_TOLERANCE_PERCENT: GoertzelModule.CPT_CADENCE_TOLERANCE_PERCENT,
    CPT_MIN_CYCLE_CONFIRMATION: GoertzelModule.CPT_MIN_CYCLE_CONFIRMATION
};

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