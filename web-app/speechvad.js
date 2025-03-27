// --- START OF FILE speechvad.js ---
// This module performs voice activity detection (VAD) using the TensorFlow.js Speech Commands model.
// NOTE: The Speech Commands model is trained to recognize a small set of commands (e.g., "yes", "no", "up", "down").
//       Any audio not matching these commands is classified as "_background_noise_".
//       If your audio doesn't contain these specific commands, you'll likely see no detected speech regions.
const SpeechVAD = (function() {
  'use strict';

  let recognizer = null;
  const probabilityThreshold = 0.75;
  // Set window size to exactly 9976 samples (the expected input length for the model).
  const windowSizeSec = 9976 / 16000;  // ~0.6235 seconds
  const overlapFactor = 0.5; // 50% overlap between consecutive windows
  const stepSizeSec = windowSizeSec * (1 - overlapFactor);  // ~0.31175 seconds
  const targetSampleRate = 16000; // Ensure audio is mono at 16kHz

  // Initialize the Speech Commands recognizer.
  async function init() {
    console.log("Initializing Speech VAD (offline)...");
    recognizer = speechCommands.create('BROWSER_FFT');
    await recognizer.ensureModelLoaded();
    console.log("Speech Commands recognizer loaded.");
  }

  // Convert an AudioBuffer to a mono Float32Array at 16kHz.
  // Similar to resampling in Python, this function creates an OfflineAudioContext to do the conversion.
  async function convertAudioBufferToFloat32(audioBuffer) {
    const offlineCtx = new OfflineAudioContext(
      1,
      Math.ceil(audioBuffer.duration * targetSampleRate),
      targetSampleRate
    );
    const src = offlineCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(offlineCtx.destination);
    src.start();
    const renderedBuffer = await offlineCtx.startRendering();
    return renderedBuffer.getChannelData(0);
  }

  // Analyze an AudioBuffer and return an array of speech regions.
  // Each region is an object with 'start' and 'end' times (in seconds).
  async function analyzeAudioBuffer(audioBuffer) {
    if (!recognizer) {
      await init();
    }
    console.log("Analyzing audio buffer for speech regions using TF.js VAD...");
    const floatData = await convertAudioBufferToFloat32(audioBuffer);
    const sampleRate = targetSampleRate;
    // Calculate window size in samples; this should equal 9976.
    const windowSize = Math.floor(windowSizeSec * sampleRate);
    const stepSize = Math.floor(stepSizeSec * sampleRate);

    const regions = [];
    let currentSpeech = null;
    // Iterate over the audio data in fixed-size windows.
    for (let startSample = 0; startSample + windowSize <= floatData.length; startSample += stepSize) {
      const windowData = floatData.slice(startSample, startSample + windowSize);
      const result = await recognizer.recognize(windowData, { probabilityThreshold, includeSpectrogram: false });
      const scores = result.scores;
      const maxScore = Math.max(...scores);
      const maxIndex = scores.indexOf(maxScore);
      const words = recognizer.wordLabels();
      const predictedWord = words[maxIndex];

      // Debug: Uncomment the line below to see predictions for each window.
      console.log(`Window at ${(startSample/sampleRate).toFixed(2)}s: predicted="${predictedWord}", score=${maxScore.toFixed(3)}`);

      const timeSec = startSample / sampleRate;
      // Only consider this window as speech if the predicted word is not background noise.
      // IMPORTANT: The model only recognizes its limited vocabulary. If your audio doesn't contain these commands,
      //            it will be classified as '_background_noise_' even if someone is speaking.
      if (predictedWord !== '_background_noise_' && maxScore > probabilityThreshold) {
        if (!currentSpeech) {
          currentSpeech = { start: timeSec };
        }
      } else {
        if (currentSpeech) {
          currentSpeech.end = timeSec + windowSizeSec;
          regions.push(currentSpeech);
          currentSpeech = null;
        }
      }
    }
    if (currentSpeech) {
      currentSpeech.end = floatData.length / sampleRate;
      regions.push(currentSpeech);
    }
    // Merge overlapping or adjacent speech regions.
    const mergedRegions = [];
    for (const region of regions) {
      if (mergedRegions.length === 0) {
        mergedRegions.push(region);
      } else {
        const last = mergedRegions[mergedRegions.length - 1];
        if (region.start <= last.end) {
          last.end = Math.max(last.end, region.end);
        } else {
          mergedRegions.push(region);
        }
      }
    }
    console.log("Detected speech regions:", mergedRegions);
    return mergedRegions;
  }

  return {
    init: init,
    analyzeAudioBuffer: analyzeAudioBuffer
  };
})();
// --- END OF FILE speechvad.js ---
