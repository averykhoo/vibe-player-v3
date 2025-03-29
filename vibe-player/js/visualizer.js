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
        resizeCanvasesInternal(false);

        // --- Waveform ---
        console.time("Waveform compute");
        const waveformData = computeWaveformData(audioBuffer, waveformCanvas.width);
        console.timeEnd("Waveform compute");
        console.time("Waveform draw");
        drawWaveform(waveformData, waveformCanvas, speechRegions, audioBuffer.duration);
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
     * Redraws waveform highlighting without full recompute.
     * @param {AudioBuffer} audioBuffer
     * @param {Array<{start: number, end: number}>} speechRegions
     * @public
     */
    function redrawWaveformHighlight(audioBuffer, speechRegions) {
         if (!audioBuffer || !waveformCtx || !waveformCanvas) return;
         const waveformData = computeWaveformData(audioBuffer, waveformCanvas.width);
         drawWaveform(waveformData, waveformCanvas, speechRegions, audioBuffer.duration);
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
        // ... (Waveform computation remains the same) ...
        if (!buffer || !buffer.getChannelData || targetWidth <= 0) return []; const channelCount = buffer.numberOfChannels; const bufferLength = buffer.length; if (bufferLength === 0) return []; const sourceData = channelCount > 1 ? new Float32Array(bufferLength).fill(0) : buffer.getChannelData(0); if (channelCount > 1) { for (let ch = 0; ch < channelCount; ch++) { const channelData = buffer.getChannelData(ch); for (let i = 0; i < bufferLength; i++) sourceData[i] += channelData[i]; } for (let i = 0; i < bufferLength; i++) sourceData[i] /= channelCount; } const samplesPerPixel = Math.max(1, Math.floor(bufferLength / targetWidth)); const waveform = []; for (let i = 0; i < targetWidth; i++) { const start = Math.floor(i * samplesPerPixel); const end = Math.min(start + samplesPerPixel, bufferLength); if (start >= end) { waveform.push({min: 0, max: 0}); continue; } let min = 1.0, max = -1.0; for (let j = start; j < end; j++) { const sample = sourceData[j]; if (sample < min) min = sample; if (sample > max) max = sample; } waveform.push({min, max}); } return waveform;
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
        // console.log(`Visualizer: hopSize = ${hopSize} (fftSize=${actualFftSize}, divisor=${hopDivisor})`); // Debug

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
             for (let i = 0; i < numRawSlices; i++) { finalSpec[i] = rawSpec[i]; }
        } else if (numRawSlices > 0) {
            // --- LINEAR INTERPOLATION ---
            for (let i = 0; i < targetSlices; i++) {
                 const rawPos = (numRawSlices > 1) ? (i / (targetSlices - 1)) * (numRawSlices - 1) : 0;
                 const index1 = Math.floor(rawPos);
                 const index2 = Math.min(numRawSlices - 1, Math.ceil(rawPos));
                 const factor = rawPos - index1;
                 const magnitudes1 = rawSpec[index1];
                 const magnitudes2 = rawSpec[index2];
                 finalSpec[i] = new Float32Array(numFreqBins); // Ensure correct bin count
                 if (index1 === index2 || factor === 0) {
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
        // ... (Hann window function remains the same) ...
        if (length <= 0) return null; let windowArr = new Array(length); if (length === 1) { windowArr[0] = 1; return windowArr; } const denom = length - 1; for (let i = 0; i < length; i++) { windowArr[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom)); } return windowArr;
    }

    // --- Drawing Helper Functions ---

    /**
     * Draws the waveform, highlighting speech regions.
     * @param {Array<{min: number, max: number}>} waveformData
     * @param {HTMLCanvasElement} canvas
     * @param {Array<{start: number, end: number}>} speechRegions
     * @param {number} audioDuration
     * @private
     */
     function drawWaveform(waveformData, canvas, speechRegions, audioDuration) {
        // ... (Waveform drawing remains the same) ...
        const ctx = canvas.getContext('2d'); if (!ctx) return; const { width, height } = canvas; ctx.clearRect(0, 0, width, height); if (!waveformData || waveformData.length === 0 || !audioDuration || audioDuration <= 0) { ctx.fillStyle = '#888'; ctx.textAlign = 'center'; ctx.font = '12px sans-serif'; ctx.fillText("No waveform data", width / 2, height / 2); return; } const dataLen = waveformData.length; const halfHeight = height / 2; const scale = halfHeight * WAVEFORM_HEIGHT_SCALE; const pixelsPerSecond = width / audioDuration; const speechPixelRegions = (speechRegions || []).map(r => ({ startPx: r.start * pixelsPerSecond, endPx: r.end * pixelsPerSecond })); const pixelWidth = width / dataLen; ctx.fillStyle = '#3455db'; ctx.beginPath(); for (let i = 0; i < dataLen; i++) { const x = i * pixelWidth; const currentPixelEnd = x + pixelWidth; let isOutsideSpeech = true; for (const region of speechPixelRegions) { if (region.startPx < currentPixelEnd && region.endPx > x) { isOutsideSpeech = false; break; } } if (isOutsideSpeech) { const { min, max } = waveformData[i]; const y1 = halfHeight - max * scale; const y2 = halfHeight - min * scale; ctx.rect(x, y1, pixelWidth, Math.max(1, y2 - y1)); } } ctx.fill(); ctx.fillStyle = 'orange'; ctx.beginPath(); for (let i = 0; i < dataLen; i++) { const x = i * pixelWidth; const currentPixelEnd = x + pixelWidth; let isInsideSpeech = false; for (const region of speechPixelRegions) { if (region.startPx < currentPixelEnd && region.endPx > x) { isInsideSpeech = true; break; } } if (isInsideSpeech) { const { min, max } = waveformData[i]; const y1 = halfHeight - max * scale; const y2 = halfHeight - min * scale; ctx.rect(x, y1, pixelWidth, Math.max(1, y2 - y1)); } } ctx.fill();
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
            // ... (Initial checks remain the same) ...
            if (!canvas) return reject(new Error("Spectrogram target canvas not found")); if (!spectrogramData || spectrogramData.length === 0 || !spectrogramData[0]) { console.warn("Visualizer: No valid spectrogram data to draw async."); const ctx = canvas.getContext('2d'); if (ctx) { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#888'; ctx.textAlign = 'center'; ctx.font = '12px sans-serif'; ctx.fillText("No spectrogram data", canvas.width / 2, canvas.height / 2); } return resolve(); } const displayCtx = canvas.getContext('2d'); if (!displayCtx) return reject(new Error("Could not get 2D context for spectrogram canvas")); displayCtx.clearRect(0, 0, canvas.width, canvas.height);

            const offscreen = document.createElement('canvas');
            offscreen.width = spectrogramData.length; offscreen.height = canvas.height;
            const offCtx = offscreen.getContext('2d', { willReadFrequently: false });
            if (!offCtx) return reject(new Error("Could not get 2D context for offscreen spectrogram"));

            const computedSlices = spectrogramData.length;
            const height = offscreen.height;
            // Use the *actual* number of bins based on the FFT size used
            const numBins = actualFftSize / 2; // spectrogramData[0].length should also match this
            const nyquist = sampleRate / 2;
            // Recalculate maxBinIndex based on the actual number of bins
            const maxBinIndex = Math.min(numBins - 1, Math.floor((SPECTROGRAM_MAX_FREQ / nyquist) * (numBins - 1)));

            // ... (dB Range calculation remains the same) ...
            const dbThreshold = -60; let maxDb = -Infinity; const sliceStep = Math.max(1, Math.floor(computedSlices / 100)); const binStep = Math.max(1, Math.floor(maxBinIndex / 50)); for (let i = 0; i < computedSlices; i += sliceStep) { const magnitudes = spectrogramData[i]; for (let j = 0; j <= maxBinIndex; j += binStep) { const db = 20 * Math.log10((magnitudes[j] || 0) + 1e-9); maxDb = Math.max(maxDb, Math.max(dbThreshold, db)); } } maxDb = Math.max(maxDb, dbThreshold + 1); const minDb = dbThreshold; const dbRange = maxDb - minDb;

            function viridisColor(t) { /* ... (viridis colormap function remains the same) ... */ const colors = [ [0.0, 68, 1, 84], [0.1, 72, 40, 120], [0.2, 62, 74, 137], [0.3, 49, 104, 142], [0.4, 38, 130, 142], [0.5, 31, 155, 137], [0.6, 53, 178, 126], [0.7, 109, 199, 104], [0.8, 170, 217, 70], [0.9, 235, 231, 35], [1.0, 253, 231, 37] ]; t = Math.max(0, Math.min(1, t)); let c1 = colors[0]; let c2 = colors[colors.length - 1]; for (let i = 0; i < colors.length - 1; i++) { if (t >= colors[i][0] && t <= colors[i + 1][0]) { c1 = colors[i]; c2 = colors[i + 1]; break; } } const range = c2[0] - c1[0]; const ratio = (range === 0) ? 0 : (t - c1[0]) / range; const r = Math.round(c1[1] + ratio * (c2[1] - c1[1])); const g = Math.round(c1[2] + ratio * (c2[2] - c1[2])); const b = Math.round(c1[3] + ratio * (c2[3] - c1[3])); return [r, g, b]; }

            // Async Drawing Loop
            const fullImageData = offCtx.createImageData(offscreen.width, height); const data = fullImageData.data; let currentSlice = 0; const chunkSize = 32;

            function drawChunk() {
                try {
                    const startSlice = currentSlice; const endSlice = Math.min(startSlice + chunkSize, computedSlices);
                    for (let i = startSlice; i < endSlice; i++) {
                        if (!spectrogramData[i]) continue; const magnitudes = spectrogramData[i];
                        // Check if magnitudes array has expected length (can be shorter if fftSize changed)
                        if (magnitudes.length !== numBins) {
                             // This shouldn't happen if computeSpectrogram is correct, but safety check
                             console.warn(`Slice ${i} has ${magnitudes.length} bins, expected ${numBins}`);
                             continue; // Skip drawing this potentially corrupted slice
                        }
                        for (let y = 0; y < height; y++) {
                            const freqRatio = (height - 1 - y) / (height - 1); const logFreqRatio = Math.pow(freqRatio, 2.0);
                            // Use maxBinIndex calculated based on actual numBins
                            const binIndex = Math.min(maxBinIndex, Math.floor(logFreqRatio * maxBinIndex));
                            const magnitude = magnitudes[binIndex] || 0; const db = 20 * Math.log10(magnitude + 1e-9); const clampedDb = Math.max(minDb, db); const normValue = dbRange > 0 ? (clampedDb - minDb) / dbRange : 0; const [r, g, b] = viridisColor(normValue); const idx = (i + y * offscreen.width) * 4; data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255;
                        }
                    }
                    currentSlice = endSlice; offCtx.putImageData(fullImageData, 0, 0, startSlice, 0, endSlice - startSlice, height);
                    if (currentSlice < computedSlices) { requestAnimationFrame(drawChunk); }
                    else { cachedSpectrogramCanvas = offscreen; displayCtx.drawImage(offscreen, 0, 0, canvas.width, canvas.height); /* console.log("Visualizer: Spectrogram async drawing complete."); */ resolve(); }
                } catch (error) { console.error("Visualizer: Error within async drawChunk -", error); reject(error); }
            }
            requestAnimationFrame(drawChunk);
        });
    }


    // --- UI Update Methods ---
    function updateProgressIndicator(currentTime, duration) { /* ... (No change) ... */ if (isNaN(duration) || duration <= 0) { if (waveformProgressIndicator) waveformProgressIndicator.style.left = "0px"; if (spectrogramProgressIndicator) spectrogramProgressIndicator.style.left = "0px"; return; } const fraction = currentTime / duration; const waveformWidth = waveformCanvas ? waveformCanvas.clientWidth : 0; if (waveformProgressIndicator && waveformWidth > 0) waveformProgressIndicator.style.left = (fraction * waveformWidth) + "px"; else if (waveformProgressIndicator) waveformProgressIndicator.style.left = "0px"; const spectrogramWidth = spectrogramCanvas ? spectrogramCanvas.clientWidth : 0; if (spectrogramProgressIndicator && spectrogramWidth > 0) spectrogramProgressIndicator.style.left = (fraction * spectrogramWidth) + "px"; else if (spectrogramProgressIndicator) spectrogramProgressIndicator.style.left = "0px"; }
    function clearVisuals() { /* ... (No change) ... */ console.log("Visualizer: Clearing visuals and cache."); if (waveformCtx && waveformCanvas) waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height); if (spectrogramCtx && spectrogramCanvas) spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height); cachedSpectrogramCanvas = null; updateProgressIndicator(0, 1); }
    function showSpinner(show) { /* ... (No change) ... */ if (spectrogramSpinner) spectrogramSpinner.style.display = show ? 'inline' : 'none'; }
    function resizeCanvasesInternal() { /* ... (No change) ... */ let resized = false; [waveformCanvas, spectrogramCanvas].forEach(canvas => { if (!canvas) return; const { width, height } = canvas.getBoundingClientRect(); const roundedWidth = Math.max(10, Math.round(width)); const roundedHeight = Math.max(10, Math.round(height)); if (canvas.width !== roundedWidth || canvas.height !== roundedHeight) { canvas.width = roundedWidth; canvas.height = roundedHeight; resized = true; } }); return resized; }
    function resizeAndRedraw(audioBuffer, speechRegions) { /* ... (No change) ... */ const wasResized = resizeCanvasesInternal(); if (wasResized && audioBuffer) { redrawWaveformHighlight(audioBuffer, speechRegions || []); if (cachedSpectrogramCanvas && spectrogramCtx && spectrogramCanvas) { spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height); spectrogramCtx.drawImage(cachedSpectrogramCanvas, 0, 0, cachedSpectrogramCanvas.width, cachedSpectrogramCanvas.height, 0, 0, spectrogramCanvas.width, spectrogramCanvas.height); } else { if(spectrogramCtx && spectrogramCanvas) { spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height); } } } else if (wasResized) { if(waveformCtx && waveformCanvas) waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height); if(spectrogramCtx && spectrogramCanvas) spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height); } }

    // --- Public Interface ---
    return {
        init: init,
        computeAndDrawVisuals: computeAndDrawVisuals,
        redrawWaveformHighlight: redrawWaveformHighlight,
        resizeAndRedraw: resizeAndRedraw,
        updateProgressIndicator: updateProgressIndicator,
        clearVisuals: clearVisuals,
        showSpinner: showSpinner
    };

})(window.FFT); // Pass the global FFT constructor
// --- /vibe-player/js/visualizer.js ---
