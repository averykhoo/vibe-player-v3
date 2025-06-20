<!-- vibe-player-v2.0/src/lib/components/Controls.svelte -->
<script lang="ts">
	/**
	 * @file Controls component for Vibe Player V2.
	 * @description Provides UI sliders and buttons for controlling audio playback parameters
	 * such as speed, pitch, gain, and VAD thresholds. It interacts with the audioEngine
	 * and analysis services to apply user changes.
	 */
	import { RangeSlider } from '@skeletonlabs/skeleton';
	import audioEngine from '$lib/services/audioEngine.service';
	import { playerStore } from '$lib/stores/player.store';
	import { analysisStore } from '$lib/stores/analysis.store';
	import { get } from 'svelte/store';
	import { debounce } from '$lib/utils/async'; // Import the debounce utility

	// --- Debounced Service Callers ---
	const debouncedSetSpeed = debounce((newSpeed: number) => {
		console.log(`[Controls.svelte] Debounced function EXECUTED for setSpeed. Value: ${newSpeed}`);
		audioEngine.setSpeed(newSpeed);
	}, 250);

	const debouncedSetPitch = debounce((newPitch: number) => {
		console.log(`[Controls.svelte] Debounced function EXECUTED for setPitch. Value: ${newPitch}`);
		audioEngine.setPitch(newPitch);
	}, 250);

	const debouncedSetGain = debounce((newGain: number) => {
		console.log(`[Controls.svelte] Debounced function EXECUTED for setGain. Value: ${newGain}`);
		audioEngine.setGain(newGain);
	}, 250);

	const debouncedSetVadThresholds = debounce((positive: number, negative: number) => {
		console.log(
			`[Controls.svelte] Debounced function EXECUTED for setVadThresholds. Values: P=${positive}, N=${negative}`
		);
		analysisStore.update((s) => ({
			...s,
			vadPositiveThreshold: positive,
			vadNegativeThreshold: negative
		}));
	}, 250);

	// --- Local State for UI Binding ---
	let speed = $playerStore?.speed || 1.0;
	let pitch = $playerStore?.pitch || 0.0;
	let gain = $playerStore?.gain || 1.0;
	let vadPositive = $analysisStore?.vadPositiveThreshold || 0.5;
	let vadNegative = $analysisStore?.vadNegativeThreshold || 0.35;

	// --- Reactive Statements (The Core Logic) ---
	$: if (speed !== undefined) {
		console.log(`[Controls.svelte] Reactive statement TRIGGERED for speed. Calling debounced function. Value: ${speed}`);
		debouncedSetSpeed(speed);
	}

	$: if (pitch !== undefined) {
		console.log(`[Controls.svelte] Reactive statement TRIGGERED for pitch. Calling debounced function. Value: ${pitch}`);
		debouncedSetPitch(pitch);
	}

	$: if (gain !== undefined) {
		console.log(`[Controls.svelte] Reactive statement TRIGGERED for gain. Calling debounced function. Value: ${gain}`);
		debouncedSetGain(gain);
	}

	$: if (vadPositive !== undefined && vadNegative !== undefined) {
		console.log(
			`[Controls.svelte] Reactive statement TRIGGERED for VAD. Calling debounced function. Values: P=${vadPositive}, N=${vadNegative}`
		);
		debouncedSetVadThresholds(vadPositive, vadNegative);
	}

	// --- Subscriptions to Sync UI from External Store Changes ---
	playerStore.subscribe((val) => {
		if (val.speed !== undefined && speed !== val.speed) speed = val.speed;
		if (val.pitch !== undefined && pitch !== val.pitch) pitch = val.pitch;
		if (val.gain !== undefined && gain !== val.gain) gain = val.gain;
	});
	analysisStore.subscribe((val) => {
		if (val.vadPositiveThreshold !== undefined && vadPositive !== val.vadPositiveThreshold)
			vadPositive = val.vadPositiveThreshold;
		if (val.vadNegativeThreshold !== undefined && vadNegative !== val.vadNegativeThreshold)
			vadNegative = val.vadNegativeThreshold;
	});

	// --- Button Handlers ---
	function handlePlayPause() {
		if (get(playerStore).isPlaying) {
			audioEngine.pause();
		} else {
			audioEngine.play();
		}
	}

	function handleStop() {
		audioEngine.stop();
	}
</script>

<div class="card p-4 space-y-4">
	<h3 class="h3">Controls</h3>
	<div class="flex space-x-2">
		<button
			type="button"
			class="btn"
			data-testid="play-button"
			on:click={handlePlayPause}
			disabled={!$playerStore.isPlayable}
		>
			{$playerStore.isPlaying ? 'Pause' : 'Play'}
		</button>
		<button
			type="button"
			class="btn"
			data-testid="stop-button"
			on:click={handleStop}
			disabled={!$playerStore.isPlayable}>Stop</button
		>
	</div>
	<div>
		<label for="speedSlider" class="label" data-testid="speed-value"
			>Speed: {speed.toFixed(2)}x</label
		>
		<RangeSlider
			data-testid="speed-slider-input"
			name="speedSlider"
			bind:value={speed}
			min={0.5}
			max={2.0}
			step={0.01}
		/>
	</div>
	<div>
		<label for="pitchSlider" class="label" data-testid="pitch-value"
			>Pitch: {pitch.toFixed(1)} semitones</label
		>
		<RangeSlider
			data-testid="pitch-slider-input"
			name="pitchSlider"
			bind:value={pitch}
			min={-12}
			max={12}
			step={0.1}
		/>
	</div>
	<div>
		<label for="gainSlider" class="label" data-testid="gain-value">Gain: {gain.toFixed(2)}</label>
		<RangeSlider
			data-testid="gain-slider-input"
			name="gainSlider"
			bind:value={gain}
			min={0}
			max={2.0}
			step={0.01}
		/>
	</div>
	<div>
		<label for="vadPositiveSlider" class="label" data-testid="vad-positive-value"
			>VAD Positive Threshold: {vadPositive.toFixed(2)}</label
		>
		<RangeSlider
			data-testid="vad-positive-slider-input"
			name="vadPositiveSlider"
			bind:value={vadPositive}
			min={0.05}
			max={0.95}
			step={0.01}
		/>
	</div>
	<div>
		<label for="vadNegativeSlider" class="label" data-testid="vad-negative-value"
			>VAD Negative Threshold: {vadNegative.toFixed(2)}</label
		>
		<RangeSlider
			data-testid="vad-negative-slider-input"
			name="vadNegativeSlider"
			bind:value={vadNegative}
			min={0.05}
			max={0.95}
			step={0.01}
		/>
	</div>
</div>