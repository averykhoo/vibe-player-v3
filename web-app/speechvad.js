// --- START OF FILE speechvad.js ---
const SpeechVAD = (function() {
  'use strict';

  let recognizer = null;
  const probabilityThreshold = 0.75;
  const windowSizeSec = 1.0; // 1-second window
  const overlapFactor = 0.5; // 50% overlap => step size = 0.5 sec
  const stepSizeSec = windowSizeSec * (1 - overlapFactor); // 0.5 sec step
  const targetSampleRate = 16000;

  async function init() {
    console.log("Initializing Speech VAD (offline)...");
    recognizer = speechCommands.create('BROWSER_FFT');
    await recognizer.ensureModelLoaded();
    console.log("Speech Commands recognizer loaded.");
  }

  // Convert an AudioBuffer to a Float32Array at 16kHz (mono)
  async function convertAudioBufferToFloat32(audioBuffer) {
    const offlineCtx = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * targetSampleRate), targetSampleRate);
    const src = offlineCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(offlineCtx.destination);
    src.start();
    const renderedBuffer = await offlineCtx.startRendering();
    return renderedBuffer.getChannelData(0);
  }

  // Analyze an audio buffer and return an array of speech regions [{start, end}, ...] (in seconds).
  async function analyzeAudioBuffer(audioBuffer) {
    if (!recognizer) {
      await init();
    }
    console.log("Analyzing audio buffer for speech regions using TF.js VAD...");
    const floatData = await convertAudioBufferToFloat32(audioBuffer);
    const sampleRate = targetSampleRate;
    const windowSize = Math.floor(windowSizeSec * sampleRate); // e.g. 16000 samples
    const stepSize = Math.floor(stepSizeSec * sampleRate); // e.g. 8000 samples

    const regions = [];
    let currentSpeech = null;
    for (let startSample = 0; startSample + windowSize <= floatData.length; startSample += stepSize) {
      const windowData = floatData.slice(startSample, startSample + windowSize);
      // recognizer.recognize() accepts a Float32Array as input.
      const result = await recognizer.recognize(windowData, { probabilityThreshold, includeSpectrogram: false });
      const scores = result.scores;
      const maxScore = Math.max(...scores);
      const maxIndex = scores.indexOf(maxScore);
      const words = recognizer.wordLabels();
      const predictedWord = words[maxIndex];
      const timeSec = startSample / sampleRate;
      // Mark this window as speech if it’s not background noise and meets threshold.
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
    // Merge overlapping/adjacent regions.
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
