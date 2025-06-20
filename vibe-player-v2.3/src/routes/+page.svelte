<!-- vibe-player-v2.3/src/routes/+page.svelte -->
    <script lang="ts">
        import { onMount, onDestroy } from 'svelte';
        import { get } from 'svelte/store';
        import { Toaster } from 'svelte-sonner';
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

        // Simplified seek handler
        function handleSeek(event: MouseEvent | TouchEvent) {
            const slider = event.currentTarget as HTMLInputElement;
            const rect = slider.getBoundingClientRect();
            let clientX: number;
            if (window.TouchEvent && event instanceof TouchEvent && event.changedTouches && event.changedTouches.length > 0) {
                clientX = event.changedTouches[0].clientX;
            } else {
                clientX = (event as MouseEvent).clientX;
            }
            const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            const newTime = percent * get(playerStore).duration;
            audioEngine.seek(newTime);
        }

        onMount(() => {
            const orchestrator = AudioOrchestrator.getInstance();
            orchestrator.setupUrlSerialization();

            // Attempt to read initial state from URL if parameters are present
            // This is a basic example; a more robust solution might involve a dedicated URL parsing service
            // and more sophisticated state hydration logic.
            const currentHash = window.location.hash.substring(1);
            if (currentHash) {
                // This is where you might parse the hash and apply initial settings
                // For now, we assume setupUrlSerialization and other initial loads handle it.
                // orchestrator.hydrateStateFromUrl(currentHash); // If such a method existed
            }

            return () => {
                // audioEngine.dispose(); // dispose is not part of the provided audioEngine interface in the issue
                // If other services had dispose methods, they would be called here.
                // e.g. dtmfService.dispose(), spectrogramService.dispose()
                console.log("Main page unmounted. AudioEngine dispose would be called here if available.");
            };
        });
    </script>

<Toaster/>

<div class="container mx-auto p-4 max-w-4xl">
    <header class="mb-6 text-center">
        <h1 class="text-4xl font-bold text-primary" data-testid="app-bar-title">Vibe Player V2</h1>
        <p class="text-muted-foreground">Experimental Audio Analysis & Playback</p>
    </header>

    <section id="file-loader" class="mb-8 p-6 bg-card rounded-lg shadow">
        <FileLoader/>
    </section>

    <section class="mb-8 p-6 bg-card rounded-lg shadow">
        <div class="text-center font-mono text-lg" data-testid="time-display">
            {formatTime($timeStore)} / {formatTime($playerStore.duration)}
        </div>
        <RangeSlider
            name="seek"
            bind:value={$timeStore}
            max={$playerStore.duration || 1}
            step="any"
            on:click={handleSeek} /* Changed from on:input and on:mousedown/on:touchstart */
            disabled={!$playerStore.isPlayable}
            data-testid="seek-slider-input"
        />
    </section>

    <section id="controls" class="mb-8 p-6 bg-card rounded-lg shadow">
        <Controls/>
    </section>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <section id="waveform" class="p-6 bg-card rounded-lg shadow">
            <h2 class="text-2xl font-semibold mb-4 text-center text-primary">Waveform</h2>
            <Waveform/>
        </section>

        <section id="tone-display" class="p-6 bg-card rounded-lg shadow">
            <h2 class="text-2xl font-semibold mb-4 text-center text-primary">Tone Activity</h2>
            <ToneDisplay/>
        </section>
    </div>

    <section id="spectrogram" class="p-6 bg-card rounded-lg shadow">
        <h2 class="text-2xl font-semibold mb-4 text-center text-primary">Spectrogram</h2>
        <Spectrogram/>
    </section>

    <footer class="mt-12 text-center text-sm text-muted-foreground">
        <p>Vibe Player V2 written mostly by Gemini and Jules</p>
    </footer>
</div>