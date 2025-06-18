<!-- vibe-player-v2/src/routes/+page.svelte -->
<script lang="ts">
    /**
     * @file Main page component for Vibe Player V2.
     * @description This component serves as the main entry point for the application. It orchestrates
     * the initialization and disposal of various services (audio engine, analysis services) and
     * manages the primary UI layout. It also contains the logic for serializing application
     * state (like playback speed and VAD thresholds) to the URL for sharing.
     */
	import { onMount, onDestroy } from 'svelte';
    import {get} from 'svelte/store';
    import {Toaster} from 'svelte-sonner';
    import {RangeSlider} from '@skeletonlabs/skeleton'; // <-- ADD THIS IMPORT
    // Components
    import Controls from '$lib/components/Controls.svelte';
    import FileLoader from '$lib/components/FileLoader.svelte';
    import ToneDisplay from '$lib/components/ToneDisplay.svelte';
    import Waveform from '$lib/components/visualizers/Waveform.svelte';
    import Spectrogram from '$lib/components/visualizers/Spectrogram.svelte';

    // Services and Stores
    import audioEngineService from '$lib/services/audioEngine.service';
    import analysisService from '$lib/services/analysis.service';
    import dtmfService from '$lib/services/dtmf.service';
    import spectrogramService from '$lib/services/spectrogram.service';
	import { URL_HASH_KEYS, UI_CONSTANTS } from '$lib/utils/constants'; // VAD_CONSTANTS removed
    import {playerStore} from '$lib/stores/player.store';
    import {analysisStore} from '$lib/stores/analysis.store';
    import { AudioOrchestrator } from '$lib/services/AudioOrchestrator.service';
    import {formatTime} from '$lib/utils/formatters';
    // import {debounce, updateUrlWithParams} from '$lib/utils'; // No longer needed here

    onMount(() => {
        console.log('[+page.svelte] onMount: Initializing AudioOrchestrator.');

        // Initialize AudioOrchestrator and its URL handling capabilities
        const audioOrchestrator = AudioOrchestrator.getInstance(); // Ensure this is imported
        audioOrchestrator.setupUrlSerialization();

        // Original keydown handler can remain if needed for global shortcuts
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code === 'Space') {
                event.preventDefault();
                // Play/pause logic here if not handled within Controls component
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        // Cleanup function
        return () => {
            console.log('Disposing all services onDestroy...');
            window.removeEventListener('keydown', handleKeyDown);

            // Dispose all services when the component is destroyed.
            audioEngineService.dispose();
            analysisService.dispose(); // Keep for now
            dtmfService.dispose(); // Keep for now
            spectrogramService.dispose(); // Keep for now
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
            {formatTime($playerStore.currentTime)} / {formatTime($playerStore.duration)}
        </div>
        <RangeSlider
                name="seek"
                bind:value={$playerStore.currentTime}
                max={$playerStore.duration || 1}
                step="any"
                on:input={(e) => audioEngineService.updateSeek(e.currentTarget.valueAsNumber)}
                on:mousedown={audioEngineService.startSeek}
                on:mouseup={(e) => audioEngineService.endSeek(e.currentTarget.valueAsNumber)}
                on:touchstart={audioEngineService.startSeek}
                on:touchend={(e) => audioEngineService.endSeek(e.currentTarget.valueAsNumber)}
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