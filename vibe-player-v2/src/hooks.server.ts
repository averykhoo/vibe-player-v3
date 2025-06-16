// vibe-player-v2/src/hooks.server.ts
import type { Handle } from "@sveltejs/kit";

/**
 * SvelteKit hook to add required security headers for SharedArrayBuffer support.
 * This is crucial for libraries like ONNX Runtime (ort-wasm-simd-threaded) and ensures
 * that both pages and static assets are served with the correct policies.
 * See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer/security_requirements
 */
export const handle: Handle = async ({ event, resolve }) => {
  // Apply the headers to all responses.
  const response = await resolve(event);

  // Required for SharedArrayBuffer
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Embedder-Policy", "require-corp");

  return response;
};
