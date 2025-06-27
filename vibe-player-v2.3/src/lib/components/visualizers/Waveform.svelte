<!-- vibe-player-v2.3/src/lib/components/visualizers/Waveform.svelte -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { playerStore } from '$lib/stores/player.store';
	import { analysisStore } from '$lib/stores/analysis.store';
	import { VISUALIZER_CONSTANTS } from '$lib/utils/constants';
	import { get } from 'svelte/store';
	import type { VadRegion } from '$lib/types/analysis.types';

	let canvasElement: HTMLCanvasElement;
	let canvasCtx: CanvasRenderingContext2D | null = null;
	let waveformData: number[][] = [];
	let speechRegions: VadRegion[] | null = null;

	const WAVEFORM_COLOR_DEFAULT = VISUALIZER_CONSTANTS.WAVEFORM_COLOR_DEFAULT || '#26828E';
	const WAVEFORM_COLOR_SPEECH = VISUALIZER_CONSTANTS.WAVEFORM_COLOR_SPEECH || '#FDE725';
	const WAVEFORM_HEIGHT_SCALE = VISUALIZER_CONSTANTS.WAVEFORM_HEIGHT_SCALE || 0.8;

	playerStore.subscribe((value) => {
		let needsRedraw = false;
		if (value.waveformData && value.waveformData !== waveformData) {
			waveformData = value.waveformData;
			needsRedraw = true;
		} else if (!value.waveformData && waveformData.length > 0) {
			waveformData = [];
			clearCanvas();
		}
		if (needsRedraw) drawWaveform();
	});

	analysisStore.subscribe((value) => {
		if (value.vadRegions !== speechRegions) {
			speechRegions = value.vadRegions;
			if (waveformData.length > 0) {
				drawWaveform();
			}
		}
	});

	function clearCanvas() {
		if (canvasCtx && canvasElement) {
			canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
		}
	}

	function drawWaveform() {
		if (!canvasCtx || !canvasElement || waveformData.length === 0 || waveformData[0].length === 0) {
			clearCanvas();
			return;
		}

		const width = canvasElement.width;
		const height = canvasElement.height;
		const duration = get(playerStore).duration;

		canvasCtx.clearRect(0, 0, width, height);

		const pixelsPerSecond = duration > 0 ? width / duration : 0;
		const speechPixelRegions = (speechRegions || []).map((r) => ({
			startPx: r.start * pixelsPerSecond,
			endPx: r.end * pixelsPerSecond
		}));

		drawWaveformPath(WAVEFORM_COLOR_DEFAULT, (x) => !isPixelInRegions(x, speechPixelRegions));

		if (speechPixelRegions.length > 0) {
			drawWaveformPath(WAVEFORM_COLOR_SPEECH, (x) => isPixelInRegions(x, speechPixelRegions));
		}
	}

	function isPixelInRegions(pixelX: number, regions: { startPx: number; endPx: number }[]): boolean {
		for (const region of regions) {
			if (pixelX >= region.startPx && pixelX <= region.endPx) {
				return true;
			}
		}
		return false;
	}

	function drawWaveformPath(color: string, condition: (x: number) => boolean) {
		if (!canvasCtx || !canvasElement || waveformData.length === 0) return;
		const width = canvasElement.width;
		const height = canvasElement.height;
		const numChannels = waveformData.length;
		const channelHeight = height / numChannels;
		const dataPoints = waveformData[0].length;
		const stepX = width / dataPoints;

		canvasCtx.fillStyle = color;
		canvasCtx.beginPath();

		for (let c = 0; c < numChannels; c++) {
			const channelData = waveformData[c];
			if (!channelData || channelData.length === 0) continue;
			const channelCenterY = channelHeight * c + channelHeight / 2;

			for (let i = 0; i < dataPoints; i++) {
				const x = i * stepX;
				if (condition(x)) {
					const peakAmplitude = channelData[i];
					const y = (peakAmplitude * channelHeight) / 2 * WAVEFORM_HEIGHT_SCALE;
					canvasCtx.rect(x, channelCenterY - y, stepX, y * 2);
				}
			}
		}
		canvasCtx.fill();
	}

	onMount(() => {
		if (!canvasElement) return;
		canvasElement.width = canvasElement.offsetWidth;
		canvasElement.height = canvasElement.offsetHeight;
		canvasCtx = canvasElement.getContext('2d');

		const currentPlayerData = get(playerStore);
		if (currentPlayerData.waveformData) {
			waveformData = currentPlayerData.waveformData;
		}
		drawWaveform();
	});
</script>

<div class="card p-1 bg-surface-200-700-token aspect-[4/1] w-full h-full">
	<canvas bind:this={canvasElement} class="w-full h-full"></canvas>
</div>
