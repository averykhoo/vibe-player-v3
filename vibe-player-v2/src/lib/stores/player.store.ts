// vibe-player-v2/src/lib/stores/player.store.ts
import { writable } from "svelte/store";
import type { PlayerState } from "$lib/types/player.types";
// import { updateUrlWithParams } from "../utils/urlState"; // No longer used in this file
// import { debounce } from "../utils/async"; // No longer used in this file

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

// Self-subscription logic for URL serialization has been removed.
// This responsibility is now handled by AudioOrchestrator.service.ts,
// which listens to this store (and others) to update URL parameters.
