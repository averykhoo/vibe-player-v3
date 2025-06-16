<!-- vibe-player-v2/src/routes/+page.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
  import { Toaster } from 'svelte-sonner';
	import { RangeSlider } from '@skeletonlabs/skeleton'; // <-- ADD THIS IMPORT

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
  import { VAD_CONSTANTS } from '$lib/utils/constants';
  import { playerStore } from '$lib/stores/player.store';
	import { analysisStore } from '$lib/stores/analysis.store'; // analysisStore is needed
	import { formatTime } from '$lib/utils/formatters'; // <-- ADD THIS IMPORT

	// --- NEW: Function to handle seeking ---
	function handleSeek(event: Event) {
		const target = event.target as HTMLInputElement;
		const time = parseFloat(target.value);
		// --- ADD THIS GUARD ---
		if (!isNaN(time)) {
			audioEngineService.seek(time);
		} else {
			console.warn("handleSeek received a non-numeric value:", target.value);
		}
		// --- END GUARD ---
	}

  onMount(() => {
    // Initialize all services eagerly when the application component mounts.
    // This is the most robust approach to ensure everything is ready.
    console.log('Initializing all services onMount...');

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
      analysisService.dispose();
      dtmfService.dispose();
      spectrogramService.dispose();
      unsub(); // Unsubscribe from the player store
    };
  });
</script>

<Toaster />

<div class="container mx-auto p-4 max-w-4xl">
  <header class="mb-6 text-center">
		<h1 class="text-4xl font-bold text-primary" data-testid="app-bar-title">Vibe Player V2</h1>
    <p class="text-muted-foreground">Experimental Audio Analysis & Playback</p>
  </header>

  <section id="file-loader" class="mb-8 p-6 bg-card rounded-lg shadow">
    <FileLoader />
  </section>

	<section class="mb-8 p-6 bg-card rounded-lg shadow">
		<div class="text-center font-mono text-lg" data-testid="time-display">
			{formatTime($playerStore.currentTime)} / {formatTime($playerStore.duration)}
		</div>
		<RangeSlider
			name="seek"
			bind:value={$playerStore.currentTime}
			max={$playerStore.duration || 1}
			on:input={handleSeek}
			disabled={!$playerStore.isPlayable}
			data-testid="seek-slider-input"
		/>
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
    <p>Vibe Player V2 written mostly by Gemini and Jules</p>
  </footer>
</div>