// --- START OF FILE speech_detector.js ---
(function(global) {
  function SpeechDetector(silero, frameSamples, positiveSpeechThreshold, negativeSpeechThreshold, redemptionFrames, minSpeechFrames) {
    this.silero = silero;
    this.frameSamples = frameSamples;
    this.positiveSpeechThreshold = positiveSpeechThreshold;
    this.negativeSpeechThreshold = negativeSpeechThreshold;
    this.redemptionFrames = redemptionFrames;
    this.minSpeechFrames = minSpeechFrames;
    this.speechSegmentsStreamController = null;
    this.currentSpeechSegment = null;
    this.speaking = false;
    this.redemptionCounter = 0;
    this.speechFrameCount = 0;
    this.frameCount = 0;
  }

  SpeechDetector.create = async function(frameSamples, positiveSpeechThreshold, negativeSpeechThreshold, redemptionFrames, minSpeechFrames) {
    frameSamples = frameSamples || 1536;
    positiveSpeechThreshold = (positiveSpeechThreshold !== undefined) ? positiveSpeechThreshold : 0.5;
    negativeSpeechThreshold = (negativeSpeechThreshold !== undefined) ? negativeSpeechThreshold : 0.35;
    redemptionFrames = redemptionFrames || 15;
    minSpeechFrames = minSpeechFrames || 1;
    // Create a Silero instance (model expects 16000Hz PCM audio)
    var silero = await window.Silero.create(16000);
    return new SpeechDetector(silero, frameSamples, positiveSpeechThreshold, negativeSpeechThreshold, redemptionFrames, minSpeechFrames);
  };

  // (Streaming methods and additional processing can remain as originally written if needed.)

  global.SpeechDetector = SpeechDetector;
})(window);
// --- END OF FILE speech_detector.js ---
