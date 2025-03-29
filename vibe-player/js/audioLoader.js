// /vibe-player/js/audioLoader.js

/**
 * Handles audio file loading, decoding, and triggers VAD analysis.
 * Dispatches 'audioapp:audioReady' event when complete.
 */
const audioLoader = (() => {
    // --- Private Module State ---
    let audioContext = null;
    let config = null;
    let vadAnalyzer = null; // Reference to AudioApp.vadAnalyzer
    let uiManager = null; // Reference to AudioApp.uiManager

    let originalAudioBuffer = null;
    let vadResults = null;
    let isProcessing = false;

    // --- Private Methods ---

    /**
     * Resamples audio data to the target sample rate using OfflineAudioContext.
     * @param {AudioBuffer} audioBuffer Buffer to resample.
     * @param {number} targetSampleRate Target sample rate (e.g., 16000 for VAD).
     * @returns {Promise<AudioBuffer>} Resampled AudioBuffer.
     */
    async function resampleAudioBuffer(audioBuffer, targetSampleRate) {
        const currentSampleRate = audioBuffer.sampleRate;
        if (currentSampleRate === targetSampleRate) {
            console.log("[AudioLoader] No resampling needed.");
            return audioBuffer;
        }
        console.log(`[AudioLoader] Resampling from ${currentSampleRate}Hz to ${targetSampleRate}Hz...`);
        const duration = audioBuffer.duration;
        const numChannels = audioBuffer.numberOfChannels; // Keep original channel count for resampling context

        // Use OfflineAudioContext for high-quality resampling
        const offlineCtx = new OfflineAudioContext(numChannels, duration * targetSampleRate, targetSampleRate);
        const bufferSource = offlineCtx.createBufferSource();
        bufferSource.buffer = audioBuffer;
        bufferSource.connect(offlineCtx.destination);
        bufferSource.start();

        try {
            const resampledBuffer = await offlineCtx.startRendering();
            console.log("[AudioLoader] Resampling complete.");
            return resampledBuffer;
        } catch (error) {
            console.error("[AudioLoader] Resampling failed:", error);
            throw new Error(`Failed to resample audio: ${error.message}`);
        }
    }

    /**
     * Converts a multi-channel AudioBuffer to a single-channel Float32Array (mono).
     * Averages channels if more than one exists.
     * @param {AudioBuffer} audioBuffer The input AudioBuffer.
     * @returns {Float32Array} Mono audio data.
     */
    function convertToMono(audioBuffer) {
        if (audioBuffer.numberOfChannels === 1) {
            // Already mono, just return a copy of the channel data
             return audioBuffer.getChannelData(0).slice();
        } else {
            console.log(`[AudioLoader] Converting ${audioBuffer.numberOfChannels} channels to mono...`);
            const numSamples = audioBuffer.length;
            const monoData = new Float32Array(numSamples);
            const channels = [];
            for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
                channels.push(audioBuffer.getChannelData(i));
            }

            for (let i = 0; i < numSamples; i++) {
                let sum = 0;
                for (let j = 0; j < audioBuffer.numberOfChannels; j++) {
                    sum += channels[j][i];
                }
                monoData[i] = sum / audioBuffer.numberOfChannels;
            }
            console.log("[AudioLoader] Mono conversion complete.");
            return monoData;
        }
    }

    /**
     * Handles the file selection event from the UI.
     * @param {CustomEvent} event Event containing the selected file.
     */
    async function handleFileSelected(event) {
        if (isProcessing) {
            console.warn("[AudioLoader] Already processing a file.");
             uiManager?.showError("Already processing a file. Please wait.");
            return;
        }
        if (!event.detail || !event.detail.file) {
            console.error("[AudioLoader] Invalid file selected event detail.");
            return;
        }

        const file = event.detail.file;
        console.log(`[AudioLoader] File selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
        isProcessing = true;
        originalAudioBuffer = null;
        vadResults = null;

        // --- Update UI ---
        uiManager?.setFileInfo(`Loading: ${file.name}`);
        uiManager?.showLoading(true, 'Decoding...'); // Show spinner

        try {
            // 1. Read File
            const arrayBuffer = await file.arrayBuffer();
            console.log("[AudioLoader] File read into ArrayBuffer.");

             // Ensure AudioContext is running (might be suspended initially)
             if (audioContext.state === 'suspended') {
                 console.log("[AudioLoader] Resuming AudioContext...");
                 await audioContext.resume();
                 console.log("[AudioLoader] AudioContext Resumed. State:", audioContext.state);
             }
             if (audioContext.state !== 'running') {
                 throw new Error(`AudioContext is not running (state: ${audioContext.state}). Cannot decode.`);
             }

            // 2. Decode Audio Data
            console.log("[AudioLoader] Decoding audio data...");
            originalAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            if (!originalAudioBuffer || originalAudioBuffer.length === 0) {
                throw new Error("Decoded audio buffer is invalid or empty.");
            }
            const duration = originalAudioBuffer.duration;
            console.log(`[AudioLoader] Audio decoded. Duration: ${duration.toFixed(2)}s, SR: ${originalAudioBuffer.sampleRate}Hz, Channels: ${originalAudioBuffer.numberOfChannels}`);
            uiManager?.setFileInfo(`File: ${file.name} (${duration.toFixed(2)}s)`);
            uiManager?.showLoading(true, 'Analyzing VAD...');

            // 3. Perform VAD Analysis (Offline)
            console.log("[AudioLoader] Starting VAD analysis...");
            // a. Resample to VAD model's expected sample rate (e.g., 16kHz)
            const vadTargetSampleRate = config?.vad?.sampleRate || 16000;
            const resampledBuffer = await resampleAudioBuffer(originalAudioBuffer, vadTargetSampleRate);

            // b. Convert to Mono Float32Array
            const monoPcm16k = convertToMono(resampledBuffer);
            if (!monoPcm16k || monoPcm16k.length === 0) {
                 throw new Error("Failed to convert resampled audio to mono for VAD.");
             }

            // c. Ensure VAD Analyzer's wrapper is potentially ready (session created on demand)
            // We don't need to re-initialize vadAnalyzer itself here.
            // Its analyze() method will handle creating the session via the wrapper if needed.
            if (!vadAnalyzer) { // Check if the analyzer instance exists (it should)
                 throw new Error("VAD Analyzer instance is missing in audioLoader.");
            }
            // Optional: Check wrapper readiness if needed, but analyze() handles it
            // if (!vadAnalyzer.isReady()) {
            //     console.log("[AudioLoader] VAD model session not yet created (will happen on first analyze call).");
            // }
            // user note: this was removed because it caused a bug
            //  // c. Ensure VAD Analyzer is ready (model loaded etc.)
            //  if (!vadAnalyzer || !vadAnalyzer.isReady()) {
            //       console.log("[AudioLoader] VAD Analyzer not ready, attempting to initialize...");
            //       const vadInitialized = await vadAnalyzer.init(config.vad); // Assume init returns promise/boolean
            //       if (!vadInitialized) {
            //            throw new Error("Failed to initialize VAD Analyzer.");
            //       }
            //       console.log("[AudioLoader] VAD Analyzer initialized.");
            //  }

            // d. Run VAD analysis
            console.time("VAD Analysis Duration");
            vadResults = await vadAnalyzer.analyze(monoPcm16k);
            console.timeEnd("VAD Analysis Duration");
            console.log("[AudioLoader] VAD analysis complete.", vadResults);
            uiManager?.updateVadDisplay(vadResults); // Update VAD text display immediately

            // 4. Dispatch Audio Ready Event
             console.log("[AudioLoader] Dispatching audioapp:audioReady event.");
             document.dispatchEvent(new CustomEvent('audioapp:audioReady', {
                 detail: {
                     buffer: originalAudioBuffer, // Pass the original buffer
                     vad: vadResults            // Pass the analysis results
                 }
             }));
            // WorkletManager and Visualizer will listen for this.

            uiManager?.showLoading(false); // Hide spinner

        } catch (error) {
            console.error("[AudioLoader] Error processing file:", error);
            uiManager?.showError(`Error loading file: ${error.message}`);
            uiManager?.setFileInfo("Failed to load file.");
            uiManager?.showLoading(false);
            originalAudioBuffer = null; // Clear buffer on error
            vadResults = null;
        } finally {
            isProcessing = false;
        }
    }

    // --- Public API ---
    return {
        /**
         * Initializes the AudioLoader.
         * @param {AudioContext} ctx The main AudioContext.
         * @param {AudioAppConfig} appConfig The application configuration.
         * @param {object} analyzerInstance Instance of VAD Analyzer.
         * @param {object} uiInstance Instance of UI Manager.
         */
        init(ctx, appConfig, analyzerInstance, uiInstance) {
            if (!ctx || !appConfig || !analyzerInstance || !uiInstance) {
                throw new Error("AudioLoader init requires AudioContext, Config, VAD Analyzer, and UI Manager instances.");
            }
            audioContext = ctx;
            config = appConfig;
            vadAnalyzer = analyzerInstance;
            uiManager = uiInstance;

            // Listen for the file selection event from the UI Manager
            document.addEventListener('audioapp:fileSelected', handleFileSelected);

            console.log("[AudioLoader] Initialized and listening for file selection.");
        },

        /**
         * Gets the most recently loaded original AudioBuffer.
         * @returns {AudioBuffer | null}
         */
        getOriginalBuffer() {
            return originalAudioBuffer;
        },

        /**
         * Gets the most recent VAD analysis results.
         * @returns {object | null} Object containing { regions, stats } or null.
         */
        getVadResults() {
            return vadResults;
        }
    };
})();

// Attach to the global AudioApp namespace
if (typeof window.AudioApp === 'undefined') {
    window.AudioApp = {};
}
window.AudioApp.audioLoader = audioLoader;
console.log("AudioLoader module loaded.");

// /vibe-player/js/audioLoader.js
