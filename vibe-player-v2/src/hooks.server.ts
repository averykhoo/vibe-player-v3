// vibe-player-v2/src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';

/**
 * SvelteKit hook to add required security headers for SharedArrayBuffer support.
 * SharedArrayBuffer is used by ort-wasm-simd-threaded.jsep.mjs (ONNX Runtime) for multithreading.
 * Without these headers, the browser will not allow the module to load, causing a silent failure.
 * See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer/security_requirements
 */
export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  // Required for SharedArrayBuffer
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');

  return response;
};
