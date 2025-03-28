// --- START OF FILE utils.js ---
'use strict';

/**
 * Formats time in seconds to a "minutes:seconds" string (e.g., "1:05").
 * @param {number} sec - Time in seconds.
 * @returns {string} - Formatted time string.
 */
function formatTime(sec) {
    if (isNaN(sec) || sec < 0) sec = 0;
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    // Pad seconds with a leading zero if less than 10.
    return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
}

/**
 * Converts an AudioBuffer to 16kHz mono Float32Array PCM using OfflineAudioContext.
 * @param {AudioBuffer} audioBuffer - The original decoded audio buffer.
 * @returns {Promise<Float32Array>} - A promise resolving to the 16kHz mono PCM data.
 */
function convertAudioBufferTo16kHzMonoFloat32(audioBuffer) {
    const targetSampleRate = 16000;
    if (!audioBuffer) return Promise.reject(new Error("Invalid AudioBuffer provided for resampling."));
    // Check if already 16kHz mono
    if (audioBuffer.sampleRate === targetSampleRate && audioBuffer.numberOfChannels === 1) {
        console.log("Audio is already 16kHz mono. Skipping resampling.");
        return Promise.resolve(audioBuffer.getChannelData(0)); // Return existing data
    }

    const offlineCtx = new OfflineAudioContext(
        1, // Mono
        audioBuffer.duration * targetSampleRate, // Target length
        targetSampleRate
    );
    const src = offlineCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(offlineCtx.destination);
    src.start();
    console.log(`Resampling audio from ${audioBuffer.sampleRate}Hz to ${targetSampleRate}Hz mono for VAD.`);
    return offlineCtx.startRendering().then(rendered => {
        return rendered.getChannelData(0);
    }).catch(err => {
        console.error("Error during audio resampling:", err);
        throw err;
    });
}


// Export functions
window.Utils = {
    formatTime,
    convertAudioBufferTo16kHzMonoFloat32
};
// --- END OF FILE utils.js ---