// vibe-player-v2/src/lib/utils/assert.ts
import { dev } from "$app/environment";

/**
 * Asserts that a condition is true, throwing an error in development if it's not.
 * This function is stripped from production builds.
 * @param condition The condition to check.
 * @param message The error message to throw if the condition is false.
 */
export function assert(condition: unknown, message: string): asserts condition {
  if (dev && !condition) {
    throw new Error(`[Assertion Failed] ${message}`);
  }
}
