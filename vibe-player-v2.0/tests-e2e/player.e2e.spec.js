// vibe-player-v2.0/tests-e2e/player.e2e.spec.js
import { expect, test } from "@playwright/test";
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

  // --- MODIFIED: Added testInfo and console logs to beforeEach ---
  test.beforeEach(async ({ page }, testInfo) => {
    // Log a clear header for the start of each test.
    console.log(`\n\n=== STARTING TEST: ${testInfo.title} ===\n`);

    page.on("console", (msg) => {
      const text = msg.text();
      // Only log non-URL serialization messages to reduce noise
      if (!text.includes("[URL Serialization]")) {
        console.log(`[BROWSER LOG]: ${text}`);
      }
      if (msg.type() === "error") {
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

  // --- ADDED: afterEach hook for logging ---
  test.afterEach(async ({ page }, testInfo) => {
    // Log a clear footer for the end of each test, including its status.
    console.log(
      `\n=== FINISHED TEST: ${testInfo.title} | Status: ${testInfo.status} ===\n`,
    );
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

    // 1. Assert initial "Play" state
    await expect(playerPage.playButton).toHaveText(/Play/i);

    // 2. Click to play and assert the text changes to "Pause".
    // Playwright's `expect` with `toHaveText` will automatically wait for the DOM
    // to update after the async play() method completes. This is the fix.
    await playerPage.playButton.click();
    await expect(playerPage.playButton).toHaveText(/Pause/i, { timeout: 5000 });

    // 3. Assert that time has advanced from zero.
    await expect(
      playerPage.timeDisplay,
      "Playback did not start, time is still 0:00",
    ).not.toHaveText(/^0:00 \//, { timeout: 5000 });

    // 4. Click to pause and verify the text returns to "Play".
    await playerPage.playButton.click();
    await expect(playerPage.playButton).toHaveText(/Play/i);

    // 5. Verify time stops advancing after a pause.
    const timeAfterPause = await playerPage.timeDisplay.textContent();
    await page.waitForTimeout(500); // Wait a moment to see if time changes
    await expect(playerPage.timeDisplay).toHaveText(timeAfterPause);
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

    // 5. Assert that the time has updated correctly by polling the UI until the
    //    condition is met or the timeout is reached.
    await page.waitForFunction(
      (expectedTime) => {
        const timeDisplay = document.querySelector(
          '[data-testid="time-display"]',
        );
        if (!timeDisplay?.textContent) return false;

        const currentTimeStr = timeDisplay.textContent.split(" / ")[0];
        const parts = currentTimeStr.split(":");
        if (parts.length < 2) return false;

        const currentTime =
          parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);

        // Check if the current time is within a reasonable range (e.g., 90-110%) of the expected time.
        // expectedTime in this context is durationSeconds * seekTargetFraction.
        // The original issue description implies seekTargetFraction is 0.5 for the middle.
        // So, we are expecting currentTime to be around 0.5 * duration.
        // The check `currentTime >= expectedTime * 0.9 && currentTime <= expectedTime * 1.1`
        // means currentTime should be between 0.45 * duration and 0.55 * duration.
        return (
          currentTime >= expectedTime * 0.9 && currentTime <= expectedTime * 1.1
        );
      },
      durationSeconds * 0.5,
      { timeout: 5000 },
    ); // Pass the expected time (middle of duration) and a timeout

    // Now that we've waited for the state to settle, a final, simpler assertion is safe.
    const finalTimeText = await playerPage.timeDisplay.textContent();
    const finalCurrentTime = parseTimeToSeconds(finalTimeText.split(" / ")[0]);
    expect(finalCurrentTime).toBeGreaterThan(durationSeconds * 0.4);
    expect(await playerPage.getPlayButtonText()).toMatch(/Pause/i);
  });

  test("should detect and display DTMF tones", async ({ page }) => {
    await playerPage.loadAudioFile(DTMF_TEST_AUDIO_FILE);
    await playerPage.expectControlsToBeReadyForPlayback();

    const expectedDtmfSequence = "1 2 3 A 4 5 6 B 7 8 9 C * 0 # D";

    // --- START: IMPROVED TWO-STAGE ASSERTION ---
    // Stage 1: Wait for the DTMF display element to appear on the page.
    await expect(
      playerPage.dtmfDisplay,
      "DTMF display element did not appear",
    ).toBeVisible({ timeout: 15000 });

    // Stage 2: Now that it exists, check its text content.
    await expect(
      playerPage.dtmfDisplay,
      "DTMF text content did not match expected sequence",
    ).toHaveText(expectedDtmfSequence);
    // --- END: IMPROVED TWO-STAGE ASSERTION ---
  });

  test.describe("URL State Serialization", () => {
    test("should update URL when settings change", async ({ page }) => {
      await playerPage.loadAudioFile(TEST_AUDIO_FILE);
      await playerPage.expectControlsToBeReadyForPlayback();

      // --- SPEED ---
      await playerPage.setSliderValue(playerPage.speedSliderInput, "1.5");
      await expect(page).toHaveURL(/speed=1.50/, { timeout: 2000 });

      // --- PITCH ---
      await playerPage.setSliderValue(playerPage.pitchSliderInput, "2.0");
      await expect(page).toHaveURL(/pitch=2.0/, { timeout: 2000 });
      await expect(page).toHaveURL(/speed=1.50/); // Ensure previous param is still there

      // --- GAIN (NEWLY ADDED) ---
      await playerPage.setSliderValue(playerPage.gainSliderInput, "1.75");
      await expect(page).toHaveURL(/gain=1.75/, { timeout: 2000 });
      await expect(page).toHaveURL(/speed=1.50/); // Ensure other params remain
      await expect(page).toHaveURL(/pitch=2.0/);
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

      // --- ROBUST FIX: Assert against the visible label, not the input's internal value ---
      // This confirms the value was processed by the store and reflected in the UI component's state.
      await expect(
        playerPage.speedValueDisplay,
        "The visible speed label did not update from the URL parameter.",
      ).toHaveText("Speed: 1.75x", { timeout: 2000 });

      await expect(
        playerPage.pitchValueDisplay,
        "The visible pitch label did not update from the URL parameter.",
      ).toHaveText("Pitch: -3.0 semitones", { timeout: 2000 });
    });
  });
});
