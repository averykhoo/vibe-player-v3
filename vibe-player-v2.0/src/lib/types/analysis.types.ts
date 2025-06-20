// vibe-player-v2.3/src/lib/types/analysis.types.ts
import type { SileroVadProcessResultPayload } from "$lib/types/worker.types";

export interface AnalysisState {
  // VAD related properties
  vadStatus?: string; // e.g., "VAD service initializing...", "VAD service initialized."
  lastVadResult?: SileroVadProcessResultPayload | null;
  isSpeaking?: boolean;
  vadStateResetted?: boolean;
  vadError?: string | null;
  vadInitialized?: boolean; // To track VAD worker initialization status

  // Spectrogram related properties
  spectrogramStatus?: string; // e.g., "Spectrogram worker initializing..."
  spectrogramError?: string | null;
  // CHANGE THIS LINE:
  spectrogramData?: Float32Array[] | null; // Changed from number[][]
  spectrogramInitialized?: boolean; // To track Spectrogram worker initialization

  // General analysis properties
  isLoading?: boolean; // For general loading states within the analysis domain
}
