// playwright.config.js
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests-e2e', // Specify the directory for E2E tests
  // Optional: Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    // {
    //   name: 'firefox',
    //   use: { browserName: 'firefox' },
    // },
    // {
    //   name: 'webkit',
    //   use: { browserName: 'webkit' },
    // },
  ],
  // Optional: Set a global timeout for all tests
  timeout: 60000, // 60 seconds
  // Optional: Reporter to use. See https://playwright.dev/docs/test-reporters
  reporter: 'html', // Generates a nice HTML report

  use: {
    // Optional: Base URL to use in actions like `await page.goto('/')`
    // baseURL: 'http://localhost:8080', // Not using this as goto() has full URL

    // Optional: Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer
    trace: 'on-first-retry',
    headless: true, // Run tests in headless mode
  },

  // Configure the web server for E2E tests
  webServer: {
    command: 'npm run preview --prefix vibe-player-v2 -- --host 0.0.0.0 --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI, // Reuse server locally, not in CI
    timeout: 180 * 1000, // Increase timeout for server to start
  },
});
