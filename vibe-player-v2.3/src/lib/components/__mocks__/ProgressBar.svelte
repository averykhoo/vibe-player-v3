<!-- vibe-player-v2.3/src/lib/components/__mocks__/ProgressBar.svelte -->
<script lang="ts">
  // Minimal mock for ProgressBar.svelte
  export let value: number | undefined = undefined;
  export let max: number = 100;
  // Add any other props that might be minimally required if type checking is strict
</script>

<div data-testid="mock-progress-bar" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
  <!-- Mock content -->
</div>
