// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
import path from 'path';

// Define a port for the dev server to listen on.
const PORT = process.env.PORT || 8080;

// Define the base URL for the dev server.
const baseURL = `http://localhost:${PORT}`;

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  // Define the test directory.
  testDir: path.resolve(__dirname, 'vibe-player-v2/tests/e2e'), // Adjusted path to E2E tests
  // Define the directory for test results, screenshots, videos, traces, etc.
  outputDir: path.resolve(__dirname, 'vibe-player-v2/tests/e2e/test-results'), // Adjusted path for outputs
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: baseURL,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  /* Run your local dev server before starting the tests */
  webServer: {
    // Adjusted the command to serve the SvelteKit app from its correct directory
    command: `npm run serve-for-test --prefix ./vibe-player-v2`, // Assuming 'serve-for-test' is defined in vibe-player-v2's package.json
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    cwd: __dirname, // Consider setting CWD if 'serve-for-test' needs specific context
    // stdout: 'pipe', // Or 'ignore'
    // stderr: 'pipe', // Or 'ignore'
  },
});
