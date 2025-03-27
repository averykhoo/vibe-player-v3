// --- START OF FILE spectrogram-visualizer.js ---
'use strict';

/**
 * Handles computing and drawing the audio spectrogram visualization.
 * Requires the global FFT object from fft.js.
 */
const SpectrogramVisualizer = (function () {

    // Constants
    const FFT_SIZE = 1024;
    const MAX_FREQ = 8000; // Max frequency to display
    const FIXED_WIDTH = 2048; // Internal calculation width

    // --- Module Scope State ---
    let cachedCanvas = null; // Offscreen cache for the spectrogram
    let isDrawing = false;   // <<< MOVED DECLARATION HERE: Flag to prevent concurrent drawing operations

    /**
     * Generates a Hann window array.
     * @param {number} length - Window length.
     * @returns {Array<number>} - Hann window array.
     */
    function hannWindow(length) {
        // (Same implementation as before)
        if (length <= 0) return [];
        let windowArr = new Array(length);
        if (length === 1) return [1];
        const denom = length - 1;
        for (let i = 0; i < length; i++) {
            windowArr[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
        }
        return windowArr;
    }

    /**
     * Viridis colormap function.
     * @param {number} t - Value between 0 and 1.
     * @returns {Array<number>} - [r, g, b] array.
     */
    function viridisColor(t) {
        // (Same implementation as before)
        const colors = [
            {t: 0.0, r: 68, g: 1, b: 84}, {t: 0.1, r: 72, g: 40, b: 120},
            {t: 0.2, r: 62, g: 74, b: 137}, {t: 0.3, r: 49, g: 104, b: 142},
            {t: 0.4, r: 38, g: 130, b: 142}, {t: 0.5, r: 31, g: 155, b: 137},
            {t: 0.6, r: 53, g: 178, b: 126}, {t: 0.7, r: 109, g: 199, b: 104},
            {t: 0.8, r: 170, g: 217, b: 70}, {t: 0.9, r: 235, g: 231, b: 35},
            {t: 1.0, r: 253, g: 231, b: 37}
        ];
        t = Math.max(0, Math.min(1, t)); // Clamp t to [0, 1]
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
        return [r, g, b];
    }


    /**
     * Computes spectrogram data (magnitude per frequency bin per time slice).
     * @param {AudioBuffer} buffer - The original audio buffer.
     * @returns {Array<Float32Array>|null} - Array of magnitude arrays, or null on error/no data.
     */
    function computeData(buffer) {
        if (typeof FFT === 'undefined') {
            console.error("SpectrogramVisualizer: FFT constructor not found.");
            return null;
        }
        if (!buffer || !(buffer instanceof AudioBuffer)) {
            console.warn("SpectrogramVisualizer: Invalid AudioBuffer for computeData.");
            return null;
        }
        if ((FFT_SIZE & (FFT_SIZE - 1)) !== 0 || FFT_SIZE <= 1) {
            console.error(`SpectrogramVisualizer: Invalid FFT size: ${FFT_SIZE}.`);
            return null;
        }

        const channelData = buffer.getChannelData(0); // Use first channel
        const totalSamples = channelData.length;
        const hopSize = Math.max(1, Math.floor(FFT_SIZE / 4));
        const rawSliceCount = totalSamples < FFT_SIZE ? 0 : Math.floor((totalSamples - FFT_SIZE) / hopSize) + 1;

        if (rawSliceCount <= 0) {
            console.warn("SpectrogramVisualizer: Not enough audio samples for FFT.");
            return [];
        }
        console.log(`SpectrogramVisualizer: Computing ${rawSliceCount} raw slices for FFT size ${FFT_SIZE}...`);

        const fftInstance = new FFT(FFT_SIZE);
        const complexBuffer = fftInstance.createComplexArray();
        const fftInput = new Array(FFT_SIZE);
        const windowFunc = hannWindow(FFT_SIZE);
        if (!windowFunc) {
            console.error('SpectrogramVisualizer: Failed to generate Hann window!');
            return null;
        }

        const rawSpec = [];
        for (let i = 0; i < rawSliceCount; i++) {
            // ... (FFT calculation loop) ...
            const start = i * hopSize;
            for (let j = 0; j < FFT_SIZE; j++) {
                const sample = (start + j < totalSamples) ? channelData[start + j] : 0;
                fftInput[j] = sample * windowFunc[j];
            }
            fftInstance.realTransform(complexBuffer, fftInput); // In-place on complexBuffer? No, output is complexBuffer

            const magnitudes = new Float32Array(FFT_SIZE / 2);
            for (let k = 0; k < FFT_SIZE / 2; k++) {
                const re = complexBuffer[k * 2];
                const im = complexBuffer[k * 2 + 1];
                const magSq = (re * re + im * im);
                magnitudes[k] = Math.sqrt(magSq > 0 ? magSq : 0);
            }
            rawSpec.push(magnitudes);
        }

        // Resample/Select slices to match FIXED_WIDTH
        const finalSpec = new Array(FIXED_WIDTH);
        const rawCount = rawSpec.length;
        if (rawCount === FIXED_WIDTH) {
            Object.assign(finalSpec, rawSpec); // Faster copy if sizes match
        } else {
            for (let i = 0; i < FIXED_WIDTH; i++) {
                const t = (FIXED_WIDTH > 1) ? (i / (FIXED_WIDTH - 1)) : 0;
                const rawPos = t * (rawCount - 1);
                const nearestIndex = Math.min(rawCount - 1, Math.max(0, Math.round(rawPos)));
                // Use slice() to create a copy, preventing modification issues if rawSpec is reused
                finalSpec[i] = rawSpec[nearestIndex] ? new Float32Array(rawSpec[nearestIndex]) : new Float32Array(FFT_SIZE / 2);
            }
        }
        return finalSpec;
    }

    /**
     * Draws the spectrogram onto a canvas asynchronously, updating the cache.
     * @param {HTMLCanvasElement} displayCanvas - The visible canvas element.
     * @param {Array<Float32Array>} spectrogramData - The computed spectrogram magnitude data.
     * @param {number} sampleRate - The original sample rate of the audio.
     * @returns {Promise<void>} - A promise that resolves when drawing is complete.
     */
    function drawAsync(displayCanvas, spectrogramData, sampleRate) {
        return new Promise((resolve, reject) => {
            // --- Check for valid input ---
            if (!displayCanvas || !spectrogramData || spectrogramData.length === 0 || !spectrogramData[0]) {
                console.warn("SpectrogramVisualizer: Invalid input for drawAsync.");
                // Clear canvas and reject/resolve?
                if (displayCanvas) {
                    const displayCtx = displayCanvas.getContext('2d');
                    displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
                    displayCtx.fillStyle = '#888';
                    displayCtx.textAlign = 'center';
                    displayCtx.fillText("No Spectrogram Data", displayCanvas.width / 2, displayCanvas.height / 2);
                }
                reject(new Error("Invalid data for spectrogram drawing"));
                return;
            }

            // --- Prevent Concurrent Drawing ---
            // Check the module-scoped 'isDrawing' flag
            if (isDrawing) {
                console.log("SpectrogramVisualizer: Draw already in progress, skipping.");
                resolve(); // Resolve immediately, as a draw is happening/will finish
                return;
            }
            isDrawing = true; // Set flag to block subsequent calls until this one finishes
            // --- End Concurrency Check ---


            const displayCtx = displayCanvas.getContext('2d');
            displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height); // Clear visible canvas

            // Create or reuse offscreen canvas
            if (!cachedCanvas || cachedCanvas.width !== FIXED_WIDTH || cachedCanvas.height !== displayCanvas.height) {
                cachedCanvas = document.createElement('canvas');
                cachedCanvas.width = FIXED_WIDTH;
                cachedCanvas.height = displayCanvas.height; // Match display height
                console.log(`SpectrogramVisualizer: Created/Resized offscreen cache ${cachedCanvas.width}x${cachedCanvas.height}`);
            }
            const offCtx = cachedCanvas.getContext('2d', {willReadFrequently: false}); // alpha: false?

            const computedSlices = spectrogramData.length; // Should match FIXED_WIDTH
            const height = cachedCanvas.height;
            const numBins = spectrogramData[0].length;
            const nyquist = sampleRate / 2;
            const maxBinIndex = Math.min(numBins - 1, Math.floor((MAX_FREQ / nyquist) * numBins));

            // Calculate dB Range (same logic as before)
            const dbThreshold = -60;
            let maxDb = -Infinity;
            // Optimize dB range calculation slightly
            for (let i = 0; i < computedSlices; i++) {
                const magnitudes = spectrogramData[i];
                if (!magnitudes) continue;
                // Could potentially optimize by checking only a subset of bins/slices?
                for (let j = 0; j <= maxBinIndex; j++) {
                    const db = 20 * Math.log10((magnitudes[j] || 0) + 1e-9);
                    const clampedDb = Math.max(dbThreshold, db);
                    if (clampedDb > maxDb) maxDb = clampedDb;
                }
            }
            const minDb = dbThreshold;
            const dbRange = Math.max(1, maxDb - minDb);
            console.log(`SpectrogramVisualizer: dB range ${minDb.toFixed(1)} to ${maxDb.toFixed(1)}`);

            // --- Asynchronous Drawing Loop (requestAnimationFrame) ---
            const fullImageData = offCtx.createImageData(cachedCanvas.width, height);
            const data = fullImageData.data;
            let currentSlice = 0;
            const chunkSize = 64; // Process N slices per frame

            function drawChunk() {
                try { // Add try...finally for robust flag reset
                    const startSlice = currentSlice;
                    const endSlice = Math.min(startSlice + chunkSize, computedSlices);

                    // --- Pixel manipulation loop (same as before) ---
                    for (let i = startSlice; i < endSlice; i++) {
                        const magnitudes = spectrogramData[i];
                        if (!magnitudes) continue;
                        for (let y = 0; y < height; y++) {
                            const freqRatio = (height - 1 - y) / (height - 1);
                            const logFreqRatio = Math.pow(freqRatio, 2.5);
                            const binIndex = Math.min(maxBinIndex, Math.floor(logFreqRatio * maxBinIndex));

                            const magnitude = magnitudes[binIndex] || 0;
                            const db = 20 * Math.log10(magnitude + 1e-9);
                            const clampedDb = Math.max(minDb, db);
                            const normValue = (clampedDb - minDb) / dbRange;
                            const [r, g, b] = viridisColor(normValue);
                            const idx = (i + y * cachedCanvas.width) * 4;
                            data[idx] = r;
                            data[idx + 1] = g;
                            data[idx + 2] = b;
                            data[idx + 3] = 255;
                        }
                    }
                    // --- End Pixel manipulation ---

                    currentSlice = endSlice;

                    // Update the offscreen canvas (this is the expensive part visually)
                    offCtx.putImageData(fullImageData, 0, 0);

                    // --- Continue or Finish ---
                    if (currentSlice < computedSlices) {
                        requestAnimationFrame(drawChunk); // Schedule next chunk
                    } else {
                        // Drawing finished
                        console.log("SpectrogramVisualizer: Offscreen drawing complete.");
                        // Draw the final cached image onto the visible canvas
                        displayCtx.drawImage(cachedCanvas, 0, 0, displayCanvas.width, displayCanvas.height);
                        isDrawing = false; // <<< IMPORTANT: Reset flag *here* when done
                        resolve(); // Resolve the promise
                    }
                } catch (error) {
                    console.error("SpectrogramVisualizer: Error during drawChunk", error);
                    isDrawing = false; // <<< IMPORTANT: Reset flag on error too
                    reject(error);
                }
            }

            // Start async drawing
            drawChunk();
        });
    }

    /**
     * Clears the cache and the display canvas.
     * @param {HTMLCanvasElement} displayCanvas - The visible canvas.
     */
    function clear(displayCanvas) {
        cachedCanvas = null; // Clear cache
        if (displayCanvas) {
            const ctx = displayCanvas.getContext('2d');
            ctx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
        }
        console.log("SpectrogramVisualizer: Cache cleared.");
    }

    /**
     * Redraws the spectrogram on the display canvas using the cache if available.
     * Useful after resize.
     * @param {HTMLCanvasElement} displayCanvas - The visible canvas.
     */
    function redrawFromCache(displayCanvas) {
        if (!displayCanvas) return;
        const ctx = displayCanvas.getContext('2d');
        ctx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
        if (cachedCanvas) {
            console.log("SpectrogramVisualizer: Redrawing from cache.");
            ctx.drawImage(cachedCanvas, 0, 0, displayCanvas.width, displayCanvas.height);
            return true;
        } else {
            console.log("SpectrogramVisualizer: No cache to redraw from.");
            ctx.fillStyle = '#888';
            ctx.textAlign = 'center';
            ctx.fillText("No Spectrogram Cached", displayCanvas.width / 2, displayCanvas.height / 2);
            return false;
        }
    }


    // Public API
    return {
        computeData,
        drawAsync,
        clear,
        redrawFromCache
    };

})();

window.SpectrogramVisualizer = SpectrogramVisualizer; // Expose to global scope
// --- END OF FILE spectrogram-visualizer.js ---