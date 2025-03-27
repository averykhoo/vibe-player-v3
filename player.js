// --- START OF FILE player.js ---

// Wrap everything in an IIFE to avoid polluting the global scope.
const AudioPlayer = (function() {
  'use strict';

  // =============================================
  // == MODULE SCOPE VARIABLES & CONFIGURATION ==
  // =============================================

  // --- DOM Element References ---
  let fileInput, fileInfo, playPauseButton, jumpBackButton, jumpForwardButton,
      jumpTimeInput, playbackSpeedControl, speedValueDisplay, gainControl,
      gainValueDisplay, timeDisplay, waveformCanvas, spectrogramCanvas,
      spectrogramSpinner, waveformProgressBar, waveformProgressIndicator,
      spectrogramProgressBar, spectrogramProgressIndicator, audioEl;

  // --- Web Audio API State ---
  let audioCtx = null;
  let gainNode = null;
  let mediaSource = null; // Source node for the <audio> element

  // --- Playback State & Data ---
  let decodedBuffer = null; // Stores the full audio buffer for visualization
  let isPlaying = false; // Simple flag, mirrors audioEl.paused roughly

  // --- Visualization Constants ---
  const WAVEFORM_HEIGHT_SCALE = 0.8; // Proportion of canvas height used for waveform
  const SPECTROGRAM_FFT_SIZE = 1024; // Must be power of 2 (affects frequency resolution)
  const SPECTROGRAM_MAX_FREQ = 16000; // Maximum frequency (Hz) to display

  // Cached offscreen spectrogram image to avoid re-computation on resize
  let cachedSpectrogramCanvas = null;

  // =============================================
  // == INITIALIZATION & SETUP ==
  // =============================================

  /**
   * Initializes the audio player: grabs DOM elements, sets up event listeners,
   * initializes the AudioContext, and sets canvas sizes.
   */
  function init() {
    console.log("AudioPlayer initializing...");
    assignDOMElements();
    setupEventListeners();
    setupAudioContext(); // Create AudioContext and GainNode early
    resizeCanvases();    // Set initial canvas sizes
    window.addEventListener('resize', resizeCanvases);
    console.log("AudioPlayer initialized.");
  }

  /**
   * Gets references to all necessary DOM elements.
   */
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
  }

  /**
   * Sets up event listeners for UI controls, file input, audio element, and keyboard shortcuts.
   */
  function setupEventListeners() {
    fileInput.addEventListener('change', handleFileLoad);
    playPauseButton.addEventListener('click', togglePlayPause);
    jumpBackButton.addEventListener('click', () => jumpBy(-getJumpTime()));
    jumpForwardButton.addEventListener('click', () => jumpBy(getJumpTime()));
    playbackSpeedControl.addEventListener('input', handleSpeedChange);
    gainControl.addEventListener('input', handleGainChange);

    // Enable seeking via clicks on the canvases
    [waveformCanvas, spectrogramCanvas].forEach(canvas => {
      canvas.addEventListener('click', handleCanvasClick);
    });

    // Audio element event listeners
    audioEl.addEventListener('play', () => { isPlaying = true; playPauseButton.textContent = 'Pause'; });
    audioEl.addEventListener('pause', () => { isPlaying = false; playPauseButton.textContent = 'Play'; });
    audioEl.addEventListener('ended', () => { isPlaying = false; playPauseButton.textContent = 'Play'; });
    audioEl.addEventListener('timeupdate', updateUI);
    audioEl.addEventListener('loadedmetadata', updateUI);
    audioEl.addEventListener('durationchange', updateUI);

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyDown);
  }

  /**
   * Initializes the AudioContext and GainNode (if not already initialized).
   */
  function setupAudioContext() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        gainNode = audioCtx.createGain();
        // Use the current gainControl value (range 1 to 5)
        gainNode.gain.value = parseFloat(gainControl.value);
        gainNode.connect(audioCtx.destination);
        console.log("AudioContext and GainNode created.");
      } catch (e) {
        console.error("Web Audio API is not supported by this browser.", e);
        alert("Web Audio API is not supported by this browser.");
      }
    }
  }

  /**
   * Connects the audio element to the Web Audio graph (audio element -> GainNode -> destination).
   */
  function connectAudioElementSource() {
    if (!audioCtx || !audioEl.src || mediaSource) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      mediaSource = audioCtx.createMediaElementSource(audioEl);
      mediaSource.connect(gainNode);
      console.log("Audio element connected to Web Audio graph.");
    } catch (e) {
      console.error("Error connecting audio element source:", e);
    }
  }

  // =============================================
  // == FILE LOADING & PROCESSING ==
  // =============================================

  /**
   * Handles the file input change event: loads the file, decodes audio data,
   * and triggers visualization computation and drawing.
   */
  async function handleFileLoad(e) {
    const file = e.target.files[0];
    if (!file) return;

    console.log("File selected:", file.name);
    fileInfo.textContent = `File: ${file.name}`;
    decodedBuffer = null;
    resetUI();
    cachedSpectrogramCanvas = null; // Clear any previous spectrogram cache

    // Set up the <audio> element for playback
    const objectURL = URL.createObjectURL(file);
    audioEl.src = objectURL;
    audioEl.load();
    connectAudioElementSource();

    // Remove focus from file input (prevents spacebar re-trigger)
    if (fileInput) fileInput.blur();

    // Show spinner and clear canvases
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

  // =============================================
  // == PLAYBACK CONTROLS ==
  // =============================================

  function togglePlayPause() {
    if (!audioEl.src || audioEl.readyState < 1) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

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
    const rect = e.target.getBoundingClientRect();
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

  /**
   * Handles gain (volume) changes.
   * Note: This controls playback volume within the browser only and cannot affect OS volume.
   */
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
    if (handled) e.preventDefault();
  }

  function getJumpTime() {
    return parseFloat(jumpTimeInput.value) || 5;
  }

  // =============================================
  // == UI UPDATE & STATE MANAGEMENT ==
  // =============================================

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
    // Gain control remains enabled always.
  }

  function disableControls() {
    playPauseButton.disabled = true;
    jumpBackButton.disabled = true;
    jumpForwardButton.disabled = true;
    playbackSpeedControl.disabled = true;
  }

  // =============================================
  // == VISUALIZATION COMPUTATION & DRAWING ==
  // =============================================

  /**
   * Orchestrates computing and drawing both waveform and spectrogram.
   * Waveform is computed and rendered synchronously.
   * Spectrogram drawing is performed asynchronously in chunks and cached.
   */
  function computeAndDrawVisuals() {
    if (!decodedBuffer) return;
    console.log("Computing visualizations...");
    console.time("Visualization Computation");

    // Ensure canvases are properly sized
    resizeCanvases(false);

    const waveformWidth = waveformCanvas.width;
    const spectrogramWidth = spectrogramCanvas.width;

    // --- Waveform ---
    console.time("Waveform compute");
    const waveformData = computeWaveformData(decodedBuffer, waveformWidth);
    console.timeEnd("Waveform compute");
    console.time("Waveform draw");
    drawWaveform(waveformData, waveformCanvas);
    console.timeEnd("Waveform draw");

    // --- Spectrogram ---
    console.time("Spectrogram compute");
    const spectrogramData = computeSpectrogram(decodedBuffer, SPECTROGRAM_FFT_SIZE, spectrogramWidth);
    console.timeEnd("Spectrogram compute");

    if (spectrogramData && spectrogramData.length > 0) {
      console.time("Spectrogram draw (async)");
      // Show spinner during async drawing
      spectrogramSpinner.style.display = 'inline';
      drawSpectrogramAsync(spectrogramData, spectrogramCanvas, decodedBuffer.sampleRate)
        .then(() => {
          console.timeEnd("Spectrogram draw (async)");
          updateUI();
        });
    } else {
      console.warn("Spectrogram computation yielded no data.");
      const specCtx = spectrogramCanvas.getContext('2d');
      specCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
      specCtx.fillStyle = '#888';
      specCtx.textAlign = 'center';
      specCtx.fillText("Could not compute spectrogram", spectrogramCanvas.width / 2, spectrogramCanvas.height / 2);
    }
    console.timeEnd("Visualization Computation");
  }

  /**
   * Computes waveform data as an array of {min, max} pairs.
   */
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

  /**
   * Draws waveform data onto the provided canvas.
   */
  function drawWaveform(waveformData, canvas) {
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
    ctx.beginPath();
    ctx.moveTo(0, halfHeight - waveformData[0].max * scale);
    for (let i = 1; i < dataLen; i++) {
      const x = (i / (dataLen - 1)) * width;
      const y = halfHeight - waveformData[i].max * scale;
      ctx.lineTo(x, y);
    }
    for (let i = dataLen - 1; i >= 0; i--) {
      const x = (i / (dataLen - 1)) * width;
      const y = halfHeight - waveformData[i].min * scale;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#3455db';
    ctx.fill();
  }

  /**
   * Computes spectrogram data using the provided FFT.
   * Returns an array of Float32Array (one per time slice).
   */
  function computeSpectrogram(buffer, fftSize, targetSlices) {
    if (typeof FFT === 'undefined') {
      console.error("FFT constructor not found! Ensure fft.js is loaded.");
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
    targetSlices = Math.max(1, Math.floor(targetSlices));
    const channelData = buffer.getChannelData(0);
    const totalSamples = channelData.length;
    const hopSize = Math.max(1, Math.floor(fftSize / 4));
    const actualSlices = totalSamples < fftSize ? 0 : Math.floor((totalSamples - fftSize) / hopSize) + 1;
    if (actualSlices <= 0) {
      console.warn("Not enough audio samples for the chosen FFT size and hop size.");
      return [];
    }
    console.log(`Spectrogram: fftSize=${fftSize}, targetSlices(requested)=${targetSlices}, hopSize=${hopSize}, actualSlices(computed)=${actualSlices}`);

    const fftInstance = new FFT(fftSize);
    const complexBuffer = fftInstance.createComplexArray();
    const windowFunc = hannWindow(fftSize);
    if (!windowFunc || windowFunc.length !== fftSize) {
      console.error('Failed to generate Hann window!');
      return null;
    }
    const spec = [];
    for (let i = 0; i < actualSlices; i++) {
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
      spec.push(magnitudes);
    }
    return spec;
  }

  /**
   * Asynchronously draws the spectrogram on an offscreen canvas in chunks.
   * Once complete, caches the offscreen canvas for fast redraws (e.g., on resize).
   */
  function drawSpectrogramAsync(spectrogramData, canvas, sampleRate) {
    return new Promise(resolve => {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Create an offscreen canvas to draw the spectrogram once.
      const offscreen = document.createElement('canvas');
      offscreen.width = canvas.width;
      offscreen.height = canvas.height;
      const offCtx = offscreen.getContext('2d');

      const numSlices = spectrogramData.length;
      const sliceWidth = canvas.width / numSlices;
      const height = canvas.height;
      const numBins = spectrogramData[0].length;
      const nyquist = sampleRate / 2;
      const maxBinIndex = Math.min(numBins - 1, Math.floor((SPECTROGRAM_MAX_FREQ / nyquist) * numBins));

      // Compute global dB range for normalization.
      const dbThreshold = -60;
      let maxDb = -100;
      for (let i = 0; i < numSlices; i++) {
        const magnitudes = spectrogramData[i];
        for (let j = 0; j <= maxBinIndex; j++) {
          const db = 20 * Math.log10(magnitudes[j] + 1e-9);
          const clampedDb = Math.max(dbThreshold, db);
          if (clampedDb > maxDb) maxDb = clampedDb;
        }
      }
      const minDb = dbThreshold;
      const dbRange = Math.max(1, maxDb - minDb);

      // Viridis colormap function (as used in the original code).
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
          if (t >= colors[i].t && t <= colors[i + 1].t) {
            c1 = colors[i];
            c2 = colors[i + 1];
            break;
          }
        }
        const range = c2.t - c1.t;
        const ratio = (range === 0) ? 0 : (t - c1.t) / range;
        const r = Math.round(c1.r + ratio * (c2.r - c1.r));
        const g = Math.round(c1.g + ratio * (c2.g - c1.g));
        const b = Math.round(c1.b + ratio * (c2.b - c1.b));
        return `rgb(${r},${g},${b})`;
      }

      let currentSlice = 0;
      const chunkSize = 20; // Number of slices to process per animation frame

      function drawChunk() {
        const startSlice = currentSlice;
        for (; currentSlice < startSlice + chunkSize && currentSlice < numSlices; currentSlice++) {
          const x = currentSlice * sliceWidth;
          const magnitudes = spectrogramData[currentSlice];
          const sliceImageData = offCtx.createImageData(1, height);
          const sliceData = sliceImageData.data;
          for (let y = 0; y < height; y++) {
            const freqRatio = (height - 1 - y) / (height - 1);
            const logFreqRatio = Math.pow(freqRatio, 2.5);
            const binIndex = Math.min(maxBinIndex, Math.floor(logFreqRatio * maxBinIndex));
            const magnitude = magnitudes[binIndex] || 0;
            const db = 20 * Math.log10(magnitude + 1e-9);
            const clampedDb = Math.max(minDb, db);
            const normValue = (clampedDb - minDb) / dbRange;
            const color = viridisColor(normValue);
            const rgb = color.match(/\d+/g);
            if (rgb && rgb.length === 3) {
              const offset = y * 4;
              sliceData[offset] = parseInt(rgb[0], 10);
              sliceData[offset + 1] = parseInt(rgb[1], 10);
              sliceData[offset + 2] = parseInt(rgb[2], 10);
              sliceData[offset + 3] = 255;
            }
          }
          offCtx.putImageData(sliceImageData, Math.round(x), 0);

          // Update the progress indicator on the spectrogram canvas
          if (spectrogramProgressIndicator) {
            const canvasWidth = canvas.clientWidth;
            spectrogramProgressIndicator.style.left = (currentSlice / numSlices * canvasWidth) + "px";
          }
        }
        if (currentSlice < numSlices) {
          requestAnimationFrame(drawChunk);
        } else {
          // When done, cache the offscreen canvas and draw it to the main canvas
          cachedSpectrogramCanvas = offscreen;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
          if (spectrogramSpinner) spectrogramSpinner.style.display = 'none';
          resolve();
        }
      }
      drawChunk();
    });
  }

  // =============================================
  // == CANVAS & WINDOW MANAGEMENT ==
  // =============================================

  /**
   * Adjusts the internal canvas sizes to match their displayed size.
   * On resizing, if the spectrogram is cached, scales the cached image instead of recomputing.
   */
  function resizeCanvases(redraw = true) {
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
    // If the spectrogram was already computed, simply scale the cached image.
    if (cachedSpectrogramCanvas && spectrogramCanvas) {
      const specCtx = spectrogramCanvas.getContext('2d');
      specCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
      specCtx.drawImage(cachedSpectrogramCanvas, 0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
    } else if (decodedBuffer && resized && redraw) {
      // Otherwise, recompute and redraw visuals if needed.
      computeAndDrawVisuals();
    } else if (resized) {
      updateUI();
    }
  }

  // =============================================
  // == UTILITY FUNCTIONS ==
  // =============================================

  function formatTime(sec) {
    if (isNaN(sec) || sec < 0) sec = 0;
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
  }

  function hannWindow(length) {
    if (length <= 0) return [];
    const windowArr = new Array(length);
    if (length === 1) return [1];
    const denom = length - 1;
    for (let i = 0; i < length; i++) {
      windowArr[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
    }
    return windowArr;
  }

  // =============================================
  // == PUBLIC INTERFACE ==
  // =============================================
  return {
    init: init
  };
})();

// Global execution: initialize the player when the DOM is ready.
document.addEventListener('DOMContentLoaded', AudioPlayer.init);

// --- END OF FILE player.js ---
