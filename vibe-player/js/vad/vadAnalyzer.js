// --- /vibe-player/js/vad/vadAnalyzer.js --- // Updated Path
// Manages VAD state (analysis results, current thresholds) and uses SileroProcessor
// to perform analysis and recalculations. Acts as a bridge between app controller and processor.

var AudioApp = AudioApp || {}; // Ensure namespace exists

// Design Decision: Use IIFE, pass the Silero processor module as a dependency.
AudioApp.vadAnalyzer = (function(processor) {
    'use strict';

    // === Module Dependencies ===
    // Assuming AudioApp.Constants is loaded before this file.
    const Constants = AudioApp.Constants;

    // Check if the required processor module is available
     if (!processor) {
        console.error("VadAnalyzer: CRITICAL - AudioApp.sileroProcessor is not available!");
        return { // Return a non-functional public interface
            analyze: () => Promise.reject(new Error("VAD Processor not available")),
            recalculate: () => [], getCurrentRegions: () => [], handleThresholdUpdate: () => [], getFrameSamples: () => Constants?.DEFAULT_VAD_FRAME_SAMPLES || 1536
        };
    }
     // Check if Constants module is loaded
     if (!Constants) {
          console.error("VadAnalyzer: CRITICAL - AudioApp.Constants not available!");
          // Provide fallback for getFrameSamples if Constants missing
           return {
               analyze: () => Promise.reject(new Error("Constants not available")),
               recalculate: () => [], getCurrentRegions: () => [], handleThresholdUpdate: () => [], getFrameSamples: () => 1536 // Fallback value
          };
     }

    // --- Module State ---
    /** @type {VadResult|null} */
    let currentVadResults = null;
    /** @type {number} */
    let currentPositiveThreshold = 0.5; // Default
    /** @type {number} */
    let currentNegativeThreshold = 0.35; // Default

    // --- Default Frame Size Constant REMOVED - Use AudioApp.Constants ---
    // const DEFAULT_FRAME_SAMPLES = 1536; // Use Constants.DEFAULT_VAD_FRAME_SAMPLES

    // --- Public Methods ---

    /**
     * Runs the initial VAD analysis for a given PCM data array using the processor.
     * Stores the results internally and passes along an onProgress callback.
     * @param {Float32Array} pcm16k - The 16kHz mono audio data.
     * @param {object} [options={}] - Configuration options.
     * @param {function({processedFrames: number, totalFrames: number}): void} [options.onProgress] - Optional callback for progress updates.
     * @param {number} [options.frameSamples] - Optional override for frame size. Defaults to Constants.DEFAULT_VAD_FRAME_SAMPLES.
     * @returns {Promise<VadResult>} The full VAD results object from the processor.
     * @throws {Error} If the analysis in the processor fails.
     * @public
     */
    async function analyze(pcm16k, options = {}) {
        currentVadResults = null;
        currentPositiveThreshold = 0.5;
        currentNegativeThreshold = 0.35;

        const onProgressCallback = options.onProgress;
        const frameSamplesOverride = options.frameSamples;

        const processorOptions = {
             positiveSpeechThreshold: currentPositiveThreshold,
             negativeSpeechThreshold: currentNegativeThreshold,
             frameSamples: frameSamplesOverride || Constants.DEFAULT_VAD_FRAME_SAMPLES, // Use Constant default
             onProgress: onProgressCallback
        };

        console.log("VadAnalyzer: Starting analysis via processor...");
        try {
            const results = await processor.analyzeAudio(pcm16k, processorOptions); // Delegate to processor
            currentVadResults = results;
            currentPositiveThreshold = results.initialPositiveThreshold;
            currentNegativeThreshold = results.initialNegativeThreshold;
            console.log("VadAnalyzer: Analysis successful.");
            return currentVadResults;
        } catch (error) {
            console.error("VadAnalyzer: Analysis failed -", error);
            currentVadResults = null;
            throw error;
        }
    }

     /**
     * Handles updates from UI sliders (via app.js), updates internal threshold state,
     * and triggers a recalculation of speech regions.
     * @param {string} type - The type of threshold changed ('positive' or 'negative').
     * @param {number} value - The new threshold value from the slider.
     * @returns {Array<{start: number, end: number}>} The newly recalculated speech regions. Returns empty array if analysis hasn't run.
     * @public
     */
     function handleThresholdUpdate(type, value) {
        if (!currentVadResults) {
            console.warn("VadAnalyzer: Cannot handle threshold update - no VAD results available.");
            return [];
        }
        if (type === 'positive') { currentPositiveThreshold = value; }
        else if (type === 'negative') { currentNegativeThreshold = value; }
        else { console.warn(`VadAnalyzer: Unknown threshold type '${type}'`); return currentVadResults.regions || []; }
        // Trigger recalculation using the updated internal thresholds
        return recalculate();
    }


    /**
     * Recalculates speech regions using stored probabilities and the *current* internal thresholds.
     * Delegates the calculation logic to the sileroProcessor.
     * Updates the `regions` array within the stored `currentVadResults`.
     * @returns {Array<{start: number, end: number}>} The recalculated speech regions. Returns empty array if analysis hasn't run.
     * @public
     */
    function recalculate() {
        if (!currentVadResults || !currentVadResults.probabilities) {
            console.warn("VadAnalyzer: Cannot recalculate - VAD results or probabilities missing.");
            return [];
        }
        // Prepare options using current state for the processor's recalculate function
        const optionsForRecalc = {
            frameSamples: currentVadResults.frameSamples,
            sampleRate: currentVadResults.sampleRate, // Use sample rate from results (should be VAD_SAMPLE_RATE)
            positiveSpeechThreshold: currentPositiveThreshold, // Use current state
            negativeSpeechThreshold: currentNegativeThreshold, // Use current state
            redemptionFrames: currentVadResults.redemptionFrames
        };
        // Delegate the actual calculation
        const newRegions = processor.recalculateSpeechRegions(currentVadResults.probabilities, optionsForRecalc);
        // Update the stored regions within the main results object
        currentVadResults.regions = newRegions;
        return newRegions;
    }

    /**
     * Gets the currently active speech regions based on the latest analysis or recalculation.
     * @returns {Array<{start: number, end: number}>} An array of speech region objects, or an empty array if no analysis is done.
     * @public
     */
    function getCurrentRegions() {
        return currentVadResults ? (currentVadResults.regions || []) : [];
    }

    /**
     * Gets the frame size used in the last successful analysis.
     * Needed by app.js to calculate total frames for the progress bar.
     * Returns Constants.DEFAULT_VAD_FRAME_SAMPLES if no analysis done yet.
     * @returns {number} The frame size in samples.
     * @public
     */
    function getFrameSamples() {
        // Use frameSamples from results if available, otherwise use the Constant default
        return currentVadResults ? currentVadResults.frameSamples : Constants.DEFAULT_VAD_FRAME_SAMPLES;
    }

    // --- Public Interface ---
    return {
        analyze: analyze,
        recalculate: recalculate,
        handleThresholdUpdate: handleThresholdUpdate,
        getCurrentRegions: getCurrentRegions,
        getFrameSamples: getFrameSamples // Expose getter for frame size
    };

})(AudioApp.sileroProcessor); // Pass the processor module as a dependency
// --- /vibe-player/js/vad/vadAnalyzer.js --- // Updated Path
