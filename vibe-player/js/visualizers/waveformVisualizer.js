// --- /vibe-player/js/visualizers/waveformVisualizer.js ---
// Handles drawing the Waveform visualization to a canvas element.

var AudioApp = AudioApp || {}; // Ensure namespace exists

AudioApp.waveformVisualizer = (function() {
    'use strict';

    // === Module Dependencies ===
    // Assuming AudioApp.Constants and AudioApp.Utils are loaded before this file.
    const Constants = AudioApp.Constants;
    const Utils = AudioApp.Utils;

    // === DOM Element References ===
    /** @type {HTMLCanvasElement|null} */ let waveformCanvas;
    /** @type {CanvasRenderingContext2D|null} */ let waveformCtx;
    /** @type {HTMLDivElement|null} */ let waveformProgressIndicator;

    // === Initialization ===

    /**
     * Initializes the Waveform Visualizer module.
     * Gets canvas references and adds event listeners.
     * @public
     */
    function init() {
        console.log("WaveformVisualizer: Initializing...");
        assignDOMElements();
        if (waveformCanvas) {
            waveformCanvas.addEventListener('click', handleCanvasClick);
        } else {
            console.warn("WaveformVisualizer: Waveform canvas not found.");
        }
        console.log("WaveformVisualizer: Initialized.");
    }

    /**
     * Gets references to waveform canvas elements and context.
     * @private
     */
    function assignDOMElements() {
        waveformCanvas = document.getElementById('waveformCanvas');
        waveformProgressIndicator = document.getElementById('waveformProgressIndicator');
        if (waveformCanvas) {
            waveformCtx = waveformCanvas.getContext('2d');
        }
    }

    // === Event Handlers ===

    /**
     * Handles click events on the waveform canvas for seeking.
     * Dispatches 'audioapp:seekRequested'.
     * @param {MouseEvent} e - The click event.
     * @private
     */
    function handleCanvasClick(e) {
        if (!waveformCanvas) return;
        const rect = waveformCanvas.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;
        const clickXRelative = e.clientX - rect.left;
        const fraction = Math.max(0, Math.min(1, clickXRelative / rect.width));
        document.dispatchEvent(new CustomEvent('audioapp:seekRequested', { detail: { fraction: fraction } }));
    }

    // === Core Drawing & Computation ===

    /**
     * Computes and draws the waveform for the given audio buffer.
     * Uses loading color if speechRegions is empty/null.
     * @param {AudioBuffer} audioBuffer - The original, decoded audio buffer.
     * @param {Array<{start: number, end: number}>|null|undefined} speechRegions - Speech regions, or null/empty for initial draw.
     * @returns {Promise<void>} Resolves when drawing is complete (drawing is synchronous here).
     * @public
     */
    async function computeAndDrawWaveform(audioBuffer, speechRegions) {
        if (!audioBuffer) { console.warn("WaveformVisualizer: AudioBuffer missing."); return; }
        if (!waveformCtx || !waveformCanvas) { console.warn("WaveformVisualizer: Canvas context/element missing."); return; }

        // Resize canvas before drawing to ensure correct dimensions
        resizeCanvasInternal();
        const width = waveformCanvas.width;

        console.time("Waveform compute");
        const waveformData = computeWaveformData(audioBuffer, width);
        console.timeEnd("Waveform compute");

        console.time("Waveform draw");
        drawWaveform(waveformData, waveformCanvas, waveformCtx, speechRegions, audioBuffer.duration, width);
        console.timeEnd("Waveform draw");

        // Reset progress indicator position after drawing
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
             console.warn("WaveformVisualizer: Cannot redraw highlight, AudioBuffer missing.");
             return;
         }
         if (!waveformCanvas || !waveformCtx) {
              console.warn("WaveformVisualizer: Cannot redraw highlight, Waveform canvas/context missing.");
              return;
         }
         const width = waveformCanvas.width; // Get current width
         if (width <= 0) {
             console.warn("WaveformVisualizer: Cannot redraw highlight, Waveform canvas width is zero.");
             return;
         }
         console.log("WaveformVisualizer: Redrawing waveform highlights...");
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
            for (let i = 0; i < bufferLength; i++) { sourceData[i] /= channelCount; } // Average
        }

        // --- Compute Min/Max per Pixel ---
        const samplesPerPixel = Math.max(1, Math.floor(bufferLength / targetWidth));
        const waveform = [];
        for (let i = 0; i < targetWidth; i++) {
            const start = Math.floor(i * samplesPerPixel);
            const end = Math.min(start + samplesPerPixel, bufferLength);

            if (start >= end) { waveform.push({min: 0, max: 0}); continue; }

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

    // --- Drawing Helper Functions ---

    /**
     * Draws the waveform, highlighting speech regions with specific colors.
     * Uses WAVEFORM_COLOR_LOADING from Constants if speechRegions is empty/null.
     * @param {Array<{min: number, max: number}>} waveformData - Min/max pairs per pixel.
     * @param {HTMLCanvasElement} canvas - The target canvas element.
     * @param {CanvasRenderingContext2D} ctx - The canvas context.
     * @param {Array<{start: number, end: number}>|null|undefined} speechRegions - Array of speech time regions.
     * @param {number} audioDuration - Total duration of the audio in seconds.
     * @param {number} width - The current width of the canvas.
     * @private
     */
     function drawWaveform(waveformData, canvas, ctx, speechRegions, audioDuration, width) {
        if (!ctx || !Constants) return; // Need context and constants

        const { height } = canvas;
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#000'; // Explicitly set black background
        ctx.fillRect(0, 0, width, height);

        if (!waveformData || waveformData.length === 0 || !audioDuration || audioDuration <= 0) {
            ctx.fillStyle = '#888'; ctx.textAlign = 'center'; ctx.font = '12px sans-serif';
            ctx.fillText("No waveform data", width / 2, height / 2);
            return;
        }

        const dataLen = waveformData.length;
        const halfHeight = height / 2;
        const scale = halfHeight * Constants.WAVEFORM_HEIGHT_SCALE; // Use constant
        const pixelsPerSecond = width / audioDuration;

        const initialDraw = !speechRegions || speechRegions.length === 0;
        const defaultColor = initialDraw ? Constants.WAVEFORM_COLOR_LOADING : Constants.WAVEFORM_COLOR_DEFAULT; // Use constants

        const speechPixelRegions = initialDraw ? [] : (speechRegions || []).map(r => ({
            startPx: r.start * pixelsPerSecond,
            endPx: r.end * pixelsPerSecond
        }));

        const pixelWidth = width / dataLen;

        // --- Draw Default/Loading Waveform Color ---
        ctx.fillStyle = defaultColor;
        ctx.beginPath();
        for (let i = 0; i < dataLen; i++) {
            const x = i * pixelWidth;
            const currentPixelEnd = x + pixelWidth;
            let isOutsideSpeech = true;
            if (!initialDraw) {
                for (const region of speechPixelRegions) {
                    if (x < region.endPx && currentPixelEnd > region.startPx) {
                        isOutsideSpeech = false; break;
                    }
                }
            }
            if (isOutsideSpeech) {
                const { min, max } = waveformData[i];
                const y1 = halfHeight - max * scale; const y2 = halfHeight - min * scale;
                ctx.rect(x, y1, pixelWidth, Math.max(1, y2 - y1));
            }
        }
        ctx.fill();

        // --- Draw Speech Highlights (Yellow) ---
        if (!initialDraw) {
            ctx.fillStyle = Constants.WAVEFORM_COLOR_SPEECH; // Use constant
            ctx.beginPath();
            for (let i = 0; i < dataLen; i++) {
                const x = i * pixelWidth;
                const currentPixelEnd = x + pixelWidth;
                let isInsideSpeech = false;
                for (const region of speechPixelRegions) {
                    if (x < region.endPx && currentPixelEnd > region.startPx) {
                        isInsideSpeech = true; break;
                    }
                }
                if (isInsideSpeech) {
                    const { min, max } = waveformData[i];
                    const y1 = halfHeight - max * scale; const y2 = halfHeight - min * scale;
                    ctx.rect(x, y1, pixelWidth, Math.max(1, y2 - y1));
                }
            }
            ctx.fill();
        }
    }

    // --- UI Update Methods ---

    /**
     * Updates the position of the progress indicator overlay.
     * @param {number} currentTime - The current playback time in seconds.
     * @param {number} duration - The total audio duration in seconds.
     * @public
     */
    function updateProgressIndicator(currentTime, duration) {
        if (!waveformCanvas || !waveformProgressIndicator) return;
        if (isNaN(duration) || duration <= 0) {
            waveformProgressIndicator.style.left = "0px";
            return;
        }
        const fraction = Math.max(0, Math.min(1, currentTime / duration));
        const waveformWidth = waveformCanvas.clientWidth;
        if (waveformWidth > 0) {
            waveformProgressIndicator.style.left = (fraction * waveformWidth) + "px";
        } else {
            waveformProgressIndicator.style.left = "0px"; // Fallback
        }
    }

    /**
     * Clears the waveform visualization canvas.
     * @public
     */
    function clearVisuals() {
        console.log("WaveformVisualizer: Clearing visuals.");
        if (waveformCtx && waveformCanvas) {
            waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
             // Optionally draw black background on clear
             waveformCtx.fillStyle = '#000';
             waveformCtx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);
        }
        // Reset progress indicator
        updateProgressIndicator(0, 1);
    }

    /**
     * Resizes canvas to match its displayed size. Internal use.
     * @returns {boolean} True if the canvas was actually resized.
     * @private
     */
    function resizeCanvasInternal() {
        if (!waveformCanvas) return false;
        const { width, height } = waveformCanvas.getBoundingClientRect();
        const roundedWidth = Math.max(10, Math.round(width));
        const roundedHeight = Math.max(10, Math.round(height));
        if (waveformCanvas.width !== roundedWidth || waveformCanvas.height !== roundedHeight) {
            waveformCanvas.width = roundedWidth;
            waveformCanvas.height = roundedHeight;
             // Redraw black background after resize
             if(waveformCtx) {
                  waveformCtx.fillStyle = '#000';
                  waveformCtx.fillRect(0, 0, roundedWidth, roundedHeight);
             }
            return true;
        }
        return false;
    }

    /**
     * Handles window resize: adjusts canvas dimensions and redraws waveform.
     * @param {AudioBuffer | null} audioBuffer - The current audio buffer (needed for redraw).
     * @param {Array<{start: number, end: number}> | null} speechRegions - Current speech regions.
     * @public
     */
    function resizeAndRedraw(audioBuffer, speechRegions) {
        const wasResized = resizeCanvasInternal();
        if (wasResized && audioBuffer) {
            console.log("WaveformVisualizer: Redrawing waveform after resize.");
            redrawWaveformHighlight(audioBuffer, speechRegions || []); // Use redrawHighlight which handles data recompute
        } else if (wasResized) {
            clearVisuals(); // Clear if resized but no buffer
        }
        // Always update progress indicator after resize
        const { currentTime = 0, duration = 0 } = AudioApp.audioEngine?.getCurrentTime() || {};
        updateProgressIndicator(currentTime, duration || (audioBuffer ? audioBuffer.duration : 0));
    }

    // === Public Interface ===
    return {
        init: init,
        computeAndDrawWaveform: computeAndDrawWaveform,
        redrawWaveformHighlight: redrawWaveformHighlight,
        resizeAndRedraw: resizeAndRedraw,
        updateProgressIndicator: updateProgressIndicator,
        clearVisuals: clearVisuals
    };

})(); // End of AudioApp.waveformVisualizer IIFE
// --- /vibe-player/js/visualizers/waveformVisualizer.js ---