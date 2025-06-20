<!-- vibe-player-v2.0/src/lib/components/visualizers/Waveform.svelte -->
<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { playerStore } from '$lib/stores/player.store';
    import { VISUALIZER_CONSTANTS } from '$lib/utils/constants'; // For colors etc.
    import { get } from 'svelte/store'; // To read store value once if needed

    let canvasElement: HTMLCanvasElement;
    let canvasCtx: CanvasRenderingContext2D | null = null;
    let waveformData: number[][] = []; // Store current waveform data

    const WAVEFORM_COLOR_DEFAULT = VISUALIZER_CONSTANTS.WAVEFORM_COLOR_DEFAULT || '#26828E';
    const WAVEFORM_HEIGHT_SCALE = VISUALIZER_CONSTANTS.WAVEFORM_HEIGHT_SCALE || 0.8;


    playerStore.subscribe(value => {
        if (value.waveformData && value.waveformData.length > 0) {
            waveformData = value.waveformData;
            drawWaveform();
        } else if (waveformData.length > 0 && (!value.waveformData || value.waveformData.length === 0)) {
            // Clear canvas if waveform data is removed (e.g. new file loading, error)
            waveformData = [];
            clearCanvas();
        }
    });

    function clearCanvas() {
        if (canvasCtx && canvasElement) {
            canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        }
    }

    function drawWaveform() {
        if (!canvasCtx || !canvasElement || !waveformData || waveformData.length === 0) {
            clearCanvas();
            return;
        }

        const width = canvasElement.width;
        const height = canvasElement.height;
        const numChannels = waveformData.length;
        const channelHeight = height / numChannels;

        canvasCtx.clearRect(0, 0, width, height);
        canvasCtx.strokeStyle = WAVEFORM_COLOR_DEFAULT;
        canvasCtx.lineWidth = 1;

        for (let c = 0; c < numChannels; c++) {
            const channelData = waveformData[c];
            if (!channelData || channelData.length === 0) continue;

            const dataPoints = channelData.length;
            const stepX = width / dataPoints;
            const channelCenterY = (channelHeight * c) + (channelHeight / 2);

            canvasCtx.beginPath();
            canvasCtx.moveTo(0, channelCenterY - (channelData[0] * channelHeight / 2 * WAVEFORM_HEIGHT_SCALE));

            for (let i = 1; i < dataPoints; i++) {
                const x = i * stepX;
                const yValue = channelData[i] * channelHeight / 2 * WAVEFORM_HEIGHT_SCALE; // Scale amplitude to fit channel height
                canvasCtx.lineTo(x, channelCenterY - yValue);
            }
            canvasCtx.stroke();
        }
    }

    onMount(() => {
        if (!canvasElement) return;
        // Ensure canvas has a size for drawing, falling back to CSS size if not set directly
        // For responsive canvas, often done with ResizeObserver or binding width/height
        // Here, we'll use offsetWidth/Height for initial sizing.
        canvasElement.width = canvasElement.offsetWidth;
        canvasElement.height = canvasElement.offsetHeight;
        canvasCtx = canvasElement.getContext('2d');

        // Initial draw in case store already has data (e.g. page reload with URL state)
        const currentPlayerData = get(playerStore);
        if (currentPlayerData.waveformData) {
             waveformData = currentPlayerData.waveformData;
        }
        drawWaveform();

        // Optional: Handle window resize to redraw (more complex, involves debouncing)
        // window.addEventListener('resize', handleResize);
    });

    // function handleResize() { // Debounced resize handler
    //     if(canvasElement) {
    //         canvasElement.width = canvasElement.offsetWidth;
    //         canvasElement.height = canvasElement.offsetHeight;
    //         drawWaveform();
    //     }
    // }

    onDestroy(() => {
        // window.removeEventListener('resize', handleResize);
    });

</script>

<div class="card p-1 bg-surface-200-700-token aspect-[4/1] w-full h-full">
    <canvas bind:this={canvasElement} class="w-full h-full"></canvas>
</div>
