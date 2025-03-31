// --- /vibe-player/js/utils.js ---
// General utility functions for the Vibe Player application.

var AudioApp = AudioApp || {}; // Ensure main namespace exists

AudioApp.Utils = (function() {
    'use strict';

    /**
     * Formats time in seconds to a mm:ss string.
     * Moved from uiManager.js
     * @param {number} sec - Time in seconds.
     * @returns {string} Formatted time string (e.g., "1:23").
     */
    function formatTime(sec) {
        if (isNaN(sec) || sec < 0) sec = 0;
        const minutes = Math.floor(sec / 60);
        const seconds = Math.floor(sec % 60);
        return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
    }

    /**
     * Helper function to yield control back to the main event loop.
     * Uses `setTimeout(resolve, 0)` inside a Promise.
     * Moved from sileroProcessor.js
     * @returns {Promise<void>} Resolves on the next tick.
     */
    async function yieldToMainThread() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    /**
     * Generates a Hann window array for FFT.
     * Moved from visualizer.js
     * @param {number} length - The desired window length.
     * @returns {Array<number>|null} The Hann window array or null if length is invalid.
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

     /**
     * Viridis colormap function.
     * Moved from visualizer.js
     * @param {number} t - Normalized value (0 to 1).
     * @returns {number[]} Array containing [r, g, b] values (0-255).
     */
     function viridisColor(t) {
         const colors = [
             [0.0, 68, 1, 84], [0.1, 72, 40, 120], [0.2, 62, 74, 137], [0.3, 49, 104, 142],
             [0.4, 38, 130, 142], [0.5, 31, 155, 137], [0.6, 53, 178, 126], [0.7, 109, 199, 104],
             [0.8, 170, 217, 70], [0.9, 235, 231, 35], [1.0, 253, 231, 37]
         ];
         t = Math.max(0, Math.min(1, t)); // Clamp t to [0, 1]
         let c1 = colors[0];
         let c2 = colors[colors.length - 1];
         for (let i = 0; i < colors.length - 1; i++) {
             if (t >= colors[i][0] && t <= colors[i + 1][0]) {
                 c1 = colors[i];
                 c2 = colors[i + 1];
                 break;
             }
         }
         const range = c2[0] - c1[0];
         const ratio = (range === 0) ? 0 : (t - c1[0]) / range;
         const r = Math.round(c1[1] + ratio * (c2[1] - c1[1]));
         const g = Math.round(c1[2] + ratio * (c2[2] - c1[2]));
         const b = Math.round(c1[3] + ratio * (c2[3] - c1[3]));
         return [r, g, b];
     }


    /**
     * Returns a function, that, as long as it continues to be invoked, will not
     * be triggered. The function will be called after it stops being called for
     * N milliseconds. If `immediate` is passed, trigger the function on the
     * leading edge, instead of the trailing.
     * @param {Function} func - The function to debounce.
     * @param {number} wait - The number of milliseconds to delay.
     * @param {boolean} [immediate=false] - Whether to trigger on the leading edge.
     * @returns {Function} The new debounced function.
     */
    function debounce(func, wait, immediate = false) {
        let timeout;
        return function executedFunction() {
            const context = this;
            const args = arguments;
            const later = function() {
                timeout = null;
                if (!immediate) func.apply(context, args);
            };
            const callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func.apply(context, args);
        };
    }

    // === Public Interface ===
    return {
        formatTime,
        yieldToMainThread,
        hannWindow,
        viridisColor,
        debounce // <-- Expose debounce
    };

})(); // End of AudioApp.Utils IIFE
// --- /vibe-player/js/utils.js ---
