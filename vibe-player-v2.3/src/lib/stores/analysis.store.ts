// vibe-player-v2.3/src/lib/stores/analysis.store.ts
import { writable } from "svelte/store";
import type { AnalysisState } from "$lib/types/analysis.types";
import { VAD_CONSTANTS } from "$lib/utils/constants";

const initialState: AnalysisState = {
  vadStatus: undefined,
  lastVadResult: null,
  isSpeaking: undefined,
  vadStateResetted: undefined,
  vadError: null,
  vadInitialized: false,
  vadPositiveThreshold: VAD_CONSTANTS.DEFAULT_POSITIVE_THRESHOLD,
  vadNegativeThreshold: VAD_CONSTANTS.DEFAULT_NEGATIVE_THRESHOLD,
  vadProbabilities: null,
  vadRegions: null,

  spectrogramStatus: undefined,
  spectrogramError: null,
  spectrogramData: null,
  spectrogramInitialized: false,

  isLoading: false,
};

export const analysisStore = writable<AnalysisState>(initialState);
