// vibe-player/js/visualizers/waveformVisualizer.js
// Handles drawing the Waveform visualization to a canvas element.

/** @namespace AudioApp */
var AudioApp = AudioApp || {};

/**
 * @namespace AudioApp.waveformVisualizer
 * @description Manages the rendering of the audio waveform, including highlighting speech regions
 * and displaying a playback progress indicator.
 */
AudioApp.waveformVisualizer = (function () {
    'use strict';

    /**
     * @private
     * @type {AudioApp.Constants} Reference to the Constants module.
     */
    // const Constants = AudioApp.Constants; // Constants is now a global class
    /**
     * @private
     * @type {AudioApp.Utils} Reference to the Utils module (not directly used in this snippet but assumed available if needed).
     */
    const Utils = AudioApp.Utils;

    /** @type {HTMLCanvasElement|null} The canvas element for the waveform. */
    let waveformCanvas = null;
    /** @type {CanvasRenderingContext2D|null} The 2D rendering context of the waveform canvas. */
    let waveformCtx = null;
    /** @type {HTMLDivElement|null} The element used to indicate playback progress on the waveform. */
    let waveformProgressIndicator = null;


    /**
     * Initializes the Waveform Visualizer.
     * Retrieves DOM elements and sets up event listeners.
     * @public
     */
    function init() {
        console.log("WaveformVisualizer: Initializing...");
        assignDOMElements();
        if (waveformCanvas) {
            waveformCanvas.addEventListener('click', handleCanvasClick);
        } else {
            console.warn("WaveformVisualizer: Waveform canvas element not found during init.");
        }
        console.log("WaveformVisualizer: Initialized.");
    }

    /**
     * Assigns DOM elements to module-level variables.
     * @private
     */
    function assignDOMElements() {
        waveformCanvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('waveformCanvas'));
        waveformProgressIndicator = /** @type {HTMLDivElement|null} */ (document.getElementById('waveformProgressIndicator'));
        if (waveformCanvas) {
            waveformCtx = waveformCanvas.getContext('2d');
        } else {
            console.error("WaveformVisualizer: Could not find 'waveformCanvas' element.");
        }
        if (!waveformProgressIndicator) {
            console.warn("WaveformVisualizer: Could not find 'waveformProgressIndicator' element.");
        }
    }


    /**
     * Handles click events on the waveform canvas, dispatching a seek request.
     * @private
     * @param {MouseEvent} e - The MouseEvent from the click.
     */
    function handleCanvasClick(e) {
        if (!waveformCanvas) return;
        const rect = waveformCanvas.getBoundingClientRect();
        if (!rect || rect.width <= 0) return; // Avoid division by zero if canvas has no width
        const clickXRelative = e.clientX - rect.left;
        const fraction = Math.max(0, Math.min(1, clickXRelative / rect.width)); // Clamp fraction to [0, 1]
        document.dispatchEvent(new CustomEvent('audioapp:seekRequested', {detail: {fraction: fraction}}));
    }


    /**
     * @typedef {object} SpeechRegion
     * @property {number} start - Start time of the speech region in seconds.
     * @property {number} end - End time of the speech region in seconds.
     */

    /**
     * Computes waveform data from an AudioBuffer and draws it on the canvas.
     * Highlights speech regions if provided.
     * @public
     * @async
     * @param {AudioBuffer} audioBuffer - The audio data to visualize.
     * @param {SpeechRegion[]|null|undefined} speechRegions - Optional array of speech regions to highlight.
     * If null or empty, the waveform is drawn with a loading/default color.
     * @returns {Promise<void>} Resolves when the waveform has been drawn.
     */
    async function computeAndDrawWaveform(audioBuffer, speechRegions) {
        if (!audioBuffer) {
            console.warn("WaveformVisualizer: computeAndDrawWaveform called with no AudioBuffer.");
            return;
        }
        if (!waveformCtx || !waveformCanvas) {
            console.warn("WaveformVisualizer: Canvas context/element missing for drawing.");
            return;
        }

        resizeCanvasInternal(); // Ensure canvas dimensions are up-to-date
        const width = waveformCanvas.width;

        const waveformData = computeWaveformData(audioBuffer, width);
        drawWaveform(waveformData, waveformCanvas, waveformCtx, speechRegions, audioBuffer.duration, width);
        updateProgressIndicator(0, audioBuffer.duration); // Reset progress indicator
    }

    /**
     * Redraws the waveform, primarily to update speech region highlighting.
     * Recomputes waveform data based on the current canvas size.
     * @public
     * @param {AudioBuffer|null} audioBuffer - The current audio buffer.
     * @param {SpeechRegion[]} speechRegions - The speech regions to highlight.
     */
    function redrawWaveformHighlight(audioBuffer, speechRegions) {
        if (!audioBuffer) {
            console.warn("WaveformVisualizer: Cannot redraw highlight, AudioBuffer missing.");
            return;
        }
        if (!waveformCanvas || !waveformCtx) {
            console.warn("WaveformVisualizer: Cannot redraw highlight, canvas/context missing.");
            return;
        }
        const width = waveformCanvas.width;
        if (width <= 0) {
            console.warn("WaveformVisualizer: Cannot redraw highlight, canvas width is zero or invalid.");
            return;
        }

        const waveformData = computeWaveformData(audioBuffer, width);
        drawWaveform(waveformData, waveformCanvas, waveformCtx, speechRegions, audioBuffer.duration, width);
    }


    /**
     * @typedef {object} WaveformMinMax
     * @property {number} min - Minimum sample value in the segment.
     * @property {number} max - Maximum sample value in the segment.
     */

    /**
     * Computes simplified waveform data (min/max pairs for each pixel column).
     * @private
     * @param {AudioBuffer} buffer - The audio buffer to process.
     * @param {number} targetWidth - The target width in pixels for the waveform display.
     * @returns {WaveformMinMax[]} An array of min/max objects, one for each pixel column.
     */
    function computeWaveformData(buffer, targetWidth) {
        if (!buffer?.getChannelData || targetWidth <= 0) return [];
        const channelCount = buffer.numberOfChannels;
        const bufferLength = buffer.length;
        if (bufferLength === 0) return [];

        /** @type {Float32Array} */
        let sourceData;
        if (channelCount === 1) {
            sourceData = buffer.getChannelData(0);
        } else { // Mix down to mono if multi-channel
            sourceData = new Float32Array(bufferLength);
            for (let ch = 0; ch < channelCount; ch++) {
                const chData = buffer.getChannelData(ch);
                for (let i = 0; i < bufferLength; i++) {
                    sourceData[i] += chData[i];
                }
            }
            for (let i = 0; i < bufferLength; i++) {
                sourceData[i] /= channelCount;
            }
        }

        const samplesPerPixel = Math.max(1, Math.floor(bufferLength / targetWidth));
        /** @type {WaveformMinMax[]} */
        const waveform = [];
        for (let i = 0; i < targetWidth; i++) {
            const start = Math.floor(i * samplesPerPixel);
            const end = Math.min(start + samplesPerPixel, bufferLength);
            if (start >= end) {
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
     * Draws the computed waveform data onto the canvas.
     * Highlights speech regions using specific colors defined in `AudioApp.Constants`.
     * @private
     * @param {WaveformMinMax[]} waveformData - Array of min/max values per pixel column.
     * @param {HTMLCanvasElement} canvas - The canvas element to draw on.
     * @param {CanvasRenderingContext2D} ctx - The 2D rendering context of the canvas.
     * @param {SpeechRegion[]|null|undefined} speechRegions - Array of speech time regions to highlight.
     * @param {number} audioDuration - Total duration of the audio in seconds.
     * @param {number} width - The current width of the canvas.
     */
    function drawWaveform(waveformData, canvas, ctx, speechRegions, audioDuration, width) {
        if (!ctx || typeof Constants === 'undefined') {
            console.error("WaveformVisualizer: Missing context or Constants for drawing.");
            return;
        }

        const {height} = canvas;
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height); // Background

        if (!waveformData || waveformData.length === 0 || !audioDuration || audioDuration <= 0) {
            ctx.fillStyle = '#888';
            ctx.textAlign = 'center';
            ctx.font = '12px sans-serif';
            ctx.fillText("No waveform data available", width / 2, height / 2);
            return;
        }

        const dataLen = waveformData.length;
        const halfHeight = height / 2;
        const scale = halfHeight * Constants.Visualizer.WAVEFORM_HEIGHT_SCALE;
        const pixelsPerSecond = width / audioDuration;
        const initialDraw = !speechRegions || speechRegions.length === 0;
        const defaultColor = initialDraw ? Constants.Visualizer.WAVEFORM_COLOR_LOADING : Constants.Visualizer.WAVEFORM_COLOR_DEFAULT;
        const speechPixelRegions = initialDraw ? [] : (speechRegions || []).map(r => ({
            startPx: r.start * pixelsPerSecond, endPx: r.end * pixelsPerSecond
        }));
        const pixelWidth = width / dataLen; // Width of each bar in the waveform

        // Draw non-speech/loading parts
        ctx.fillStyle = defaultColor;
        ctx.beginPath();
        for (let i = 0; i < dataLen; i++) {
            const x = i * pixelWidth;
            const currentPixelEnd = x + pixelWidth;
            let isOutsideSpeech = true;
            if (!initialDraw) {
                for (const region of speechPixelRegions) {
                    if (x < region.endPx && currentPixelEnd > region.startPx) {
                        isOutsideSpeech = false;
                        break;
                    }
                }
            }
            if (isOutsideSpeech) {
                const {min, max} = waveformData[i];
                const y1 = halfHeight - (max * scale);
                const y2 = halfHeight - (min * scale);
                ctx.rect(x, y1, pixelWidth, Math.max(1, y2 - y1)); // Ensure rect has at least 1px height
            }
        }
        ctx.fill();

        // Draw speech highlights
        if (!initialDraw) {
            ctx.fillStyle = Constants.Visualizer.WAVEFORM_COLOR_SPEECH;
            ctx.beginPath();
            for (let i = 0; i < dataLen; i++) {
                const x = i * pixelWidth;
                const currentPixelEnd = x + pixelWidth;
                let isInsideSpeech = false;
                for (const region of speechPixelRegions) {
                    if (x < region.endPx && currentPixelEnd > region.startPx) {
                        isInsideSpeech = true;
                        break;
                    }
                }
                if (isInsideSpeech) {
                    const {min, max} = waveformData[i];
                    const y1 = halfHeight - (max * scale);
                    const y2 = halfHeight - (min * scale);
                    ctx.rect(x, y1, pixelWidth, Math.max(1, y2 - y1));
                }
            }
            ctx.fill();
        }
    }


    /**
     * Updates the position of the playback progress indicator on the waveform.
     * @public
     * @param {number} currentTime - The current playback time in seconds.
     * @param {number} duration - The total duration of the audio in seconds.
     */
    function updateProgressIndicator(currentTime, duration) {
        if (!waveformCanvas || !waveformProgressIndicator) return;
        if (isNaN(duration) || duration <= 0) {
            waveformProgressIndicator.style.left = "0px";
            return;
        }
        const fraction = Math.max(0, Math.min(1, currentTime / duration));
        const waveformWidth = waveformCanvas.clientWidth;
        waveformProgressIndicator.style.left = waveformWidth > 0 ? `${fraction * waveformWidth}px` : "0px";
    }

    /**
     * Clears the waveform canvas and resets the progress indicator.
     * @public
     */
    function clearVisuals() {
        console.log("WaveformVisualizer: Clearing visuals.");
        if (waveformCtx && waveformCanvas) {
            waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
            waveformCtx.fillStyle = '#000'; // Explicitly set black background
            waveformCtx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);
        }
        updateProgressIndicator(0, 1); // Reset progress indicator
    }

    /**
     * Resizes the canvas element to match its CSS-defined display size.
     * This is important for ensuring crisp rendering.
     * @private
     * @returns {boolean} True if the canvas was resized, false otherwise.
     */
    function resizeCanvasInternal() {
        if (!waveformCanvas) return false;
        const {width, height} = waveformCanvas.getBoundingClientRect();
        const roundedWidth = Math.max(10, Math.round(width)); // Ensure minimum size
        const roundedHeight = Math.max(10, Math.round(height));
        if (waveformCanvas.width !== roundedWidth || waveformCanvas.height !== roundedHeight) {
            waveformCanvas.width = roundedWidth;
            waveformCanvas.height = roundedHeight;
            if (waveformCtx) { // Redraw background if context exists
                waveformCtx.fillStyle = '#000';
                waveformCtx.fillRect(0, 0, roundedWidth, roundedHeight);
            }
            return true;
        }
        return false;
    }

    /**
     * Handles window resize events. Adjusts canvas dimensions and redraws the waveform
     * using the provided audio buffer and speech regions.
     * @public
     * @param {AudioBuffer|null} audioBuffer - The current audio buffer.
     * @param {SpeechRegion[]|null} speechRegions - Current speech regions to highlight.
     */
    function resizeAndRedraw(audioBuffer, speechRegions) {
        const wasResized = resizeCanvasInternal();
        if (wasResized && audioBuffer) {
            redrawWaveformHighlight(audioBuffer, speechRegions || []);
        } else if (wasResized) {
            clearVisuals(); // Clear if resized but no audio buffer to redraw
        }
        // Always update progress indicator, as its position depends on clientWidth
        const {currentTime = 0, duration = 0} = AudioApp.audioEngine?.getCurrentTime() || {};
        updateProgressIndicator(currentTime, duration || (audioBuffer ? audioBuffer.duration : 0));
    }

    /**
     * @typedef {Object} WaveformVisualizerPublicInterface
     * @property {function(): void} init
     * @property {function(AudioBuffer, SpeechRegion[]|null|undefined): Promise<void>} computeAndDrawWaveform
     * @property {function(AudioBuffer|null, SpeechRegion[]): void} redrawWaveformHighlight
     * @property {function(AudioBuffer|null, SpeechRegion[]|null): void} resizeAndRedraw
     * @property {function(number, number): void} updateProgressIndicator
     * @property {function(): void} clearVisuals
     */

    /** @type {WaveformVisualizerPublicInterface} */
    return {
        init: init,
        computeAndDrawWaveform: computeAndDrawWaveform,
        redrawWaveformHighlight: redrawWaveformHighlight,
        resizeAndRedraw: resizeAndRedraw,
        updateProgressIndicator: updateProgressIndicator,
        clearVisuals: clearVisuals
    };

})();
// --- /vibe-player/js/visualizers/waveformVisualizer.js ---