<!-- vibe-player-v2/src/lib/components/ToneDisplay.svelte -->
<script lang="ts">
  import { dtmfStore } from '$lib/stores/dtmf.store';
</script>

<div class="card p-4 space-y-4">
  <h3 class="h3">Detected Tones</h3>
  <div>
    <h4 class="font-bold">DTMF (Dial Tones):</h4>
    {#if $dtmfStore.status === 'processing'}
      <p class="text-sm text-surface-500">Processing...</p>
    {:else if $dtmfStore.dtmf.length > 0}
  <!-- *** ADD data-testid HERE *** -->
  <p data-testid="dtmf-display" class="font-mono text-lg p-2 bg-surface-100 dark:bg-surface-800 rounded">
        {$dtmfStore.dtmf.join(' ')}
      </p>
    {:else}
      <p class="text-sm text-surface-500">None detected.</p>
    {/if}
  </div>
  <!-- You would add a similar block for CPTs here -->
</div>
