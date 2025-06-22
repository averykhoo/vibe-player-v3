<!-- vibe-player-v2.3/src/lib/components/__mocks__/RangeSlider.svelte -->
<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte'; // 1. Import createEventDispatcher & onMount

  const dispatch = createEventDispatcher(); // 2. Instantiate the dispatcher

  // Props
  export let value: number = 0;
  export let name: string = '';
  export let min: number = 0;
  export let max: number = 100;
  export let step: number = 1;
  export let disabled: boolean = false;

  const id = name; // Usually, id should be unique, using name might not be ideal if name isn't unique.
                  // For a mock, this might be acceptable if 'name' is used as a unique identifier in tests.

  // Capture any other props passed to the component, like data-testid
  const { value: _v, name: _n, min: _min, max: _max, step: _s, disabled: _d, id: _id_prop, ...restProps } = $$props;

  // --- LOGGING ---
  console.log(`[Mock RangeSlider ${name || '(no name)'}] CREATED/MOUNTED. Initial props - value: ${value}, min: ${min}, max: ${max}, step: ${step}, disabled: ${disabled}`);

  $: console.log(`[Mock RangeSlider ${name || '(no name)'}] PROPS UPDATE - value: ${value}, min: ${min}, max: ${max}, step: ${step}, disabled: ${disabled}`);

  // 3. Define handler functions to dispatch Svelte events
  function handleNativeMouseDown(event: MouseEvent) {
    console.log(`[Mock RangeSlider ${name || '(no name)'}] NATIVE mousedown event detected. Dispatching 'mousedown' Svelte event.`);
    dispatch('mousedown', event); // Dispatch 'mousedown' Svelte event
  }

  function handleNativeMouseUp(event: MouseEvent) {
    console.log(`[Mock RangeSlider ${name || '(no name)'}] NATIVE mouseup event detected. Dispatching 'mouseup' Svelte event.`);
    dispatch('mouseup', event); // Dispatch 'mouseup' Svelte event
  }

  // Svelte's on:input and on:change on the native <input> will automatically
  // dispatch 'input' and 'change' events from this component if they are listened to.
  // We can add explicit handlers if we need to log or modify the event.
  function handleNativeInput(event: Event) {
    // The 'value' prop is already bound with `bind:value`, so Svelte handles updating it.
    // We dispatch 'input' so that `on:input` on the component instance in `+page.svelte` works as expected.
    // Svelte would do this implicitly for `on:input` on native elements, but being explicit for mocks is good.
    const target = event.target as HTMLInputElement;
    console.log(`[Mock RangeSlider ${name || '(no name)'}] NATIVE input event detected. Current input value: ${target.value}. Dispatching 'input' Svelte event.`);
    dispatch('input', event);
  }

  function handleNativeChange(event: Event) {
    const target = event.target as HTMLInputElement;
    console.log(`[Mock RangeSlider ${name || '(no name)'}] NATIVE change event detected. Current input value: ${target.value}. Dispatching 'change' Svelte event.`);
    dispatch('change', event);
  }

</script>

<input
  type="range"
  class="mock-range-slider"
  {id}
  {name}
  bind:value <!-- This handles two-way binding for the 'value' prop -->
  {min}
  {max}
  {step}
  {disabled}
  on:input={handleNativeInput}   <!-- Explicitly handle native input to log & re-dispatch -->
  on:change={handleNativeChange} <!-- Explicitly handle native change to log & re-dispatch -->
  on:mousedown={handleNativeMouseDown} <!-- 4. Call native mousedown handler -->
  on:mouseup={handleNativeMouseUp}   <!-- 5. Call native mouseup handler -->
  {...restProps}
/>