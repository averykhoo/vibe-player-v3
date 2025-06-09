<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { get } from 'svelte/store';
    import { analysisStore } from '$lib/stores/analysis.store';
    import { viridisColor } from '$lib/utils/dsp'; // Assuming dsp.ts has viridisColor
    import { VISUALIZER_CONSTANTS } from '$lib/utils';

    let canvasElement: HTMLCanvasElement;
    let canvasCtx: CanvasRenderingContext2D | null = null;
    let spectrogramData: Float32Array[] | null = null;

    // Example: Trigger spectrogram processing after file is loaded via audioEngine
    // This is a bit indirect. A more robust system might have audioEngine emit an event
    // or update a store that analysisService listens to, to get the full audio buffer.
    // For now, this is a placeholder for how processing might be initiated.
    // playerStore.subscribe(value => {
    //     if (value.originalAudioBuffer && analysisService && get(analysisStore).spectrogramWorkerInitialized) {
    //          const pcmData = value.originalAudioBuffer.getChannelData(0); // Mono for spec for now
    //          analysisService.processAudioForSpectrogram(pcmData);
    //     }
    // });

    analysisStore.subscribe(value => {
        if (value.spectrogramData && value.spectrogramData.length > 0) {
            spectrogramData = value.spectrogramData;
            drawSpectrogram();
        } else if (spectrogramData && (!value.spectrogramData || value.spectrogramData.length === 0)) {
            spectrogramData = null;
            clearCanvas();
        }
    });

    function clearCanvas() {
        if (canvasCtx && canvasElement) {
            canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        }
    }

    function drawSpectrogram() {
        if (!canvasCtx || !canvasElement || !spectrogramData || spectrogramData.length === 0) {
            clearCanvas();
            return;
        }

        const numFrames = spectrogramData.length; // Time axis
        const numBins = spectrogramData[0].length; // Frequency axis (FFT_SIZE / 2 + 1)

        const width = canvasElement.width;
        const height = canvasElement.height;

        const cellWidth = width / numFrames;
        const cellHeight = height / numBins;

        canvasCtx.clearRect(0, 0, width, height);

        // Find global min/max magnitude for better color scaling (or use fixed range)
        let minMag = Infinity, maxMag = -Infinity;
        for (let t = 0; t < numFrames; t++) {
            for (let f = 0; f < numBins; f++) {
                const mag = spectrogramData[t][f];
                if (mag < minMag) minMag = mag;
                if (mag > maxMag) maxMag = mag;
            }
        }
        // Basic log scaling for magnitudes can improve visualization
        // const logMinMag = Math.log10(Math.max(1e-6, minMag)); // Avoid log(0)
        // const logMaxMag = Math.log10(Math.max(1e-6, maxMag));
        // const magRange = logMaxMag - logMinMag;

        // For linear scaling from 0 to maxMag (assuming magnitudes are positive)
        maxMag = Math.max(maxMag, 0.00001); // ensure maxMag is not zero for division

        for (let t = 0; t < numFrames; t++) { // Time
            for (let f = 0; f < numBins; f++) { // Frequency
                const magnitude = spectrogramData[t][f];

                // Normalize magnitude (0 to 1) - simple linear scaling
                let normalizedMag = magnitude / maxMag;
                // Or log scale:
                // if (magRange > 1e-6) {
                //    normalizedMag = (Math.log10(Math.max(1e-6, magnitude)) - logMinMag) / magRange;
                // } else {
                //    normalizedMag = 0;
                // }
                normalizedMag = Math.max(0, Math.min(1, normalizedMag)); // Clamp

                const [r, g, b] = viridisColor(normalizedMag);
                canvasCtx.fillStyle = `rgb(${r},${g},${b})`;

                // Draw from top (high freq) to bottom (low freq)
                canvasCtx.fillRect(t * cellWidth, height - (f + 1) * cellHeight, cellWidth, cellHeight);
            }
        }
    }

    onMount(() => {
        if (!canvasElement) return;
        canvasElement.width = canvasElement.offsetWidth;
        canvasElement.height = canvasElement.offsetHeight;
        canvasCtx = canvasElement.getContext('2d');

        const currentAnalysisData = get(analysisStore);
        if (currentAnalysisData.spectrogramData) {
            spectrogramData = currentAnalysisData.spectrogramData;
        }
        drawSpectrogram();
    });

</script>

<div class="card p-1 bg-surface-200-700-token aspect-[4/1] w-full h-full">
    <canvas bind:this={canvasElement} class="w-full h-full"></canvas>
</div>
