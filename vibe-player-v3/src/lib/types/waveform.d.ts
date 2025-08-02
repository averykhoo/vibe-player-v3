// vibe-player-v3/src/lib/types/waveform.d.ts
export interface IWaveformPort {
  generatePeakData(buffer: AudioBuffer): Promise<void>;
  getWaveformData(): number[][] | null;
}