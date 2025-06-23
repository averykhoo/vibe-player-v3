// vibe-player-v2.3/src/lib/utils/urlState.ts

import { BROWSER } from "esm-env";
import { URL_HASH_KEYS } from "./constants"; // <-- ADD THIS IMPORT

/**
 * Updates the browser's URL with the given parameters without reloading the page.
 * This function is now authoritative: it first removes all known Vibe Player
 * parameters and then sets only the ones provided.
 * @param params The parameters to update the URL with.
 */
export function updateUrlWithParams(params: Record<string, string>) {
  if (!BROWSER) return;
  const url = new URL(window.location.href);

  // --- START OF FIX ---
  // 1. Clear all previously set, known parameters to ensure no stale values remain.
  for (const key of Object.values(URL_HASH_KEYS)) {
    url.searchParams.delete(key);
  }

  // 2. Set only the new, current parameters.
  for (const [key, value] of Object.entries(params)) {
    // A simple check to not add empty/undefined values.
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  // --- END OF FIX ---

  const newUrl = url.toString();
  console.log(
    `[urlState.ts/updateUrlWithParams] Updating browser URL to: ${newUrl}`,
  );
  history.replaceState({}, "", newUrl);
}

/**
 * Creates a URL with the given parameters.
 * @param params The parameters to create the URL with.
 * @returns The URL with the given parameters.
 */
export function createUrlWithParams(params: Record<string, string>): string {
  if (!BROWSER) return ""; // Corrected to use BROWSER from esm-env
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value); // Corrected typo here
    }
  }
  return url.toString();
}

/**
 * Returns the value of the given parameter from the URL.
 * @param param The parameter to get the value of.
 * @returns The value of the given parameter from the URL.
 */
export function getParamFromUrl(param: string): string | undefined {
  if (!BROWSER) return;
  const url = new URL(window.location.href);
  return url.searchParams.get(param) ?? undefined;
}
