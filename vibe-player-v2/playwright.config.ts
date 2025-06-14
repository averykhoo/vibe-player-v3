// vibe-player-v2/playwright.config.ts (FIXED)

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Point to the correct test directory, which is one level up from this file's location.
  testDir: '../tests-e2e',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    // The command in webServer will serve the app at this port.
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // UNCOMMENT and CONFIGURE the webServer block. This is critical.
  // It tells Playwright how to build and start the V2 application for testing.
  webServer: {
    command: 'npm run build && npm run preview -- --host 0.0.0.0 --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000, // 3 minutes, allowing for build time
  },
});
