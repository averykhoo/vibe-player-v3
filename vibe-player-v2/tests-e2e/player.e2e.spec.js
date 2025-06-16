// tests-e2e/player.e2e.spec.js
import { test, expect } from "@playwright/test";
import { PlayerPage } from "./PlayerPage.mjs";

function parseTimeToSeconds(timeStr) {
  if (!timeStr || !timeStr.includes(":") || timeStr.includes("NaN")) return 0;
  const parts = timeStr.split(":");
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

// UPDATED: Paths are now relative to the server root, as they are in the static dir.
const TEST_AUDIO_FILE = "test-audio/C.Noisy_Voice.wav";
const DTMF_TEST_AUDIO_FILE = "test-audio/dtmf-123A456B789C(star)0(hex)D.mp3";

test.describe("Vibe Player V2 E2E", () => {
  let playerPage;

  test.beforeEach(async ({ page }) => {
    page.on("console", (msg) => {
      const text = msg.text();
      if (msg.type() === "error") {
        console.error(`[Browser Console ERROR] ${text}`);
        // Detect critical VAD/WASM errors and fail the test immediately
        if (
          text.includes("VAD error") ||
          text.includes("WASM error") ||
          text.includes("WebAssembly")
        ) {
          test.fail(
            true,
            `Critical VAD/WASM error detected in browser console: ${text}`,
          );
        }
      }
    });
    playerPage = new PlayerPage(page);
    await playerPage.goto();
  });

  test("should load an audio file and enable playback controls", async ({
    page,
  }) => {
    await playerPage.loadAudioFile(TEST_AUDIO_FILE);
    await playerPage.expectControlsToBeReadyForPlayback();
  });

  test('should display initial time as "0:00 / 0:00" or similar', async () => {
    await playerPage.loadAudioFile(TEST_AUDIO_FILE);
    await playerPage.expectControlsToBeReadyForPlayback();
    await expect(playerPage.timeDisplay).toHaveText(/0:00 \/ [0-9]+:[0-9]{2}/, {
      timeout: 5000,
    });
  });

  test("should play and pause audio", async ({ page }) => {
    await playerPage.loadAudioFile(TEST_AUDIO_FILE);
    await playerPage.expectControlsToBeReadyForPlayback();

    await expect(await playerPage.getPlayButtonText()).toMatch(/Play/i);

    await playerPage.playButton.click();
    await expect(await playerPage.getPlayButtonText()).toMatch(/Pause/i, {
      timeout: 2000,
    });

    // --- START: IMPROVED TWO-STAGE ASSERTION ---
    // Stage 1: Wait for the element to be visible (should be instant, but good practice).
    await expect(playerPage.timeDisplay).toBeVisible();

    // Stage 2: Wait for its content to change.
    await expect(playerPage.timeDisplay, "Playback did not start and time did not advance")
        .not.toHaveText(/^0:00 \//, { timeout: 10000 });
    // --- END: IMPROVED TWO-STAGE ASSERTION ---

    // Note: The lines `const initialTime = ...` and `expect(initialTime).not.toMatch(...)`
    // from the prompt's snippet are omitted here as they don't align with the current code structure
    // and the core change is the two-stage expect above. The existing logic for time check is sufficient.

    await playerPage.playButton.click();
    await expect(await playerPage.getPlayButtonText()).toMatch(/Play/i);
    const timeAfterPause = await playerPage.timeDisplay.textContent();
    await page.waitForTimeout(500);
    const timeAfterPauseAndDelay = await playerPage.timeDisplay.textContent();
    expect(timeAfterPauseAndDelay).toBe(timeAfterPause);
  });

  test("should seek audio using the seek bar", async ({ page }) => {
    await playerPage.loadAudioFile(TEST_AUDIO_FILE);
    await playerPage.expectControlsToBeReadyForPlayback();
    await playerPage.playButton.click();

    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="time-display"]')?.textContent !==
        "0:00 / 0:00",
      null,
      { timeout: 5000 },
    );

    const initialTimeText = await playerPage.timeDisplay.textContent();
    const durationSeconds = parseTimeToSeconds(initialTimeText.split(" / ")[1]);
    expect(durationSeconds).toBeGreaterThan(0);

    const currentMax =
      parseFloat(await playerPage.seekSliderInput.getAttribute("max")) ||
      durationSeconds;
    await playerPage.setSliderValue(
      playerPage.seekSliderInput,
      String(currentMax / 2),
    );

    await page.waitForTimeout(500);

    const timeAfterSeekText = await playerPage.timeDisplay.textContent();
    const currentTimeAfterSeek = parseTimeToSeconds(
      timeAfterSeekText.split(" / ")[0],
    );
    const durationAfterSeek = parseTimeToSeconds(
      timeAfterSeekText.split(" / ")[1],
    );

    expect(currentTimeAfterSeek).toBeGreaterThanOrEqual(
      durationAfterSeek * 0.4,
    );
    expect(currentTimeAfterSeek).toBeLessThanOrEqual(durationAfterSeek * 0.6);
    expect(await playerPage.getPlayButtonText()).toMatch(/Pause/i);
  });

  test("should detect and display DTMF tones", async ({ page }) => {
    await playerPage.loadAudioFile(DTMF_TEST_AUDIO_FILE);
    await playerPage.expectControlsToBeReadyForPlayback();

    const expectedDtmfSequence = "1 2 3 A 4 5 6 B 7 8 9 C * 0 # D";

    // --- START: IMPROVED TWO-STAGE ASSERTION ---
    // Stage 1: Wait for the DTMF display element to appear on the page.
    await expect(playerPage.dtmfDisplay, "DTMF display element did not appear")
        .toBeVisible({ timeout: 15000 });

    // Stage 2: Now that it exists, check its text content.
    await expect(playerPage.dtmfDisplay, "DTMF text content did not match expected sequence")
        .toHaveText(expectedDtmfSequence);
    // --- END: IMPROVED TWO-STAGE ASSERTION ---
  });

  test.describe("URL State Serialization", () => {
    test("should update URL when settings change", async ({ page }) => {
      await playerPage.loadAudioFile(TEST_AUDIO_FILE);
      await playerPage.expectControlsToBeReadyForPlayback();

      await playerPage.setSliderValue(playerPage.speedSliderInput, "1.5");
      // --- FIX: Wait for the debounced function to execute ---
      await page.waitForURL("**/*speed=1.50", { timeout: 2000 });
      await expect(page).toHaveURL(/speed=1.50/); // Keep this assertion

      await playerPage.setSliderValue(playerPage.pitchSliderInput, "2");
      // --- FIX: Wait for the next change ---
      await page.waitForURL("**/*pitch=2.0", { timeout: 2000 });
      await expect(page).toHaveURL(/pitch=2.0/, { timeout: 2000 }); // It's fine to re-assert
      await expect(page).toHaveURL(/speed=1.50/); // Ensure previous param is still there
    });

    test("should load settings from URL parameters on page load", async ({
      page,
    }) => {
      await playerPage.page.goto(
        playerPage.devServerUrl + "?speed=1.75&pitch=-3",
      );
      await expect(playerPage.appBarTitle).toHaveText("Vibe Player V2", {
        timeout: 15000,
      });
      await expect(playerPage.fileInput).toBeVisible({ timeout: 10000 });

      await playerPage.loadAudioFile(TEST_AUDIO_FILE);
      await playerPage.expectControlsToBeReadyForPlayback();

      await expect(playerPage.speedSliderInput).toHaveValue("1.75", {
        timeout: 2000,
      });
      await expect(playerPage.pitchSliderInput).toHaveValue("-3", {
        timeout: 2000,
      });
    });
  });
});
