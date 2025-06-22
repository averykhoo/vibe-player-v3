<script lang="ts">
    import { RangeSlider } from '@skeletonlabs/skeleton';
    import audioEngine from '$lib/services/audioEngine.service';
    import { playerStore } from '$lib/stores/player.store';
    import { analysisStore } from '$lib/stores/analysis.store'; // <-- ADDED for VAD
    import { debounce } from '$lib/utils/async';
    import { get } from 'svelte/store'; // <-- Ensure get is imported

    const engine = audioEngine;
    $: controlsDisabled = !$playerStore.isPlayable || $playerStore.status === 'loading';

    // --- Local State for UI Binding (Speed, Pitch, Gain) ---
    let speed = get(playerStore).speed;
    let pitchShift = get(playerStore).pitchShift;
    let gain = get(playerStore).gain;

    // --- Local State for VAD Sliders (NEW) ---
    let vadPositive = get(analysisStore).vadPositiveThreshold;
    let vadNegative = get(analysisStore).vadNegativeThreshold;

    const debouncedSetSpeed = debounce((val: number) => {
        console.log(`[Controls.svelte] DEBOUNCED setSpeed executed with: ${val}`);
        engine.setSpeed(val);
    }, 150);
    const debouncedSetPitch = debounce((val: number) => {
        console.log(`[Controls.svelte] DEBOUNCED setPitch (pitchShift) executed with: ${val}`);
        engine.setPitch(val);
    }, 150);
    const debouncedSetGain = debounce((val: number) => {
        console.log(`[Controls.svelte] DEBOUNCED setGain executed with: ${val}`);
        engine.setGain(val);
    }, 150);

    // --- Debounced VAD Update (NEW) ---
    const debouncedSetVadThresholds = debounce(() => {
        analysisStore.update(s => ({
            ...s,
            vadPositiveThreshold: vadPositive,
            vadNegativeThreshold: vadNegative
        }));
        // Note: For live VAD updates, analysisService would need a method to re-init or update worker thresholds.
        // For now, this just updates the store, which might be used on next file load by orchestrator.
    }, 250);

    // --- Reactive Statements to Call Services ---
    // MODIFIED: Simpler reactive triggers for speed, pitch, gain
    $: if (speed !== undefined) {
        console.log(`[Controls.svelte] UI 'speed' changed to: ${speed}. Queuing debouncedSetSpeed.`);
        debouncedSetSpeed(speed);
    }
    $: if (pitchShift !== undefined) {
        console.log(`[Controls.svelte] UI 'pitchShift' changed to: ${pitchShift}. Queuing debouncedSetPitch.`);
        debouncedSetPitch(pitchShift);
    }
    $: if (gain !== undefined) {
        console.log(`[Controls.svelte] UI 'gain' changed to: ${gain}. Queuing debouncedSetGain.`);
        debouncedSetGain(gain);
    }
    // Note: The conditions `!== get(playerStore).<value>` are added to prevent
    // the debounced functions from being called on initial component load if the
    // local values are already in sync with the store.


    // --- Reactive Statement for VAD (NEW) ---
    $: if (vadPositive !== undefined && vadNegative !== undefined) debouncedSetVadThresholds();

    // --- Subscriptions to Sync UI from External Store Changes ---
    playerStore.subscribe(val => {
        if (val.speed !== speed) speed = val.speed;
        if (val.pitchShift !== pitchShift) pitchShift = val.pitchShift;
        if (val.gain !== gain) gain = val.gain;
    });

    analysisStore.subscribe(val => { // (NEW)
        if (val.vadPositiveThreshold !== undefined && vadPositive !== val.vadPositiveThreshold)
            vadPositive = val.vadPositiveThreshold;
        if (val.vadNegativeThreshold !== undefined && vadNegative !== val.vadNegativeThreshold)
            vadNegative = val.vadNegativeThreshold;
    });

    function handlePlayPause() {
        engine.togglePlayPause();
    }
    function handleStop() {
        engine.stop();
    }

    // REMOVE jumpSeconds variable and jump button logic
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
        <!-- Jump controls REMOVED from here -->
    </div>

    <div class="space-y-1">
        <label for="speedSlider" class="label text-sm font-medium text-gray-700 dark:text-gray-300" data-testid="speed-value"
            >Speed: {speed.toFixed(2)}x</label
        > <!-- MODIFIED to bind local 'speed' -->
        <RangeSlider
            data-testid="speed-slider-input"
            name="speedSlider"
            bind:value={speed}
            min={0.5} max={2.0} step={0.01}
            disabled={controlsDisabled}
            class="w-full"
        ></RangeSlider>
    </div>

    <div class="space-y-1">
        <label for="pitchSlider" class="label text-sm font-medium text-gray-700 dark:text-gray-300" data-testid="pitch-value"
            >Pitch: {pitchShift.toFixed(1)} semitones</label
        > <!-- MODIFIED to bind local 'pitchShift' -->
        <RangeSlider
            data-testid="pitch-slider-input"
            name="pitchSlider"
            bind:value={pitchShift}
            min={-12} max={12} step={0.1}
            disabled={controlsDisabled}
            class="w-full"
        ></RangeSlider>
    </div>

    <div class="space-y-1">
        <label for="gainSlider" class="label text-sm font-medium text-gray-700 dark:text-gray-300" data-testid="gain-value"
            >Gain: {gain.toFixed(2)}</label
        > <!-- MODIFIED to bind local 'gain' -->
        <RangeSlider
            data-testid="gain-slider-input"
            name="gainSlider"
            bind:value={gain}
            min={0} max={2.0} step={0.01}
            disabled={controlsDisabled}
            class="w-full"
        ></RangeSlider>
    </div>

    <!-- VAD Sliders (NEWLY ADDED) -->
    <div class="space-y-1">
        <label for="vadPositiveSlider" class="label text-sm font-medium text-gray-700 dark:text-gray-300" data-testid="vad-positive-value">
            VAD Positive Threshold: {vadPositive.toFixed(2)}
        </label>
        <RangeSlider
            data-testid="vad-positive-slider-input"
            name="vadPositiveSlider"
            bind:value={vadPositive}
            min={0.05} max={0.95} step={0.01}
            disabled={controlsDisabled}
            class="w-full"
        ></RangeSlider>
    </div>
    <div class="space-y-1">
        <label for="vadNegativeSlider" class="label text-sm font-medium text-gray-700 dark:text-gray-300" data-testid="vad-negative-value">
            VAD Negative Threshold: {vadNegative.toFixed(2)}
        </label>
        <RangeSlider
            data-testid="vad-negative-slider-input"
            name="vadNegativeSlider"
            bind:value={vadNegative}
            min={0.05} max={0.95} step={0.01}
            disabled={controlsDisabled}
            class="w-full"
        ></RangeSlider>
    </div>
</div>
