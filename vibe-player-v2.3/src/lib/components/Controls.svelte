<!-- vibe-player-v2.3/src/lib/components/Controls.svelte -->
<script lang="ts">
	import { RangeSlider } from '@skeletonlabs/skeleton';
	import audioEngine from '$lib/services/audioEngine.service';
	import { playerStore } from '$lib/stores/player.store';

	const engine = audioEngine; // Cache instance

	// Reactive variable to unify disabled logic
	$: controlsDisabled = !$playerStore.isPlayable || $playerStore.status === 'loading';

	// CORRECTED: The component simply reports the user's INTENT to toggle playback.
	function handlePlayPause() {
        console.log('[Controls.svelte] handlePlayPause triggered. Calling engine.togglePlayPause()');
		engine.togglePlayPause();
	}

	function handleStop() {
		engine.stop();
	}
</script>

<div class="card p-4 space-y-4 rounded-lg shadow-md">
	<h3 class="h3 text-lg font-semibold text-gray-700 dark:text-gray-300">Playback Controls</h3>

	<div class="flex items-center space-x-2">
		<button
			type="button"
			class="btn btn-primary"
			data-testid="play-button"
			on:click={handlePlayPause}
			disabled={controlsDisabled}
			aria-label={$playerStore.isPlaying ? 'Pause audio' : 'Play audio'}
		>
			{#if $playerStore.isPlaying}
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path d="M6.25 5.007C6.25 4.451 6.694 4 7.25 4h1.5c.556 0 1 .451 1 .007v14.986c0 .556-.444 1.007-1 1.007h-1.5c-.556 0-1-.451-1-1.007V5.007zM15.25 5.007C15.25 4.451 15.694 4 16.25 4h1.5c.556 0 1 .451 1 .007v14.986c0 .556-.444 1.007-1 1.007h-1.5c-.556 0-1-.451-1-1.007V5.007z"></path></svg>
				<span>Pause</span>
			{:else}
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path d="M5.055 7.06C3.805 7.06 2.75 8.115 2.75 9.365v5.27c0 1.25 1.055 2.305 2.305 2.305h1.24c.39 0 .745.195.975.515l3.565 4.625a1.5 1.5 0 002.415-.011l.11-.135c.585-.72 1.51-1.125 2.485-1.125h3.005c1.25 0 2.305-1.055 2.305-2.305V9.365c0-1.25-1.055-2.305-2.305-2.305h-3.005a3.75 3.75 0 00-2.485-1.125l-.11-.135a1.5 1.5 0 00-2.415-.01L7.27 6.545a1.25 1.25 0 00-.975.515H5.055z"></path></svg>
				<span>Play</span>
			{/if}
		</button>
		<button
			type="button"
			class="btn btn-secondary"
			data-testid="stop-button"
			on:click={handleStop}
			disabled={controlsDisabled && !$playerStore.isPlaying}
			aria-label="Stop audio"
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path d="M5.25 6.375a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0zM4.125 7.5A2.25 2.25 0 108.625 7.5 2.25 2.25 0 004.125 7.5zM15.375 5.25a1.125 1.125 0 110 2.25 1.125 1.125 0 010-2.25zM16.5 4.125a2.25 2.25 0 100 4.5 2.25 2.25 0 000-4.5zM4.5 10.875a.75.75 0 000 1.5h15a.75.75 0 000-1.5H4.5z"></path></svg>
			<span>Stop</span>
		</button>
	</div>

	<div class="space-y-1">
		<label for="speedSlider" class="label text-sm font-medium text-gray-700 dark:text-gray-300" data-testid="speed-value"
			>Speed: {$playerStore.speed.toFixed(2)}x</label
		>
		<RangeSlider
			data-testid="speed-slider-input"
			name="speedSlider"
			value={$playerStore.speed}
			on:input={(e) => engine.setSpeed(e.currentTarget.valueAsNumber)}
			min={0.5} max={2.0} step={0.01}
			disabled={controlsDisabled}
			class="w-full"
		/>
	</div>

	<div class="space-y-1">
		<label for="pitchSlider" class="label text-sm font-medium text-gray-700 dark:text-gray-300" data-testid="pitch-value"
			>Pitch: {$playerStore.pitchShift.toFixed(1)} semitones</label
		>
		<RangeSlider
			data-testid="pitch-slider-input"
			name="pitchSlider"
			value={$playerStore.pitchShift}
			on:input={(e) => engine.setPitch(e.currentTarget.valueAsNumber)}
			min={-12} max={12} step={0.1}
			disabled={controlsDisabled}
			class="w-full"
		/>
	</div>

	<div class="space-y-1">
		<label for="gainSlider" class="label text-sm font-medium text-gray-700 dark:text-gray-300" data-testid="gain-value"
			>Gain: {$playerStore.gain.toFixed(2)}</label
		>
		<RangeSlider
			data-testid="gain-slider-input"
			name="gainSlider"
			value={$playerStore.gain}
			on:input={(e) => engine.setGain(e.currentTarget.valueAsNumber)}
			min={0} max={2.0} step={0.01}
			disabled={controlsDisabled}
			class="w-full"
		/>
	</div>
</div>