// vibe-player-v2/src/lib/utils/assert.ts

/**
 * Asserts that a condition is true.
 * In development mode, this will throw an error if the condition is false.
 * This function and its checks are completely removed from production builds.
 *
 * This implementation uses `import.meta.env.DEV`, a Vite-provided variable,
 * making it safe to use in both the main app and in Web Workers.
 *
 * @param condition The condition to check.
 * @param message The error message to throw if the condition is false.
 */
export function assert(condition: unknown, message: string): asserts condition {
  // Vite will replace `import.meta.env.DEV` with `true` or `false` at build time.
  // The `if (false && ...)` block will be completely removed (tree-shaken)
  // in production builds, resulting in zero performance overhead.
  if (import.meta.env.DEV && !condition) {
    throw new Error(`[Assertion Failed] ${message}`);
  }
}
