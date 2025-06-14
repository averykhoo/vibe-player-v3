<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import FileLoader from '$lib/components/FileLoader.svelte';
  import Controls from '$lib/components/Controls.svelte';
  import Waveform from '$lib/components/visualizers/Waveform.svelte';
  import Spectrogram from '$lib/components/visualizers/Spectrogram.svelte';
  import ToneDisplay from '$lib/components/ToneDisplay.svelte';
  import { playerStore } from '$lib/stores/player.store';

  // Service imports are moved into onMount for SSR safety
  import type { AnalysisService } from '$lib/services/analysis.service';
  import type { DtmfService } from '$lib/services/dtmf.service';
  import type { SpectrogramService } from '$lib/services/spectrogram.service';
  import type { AudioEngineService } from '$lib/services/audioEngine.service';

  // Define local variables to hold the service instances
  let analysisService: AnalysisService;
  let dtmfService: DtmfService;
  let spectrogramService: SpectrogramService;
  let audioEngineService: AudioEngineService;


  onMount(async () => {
    // Dynamically import services only on the client-side
    const audioModule = await import('$lib/services/audioEngine.service');
    audioEngineService = audioModule.default;
    audioEngineService.initialize();

    const analysisModule = await import('$lib/services/analysis.service');
    analysisService = analysisModule.default;
    analysisService.initialize(); // For VAD

    const specModule = await import('$lib/services/spectrogram.service');
    spectrogramService = specModule.default;
    // Note: SpectrogramService init requires sampleRate, which we don't have yet.
    // It will be initialized later when a file is loaded. This is fine.

    const dtmfModule = await import('$lib/services/dtmf.service');
    dtmfService = dtmfModule.default;
    dtmfService.initialize(16000); // Initialize with default DTMF sample rate

    // Cleanup services when the component is destroyed
    return () => {
      console.log('[+page.svelte onDestroy] Disposing services...');
      audioEngineService?.dispose();
      analysisService?.dispose();
      spectrogramService?.dispose();
      dtmfService?.dispose();
      console.log('[+page.svelte onDestroy] Services disposed.');
    };
  });

  // Reactive statement to trigger analysis when a file is ready
  $: if ($playerStore.isPlayable && $playerStore.audioBuffer && audioEngineService && analysisService && spectrogramService && dtmfService) {
    console.log('[+page.svelte reactive] isPlayable is true, starting background analysis.');
    const audioBuffer = $playerStore.audioBuffer; // Capture buffer

    // Spectrogram Processing
    const processSpectrogram = async () => {
      if (!audioBuffer || !spectrogramService) return;
      try {
        console.log('[+page.svelte] Initializing spectrogram service with sample rate:', audioBuffer.sampleRate);
        // Initialize spectrogram service here as we have the sampleRate
        await spectrogramService.initialize({ sampleRate: audioBuffer.sampleRate });

        const pcmData = audioBuffer.getChannelData(0); // Assuming mono
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

    // DTMF Processing
    const processTones = () => {
      if (!audioBuffer || !dtmfService) return;
      try {
        console.log('[+page.svelte] Processing audio for DTMF tones...');
        dtmfService.process(audioBuffer); // audioBuffer is passed, service handles resampling
      } catch (error) {
        console.error('[+page.svelte] Error during DTMF processing:', error);
      }
    };
    processTones();
  }
</script>

<!-- Add a wrapper to prevent UI from showing before services are ready -->
{#if audioEngineService}
  <div class="p-4 space-y-4 max-w-4xl mx-auto">
    <h1 data-testid="app-bar-title" class="text-2xl font-bold">Vibe Player V2</h1>

    <FileLoader />
    <Controls />
    <Waveform />
    <Spectrogram />
    <ToneDisplay />

    <!-- Add other components as needed -->
  </div>
{:else}
  <p>Loading application...</p>
{/if}