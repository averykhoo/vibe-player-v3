// vibe-player-v2.3/src/lib/stores/player.store.ts
import { writable } from "svelte/store";
import type { PlayerState } from "$lib/types/player.types";

const initialState: PlayerState = {
  status: "idle",
  fileName: null,
  duration: 0,
  currentTime: 0,
  isPlaying: false,
  isPlayable: false,
  speed: 1.0,
  pitchShift: 0.0,
  gain: 1.0,
  jumpSeconds: 5, // <-- ADD THIS LINE
  waveformData: undefined,
  error: null,
  audioBuffer: undefined,
  audioContextResumed: false,
  channels: undefined,
  sampleRate: undefined,
  lastProcessedChunk: undefined,
};

export const playerStore = writable<PlayerState>(initialState);

// Self-subscription logic for URL serialization has been removed.
// This responsibility is now handled by AudioOrchestrator.service.ts.
