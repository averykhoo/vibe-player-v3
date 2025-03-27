// --- START OF FILE waveform-visualizer.js ---
'use strict';

/**
 * Handles computing and drawing the audio waveform visualization.
 */
const WaveformVisualizer = (function() {

    const WAVEFORM_HEIGHT_SCALE = 0.8; // Vertical scaling

    /**
     * Computes simplified waveform data (min/max pairs) for drawing.
     * Downsamples audio data to fit the target width.
     * @param {AudioBuffer} buffer - The original AudioBuffer.
     * @param {number} targetWidth - The target width in pixels.
     * @returns {Array<{min: number, max: number}>} - Array of min/max values. Returns empty array on error.
     */
    function computeData(buffer, targetWidth) {
        if (!buffer || !(buffer instanceof AudioBuffer) || targetWidth <= 0) {
             console.warn("WaveformVisualizer: Invalid input for computeData.", { buffer, targetWidth });
             return [];
        }

        const channelCount = buffer.numberOfChannels;
        const bufferLength = buffer.length;
        let sourceData;

        // Mix down to mono if necessary
        if (channelCount > 1) {
            sourceData = new Float32Array(bufferLength);
            for (let ch = 0; ch < channelCount; ch++) {
                const channelData = buffer.getChannelData(ch);
                for (let i = 0; i < bufferLength; i++) {
                    sourceData[i] += channelData[i];
                }
            }
            for (let i = 0; i < bufferLength; i++) {
                sourceData[i] /= channelCount;
            }
        } else {
            // Use Float32Array view for consistency, though getChannelData returns one
            sourceData = buffer.getChannelData(0);
            if (!(sourceData instanceof Float32Array)) {
                 sourceData = new Float32Array(sourceData); // Ensure it's a Float32Array
            }
        }

        const samplesPerPixel = Math.max(1, Math.floor(bufferLength / targetWidth));
        const waveform = [];

        for (let i = 0; i < targetWidth; i++) {
            const start = Math.floor(i * samplesPerPixel);
            const end = Math.min(start + samplesPerPixel, bufferLength);
            if (start >= end) {
                waveform.push({ min: 0, max: 0 });
                continue;
            }
            let min = 1.0, max = -1.0;
            // // Optimization: Loop directly over the Float32Array segment
            // const segment = sourceData.subarray(start, end);
            // for (let j = 0; j < segment.length; j++) {
            //      const sample = segment[j];
            //      if (sample < min) min = sample;
            //      if (sample > max) max = sample;
            // }

            // --- REVERTED INNER LOOP ---
            // Iterate directly over the original sourceData indices
            for (let j = start; j < end; j++) {
                const sample = sourceData[j]; // Read directly from sourceData
                if (sample < min) min = sample;
                if (sample > max) max = sample;
            }
            // Handle potential silence where min/max don't change from init
            if (min === 1.0 && max === -1.0) { min = 0; max = 0; }

            waveform.push({ min, max });
        }
        return waveform;
    }

    /**
     * Draws the waveform onto the canvas, highlighting speech regions.
     * @param {HTMLCanvasElement} canvas - The target canvas element.
     * @param {Array<{min: number, max: number}>} waveformData - Pre-computed waveform data from computeData.
     * @param {Array<{start: number, end: number}>} speechRegions - Current speech regions to highlight.
     * @param {number} audioDuration - Total duration of the audio in seconds.
     */
    function draw(canvas, waveformData, speechRegions, audioDuration) {
        if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
            console.error("WaveformVisualizer: Invalid canvas provided for drawing.");
            return;
        }
        const ctx = canvas.getContext('2d');
        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height);

        if (!waveformData || waveformData.length === 0 || !audioDuration || audioDuration <= 0) {
            ctx.fillStyle = '#888';
            ctx.textAlign = 'center';
            // Display specific message based on what's missing
            let message = "No Waveform Data";
            if (waveformData && waveformData.length > 0 && (!audioDuration || audioDuration <= 0)) {
                message = "Invalid Duration"; // Show this specifically if duration is the issue
            }
            ctx.fillText(message, width / 2, height / 2);
            return;
        }

        const dataLen = waveformData.length;
        const halfHeight = height / 2;
        const scale = halfHeight * WAVEFORM_HEIGHT_SCALE;
        const pixelsPerSecond = width / audioDuration;
        const pixelWidth = width / dataLen;

        // Pre-calculate speech region boundaries in pixels
        const speechPixelRegions = (speechRegions || [])
            .map(r => ({
                startPx: r.start * pixelsPerSecond,
                endPx: r.end * pixelsPerSecond
            }));

        // Draw non-speech parts
        ctx.fillStyle = '#3455db';
        ctx.beginPath();
        for (let i = 0; i < dataLen; i++) {
            const x = i * pixelWidth;
            const currentPixelEnd = x + pixelWidth;
            let isOutsideSpeech = true;
            for (const region of speechPixelRegions) {
                if (region.startPx < currentPixelEnd && region.endPx > x) {
                    isOutsideSpeech = false; break;
                }
            }
            if (isOutsideSpeech) {
                const { min, max } = waveformData[i];
                const y1 = halfHeight - max * scale;
                const y2 = halfHeight - min * scale;
                ctx.rect(x, y1, pixelWidth, Math.max(1, y2 - y1));
            }
        }
        ctx.fill();

        // Draw speech parts
        ctx.fillStyle = 'orange';
        ctx.beginPath();
        for (let i = 0; i < dataLen; i++) {
            const x = i * pixelWidth;
            const currentPixelEnd = x + pixelWidth;
            let isInsideSpeech = false;
            for (const region of speechPixelRegions) {
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

    // Public API
    return {
        computeData,
        draw
    };

})();

window.WaveformVisualizer = WaveformVisualizer; // Expose to global scope
// --- END OF FILE waveform-visualizer.js ---