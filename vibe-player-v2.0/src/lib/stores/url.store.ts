// vibe-player-v2.0/src/lib/stores/url.store.ts
import { derived, get } from "svelte/store";
import { playerStore } from "./player.store";
import { analysisStore } from "./analysis.store";
import { URL_HASH_KEYS, VAD_CONSTANTS } from "$lib/utils/constants";
import { updateUrlWithParams } from "$lib/utils";

/**
 * A derived store that computes the URL search parameter object
 * based on the current state of the player and analysis stores.
 * It only includes values that differ from their defaults.
 */
export const urlParamsStore = derived(
  [playerStore, analysisStore],
  ([$player, $analysis]) => {
    const params: Record<string, string> = {};

    // Player params
    if ($player.speed !== 1.0) {
      params[URL_HASH_KEYS.SPEED] = $player.speed.toFixed(2);
    }
    if ($player.pitch !== 0.0) {
      params[URL_HASH_KEYS.PITCH] = $player.pitch.toFixed(1);
    }
    if ($player.gain !== 1.0) {
      params[URL_HASH_KEYS.GAIN] = $player.gain.toFixed(2);
    }

    // Analysis params (for VAD)
    if (
      $analysis.vadPositiveThreshold !== undefined &&
      $analysis.vadPositiveThreshold !==
        VAD_CONSTANTS.DEFAULT_POSITIVE_THRESHOLD
    ) {
      params[URL_HASH_KEYS.VAD_POSITIVE] =
        $analysis.vadPositiveThreshold.toFixed(2);
    }
    if (
      $analysis.vadNegativeThreshold !== undefined &&
      $analysis.vadNegativeThreshold !==
        VAD_CONSTANTS.DEFAULT_NEGATIVE_THRESHOLD
    ) {
      params[URL_HASH_KEYS.VAD_NEGATIVE] =
        $analysis.vadNegativeThreshold.toFixed(2);
    }

    return params;
  },
);

/**
 * An on-demand function to update the URL with all current settings
 * PLUS the current playback time. This should be called explicitly
 * on user interactions like pause or seek.
 */
export function updateUrlWithCurrentTime(): void {
  if (typeof window === "undefined") return;

  const params = get(urlParamsStore);
  const time = get(playerStore).currentTime;

  const paramsWithTime = { ...params };
  if (time > 0.1) {
    // Use a small threshold to avoid writing for near-zero values
    paramsWithTime[URL_HASH_KEYS.TIME] = time.toFixed(2);
  } else {
    // This key might not exist, but calling delete is safe and ensures it's removed.
    delete paramsWithTime[URL_HASH_KEYS.TIME];
  }

  updateUrlWithParams(paramsWithTime);
}
