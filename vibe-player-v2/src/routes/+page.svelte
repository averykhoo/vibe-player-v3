<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { AppShell, AppBar } from '@skeletonlabs/skeleton';

    // Services
    import audioEngine from '$lib/services/audioEngine.service';
    import analysisService from '$lib/services/analysis.service';
    import { playerStore } from '$lib/stores/player.store';

    // URL State Utilities
    import { loadStateFromUrl, subscribeToStoresForUrlUpdate } from '$lib/utils/urlState';

    // Component Stubs - will be fleshed out later
    import FileLoader from '$lib/components/FileLoader.svelte';
    import Controls from '$lib/components/Controls.svelte';
    import Waveform from '$lib/components/visualizers/Waveform.svelte';
    import Spectrogram from '$lib/components/visualizers/Spectrogram.svelte';

    // Action
    import { sparkles } from '$lib/actions/sparkles.action';

    let unsubscribeUrlState: (() => void) | null = null;

    onMount(async () => {
        // Initialize URL state loading first (though actual store updates happen inside)
        loadStateFromUrl();

        // Initialize services
        // TODO: Define actual default/initial parameters based on constants or app requirements
        try {
            await audioEngine.initialize({
                sampleRate: 44100, // Example, use VAD_CONSTANTS.SAMPLE_RATE or app default
                channels: 1,       // Example
                initialSpeed: 1.0,
                initialPitch: 0.0
            });
            console.log('AudioEngine initialized');
        } catch (e) {
            console.error('Failed to initialize AudioEngine:', e);
        }

        try {
            await analysisService.initialize({
                // positiveThreshold: VAD_CONSTANTS.DEFAULT_POSITIVE_THRESHOLD, // from store or config
                // negativeThreshold: VAD_CONSTANTS.DEFAULT_NEGATIVE_THRESHOLD
            });
            console.log('AnalysisService initialized');
        } catch (e) {
            console.error('Failed to initialize AnalysisService:', e);
        }

        // Subscribe to store changes for URL updates after services are initialized and potentially updated by URL state
        unsubscribeUrlState = subscribeToStoresForUrlUpdate();
    });

    onDestroy(() => {
        audioEngine.dispose();
        analysisService.dispose();
        if (unsubscribeUrlState) {
            unsubscribeUrlState();
        }
        console.log('+page.svelte destroyed, services disposed.');
    });

    $: {
      if ($playerStore.isPlayable && $playerStore.audioBuffer) {
        // A file has been successfully decoded and is ready to play.
        // Now, we can kick off the heavy analysis tasks in the background.
        console.log('UI Layer: isPlayable is true, starting background analysis.');
        analysisService.startSpectrogramProcessing($playerStore.audioBuffer);
      }
    }
</script>

<!-- Base page layout using Skeleton UI -->
<AppShell>
    <svelte:fragment slot="header">
        <AppBar>
            <svelte:fragment slot="lead">
                <strong class="text-xl uppercase">Vibe Player V2</strong>
            </svelte:fragment>
            <svelte:fragment slot="trail">
                <a href="https://github.com/your-repo/vibe-player-v2" target="_blank" rel="noopener noreferrer" class="btn btn-sm variant-ghost-surface">
                    GitHub
                </a>
            </svelte:fragment>
        </AppBar>
    </svelte:fragment>

    <!-- Main content area -->
    <div class="container mx-auto p-4 space-y-4" use:sparkles>
        <section id="file-loader-section">
            <FileLoader />
        </section>

        <section id="controls-section">
            <Controls />
        </section>

        <section id="visualizers-section" class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
                <h2 class="text-lg font-semibold mb-2">Waveform</h2>
                <Waveform />
            </div>
            <div>
                <h2 class="text-lg font-semibold mb-2">Spectrogram</h2>
                <Spectrogram />
            </div>
        </section>

        <!-- You can add more sections here, like a footer -->
    </div>

    <svelte:fragment slot="pageFooter">
        <div class="text-center p-2 text-xs text-gray-500">
            Vibe Player V2 - Refactored with SvelteKit & Skeleton UI
        </div>
    </svelte:fragment>
</AppShell>

<style lang="postcss">
    /* Global styles or component-specific overrides if necessary */
    /* Tailwind directives are usually in app.postcss or a global CSS file imported in +layout.svelte */
</style>
