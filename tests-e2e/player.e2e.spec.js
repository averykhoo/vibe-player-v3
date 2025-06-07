// tests-e2e/player.e2e.spec.js
const { test, expect } = require('@playwright/test');
const { PlayerPage } = require('./PlayerPage');

// Helper function at the top of player.e2e.spec.js
function parseTimeToSeconds(timeStr) {
  if (!timeStr || !timeStr.includes(':')) return 0;
  const parts = timeStr.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

test.describe('Vibe Player End-to-End', () => {
  let player;

  test.beforeEach(async ({ page }) => {
    player = new PlayerPage(page);
    await player.goto();
  });

  test('should load an audio file and enable playback controls', async () => {
    await expect(player.playPauseButton).toBeDisabled();
    await expect(player.fileNameDisplay).toHaveText('');
    await player.loadAudioFile('IELTS13-Tests1-4CD1Track_01.mp3');
    await player.expectFileName('IELTS13-Tests1-4CD1Track_01.mp3');
    await player.expectControlsToBeEnabled();
  });

  test('should correctly detect and display DTMF tones', async () => {
    await player.loadAudioFile('dtmf-123A456B789C(star)0(hex)D.mp3');
    await player.expectControlsToBeEnabled();
    await expect(player.dtmfDisplay).toContainText('1, 2, 3, A, 4, 5, 6, B, 7, 8, 9, C, *, 0, #, D', { timeout: 15000 });
  });

  test('should correctly detect and display Call Progress Tones', async () => {
    await player.loadAudioFile('Dial DTMF sound _Busy Tone_ (480Hz+620Hz) [OnlineSound.net].mp3');
    await player.expectControlsToBeEnabled();
    await expect(player.cptDisplay).toContainText('Fast Busy / Reorder Tone', { timeout: 15000 });
  });

  test('should display initial time as 0:00 / 0:00', async () => {
    await expect(player.timeDisplay).toHaveText('0:00 / 0:00');
  });

  test('should play and pause audio', async ({ page }) => {
    await player.loadAudioFile('IELTS13-Tests1-4CD1Track_01.mp3'); // A short file
    await player.expectControlsToBeEnabled();

    // Check initial button text is 'Play'
    await expect(player.playPauseButton).toHaveText('Play');

    // Click Play
    await player.playPauseButton.click();
    await expect(player.playPauseButton).toHaveText('Pause'); // Assuming text changes

    // Wait for time to advance - check that current time is not 0:00
    // This requires the audio to actually play and time to update.
    // We might need a small delay or a more robust way to check time advancement.
    await page.waitForTimeout(500); // Wait for 0.5 second of playback
    const initialTime = await player.timeDisplay.textContent();
    expect(initialTime).not.toBe('0:00 / 0:00'); // Or more specific check if duration is known
    expect(initialTime?.startsWith('0:00')).toBe(false); // Current time should not be 0:00

    // Click Pause
    await player.playPauseButton.click();
    await expect(player.playPauseButton).toHaveText('Play');
    const timeAfterPause = await player.timeDisplay.textContent();
    await page.waitForTimeout(500); // Wait again
    const timeAfterPauseAndDelay = await player.timeDisplay.textContent();
    expect(timeAfterPauseAndDelay).toBe(timeAfterPause); // Time should not change after pause
  });

  test('should seek audio using the seek bar', async ({ page }) => {
    // This test assumes IELTS13-Tests1-4CD1Track_01.mp3 is longer than a few seconds
    await player.loadAudioFile('IELTS13-Tests1-4CD1Track_01.mp3');
    await player.expectControlsToBeEnabled();
    await player.playPauseButton.click(); // Start playback

    // Wait for some playback to ensure duration is loaded and displayed
    await page.waitForFunction(() => document.getElementById('timeDisplay').textContent !== '0:00 / 0:00');

    const initialTimeText = await player.timeDisplay.textContent();
    const durationSeconds = parseTimeToSeconds(initialTimeText.split(' / ')[1]);
    expect(durationSeconds).toBeGreaterThan(5); // Ensure file is reasonably long

    // Seek to middle
    await player.seekToMiddle(); // This is the new method in PlayerPage
    await page.waitForTimeout(200); // Allow time for UI to update after seek

    const timeAfterSeekText = await player.timeDisplay.textContent();
    const currentTimeAfterSeek = parseTimeToSeconds(timeAfterSeekText.split(' / ')[0]);
    const durationAfterSeek = parseTimeToSeconds(timeAfterSeekText.split(' / ')[1]);

    // Expect current time to be roughly half of duration, allow some tolerance
    // This also verifies duration is still displayed correctly
    expect(currentTimeAfterSeek).toBeGreaterThanOrEqual(durationAfterSeek * 0.4);
    expect(currentTimeAfterSeek).toBeLessThanOrEqual(durationAfterSeek * 0.6);
    expect(player.playPauseButton).toHaveText('Pause'); // Should still be playing
  });

  test('should jump forward and backward', async ({ page }) => {
    await player.loadAudioFile('IELTS13-Tests1-4CD1Track_01.mp3');
    await player.expectControlsToBeEnabled();
    await player.playPauseButton.click(); // Start playing

    // Wait for a couple of seconds of playback
    await page.waitForFunction(() => {
      const timeParts = document.getElementById('timeDisplay').textContent?.split(' / ')[0].split(':');
      if (!timeParts || timeParts.length < 2) return false;
      const currentTime = parseInt(timeParts[0], 10) * 60 + parseInt(timeParts[1], 10);
      return currentTime >= 2;
    }, null, { timeout: 10000 });

    let currentTimeText = await player.timeDisplay.textContent();
    let currentTimeSeconds = parseTimeToSeconds(currentTimeText.split(' / ')[0]);

    // Jump forward (default 5s)
    await player.jumpForward.click();
    await page.waitForTimeout(200); // Allow UI to update
    let timeAfterForwardJumpText = await player.timeDisplay.textContent();
    let timeAfterForwardJumpSeconds = parseTimeToSeconds(timeAfterForwardJumpText.split(' / ')[0]);
    expect(timeAfterForwardJumpSeconds).toBeCloseTo(currentTimeSeconds + 5, 0); // Allow 0 decimal places tolerance

    currentTimeSeconds = timeAfterForwardJumpSeconds; // Update current time

    // Jump backward
    await player.jumpBack.click();
    await page.waitForTimeout(200); // Allow UI to update
    let timeAfterBackwardJumpText = await player.timeDisplay.textContent();
    let timeAfterBackwardJumpSeconds = parseTimeToSeconds(timeAfterBackwardJumpText.split(' / ')[0]);
    expect(timeAfterBackwardJumpSeconds).toBeCloseTo(currentTimeSeconds - 5, 0);
  });
});
