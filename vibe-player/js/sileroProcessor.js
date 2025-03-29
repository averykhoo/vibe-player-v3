// --- /vibe-player/js/sileroProcessor.js ---
// Performs VAD analysis frame-by-frame using the SileroWrapper.
// Encapsulates the logic for iterating through audio data and calculating speech regions.

var AudioApp = AudioApp || {}; // Ensure namespace exists

// Design Decision: Use IIFE, pass the Silero wrapper module as a dependency.
AudioApp.sileroProcessor = (function(wrapper) {
    'use strict';

    // Check if the required wrapper module is available
    if (!wrapper || !wrapper.isAvailable) {
        console.error("SileroProcessor: CRITICAL - AudioApp.sileroWrapper is not available!");
        // Return a non-functional public interface
        return {
             /** @returns {Promise<object>} */ analyzeAudio: () => Promise.reject(new Error("Silero VAD Wrapper not available")),
             /** @returns {Array} */ recalculateSpeechRegions: () => []
        };
    }

    // --- Constants ---
    /** @const {number} The fixed sample rate required by the Silero VAD model */
    const VAD_SAMPLE_RATE = 16000;

    // --- Core Analysis Function ---

    /**
     * Analyzes 16kHz mono PCM data for speech regions using the Silero VAD model via the wrapper.
     * Returns initial speech regions and the raw probabilities for each frame.
     * @param {Float32Array} pcmData - The 16kHz mono Float32Array audio data.
     * @param {object} [options={}] - VAD parameters.
     * @param {number} [options.frameSamples=1536] - Samples per VAD frame (e.g., 96ms @ 16kHz). Affects latency and granularity.
     * @param {number} [options.positiveSpeechThreshold=0.5] - Probability threshold to start or continue speech.
     * @param {number} [options.negativeSpeechThreshold] - Probability threshold to consider stopping speech (defaults to positive - 0.15).
     * @param {number} [options.redemptionFrames=7] - Consecutive frames below negative threshold needed to end a speech segment.
     * @param {string} [options.modelPath='./model/silero_vad.onnx'] - Path to model (passed to wrapper if needed, though wrapper usually handles creation).
     * @returns {Promise<VadResult>} A promise resolving to the VAD results object.
     * @typedef {object} VadResult
     * @property {Array<{start: number, end: number}>} regions - Initial calculated speech regions.
     * @property {Float32Array} probabilities - Raw probability for each processed frame.
     * @property {number} frameSamples - Frame size used in analysis.
     * @property {number} sampleRate - Sample rate used (should be 16000).
     * @property {number} initialPositiveThreshold - Positive threshold used for initial calculation.
     * @property {number} initialNegativeThreshold - Negative threshold used for initial calculation.
     * @property {number} redemptionFrames - Redemption frames value used.
     * @throws {Error} If analysis fails (e.g., wrapper error, invalid input).
     * @public
     */
    async function analyzeAudio(pcmData, options = {}) {
        // --- Validate Input ---
        if (!(pcmData instanceof Float32Array)) {
            // Attempt conversion, but warn. Performance might be impacted elsewhere if conversion is frequent.
            console.warn("SileroProcessor: VAD input data is not Float32Array. Attempting conversion.");
            try { pcmData = new Float32Array(pcmData); }
            catch (e) {
                console.error("SileroProcessor: Failed to convert VAD input data to Float32Array.", e);
                throw new Error("VAD input data must be a Float32Array or convertible.");
            }
        }
        if (!pcmData || pcmData.length === 0) {
            console.log("SileroProcessor: No audio data provided to analyze.");
            // Return an empty valid result structure
            return {
                 regions: [], probabilities: new Float32Array(),
                 frameSamples: options.frameSamples || 1536, sampleRate: VAD_SAMPLE_RATE,
                 initialPositiveThreshold: options.positiveSpeechThreshold || 0.5,
                 initialNegativeThreshold: options.negativeSpeechThreshold || ((options.positiveSpeechThreshold || 0.5) - 0.15),
                 redemptionFrames: options.redemptionFrames || 7
            };
        }

        // --- VAD Parameters ---
        // Design Decision: Set defaults here, allowing overrides via options.
        const frameSamples = options.frameSamples || 1536; // ~96ms default seems reasonable
        const positiveThreshold = options.positiveSpeechThreshold !== undefined ? options.positiveSpeechThreshold : 0.5;
        // Default negative threshold relative to positive, ensuring it's slightly lower.
        const negativeThreshold = options.negativeSpeechThreshold !== undefined
            ? options.negativeSpeechThreshold
            : Math.max(0.01, positiveThreshold - 0.15); // Ensure negative doesn't go too low
        const redemptionFrames = options.redemptionFrames !== undefined ? options.redemptionFrames : 7;

        // --- Ensure Silero Model is Ready & Reset State ---
        // Design Decision: Call reset_state via the wrapper before processing each new file/analysis run.
        // Assumes the wrapper's `create` method was called successfully earlier by app.js or similar.
        try {
            wrapper.reset_state();
        } catch (e) {
             console.error("SileroProcessor: Error resetting VAD state via wrapper:", e);
             // Should this throw? If reset fails, processing will likely fail too.
            throw new Error(`Failed to reset Silero VAD state: ${e.message}`);
        }

        // --- Process Audio Frames ---
        /** @type {number[]} Temporary array to store probabilities */
        const allProbabilities = [];
        console.log(`SileroProcessor: Analyzing ${pcmData.length} samples with frame size ${frameSamples}...`);
        const startTime = performance.now();

        try {
            // Iterate through the audio data in non-overlapping frames.
            // The loop condition ensures we don't try to slice beyond the buffer length.
            for (let i = 0; i <= pcmData.length - frameSamples; i += frameSamples) {
                // Extract the current frame. Use slice for a copy.
                const frame = pcmData.slice(i, i + frameSamples);

                // Run the Silero VAD model on the frame using the wrapper.
                const probability = await wrapper.process(frame);
                allProbabilities.push(probability);
            }
        } catch (e) {
            const endTime = performance.now();
            console.error(`SileroProcessor: Error during frame processing after ${((endTime - startTime)/1000).toFixed(2)}s:`, e);
            // Re-throw error for app.js to handle UI state
            throw new Error(`VAD inference failed: ${e.message}`);
        }
        const endTime = performance.now();
        console.log(`SileroProcessor: VAD analysis took ${((endTime - startTime)/1000).toFixed(2)}s.`);


        // --- Calculate Initial Regions ---
        // Design Decision: Use the same `recalculateSpeechRegions` logic for initial calculation
        // to ensure consistency between initial results and results after threshold changes.
        const probabilities = new Float32Array(allProbabilities); // Convert to typed array
        const initialRegions = recalculateSpeechRegions(probabilities, {
            frameSamples: frameSamples,
            sampleRate: VAD_SAMPLE_RATE,
            positiveSpeechThreshold: positiveThreshold,
            negativeSpeechThreshold: negativeThreshold,
            redemptionFrames: redemptionFrames
        });

        console.log(`SileroProcessor: Initially detected ${initialRegions.length} speech regions.`);

        // --- Return Comprehensive Results ---
        return {
            regions: initialRegions,
            probabilities: probabilities, // Provide raw probabilities for later recalculation
            frameSamples: frameSamples,
            sampleRate: VAD_SAMPLE_RATE,
            initialPositiveThreshold: positiveThreshold, // Record params used
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
     * @param {number} options.sampleRate - Sample rate used (should be 16000).
     * @param {number} options.positiveSpeechThreshold - Current positive threshold (e.g., from slider).
     * @param {number} options.negativeSpeechThreshold - Current negative threshold.
     * @param {number} options.redemptionFrames - Redemption frames value used.
     * @returns {Array<{start: number, end: number}>} - Newly calculated speech regions.
     * @public
     */
    function recalculateSpeechRegions(probabilities, options) {
        // Destructure options for clarity
        const {
            frameSamples, sampleRate, positiveSpeechThreshold,
            negativeSpeechThreshold, redemptionFrames
        } = options;

        // Basic validation
        if (!probabilities || probabilities.length === 0 || !frameSamples || !sampleRate || !positiveSpeechThreshold || !negativeSpeechThreshold || !redemptionFrames) {
            console.warn("SileroProcessor: Invalid arguments for recalculateSpeechRegions.", options);
            return [];
        }

        /** @type {Array<{start: number, end: number}>} */
        const newRegions = [];
        let inSpeech = false;
        let regionStart = 0.0;
        let redemptionCounter = 0; // Counter for consecutive non-speech frames below negative threshold

        // Iterate through the stored probabilities.
        for (let i = 0; i < probabilities.length; i++) {
            const probability = probabilities[i];
            // Calculate start time for the *current* frame.
            const frameStartTime = (i * frameSamples) / sampleRate;
            // const frameEndTime = ((i + 1) * frameSamples) / sampleRate; // Not needed for end calculation logic

            // --- Apply VAD Logic ---
            if (probability >= positiveSpeechThreshold) {
                // Frame is considered speech.
                if (!inSpeech) {
                    // Start of a new speech segment.
                    inSpeech = true;
                    regionStart = frameStartTime; // Record start time (start of this frame).
                }
                // Reset redemption counter if we detect speech.
                redemptionCounter = 0;
            } else if (inSpeech) {
                // Frame is not positive, but we were previously in a speech segment.
                if (probability < negativeSpeechThreshold) {
                    // Probability is below the negative threshold, increment redemption counter.
                    redemptionCounter++;
                    if (redemptionCounter >= redemptionFrames) {
                        // Redemption threshold met, finalize the speech segment.
                        // The speech effectively ended 'redemptionFrames' ago.
                        // The frame that triggered the end (first frame below negative threshold in the sequence)
                        // has index `i - redemptionFrames + 1`. The segment ends *at the start* of this triggering frame.
                        const triggerFrameIndex = i - redemptionFrames + 1;
                        const actualEnd = (triggerFrameIndex * frameSamples) / sampleRate;

                        // Ensure end time isn't before start time (can happen with short blips and high redemption).
                        const finalEnd = Math.max(regionStart, actualEnd);

                        newRegions.push({ start: regionStart, end: finalEnd });
                        inSpeech = false; // No longer in speech.
                        redemptionCounter = 0; // Reset counter for next segment.
                    }
                    // else: Still within redemption period, do nothing yet.
                } else {
                    // Probability is between negative and positive thresholds.
                    // Treat as continuation of speech (reset redemption counter).
                    redemptionCounter = 0;
                }
            }
            // If not inSpeech and probability < positiveThreshold, do nothing.
            // --- End VAD Logic ---
        }

        // If still 'inSpeech' after the loop (speech continued to the end of the audio),
        // finalize the last segment.
        if (inSpeech) {
            // End time is the end of the very last processed frame.
            const finalEnd = (probabilities.length * frameSamples) / sampleRate;
            newRegions.push({ start: regionStart, end: finalEnd });
        }

        // console.log(`Recalculated ${newRegions.length} regions with pos=${positiveSpeechThreshold.toFixed(2)} neg=${negativeSpeechThreshold.toFixed(2)} red=${redemptionFrames}`);
        return newRegions;
    }

    // --- Public Interface ---
    return {
        analyzeAudio: analyzeAudio,
        recalculateSpeechRegions: recalculateSpeechRegions
    };

})(AudioApp.sileroWrapper); // Pass the Silero wrapper module as a dependency
