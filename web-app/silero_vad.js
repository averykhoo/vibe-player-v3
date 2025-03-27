// --- START OF FILE silero_vad.js ---
(function(global) {

  /**
   * Analyzes a 16kHz mono Float32Array for speech regions using Silero VAD.
   * @param {Float32Array} pcmData - The 16kHz mono audio data.
   * @param {number} sampleRate - Should be 16000.
   * @param {object} [options] - Optional VAD parameters.
   * @param {number} [options.frameSamples=1536] - Samples per VAD frame.
   * @param {number} [options.positiveSpeechThreshold=0.5] - Probability threshold to start speech.
   * @param {number} [options.negativeSpeechThreshold=0.35] - Probability threshold to end speech (below this).
   * @param {number} [options.redemptionFrames=15] - How many non-speech frames to wait before ending region.
   * @param {string} [options.modelPath="./model/silero_vad.onnx"] - Path to the ONNX model.
   * @returns {Promise<Array<{start: number, end: number}>>} - Array of speech regions in seconds.
   */
  async function analyzeAudio(pcmData, sampleRate, options = {}) {
    if (sampleRate !== 16000) {
      console.warn(`Silero VAD expects 16000 Hz audio, but received ${sampleRate} Hz. Results may be inaccurate if data wasn't resampled.`);
      // Proceed anyway, but the model's internal sample rate tensor is fixed at 16k
    }
    if (!pcmData || pcmData.length === 0) {
        console.log("VAD: No audio data to analyze.");
        return [];
    }

    // --- Default VAD Parameters ---
    const frameSamples = options.frameSamples || 1536; // ~30ms chunks often used (e.g., 480), 1536 is ~96ms
    const positiveThreshold = options.positiveSpeechThreshold !== undefined ? options.positiveSpeechThreshold : 0.5;
    const negativeThreshold = options.negativeSpeechThreshold !== undefined ? options.negativeSpeechThreshold : (positiveThreshold - 0.15); // Default like original speech_detector
    const redemptionFrames = options.redemptionFrames || 7; // Adjusted redemption frames (can be tuned)
    const modelPath = options.modelPath || "./model/silero_vad.onnx";
    // minSpeechFrames is implicitly handled by redemption logic now
    // --- End Parameters ---

    let sileroInstance;
    try {
        // Create Silero instance directly
        sileroInstance = await window.Silero.create(sampleRate, modelPath); // Pass sampleRate (should be 16000)
    } catch (e) {
        console.error("Failed to create Silero VAD instance:", e);
        throw new Error("Could not load the Silero VAD model. Ensure model file exists and onnxruntime is loaded.");
    }

    const speechRegions = [];
    let inSpeech = false;
    let regionStart = 0;
    let regionEnd = 0; // Tracks the end of the *last potential* speech frame
    let redemptionCounter = 0;

    console.log(`VAD analyzing ${pcmData.length} samples with frame size ${frameSamples}...`);

    // Process audio in non-overlapping frames
    for (let i = 0; i <= pcmData.length - frameSamples; i += frameSamples) {
      const frame = pcmData.slice(i, i + frameSamples);
      // Silero model expects Float32Array
      const probability = await sileroInstance.process(frame);
      const currentTime = (i + frameSamples) / sampleRate; // Time at the *end* of the current frame

      if (probability >= positiveThreshold) {
        if (!inSpeech) {
          inSpeech = true;
          regionStart = i / sampleRate; // Start time is beginning of this frame
          // console.log(`Speech Start @ ${regionStart.toFixed(2)}s (prob: ${probability.toFixed(2)})`);
        }
        regionEnd = currentTime; // Keep updating potential end time
        redemptionCounter = 0; // Reset redemption on positive frame
      } else if (inSpeech) {
         // Frame is not positive, but we were in speech
        if (probability < negativeThreshold) {
          redemptionCounter++;
          // console.log(`Redemption counter: ${redemptionCounter}/${redemptionFrames} @ ${currentTime.toFixed(2)}s (prob: ${probability.toFixed(2)})`);
          if (redemptionCounter >= redemptionFrames) {
            // End of speech detected after redemption period
            // The actual end was 'redemptionFrames' ago.
            const actualEnd = (i + frameSamples - (redemptionFrames * frameSamples)) / sampleRate;
            // Ensure end is not before start (can happen with very short segments + high redemption)
            const finalEnd = Math.max(regionStart, actualEnd);

            // console.log(`Speech End @ ${finalEnd.toFixed(2)}s`);
            speechRegions.push({ start: regionStart, end: finalEnd });
            inSpeech = false;
            redemptionCounter = 0;
          } else {
              // Still in redemption period, keep track of potential end time IF it gets redeemed
               // regionEnd = currentTime; // DON'T update regionEnd here, it marks the last *positive* frame implicitly
          }
        } else {
          // Probability is between negative and positive threshold - extend the speech region
          regionEnd = currentTime;
          redemptionCounter = 0; // Reset redemption if we are in the ambiguous zone
          // console.log(`Speech Extended @ ${currentTime.toFixed(2)}s (prob: ${probability.toFixed(2)})`);
        }
      }
      // If not inSpeech and probability < positiveThreshold, do nothing.
    }

    // Finalize region if still in speech at the end of the audio
    if (inSpeech) {
      console.log(`Finalizing speech region at end of audio (End @ ${regionEnd.toFixed(2)}s)`);
      speechRegions.push({ start: regionStart, end: regionEnd });
    }

    console.log(`Silero detected ${speechRegions.length} speech regions:`, speechRegions.map(r => `[${r.start.toFixed(2)}-${r.end.toFixed(2)}]`).join(' '));
    return speechRegions;
  }

  // Expose the simplified function
  global.SileroVAD = {
    analyzeAudio: analyzeAudio // Rename the exposed function for clarity
  };

})(window);
// --- END OF FILE silero_vad.js ---