// Wrap everything in an IIFE (Immediately Invoked Function Expression)
// to avoid polluting the global scope and create a private scope.
const AudioPlayer = (function() {
    'use strict';

    // --- DOM Element References ---
    // These will be assigned in init()
    let fileInput, fileInfo, playPauseButton, jumpBackButton, jumpForwardButton,
        jumpTimeInput, playbackSpeedControl, speedValueDisplay, gainControl,
        gainValueDisplay, timeDisplay, waveformCanvas, spectrogramCanvas,
        spectrogramSpinner, progressBar, progressIndicator, audioEl;

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

    // --- Initialization ---

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
        progressBar = document.getElementById('progressBar');
        progressIndicator = document.getElementById('progressIndicator');
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
     * Connects the <audio> element source after it's loaded.
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
             // Don't reconnect if already connected or no source
             // Note: Can only create one MediaElementSource per element
             return;
         }
         try {
             mediaSource = audioCtx.createMediaElementSource(audioEl);
             mediaSource.connect(gainNode); // Connect source to gain
             console.log("Audio element connected to Web Audio graph.");
         } catch (e) {
              console.error("Error connecting audio element source:", e);
         }
    }

    // --- File Loading and Processing ---

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
        connectAudioElementSource(); // Connect to gain node *after* setting src

        // 2. Decode the *same* file data for visualizations
        spectrogramSpinner.style.display = 'inline'; // Show spinner
        waveformCanvas.getContext('2d').clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
        spectrogramCanvas.getContext('2d').clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);

        try {
            const arrayBuffer = await file.arrayBuffer();
            console.log("Decoding audio data...");
            // Use a separate AudioContext instance for decoding? Sometimes recommended
            // but reusing the main one is often fine for offline decoding.
            decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            console.log(`Audio decoded: ${decodedBuffer.duration.toFixed(2)}s, ${decodedBuffer.sampleRate}Hz`);

            enableControls();
            computeAndDrawVisuals(); // Compute and draw waveform and spectrogram

        } catch (err) {
            console.error('Error decoding or processing audio data:', err); // More general error message
            fileInfo.textContent = `Error processing file: ${err.message}`;
            alert(`Could not process audio file: ${err.message}`);
            disableControls();
        } finally {
            spectrogramSpinner.style.display = 'none'; // Hide spinner
        }
    }

    // --- Playback Controls ---

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
        if (!decodedBuffer || isNaN(audioEl.duration)) return;
        seek(audioEl.currentTime + seconds);
    }

    function seek(time) {
         if (!decodedBuffer || isNaN(audioEl.duration)) return;
         let newTime = Math.max(0, Math.min(time, audioEl.duration));
         audioEl.currentTime = newTime;
         // No need to call updateUI immediately, 'timeupdate' will fire.
         console.log(`Seeked to ${formatTime(newTime)}`);
    }

    function handleCanvasClick(e) {
        if (!decodedBuffer || isNaN(audioEl.duration)) return;
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
        // Ensure pitch preservation is enabled (modern browsers often default, but explicit is good)
        audioEl.preservesPitch = true;
        audioEl.mozPreservesPitch = true; // Firefox legacy
        // webkitPreservesPitch is often unnecessary now
    }

    function handleGainChange() {
        const val = parseFloat(gainControl.value);
        gainValueDisplay.textContent = val.toFixed(2) + "x";
        if (gainNode) {
            // You might want a non-linear mapping (e.g., exponential) for perceived volume
            gainNode.gain.setValueAtTime(val, audioCtx.currentTime);
        }
    }

     function handleKeyDown(e) {
        // Don't interfere with text inputs
        if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
        if (!decodedBuffer) return; // Need audio loaded

        let handled = false;
        switch (e.code) {
            case 'Space':
                togglePlayPause();
                handled = true;
                break;
            case 'ArrowLeft':
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
            e.preventDefault(); // Prevent default browser action (e.g., scrolling)
        }
    }

    function getJumpTime() {
        return parseFloat(jumpTimeInput.value) || 5;
    }

    // --- UI Update ---

    /**
     * Updates the time display and progress indicator based on audio element state.
     */
    function updateUI() {
        if (!decodedBuffer || isNaN(audioEl.duration)) {
            timeDisplay.textContent = "0:00 / 0:00";
            progressIndicator.style.left = "0px";
            return;
        };

        const currentTime = audioEl.currentTime;
        const duration = audioEl.duration;
        const fraction = duration > 0 ? currentTime / duration : 0;

        timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;

        // Update progress indicator position based on the *visible width* of the bar
        const progressBarWidth = progressBar.clientWidth;
        progressIndicator.style.left = (fraction * progressBarWidth) + "px";
    }

    /**
     * Resets UI elements to initial state (e.g., after loading a new file).
     */
     function resetUI() {
         playPauseButton.textContent = 'Play';
         timeDisplay.textContent = "0:00 / 0:00";
         progressIndicator.style.left = "0px";
         // Reset sliders visually? Optional.
         // playbackSpeedControl.value = 1.0;
         // speedValueDisplay.textContent = "1.00x";
         disableControls(); // Disable until file loaded & decoded
     }

     /** Enable playback controls */
     function enableControls() {
          playPauseButton.disabled = false;
          jumpBackButton.disabled = false;
          jumpForwardButton.disabled = false;
          playbackSpeedControl.disabled = false;
     }
     /** Disable playback controls */
      function disableControls() {
          playPauseButton.disabled = true;
          jumpBackButton.disabled = true;
          jumpForwardButton.disabled = true;
          playbackSpeedControl.disabled = true;
     }


    // --- Visualization ---

    /**
     * Orchestrates computing and drawing both waveform and spectrogram.
     */
    function computeAndDrawVisuals() {
        if (!decodedBuffer) return;
        console.log("Computing visualizations...");
        console.time("Visualization Computation");

        // NOTE: Removed resizeCanvases() call from here to prevent recursion

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
        // Use canvas width for target horizontal resolution. Larger FFT size for better freq resolution.
        console.time("Spectrogram compute");
        const spectrogramData = computeSpectrogram(decodedBuffer, SPECTROGRAM_FFT_SIZE, spectrogramWidth);
        console.timeEnd("Spectrogram compute");

        if (spectrogramData && spectrogramData.length > 0) {
            console.time("Spectrogram draw");
            drawSpectrogram(spectrogramData, spectrogramCanvas, decodedBuffer.sampleRate);
            console.timeEnd("Spectrogram draw");
        } else {
             console.warn("Spectrogram computation yielded no data or failed.");
             // Optionally draw a "no data" message on the canvas
        }


        console.timeEnd("Visualization Computation");
        updateUI(); // Update progress/time display now that duration is known
    }

    /** Computes data points for the waveform */
    function computeWaveformData(buffer, targetWidth) {
        const channelCount = buffer.numberOfChannels;
        const bufferLength = buffer.length;
        const sampleRate = buffer.sampleRate;

        // Merge channels for simplicity (average)
        const mergedData = new Float32Array(bufferLength);
        if (channelCount > 1) {
            for (let ch = 0; ch < channelCount; ch++) {
                const channelData = buffer.getChannelData(ch);
                for (let i = 0; i < channelData.length; i++) {
                    mergedData[i] += channelData[i] / channelCount;
                }
            }
        } else {
            // If mono, just copy the data (or getChannelData(0) directly in loop below)
            mergedData.set(buffer.getChannelData(0));
        }


        // Calculate samples per pixel, ensuring it's at least 1
        const samplesPerPixel = Math.max(1, Math.floor(bufferLength / targetWidth));
        const waveform = []; // Store { min, max } pairs

        for (let i = 0; i < targetWidth; i++) {
            const start = i * samplesPerPixel;
            // Ensure 'end' doesn't exceed buffer length
            const end = Math.min(start + samplesPerPixel, bufferLength);

            if (start >= end) { // Handle edge case where width > samples
                 waveform.push({ min: 0, max: 0 });
                 continue;
            }

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

    /** Draws the computed waveform data onto a canvas */
    function drawWaveform(waveformData, canvas) {
        const ctx = canvas.getContext('2d');
        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height);

        if (!waveformData || waveformData.length === 0) return; // No data

        const halfHeight = height / 2;
        const scale = halfHeight * WAVEFORM_HEIGHT_SCALE;

        ctx.beginPath();
        // Draw top edge
        for (let i = 0; i < waveformData.length; i++) {
            // Calculate x based on array index and total points
            const x = (i / waveformData.length) * width;
            const y = halfHeight - waveformData[i].max * scale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        // Draw bottom edge backwards
        for (let i = waveformData.length - 1; i >= 0; i--) {
            const x = (i / waveformData.length) * width;
            const y = halfHeight - waveformData[i].min * scale;
            ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = '#333'; // Darker fill color
        ctx.fill();
    }


    /**
     * Computes spectrogram data using the provided FFT implementation.
     * @param {AudioBuffer} buffer The decoded audio buffer.
     * @param {number} fftSize Power-of-two FFT window size.
     * @param {number} targetSlices Target number of horizontal slices (e.g., canvas width).
     * @returns {Array<Float32Array>} Array of magnitude arrays, one per slice.
     */
    function computeSpectrogram(buffer, fftSize, targetSlices) {
        if (!fft) { // Check if FFT implementation is available
             console.error("FFT implementation not found!");
             return [];
        }
        if ((fftSize & (fftSize - 1)) !== 0 || fftSize <= 1) {
            console.error(`Invalid FFT size: ${fftSize}. Must be a power of two > 1.`);
            return [];
        }

        // Ensure targetSlices is reasonable
        targetSlices = Math.max(1, Math.floor(targetSlices));

        // Use the first channel for spectrogram calculation
        const channelData = buffer.getChannelData(0);
        const totalSamples = channelData.length;

        // --- Calculate hopSize to achieve roughly targetSlices ---
        let hopSize = 1;
        if (totalSamples > fftSize && targetSlices > 1) {
            // Calculate hop based on available space and number of slices needed
            hopSize = Math.max(1, Math.floor((totalSamples - fftSize) / (targetSlices - 1)));
        } else if (targetSlices <= 1 && totalSamples >= fftSize) {
            hopSize = totalSamples; // Only one FFT for the whole thing if target is 1
            targetSlices = 1;
        } else {
            console.warn("Not enough audio samples for the chosen FFT size.");
            return []; // Not enough data for even one FFT window
        }

        // Estimate actual number of slices we will compute
        const actualSlices = Math.floor((totalSamples - fftSize) / hopSize) + 1;
        console.log(`Spectrogram: fftSize=${fftSize}, targetSlices=${targetSlices}, hopSize=${hopSize}, actualSlices=${actualSlices}`);

        // Prepare FFT instance and buffers
        const fftInstance = new fft(fftSize); // Use the imported/embedded faster FFT
        const complexBuffer = fftInstance.createComplexArray(); // Reusable output buffer for FFT
        const windowFunc = hannWindow(fftSize); // Precompute window

        // --- Add Check for Hann Window (Optional but good practice) ---
        if (!windowFunc || typeof windowFunc.length === 'undefined' || windowFunc.length !== fftSize) {
             console.error('Failed to generate Hann window! windowFunc is:', windowFunc);
             return []; // Stop if window generation failed
        }
        // console.log(`Generated Hann window with length: ${windowFunc.length}`); // Can uncomment for debugging
        // --- End Check ---

        const spec = []; // Array to hold magnitude arrays for each slice

        for (let i = 0; i < actualSlices; i++) {
            const start = i * hopSize;
            const end = start + fftSize; // We need exactly fftSize samples for the FFT

            // Get the slice of audio data
            const slice = channelData.slice(start, end);

            // Prepare input buffer for FFT (apply window, handle potential padding)
            // IMPORTANT: This library expects a regular Array, not Float32Array for input.
            const fftInput = new Array(fftSize);
            for(let j = 0; j < fftSize; j++) {
                // Apply window and handle cases where slice is shorter than fftSize (end of file)
                const sample = slice[j] || 0; // Ensure we have a value
                const windowVal = windowFunc[j]; // Get window value
                fftInput[j] = sample * windowVal;
            }

            // Perform FFT using the realTransform method
            // 'complexBuffer' is the output, 'fftInput' is the input
            fftInstance.realTransform(complexBuffer, fftInput);

            // Calculate magnitudes (only need the first half: 0 to Nyquist)
            const magnitudes = new Float32Array(fftSize / 2);
            for (let k = 0; k < fftSize / 2; k++) {
                const re = complexBuffer[k * 2];
                const im = complexBuffer[k * 2 + 1];
                // Guard against potential NaN/Infinity if re/im are somehow invalid
                magnitudes[k] = Math.sqrt(re * re + im * im) || 0;
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

        // --- Find Global Max Magnitude for Consistent Coloring ---
        // This could be done more efficiently in the compute step or by sampling
        let globalMaxMag = 1e-9; // Avoid division by zero
        for (let i = 0; i < numSlices; i++) {
            // Check if spectrogramData[i] exists and is an array/typed array
            if (spectrogramData[i] && typeof spectrogramData[i].length !== 'undefined') {
                for (let j = 0; j <= maxBinIndex; j++) {
                    const mag = spectrogramData[i][j];
                    if (mag > globalMaxMag) {
                        globalMaxMag = mag;
                    }
                }
            } else {
                 console.warn(`Spectrogram slice ${i} is invalid:`, spectrogramData[i]);
            }
        }
        console.log("Spectrogram Global Max Magnitude:", globalMaxMag);
        if(globalMaxMag <= 1e-9) {
             console.warn("Spectrogram max magnitude is near zero. Colors might be incorrect.");
             // Optionally draw a message indicating low signal
        }

        // --- Draw Slices ---
        const sliceWidth = width / numSlices;

        for (let i = 0; i < numSlices; i++) { // Loop through time slices (horizontal)
             // Check again if data for this slice is valid before proceeding
             if (!spectrogramData[i] || typeof spectrogramData[i].length === 'undefined') {
                  continue; // Skip this slice if invalid
             }

            const x = i * sliceWidth;
            const magnitudes = spectrogramData[i];

            for (let y = 0; y < height; y++) { // Loop through pixels vertically
                // Map y-pixel to frequency bin index (non-linear mapping)
                // Squaring the ratio emphasizes lower frequencies
                const freqRatio = ((height - 1 - y) / (height - 1)); // Ratio 0 (top) to 1 (bottom)
                const binIndex = Math.min(maxBinIndex, Math.floor((freqRatio ** 2) * maxBinIndex)); // Ensure index is within bounds

                const magnitude = magnitudes[binIndex] || 0;

                // Normalize magnitude (0 to 1 range). Sqrt often looks better visually.
                // Add a small epsilon to globalMaxMag to prevent division by zero if it's truly zero
                const normMag = Math.sqrt(magnitude / (globalMaxMag + 1e-9));

                // Map normalized magnitude to color
                const color = viridisColor(Math.min(normMag, 1.0)); // Clamp to ensure valid color map input

                ctx.fillStyle = color;
                // Use Math.ceil to potentially avoid tiny gaps between slices if sliceWidth is fractional
                ctx.fillRect(Math.floor(x), y, Math.ceil(sliceWidth), 1); // Floor x for consistency
            }
        }
    }

    /** Adjusts canvas internal size to match CSS display size */
    function resizeCanvases() {
        let resized = false;
        [waveformCanvas, spectrogramCanvas].forEach(canvas => {
            const { width, height } = canvas.getBoundingClientRect();
            const roundedWidth = Math.round(width);
            const roundedHeight = Math.round(height);
            if (canvas.width !== roundedWidth || canvas.height !== roundedHeight) {
                 canvas.width = roundedWidth;
                 canvas.height = roundedHeight;
                 console.log(`Resized ${canvas.id} to ${canvas.width}x${canvas.height}`);
                 resized = true;
            }
        });
        // Redraw static visuals if data exists AND a resize actually happened
        if (decodedBuffer && resized) {
            console.log("Redrawing visuals after resize...");
            // Recomputing might be too slow, just redraw if data is kept
            // For now, let's recompute for simplicity, but could optimize later
            // by storing computed data and only redrawing.
             computeAndDrawVisuals();
        }
    }

    // --- Utility Functions ---

    /** Formats seconds into MM:SS */
    function formatTime(sec) {
        if (isNaN(sec) || sec < 0) sec = 0;
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s < 10 ? '0' + s : s}`;
    }

    /** Generates a Hann window array */
    function hannWindow(length) {
        let windowArr = new Array(length);
        const denom = length - 1;
        // Avoid division by zero if length is 1 (though fftSize shouldn't be 1)
        if (denom <= 0) return windowArr.fill(1);
        for (let i = 0; i < length; i++) {
            windowArr[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
        }
        return windowArr;
    }

    /** Viridis color map implementation */
    function viridisColor(t) {
        // (Keep your existing viridisColor implementation here)
        const colors = [
            { t: 0.0, r: 68, g: 1, b: 84 }, { t: 0.1, r: 72, g: 40, b: 120 }, // Smoother start
            { t: 0.2, r: 62, g: 74, b: 137 }, { t: 0.3, r: 49, g: 104, b: 142 },
            { t: 0.4, r: 38, g: 130, b: 142 }, { t: 0.5, r: 31, g: 155, b: 137 }, // Mid point adjusted slightly
            { t: 0.6, r: 53, g: 178, b: 126 }, { t: 0.7, r: 109, g: 199, b: 104 },
            { t: 0.8, r: 170, g: 217, b: 70 }, { t: 0.9, r: 235, g: 231, b: 35 }, // Smoother end
            { t: 1.0, r: 253, g: 231, b: 37 }
        ];
        // Handle edge cases
        t = Math.max(0, Math.min(1, t)); // Clamp t to [0, 1]
        if (t === 0.0) return `rgb(${colors[0].r},${colors[0].g},${colors[0].b})`;
        if (t === 1.0) return `rgb(${colors[colors.length-1].r},${colors[colors.length-1].g},${colors[colors.length-1].b})`;

        // Interpolate
        for (let i = 0; i < colors.length - 1; i++) {
            if (t >= colors[i].t && t <= colors[i+1].t) {
                const ratio = (t - colors[i].t) / (colors[i+1].t - colors[i].t);
                const r = Math.round(colors[i].r + ratio * (colors[i+1].r - colors[i].r));
                const g = Math.round(colors[i].g + ratio * (colors[i+1].g - colors[i].g));
                const b = Math.round(colors[i].b + ratio * (colors[i+1].b - colors[i].b));
                return `rgb(${r},${g},${b})`;
            }
        }
        // Fallback (shouldn't be reached if clamping and loop are correct)
        const lastColor = colors[colors.length-1];
        return `rgb(${lastColor.r},${lastColor.g},${lastColor.b})`;
    }

    // --- Faster FFT Implementation (Embedded) ---
    /* --- START OF FFT.js content --- */
    // NOTE: 'use strict' is already applied by the outer IIFE

    function FFT(size) {
      this.size = size | 0;
      if (this.size <= 1 || (this.size & (this.size - 1)) !== 0)
        throw new Error('FFT size must be a power of two and bigger than 1');

      this._csize = size << 1;

      // NOTE: Use of `var` is intentional for old V8 versions
      var table = new Array(this.size * 2);
      for (var i = 0; i < table.length; i += 2) {
        const angle = Math.PI * i / this.size;
        table[i] = Math.cos(angle);
        table[i + 1] = -Math.sin(angle);
      }
      this.table = table;

      // Find size's power of two
      var power = 0;
      for (var t = 1; this.size > t; t <<= 1)
        power++;

      // Calculate initial step's width:
      //   * If we are full radix-4 - it is 2x smaller to give inital len=8
      //   * Otherwise it is the same as `power` to give len=4
      this._width = power % 2 === 0 ? power - 1 : power;

      // Pre-compute bit-reversal patterns
      this._bitrev = new Array(1 << this._width);
      for (var j = 0; j < this._bitrev.length; j++) {
        this._bitrev[j] = 0;
        for (var shift = 0; shift < this._width; shift += 2) {
          var revShift = this._width - shift - 2;
          this._bitrev[j] |= ((j >>> shift) & 3) << revShift;
        }
      }

      this._out = null;
      this._data = null;
      this._inv = 0;
    }
    // module.exports = FFT; // <-- REMOVED FOR BROWSER

    FFT.prototype.fromComplexArray = function fromComplexArray(complex, storage) {
      var res = storage || new Array(complex.length >>> 1);
      for (var i = 0; i < complex.length; i += 2)
        res[i >>> 1] = complex[i];
      return res;
    };

    FFT.prototype.createComplexArray = function createComplexArray() {
      const res = new Array(this._csize);
      for (var i = 0; i < res.length; i++)
        res[i] = 0;
      return res;
    };

    FFT.prototype.toComplexArray = function toComplexArray(input, storage) {
      var res = storage || this.createComplexArray();
      for (var i = 0; i < res.length; i += 2) {
        res[i] = input[i >>> 1];
        res[i + 1] = 0;
      }
      return res;
    };

    FFT.prototype.completeSpectrum = function completeSpectrum(spectrum) {
      var size = this._csize;
      var half = size >>> 1;
      for (var i = 2; i < half; i += 2) {
        spectrum[size - i] = spectrum[i];
        spectrum[size - i + 1] = -spectrum[i + 1];
      }
    };

    FFT.prototype.transform = function transform(out, data) {
      if (out === data)
        throw new Error('Input and output buffers must be different');

      this._out = out;
      this._data = data;
      this._inv = 0;
      this._transform4();
      this._out = null;
      this._data = null;
    };

    FFT.prototype.realTransform = function realTransform(out, data) {
      if (out === data)
        throw new Error('Input and output buffers must be different');

      this._out = out;
      this._data = data;
      this._inv = 0;
      this._realTransform4();
      this._out = null;
      this._data = null;
    };

    FFT.prototype.inverseTransform = function inverseTransform(out, data) {
      if (out === data)
        throw new Error('Input and output buffers must be different');

      this._out = out;
      this._data = data;
      this._inv = 1;
      this._transform4();
      for (var i = 0; i < out.length; i++)
        out[i] /= this.size;
      this._out = null;
      this._data = null;
    };

    // radix-4 implementation
    //
    // NOTE: Uses of `var` are intentional for older V8 version that do not
    // support both `let compound assignments` and `const phi`
    FFT.prototype._transform4 = function _transform4() {
      var out = this._out;
      var size = this._csize;

      // Initial step (permute and transform)
      var width = this._width;
      var step = 1 << width;
      var len = (size / step) << 1;

      var outOff;
      var t;
      var bitrev = this._bitrev;
      if (len === 4) {
        for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
          const off = bitrev[t];
          this._singleTransform2(outOff, off, step);
        }
      } else {
        // len === 8
        for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
          const off = bitrev[t];
          this._singleTransform4(outOff, off, step);
        }
      }

      // Loop through steps in decreasing order
      var inv = this._inv ? -1 : 1;
      var table = this.table;
      for (step >>= 2; step >= 2; step >>= 2) {
        len = (size / step) << 1;
        var quarterLen = len >>> 2;

        // Loop through offsets in the data
        for (outOff = 0; outOff < size; outOff += len) {
          // Full case
          var limit = outOff + quarterLen;
          for (var i = outOff, k = 0; i < limit; i += 2, k += step) {
            const A = i;
            const B = A + quarterLen;
            const C = B + quarterLen;
            const D = C + quarterLen;

            // Original values
            const Ar = out[A];
            const Ai = out[A + 1];
            const Br = out[B];
            const Bi = out[B + 1];
            const Cr = out[C];
            const Ci = out[C + 1];
            const Dr = out[D];
            const Di = out[D + 1];

            // Middle values
            const MAr = Ar;
            const MAi = Ai;

            const tableBr = table[k];
            const tableBi = inv * table[k + 1];
            const MBr = Br * tableBr - Bi * tableBi;
            const MBi = Br * tableBi + Bi * tableBr;

            const tableCr = table[2 * k];
            const tableCi = inv * table[2 * k + 1];
            const MCr = Cr * tableCr - Ci * tableCi;
            const MCi = Cr * tableCi + Ci * tableCr;

            const tableDr = table[3 * k];
            const tableDi = inv * table[3 * k + 1];
            const MDr = Dr * tableDr - Di * tableDi;
            const MDi = Dr * tableDi + Di * tableDr;

            // Pre-Final values
            const T0r = MAr + MCr;
            const T0i = MAi + MCi;
            const T1r = MAr - MCr;
            const T1i = MAi - MCi;
            const T2r = MBr + MDr;
            const T2i = MBi + MDi;
            const T3r = inv * (MBr - MDr);
            const T3i = inv * (MBi - MDi);

            // Final values
            const FAr = T0r + T2r;
            const FAi = T0i + T2i;

            const FCr = T0r - T2r;
            const FCi = T0i - T2i;

            const FBr = T1r + T3i;
            const FBi = T1i - T3r;

            const FDr = T1r - T3i;
            const FDi = T1i + T3r;

            out[A] = FAr;
            out[A + 1] = FAi;
            out[B] = FBr;
            out[B + 1] = FBi;
            out[C] = FCr;
            out[C + 1] = FCi;
            out[D] = FDr;
            out[D + 1] = FDi;
          }
        }
      }
    };

    // radix-2 implementation
    //
    // NOTE: Only called for len=4
    FFT.prototype._singleTransform2 = function _singleTransform2(outOff, off,
                                                                 step) {
      const out = this._out;
      const data = this._data;

      const evenR = data[off];
      const evenI = data[off + 1];
      const oddR = data[off + step];
      const oddI = data[off + step + 1];

      const leftR = evenR + oddR;
      const leftI = evenI + oddI;
      const rightR = evenR - oddR;
      const rightI = evenI - oddI;

      out[outOff] = leftR;
      out[outOff + 1] = leftI;
      out[outOff + 2] = rightR;
      out[outOff + 3] = rightI;
    };

    // radix-4
    //
    // NOTE: Only called for len=8
    FFT.prototype._singleTransform4 = function _singleTransform4(outOff, off,
                                                                 step) {
      const out = this._out;
      const data = this._data;
      const inv = this._inv ? -1 : 1;
      const step2 = step * 2;
      const step3 = step * 3;

      // Original values
      const Ar = data[off];
      const Ai = data[off + 1];
      const Br = data[off + step];
      const Bi = data[off + step + 1];
      const Cr = data[off + step2];
      const Ci = data[off + step2 + 1];
      const Dr = data[off + step3];
      const Di = data[off + step3 + 1];

      // Pre-Final values
      const T0r = Ar + Cr;
      const T0i = Ai + Ci;
      const T1r = Ar - Cr;
      const T1i = Ai - Ci;
      const T2r = Br + Dr;
      const T2i = Bi + Di;
      const T3r = inv * (Br - Dr);
      const T3i = inv * (Bi - Di);

      // Final values
      const FAr = T0r + T2r;
      const FAi = T0i + T2i;

      const FBr = T1r + T3i;
      const FBi = T1i - T3r;

      const FCr = T0r - T2r;
      const FCi = T0i - T2i;

      const FDr = T1r - T3i;
      const FDi = T1i + T3r;

      out[outOff] = FAr;
      out[outOff + 1] = FAi;
      out[outOff + 2] = FBr;
      out[outOff + 3] = FBi;
      out[outOff + 4] = FCr;
      out[outOff + 5] = FCi;
      out[outOff + 6] = FDr;
      out[outOff + 7] = FDi;
    };

    // Real input radix-4 implementation
    FFT.prototype._realTransform4 = function _realTransform4() {
      var out = this._out;
      var size = this._csize;

      // Initial step (permute and transform)
      var width = this._width;
      var step = 1 << width;
      var len = (size / step) << 1;

      var outOff;
      var t;
      var bitrev = this._bitrev;
      if (len === 4) {
        for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
          const off = bitrev[t];
          this._singleRealTransform2(outOff, off >>> 1, step >>> 1);
        }
      } else {
        // len === 8
        for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
          const off = bitrev[t];
          this._singleRealTransform4(outOff, off >>> 1, step >>> 1);
        }
      }

      // Loop through steps in decreasing order
      var inv = this._inv ? -1 : 1;
      var table = this.table;
      for (step >>= 2; step >= 2; step >>= 2) {
        len = (size / step) << 1;
        var halfLen = len >>> 1;
        var quarterLen = halfLen >>> 1;
        var hquarterLen = quarterLen >>> 1;

        // Loop through offsets in the data
        for (outOff = 0; outOff < size; outOff += len) {
          for (var i = 0, k = 0; i <= hquarterLen; i += 2, k += step) {
            var A = outOff + i;
            var B = A + quarterLen;
            var C = B + quarterLen;
            var D = C + quarterLen;

            // Original values
            var Ar = out[A];
            var Ai = out[A + 1];
            var Br = out[B];
            var Bi = out[B + 1];
            var Cr = out[C];
            var Ci = out[C + 1];
            var Dr = out[D];
            var Di = out[D + 1];

            // Middle values
            var MAr = Ar;
            var MAi = Ai;

            var tableBr = table[k];
            var tableBi = inv * table[k + 1];
            var MBr = Br * tableBr - Bi * tableBi;
            var MBi = Br * tableBi + Bi * tableBr;

            var tableCr = table[2 * k];
            var tableCi = inv * table[2 * k + 1];
            var MCr = Cr * tableCr - Ci * tableCi;
            var MCi = Cr * tableCi + Ci * tableCr;

            var tableDr = table[3 * k];
            var tableDi = inv * table[3 * k + 1];
            var MDr = Dr * tableDr - Di * tableDi;
            var MDi = Dr * tableDi + Di * tableDr;

            // Pre-Final values
            var T0r = MAr + MCr;
            var T0i = MAi + MCi;
            var T1r = MAr - MCr;
            var T1i = MAi - MCi;
            var T2r = MBr + MDr;
            var T2i = MBi + MDi;
            var T3r = inv * (MBr - MDr);
            var T3i = inv * (MBi - MDi);

            // Final values
            var FAr = T0r + T2r;
            var FAi = T0i + T2i;

            var FBr = T1r + T3i;
            var FBi = T1i - T3r;

            out[A] = FAr;
            out[A + 1] = FAi;
            out[B] = FBr;
            out[B + 1] = FBi;

            // Output final middle point
            if (i === 0) {
              var FCr = T0r - T2r;
              var FCi = T0i - T2i;
              out[C] = FCr;
              out[C + 1] = FCi;
              continue;
            }

            // Do not overwrite ourselves
            if (i === hquarterLen)
              continue;

            // In the flipped case:
            // MAi = -MAi
            // MBr=-MBi, MBi=-MBr
            // MCr=-MCr
            // MDr=MDi, MDi=MDr
            var ST0r = T1r;
            var ST0i = -T1i;
            var ST1r = T0r;
            var ST1i = -T0i;
            var ST2r = -inv * T3i;
            var ST2i = -inv * T3r;
            var ST3r = -inv * T2i;
            var ST3i = -inv * T2r;

            var SFAr = ST0r + ST2r;
            var SFAi = ST0i + ST2i;

            var SFBr = ST1r + ST3i;
            var SFBi = ST1i - ST3r;

            var SA = outOff + quarterLen - i;
            var SB = outOff + halfLen - i;

            out[SA] = SFAr;
            out[SA + 1] = SFAi;
            out[SB] = SFBr;
            out[SB + 1] = SFBi;
          }
        }
      }
    };

    // radix-2 implementation
    //
    // NOTE: Only called for len=4
    FFT.prototype._singleRealTransform2 = function _singleRealTransform2(outOff,
                                                                         off,
                                                                         step) {
      const out = this._out;
      const data = this._data;

      const evenR = data[off];
      const oddR = data[off + step];

      const leftR = evenR + oddR;
      const rightR = evenR - oddR;

      out[outOff] = leftR;
      out[outOff + 1] = 0;
      out[outOff + 2] = rightR;
      out[outOff + 3] = 0;
    };

    // radix-4
    //
    // NOTE: Only called for len=8
    FFT.prototype._singleRealTransform4 = function _singleRealTransform4(outOff,
                                                                         off,
                                                                         step) {
      const out = this._out;
      const data = this._data;
      const inv = this._inv ? -1 : 1;
      const step2 = step * 2;
      const step3 = step * 3;

      // Original values
      const Ar = data[off];
      const Br = data[off + step];
      const Cr = data[off + step2];
      const Dr = data[off + step3];

      // Pre-Final values
      const T0r = Ar + Cr;
      const T1r = Ar - Cr;
      const T2r = Br + Dr;
      const T3r = inv * (Br - Dr);

      // Final values
      const FAr = T0r + T2r;

      const FBr = T1r;
      const FBi = -T3r;

      const FCr = T0r - T2r;

      const FDr = T1r;
      const FDi = T3r;

      out[outOff] = FAr;
      out[outOff + 1] = 0;
      out[outOff + 2] = FBr;
      out[outOff + 3] = FBi;
      out[outOff + 4] = FCr;
      out[outOff + 5] = 0;
      out[outOff + 6] = FDr;
      out[outOff + 7] = FDi;
    };

    // Make the FFT constructor available via the lowercase 'fft' variable
    const fft = FFT;
    /* --- END OF FFT.js content --- */


    // --- Public Interface ---
    // Expose only the init function to the outside world.
    return {
        init: init
    };

})(); // End of IIFE

// --- Global Execution ---
// Wait for the DOM to be fully loaded before initializing the player.
document.addEventListener('DOMContentLoaded', AudioPlayer.init);