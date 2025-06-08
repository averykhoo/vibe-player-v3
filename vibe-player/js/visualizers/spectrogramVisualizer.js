// --- /vibe-player/js/visualizers/spectrogramVisualizer.js --- (CORRECTED)
// Handles orchestrating the Spectrogram worker and rendering the results to a canvas.

AudioApp.spectrogramVisualizer = (function (globalFFT) {
    'use strict';

    // Constants is now a global class, AudioApp.Constants is no longer used.
    const Utils = AudioApp.Utils;

    // DOM Elements
    let spectrogramCanvas = null, spectrogramCtx = null, spectrogramSpinner = null,
        spectrogramProgressIndicator = null, cachedSpectrogramCanvas = null;

    let getSharedAudioBuffer = null;
    let currentMaxFreqIndex = Constants.Visualizer.SPEC_DEFAULT_MAX_FREQ_INDEX;
    let worker = null;
    let lastAudioBuffer = null; // Cache the audio buffer for the current job

    function init(getAudioBufferCallback) {
        console.log("SpectrogramVisualizer: Initializing...");
        assignDOMElements();
        getSharedAudioBuffer = getAudioBufferCallback;

        try {
            worker = new Worker('js/visualizers/spectrogram.worker.js');
            worker.onmessage = handleWorkerMessage;
            worker.onerror = handleWorkerError;
        } catch (e) {
            console.error("SpectrogramVisualizer: Failed to create Web Worker.", e);
            worker = null;
        }

        if (spectrogramCanvas) {
            spectrogramCanvas.addEventListener('click', handleCanvasClick);
            spectrogramCanvas.addEventListener('dblclick', handleCanvasDoubleClick);
        }
    }

    function handleWorkerError(e) {
        console.error("SpectrogramVisualizer: Received error from worker:", e);
        showSpinner(false);
        if (spectrogramCtx && spectrogramCanvas) {
            spectrogramCtx.fillStyle = '#D32F2F';
            spectrogramCtx.textAlign = 'center';
            spectrogramCtx.font = '14px sans-serif';
            spectrogramCtx.fillText(`Worker Error: ${e.message}`, spectrogramCanvas.width / 2, spectrogramCanvas.height / 2);
        }
    }

    function handleWorkerMessage(event) {
        const {type, payload, detail} = event.data;
        if (type === 'result') {
            const {spectrogramData} = payload;
            const audioBuffer = lastAudioBuffer;

            if (!audioBuffer) {
                console.warn("SpectrogramVisualizer: Worker returned a result, but there is no longer an active audio buffer. Ignoring.");
                showSpinner(false);
                return;
            }

            if (spectrogramData && spectrogramData.length > 0) {
                const actualFftSize = audioBuffer.duration < Constants.Visualizer.SPEC_SHORT_FILE_FFT_THRESHOLD_S ? Constants.Visualizer.SPEC_SHORT_FFT_SIZE : Constants.Visualizer.SPEC_NORMAL_FFT_SIZE;
                drawSpectrogramAsync(spectrogramData, spectrogramCanvas, audioBuffer.sampleRate, actualFftSize)
                    .catch(error => console.error("SpectrogramVisualizer: Error during async drawing.", error))
                    .finally(() => showSpinner(false));
            } else {
                console.warn("SpectrogramVisualizer: Worker returned empty or null data.");
                showSpinner(false);
            }
        } else if (type === 'error') {
            handleWorkerError({message: detail});
        }
    }

    async function computeAndDrawSpectrogram(audioBufferFromParam) {
        lastAudioBuffer = audioBufferFromParam || (getSharedAudioBuffer ? getSharedAudioBuffer() : null);

        if (!lastAudioBuffer) {
            console.warn("SpectrogramVisualizer: No AudioBuffer available.");
            return;
        }
        if (!spectrogramCtx || !spectrogramCanvas) {
            console.warn("SpectrogramVisualizer: Canvas context/element missing.");
            return;
        }
        if (!worker) {
            handleWorkerError({message: "Worker not available or failed to load."});
            return;
        }

        console.log("SpectrogramVisualizer: Offloading spectrogram computation to worker...");
        clearVisualsInternal();
        resizeCanvasInternal();
        cachedSpectrogramCanvas = null;
        showSpinner(true);

        const actualFftSize = lastAudioBuffer.duration < Constants.Visualizer.SPEC_SHORT_FILE_FFT_THRESHOLD_S ? Constants.Visualizer.SPEC_SHORT_FFT_SIZE : Constants.Visualizer.SPEC_NORMAL_FFT_SIZE;
        // IMPORTANT: We must copy the data for transfer, as the original buffer might be needed elsewhere (e.g., VAD)
        const channelData = lastAudioBuffer.getChannelData(0).slice();

        worker.postMessage({
            type: 'compute',
            payload: {
                channelData: channelData,
                sampleRate: lastAudioBuffer.sampleRate,
                duration: lastAudioBuffer.duration,
                fftSize: actualFftSize,
                targetSlices: Constants.Visualizer.SPEC_FIXED_WIDTH
            }
        }, [channelData.buffer]);
    }

    // --- HELPER FUNCTIONS THAT WERE MISSING ---

    function assignDOMElements() {
        spectrogramCanvas = document.getElementById('spectrogramCanvas');
        spectrogramSpinner = document.getElementById('spectrogramSpinner');
        spectrogramProgressIndicator = document.getElementById('spectrogramProgressIndicator');
        if (spectrogramCanvas) {
            spectrogramCtx = spectrogramCanvas.getContext('2d');
        } else {
            console.error("SpectrogramVisualizer: Could not find 'spectrogramCanvas' element.");
        }
    }

    function handleCanvasClick(e) {
        if (!spectrogramCanvas) return;
        const rect = spectrogramCanvas.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;
        const clickXRelative = e.clientX - rect.left;
        const fraction = Math.max(0, Math.min(1, clickXRelative / rect.width));
        document.dispatchEvent(new CustomEvent('audioapp:seekRequested', {detail: {fraction: fraction}}));
    }

    function handleCanvasDoubleClick(e) {
        e.preventDefault();
        if (!spectrogramCanvas || !Constants.Visualizer.SPEC_MAX_FREQS?.length) return;

        currentMaxFreqIndex = (currentMaxFreqIndex + 1) % Constants.Visualizer.SPEC_MAX_FREQS.length;
        const audioBufferForRedraw = lastAudioBuffer || (getSharedAudioBuffer ? getSharedAudioBuffer() : null);
        if (audioBufferForRedraw) {
            computeAndDrawSpectrogram(audioBufferForRedraw);
        }
    }

    function drawSpectrogramAsync(spectrogramData, canvas, sampleRate, actualFftSize) {
        return new Promise((resolve, reject) => {
            if (!canvas || !spectrogramData?.[0] || typeof Constants === 'undefined' || !Utils) {
                return reject(new Error("SpectrogramVisualizer: Missing dependencies for async draw."));
            }
            const displayCtx = canvas.getContext('2d');
            if (!displayCtx) return reject(new Error("SpectrogramVisualizer: Could not get 2D context from display canvas."));

            displayCtx.clearRect(0, 0, canvas.width, canvas.height);
            displayCtx.fillStyle = '#000';
            displayCtx.fillRect(0, 0, canvas.width, canvas.height);

            const dataWidth = spectrogramData.length;
            const displayHeight = canvas.height;
            if (!cachedSpectrogramCanvas || cachedSpectrogramCanvas.width !== dataWidth || cachedSpectrogramCanvas.height !== displayHeight) {
                cachedSpectrogramCanvas = document.createElement('canvas');
                cachedSpectrogramCanvas.width = dataWidth;
                cachedSpectrogramCanvas.height = displayHeight;
            }
            const offCtx = cachedSpectrogramCanvas.getContext('2d');
            if (!offCtx) return reject(new Error("SpectrogramVisualizer: Could not get context from offscreen canvas."));

            const numBins = actualFftSize / 2;
            const nyquist = sampleRate / 2;
            const currentSpecMaxFreq = Constants.Visualizer.SPEC_MAX_FREQS[currentMaxFreqIndex];
            const maxBinIndex = Math.min(numBins - 1, Math.floor((currentSpecMaxFreq / nyquist) * (numBins - 1)));

            const dbThreshold = -60;
            let maxDb = -Infinity;
            const sliceStep = Math.max(1, Math.floor(dataWidth / 100));
            const binStep = Math.max(1, Math.floor(maxBinIndex / 50));
            for (let i = 0; i < dataWidth; i += sliceStep) {
                const magnitudes = spectrogramData[i];
                if (!magnitudes) continue;
                for (let j = 0; j <= maxBinIndex; j += binStep) {
                    if (j >= magnitudes.length) break;
                    const db = 20 * Math.log10(Math.max(1e-9, magnitudes[j]));
                    maxDb = Math.max(maxDb, Math.max(dbThreshold, db));
                }
            }
            maxDb = Math.max(maxDb, dbThreshold + 1);
            const minDb = dbThreshold;
            const dbRange = maxDb - minDb;

            const fullImageData = offCtx.createImageData(dataWidth, displayHeight);
            const imgData = fullImageData.data;
            let currentSlice = 0;
            const chunkSize = 32;

            function drawChunk() {
                try {
                    const startSlice = currentSlice;
                    const endSlice = Math.min(startSlice + chunkSize, dataWidth);
                    for (let i = startSlice; i < endSlice; i++) {
                        const magnitudes = spectrogramData[i];
                        if (!magnitudes) continue;
                        for (let y = 0; y < displayHeight; y++) {
                            const freqRatio = (displayHeight - 1 - y) / (displayHeight - 1);
                            const logFreqRatio = Math.pow(freqRatio, 2.0);
                            const binIndex = Math.min(maxBinIndex, Math.floor(logFreqRatio * maxBinIndex));
                            const magnitude = magnitudes[binIndex] || 0;
                            const db = 20 * Math.log10(Math.max(1e-9, magnitude));
                            const normValue = dbRange > 0 ? (Math.max(minDb, db) - minDb) / dbRange : 0;
                            const [r, g, b] = Utils.viridisColor(normValue);
                            const idx = (i + y * dataWidth) * 4;
                            imgData[idx] = r;
                            imgData[idx + 1] = g;
                            imgData[idx + 2] = b;
                            imgData[idx + 3] = 255;
                        }
                    }
                    offCtx.putImageData(fullImageData, 0, 0, startSlice, 0, endSlice - startSlice, displayHeight);
                    currentSlice = endSlice;
                    if (currentSlice < dataWidth) {
                        requestAnimationFrame(drawChunk);
                    } else {
                        displayCtx.drawImage(cachedSpectrogramCanvas, 0, 0, canvas.width, canvas.height);
                        resolve();
                    }
                } catch (error) {
                    reject(error);
                }
            }

            requestAnimationFrame(drawChunk);
        });
    }

    function updateProgressIndicator(currentTime, duration) {
        if (!spectrogramCanvas || !spectrogramProgressIndicator) return;
        if (isNaN(duration) || duration <= 0) {
            spectrogramProgressIndicator.style.left = "0px";
            return;
        }
        const fraction = Math.max(0, Math.min(1, currentTime / duration));
        spectrogramProgressIndicator.style.left = `${fraction * spectrogramCanvas.clientWidth}px`;
    }

    function clearVisualsInternal() {
        if (spectrogramCtx && spectrogramCanvas) {
            spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
            spectrogramCtx.fillStyle = '#000';
            spectrogramCtx.fillRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
        }
        updateProgressIndicator(0, 1);
    }

    function clearVisuals() {
        clearVisualsInternal();
        cachedSpectrogramCanvas = null;
    }

    function showSpinner(show) {
        if (spectrogramSpinner) {
            spectrogramSpinner.style.display = show ? 'inline' : 'none';
        }
    }

    function resizeCanvasInternal() {
        if (!spectrogramCanvas) return false;
        const {width, height} = spectrogramCanvas.getBoundingClientRect();
        const roundedWidth = Math.round(width);
        const roundedHeight = Math.round(height);
        if (spectrogramCanvas.width !== roundedWidth || spectrogramCanvas.height !== roundedHeight) {
            spectrogramCanvas.width = roundedWidth;
            spectrogramCanvas.height = roundedHeight;
            if (spectrogramCtx) {
                spectrogramCtx.fillStyle = '#000';
                spectrogramCtx.fillRect(0, 0, roundedWidth, roundedHeight);
            }
            return true;
        }
        return false;
    }

    function resizeAndRedraw(audioBuffer) {
        const wasResized = resizeCanvasInternal();
        if (wasResized && cachedSpectrogramCanvas && spectrogramCtx && spectrogramCanvas) {
            spectrogramCtx.drawImage(cachedSpectrogramCanvas, 0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
        }
        const {currentTime = 0, duration = 0} = AudioApp.audioEngine?.getCurrentTime() || {};
        updateProgressIndicator(currentTime, duration || (audioBuffer ? audioBuffer.duration : 0));
    }

    return {
        init: init,
        computeAndDrawSpectrogram: computeAndDrawSpectrogram,
        resizeAndRedraw: resizeAndRedraw,
        updateProgressIndicator: updateProgressIndicator,
        clearVisuals: clearVisuals,
        showSpinner: showSpinner
    };
})(window.FFT);
