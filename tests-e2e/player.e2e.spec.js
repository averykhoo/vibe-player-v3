// tests-e2e/player.e2e.spec.js
const { test, expect } = require('@playwright/test');
const { PlayerPage } = require('./PlayerPage');

// Helper function (keep as is)
function parseTimeToSeconds(timeStr) {
  if (!timeStr || !timeStr.includes(':') || timeStr.includes('NaN')) return 0;
  const parts = timeStr.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

// FIX: Changed the test file from a .mp3 to a .wav for better CI compatibility
const TEST_AUDIO_FILE = 'C.Noisy_Voice.wav';

test.describe('Vibe Player V2 E2E', () => {
  let player;

  test.beforeEach(async ({ page }) => {
    player = new PlayerPage(page);
    await player.goto();
  });

  test('should load an audio file and enable playback controls', async () => {
    await player.loadAudioFile(TEST_AUDIO_FILE);
    await player.expectControlsToBeReadyForPlayback();
  });

  test('should display initial time as "0:00 / 0:00" or similar', async () => {
    await player.loadAudioFile(TEST_AUDIO_FILE);
    await player.expectControlsToBeReadyForPlayback();
    await expect(player.timeDisplay).toHaveText(/0:00 \/ [0-9]+:[0-9]{2}/, {timeout: 5000});
  });

  test('should play and pause audio', async ({ page }) => {
    await player.loadAudioFile(TEST_AUDIO_FILE);
    await player.expectControlsToBeReadyForPlayback();

    await expect(await player.getPlayButtonText()).toMatch(/Play/i);

    await player.playButton.click();
    await expect(await player.getPlayButtonText()).toMatch(/Pause/i, { timeout: 2000 });

    await page.waitForFunction(
      () => document.querySelector('[data-testid="time-display"]')?.textContent?.startsWith('0:00') === false,
      null,
      { timeout: 5000 }
    );
    const initialTime = await player.timeDisplay.textContent();
    expect(initialTime).not.toMatch(/^0:00 \//);

    await player.playButton.click();
    await expect(await player.getPlayButtonText()).toMatch(/Play/i);
    const timeAfterPause = await player.timeDisplay.textContent();
    await page.waitForTimeout(500);
    const timeAfterPauseAndDelay = await player.timeDisplay.textContent();
    expect(timeAfterPauseAndDelay).toBe(timeAfterPause);
  });

  test('should seek audio using the seek bar', async ({ page }) => {
    await player.loadAudioFile(TEST_AUDIO_FILE);
    await player.expectControlsToBeReadyForPlayback();
    await player.playButton.click();

    await page.waitForFunction(
        () => document.querySelector('[data-testid="time-display"]')?.textContent !== '0:00 / 0:00',
        null,
        {timeout: 5000}
    );

    const initialTimeText = await player.timeDisplay.textContent();
    const durationSeconds = parseTimeToSeconds(initialTimeText.split(' / ')[1]);
    expect(durationSeconds).toBeGreaterThan(0); // WAV file is short, adjust expectation

    const currentMax = parseFloat(await player.seekSliderInput.getAttribute('max')) || durationSeconds;
    await player.setSliderValue(player.seekSliderInput, String(currentMax / 2));

    await page.waitForTimeout(500);

    const timeAfterSeekText = await player.timeDisplay.textContent();
    const currentTimeAfterSeek = parseTimeToSeconds(timeAfterSeekText.split(' / ')[0]);
    const durationAfterSeek = parseTimeToSeconds(timeAfterSeekText.split(' / ')[1]);

    expect(currentTimeAfterSeek).toBeGreaterThanOrEqual(durationAfterSeek * 0.4);
    expect(currentTimeAfterSeek).toBeLessThanOrEqual(durationAfterSeek * 0.6);
    expect(await player.getPlayButtonText()).toMatch(/Pause/i);
  });

  test.describe('URL State Serialization', () => {
    test('should update URL when settings change', async ({ page }) => {
        await player.loadAudioFile(TEST_AUDIO_FILE);
        await player.expectControlsToBeReadyForPlayback();

        await player.setSliderValue(player.speedSliderInput, '1.5');
        await expect(page).toHaveURL(/speed=1.5/, { timeout: 2000 });

        await player.setSliderValue(player.pitchSliderInput, '2');
        await expect(page).toHaveURL(/pitch=2/, { timeout: 2000 });
        await expect(page).toHaveURL(/speed=1.5/);
    });

    test('should load settings from URL parameters on page load', async ({ page }) => {
        await player.page.goto(player.devServerUrl + '?speed=1.75&pitch=-3');
        await expect(player.appBarTitle).toHaveText('Vibe Player V2', { timeout: 15000 });
        await expect(player.fileInput).toBeVisible({timeout: 10000});

        await player.loadAudioFile(TEST_AUDIO_FILE);
        await player.expectControlsToBeReadyForPlayback();

        await expect(player.speedSliderInput).toHaveValue('1.75', { timeout: 2000 });
        await expect(player.pitchSliderInput).toHaveValue('-3', { timeout: 2000 });
    });
  });
});
