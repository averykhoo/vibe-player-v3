// --- /vibe-player/js/vad/sileroProcessor.js --- // Updated Path
// Performs VAD analysis frame-by-frame using the SileroWrapper.
// Encapsulates the logic for iterating through audio data and calculating speech regions.

var AudioApp = AudioApp || {}; // Ensure namespace exists

// Design Decision: Use IIFE, pass the Silero wrapper module as a dependency.
AudioApp.sileroProcessor = (function(wrapper) {
    'use strict';

    // === Module Dependencies ===
    // Assuming AudioApp.Constants and AudioApp.Utils are loaded before this file.
    const Constants = AudioApp.Constants;
    const Utils = AudioApp.Utils;

    // Check if the required wrapper module is available
    if (!wrapper || !wrapper.isAvailable) {
        console.error("SileroProcessor: CRITICAL - AudioApp.sileroWrapper is not available!");
        return { // Return a non-functional public interface
             analyzeAudio: () => Promise.reject(new Error("Silero VAD Wrapper not available")),
             recalculateSpeechRegions: () => []
        };
    }
    // Check if required dependencies are loaded
    if (!Constants) {
         console.error("SileroProcessor: CRITICAL - AudioApp.Constants not available!");
         return { analyzeAudio: () => Promise.reject(new Error("Constants not available")), recalculateSpeechRegions: () => [] };
    }
     if (!Utils) {
          console.error("SileroProcessor: CRITICAL - AudioApp.Utils not available!");
          return { analyzeAudio: () => Promise.reject(new Error("Utils not available")), recalculateSpeechRegions: () => [] };
     }

    // --- Constants REMOVED - Use AudioApp.Constants ---
    // const VAD_SAMPLE_RATE = 16000; // Use Constants.VAD_SAMPLE_RATE
    // const PROGRESS_REPORT_INTERVAL_FRAMES = 20; // Use Constants.VAD_PROGRESS_REPORT_INTERVAL
    // const YIELD_INTERVAL_FRAMES = 5; // Use Constants.VAD_YIELD_INTERVAL

    // --- Helper Function REMOVED - Use AudioApp.Utils ---
    // async function yieldToMainThread() { ... } // Use Utils.yieldToMainThread

    // --- Core Analysis Function ---

    /**
     * Analyzes 16kHz mono PCM data for speech regions using the Silero VAD model via the wrapper.
     * Returns initial speech regions and the raw probabilities for each frame.
     * Calls an optional onProgress callback during processing and yields periodically.
     * @param {Float32Array} pcmData - The 16kHz mono Float32Array audio data.
     * @param {object} [options={}] - VAD parameters and callback.
     * @param {number} [options.frameSamples=Constants.DEFAULT_VAD_FRAME_SAMPLES] - Samples per VAD frame.
     * @param {number} [options.positiveSpeechThreshold=0.5] - Probability threshold to start or continue speech.
     * @param {number} [options.negativeSpeechThreshold] - Probability threshold to consider stopping speech (defaults to positive - 0.15).
     * @param {number} [options.redemptionFrames=7] - Consecutive frames below negative threshold needed to end a speech segment.
     * @param {string} [options.modelPath='./model/silero_vad.onnx'] - Path to model (passed to wrapper if needed).
     * @param {function({processedFrames: number, totalFrames: number}): void} [options.onProgress] - Optional callback for progress updates.
     * @returns {Promise<VadResult>} A promise resolving to the VAD results object.
     * @typedef {object} VadResult
     * @property {Array<{start: number, end: number}>} regions - Initial calculated speech regions.
     * @property {Float32Array} probabilities - Raw probability for each processed frame.
     * @property {number} frameSamples - Frame size used in analysis.
     * @property {number} sampleRate - Sample rate used (should be Constants.VAD_SAMPLE_RATE).
     * @property {number} initialPositiveThreshold - Positive threshold used for initial calculation.
     * @property {number} initialNegativeThreshold - Negative threshold used for initial calculation.
     * @property {number} redemptionFrames - Redemption frames value used.
     * @throws {Error} If analysis fails (e.g., wrapper error, invalid input).
     * @public
     */
    async function analyzeAudio(pcmData, options = {}) {
        // --- Validate Input ---
        if (!(pcmData instanceof Float32Array)) {
            console.warn("SileroProcessor: VAD input data is not Float32Array. Attempting conversion.");
            try { pcmData = new Float32Array(pcmData); }
            catch (e) { console.error("SileroProcessor: Failed to convert VAD input data to Float32Array.", e); throw new Error("VAD input data must be a Float32Array or convertible."); }
        }

        // --- VAD Parameters ---
        const frameSamples = options.frameSamples || Constants.DEFAULT_VAD_FRAME_SAMPLES; // Use Constant default
        const positiveThreshold = options.positiveSpeechThreshold !== undefined ? options.positiveSpeechThreshold : 0.5;
        const negativeThreshold = options.negativeSpeechThreshold !== undefined ? options.negativeSpeechThreshold : Math.max(0.01, positiveThreshold - 0.15);
        const redemptionFrames = options.redemptionFrames !== undefined ? options.redemptionFrames : 7;
        const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

         if (!pcmData || pcmData.length === 0 || frameSamples <= 0) {
             console.log("SileroProcessor: No audio data or invalid frame size provided to analyze.");
             setTimeout(() => onProgress({ processedFrames: 0, totalFrames: 0 }), 0);
             return {
                 regions: [], probabilities: new Float32Array(),
                 frameSamples: frameSamples, sampleRate: Constants.VAD_SAMPLE_RATE, // Use Constant
                 initialPositiveThreshold: positiveThreshold,
                 initialNegativeThreshold: negativeThreshold,
                 redemptionFrames: redemptionFrames
             };
         }

        // --- Ensure Silero Model is Ready & Reset State ---
        try { wrapper.reset_state(); }
        catch (e) { console.error("SileroProcessor: Error resetting VAD state via wrapper:", e); throw new Error(`Failed to reset Silero VAD state: ${e.message}`); }

        // --- Process Audio Frames ---
        const allProbabilities = [];
        const totalFrames = Math.floor(pcmData.length / frameSamples);
        let processedFrames = 0;

        console.log(`SileroProcessor: Analyzing ${pcmData.length} samples (${totalFrames} frames) with frame size ${frameSamples}...`);
        const startTime = performance.now();

        try {
            for (let i = 0; (i + frameSamples) <= pcmData.length; i += frameSamples) {
                const frame = pcmData.slice(i, i + frameSamples);
                const probability = await wrapper.process(frame); // Inference
                allProbabilities.push(probability);
                processedFrames++;

                // --- Report Progress Periodically ---
                if (processedFrames === 1 || processedFrames === totalFrames || (processedFrames % Constants.VAD_PROGRESS_REPORT_INTERVAL === 0)) { // Use Constant
                     onProgress({ processedFrames, totalFrames });
                }

                // --- Force Yield Periodically ---
                if (processedFrames % Constants.VAD_YIELD_INTERVAL === 0 && processedFrames < totalFrames) { // Use Constant
                     await Utils.yieldToMainThread(); // Use Utils
                }
            }
        } catch (e) {
            const endTime = performance.now();
            console.error(`SileroProcessor: Error during frame processing after ${((endTime - startTime)/1000).toFixed(2)}s:`, e);
            const progressData = { processedFrames, totalFrames };
             setTimeout(() => onProgress(progressData), 0);
            throw new Error(`VAD inference failed: ${e.message}`);
        }

        const endTime = performance.now();
        console.log(`SileroProcessor: VAD analysis took ${((endTime - startTime)/1000).toFixed(2)}s.`);

        const finalProgressData = { processedFrames, totalFrames };
         setTimeout(() => onProgress(finalProgressData), 0);
        if (processedFrames !== totalFrames) { console.warn(`[SileroProcessor] Loop finished but processedFrames (${processedFrames}) != totalFrames (${totalFrames}).`); }

        // --- Calculate Initial Regions ---
        const probabilities = new Float32Array(allProbabilities);
        const initialRegions = recalculateSpeechRegions(probabilities, {
            frameSamples: frameSamples,
            sampleRate: Constants.VAD_SAMPLE_RATE, // Use Constant
            positiveSpeechThreshold: positiveThreshold,
            negativeSpeechThreshold: negativeThreshold,
            redemptionFrames: redemptionFrames
        });

        console.log(`SileroProcessor: Initially detected ${initialRegions.length} speech regions.`);

        // --- Return Comprehensive Results ---
        return {
            regions: initialRegions,
            probabilities: probabilities,
            frameSamples: frameSamples,
            sampleRate: Constants.VAD_SAMPLE_RATE, // Use Constant
            initialPositiveThreshold: positiveThreshold,
            initialNegativeThreshold: negativeThreshold,
            redemptionFrames: redemptionFrames
        };
    }


    // --- Region Recalculation Function ---

    /**
     * Recalculates speech regions based on stored probabilities and potentially new thresholds.
     * This function is FAST as it only iterates through probabilities, not the audio or model.
     * @param {Float32Array} probabilities - The stored probabilities for each frame from `analyzeAudio`.
     * @param {object} options - Contains current threshold and VAD parameters.
     * @param {number} options.frameSamples - Samples per frame used during original analysis.
     * @param {number} options.sampleRate - Sample rate used (should be Constants.VAD_SAMPLE_RATE).
     * @param {number} options.positiveSpeechThreshold - Current positive threshold (e.g., from slider).
     * @param {number} options.negativeSpeechThreshold - Current negative threshold.
     * @param {number} options.redemptionFrames - Redemption frames value used.
     * @returns {Array<{start: number, end: number}>} - Newly calculated speech regions.
     * @public
     */
    function recalculateSpeechRegions(probabilities, options) {
        const { frameSamples, sampleRate, positiveSpeechThreshold, negativeSpeechThreshold, redemptionFrames } = options;

        // Validate sampleRate consistency
         if (sampleRate !== Constants.VAD_SAMPLE_RATE) {
            console.warn(`SileroProcessor: Recalculating with sample rate ${sampleRate} which differs from expected constant ${Constants.VAD_SAMPLE_RATE}`);
        }

        if (!probabilities || probabilities.length === 0 || !frameSamples || !sampleRate || positiveSpeechThreshold === undefined || negativeSpeechThreshold === undefined || redemptionFrames === undefined) {
             console.warn("SileroProcessor: Invalid arguments for recalculateSpeechRegions.", {probabilities: !!probabilities, frameSamples, sampleRate, positiveSpeechThreshold, negativeSpeechThreshold, redemptionFrames});
            return [];
        }

        const newRegions = [];
        let inSpeech = false; let regionStart = 0.0; let redemptionCounter = 0;

        for (let i = 0; i < probabilities.length; i++) {
            const probability = probabilities[i];
            const frameStartTime = (i * frameSamples) / sampleRate;

            if (probability >= positiveSpeechThreshold) {
                if (!inSpeech) { inSpeech = true; regionStart = frameStartTime; }
                redemptionCounter = 0;
            } else if (inSpeech) {
                if (probability < negativeSpeechThreshold) {
                    redemptionCounter++;
                    if (redemptionCounter >= redemptionFrames) {
                        const triggerFrameIndex = i - redemptionFrames + 1;
                        const actualEnd = (triggerFrameIndex * frameSamples) / sampleRate;
                        const finalEnd = Math.max(regionStart, actualEnd);
                        newRegions.push({ start: regionStart, end: finalEnd });
                        inSpeech = false; redemptionCounter = 0;
                    }
                } else { redemptionCounter = 0; } // Reset if between thresholds
            }
        }
        // Finalize if speech continued to the end
        if (inSpeech) {
            const finalEnd = (probabilities.length * frameSamples) / sampleRate;
            newRegions.push({ start: regionStart, end: finalEnd });
        }
        return newRegions;
    }

    // --- Public Interface ---
    return {
        analyzeAudio: analyzeAudio,
        recalculateSpeechRegions: recalculateSpeechRegions
    };

})(AudioApp.sileroWrapper); // Pass the Silero wrapper module as a dependency
// --- /vibe-player/js/vad/sileroProcessor.js --- // Updated Path
