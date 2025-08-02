// vibe-player-v3/src/lib/types/spectrogram.d.ts
export interface ISpectrogramPort {
  generateFFTData(buffer: AudioBuffer): Promise<void>;
  getSpectrogramData(): Float32Array[] | null;
}