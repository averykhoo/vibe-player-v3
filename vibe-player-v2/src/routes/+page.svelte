<!-- vibe-player-v2/src/routes/+page.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Toaster } from 'svelte-sonner';

  // Components
  import Controls from '$lib/components/Controls.svelte';
  import FileLoader from '$lib/components/FileLoader.svelte';
  import ToneDisplay from '$lib/components/ToneDisplay.svelte';
  import Waveform from '$lib/components/visualizers/Waveform.svelte';
  import Spectrogram from '$lib/components/visualizers/Spectrogram.svelte';

  // --- START of CHANGE ---
  // Import all services that need initialization
  import audioEngineService from '$lib/services/audioEngine.service';
  import analysisService from '$lib/services/analysis.service';
  import dtmfService from '$lib/services/dtmf.service';
  import spectrogramService from '$lib/services/spectrogram.service';
  import { VAD_CONSTANTS } from '$lib/utils/constants';
  import { playerStore } from '$lib/stores/player.store';
  import { get } from 'svelte/store';
  // --- END of CHANGE ---

  onMount(() => {
    // --- START of CHANGE ---
    // Initialize all services eagerly when the application component mounts.
    // This is the most robust approach to ensure everything is ready.
    console.log('Initializing all services onMount...');

    // Initialize the audio engine, which prepares the Rubberband worker.
    audioEngineService.initialize();

    // Initialize the analysis service, which prepares the SileroVAD worker.
    analysisService.initialize();

    // Initialize the DTMF service and its worker.
    dtmfService.initialize(VAD_CONSTANTS.SAMPLE_RATE);

    // Subscribe to the playerStore to initialize the spectrogram service
    // once an audio file's sample rate is known.
    const unsub = playerStore.subscribe(state => {
      // Initialize the spectrogram service as soon as we have a sample rate.
      // This will happen after the first file is loaded.
      if (state.sampleRate && !get(analysisStore).spectrogramInitialized) {
        console.log(`Initializing spectrogram service with sample rate: ${state.sampleRate}`);
        spectrogramService.initialize({ sampleRate: state.sampleRate });
      }
    });
    // --- END of CHANGE ---

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

      // --- START of CHANGE ---
      // Dispose all services when the component is destroyed.
      audioEngineService.dispose();
      analysisService.dispose();
      dtmfService.dispose();
      spectrogramService.dispose();
      unsub(); // Unsubscribe from the player store
      // --- END of CHANGE ---
    };
  });
</script>

<Toaster />

<div class="container mx-auto p-4 max-w-4xl">
  <header class="mb-6 text-center">
    <h1 class="text-4xl font-bold text-primary">Vibe Player V2</h1>
    <p class="text-muted-foreground">Experimental Audio Analysis & Playback</p>
  </header>

  <section id="file-loader" class="mb-8 p-6 bg-card rounded-lg shadow">
    <FileLoader />
  </section>

  <section id="controls" class="mb-8 p-6 bg-card rounded-lg shadow">
    <Controls />
  </section>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
    <section id="waveform" class="p-6 bg-card rounded-lg shadow">
      <h2 class="text-2xl font-semibold mb-4 text-center text-primary">Waveform</h2>
      <Waveform />
    </section>

    <section id="tone-display" class="p-6 bg-card rounded-lg shadow">
      <h2 class="text-2xl font-semibold mb-4 text-center text-primary">Tone Activity</h2>
      <ToneDisplay />
    </section>
  </div>

  <section id="spectrogram" class="p-6 bg-card rounded-lg shadow">
    <h2 class="text-2xl font-semibold mb-4 text-center text-primary">Spectrogram</h2>
    <Spectrogram />
  </section>

  <footer class="mt-12 text-center text-sm text-muted-foreground">
    <p>&copy; 2024 Vibe Player V2. All rights reserved.</p>
  </footer>
</div>