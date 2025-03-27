// --- START OF FILE player.js ---
const AudioPlayer = (function() {
  'use strict';

  /**
   * Converts an AudioBuffer to 16kHz mono Float32Array PCM.
   * This is the required format for the Silero VAD model.
   * Uses OfflineAudioContext for high-quality resampling.
   * @param {AudioBuffer} audioBuffer - The original decoded audio buffer.
   * @returns {Promise<Float32Array>} - A promise resolving to the 16kHz mono PCM data.
   */
  function convertAudioBufferTo16kHzMonoFloat32(audioBuffer) {
    const targetSampleRate = 16000;
    // Create an Offline context to process the audio graph without playing it.
    const offlineCtx = new OfflineAudioContext(
      1, // Number of channels (Mono)
      audioBuffer.duration * targetSampleRate, // Target buffer length in samples
      targetSampleRate // Target sample rate
    );
    // Create a buffer source node for the original audio.
    const src = offlineCtx.createBufferSource();
    src.buffer = audioBuffer;
    // Connect the source to the destination (the output of the context).
    src.connect(offlineCtx.destination);
    // Start the source node.
    src.start();
    console.log(`Resampling audio from ${audioBuffer.sampleRate}Hz to ${targetSampleRate}Hz mono for VAD.`);
    // Start rendering the audio graph. This returns a Promise.
    return offlineCtx.startRendering().then(rendered => {
      // Get the raw Float32Array data from the first (and only) channel.
      return rendered.getChannelData(0);
    }).catch(err => {
      console.error("Error during audio resampling:", err);
      throw err; // Re-throw the error to be caught by the caller
    });
  }

  // =============================================
  // == MODULE SCOPE VARIABLES & CONFIGURATION ==
  // =============================================

  // --- DOM Element References ---
  let fileInput, fileInfo, playPauseButton, jumpBackButton, jumpForwardButton,
      jumpTimeInput, playbackSpeedControl, speedValueDisplay, gainControl,
      gainValueDisplay, timeDisplay, waveformCanvas, spectrogramCanvas,
      spectrogramSpinner, waveformProgressBar, waveformProgressIndicator,
      spectrogramProgressBar, spectrogramProgressIndicator, audioEl,
      speechRegionsDisplay,
      // VAD Tuning Elements
      vadThresholdSlider, vadThresholdValueDisplay;

  // --- Web Audio API & State ---
  let audioCtx = null; // The main AudioContext
  let gainNode = null; // Gain node for volume control
  let mediaSource = null; // MediaElementAudioSourceNode connecting <audio> to AudioContext
  let decodedBuffer = null; // Store the *original* fully decoded AudioBuffer
  let currentObjectURL = null; // Store the current Blob URL for the <audio> element
  let isPlaying = false; // Track playback state

  // --- VAD Analysis Results Storage ---
  let speechRegions = []; // Current regions {start, end} based on slider threshold
  let vadProbabilities = null; // Store Float32Array of frame probabilities from VAD analysis
  let vadFrameSamples = 0; // Samples per frame used in VAD analysis
  let vadSampleRate = 0; // Sample rate used in VAD analysis (should be 16000)
  let vadRedemptionFrames = 0; // Redemption frames used in VAD analysis
  let vadNegativeThreshold = 0.35; // Negative threshold used in VAD analysis

  // --- Visualization & Constants ---
  const WAVEFORM_HEIGHT_SCALE = 0.8; // How much vertical space the waveform uses (0 to 1)
  const SPECTROGRAM_FFT_SIZE = 1024; // FFT window size (power of 2)
  const SPECTROGRAM_MAX_FREQ = 8000; // Max frequency to display on spectrogram (adjust as needed)
  const SPEC_FIXED_WIDTH = 2048; // Fixed internal width for spectrogram calculation/caching
  let cachedSpectrogramCanvas = null; // Offscreen canvas for caching the full spectrogram


  /**
   * Initializes the audio player, gets DOM elements, and sets up listeners.
   */
  async function init() {
    console.log("AudioPlayer initializing...");
    assignDOMElements();
    setupEventListeners();
    setupAudioContext();
    resizeCanvases(); // Initial canvas size calculation
    window.addEventListener('resize', resizeCanvases); // Handle window resize
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
    speechRegionsDisplay = document.getElementById('speechRegionsDisplay');
    // VAD Tuning Elements
    vadThresholdSlider = document.getElementById('vadThreshold');
    vadThresholdValueDisplay = document.getElementById('vadThresholdValue');
  }

  /**
   * Sets up all event listeners for controls, audio element, and window.
   */
  function setupEventListeners() {
    fileInput.addEventListener('change', handleFileLoad);
    playPauseButton.addEventListener('click', togglePlayPause);
    jumpBackButton.addEventListener('click', () => jumpBy(-getJumpTime()));
    jumpForwardButton.addEventListener('click', () => jumpBy(getJumpTime()));
    playbackSpeedControl.addEventListener('input', handleSpeedChange);
    gainControl.addEventListener('input', handleGainChange);

    // Allow seeking by clicking on canvases
    [waveformCanvas, spectrogramCanvas].forEach(canvas => {
      if (canvas) canvas.addEventListener('click', handleCanvasClick);
    });

    // Listen to audio element events
    audioEl.addEventListener('play', () => { isPlaying = true; playPauseButton.textContent = 'Pause'; });
    audioEl.addEventListener('pause', () => { isPlaying = false; playPauseButton.textContent = 'Play'; });
    audioEl.addEventListener('ended', () => { isPlaying = false; playPauseButton.textContent = 'Play'; });
    audioEl.addEventListener('timeupdate', updateUI); // Update time display and progress bars
    audioEl.addEventListener('loadedmetadata', updateUI); // Update duration info
    audioEl.addEventListener('durationchange', updateUI); // Update duration info if it changes

    // Listen for keyboard shortcuts
    document.addEventListener('keydown', handleKeyDown);

    // Setup VAD Tuning Slider Listener
    if (vadThresholdSlider) {
        vadThresholdSlider.addEventListener('input', handleThresholdChange);
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (currentObjectURL) {
            URL.revokeObjectURL(currentObjectURL);
            console.log("Revoked Object URL on page unload:", currentObjectURL);
        }
        if (audioCtx && audioCtx.state !== 'closed') {
            audioCtx.close().catch(e => console.warn("Error closing AudioContext:", e));
        }
    });
  }

  /**
   * Creates the main AudioContext and the GainNode for volume control.
   */
  function setupAudioContext() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        gainNode = audioCtx.createGain();
        gainNode.gain.value = parseFloat(gainControl.value); // Set initial gain
        gainNode.connect(audioCtx.destination); // Connect gain node to output
        console.log("AudioContext and GainNode created.");
      } catch (e) {
        console.error("Web Audio API is not supported by this browser.", e);
        alert("Web Audio API is not supported by this browser.");
      }
    }
  }

  /**
   * Connects the HTML <audio> element to the Web Audio API graph (via GainNode).
   * Required for gain control.
   */
  function connectAudioElementSource() {
    // Ensure context exists, audio has a source, and we haven't already connected.
    if (!audioCtx || !audioEl.src || mediaSource) return;
    try {
      // Resume context if it was suspended (e.g., by browser autoplay policy)
      if (audioCtx.state === 'suspended') audioCtx.resume();
      // Create a source node from the <audio> element.
      mediaSource = audioCtx.createMediaElementSource(audioEl);
      // Connect the source to the gain node (which is connected to destination).
      mediaSource.connect(gainNode);
      console.log("Audio element connected to Web Audio graph.");
    } catch (e) {
      // Catch potential errors (e.g., trying to create source node multiple times)
      console.error("Error connecting audio element source:", e);
      mediaSource = null; // Ensure mediaSource is null if connection failed
    }
  }

  /**
   * Handles the loading of a new audio file selected by the user.
   * Decodes the audio, runs VAD analysis, and triggers visualization computation.
   * @param {Event} e - The file input change event.
   */
  async function handleFileLoad(e) {
    const file = e.target.files[0];
    if (!file) return; // No file selected

    console.log("File selected:", file.name);
    fileInfo.textContent = `File: ${file.name}`;

    // --- Reset State ---
    decodedBuffer = null;
    speechRegions = [];
    vadProbabilities = null;
    vadFrameSamples = 0;
    vadSampleRate = 0;
    resetUI(); // Reset UI elements and disable controls
    cachedSpectrogramCanvas = null; // Clear cached spectrogram
    // --- End Reset State ---

    // --- Manage Object URL for <audio> element ---
    // Revoke the previous Object URL if one exists to free up memory.
    if (currentObjectURL) {
      URL.revokeObjectURL(currentObjectURL);
      console.log("Revoked previous Object URL:", currentObjectURL);
      currentObjectURL = null;
    }
    // Create a new Object URL for the selected file.
    currentObjectURL = URL.createObjectURL(file);
    // --- End Manage Object URL ---

    // Set the new source for the <audio> element and load it.
    audioEl.src = currentObjectURL;
    audioEl.load(); // Important: Tell the audio element to load the new source.

    // Reconnect the <audio> element to the Web Audio graph if needed.
    // Disconnecting might happen automatically on src change, or the source node might become invalid.
    // It's safer to disconnect the old one (if exists) and create/connect a new one.
    if (mediaSource) {
        try { mediaSource.disconnect(); } catch (err) { /* ignore */ }
        mediaSource = null; // Reset mediaSource
    }
    connectAudioElementSource();

    // Unfocus the file input element for better keyboard shortcut usability.
    if (fileInput) fileInput.blur();

    // Show spinner and clear canvases while processing.
    spectrogramSpinner.style.display = 'inline';
    waveformCanvas.getContext('2d').clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    spectrogramCanvas.getContext('2d').clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
    if (speechRegionsDisplay) speechRegionsDisplay.textContent = "Analyzing...";


    try {
      // Read the file content as an ArrayBuffer.
      const arrayBuffer = await file.arrayBuffer();
      console.log("Decoding audio data...");
      // Ensure AudioContext is ready.
      if (!audioCtx) setupAudioContext();
      if (!audioCtx) throw new Error("AudioContext could not be initialized.");

      // Decode the ArrayBuffer into an AudioBuffer using the Web Audio API.
      // This decodes the *entire file* into memory.
      decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      console.log(`Audio decoded: ${decodedBuffer.duration.toFixed(2)}s, ${decodedBuffer.sampleRate}Hz, ${decodedBuffer.numberOfChannels} channels`);

      // Enable playback controls now that we have a decodable file.
      enablePlaybackControls();

      // --- Perform VAD Analysis on Resampled Audio ---
      console.log("Preparing audio for VAD (resampling to 16kHz mono)...");
      console.time("VAD Resampling");
      // Convert the original AudioBuffer to the format needed by Silero VAD.
      const pcm16kMono = await convertAudioBufferTo16kHzMonoFloat32(decodedBuffer);
      console.timeEnd("VAD Resampling");

      console.log("Running Silero VAD analysis...");
      console.time("VAD Analysis");
      // Call the VAD analysis function which now returns probabilities and initial regions.
      const vadResult = await SileroVAD.analyzeAudio(pcm16kMono, 16000); // Use 16000 Hz
      console.timeEnd("VAD Analysis");

      // --- Store VAD results and parameters for later recalculation ---
      speechRegions = vadResult.regions; // Store initial regions
      vadProbabilities = vadResult.probabilities; // Store raw frame probabilities
      vadFrameSamples = vadResult.frameSamples; // Store frame size used
      vadSampleRate = vadResult.sampleRate; // Store sample rate used (16000)
      vadRedemptionFrames = vadResult.redemptionFrames; // Store redemption frames used
      vadNegativeThreshold = vadResult.initialNegativeThreshold; // Store negative threshold used

      // Set the VAD slider to the initial threshold value used and enable it.
      if (vadThresholdSlider) {
          vadThresholdSlider.value = vadResult.initialPositiveThreshold;
          vadThresholdSlider.disabled = false; // Enable the slider now
      }
      if (vadThresholdValueDisplay) {
          vadThresholdValueDisplay.textContent = parseFloat(vadResult.initialPositiveThreshold).toFixed(2);
      }
      // --- End Store VAD results ---

      // Update the text display with the initial VAD results.
      updateSpeechRegionsDisplay();

      // Compute and draw visualizations using the ORIGINAL decodedBuffer and INITIAL speechRegions.
      computeAndDrawVisuals();

    } catch (err) {
      console.error('Error processing audio file:', err);
      const errorMsg = `Error processing file: ${err.message || err}`;
      fileInfo.textContent = errorMsg;
      if (speechRegionsDisplay) speechRegionsDisplay.textContent = "Error during analysis.";
      alert(`Could not process audio file: ${err.message || err}`);
      disableControls(); // Disable all controls, including VAD slider
      // Revoke Object URL on error as well.
      if (currentObjectURL) {
        URL.revokeObjectURL(currentObjectURL);
        currentObjectURL = null;
      }
    } finally {
      // Hide the spinner regardless of success or failure.
      spectrogramSpinner.style.display = 'none';
    }
  }

  /**
   * Toggles playback state (Play/Pause) of the audio element.
   * Resumes AudioContext if suspended.
   */
  function togglePlayPause() {
    // Ensure audio is loaded and ready before trying to play/pause.
    if (!audioEl.src || audioEl.readyState < audioEl.HAVE_METADATA) return;
    // Resume AudioContext if it's suspended (often happens on first user interaction).
    if (audioCtx.state === 'suspended') audioCtx.resume();

    if (audioEl.paused) {
      audioEl.play().catch(e => console.error("Error playing audio:", e));
    } else {
      audioEl.pause();
    }
  }

  /**
   * Jumps the playback position by a specified number of seconds.
   * @param {number} seconds - The amount to jump (positive for forward, negative for backward).
   */
  function jumpBy(seconds) {
    if (!audioEl.src || isNaN(audioEl.duration)) return;
    seek(audioEl.currentTime + seconds);
  }

  /**
   * Seeks the playback position to a specific time.
   * Clamps the time within the valid duration range [0, duration].
   * @param {number} time - The target time in seconds.
   */
  function seek(time) {
    if (!audioEl.src || isNaN(audioEl.duration)) return;
    // Ensure the target time is within the bounds of the audio duration.
    let newTime = Math.max(0, Math.min(time, audioEl.duration));
    audioEl.currentTime = newTime;
    console.log(`Seeked to ${formatTime(newTime)}`);
    // UI update will be handled by the 'timeupdate' event listener.
  }

  /**
   * Handles clicks on the waveform or spectrogram canvases to seek playback.
   * @param {MouseEvent} e - The click event.
   */
  function handleCanvasClick(e) {
    // Ensure audio is loaded and has a valid duration.
    if (!audioEl.src || isNaN(audioEl.duration) || audioEl.duration === 0) return;

    const canvas = e.target;
    const rect = canvas.getBoundingClientRect(); // Get canvas position and size
    const clickXRelative = e.clientX - rect.left; // X coordinate relative to canvas start
    const fraction = clickXRelative / rect.width; // Fraction of the click position along the width
    const newTime = fraction * audioEl.duration; // Calculate target time

    seek(newTime); // Seek to the calculated time
  }

  /**
   * Handles changes to the playback speed slider.
   */
  function handleSpeedChange() {
    const val = parseFloat(playbackSpeedControl.value);
    speedValueDisplay.textContent = val.toFixed(2) + "x"; // Update display
    audioEl.playbackRate = val; // Set playback rate on the audio element
    // Ensure pitch correction is enabled (most browsers do this by default now)
    audioEl.preservesPitch = true;
    audioEl.mozPreservesPitch = true; // For older Firefox
  }

  /**
   * Handles changes to the gain (volume) control slider.
   */
  function handleGainChange() {
    const val = parseFloat(gainControl.value);
    gainValueDisplay.textContent = val.toFixed(2) + "x"; // Update display
    // If the GainNode exists, update its gain value smoothly.
    if (gainNode && audioCtx) {
      // Use setValueAtTime for smooth changes (though linearRampToValueAtTime is smoother for transitions)
      gainNode.gain.setValueAtTime(val, audioCtx.currentTime);
    }
  }

  /**
   * Handles keyboard shortcuts for playback control.
   * @param {KeyboardEvent} e - The keydown event.
   */
  function handleKeyDown(e) {
    // Ignore shortcuts if user is typing in an input field (except range/number inputs)
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'number') return;
    // Ignore if no audio is loaded
    if (!audioEl.src || isNaN(audioEl.duration)) return;

    let handled = false;
    switch (e.code) {
      case 'Space':
        // Prevent space bar from scrolling page if not in an input
        if (e.target.tagName !== 'INPUT') {
          togglePlayPause();
          handled = true;
        }
        break;
      case 'ArrowLeft':
        jumpBy(-getJumpTime()); // Jump back
        handled = true;
        break;
      case 'ArrowRight':
        jumpBy(getJumpTime()); // Jump forward
        handled = true;
        break;
    }

    // Prevent default browser action (e.g., scrolling) if we handled the key press.
    if (handled) e.preventDefault();
  }

  /**
   * Gets the jump time interval from the input field.
   * @returns {number} - The jump time in seconds.
   */
  function getJumpTime() {
    return parseFloat(jumpTimeInput.value) || 5; // Default to 5 seconds if input is invalid
  }

  /**
   * Updates the time display and progress indicators based on current playback time.
   */
  function updateUI() {
    // Handle cases where audio might not be ready or duration is invalid
    if (!audioEl.src || isNaN(audioEl.duration) || audioEl.duration <= 0) {
      timeDisplay.textContent = "0:00 / 0:00";
      if (waveformProgressIndicator) waveformProgressIndicator.style.left = "0px";
      if (spectrogramProgressIndicator) spectrogramProgressIndicator.style.left = "0px";
      return;
    }

    const currentTime = audioEl.currentTime;
    const duration = audioEl.duration;
    const fraction = currentTime / duration; // Calculate playback progress fraction

    // Update time display (e.g., "1:23 / 4:56")
    timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;

    // Update waveform progress indicator position
    if (waveformProgressIndicator && waveformCanvas) {
      const waveformCanvasWidth = waveformCanvas.clientWidth; // Get current display width
      if (waveformCanvasWidth > 0) {
        waveformProgressIndicator.style.left = (fraction * waveformCanvasWidth) + "px";
      } else {
        waveformProgressIndicator.style.left = "0px";
      }
    }

    // Update spectrogram progress indicator position
    if (spectrogramProgressIndicator && spectrogramCanvas) {
      const spectrogramCanvasWidth = spectrogramCanvas.clientWidth; // Get current display width
      if (spectrogramCanvasWidth > 0) {
        spectrogramProgressIndicator.style.left = (fraction * spectrogramCanvasWidth) + "px";
      } else {
        spectrogramProgressIndicator.style.left = "0px";
      }
    }
  }

  /**
   * Resets UI elements to their default state (e.g., when loading a new file or on error).
   */
  function resetUI() {
    playPauseButton.textContent = 'Play';
    timeDisplay.textContent = "0:00 / 0:00";
    if (waveformProgressIndicator) waveformProgressIndicator.style.left = "0px";
    if (spectrogramProgressIndicator) spectrogramProgressIndicator.style.left = "0px";
    if (speechRegionsDisplay) speechRegionsDisplay.textContent = "None"; // Reset VAD display
    if (vadThresholdValueDisplay) vadThresholdValueDisplay.textContent = "N/A"; // Reset VAD threshold display
    disableControls(); // Disable all controls
  }

  /**
   * Enables playback-related controls.
   */
  function enablePlaybackControls() {
    playPauseButton.disabled = false;
    jumpBackButton.disabled = false;
    jumpForwardButton.disabled = false;
    playbackSpeedControl.disabled = false;
    // Gain control is usually always enabled
  }

  /**
   * Disables all interactive controls (playback and VAD tuning).
   */
  function disableControls() {
    playPauseButton.disabled = true;
    jumpBackButton.disabled = true;
    jumpForwardButton.disabled = true;
    playbackSpeedControl.disabled = true;
    if (vadThresholdSlider) vadThresholdSlider.disabled = true; // Ensure VAD slider is disabled
    // Gain control can remain enabled
  }

  /**
   * Computes and draws the waveform and spectrogram visualizations.
   * Uses the *original* decodedBuffer for visual fidelity.
   * Uses the *current* speechRegions for highlighting.
   */
  async function computeAndDrawVisuals() {
    // Ensure we have the original decoded audio data.
    if (!decodedBuffer) return;
    console.log("Computing and drawing visualizations...");
    console.time("Visualization Computation");

    // Ensure canvases are sized correctly before drawing.
    resizeCanvases(false); // Pass false to prevent recursive redraw if resize happens

    // --- Waveform ---
    const waveformWidth = waveformCanvas.width; // Get current canvas width
    console.time("Waveform compute");
    // Compute waveform data based on the original buffer and current canvas width.
    const waveformData = computeWaveformData(decodedBuffer, waveformCanvas.width);
    console.timeEnd("Waveform compute");

    console.time("Waveform draw");
    // Draw the waveform, passing the CURRENT speechRegions for highlighting.
    drawWaveform(waveformData, waveformCanvas, speechRegions, decodedBuffer.duration);
    console.timeEnd("Waveform draw");
    // --- End Waveform ---

    // --- Spectrogram ---
    // Only recompute spectrogram if not cached or if major parameters changed (not the case here yet)
    if (!cachedSpectrogramCanvas) {
        console.time("Spectrogram compute");
        // Compute spectrogram data based on the original buffer.
        const spectrogramData = computeSpectrogram(decodedBuffer, SPECTROGRAM_FFT_SIZE, SPEC_FIXED_WIDTH);
        console.timeEnd("Spectrogram compute");

        if (spectrogramData && spectrogramData.length > 0) {
          console.time("Spectrogram draw (async)");
          // Draw the spectrogram asynchronously onto the offscreen cache and then display it.
          // Use the original sample rate for frequency axis calculation.
          drawSpectrogramAsync(spectrogramData, spectrogramCanvas, decodedBuffer.sampleRate)
            .then(() => {
              console.timeEnd("Spectrogram draw (async)");
              updateUI(); // Ensure progress indicators are updated after drawing finishes
            });
        } else {
          // Handle cases where spectrogram computation failed.
          console.warn("Spectrogram computation yielded no data or failed.");
          const specCtx = spectrogramCanvas.getContext('2d');
          specCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
          specCtx.fillStyle = '#888';
          specCtx.textAlign = 'center';
          specCtx.fillText("Could not compute spectrogram", spectrogramCanvas.width / 2, spectrogramCanvas.height / 2);
        }
    } else {
        // If cached, just draw the cached image onto the visible canvas.
        console.log("Using cached spectrogram.");
        const specCtx = spectrogramCanvas.getContext('2d');
        specCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
        specCtx.drawImage(cachedSpectrogramCanvas, 0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
        updateUI(); // Still need to update progress indicators
    }
    // --- End Spectrogram ---

    console.timeEnd("Visualization Computation");
    // updateUI(); // Initial UI update after computations start
  }

  /**
   * Computes simplified waveform data (min/max pairs) for drawing.
   * Downsamples the audio data to fit the target canvas width.
   * @param {AudioBuffer} buffer - The original AudioBuffer.
   * @param {number} targetWidth - The target width in pixels.
   * @returns {Array<{min: number, max: number}>} - Array of min/max values for each pixel column.
   */
  function computeWaveformData(buffer, targetWidth) {
    if (!buffer || targetWidth <= 0) return [];
    const channelCount = buffer.numberOfChannels;
    const bufferLength = buffer.length;

    // Get raw audio data, mixing down to mono if necessary.
    const sourceData = channelCount > 1 ? new Float32Array(bufferLength) : buffer.getChannelData(0);
    if (channelCount > 1) {
      // Simple averaging mix-down
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

    // Determine how many source samples correspond to one pixel column.
    const samplesPerPixel = Math.max(1, Math.floor(bufferLength / targetWidth));
    const waveform = [];

    // Iterate through each pixel column.
    for (let i = 0; i < targetWidth; i++) {
      const start = Math.floor(i * samplesPerPixel);
      const end = Math.min(start + samplesPerPixel, bufferLength);

      // If calculation results in empty segment, push zero values.
      if (start >= end) {
        waveform.push({ min: 0, max: 0 });
        continue;
      }

      // Find the minimum and maximum sample value within the segment.
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
   * Draws the waveform onto the canvas, highlighting speech regions.
   * @param {Array<{min: number, max: number}>} waveformData - Pre-computed waveform data.
   * @param {HTMLCanvasElement} canvas - The target canvas element.
   * @param {Array<{start: number, end: number}>} speechRegions - Current speech regions to highlight.
   * @param {number} audioDuration - Total duration of the audio in seconds.
   */
   function drawWaveform(waveformData, canvas, speechRegions, audioDuration) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height); // Clear previous drawing

    // Handle cases with no data or invalid duration.
    if (!waveformData || waveformData.length === 0 || !audioDuration || audioDuration <= 0) {
      ctx.fillStyle = '#888';
      ctx.textAlign = 'center';
      ctx.fillText("No waveform data", width / 2, height / 2);
      return;
    }

    const dataLen = waveformData.length;
    const halfHeight = height / 2;
    const scale = halfHeight * WAVEFORM_HEIGHT_SCALE; // Vertical scaling factor
    const pixelsPerSecond = width / audioDuration; // Horizontal scaling: pixels per second

    // Pre-calculate speech region boundaries in pixels for efficiency.
    const speechPixelRegions = (speechRegions || [])
        .map(r => ({
            startPx: r.start * pixelsPerSecond,
            endPx: r.end * pixelsPerSecond
          }));

    const pixelWidth = width / dataLen; // Width of each vertical bar

    // Optimization: Draw non-speech and speech parts separately to avoid style switching per pixel.

    // 1. Draw non-speech parts
    ctx.fillStyle = '#3455db'; // Default (non-speech) color
    ctx.beginPath(); // Start a new path for all non-speech rectangles
    for (let i = 0; i < dataLen; i++) {
      const x = i * pixelWidth; // Starting X position of the bar
      const currentPixelEnd = x + pixelWidth; // Ending X position of the bar

      // Check if this bar overlaps with *any* speech region.
      let isOutsideSpeech = true;
      for (const region of speechPixelRegions) {
          // Basic overlap check: region starts before bar ends AND region ends after bar starts
          if (region.startPx < currentPixelEnd && region.endPx > x) {
              isOutsideSpeech = false;
              break; // Found an overlap, no need to check other regions
          }
      }

      // If it's outside all speech regions, add its rectangle to the path.
      if (isOutsideSpeech) {
         const min = waveformData[i].min;
         const max = waveformData[i].max;
         const y1 = halfHeight - max * scale; // Top coordinate
         const y2 = halfHeight - min * scale; // Bottom coordinate (min is negative)
         ctx.rect(x, y1, pixelWidth, Math.max(1, y2 - y1)); // Use rect for batch drawing, ensure min height of 1px
      }
    }
    ctx.fill(); // Draw all non-speech rectangles added to the path

    // 2. Draw speech parts
    ctx.fillStyle = 'orange'; // Speech color
    ctx.beginPath(); // Start a new path for all speech rectangles
     for (let i = 0; i < dataLen; i++) {
      const x = i * pixelWidth;
      const currentPixelEnd = x + pixelWidth;

      // Check if this bar overlaps with *any* speech region.
      let isInsideSpeech = false;
      for (const region of speechPixelRegions) {
         if (region.startPx < currentPixelEnd && region.endPx > x) {
              isInsideSpeech = true;
              break;
          }
      }

      // If it overlaps with a speech region, add its rectangle to the path.
      if (isInsideSpeech) {
         const min = waveformData[i].min;
         const max = waveformData[i].max;
         const y1 = halfHeight - max * scale;
         const y2 = halfHeight - min * scale;
         ctx.rect(x, y1, pixelWidth, Math.max(1, y2 - y1));
      }
    }
    ctx.fill(); // Draw all speech rectangles added to the path
  }


  /**
   * Computes spectrogram data (magnitude per frequency bin per time slice).
   * Uses the FFT library. Processes the *original* audio buffer.
   * @param {AudioBuffer} buffer - The original audio buffer.
   * @param {number} fftSize - The size of the FFT window (power of 2).
   * @param {number} targetSlices - The desired number of time slices (pixels) in the output.
   * @returns {Array<Float32Array>|null} - Array of magnitude arrays, or null on error.
   */
  function computeSpectrogram(buffer, fftSize, targetSlices) {
    // Ensure FFT library is loaded.
    if (typeof FFT === 'undefined') {
      console.error("FFT constructor not found! Make sure fft.js is loaded before player.js.");
      return null;
    }
    // Ensure buffer is valid.
    if (!buffer) {
      console.error("Cannot compute spectrogram without an AudioBuffer.");
      return null;
    }
    // Validate FFT size.
    if ((fftSize & (fftSize - 1)) !== 0 || fftSize <= 1) {
      console.error(`Invalid FFT size: ${fftSize}. Must be a power of two > 1.`);
      return null;
    }

    // Use the first channel for spectrogram calculation.
    const channelData = buffer.getChannelData(0);
    const totalSamples = channelData.length;
    // Hop size determines overlap between FFT windows. fftSize/4 gives 75% overlap.
    const hopSize = Math.max(1, Math.floor(fftSize / 4));

    // Calculate the number of raw FFT slices we can get from the data.
    const rawSliceCount = totalSamples < fftSize
      ? 0
      : Math.floor((totalSamples - fftSize) / hopSize) + 1;

    if (rawSliceCount <= 0) {
      console.warn("Not enough audio samples for the chosen FFT size and hop size.");
      return [];
    }
    console.log(`Spectrogram: fftSize=${fftSize}, rawSliceCount=${rawSliceCount}, hopSize=${hopSize}, targetSlices=${targetSlices}`);

    const fftInstance = new FFT(fftSize);
    // Output buffer for complex FFT results (interleaved real/imaginary).
    const complexBuffer = fftInstance.createComplexArray();
    // Input buffer for real FFT (windowed samples).
    const fftInput = new Array(fftSize);
    // Hann window function to reduce spectral leakage.
    const windowFunc = hannWindow(fftSize);
    if (!windowFunc || windowFunc.length !== fftSize) {
      console.error('Failed to generate Hann window!');
      return null;
    }

    const rawSpec = []; // Store raw magnitude arrays

    // Calculate FFT for each overlapping frame.
    for (let i = 0; i < rawSliceCount; i++) {
      const start = i * hopSize;
      // Apply window function to the frame samples.
      for (let j = 0; j < fftSize; j++) {
        const sample = (start + j < totalSamples) ? channelData[start + j] : 0; // Zero-pad if needed
        fftInput[j] = sample * windowFunc[j];
      }

      // Perform the real FFT.
      fftInstance.realTransform(complexBuffer, fftInput);

      // Calculate magnitudes from the complex results (only need first half: 0 to Nyquist).
      const magnitudes = new Float32Array(fftSize / 2);
      for (let k = 0; k < fftSize / 2; k++) {
        const re = complexBuffer[k * 2];
        const im = complexBuffer[k * 2 + 1];
        // Magnitude = sqrt(re^2 + im^2). Avoid sqrt for performance? No, needed for dB conversion.
        const magSq = (re * re + im * im);
        // Ensure magnitude is non-negative before sqrt.
        magnitudes[k] = Math.sqrt(magSq > 0 ? magSq : 0);
      }
      rawSpec.push(magnitudes);
    }

    // --- Resample/Select Slices to Match Target Width ---
    // Simple nearest-neighbor resampling if raw count doesn't match target.
    // More advanced interpolation (linear, etc.) could be used for smoother results.
    const finalSpec = new Array(targetSlices);
    const rawCount = rawSpec.length;
    if (rawCount === targetSlices) {
      // If counts match, just copy.
      for (let i = 0; i < rawCount; i++) {
        finalSpec[i] = rawSpec[i];
      }
    } else {
      // If counts differ, pick nearest raw slice for each target slice.
      for (let i = 0; i < targetSlices; i++) {
          // Calculate the 'ideal' position in the raw spectrum array.
          const t = (targetSlices > 1) ? (i / (targetSlices - 1)) : 0;
          const rawPos = t * (rawCount - 1);
          // Find the nearest raw slice index.
          const nearestIndex = Math.min(rawCount - 1, Math.max(0, Math.round(rawPos)));
          // Copy the magnitudes from the nearest raw slice.
          finalSpec[i] = rawSpec[nearestIndex]; // Note: This copies the reference, use new Float32Array(rawSpec[nearestIndex]) if modification is needed later.
      }
    }

    return finalSpec;
  }

  /**
   * Generates a Hann window array of a given length.
   * @param {number} length - The desired window length.
   * @returns {Array<number>} - The Hann window array.
   */
  function hannWindow(length) {
    if (length <= 0) return [];
    let windowArr = new Array(length);
    if (length === 1) return [1]; // Window is just 1 for length 1
    // Formula: 0.5 * (1 - cos(2 * PI * n / (N - 1)))
    const denom = length - 1;
    for (let i = 0; i < length; i++) {
      windowArr[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
    }
    return windowArr;
  }

  /**
   * Draws the spectrogram onto a canvas asynchronously using requestAnimationFrame.
   * Uses an offscreen canvas for potentially better performance and caching.
   * @param {Array<Float32Array>} spectrogramData - The computed spectrogram magnitude data.
   * @param {HTMLCanvasElement} canvas - The visible canvas element to draw onto.
   * @param {number} sampleRate - The original sample rate of the audio.
   * @returns {Promise<void>} - A promise that resolves when drawing is complete.
   */
  function drawSpectrogramAsync(spectrogramData, canvas, sampleRate) {
    return new Promise(resolve => {
      const displayCtx = canvas.getContext('2d');
      displayCtx.clearRect(0, 0, canvas.width, canvas.height); // Clear visible canvas

      // Use the fixed internal width for the offscreen canvas.
      const offscreen = document.createElement('canvas');
      offscreen.width = SPEC_FIXED_WIDTH;
      offscreen.height = canvas.height; // Use visible canvas height
      const offCtx = offscreen.getContext('2d', { willReadFrequently: false }); // Optimization hint

      const computedSlices = spectrogramData.length; // Should match SPEC_FIXED_WIDTH
      const height = offscreen.height;
      const numBins = spectrogramData[0].length; // Number of frequency bins (fftSize / 2)
      const nyquist = sampleRate / 2;

      // Determine the highest frequency bin index to display based on SPECTROGRAM_MAX_FREQ.
      const maxBinIndex = Math.min(
        numBins - 1,
        Math.floor((SPECTROGRAM_MAX_FREQ / nyquist) * numBins)
      );

      // --- Calculate dB Range ---
      // Find the approximate max dB value across the relevant bins for normalization.
      const dbThreshold = -60; // Floor level for dB values (lower values treated as this)
      let maxDb = -Infinity; // Start with very small value
      for (let i = 0; i < computedSlices; i++) {
        const magnitudes = spectrogramData[i];
        for (let j = 0; j <= maxBinIndex; j++) {
          // Convert magnitude to dB: 20 * log10(magnitude). Add small epsilon to avoid log(0).
          const db = 20 * Math.log10((magnitudes[j] || 0) + 1e-9);
          const clampedDb = Math.max(dbThreshold, db); // Apply threshold
          if (clampedDb > maxDb) maxDb = clampedDb;
        }
      }
      const minDb = dbThreshold;
      const dbRange = Math.max(1, maxDb - minDb); // Ensure range is at least 1 to avoid division by zero.
      console.log(`Spectrogram dB range: ${minDb.toFixed(1)} dB to ${maxDb.toFixed(1)} dB`);
      // --- End Calculate dB Range ---


      // Get ImageData for direct pixel manipulation (faster than fillRect per pixel).
      const fullImageData = offCtx.createImageData(offscreen.width, height);
      const data = fullImageData.data; // Uint8ClampedArray [R, G, B, A, R, G, B, A, ...]

      // --- Viridis Colormap Function ---
      // (Same as before)
      function viridisColor(t) { /* ... implementation ... */ }
      // (Example Viridis implementation - copy from previous answer if needed)
      // Colors from Matplotlib's Viridis
      function viridisColor(t) {
          const colors = [
              { t: 0.0, r: 68, g: 1, b: 84 }, { t: 0.1, r: 72, g: 40, b: 120 },
              { t: 0.2, r: 62, g: 74, b: 137 }, { t: 0.3, r: 49, g: 104, b: 142 },
              { t: 0.4, r: 38, g: 130, b: 142 }, { t: 0.5, r: 31, g: 155, b: 137 },
              { t: 0.6, r: 53, g: 178, b: 126 }, { t: 0.7, r: 109, g: 199, b: 104 },
              { t: 0.8, r: 170, g: 217, b: 70 }, { t: 0.9, r: 235, g: 231, b: 35 },
              { t: 1.0, r: 253, g: 231, b: 37 } // Same as 0.9 to avoid abrupt end? Often yellow.
          ];
          t = Math.max(0, Math.min(1, t)); // Clamp t to [0, 1]
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


      // Process the spectrogram data in chunks using requestAnimationFrame for non-blocking UI.
      let currentSlice = 0;
      const chunkSize = 32; // Number of slices to process per frame

      function drawChunk() {
        const startSlice = currentSlice;
        const endSlice = Math.min(startSlice + chunkSize, computedSlices);

        // Loop through time slices in the chunk.
        for (let i = startSlice; i < endSlice; i++) {
          const magnitudes = spectrogramData[i];
          // Loop through vertical pixels (representing frequency).
          for (let y = 0; y < height; y++) {
            // Map vertical pixel position (y) to frequency bin index.
            // Using a logarithmic scale (power function) emphasizes lower frequencies.
            const freqRatio = (height - 1 - y) / (height - 1); // 0 (top) to 1 (bottom) -> 1 (high f) to 0 (low f)
            const logFreqRatio = Math.pow(freqRatio, 2.5); // Adjust power for desired emphasis
            const binIndex = Math.min(maxBinIndex, Math.floor(logFreqRatio * maxBinIndex));

            const magnitude = magnitudes[binIndex] || 0;
            const db = 20 * Math.log10(magnitude + 1e-9); // Convert to dB
            const clampedDb = Math.max(minDb, db); // Apply floor threshold
            const normValue = (clampedDb - minDb) / dbRange; // Normalize dB value to [0, 1]

            const [r, g, b] = viridisColor(normValue); // Get color from colormap

            // Calculate pixel index in the ImageData array.
            // Note: 'i' is the slice index (horizontal), 'y' is the row index (vertical).
            const idx = (i + y * offscreen.width) * 4; // (x + y * width) * 4

            // Set RGBA values.
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255; // Alpha (fully opaque)
          }
        }
        currentSlice = endSlice; // Update progress

        // Put the updated pixel data onto the offscreen canvas (only the changed part for efficiency? No, putImageData expects full image data).
        // This step might still be relatively slow depending on canvas size.
        offCtx.putImageData(fullImageData, 0, 0); // Redraw the whole offscreen canvas from buffer


        // Update progress indicator during async drawing (optional)
        // if (spectrogramProgressIndicator) { /* ... update based on currentSlice ... */ }

        // If not finished, schedule the next chunk.
        if (currentSlice < computedSlices) {
          requestAnimationFrame(drawChunk);
        } else {
          // Drawing finished.
          cachedSpectrogramCanvas = offscreen; // Cache the fully drawn offscreen canvas
          // Draw the completed offscreen canvas onto the visible canvas, scaling if needed.
          displayCtx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
          if (spectrogramSpinner) spectrogramSpinner.style.display = 'none'; // Hide spinner
          console.log("Spectrogram drawing complete.");
          resolve(); // Resolve the promise
        }
      }
      // Start the asynchronous drawing process.
      drawChunk();
    });
  }

  /**
   * Resizes the waveform and spectrogram canvases to match their CSS dimensions.
   * Redraws visualizations if necessary and if data is available.
   * @param {boolean} [redraw=true] - Whether to redraw visualizations after resizing.
   */
  async function resizeCanvases(redraw = true) {
    let resized = false;
    [waveformCanvas, spectrogramCanvas].forEach(canvas => {
      if (!canvas) return;
      const { width, height } = canvas.getBoundingClientRect(); // Get CSS dimensions
      // Round dimensions to avoid fractional pixels.
      const roundedWidth = Math.max(10, Math.round(width));
      const roundedHeight = Math.max(10, Math.round(height));

      // Only update canvas bitmap size if it actually changed.
      if (canvas.width !== roundedWidth || canvas.height !== roundedHeight) {
        canvas.width = roundedWidth;
        canvas.height = roundedHeight;
        console.log(`Resized ${canvas.id} to ${canvas.width}x${canvas.height}`);
        resized = true;
      }
    });

    // If canvases were resized and redraw is requested and we have data...
    if (resized && redraw && decodedBuffer) {
      console.log("Redrawing visuals after resize.");
      // Redraw waveform immediately using existing data.
      const waveformData = computeWaveformData(decodedBuffer, waveformCanvas.width);
      drawWaveform(waveformData, waveformCanvas, speechRegions, decodedBuffer.duration);

      // Redraw spectrogram by scaling the cached offscreen canvas.
      if (cachedSpectrogramCanvas && spectrogramCanvas) {
        const specCtx = spectrogramCanvas.getContext('2d');
        specCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
        // Draw cached image, scaling it to fit the new canvas dimensions.
        specCtx.drawImage(cachedSpectrogramCanvas, 0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
      } else {
        // If no cache, need to recompute and draw (should ideally not happen often if cache is working)
        // computeAndDrawVisuals(); // Avoid recursion, maybe just clear spectrogram?
         const specCtx = spectrogramCanvas.getContext('2d');
         specCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
         specCtx.fillText("Resize needed recompute (no cache)", spectrogramCanvas.width/2, spectrogramCanvas.height/2);
      }
      updateUI(); // Ensure progress indicators are correct after resize/redraw
    } else if (resized) {
        // If resized but no data/redraw needed, just update UI (progress bars).
        updateUI();
    }
  }

  /**
   * Formats time in seconds to a "minutes:seconds" string (e.g., "1:05").
   * @param {number} sec - Time in seconds.
   * @returns {string} - Formatted time string.
   */
  function formatTime(sec) {
    if (isNaN(sec) || sec < 0) sec = 0;
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    // Pad seconds with a leading zero if less than 10.
    return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
  }


  // --- VAD Tuning Related Functions ---

  /**
   * Recalculates speech regions based on stored probabilities and new thresholds.
   * This function is FAST as it doesn't run the ONNX model again.
   * @param {Float32Array} probabilities - The stored probabilities for each frame.
   * @param {number} frameSamples - Samples per frame used during analysis.
   * @param {number} sampleRate - Sample rate used during analysis (16000).
   * @param {object} options - Contains current threshold settings.
   * @param {number} options.positiveSpeechThreshold - Current positive threshold from slider.
   * @param {number} options.negativeSpeechThreshold - Negative threshold to use.
   * @param {number} options.redemptionFrames - Redemption frames to use.
   * @returns {Array<{start: number, end: number}>} - Newly calculated speech regions.
   */
  function recalculateSpeechRegions(probabilities, frameSamples, sampleRate, options) {
      const positiveThreshold = options.positiveSpeechThreshold;
      const negativeThreshold = options.negativeSpeechThreshold;
      const redemptionFrames = options.redemptionFrames;

      const newRegions = [];
      let inSpeech = false;
      let regionStart = 0.0;
      let redemptionCounter = 0; // Reset counter for recalculation

      if (!probabilities || probabilities.length === 0) return [];

      // Iterate through the stored probabilities.
      for (let i = 0; i < probabilities.length; i++) {
          const probability = probabilities[i];
          // Calculate start and end times for the *current* frame.
          const frameStartTime = (i * frameSamples) / sampleRate;
          const frameEndTime = ((i + 1) * frameSamples) / sampleRate;

          // Apply the same VAD logic as in silero_vad.js, but using the stored probs.
          if (probability >= positiveThreshold) {
              if (!inSpeech) {
                  inSpeech = true;
                  regionStart = frameStartTime; // Speech starts at the beginning of this frame.
              }
              redemptionCounter = 0; // Reset redemption on positive frame.
          } else if (inSpeech) {
              // We were in speech, but this frame is not positive.
              if (probability < negativeThreshold) {
                  // Probability is below the negative threshold, start/increment redemption.
                  redemptionCounter++;
                  if (redemptionCounter >= redemptionFrames) {
                      // Redemption period met, end the speech segment.
                      // The actual end time is considered the start of the frame that *triggered* the end count,
                      // which is `redemptionFrames` frames before the current one.
                      // Index `i` is the current frame, so the triggering frame index is `i - redemptionFrames + 1`.
                      // The end time is the start of that frame.
                      const triggerFrameIndex = i - redemptionFrames + 1;
                      const actualEnd = (triggerFrameIndex * frameSamples) / sampleRate;
                      // Ensure end time is not before start time (can happen with short segments).
                      const finalEnd = Math.max(regionStart, actualEnd);

                      newRegions.push({ start: regionStart, end: finalEnd });
                      inSpeech = false;
                      redemptionCounter = 0; // Reset for next potential segment.
                  }
                  // else: Still within redemption period, do nothing yet.
              } else {
                  // Probability is between negative and positive thresholds - treat as speech continuation.
                  // Keep 'inSpeech' true, and reset redemption counter.
                  redemptionCounter = 0;
              }
          }
          // If not inSpeech and probability < positiveThreshold, do nothing.
      }

      // Finalize region if still 'inSpeech' after the loop finishes.
      if (inSpeech) {
          // The speech continued until the very end of the analyzed data.
          const finalEnd = (probabilities.length * frameSamples) / sampleRate; // End time is end of last frame
          newRegions.push({ start: regionStart, end: finalEnd });
      }

      return newRegions; // Return the newly calculated regions array.
  }

  /**
   * Event Handler for the VAD Threshold Slider change.
   * Recalculates speech regions and redraws the waveform.
   * @param {Event} e - The input event from the slider.
   */
  function handleThresholdChange(e) {
    // Ensure we have the necessary VAD data.
    if (!vadProbabilities || !decodedBuffer) return;

    const newThreshold = parseFloat(e.target.value);
    // Update the text display next to the slider.
    if (vadThresholdValueDisplay) {
      vadThresholdValueDisplay.textContent = newThreshold.toFixed(2);
    }

    // Define options for recalculation using current slider value and stored params.
    const options = {
        positiveSpeechThreshold: newThreshold,
        negativeSpeechThreshold: vadNegativeThreshold, // Use the stored negative threshold
        redemptionFrames: vadRedemptionFrames     // Use the stored redemption frames
    };

    // Recalculate regions using the fast function.
    speechRegions = recalculateSpeechRegions(
        vadProbabilities,
        vadFrameSamples,
        vadSampleRate,
        options
    );

    // Update the text area displaying the list of regions.
    updateSpeechRegionsDisplay();

    // Redraw *only* the waveform with the new region highlighting.
    // Recomputing waveform data isn't strictly needed unless canvas size changed,
    // but it's quick and ensures consistency if drawWaveform relies on it.
    const waveformData = computeWaveformData(decodedBuffer, waveformCanvas.width);
    drawWaveform(waveformData, waveformCanvas, speechRegions, decodedBuffer.duration);

    // Optional: Update progress indicator position just in case (though unlikely to change).
    // updateUI();
  }

  /**
   * Helper function to update the text area that lists detected speech regions.
   */
  function updateSpeechRegionsDisplay() {
      if (speechRegionsDisplay) {
          if (speechRegions && speechRegions.length > 0) {
              // Format each region and join with newlines.
              speechRegionsDisplay.textContent = speechRegions
                  .map(r => `Start: ${r.start.toFixed(2)}s, End: ${r.end.toFixed(2)}s`)
                  .join('\n');
          } else {
              // Display message if no regions are detected at the current threshold.
              speechRegionsDisplay.textContent = "No speech detected (at current threshold).";
          }
      }
  }


  // --- Public API ---
  // Expose only the 'init' function to start the player.
  return {
    init: init
  };
})();

// --- Initialization ---
// Wait for the DOM to be fully loaded before initializing the player.
document.addEventListener('DOMContentLoaded', () => {
  AudioPlayer.init().catch(console.error); // Initialize and catch any setup errors.
});
// --- END OF FILE player.js ---