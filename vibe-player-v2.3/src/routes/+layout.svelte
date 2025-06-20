<!-- vibe-player-v2.3/src/routes/+layout.svelte -->
<script lang="ts">
  import "../app.css";
  // Assuming use of Skeleton UI's AppBar component for the header
  import { AppBar } from '@skeletonlabs/skeleton';
</script>

<AppBar>
  <svelte:fragment slot="lead">
    <strong class="text-xl uppercase">Vibe Player V2</strong>
  </svelte:fragment>
  <svelte:fragment slot="trail">
    <!-- Other nav elements could go here -->
    <a href="https://github.com/averykhoo/vibe-player" target="_blank" rel="noopener noreferrer" class="btn btn-sm variant-ghost-surface">GitHub</a>
  </svelte:fragment>
</AppBar>

<!-- Main content slot -->
<main class="p-4">
  <slot />
</main>
