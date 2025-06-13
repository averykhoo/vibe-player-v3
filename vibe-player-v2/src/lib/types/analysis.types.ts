import type { SileroVadProcessResultPayload, SpectrogramResultPayload } from '$lib/types/worker.types';

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
  spectrogramData?: number[][] | null; // Assuming magnitudes from SpectrogramResultPayload are number[][]
  spectrogramInitialized?: boolean; // To track Spectrogram worker initialization

  // General analysis properties
  isLoading?: boolean; // For general loading states within the analysis domain
}
