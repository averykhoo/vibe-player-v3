export interface PlayerState {
  status: string;
  fileName: string | null;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  isPlayable: boolean;
  speed: number;
  pitch: number;
  gain: number;
  waveformData?: number[][];
  error: string | null;
  audioBuffer?: AudioBuffer;
  audioContextResumed?: boolean;
  channels?: number;
  sampleRate?: number;
  lastProcessedChunk?: any; // TODO: Refine this type later
}
