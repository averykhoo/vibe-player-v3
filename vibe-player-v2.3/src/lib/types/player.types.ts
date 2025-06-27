// vibe-player-v2.3/src/lib/types/player.types.ts
export interface PlayerState {
  status: string;
  fileName: string | null;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  isPlayable: boolean;
  speed: number;
  pitchShift: number;
  gain: number;
  sourceUrl?: string | null; // <-- ADD THIS
  waveformData?: number[][];
  jumpSeconds: number; // <-- ADD THIS LINE
  error: string | null;
  audioBuffer?: AudioBuffer;
  audioContextResumed?: boolean;
  channels?: number;
  sampleRate?: number;
  lastProcessedChunk?: any; // TODO: Refine this type later
}
