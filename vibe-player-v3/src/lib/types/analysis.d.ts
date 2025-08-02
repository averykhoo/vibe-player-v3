// vibe-player-v3/src/lib/types/analysis.d.ts
export interface IAnalysisPort {
  startAnalysis(buffer: AudioBuffer): Promise<void>;
  recalculateRegions(params: { vadPositive: number; vadNegative: number }): void;
  getVadProbabilities(): Float32Array | null;
}