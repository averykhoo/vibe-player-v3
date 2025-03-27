// --- START OF FILE player.js ---
const AudioPlayer = (function() {
  'use strict';

  /**
   * Converts an AudioBuffer to 16kHz mono Int16 PCM.
   */
  function convertAudioBufferToPCM16k(audioBuffer) {
    const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * 16000, 16000);
    const src = offlineCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(offlineCtx.destination);
    src.start();
    return offlineCtx.startRendering().then(rendered => {
      const float32 = rendered.getChannelData(0);
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        let s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      return int16;
    });
  }

  // =============================================
  // == MODULE SCOPE VARIABLES & CONFIGURATION ==
  // =============================================
  let fileInput, fileInfo, playPauseButton, jumpBackButton, jumpForwardButton,
      jumpTimeInput, playbackSpeedControl, speedValueDisplay, gainControl,
      gainValueDisplay, timeDisplay, waveformCanvas, spectrogramCanvas,
      spectrogramSpinner, waveformProgressBar, waveformProgressIndicator,
      spectrogramProgressBar, spectrogramProgressIndicator, audioEl,
      speechRegionsDisplay;

  let audioCtx = null;
  let gainNode = null;
  let mediaSource = null;
  let decodedBuffer = null;
  let isPlaying = false;
  const WAVEFORM_HEIGHT_SCALE = 0.8;
  const SPECTROGRAM_FFT_SIZE = 1024;
  const SPECTROGRAM_MAX_FREQ = 16000;
  const SPEC_FIXED_WIDTH = 2048;
  let cachedSpectrogramCanvas = null;
  let speechRegions = []; // Array to store detected speech regions

  // =============================================
  // == INITIALIZATION & SETUP ==
  // =============================================
  async function init() {
    console.log("AudioPlayer initializing...");
    assignDOMElements();
    setupEventListeners();
    setupAudioContext();
    resizeCanvases(); // Initial canvas size calculation
    window.addEventListener('resize', resizeCanvases); // Handle window resize
    console.log("AudioPlayer initialized.");
  }

  function assignDOMElements() {
    fileInput = document.getElementById('audioFile');
    fileInfo = document.getElementById('fileInfo');
    playPauseButton = document.getElementById('playPause');
    jumpBackButton = document.getElementById('jumpBack');
    jumpForwardButton = document.getElementById('jumpForward');
    jumpTimeInput = document.getElementById('jumpTime');
    playbackSpeedControl = document.getElementById('playbackSpeed');
    speedValueDisplay = document.getElementById('speedValue');
    gainControl = document.getElementById('gainControl');
    gainValueDisplay = document.getElementById('gainValue');
    timeDisplay = document.getElementById('timeDisplay');
    waveformCanvas = document.getElementById('waveformCanvas');
    spectrogramCanvas = document.getElementById('spectrogramCanvas');
    spectrogramSpinner = document.getElementById('spectrogramSpinner');
    waveformProgressBar = document.getElementById('waveformProgressBar');
    waveformProgressIndicator = document.getElementById('waveformProgressIndicator');
    spectrogramProgressBar = document.getElementById('spectrogramProgressBar');
    spectrogramProgressIndicator = document.getElementById('spectrogramProgressIndicator');
    audioEl = document.getElementById('player');
    speechRegionsDisplay = document.getElementById('speechRegionsDisplay');
  }

  function setupEventListeners() {
    fileInput.addEventListener('change', handleFileLoad);
    playPauseButton.addEventListener('click', togglePlayPause);
    jumpBackButton.addEventListener('click', () => jumpBy(-getJumpTime()));
    jumpForwardButton.addEventListener('click', () => jumpBy(getJumpTime()));
    playbackSpeedControl.addEventListener('input', handleSpeedChange);
    gainControl.addEventListener('input', handleGainChange);

    [waveformCanvas, spectrogramCanvas].forEach(canvas => {
         canvas.addEventListener('click', handleCanvasClick);
    });

    audioEl.addEventListener('play', () => { isPlaying = true; playPauseButton.textContent = 'Pause'; });
    audioEl.addEventListener('pause', () => { isPlaying = false; playPauseButton.textContent = 'Play'; });
    audioEl.addEventListener('ended', () => { isPlaying = false; playPauseButton.textContent = 'Play'; });
    audioEl.addEventListener('timeupdate', updateUI);
    audioEl.addEventListener('loadedmetadata', updateUI);
    audioEl.addEventListener('durationchange', updateUI);
    document.addEventListener('keydown', handleKeyDown);
  }

  function setupAudioContext() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        gainNode = audioCtx.createGain();
        gainNode.gain.value = parseFloat(gainControl.value);
        gainNode.connect(audioCtx.destination);
        console.log("AudioContext and GainNode created.");
      } catch (e) {
        console.error("Web Audio API is not supported by this browser.", e);
        alert("Web Audio API is not supported by this browser.");
      }
    }
  }

  function connectAudioElementSource() {
    if (!audioCtx || !audioEl.src || mediaSource) {
      return;
    }
    try {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      mediaSource = audioCtx.createMediaElementSource(audioEl);
      mediaSource.connect(gainNode);
      console.log("Audio element connected to Web Audio graph.");
    } catch (e) {
      console.error("Error connecting audio element source:", e);
    }
  }

  async function handleFileLoad(e) {
    const file = e.target.files[0];
    if (!file) return;

    console.log("File selected:", file.name);
    fileInfo.textContent = `File: ${file.name}`;
    decodedBuffer = null;
    resetUI();
    cachedSpectrogramCanvas = null;

    const objectURL = URL.createObjectURL(file);
    audioEl.src = objectURL;
    audioEl.load();

    connectAudioElementSource();

    if (fileInput) fileInput.blur();

    spectrogramSpinner.style.display = 'inline';
    waveformCanvas.getContext('2d').clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    spectrogramCanvas.getContext('2d').clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);

    try {
      const arrayBuffer = await file.arrayBuffer();
      console.log("Decoding audio data...");
      if (!audioCtx) setupAudioContext();
      if (!audioCtx) throw new Error("AudioContext could not be initialized.");

      decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      console.log(`Audio decoded: ${decodedBuffer.duration.toFixed(2)}s, ${decodedBuffer.sampleRate}Hz`);

      enableControls();

      // Use TF.js VAD (SpeechVAD) to analyze the decoded audio file
      speechRegions = await SpeechVAD.analyzeAudioBuffer(decodedBuffer);
      // Also display detected regions (for debugging)
      if (speechRegionsDisplay) {
        speechRegionsDisplay.textContent = JSON.stringify(speechRegions, null, 2);
      }

      computeAndDrawVisuals();
    } catch (err) {
      console.error('Error processing audio file:', err);
      fileInfo.textContent = `Error processing file: ${err.message || err}`;
      alert(`Could not process audio file: ${err.message || err}`);
      disableControls();
    } finally {
      spectrogramSpinner.style.display = 'none';
    }
  }

  function togglePlayPause() {
    if (!audioEl.src || audioEl.readyState < 1) return;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    if (audioEl.paused) {
      audioEl.play().catch(e => console.error("Error playing audio:", e));
    } else {
      audioEl.pause();
    }
  }

  function jumpBy(seconds) {
    if (!audioEl.src || isNaN(audioEl.duration)) return;
    seek(audioEl.currentTime + seconds);
  }

  function seek(time) {
    if (!audioEl.src || isNaN(audioEl.duration)) return;
    let newTime = Math.max(0, Math.min(time, audioEl.duration));
    audioEl.currentTime = newTime;
    console.log(`Seeked to ${formatTime(newTime)}`);
  }

  function handleCanvasClick(e) {
    if (!audioEl.src || isNaN(audioEl.duration) || audioEl.duration === 0) return;
    const canvas = e.target;
    const rect = canvas.getBoundingClientRect();
    const clickXRelative = e.clientX - rect.left;
    const fraction = clickXRelative / rect.width;
    const newTime = fraction * audioEl.duration;
    seek(newTime);
  }

  function handleSpeedChange() {
    const val = parseFloat(playbackSpeedControl.value);
    speedValueDisplay.textContent = val.toFixed(2) + "x";
    audioEl.playbackRate = val;
    audioEl.preservesPitch = true;
    audioEl.mozPreservesPitch = true;
  }

  function handleGainChange() {
    const val = parseFloat(gainControl.value);
    gainValueDisplay.textContent = val.toFixed(2) + "x";
    if (gainNode && audioCtx) {
      gainNode.gain.setValueAtTime(val, audioCtx.currentTime);
    }
  }

  function handleKeyDown(e) {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'number') return;
    if (!audioEl.src || isNaN(audioEl.duration)) return;
    let handled = false;
    switch (e.code) {
      case 'Space':
        if (e.target.tagName !== 'INPUT') {
          togglePlayPause();
          handled = true;
        }
        break;
      case 'ArrowLeft':
        jumpBy(-getJumpTime());
        handled = true;
        break;
      case 'ArrowRight':
        jumpBy(getJumpTime());
        handled = true;
        break;
    }
    if (handled) {
      e.preventDefault();
    }
  }

  function getJumpTime() {
    return parseFloat(jumpTimeInput.value) || 5;
  }

  function updateUI() {
    if (!audioEl.src || isNaN(audioEl.duration) || audioEl.duration === 0) {
      timeDisplay.textContent = "0:00 / 0:00";
      if (waveformProgressIndicator) waveformProgressIndicator.style.left = "0px";
      if (spectrogramProgressIndicator) spectrogramProgressIndicator.style.left = "0px";
      return;
    }
    const currentTime = audioEl.currentTime;
    const duration = audioEl.duration;
    const fraction = duration > 0 ? currentTime / duration : 0;
    timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    if (waveformProgressIndicator && waveformCanvas) {
      const waveformCanvasWidth = waveformCanvas.clientWidth;
      waveformProgressIndicator.style.left = (fraction * waveformCanvasWidth) + "px";
    }
    if (spectrogramProgressIndicator && spectrogramCanvas) {
      const spectrogramCanvasWidth = spectrogramCanvas.clientWidth;
      spectrogramProgressIndicator.style.left = (fraction * spectrogramCanvasWidth) + "px";
    }
  }

  function resetUI() {
    playPauseButton.textContent = 'Play';
    timeDisplay.textContent = "0:00 / 0:00";
    if (waveformProgressIndicator) waveformProgressIndicator.style.left = "0px";
    if (spectrogramProgressIndicator) spectrogramProgressIndicator.style.left = "0px";
    disableControls();
  }

  function enableControls() {
    playPauseButton.disabled = false;
    jumpBackButton.disabled = false;
    jumpForwardButton.disabled = false;
    playbackSpeedControl.disabled = false;
  }
  function disableControls() {
    playPauseButton.disabled = true;
    jumpBackButton.disabled = true;
    jumpForwardButton.disabled = true;
    playbackSpeedControl.disabled = true;
  }

  async function computeAndDrawVisuals() {
    if (!decodedBuffer) return;
    console.log("Computing visualizations...");
    console.time("Visualization Computation");
    resizeCanvases(false);
    const waveformWidth = waveformCanvas.width;
    console.time("Waveform compute");
    const waveformData = computeWaveformData(decodedBuffer, waveformWidth);
    console.timeEnd("Waveform compute");
    console.time("Waveform draw");
    // Draw waveform with speechRegions (color speech segments orange)
    drawWaveform(waveformData, waveformCanvas, speechRegions);
    console.timeEnd("Waveform draw");
    console.time("Spectrogram compute");
    const spectrogramData = computeSpectrogram(decodedBuffer, SPECTROGRAM_FFT_SIZE, SPEC_FIXED_WIDTH);
    console.timeEnd("Spectrogram compute");
    if (spectrogramData && spectrogramData.length > 0) {
      console.time("Spectrogram draw (async)");
      drawSpectrogramAsync(spectrogramData, spectrogramCanvas, decodedBuffer.sampleRate)
        .then(() => {
          console.timeEnd("Spectrogram draw (async)");
          updateUI();
        });
    } else {
      console.warn("Spectrogram computation yielded no data or failed.");
      const specCtx = spectrogramCanvas.getContext('2d');
      specCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
      specCtx.fillStyle = '#888';
      specCtx.textAlign = 'center';
      specCtx.fillText("Could not compute spectrogram", spectrogramCanvas.width / 2, spectrogramCanvas.height / 2);
    }
    console.timeEnd("Visualization Computation");
    updateUI();
  }

  // Modified: compute waveform data as before.
  function computeWaveformData(buffer, targetWidth) {
    if (!buffer || targetWidth <= 0) return [];
    const channelCount = buffer.numberOfChannels;
    const bufferLength = buffer.length;
    const sourceData = channelCount > 1 ? new Float32Array(bufferLength) : buffer.getChannelData(0);
    if (channelCount > 1) {
      for (let ch = 0; ch < channelCount; ch++) {
        const channelData = buffer.getChannelData(ch);
        for (let i = 0; i < channelData.length; i++) {
          sourceData[i] += channelData[i];
        }
      }
      for (let i = 0; i < bufferLength; i++) {
        sourceData[i] /= channelCount;
      }
    }
    const samplesPerPixel = Math.max(1, Math.floor(bufferLength / targetWidth));
    const waveform = [];
    for (let i = 0; i < targetWidth; i++) {
      const start = Math.floor(i * samplesPerPixel);
      const end = Math.min(start + samplesPerPixel, bufferLength);
      if (start >= end) {
        waveform.push({ min: 0, max: 0 });
        continue;
      }
      let min = 1.0, max = -1.0;
      for (let j = start; j < end; j++) {
        const sample = sourceData[j];
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
      waveform.push({ min, max });
    }
    return waveform;
  }

  // Modified: draw waveform using speechRegions.
  function drawWaveform(waveformData, canvas, speechRegions) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    if (!waveformData || waveformData.length === 0) {
      ctx.fillStyle = '#888';
      ctx.textAlign = 'center';
      ctx.fillText("No waveform data", width / 2, height / 2);
      return;
    }
    const dataLen = waveformData.length;
    const halfHeight = height / 2;
    const scale = halfHeight * WAVEFORM_HEIGHT_SCALE;
    const pixelsPerSample = width / dataLen;
    for (let i = 0; i < dataLen; i++) {
      const x = i * pixelsPerSample;
      const time = (i / dataLen) * audioEl.duration;
      const inSpeech = speechRegions && speechRegions.some(r => time >= r.start && time <= r.end);
      ctx.fillStyle = inSpeech ? 'orange' : '#3455db';
      const min = waveformData[i].min, max = waveformData[i].max;
      const y1 = halfHeight - max * scale;
      const y2 = halfHeight - min * scale;
      ctx.fillRect(x, y1, pixelsPerSample, y2 - y1);
    }
  }

  function computeSpectrogram(buffer, fftSize, _targetSlices) {
    if (typeof FFT === 'undefined') {
      console.error("FFT constructor not found! Make sure fft.js is loaded before player.js.");
      return null;
    }
    if (!buffer) {
      console.error("Cannot compute spectrogram without an AudioBuffer.");
      return null;
    }
    if ((fftSize & (fftSize - 1)) !== 0 || fftSize <= 1) {
      console.error(`Invalid FFT size: ${fftSize}. Must be a power of two > 1.`);
      return null;
    }
    const targetSlices = SPEC_FIXED_WIDTH;
    const channelData = buffer.getChannelData(0);
    const totalSamples = channelData.length;
    const hopSize = Math.max(1, Math.floor(fftSize / 4));
    const rawSliceCount = totalSamples < fftSize
      ? 0
      : Math.floor((totalSamples - fftSize) / hopSize) + 1;
    if (rawSliceCount <= 0) {
      console.warn("Not enough audio samples for the chosen FFT size and hop size.");
      return [];
    }
    console.log(`Spectrogram: fftSize=${fftSize}, rawSliceCount=${rawSliceCount}, hopSize=${hopSize}`);
    const fftInstance = new FFT(fftSize);
    const complexBuffer = fftInstance.createComplexArray();
    const windowFunc = hannWindow(fftSize);
    if (!windowFunc || windowFunc.length !== fftSize) {
      console.error('Failed to generate Hann window!');
      return null;
    }
    const rawSpec = [];
    for (let i = 0; i < rawSliceCount; i++) {
      const start = i * hopSize;
      const fftInput = new Array(fftSize);
      for (let j = 0; j < fftSize; j++) {
        const sample = (start + j < totalSamples) ? channelData[start + j] : 0;
        fftInput[j] = sample * windowFunc[j];
      }
      fftInstance.realTransform(complexBuffer, fftInput);
      const magnitudes = new Float32Array(fftSize / 2);
      for (let k = 0; k < fftSize / 2; k++) {
        const re = complexBuffer[k * 2];
        const im = complexBuffer[k * 2 + 1];
        const magSq = (re * re + im * im);
        magnitudes[k] = Math.sqrt(magSq > 0 ? magSq : 0);
      }
      rawSpec.push(magnitudes);
    }
    const finalSpec = new Array(targetSlices);
    const rawCount = rawSpec.length;
    if (rawCount === targetSlices) {
      for (let i = 0; i < rawCount; i++) {
        finalSpec[i] = rawSpec[i];
      }
    } else {
      for (let i = 0; i < targetSlices; i++) {
        const t = (targetSlices > 1)
          ? (i / (targetSlices - 1))
          : 0;
        const rawPos = t * (rawCount - 1);
        const nearest = Math.round(rawPos);
        finalSpec[i] = new Float32Array(rawSpec[nearest]);
      }
    }
    return finalSpec;
  }

  function hannWindow(length) {
    if (length <= 0) return [];
    let windowArr = new Array(length);
    if (length === 1) return [1];
    const denom = length - 1;
    for (let i = 0; i < length; i++) {
      windowArr[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
    }
    return windowArr;
  }

  function drawSpectrogramAsync(spectrogramData, canvas, sampleRate) {
    return new Promise(resolve => {
      const displayCtx = canvas.getContext('2d');
      displayCtx.clearRect(0, 0, canvas.width, canvas.height);
      const offscreen = document.createElement('canvas');
      offscreen.width = SPEC_FIXED_WIDTH;
      offscreen.height = canvas.height;
      const offCtx = offscreen.getContext('2d');
      const computedSlices = spectrogramData.length;
      const sliceWidth = offscreen.width / computedSlices;
      const height = offscreen.height;
      const numBins = spectrogramData[0].length;
      const nyquist = sampleRate / 2;
      const maxBinIndex = Math.min(
        numBins - 1,
        Math.floor((SPECTROGRAM_MAX_FREQ / nyquist) * numBins)
      );
      const dbThreshold = -60;
      let maxDb = -100;
      for (let i = 0; i < computedSlices; i++) {
        const magnitudes = spectrogramData[i];
        for (let j = 0; j <= maxBinIndex; j++) {
          const db = 20 * Math.log10(magnitudes[j] + 1e-9);
          const clampedDb = Math.max(dbThreshold, db);
          if (clampedDb > maxDb) maxDb = clampedDb;
        }
      }
      const minDb = dbThreshold;
      const dbRange = Math.max(1, maxDb - minDb);
      console.log(`Spectrogram dB range: ${minDb.toFixed(1)} dB to ${maxDb.toFixed(1)} dB`);
      const fullImageData = offCtx.createImageData(offscreen.width, height);
      const data = fullImageData.data;
      function viridisColor(t) {
        const colors = [
          { t: 0.0, r: 68, g: 1, b: 84 }, { t: 0.1, r: 72, g: 40, b: 120 },
          { t: 0.2, r: 62, g: 74, b: 137 }, { t: 0.3, r: 49, g: 104, b: 142 },
          { t: 0.4, r: 38, g: 130, b: 142 }, { t: 0.5, r: 31, g: 155, b: 137 },
          { t: 0.6, r: 53, g: 178, b: 126 }, { t: 0.7, r: 109, g: 199, b: 104 },
          { t: 0.8, r: 170, g: 217, b: 70 }, { t: 0.9, r: 235, g: 231, b: 35 },
          { t: 1.0, r: 253, g: 231, b: 37 }
        ];
        t = Math.max(0, Math.min(1, t));
        let c1 = colors[0];
        let c2 = colors[colors.length - 1];
        for (let i = 0; i < colors.length - 1; i++) {
          if (t >= colors[i].t && t <= colors[i+1].t) {
            c1 = colors[i];
            c2 = colors[i+1];
            break;
          }
        }
        const range = c2.t - c1.t;
        const ratio = (range === 0) ? 0 : (t - c1.t) / range;
        const r = Math.round(c1.r + ratio * (c2.r - c1.r));
        const g = Math.round(c1.g + ratio * (c2.g - c1.g));
        const b = Math.round(c1.b + ratio * (c2.b - c1.b));
        return [r, g, b];
      }
      let currentSlice = 0;
      const chunkSize = 32;
      function drawChunk() {
        const startSlice = currentSlice;
        for (; currentSlice < startSlice + chunkSize && currentSlice < computedSlices; currentSlice++) {
          const x = currentSlice * sliceWidth;
          const magnitudes = spectrogramData[currentSlice];
          for (let y = 0; y < height; y++) {
            const freqRatio = (height - 1 - y) / (height - 1);
            const logFreqRatio = Math.pow(freqRatio, 2.5);
            const binIndex = Math.min(maxBinIndex, Math.floor(logFreqRatio * maxBinIndex));
            const magnitude = magnitudes[binIndex] || 0;
            const db = 20 * Math.log10(magnitude + 1e-9);
            const clampedDb = Math.max(minDb, db);
            const normValue = (clampedDb - minDb) / dbRange;
            const [r, g, b] = viridisColor(normValue);
            const idx = (Math.floor(x) + y * offscreen.width) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
          }
        }
        offCtx.putImageData(fullImageData, 0, 0);
        if (spectrogramProgressIndicator) {
          const canvasWidth = canvas.clientWidth;
          spectrogramProgressIndicator.style.left = (currentSlice / computedSlices * canvasWidth) + "px";
        }
        if (currentSlice < computedSlices) {
          requestAnimationFrame(drawChunk);
        } else {
          cachedSpectrogramCanvas = offscreen;
          displayCtx.clearRect(0, 0, canvas.width, canvas.height);
          displayCtx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
          if (spectrogramSpinner) spectrogramSpinner.style.display = 'none';
          resolve();
        }
      }
      drawChunk();
    });
  }

  async function resizeCanvases(redraw = true) {
    let resized = false;
    [waveformCanvas, spectrogramCanvas].forEach(canvas => {
      if (!canvas) return;
      const { width, height } = canvas.getBoundingClientRect();
      const roundedWidth = Math.max(10, Math.round(width));
      const roundedHeight = Math.max(10, Math.round(height));
      if (canvas.width !== roundedWidth || canvas.height !== roundedHeight) {
        canvas.width = roundedWidth;
        canvas.height = roundedHeight;
        console.log(`Resized ${canvas.id} to ${canvas.width}x${canvas.height}`);
        resized = true;
      }
    });
    if (decodedBuffer && resized && redraw) {
      const waveformData = computeWaveformData(decodedBuffer, waveformCanvas.width);
      drawWaveform(waveformData, waveformCanvas, speechRegions);
      if (cachedSpectrogramCanvas && spectrogramCanvas) {
        const specCtx = spectrogramCanvas.getContext('2d');
        specCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
        specCtx.drawImage(cachedSpectrogramCanvas, 0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
      } else {
        computeAndDrawVisuals();
      }
    } else if (resized) {
      updateUI();
    }
  }

  function formatTime(sec) {
    if (isNaN(sec) || sec < 0) sec = 0;
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
  }

  return {
    init: init
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  AudioPlayer.init().catch(console.error);
});
// --- END OF FILE player.js ---
