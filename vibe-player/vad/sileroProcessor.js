// /vibe-player/vad/sileroProcessor.js

/**
 * Processes audio using the Silero VAD wrapper, applying thresholds
 * and logic to detect speech segments based on frame probabilities.
 */
const sileroProcessor = (() => {
    // --- Private Module State ---
    let wrapper = null; // Reference to AudioApp.sileroWrapper

    // --- Public API ---
    return {
        /**
         * Initializes the Silero Processor.
         * @param {object} sileroWrapperInstance Instance of the Silero Wrapper.
         */
        init(sileroWrapperInstance) {
            if (!sileroWrapperInstance) {
                throw new Error("SileroProcessor requires an instance of SileroWrapper.");
            }
            wrapper = sileroWrapperInstance;
            console.log("SileroProcessor initialized.");
        },

        /**
         * Analyzes the full audio data for speech regions using the VAD model.
         *
         * @param {Float32Array} pcmData Mono PCM audio data at the VAD model's sample rate (e.g., 16kHz).
         * @param {object} options VAD processing options.
         * @param {number} options.window_size_samples Size of each audio chunk to process.
         * @param {number} options.threshold Probability threshold to trigger speech start.
         * @param {number} options.negative_threshold Probability threshold to trigger speech end (after redemption).
         * @param {number} options.min_speech_duration_ms Minimum duration (ms) for a speech segment.
         * @param {number} options.min_silence_duration_ms Minimum duration (ms) of silence to mark end of segment.
         * @param {number} options.speech_pad_ms Padding (ms) added to the start/end of detected speech segments.
         * @param {number} options.sampleRate The sample rate of the pcmData (should match VAD model).
         * @param {function} [progressCallback] Optional callback function for progress updates (0 to 1).
         * @returns {Promise<Array<{start: number, end: number}>>} A promise resolving to an array of speech regions [{start, end} in seconds].
         */
        async analyzeAudio(pcmData, options, progressCallback = null) {
            if (!wrapper || !wrapper.isReady()) {
                console.error("[SileroProcessor] Wrapper not ready for analysis.");
                // Attempt to create session if not ready? Or let vadAnalyzer handle it?
                // For now, assume vadAnalyzer ensures readiness before calling.
                throw new Error("VAD model session is not ready.");
            }
            if (!pcmData || pcmData.length === 0) {
                console.warn("[SileroProcessor] No audio data provided for analysis.");
                return [];
            }

            console.log("[SileroProcessor] Starting audio analysis with options:", options);

            const {
                window_size_samples,
                threshold,
                negative_threshold, // Lower threshold for ending speech
                min_speech_duration_ms,
                min_silence_duration_ms,
                speech_pad_ms,
                sampleRate
            } = options;

            // Convert ms thresholds to samples
            const minSpeechSamples = sampleRate * (min_speech_duration_ms / 1000);
            const minSilenceSamples = sampleRate * (min_silence_duration_ms / 1000);
            const speechPadSamples = sampleRate * (speech_pad_ms / 1000);

            let regions = [];
            let currentSpeechStart = -1; // Index where current potential speech segment started
            let silenceFrames = 0;       // Number of consecutive frames below negative_threshold after speech trigger
            let speechFrames = 0;        // Number of consecutive frames above threshold triggering speech
            let triggered = false;       // Are we currently in a potential speech segment (above threshold)?

            // Reset VAD model state before starting analysis
            wrapper.reset_state();

            const totalSamples = pcmData.length;
            const numChunks = Math.ceil(totalSamples / window_size_samples);
            let lastProgressUpdate = -1;

            console.log(`[SileroProcessor] Processing ${totalSamples} samples in ${numChunks} chunks of size ${window_size_samples}...`);

            for (let i = 0; i < numChunks; i++) {
                const start = i * window_size_samples;
                const end = Math.min(start + window_size_samples, totalSamples);
                const chunk = pcmData.slice(start, end);

                // If the last chunk is smaller than the window size, pad it with zeros.
                // Silero VAD models often require fixed input size.
                let inputChunk = chunk;
                if (chunk.length < window_size_samples) {
                    inputChunk = new Float32Array(window_size_samples).fill(0);
                    inputChunk.set(chunk, 0);
                     // console.log(`[SileroProcessor] Padded last chunk from ${chunk.length} to ${window_size_samples}`);
                }

                // Process the chunk using the wrapper
                const result = await wrapper.process(inputChunk);
                if (!result) {
                    // Error during processing, stop analysis?
                    console.error(`[SileroProcessor] VAD processing failed at chunk ${i}. Stopping analysis.`);
                    // Maybe return partial regions? For now, return empty or throw.
                    throw new Error(`VAD inference failed at chunk ${i}.`);
                }
                const prob = result.probability;
                const currentTimeIndex = start; // Start index of the current chunk

                // --- VAD State Machine Logic ---
                if (prob >= threshold && !triggered) {
                    triggered = true;
                    speechFrames++;
                    // If not already in speech, mark potential start
                    if (currentSpeechStart === -1) {
                         currentSpeechStart = currentTimeIndex;
                         // console.log(` -> Potential Speech Start at sample ${currentSpeechStart} (prob: ${prob.toFixed(3)})`);
                    }
                    silenceFrames = 0; // Reset silence counter
                } else if (prob >= threshold && triggered) {
                     speechFrames++;
                     silenceFrames = 0; // Still speech, reset silence counter
                } else if (prob < negative_threshold && triggered) {
                    silenceFrames++;
                    // Check if silence duration exceeds minimum
                    if (silenceFrames * window_size_samples >= minSilenceSamples) {
                        // Silence duration met, potentially end the speech segment
                        if (currentSpeechStart !== -1) {
                             // Check if the detected speech part meets minimum duration
                             // const speechDurationSamples = (currentTimeIndex + window_size_samples) - currentSpeechStart; // End of current chunk
                             const potentialEndIndex = currentTimeIndex - ( (silenceFrames -1) * window_size_samples); // End is before the min_silence started
                             const speechDurationSamples = potentialEndIndex - currentSpeechStart;

                             if (speechDurationSamples >= minSpeechSamples) {
                                 // Valid speech segment detected
                                 const segmentStart = Math.max(0, currentSpeechStart - speechPadSamples);
                                 const segmentEnd = Math.min(totalSamples, potentialEndIndex + speechPadSamples);

                                 // Convert samples to seconds
                                 regions.push({
                                     start: segmentStart / sampleRate,
                                     end: segmentEnd / sampleRate
                                 });
                                  // console.log(` -> Speech End. Region [${(segmentStart/sampleRate).toFixed(3)} - ${(segmentEnd/sampleRate).toFixed(3)}]s`);
                             } else {
                                  // console.log(` -> Speech segment too short (${(speechDurationSamples/sampleRate).toFixed(3)}s), discarding.`);
                             }
                         }
                        // Reset state for next segment
                        triggered = false;
                        currentSpeechStart = -1;
                        silenceFrames = 0;
                        speechFrames = 0;
                    } else {
                        // Silence detected, but not long enough yet, keep accumulating
                        speechFrames = 0; // Reset contiguous speech frames counter
                    }
                } else if (prob >= negative_threshold && triggered) {
                     // Below positive threshold but above negative threshold - considered 'uncertain' or continued speech
                     // Reset silence counter but don't increment speech counter unless above positive threshold.
                     silenceFrames = 0;
                } else {
                    // Below negative_threshold and not triggered (continued silence)
                    // No state change needed
                }

                // --- Progress Update ---
                 if (progressCallback) {
                     const progress = (i + 1) / numChunks;
                     // Throttle progress updates slightly
                     const currentProgressBucket = Math.floor(progress * 100); // Update approx every 1%
                     if (currentProgressBucket > lastProgressUpdate) {
                         progressCallback(progress);
                         lastProgressUpdate = currentProgressBucket;
                     }
                 }

            } // End loop through chunks

            // Handle case where audio ends during a triggered speech segment
            if (currentSpeechStart !== -1) {
                 // Check if the final segment meets minimum duration
                 const speechDurationSamples = totalSamples - currentSpeechStart;
                 if (speechDurationSamples >= minSpeechSamples) {
                     // Valid speech segment at the end
                     const segmentStart = Math.max(0, currentSpeechStart - speechPadSamples);
                     const segmentEnd = totalSamples; // End of audio

                     regions.push({
                         start: segmentStart / sampleRate,
                         end: segmentEnd / sampleRate
                     });
                      // console.log(` -> Speech End (Audio End). Region [${(segmentStart/sampleRate).toFixed(3)} - ${(segmentEnd/sampleRate).toFixed(3)}]s`);
                 } else {
                     // console.log(` -> Final speech segment too short (${(speechDurationSamples/sampleRate).toFixed(3)}s), discarding.`);
                 }
            }

            // Merge overlapping or very close regions? (Optional post-processing)
            // regions = mergeOverlappingRegions(regions, mergeThresholdSeconds);

             console.log(`[SileroProcessor] Analysis finished. Found ${regions.length} regions.`);
            return regions;
        }
    };
})();

// Attach to the global AudioApp namespace
if (typeof window.AudioApp === 'undefined') {
    window.AudioApp = {};
}
window.AudioApp.sileroProcessor = sileroProcessor;
console.log("SileroProcessor module loaded.");

// /vibe-player/vad/sileroProcessor.js
