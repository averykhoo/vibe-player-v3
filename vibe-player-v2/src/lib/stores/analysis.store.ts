// vibe-player-v2/src/lib/stores/analysis.store.ts
import { writable } from "svelte/store";
import type { AnalysisState } from "$lib/types/analysis.types";

const initialState: AnalysisState = {
  vadStatus: undefined,
  lastVadResult: null,
  isSpeaking: undefined,
  vadStateResetted: undefined,
  vadError: null,
  vadInitialized: false,
  vadPositiveThreshold: 0.5, // Default value
  vadNegativeThreshold: 0.35, // Default value

  spectrogramStatus: undefined,
  spectrogramError: null,
  spectrogramData: null,
  spectrogramInitialized: false,

  isLoading: false,
};

export const analysisStore = writable<AnalysisState>(initialState);
