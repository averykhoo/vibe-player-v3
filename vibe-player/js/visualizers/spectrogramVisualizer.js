// --- /vibe-player/js/visualizers/spectrogramVisualizer.js ---
// Handles drawing the Spectrogram visualization to a canvas element.

/** @namespace AudioApp */
var AudioApp = AudioApp || {};

/**
 * @namespace AudioApp.spectrogramVisualizer
 * @description Manages the creation and rendering of an audio spectrogram.
 * It uses an FFT library for calculations and provides controls for frequency range toggling.
 * @param {function(new:FFT, number, number): FFT} globalFFT - Constructor for the FFT library (e.g., `window.FFT`).
 * @property {function(Function): void} init - Initializes the visualizer.
 * @property {function(AudioBuffer): Promise<void>} computeAndDrawSpectrogram - Computes and draws the spectrogram.
 * @property {function(AudioBuffer|null): void} resizeAndRedraw - Handles window resize.
 * @property {function(number, number): void} updateProgressIndicator - Updates the playback progress indicator.
 * @property {function(): void} clearVisuals - Clears the spectrogram display.
 * @property {function(boolean): void} showSpinner - Shows or hides a loading spinner.
 */
AudioApp.spectrogramVisualizer = (function(globalFFT) {
    'use strict';

     if (typeof globalFFT === 'undefined') {
        console.error("SpectrogramVisualizer: CRITICAL - FFT library constructor (e.g., window.FFT) not found globally!");
        /** @type {SpectrogramVisualizerPublicInterface} */
        const nonFunctionalInterface = {
             init: () => { console.error("SpectrogramVisualizer: Not initialized due to missing FFT library."); },
             computeAndDrawSpectrogram: () => Promise.reject(new Error("SpectrogramVisualizer: FFT library missing.")),
             resizeAndRedraw: () => {},
             updateProgressIndicator: () => {},
             clearVisuals: () => {},
             showSpinner: () => {}
         };
        return nonFunctionalInterface;
    }

    /**
     * @private
     * @type {AudioApp.Constants} Reference to the Constants module.
     */
    const Constants = AudioApp.Constants;
    /**
     * @private
     * @type {AudioApp.Utils} Reference to the Utils module.
     */
    const Utils = AudioApp.Utils;

    /** @type {HTMLCanvasElement|null} The canvas element for the spectrogram. */
    let spectrogramCanvas = null;
    /** @type {CanvasRenderingContext2D|null} The 2D rendering context of the spectrogram canvas. */
    let spectrogramCtx = null;
    /** @type {HTMLSpanElement|null} The loading spinner element. */
    let spectrogramSpinner = null;
    /** @type {HTMLDivElement|null} The playback progress indicator element. */
    let spectrogramProgressIndicator = null;

    /** @type {HTMLCanvasElement|null} Offscreen canvas for caching the rendered spectrogram image. */
    let cachedSpectrogramCanvas = null;
    /** @type {Function|null} Callback function to retrieve the current AudioBuffer from `app.js`. */
    let getSharedAudioBuffer = null;
    /** @type {number} Index for the `Constants.SPEC_MAX_FREQS` array, determining the current max frequency displayed. */
    let currentMaxFreqIndex = Constants.SPEC_DEFAULT_MAX_FREQ_INDEX;


    /**
     * Initializes the Spectrogram Visualizer module.
     * Assigns DOM elements and sets up event listeners, including the callback for audio buffer access.
     * @public
     * @param {function(): (AudioBuffer|null)} getAudioBufferCallback - A function that returns the current `AudioBuffer` from `app.js`.
     */
    function init(getAudioBufferCallback) {
        console.log("SpectrogramVisualizer: Initializing...");
        assignDOMElements();
        if (typeof getAudioBufferCallback === 'function') {
            getSharedAudioBuffer = getAudioBufferCallback;
        } else {
            console.warn("SpectrogramVisualizer: getAudioBufferCallback was not provided or is not a function during init. Frequency toggling might not have audio data.");
        }

        if (spectrogramCanvas) {
            spectrogramCanvas.addEventListener('click', handleCanvasClick);
            spectrogramCanvas.addEventListener('dblclick', handleCanvasDoubleClick);
        } else {
             console.warn("SpectrogramVisualizer: Spectrogram canvas element not found.");
        }
        console.log("SpectrogramVisualizer: Initialized.");
    }

    /**
     * Assigns DOM elements (canvas, spinner, progress indicator) to module-level variables.
     * @private
     */
    function assignDOMElements() {
        spectrogramCanvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('spectrogramCanvas'));
        spectrogramSpinner = /** @type {HTMLSpanElement|null} */ (document.getElementById('spectrogramSpinner'));
        spectrogramProgressIndicator = /** @type {HTMLDivElement|null} */ (document.getElementById('spectrogramProgressIndicator'));
        if (spectrogramCanvas) {
            spectrogramCtx = spectrogramCanvas.getContext('2d');
        } else {
            console.error("SpectrogramVisualizer: Could not find 'spectrogramCanvas' element.");
        }
        if (!spectrogramSpinner) console.warn("SpectrogramVisualizer: Could not find 'spectrogramSpinner' element.");
        if (!spectrogramProgressIndicator) console.warn("SpectrogramVisualizer: Could not find 'spectrogramProgressIndicator' element.");
    }


    /**
     * Handles click events on the spectrogram canvas for seeking playback.
     * Dispatches an 'audioapp:seekRequested' custom event with the seek fraction.
     * @private
     * @param {MouseEvent} e - The click MouseEvent.
     */
     function handleCanvasClick(e) {
        if (!spectrogramCanvas) return;
        const rect = spectrogramCanvas.getBoundingClientRect();
        if (!rect || rect.width <= 0) return; // Avoid division by zero
        const clickXRelative = e.clientX - rect.left;
        const fraction = Math.max(0, Math.min(1, clickXRelative / rect.width)); // Clamp to [0,1]
        document.dispatchEvent(new CustomEvent('audioapp:seekRequested', { detail: { fraction: fraction } }));
    }

    /**
     * Handles double-click events on the spectrogram canvas to toggle the displayed maximum frequency.
     * Cycles through frequencies defined in `AudioApp.Constants.SPEC_MAX_FREQS`.
     * Recomputes and redraws the spectrogram if an audio buffer is available.
     * @private
     * @param {MouseEvent} e - The double-click MouseEvent.
     */
    function handleCanvasDoubleClick(e) {
        if (!spectrogramCanvas || !Constants.SPEC_MAX_FREQS || Constants.SPEC_MAX_FREQS.length === 0) {
            console.warn("SpectrogramVisualizer: Cannot toggle frequency - Canvas or frequency constants not available.");
            return;
        }
        e.preventDefault(); // Prevent default double-click actions like text selection

        currentMaxFreqIndex = (currentMaxFreqIndex + 1) % Constants.SPEC_MAX_FREQS.length;
        const newMaxFreq = Constants.SPEC_MAX_FREQS[currentMaxFreqIndex];
        console.log(`SpectrogramVisualizer: Toggled max frequency to index ${currentMaxFreqIndex} (${newMaxFreq} Hz)`);

        const localAudioBuffer = getSharedAudioBuffer ? getSharedAudioBuffer() : null;
        if (localAudioBuffer) {
            computeAndDrawSpectrogram(localAudioBuffer); // Re-compute with new frequency
        } else {
            console.warn("SpectrogramVisualizer: Audio buffer not available for frequency toggle redraw. Spectrogram will update when audio is next processed.");
        }
    }


    /**
     * Computes the spectrogram data from an AudioBuffer and initiates drawing.
     * Manages UI state like showing/hiding a spinner.
     * @public
     * @async
     * @param {AudioBuffer|null} audioBufferFromParam - The AudioBuffer to process. Can be null if called after a frequency toggle without a readily available buffer.
     * @returns {Promise<void>} Resolves when the spectrogram is computed and drawn, or if no buffer is available.
     */
    async function computeAndDrawSpectrogram(audioBufferFromParam) {
        const localAudioBuffer = audioBufferFromParam || (getSharedAudioBuffer ? getSharedAudioBuffer() : null);

        if (!localAudioBuffer) { console.warn("SpectrogramVisualizer: AudioBuffer missing for computeAndDrawSpectrogram. Cannot proceed."); return; }
        if (!spectrogramCtx || !spectrogramCanvas) { console.warn("SpectrogramVisualizer: Canvas context or element missing. Cannot draw."); return; }
        if (!Constants || !Utils || !globalFFT) { console.error("SpectrogramVisualizer: Critical dependencies (Constants, Utils, FFT library) not loaded."); return; }

        // Validate and reset currentMaxFreqIndex if necessary
        if (currentMaxFreqIndex === undefined || currentMaxFreqIndex < 0 || currentMaxFreqIndex >= (Constants.SPEC_MAX_FREQS?.length || 0)) {
            console.warn(`SpectrogramVisualizer: Invalid currentMaxFreqIndex (${currentMaxFreqIndex}), resetting to default.`);
            currentMaxFreqIndex = Constants.SPEC_DEFAULT_MAX_FREQ_INDEX || 0;
        }

        console.log("SpectrogramVisualizer: Starting spectrogram computation and drawing...");
        clearVisualsInternal(); resizeCanvasInternal();
        cachedSpectrogramCanvas = null; showSpinner(true); // Reset cache and show spinner

        try {
            const actualFftSize = localAudioBuffer.duration < Constants.SPEC_SHORT_FILE_FFT_THRESHOLD_S ? Constants.SPEC_SHORT_FFT_SIZE : Constants.SPEC_NORMAL_FFT_SIZE;
            const currentMaxFreq = Constants.SPEC_MAX_FREQS[currentMaxFreqIndex];
            console.log(`SpectrogramVisualizer: Using FFT Size: ${actualFftSize}, Max Freq: ${currentMaxFreq} Hz for duration ${localAudioBuffer.duration.toFixed(2)}s.`);

            const spectrogramData = computeSpectrogram(localAudioBuffer, actualFftSize, Constants.SPEC_FIXED_WIDTH);

            if (spectrogramData && spectrogramData.length > 0) {
                await drawSpectrogramAsync(spectrogramData, spectrogramCanvas, localAudioBuffer.sampleRate, actualFftSize);
            } else {
                 console.warn("SpectrogramVisualizer: Spectrogram computation yielded no data or failed.");
                 if (spectrogramCtx && spectrogramCanvas) { // Check again before drawing error text
                    spectrogramCtx.fillStyle = '#888'; spectrogramCtx.textAlign = 'center'; spectrogramCtx.font = '12px sans-serif';
                    spectrogramCtx.fillText("Could not compute spectrogram", spectrogramCanvas.width / 2, spectrogramCanvas.height / 2);
                 }
            }
        } catch (error) {
            const err = /** @type {Error} */ (error);
            console.error("SpectrogramVisualizer: Error computing or drawing spectrogram:", err.message, err.stack);
            if (spectrogramCtx && spectrogramCanvas) {
                spectrogramCtx.fillStyle = '#D32F2F'; spectrogramCtx.textAlign = 'center'; spectrogramCtx.font = '14px sans-serif';
                spectrogramCtx.fillText(`Spectrogram Error: ${err.message.substring(0, 100)}`, spectrogramCanvas.width / 2, spectrogramCanvas.height / 2);
            }
        } finally {
            showSpinner(false);
        }
    }


    /**
     * Computes spectrogram data (array of magnitude arrays) from an AudioBuffer.
     * Uses FFT.js for Fast Fourier Transform calculations.
     * @private
     * @param {AudioBuffer} buffer - The audio buffer to analyze.
     * @param {number} actualFftSize - The FFT size to use for analysis.
     * @param {number} targetSlices - The desired number of time slices (columns) in the output spectrogram.
     * @returns {Float32Array[]|null} An array of Float32Arrays, where each inner array represents
     *                                 the magnitudes of frequency bins for a time slice. Returns null on critical error.
     */
     function computeSpectrogram(buffer, actualFftSize, targetSlices) {
        if (!buffer?.getChannelData) { console.error("SpectrogramVisualizer: Invalid AudioBuffer in computeSpectrogram."); return null; }
        if (!Constants || !Utils) { console.error("SpectrogramVisualizer: Constants or Utils not loaded for computeSpectrogram."); return null; }
        if ((actualFftSize & (actualFftSize - 1)) !== 0 || actualFftSize <= 1) { console.error(`SpectrogramVisualizer: Invalid FFT size: ${actualFftSize}. Must be power of 2.`); return null; }

        const channelData = buffer.getChannelData(0); // Process mono
        const totalSamples = channelData.length;
        const duration = buffer.duration;

        const hopDivisor = duration < Constants.SPEC_SHORT_FILE_HOP_THRESHOLD_S ? Constants.SPEC_SHORT_HOP_DIVISOR : Constants.SPEC_NORMAL_HOP_DIVISOR;
        const hopSize = Math.max(1, Math.floor(actualFftSize / hopDivisor));
        const padding = Constants.SPEC_CENTER_WINDOWS ? Math.floor(actualFftSize / 2) : 0;
        const rawSliceCount = Constants.SPEC_CENTER_WINDOWS ? Math.ceil(totalSamples / hopSize)
            : (totalSamples < actualFftSize ? 0 : Math.floor((totalSamples - actualFftSize) / hopSize) + 1);

        if (rawSliceCount <= 0) { console.warn("SpectrogramVisualizer: Not enough audio samples for FFT with current settings."); return []; }

        const fftInstance = new globalFFT(actualFftSize, buffer.sampleRate); // Pass sampleRate to FFT constructor
        const complexBuffer = fftInstance.createComplexArray(); // Reusable buffer for FFT output
        /** @type {number[]} */ const fftInput = new Array(actualFftSize); // Reusable input buffer for FFT
        const windowFunc = Utils.hannWindow(actualFftSize);
        if (!windowFunc) { console.error("SpectrogramVisualizer: Failed to generate Hann window."); return null; }

        /** @type {Float32Array[]} */ const rawSpec = [];
        for (let i = 0; i < rawSliceCount; i++) {
            const windowCenterSample = i * hopSize;
            const windowFetchStart = windowCenterSample - padding;
            for (let j = 0; j < actualFftSize; j++) {
                const sampleIndex = windowFetchStart + j;
                let sampleValue = 0.0; // Default to 0 for out-of-bounds (padding)
                if (sampleIndex >= 0 && sampleIndex < totalSamples) {
                    sampleValue = channelData[sampleIndex];
                } else if (sampleIndex < 0) { // Replication padding at start
                    sampleValue = totalSamples > 0 ? channelData[0] : 0.0;
                } else { // Replication padding at end
                    sampleValue = totalSamples > 0 ? channelData[totalSamples - 1] : 0.0;
                }
                fftInput[j] = sampleValue * windowFunc[j];
            }
            fftInstance.realTransform(complexBuffer, fftInput); // Perform FFT
            const numBins = actualFftSize / 2; // Number of useful frequency bins
            const magnitudes = new Float32Array(numBins);
            for (let k = 0; k < numBins; k++) {
                const re = complexBuffer[k * 2]; const im = complexBuffer[k * 2 + 1];
                magnitudes[k] = Math.sqrt(re * re + im * im); // Calculate magnitude
            }
            rawSpec.push(magnitudes);
        }

        if (rawSpec.length === 0) return [];
        // Resample slices if necessary to fit targetSlices (e.g., canvas width)
        if (rawSpec.length === targetSlices) return rawSpec;

        const numFreqBins = rawSpec[0].length;
        /** @type {Float32Array[]} */ const finalSpec = new Array(targetSlices);
        for (let i = 0; i < targetSlices; i++) {
             const rawPos = (rawSpec.length > 1) ? (i / (targetSlices - 1)) * (rawSpec.length - 1) : 0;
             const index1 = Math.floor(rawPos);
             const index2 = Math.min(rawSpec.length - 1, Math.ceil(rawPos));
             const factor = rawPos - index1;
             const magnitudes1 = rawSpec[index1]; const magnitudes2 = rawSpec[index2];
             finalSpec[i] = new Float32Array(numFreqBins);
             if (index1 === index2 || factor === 0) {
                 finalSpec[i].set(magnitudes1);
             } else { // Linear interpolation between slices
                 for (let k = 0; k < numFreqBins; k++) {
                     finalSpec[i][k] = magnitudes1[k] * (1.0 - factor) + magnitudes2[k] * factor;
                 }
             }
        }
        return finalSpec;
    }


    /**
     * Draws the spectrogram data onto the canvas. Uses an offscreen canvas for potentially smoother rendering.
     * Applies a color map (Viridis) and logarithmic frequency scaling.
     * @private
     * @async
     * @param {Float32Array[]} spectrogramData - Array of magnitude arrays for each time slice.
     * @param {HTMLCanvasElement} canvas - The visible canvas element to draw on.
     * @param {number} sampleRate - The sample rate of the audio.
     * @param {number} actualFftSize - The FFT size used for analysis.
     * @returns {Promise<void>} Resolves when drawing is complete.
     * @throws {Error} If drawing context cannot be obtained or critical dependencies are missing.
     */
    function drawSpectrogramAsync(spectrogramData, canvas, sampleRate, actualFftSize) {
        return new Promise((resolve, reject) => {
            if (!canvas || !spectrogramData?.[0] || !Constants || !Utils) {
                return reject(new Error("SpectrogramVisualizer: Missing critical dependencies for async draw (canvas, data, Constants, or Utils)."));
            }
            const displayCtx = canvas.getContext('2d');
            if (!displayCtx) return reject(new Error("SpectrogramVisualizer: Could not get 2D context from display canvas."));

            displayCtx.clearRect(0, 0, canvas.width, canvas.height);
            displayCtx.fillStyle = '#000'; displayCtx.fillRect(0, 0, canvas.width, canvas.height);

            const dataWidth = spectrogramData.length; const displayHeight = canvas.height;
            if (!cachedSpectrogramCanvas || cachedSpectrogramCanvas.width !== dataWidth || cachedSpectrogramCanvas.height !== displayHeight) {
                 cachedSpectrogramCanvas = document.createElement('canvas');
                 cachedSpectrogramCanvas.width = dataWidth; cachedSpectrogramCanvas.height = displayHeight;
            }
            const offCtx = cachedSpectrogramCanvas.getContext('2d', { willReadFrequently: false }); // Consider performance hint
            if (!offCtx) return reject(new Error("SpectrogramVisualizer: Could not get 2D context from offscreen cache canvas."));

            const numBins = actualFftSize / 2;
            const nyquist = sampleRate / 2;
            const currentSpecMaxFreq = Constants.SPEC_MAX_FREQS[currentMaxFreqIndex]; // Use current max freq
            const maxBinIndex = Math.min(numBins - 1, Math.floor((currentSpecMaxFreq / nyquist) * (numBins - 1)));

            // Simplified dB Range Calculation
            const dbThreshold = -60; let maxDb = -Infinity;
            const sliceStep = Math.max(1, Math.floor(dataWidth / 100)); // Sample ~100 slices for range
            const binStep = Math.max(1, Math.floor(maxBinIndex / 50));   // Sample ~50 bins for range
            for (let i = 0; i < dataWidth; i += sliceStep) {
                 const magnitudes = spectrogramData[i]; if (!magnitudes) continue;
                 for (let j = 0; j <= maxBinIndex; j += binStep) {
                     if (j >= magnitudes.length) break;
                     const db = 20 * Math.log10(Math.max(1e-9, magnitudes[j])); // Ensure non-zero for log
                     maxDb = Math.max(maxDb, Math.max(dbThreshold, db));
                 }
            }
            maxDb = Math.max(maxDb, dbThreshold + 1); // Ensure range is at least 1 dB
            const minDb = dbThreshold; const dbRange = maxDb - minDb;

            const fullImageData = offCtx.createImageData(dataWidth, displayHeight);
            const imgData = fullImageData.data; // Uint8ClampedArray: R,G,B,A values
            let currentSlice = 0; const chunkSize = 32; // Process in chunks for responsiveness

            function drawChunk() {
                try {
                    const startSlice = currentSlice; const endSlice = Math.min(startSlice + chunkSize, dataWidth);
                    for (let i = startSlice; i < endSlice; i++) { // Iterate over time slices (x-axis)
                        const magnitudes = spectrogramData[i]; if (!magnitudes || magnitudes.length !== numBins) continue;
                        for (let y = 0; y < displayHeight; y++) { // Iterate over pixel rows (y-axis, frequency)
                            const freqRatio = (displayHeight - 1 - y) / (displayHeight - 1); // Normalized y (0=Nyquist, 1=DC)
                            const logFreqRatio = Math.pow(freqRatio, 2.0); // Logarithmic scaling for frequency
                            const binIndex = Math.min(maxBinIndex, Math.floor(logFreqRatio * maxBinIndex)); // Map y to freq bin
                            const magnitude = magnitudes[binIndex] || 0;
                            const db = 20 * Math.log10(Math.max(1e-9, magnitude));
                            const normValue = dbRange > 0 ? (Math.max(minDb, db) - minDb) / dbRange : 0; // Normalize dB to [0,1]
                            const [r, g, b] = Utils.viridisColor(normValue); // Get RGB from colormap
                            const idx = (i + y * dataWidth) * 4; // Pixel index in ImageData
                            imgData[idx] = r; imgData[idx + 1] = g; imgData[idx + 2] = b; imgData[idx + 3] = 255; // Alpha
                        }
                    }
                    offCtx.putImageData(fullImageData, 0, 0, startSlice, 0, endSlice - startSlice, displayHeight);
                    currentSlice = endSlice;
                    if (currentSlice < dataWidth) { requestAnimationFrame(drawChunk); }
                    else { // Drawing finished
                        displayCtx.drawImage(cachedSpectrogramCanvas, 0, 0, canvas.width, canvas.height); // Scale to fit
                        resolve();
                    }
                } catch (error) {
                    const err = /** @type {Error} */ (error);
                    console.error("SpectrogramVisualizer: Error in drawChunk -", err.message, err.stack);
                    reject(err);
                }
            }
            requestAnimationFrame(drawChunk);
        });
    }


    /**
     * Updates the position of the playback progress indicator overlay on the spectrogram.
     * @public
     * @param {number} currentTime - The current playback time in seconds.
     * @param {number} duration - The total duration of the audio in seconds.
     */
    function updateProgressIndicator(currentTime, duration) {
        if (!spectrogramCanvas || !spectrogramProgressIndicator) return;
        if (isNaN(duration) || duration <= 0) {
            spectrogramProgressIndicator.style.left = "0px"; return;
        }
        const fraction = Math.max(0, Math.min(1, currentTime / duration));
        const spectrogramWidth = spectrogramCanvas.clientWidth;
        spectrogramProgressIndicator.style.left = spectrogramWidth > 0 ? `${fraction * spectrogramWidth}px` : "0px";
    }

    /**
     * Clears the spectrogram canvas, its offscreen cache, and resets the progress indicator.
     * @public
     */
    function clearVisuals() {
        console.log("SpectrogramVisualizer: Clearing visuals and cache.");
        clearVisualsInternal();
        cachedSpectrogramCanvas = null;
    }

    /**
     * Internal helper to clear the visible canvas and reset progress.
     * @private
     */
    function clearVisualsInternal() {
         if (spectrogramCtx && spectrogramCanvas) {
            spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
            spectrogramCtx.fillStyle = '#000'; // Explicitly set black background
            spectrogramCtx.fillRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
        }
        updateProgressIndicator(0, 1); // Reset progress indicator
    }

    /**
     * Shows or hides the loading spinner for the spectrogram.
     * @public
     * @param {boolean} show - True to show the spinner, false to hide it.
     */
    function showSpinner(show) {
        if (spectrogramSpinner) {
            spectrogramSpinner.style.display = show ? 'inline' : 'none';
        }
    }

    /**
     * Resizes the spectrogram canvas to match its CSS-defined display size.
     * Important for crisp rendering and correct coordinate calculations.
     * @private
     * @returns {boolean} True if the canvas was actually resized, false otherwise.
     */
    function resizeCanvasInternal() {
         if (!spectrogramCanvas) return false;
        const { width, height } = spectrogramCanvas.getBoundingClientRect();
        const roundedWidth = Math.max(10, Math.round(width)); // Ensure minimum dimensions
        const roundedHeight = Math.max(10, Math.round(height));
        if (spectrogramCanvas.width !== roundedWidth || spectrogramCanvas.height !== roundedHeight) {
            spectrogramCanvas.width = roundedWidth; spectrogramCanvas.height = roundedHeight;
             if(spectrogramCtx) { // Redraw background if context exists
                  spectrogramCtx.fillStyle = '#000';
                  spectrogramCtx.fillRect(0, 0, roundedWidth, roundedHeight);
             }
            return true;
        }
        return false;
    }

    /**
     * Handles window resize events. Adjusts canvas dimensions and redraws the
     * spectrogram from the offscreen cache if available.
     * @public
     * @param {AudioBuffer|null} audioBuffer - The current audio buffer (used for duration context with progress indicator).
     */
    function resizeAndRedraw(audioBuffer) {
        const wasResized = resizeCanvasInternal();
        if (wasResized && cachedSpectrogramCanvas && spectrogramCtx && spectrogramCanvas) {
             spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
             spectrogramCtx.fillStyle = '#000'; spectrogramCtx.fillRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
             spectrogramCtx.drawImage(cachedSpectrogramCanvas, 0, 0, spectrogramCanvas.width, spectrogramCanvas.height); // Scale cached image
        } else if (wasResized) {
            clearVisualsInternal(); // Clear if resized but no cache to redraw
        }
        // Always update progress indicator position as it depends on clientWidth
        const { currentTime = 0, duration = 0 } = AudioApp.audioEngine?.getCurrentTime() || {};
        updateProgressIndicator(currentTime, duration || (audioBuffer ? audioBuffer.duration : 0));
    }

    /**
     * @typedef {Object} SpectrogramVisualizerPublicInterface
     * @property {function(function(): (AudioBuffer|null)): void} init
     * @property {function(AudioBuffer|null): Promise<void>} computeAndDrawSpectrogram
     * @property {function(AudioBuffer|null): void} resizeAndRedraw
     * @property {function(number, number): void} updateProgressIndicator
     * @property {function(): void} clearVisuals
     * @property {function(boolean): void} showSpinner
     */

    /** @type {SpectrogramVisualizerPublicInterface} */
    return {
        init: init,
        computeAndDrawSpectrogram: computeAndDrawSpectrogram,
        resizeAndRedraw: resizeAndRedraw,
        updateProgressIndicator: updateProgressIndicator,
        clearVisuals: clearVisuals,
        showSpinner: showSpinner
    };

})(window.FFT);
// --- /vibe-player/js/visualizers/spectrogramVisualizer.js ---
