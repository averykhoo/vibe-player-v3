// vibe-player-v2/src/lib/utils/formatters.ts
export function formatTime(sec: number): string {
    if (isNaN(sec) || sec < 0) sec = 0;
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    return `${minutes}:${seconds < 10 ? "0" + seconds : seconds}`;
}
