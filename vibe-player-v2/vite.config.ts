// vibe-player-v2/vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config"; // Changed from "vite"
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [
    sveltekit(),
    viteStaticCopy({
      targets: [
        {
          src: "./node_modules/onnxruntime-web/dist/*.{wasm,mjs}",
          dest: ".", // Copies to the root of the build directory
        },
      ],
    }),
  ],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{js,ts}"],
    setupFiles: ["./src/setupTests.ts"],
  },
  resolve: {
    conditions: ["browser", "svelte"],
  },
});
