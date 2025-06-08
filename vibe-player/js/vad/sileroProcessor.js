// --- /vibe-player/js/vad/sileroProcessor.js --- // Updated Path
// Performs VAD analysis frame-by-frame using the SileroWrapper.
// Encapsulates the logic for iterating through audio data and calculating speech regions.

/** @namespace AudioApp */
var AudioApp = AudioApp || {};

/**
 * @namespace AudioApp.sileroProcessor
 * @description Processes audio data using the Silero VAD model via a wrapper.
 * Provides functions to analyze audio for speech regions and recalculate them with different thresholds.
 * @param {AudioApp.sileroWrapper} wrapper - The Silero VAD wrapper module.
 */
AudioApp.sileroProcessor = (function (wrapper) {
    'use strict';

    /**
     * @private
     * @type {AudioApp.Constants} Reference to the Constants module.
     */
    // const Constants = AudioApp.Constants; // Constants is now a global class
    /**
     * @private
     * @type {AudioApp.Utils} Reference to the Utils module.
     */
    const Utils = AudioApp.Utils;

    if (!wrapper || typeof wrapper.isAvailable !== 'function' || !wrapper.isAvailable()) {
        console.error("SileroProcessor: CRITICAL - AudioApp.sileroWrapper is not available or not functional!");
        /** @type {SileroProcessorPublicInterface} */
        const nonFunctionalInterface = {
            analyzeAudio: () => Promise.reject(new Error("Silero VAD Wrapper not available")),
            recalculateSpeechRegions: () => {
                console.error("SileroProcessor: Cannot recalculate, VAD wrapper not available.");
                return [];
            }
        };
        return nonFunctionalInterface;
    }
    if (typeof Constants === 'undefined') {
        console.error("SileroProcessor: CRITICAL - Constants class not available!");
        /** @type {SileroProcessorPublicInterface} */
        const errorInterface = {
            analyzeAudio: () => Promise.reject(new Error("Constants class not available")),
            recalculateSpeechRegions: () => []
        };
        return errorInterface;
    }
    if (!Utils) {
        console.error("SileroProcessor: CRITICAL - AudioApp.Utils not available!");
        /** @type {SileroProcessorPublicInterface} */
        const errorInterface = {
            analyzeAudio: () => Promise.reject(new Error("Utils not available")),
            recalculateSpeechRegions: () => []
        };
        return errorInterface;
    }

    /**
     * @typedef {object} VadRegion
     * @property {number} start - Start time of the speech region in seconds.
     * @property {number} end - End time of the speech region in seconds.
     */

    /**
     * @typedef {object} VadAnalysisOptions
     * @property {number} [frameSamples=AudioApp.Constants.DEFAULT_VAD_FRAME_SAMPLES] - Number of samples per VAD frame.
     * @property {number} [positiveSpeechThreshold=0.5] - Probability threshold to start or continue a speech segment.
     * @property {number} [negativeSpeechThreshold] - Probability threshold to consider stopping speech. Defaults to `positiveSpeechThreshold - 0.15`.
     * @property {number} [redemptionFrames=7] - Number of consecutive frames below `negativeSpeechThreshold` needed to end a speech segment.
     * @property {string} [modelPath] - Path to the ONNX VAD model (typically handled by the wrapper).
     * @property {function({processedFrames: number, totalFrames: number}): void} [onProgress] - Optional callback for progress updates.
     */

    /**
     * @typedef {object} VadResult
     * @property {VadRegion[]} regions - Array of detected speech regions.
     * @property {Float32Array} probabilities - Raw probability for each processed frame.
     * @property {number} frameSamples - Frame size (in samples) used in the analysis.
     * @property {number} sampleRate - Sample rate of the audio data used (should be `AudioApp.Constants.VAD_SAMPLE_RATE`).
     * @property {number} initialPositiveThreshold - The positive speech threshold used for this result.
     * @property {number} initialNegativeThreshold - The negative speech threshold used for this result.
     * @property {number} redemptionFrames - The number of redemption frames used for this result.
     */

    /**
     * Analyzes 16kHz mono PCM audio data for speech regions using the Silero VAD model.
     * @public
     * @async
     * @param {Float32Array} pcmData - The 16kHz mono Float32Array audio data.
     * @param {VadAnalysisOptions} [options={}] - VAD parameters and callback.
     * @returns {Promise<VadResult>} A promise resolving to the VAD results.
     * @throws {Error} If analysis fails (e.g., wrapper error, invalid input data).
     */
    async function analyzeAudio(pcmData, options = {}) {
        if (!(pcmData instanceof Float32Array)) {
            console.warn("SileroProcessor: VAD input data is not Float32Array. Attempting conversion.");
            try {
                pcmData = new Float32Array(pcmData);
            } catch (e) {
                const err = /** @type {Error} */ (e);
                console.error("SileroProcessor: Failed to convert VAD input data to Float32Array.", err);
                throw new Error(`VAD input data must be a Float32Array or convertible: ${err.message}`);
            }
        }

        const frameSamples = options.frameSamples || Constants.VAD.DEFAULT_FRAME_SAMPLES;
        const positiveThreshold = options.positiveSpeechThreshold !== undefined ? options.positiveSpeechThreshold : 0.5;
        const negativeThreshold = options.negativeSpeechThreshold !== undefined ? options.negativeSpeechThreshold : Math.max(0.01, positiveThreshold - 0.15);
        const redemptionFrames = options.redemptionFrames !== undefined ? options.redemptionFrames : 7;
        const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {
        };

        if (!pcmData || pcmData.length === 0 || frameSamples <= 0) {
            console.log("SileroProcessor: No audio data or invalid frame size for VAD analysis.");
            // Ensure onProgress is called even for empty data, to complete any UI state
            setTimeout(() => onProgress({processedFrames: 0, totalFrames: 0}), 0);
            /** @type {VadResult} */
            const emptyResult = {
                regions: [], probabilities: new Float32Array(),
                frameSamples: frameSamples, sampleRate: Constants.VAD.SAMPLE_RATE,
                initialPositiveThreshold: positiveThreshold, initialNegativeThreshold: negativeThreshold,
                redemptionFrames: redemptionFrames
            };
            return emptyResult;
        }

        try {
            wrapper.reset_state();
        } catch (e) {
            const err = /** @type {Error} */ (e);
            console.error("SileroProcessor: Error resetting VAD state via wrapper:", err);
            throw new Error(`Failed to reset Silero VAD state: ${err.message}`);
        }

        /** @type {number[]} */ const allProbabilities = [];
        const totalFrames = Math.floor(pcmData.length / frameSamples);
        let processedFrames = 0;
        const startTime = performance.now();

        try {
            for (let i = 0; (i + frameSamples) <= pcmData.length; i += frameSamples) {
                const frame = pcmData.slice(i, i + frameSamples);
                const probability = await wrapper.process(frame);
                allProbabilities.push(probability);
                processedFrames++;

                if (processedFrames === 1 || processedFrames === totalFrames || (processedFrames % Constants.VAD.PROGRESS_REPORT_INTERVAL === 0)) {
                    onProgress({processedFrames, totalFrames});
                }
                if (processedFrames % Constants.VAD.YIELD_INTERVAL === 0 && processedFrames < totalFrames) {
                    await Utils.yieldToMainThread();
                }
            }
        } catch (e) {
            const err = /** @type {Error} */ (e);
            console.error(`SileroProcessor: Error during VAD frame processing after ${((performance.now() - startTime) / 1000).toFixed(2)}s:`, err);
            setTimeout(() => onProgress({processedFrames, totalFrames}), 0); // Final progress update on error
            throw new Error(`VAD inference failed: ${err.message}`);
        }
        console.log(`SileroProcessor: VAD analysis of ${totalFrames} frames took ${((performance.now() - startTime) / 1000).toFixed(2)}s.`);
        setTimeout(() => onProgress({processedFrames, totalFrames}), 0); // Ensure final progress is reported

        const probabilities = new Float32Array(allProbabilities);
        const initialRegions = recalculateSpeechRegions(probabilities, {
            frameSamples, sampleRate: Constants.VAD.SAMPLE_RATE,
            positiveSpeechThreshold: positiveThreshold, negativeSpeechThreshold: negativeThreshold,
            redemptionFrames
        });
        console.log(`SileroProcessor: Initially detected ${initialRegions.length} speech regions.`);

        /** @type {VadResult} */
        const result = {
            regions: initialRegions, probabilities, frameSamples,
            sampleRate: Constants.VAD.SAMPLE_RATE,
            initialPositiveThreshold: positiveThreshold, initialNegativeThreshold: negativeThreshold,
            redemptionFrames
        };
        return result;
    }

    /**
     * @typedef {object} RecalculateOptions
     * @property {number} frameSamples - Samples per frame used during original analysis.
     * @property {number} sampleRate - Sample rate used (should be `AudioApp.Constants.VAD_SAMPLE_RATE`).
     * @property {number} positiveSpeechThreshold - Current positive threshold (e.g., from UI slider).
     * @property {number} negativeSpeechThreshold - Current negative threshold.
     * @property {number} redemptionFrames - Redemption frames value used.
     */

    /**
     * Recalculates speech regions from stored probabilities using potentially new thresholds.
     * Does not re-run the VAD model; operates only on the probability array.
     * @public
     * @param {Float32Array} probabilities - Probabilities for each frame from `analyzeAudio`.
     * @param {RecalculateOptions} options - Parameters for recalculation.
     * @returns {VadRegion[]} Newly calculated speech regions.
     */
    function recalculateSpeechRegions(probabilities, options) {
        const {frameSamples, sampleRate, positiveSpeechThreshold, negativeSpeechThreshold, redemptionFrames} = options;

        if (sampleRate !== Constants.VAD.SAMPLE_RATE) {
            console.warn(`SileroProcessor: Recalculating speech regions with sample rate ${sampleRate}, which differs from the expected VAD constant ${Constants.VAD.SAMPLE_RATE}. This may lead to incorrect timing if frameSamples is based on the original rate.`);
        }
        if (!probabilities || probabilities.length === 0 || !frameSamples || !sampleRate ||
            positiveSpeechThreshold === undefined || negativeSpeechThreshold === undefined || redemptionFrames === undefined) {
            console.warn("SileroProcessor: Invalid arguments for recalculateSpeechRegions. Returning empty array.", options);
            return [];
        }

        /** @type {VadRegion[]} */ const newRegions = [];
        let inSpeech = false;
        let regionStart = 0.0;
        let redemptionCounter = 0;

        for (let i = 0; i < probabilities.length; i++) {
            const probability = probabilities[i];
            const frameStartTime = (i * frameSamples) / sampleRate;

            if (probability >= positiveSpeechThreshold) {
                if (!inSpeech) {
                    inSpeech = true;
                    regionStart = frameStartTime;
                }
                redemptionCounter = 0; // Reset redemption if speech detected
            } else if (inSpeech) { // Only apply redemption logic if we were in speech
                if (probability < negativeSpeechThreshold) {
                    redemptionCounter++;
                    if (redemptionCounter >= redemptionFrames) {
                        // End of speech segment detected
                        const triggerFrameIndex = i - redemptionFrames + 1; // Frame that triggered end
                        const actualEnd = (triggerFrameIndex * frameSamples) / sampleRate;
                        const finalEnd = Math.max(regionStart, actualEnd); // Ensure end is not before start
                        newRegions.push({start: regionStart, end: finalEnd});
                        inSpeech = false;
                        redemptionCounter = 0;
                    }
                } else { // Probability is between negative and positive thresholds
                    redemptionCounter = 0; // Reset redemption if not strictly below negative threshold
                }
            }
        }
        if (inSpeech) { // If speech segment was active at the end of probabilities
            const finalEnd = (probabilities.length * frameSamples) / sampleRate;
            newRegions.push({start: regionStart, end: finalEnd});
        }
        return newRegions;
    }

    /**
     * @typedef {Object} SileroProcessorPublicInterface
     * @property {function(Float32Array, VadAnalysisOptions=): Promise<VadResult>} analyzeAudio
     * @property {function(Float32Array, RecalculateOptions): VadRegion[]} recalculateSpeechRegions
     */

    /** @type {SileroProcessorPublicInterface} */
    return {
        analyzeAudio: analyzeAudio,
        recalculateSpeechRegions: recalculateSpeechRegions
    };

})(AudioApp.sileroWrapper);
// --- /vibe-player/js/vad/sileroProcessor.js --- // Updated Path
