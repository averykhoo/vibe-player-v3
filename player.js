// Global variables for Web Audio and decoded buffer
let audioCtx;
let mediaSource;
let gainNode;
let decodedBuffer; // for visualization
const fileInput = document.getElementById('audioFile');
const fileInfo = document.getElementById('fileInfo');
const playPauseButton = document.getElementById('playPause');
const jumpBackButton = document.getElementById('jumpBack');
const jumpForwardButton = document.getElementById('jumpForward');
const jumpTimeInput = document.getElementById('jumpTime');
const playbackSpeedControl = document.getElementById('playbackSpeed');
const speedValueDisplay = document.getElementById('speedValue');
const gainControl = document.getElementById('gainControl');
const gainValueDisplay = document.getElementById('gainValue');
const timeDisplay = document.getElementById('timeDisplay');

const waveformCanvas = document.getElementById('waveformCanvas');
const spectrogramCanvas = document.getElementById('spectrogramCanvas');
const spectrogramSpinner = document.getElementById('spectrogramSpinner');
const progressBar = document.getElementById('progressBar');
const progressIndicator = document.getElementById('progressIndicator');

// Hidden audio element for pitch-preserved playback
const audioEl = document.getElementById('player');

// Initialize AudioContext and connect the audio element to a GainNode
function initAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    gainNode = audioCtx.createGain();
    gainNode.gain.value = parseFloat(gainControl.value);
    mediaSource = audioCtx.createMediaElementSource(audioEl);
    mediaSource.connect(gainNode).connect(audioCtx.destination);
  }
}

// File loading: set up the audio element and decode the file for visualization
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  fileInfo.textContent = file.name;
  initAudioContext();

  // Set the audio element source (object URL) for playback
  const url = URL.createObjectURL(file);
  audioEl.src = url;
  audioEl.load();

  // Decode the file for visualizations
  spectrogramSpinner.style.display = 'block';
  try {
    const arrayBuffer = await file.arrayBuffer();
    decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    computeAndDrawStaticVisuals();
  } catch (err) {
    console.error('Error decoding audio data:', err);
  } finally {
    spectrogramSpinner.style.display = 'none';
  }
});

// Playback controls
playPauseButton.addEventListener('click', togglePlayPause);
jumpBackButton.addEventListener('click', () => {
  jumpBy(-parseFloat(jumpTimeInput.value));
});
jumpForwardButton.addEventListener('click', () => {
  jumpBy(parseFloat(jumpTimeInput.value));
});

function togglePlayPause() {
  if (!audioEl.src) return;
  if (audioEl.paused) {
    audioEl.play();
    playPauseButton.textContent = 'Pause';
  } else {
    audioEl.pause();
    playPauseButton.textContent = 'Play';
  }
}

// Update playback speed and ensure pitch preservation
playbackSpeedControl.addEventListener('input', () => {
  const val = parseFloat(playbackSpeedControl.value);
  speedValueDisplay.textContent = val.toFixed(2) + "x";
  audioEl.playbackRate = val;
  audioEl.preservesPitch = true;
  audioEl.mozPreservesPitch = true;
  audioEl.webkitPreservesPitch = true;
  audioEl.msPreservesPitch = true;
});

// Update gain control via the GainNode
gainControl.addEventListener('input', () => {
  const val = parseFloat(gainControl.value);
  gainValueDisplay.textContent = val.toFixed(2) + "x";
  if (gainNode) {
    gainNode.gain.value = val;
  }
});

// Update progress bar and time display during playback
audioEl.addEventListener('timeupdate', updateProgress);
audioEl.addEventListener('ended', () => {
  playPauseButton.textContent = 'Play';
});

function updateProgress() {
  if (!decodedBuffer || !audioEl.duration) return;
  const currentTime = audioEl.currentTime;
  const total = audioEl.duration;
  const fraction = currentTime / total;
  progressIndicator.style.left = (fraction * progressBar.clientWidth) + "px";
  timeDisplay.textContent = formatTime(currentTime) + " / " + formatTime(total);
}

// Jump (seek) function used by jump buttons and arrow keys
function jumpBy(seconds) {
  if (!audioEl.duration) return;
  let newTime = audioEl.currentTime + seconds;
  if (newTime < 0) newTime = 0;
  if (newTime > audioEl.duration) newTime = audioEl.duration;
  audioEl.currentTime = newTime;
  updateProgress();
}

// Enable click-to-seek on the waveform and spectrogram canvases
function handleCanvasClick(e) {
  if (!decodedBuffer || !audioEl.duration) return;
  const rect = e.target.getBoundingClientRect();
  const scaleX = e.target.width / rect.width;
  const clickX = (e.clientX - rect.left) * scaleX;
  const fraction = clickX / e.target.width;
  const newTime = fraction * audioEl.duration;
  audioEl.currentTime = newTime;
  updateProgress();
}
[waveformCanvas, spectrogramCanvas].forEach(canvas => {
  canvas.addEventListener('click', handleCanvasClick);
});

// ----- Visualization Functions (adapted from the audio-player version) -----

function computeAndDrawStaticVisuals() {
  if (!decodedBuffer) return;
  const width = waveformCanvas.width;
  const waveformData = computeWaveformData(decodedBuffer, width);
  const spectrogramData = computeSpectrogram(decodedBuffer, 512);
  drawWaveform(waveformData);
  drawSpectrogram(spectrogramData);
  updateProgress();
}

