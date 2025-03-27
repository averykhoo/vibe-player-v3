// --- START OF FILE silero_vad.js ---
(function(global) {

  /**
   * Analyzes a 16kHz mono Float32Array for speech regions using Silero VAD.
   * Runs the ONNX model frame by frame and returns both the initial speech regions
   * (calculated using provided or default thresholds) and the raw probability
   * output for each frame, allowing for later recalculation with different thresholds.
   *
   * @param {Float32Array} pcmData - The 16kHz mono audio data. Must be Float32Array.
   * @param {number} sampleRate - The sample rate of pcmData. Must be 16000.
   * @param {object} [options] - Optional VAD parameters.
   * @param {number} [options.frameSamples=1536] - Samples per VAD frame (e.g., 1536 for ~96ms). Silero VAD examples often use smaller sizes like 480 (~30ms). Adjust based on model expectations if known.
   * @param {number} [options.positiveSpeechThreshold=0.5] - Probability threshold to start or continue speech.
   * @param {number} [options.negativeSpeechThreshold=0.35] - Probability threshold to consider stopping speech (must be below this). Default is positiveThreshold - 0.15.
   * @param {number} [options.redemptionFrames=7] - How many consecutive frames below negativeSpeechThreshold are needed to definitively end a speech segment.
   * @param {string} [options.modelPath="./model/silero_vad.onnx"] - Path to the ONNX model file.
   * @returns {Promise<object>} - A promise resolving to an object containing:
   *     - regions: Array<{start: number, end: number}> - Initial speech regions calculated using the thresholds.
   *     - probabilities: Float32Array - Raw probability output for each processed frame.
   *     - frameSamples: number - The frame size used.
   *     - sampleRate: number - The sample rate used (16000).
   *     - initialPositiveThreshold: number - The positive threshold used for the initial calculation.
   *     - initialNegativeThreshold: number - The negative threshold used for the initial calculation.
   *     - redemptionFrames: number - The redemption frames value used.
   * @throws {Error} - If the Silero VAD model cannot be loaded or run.
   */
  async function analyzeAudioAndGetProbs(pcmData, sampleRate, options = {}) {
    // --- Validate Input ---
    if (sampleRate !== 16000) {
      // This is a critical requirement for the pre-trained Silero model.
      console.error(`Silero VAD requires 16000 Hz audio, but received ${sampleRate} Hz. Analysis aborted. Ensure audio is resampled correctly.`);
      throw new Error("Silero VAD requires 16000 Hz audio.");
    }
    if (!(pcmData instanceof Float32Array)) {
        console.warn("VAD input data is not a Float32Array. Attempting conversion, but performance may be affected.");
        try {
            pcmData = new Float32Array(pcmData);
        } catch(e) {
            console.error("Failed to convert VAD input data to Float32Array.", e);
            throw new Error("VAD input data must be a Float32Array or convertible.");
        }
    }
    if (!pcmData || pcmData.length === 0) {
        console.log("VAD: No audio data provided to analyze.");
        return { // Return empty results structure
             regions: [], probabilities: new Float32Array(), frameSamples: options.frameSamples || 1536, sampleRate: sampleRate,
             initialPositiveThreshold: options.positiveSpeechThreshold || 0.5, initialNegativeThreshold: options.negativeSpeechThreshold || 0.35, redemptionFrames: options.redemptionFrames || 7
        };
    }

    // --- VAD Parameters ---
    // Determine frame size. Common Silero examples use 30ms (480 samples), 60ms (960), 90ms (1440).
    // The original SpeechDetector used 1536 (~96ms). Let's keep that as default unless overridden.
    const frameSamples = options.frameSamples || 1536;
    const positiveThreshold = options.positiveSpeechThreshold !== undefined ? options.positiveSpeechThreshold : 0.5;
    // Default negative threshold relative to positive, or use provided value.
    const negativeThreshold = options.negativeSpeechThreshold !== undefined ? options.negativeSpeechThreshold : (positiveThreshold - 0.15);
    const redemptionFrames = options.redemptionFrames !== undefined ? options.redemptionFrames : 7; // Can be tuned (e.g., 5-15)
    const modelPath = options.modelPath || "./model/silero_vad.onnx";
    // --- End Parameters ---


    // --- Load Silero Model ---
    let sileroInstance;
    try {
        // Create Silero instance (loads ONNX model, sets up session).
        sileroInstance = await global.Silero.create(sampleRate, modelPath); // Pass sampleRate (must be 16000)
    } catch (e) {
        console.error("Failed to create Silero VAD instance:", e);
        // Provide a more helpful error message to the user.
        throw new Error("Could not load the Silero VAD model. Ensure the model file exists at the specified path and onnxruntime-web is loaded correctly (including WASM files).");
    }
    // --- End Load Model ---


    // --- Process Audio Frames ---
    const allProbabilities = []; // Array to store raw probability for each frame.
    const initialRegions = [];   // Array to store speech regions calculated with initial thresholds.
    let inSpeech = false;        // State variable: currently detecting speech?
    let regionStart = 0.0;       // Start time of the current potential speech segment.
    let redemptionCounter = 0;   // Counter for consecutive non-speech frames below negative threshold.

    console.log(`VAD analyzing ${pcmData.length} samples with frame size ${frameSamples}...`);

    // Iterate through the audio data in non-overlapping frames.
    // The loop condition ensures we don't try to slice beyond the buffer length.
    for (let i = 0; i <= pcmData.length - frameSamples; i += frameSamples) {
      // Extract the current frame.
      const frame = pcmData.slice(i, i + frameSamples);

      // Run the Silero VAD model on the frame.
      const probability = await sileroInstance.process(frame);
      allProbabilities.push(probability); // Store the raw probability.

      // Calculate the time corresponding to the *start* and *end* of the current frame.
      const frameStartTime = i / sampleRate;
      const frameEndTime = (i + frameSamples) / sampleRate;

      // --- Apply VAD Logic (for initial region calculation) ---
      if (probability >= positiveThreshold) {
          // Frame is considered speech.
          if (!inSpeech) {
              // Start of a new speech segment.
              inSpeech = true;
              regionStart = frameStartTime; // Record start time.
          }
          // Reset redemption counter if we detect speech.
          redemptionCounter = 0;
      } else if (inSpeech) {
          // Frame is not considered speech, but we were previously in a speech segment.
          if (probability < negativeThreshold) {
              // Probability is below the negative threshold, increment redemption counter.
              redemptionCounter++;
              if (redemptionCounter >= redemptionFrames) {
                  // Redemption threshold met, finalize the speech segment.
                  // End time calculation: The speech effectively ended 'redemptionFrames' ago.
                  // The frame that triggered the end is index `i - redemptionFrames + 1`. End time is the START of that frame.
                  const triggerFrameIndex = i - redemptionFrames + 1;
                  const actualEnd = (triggerFrameIndex * frameSamples) / sampleRate;
                  // Ensure end time isn't before start time.
                  const finalEnd = Math.max(regionStart, actualEnd);

                  initialRegions.push({ start: regionStart, end: finalEnd });
                  inSpeech = false; // No longer in speech.
                  redemptionCounter = 0; // Reset counter.
              }
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
        const finalEnd = (allProbabilities.length * frameSamples) / sampleRate; // End is end of last processed frame
        initialRegions.push({ start: regionStart, end: finalEnd });
    }
    // --- End Process Audio Frames ---

    console.log(`Silero initially detected ${initialRegions.length} speech regions.`);

    // --- Return Results ---
    // Package the initial regions, raw probabilities, and parameters used.
    return {
        regions: initialRegions,
        probabilities: new Float32Array(allProbabilities), // Use TypedArray
        frameSamples: frameSamples,
        sampleRate: sampleRate,
        initialPositiveThreshold: positiveThreshold,
        initialNegativeThreshold: negativeThreshold,
        redemptionFrames: redemptionFrames
    };
  }

  // Expose the analysis function to the global scope (window).
  global.SileroVAD = {
    // Keep the original name or change if you prefer, e.g., analyzeAudioAndGetProbs
    analyzeAudio: analyzeAudioAndGetProbs
  };

})(window);
// --- END OF FILE silero_vad.js ---