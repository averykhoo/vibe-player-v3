// vibe-player-v2.3/src/routes/+page.ts
// src/routes/+page.ts
import { URL_HASH_KEYS } from "$lib/utils/constants";
import type { PageLoad } from "./$types";

/**
 * SvelteKit load function. Runs before the page component is rendered.
 * It deserializes state from URL search parameters, making them available
 * to the component on initial load.
 */
export const load: PageLoad = ({ url }) => {
  console.log("[+page.ts load] Deserializing state from URL:", url.href);

  const initialPlayerData = {
    speed: url.searchParams.has(URL_HASH_KEYS.SPEED)
      ? parseFloat(url.searchParams.get(URL_HASH_KEYS.SPEED)!)
      : undefined,
    pitchShift: url.searchParams.has(URL_HASH_KEYS.PITCH)
      ? parseFloat(url.searchParams.get(URL_HASH_KEYS.PITCH)!)
      : undefined,
    gain: url.searchParams.has(URL_HASH_KEYS.GAIN)
      ? parseFloat(url.searchParams.get(URL_HASH_KEYS.GAIN)!)
      : undefined,
    currentTime: url.searchParams.has(URL_HASH_KEYS.TIME)
      ? parseFloat(url.searchParams.get(URL_HASH_KEYS.TIME)!)
      : undefined,
  };

  // Filter out undefined values
  const filteredData = Object.fromEntries(
    Object.entries(initialPlayerData).filter(([_, v]) => v !== undefined),
  );

  console.log("[+page.ts load] Parsed initial player data:", filteredData);

  return {
    player: filteredData,
  };
};
