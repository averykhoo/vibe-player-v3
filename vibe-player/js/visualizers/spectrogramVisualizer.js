// --- /vibe-player/js/visualizers/spectrogramVisualizer.js ---
// Handles drawing the Spectrogram visualization to a canvas element.

var AudioApp = AudioApp || {}; // Ensure namespace exists

// Design Decision: Use IIFE, pass the global FFT constructor dependency.
AudioApp.spectrogramVisualizer = (function(globalFFT) {
    'use strict';

    // Check if the required FFT library is available
     if (typeof globalFFT === 'undefined') {
        console.error("SpectrogramVisualizer: CRITICAL - FFT library constructor not found globally!");
        return { // Return non-functional interface
             init: () => {},
             computeAndDrawSpectrogram: () => Promise.resolve(),
             resizeAndRedraw: () => {},
             updateProgressIndicator: () => {},
             clearVisuals: () => {},
             showSpinner: () => {}
         };
    }

    // === Module Dependencies ===
    // Assuming AudioApp.Constants and AudioApp.Utils are loaded before this file.
    const Constants = AudioApp.Constants;
    const Utils = AudioApp.Utils;

    // === DOM Element References ===
    /** @type {HTMLCanvasElement|null} */ let spectrogramCanvas;
    /** @type {CanvasRenderingContext2D|null} */ let spectrogramCtx;
    /** @type {HTMLSpanElement|null} */ let spectrogramSpinner;
    /** @type {HTMLDivElement|null} */ let spectrogramProgressIndicator;

    // === State ===
    /** @type {HTMLCanvasElement|null} Offscreen canvas for caching the rendered spectrogram. */
    let cachedSpectrogramCanvas = null;

    // === Initialization ===

    /**
     * Initializes the Spectrogram Visualizer module.
     * @public
     */
    function init() {
        console.log("SpectrogramVisualizer: Initializing...");
        assignDOMElements();
        if (spectrogramCanvas) {
            spectrogramCanvas.addEventListener('click', handleCanvasClick);
        } else {
             console.warn("SpectrogramVisualizer: Spectrogram canvas not found.");
        }
        console.log("SpectrogramVisualizer: Initialized.");
    }

    /**
     * Gets references to spectrogram canvas elements, context, and spinner.
     * @private
     */
    function assignDOMElements() {
        spectrogramCanvas = document.getElementById('spectrogramCanvas');
        spectrogramSpinner = document.getElementById('spectrogramSpinner');
        spectrogramProgressIndicator = document.getElementById('spectrogramProgressIndicator');
        if (spectrogramCanvas) {
            spectrogramCtx = spectrogramCanvas.getContext('2d');
        }
    }

    // === Event Handlers ===

    /**
     * Handles click events on the spectrogram canvas for seeking.
     * Dispatches 'audioapp:seekRequested'.
     * @param {MouseEvent} e - The click event.
     * @private
     */
     function handleCanvasClick(e) {
        if (!spectrogramCanvas) return;
        const rect = spectrogramCanvas.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;
        const clickXRelative = e.clientX - rect.left;
        const fraction = Math.max(0, Math.min(1, clickXRelative / rect.width));
        document.dispatchEvent(new CustomEvent('audioapp:seekRequested', { detail: { fraction: fraction } }));
    }

    // === Core Drawing & Computation ===

    /**
     * Computes and draws the spectrogram for the given audio buffer.
     * Shows spinner during computation/drawing.
     * @param {AudioBuffer} audioBuffer - The original, decoded audio buffer.
     * @returns {Promise<void>} Resolves when async drawing is complete.
     * @public
     */
    async function computeAndDrawSpectrogram(audioBuffer) {
        if (!audioBuffer) { console.warn("SpectrogramVisualizer: AudioBuffer missing."); return; }
        if (!spectrogramCtx || !spectrogramCanvas) { console.warn("SpectrogramVisualizer: Canvas context/element missing."); return; }
        if (!Constants || !Utils || !globalFFT) { console.error("SpectrogramVisualizer: Dependencies (Constants, Utils, FFT) not loaded."); return; }

        console.log("SpectrogramVisualizer: Starting computation and drawing...");
        const startTime = performance.now();

        clearVisualsInternal(); // Clear before drawing
        resizeCanvasInternal(); // Ensure correct size

        // Clear cache and show spinner
        cachedSpectrogramCanvas = null;
        showSpinner(true);

        console.time("Spectrogram compute");
        const actualFftSize = audioBuffer.duration < Constants.SPEC_SHORT_FILE_FFT_THRESHOLD_S ? Constants.SPEC_SHORT_FFT_SIZE : Constants.SPEC_NORMAL_FFT_SIZE;
        console.log(`SpectrogramVisualizer: Using FFT Size: ${actualFftSize} for duration ${audioBuffer.duration.toFixed(2)}s`);
        const spectrogramData = computeSpectrogram(audioBuffer, actualFftSize, Constants.SPEC_FIXED_WIDTH);
        console.timeEnd("Spectrogram compute");

        if (spectrogramData && spectrogramData.length > 0) {
             console.time("Spectrogram draw (async)");
             try {
                // Draw asynchronously to offscreen canvas, then display
                await drawSpectrogramAsync(spectrogramData, spectrogramCanvas, audioBuffer.sampleRate, actualFftSize);
                console.timeEnd("Spectrogram draw (async)");
             } catch (error) {
                  console.error("SpectrogramVisualizer: Error drawing spectrogram asynchronously -", error);
                  spectrogramCtx.fillStyle = '#D32F2F'; spectrogramCtx.textAlign = 'center'; spectrogramCtx.font = '14px sans-serif';
                  spectrogramCtx.fillText(`Spectrogram Error: ${error.message}`, spectrogramCanvas.width / 2, spectrogramCanvas.height / 2);
             } finally {
                showSpinner(false);
             }
        } else {
             console.warn("SpectrogramVisualizer: Spectrogram computation yielded no data or failed.");
             spectrogramCtx.fillStyle = '#888'; spectrogramCtx.textAlign = 'center'; spectrogramCtx.font = '12px sans-serif';
             spectrogramCtx.fillText("Could not compute spectrogram", spectrogramCanvas.width / 2, spectrogramCanvas.height / 2);
             showSpinner(false);
        }

        const endTime = performance.now();
        console.log(`SpectrogramVisualizer: Processing took ${((endTime - startTime)/1000).toFixed(2)}s.`);
        updateProgressIndicator(0, audioBuffer.duration);
    }

    // --- Computation Helper Functions ---

    /**
     * Computes spectrogram data using FFT.js.
     * Applies Replication Padding and adaptive hopSize. Uses LINEAR INTERPOLATION for resampling slices.
     * Relies on AudioApp.Constants and AudioApp.Utils.
     * @param {AudioBuffer} buffer
     * @param {number} actualFftSize
     * @param {number} targetSlices (e.g., Constants.SPEC_FIXED_WIDTH)
     * @returns {Array<Float32Array>|null} Array of magnitude arrays or null on error.
     * @private
     */
     function computeSpectrogram(buffer, actualFftSize, targetSlices) {
        if (!buffer?.getChannelData) { console.error("SpectrogramVisualizer: Invalid AudioBuffer"); return null; }
        if (!Constants || !Utils) { console.error("SpectrogramVisualizer: Constants or Utils not loaded."); return null; }
        if ((actualFftSize & (actualFftSize - 1)) !== 0 || actualFftSize <= 1) { console.error(`SpectrogramVisualizer: Invalid FFT size: ${actualFftSize}`); return null; }

        const channelData = buffer.getChannelData(0); // Use channel 0 (assuming mono or taking first channel)
        const totalSamples = channelData.length;
        const duration = buffer.duration;

        const hopDivisor = duration < Constants.SPEC_SHORT_FILE_HOP_THRESHOLD_S ? Constants.SPEC_SHORT_HOP_DIVISOR : Constants.SPEC_NORMAL_HOP_DIVISOR;
        const hopSize = Math.max(1, Math.floor(actualFftSize / hopDivisor));

        const padding = Constants.SPEC_CENTER_WINDOWS ? Math.floor(actualFftSize / 2) : 0;
        const rawSliceCount = Constants.SPEC_CENTER_WINDOWS
            ? Math.ceil(totalSamples / hopSize)
            : (totalSamples < actualFftSize ? 0 : Math.floor((totalSamples - actualFftSize) / hopSize) + 1);

        if (rawSliceCount <= 0) { console.warn("SpectrogramVisualizer: Not enough audio samples for FFT."); return []; }

        const fftInstance = new globalFFT(actualFftSize);
        const complexBuffer = fftInstance.createComplexArray();
        const fftInput = new Array(actualFftSize);
        const windowFunc = Utils.hannWindow(actualFftSize); // Use Utils
        if (!windowFunc) return null;

        const rawSpec = [];
        for (let i = 0; i < rawSliceCount; i++) {
            const windowCenterSample = i * hopSize;
            const windowFetchStart = windowCenterSample - padding;
            for (let j = 0; j < actualFftSize; j++) {
                const sampleIndex = windowFetchStart + j;
                let sampleValue;
                if (sampleIndex < 0) { sampleValue = channelData[0]; }
                else if (sampleIndex >= totalSamples) { sampleValue = totalSamples > 0 ? channelData[totalSamples - 1] : 0.0; }
                else { sampleValue = channelData[sampleIndex]; }
                fftInput[j] = sampleValue * windowFunc[j];
            }
            fftInstance.realTransform(complexBuffer, fftInput);
            const numBins = actualFftSize / 2;
            const magnitudes = new Float32Array(numBins);
            for (let k = 0; k < numBins; k++) {
                const re = complexBuffer[k * 2]; const im = complexBuffer[k * 2 + 1];
                const magSq = (re * re + im * im);
                magnitudes[k] = Math.sqrt(magSq > 0 ? magSq : 0);
            }
            rawSpec.push(magnitudes);
        }

        // --- Resample/Interpolate Slices ---
        const numRawSlices = rawSpec.length;
        if (numRawSlices === 0) return [];
        const numFreqBins = rawSpec[0].length;
        const finalSpec = new Array(targetSlices);

        if (numRawSlices === targetSlices) {
             for (let i = 0; i < numRawSlices; i++) { finalSpec[i] = rawSpec[i]; }
        } else if (numRawSlices > 0) {
            for (let i = 0; i < targetSlices; i++) {
                 const rawPos = (numRawSlices > 1) ? (i / (targetSlices - 1)) * (numRawSlices - 1) : 0;
                 const index1 = Math.floor(rawPos);
                 const index2 = Math.min(numRawSlices - 1, Math.ceil(rawPos));
                 const factor = rawPos - index1;
                 const magnitudes1 = rawSpec[index1]; const magnitudes2 = rawSpec[index2];
                 finalSpec[i] = new Float32Array(numFreqBins);
                 if (index1 === index2 || factor === 0) { finalSpec[i].set(magnitudes1); }
                 else { for (let k = 0; k < numFreqBins; k++) { finalSpec[i][k] = magnitudes1[k] * (1.0 - factor) + magnitudes2[k] * factor; } }
            }
        }
        return finalSpec;
    }

    // --- Drawing Helper Functions ---

    /**
     * Draws the spectrogram asynchronously to an offscreen cache, then to the visible canvas.
     * Uses viridisColor from AudioApp.Utils.
     * @param {Array<Float32Array>} spectrogramData
     * @param {HTMLCanvasElement} canvas
     * @param {number} sampleRate
     * @param {number} actualFftSize
     * @returns {Promise<void>}
     * @private
     */
    function drawSpectrogramAsync(spectrogramData, canvas, sampleRate, actualFftSize) {
        return new Promise((resolve, reject) => {
            if (!canvas || !spectrogramData?.[0] || !Constants || !Utils) {
                 // Simplified checks, ensure critical deps exist
                console.warn("SpectrogramVisualizer: Missing canvas, data, Constants or Utils for async draw.");
                return reject(new Error("Missing dependencies for async draw"));
            }

            const displayCtx = canvas.getContext('2d');
            if (!displayCtx) return reject(new Error("Could not get 2D context for spectrogram canvas"));

            displayCtx.clearRect(0, 0, canvas.width, canvas.height); // Clear display canvas
             displayCtx.fillStyle = '#000'; // Explicitly set black background
             displayCtx.fillRect(0, 0, canvas.width, canvas.height);

            // Create/reuse offscreen cache canvas
            const dataWidth = spectrogramData.length;
            const displayHeight = canvas.height;
            if (!cachedSpectrogramCanvas || cachedSpectrogramCanvas.width !== dataWidth || cachedSpectrogramCanvas.height !== displayHeight) {
                 cachedSpectrogramCanvas = document.createElement('canvas');
                 cachedSpectrogramCanvas.width = dataWidth;
                 cachedSpectrogramCanvas.height = displayHeight;
                 console.log(`SpectrogramVisualizer: Created/resized cache canvas (${dataWidth}x${displayHeight})`);
            }
            const offCtx = cachedSpectrogramCanvas.getContext('2d', { willReadFrequently: false });
            if (!offCtx) return reject(new Error("Could not get 2D context for offscreen spectrogram"));

            const computedSlices = dataWidth;
            const height = displayHeight;
            const numBins = actualFftSize / 2;
            const nyquist = sampleRate / 2;
            const maxBinIndex = Math.min(numBins - 1, Math.floor((Constants.SPEC_MAX_FREQ / nyquist) * (numBins - 1)));

            // Calculate dB Range (simplified sampling)
            const dbThreshold = -60; let maxDb = -Infinity;
            const sliceStep = Math.max(1, Math.floor(computedSlices / 100));
            const binStep = Math.max(1, Math.floor(maxBinIndex / 50));
            for (let i = 0; i < computedSlices; i += sliceStep) {
                 const magnitudes = spectrogramData[i]; if (!magnitudes) continue;
                 for (let j = 0; j <= maxBinIndex; j += binStep) {
                     if (j >= magnitudes.length) break;
                     const db = 20 * Math.log10((magnitudes[j] || 0) + 1e-9);
                     maxDb = Math.max(maxDb, Math.max(dbThreshold, db));
                 }
            }
            maxDb = Math.max(maxDb, dbThreshold + 1);
            const minDb = dbThreshold; const dbRange = maxDb - minDb;

            // Async Drawing Loop (using rAF)
            const fullImageData = offCtx.createImageData(computedSlices, height);
            const data = fullImageData.data;
            let currentSlice = 0; const chunkSize = 32;

            function drawChunk() {
                try {
                    const startSlice = currentSlice; const endSlice = Math.min(startSlice + chunkSize, computedSlices);
                    for (let i = startSlice; i < endSlice; i++) {
                        if (!spectrogramData[i]) continue;
                        const magnitudes = spectrogramData[i];
                        if (magnitudes.length !== numBins) continue; // Basic check
                        for (let y = 0; y < height; y++) {
                            const freqRatio = (height - 1 - y) / (height - 1);
                            const logFreqRatio = Math.pow(freqRatio, 2.0);
                            const binIndex = Math.min(maxBinIndex, Math.floor(logFreqRatio * maxBinIndex));
                            const magnitude = magnitudes[binIndex] || 0;
                            const db = 20 * Math.log10(magnitude + 1e-9);
                            const clampedDb = Math.max(minDb, db);
                            const normValue = dbRange > 0 ? (clampedDb - minDb) / dbRange : 0;
                            const [r, g, b] = Utils.viridisColor(normValue); // Use Utils
                            const idx = (i + y * computedSlices) * 4;
                            data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255;
                        }
                    }
                    offCtx.putImageData(fullImageData, 0, 0, startSlice, 0, endSlice - startSlice, height); // Update chunk
                    currentSlice = endSlice;
                    if (currentSlice < computedSlices) { requestAnimationFrame(drawChunk); }
                    else { // Drawing finished
                        displayCtx.drawImage(cachedSpectrogramCanvas, 0, 0, canvas.width, canvas.height); // Final copy
                        resolve();
                    }
                } catch (error) { console.error("SpectrogramVisualizer: Error in drawChunk -", error); reject(error); }
            }
            requestAnimationFrame(drawChunk); // Start loop
        });
    }

    // --- UI Update Methods ---

    /**
     * Updates the position of the progress indicator overlay.
     * @param {number} currentTime - The current playback time in seconds.
     * @param {number} duration - The total audio duration in seconds.
     * @public
     */
    function updateProgressIndicator(currentTime, duration) {
        if (!spectrogramCanvas || !spectrogramProgressIndicator) return;
        if (isNaN(duration) || duration <= 0) {
            spectrogramProgressIndicator.style.left = "0px";
            return;
        }
        const fraction = Math.max(0, Math.min(1, currentTime / duration));
        const spectrogramWidth = spectrogramCanvas.clientWidth;
        if (spectrogramWidth > 0) {
            spectrogramProgressIndicator.style.left = (fraction * spectrogramWidth) + "px";
        } else {
            spectrogramProgressIndicator.style.left = "0px"; // Fallback
        }
    }

    /**
     * Clears the spectrogram visualization canvas and cache.
     * @public
     */
    function clearVisuals() {
        console.log("SpectrogramVisualizer: Clearing visuals and cache.");
        clearVisualsInternal();
        cachedSpectrogramCanvas = null; // Clear the cache
    }

    /** Internal helper to clear canvas */
    function clearVisualsInternal() {
         if (spectrogramCtx && spectrogramCanvas) {
            spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
             // Optionally draw black background on clear
             spectrogramCtx.fillStyle = '#000';
             spectrogramCtx.fillRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
        }
        // Reset progress indicator
        updateProgressIndicator(0, 1);
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
     * Resizes canvas to match its displayed size. Internal use.
     * @returns {boolean} True if the canvas was actually resized.
     * @private
     */
    function resizeCanvasInternal() {
         if (!spectrogramCanvas) return false;
        const { width, height } = spectrogramCanvas.getBoundingClientRect();
        const roundedWidth = Math.max(10, Math.round(width));
        const roundedHeight = Math.max(10, Math.round(height));
        if (spectrogramCanvas.width !== roundedWidth || spectrogramCanvas.height !== roundedHeight) {
            spectrogramCanvas.width = roundedWidth;
            spectrogramCanvas.height = roundedHeight;
             // Redraw black background after resize
             if(spectrogramCtx) {
                  spectrogramCtx.fillStyle = '#000';
                  spectrogramCtx.fillRect(0, 0, roundedWidth, roundedHeight);
             }
            return true;
        }
        return false;
    }

    /**
     * Handles window resize: adjusts canvas dimensions and redraws spectrogram from cache.
     * @param {AudioBuffer | null} audioBuffer - Current audio buffer (used for duration).
     * @public
     */
    function resizeAndRedraw(audioBuffer) {
        const wasResized = resizeCanvasInternal();

        if (wasResized && cachedSpectrogramCanvas && spectrogramCtx && spectrogramCanvas) {
            console.log("SpectrogramVisualizer: Redrawing spectrogram from cache after resize.");
             spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
             spectrogramCtx.fillStyle = '#000'; // Ensure black background
             spectrogramCtx.fillRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
             spectrogramCtx.drawImage( // Draw cached image scaled
                 cachedSpectrogramCanvas,
                 0, 0, cachedSpectrogramCanvas.width, cachedSpectrogramCanvas.height,
                 0, 0, spectrogramCanvas.width, spectrogramCanvas.height
             );
        } else if (wasResized) {
            clearVisualsInternal(); // Clear if resized but no cache
        }
        // Always update progress indicator after resize
        const { currentTime = 0, duration = 0 } = AudioApp.audioEngine?.getCurrentTime() || {};
        updateProgressIndicator(currentTime, duration || (audioBuffer ? audioBuffer.duration : 0));
    }

    // === Public Interface ===
    return {
        init: init,
        computeAndDrawSpectrogram: computeAndDrawSpectrogram,
        resizeAndRedraw: resizeAndRedraw,
        updateProgressIndicator: updateProgressIndicator,
        clearVisuals: clearVisuals,
        showSpinner: showSpinner
    };

})(window.FFT); // Pass the global FFT constructor
// --- /vibe-player/js/visualizers/spectrogramVisualizer.js ---
