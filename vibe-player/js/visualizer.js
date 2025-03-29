// --- /vibe-player/js/visualizer.js ---
/**
 * @namespace AudioApp.visualizer
 * @description Handles drawing Waveform and Spectrogram visualizations to canvas elements.
 * Uses FFT.js for spectrogram calculation. Manages canvas resizing, progress indicators,
 * and click-to-seek functionality. Relies on main.js for data and time updates.
 * Depends on the global FFT constructor from fft.js and constants from AudioApp.config.
 */
var AudioApp = AudioApp || {}; // Ensure namespace exists

AudioApp.visualizer = (function(globalFFT) { // Pass FFT constructor
    'use strict';

     // --- Dependency Check ---
     if (typeof globalFFT === 'undefined') {
        console.error("Visualizer: CRITICAL - FFT library constructor (fft.js) not found globally!");
        // Return a non-functional public interface to prevent further errors
        return {
             init: () => { console.error("Visualizer disabled: FFT library missing."); },
             computeAndDrawVisuals: () => Promise.resolve(),
             redrawWaveformHighlight: () => {},
             resizeAndRedraw: () => {},
             updateProgressIndicator: () => {},
             clearVisuals: () => {},
             showSpinner: () => {}
         };
    }
    if (typeof AudioApp.config === 'undefined') {
        console.error("Visualizer: CRITICAL - AudioApp.config not found!");
        // Return non-functional interface
         return { init: () => { console.error("Visualizer disabled: Config missing."); }, /* ... dummy methods */ };
    }

    // --- DOM Element References ---
    let waveformCanvas, waveformCtx, spectrogramCanvas, spectrogramCtx;
    let spectrogramSpinner, waveformProgressIndicator, spectrogramProgressIndicator;

    // --- Configuration (from AudioApp.config) ---
    const cfg = AudioApp.config; // Alias for convenience
    const WAVEFORM_HEIGHT_SCALE = cfg.WAVEFORM_HEIGHT_SCALE;
    const SPECTROGRAM_FFT_SIZE = cfg.SPECTROGRAM_FFT_SIZE;
    const SPECTROGRAM_MAX_FREQ = cfg.SPECTROGRAM_MAX_FREQ;
    const SPEC_FIXED_WIDTH = cfg.SPEC_FIXED_WIDTH; // Internal calculation width

    // --- State ---
    /** Offscreen canvas for caching the fully rendered spectrogram at SPEC_FIXED_WIDTH. */
    let cachedSpectrogramCanvas = null;

    // --- Initialization ---
    /**
     * Initializes the Visualizer module: gets canvas elements and contexts, adds listeners.
     * Called by main.js.
     * @public
     */
    function init() {
        console.log("Visualizer: Initializing...");
        assignDOMElements();
        // Initial resize can optionally be called here, or deferred until first draw / window resize event.
        // resizeCanvasesInternal();
        console.log("Visualizer: Initialized.");
    }

    /**
     * Gets references to canvas elements and their rendering contexts from the DOM.
     * Adds click listeners to canvases for seeking functionality.
     * @private
     */
    function assignDOMElements() {
        waveformCanvas = document.getElementById('waveformCanvas');
        spectrogramCanvas = document.getElementById('spectrogramCanvas');
        spectrogramSpinner = document.getElementById('spectrogramSpinner');
        waveformProgressIndicator = document.getElementById('waveformProgressIndicator');
        spectrogramProgressIndicator = document.getElementById('spectrogramProgressIndicator');

        if (waveformCanvas) {
            waveformCtx = waveformCanvas.getContext('2d');
            if (waveformCtx) {
                waveformCanvas.addEventListener('click', handleCanvasClick);
            } else {
                console.error("Visualizer: Failed to get 2D context for waveform canvas.");
            }
        } else {
             console.warn("Visualizer: Waveform canvas element not found.");
        }
        if (spectrogramCanvas) {
            spectrogramCtx = spectrogramCanvas.getContext('2d');
             if (spectrogramCtx) {
                spectrogramCanvas.addEventListener('click', handleCanvasClick);
            } else {
                 console.error("Visualizer: Failed to get 2D context for spectrogram canvas.");
            }
        } else {
             console.warn("Visualizer: Spectrogram canvas element not found.");
        }
    }

    // --- Event Handlers ---
    /**
     * Handles click events on either canvas. Calculates the click position as a fraction
     * of the total width and dispatches 'audioapp:seekRequested' for main.js to handle.
     * @param {MouseEvent} e - The click event.
     * @private
     */
     function handleCanvasClick(e) {
        const canvas = /** @type {HTMLCanvasElement} */ (e.target);
        const rect = canvas.getBoundingClientRect();
        // Prevent calculation errors if canvas has no dimensions
        if (!rect || rect.width <= 0) {
            console.warn("Visualizer: Canvas click ignored, invalid dimensions.");
            return;
        }

        const clickXRelative = e.clientX - rect.left;
        // Calculate click position as a fraction [0, 1] of the canvas width
        const fraction = Math.max(0, Math.min(1, clickXRelative / rect.width));

        // Dispatch event with the fraction; main.js needs the audio duration to calculate the target time.
        document.dispatchEvent(new CustomEvent('audioapp:seekRequested', {
            detail: { fraction: fraction }
        }));
    }

    // --- Core Drawing & Computation ---

    /**
     * Computes and draws both the waveform and spectrogram for the given audio buffer.
     * This is the main function called by main.js when a new audio file is loaded and processed.
     * @param {AudioBuffer|null} audioBuffer - The original, decoded audio buffer.
     * @param {Array<{start: number, end: number}>|null} speechRegions - The initial speech regions to highlight.
     * @returns {Promise<void>} A promise that resolves when async drawing (spectrogram) is complete.
     * @public
     */
    async function computeAndDrawVisuals(audioBuffer, speechRegions) {
        // Validate inputs
        if (!audioBuffer) {
             console.warn("Visualizer: Cannot compute/draw visuals - AudioBuffer is missing.");
             clearVisuals(); // Ensure visuals are cleared if buffer is null
             return;
        }
        if (!waveformCtx || !spectrogramCtx) {
             console.warn("Visualizer: Cannot compute/draw visuals - Canvas context(s) missing.");
             return;
        }

        console.log("Visualizer: Starting computation and drawing of visuals...");
        const startTime = performance.now();

        clearVisuals(); // Clear previous drawings and invalidate spectrogram cache
        resizeCanvasesInternal(); // Ensure canvas buffers match CSS dimensions before drawing

        // --- Waveform (Synchronous) ---
        try {
            console.time("Waveform compute");
            const waveformData = computeWaveformData(audioBuffer, waveformCanvas.width);
            console.timeEnd("Waveform compute");
            console.time("Waveform draw");
            drawWaveform(waveformData, waveformCanvas, waveformCtx, speechRegions || [], audioBuffer.duration);
            console.timeEnd("Waveform draw");
        } catch (error) {
             console.error("Visualizer: Error during waveform processing:", error);
             // Optionally draw an error message on the waveform canvas
             drawErrorText(waveformCtx, waveformCanvas, `Waveform Error: ${error.message}`);
        }


        // --- Spectrogram (Asynchronous) ---
        cachedSpectrogramCanvas = null; // Invalidate cache for new audio
        showSpinner(true); // Show spinner while computing/drawing spectrogram
        let spectrogramData = null;

        try {
            console.time("Spectrogram compute");
            spectrogramData = computeSpectrogram(audioBuffer, SPECTROGRAM_FFT_SIZE, SPEC_FIXED_WIDTH);
            console.timeEnd("Spectrogram compute");
        } catch (error) {
             console.error("Visualizer: Error computing spectrogram data:", error);
             drawErrorText(spectrogramCtx, spectrogramCanvas, `Spectrogram Compute Error: ${error.message}`);
             showSpinner(false);
             // Continue without spectrogram if computation fails
        }


        if (spectrogramData && spectrogramData.length > 0) {
             console.time("Spectrogram draw (async)");
             try {
                // Draw asynchronously to avoid blocking the main thread. Caches the result on completion.
                await drawSpectrogramAsync(spectrogramData, spectrogramCanvas, spectrogramCtx, audioBuffer.sampleRate);
                console.timeEnd("Spectrogram draw (async)");
             } catch (error) {
                  console.error("Visualizer: Error drawing spectrogram asynchronously:", error);
                  drawErrorText(spectrogramCtx, spectrogramCanvas, `Spectrogram Draw Error: ${error.message}`);
             } finally {
                showSpinner(false); // Hide spinner regardless of success/failure
             }
        } else if (!spectrogramData) {
            // Handle case where computation failed earlier (error already drawn)
            showSpinner(false);
        }
         else {
             // Handle case where computation yielded no data (but didn't throw error)
             console.warn("Visualizer: Spectrogram computation yielded no data.");
             drawErrorText(spectrogramCtx, spectrogramCanvas, "Could not compute spectrogram data");
             showSpinner(false);
        }

        const endTime = performance.now();
        console.log(`Visualizer: Total visuals processing time: ${((endTime - startTime)/1000).toFixed(2)}s.`);
        updateProgressIndicator(0, audioBuffer.duration); // Ensure progress bars are reset to start
    }

    /**
     * Redraws only the waveform, specifically updating the speech region highlighting.
     * Assumes the canvas size hasn't changed significantly (use resizeAndRedraw for size changes).
     * Recomputes waveform data for current width to ensure accuracy.
     * @param {AudioBuffer|null} audioBuffer - The original decoded audio buffer.
     * @param {Array<{start: number, end: number}>} speechRegions - The *new* speech regions to highlight.
     * @public
     */
    function redrawWaveformHighlight(audioBuffer, speechRegions) {
         if (!audioBuffer || !waveformCtx || !waveformCanvas) {
             // console.warn("Visualizer: Cannot redraw highlight - buffer or canvas context missing.");
             return;
         }
         // Recompute waveform data based on *current* canvas display width
         try {
             const waveformData = computeWaveformData(audioBuffer, waveformCanvas.width);
             // Redraw the entire waveform with the new region highlighting
             drawWaveform(waveformData, waveformCanvas, waveformCtx, speechRegions || [], audioBuffer.duration);
         } catch(error) {
              console.error("Visualizer: Error redrawing waveform highlight:", error);
              drawErrorText(waveformCtx, waveformCanvas, `Waveform Redraw Error`);
         }
    }

    // --- Computation Helper Functions ---

    /**
     * Computes simplified waveform data (min/max pairs per pixel column) for drawing.
     * Mixes down to mono if necessary using simple averaging.
     * @param {AudioBuffer} buffer - The original AudioBuffer.
     * @param {number} targetWidth - The target canvas width in pixels.
     * @returns {Array<{min: number, max: number}>} Array of min/max values for each pixel column.
     * @throws {Error} If buffer is invalid.
     * @private
     */
    function computeWaveformData(buffer, targetWidth) {
        if (!buffer || typeof buffer.getChannelData !== 'function' || buffer.length === 0) {
             throw new Error("Invalid AudioBuffer provided to computeWaveformData.");
        }
        if (targetWidth <= 0 || !Number.isInteger(targetWidth)){
             console.warn(`Visualizer: Invalid targetWidth ${targetWidth} for waveform, using 1.`);
             targetWidth = 1;
        }

        const channelCount = buffer.numberOfChannels;
        const bufferLength = buffer.length;
        let sourceData;

        // Mix down to mono if necessary
        if (channelCount > 1) {
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
        } else {
            // Use channel 0 directly if mono
            sourceData = buffer.getChannelData(0);
        }

        const samplesPerPixel = Math.max(1, Math.floor(bufferLength / targetWidth));
        const waveform = [];

        for (let i = 0; i < targetWidth; i++) {
            const start = Math.min(bufferLength - 1, Math.floor(i * samplesPerPixel)); // Ensure start is valid index
            const end = Math.min(start + samplesPerPixel, bufferLength); // Ensure end doesn't exceed buffer length

            // Handle edge cases: if segment is empty or invalid, push zero values
            if (start >= end) {
                waveform.push({min: 0, max: 0});
                continue;
            }

            // Find min/max within the segment using a loop
            let min = 1.0, max = -1.0;
            for (let j = start; j < end; j++) {
                const sample = sourceData[j];
                if (sample < min) min = sample;
                if (sample > max) max = sample;
            }
            // Clamp min/max just in case of unexpected values (should be [-1, 1])
            waveform.push({ min: Math.max(-1.0, min), max: Math.min(1.0, max) });
        }
        return waveform;
    }

    /**
     * Computes spectrogram data using FFT.js.
     * @param {AudioBuffer} buffer - The original audio buffer.
     * @param {number} fftSize - The size of the FFT window (power of 2).
     * @param {number} targetSlices - The desired number of time slices (pixels) in the output (SPEC_FIXED_WIDTH).
     * @returns {Array<Float32Array>|null} Array of magnitude arrays, or null on error.
     * @throws {Error} If buffer or FFT size is invalid.
     * @private
     */
     function computeSpectrogram(buffer, fftSize, targetSlices) {
        if (!buffer || typeof buffer.getChannelData !== 'function') {
             throw new Error("Invalid AudioBuffer for computeSpectrogram.");
        }
        // Validate FFT size (must be power of 2 > 1)
        if ((fftSize & (fftSize - 1)) !== 0 || fftSize <= 1) {
             throw new Error(`Invalid FFT size: ${fftSize}. Must be a power of two > 1.`);
        }
        if (targetSlices <= 0 || !Number.isInteger(targetSlices)) {
             throw new Error(`Invalid targetSlices: ${targetSlices}. Must be a positive integer.`);
        }

        // Use the first channel for spectrogram
        const channelData = buffer.getChannelData(0);
        const totalSamples = channelData.length;
        // Determine hop size (e.g., 75% overlap)
        const hopSize = Math.max(1, Math.floor(fftSize / 4));

        // Calculate the number of raw FFT slices possible
        const rawSliceCount = totalSamples < fftSize
            ? 0 // Not enough samples for even one frame
            : Math.floor((totalSamples - fftSize) / hopSize) + 1;

        if (rawSliceCount <= 0) {
            console.warn("Visualizer: Not enough audio samples for spectrogram with current FFT/hop size.");
            return []; // Return empty array if no full slices can be computed
        }

        // Initialize FFT instance and buffers
        const fftInstance = new globalFFT(fftSize);
        const complexBuffer = fftInstance.createComplexArray(); // Output for complex FFT results
        const fftInput = new Array(fftSize); // Input buffer (real samples)
        const windowFunc = hannWindow(fftSize); // Get Hann window
        if (!windowFunc) throw new Error("Failed to generate Hann window.");

        const rawSpec = []; // Store raw magnitude arrays

        // --- Calculate FFT for each frame ---
        for (let i = 0; i < rawSliceCount; i++) {
            const frameStart = i * hopSize;
            // Apply window function and copy frame data
            for (let j = 0; j < fftSize; j++) {
                const sample = (frameStart + j < totalSamples) ? channelData[frameStart + j] : 0; // Zero-pad end
                fftInput[j] = sample * windowFunc[j];
            }

            // Perform real FFT
            fftInstance.realTransform(complexBuffer, fftInput);

            // Calculate magnitudes (only need first half: 0 to Nyquist)
            const magnitudes = new Float32Array(fftSize / 2);
            for (let k = 0; k < fftSize / 2; k++) {
                const re = complexBuffer[k * 2];
                const im = complexBuffer[k * 2 + 1];
                magnitudes[k] = Math.sqrt(re * re + im * im); // Magnitude
            }
            rawSpec.push(magnitudes);
        }

        // --- Resample/Select Slices to Match Target Width ---
        // Use simple nearest-neighbor selection for speed.
        const finalSpec = new Array(targetSlices);
        const numRawSlices = rawSpec.length;

        if (numRawSlices === targetSlices) {
            // If counts match, directly use the computed slices
            for (let i = 0; i < numRawSlices; i++) finalSpec[i] = rawSpec[i];
        } else if (numRawSlices > 0) {
            // If counts differ, pick nearest raw slice for each target slice
            for (let i = 0; i < targetSlices; i++) {
                // Map target index [0, target-1] to raw index [0, raw-1]
                const t = (targetSlices > 1) ? (i / (targetSlices - 1)) : 0; // Normalized position [0, 1]
                const rawPos = t * (numRawSlices - 1);
                const nearestIndex = Math.min(numRawSlices - 1, Math.max(0, Math.round(rawPos))); // Clamp index
                finalSpec[i] = rawSpec[nearestIndex];
            }
        }
        // If numRawSlices was 0, finalSpec remains empty (handled by drawing function).

        return finalSpec;
    }

    /**
     * Generates a Hann window array.
     * @param {number} length - The desired window length (must be > 0).
     * @returns {Array<number>|null} The Hann window array, or null if length is invalid.
     * @private
     */
    function hannWindow(length) {
        if (length <= 0 || !Number.isInteger(length)) return null;
        let windowArr = new Array(length);
        if (length === 1) {
            windowArr[0] = 1; // Window is 1 for length 1
            return windowArr;
        }
        // Formula: 0.5 * (1 - cos(2 * PI * n / (N - 1)))
        const denom = length - 1;
        for (let i = 0; i < length; i++) {
            windowArr[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
        }
        return windowArr;
    }


    // --- Drawing Helper Functions ---

    /**
     * Draws the pre-computed waveform data onto the canvas, highlighting speech regions.
     * @param {Array<{min: number, max: number}>} waveformData - Array from computeWaveformData.
     * @param {HTMLCanvasElement} canvas - The target canvas element.
     * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
     * @param {Array<{start: number, end: number}>} speechRegions - Current speech regions to highlight.
     * @param {number} audioDuration - Total duration of the audio in seconds.
     * @private
     */
     function drawWaveform(waveformData, canvas, ctx, speechRegions, audioDuration) {
        if (!ctx) return;

        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height); // Clear previous drawing

        if (!waveformData || waveformData.length === 0 || !audioDuration || audioDuration <= 0) {
            drawErrorText(ctx, canvas, "No waveform data available");
            return;
        }

        const dataLen = waveformData.length;
        const halfHeight = height / 2;
        const scale = halfHeight * WAVEFORM_HEIGHT_SCALE; // Vertical scaling
        const pixelsPerSecond = width / audioDuration; // Horizontal scaling

        // Pre-calculate speech region boundaries in pixels
        const speechPixelRegions = (speechRegions || []).map(r => ({
            startPx: r.start * pixelsPerSecond,
            endPx: r.end * pixelsPerSecond
        })).filter(r => r.endPx > r.startPx); // Filter out invalid regions

        const pixelWidth = width / dataLen; // Width of each vertical bar

        // Draw non-speech parts (Default color)
        ctx.fillStyle = '#3455db'; // Blue
        ctx.beginPath();
        for (let i = 0; i < dataLen; i++) {
            const x = i * pixelWidth;
            const currentPixelEnd = x + pixelWidth;
            let isOutsideSpeech = true;
            for (const region of speechPixelRegions) { // Check overlap with *any* speech region
                if (region.startPx < currentPixelEnd && region.endPx > x) {
                    isOutsideSpeech = false; break;
                }
            }
            if (isOutsideSpeech) {
                const { min, max } = waveformData[i];
                const y1 = halfHeight - max * scale; // Y increases downwards
                const y2 = halfHeight - min * scale;
                ctx.rect(x, y1, pixelWidth, Math.max(1, y2 - y1)); // Min height 1px
            }
        }
        ctx.fill();

        // Draw speech parts (Highlight color)
        ctx.fillStyle = 'orange'; // Highlight
        ctx.beginPath();
        for (let i = 0; i < dataLen; i++) {
            const x = i * pixelWidth;
            const currentPixelEnd = x + pixelWidth;
            let isInsideSpeech = false;
            for (const region of speechPixelRegions) { // Check overlap
                if (region.startPx < currentPixelEnd && region.endPx > x) {
                    isInsideSpeech = true; break;
                }
            }
            if (isInsideSpeech) {
                const { min, max } = waveformData[i];
                const y1 = halfHeight - max * scale;
                const y2 = halfHeight - min * scale;
                ctx.rect(x, y1, pixelWidth, Math.max(1, y2 - y1));
            }
        }
        ctx.fill();
    }

    /**
     * Draws the spectrogram onto the target canvas asynchronously using requestAnimationFrame.
     * Uses an offscreen canvas for rendering the full spectrogram at SPEC_FIXED_WIDTH,
     * then scales this to the visible canvas. Caches the offscreen canvas.
     * @param {Array<Float32Array>|null} spectrogramData - Computed data.
     * @param {HTMLCanvasElement} canvas - Visible canvas.
     * @param {CanvasRenderingContext2D} displayCtx - Visible canvas context.
     * @param {number} sampleRate - Audio sample rate.
     * @returns {Promise<void>} Resolves on completion, rejects on error.
     * @private
     */
    function drawSpectrogramAsync(spectrogramData, canvas, displayCtx, sampleRate) {
        return new Promise((resolve, reject) => {
            // Basic validation
            if (!canvas || !displayCtx) return reject(new Error("Spectrogram target canvas/context not found"));
            displayCtx.clearRect(0, 0, canvas.width, canvas.height); // Clear visible canvas

            if (!spectrogramData || spectrogramData.length === 0 || !spectrogramData[0]) {
                 console.warn("Visualizer: No valid spectrogram data to draw.");
                 drawErrorText(displayCtx, canvas, "No spectrogram data");
                 return resolve(); // Resolve successfully, nothing drawn
            }

            // Create or reuse offscreen canvas
            const offscreen = cachedSpectrogramCanvas || document.createElement('canvas');
            const needsInitialRender = !cachedSpectrogramCanvas; // Only render fully if cache is missing

            // Set offscreen dimensions (fixed width for calculation, current height for aspect)
            offscreen.width = SPEC_FIXED_WIDTH;
            offscreen.height = canvas.height; // Match visible canvas height
            const offCtx = offscreen.getContext('2d', { willReadFrequently: false }); // Hint if not reading back often
            if (!offCtx) return reject(new Error("Could not get 2D context for offscreen spectrogram canvas"));

            const computedSlices = spectrogramData.length;
            const height = offscreen.height;
            const numBins = spectrogramData[0].length;
            const nyquist = sampleRate / 2;

            // Determine highest frequency bin to display
            const maxBinIndex = Math.min(
                numBins - 1,
                Math.floor((SPECTROGRAM_MAX_FREQ / nyquist) * (numBins -1))
            );

            // Only perform full render if cache is missing
            if (needsInitialRender) {
                console.log("Visualizer: Rendering spectrogram to offscreen canvas...");
                // --- Calculate dB Range for Color Mapping ---
                const dbThreshold = -60; // dB floor
                let maxDb = -Infinity;
                const sliceStep = Math.max(1, Math.floor(computedSlices / 100)); // Sample ~100 slices
                const binStep = Math.max(1, Math.floor(maxBinIndex / 50)); // Sample ~50 bins/slice
                for (let i = 0; i < computedSlices; i += sliceStep) {
                    const magnitudes = spectrogramData[i];
                    if (!magnitudes) continue;
                    for (let j = 0; j <= maxBinIndex; j += binStep) {
                        const db = 20 * Math.log10((magnitudes[j] || 0) + 1e-9); // Magnitude to dB
                        maxDb = Math.max(maxDb, Math.max(dbThreshold, db)); // Apply floor and find max
                    }
                }
                maxDb = Math.max(maxDb, dbThreshold + 1); // Ensure range > 0
                const minDb = dbThreshold;
                const dbRange = maxDb - minDb;
                // console.log(`Visualizer Spectrogram dB range: ${minDb.toFixed(1)} to ${maxDb.toFixed(1)}`);

                // --- Asynchronous Drawing using requestAnimationFrame & ImageData ---
                const fullImageData = offCtx.createImageData(offscreen.width, height);
                const data = fullImageData.data; // Direct pixel access [R, G, B, A, ...]
                let currentSlice = 0;
                const chunkSize = 64; // Draw N slices per frame to yield main thread

                function drawChunk() {
                    try {
                        const startSlice = currentSlice;
                        const endSlice = Math.min(startSlice + chunkSize, computedSlices);

                        for (let i = startSlice; i < endSlice; i++) { // Time slice (horizontal pixel)
                            const magnitudes = spectrogramData[i];
                            if (!magnitudes) continue;

                            for (let y = 0; y < height; y++) { // Vertical pixel (frequency)
                                // Map vertical pixel to frequency bin (logarithmic-like emphasis on low freqs)
                                const freqRatio = (height - 1 - y) / (height - 1); // 0 (high) to 1 (low)
                                const logFreqRatio = Math.pow(freqRatio, 2.0); // Power > 1 emphasizes lower frequencies
                                const binIndex = Math.min(maxBinIndex, Math.floor(logFreqRatio * maxBinIndex));

                                // Get color based on magnitude at that bin
                                const magnitude = magnitudes[binIndex] || 0;
                                const db = 20 * Math.log10(magnitude + 1e-9);
                                const clampedDb = Math.max(minDb, db);
                                const normValue = dbRange > 0 ? (clampedDb - minDb) / dbRange : 0; // Normalize [0, 1]
                                const [r, g, b] = viridisColor(normValue); // Get Viridis color

                                // Set pixel data in ImageData
                                const idx = (i + y * offscreen.width) * 4;
                                data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255; // RGBA
                            }
                        }
                        currentSlice = endSlice;

                        // Draw the completed image data to the offscreen canvas
                        offCtx.putImageData(fullImageData, 0, 0);

                        if (currentSlice < computedSlices) {
                            requestAnimationFrame(drawChunk); // Schedule next chunk
                        } else {
                            // --- Finished Rendering to Offscreen Canvas ---
                            cachedSpectrogramCanvas = offscreen; // Cache the result
                            // Now draw the cached offscreen canvas onto the visible canvas
                            displayCtx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
                            console.log("Visualizer: Spectrogram async drawing complete.");
                            resolve(); // Resolve the promise
                        }
                    } catch (error) {
                         console.error("Visualizer: Error within async drawChunk:", error);
                         reject(error); // Reject the promise on error
                    }
                }
                requestAnimationFrame(drawChunk); // Start the drawing loop
            } else {
                // --- Cache Hit: Just draw the cached canvas ---
                // console.log("Visualizer: Drawing spectrogram from cache.");
                displayCtx.drawImage(cachedSpectrogramCanvas, 0, 0, canvas.width, canvas.height);
                resolve(); // Resolve immediately
            }
        });
    }

    /**
     * Simple Viridis colormap function.
     * @param {number} t - Normalized value [0, 1].
     * @returns {Array<number>} [r, g, b] array (0-255).
     * @private
     */
    function viridisColor(t) {
        // Simple lookup table interpolation (as used in Vibe Player)
        const colors = [ // [t, r, g, b]
            [0.0, 68, 1, 84], [0.1, 72, 40, 120], [0.2, 62, 74, 137],
            [0.3, 49, 104, 142], [0.4, 38, 130, 142], [0.5, 31, 155, 137],
            [0.6, 53, 178, 126], [0.7, 109, 199, 104], [0.8, 170, 217, 70],
            [0.9, 235, 231, 35], [1.0, 253, 231, 37] // ~Yellow end
        ];
        t = Math.max(0, Math.min(1, t)); // Clamp t
        let c1 = colors[0], c2 = colors[colors.length - 1];
        for (let i = 0; i < colors.length - 1; i++) {
            if (t >= colors[i][0] && t <= colors[i + 1][0]) {
                c1 = colors[i]; c2 = colors[i + 1]; break;
            }
        }
        const range = c2[0] - c1[0]; const ratio = (range === 0) ? 0 : (t - c1[0]) / range;
        const r = Math.round(c1[1] + ratio * (c2[1] - c1[1])); const g = Math.round(c1[2] + ratio * (c2[2] - c1[2])); const b = Math.round(c1[3] + ratio * (c2[3] - c1[3]));
        return [r, g, b];
    }

    /**
     * Helper to draw simple error text centered on a canvas.
     * @param {CanvasRenderingContext2D} ctx
     * @param {HTMLCanvasElement} canvas
     * @param {string} message
     * @private
     */
    function drawErrorText(ctx, canvas, message) {
        if (!ctx || !canvas) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear first
        ctx.fillStyle = '#D32F2F'; // Red
        ctx.textAlign = 'center';
        ctx.font = '14px sans-serif';
        ctx.fillText(message, canvas.width / 2, canvas.height / 2);
    }


    // --- UI Update Methods ---

    /**
     * Updates the position of the progress indicator lines on both canvases.
     * Called by main.js with time updates from the worklet.
     * @param {number} currentTime - Current playback time in seconds.
     * @param {number} duration - Total audio duration in seconds.
     * @public
     */
    function updateProgressIndicator(currentTime, duration) {
        // Prevent division by zero or NaN if duration is invalid or not yet known
        if (isNaN(duration) || duration <= 0) {
            if (waveformProgressIndicator) waveformProgressIndicator.style.left = "0px";
            if (spectrogramProgressIndicator) spectrogramProgressIndicator.style.left = "0px";
            return;
        }

        // Ensure currentTime is within bounds [0, duration]
        const clampedTime = Math.max(0, Math.min(currentTime, duration));
        const fraction = clampedTime / duration;

        // Update waveform indicator position based on current *display* width
        const waveformWidth = waveformCanvas ? waveformCanvas.clientWidth : 0;
        if (waveformProgressIndicator && waveformWidth > 0) {
            waveformProgressIndicator.style.left = (fraction * waveformWidth) + "px";
        } else if (waveformProgressIndicator) {
             waveformProgressIndicator.style.left = "0px"; // Reset if width is 0
        }

        // Update spectrogram indicator position
        const spectrogramWidth = spectrogramCanvas ? spectrogramCanvas.clientWidth : 0;
        if (spectrogramProgressIndicator && spectrogramWidth > 0) {
            spectrogramProgressIndicator.style.left = (fraction * spectrogramWidth) + "px";
        } else if (spectrogramProgressIndicator) {
             spectrogramProgressIndicator.style.left = "0px";
        }
    }

     /**
      * Clears both visualization canvases and resets the spectrogram cache.
      * @public
      */
     function clearVisuals() {
        console.log("Visualizer: Clearing visuals and cache.");
        if (waveformCtx && waveformCanvas) waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
        if (spectrogramCtx && spectrogramCanvas) spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
        cachedSpectrogramCanvas = null; // Invalidate spectrogram cache
        updateProgressIndicator(0, 1); // Reset progress bars visually to start
    }

    /**
     * Shows or hides the loading spinner for the spectrogram.
     * @param {boolean} show - True to show, false to hide.
     * @public
     */
    function showSpinner(show) {
        if (spectrogramSpinner) {
             spectrogramSpinner.style.display = show ? 'inline' : 'none';
        }
    }


    // --- Resizing Logic ---

    /**
     * Internal function to resize canvas rendering buffers to match their CSS dimensions.
     * Avoids unnecessary resizing if dimensions haven't changed.
     * @returns {boolean} True if any canvas rendering buffer was actually resized, false otherwise.
     * @private
     */
    function resizeCanvasesInternal() {
        let resized = false;
        [waveformCanvas, spectrogramCanvas].forEach(canvas => {
            if (!canvas) return;
            const { width, height } = canvas.getBoundingClientRect();
            const roundedWidth = Math.max(10, Math.round(width)); // Use client rect for CSS size
            const roundedHeight = Math.max(10, Math.round(height));

            // Only update if size actually changed to prevent unnecessary buffer clears
            if (canvas.width !== roundedWidth || canvas.height !== roundedHeight) {
                canvas.width = roundedWidth;   // Set buffer width
                canvas.height = roundedHeight; // Set buffer height
                // console.log(`Visualizer: Resized ${canvas.id} buffer to ${canvas.width}x${canvas.height}`);
                resized = true;
            }
        });
        return resized;
    }

    /**
     * Public method called on window resize event (via main.js).
     * Resizes canvases and redraws visualizations efficiently.
     * Redraws waveform from re-computed data for the new size.
     * Redraws spectrogram by scaling the cached offscreen image.
     * @param {AudioBuffer|null} audioBuffer - The current audio buffer (needed for waveform redraw).
     * @param {Array<{start: number, end: number}>|null} speechRegions - Current speech regions (for waveform).
     * @public
     */
     function resizeAndRedraw(audioBuffer, speechRegions) {
        const wasResized = resizeCanvasesInternal(); // Resize buffers first

        if (wasResized && audioBuffer) {
            // If canvases were resized AND we have audio data, redraw content
            console.log("Visualizer: Redrawing visuals after resize.");

            // --- Redraw Waveform ---
            // Recompute waveform data for the new width and redraw immediately.
            try {
                 redrawWaveformHighlight(audioBuffer, speechRegions || []);
            } catch(error) {
                 console.error("Visualizer: Error redrawing waveform on resize:", error);
            }


            // --- Redraw Spectrogram ---
            // Draw from cache if available, scaling to the new visible canvas size.
            if (cachedSpectrogramCanvas && spectrogramCtx && spectrogramCanvas) {
                 spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
                 // Draw cached image, scaling it from its fixed width/height to fit the new visible dimensions.
                 spectrogramCtx.drawImage(cachedSpectrogramCanvas, 0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
                 // console.log("Visualizer: Redrew spectrogram from cache after resize.");
            } else {
                 // If no cache (e.g., initial load failed or resize happened before completion),
                 // just clear the canvas or show a message. Recomputing on resize is too slow.
                 console.warn("Visualizer: Spectrogram cache missing on resize, clearing display.");
                  if(spectrogramCtx && spectrogramCanvas) {
                      drawErrorText(spectrogramCtx, spectrogramCanvas, "Resize occurred (no spectrogram cache)");
                  }
            }
        } else if (wasResized) {
            // If canvases resized but no audio buffer, ensure they are clear.
             if(waveformCtx && waveformCanvas) waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
             if(spectrogramCtx && spectrogramCanvas) spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
        }
        // Note: main.js is responsible for calling updateProgressIndicator separately
        // after a resize to ensure the indicator is positioned correctly based on current time.
    }


    // --- Public Interface ---
    return {
        init,
        computeAndDrawVisuals,
        redrawWaveformHighlight,
        resizeAndRedraw,
        updateProgressIndicator,
        clearVisuals,
        showSpinner
    };

})(window.FFT); // Pass the global FFT constructor

// --- /vibe-player/js/visualizer.js ---
