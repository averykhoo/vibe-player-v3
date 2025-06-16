// vibe-player-v2/playwright.config.ts

import {defineConfig, devices} from "@playwright/test";

// SvelteKit's default preview port is 4173.
const PORT = 4173;
const baseURL = `http://localhost:${PORT}`;

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
    // The test directory is now relative to THIS config file.
    testDir: "./tests-e2e",

    // Output dir for reports is also relative.
    outputDir: "./tests-e2e/test-results",

    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    maxFailures: process.env.CI ? 1 : undefined,
    reporter: "html",

    use: {
        baseURL: baseURL,
        trace: "on-first-retry",
    },

    projects: [
        {name: "chromium", use: {...devices["Desktop Chrome"]}},
        {name: "firefox", use: {...devices["Desktop Firefox"]}},
        {name: "webkit", use: {...devices["Desktop Safari"]}},
    ],

    // **THE KEY FIX IS HERE**
    // We now run the standard SvelteKit preview command from within this directory.
    // This command serves the production build of our app, which is the best
    // way to run end-to-end tests.
    webServer: {
        command: "npm run preview",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
    },
});
