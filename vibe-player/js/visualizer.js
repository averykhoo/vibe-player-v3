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
    // Design Decision: Define visual parameters as constants for clarity.
    /** @const {number} How much vertical space the waveform uses (0 to 1) */
    const WAVEFORM_HEIGHT_SCALE = 0.8;
    /** @const {number} FFT window size (power of 2) */
    const SPECTROGRAM_FFT_SIZE = 1024;
    /** @const {number} Max frequency (Hz) to display on spectrogram Y-axis */
    const SPECTROGRAM_MAX_FREQ = 8000;
    /** @const {number} Fixed internal width for spectrogram calculation/caching. Larger values = more detail but more computation. */
    const SPEC_FIXED_WIDTH = 2048;

    // --- State ---
    /**
     * Offscreen canvas for caching the fully rendered spectrogram at SPEC_FIXED_WIDTH.
     * Avoids recomputing FFT on resize, allows faster redraws by scaling this cached image.
     * @type {HTMLCanvasElement|null}
     */
    let cachedSpectrogramCanvas = null;


    // --- Initialization ---

    /**
     * Initializes the Visualizer module: gets canvas elements and contexts, adds listeners.
     * @public
     */
    function init() {
        console.log("Visualizer: Initializing...");
        assignDOMElements();
        // Initial resize can be deferred until first draw or handled by app's initial resize call
        // resizeAndRedraw();
        console.log("Visualizer: Initialized.");
    }

    /**
     * Gets references to canvas elements and their rendering contexts.
     * Adds click listeners for seeking.
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
            waveformCanvas.addEventListener('click', handleCanvasClick);
        } else {
             console.warn("Visualizer: Waveform canvas not found.");
        }
        if (spectrogramCanvas) {
            spectrogramCtx = spectrogramCanvas.getContext('2d');
            spectrogramCanvas.addEventListener('click', handleCanvasClick);
        } else {
             console.warn("Visualizer: Spectrogram canvas not found.");
        }
    }

    // --- Event Handlers ---

    /**
     * Handles click events on either canvas. Calculates the click position as a fraction
     * of the total width and dispatches 'audioapp:seekRequested' for app.js to handle.
     * @param {MouseEvent} e - The click event.
     * @private
     */
     function handleCanvasClick(e) {
        const canvas = /** @type {HTMLCanvasElement} */ (e.target);
        const rect = canvas.getBoundingClientRect();
        // Prevent division by zero or invalid calculation if canvas has no width
        if (!rect || rect.width <= 0) return;

        const clickXRelative = e.clientX - rect.left;
        const fraction = Math.max(0, Math.min(1, clickXRelative / rect.width)); // Clamp fraction [0, 1]

        // Dispatch event with the fraction; app.js needs the audio duration to calculate the actual time.
        document.dispatchEvent(new CustomEvent('audioapp:seekRequested', {
            detail: { fraction: fraction }
        }));
    }


    // --- Core Drawing & Computation ---

    /**
     * Computes and draws both the waveform and spectrogram for the given audio buffer.
     * This is the main function called when a new audio file is loaded and processed.
     * @param {AudioBuffer} audioBuffer - The original, decoded audio buffer.
     * @param {Array<{start: number, end: number}>} speechRegions - The initial speech regions to highlight.
     * @returns {Promise<void>} A promise that resolves when async drawing (spectrogram) is complete.
     * @public
     */
    async function computeAndDrawVisuals(audioBuffer, speechRegions) {
        if (!audioBuffer) {
             console.warn("Visualizer: Cannot compute/draw visuals - AudioBuffer is missing.");
             return;
        }
        if (!waveformCtx || !spectrogramCtx) {
             console.warn("Visualizer: Cannot compute/draw visuals - Canvas context missing.");
             return;
        }
        console.log("Visualizer: Starting computation and drawing of visuals...");
        const startTime = performance.now();

        clearVisuals(); // Clear previous drawings and cache
        resizeCanvasesInternal(false); // Ensure canvas buffer sizes match CSS dimensions before drawing

        // --- Waveform ---
        // Design Decision: Waveform computation/drawing is synchronous and relatively fast.
        console.time("Waveform compute");
        const waveformData = computeWaveformData(audioBuffer, waveformCanvas.width);
        console.timeEnd("Waveform compute");
        console.time("Waveform draw");
        drawWaveform(waveformData, waveformCanvas, speechRegions, audioBuffer.duration);
        console.timeEnd("Waveform draw");

        // --- Spectrogram ---
        // Design Decision: Spectrogram computation (FFT) and drawing (pixel manipulation)
        // can be slow, so run asynchronously using requestAnimationFrame.
        // Show spinner during this process.
        cachedSpectrogramCanvas = null; // Invalidate cache for new audio
        showSpinner(true);
        console.time("Spectrogram compute");
        const spectrogramData = computeSpectrogram(audioBuffer, SPECTROGRAM_FFT_SIZE, SPEC_FIXED_WIDTH);
        console.timeEnd("Spectrogram compute");

        if (spectrogramData && spectrogramData.length > 0) {
             console.time("Spectrogram draw (async)");
             try {
                // Draw asynchronously to avoid blocking the main thread. Caches the result on completion.
                await drawSpectrogramAsync(spectrogramData, spectrogramCanvas, audioBuffer.sampleRate);
                console.timeEnd("Spectrogram draw (async)");
             } catch (error) {
                  console.error("Visualizer: Error drawing spectrogram asynchronously -", error);
                  // Display error message on canvas
                  spectrogramCtx.fillStyle = '#D32F2F'; // Red color for error
                  spectrogramCtx.textAlign = 'center';
                  spectrogramCtx.font = '14px sans-serif';
                  spectrogramCtx.fillText(`Spectrogram Error: ${error.message}`, spectrogramCanvas.width / 2, spectrogramCanvas.height / 2);
             } finally {
                showSpinner(false); // Hide spinner regardless of success/failure
             }
        } else {
             // Handle case where computation yielded no data
             console.warn("Visualizer: Spectrogram computation yielded no data or failed.");
             spectrogramCtx.fillStyle = '#888';
             spectrogramCtx.textAlign = 'center';
             spectrogramCtx.font = '12px sans-serif';
             spectrogramCtx.fillText("Could not compute spectrogram", spectrogramCanvas.width / 2, spectrogramCanvas.height / 2);
             showSpinner(false);
        }

        const endTime = performance.now();
        console.log(`Visualizer: Visuals processing took ${((endTime - startTime)/1000).toFixed(2)}s.`);
        updateProgressIndicator(0, audioBuffer.duration); // Ensure progress bars are reset
    }

    /**
     * Redraws only the waveform, specifically updating the speech region highlighting.
     * Assumes the canvas size hasn't changed significantly (or resizeAndRedraw was called).
     * Recomputes waveform data for current width to ensure accuracy.
     * @param {AudioBuffer} audioBuffer - The original decoded audio buffer.
     * @param {Array<{start: number, end: number}>} speechRegions - The *new* speech regions to highlight.
     * @public
     */
    function redrawWaveformHighlight(audioBuffer, speechRegions) {
         if (!audioBuffer || !waveformCtx || !waveformCanvas) {
             console.warn("Visualizer: Cannot redraw highlight - buffer or canvas context missing.");
             return;
         }
         // console.log("Visualizer: Redrawing waveform highlight.");
         // Recompute waveform data based on *current* canvas display width
         const waveformData = computeWaveformData(audioBuffer, waveformCanvas.width);
         // Redraw the entire waveform with the new region highlighting
         drawWaveform(waveformData, waveformCanvas, speechRegions, audioBuffer.duration);
    }

    // --- Computation Helper Functions ---

    /**
     * Computes simplified waveform data (min/max pairs per pixel column) for drawing.
     * Mixes down to mono if necessary.
     * @param {AudioBuffer} buffer - The original AudioBuffer.
     * @param {number} targetWidth - The target canvas width in pixels.
     * @returns {Array<{min: number, max: number}>} Array of min/max values for each pixel column.
     * @private
     */
    function computeWaveformData(buffer, targetWidth) {
        // Basic validation
        if (!buffer || !buffer.getChannelData || targetWidth <= 0) return [];
        const channelCount = buffer.numberOfChannels;
        const bufferLength = buffer.length;
        if (bufferLength === 0) return [];

        // Get audio data, mix down to mono if necessary using simple averaging
        const sourceData = channelCount > 1 ? new Float32Array(bufferLength).fill(0) : buffer.getChannelData(0);
        if (channelCount > 1) {
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

        // Determine samples per pixel column, ensuring at least 1
        const samplesPerPixel = Math.max(1, Math.floor(bufferLength / targetWidth));
        /** @type {Array<{min: number, max: number}>} */
        const waveform = [];

        // Iterate through each pixel column
        for (let i = 0; i < targetWidth; i++) {
            const start = Math.floor(i * samplesPerPixel);
            // Ensure end doesn't exceed buffer length
            const end = Math.min(start + samplesPerPixel, bufferLength);

            // Handle edge case where calculation results in empty segment
            if (start >= end) {
                waveform.push({min: 0, max: 0});
                continue;
            }

            // Find min/max within the segment
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
     * Computes spectrogram data (magnitude per frequency bin per time slice) using FFT.
     * Processes the *original* audio buffer's first channel.
     * @param {AudioBuffer} buffer - The original audio buffer.
     * @param {number} fftSize - The size of the FFT window (power of 2, e.g., 1024).
     * @param {number} targetSlices - The desired number of time slices (pixels) in the output (e.g., SPEC_FIXED_WIDTH).
     * @returns {Array<Float32Array>|null} Array of magnitude arrays (one per time slice), or null on error.
     * @private
     */
     function computeSpectrogram(buffer, fftSize, targetSlices) {
        if (!buffer || !buffer.getChannelData) {
             console.error("Visualizer: Invalid AudioBuffer provided to computeSpectrogram.");
             return null;
        }
        // Validate FFT size (must be power of 2 > 1)
        if ((fftSize & (fftSize - 1)) !== 0 || fftSize <= 1) {
             console.error(`Visualizer: Invalid FFT size for spectrogram: ${fftSize}. Must be a power of two > 1.`);
             return null;
        }

        // Use the first channel for spectrogram calculation.
        const channelData = buffer.getChannelData(0);
        const totalSamples = channelData.length;
        // Hop size determines overlap between FFT windows. fftSize/4 gives 75% overlap (common).
        const hopSize = Math.max(1, Math.floor(fftSize / 4));

        // Calculate the number of raw FFT slices we can get from the data.
        const rawSliceCount = totalSamples < fftSize
            ? 0 // Not enough samples for even one full frame
            : Math.floor((totalSamples - fftSize) / hopSize) + 1;

        if (rawSliceCount <= 0) {
            console.warn("Visualizer: Not enough audio samples for the chosen FFT size and hop size.");
            return []; // Return empty array if no slices can be computed
        }
        // console.log(`Visualizer Spectrogram Params: fftSize=${fftSize}, hopSize=${hopSize}, rawSlices=${rawSliceCount}, targetSlices=${targetSlices}`);

        // Create FFT instance using the global constructor provided by fft.js
        const fftInstance = new globalFFT(fftSize);
        // Output buffer for complex FFT results (interleaved real/imaginary).
        const complexBuffer = fftInstance.createComplexArray();
        // Input buffer for real FFT (windowed samples). Reused for each frame.
        const fftInput = new Array(fftSize);
        // Hann window function to reduce spectral leakage.
        const windowFunc = hannWindow(fftSize);
        if (!windowFunc) return null; // Stop if window creation failed

        /** @type {Array<Float32Array>} Store raw magnitude arrays */
        const rawSpec = [];

        // --- Calculate FFT for each overlapping frame ---
        for (let i = 0; i < rawSliceCount; i++) {
            const frameStart = i * hopSize;
            // Apply window function to the frame samples.
            for (let j = 0; j < fftSize; j++) {
                // Zero-pad if the frame extends beyond the actual audio data
                const sample = (frameStart + j < totalSamples) ? channelData[frameStart + j] : 0;
                fftInput[j] = sample * windowFunc[j];
            }

            // Perform the real FFT (expects real input, produces complex output).
            fftInstance.realTransform(complexBuffer, fftInput);

            // Calculate magnitudes from the complex results.
            // Only need the first half of the results (0 to Nyquist frequency).
            const magnitudes = new Float32Array(fftSize / 2);
            for (let k = 0; k < fftSize / 2; k++) {
                const re = complexBuffer[k * 2];
                const im = complexBuffer[k * 2 + 1];
                // Magnitude = sqrt(re^2 + im^2).
                const magSq = (re * re + im * im);
                // Ensure non-negative value before sqrt, though magSq should be >= 0.
                magnitudes[k] = Math.sqrt(magSq > 0 ? magSq : 0);
            }
            rawSpec.push(magnitudes);
        }

        // --- Resample/Select Slices to Match Target Width ---
        // Design Decision: Use simple nearest-neighbor selection for resampling time slices
        // to match the target width (SPEC_FIXED_WIDTH). This is fast but less smooth than interpolation.
        /** @type {Array<Float32Array>} */
        const finalSpec = new Array(targetSlices);
        const numRawSlices = rawSpec.length;

        if (numRawSlices === targetSlices) {
            // If counts match exactly, just copy references.
            for (let i = 0; i < numRawSlices; i++) {
                finalSpec[i] = rawSpec[i];
            }
        } else if (numRawSlices > 0) {
            // If counts differ, pick the nearest raw slice for each target slice position.
            for (let i = 0; i < targetSlices; i++) {
                // Calculate the 'ideal' corresponding position in the raw spectrum array.
                // Use targetSlices - 1 and numRawSlices - 1 for correct mapping from [0, target-1] to [0, raw-1].
                const t = (targetSlices > 1) ? (i / (targetSlices - 1)) : 0; // Normalized position [0, 1]
                const rawPos = t * (numRawSlices - 1);
                // Find the nearest raw slice index, clamping to valid range.
                const nearestIndex = Math.min(numRawSlices - 1, Math.max(0, Math.round(rawPos)));
                finalSpec[i] = rawSpec[nearestIndex]; // Assign the reference
            }
        }
        // If numRawSlices is 0, finalSpec remains an array of empty slots, which drawSpectrogramAsync should handle.

        return finalSpec;
    }

    /**
     * Generates a Hann window array. Used to reduce spectral leakage in FFT.
     * @param {number} length - The desired window length (should match fftSize).
     * @returns {Array<number>|null} The Hann window array, or null if length is invalid.
     * @private
     */
    function hannWindow(length) {
        if (length <= 0) return null;
        let windowArr = new Array(length);
        if (length === 1) {
            windowArr[0] = 1; // Window is just 1 for length 1
            return windowArr;
        }
        // Formula: 0.5 * (1 - cos(2 * PI * n / (N - 1))) where N is window length
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
     * @param {Array<{start: number, end: number}>} speechRegions - Current speech regions to highlight.
     * @param {number} audioDuration - Total duration of the audio in seconds.
     * @private
     */
     function drawWaveform(waveformData, canvas, speechRegions, audioDuration) {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const { width, height } = canvas;
        // Clear previous drawing
        ctx.clearRect(0, 0, width, height);

        // Handle cases with no data or invalid duration.
        if (!waveformData || waveformData.length === 0 || !audioDuration || audioDuration <= 0) {
            ctx.fillStyle = '#888'; ctx.textAlign = 'center'; ctx.font = '12px sans-serif';
            ctx.fillText("No waveform data", width / 2, height / 2);
            return;
        }

        const dataLen = waveformData.length;
        const halfHeight = height / 2;
        // Scale vertically based on canvas height and scale factor
        const scale = halfHeight * WAVEFORM_HEIGHT_SCALE;
        // Scale horizontally: pixels per second
        const pixelsPerSecond = width / audioDuration;

        // Pre-calculate speech region boundaries in pixels for efficient lookup during drawing.
        const speechPixelRegions = (speechRegions || [])
            .map(r => ({
                startPx: r.start * pixelsPerSecond,
                endPx: r.end * pixelsPerSecond
            }));

        // Width of each vertical bar in the waveform drawing
        const pixelWidth = width / dataLen;

        // Optimization: Draw non-speech and speech parts in separate loops/paths
        // to minimize canvas style changes (fillStyle).

        // 1. Draw non-speech parts (Default color)
        ctx.fillStyle = '#3455db'; // Blue for non-speech
        ctx.beginPath(); // Start a single path for all non-speech rectangles
        for (let i = 0; i < dataLen; i++) {
            const x = i * pixelWidth; // Starting X position of the bar
            const currentPixelEnd = x + pixelWidth; // Ending X position of the bar

            // Check if this bar (pixel column) overlaps with *any* speech region.
            let isOutsideSpeech = true;
            for (const region of speechPixelRegions) {
                // Basic overlap check: Is the region active within this pixel's span?
                // (Region starts before pixel ends) AND (Region ends after pixel starts)
                if (region.startPx < currentPixelEnd && region.endPx > x) {
                    isOutsideSpeech = false;
                    break; // Found an overlap, no need to check other regions
                }
            }

            // If it's entirely outside all speech regions, add its rectangle to the non-speech path.
            if (isOutsideSpeech) {
                const { min, max } = waveformData[i];
                // Y coordinates: Max value is top, Min value (negative) is bottom.
                const y1 = halfHeight - max * scale; // Top coordinate (canvas Y increases downwards)
                const y2 = halfHeight - min * scale; // Bottom coordinate
                // Use rect(), ensure minimum height of 1px for visibility
                ctx.rect(x, y1, pixelWidth, Math.max(1, y2 - y1));
            }
        }
        ctx.fill(); // Draw all non-speech rectangles added to the path at once

        // 2. Draw speech parts (Highlight color)
        ctx.fillStyle = 'orange'; // Orange for speech
        ctx.beginPath(); // Start a new path for all speech rectangles
        for (let i = 0; i < dataLen; i++) {
            const x = i * pixelWidth;
            const currentPixelEnd = x + pixelWidth;

            // Check if this bar overlaps with *any* speech region (same logic as above).
            let isInsideSpeech = false;
            for (const region of speechPixelRegions) {
                if (region.startPx < currentPixelEnd && region.endPx > x) {
                    isInsideSpeech = true;
                    break;
                }
            }

            // If it overlaps with a speech region, add its rectangle to the speech path.
            if (isInsideSpeech) {
                const { min, max } = waveformData[i];
                const y1 = halfHeight - max * scale;
                const y2 = halfHeight - min * scale;
                ctx.rect(x, y1, pixelWidth, Math.max(1, y2 - y1));
            }
        }
        ctx.fill(); // Draw all speech rectangles added to the path at once
    }

    /**
     * Draws the spectrogram onto the target canvas asynchronously using requestAnimationFrame.
     * Uses an offscreen canvas for rendering the full spectrogram at SPEC_FIXED_WIDTH,
     * then scales this to the visible canvas. Caches the offscreen canvas.
     * @param {Array<Float32Array>} spectrogramData - The computed spectrogram magnitude data.
     * @param {HTMLCanvasElement} canvas - The visible canvas element to draw onto.
     * @param {number} sampleRate - The original sample rate of the audio (for frequency scaling).
     * @returns {Promise<void>} A promise that resolves when drawing is complete, or rejects on error.
     * @private
     */
    function drawSpectrogramAsync(spectrogramData, canvas, sampleRate) {
        return new Promise((resolve, reject) => {
            // Basic validation
            if (!canvas) return reject(new Error("Spectrogram target canvas not found"));
            if (!spectrogramData || spectrogramData.length === 0 || !spectrogramData[0]) {
                 console.warn("Visualizer: No valid spectrogram data to draw.");
                 // Optionally draw a message on the canvas
                 const ctx = canvas.getContext('2d');
                 if (ctx) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = '#888'; ctx.textAlign = 'center'; ctx.font = '12px sans-serif';
                    ctx.fillText("No spectrogram data", canvas.width / 2, canvas.height / 2);
                 }
                 return resolve(); // Resolve successfully, nothing to draw
            }

            const displayCtx = canvas.getContext('2d');
            if (!displayCtx) return reject(new Error("Could not get 2D context for spectrogram canvas"));
            displayCtx.clearRect(0, 0, canvas.width, canvas.height); // Clear visible canvas initially

            // Create or reuse offscreen canvas for rendering
            // Design Decision: Render to a fixed-width offscreen canvas first (caching).
            const offscreen = document.createElement('canvas');
            offscreen.width = SPEC_FIXED_WIDTH; // Use fixed internal width for calculation/cache
            offscreen.height = canvas.height; // Use the *current* visible canvas height
            const offCtx = offscreen.getContext('2d', {
                 willReadFrequently: false, // Optimization hint if not reading back pixels often
                 // alpha: false // Can improve performance if transparency isn't needed
            });
            if (!offCtx) return reject(new Error("Could not get 2D context for offscreen spectrogram canvas"));

            const computedSlices = spectrogramData.length; // Should match SPEC_FIXED_WIDTH
            const height = offscreen.height;
            const numBins = spectrogramData[0].length; // Number of frequency bins (fftSize / 2)
            const nyquist = sampleRate / 2;

            // Determine the highest frequency bin index to display based on SPECTROGRAM_MAX_FREQ.
            const maxBinIndex = Math.min(
                numBins - 1, // Cannot exceed available bins
                Math.floor((SPECTROGRAM_MAX_FREQ / nyquist) * (numBins -1)) // Map max freq to bin index
            );

            // --- Calculate dB Range for Color Mapping ---
            // Design Decision: Find approximate max dB across a sample of the data for normalization.
            // This avoids iterating through every single magnitude value which can be slow.
            const dbThreshold = -60; // Floor level for dB values (lower values treated as this)
            let maxDb = -Infinity; // Start with very small value
            const sliceStep = Math.max(1, Math.floor(computedSlices / 100)); // Sample ~100 slices
            const binStep = Math.max(1, Math.floor(maxBinIndex / 50)); // Sample ~50 bins per slice
            for (let i = 0; i < computedSlices; i += sliceStep) {
                const magnitudes = spectrogramData[i];
                // Only iterate up to the max displayable bin index
                for (let j = 0; j <= maxBinIndex; j += binStep) {
                    // Convert magnitude to dB: 20 * log10(magnitude). Add small epsilon to avoid log(0).
                    // Use 1e-9 which is -180dB, well below threshold.
                    const db = 20 * Math.log10((magnitudes[j] || 0) + 1e-9);
                    // Clamp to threshold and update max
                    maxDb = Math.max(maxDb, Math.max(dbThreshold, db));
                }
            }
            // Ensure maxDb is at least slightly above minDb to avoid division by zero in normalization.
             maxDb = Math.max(maxDb, dbThreshold + 1);
             const minDb = dbThreshold;
             const dbRange = maxDb - minDb;
             // console.log(`Visualizer Spectrogram dB range: ${minDb.toFixed(1)} to ${maxDb.toFixed(1)}`);

            // --- Viridis Colormap Function (Lookup or interpolation) ---
            // Design Decision: Use Viridis, a perceptually uniform colormap.
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

            // --- Asynchronous Drawing using requestAnimationFrame ---
            // Design Decision: Draw in chunks to avoid blocking the main thread for too long.
            // Use putImageData for potentially faster pixel manipulation than fillRect per pixel.
            const fullImageData = offCtx.createImageData(offscreen.width, height);
            const data = fullImageData.data; // Uint8ClampedArray [R, G, B, A, ...]
            let currentSlice = 0;
            const chunkSize = 32; // Process N slices per animation frame

            function drawChunk() {
                try {
                    const startSlice = currentSlice;
                    const endSlice = Math.min(startSlice + chunkSize, computedSlices);

                    // Loop through time slices (horizontal pixels) in this chunk
                    for (let i = startSlice; i < endSlice; i++) {
                        if (!spectrogramData[i]) continue; // Skip if slice data is missing
                        const magnitudes = spectrogramData[i];

                        // Loop through vertical pixels (representing frequency)
                        for (let y = 0; y < height; y++) {
                            // Map vertical pixel position (y) to frequency bin index.
                            // Higher y means lower frequency.
                            // Use a logarithmic-like scale (power function) to emphasize lower frequencies.
                            // freqRatio goes 0 (high freq) to 1 (low freq) as y goes 0 to height-1
                            const freqRatio = (height - 1 - y) / (height - 1);
                            // Power > 1 emphasizes lower frequencies (stretches the bottom). Adjust power (e.g., 1.5 to 3.0) as needed.
                            const logFreqRatio = Math.pow(freqRatio, 2.0); // Quadratic emphasis on lower freqs
                            // Map the log-scaled ratio to the bin index, up to maxBinIndex
                            const binIndex = Math.min(maxBinIndex, Math.floor(logFreqRatio * maxBinIndex));

                            const magnitude = magnitudes[binIndex] || 0; // Get magnitude for the calculated bin
                            const db = 20 * Math.log10(magnitude + 1e-9); // Convert to dB
                            const clampedDb = Math.max(minDb, db); // Apply floor threshold
                            const normValue = dbRange > 0 ? (clampedDb - minDb) / dbRange : 0; // Normalize dB value to [0, 1]

                            const [r, g, b] = viridisColor(normValue); // Get color from colormap

                            // Calculate pixel index in the ImageData array.
                            // (x, y) maps to index: (x + y * width) * 4
                            const idx = (i + y * offscreen.width) * 4;

                            // Set RGBA values.
                            data[idx] = r;     // Red
                            data[idx + 1] = g; // Green
                            data[idx + 2] = b; // Blue
                            data[idx + 3] = 255; // Alpha (fully opaque)
                        }
                    }
                    currentSlice = endSlice; // Update progress for the next chunk

                    // Update the offscreen canvas with the new pixel data for the processed chunk
                    // For simplicity, redraw the whole buffer each time. Optimization: use putImageData with dirty rect (more complex).
                    offCtx.putImageData(fullImageData, 0, 0);

                    // If not finished, schedule the next chunk.
                    if (currentSlice < computedSlices) {
                        requestAnimationFrame(drawChunk);
                    } else {
                        // Drawing finished.
                        cachedSpectrogramCanvas = offscreen; // Cache the fully drawn offscreen canvas
                        // Draw the completed offscreen canvas onto the visible canvas, scaling if needed.
                        displayCtx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
                        console.log("Visualizer: Spectrogram async drawing complete.");
                        resolve(); // Resolve the promise indicating completion
                    }
                } catch (error) {
                     console.error("Visualizer: Error within async drawChunk -", error);
                     reject(error); // Reject the promise on error
                }
            }

            // Start the asynchronous drawing process.
            requestAnimationFrame(drawChunk);
        });
    }


    // --- UI Update Methods ---

    /**
     * Updates the position of the progress indicator lines on both canvases.
     * @param {number} currentTime - Current playback time in seconds.
     * @param {number} duration - Total audio duration in seconds.
     * @public
     */
    function updateProgressIndicator(currentTime, duration) {
        // Prevent division by zero or NaN if duration is invalid
        if (isNaN(duration) || duration <= 0) {
            if (waveformProgressIndicator) waveformProgressIndicator.style.left = "0px";
            if (spectrogramProgressIndicator) spectrogramProgressIndicator.style.left = "0px";
            return;
        }

        const fraction = currentTime / duration; // Calculate playback progress fraction [0, 1]

        // Update waveform progress indicator position based on current *display* width
        const waveformWidth = waveformCanvas ? waveformCanvas.clientWidth : 0;
        if (waveformProgressIndicator && waveformWidth > 0) {
            waveformProgressIndicator.style.left = (fraction * waveformWidth) + "px";
        } else if (waveformProgressIndicator) {
             waveformProgressIndicator.style.left = "0px"; // Reset if width is 0
        }

        // Update spectrogram progress indicator position
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
        cachedSpectrogramCanvas = null; // Invalidate cache
        updateProgressIndicator(0, 1); // Reset progress bars visually
    }

    /**
     * Shows or hides the loading spinner usually associated with the spectrogram.
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
     * Does not automatically redraw content.
     * @param {boolean} [forceRedraw=false] - Not used here, redraw handled by public method.
     * @returns {boolean} True if any canvas was actually resized, false otherwise.
     * @private
     */
    function resizeCanvasesInternal(forceRedraw = false) {
        let resized = false;
        // Iterate through canvases that need responsive sizing
        [waveformCanvas, spectrogramCanvas].forEach(canvas => {
            if (!canvas) return;
            // Get current CSS dimensions
            const { width, height } = canvas.getBoundingClientRect();
            // Round dimensions to avoid fractional pixels which can cause issues
            const roundedWidth = Math.max(10, Math.round(width)); // Ensure minimum size
            const roundedHeight = Math.max(10, Math.round(height));

            // Only update canvas bitmap size if it actually changed to avoid unnecessary redraws/clears
            if (canvas.width !== roundedWidth || canvas.height !== roundedHeight) {
                canvas.width = roundedWidth;
                canvas.height = roundedHeight;
                console.log(`Visualizer: Resized ${canvas.id} buffer to ${canvas.width}x${canvas.height}`);
                resized = true;
            }
        });
        return resized;
    }

    /**
     * Public method called on window resize. Resizes canvases and redraws visualizations.
     * Redraws waveform from computed data, redraws spectrogram by scaling the cache.
     * @param {AudioBuffer|null} audioBuffer - The current audio buffer (needed for waveform redraw).
     * @param {Array<{start: number, end: number}>|null} speechRegions - Current speech regions (needed for waveform).
     * @public
     */
     function resizeAndRedraw(audioBuffer, speechRegions) {
        const wasResized = resizeCanvasesInternal();

        if (wasResized && audioBuffer) {
            // If canvases were resized AND we have audio data, redraw content
            console.log("Visualizer: Redrawing visuals after resize.");

            // Redraw waveform immediately (computation is relatively fast)
            redrawWaveformHighlight(audioBuffer, speechRegions || []);

            // Redraw spectrogram by scaling the cached offscreen canvas
            if (cachedSpectrogramCanvas && spectrogramCtx && spectrogramCanvas) {
                 spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
                 // Draw cached image, scaling it to fit the new visible canvas dimensions.
                 spectrogramCtx.drawImage(cachedSpectrogramCanvas, 0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
                 console.log("Visualizer: Redrew spectrogram from cache.");
            } else {
                 // If no cache, maybe just show a message? Recomputing on resize is expensive.
                 console.warn("Visualizer: Spectrogram cache missing on resize, clearing display.");
                  if(spectrogramCtx && spectrogramCanvas) {
                      spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
                      spectrogramCtx.fillStyle = '#888';
                      spectrogramCtx.textAlign = 'center';
                      spectrogramCtx.font = '12px sans-serif';
                      spectrogramCtx.fillText("Resize occurred, no spectrogram cache.", spectrogramCanvas.width / 2, spectrogramCanvas.height / 2);
                  }
                 // Alternatively, trigger a full recompute if essential:
                 // showSpinner(true);
                 // computeAndDrawVisuals(audioBuffer, speechRegions || []).finally(() => showSpinner(false));
            }
        } else if (wasResized) {
            // If resized but no audio buffer, ensure canvases are clear (resize might clear them anyway)
             if(waveformCtx && waveformCanvas) waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
             if(spectrogramCtx && spectrogramCanvas) spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
        }
        // App controller should handle updating progress indicator position after resize via timeUpdate event.
    }


    // --- Public Interface ---
    // Expose methods needed by app.js to manage visualizations.
    return {
        init: init,
        computeAndDrawVisuals: computeAndDrawVisuals,
        redrawWaveformHighlight: redrawWaveformHighlight,
        resizeAndRedraw: resizeAndRedraw,
        updateProgressIndicator: updateProgressIndicator,
        clearVisuals: clearVisuals,
        showSpinner: showSpinner
    };

})(window.FFT); // Pass the global FFT constructor as a dependency
