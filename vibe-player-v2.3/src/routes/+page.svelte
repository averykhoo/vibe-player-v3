<!-- vibe-player-v2.3/src/routes/+page.svelte -->
<!-- vibe-player-v2.3/src/routes/+page.svelte -->
<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { get } from 'svelte/store';
    import { Toaster, toast } from 'svelte-sonner';
    import { RangeSlider } from '@skeletonlabs/skeleton';
    import Controls from '$lib/components/Controls.svelte';
    import FileLoader from '$lib/components/FileLoader.svelte';
    import ToneDisplay from '$lib/components/ToneDisplay.svelte';
    import Waveform from '$lib/components/visualizers/Waveform.svelte';
    import Spectrogram from '$lib/components/visualizers/Spectrogram.svelte';
    import type { PageData } from './$types';
    export let data: PageData;
    import audioEngine from '$lib/services/audioEngine.service';
    import { playerStore } from '$lib/stores/player.store';
    import { timeStore } from '$lib/stores/time.store';
    import { AudioOrchestrator } from '$lib/services/AudioOrchestrator.service';
    import { formatTime } from '$lib/utils/formatters';
    import { statusStore } from '$lib/stores/status.store';

    let orchestrator: AudioOrchestrator;
    let isDragOver = false; // For drag-and-drop UI feedback

    // --- SEEK LOGIC (UNCHANGED) ---
    let seekTime = $timeStore;
    let isSeeking = false;
    let wasPlayingBeforeSeek = false;
    timeStore.subscribe(value => {
        if (!isSeeking) seekTime = value;
    });
    function handleSeekStart() {
        console.log(`[+page.svelte handleSeekStart] Fired. Current $playerStore.isPlayable: ${get(playerStore).isPlayable}`);
        if (!get(playerStore).isPlayable) return;
		isSeeking = true;
		wasPlayingBeforeSeek = get(playerStore).isPlaying;
        console.log(`[+page.svelte handleSeekStart] Set isSeeking=true, wasPlayingBeforeSeek=${wasPlayingBeforeSeek}`);
		if (wasPlayingBeforeSeek) {
            console.log(`[+page.svelte handleSeekStart] Was playing. Calling audioEngine.pause().`);
			audioEngine.pause();
		}
	}
    function handleSeekInput() {
        if (!isSeeking) return; // Only log if actively seeking
        console.log(`[+page.svelte handleSeekInput] Fired. Current local seekTime: ${seekTime.toFixed(3)}. Updating timeStore.`);
		timeStore.set(seekTime);
	}
    function handleSeekEnd() {
        console.log(`[+page.svelte handleSeekEnd] Fired. wasPlayingBeforeSeek: ${wasPlayingBeforeSeek}, isSeeking (before reset): ${isSeeking}, local seekTime: ${seekTime.toFixed(3)}`);
        if (!get(playerStore).isPlayable) {
            isSeeking = false; // Ensure flag is reset
            console.log('[+page.svelte handleSeekEnd] Player not playable, exiting.');
            return;
        }
        console.log(`[+page.svelte handleSeekEnd] Calling audioEngine.seek(${seekTime.toFixed(3)}).`);
		audioEngine.seek(seekTime);
        isSeeking = false; // Reset seeking flag FIRST.
        console.log(`[+page.svelte handleSeekEnd] Set isSeeking=false.`);
		if (wasPlayingBeforeSeek) {
            console.log('[+page.svelte handleSeekEnd] Condition wasPlayingBeforeSeek is true. Calling audioEngine.play().');
			audioEngine.play();
		}
        wasPlayingBeforeSeek = false; // Reset flag
        console.log(`[+page.svelte handleSeekEnd] Set wasPlayingBeforeSeek=false. Method complete.`);
	}
    // --- END SEEK LOGIC ---

    // --- DRAG-AND-DROP HANDLERS ---
    function handleDragOver(e: DragEvent) {
        e.preventDefault();
        isDragOver = true;
    }
    function handleDragLeave(e: DragEvent) {
        e.preventDefault();
        isDragOver = false;
    }
    function handleDrop(e: DragEvent) {
        e.preventDefault();
        isDragOver = false;
        if (e.dataTransfer?.files.length) {
            const file = e.dataTransfer.files[0];
            orchestrator.loadFromFile(file, data.player);
        }
    }

    onMount(() => {
        orchestrator = AudioOrchestrator.getInstance();
        orchestrator.setupUrlSerialization();

        const unsubscribeStatus = statusStore.subscribe(currentStatus => {
            if (currentStatus.type === 'error' && currentStatus.message) {
                toast.error(currentStatus.message);
            }
        });

        // --- AUTO-LOAD FROM URL ---
        if (data.player?.sourceUrl) {
            orchestrator.loadFromUrl(data.player.sourceUrl, data.player);
        }

        return () => {
            unsubscribeStatus();
            console.log("Main page unmounted.");
        };
    });
</script>

<Toaster richColors position="top-right" />

<!-- Main container with new drag-and-drop event handlers -->
<div
    role="region"
    aria-label="Drop zone for audio files"
    class="container mx-auto p-4 max-w-4xl space-y-8 transition-all"
    class:outline-dashed={isDragOver}
    class:outline-2={isDragOver}
    class:outline-offset-8={isDragOver}
    class:outline-primary-500={isDragOver}
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:drop={handleDrop}
>
    <header class="mb-6 text-center pointer-events-none"> <!-- pointer-events-none to prevent interfering with drop -->
        <h1 class="text-4xl font-bold text-primary-600 dark:text-primary-400" data-testid="app-bar-title">Vibe Player</h1>
        <p class="text-gray-600 dark:text-gray-400">Refactored Audio Analysis & Playback</p>
    </header>

    <section id="file-loader" class="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
        <!-- New event handlers for load and load-url -->
        <FileLoader
            on:load={(e) => orchestrator.loadFromFile(e.detail.file, data.player)}
            on:load-url={(e) => orchestrator.loadFromUrl(e.detail.url, data.player)}
        />
    </section>

    <section id="player-main" class="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg space-y-4">
        {#if $playerStore.fileName}
            <div class="text-center">
                <p class="text-sm text-gray-500 dark:text-gray-400">Now Playing:</p>
                <h2 class="text-xl font-semibold text-gray-700 dark:text-gray-300" data-testid="file-name-display">{$playerStore.fileName}</h2>
            </div>
        {/if}

        <div class="text-center font-mono text-lg text-gray-700 dark:text-gray-300" data-testid="time-display">
            {formatTime($timeStore)} / {formatTime($playerStore.duration)}
        </div>
        <RangeSlider
            name="seek"
            bind:value={seekTime}
            max={$playerStore.duration > 0 ? $playerStore.duration : 1}
            step="any"
            on:mousedown={handleSeekStart}
            on:touchstart={handleSeekStart}
            on:input={handleSeekInput}
            on:mouseup={handleSeekEnd}
            on:touchend={handleSeekEnd}
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
</style>