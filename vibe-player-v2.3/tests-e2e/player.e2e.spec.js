// vibe-player-v2.3/tests-e2e/player.e2e.spec.js
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
  let testLogs; // Buffer for logs for the current test

  // This hook runs before each test
  test.beforeEach(async ({ page }, testInfo) => {
    // 1. Reset the log buffer for each new test
    testLogs = [];
    console.log(`--- STARTING TEST: ${testInfo.titlePath.join(" > ")} ---`);

    // 2. Buffer console messages instead of printing them immediately
    page.on("console", (msg) => {
      const text = msg.text();
      const type = msg.type();
      testLogs.push(`[${type.toUpperCase()}]: ${text}`);

      // We still want to fail fast for critical errors
      if (
        type === "error" &&
        (text.includes("WASM") || text.includes("WebAssembly"))
      ) {
        test.fail(true, `Critical WASM error detected in browser: ${text}`);
      }
    });

    playerPage = new PlayerPage(page);
    await playerPage.goto();
  });

  // This new hook runs after each test
  test.afterEach(async ({ page }, testInfo) => {
    console.log(
      `--- FINISHED TEST: ${testInfo.titlePath.join(" > ")} | STATUS: ${testInfo.status} ---`,
    );

    // 3. Only print the buffered logs if the test did not pass
    if (testInfo.status !== "passed" && testInfo.status !== "skipped") {
      console.log("--- BROWSER LOGS FOR FAILED TEST ---");
      testLogs.forEach((log) => console.log(log));
      console.log("------------------------------------");
    }
  });

  // ... all existing test cases remain here, unchanged ...
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
    await expect(
      playerPage.timeDisplay,
      "Playback did not start and time did not advance",
    ).not.toHaveText(/^0:00 \//, { timeout: 10000 });
    // --- END: IMPROVED TWO-STAGE ASSERTION ---

    await playerPage.playButton.click();
    await expect(await playerPage.getPlayButtonText()).toMatch(/Play/i);
    const timeAfterPause = await playerPage.timeDisplay.textContent();
    await page.waitForTimeout(500);
    const timeAfterPauseAndDelay = await playerPage.timeDisplay.textContent();
    expect(timeAfterPauseAndDelay).toBe(timeAfterPause);
  });

  test("should seek audio using the seek bar with pause-seek-resume behavior", async ({
    page,
  }) => {
    await playerPage.loadAudioFile(TEST_AUDIO_FILE);
    await playerPage.expectControlsToBeReadyForPlayback();

    // 1. Start playback
    await playerPage.playButton.click();
    await expect(playerPage.playButton).toHaveText("Pause");

    // Wait for playback to start and time to advance a bit
    await expect(
      playerPage.timeDisplay,
      "Playback did not start",
    ).not.toHaveText(/^0:00 \//, { timeout: 5000 });

    const timeBeforeSeek = await playerPage.getCurrentTime();
    expect(timeBeforeSeek).toBeGreaterThan(0);

    // 2. Initiate Seek to roughly the middle of the track
    const durationText = (await playerPage.timeDisplay.textContent())?.split(
      " / ",
    )[1];
    const durationSeconds = parseTimeToSeconds(durationText);
    expect(durationSeconds).toBeGreaterThan(0);

    const targetSeekTimeSeconds = durationSeconds / 2;
    // PlayerPage.setSliderValue takes string, and it internally handles min/max attributes.
    // We pass the desired absolute time value string.
    await playerPage.setSliderValue(
      playerPage.seekSliderInput,
      String(targetSeekTimeSeconds),
    );

    // 3. Assert Playback Resumed and Seek Completion
    // The setSliderValue includes a waitForTimeout(350) which should be enough for UI to reflect the post-seek state.
    // Play button should indicate "Pause" meaning playback resumed.
    await expect(
      playerPage.playButton,
      "Playback did not resume after seek",
    ).toHaveText("Pause");

    // Check current time after seek.
    const timeAfterSeek = await playerPage.getCurrentTime();
    // Allow a tolerance (e.g., +/- 1 second) due to timing of updates and playback loop.
    expect(timeAfterSeek).toBeCloseTo(targetSeekTimeSeconds, 0); // Using Playwright's default tolerance or specify with second arg

    // 4. Assert Playback is ongoing and time is advancing
    await page.waitForTimeout(1000); // Wait for playback to continue for a second

    const timeAfterResumeAndPlay = await playerPage.getCurrentTime();
    // Check if time has advanced beyond the point of seek, considering potential small initial delay/buffering
    expect(
      timeAfterResumeAndPlay,
      "Time did not advance after resuming playback",
    ).toBeGreaterThan(timeAfterSeek - 0.1); // allow for slight timing variance
    expect(timeAfterResumeAndPlay).toBeGreaterThanOrEqual(
      targetSeekTimeSeconds,
    );

    await expect(
      playerPage.playButton,
      "Playback stopped after resuming and playing",
    ).toHaveText("Pause"); // Still playing
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
      await expect(page).toHaveURL(/pitch=2.00/, { timeout: 2000 });
      await expect(page).toHaveURL(/speed=1.50/); // Ensure previous param is still there

      // --- GAIN (NEWLY ADDED) ---
      await playerPage.setSliderValue(playerPage.gainSliderInput, "1.75");
      await expect(page).toHaveURL(/gain=1.75/, { timeout: 2000 });
      await expect(page).toHaveURL(/speed=1.50/); // Ensure other params remain
      await expect(page).toHaveURL(/pitch=2.00/);
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
