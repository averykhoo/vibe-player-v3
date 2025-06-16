// vibe-player-v2/src/lib/utils/urlState.ts

import { BROWSER } from "esm-env";

/**
 * Updates the URL with the given parameters.
 * @param params The parameters to update the URL with.
 */
export function updateUrlWithParams(params: Record<string, string>) {
  if (!BROWSER) return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  }
  history.replaceState({}, "", url.toString());
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
