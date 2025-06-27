// vibe-player-v2.3/src/lib/types/analysis.types.ts
import type { SileroVadProcessResultPayload } from "$lib/types/worker.types";

export interface VadRegion {
  start: number;
  end: number;
}

export interface AnalysisState {
  // VAD related properties
  vadStatus?: string;
  lastVadResult?: SileroVadProcessResultPayload | null;
  isSpeaking?: boolean;
  vadStateResetted?: boolean;
  vadError?: string | null;
  vadInitialized?: boolean;
  vadPositiveThreshold: number; // Changed to non-optional
  vadNegativeThreshold: number; // Changed to non-optional
  vadProbabilities: Float32Array | null; // <-- ADD
  vadRegions: VadRegion[] | null; // <-- ADD

  // Spectrogram related properties
  spectrogramStatus?: string; // e.g., "Spectrogram worker initializing..."
  spectrogramError?: string | null;
  spectrogramData?: number[][] | null; // Assuming magnitudes from SpectrogramResultPayload are number[][]
  spectrogramInitialized?: boolean; // To track Spectrogram worker initialization

  // General analysis properties
  isLoading?: boolean; // For general loading states within the analysis domain
}
