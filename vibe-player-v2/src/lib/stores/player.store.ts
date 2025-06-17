// vibe-player-v2/src/lib/stores/player.store.ts
import { writable } from "svelte/store";
import type { PlayerState } from "$lib/types/player.types";
import { updateUrlWithParams } from "../utils/urlState";
import { debounce } from "../utils/async";

const initialState: PlayerState = {
  status: "idle",
  fileName: null,
  duration: 0,
  currentTime: 0,
  isPlaying: false,
  isPlayable: false,
  speed: 1.0,
  pitch: 0.0,
  gain: 1.0,
  waveformData: undefined,
  error: null,
  audioBuffer: undefined,
  audioContextResumed: false,
  channels: undefined,
  sampleRate: undefined,
  lastProcessedChunk: undefined,
};

export const playerStore = writable<PlayerState>(initialState);

let previousSpeed: number | undefined = initialState.speed;
let previousPitch: number | undefined = initialState.pitch;
let previousGain: number | undefined = initialState.gain;

const debouncedUpdateUrl = debounce((params: Record<string, string>) => {
  updateUrlWithParams(params);
}, 300);

playerStore.subscribe((currentState) => {
  const params: Record<string, string> = {};
  let changed = false;

  if (currentState.speed !== previousSpeed) {
    if (
      currentState.speed !== undefined &&
      currentState.speed !== initialState.speed
    ) {
      params.speed = currentState.speed.toFixed(2);
    }
    previousSpeed = currentState.speed;
    changed = true;
  }

  if (currentState.pitch !== previousPitch) {
    if (
      currentState.pitch !== undefined &&
      currentState.pitch !== initialState.pitch
    ) {
      params.pitch = currentState.pitch.toFixed(2);
    }
    previousPitch = currentState.pitch;
    changed = true;
  }

  if (currentState.gain !== previousGain) {
    if (
      currentState.gain !== undefined &&
      currentState.gain !== initialState.gain
    ) {
      params.gain = currentState.gain.toFixed(2);
    }
    previousGain = currentState.gain;
    changed = true;
  }

  if (changed && Object.keys(params).length > 0) {
    debouncedUpdateUrl(params);
  } else if (changed && Object.keys(params).length === 0) {
    // If all values returned to default, clear them from URL
    // This depends on how updateUrlWithParams handles empty strings or undefined for existing params.
    // Assuming it can remove params if not present in the new call,
    // or we might need a specific function to remove params.
    // For now, let's test how it behaves or if specific removal is needed.
    // updateUrlWithParams({}); // This might clear all, or do nothing.
    // For now, let's ensure we update with defaults if that's the requirement or remove if not.
    // The tests imply non-default values are added and stay.
    // "speed=1.50" and "pitch=2.0" then "speed=1.50&pitch=2.0"
    // This means we should only add/update parameters, not remove them if they go back to default.
    // However, the prompt says "If a setting is at its default value, it can be omitted from the URL params"
    // Let's try to form params only with non-default values.
    // The current logic for adding to `params` object already handles this:
    // it only adds if ` !== initialState.speed` etc.

    // If params became empty because all values returned to default,
    // we might want to call updateUrlWithParams with an empty object
    // to signify that all relevant params should be cleared.
    // Or, if `updateUrlWithParams` is smart, it might remove params not specified.
    // Let's assume `updateUrlWithParams` can handle this.
    // If no non-default params are left, we might want to clear them.
    // The existing tests `should load settings from URL parameters on page load` also uses `speed=1.75&pitch=-3`
    // The most direct interpretation is: if a value is non-default, put it in URL. If it's default, it shouldn't be in URL.
    // So, if all values revert to default, `params` will be empty.
    // We need to decide if `updateUrlWithParams({})` clears existing URL params or if we need to explicitly list them as undefined.
    // For now, the logic is: if `params` is empty, but there *was* a change (meaning something went to default),
    // we potentially need to clear those specific parameters from the URL.
    // Let's refine `updateUrlWithParams` to clear params that are not provided.
    // The current logic is fine: params will only contain non-default values.
    // If all values are default, params will be empty. `updateUrlWithParams({})` should then be called.
    // This is what `updateUrlWithParams` is designed for.
    // If `params` is empty after checking all conditions, and `changed` is true,
    // it means all parameters were reset to their default values.
    // In this scenario, we should call `updateUrlWithParams` with an empty object
    // to clear these parameters from the URL.
    debouncedUpdateUrl({});
  }
});
