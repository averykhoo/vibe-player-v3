// --- START OF FILE vad-manager.js ---
'use strict';

/**
 * Manages VAD analysis state, parameters, and recalculations.
 * Interacts with the global SileroVAD object.
 */
const VADManager = (function() {

    // State
    let speechRegions = [];
    let vadProbabilities = null;
    let vadFrameSamples = 0;
    let vadSampleRate = 0;
    let vadRedemptionFrames = 0;
    let currentPositiveThreshold = 0.5;
    let currentNegativeThreshold = 0.35;
    let isAnalyzing = false;
    let hasAnalyzed = false;

    // Default options for initial analysis (can be overridden)
    const defaultAnalysisOptions = {
        positiveSpeechThreshold: currentPositiveThreshold,
        negativeSpeechThreshold: currentNegativeThreshold,
        redemptionFrames: 7,
        frameSamples: 1536 // Or another default like 480, 960 etc.
    };

    /**
     * Runs the initial VAD analysis on resampled audio data.
     * @param {Float32Array} pcm16kMono - The 16kHz mono audio data.
     * @param {object} [initialOptions] - Optional overrides for thresholds/frames for the first run.
     * @returns {Promise<boolean>} - Promise resolving to true if analysis succeeded, false otherwise.
     */
    async function analyze(pcm16kMono, initialOptions = {}) {
        if (isAnalyzing) {
            console.warn("VADManager: Analysis already in progress.");
            return false;
        }
        isAnalyzing = true;
        hasAnalyzed = false;
        console.log("VADManager: Starting analysis...");

        // Merge default options with any provided initial options
        const options = { ...defaultAnalysisOptions, ...initialOptions };

        try {
            // Assume SileroVAD.analyzeAudio exists globally and returns the expected structure
            if (!window.SileroVAD || typeof window.SileroVAD.analyzeAudio !== 'function') {
                 throw new Error("Global SileroVAD.analyzeAudio function not found.");
            }

            // Run the analysis (this performs ONNX inference)
            const vadResult = await window.SileroVAD.analyzeAudio(pcm16kMono, 16000, options);

            // Store results
            speechRegions = vadResult.regions;
            vadProbabilities = vadResult.probabilities;
            vadFrameSamples = vadResult.frameSamples;
            vadSampleRate = vadResult.sampleRate;
            vadRedemptionFrames = vadResult.redemptionFrames;
            // Update current thresholds based on what was actually used by analyzeAudio
            currentPositiveThreshold = vadResult.initialPositiveThreshold;
            currentNegativeThreshold = vadResult.initialNegativeThreshold;

            console.log("VADManager: Analysis complete.");
            hasAnalyzed = true;
            isAnalyzing = false;
            return true;
        } catch (error) {
            console.error("VADManager: Analysis failed.", error);
            // Reset state on failure
            speechRegions = [];
            vadProbabilities = null;
            isAnalyzing = false;
            hasAnalyzed = false;
            // Maybe emit an error event here? For now, return false.
            return false;
        }
    }

    /**
     * Recalculates speech regions based on stored probabilities and current thresholds.
     * This is fast as it avoids running the ONNX model again.
     */
    function recalculate() {
        if (!vadProbabilities || !hasAnalyzed) {
            console.warn("VADManager: Cannot recalculate, no analysis data available.");
            return false;
        }
        if (isAnalyzing) {
             console.warn("VADManager: Cannot recalculate while analysis is in progress.");
            return false;
        }

        console.log(`VADManager: Recalculating regions with Pos=${currentPositiveThreshold.toFixed(2)}, Neg=${currentNegativeThreshold.toFixed(2)}`);

        const options = {
            positiveSpeechThreshold: currentPositiveThreshold,
            negativeSpeechThreshold: currentNegativeThreshold,
            redemptionFrames: vadRedemptionFrames
        };

        // --- Recalculation Logic (Copied from old player.js version) ---
        const newRegions = [];
        let inSpeech = false;
        let regionStart = 0.0;
        let redemptionCounter = 0;

        for (let i = 0; i < vadProbabilities.length; i++) {
            const probability = vadProbabilities[i];
            const frameStartTime = (i * vadFrameSamples) / vadSampleRate;

            if (probability >= options.positiveSpeechThreshold) {
                if (!inSpeech) {
                    inSpeech = true;
                    regionStart = frameStartTime;
                }
                redemptionCounter = 0;
            } else if (inSpeech) {
                if (probability < options.negativeSpeechThreshold) {
                    redemptionCounter++;
                    if (redemptionCounter >= options.redemptionFrames) {
                        const triggerFrameIndex = i - options.redemptionFrames + 1;
                        const actualEnd = (triggerFrameIndex * vadFrameSamples) / vadSampleRate;
                        const finalEnd = Math.max(regionStart, actualEnd);
                        newRegions.push({ start: regionStart, end: finalEnd });
                        inSpeech = false;
                        redemptionCounter = 0;
                    }
                } else {
                    redemptionCounter = 0;
                }
            }
        }
        if (inSpeech) {
            const finalEnd = (vadProbabilities.length * vadFrameSamples) / vadSampleRate;
            newRegions.push({ start: regionStart, end: finalEnd });
        }
        // --- End Recalculation Logic ---

        speechRegions = newRegions; // Update the stored regions
        return true; // Indicate success
    }

    /**
     * Updates the current thresholds used for recalculation.
     * @param {number} positive - The new positive threshold.
     * @param {number} negative - The new negative threshold.
     * @returns {boolean} - True if recalculation was triggered, false otherwise.
     */
    function setThresholds(positive, negative) {
        let changed = false;
        if (typeof positive === 'number' && positive >= 0.01 && positive <= 0.99 && currentPositiveThreshold !== positive) {
            currentPositiveThreshold = positive;
            changed = true;
        }
         if (typeof negative === 'number' && negative >= 0.01 && negative <= 0.99 && currentNegativeThreshold !== negative) {
            currentNegativeThreshold = negative;
            changed = true;
        }

        if (changed) {
            // Trigger recalculation immediately after setting thresholds
            return recalculate();
        }
        return false; // No change, no recalculation needed
    }

    function reset() {
        speechRegions = [];
        vadProbabilities = null;
        vadFrameSamples = 0;
        vadSampleRate = 0;
        vadRedemptionFrames = 0;
        currentPositiveThreshold = defaultAnalysisOptions.positiveSpeechThreshold; // Reset to defaults
        currentNegativeThreshold = defaultAnalysisOptions.negativeSpeechThreshold;
        isAnalyzing = false;
        hasAnalyzed = false;
        console.log("VADManager: State reset.");
    }

    // --- Getters ---
    function getRegions() { return [...speechRegions]; } // Return copy
    function getProbabilities() { return vadProbabilities; } // Can return null
    function getCurrentPositiveThreshold() { return currentPositiveThreshold; }
    function getCurrentNegativeThreshold() { return currentNegativeThreshold; }
    function getHasAnalyzed() { return hasAnalyzed; }
    function getIsAnalyzing() { return isAnalyzing; }
    function getParameters() { // Get params used for the last analysis/recalculation
        return {
            frameSamples: vadFrameSamples,
            sampleRate: vadSampleRate,
            redemptionFrames: vadRedemptionFrames
        };
    }


    // Public API
    return {
        analyze,
        recalculate, // Expose recalculate if needed externally, but setThresholds calls it
        setThresholds,
        reset,
        // Getters
        getRegions,
        getProbabilities,
        getCurrentPositiveThreshold,
        getCurrentNegativeThreshold,
        getHasAnalyzed,
        getIsAnalyzing,
        getParameters
    };
})();

window.VADManager = VADManager; // Expose to global scope
// --- END OF FILE vad-manager.js ---