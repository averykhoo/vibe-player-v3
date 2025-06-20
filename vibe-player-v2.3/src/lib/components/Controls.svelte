<!-- vibe-player-v2.3/src/lib/components/Controls.svelte -->
<script lang="ts">
	import { RangeSlider } from '@skeletonlabs/skeleton';
	import audioEngine from '$lib/services/audioEngine.service';
	import { playerStore } from '$lib/stores/player.store';
	import { analysisStore } from '$lib/stores/analysis.store'; // This import seems unused in the script block
	import { get } from 'svelte/store';

	function handlePlayPause() {
		get(playerStore).isPlaying ? audioEngine.pause() : audioEngine.play();
	}

	function handleStop() {
		audioEngine.stop();
	}

    // Functions to call audioEngine service methods directly for sliders
    // These will be used in on:input events in the template
    function updateSpeed(event: Event) {
        const newSpeed = parseFloat((event.target as HTMLInputElement).value);
        playerStore.update(s => ({ ...s, speed: newSpeed })); // Update store optimistically
        audioEngine.setSpeed(newSpeed);
    }

    function updatePitch(event: Event) {
        const newPitch = parseFloat((event.target as HTMLInputElement).value);
        playerStore.update(s => ({ ...s, pitchShift: newPitch })); // Update store optimistically
        audioEngine.setPitch(newPitch);
    }

    function updateGain(event: Event) {
        const newGain = parseFloat((event.target as HTMLInputElement).value);
        playerStore.update(s => ({ ...s, gain: newGain })); // Update store optimistically
        audioEngine.setGain(newGain);
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
			>Pitch: {$playerStore.pitchShift.toFixed(1)} semitones</label
		>
		<RangeSlider
			data-testid="pitch-slider-input"
			name="pitchSlider"
			bind:value={$playerStore.pitchShift}
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
</div>