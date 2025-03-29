// --- /vibe-player/vad/vadAnalyzer.js ---
/**
 * @namespace AudioApp.vadAnalyzer
 * @description Manages VAD state (analysis results, current thresholds) and uses the
 * sileroProcessor module to perform the initial analysis and recalculate speech regions
 * when thresholds are updated via the UI. Acts as a stateful bridge between the main
 * application controller (main.js) and the stateless VAD processing logic (sileroProcessor.js).
 * Depends on AudioApp.sileroProcessor.
 */
var AudioApp = AudioApp || {}; // Ensure namespace exists

AudioApp.vadAnalyzer = (function(processor) { // Inject sileroProcessor dependency
    'use strict';

    // --- Dependency Check ---
     if (!processor) {
        console.error("VadAnalyzer: CRITICAL - AudioApp.sileroProcessor is not available! Ensure sileroProcessor.js is loaded before this script.");
        // Return a non-functional public interface
        return {
            analyze: () => Promise.reject(new Error("VAD Processor not available")),
            handleThresholdUpdate: () => [],
            getCurrentRegions: () => []
        };
    }

    // --- Module State ---
    /**
     * Stores the complete results from the last successful VAD analysis run.
     * This includes probabilities needed for recalculation.
     * @type {VadResult|null}
     * @see {AudioApp.sileroProcessor.analyzeAudio} typedef for VadResult structure.
     */
    let currentVadResults = null;

    /** @type {number} The currently active positive speech threshold being used for region calculation. */
    let currentPositiveThreshold = AudioApp.config?.DEFAULT_VAD_POSITIVE_THRESHOLD ?? 0.5; // Initialize with default
    /** @type {number} The currently active negative speech threshold being used for region calculation. */
    let currentNegativeThreshold = AudioApp.config?.DEFAULT_VAD_NEGATIVE_THRESHOLD ?? 0.35; // Initialize with default

    // --- Public Methods ---

    /**
     * Runs the initial VAD analysis for given PCM data using the sileroProcessor.
     * Stores the comprehensive results internally, including probabilities and initial regions/thresholds.
     * Called by main.js after audio is decoded and resampled.
     * @param {Float32Array} pcm16k - The 16kHz mono audio data (must be Float32Array).
     * @returns {Promise<VadResult>} The full VAD results object from the processor, which is also stored internally.
     * @throws {Error} If the analysis in the processor fails.
     * @public
     */
    async function analyze(pcm16k) {
        // Reset internal state before starting analysis for a new file/run
        currentVadResults = null;
        // Reset thresholds to defaults from config; they will be updated by processor results
        currentPositiveThreshold = AudioApp.config?.DEFAULT_VAD_POSITIVE_THRESHOLD ?? 0.5;
        currentNegativeThreshold = AudioApp.config?.DEFAULT_VAD_NEGATIVE_THRESHOLD ?? 0.35;

        // Define initial options for the processor, using current (default) thresholds
        const initialOptions = {
             positiveSpeechThreshold: currentPositiveThreshold,
             negativeSpeechThreshold: currentNegativeThreshold
             // Other options like frameSamples, redemptionFrames will use defaults
             // within sileroProcessor if not specified here or in config.
        };

        console.log("VadAnalyzer: Starting VAD analysis via processor...");
        try {
            // Delegate the core analysis to the injected sileroProcessor module
            const results = await processor.analyzeAudio(pcm16k, initialOptions);

            // Store the complete results object internally upon success
            currentVadResults = results;

            // Update the analyzer's current thresholds based on what was actually
            // calculated or used by the processor (initial analysis might adjust defaults)
            currentPositiveThreshold = results.initialPositiveThreshold;
            currentNegativeThreshold = results.initialNegativeThreshold;

            console.log("VadAnalyzer: Initial analysis successful.");
            return currentVadResults; // Return the comprehensive results object

        } catch (error) {
            console.error("VadAnalyzer: VAD analysis failed -", error);
            currentVadResults = null; // Ensure state is cleared on failure
            // Re-throw the error for the main application controller (main.js) to handle UI/state
            throw error;
        }
    }

     /**
     * Handles updates when VAD threshold sliders change in the UI (event dispatched via main.js).
     * Updates the relevant internal threshold state (positive or negative) and triggers
     * a recalculation of speech regions using the stored probabilities.
     * @param {string} type - The type of threshold changed ('positive' or 'negative').
     * @param {number} value - The new threshold value from the slider (0.01-0.99).
     * @returns {Array<{start: number, end: number}>} The newly recalculated speech regions. Returns empty array if analysis hasn't run successfully yet.
     * @public
     */
     function handleThresholdUpdate(type, value) {
        // Check if we have results (especially probabilities) from a previous analysis
        if (!currentVadResults || !currentVadResults.probabilities) {
            console.warn("VadAnalyzer: Cannot handle threshold update - VAD analysis results not available.");
            return []; // No analysis run yet, or it failed.
        }

        // Validate and update the internal threshold state
        let needsRecalculation = false;
        if (type === 'positive') {
            // Clamp value to a reasonable range if needed (though slider should handle this)
            const newPositive = Math.max(0.01, Math.min(0.99, value));
            if (currentPositiveThreshold !== newPositive) {
                currentPositiveThreshold = newPositive;
                // Optional: Automatically adjust negative threshold to be <= positive?
                // currentNegativeThreshold = Math.min(currentNegativeThreshold, currentPositiveThreshold);
                needsRecalculation = true;
            }
        } else if (type === 'negative') {
            const newNegative = Math.max(0.01, Math.min(0.99, value));
             // Ensure negative doesn't exceed positive threshold
            const clampedNegative = Math.min(newNegative, currentPositiveThreshold);
            if (currentNegativeThreshold !== clampedNegative) {
                 currentNegativeThreshold = clampedNegative;
                 needsRecalculation = true;
            }
        } else {
             console.warn(`VadAnalyzer: Unknown threshold type '${type}' received.`);
             // Return the previously calculated regions if the type is invalid
             return currentVadResults.regions || [];
        }

        // Trigger recalculation only if a threshold actually changed
        if (needsRecalculation) {
            // console.log(`VadAnalyzer: Recalculating regions with thresholds P=${currentPositiveThreshold.toFixed(2)}, N=${currentNegativeThreshold.toFixed(2)}`);
            return recalculateRegions();
        } else {
            // If threshold value didn't effectively change (e.g., due to clamping), return existing regions.
            return currentVadResults.regions || [];
        }
    }


    /**
     * Recalculates speech regions using stored probabilities and the *current* internal thresholds.
     * Delegates the calculation logic to the sileroProcessor.
     * Updates the `regions` array within the stored `currentVadResults`.
     * @returns {Array<{start: number, end: number}>} The recalculated speech regions. Returns empty array if analysis results aren't available.
     * @private // Made private, usually called via handleThresholdUpdate
     */
    function recalculateRegions() {
        // Check prerequisite state: need results from initial analysis
        if (!currentVadResults || !currentVadResults.probabilities) {
            console.warn("VadAnalyzer: Cannot recalculate regions - initial VAD results or probabilities missing.");
            return [];
        }

        // Prepare options for the processor's recalculate function, using current internal state
        const options = {
            frameSamples: currentVadResults.frameSamples,
            sampleRate: currentVadResults.sampleRate,
            positiveSpeechThreshold: currentPositiveThreshold, // Use current state
            negativeSpeechThreshold: currentNegativeThreshold, // Use current state
            redemptionFrames: currentVadResults.redemptionFrames
        };

        // Delegate the actual calculation logic to the processor module
        const newRegions = processor.recalculateSpeechRegions(currentVadResults.probabilities, options);

        // --- IMPORTANT: Update the stored regions ---
        // This ensures that getCurrentRegions() always returns the latest calculated regions.
        currentVadResults.regions = newRegions;

        return newRegions; // Return the newly calculated regions
    }

    /**
     * Gets the currently active speech regions.
     * This returns the `regions` array from the internally stored `currentVadResults`,
     * which should reflect the latest calculation triggered by `analyze` or `handleThresholdUpdate`.
     * @returns {Array<{start: number, end: number}>} An array of speech region objects {start, end} in seconds,
     * or an empty array if no analysis has been successfully completed.
     * @public
     */
    function getCurrentRegions() {
        // Provide easy access for other modules (like Visualizer) to get the current set of regions.
        if (currentVadResults && Array.isArray(currentVadResults.regions)) {
            return currentVadResults.regions;
        } else {
            return []; // Return empty array if no results are available
        }
    }

    // --- Public Interface ---
    // Expose methods needed by main.js to manage VAD processing and results.
    return {
        analyze: analyze,
        handleThresholdUpdate: handleThresholdUpdate,
        getCurrentRegions: getCurrentRegions
        // Note: recalculateRegions is kept private, threshold updates are the trigger.
    };

})(AudioApp.sileroProcessor); // Inject the processor dependency

// --- /vibe-player/vad/vadAnalyzer.js ---
