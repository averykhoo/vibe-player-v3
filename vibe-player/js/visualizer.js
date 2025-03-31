// --- /vibe-player/js/visualizer.js ---
// Handles drawing Waveform and Spectrogram visualizations to canvas elements.
// Uses FFT.js for spectrogram calculation. Manages canvas resizing and progress indicators.

var AudioApp = AudioApp || {}; // Ensure namespace exists

// Design Decision: Use IIFE, pass the global FFT constructor dependency.
AudioApp.visualizer = (function(globalFFT) {
    'use strict';

     // Check if the required FFT library is available
     if (typeof globalFFT === 'undefined') {
        console.error("Visualizer: CRITICAL - FFT library constructor not found globally!");
        // Return a non-functional public interface
        return {
             init: () => {},
             /** @returns {Promise<void>} */ computeAndDrawVisuals: () => Promise.resolve(),
             redrawWaveformHighlight: () => {},
             resizeAndRedraw: () => {},
             updateProgressIndicator: () => {},
             clearVisuals: () => {},
             showSpinner: () => {}
         };
    }

    // --- DOM Element References ---
    /** @type {HTMLCanvasElement|null} */ let waveformCanvas;
    /** @type {CanvasRenderingContext2D|null} */ let waveformCtx;
    /** @type {HTMLCanvasElement|null} */ let spectrogramCanvas;
    /** @type {CanvasRenderingContext2D|null} */ let spectrogramCtx;
    /** @type {HTMLSpanElement|null} */ let spectrogramSpinner;
    /** @type {HTMLDivElement|null} */ let waveformProgressIndicator;
    /** @type {HTMLDivElement|null} */ let spectrogramProgressIndicator;

    // --- Configuration ---
    /** @const {number} How much vertical space the waveform uses (0 to 1) */
    const WAVEFORM_HEIGHT_SCALE = 0.8;
    /** @const {number} FFT window size for longer files */
    const NORMAL_FFT_SIZE = 8192;
    /** @const {number} FFT window size for shorter files */
    const SHORT_FFT_SIZE = 2048; // Use smaller FFT for better time resolution on short files
    /** @const {number} Duration threshold (seconds) to switch FFT size */
    const SHORT_FILE_FFT_THRESHOLD_S = 10.0; // Files shorter than this use SHORT_FFT_SIZE
    /** @const {number} Max frequency (Hz) to display on spectrogram Y-axis */
    const SPECTROGRAM_MAX_FREQ = 12000;
    /** @const {number} Fixed internal width for spectrogram calculation/caching. */
    const SPEC_FIXED_WIDTH = 2048;
    /** @const {number} Duration threshold (seconds) below which a smaller hopSize is used */
    const SHORT_FILE_HOP_THRESHOLD_S = 5.0; // Keep separate threshold for hop size adjustment if desired
    /** @const {number} FFT hop size divisor for normal files (fftSize / 4 = 75% overlap) */
    const NORMAL_HOP_DIVISOR = 4;
    /** @const {number} FFT hop size divisor for short files (e.g., fftSize / 8 = 87.5% overlap) */
    const SHORT_HOP_DIVISOR = 8;
    /** @const {boolean} Whether to center the FFT windows conceptually for padding */
    const CENTER_WINDOWS = true;
    /** @const {string} Waveform initial/loading color */
    const WAVEFORM_COLOR_LOADING = '#888888'; // Light Gray
    /** @const {string} Waveform default/non-speech color */
    const WAVEFORM_COLOR_DEFAULT = '#26828E'; // Teal (Original Default)
    /** @const {string} Waveform speech highlight color (Viridis Yellow ~1.0) */
    const WAVEFORM_COLOR_SPEECH = '#FDE725';


    // --- State ---
    /**
     * Offscreen canvas for caching the fully rendered spectrogram at SPEC_FIXED_WIDTH.
     * @type {HTMLCanvasElement|null}
     */
    let cachedSpectrogramCanvas = null;


    // --- Initialization ---

    /**
     * Initializes the Visualizer module.
     * @public
     */
    function init() {
        console.log("Visualizer: Initializing...");
        assignDOMElements();
        console.log("Visualizer: Initialized.");
    }

    /**
     * Gets references to canvas elements and contexts, adds listeners.
     * @private
     */
    function assignDOMElements() {
        waveformCanvas = document.getElementById('waveformCanvas');
        spectrogramCanvas = document.getElementById('spectrogramCanvas');
        spectrogramSpinner = document.getElementById('spectrogramSpinner');
        waveformProgressIndicator = document.getElementById('waveformProgressIndicator');
        spectrogramProgressIndicator = document.getElementById('spectrogramProgressIndicator');

        if (waveformCanvas) { waveformCtx = waveformCanvas.getContext('2d'); waveformCanvas.addEventListener('click', handleCanvasClick); }
        else { console.warn("Visualizer: Waveform canvas not found."); }
        if (spectrogramCanvas) { spectrogramCtx = spectrogramCanvas.getContext('2d'); spectrogramCanvas.addEventListener('click', handleCanvasClick); }
        else { console.warn("Visualizer: Spectrogram canvas not found."); }
    }

    // --- Event Handlers ---

    /**
     * Handles click events on canvases for seeking.
     * @param {MouseEvent} e - The click event.
     * @private
     */
     function handleCanvasClick(e) {
        const canvas = /** @type {HTMLCanvasElement} */ (e.target);
        const rect = canvas.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;
        const clickXRelative = e.clientX - rect.left;
        const fraction = Math.max(0, Math.min(1, clickXRelative / rect.width));
        document.dispatchEvent(new CustomEvent('audioapp:seekRequested', { detail: { fraction: fraction } }));
    }


    // --- Core Drawing & Computation ---

    /**
     * Computes and draws both visuals for the given audio buffer.
     * @param {AudioBuffer} audioBuffer - The original, decoded audio buffer.
     * @param {Array<{start: number, end: number}>} speechRegions - The initial speech regions.
     * @returns {Promise<void>} Resolves when async drawing is complete.
     * @public
     */
    async function computeAndDrawVisuals(audioBuffer, speechRegions) {
        if (!audioBuffer) { console.warn("Visualizer: AudioBuffer missing."); return; }
        if (!waveformCtx || !spectrogramCtx) { console.warn("Visualizer: Canvas context missing."); return; }
        console.log("Visualizer: Starting computation and drawing...");
        const startTime = performance.now();

        clearVisuals();
        resizeCanvasesInternal(false); // Resize before drawing

        // --- Waveform ---
        console.time("Waveform compute");
        const waveformData = computeWaveformData(audioBuffer, waveformCanvas.width);
        console.timeEnd("Waveform compute");
        console.time("Waveform draw");
        // Pass width explicitly to drawing function
        drawWaveform(waveformData, waveformCanvas, waveformCtx, speechRegions, audioBuffer.duration, waveformCanvas.width);
        console.timeEnd("Waveform draw");

        // --- Spectrogram ---
        cachedSpectrogramCanvas = null;
        showSpinner(true);
        console.time("Spectrogram compute");
        // Dynamic FFT Size based on duration
        const actualFftSize = audioBuffer.duration < SHORT_FILE_FFT_THRESHOLD_S ? SHORT_FFT_SIZE : NORMAL_FFT_SIZE;
        console.log(`Visualizer: Using FFT Size: ${actualFftSize} for duration ${audioBuffer.duration.toFixed(2)}s`);
        const spectrogramData = computeSpectrogram(audioBuffer, actualFftSize, SPEC_FIXED_WIDTH);
        console.timeEnd("Spectrogram compute");

        if (spectrogramData && spectrogramData.length > 0) {
             console.time("Spectrogram draw (async)");
             try {
                // Draw asynchronously to offscreen canvas, then display
                await drawSpectrogramAsync(spectrogramData, spectrogramCanvas, audioBuffer.sampleRate, actualFftSize); // Pass actualFftSize
                console.timeEnd("Spectrogram draw (async)");
             } catch (error) {
                  console.error("Visualizer: Error drawing spectrogram asynchronously -", error);
                  spectrogramCtx.fillStyle = '#D32F2F'; spectrogramCtx.textAlign = 'center'; spectrogramCtx.font = '14px sans-serif';
                  spectrogramCtx.fillText(`Spectrogram Error: ${error.message}`, spectrogramCanvas.width / 2, spectrogramCanvas.height / 2);
             } finally {
                showSpinner(false);
             }
        } else {
             console.warn("Visualizer: Spectrogram computation yielded no data or failed.");
             spectrogramCtx.fillStyle = '#888'; spectrogramCtx.textAlign = 'center'; spectrogramCtx.font = '12px sans-serif';
             spectrogramCtx.fillText("Could not compute spectrogram", spectrogramCanvas.width / 2, spectrogramCanvas.height / 2);
             showSpinner(false);
        }

        const endTime = performance.now();
        console.log(`Visualizer: Visuals processing took ${((endTime - startTime)/1000).toFixed(2)}s.`);
        updateProgressIndicator(0, audioBuffer.duration);
    }

    /**
     * Redraws waveform highlighting without full recompute of other visuals.
     * Recomputes waveform data for current size and redraws with speech highlights.
     * @param {AudioBuffer|null} audioBuffer - The current audio buffer.
     * @param {Array<{start: number, end: number}>} speechRegions - The calculated speech regions.
     * @public
     */
    function redrawWaveformHighlight(audioBuffer, speechRegions) {
         if (!audioBuffer) {
             console.warn("Visualizer: Cannot redraw highlight, AudioBuffer missing.");
             return;
         }
         if (!waveformCanvas || !waveformCtx) {
              console.warn("Visualizer: Cannot redraw highlight, Waveform canvas/context missing.");
              return;
         }
         const width = waveformCanvas.width; // Get current width
         if (width <= 0) {
             console.warn("Visualizer: Cannot redraw highlight, Waveform canvas width is zero.");
             return;
         }
         console.log("Visualizer: Redrawing waveform highlights...");
         // Recompute waveform data for the current canvas width
         const waveformData = computeWaveformData(audioBuffer, width);
         // Call drawWaveform with the new regions. It will now use default+speech colors.
         drawWaveform(waveformData, waveformCanvas, waveformCtx, speechRegions, audioBuffer.duration, width);
    }

    // --- Computation Helper Functions ---

    /**
     * Computes simplified waveform data (min/max pairs per pixel column).
     * @param {AudioBuffer} buffer
     * @param {number} targetWidth
     * @returns {Array<{min: number, max: number}>}
     * @private
     */
    function computeWaveformData(buffer, targetWidth) {
        if (!buffer || !buffer.getChannelData || targetWidth <= 0) return [];
        const channelCount = buffer.numberOfChannels;
        const bufferLength = buffer.length;
        if (bufferLength === 0) return [];

        // --- Get Mono Data ---
        // Use channel 0 if mono, otherwise average channels
        let sourceData;
        if (channelCount === 1) {
            sourceData = buffer.getChannelData(0);
        } else {
            sourceData = new Float32Array(bufferLength).fill(0);
            for (let ch = 0; ch < channelCount; ch++) {
                const channelData = buffer.getChannelData(ch);
                for (let i = 0; i < bufferLength; i++) {
                    sourceData[i] += channelData[i];
                }
            }
            // Average the channels
            for (let i = 0; i < bufferLength; i++) {
                sourceData[i] /= channelCount;
            }
        }

        // --- Compute Min/Max per Pixel ---
        const samplesPerPixel = Math.max(1, Math.floor(bufferLength / targetWidth));
        const waveform = [];
        for (let i = 0; i < targetWidth; i++) {
            const start = Math.floor(i * samplesPerPixel);
            const end = Math.min(start + samplesPerPixel, bufferLength);

            if (start >= end) {
                // Handle cases where samplesPerPixel > 1 and we are at the very end
                waveform.push({min: 0, max: 0});
                continue;
            }

            let min = 1.0, max = -1.0;
            for (let j = start; j < end; j++) {
                const sample = sourceData[j];
                if (sample < min) min = sample;
                if (sample > max) max = sample;
            }
            waveform.push({min, max});
        }
        return waveform;
    }

    /**
     * Computes spectrogram data. Uses FFT.js.
     * Applies Replication Padding based on CENTER_WINDOWS flag.
     * Uses adaptive hopSize for short audio files.
     * Handles resampling time slices using LINEAR INTERPOLATION.
     * @param {AudioBuffer} buffer
     * @param {number} actualFftSize - The dynamically chosen FFT size.
     * @param {number} targetSlices - Fixed width for the output/cached spectrogram data (SPEC_FIXED_WIDTH).
     * @returns {Array<Float32Array>|null} Array of magnitude arrays (one per time slice), or null on error.
     * @private
     */
     function computeSpectrogram(buffer, actualFftSize, targetSlices) {
        if (!buffer || !buffer.getChannelData) { console.error("Visualizer: Invalid AudioBuffer"); return null; }
        if ((actualFftSize & (actualFftSize - 1)) !== 0 || actualFftSize <= 1) { console.error(`Visualizer: Invalid FFT size: ${actualFftSize}`); return null; }

        const channelData = buffer.getChannelData(0);
        const totalSamples = channelData.length;
        const duration = buffer.duration;

        // Adaptive hopSize Calculation (uses actualFftSize)
        const hopDivisor = duration < SHORT_FILE_HOP_THRESHOLD_S ? SHORT_HOP_DIVISOR : NORMAL_HOP_DIVISOR;
        const hopSize = Math.max(1, Math.floor(actualFftSize / hopDivisor));

        const padding = CENTER_WINDOWS ? Math.floor(actualFftSize / 2) : 0;
        const rawSliceCount = CENTER_WINDOWS
            ? Math.ceil(totalSamples / hopSize)
            : (totalSamples < actualFftSize ? 0 : Math.floor((totalSamples - actualFftSize) / hopSize) + 1);

        if (rawSliceCount <= 0) { console.warn("Visualizer: Not enough audio samples for FFT with current settings."); return []; }

        const fftInstance = new globalFFT(actualFftSize); // Use actual size
        const complexBuffer = fftInstance.createComplexArray(); // Use actual size
        const fftInput = new Array(actualFftSize); // Use actual size
        const windowFunc = hannWindow(actualFftSize); // Use actual size
        if (!windowFunc) return null;

        const rawSpec = [];
        for (let i = 0; i < rawSliceCount; i++) {
            const windowCenterSample = i * hopSize;
            const windowFetchStart = windowCenterSample - padding;

            for (let j = 0; j < actualFftSize; j++) { // Use actual size
                const sampleIndex = windowFetchStart + j;
                let sampleValue;
                // Replication Padding
                if (sampleIndex < 0) { sampleValue = channelData[0]; }
                else if (sampleIndex >= totalSamples) { sampleValue = totalSamples > 0 ? channelData[totalSamples - 1] : 0.0; }
                else { sampleValue = channelData[sampleIndex]; }
                fftInput[j] = sampleValue * windowFunc[j];
            }

            fftInstance.realTransform(complexBuffer, fftInput); // Use actual size

            const numBins = actualFftSize / 2; // Use actual size
            const magnitudes = new Float32Array(numBins); // Use actual size
            for (let k = 0; k < numBins; k++) { // Use actual size
                const re = complexBuffer[k * 2];
                const im = complexBuffer[k * 2 + 1];
                const magSq = (re * re + im * im);
                // Convert to Magnitude (sqrt) - use 0 for negative squared values (numerical precision issues)
                magnitudes[k] = Math.sqrt(magSq > 0 ? magSq : 0);
            }
            rawSpec.push(magnitudes);
        }

        // --- Resample/Interpolate Slices ---
        const numRawSlices = rawSpec.length;
        if (numRawSlices === 0) return [];
        const numFreqBins = rawSpec[0].length; // Based on actualFftSize / 2
        /** @type {Array<Float32Array>} */
        const finalSpec = new Array(targetSlices);

        if (numRawSlices === targetSlices) {
             // Direct copy if sizes match
             for (let i = 0; i < numRawSlices; i++) { finalSpec[i] = rawSpec[i]; }
        } else if (numRawSlices > 0) {
            // --- LINEAR INTERPOLATION ---
            for (let i = 0; i < targetSlices; i++) {
                 // Calculate the corresponding position in the raw spectrogram
                 const rawPos = (numRawSlices > 1) ? (i / (targetSlices - 1)) * (numRawSlices - 1) : 0;
                 const index1 = Math.floor(rawPos);
                 const index2 = Math.min(numRawSlices - 1, Math.ceil(rawPos)); // Clamp index2
                 const factor = rawPos - index1; // Weight for index2

                 const magnitudes1 = rawSpec[index1];
                 const magnitudes2 = rawSpec[index2];

                 finalSpec[i] = new Float32Array(numFreqBins); // Ensure correct bin count

                 // Interpolate each frequency bin
                 if (index1 === index2 || factor === 0) {
                     // If exact match or factor is 0, just copy magnitudes1
                     finalSpec[i].set(magnitudes1);
                 } else {
                     for (let k = 0; k < numFreqBins; k++) { // Use actual bin count
                         finalSpec[i][k] = magnitudes1[k] * (1.0 - factor) + magnitudes2[k] * factor;
                     }
                 }
            }
        }
        return finalSpec;
    }


    /**
     * Generates a Hann window array.
     * @param {number} length
     * @returns {Array<number>|null}
     * @private
     */
    function hannWindow(length) {
        if (length <= 0) return null;
        let windowArr = new Array(length);
        if (length === 1) {
            windowArr[0] = 1;
            return windowArr;
        }
        const denom = length - 1;
        for (let i = 0; i < length; i++) {
            windowArr[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
        }
        return windowArr;
    }

    // --- Drawing Helper Functions ---

    /**
     * Draws the waveform, highlighting speech regions with specific colors.
     * Uses WAVEFORM_COLOR_LOADING if speechRegions is empty/null.
     * @param {Array<{min: number, max: number}>} waveformData - Min/max pairs per pixel.
     * @param {HTMLCanvasElement} canvas - The target canvas element.
     * @param {CanvasRenderingContext2D} ctx - The canvas context.
     * @param {Array<{start: number, end: number}>|null|undefined} speechRegions - Array of speech time regions, or null/empty for initial draw.
     * @param {number} audioDuration - Total duration of the audio in seconds.
     * @param {number} width - The current width of the canvas.
     * @private
     */
     function drawWaveform(waveformData, canvas, ctx, speechRegions, audioDuration, width) {
        if (!ctx) return;

        const { height } = canvas;
        ctx.clearRect(0, 0, width, height);

        if (!waveformData || waveformData.length === 0 || !audioDuration || audioDuration <= 0) {
            ctx.fillStyle = '#888'; // Keep error text grey
            ctx.textAlign = 'center';
            ctx.font = '12px sans-serif';
            ctx.fillText("No waveform data", width / 2, height / 2);
            return;
        }

        const dataLen = waveformData.length;
        const halfHeight = height / 2;
        const scale = halfHeight * WAVEFORM_HEIGHT_SCALE;
        const pixelsPerSecond = width / audioDuration;

        // Determine if we are doing the initial draw (no regions yet)
        const initialDraw = !speechRegions || speechRegions.length === 0;
        const defaultColor = initialDraw ? WAVEFORM_COLOR_LOADING : WAVEFORM_COLOR_DEFAULT;

        // Convert speech time regions to pixel regions only if needed
        const speechPixelRegions = initialDraw ? [] : (speechRegions || []).map(r => ({
            startPx: r.start * pixelsPerSecond,
            endPx: r.end * pixelsPerSecond
        }));

        // Calculate pixel width - MUST use the width used for computation
        const pixelWidth = width / dataLen;

        // --- Draw Default/Loading Waveform Color ---
        ctx.fillStyle = defaultColor;
        ctx.beginPath();
        for (let i = 0; i < dataLen; i++) {
            const x = i * pixelWidth;
            const currentPixelEnd = x + pixelWidth;

            // Check if this pixel column is OUTSIDE any speech region (if we have regions)
            let isOutsideSpeech = true;
            if (!initialDraw) {
                for (const region of speechPixelRegions) {
                    // A pixel is inside if its start is before the region end AND its end is after the region start
                    if (x < region.endPx && currentPixelEnd > region.startPx) {
                        isOutsideSpeech = false;
                        break;
                    }
                }
            } // else: if initialDraw, isOutsideSpeech remains true

            if (isOutsideSpeech) {
                const { min, max } = waveformData[i];
                const y1 = halfHeight - max * scale; // Top of rect
                const y2 = halfHeight - min * scale; // Bottom of rect (min is negative)
                // Draw rectangle for this pixel column
                // Use Math.max(1, ...) for height to ensure visibility even for near-zero values
                ctx.rect(x, y1, pixelWidth, Math.max(1, y2 - y1));
            }
        }
        ctx.fill(); // Fill all non-speech (or all if initialDraw) parts

        // --- Draw Speech Highlights (Yellow) - Only if NOT initialDraw ---
        if (!initialDraw) {
            ctx.fillStyle = WAVEFORM_COLOR_SPEECH; // Use yellow
            ctx.beginPath();
            for (let i = 0; i < dataLen; i++) {
                const x = i * pixelWidth;
                const currentPixelEnd = x + pixelWidth;

                // Check if this pixel column is INSIDE any speech region
                let isInsideSpeech = false;
                for (const region of speechPixelRegions) {
                    if (x < region.endPx && currentPixelEnd > region.startPx) {
                        isInsideSpeech = true;
                        break;
                    }
                }

                if (isInsideSpeech) {
                    const { min, max } = waveformData[i];
                    const y1 = halfHeight - max * scale;
                    const y2 = halfHeight - min * scale;
                    ctx.rect(x, y1, pixelWidth, Math.max(1, y2 - y1));
                }
            }
            ctx.fill(); // Fill all speech parts yellow
        }
    }

    /**
     * Draws the spectrogram asynchronously, adapting to FFT size.
     * @param {Array<Float32Array>} spectrogramData
     * @param {HTMLCanvasElement} canvas
     * @param {number} sampleRate
     * @param {number} actualFftSize - The FFT size used to generate the data.
     * @returns {Promise<void>}
     * @private
     */
    function drawSpectrogramAsync(spectrogramData, canvas, sampleRate, actualFftSize) { // Accept actualFftSize
        return new Promise((resolve, reject) => {
            if (!canvas) return reject(new Error("Spectrogram target canvas not found"));
            if (!spectrogramData || spectrogramData.length === 0 || !spectrogramData[0]) {
                console.warn("Visualizer: No valid spectrogram data to draw async.");
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = '#888'; ctx.textAlign = 'center'; ctx.font = '12px sans-serif';
                    ctx.fillText("No spectrogram data", canvas.width / 2, canvas.height / 2);
                }
                return resolve(); // Resolve successfully even if no data
            }

            const displayCtx = canvas.getContext('2d');
            if (!displayCtx) return reject(new Error("Could not get 2D context for spectrogram canvas"));

            displayCtx.clearRect(0, 0, canvas.width, canvas.height); // Clear the display canvas

            // --- Setup Offscreen Canvas ---
            // Create or reuse offscreen canvas matching the *data* dimensions (for caching)
            if (!cachedSpectrogramCanvas || cachedSpectrogramCanvas.width !== spectrogramData.length || cachedSpectrogramCanvas.height !== canvas.height) {
                 cachedSpectrogramCanvas = document.createElement('canvas');
                 cachedSpectrogramCanvas.width = spectrogramData.length; // Width based on computed slices
                 cachedSpectrogramCanvas.height = canvas.height; // Height based on display canvas
                 console.log(`Visualizer: Created/resized spectrogram cache canvas (${cachedSpectrogramCanvas.width}x${cachedSpectrogramCanvas.height})`);
            }
            const offCtx = cachedSpectrogramCanvas.getContext('2d', { willReadFrequently: false }); // Use cached canvas
            if (!offCtx) return reject(new Error("Could not get 2D context for offscreen spectrogram"));


            // --- Calculation Constants ---
            const computedSlices = spectrogramData.length;
            const height = cachedSpectrogramCanvas.height; // Use offscreen height
            // Use the *actual* number of bins based on the FFT size used
            const numBins = actualFftSize / 2; // spectrogramData[0].length should also match this
            const nyquist = sampleRate / 2;
            // Recalculate maxBinIndex based on the actual number of bins and desired max frequency
            const maxBinIndex = Math.min(numBins - 1, Math.floor((SPECTROGRAM_MAX_FREQ / nyquist) * (numBins - 1)));

            // --- Calculate dB Range ---
            const dbThreshold = -60; // Floor for dB values
            let maxDb = -Infinity;
            // Optimization: Sample dB range calculation
            const sliceStep = Math.max(1, Math.floor(computedSlices / 100)); // Check ~100 slices
            const binStep = Math.max(1, Math.floor(maxBinIndex / 50)); // Check ~50 bins per slice
            for (let i = 0; i < computedSlices; i += sliceStep) {
                const magnitudes = spectrogramData[i];
                // Basic check if magnitudes array exists for this slice
                 if (!magnitudes || magnitudes.length === 0) continue;
                for (let j = 0; j <= maxBinIndex; j += binStep) {
                     // Check if index j is valid for this magnitude array
                     if (j >= magnitudes.length) break; // Avoid reading out of bounds
                     // Add small epsilon to avoid log10(0)
                     const db = 20 * Math.log10((magnitudes[j] || 0) + 1e-9);
                     maxDb = Math.max(maxDb, Math.max(dbThreshold, db)); // Apply threshold here too
                }
            }
            maxDb = Math.max(maxDb, dbThreshold + 1); // Ensure maxDb is slightly above threshold
            const minDb = dbThreshold;
            const dbRange = maxDb - minDb;

            // --- Viridis Colormap Function ---
            // (Remains the same)
            function viridisColor(t) { const colors = [ [0.0, 68, 1, 84], [0.1, 72, 40, 120], [0.2, 62, 74, 137], [0.3, 49, 104, 142], [0.4, 38, 130, 142], [0.5, 31, 155, 137], [0.6, 53, 178, 126], [0.7, 109, 199, 104], [0.8, 170, 217, 70], [0.9, 235, 231, 35], [1.0, 253, 231, 37] ]; t = Math.max(0, Math.min(1, t)); let c1 = colors[0]; let c2 = colors[colors.length - 1]; for (let i = 0; i < colors.length - 1; i++) { if (t >= colors[i][0] && t <= colors[i + 1][0]) { c1 = colors[i]; c2 = colors[i + 1]; break; } } const range = c2[0] - c1[0]; const ratio = (range === 0) ? 0 : (t - c1[0]) / range; const r = Math.round(c1[1] + ratio * (c2[1] - c1[1])); const g = Math.round(c1[2] + ratio * (c2[2] - c1[2])); const b = Math.round(c1[3] + ratio * (c2[3] - c1[3])); return [r, g, b]; }

            // --- Async Drawing Loop ---
            const fullImageData = offCtx.createImageData(computedSlices, height); // Use computedSlices for width
            const data = fullImageData.data;
            let currentSlice = 0;
            const chunkSize = 32; // Draw in chunks for responsiveness

            function drawChunk() {
                try {
                    const startSlice = currentSlice;
                    const endSlice = Math.min(startSlice + chunkSize, computedSlices);

                    for (let i = startSlice; i < endSlice; i++) { // Iterate horizontally (time slices)
                        if (!spectrogramData[i]) continue; // Skip if slice data missing
                        const magnitudes = spectrogramData[i];

                        // Check if magnitudes array has expected length
                        if (magnitudes.length !== numBins) {
                             console.warn(`Spectrogram Draw: Slice ${i} has ${magnitudes.length} bins, expected ${numBins}. Skipping.`);
                             continue; // Skip drawing this potentially corrupted slice
                        }

                        for (let y = 0; y < height; y++) { // Iterate vertically (frequency pixels)
                            // Map pixel y to frequency bin index (logarithmic scale)
                            const freqRatio = (height - 1 - y) / (height - 1); // 0 (low freq) to 1 (high freq)
                            // Exponential scaling for pseudo-logarithmic frequency axis
                            const logFreqRatio = Math.pow(freqRatio, 2.0); // Adjust exponent (e.g., 1.5, 2.0, 2.5) for scale
                            // Use maxBinIndex calculated based on actual numBins and SPECTROGRAM_MAX_FREQ
                            const binIndex = Math.min(maxBinIndex, Math.floor(logFreqRatio * maxBinIndex));

                            const magnitude = magnitudes[binIndex] || 0; // Get magnitude for this bin
                            const db = 20 * Math.log10(magnitude + 1e-9); // Convert to dB
                            const clampedDb = Math.max(minDb, db); // Clamp to min dB
                            const normValue = dbRange > 0 ? (clampedDb - minDb) / dbRange : 0; // Normalize 0-1
                            const [r, g, b] = viridisColor(normValue); // Get color

                            // Set pixel data (RGBA)
                            const idx = (i + y * computedSlices) * 4; // Calculate index in ImageData
                            data[idx] = r;
                            data[idx + 1] = g;
                            data[idx + 2] = b;
                            data[idx + 3] = 255; // Alpha
                        }
                    }

                    // Update the offscreen canvas chunk by chunk
                    offCtx.putImageData(fullImageData, 0, 0, startSlice, 0, endSlice - startSlice, height);

                    currentSlice = endSlice;

                    if (currentSlice < computedSlices) {
                        requestAnimationFrame(drawChunk); // Schedule next chunk
                    } else {
                        // Drawing finished - copy final offscreen canvas to display canvas
                        displayCtx.drawImage(cachedSpectrogramCanvas, 0, 0, canvas.width, canvas.height);
                        // console.log("Visualizer: Spectrogram async drawing complete.");
                        resolve(); // Resolve the promise
                    }
                } catch (error) {
                    console.error("Visualizer: Error within async drawChunk -", error);
                    reject(error); // Reject the promise on error
                }
            }
            requestAnimationFrame(drawChunk); // Start the drawing loop
        });
    }


    // --- UI Update Methods ---

    /**
     * Updates the position of the progress indicator overlays.
     * @param {number} currentTime - The current playback time in seconds.
     * @param {number} duration - The total audio duration in seconds.
     * @public
     */
    function updateProgressIndicator(currentTime, duration) {
        if (isNaN(duration) || duration <= 0) {
            // Reset if duration is invalid
            if (waveformProgressIndicator) waveformProgressIndicator.style.left = "0px";
            if (spectrogramProgressIndicator) spectrogramProgressIndicator.style.left = "0px";
            return;
        }

        const fraction = Math.max(0, Math.min(1, currentTime / duration));

        // Update waveform progress
        const waveformWidth = waveformCanvas ? waveformCanvas.clientWidth : 0;
        if (waveformProgressIndicator && waveformWidth > 0) {
            waveformProgressIndicator.style.left = (fraction * waveformWidth) + "px";
        } else if (waveformProgressIndicator) {
            waveformProgressIndicator.style.left = "0px"; // Fallback if width is zero
        }

        // Update spectrogram progress
        const spectrogramWidth = spectrogramCanvas ? spectrogramCanvas.clientWidth : 0;
        if (spectrogramProgressIndicator && spectrogramWidth > 0) {
            spectrogramProgressIndicator.style.left = (fraction * spectrogramWidth) + "px";
        } else if (spectrogramProgressIndicator) {
            spectrogramProgressIndicator.style.left = "0px"; // Fallback
        }
    }

    /**
     * Clears both visualization canvases and the spectrogram cache.
     * @public
     */
    function clearVisuals() {
        console.log("Visualizer: Clearing visuals and cache.");
        if (waveformCtx && waveformCanvas) {
            waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
        }
        if (spectrogramCtx && spectrogramCanvas) {
            spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
        }
        cachedSpectrogramCanvas = null; // Clear the cache
        updateProgressIndicator(0, 1); // Reset progress indicators
    }

    /**
     * Shows or hides the spectrogram loading spinner.
     * @param {boolean} show - True to show, false to hide.
     * @public
     */
    function showSpinner(show) {
        if (spectrogramSpinner) {
            spectrogramSpinner.style.display = show ? 'inline' : 'none';
        }
    }

    /**
     * Resizes canvases to match their displayed size. Internal use.
     * @returns {boolean} True if any canvas was actually resized.
     * @private
     */
    function resizeCanvasesInternal() {
        let resized = false;
        [waveformCanvas, spectrogramCanvas].forEach(canvas => {
            if (!canvas) return;
            const { width, height } = canvas.getBoundingClientRect();
            // Use Math.round to avoid subpixel issues, ensure minimum size
            const roundedWidth = Math.max(10, Math.round(width));
            const roundedHeight = Math.max(10, Math.round(height));

            if (canvas.width !== roundedWidth || canvas.height !== roundedHeight) {
                canvas.width = roundedWidth;
                canvas.height = roundedHeight;
                resized = true;
                // console.log(`Visualizer: Resized ${canvas.id} to ${roundedWidth}x${roundedHeight}`); // Debugging
            }
        });
        return resized;
    }

    /**
     * Handles window resize: adjusts canvas dimensions and redraws visuals.
     * @param {AudioBuffer | null} audioBuffer - The current audio buffer (needed for redraw).
     * @param {Array<{start: number, end: number}> | null} speechRegions - Current speech regions.
     * @public
     */
    function resizeAndRedraw(audioBuffer, speechRegions) {
        const wasResized = resizeCanvasesInternal();

        if (wasResized && audioBuffer) {
            console.log("Visualizer: Redrawing visuals after resize.");
            // Redraw waveform with highlighting
            redrawWaveformHighlight(audioBuffer, speechRegions || []);

            // Redraw spectrogram from cache if available
            if (cachedSpectrogramCanvas && spectrogramCtx && spectrogramCanvas) {
                 spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
                 // Draw cached image scaled to new canvas size
                 spectrogramCtx.drawImage(
                     cachedSpectrogramCanvas,
                     0, 0, cachedSpectrogramCanvas.width, cachedSpectrogramCanvas.height, // Source rect (full cache)
                     0, 0, spectrogramCanvas.width, spectrogramCanvas.height // Destination rect (scaled display)
                 );
            } else {
                 // If no cache, maybe just clear? Or trigger recompute? For now, clear.
                 if(spectrogramCtx && spectrogramCanvas) {
                    spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
                    // Optionally display a message like "Resize detected, re-load audio to recompute spectrogram"
                 }
            }
        } else if (wasResized) {
            // Clear canvases if resized but no audio buffer available
             if(waveformCtx && waveformCanvas) waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
             if(spectrogramCtx && spectrogramCanvas) spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
        }
        // Always update progress indicator after resize, even if visuals weren't redrawn yet
        // Get current time from AudioApp.audioEngine if possible, otherwise use 0
        const { currentTime = 0, duration = 0 } = AudioApp.audioEngine?.getCurrentTime() || {};
        updateProgressIndicator(currentTime, duration || (audioBuffer ? audioBuffer.duration : 0));
    }

    // --- Public Interface ---
    return {
        init: init,
        computeAndDrawVisuals: computeAndDrawVisuals,
        redrawWaveformHighlight: redrawWaveformHighlight, // <-- ADDED
        resizeAndRedraw: resizeAndRedraw,
        updateProgressIndicator: updateProgressIndicator,
        clearVisuals: clearVisuals,
        showSpinner: showSpinner
    };

})(window.FFT); // Pass the global FFT constructor
// --- /vibe-player/js/visualizer.js ---
