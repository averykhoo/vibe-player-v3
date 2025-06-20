// vibe-player-v2.3/src/lib/stores/player.store.ts
import { writable } from "svelte/store";
import type { PlayerState } from "$lib/types/player.types";
import { AUDIO_ENGINE_CONSTANTS } from "$lib/utils";
// import { updateUrlWithParams } from "../utils/urlState"; // No longer needed
// import { debounce } from "../utils/async"; // No longer needed

const initialState: PlayerState = {
  status: "idle",
  fileName: null,
  duration: 0,
  currentTime: 0,
  isPlaying: false,
  isPlayable: false,
  speed: 1.0,
  pitch: 0.0,
  gain: AUDIO_ENGINE_CONSTANTS.DEFAULT_GAIN,
  waveformData: undefined,
  error: null,
  audioBuffer: undefined,
  audioContextResumed: false,
  channels: undefined,
  sampleRate: undefined,
  lastProcessedChunk: undefined,
};

export const playerStore = writable<PlayerState>(initialState);
