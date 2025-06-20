<!-- vibe-player-v2.3/src/lib/components/__mocks__/Button.svelte -->
<script>
  // Mock Button
  export let color = 'primary'; // Example prop
  // Add any other props your component might expect to avoid runtime warnings/errors
</script>

<button class="mock-button btn variant-filled-{color}" on:click>
  <slot />
</button>
