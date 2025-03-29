// /vibe-player/js/visualizer.js

/**
 * Handles drawing the waveform and spectrogram visualizations,
 * including VAD region highlighting and playback progress indication.
 */
const visualizer = (() => {
    // --- Private Module State ---
    let config = null;
    let audioBuffer = null;
    let vadRegions = null; // Array of { start, end } in seconds

    // Canvas elements and contexts
    let waveformCanvas = null;
    let waveformCtx = null;
    let spectrogramCanvas = null;
    let spectrogramCtx = null;
    let waveformProgressIndicator = null;
    let spectrogramProgressIndicator = null;

    // Spectrogram caching
    let spectrogramOffscreenCanvas = null;
    let spectrogramOffscreenCtx = null;
    let isSpectrogramComputing = false;
    let spectrogramNeedsRedraw = false;

    // Precomputed waveform data
    let waveformData = null;

    // Animation frame ID for progress updates (if needed, might rely solely on events)
    // let animationFrameId = null;

    // --- Private Methods ---

    /** Cache DOM elements and get rendering contexts. */
    function cacheDomElements() {
        waveformCanvas = document.getElementById('waveformCanvas');
        spectrogramCanvas = document.getElementById('spectrogramCanvas');
        waveformProgressIndicator = document.getElementById('waveformProgressIndicator');
        spectrogramProgressIndicator = document.getElementById('spectrogramProgressIndicator');

        if (!waveformCanvas || !spectrogramCanvas || !waveformProgressIndicator || !spectrogramProgressIndicator) {
            console.error("[Visualizer] Failed to find required canvas or progress elements.");
            return false;
        }

        waveformCtx = waveformCanvas.getContext('2d');
        spectrogramCtx = spectrogramCanvas.getContext('2d');

        if (!waveformCtx || !spectrogramCtx) {
            console.error("[Visualizer] Failed to get 2D rendering contexts.");
            return false;
        }
        return true;
    }

     /** Attaches event listeners. */
     function attachEventListeners() {
         // Listen for audio readiness to get data and draw initial visuals
         document.addEventListener('audioapp:audioReady', handleAudioReady);

         // Listen for time updates from the worklet manager
         document.addEventListener('audioapp:workletTimeUpdate', handleTimeUpdate);

         // Listen for window resize to redraw canvases
         window.addEventListener('resize', handleResize);

         // Add click listeners for seeking
         waveformCanvas?.addEventListener('click', handleCanvasClick);
         spectrogramCanvas?.addEventListener('click', handleCanvasClick);
     }

    /** Handles the audioReady event, storing data and triggering drawing. */
    function handleAudioReady(event) {
        if (!event.detail || !event.detail.buffer) {
            console.error("[Visualizer] Invalid audioReady event received.");
            return;
        }
        console.log("[Visualizer] Received audioReady event.");
        audioBuffer = event.detail.buffer;
        vadRegions = event.detail.vad?.regions || []; // Use provided regions or empty array

        // Reset state for new audio
        waveformData = null;
        spectrogramOffscreenCanvas = null; // Clear spectrogram cache
        updateProgressIndicator(0); // Reset progress indicator visually

        // Compute and draw visuals
        computeAndDrawVisuals();
    }

     /** Handles time updates from the worklet manager. */
     function handleTimeUpdate(event) {
         if (!audioBuffer || audioBuffer.duration <= 0) return; // No duration, nothing to update against
         const currentTime = event.detail.currentTime ?? 0;
         const progress = currentTime / audioBuffer.duration;
         updateProgressIndicator(progress);
     }

     /** Handles canvas clicks to dispatch seek requests. */
     function handleCanvasClick(event) {
         if (!audioBuffer || audioBuffer.duration <= 0) return;

         const canvas = event.target;
         const rect = canvas.getBoundingClientRect();
         const x = event.clientX - rect.left;
         const progress = x / rect.width; // Use clientWidth for accurate visible width
         const seekTime = progress * audioBuffer.duration;

         console.log(`[Visualizer] Seek requested to ${seekTime.toFixed(3)}s (Progress: ${progress.toFixed(3)})`);
         document.dispatchEvent(new CustomEvent('audioapp:seekRequested', {
             detail: { positionSeconds: seekTime }
         }));
     }


     /** Handles window resize events. */
     function handleResize() {
         // Debounce resize events for performance? (Simple version for now)
         console.log("[Visualizer] Handling resize.");
         resizeAndRedraw();
     }

    /** Computes waveform data from the AudioBuffer. */
    function computeWaveformData() {
        if (!audioBuffer) return;
        console.log("[Visualizer] Computing waveform data...");
        const channelData = audioBuffer.getChannelData(0); // Use first channel for waveform
        const numSamples = channelData.length;
        const width = waveformCanvas?.width || 1; // Use actual canvas render width
        const step = Math.ceil(numSamples / width);
        const amps = [];

        for (let i = 0; i < width; i++) {
            const start = i * step;
            const end = Math.min(start + step, numSamples);
            let min = 1.0;
            let max = -1.0;
            for (let j = start; j < end; j++) {
                const sample = channelData[j];
                if (sample < min) min = sample;
                if (sample > max) max = sample;
            }
            amps.push({ min, max });
        }
        waveformData = amps;
        console.log("[Visualizer] Waveform data computed.");
    }

    /** Draws the waveform onto the canvas. */
    function drawWaveform() {
        if (!waveformCtx || !waveformCanvas || !waveformData) return;

        const width = waveformCanvas.width;
        const height = waveformCanvas.height;
        const centerY = height / 2;
        const waveColor = config?.visualization?.waveformColor || '#3498db';
        const highlightColor = config?.visualization?.waveformHighlightColor || '#e67e22';

        // Clear canvas
        waveformCtx.clearRect(0, 0, width, height);

        // Draw background line
        waveformCtx.strokeStyle = '#ccc';
        waveformCtx.lineWidth = 1;
        waveformCtx.beginPath();
        waveformCtx.moveTo(0, centerY);
        waveformCtx.lineTo(width, centerY);
        waveformCtx.stroke();

        // Draw waveform
        waveformCtx.strokeStyle = waveColor;
        waveformCtx.lineWidth = 1; // Use 1 for sharp lines
        waveformCtx.beginPath();

        waveformData.forEach((amp, i) => {
             const yMin = centerY + amp.min * centerY;
             const yMax = centerY + amp.max * centerY;
             waveformCtx.moveTo(i + 0.5, yMin); // Use +0.5 for sharper lines
             waveformCtx.lineTo(i + 0.5, yMax);
        });
        waveformCtx.stroke();

        // Draw VAD highlights if regions exist
         if (vadRegions && vadRegions.length > 0 && audioBuffer && audioBuffer.duration > 0) {
            waveformCtx.fillStyle = highlightColor + '80'; // Add alpha for highlighting effect
            vadRegions.forEach(region => {
                 const startX = (region.start / audioBuffer.duration) * width;
                 const endX = (region.end / audioBuffer.duration) * width;
                 const regionWidth = Math.max(1, endX - startX); // Ensure at least 1px width
                 if (startX < width && endX > 0) { // Only draw if visible
                     waveformCtx.fillRect(startX, 0, regionWidth, height);
                 }
             });
         }
    }

    /** Computes and draws the spectrogram (potentially async). */
    async function computeAndDrawSpectrogram() {
        if (!audioBuffer || !spectrogramCanvas || !spectrogramCtx) return;
        if (isSpectrogramComputing) {
             console.log("[Visualizer] Spectrogram computation already in progress.");
             spectrogramNeedsRedraw = true; // Flag to redraw when current computation finishes
             return;
        }

        isSpectrogramComputing = true;
        spectrogramNeedsRedraw = false;
        AudioApp.uiManager?.showLoading(true, 'Spectrogram...'); // Show spinner via uiManager
        console.log("[Visualizer] Computing spectrogram...");

        // Ensure FFT library is loaded (it should be global via script tag)
        if (typeof FFT !== 'function') {
            console.error("[Visualizer] FFT library not found!");
            AudioApp.uiManager?.showError("Spectrogram library missing.");
             AudioApp.uiManager?.showLoading(false);
            isSpectrogramComputing = false;
            return;
        }

        const channelData = audioBuffer.getChannelData(0); // Use first channel
        const sampleRate = audioBuffer.sampleRate;
        const fftSize = config?.visualization?.fftSize || 1024;
        const hopLength = config?.visualization?.hopLength || Math.floor(fftSize / 4);
        const numFrames = Math.floor((channelData.length - fftSize) / hopLength) + 1;
        const numBins = fftSize / 2 + 1; // Number of frequency bins

        // Target canvas dimensions for drawing
        const targetWidth = spectrogramCanvas.width;
        const targetHeight = spectrogramCanvas.height;

         // Create or resize offscreen canvas for drawing spectrogram data
         if (!spectrogramOffscreenCanvas || spectrogramOffscreenCanvas.width !== numFrames || spectrogramOffscreenCanvas.height !== numBins) {
             spectrogramOffscreenCanvas = new OffscreenCanvas(numFrames, numBins);
             spectrogramOffscreenCtx = spectrogramOffscreenCanvas.getContext('2d', { alpha: false, willReadFrequently: false }); // Optimize for drawing
             console.log(`[Visualizer] Created/Resized offscreen spectrogram canvas: ${numFrames}x${numBins}`);
         }
         const imageData = spectrogramOffscreenCtx.createImageData(numFrames, numBins);
         const data = imageData.data; // RGBA array

        // --- Perform FFT calculation (can be slow) ---
        // Wrap in promise/async function if needed for yielding
        try {
            const fft = new FFT(fftSize, sampleRate);
            const magnitudes = []; // Store max magnitude for normalization later
            let maxMagnitude = 0;

            for (let i = 0; i < numFrames; i++) {
                const start = i * hopLength;
                const frame = channelData.subarray(start, start + fftSize);
                 // Apply window function? (e.g., Hanning) - Skipping for simplicity now
                const spectrum = fft.forward(frame); // Complex array [real, imag, real, imag, ...]
                const frameMagnitudes = [];

                for (let j = 0; j < numBins; j++) {
                    const real = spectrum[j * 2];
                    const imag = spectrum[j * 2 + 1];
                    // Magnitude = sqrt(real^2 + imag^2)
                    // Convert to dB: 20 * log10(magnitude) - More common for spectrograms
                    // Using simple magnitude squared for now (power spectrum) for performance
                    const magSquared = real * real + imag * imag;
                    frameMagnitudes.push(magSquared);
                    if (magSquared > maxMagnitude) maxMagnitude = magSquared;
                }
                magnitudes.push(frameMagnitudes);
            }
             console.log(`[Visualizer] Max magnitude squared: ${maxMagnitude}`);

            // Normalize and draw to offscreen canvas ImageData
            const maxLog = maxMagnitude > 0 ? Math.log10(maxMagnitude) : 1; // Avoid log(0)
            const minLog = maxMagnitude > 0 ? Math.log10(maxMagnitude / 10000) : 0; // Approx dynamic range (adjust as needed)
            const range = Math.max(1e-6, maxLog - minLog); // Avoid division by zero

            for (let i = 0; i < numFrames; i++) { // x-axis (time)
                 for (let j = 0; j < numBins; j++) { // y-axis (frequency)
                     const magSquared = magnitudes[i][j];
                     const logMag = magSquared > 1e-9 ? Math.log10(magSquared) : minLog; // Threshold small values
                     // Normalize log magnitude to 0-1 range
                     const normValue = Math.max(0, Math.min(1, (logMag - minLog) / range));
                     // Simple grayscale color map (inverted: higher value = darker)
                     const colorVal = Math.floor((1 - normValue) * 255);

                     const pixelIndex = ( (numBins - 1 - j) * numFrames + i) * 4; // y is inverted in canvas coords
                     data[pixelIndex] = colorVal;     // R
                     data[pixelIndex + 1] = colorVal; // G
                     data[pixelIndex + 2] = colorVal; // B
                     data[pixelIndex + 3] = 255;      // Alpha
                 }
            }
             spectrogramOffscreenCtx.putImageData(imageData, 0, 0);
             console.log("[Visualizer] Spectrogram data drawn to offscreen canvas.");

            // Draw from offscreen canvas to visible canvas
            drawSpectrogramFromOffscreen();

        } catch (error) {
            console.error("[Visualizer] Error computing spectrogram:", error);
             AudioApp.uiManager?.showError(`Spectrogram failed: ${error.message}`);
        } finally {
            isSpectrogramComputing = false;
             AudioApp.uiManager?.showLoading(false); // Hide spinner

             // If resize happened during computation, redraw now
            if (spectrogramNeedsRedraw) {
                 console.log("[Visualizer] Redrawing spectrogram after computation due to pending resize.");
                 resizeAndRedraw(); // Will redraw both waveform and spectrogram
             }
        }
    }

    /** Draws the cached spectrogram from the offscreen canvas to the visible one. */
    function drawSpectrogramFromOffscreen() {
        if (!spectrogramCtx || !spectrogramCanvas || !spectrogramOffscreenCanvas) return;
        const targetWidth = spectrogramCanvas.width;
        const targetHeight = spectrogramCanvas.height;

        spectrogramCtx.clearRect(0, 0, targetWidth, targetHeight);
        spectrogramCtx.imageSmoothingEnabled = false; // Use nearest-neighbor for scaling pixel data
        spectrogramCtx.drawImage(
            spectrogramOffscreenCanvas,
            0, 0, spectrogramOffscreenCanvas.width, spectrogramOffscreenCanvas.height, // Source rect
            0, 0, targetWidth, targetHeight // Destination rect (stretch/shrink)
        );
         // console.log("[Visualizer] Spectrogram drawn from offscreen canvas.");
    }

    /** Updates the position of the progress indicator line. */
    function updateProgressIndicator(progressRatio) {
        const progress = Math.max(0, Math.min(1, progressRatio)); // Clamp between 0 and 1
        const percent = `${progress * 100}%`;
        if (waveformProgressIndicator) {
            waveformProgressIndicator.style.left = percent;
        }
        if (spectrogramProgressIndicator) {
            spectrogramProgressIndicator.style.left = percent;
        }
    }

    /** Resizes canvases to fit container width and redraws content. */
    function resizeAndRedraw() {
        let didResize = false;

        [waveformCanvas, spectrogramCanvas].forEach(canvas => {
            if (!canvas) return;
            // Get container width (assuming canvas parent stretches)
            // Use clientWidth for actual rendered width
            const containerWidth = canvas.parentElement.clientWidth;
             // Check if resize is actually needed to avoid unnecessary redraws
            if (canvas.width !== containerWidth) {
                 canvas.width = containerWidth; // Set drawing buffer size
                 // Height is set via CSS or defaults, update if needed based on style
                 // canvas.height = parseInt(window.getComputedStyle(canvas).height, 10);
                 didResize = true;
                 console.log(`[Visualizer] Resized ${canvas.id} to width: ${containerWidth}`);
            }
        });

        // Only redraw if a resize actually occurred
        if (didResize) {
            // Recompute waveform data based on new width
             computeWaveformData(); // Uses current canvas width
             drawWaveform(); // Redraw waveform with new data/size

             // Redraw spectrogram from cache if available, otherwise flag for recompute/redraw
             if (spectrogramOffscreenCanvas) {
                 drawSpectrogramFromOffscreen();
             } else if (audioBuffer && !isSpectrogramComputing) {
                 // If buffer exists but spectrogram hasn't been computed yet, trigger it
                 computeAndDrawSpectrogram(); // Will redraw when done
             } else if (isSpectrogramComputing) {
                  // If computation is running, flag that redraw is needed when it finishes
                  spectrogramNeedsRedraw = true;
             }
             // Progress indicator position is relative (%), no redraw needed, just ensures it's visible
        }
    }

     /** Computes and draws both waveform and spectrogram. */
     function computeAndDrawVisuals() {
          if (!audioBuffer) return;
          resizeAndRedraw(); // Ensure canvases are sized correctly first
          // Waveform computation is synchronous and fast
          computeWaveformData();
          drawWaveform();
          // Spectrogram computation is async and slower
          computeAndDrawSpectrogram(); // Don't await, let it run in background
     }

    // --- Public API ---
    return {
        /**
         * Initializes the Visualizer.
         * @param {AudioAppConfig} appConfig The application configuration.
         */
        init(appConfig) {
            config = appConfig;
            if (!cacheDomElements()) {
                 throw new Error("Visualizer initialization failed: DOM elements missing.");
             }
            attachEventListeners();
            // Set initial canvas heights from config or CSS
            waveformCanvas.height = config.visualization.waveformHeight;
            spectrogramCanvas.height = config.visualization.spectrogramHeight;
            // Ensure initial size calculation happens
            resizeAndRedraw();
            console.log("Visualizer initialized.");
        },

        /** Triggers re-computation and drawing of all visuals. */
        // computeAndDrawVisuals, // Exposed if external trigger needed, handled by audioReady now

        /** Updates the progress indicator position. */
        updateProgressIndicator: (progressRatio) => updateProgressIndicator(progressRatio),

        /** Redraws only the VAD highlighting on the waveform. */
         redrawWaveformHighlight: (newVadRegions) => {
             console.log("[Visualizer] Redrawing VAD highlights.");
             vadRegions = newVadRegions || [];
             drawWaveform(); // Redraw the whole waveform to update highlights
         }
    };
})();

// Attach to the global AudioApp namespace
if (typeof window.AudioApp === 'undefined') {
    window.AudioApp = {};
}
window.AudioApp.visualizer = visualizer;
console.log("Visualizer module loaded.");

// /vibe-player/js/visualizer.js