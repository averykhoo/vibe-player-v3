<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import FileLoader from '$lib/components/FileLoader.svelte';
  import Controls from '$lib/components/Controls.svelte';
  import Waveform from '$lib/components/visualizers/Waveform.svelte';
  import Spectrogram from '$lib/components/visualizers/Spectrogram.svelte';
  import { playerStore } from '$lib/stores/player.store';
  import audioEngineService from '$lib/services/audioEngine.service';
  import analysisService from '$lib/services/analysis.service';
  import spectrogramService from '$lib/services/spectrogram.service';

  onMount(() => {
    console.log('[+page.svelte onMount] Initializing services...');
    // Initialize services with default parameters.
    // They will now be ready before any file is loaded.
    audioEngineService.initialize({
      sampleRate: 44100, // A default, can be re-initialized later if needed
      channels: 1,
      initialSpeed: 1.0,
      initialPitch: 0.0,
    });
    analysisService.initialize();
    console.log('[+page.svelte onMount] Services initialization called.');

    // Cleanup services when the component is destroyed
    return () => {
      console.log('[+page.svelte onDestroy] Disposing services...');
      audioEngineService.dispose();
      analysisService.dispose();
      spectrogramService.dispose();
      console.log('[+page.svelte onDestroy] Services disposed.');
    };
  });

  // Reactive statement to trigger spectrogram processing when a file is loaded and playable
  $: if ($playerStore.isPlayable && $playerStore.audioBuffer) {
    console.log('[+page.svelte reactive] isPlayable is true, starting background analysis.');
    // analysisService.startSpectrogramProcessing($playerStore.audioBuffer); // Old way
    const processSpectrogram = async () => {
      if (!$playerStore.audioBuffer) return;
      try {
        console.log('[+page.svelte] Initializing spectrogram service with sample rate:', $playerStore.audioBuffer.sampleRate);
        await spectrogramService.initialize({ sampleRate: $playerStore.audioBuffer.sampleRate });

        const pcmData = $playerStore.audioBuffer.getChannelData(0); // Assuming mono
        if (pcmData && pcmData.length > 0) {
          console.log('[+page.svelte] Processing PCM data for spectrogram...');
          await spectrogramService.process(pcmData);
          console.log('[+page.svelte] Spectrogram processing initiated.');
        } else {
          console.warn('[+page.svelte] No PCM data found in audioBuffer or data is empty.');
        }
      } catch (error) {
        console.error('[+page.svelte] Error during spectrogram processing:', error);
      }
    };
    processSpectrogram();
  }
</script>

<div class="container mx-auto p-4 space-y-4">
  <header>
    <h1 class="h1 font-bold" data-testid="app-bar-title">Vibe Player V2</h1>
  </header>

  <main class="space-y-4">
    <FileLoader />

    {#if $playerStore.isPlayable}
      <Controls />
      <Waveform />
      <Spectrogram />
    {:else}
      <div class="text-center p-8 bg-neutral-100 dark:bg-neutral-800 rounded-lg">
        <p class="text-lg text-neutral-500">
          Load an audio file to begin analysis.
        </p>
      </div>
    {/if}
  </main>
</div>