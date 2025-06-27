<!-- vibe-player-v2.3/src/lib/components/Controls.svelte -->
<script lang="ts">
	import { RangeSlider } from '@skeletonlabs/skeleton';
	import audioEngine from '$lib/services/audioEngine.service';
	import { playerStore } from '$lib/stores/player.store';
	import { analysisStore } from '$lib/stores/analysis.store';
	import { debounce } from '$lib/utils/async';
	import { get } from 'svelte/store';

	const engine = audioEngine;
	$: controlsDisabled = !$playerStore.isPlayable || $playerStore.status === 'loading';

	// --- Local State for UI Binding ---
	let speed = get(playerStore).speed;
	let pitchShift = get(playerStore).pitchShift;
	let gain = get(playerStore).gain;
	let vadPositive = get(analysisStore).vadPositiveThreshold;
	let vadNegative = get(analysisStore).vadNegativeThreshold;
	let jumpDuration = get(playerStore).jumpSeconds;

	// --- Debounced Service Calls ---
	const debouncedSetSpeed = debounce((val: number) => engine.setSpeed(val), 150);
	const debouncedSetPitch = debounce((val: number) => engine.setPitch(val), 150);
	const debouncedSetGain = debounce((val: number) => engine.setGain(val), 150);

	// --- Reactive Statements to update stores and services ---
	$: if (speed !== undefined) debouncedSetSpeed(speed);
	$: if (pitchShift !== undefined) debouncedSetPitch(pitchShift);
	$: if (gain !== undefined) debouncedSetGain(gain);
	$: if (vadPositive !== undefined) analysisStore.update((s) => ({ ...s, vadPositiveThreshold: vadPositive }));
	$: if (vadNegative !== undefined) analysisStore.update((s) => ({ ...s, vadNegativeThreshold: vadNegative }));
	$: if (jumpDuration !== undefined) playerStore.update((s) => ({ ...s, jumpSeconds: jumpDuration }));

	// --- Subscriptions to sync UI from external store changes ---
	playerStore.subscribe((val) => {
		if (val.speed !== speed) speed = val.speed;
		if (val.pitchShift !== pitchShift) pitchShift = val.pitchShift;
		if (val.gain !== gain) gain = val.gain;
		if (val.jumpSeconds !== jumpDuration) jumpDuration = val.jumpSeconds;
	});

	analysisStore.subscribe((val) => {
		if (val.vadPositiveThreshold !== undefined && vadPositive !== val.vadPositiveThreshold)
			vadPositive = val.vadPositiveThreshold;
		if (val.vadNegativeThreshold !== undefined && vadNegative !== val.vadNegativeThreshold)
			vadNegative = val.vadNegativeThreshold;
	});

	// --- Event Handlers ---
	function handlePlayPause() {
		engine.togglePlayPause();
	}
	function handleStop() {
		engine.stop();
	}
	function handleJumpBack() {
		engine.jump(-1);
	}
	function handleJumpForward() {
		engine.jump(1);
	}
</script>

<div class="card p-4 space-y-4 rounded-lg shadow-md">
	<h3 class="h3 text-lg font-semibold text-gray-700 dark:text-gray-300">Playback Controls</h3>

	<div class="flex items-center justify-center space-x-2">
		<button type="button" class="btn btn-secondary" on:click={handleJumpBack} disabled={controlsDisabled} aria-label="Jump back">
			<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd" /><path fill-rule="evenodd" d="M8.707 5.293a1 1 0 010 1.414L5.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
		</button>

		<button
			type="button"
			class="btn btn-primary w-28"
			data-testid="play-button"
			on:click={handlePlayPause}
			disabled={controlsDisabled}
			aria-label={$playerStore.isPlaying ? 'Pause audio' : 'Play audio'}
		>
			{#if $playerStore.isPlaying}
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"
					><path
						d="M6.25 5.007C6.25 4.451 6.694 4 7.25 4h1.5c.556 0 1 .451 1 .007v14.986c0 .556-.444 1.007-1 1.007h-1.5c-.556 0-1-.451-1-1.007V5.007zM15.25 5.007C15.25 4.451 15.694 4 16.25 4h1.5c.556 0 1 .451 1 .007v14.986c0 .556-.444 1.007-1 1.007h-1.5c-.556 0-1-.451-1-1.007V5.007z"
					/></svg
				>
				<span>Pause</span>
			{:else}
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"
					><path
						d="M5.055 7.06C3.805 7.06 2.75 8.115 2.75 9.365v5.27c0 1.25 1.055 2.305 2.305 2.305h1.24c.39 0 .745.195.975.515l3.565 4.625a1.5 1.5 0 002.415-.011l.11-.135c.585-.72 1.51-1.125 2.485-1.125h3.005c1.25 0 2.305-1.055 2.305-2.305V9.365c0-1.25-1.055-2.305-2.305-2.305h-3.005a3.75 3.75 0 00-2.485-1.125l-.11-.135a1.5 1.5 0 00-2.415-.01L7.27 6.545a1.25 1.25 0 00-.975.515H5.055z"
					/></svg
				>
				<span>Play</span>
			{/if}
		</button>
		<button
			type="button"
			class="btn btn-secondary w-28"
			data-testid="stop-button"
			on:click={handleStop}
			disabled={controlsDisabled && !$playerStore.isPlaying}
			aria-label="Stop audio"
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"
				><path
					d="M5.25 6.375a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0zM4.125 7.5A2.25 2.25 0 108.625 7.5 2.25 2.25 0 004.125 7.5zM15.375 5.25a1.125 1.125 0 110 2.25 1.125 1.125 0 010-2.25zM16.5 4.125a2.25 2.25 0 100 4.5 2.25 2.25 0 000-4.5zM4.5 10.875a.75.75 0 000 1.5h15a.75.75 0 000-1.5H4.5z"
				/></svg
			>
			<span>Stop</span>
		</button>

		<button type="button" class="btn btn-secondary" on:click={handleJumpForward} disabled={controlsDisabled} aria-label="Jump forward">
			<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" /><path fill-rule="evenodd" d="M11.293 14.707a1 1 0 010-1.414L14.586 10l-3.293-3.293a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" /></svg>
		</button>
	</div>

	<div class="flex items-center justify-center space-x-2 text-sm">
		<label for="jump-duration">Jump by:</label>
		<input
			type="number"
			id="jump-duration"
			bind:value={jumpDuration}
			min="1"
			step="1"
			class="input input-sm w-20 text-center"
			aria-label="Jump duration in seconds"
			disabled={controlsDisabled}
		/>
		<span>seconds</span>
	</div>

    <!-- ... (rest of the component) ... -->
</div>
