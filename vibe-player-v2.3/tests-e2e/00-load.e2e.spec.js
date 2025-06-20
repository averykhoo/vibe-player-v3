// vibe-player-v2.3/tests-e2e/00-load.e2e.spec.js
import { expect, test } from "@playwright/test";
import { PlayerPage } from "./PlayerPage.mjs";

/**
 * This is a foundational "smoke test". Its only purpose is to ensure the SvelteKit
 * application can build, start, and render its initial state without crashing.
 * If this test fails, it points to a critical problem in the application's
 * `onMount` lifecycle or initial component rendering.
 */
test.describe("Application Startup Smoke Test", () => {
  let playerPage;

  test.beforeEach(async ({ page }) => {
    // Set up a console listener to catch any critical errors during page load.
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error(`[Smoke Test Browser Console ERROR] ${msg.text()}`);
      }
    });
    playerPage = new PlayerPage(page);
  });

  test("should load the main page and display initial UI components", async () => {
    // 1. Navigate to the root of the application.
    await playerPage.goto();

    // 2. Assert that the main header is visible. This is a basic check that the
    //    Svelte layout has rendered. The timeout is generous for CI environments.
    await expect(playerPage.appBarTitle).toBeVisible({ timeout: 15000 });
    await expect(playerPage.appBarTitle).toHaveText("Vibe Player V2");

    // 3. Assert that the FileLoader component has rendered and its primary
    //    interactive element (the file input) is visible.
    await expect(playerPage.fileInput).toBeVisible();

    // 4. Assert that the Controls component has rendered. A good check for this
    //    is to ensure the play button is visible, and critically, that it is
    //    *disabled* in its initial state before any file is loaded.
    await expect(playerPage.playButton).toBeVisible();
    await expect(playerPage.playButton).toBeDisabled();
  });
});
