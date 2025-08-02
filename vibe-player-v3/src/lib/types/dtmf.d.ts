// vibe-player-v3/src/lib/types/dtmf.d.ts
export interface IDtmfPort {
  startAnalysis(buffer: AudioBuffer): Promise<void>;
}