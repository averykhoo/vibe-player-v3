// --- /vibe-player/js/vad/vadAnalyzer.js --- // Updated Path
// Manages VAD state (analysis results, current thresholds) and uses SileroProcessor
// to perform analysis and recalculations. Acts as a bridge between app controller and processor.

/** @namespace AudioApp */
var AudioApp = AudioApp || {};

/**
 * @namespace AudioApp.vadAnalyzer
 * @description Manages Voice Activity Detection (VAD) state, including analysis results
 * and current thresholds. It uses the `AudioApp.sileroProcessor` for performing the
 * actual VAD analysis and recalculating speech regions based on new parameters.
 * @param {AudioApp.sileroProcessor} processor - The Silero VAD processor module.
 */
AudioApp.vadAnalyzer = (function(processor) {
    'use strict';

    /**
     * @private
     * @type {AudioApp.Constants} Reference to the Constants module.
     */
    const Constants = AudioApp.Constants;

    if (!processor) {
        console.error("VadAnalyzer: CRITICAL - AudioApp.sileroProcessor dependency is not available!");
        /** @type {VadAnalyzerPublicInterface} */
        const nonFunctionalInterface = {
            analyze: () => Promise.reject(new Error("VAD Processor not available")),
            recalculate: () => { console.error("VadAnalyzer: Cannot recalculate, VAD Processor not available."); return []; },
            getCurrentRegions: () => [],
            handleThresholdUpdate: () => { console.error("VadAnalyzer: Cannot handle threshold update, VAD Processor not available."); return []; },
            getFrameSamples: () => Constants?.DEFAULT_VAD_FRAME_SAMPLES || 1536 // Fallback if Constants is also missing
        };
        return nonFunctionalInterface;
    }
     if (!Constants) {
          console.error("VadAnalyzer: CRITICAL - AudioApp.Constants module not available!");
          /** @type {VadAnalyzerPublicInterface} */
          const errorInterface = {
               analyze: () => Promise.reject(new Error("AudioApp.Constants not available for VadAnalyzer")),
               recalculate: () => [], getCurrentRegions: () => [], handleThresholdUpdate: () => [],
               getFrameSamples: () => 1536 // Hardcoded fallback if Constants is missing
          };
          return errorInterface;
     }

    /**
     * @private
     * @type {AudioApp.sileroProcessor.VadResult|null} Stores the latest VAD results.
     * @see {@link AudioApp.sileroProcessor.VadResult} for type definition.
     */
    let currentVadResults = null;
    /**
     * @private
     * @type {number} Current positive speech threshold used for VAD.
     */
    let currentPositiveThreshold = 0.5; // Default
    /**
     * @private
     * @type {number} Current negative speech threshold used for VAD.
     */
    let currentNegativeThreshold = 0.35; // Default


    /**
     * @typedef {object} VadAnalyzerAnalysisOptions
     * @property {function({processedFrames: number, totalFrames: number}): void} [onProgress] - Optional callback for progress updates during analysis.
     * @property {number} [frameSamples] - Optional override for the number of samples per VAD frame.
     *                                      Defaults to `AudioApp.Constants.DEFAULT_VAD_FRAME_SAMPLES`.
     */

    /**
     * Runs the initial VAD analysis on the provided PCM data using the configured `sileroProcessor`.
     * Stores the analysis results internally, including probabilities and initial speech regions.
     * @public
     * @async
     * @param {Float32Array} pcm16k - The 16kHz mono PCM audio data as a Float32Array.
     * @param {VadAnalyzerAnalysisOptions} [options={}] - Configuration options for the analysis.
     * @returns {Promise<AudioApp.sileroProcessor.VadResult>} The full VAD results object from the processor.
     * @throws {Error} If the analysis in the underlying processor fails.
     */
    async function analyze(pcm16k, options = {}) {
        currentVadResults = null; // Reset previous results
        // Reset thresholds to defaults before new analysis, processor will use these for initial regions.
        currentPositiveThreshold = 0.5;
        currentNegativeThreshold = 0.35;

        /** @type {AudioApp.sileroProcessor.VadAnalysisOptions} */
        const processorOptions = {
             positiveSpeechThreshold: currentPositiveThreshold,
             negativeSpeechThreshold: currentNegativeThreshold,
             frameSamples: options.frameSamples || Constants.DEFAULT_VAD_FRAME_SAMPLES,
             onProgress: options.onProgress
        };

        console.log("VadAnalyzer: Starting VAD analysis via sileroProcessor...");
        try {
            const results = await processor.analyzeAudio(pcm16k, processorOptions);
            currentVadResults = results;
            // Update internal thresholds to match those used for the initial analysis by the processor
            currentPositiveThreshold = results.initialPositiveThreshold;
            currentNegativeThreshold = results.initialNegativeThreshold;
            console.log("VadAnalyzer: VAD analysis successful.");
            return currentVadResults;
        } catch (error) {
            const err = /** @type {Error} */ (error);
            console.error("VadAnalyzer: VAD analysis failed -", err.message, err.stack);
            currentVadResults = null; // Clear results on failure
            throw err; // Re-throw for the caller (e.g., app.js) to handle
        }
    }

     /**
     * Handles updates to VAD thresholds (e.g., from UI sliders via app.js).
     * Updates the internal threshold state and triggers a recalculation of speech regions.
     * @public
     * @param {'positive' | 'negative'} type - The type of threshold being updated.
     * @param {number} value - The new threshold value.
     * @returns {AudioApp.sileroProcessor.VadRegion[]} The newly recalculated speech regions.
     * Returns an empty array if VAD analysis has not been performed yet.
     * @see {@link AudioApp.sileroProcessor.VadRegion} for region object structure.
     */
     function handleThresholdUpdate(type, value) {
        if (!currentVadResults) {
            console.warn("VadAnalyzer: Cannot handle threshold update - no VAD results available. Call analyze() first.");
            return [];
        }
        if (type === 'positive') {
            currentPositiveThreshold = value;
        } else if (type === 'negative') {
            currentNegativeThreshold = value;
        } else {
            console.warn(`VadAnalyzer: Unknown threshold type '${type}'. No update performed.`);
            return currentVadResults.regions || []; // Return existing regions if type is unknown
        }
        return recalculate(); // Recalculate with the new threshold
    }


    /**
     * Recalculates speech regions using the stored probabilities from the last analysis
     * and the current internal positive and negative threshold values.
     * This method delegates the actual calculation logic to the `sileroProcessor`.
     * The `regions` array within the stored `currentVadResults` is updated with the new regions.
     * @public
     * @returns {AudioApp.sileroProcessor.VadRegion[]} The recalculated speech regions.
     * Returns an empty array if VAD analysis results (especially probabilities) are not available.
     * @see {@link AudioApp.sileroProcessor.VadRegion} for region object structure.
     */
    function recalculate() {
        if (!currentVadResults || !currentVadResults.probabilities) {
            console.warn("VadAnalyzer: Cannot recalculate speech regions - VAD results or probabilities are missing. Call analyze() first.");
            return [];
        }

        /** @type {AudioApp.sileroProcessor.RecalculateOptions} */
        const optionsForRecalc = {
            frameSamples: currentVadResults.frameSamples,
            sampleRate: currentVadResults.sampleRate,
            positiveSpeechThreshold: currentPositiveThreshold,
            negativeSpeechThreshold: currentNegativeThreshold,
            redemptionFrames: currentVadResults.redemptionFrames
        };

        const newRegions = processor.recalculateSpeechRegions(currentVadResults.probabilities, optionsForRecalc);
        currentVadResults.regions = newRegions; // Update the stored regions
        return newRegions;
    }

    /**
     * Retrieves the currently calculated speech regions.
     * These regions are based on the latest analysis or recalculation.
     * @public
     * @returns {AudioApp.sileroProcessor.VadRegion[]} An array of speech region objects.
     * Returns an empty array if no VAD analysis has been performed or if no regions were detected.
     * @see {@link AudioApp.sileroProcessor.VadRegion} for region object structure.
     */
    function getCurrentRegions() {
        return currentVadResults?.regions || [];
    }

    /**
     * Gets the number of samples per frame used in the last successful VAD analysis.
     * This is useful for UI elements like progress bars that need to relate frame counts to time.
     * @public
     * @returns {number} The frame size in samples. Defaults to `AudioApp.Constants.DEFAULT_VAD_FRAME_SAMPLES` if no analysis has been run.
     */
    function getFrameSamples() {
        return currentVadResults?.frameSamples || Constants.DEFAULT_VAD_FRAME_SAMPLES;
    }

    /**
     * @typedef {Object} VadAnalyzerPublicInterface
     * @property {function(Float32Array, VadAnalyzerAnalysisOptions=): Promise<AudioApp.sileroProcessor.VadResult>} analyze
     * @property {function(): AudioApp.sileroProcessor.VadRegion[]} recalculate
     * @property {function('positive'|'negative', number): AudioApp.sileroProcessor.VadRegion[]} handleThresholdUpdate
     * @property {function(): AudioApp.sileroProcessor.VadRegion[]} getCurrentRegions
     * @property {function(): number} getFrameSamples
     */

    /** @type {VadAnalyzerPublicInterface} */
    return {
        analyze: analyze,
        recalculate: recalculate,
        handleThresholdUpdate: handleThresholdUpdate,
        getCurrentRegions: getCurrentRegions,
        getFrameSamples: getFrameSamples
    };

})(AudioApp.sileroProcessor);
// --- /vibe-player/js/vad/vadAnalyzer.js --- // Updated Path
