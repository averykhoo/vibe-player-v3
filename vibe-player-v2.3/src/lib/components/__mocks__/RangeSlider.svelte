<!-- vibe-player-v2.3/src/lib/components/__mocks__/RangeSlider.svelte -->
<script lang="ts">
  // Mock RangeSlider
  export let value: number = 0;
  export let name: string = ''; // This will be used as the ID for the label's 'for' attribute
  export let min: number = 0;
  export let max: number = 100;
  export let step: number = 1;
  export let disabled: boolean = false; // Explicitly declare the disabled prop

  // Use the 'name' prop also as 'id' to match <label for="...">
  const id = name;

  // Capture any other props passed to the component, like data-testid
  // We need to filter out the props we've explicitly declared to avoid conflicts if they are also in $$props
  const { value: _v, name: _n, min: _min, max: _max, step: _s, disabled: _d, id: _id, ...restProps } = $$props;
</script>

<input
  type="range"
  class="mock-range-slider"
  {id}
  {name}
  bind:value
  {min}
  {max}
  {step}
  {disabled}
  on:input
  on:change
  {...restProps}
/>
