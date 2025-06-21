<!-- vibe-player-v2.3/src/routes/+page.svelte -->
<!-- DO NOT ADD /* ... */ STYLE COMMENTS IN THIS FILE. SVELTE DOES NOT WORK LIKE THAT. -->
<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { get } from 'svelte/store';
    import { Toaster, toast } from 'svelte-sonner'; // Added toast for potential notifications
    import { RangeSlider } from '@skeletonlabs/skeleton';
    import Controls from '$lib/components/Controls.svelte';
    import FileLoader from '$lib/components/FileLoader.svelte';
    import ToneDisplay from '$lib/components/ToneDisplay.svelte';
    import Waveform from '$lib/components/visualizers/Waveform.svelte';
    import Spectrogram from '$lib/components/visualizers/Spectrogram.svelte';

    import audioEngine from '$lib/services/audioEngine.service';
    import { playerStore } from '$lib/stores/player.store';
    import { timeStore } from '$lib/stores/time.store'; // NEW
    import { AudioOrchestrator } from '$lib/services/AudioOrchestrator.service';
    import { formatTime } from '$lib/utils/formatters';
    import { statusStore } from '$lib/stores/status.store'; // For reacting to status changes, e.g., errors

    let orchestrator: AudioOrchestrator; // To store instance

    // Simplified seek handler
    function handleSeek(event: MouseEvent | TouchEvent) {
        if (!$playerStore.isPlayable) return;

        const slider = event.currentTarget as HTMLInputElement;
        const rect = slider.getBoundingClientRect();
        let clientX: number;

        if (window.TouchEvent && event instanceof TouchEvent && event.changedTouches && event.changedTouches.length > 0) {
            clientX = event.changedTouches[0].clientX;
        } else if (event instanceof MouseEvent) {
            clientX = event.clientX;
        } else {
            return; // Not a recognized event type
        }

        const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const newTime = percent * get(playerStore).duration;

        // Check if duration is valid before seeking
        if (get(playerStore).duration > 0) {
            audioEngine.seek(newTime);
        }
    }

    onMount(() => {
        orchestrator = AudioOrchestrator.getInstance();
        orchestrator.setupUrlSerialization();

        // Example: Subscribe to statusStore to show toast notifications for errors
        const unsubscribeStatus = statusStore.subscribe(currentStatus => {
            if (currentStatus.type === 'error' && currentStatus.message) {
                toast.error(currentStatus.message);
            }
            // Could also show success toasts, etc.
            // if (currentStatus.type === 'success' && currentStatus.message && !currentStatus.isLoading) {
            //    toast.success(currentStatus.message);
            // }
        });

        return () => {
            // audioEngine.dispose(); // Per issue description, AudioEngine.service.ts does not define dispose, so not called here.
            // The subtask for AudioEngine.service.ts *did* add a dispose method. If its usage is confirmed, this line can be reinstated.
            // For now, adhering to the original issue's stated interface for AudioEngine from +page.svelte's perspective.
            unsubscribeStatus(); // Clean up store subscription
            console.log("Main page unmounted.");
        };
    });
</script>

<Toaster richColors position="top-right" />

<div class="container mx-auto p-4 max-w-4xl space-y-8">
    <header class="mb-6 text-center">
        <h1 class="text-4xl font-bold text-primary-600 dark:text-primary-400" data-testid="app-bar-title">Vibe Player V2.3</h1>
        <p class="text-gray-600 dark:text-gray-400">Refactored Audio Analysis & Playback</p>
    </header>

    <section id="file-loader" class="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
        <FileLoader />
    </section>

<!-- This section is now ALWAYS rendered -->
    <section id="player-main" class="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg space-y-4">
    <!-- Only wrap the "Now Playing" text in the conditional block -->
    {#if $playerStore.fileName}
        <div class="text-center">
            <p class="text-sm text-gray-500 dark:text-gray-400">Now Playing:</p>
            <h2 class="text-xl font-semibold text-gray-700 dark:text-gray-300" data-testid="file-name-display">{$playerStore.fileName}</h2>
        </div>
    {/if}

    <!-- The rest of the controls are always visible -->
        <div class="text-center font-mono text-lg text-gray-700 dark:text-gray-300" data-testid="time-display">
            {formatTime($timeStore)} / {formatTime($playerStore.duration)}
        </div>
        <RangeSlider
            name="seek"
            bind:value={$timeStore}
            max={$playerStore.duration > 0 ? $playerStore.duration : 1}
            step="any"
            on:click={handleSeek}
            disabled={!$playerStore.isPlayable || $playerStore.status === 'loading'}
            data-testid="seek-slider-input"
            aria-label="Seek audio track"
            class="w-full"
        />
        <div id="controls">
            <Controls/>
        </div>
    </section>


    {#if $playerStore.isPlayable && $playerStore.status !== 'loading'}
    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <section id="waveform" class="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
            <h2 class="text-2xl font-semibold mb-4 text-center text-primary-600 dark:text-primary-400">Waveform</h2>
            <Waveform/>
        </section>

        <section id="tone-display" class="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
            <h2 class="text-2xl font-semibold mb-4 text-center text-primary-600 dark:text-primary-400">Tone Activity</h2>
            <ToneDisplay/>
        </section>
    </div>

    <section id="spectrogram" class="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
        <h2 class="text-2xl font-semibold mb-4 text-center text-primary-600 dark:text-primary-400">Spectrogram</h2>
        <Spectrogram/>
    </section>
    {/if}

    <footer class="mt-12 text-center text-sm text-gray-500 dark:text-gray-400">
        <p>Vibe Player V2.3 - Orchestrated Single-Authority Architecture</p>
        <p>Developed with assistance from AI.</p>
    </footer>
</div>

<style>
    /* Add any page-specific styles here if needed */
    /* Example: ensure visibility of RangeSlider thumb */
    :global(input[type="range"]::-webkit-slider-thumb) {
        /* -webkit-appearance: none; */
        /* appearance: none; */
        /* background: #007bff; */
        /* cursor: pointer; */
        /* height: 20px; */
        /* width: 20px; */
        /* border-radius: 50%; */
    }
    :global(input[type="range"]::-moz-range-thumb) {
        /* background: #007bff; */
        /* cursor: pointer; */
        /* height: 20px; */
        /* width: 20px; */
        /* border-radius: 50%; */
        /* border: none; */
    }
</style>