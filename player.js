// --- START OF FILE player.js ---

// Wrap everything in an IIFE (Immediately Invoked Function Expression)
// to avoid polluting the global scope and create a private scope.
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
    const WAVEFORM_HEIGHT_SCALE = 0.8; // How much of canvas height to use
    const SPECTROGRAM_FFT_SIZE = 1024; // Power of 2 for FFT. Affects frequency resolution.
    const SPECTROGRAM_MAX_FREQ = 16000; // Max frequency (Hz) to display

    // =============================================
    // == INITIALIZATION & SETUP ==
    // =============================================

    /**
     * Initializes the audio player, gets DOM elements, sets up event listeners.
     * Should be called once the DOM is ready.
     */
    function init() {
        console.log("AudioPlayer initializing...");
        assignDOMElements();
        setupEventListeners();
        setupAudioContext(); // Setup context and gain node early
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
    }

    /**
     * Sets up all event listeners for UI controls and the audio element.
     */
    function setupEventListeners() {
        fileInput.addEventListener('change', handleFileLoad);
        playPauseButton.addEventListener('click', togglePlayPause);
        jumpBackButton.addEventListener('click', () => jumpBy(-getJumpTime()));
        jumpForwardButton.addEventListener('click', () => jumpBy(getJumpTime()));
        playbackSpeedControl.addEventListener('input', handleSpeedChange);
        gainControl.addEventListener('input', handleGainChange);

        // Use event delegation or attach to canvases directly for seeking
        [waveformCanvas, spectrogramCanvas].forEach(canvas => {
             canvas.addEventListener('click', handleCanvasClick);
        });

        // Listeners for the <audio> element's state
        audioEl.addEventListener('play', () => { isPlaying = true; playPauseButton.textContent = 'Pause'; });
        audioEl.addEventListener('pause', () => { isPlaying = false; playPauseButton.textContent = 'Play'; });
        audioEl.addEventListener('ended', () => { isPlaying = false; playPauseButton.textContent = 'Play'; /* Reset state */ });
        audioEl.addEventListener('timeupdate', updateUI);
        audioEl.addEventListener('loadedmetadata', updateUI); // Update duration display when ready
        audioEl.addEventListener('durationchange', updateUI); // Update duration display if it changes

        // Keyboard shortcuts
        document.addEventListener('keydown', handleKeyDown);
    }

    /**
     * Initializes the AudioContext and GainNode if they don't exist.
     */
    function setupAudioContext() {
        if (!audioCtx) {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                gainNode = audioCtx.createGain();
                gainNode.gain.value = parseFloat(gainControl.value); // Set initial gain
                gainNode.connect(audioCtx.destination); // Connect gain to output
                console.log("AudioContext and GainNode created.");
            } catch (e) {
                console.error("Web Audio API is not supported by this browser.", e);
                alert("Web Audio API is not supported by this browser.");
            }
        }
    }

    /**
     * Connects the audio element to the Web Audio graph (Source -> Gain -> Destination).
     * Should be called after the audio element has a valid src.
     */
    function connectAudioElementSource() {
         if (!audioCtx || !audioEl.src || mediaSource) {
             // Don't reconnect if already connected, no source, or context missing
             // Note: Can only create one MediaElementSource per element
             return;
         }
         try {
             // Resume context if suspended (often needed after user interaction)
             if (audioCtx.state === 'suspended') {
                 audioCtx.resume();
             }
             mediaSource = audioCtx.createMediaElementSource(audioEl);
             mediaSource.connect(gainNode); // Connect source to gain
             console.log("Audio element connected to Web Audio graph.");
         } catch (e) {
              console.error("Error connecting audio element source:", e);
         }
    }

    // =============================================
    // == FILE LOADING & PROCESSING ==
    // =============================================

    /**
     * Handles the file input change event. Loads the file, sets up the audio element,
     * decodes audio for visualization, and triggers visualization rendering.
     */
    async function handleFileLoad(e) {
        const file = e.target.files[0];
        if (!file) return;

        console.log("File selected:", file.name);
        fileInfo.textContent = `File: ${file.name}`;
        decodedBuffer = null; // Reset previous buffer
        resetUI(); // Reset controls and display

        // 1. Set up the <audio> element for playback
        const objectURL = URL.createObjectURL(file);
        audioEl.src = objectURL;
        audioEl.load(); // Important to load the new source

        // Connect to gain node *after* setting src and *before* potential decoding context use
        connectAudioElementSource();

        // FIX: Blur the file input to prevent spacebar re-triggering it
        if(fileInput) fileInput.blur();

        // 2. Decode the *same* file data for visualizations
        spectrogramSpinner.style.display = 'inline'; // Show spinner
        waveformCanvas.getContext('2d').clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
        spectrogramCanvas.getContext('2d').clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);

        try {
            const arrayBuffer = await file.arrayBuffer();
            console.log("Decoding audio data...");
            // Ensure audio context is ready for decoding
            if (!audioCtx) setupAudioContext();
            if (!audioCtx) throw new Error("AudioContext could not be initialized.");

            decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            console.log(`Audio decoded: ${decodedBuffer.duration.toFixed(2)}s, ${decodedBuffer.sampleRate}Hz`);

            enableControls();
            computeAndDrawVisuals(); // Compute and draw waveform and spectrogram

        } catch (err) {
            console.error('Error processing audio file:', err);
            fileInfo.textContent = `Error processing file: ${err.message || err}`;
            alert(`Could not process audio file: ${err.message || err}`);
            disableControls();
        } finally {
            spectrogramSpinner.style.display = 'none'; // Hide spinner
        }
    }

    // =============================================
    // == PLAYBACK CONTROLS ==
    // =============================================

    function togglePlayPause() {
        if (!audioEl.src || !audioEl.readyState >= 1) return; // Need src and metadata loaded

        // Ensure context is running (browsers sometimes suspend it)
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
        // Use audioEl.duration as it's the source of truth for playback timing
        if (!audioEl.src || isNaN(audioEl.duration)) return;
        seek(audioEl.currentTime + seconds);
    }

    function seek(time) {
         // Use audioEl.duration as it's the source of truth for playback timing
         if (!audioEl.src || isNaN(audioEl.duration)) return;
         let newTime = Math.max(0, Math.min(time, audioEl.duration));
         audioEl.currentTime = newTime;
         // No need to call updateUI immediately, 'timeupdate' will fire.
         console.log(`Seeked to ${formatTime(newTime)}`);
    }

    function handleCanvasClick(e) {
        // Use audioEl.duration as it's the source of truth for playback timing
        if (!audioEl.src || isNaN(audioEl.duration) || audioEl.duration === 0) return;
        const canvas = e.target;
        const rect = canvas.getBoundingClientRect();

        // Calculate click position relative to canvas element size
        const clickXRelative = e.clientX - rect.left;
        const fraction = clickXRelative / rect.width; // Use element width for fraction

        const newTime = fraction * audioEl.duration;
        seek(newTime);
    }

    function handleSpeedChange() {
        const val = parseFloat(playbackSpeedControl.value);
        speedValueDisplay.textContent = val.toFixed(2) + "x";
        audioEl.playbackRate = val;
        // Pitch preservation is typically default, but explicit doesn't hurt
        audioEl.preservesPitch = true;
        audioEl.mozPreservesPitch = true; // Firefox legacy
    }

    function handleGainChange() {
        const val = parseFloat(gainControl.value);
        gainValueDisplay.textContent = val.toFixed(2) + "x";
        if (gainNode && audioCtx) {
            // Use setValueAtTime for smooth changes
            gainNode.gain.setValueAtTime(val, audioCtx.currentTime);
        }
    }

     function handleKeyDown(e) {
        // Don't interfere with text inputs, allow number input for jump time
        if (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'number') return;
        // Only act if audio is loaded (check duration)
        if (!audioEl.src || isNaN(audioEl.duration)) return;

        let handled = false;
        switch (e.code) {
            case 'Space':
                 // Allow space only if the target is not an input element
                 if (e.target.tagName !== 'INPUT') {
                    togglePlayPause();
                    handled = true;
                 }
                break;
            case 'ArrowLeft':
                // Allow arrows even if range input is focused
                jumpBy(-getJumpTime());
                handled = true;
                break;
            case 'ArrowRight':
                 jumpBy(getJumpTime());
                 handled = true;
                break;
            // Add more shortcuts if needed (e.g., volume, speed)
        }

        if (handled) {
            e.preventDefault(); // Prevent default browser action (e.g., scrolling, spacebar page down)
        }
    }

    function getJumpTime() {
        return parseFloat(jumpTimeInput.value) || 5;
    }

    // =============================================
    // == UI UPDATE & STATE MANAGEMENT ==
    // =============================================

    /**
     * Updates the time display and progress indicators based on audio element state.
     */
    function updateUI() {
        // Check if audio element has valid duration
        if (!audioEl.src || isNaN(audioEl.duration) || audioEl.duration === 0) {
            timeDisplay.textContent = "0:00 / 0:00";
            if (waveformProgressIndicator) waveformProgressIndicator.style.left = "0px";
            if (spectrogramProgressIndicator) spectrogramProgressIndicator.style.left = "0px";
            return;
        };

        const currentTime = audioEl.currentTime;
        const duration = audioEl.duration;
        const fraction = duration > 0 ? currentTime / duration : 0;

        timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;

        // Update progress indicators based on the *visible width* of their canvases
        if (waveformProgressIndicator && waveformCanvas) {
            const waveformCanvasWidth = waveformCanvas.clientWidth;
            waveformProgressIndicator.style.left = (fraction * waveformCanvasWidth) + "px";
        }
         if (spectrogramProgressIndicator && spectrogramCanvas) {
            const spectrogramCanvasWidth = spectrogramCanvas.clientWidth;
            spectrogramProgressIndicator.style.left = (fraction * spectrogramCanvasWidth) + "px";
        }
    }

    /**
     * Resets UI elements to initial state (e.g., before loading a file).
     */
     function resetUI() {
         playPauseButton.textContent = 'Play';
         timeDisplay.textContent = "0:00 / 0:00";
         if (waveformProgressIndicator) waveformProgressIndicator.style.left = "0px";
         if (spectrogramProgressIndicator) spectrogramProgressIndicator.style.left = "0px";
         // Reset sliders visually? Optional.
         // playbackSpeedControl.value = 1.0;
         // speedValueDisplay.textContent = "1.00x";
         // gainControl.value = 1.0;
         // gainValueDisplay.textContent = "1.00x";
         disableControls(); // Disable until file loaded & decoded
     }

     /** Enable playback controls */
     function enableControls() {
          playPauseButton.disabled = false;
          jumpBackButton.disabled = false;
          jumpForwardButton.disabled = false;
          playbackSpeedControl.disabled = false;
          // Keep gain control enabled always
     }
     /** Disable playback controls (except volume) */
      function disableControls() {
          playPauseButton.disabled = true;
          jumpBackButton.disabled = true;
          jumpForwardButton.disabled = true;
          playbackSpeedControl.disabled = true;
     }

    // =============================================
    // == VISUALIZATION COMPUTATION & DRAWING ==
    // =============================================
    // Note: Could potentially move visualization functions to a separate file/module

    /**
     * Orchestrates computing and drawing both waveform and spectrogram.
     */
    function computeAndDrawVisuals() {
        if (!decodedBuffer) return;
        console.log("Computing visualizations...");
        console.time("Visualization Computation");

        // Ensure canvases have correct dimensions before drawing
        // Note: resizeCanvases *itself* calls this function if resize occurs,
        // so direct call here is fine as long as resizeCanvases has guards.
        resizeCanvases(false); // Pass false to avoid infinite loop potential

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
            console.time("Spectrogram draw");
            drawSpectrogram(spectrogramData, spectrogramCanvas, decodedBuffer.sampleRate);
            console.timeEnd("Spectrogram draw");
        } else {
             console.warn("Spectrogram computation yielded no data or failed.");
             // Optionally draw a "no data" message on the spectrogram canvas
             const specCtx = spectrogramCanvas.getContext('2d');
             specCtx.clearRect(0, 0, spectrogramWidth, spectrogramCanvas.height);
             specCtx.fillStyle = '#888';
             specCtx.textAlign = 'center';
             specCtx.fillText("Could not compute spectrogram", spectrogramWidth / 2, spectrogramCanvas.height / 2);
        }

        console.timeEnd("Visualization Computation");
        updateUI(); // Update progress/time display now that duration is known (from decodedBuffer)
                    // or re-align based on potential resize
    }

    /** Computes data points for the waveform */
    function computeWaveformData(buffer, targetWidth) {
        if (!buffer || targetWidth <= 0) return [];

        const channelCount = buffer.numberOfChannels;
        const bufferLength = buffer.length;

        // Merge channels for simplicity (average)
        // Optimization: If mono, just use getChannelData(0) directly
        const sourceData = channelCount > 1 ? new Float32Array(bufferLength) : buffer.getChannelData(0);
        if (channelCount > 1) {
            for (let ch = 0; ch < channelCount; ch++) {
                const channelData = buffer.getChannelData(ch);
                for (let i = 0; i < channelData.length; i++) {
                    sourceData[i] += channelData[i]; // Sum first
                }
            }
            // Now average
            for (let i = 0; i < bufferLength; i++) {
                sourceData[i] /= channelCount;
            }
        }

        // Calculate samples per pixel, ensuring it's at least 1
        const samplesPerPixel = Math.max(1, Math.floor(bufferLength / targetWidth));
        const waveform = []; // Store { min, max } pairs

        for (let i = 0; i < targetWidth; i++) {
            const start = Math.floor(i * samplesPerPixel);
            // Ensure 'end' doesn't exceed buffer length
            const end = Math.min(start + samplesPerPixel, bufferLength);

            if (start >= end) { // Handle edge case: targetWidth > bufferLength
                 waveform.push({ min: 0, max: 0 });
                 continue;
            }

            let min = 1.0, max = -1.0;
            // Find min/max within the block
            for (let j = start; j < end; j++) {
                const sample = sourceData[j];
                if (sample < min) min = sample;
                if (sample > max) max = sample;
            }
            waveform.push({ min, max });
        }
        return waveform;
    }

    /** Draws the computed waveform data onto a canvas */
    function drawWaveform(waveformData, canvas) {
        const ctx = canvas.getContext('2d');
        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height);

        if (!waveformData || waveformData.length === 0) {
             ctx.fillStyle = '#888';
             ctx.textAlign = 'center';
             ctx.fillText("No waveform data", width / 2, height / 2);
             return; // No data
        }

        const dataLen = waveformData.length;
        const halfHeight = height / 2;
        const scale = halfHeight * WAVEFORM_HEIGHT_SCALE;

        ctx.beginPath();
        ctx.moveTo(0, halfHeight - waveformData[0].max * scale);

        // Draw top edge
        for (let i = 1; i < dataLen; i++) {
            const x = (i / (dataLen - 1)) * width; // Ensure last point reaches edge
            const y = halfHeight - waveformData[i].max * scale;
            ctx.lineTo(x, y);
        }

        // Draw bottom edge backwards
        for (let i = dataLen - 1; i >= 0; i--) {
            const x = (i / (dataLen - 1)) * width; // Ensure last point reaches edge
            const y = halfHeight - waveformData[i].min * scale;
            ctx.lineTo(x, y);
        }

        ctx.closePath();
        ctx.fillStyle = '#3455db'; // A slightly more vibrant blue
        ctx.fill();
    }

    /**
     * Computes spectrogram data using the provided FFT implementation.
     * @param {AudioBuffer} buffer The decoded audio buffer.
     * @param {number} fftSize Power-of-two FFT window size.
     * @param {number} targetSlices Target number of horizontal slices (e.g., canvas width).
     * @returns {Array<Float32Array>|null} Array of magnitude arrays, one per slice, or null on error.
     */
    function computeSpectrogram(buffer, fftSize, targetSlices) {
         // Check if the global FFT constructor exists (loaded from fft.js)
        if (typeof FFT === 'undefined') {
             console.error("FFT constructor not found! Make sure fft.js is loaded before player.js.");
             return null; // Return null or empty array to indicate failure
        }
        if (!buffer) {
            console.error("Cannot compute spectrogram without an AudioBuffer.");
            return null;
        }
        if ((fftSize & (fftSize - 1)) !== 0 || fftSize <= 1) {
            console.error(`Invalid FFT size: ${fftSize}. Must be a power of two > 1.`);
            return null;
        }

        // Ensure targetSlices is reasonable
        targetSlices = Math.max(1, Math.floor(targetSlices));

        // Use the first channel for spectrogram calculation
        const channelData = buffer.getChannelData(0);
        const totalSamples = channelData.length;

        // --- Calculate hopSize to achieve roughly targetSlices ---
        // Overlap: 50% is common, adjust hopSize based on fftSize
        // A hopSize of fftSize / 4 gives 75% overlap, often good for visual detail.
        const hopSize = Math.max(1, Math.floor(fftSize / 4));

        // Calculate the number of FFT frames (slices) we can actually compute
        const actualSlices = totalSamples < fftSize ? 0 : Math.floor((totalSamples - fftSize) / hopSize) + 1;

        if (actualSlices <= 0) {
            console.warn("Not enough audio samples for the chosen FFT size and hop size.");
            return []; // Return empty array if no slices can be computed
        }
        console.log(`Spectrogram: fftSize=${fftSize}, targetSlices(requested)=${targetSlices}, hopSize=${hopSize}, actualSlices(computed)=${actualSlices}`);

        // Prepare FFT instance and buffers
        const fftInstance = new FFT(fftSize); // Use the global FFT constructor
        const complexBuffer = fftInstance.createComplexArray(); // Reusable output buffer for FFT
        const windowFunc = hannWindow(fftSize); // Precompute window

        if (!windowFunc || typeof windowFunc.length === 'undefined' || windowFunc.length !== fftSize) {
             console.error('Failed to generate Hann window!');
             return null; // Stop if window generation failed
        }

        const spec = []; // Array to hold magnitude arrays for each slice

        for (let i = 0; i < actualSlices; i++) {
            const start = i * hopSize;
            const end = start + fftSize; // We need exactly fftSize samples for the FFT

            // Prepare input buffer for FFT (apply window)
            // IMPORTANT: This library expects a regular Array, not Float32Array for input.
            const fftInput = new Array(fftSize);
            for(let j = 0; j < fftSize; j++) {
                // Apply window. Use 0 for samples beyond the buffer end.
                const sample = (start + j < totalSamples) ? channelData[start + j] : 0;
                fftInput[j] = sample * windowFunc[j];
            }

            // Perform FFT using the realTransform method
            fftInstance.realTransform(complexBuffer, fftInput);

            // Calculate magnitudes (only need the first half: 0 to Nyquist)
            const magnitudes = new Float32Array(fftSize / 2);
            for (let k = 0; k < fftSize / 2; k++) {
                const re = complexBuffer[k * 2];
                const im = complexBuffer[k * 2 + 1];
                // Guard against potential NaN/Infinity
                const magSq = (re * re + im * im);
                magnitudes[k] = Math.sqrt(magSq > 0 ? magSq : 0); // Use magnitude
            }
            spec.push(magnitudes);
        }
        return spec;
    }

    /** Draws the computed spectrogram data onto a canvas */
    function drawSpectrogram(spectrogramData, canvas, sampleRate) {
        const ctx = canvas.getContext('2d');
        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height);

        if (!spectrogramData || spectrogramData.length === 0 || !spectrogramData[0]) {
            console.warn("No spectrogram data to draw.");
             ctx.fillStyle = '#888';
             ctx.textAlign = 'center';
             ctx.fillText("No spectrogram data", width / 2, height / 2);
            return; // Nothing to draw
        }

        const numSlices = spectrogramData.length;
        const numBins = spectrogramData[0].length; // fftSize / 2
        const nyquist = sampleRate / 2;

        // Determine the frequency bin corresponding to our max display frequency
        const maxBinIndex = Math.min(
            numBins - 1, // Highest possible bin index
            Math.floor((SPECTROGRAM_MAX_FREQ / nyquist) * numBins)
        );
        if (maxBinIndex < 0) {
            console.warn("Max frequency results in invalid bin index.");
            return; // Cannot draw if max freq is too low or sample rate is weird
        }

        // --- Find Global Max Magnitude (dB conversion often helps) ---
        // Convert to dB and find min/max for better color mapping range
        let minDb = 0; // dB for silence reference
        let maxDb = -100; // Start low for max dB
        const dbThreshold = -60; // Floor for dB values to avoid -Infinity noise floor issues

        for (let i = 0; i < numSlices; i++) {
            if (spectrogramData[i] && typeof spectrogramData[i].length !== 'undefined') {
                for (let j = 0; j <= maxBinIndex; j++) {
                    const mag = spectrogramData[i][j];
                    // Convert magnitude to dB: 20 * log10(mag / ref)
                    // Using 1 as ref, so 20 * log10(mag). Add small epsilon to avoid log(0)
                    const db = 20 * Math.log10(mag + 1e-9);
                    const clampedDb = Math.max(dbThreshold, db); // Clamp dB value
                    // Update min/max (minDb should ideally be near dbThreshold)
                    if (clampedDb > maxDb) maxDb = clampedDb;
                    // minDb isn't as crucial if we use a fixed threshold, but can track if needed
                    // if (clampedDb < minDb) minDb = clampedDb;
                }
            }
        }
         minDb = dbThreshold; // Use the threshold as the minimum for normalization

        // Dynamic range for normalization
        const dbRange = Math.max(1, maxDb - minDb); // Avoid division by zero

        console.log(`Spectrogram dB range: ${minDb.toFixed(1)} dB to ${maxDb.toFixed(1)} dB (Range: ${dbRange.toFixed(1)} dB)`);

        if(maxDb <= minDb) {
             console.warn("Spectrogram max dB is less than or equal to min dB. Colors might be uniform.");
             // Optionally draw a message indicating low signal
        }

        // --- Draw Slices ---
        // Calculate slice width based on computed number of slices
        const sliceWidth = width / numSlices;

        for (let i = 0; i < numSlices; i++) { // Loop through time slices (horizontal)
             if (!spectrogramData[i] || typeof spectrogramData[i].length === 'undefined') {
                  continue; // Skip this slice if invalid
             }

            const x = i * sliceWidth;
            const magnitudes = spectrogramData[i];

            // Create a temporary canvas for the slice to draw it vertically then copy
            const sliceCanvas = document.createElement('canvas');
            sliceCanvas.width = 1;
            sliceCanvas.height = height;
            const sliceCtx = sliceCanvas.getContext('2d');
            const sliceImageData = sliceCtx.createImageData(1, height);
            const sliceData = sliceImageData.data; // RGBA array

            for (let y = 0; y < height; y++) { // Loop through pixels vertically
                // Map y-pixel to frequency bin index (Logarithmic or Mel scale is often better)
                const freqRatio = (height - 1 - y) / (height - 1); // Linear ratio 0 (top) to 1 (bottom)
                // **Logarithmic frequency mapping** (adjust power for emphasis)
                const logFreqRatio = freqRatio ** 2.5; // Power > 1 emphasizes lower frequencies more
                const binIndex = Math.min(maxBinIndex, Math.floor(logFreqRatio * maxBinIndex));

                const magnitude = magnitudes[binIndex] || 0;
                const db = 20 * Math.log10(magnitude + 1e-9);
                const clampedDb = Math.max(minDb, db);

                // Normalize dB value (0 to 1 range) based on calculated range
                const normValue = (clampedDb - minDb) / dbRange;

                // Map normalized value to color (Viridis)
                const color = viridisColor(Math.min(Math.max(normValue, 0.0), 1.0)); // Clamp to [0, 1]

                // Parse the 'rgb(r,g,b)' string
                const rgb = color.match(/\d+/g);
                if (rgb && rgb.length === 3) {
                    const offset = y * 4;
                    sliceData[offset] = parseInt(rgb[0], 10);     // R
                    sliceData[offset + 1] = parseInt(rgb[1], 10); // G
                    sliceData[offset + 2] = parseInt(rgb[2], 10); // B
                    sliceData[offset + 3] = 255;                  // A (fully opaque)
                }
            }
            // Put the pixel data onto the temporary slice canvas
            sliceCtx.putImageData(sliceImageData, 0, 0);

            // Draw the slice canvas onto the main spectrogram canvas, stretching if needed
            // Using Math.ceil might slightly overlap, floor might leave gaps. Round is often okay.
            ctx.drawImage(sliceCanvas, Math.round(x), 0, Math.max(1, Math.round(sliceWidth)), height);
        }
    }

    // =============================================
    // == CANVAS & WINDOW MANAGEMENT ==
    // =============================================

    /**
     * Adjusts canvas internal buffer size to match CSS display size.
     * Optionally redraws visuals if a resize occurred.
     * @param {boolean} [redraw=true] - Whether to trigger redraw if resize happens and data exists.
     */
    function resizeCanvases(redraw = true) {
        let resized = false;
        [waveformCanvas, spectrogramCanvas].forEach(canvas => {
            if (!canvas) return; // Guard against missing canvas elements
            const { width, height } = canvas.getBoundingClientRect();
            const roundedWidth = Math.max(10, Math.round(width)); // Ensure minimum width
            const roundedHeight = Math.max(10, Math.round(height)); // Ensure minimum height

            // Only resize if dimensions actually changed
            if (canvas.width !== roundedWidth || canvas.height !== roundedHeight) {
                 canvas.width = roundedWidth;
                 canvas.height = roundedHeight;
                 console.log(`Resized ${canvas.id} to ${canvas.width}x${canvas.height}`);
                 resized = true;
            }
        });
        // Redraw static visuals if data exists AND a resize actually happened
        // Avoid redraw if called from computeAndDrawVisuals itself to prevent loops
        if (decodedBuffer && resized && redraw) {
            console.log("Redrawing visuals after resize...");
            computeAndDrawVisuals(); // Recompute and redraw necessary on resize
        } else if (resized) {
             updateUI(); // At least update progress bar position if resize happened without redraw
        }
    }

    // =============================================
    // == UTILITY FUNCTIONS ==
    // =============================================
    // Note: Could potentially move utility functions to a separate file/module

    /** Formats seconds into MM:SS */
    function formatTime(sec) {
        if (isNaN(sec) || sec < 0) sec = 0;
        const minutes = Math.floor(sec / 60);
        const seconds = Math.floor(sec % 60);
        return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
    }

    /** Generates a Hann window array */
    function hannWindow(length) {
        if (length <= 0) return [];
        let windowArr = new Array(length);
        // Avoid division by zero if length is 1 (though fftSize shouldn't be 1)
        if (length === 1) return [1];
        const denom = length - 1;
        for (let i = 0; i < length; i++) {
            windowArr[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
        }
        return windowArr;
    }

    /** Viridis color map implementation - converts value [0, 1] to 'rgb(r,g,b)' */
    function viridisColor(t) {
        // Smoothed Viridis color map points
        const colors = [
            { t: 0.0, r: 68, g: 1, b: 84 }, { t: 0.1, r: 72, g: 40, b: 120 },
            { t: 0.2, r: 62, g: 74, b: 137 }, { t: 0.3, r: 49, g: 104, b: 142 },
            { t: 0.4, r: 38, g: 130, b: 142 }, { t: 0.5, r: 31, g: 155, b: 137 },
            { t: 0.6, r: 53, g: 178, b: 126 }, { t: 0.7, r: 109, g: 199, b: 104 },
            { t: 0.8, r: 170, g: 217, b: 70 }, { t: 0.9, r: 235, g: 231, b: 35 },
            { t: 1.0, r: 253, g: 231, b: 37 }
        ];

        // Clamp t to the valid range [0, 1]
        t = Math.max(0, Math.min(1, t));

        // Find the two colors to interpolate between
        let c1 = colors[0];
        let c2 = colors[colors.length - 1];
        for (let i = 0; i < colors.length - 1; i++) {
            if (t >= colors[i].t && t <= colors[i+1].t) {
                c1 = colors[i];
                c2 = colors[i+1];
                break;
            }
        }

        // Calculate the interpolation ratio
        const range = c2.t - c1.t;
        const ratio = (range === 0) ? 0 : (t - c1.t) / range;

        // Interpolate R, G, B values
        const r = Math.round(c1.r + ratio * (c2.r - c1.r));
        const g = Math.round(c1.g + ratio * (c2.g - c1.g));
        const b = Math.round(c1.b + ratio * (c2.b - c1.b));

        return `rgb(${r},${g},${b})`;
    }


    // --- Removed embedded FFT code here ---


    // =============================================
    // == PUBLIC INTERFACE ==
    // =============================================
    // Expose only the init function to the outside world.
    return {
        init: init
    };

})(); // End of IIFE

// =============================================
// == GLOBAL EXECUTION ==
// =============================================
// Wait for the DOM to be fully loaded before initializing the player.
document.addEventListener('DOMContentLoaded', AudioPlayer.init);

// --- END OF FILE player.js ---