// --- /vibe-player/js/vadAnalyzer.js ---
// Manages VAD state (analysis results, current thresholds) and uses SileroProcessor
// to perform analysis and recalculations. Acts as a bridge between app controller and processor.

var AudioApp = AudioApp || {}; // Ensure namespace exists

// Design Decision: Use IIFE, pass the Silero processor module as a dependency.
AudioApp.vadAnalyzer = (function(processor) {
    'use strict';

    // Check if the required processor module is available
     if (!processor) {
        console.error("VadAnalyzer: CRITICAL - AudioApp.sileroProcessor is not available!");
        // Return a non-functional public interface
        return {
            /** @returns {Promise<object>} */ analyze: () => Promise.reject(new Error("VAD Processor not available")),
            /** @returns {Array} */ recalculate: () => [],
            /** @returns {Array} */ getCurrentRegions: () => [],
            /** @returns {Array} */ handleThresholdUpdate: () => [] // Return empty array
        };
    }

    // --- Module State ---
    /**
     * Stores the complete results from the last successful VAD analysis.
     * @type {VadResult|null}
     * @see {AudioApp.sileroProcessor.analyzeAudio} typedef for VadResult structure.
     */
    let currentVadResults = null;

    /** @type {number} The currently active positive speech threshold. */
    let currentPositiveThreshold = 0.5; // Default
    /** @type {number} The currently active negative speech threshold. */
    let currentNegativeThreshold = 0.35; // Default

    // --- Public Methods ---

    /**
     * Runs the initial VAD analysis for a given PCM data array using the processor.
     * Stores the results internally.
     * @param {Float32Array} pcm16k - The 16kHz mono audio data.
     * @returns {Promise<VadResult>} The full VAD results object from the processor.
     * @throws {Error} If the analysis in the processor fails.
     * @public
     */
    async function analyze(pcm16k) {
        // Reset internal state before starting analysis for a new file
        currentVadResults = null;
        // Reset thresholds to defaults - they will be updated based on analysis results
        currentPositiveThreshold = 0.5;
        currentNegativeThreshold = 0.35;

        // Define initial options, could potentially be configured elsewhere in the future
        const initialOptions = {
             positiveSpeechThreshold: currentPositiveThreshold, // Pass current defaults
             negativeSpeechThreshold: currentNegativeThreshold
            // frameSamples: 1536, // Can be passed from app config if needed
            // redemptionFrames: 7 // Can be passed from app config if needed
        };

        console.log("VadAnalyzer: Starting analysis via processor...");
        try {
            // Delegate the core analysis to the sileroProcessor module
            const results = await processor.analyzeAudio(pcm16k, initialOptions);

            // Store the results and update current thresholds based on what was actually used
            currentVadResults = results;
            currentPositiveThreshold = results.initialPositiveThreshold;
            currentNegativeThreshold = results.initialNegativeThreshold;

            console.log("VadAnalyzer: Analysis successful.");
            return currentVadResults; // Return the comprehensive results object
        } catch (error) {
            console.error("VadAnalyzer: Analysis failed -", error);
            currentVadResults = null; // Ensure state is cleared on failure
            throw error; // Re-throw for the app controller to handle UI/state
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
            return []; // No analysis has been run yet
        }

        // Update the relevant internal threshold state
        if (type === 'positive') {
            currentPositiveThreshold = value;
            // Design Decision: Keep negative threshold independent unless explicitly linked.
            // If linking is desired, update `currentNegativeThreshold` here too.
            // e.g., currentNegativeThreshold = Math.max(0.01, Math.min(value - 0.15, 0.99));
        } else if (type === 'negative') {
            currentNegativeThreshold = value;
        } else {
             console.warn(`VadAnalyzer: Unknown threshold type '${type}'`);
             return currentVadResults.regions || []; // Return existing regions if type is invalid
        }

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
        const options = {
            frameSamples: currentVadResults.frameSamples,
            sampleRate: currentVadResults.sampleRate,
            positiveSpeechThreshold: currentPositiveThreshold, // Use current state
            negativeSpeechThreshold: currentNegativeThreshold, // Use current state
            redemptionFrames: currentVadResults.redemptionFrames
        };

        // Delegate the actual calculation
        const newRegions = processor.recalculateSpeechRegions(currentVadResults.probabilities, options);

        // Update the stored regions within the main results object
        // Design Decision: Keep the `currentVadResults.regions` updated so `getCurrentRegions` is always current.
        currentVadResults.regions = newRegions;

        return newRegions; // Return the newly calculated regions
    }

    /**
     * Gets the currently active speech regions based on the latest analysis or recalculation.
     * @returns {Array<{start: number, end: number}>} An array of speech region objects, or an empty array if no analysis is done.
     * @public
     */
    function getCurrentRegions() {
        // Provide easy access to the current regions for other modules (like Visualizer)
        return currentVadResults ? (currentVadResults.regions || []) : [];
    }

    // --- Public Interface ---
    // Expose methods needed by app.js to manage VAD processing and results.
    return {
        analyze: analyze,
        recalculate: recalculate, // Expose explicit recalculate if needed elsewhere
        handleThresholdUpdate: handleThresholdUpdate, // Main way thresholds trigger recalculation
        getCurrentRegions: getCurrentRegions
    };

})(AudioApp.sileroProcessor); // Pass the processor module as a dependency
