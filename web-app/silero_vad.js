// --- START OF FILE silero_vad.js ---
(function(global) {
  async function analyzeAudioBuffer(audioBuffer) {
    // Create a SpeechDetector instance with default parameters.
    var detector = await window.SpeechDetector.create();
    var sampleRate = audioBuffer.sampleRate;
    // Get mono channel data (using the first channel)
    var channelData = audioBuffer.getChannelData(0);
    var frameSamples = detector.frameSamples;
    var speechRegions = [];
    var inSpeech = false;
    var regionStart = 0;
    var regionEnd = 0;
    var redemptionCounter = 0;
    var positiveThreshold = detector.positiveSpeechThreshold;
    var negativeThreshold = detector.negativeSpeechThreshold;

    // Process audio in non-overlapping frames.
    for (var i = 0; i < channelData.length; i += frameSamples) {
      var frame = channelData.slice(i, i + frameSamples);
      if (frame.length < frameSamples) break; // Skip incomplete frame at end.

      // Get the speech probability from the Silero model.
      var probability = await detector.silero.process(frame);

      if (probability > positiveThreshold) {
        if (!inSpeech) {
          inSpeech = true;
          regionStart = i / sampleRate;
        }
        redemptionCounter = 0;
        regionEnd = (i + frameSamples) / sampleRate;
      } else if (inSpeech) {
        // If below negative threshold, count redemption frames.
        if (probability < negativeThreshold) {
          redemptionCounter++;
          if (redemptionCounter >= detector.redemptionFrames) {
            // Finalize this speech region.
            speechRegions.push({ start: regionStart, end: regionEnd });
            inSpeech = false;
            redemptionCounter = 0;
          }
        } else {
          // If probability hovers between thresholds, continue speech.
          redemptionCounter = 0;
          regionEnd = (i + frameSamples) / sampleRate;
        }
      }
    }
    // Finalize region if still in speech.
    if (inSpeech) {
      speechRegions.push({ start: regionStart, end: regionEnd });
    }
    console.log("Silero detected speech regions:", speechRegions);
    return speechRegions;
  }

  global.SileroVAD = {
    analyzeAudioBuffer: analyzeAudioBuffer
  };
})(window);
// --- END OF FILE silero_vad.js ---
