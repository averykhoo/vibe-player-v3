<!-- vibe-player-v2.0/src/lib/components/__mocks__/RangeSlider.svelte -->
<script>
  // Mock RangeSlider
  export let value = 0;
  export let name = ''; // This will be used as the ID for the label's 'for' attribute
  export let min = 0;
  export let max = 100;
  export let step = 1;
  // Add any other props your component might expect
  // Use the 'name' prop also as 'id' to match <label for="...">
  const id = name;
</script>

<input type="range" class="mock-range-slider" {id} {name} bind:value {min} {max} {step} on:input on:change />