function computeWaveformData(buffer, width) {
  const channelCount = buffer.numberOfChannels;
  const mergedData = new Float32Array(buffer.length);
  for (let ch = 0; ch < channelCount; ch++) {
    const channelData = buffer.getChannelData(ch);
    for (let i = 0; i < channelData.length; i++) {
      mergedData[i] += channelData[i] / channelCount;
    }
  }
  const samplesPerPixel = Math.floor(mergedData.length / width);
  let waveform = [];
  for (let i = 0; i < width; i++) {
    const start = i * samplesPerPixel;
    const end = start + samplesPerPixel;
    let min = 1.0, max = -1.0;
    for (let j = start; j < end; j++) {
      const sample = mergedData[j];
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    waveform.push({ min, max });
  }
  return waveform;
}

function drawWaveform(waveformData) {
  const ctx = waveformCanvas.getContext('2d');
  const { width, height } = waveformCanvas;
  ctx.clearRect(0, 0, width, height);
  const amplitudeScale = 0.8;
  ctx.beginPath();
  for (let i = 0; i < waveformData.length; i++) {
    const x = (i / (waveformData.length - 1)) * width;
    const y = (height / 2) - waveformData[i].max * (height / 2 * amplitudeScale);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = waveformData.length - 1; i >= 0; i--) {
    const x = (i / (waveformData.length - 1)) * width;
    const y = (height / 2) - waveformData[i].min * (height / 2 * amplitudeScale);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'black';
  ctx.fill();
}

function computeSpectrogram(buffer, fftSize) {
  const hopSize = fftSize / 2;
  const channelData = buffer.getChannelData(0);
  const totalSlices = Math.floor((channelData.length - fftSize) / hopSize);
  const spec = [];
  for (let i = 0; i < totalSlices; i++) {
    const start = i * hopSize;
    const slice = channelData.slice(start, start + fftSize);
    const mags = computeFFT(slice, fftSize);
    spec.push(mags);
  }
  return spec;
}

function drawSpectrogram(spectrogramData) {
  const ctx = spectrogramCanvas.getContext('2d');
  const { width, height } = spectrogramCanvas;
  ctx.clearRect(0, 0, width, height);
  if (!spectrogramData) return;
  const nyquist = decodedBuffer.sampleRate / 2;
  const maxBin = Math.min(
    spectrogramData[0].length,
    Math.floor((16000 / nyquist) * spectrogramData[0].length)
  );
  let globalMax = 0;
  spectrogramData.forEach(slice => {
    for (let i = 0; i < maxBin; i++) {
      if (slice[i] > globalMax) globalMax = slice[i];
    }
  });
  const sliceWidth = width / spectrogramData.length;
  spectrogramData.forEach((slice, i) => {
    for (let y = 0; y < height; y++) {
      const bin = Math.floor((((height - y) / height) ** 2) * maxBin);
      const magnitude = slice[bin] || 0;
      const norm = Math.sqrt(magnitude / globalMax);
      const color = viridisColor(norm);
      ctx.fillStyle = color;
      ctx.fillRect(i * sliceWidth, y, sliceWidth, 1);
    }
  });
}

function viridisColor(t) {
  const colors = [
    { t: 0.0, r: 68, g: 1, b: 84 },
    { t: 0.25, r: 59, g: 82, b: 139 },
    { t: 0.5, r: 33, g: 145, b: 140 },
    { t: 0.75, r: 94, g: 201, b: 97 },
    { t: 1.0, r: 253, g: 231, b: 37 }
  ];
  for (let i = 0; i < colors.length - 1; i++) {
    if (t >= colors[i].t && t <= colors[i+1].t) {
      const ratio = (t - colors[i].t) / (colors[i+1].t - colors[i].t);
      const r = Math.round(colors[i].r + ratio * (colors[i+1].r - colors[i].r));
      const g = Math.round(colors[i].g + ratio * (colors[i+1].g - colors[i].g));
      const b = Math.round(colors[i].b + ratio * (colors[i+1].b - colors[i].b));
      return `rgb(${r},${g},${b})`;
    }
  }
  return `rgb(253,231,37)`;
}

function computeFFT(samples, fftSize) {
  const windowFunc = hannWindow(fftSize);
  let re = new Array(fftSize);
  let im = new Array(fftSize).fill(0);
  for (let i = 0; i < fftSize; i++) {
    re[i] = samples[i] * windowFunc[i];
  }
  fft(re, im);
  let magnitudes = new Array(fftSize / 2);
  for (let i = 0; i < fftSize / 2; i++) {
    magnitudes[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }
  return magnitudes;
}

function hannWindow(length) {
  let windowArr = new Array(length);
  for (let i = 0; i < length; i++) {
    windowArr[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
  }
  return windowArr;
}

function fft(re, im) {
  const n = re.length;
  if (n <= 1) return;
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
    let m = n >> 1;
    while (j >= m && m >= 1) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len;
    const wlenRe = Math.cos(angle);
    const wlenIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wRe = 1, wIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len/2] * wRe - im[i + k + len/2] * wIm;
        const vIm = re[i + k + len/2] * wIm + im[i + k + len/2] * wRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len/2] = uRe - vRe;
        im[i + k + len/2] = uIm - vIm;
        const tmpRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = tmpRe;
      }
    }
  }
}

function formatTime(sec) {
  if (!sec || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ":" + (s < 10 ? "0" + s : s);
}

// ----- Canvas Resizing -----
function resizeCanvases() {
  [waveformCanvas, spectrogramCanvas].forEach(canvas => {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  });
  if (decodedBuffer) {
    computeAndDrawStaticVisuals();
  }
}
window.addEventListener('resize', resizeCanvases);
resizeCanvases();

// ----- Keyboard Shortcuts -----
document.addEventListener('keydown', (e) => {
  if (!audioEl.src) return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlayPause();
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    jumpBy(parseFloat(jumpTimeInput.value));
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    jumpBy(-parseFloat(jumpTimeInput.value));
  }
});
