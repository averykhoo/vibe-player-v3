// --- /vibe-player/js/visualizers/spectrogram.worker.js ---
// This worker handles the computationally intensive task of calculating the spectrogram.

// 1. Import Dependencies
try {
    // These paths are relative to this worker file's location.
    importScripts('../../lib/fft.js', '../state/constants.js', '../utils.js'); // Updated path for constants
} catch (e) {
    console.error("Spectrogram Worker: Failed to import scripts.", e);
    self.postMessage({type: 'error', detail: 'Worker script import failed.'});
}

// 2. Listen for Messages
self.onmessage = (event) => {
    // Verify that dependencies loaded correctly before proceeding.
    // Check for global Constants class directly on self
    if (typeof self.FFT === 'undefined' || typeof self.Constants === 'undefined' || typeof self.AudioApp?.Utils === 'undefined') {
        let missing = [];
        if (typeof self.FFT === 'undefined') missing.push('FFT');
        if (typeof self.Constants === 'undefined') missing.push('Constants');
        if (typeof self.AudioApp?.Utils === 'undefined') missing.push('AudioApp.Utils');
        self.postMessage({type: 'error', detail: `Worker dependencies are missing: ${missing.join(', ')}.`});
        return;
    }

    const {type, payload} = event.data;

    if (type === 'compute') {
        try {
            const {channelData, sampleRate, duration, fftSize, targetSlices} = payload;

            // Access the globally loaded scripts via the 'self' scope.
            // Constants is now directly on self.
            const Utils = self.AudioApp.Utils; // Utils is still under AudioApp namespace for now
            const FFT = self.FFT;

            // 3. Run Computation
            const spectrogramData = computeSpectrogram(channelData, sampleRate, duration, fftSize, targetSlices, FFT, self.Constants, Utils);

            // 4. Post Result Back (with Transferable objects for performance)
            if (spectrogramData) {
                const transferable = spectrogramData.map(arr => arr.buffer);
                self.postMessage({type: 'result', payload: {spectrogramData}}, transferable);
            } else {
                self.postMessage({type: 'result', payload: {spectrogramData: []}}); // Send empty result
            }
        } catch (e) {
            console.error('Spectrogram Worker: Error during computation.', e);
            self.postMessage({type: 'error', detail: e.message});
        }
    }
};

// THIS FUNCTION IS A DIRECT COPY FROM THE ORIGINAL spectrogramVisualizer.js
function computeSpectrogram(channelData, sampleRate, duration, actualFftSize, targetSlices, FFTConstructor, ConstantsGlobal, Utils) {
    if (!channelData) {
        console.error("Worker: Invalid channelData.");
        return null;
    }
    const totalSamples = channelData.length;
    const hopDivisor = duration < ConstantsGlobal.Visualizer.SPEC_SHORT_FILE_HOP_THRESHOLD_S ? ConstantsGlobal.Visualizer.SPEC_SHORT_HOP_DIVISOR : ConstantsGlobal.Visualizer.SPEC_NORMAL_HOP_DIVISOR;
    const hopSize = Math.max(1, Math.floor(actualFftSize / hopDivisor));
    const padding = ConstantsGlobal.Visualizer.SPEC_CENTER_WINDOWS ? Math.floor(actualFftSize / 2) : 0;
    const rawSliceCount = ConstantsGlobal.Visualizer.SPEC_CENTER_WINDOWS ? Math.ceil(totalSamples / hopSize)
        : (totalSamples < actualFftSize ? 0 : Math.floor((totalSamples - actualFftSize) / hopSize) + 1);

    if (rawSliceCount <= 0) {
        console.warn("Worker: Not enough audio samples for FFT.");
        return [];
    }

    const fftInstance = new FFTConstructor(actualFftSize, sampleRate);
    const complexBuffer = fftInstance.createComplexArray();
    const fftInput = new Array(actualFftSize);
    const windowFunc = Utils.hannWindow(actualFftSize);
    if (!windowFunc) {
        console.error("Worker: Failed to generate Hann window.");
        return null;
    }

    const rawSpec = [];
    for (let i = 0; i < rawSliceCount; i++) {
        const windowCenterSample = i * hopSize;
        const windowFetchStart = windowCenterSample - padding;
        for (let j = 0; j < actualFftSize; j++) {
            const sampleIndex = windowFetchStart + j;
            let sampleValue = 0.0;
            if (sampleIndex >= 0 && sampleIndex < totalSamples) {
                sampleValue = channelData[sampleIndex];
            } else if (sampleIndex < 0) {
                sampleValue = totalSamples > 0 ? channelData[0] : 0.0;
            } else {
                sampleValue = totalSamples > 0 ? channelData[totalSamples - 1] : 0.0;
            }
            fftInput[j] = sampleValue * windowFunc[j];
        }
        fftInstance.realTransform(complexBuffer, fftInput);
        const numBins = actualFftSize / 2;
        const magnitudes = new Float32Array(numBins);
        for (let k = 0; k < numBins; k++) {
            const re = complexBuffer[k * 2], im = complexBuffer[k * 2 + 1];
            magnitudes[k] = Math.sqrt(re * re + im * im);
        }
        rawSpec.push(magnitudes);
    }

    if (rawSpec.length === 0) return [];
    if (rawSpec.length === targetSlices) return rawSpec;

    const numFreqBins = rawSpec[0].length;
    const finalSpec = new Array(targetSlices);
    for (let i = 0; i < targetSlices; i++) {
        const rawPos = (rawSpec.length > 1) ? (i / (targetSlices - 1)) * (rawSpec.length - 1) : 0;
        const index1 = Math.floor(rawPos);
        const index2 = Math.min(rawSpec.length - 1, Math.ceil(rawPos));
        const factor = rawPos - index1;
        const magnitudes1 = rawSpec[index1], magnitudes2 = rawSpec[index2];
        finalSpec[i] = new Float32Array(numFreqBins);
        if (index1 === index2 || factor === 0) {
            finalSpec[i].set(magnitudes1);
        } else {
            for (let k = 0; k < numFreqBins; k++) {
                finalSpec[i][k] = magnitudes1[k] * (1.0 - factor) + magnitudes2[k] * factor;
            }
        }
    }
    return finalSpec;
}