// /vibe-player/vad/vadAnalyzer.js

/**
 * Manages VAD analysis process, stores results, handles threshold updates,
 * and interacts with the SileroProcessor and SileroWrapper.
 */
const vadAnalyzer = (() => {
    // --- Private Module State ---
    let config = null;           // VAD-specific config from global config
    let processor = null;        // Reference to AudioApp.sileroProcessor
    let wrapper = null;          // Reference to AudioApp.sileroWrapper (needed for readiness check)

    let currentVadResults = {    // Store the latest results
        regions: [],
        stats: { totalSpeechTime: 0 }
    };
    let currentPcmData = null;   // Store the 16kHz PCM data used for the last analysis
    let currentOptions = {};     // Store options used for the last analysis

    let isAnalyzing = false;     // Prevent concurrent analyses
    let isInitialized = false;   // Has the ONNX model session been created?

    // --- Private Methods ---

    /** Calculates basic statistics from the detected regions. */
    function calculateStats(regions) {
        let totalSpeechTime = 0;
        if (regions && regions.length > 0) {
            totalSpeechTime = regions.reduce((sum, region) => sum + (region.end - region.start), 0);
        }
        return { totalSpeechTime };
    }

    // --- Public API ---
    return {
        /**
         * Initializes the VAD Analyzer.
         * @param {object} vadConfig VAD-specific configuration object.
         * @param {object} sileroProcessorInstance Instance of the Silero Processor.
         * @returns {Promise<boolean>} True if initialization (including potential model load) succeeds.
         */
        async init(vadConfig, sileroProcessorInstance) {
            if (!vadConfig || !sileroProcessorInstance) {
                throw new Error("VadAnalyzer init requires VAD config and Silero Processor instance.");
            }
            config = vadConfig;
            processor = sileroProcessorInstance;
            // Get wrapper reference indirectly via processor or expect it passed? Assuming AudioApp namespace access.
            if (!AudioApp.sileroWrapper) throw new Error("SileroWrapper instance not found on AudioApp.");
            wrapper = AudioApp.sileroWrapper;

            // Store initial options based on config
            currentOptions = { ...config }; // Copy config defaults

            // Don't load the model here automatically. Load it on the first analyze call.
            isInitialized = false; // Mark as not yet initialized (model not loaded)
            console.log("VadAnalyzer initialized (model loading deferred).");
            return true; // Init itself is synchronous for now
        },

        /**
         * Checks if the underlying VAD model session is ready.
         * @returns {boolean}
         */
        isReady() {
            return isInitialized && wrapper && wrapper.isReady();
        },

        /**
         * Runs the VAD analysis on the provided PCM data.
         * Ensures the ONNX session is created if it hasn't been already.
         * @param {Float32Array} pcm16k Mono PCM audio data at the required sample rate (e.g., 16kHz).
         * @returns {Promise<object>} A promise resolving to the VAD results object { regions, stats }.
         */
        async analyze(pcm16k) {
            if (isAnalyzing) {
                console.warn("[VadAnalyzer] Analysis already in progress.");
                return currentVadResults; // Return existing results if busy
            }
            if (!processor || !wrapper) {
                console.error("[VadAnalyzer] Processor or Wrapper not initialized.");
                throw new Error("VAD components not initialized.");
            }
            if (!pcm16k) {
                 console.error("[VadAnalyzer] No PCM data provided for analysis.");
                 return { regions: [], stats: { totalSpeechTime: 0 } }; // Return empty results
            }

            isAnalyzing = true;
            console.log("[VadAnalyzer] Starting analysis...");
            currentPcmData = pcm16k; // Store data for potential recalculations

            try {
                // --- Ensure ONNX Session is Ready ---
                if (!this.isReady()) {
                    console.log("[VadAnalyzer] ONNX session not ready, attempting creation...");
                     AudioApp.uiManager?.showLoading(true, 'Loading VAD Model...'); // Inform UI
                    const success = await wrapper.createSession();
                     AudioApp.uiManager?.showLoading(false); // Hide spinner
                    if (!success) {
                        throw new Error("Failed to create VAD model session.");
                    }
                    isInitialized = true; // Mark as initialized (model loaded)
                    console.log("[VadAnalyzer] ONNX session created successfully.");
                }

                 // --- Run Analysis using Processor ---
                 // Use current thresholds stored in currentOptions
                 const optionsForAnalysis = {
                    window_size_samples: config.window_size_samples,
                    threshold: currentOptions.threshold,
                    negative_threshold: currentOptions.negative_threshold,
                    min_speech_duration_ms: config.min_speech_duration_ms,
                    min_silence_duration_ms: config.min_silence_duration_ms,
                    speech_pad_ms: config.speech_pad_ms,
                    sampleRate: config.sampleRate
                };

                 // Optional progress callback for UI updates during long analysis
                 const progressCallback = (progress) => {
                      // console.log(`VAD Progress: ${(progress * 100).toFixed(0)}%`);
                      AudioApp.uiManager?.showLoading(true, `Analyzing VAD (${(progress * 100).toFixed(0)}%)...`);
                 };

                const regions = await processor.analyzeAudio(pcm16k, optionsForAnalysis, progressCallback);
                const stats = calculateStats(regions);
                currentVadResults = { regions, stats };
                 AudioApp.uiManager?.showLoading(false); // Ensure spinner hidden after progress updates

                console.log(`[VadAnalyzer] Analysis complete. Found ${regions.length} regions.`);
                return currentVadResults;

            } catch (error) {
                console.error("[VadAnalyzer] VAD analysis failed:", error);
                 AudioApp.uiManager?.showError(`VAD analysis failed: ${error.message}`);
                currentVadResults = { regions: [], stats: { totalSpeechTime: 0 } }; // Reset results on error
                return currentVadResults; // Return empty results
            } finally {
                isAnalyzing = false;
            }
        },

         /**
         * Recalculates VAD regions using previously analyzed data but with new thresholds.
         * @param {number} newThreshold New positive threshold.
         * @param {number} newNegativeThreshold New negative threshold.
         * @returns {Promise<object>} A promise resolving to the updated VAD results object { regions, stats }.
         */
         async recalculateWithNewThresholds(newThreshold, newNegativeThreshold) {
             if (!currentPcmData) {
                 console.warn("[VadAnalyzer] Cannot recalculate: No previous PCM data available.");
                 return currentVadResults; // Return existing results
             }
             if (isAnalyzing) {
                  console.warn("[VadAnalyzer] Cannot recalculate: Analysis already in progress.");
                  return currentVadResults;
             }

             console.log(`[VadAnalyzer] Recalculating with new thresholds: Pos=${newThreshold.toFixed(2)}, Neg=${newNegativeThreshold.toFixed(2)}`);

             // Update stored options
             currentOptions.threshold = newThreshold;
             currentOptions.negative_threshold = newNegativeThreshold;

             // Reuse the analyze function with the stored PCM data and updated options
             // No need to recreate session if already initialized
             return await this.analyze(currentPcmData);
         },


        /**
         * Handles threshold updates from the UI (called by playbackController).
         * Triggers recalculation if necessary data exists.
         * @param {number} threshold The new positive threshold.
         * @param {number} negative_threshold The new negative threshold.
         */
        setThresholds(threshold, negative_threshold) {
            if (threshold === currentOptions.threshold && negative_threshold === currentOptions.negative_threshold) {
                return; // No change
            }
             console.log(`[VadAnalyzer] Threshold update received: Pos=${threshold.toFixed(2)}, Neg=${negative_threshold.toFixed(2)}`);
             // Don't run recalculate directly here. PlaybackController listens for the UI event,
             // calls this method to update the state, THEN tells the visualizer to redraw
             // using getResults(). This avoids recalculating if the user just wiggles the slider quickly.
             // Let's refine this - maybe recalculate IS better here if data exists.

             currentOptions.threshold = threshold;
             currentOptions.negative_threshold = negative_threshold;

             // If we have data, recalculate immediately for real-time feel
             if (currentPcmData && !isAnalyzing) {
                 // Recalculate but don't await fully - let it run async?
                 // Or should UI update wait? Let's recalculate and update results object.
                 // The UI update itself is triggered by playbackController getting results later.
                 this.recalculateWithNewThresholds(threshold, negative_threshold)
                     .then(results => {
                         console.log("[VadAnalyzer] Recalculation finished after threshold change.");
                         // Results are stored in currentVadResults by the recalculate function
                         // Trigger an event maybe? Or rely on getResults?
                         // Let's rely on getResults for simplicity for now.
                     })
                     .catch(error => {
                         console.error("[VadAnalyzer] Recalculation after threshold change failed:", error);
                     });
             }
         },

        /**
         * Gets the latest VAD results.
         * @returns {object} The VAD results object { regions, stats }.
         */
        getResults() {
            return currentVadResults;
        },

         /** Releases the VAD model session. */
         async cleanup() {
             console.log("[VadAnalyzer] Cleanup requested.");
             if(wrapper) await wrapper.releaseSession();
             currentPcmData = null;
             currentVadResults = { regions: [], stats: { totalSpeechTime: 0 } };
             isInitialized = false;
             isAnalyzing = false;
             console.log("[VadAnalyzer] Cleanup complete.");
         }
    };
})();

// Attach to the global AudioApp namespace
if (typeof window.AudioApp === 'undefined') {
    window.AudioApp = {};
}
window.AudioApp.vadAnalyzer = vadAnalyzer;
console.log("VadAnalyzer module loaded.");

// /vibe-player/vad/vadAnalyzer.js
