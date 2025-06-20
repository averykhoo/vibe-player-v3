// vibe-player-v2.0/src/routes/+page.ts
// src/routes/+page.ts
import { URL_HASH_KEYS } from "$lib/utils/constants";
import type { PageLoad } from "./$types";

/**
 * SvelteKit load function. This runs before the page component is rendered.
 * It's used here to deserialize state from URL parameters, ensuring the values
 * are available to the component on initial load and preventing race conditions.
 */
export const load: PageLoad = ({ url }) => {
  console.log("[+page.ts load] Deserializing state from URL:", url.href);

  const speedStr = url.searchParams.get(URL_HASH_KEYS.SPEED);
  const pitchStr = url.searchParams.get(URL_HASH_KEYS.PITCH);
  const gainStr = url.searchParams.get(URL_HASH_KEYS.GAIN);
  const timeStr = url.searchParams.get(URL_HASH_KEYS.TIME);
  // TODO: Add VAD and other params as needed

  const initialPlayerData = {
    speed: speedStr ? parseFloat(speedStr) : undefined,
    pitch: pitchStr ? parseFloat(pitchStr) : undefined,
    gain: gainStr ? parseFloat(gainStr) : undefined,
    currentTime: timeStr ? parseFloat(timeStr) : undefined,
  };

  console.log("[+page.ts load] Parsed initial player data:", initialPlayerData);

  return {
    player: initialPlayerData,
    // analysis: initialAnalysisData // for VAD etc.
  };
};
