// /vibe-player/js/visualizer.js

/**
 * Handles drawing the waveform and spectrogram visualizations,
 * including VAD region highlighting and playback progress indication.
 */
const visualizer = (() => {
    // --- Private Module State ---
    let config = null;
    let audioBuffer = null;
    let vadRegions = null; // Array of { start, end } in seconds

    // Canvas elements and contexts
    let waveformCanvas = null;
    let waveformCtx = null;
    let spectrogramCanvas = null;
    let spectrogramCtx = null;
    let waveformProgressIndicator = null;
    let spectrogramProgressIndicator = null;

    // Spectrogram caching
    let spectrogramOffscreenCanvas = null;
    let spectrogramOffscreenCtx = null;
    let isSpectrogramComputing = false;
    let spectrogramNeedsRedraw = false;

    // Precomputed waveform data
    let waveformData = null;

    // --- Private Methods ---

    /** Cache DOM elements and get rendering contexts. */
    function cacheDomElements() {
        waveformCanvas = document.getElementById('waveformCanvas');
        spectrogramCanvas = document.getElementById('spectrogramCanvas');
        waveformProgressIndicator = document.getElementById('waveformProgressIndicator');
        spectrogramProgressIndicator = document.getElementById('spectrogramProgressIndicator');

        if (!waveformCanvas || !spectrogramCanvas || !waveformProgressIndicator || !spectrogramProgressIndicator) {
            console.error("[Visualizer] Failed to find required canvas or progress elements.");
            return false;
        }

        waveformCtx = waveformCanvas.getContext('2d');
        spectrogramCtx = spectrogramCanvas.getContext('2d');

        if (!waveformCtx || !spectrogramCtx) {
            console.error("[Visualizer] Failed to get 2D rendering contexts.");
            return false;
        }
        return true;
    }

     /** Attaches event listeners. */
     function attachEventListeners() {
         // Listen for audio readiness to get data and draw initial visuals
         document.addEventListener('audioapp:audioReady', handleAudioReady);

         // Listen for time updates from the worklet manager
         document.addEventListener('audioapp:workletTimeUpdate', handleTimeUpdate);

         // Listen for window resize to redraw canvases
         window.addEventListener('resize', handleResize);

         // Add click listeners for seeking
         waveformCanvas?.addEventListener('click', handleCanvasClick);
         spectrogramCanvas?.addEventListener('click', handleCanvasClick);
     }

    /** Handles the audioReady event, storing data and triggering drawing. */
    function handleAudioReady(event) {
        if (!event.detail || !event.detail.buffer) {
            console.error("[Visualizer] Invalid audioReady event received.");
            return;
        }
        console.log("[Visualizer] Received audioReady event.");
        audioBuffer = event.detail.buffer;
        vadRegions = event.detail.vad?.regions || []; // Use provided regions or empty array

        // Reset state for new audio
        waveformData = null;
        spectrogramOffscreenCanvas = null; // Clear spectrogram cache
        updateProgressIndicator(0); // Reset progress indicator visually

        // Compute and draw visuals
        computeAndDrawVisuals();
    }

     /** Handles time updates from the worklet manager. */
     function handleTimeUpdate(event) {
         if (!audioBuffer || audioBuffer.duration <= 0) return; // No duration, nothing to update against
         const currentTime = event.detail.currentTime ?? 0;
         const progress = currentTime / audioBuffer.duration;
         updateProgressIndicator(progress);
     }

     /** Handles canvas clicks to dispatch seek requests. */
     function handleCanvasClick(event) {
         if (!audioBuffer || audioBuffer.duration <= 0) return;

         const canvas = event.target;
         const rect = canvas.getBoundingClientRect();
         const x = event.clientX - rect.left;
         // Use clientWidth for accurate visible width corresponding to CSS/layout
         const progress = x / canvas.clientWidth;
         const seekTime = progress * audioBuffer.duration;

         console.log(`[Visualizer] Seek requested to ${seekTime.toFixed(3)}s (Progress: ${progress.toFixed(3)})`);
         document.dispatchEvent(new CustomEvent('audioapp:seekRequested', {
             detail: { positionSeconds: seekTime }
         }));
     }


     /** Handles window resize events. */
     function handleResize() {
         // Debounce resize events for performance? (Simple version for now)
         console.log("[Visualizer] Handling resize.");
         resizeAndRedraw();
     }

    /** Computes waveform data from the AudioBuffer. */
    function computeWaveformData() {
        if (!audioBuffer) return;
        console.log("[Visualizer] Computing waveform data...");
        const channelData = audioBuffer.getChannelData(0); // Use first channel for waveform
        const numSamples = channelData.length;
         // Use actual canvas render width for calculation step
        const width = waveformCanvas?.width || 1;
        if (width <= 1) {
             console.warn("[Visualizer] Waveform canvas width too small for data computation.");
             waveformData = [];
             return;
        };
        const step = Math.max(1, Math.ceil(numSamples / width)); // Ensure step is at least 1
        const amps = [];

        for (let i = 0; i < width; i++) {
            const start = i * step;
            const end = Math.min(start + step, numSamples);
            let min = 1.0;
            let max = -1.0;
            // Ensure start is less than end before looping
            if (start < end) {
                 for (let j = start; j < end; j++) {
                     const sample = channelData[j];
                     if (sample < min) min = sample;
                     if (sample > max) max = sample;
                 }
            } else {
                 min = 0; max = 0;
             }
            amps.push({ min, max });
        }
        waveformData = amps;
        console.log("[Visualizer] Waveform data computed.");
    }

    /** Draws the waveform onto the canvas. */
    function drawWaveform() {
        if (!waveformCtx || !waveformCanvas || !waveformData) return;

        const width = waveformCanvas.width;
        const height = waveformCanvas.height;
        const centerY = height / 2;
        const waveColor = config?.visualization?.waveformColor || '#3498db';
        const highlightColor = config?.visualization?.waveformHighlightColor || '#e67e22';

        waveformCtx.clearRect(0, 0, width, height);
        waveformCtx.strokeStyle = '#ccc';
        waveformCtx.lineWidth = 1;
        waveformCtx.beginPath();
        waveformCtx.moveTo(0, centerY);
        waveformCtx.lineTo(width, centerY);
        waveformCtx.stroke();

        waveformCtx.strokeStyle = waveColor;
        waveformCtx.lineWidth = 1;
        waveformCtx.beginPath();
        waveformData.forEach((amp, i) => {
             const yMin = centerY + amp.min * centerY;
             const yMax = centerY + amp.max * centerY;
             waveformCtx.moveTo(i + 0.5, Math.max(0, Math.min(height, yMin)));
             waveformCtx.lineTo(i + 0.5, Math.max(0, Math.min(height, yMax)));
        });
        waveformCtx.stroke();

         if (vadRegions && vadRegions.length > 0 && audioBuffer && audioBuffer.duration > 0) {
             waveformCtx.fillStyle = highlightColor + '80';
             vadRegions.forEach(region => {
                 const startX = (region.start / audioBuffer.duration) * width;
                 const endX = (region.end / audioBuffer.duration) * width;
                 const regionWidth = Math.max(1, endX - startX);
                 if (startX < width && endX > 0) {
                     waveformCtx.fillRect(Math.floor(startX), 0, Math.ceil(regionWidth), height);
                 }
             });
         }
    }

    // --- >> Ensure viridisColor helper function from reference code is present << ---
    // (Or define it here if not already present in the visualizer scope)
    /**
     * Viridis Colormap Lookup/Interpolation.
     * @param {number} t - Normalized value [0, 1].
     * @returns {Array<number>} [r, g, b] array (0-255).
     */
    function viridisColor(t) {
        // Input t is normalized value [0, 1]
        // Output is [r, g, b] array, 0-255
        // Simple lookup table based interpolation (can be precomputed)
        const colors = [ // [t, r, g, b]
            [0.0, 68, 1, 84], [0.1, 72, 40, 120], [0.2, 62, 74, 137],
            [0.3, 49, 104, 142], [0.4, 38, 130, 142], [0.5, 31, 155, 137],
            [0.6, 53, 178, 126], [0.7, 109, 199, 104], [0.8, 170, 217, 70],
            [0.9, 235, 231, 35], [1.0, 253, 231, 37] // End ~Yellow
        ];
        t = Math.max(0, Math.min(1, t)); // Clamp t

        // Find surrounding colors in the map
        let c1 = colors[0];
        let c2 = colors[colors.length - 1];
        for (let i = 0; i < colors.length - 1; i++) {
            if (t >= colors[i][0] && t <= colors[i + 1][0]) {
                c1 = colors[i];
                c2 = colors[i + 1];
                break;
            }
        }
        // Interpolate between c1 and c2
        const range = c2[0] - c1[0];
        const ratio = (range === 0) ? 0 : (t - c1[0]) / range;
        const r = Math.round(c1[1] + ratio * (c2[1] - c1[1]));
        const g = Math.round(c1[2] + ratio * (c2[2] - c1[2]));
        const b = Math.round(c1[3] + ratio * (c2[3] - c1[3]));
        return [r, g, b];
    }
     // --- >> End of viridisColor function << ---


    /** Computes and draws the spectrogram (potentially async). */
    async function computeAndDrawSpectrogram() {
        // ... (Initial checks: audioBuffer, canvas, context, isSpectrogramComputing) ...
        // ... (Show Loading UI, console logs) ...

        // Ensure FFT constructor exists
        if (typeof FFT !== 'function') { /* ... error handling ... */ return; }

        const channelData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const fftSize = config?.visualization?.fftSize || 1024;
        const hopLength = config?.visualization?.hopLength || Math.floor(fftSize / 4);
        const maxFreq = config?.visualization?.spectrogramMaxFreq || 12000; // Get max freq from config

         // ... (Validate parameters) ...

        const numFrames = Math.floor((channelData.length - fftSize) / hopLength) + 1;
        const numBins = fftSize / 2;

        // Target canvas dimensions for drawing (used later for scaling)
        // const targetWidth = spectrogramCanvas.width; // Not directly used for offscreen rendering
        // const targetHeight = spectrogramCanvas.height;

        // --- >> Use fixed internal width for offscreen rendering (like reference) << ---
        const fixedOffscreenWidth = config?.visualization?.spectrogramFixedWidth || 2048; // From config or default

         // Create or resize offscreen canvas - Use FIXED width, numBins height
         if (!spectrogramOffscreenCanvas || spectrogramOffscreenCanvas.width !== fixedOffscreenWidth || spectrogramOffscreenCanvas.height !== numBins) {
             spectrogramOffscreenCanvas = new OffscreenCanvas(fixedOffscreenWidth, numBins);
             spectrogramOffscreenCtx = spectrogramOffscreenCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
             console.log(`[Visualizer] Created/Resized offscreen spectrogram canvas: ${fixedOffscreenWidth}x${numBins}`);
         }
         // --- >> Create ImageData matching the OFFSCREEN canvas size << ---
         const imageData = spectrogramOffscreenCtx.createImageData(fixedOffscreenWidth, numBins);
         const data = imageData.data; // RGBA array

        try {
            // --- Create FFT instance and buffers ---
            const fftInstance = new FFT(fftSize, sampleRate);
             if (!fftInstance || typeof fftInstance.realTransform !== 'function' || typeof fftInstance.createComplexArray !== 'function') {
                 throw new Error("FFT library methods mismatch (expected realTransform).");
             }
            const complexBuffer = fftInstance.createComplexArray();
            const fftInput = new Float32Array(fftSize);
            const windowFunc = hannWindow(fftSize);
             if (!windowFunc) throw new Error("Failed to create Hann window.");

            // --- >> Calculate magnitudes for ALL raw frames first << ---
            console.log(`[Visualizer] Calculating FFT for ${numFrames} raw frames...`);
            const rawMagnitudes = []; // Store Float32Arrays of magnitudes squared
            let maxMagSquaredOverall = 0;
            for (let i = 0; i < numFrames; i++) {
                 const frameStart = i * hopLength;
                 for (let j = 0; j < fftSize; j++) { // Apply window
                      const sampleIndex = frameStart + j;
                      const sample = (sampleIndex < channelData.length) ? channelData[sampleIndex] : 0;
                      fftInput[j] = sample * windowFunc[j];
                 }
                 fftInstance.realTransform(complexBuffer, fftInput); // Perform FFT

                 const frameMagSquared = new Float32Array(numBins);
                 for (let j = 0; j < numBins; j++) { // Calculate magnitude squared
                      const real = complexBuffer[j * 2];
                      const imag = complexBuffer[j * 2 + 1];
                      const magSq = real * real + imag * imag;
                      frameMagSquared[j] = magSq;
                      if (magSq > maxMagSquaredOverall) maxMagSquaredOverall = magSq;
                 }
                 rawMagnitudes.push(frameMagSquared);
            }
            console.log(`[Visualizer] Raw FFT calculation complete. Max mag^2: ${maxMagSquaredOverall}`);
             if (rawMagnitudes.length === 0) {
                 throw new Error("FFT processing resulted in zero valid magnitude frames.");
             }
            // --- >> End Raw FFT Calculation << ---


            // --- >> Resample/Select Slices to Match Fixed Width << ---
            console.log(`[Visualizer] Resampling ${numFrames} raw slices to ${fixedOffscreenWidth} target slices...`);
            const resampledMagnitudes = new Array(fixedOffscreenWidth);
            const numRawSlices = rawMagnitudes.length;
            if (numRawSlices === fixedOffscreenWidth) {
                 // If counts match exactly, just copy references.
                 for (let i = 0; i < numRawSlices; i++) {
                     resampledMagnitudes[i] = rawMagnitudes[i];
                 }
             } else {
                 // If counts differ, pick the nearest raw slice for each target slice position.
                 for (let i = 0; i < fixedOffscreenWidth; i++) {
                     const t = (fixedOffscreenWidth > 1) ? (i / (fixedOffscreenWidth - 1)) : 0;
                     const rawPos = t * (numRawSlices - 1);
                     const nearestIndex = Math.min(numRawSlices - 1, Math.max(0, Math.round(rawPos)));
                     resampledMagnitudes[i] = rawMagnitudes[nearestIndex]; // Assign the reference
                 }
             }
            console.log("[Visualizer] Resampling complete.");
            // --- >> End Resampling << ---


            // --- >> Normalization based on dB and range (like reference) << ---
            const maxLog = maxMagSquaredOverall > 1e-18 ? Math.log10(maxMagSquaredOverall) : -9; // Use log of max mag squared
            const minLogDb = -80; // Increase dynamic range slightly? Default was -60
            const minLog = maxMagSquaredOverall > 1e-18 ? maxLog + (minLogDb / 10) : -14; // Adjust default min accordingly
            const range = Math.max(1e-6, maxLog - minLog);
             console.log(`[Visualizer] Spectrogram dB range (log10 mag^2): ${minLog.toFixed(1)} to ${maxLog.toFixed(1)}`);
            // --- >> End Normalization Setup << ---

             // --- >> Determine Max Bin Index based on maxFreq << ---
             const nyquist = sampleRate / 2;
             const maxBinIndex = Math.min(
                 numBins - 1,
                 Math.floor((maxFreq / nyquist) * (numBins - 1))
             );
             console.log(`[Visualizer] Max frequency: ${maxFreq}Hz maps to max bin index: ${maxBinIndex} (out of ${numBins-1})`);
             // --- >> End Max Bin Calculation << ---


             // --- >> Render to Offscreen Canvas using new logic << ---
             // Now loop through the RESAMPLED magnitudes
             const drawNumFrames = resampledMagnitudes.length; // Should match fixedOffscreenWidth
             const drawNumBins = resampledMagnitudes[0]?.length || 0; // Should match numBins

             if (drawNumFrames === 0 || drawNumBins === 0) {
                 throw new Error("No valid resampled magnitude data to draw.");
             }

             console.log(`[Visualizer] Rendering ${drawNumFrames}x${drawNumBins} spectrogram data to offscreen canvas...`);
             for (let i = 0; i < drawNumFrames; i++) { // x-axis (time slices = offscreen width)
                 const magnitudesSlice = resampledMagnitudes[i];
                 if (!magnitudesSlice) continue; // Skip if slice data is missing

                 for (let y = 0; y < numBins; y++) { // y-axis (frequency bins = offscreen height)
                     // Map vertical pixel y to frequency bin index using log-like scale
                      // freqRatio goes 0 (high freq) to 1 (low freq) as y goes 0 to numBins-1
                     const freqRatio = y / (numBins - 1);
                      // Power > 1 emphasizes lower frequencies
                     const logFreqRatio = Math.pow(freqRatio, 2.0); // Quadratic emphasis
                      // Map the log-scaled ratio to the bin index, clamped to maxBinIndex
                     const binIndex = Math.min(maxBinIndex, Math.floor(logFreqRatio * maxBinIndex));

                      // Get magnitude squared for the calculated bin
                     const magSquared = magnitudesSlice[binIndex] || 0;
                     const logMag = magSquared > 1e-18 ? Math.log10(magSquared) : minLog - 1; // Use log(mag^2)
                     const clampedLogMag = Math.max(minLog, logMag); // Apply floor threshold
                     const normValue = range > 0 ? (clampedLogMag - minLog) / range : 0; // Normalize [0, 1]

                      // --- Use Viridis Colormap ---
                     const [r, g, b] = viridisColor(normValue);

                     // Calculate pixel index in the ImageData array.
                     // y is inverted (0 is top), so map (numBins - 1 - y)
                     // (x, y_pixel) maps to index: (x + y_pixel * width) * 4
                     const pixelIndex = (i + (numBins - 1 - y) * fixedOffscreenWidth) * 4;

                     if (pixelIndex >= 0 && pixelIndex + 3 < data.length) {
                         data[pixelIndex] = r; data[pixelIndex + 1] = g; data[pixelIndex + 2] = b; data[pixelIndex + 3] = 255;
                     } else if (i===0 && y === 0) { console.error(`[Visualizer Debug] Calculated pixelIndex ${pixelIndex} out of bounds for imageData (length ${data.length})`); }
                 }
             }
             spectrogramOffscreenCtx.putImageData(imageData, 0, 0);
             console.log("[Visualizer] Spectrogram data drawn to offscreen canvas using Viridis/Log scale.");
             // --- >> End Offscreen Rendering << ---

            // Cache the result
             cachedSpectrogramCanvas = spectrogramOffscreenCanvas;

            // Draw from offscreen canvas to visible canvas immediately
            drawSpectrogramFromOffscreen();

        } catch (error) {
            console.error("[Visualizer] Error computing/rendering spectrogram:", error);
             AudioApp.uiManager?.showError(`Spectrogram failed: ${error.message}`);
        } finally {
            isSpectrogramComputing = false;
             AudioApp.uiManager?.showLoading(false); // Hide spinner
            if (spectrogramNeedsRedraw) {
                 console.log("[Visualizer] Redrawing spectrogram after computation due to pending resize.");
                 resizeAndRedraw(); // Will redraw from cache now
             }
        }
    }

     // --- Include hannWindow function ---
     /**
      * Generates a Hann window array. Used to reduce spectral leakage in FFT.
      * @param {number} length - The desired window length (should match fftSize).
      * @returns {Float32Array|null} The Hann window array, or null if length is invalid.
      * @private
      */
     function hannWindow(length) {
         if (length <= 0) return null;
         let windowArr = new Float32Array(length);
         if (length === 1) { windowArr[0] = 1; return windowArr; }
         const denom = length - 1;
         for (let i = 0; i < length; i++) {
             windowArr[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
         }
         return windowArr;
     }
      // --- End of hannWindow function ---


    /** Draws the cached spectrogram from the offscreen canvas to the visible one. */
    function drawSpectrogramFromOffscreen() {
        if (!spectrogramCtx || !spectrogramCanvas || !spectrogramOffscreenCanvas) return;
        const targetWidth = spectrogramCanvas.width;
        const targetHeight = spectrogramCanvas.height;
        spectrogramCtx.clearRect(0, 0, targetWidth, targetHeight);
        spectrogramCtx.imageSmoothingEnabled = false;
        spectrogramCtx.drawImage(spectrogramOffscreenCanvas, 0, 0, spectrogramOffscreenCanvas.width, spectrogramOffscreenCanvas.height, 0, 0, targetWidth, targetHeight);
    }

    /** Updates the position of the progress indicator line. */
    function updateProgressIndicator(progressRatio) {
        const progress = Math.max(0, Math.min(1, progressRatio));
        const percent = `${progress * 100}%`;
        if (waveformProgressIndicator) { waveformProgressIndicator.style.left = percent; }
        if (spectrogramProgressIndicator) { spectrogramProgressIndicator.style.left = percent; }
    }

    /** Resizes canvases to fit container width and redraws content. */
    function resizeAndRedraw() {
        let didResize = false;
        [waveformCanvas, spectrogramCanvas].forEach(canvas => {
            if (!canvas) return;
            const containerWidth = canvas.parentElement.clientWidth;
            if (canvas.width !== containerWidth) {
                 canvas.width = Math.max(1, containerWidth);
                 didResize = true;
                 console.log(`[Visualizer] Resized ${canvas.id} to width: ${canvas.width}`);
            }
        });

        if (didResize && audioBuffer) {
             computeAndDrawVisuals();
        } else if (didResize) {
             waveformCtx?.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
             spectrogramCtx?.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
         }
    }

     /** Computes and draws both waveform and spectrogram. */
     function computeAndDrawVisuals() {
          if (!audioBuffer) return;
          resizeAndRedraw();
          if (isSpectrogramComputing) return;
          computeWaveformData();
          drawWaveform();
          computeAndDrawSpectrogram(); // Uses .realTransform() now
     }

    // --- Public API ---
    return {
        /** Initializes the Visualizer. */
        init(appConfig) {
            config = appConfig;
            if (!cacheDomElements()) { throw new Error("Visualizer initialization failed: DOM elements missing."); }
            attachEventListeners();
            waveformCanvas.height = config.visualization.waveformHeight;
            spectrogramCanvas.height = config.visualization.spectrogramHeight;
            resizeAndRedraw();
            console.log("Visualizer initialized.");
        },
        /** Updates the progress indicator position. */
        updateProgressIndicator: (progressRatio) => updateProgressIndicator(progressRatio),
        /** Redraws only the VAD highlighting on the waveform. */
         redrawWaveformHighlight: (newVadRegions) => {
             console.log("[Visualizer] Redrawing VAD highlights.");
             vadRegions = newVadRegions || [];
             if (waveformData) { drawWaveform(); }
         }
    };
})();

// Attach to the global AudioApp namespace
if (typeof window.AudioApp === 'undefined') {
    window.AudioApp = {};
}
window.AudioApp.visualizer = visualizer;
console.log("Visualizer module loaded.");

// /vibe-player/js/visualizer.js
