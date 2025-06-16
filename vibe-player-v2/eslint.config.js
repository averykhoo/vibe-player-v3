// vibe-player-v2/eslint.config.js
// @ts-check

import sveltePlugin from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import typescriptParser from "@typescript-eslint/parser";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

export default [
    {
        ignores: [
            ".svelte-kit/**", // Ignore SvelteKit's generated files
            "build/**", // Standard build output directory
            "dist/**", // Common distribution directory name
        ],
    },
    // eslint.configs.recommended, // Keep this commented out or remove rules like no-unused-vars from it
    ...sveltePlugin.configs["flat/recommended"],
    {
        rules: {
            "no-unused-vars": "off", // Turn off no-unused-vars for now
            // OR, more selectively for TypeScript if using @typescript-eslint/eslint-plugin
            // "@typescript-eslint/no-unused-vars": "off",
        },
    },
    {
        files: ["**/*.js", "**/*.ts", "**/*.svelte"],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node, // For things like 'module' in rubberband-loader.js if needed, or setTimeout etc.
                // Add any other specific globals your project might use if not covered by browser/node
            },
        },
    },
    {
        files: ["src/lib/workers/**/*.js", "src/lib/workers/**/*.ts"],
        languageOptions: {
            globals: {
                ...globals.worker,
            },
        },
    },
    {
        files: ["**/*.js", "**/*.ts"],
        languageOptions: {
            parser: typescriptParser,
        },
    },
    {
        files: ["**/*.svelte"],
        languageOptions: {
            parser: svelteParser,
            parserOptions: {
                parser: typescriptParser,
            },
        },
        // rules: { // Rules specific to svelte files can go here if needed
        // },
    },
    eslintConfigPrettier,
];
