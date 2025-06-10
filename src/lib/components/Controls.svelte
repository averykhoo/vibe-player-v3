<script lang="ts">
	import Button from '@skeletonlabs/skeleton/components/Button/Button.svelte';
	import RangeSlider from '@skeletonlabs/skeleton/components/RangeSlider/RangeSlider.svelte';
	import { playerStore } from '$lib/stores/player.store';
	import audioEngine from '$lib/services/audioEngine.service';
	import { analysisStore } from '$lib/stores/analysis.store';

	// Component state bound to stores
	let speed: number;
	let pitch: number;
	let gain: number;
	let vadPositiveThreshold: number;
	let vadNegativeThreshold: number;

	playerStore.subscribe((value) => {
		speed = value.speed ?? 1.0;
		pitch = value.pitch ?? 0;
		gain = value.gain ?? 1.0;
	});

	analysisStore.subscribe((value) => {
		vadPositiveThreshold = value.vadPositiveThreshold ?? 0.5;
		vadNegativeThreshold = value.vadNegativeThreshold ?? 0.35;
	});

	// Reactive statements to call services when sliders change
	$: if (speed !== undefined) audioEngine.setSpeed(speed);
	$: if (pitch !== undefined) audioEngine.setPitch(pitch);
	$: if (gain !== undefined) audioEngine.setGain(gain);
	$: if (vadPositiveThreshold !== undefined) analysisStore.update(s => ({...s, vadPositiveThreshold: vadPositiveThreshold}));
	$: if (vadNegativeThreshold !== undefined) analysisStore.update(s => ({...s, vadNegativeThreshold: vadNegativeThreshold}));
</script>

{#if $playerStore.isPlayable}
<div class="card p-4 space-y-4">
    <!-- Playback Controls -->
    <div class="flex justify-center items-center space-x-2">
        <Button data-testid="play-button" on:click={() => audioEngine.play()} class="w-24">
            {#if $playerStore.isPlaying}
                Pause
            {:else}
                Play
            {/if}
        </Button>
        <Button data-testid="stop-button" on:click={() => audioEngine.stop()} class="w-24">Stop</Button>
    </div>

    <!-- Parameter Sliders -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <!-- Speed -->
        <label class="label">
            <span>Speed: {speed.toFixed(2)}x</span>
            <RangeSlider data-testid="speed-slider-input" name="speed" bind:value={speed} min={0.25} max={2.0} step={0.01} />
        </label>

        <!-- Pitch -->
        <label class="label">
            <span>Pitch: {pitch.toFixed(1)} semitones</span>
            <RangeSlider data-testid="pitch-slider-input" name="pitch" bind:value={pitch} min={-12} max={12} step={0.1} />
        </label>

        <!-- Gain -->
        <label class="label">
            <span>Gain: {gain.toFixed(2)}</span>
            <RangeSlider data-testid="gain-slider-input" name="gain" bind:value={gain} min={0} max={2} step={0.05} />
        </label>

        <!-- VAD Positive Threshold -->
        <label class="label">
            <span>VAD Positive Threshold: {vadPositiveThreshold.toFixed(2)}</span>
            <RangeSlider data-testid="vad-positive-slider-input" name="vad-positive" bind:value={vadPositiveThreshold} min={0.01} max={0.99} step={0.01} />
        </label>

        <!-- VAD Negative Threshold -->
        <label class="label">
            <span>VAD Negative Threshold: {vadNegativeThreshold.toFixed(2)}</span>
            <RangeSlider data-testid="vad-negative-slider-input" name="vad-negative" bind:value={vadNegativeThreshold} min={0.01} max={0.99} step={0.01} />
        </label>
    </div>
</div>
{/if}
