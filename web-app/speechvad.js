// --- START OF FILE speechvad.js ---
const SpeechVAD = (function() {
  'use strict';

  let recognizer;
  const speechStatusEl = document.getElementById('speechStatus');

  async function init() {
    console.log("Initializing Speech VAD...");
    // Create a recognizer instance using the BROWSER_FFT option
    recognizer = speechCommands.create('BROWSER_FFT');
    await recognizer.ensureModelLoaded();
    const words = recognizer.wordLabels();
    console.log("Speech Commands labels:", words);

    // Start listening; the callback is invoked repeatedly.
    recognizer.listen(result => {
      const scores = result.scores;
      const maxScore = Math.max(...scores);
      const maxIndex = scores.indexOf(maxScore);
      const predictedWord = words[maxIndex];
      console.log("Detected:", predictedWord, "with score:", maxScore);

      // If the predicted label is not background noise and the confidence is high,
      // we consider that as speech being detected.
      if (predictedWord !== '_background_noise_' && maxScore > 0.75) {
        updateStatus("Speech Detected");
      } else {
        updateStatus("No Speech");
      }
    }, {
      probabilityThreshold: 0.75,
      includeSpectrogram: false,
      invokeCallbackOnNoiseAndUnknown: true,
      overlapFactor: 0.5
    });

    console.log("Speech VAD initialized.");
  }

  function updateStatus(status) {
    if (speechStatusEl) {
      speechStatusEl.textContent = status;
    }
  }

  function stop() {
    if (recognizer) {
      recognizer.stopListening();
      updateStatus("Stopped");
    }
  }

  return {
    init: init,
    stop: stop
  };
})();
// --- END OF FILE speechvad.js ---
