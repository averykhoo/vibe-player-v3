// tests-e2e/player.e2e.spec.js
import { test, expect } from '@playwright/test';
import { PlayerPage } from './PlayerPage.mjs';

function parseTimeToSeconds(timeStr) {
  if (!timeStr || !timeStr.includes(':') || timeStr.includes('NaN')) return 0;
  const parts = timeStr.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

// UPDATED: Paths are now relative to the server root, as they are in the static dir.
const TEST_AUDIO_FILE = 'test-audio/C.Noisy_Voice.wav';
const DTMF_TEST_AUDIO_FILE = 'test-audio/dtmf-123A456B789C(star)0(hex)D.mp3';

test.describe('Vibe Player V2 E2E', () => {
  let playerPage;

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') { // Only log errors to reduce noise
        console.error(`[Browser Console ERROR] ${msg.text()}`);
      }
    });
    playerPage = new PlayerPage(page);
    await playerPage.goto();
  });

  test('should load an audio file and enable playback controls', async ({ page }) => {
    await playerPage.loadAudioFile(TEST_AUDIO_FILE);
    await playerPage.expectControlsToBeReadyForPlayback();
  });

  test('should display initial time as "0:00 / 0:00" or similar', async () => {
    await playerPage.loadAudioFile(TEST_AUDIO_FILE);
    await playerPage.expectControlsToBeReadyForPlayback();
    await expect(playerPage.timeDisplay).toHaveText(/0:00 \/ [0-9]+:[0-9]{2}/, {timeout: 5000});
  });

  test('should play and pause audio', async ({ page }) => {
    await playerPage.loadAudioFile(TEST_AUDIO_FILE);
    await playerPage.expectControlsToBeReadyForPlayback();

    await expect(await playerPage.getPlayButtonText()).toMatch(/Play/i);

    await playerPage.playButton.click();
    await expect(await playerPage.getPlayButtonText()).toMatch(/Pause/i, { timeout: 2000 });

    await page.waitForFunction(
      () => document.querySelector('[data-testid="time-display"]')?.textContent?.startsWith('0:00') === false,
      null,
      { timeout: 5000 }
    );
    const initialTime = await playerPage.timeDisplay.textContent();
    expect(initialTime).not.toMatch(/^0:00 \//);

    await playerPage.playButton.click();
    await expect(await playerPage.getPlayButtonText()).toMatch(/Play/i);
    const timeAfterPause = await playerPage.timeDisplay.textContent();
    await page.waitForTimeout(500);
    const timeAfterPauseAndDelay = await playerPage.timeDisplay.textContent();
    expect(timeAfterPauseAndDelay).toBe(timeAfterPause);
  });

  test('should seek audio using the seek bar', async ({ page }) => {
    await playerPage.loadAudioFile(TEST_AUDIO_FILE);
    await playerPage.expectControlsToBeReadyForPlayback();
    await playerPage.playButton.click();

    await page.waitForFunction(
        () => document.querySelector('[data-testid="time-display"]')?.textContent !== '0:00 / 0:00',
        null,
        {timeout: 5000}
    );

    const initialTimeText = await playerPage.timeDisplay.textContent();
    const durationSeconds = parseTimeToSeconds(initialTimeText.split(' / ')[1]);
    expect(durationSeconds).toBeGreaterThan(0);

    const currentMax = parseFloat(await playerPage.seekSliderInput.getAttribute('max')) || durationSeconds;
    await playerPage.setSliderValue(playerPage.seekSliderInput, String(currentMax / 2));

    await page.waitForTimeout(500);

    const timeAfterSeekText = await playerPage.timeDisplay.textContent();
    const currentTimeAfterSeek = parseTimeToSeconds(timeAfterSeekText.split(' / ')[0]);
    const durationAfterSeek = parseTimeToSeconds(timeAfterSeekText.split(' / ')[1]);

    expect(currentTimeAfterSeek).toBeGreaterThanOrEqual(durationAfterSeek * 0.4);
    expect(currentTimeAfterSeek).toBeLessThanOrEqual(durationAfterSeek * 0.6);
    expect(await playerPage.getPlayButtonText()).toMatch(/Pause/i);
  });

  test('should detect and display DTMF tones', async ({ page }) => {
    await playerPage.loadAudioFile(DTMF_TEST_AUDIO_FILE);
    await playerPage.expectControlsToBeReadyForPlayback();

    const dtmfDisplaySelector = 'div.card:has(h3:text("Detected Tones")) p.font-mono';
    const dtmfDisplayElement = playerPage.page.locator(dtmfDisplaySelector);

    const expectedDtmfSequence = "1 2 3 A 4 5 6 B 7 8 9 C * 0 # D";

    await expect(dtmfDisplayElement).toHaveText(expectedDtmfSequence, { timeout: 15000 });
  });

  test.describe('URL State Serialization', () => {
    test('should update URL when settings change', async ({ page }) => {
        await playerPage.loadAudioFile(TEST_AUDIO_FILE);
        await playerPage.expectControlsToBeReadyForPlayback();

        await playerPage.setSliderValue(playerPage.speedSliderInput, '1.5');
        await expect(page).toHaveURL(/speed=1.50/, { timeout: 2000 });

        await playerPage.setSliderValue(playerPage.pitchSliderInput, '2');
        await expect(page).toHaveURL(/pitch=2.0/, { timeout: 2000 });
        await expect(page).toHaveURL(/speed=1.50/);
    });

    test('should load settings from URL parameters on page load', async ({ page }) => {
        await playerPage.page.goto(playerPage.devServerUrl + '?speed=1.75&pitch=-3');
        await expect(playerPage.appBarTitle).toHaveText('Vibe Player V2', { timeout: 15000 });
        await expect(playerPage.fileInput).toBeVisible({timeout: 10000});

        await playerPage.loadAudioFile(TEST_AUDIO_FILE);
        await playerPage.expectControlsToBeReadyForPlayback();

        await expect(playerPage.speedSliderInput).toHaveValue('1.75', { timeout: 2000 });
        await expect(playerPage.pitchSliderInput).toHaveValue('-3', { timeout: 2000 });
    });
  });
});
