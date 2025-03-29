// --- /vibe-player/vad/sileroProcessor.js ---
/**
 * @namespace AudioApp.sileroProcessor
 * @description Performs VAD analysis frame-by-frame using the Silero VAD model
 * via the sileroWrapper. Encapsulates the logic for iterating through audio data,
 * running inference, and calculating speech regions based on probabilities and thresholds.
 * Depends on AudioApp.sileroWrapper and AudioApp.config.
 */
var AudioApp = AudioApp || {}; // Ensure namespace exists

AudioApp.sileroProcessor = (function(wrapper, config) { // Inject dependencies
    'use strict';

    // --- Dependency Check ---
    if (!wrapper || !wrapper.isAvailable) {
        console.error("SileroProcessor: CRITICAL - AudioApp.sileroWrapper is not available!");
        return { // Return non-functional public interface
             analyzeAudio: () => Promise.reject(new Error("Silero VAD Wrapper not available")),
             recalculateSpeechRegions: () => []
        };
    }
    if (!config) {
         console.error("SileroProcessor: CRITICAL - AudioApp.config is not available!");
         return { // Return non-functional public interface
              analyzeAudio: () => Promise.reject(new Error("Config not available")),
              recalculateSpeechRegions: () => []
         };
    }

    // --- Constants (from config) ---
    const VAD_SAMPLE_RATE = config.VAD_SAMPLE_RATE; // Should be 16000

    // --- Core Analysis Function ---

    /**
     * Analyzes 16kHz mono PCM data for speech regions using the Silero VAD model via the wrapper.
     * Iterates through audio frames, gets probabilities from the wrapper, and calculates initial regions.
     * @param {Float32Array} pcmData - The 16kHz mono Float32Array audio data. MUST be Float32Array.
     * @param {object} [options={}] - Optional VAD parameters (overrides defaults from config).
     * @param {number} [options.frameSamples=config.DEFAULT_VAD_FRAME_SAMPLES] - Samples per VAD frame.
     * @param {number} [options.positiveSpeechThreshold=config.DEFAULT_VAD_POSITIVE_THRESHOLD] - Probability threshold to start/continue speech.
     * @param {number} [options.negativeSpeechThreshold=config.DEFAULT_VAD_NEGATIVE_THRESHOLD] - Probability threshold to consider stopping speech.
     * @param {number} [options.redemptionFrames=config.DEFAULT_VAD_REDEMPTION_FRAMES] - Consecutive frames below negative threshold needed to end a speech segment.
     * @returns {Promise<VadResult>} A promise resolving to the VAD results object.
     * @typedef {object} VadResult
     * @property {Array<{start: number, end: number}>} regions - Initial calculated speech regions (in seconds).
     * @property {Float32Array} probabilities - Raw probability for each processed frame.
     * @property {number} frameSamples - Frame size used in analysis.
     * @property {number} sampleRate - Sample rate used (should be 16000).
     * @property {number} initialPositiveThreshold - Positive threshold used for initial calculation.
     * @property {number} initialNegativeThreshold - Negative threshold used for initial calculation.
     * @property {number} redemptionFrames - Redemption frames value used.
     * @throws {Error} If input is invalid or VAD inference fails in the wrapper.
     * @public
     */
    async function analyzeAudio(pcmData, options = {}) {
        // --- Validate Input ---
        if (!(pcmData instanceof Float32Array)) {
            // This is a programming error if called incorrectly. Wrapper also checks, but check early.
            console.error("SileroProcessor: analyzeAudio requires Float32Array input.");
            throw new Error("VAD input data must be a Float32Array.");
        }

        // --- Set VAD Parameters (use options or defaults from config) ---
        const frameSamples = options.frameSamples ?? config.DEFAULT_VAD_FRAME_SAMPLES;
        const positiveThreshold = options.positiveSpeechThreshold ?? config.DEFAULT_VAD_POSITIVE_THRESHOLD;
        const userNegativeThreshold = options.negativeSpeechThreshold; // Check if explicitly passed
        const redemptionFrames = options.redemptionFrames ?? config.DEFAULT_VAD_REDEMPTION_FRAMES;

        // Ensure negative threshold is valid and <= positive threshold
        const negativeThreshold = (userNegativeThreshold !== undefined)
            ? Math.max(0.01, Math.min(userNegativeThreshold, positiveThreshold)) // Clamp explicit value
            : Math.max(0.01, Math.min(positiveThreshold - 0.15, positiveThreshold)); // Default relative to positive, clamped


        // Handle empty input gracefully
        if (!pcmData || pcmData.length === 0 || pcmData.length < frameSamples) {
            console.log("SileroProcessor: No audio data or data shorter than frame size provided.");
            return { // Return an empty valid result structure
                 regions: [], probabilities: new Float32Array(),
                 frameSamples: frameSamples, sampleRate: VAD_SAMPLE_RATE,
                 initialPositiveThreshold: positiveThreshold,
                 initialNegativeThreshold: negativeThreshold,
                 redemptionFrames: redemptionFrames
            };
        }

        // --- Ensure Silero Model is Ready & Reset State ---
        // The `create` call should happen *before* this in main.js.
        // Here, we just need to reset the RNN state for the new analysis run.
        try {
            wrapper.reset_state(); // Reset RNN state in the wrapper
        } catch (resetError) {
             console.error("SileroProcessor: Error resetting VAD state via wrapper:", resetError);
             throw new Error(`Failed to reset Silero VAD state: ${resetError.message}`);
        }

        // --- Process Audio Frames ---
        const numSamples = pcmData.length;
        // Calculate the total number of full frames we can process
        const numFrames = Math.floor(numSamples / frameSamples);
        if (numFrames === 0) {
             console.warn("SileroProcessor: Audio data length is less than one frame size.");
             // Return empty result as above
              return { regions: [], probabilities: new Float32Array(), frameSamples, sampleRate: VAD_SAMPLE_RATE, initialPositiveThreshold: positiveThreshold, initialNegativeThreshold: negativeThreshold, redemptionFrames };
        }

        const allProbabilities = new Float32Array(numFrames); // Pre-allocate typed array
        console.log(`SileroProcessor: Analyzing ${numSamples} samples (${numFrames} frames) with frame size ${frameSamples}...`);
        const startTime = performance.now();

        try {
            // Iterate through the audio data in frames.
            for (let i = 0; i < numFrames; i++) {
                const frameStart = i * frameSamples;
                const frameEnd = frameStart + frameSamples;
                // Extract the current frame using subarray (efficient view, no copy)
                const frame = pcmData.subarray(frameStart, frameEnd);

                // Get probability from the wrapper (which runs the ONNX model)
                // The wrapper throws if inference fails.
                const probability = await wrapper.process(frame);
                allProbabilities[i] = probability; // Store directly into typed array
            }
        } catch (inferenceError) {
            const endTime = performance.now();
            console.error(`SileroProcessor: Error during VAD inference after ${((endTime - startTime)/1000).toFixed(2)}s:`, inferenceError);
            // Re-throw for main.js to handle UI state and cleanup
            throw new Error(`VAD inference failed: ${inferenceError.message}`);
        }

        const endTime = performance.now();
        console.log(`SileroProcessor: VAD inference took ${((endTime - startTime)/1000).toFixed(2)}s.`);

        // --- Calculate Initial Regions based on computed probabilities ---
        // Use the common recalculation logic for consistency.
        const initialRegions = recalculateSpeechRegionsInternal(allProbabilities, {
            frameSamples: frameSamples,
            sampleRate: VAD_SAMPLE_RATE,
            positiveSpeechThreshold: positiveThreshold,
            negativeSpeechThreshold: negativeThreshold,
            redemptionFrames: redemptionFrames
        });

        console.log(`SileroProcessor: Initially detected ${initialRegions.length} speech regions.`);

        // --- Return Comprehensive Results ---
        return {
            regions: initialRegions,            // The calculated regions
            probabilities: allProbabilities,    // Raw probabilities for potential recalculation
            // Parameters used for this analysis run:
            frameSamples: frameSamples,
            sampleRate: VAD_SAMPLE_RATE,
            initialPositiveThreshold: positiveThreshold,
            initialNegativeThreshold: negativeThreshold,
            redemptionFrames: redemptionFrames
        };
    }


    // --- Region Recalculation Function ---

    /**
     * Internal function to calculate speech regions based on probabilities and thresholds.
     * This contains the core VAD state machine logic (inSpeech, redemptionCounter).
     * @param {Float32Array} probabilities - Array of speech probabilities for each frame.
     * @param {object} options - Contains current threshold and VAD parameters.
     * @param {number} options.frameSamples - Samples per frame used during original analysis.
     * @param {number} options.sampleRate - Sample rate used (should be 16000).
     * @param {number} options.positiveSpeechThreshold - Current positive threshold.
     * @param {number} options.negativeSpeechThreshold - Current negative threshold (must be <= positive).
     * @param {number} options.redemptionFrames - Consecutive frames below negative threshold to end segment.
     * @returns {Array<{start: number, end: number}>} - Calculated speech regions in seconds.
     * @private
     */
    function recalculateSpeechRegionsInternal(probabilities, options) {
        // Destructure options for clarity and assign defaults if somehow missing
        const {
            frameSamples, sampleRate, positiveSpeechThreshold,
            negativeSpeechThreshold, redemptionFrames
        } = options;

        // Basic validation
        if (!probabilities || probabilities.length === 0 || !frameSamples || !sampleRate ||
            positiveSpeechThreshold === undefined || negativeSpeechThreshold === undefined || redemptionFrames === undefined) {
            console.warn("SileroProcessor: Invalid arguments for recalculateSpeechRegionsInternal.", options);
            return []; // Return empty array if essential parameters are missing
        }
        // Ensure negative threshold is not higher than positive
        if (negativeSpeechThreshold > positiveSpeechThreshold) {
             console.warn(`SileroProcessor: Negative threshold (${negativeSpeechThreshold}) > Positive threshold (${positiveSpeechThreshold}). Clamping negative.`);
             options.negativeSpeechThreshold = positiveSpeechThreshold; // Clamp for this calculation
        }


        /** @type {Array<{start: number, end: number}>} */
        const newRegions = [];
        let inSpeech = false;           // State: Are we currently inside a speech segment?
        let regionStartSample = 0;      // Sample index where the current potential segment started
        let redemptionCounter = 0;      // Counter for consecutive frames below negative threshold

        // Iterate through the frame probabilities.
        for (let i = 0; i < probabilities.length; i++) {
            const probability = probabilities[i];
            // Calculate the start sample index for the *current* frame.
            const currentFrameStartSample = i * frameSamples;

            // --- VAD State Machine Logic ---
            if (probability >= positiveSpeechThreshold) {
                // Frame is considered speech.
                if (!inSpeech) {
                    // Transition: Start of a new speech segment.
                    inSpeech = true;
                    regionStartSample = currentFrameStartSample; // Record start sample index.
                    // console.log(`DEBUG: Speech Start Frame ${i} at sample ${regionStartSample}`);
                }
                // Reset redemption counter whenever speech is detected (above positive threshold).
                redemptionCounter = 0;
            } else if (inSpeech) {
                // Frame is not conclusively speech (below positive threshold), but we were previously in speech.
                if (probability < negativeSpeechThreshold) {
                    // Probability is below the 'hang-off' threshold. Increment the counter.
                    redemptionCounter++;
                    if (redemptionCounter >= redemptionFrames) {
                        // Redemption threshold met. The speech segment ends HERE.
                        // The segment effectively ended *before* the frame that *completed* the redemption count.
                        // The start sample of the frame that *first* dropped below the negative threshold in this sequence
                        // marks the end of the actual speech. This frame index is `i - redemptionFrames + 1`.
                        const endFrameIndex = i - redemptionFrames + 1;
                        const regionEndSample = endFrameIndex * frameSamples;

                        // Ensure end sample isn't before start sample (can happen with short blips + high redemption).
                        if (regionEndSample > regionStartSample) {
                            newRegions.push({
                                start: regionStartSample / sampleRate, // Convert sample index to seconds
                                end: regionEndSample / sampleRate     // Convert sample index to seconds
                            });
                            // console.log(`DEBUG: Speech End Frame ${i} (effective end sample ${regionEndSample}) -> Region [${(regionStartSample/sampleRate).toFixed(2)}s, ${(regionEndSample/sampleRate).toFixed(2)}s]`);
                        } else {
                             // console.log(`DEBUG: Discarding short speech blip ending at frame ${i}`);
                        }
                        // Transition: Exit speech state.
                        inSpeech = false;
                        redemptionCounter = 0; // Reset counter for the next potential segment.
                    }
                    // else: Still within redemption period, remain inSpeech, counter increments.
                } else {
                    // Probability is between negative and positive thresholds (uncertain region).
                    // Treat this as continuation of speech for now - reset the redemption counter.
                    redemptionCounter = 0;
                }
            }
            // else: Not inSpeech and probability < positiveThreshold - do nothing, waiting for speech start.
            // --- End VAD State Machine Logic ---
        }

        // --- Handle Segment Continuing to End ---
        // If the loop finishes and we are still 'inSpeech', finalize the last segment.
        if (inSpeech) {
            // The speech segment extends to the end of the *last processed frame*.
            // The last processed frame index is `probabilities.length - 1`.
            // Its end sample index is `(probabilities.length - 1) * frameSamples + frameSamples`, which simplifies to `probabilities.length * frameSamples`.
            const regionEndSample = probabilities.length * frameSamples;

             if (regionEndSample > regionStartSample) { // Ensure valid duration
                 newRegions.push({
                     start: regionStartSample / sampleRate,
                     end: regionEndSample / sampleRate
                 });
                // console.log(`DEBUG: Speech End at EOF (effective end sample ${regionEndSample}) -> Region [${(regionStartSample/sampleRate).toFixed(2)}s, ${(regionEndSample/sampleRate).toFixed(2)}s]`);
             }
        }

        // console.log(`Recalculated ${newRegions.length} regions with pos=${positiveSpeechThreshold.toFixed(2)} neg=${negativeSpeechThreshold.toFixed(2)} red=${redemptionFrames}`);
        return newRegions;
    }


    /**
     * Public wrapper for recalculating speech regions. Uses stored probabilities
     * from the last `analyzeAudio` call and new threshold options.
     * @param {Float32Array} probabilities - The stored probabilities array.
     * @param {object} options - Contains current thresholds and VAD parameters.
     *                          (Includes frameSamples, sampleRate, positiveSpeechThreshold,
     *                           negativeSpeechThreshold, redemptionFrames).
     * @returns {Array<{start: number, end: number}>} - Newly calculated speech regions.
     * @public
     */
    function recalculateSpeechRegions(probabilities, options) {
        // This public function simply calls the internal logic.
        // It provides a clear public API separate from the initial analysis.
        return recalculateSpeechRegionsInternal(probabilities, options);
    }


    // --- Public Interface ---
    return {
        analyzeAudio: analyzeAudio,
        recalculateSpeechRegions: recalculateSpeechRegions // Expose recalculation separately
    };

})(AudioApp.sileroWrapper, AudioApp.config); // Pass dependencies

// --- /vibe-player/vad/sileroProcessor.js ---
