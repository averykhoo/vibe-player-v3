<!-- vibe-player-v2/src/lib/components/Controls.svelte -->
<script lang="ts">
	/**
	 * @file Controls component for Vibe Player V2.
	 * @description Provides UI sliders and buttons for controlling audio playback parameters
	 * such as speed, pitch, gain, and VAD thresholds. It interacts with the audioEngine
	 * and analysis services to apply user changes.
	 */
	import { RangeSlider } from '@skeletonlabs/skeleton';
	import audioEngine from '$lib/services/audioEngine.service';
	import analysisService from '$lib/services/analysis.service';
	import { playerStore } from '$lib/stores/player.store';
	import { analysisStore } from '$lib/stores/analysis.store';
	import { get } from 'svelte/store'; // get is used by handlePlayPause

	// Local state for VAD controls - these are not part of the current refactoring task.
	let vadPositive = $analysisStore?.vadPositiveThreshold || 0.5;
	let vadNegative = $analysisStore?.vadNegativeThreshold || 0.35;

	// Subscriptions to keep local state in sync with the global store
	// Only VAD-related subscriptions remain, as speed/pitch/gain are now directly bound to playerStore.
	analysisStore.subscribe((val) => {
		if (val.vadPositiveThreshold !== undefined) vadPositive = val.vadPositiveThreshold;
		if (val.vadNegativeThreshold !== undefined) vadNegative = val.vadNegativeThreshold;
	});

	/**
	 * Toggles the playback state by calling the audioEngine service.
	 */
	function handlePlayPause() {
		if (get(playerStore).isPlaying) {
			audioEngine.pause();
		} else {
			audioEngine.play();
		}
	}

	/**
	 * Stops playback and resets the position by calling the audioEngine service.
	 */
	function handleStop() {
		audioEngine.stop();
	}

	/**
	 * Called on speed slider input to update the playback speed.
	 * Value is taken directly from the store which is bound to the slider.
	 */
	function updateSpeed() {
		console.log(`[Controls] User set speed to: ${$playerStore.speed.toFixed(2)}`);
		audioEngine.setSpeed($playerStore.speed);
	}

	/**
	 * Called on pitch slider input to update the playback pitch.
	 * Value is taken directly from the store which is bound to the slider.
	 */
	function updatePitch() {
		console.log(`[Controls] User set pitch to: ${$playerStore.pitch.toFixed(1)}`);
		audioEngine.setPitch($playerStore.pitch);
	}

	/**
	 * Called on gain slider input to update the playback gain.
	 * Value is taken directly from the store which is bound to the slider.
	 */
	function updateGain() {
		console.log(`[Controls] User set gain to: ${$playerStore.gain.toFixed(2)}`);
		audioEngine.setGain($playerStore.gain);
	}

	/**
	 * [LOGGING ADDED] Called on slider input to update VAD thresholds in the store.
	 */
	function updateVadThresholds() {
		// LOG: See what the VAD values are when this function is called.
		console.log(
			`[Controls.svelte] updateVadThresholds() called. Positive: ${vadPositive}, Negative: ${vadNegative}`
		);
		analysisStore.update((s) => ({
			...s,
			vadPositiveThreshold: vadPositive,
			vadNegativeThreshold: vadNegative
		}));
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
			>Speed: {$playerStore.speed.toFixed(2)}x</label
		>
		<RangeSlider
			data-testid="speed-slider-input"
			name="speedSlider"
			bind:value={$playerStore.speed}
			min={0.5}
			max={2.0}
			step={0.01}
			on:input={updateSpeed}
			disabled={!$playerStore.isPlayable}
		/>
	</div>
	<div>
		<label for="pitchSlider" class="label" data-testid="pitch-value"
			>Pitch: {$playerStore.pitch.toFixed(1)} semitones</label
		>
		<RangeSlider
			data-testid="pitch-slider-input"
			name="pitchSlider"
			bind:value={$playerStore.pitch}
			min={-12}
			max={12}
			step={0.1}
			on:input={updatePitch}
			disabled={!$playerStore.isPlayable}
		/>
	</div>
	<div>
		<label for="gainSlider" class="label" data-testid="gain-value">Gain: {$playerStore.gain.toFixed(2)}</label>
		<RangeSlider
			data-testid="gain-slider-input"
			name="gainSlider"
			bind:value={$playerStore.gain}
			min={0}
			max={2.0}
			step={0.01}
			on:input={updateGain}
			disabled={!$playerStore.isPlayable}
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
			on:input={updateVadThresholds}
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
			on:input={updateVadThresholds}
		/>
	</div>
</div>