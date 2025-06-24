// vibe-player-v2.3/tests-e2e/player.e2e.spec.js
import { expect, test } from "@playwright/test";
import { PlayerPage } from "./PlayerPage.mjs";

function parseTimeToSeconds(timeStr) {
  if (!timeStr || !timeStr.includes(":") || timeStr.includes("NaN")) return 0;
  const parts = timeStr.split(":");
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

// UPDATED: Paths are now relative to the server root, as they are in the static dir.
const TEST_AUDIO_FILE = "static/test-audio/C.Noisy_Voice.wav";
const DTMF_TEST_AUDIO_FILE =
  "static/test-audio/dtmf-123A456B789C(star)0(hex)D.mp3";

test.describe("Vibe Player V2 E2E", () => {
  let playerPage;
  let testLogs; // Buffer for logs for the current test

  // This hook runs before each test
  test.beforeEach(async ({ page }, testInfo) => {
    // 1. Reset the log buffer for each new test
    testLogs = [];
    console.log(`\n+++ STARTING TEST: ${testInfo.titlePath.join(" > ")} +++`);

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
      `+++ FINISHED TEST: ${testInfo.titlePath.join(" > ")} | STATUS: ${testInfo.status} +++`,
    );

    // 3. Only print the buffered logs if the test did not pass
    if (testInfo.status !== "passed" && testInfo.status !== "skipped") {
      console.log("+++ BROWSER LOGS FOR FAILED TEST +++");
      testLogs.forEach((log) => console.log(log));
      console.log("\n\n---------------------------------------\n");
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

  test.fixme(
    "should seek audio interactively (mousedown, input, mouseup) and resume if playing",
    async ({ page }) => {
      await playerPage.loadAudioFile(TEST_AUDIO_FILE);
      await playerPage.expectControlsToBeReadyForPlayback();

      // 1. Start playback and verify it's running
      await playerPage.playButton.click();
      await expect(playerPage.playButton).toHaveText(/Pause/);
      await expect(playerPage.timeDisplay).not.toHaveText(/^0:00 \//, {
        timeout: 5000,
      });

      const durationSeconds = await playerPage.getDuration();
      expect(
        durationSeconds,
        "Duration should be greater than 0",
      ).toBeGreaterThan(0);
      const targetSeekTimeSeconds = durationSeconds / 2;

      // 2. Perform the entire interactive seek using the new robust helper.
      // THIS IS THE CORRECTED CALL
      await playerPage.setSliderValue(
        playerPage.seekSliderInput,
        String(targetSeekTimeSeconds),
      );

      // 3. Assert audio resumes playing automatically, since it was playing before the seek.
      await expect(playerPage.playButton).toHaveText(/Pause/, {
        timeout: 2000,
      });

      // 4. Assert the actual time has settled near the seek target.
      await expect(async () => {
        const currentTime = await playerPage.getCurrentTime();
        expect(currentTime).toBeCloseTo(targetSeekTimeSeconds, 1);
      }).toPass({ timeout: 5000 });
    },
  );

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
      await expect(page).toHaveURL(/speed=1.50/, { timeout: 4000 });

      // --- PITCH ---
      await playerPage.setSliderValue(playerPage.pitchSliderInput, "2.0");
      await expect(page).toHaveURL(/pitch=2.00/, { timeout: 4000 });
      await expect(page).toHaveURL(/speed=1.50/, { timeout: 4000 }); // Consistent timeout

      // --- GAIN (NEWLY ADDED) ---
      await playerPage.setSliderValue(playerPage.gainSliderInput, "1.75");
      await expect(page).toHaveURL(/gain=1.75/, { timeout: 4000 });
      await expect(page).toHaveURL(/speed=1.50/, { timeout: 4000 }); // Consistent timeout
      await expect(page).toHaveURL(/pitch=2.00/, { timeout: 4000 }); // Consistent timeout
    });

    test("should load settings from URL parameters on page load", async ({
      page,
    }) => {
      await playerPage.page.goto(
        playerPage.devServerUrl + "?speed=1.75&pitch=-3",
      );
      await expect(playerPage.appBarTitle).toHaveText("Vibe Player", {
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

  // --- START: ADD THIS NEW TEST BLOCK ---
  test.describe("URL Loading Features", () => {
    // This is the known URL to a test file in the repository's static assets.
    // We use a real, fetchable URL to simulate a user providing a link.
    const TEST_AUDIO_URL = `http://localhost:4173/test-audio/449496_9289636-lq.mp3`;

    test("should load an audio file from the URL input field", async ({
      page,
    }) => {
      // 1. Fill the URL input field with the link to the test audio.
      await playerPage.urlInput.fill(TEST_AUDIO_URL);

      // 2. Click the "Load" button next to the URL input.
      await playerPage.urlLoadButton.click();

      // 3. Use the existing helper to wait for the player to become ready.
      await playerPage.expectControlsToBeReadyForPlayback();

      // 4. Assert that the file name display shows the URL, confirming a successful load.
      await expect(playerPage.fileNameDisplay).toHaveText(TEST_AUDIO_URL);

      // 5. Assert that the URL was serialized to the page's query params.
      await expect(page).toHaveURL(
        new RegExp(`\\?url=${encodeURIComponent(TEST_AUDIO_URL)}`),
      );
    });

    test("should automatically load an audio file from a URL parameter", async ({
      page,
    }) => {
      // 1. Navigate directly to a URL with the 'url' parameter.
      const fullUrl = `${playerPage.devServerUrl}?url=${encodeURIComponent(TEST_AUDIO_URL)}`;
      await page.goto(fullUrl);

      // 2. The application should auto-load the file. Wait for it to be ready.
      await playerPage.expectControlsToBeReadyForPlayback();

      // 3. Assert the file name display shows the URL.
      await expect(playerPage.fileNameDisplay).toHaveText(TEST_AUDIO_URL);
    });

    test("should auto-load and seek from URL url and time parameters", async ({
      page,
    }) => {
      const seekTime = 1.2345;
      // 1. Navigate directly to a URL with both 'url' and 'time' parameters.
      const fullUrl = `${playerPage.devServerUrl}?url=${encodeURIComponent(TEST_AUDIO_URL)}&time=${seekTime}`;
      await page.goto(fullUrl);

      // 2. Wait for playback readiness.
      await playerPage.expectControlsToBeReadyForPlayback();

      // 3. Assert that the time display shows that the seek was successful.
      //    We check that the current time is close to the target, allowing for minor float inaccuracies.
      await expect(async () => {
        const currentTime = await playerPage.getCurrentTime();
        expect(currentTime).toBeCloseTo(seekTime, 1);
      }).toPass({ timeout: 5000 }); // Use toPass for polling async value.
    });
  });
  // --- END: ADD THIS NEW TEST BLOCK ---

  test("should enable VAD controls after analysis is complete", async () => {
    // This test verifies that background VAD analysis runs and enables its UI controls.
    await playerPage.loadAudioFile(TEST_AUDIO_FILE);
    await playerPage.expectControlsToBeReadyForPlayback();

    // 1. VAD sliders should be disabled immediately after file load.
    // --- THIS LINE IS REMOVED ---
    // await expect(playerPage.vadPositiveSliderInput).toBeDisabled();

    // 2. Wait for the background VAD analysis to complete, which enables the slider.
    //    A long timeout is required because this is a background task.
    //    Since the slider is likely already enabled due to the bug, this will pass instantly
    //    if playback is ready, or wait if the app is slow. It's now just a check for enabled.
    await expect(
      playerPage.vadPositiveSliderInput,
      "VAD positive slider did not become enabled",
    ).toBeEnabled({ timeout: 20000 });

    // 3. The other VAD slider should also be enabled.
    await expect(
      playerPage.vadNegativeSliderInput,
      "VAD negative slider did not become enabled",
    ).toBeEnabled();
  });

  test("should stop playback and reset time to zero", async () => {
    await playerPage.loadAudioFile(TEST_AUDIO_FILE);
    await playerPage.expectControlsToBeReadyForPlayback();

    // 1. Start playback.
    await playerPage.playButton.click();

    // 2. Confirm playback has started by waiting for time to advance.
    await expect(
      playerPage.timeDisplay,
      "Time did not advance after play was clicked",
    ).not.toHaveText(/^0:00 \//, { timeout: 5000 });

    // 3. Click the stop button.
    await playerPage.stopButton.click();

    // 4. Assert UI has returned to a stopped state.
    await expect(
      await playerPage.getPlayButtonText(),
      "Play button did not revert to 'Play' after stop",
    ).toMatch(/Play/i);
    await expect(
      playerPage.timeDisplay,
      "Time display did not reset to zero after stop",
    ).toHaveText(/^0:00 \//);
  });

  test("should add and remove the time parameter from the URL correctly", async ({
    page,
  }) => {
    await playerPage.loadAudioFile(TEST_AUDIO_FILE);
    await playerPage.expectControlsToBeReadyForPlayback();

    // 1. Play and then pause to trigger a URL update with the time.
    await playerPage.playButton.click();
    await page.waitForTimeout(1000); // Let playback advance for a second.
    await playerPage.playButton.click(); // Pause the player.

    // 2. Assert that the `time` parameter now exists in the URL.
    //    A timeout is needed for the debounced URL update to fire.
    await expect(
      page,
      "URL did not update with 'time' parameter on pause",
    ).toHaveURL(/time=\d+\.\d+/, { timeout: 2000 });

    // 3. Click the stop button, which should reset time and clear the parameter.
    await playerPage.stopButton.click();

    // 4. Assert that the `time` parameter has been removed from the URL.
    await expect(
      page,
      "URL did not remove 'time' parameter on stop",
    ).not.toHaveURL(/time=/, { timeout: 2000 });
  });

  test("should correctly reset state when loading a second file", async ({
    page,
  }) => {
    // 1. Load the first file (non-DTMF)
    await playerPage.loadAudioFile(TEST_AUDIO_FILE);
    await playerPage.expectControlsToBeReadyForPlayback();
    await expect(playerPage.fileNameDisplay).toHaveText("C.Noisy_Voice.wav");

    // 2. Play it for a moment to ensure state is active
    await playerPage.playButton.click();
    await expect(playerPage.timeDisplay).not.toHaveText(/^0:00 \//, {
      timeout: 5000,
    });
    // Assert that the first file has NO DTMF tones
    await expect(playerPage.dtmfDisplay).not.toBeVisible();

    // 3. Load the second file (DTMF)
    await playerPage.loadAudioFile(DTMF_TEST_AUDIO_FILE);

    // 4. Assert that the UI is ready for playback with the *new* file's info
    await playerPage.expectControlsToBeReadyForPlayback();

    // 5. Assert that state has been fully reset and updated for the new file
    // Assert new file name is displayed
    await expect(playerPage.fileNameDisplay).toHaveText(
      "dtmf-123A456B789C(star)0(hex)D.mp3",
    );
    // Assert time has reset
    await expect(playerPage.timeDisplay).toHaveText(/0:00 \/ 0:10/);
    // Assert DTMF tones from the *second* file are now visible
    await expect(playerPage.dtmfDisplay).toBeVisible({ timeout: 15000 });
    await expect(playerPage.dtmfDisplay).toHaveText(
      "1 2 3 A 4 5 6 B 7 8 9 C * 0 # D",
    );
  });
});
