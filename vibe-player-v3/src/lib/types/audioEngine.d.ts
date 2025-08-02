// vibe-player-v3/src/lib/types/audioEngine.d.ts
export interface IAudioEnginePort {
  play(): void;
  pause(): void;
  stop(): void;
  seek(time: number): void;
  setSpeed(speed: number): void;
  setPitch(pitchScale: number): void;
  setGain(gain: number): void;
  getAudioBuffer(): AudioBuffer | null;
  decodeAudio(file: File): Promise<AudioBuffer>;
}