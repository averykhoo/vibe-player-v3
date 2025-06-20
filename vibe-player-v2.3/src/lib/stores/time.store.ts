// vibe-player-v2.3/src/lib/stores/time.store.ts
import { writable } from 'svelte/store';

/**
 * A "hot" store that is updated on every animation frame during playback.
 * It only holds the current time to minimize component re-renders.
 * Components that display the current time or seek bar position should subscribe to this.
 */
export const timeStore = writable(0);
