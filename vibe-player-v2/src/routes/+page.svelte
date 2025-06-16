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
  import { VAD_CONSTANTS, URL_HASH_KEYS, UI_CONSTANTS } from '$lib/utils/constants';
  import { playerStore } from '$lib/stores/player.store';
	import { analysisStore } from '$lib/stores/analysis.store';
	import { formatTime } from '$lib/utils/formatters';
  import { debounce, updateUrlWithParams } from '$lib/utils';

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

    // --- URL State Serialization Logic ---
    const serializeStateToUrl = () => {
        const pStore = get(playerStore);
        const aStore = get(analysisStore);

        if (!pStore.isPlayable) return; // Don't serialize if nothing is loaded

        const params: Record<string, string> = {
            [URL_HASH_KEYS.SPEED]: pStore.speed !== 1.0 ? pStore.speed.toFixed(2) : "",
            [URL_HASH_KEYS.PITCH]: pStore.pitch !== 0.0 ? pStore.pitch.toFixed(1) : "",
            [URL_HASH_KEYS.GAIN]: pStore.gain !== 1.0 ? pStore.gain.toFixed(2) : "",
            [URL_HASH_KEYS.VAD_POSITIVE]: aStore.vadPositiveThreshold !== VAD_CONSTANTS.DEFAULT_POSITIVE_THRESHOLD ? aStore.vadPositiveThreshold.toFixed(2) : "",
            [URL_HASH_KEYS.VAD_NEGATIVE]: aStore.vadNegativeThreshold !== VAD_CONSTANTS.DEFAULT_NEGATIVE_THRESHOLD ? aStore.vadNegativeThreshold.toFixed(2) : ""
        };
        updateUrlWithParams(params);
    };

    const debouncedUrlUpdate = debounce(serializeStateToUrl, UI_CONSTANTS.DEBOUNCE_HASH_UPDATE_MS);

    // Subscribe to stores to trigger URL updates
    const unsubPlayer = playerStore.subscribe(debouncedUrlUpdate);
    const unsubAnalysis = analysisStore.subscribe(debouncedUrlUpdate);
    // --- End URL State Serialization Logic ---

    const unsubSpec = playerStore.subscribe(state => {
      if (state.audioBuffer && state.status && state.status.startsWith('Initializing processor')) {
          console.log('New audio buffer detected, triggering DTMF analysis service...');
          dtmfService.process(state.audioBuffer);
      }

      // Initialize spectrogram service if conditions are met.
      // This is independent of the DTMF logic above.
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
      unsubSpec();
      unsubPlayer();
      unsubAnalysis();
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