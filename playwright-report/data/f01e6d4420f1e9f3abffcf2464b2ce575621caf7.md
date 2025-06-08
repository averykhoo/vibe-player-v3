# Test info

- Name: Vibe Player End-to-End >> should load an audio file and enable playback controls
- Location: /app/tests-e2e/player.e2e.spec.js:20:3

# Error details

```
Error: browserType.launch: Executable doesn't exist at /home/jules/.cache/ms-playwright/chromium_headless_shell-1169/chrome-linux/headless_shell
╔═════════════════════════════════════════════════════════════════════════╗
║ Looks like Playwright Test or Playwright was just installed or updated. ║
║ Please run the following command to download new browsers:              ║
║                                                                         ║
║     npx playwright install                                              ║
║                                                                         ║
║ <3 Playwright Team                                                      ║
╚═════════════════════════════════════════════════════════════════════════╝
```

# Test source

```ts
   1 | // tests-e2e/player.e2e.spec.js
   2 | const { test, expect } = require('@playwright/test');
   3 | const { PlayerPage } = require('./PlayerPage');
   4 |
   5 | // Helper function at the top of player.e2e.spec.js
   6 | function parseTimeToSeconds(timeStr) {
   7 |   if (!timeStr || !timeStr.includes(':')) return 0;
   8 |   const parts = timeStr.split(':');
   9 |   return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
   10 | }
   11 |
   12 | test.describe('Vibe Player End-to-End', () => {
   13 |   let player;
   14 |
   15 |   test.beforeEach(async ({ page }) => {
   16 |     player = new PlayerPage(page);
   17 |     await player.goto();
   18 |   });
   19 |
>  20 |   test('should load an audio file and enable playback controls', async () => {
      |   ^ Error: browserType.launch: Executable doesn't exist at /home/jules/.cache/ms-playwright/chromium_headless_shell-1169/chrome-linux/headless_shell
   21 |     await expect(player.playPauseButton).toBeDisabled();
   22 |     await expect(player.fileNameDisplay).toHaveText('');
   23 |     await player.loadAudioFile('IELTS13-Tests1-4CD1Track_01.mp3');
   24 |     await player.expectFileName('IELTS13-Tests1-4CD1Track_01.mp3');
   25 |     await player.expectControlsToBeEnabled();
   26 |   });
   27 |
   28 |   test('should correctly detect and display DTMF tones', async () => {
   29 |     await player.loadAudioFile('dtmf-123A456B789C(star)0(hex)D.mp3');
   30 |     await player.expectControlsToBeEnabled();
   31 |     await expect(player.dtmfDisplay).toContainText('1, 2, 3, A, 4, 5, 6, B, 7, 8, 9, C, *, 0, #, D', { timeout: 15000 });
   32 |   });
   33 |
   34 |   test('should correctly detect and display Call Progress Tones', async () => {
   35 |     await player.loadAudioFile('Dial DTMF sound _Busy Tone_ (480Hz+620Hz) [OnlineSound.net].mp3');
   36 |     await player.expectControlsToBeEnabled();
   37 |     await expect(player.cptDisplay).toContainText('Fast Busy / Reorder Tone', { timeout: 15000 });
   38 |   });
   39 |
   40 |   test('should display initial time as 0:00 / 0:00', async () => {
   41 |     await expect(player.timeDisplay).toHaveText('0:00 / 0:00');
   42 |   });
   43 |
   44 |   test('should play and pause audio', async ({ page }) => {
   45 |     await player.loadAudioFile('IELTS13-Tests1-4CD1Track_01.mp3'); // A short file
   46 |     await player.expectControlsToBeEnabled();
   47 |
   48 |     // Check initial button text is 'Play'
   49 |     await expect(player.playPauseButton).toHaveText('Play');
   50 |
   51 |     // Click Play
   52 |     await player.playPauseButton.click();
   53 |     await expect(player.playPauseButton).toHaveText('Pause'); // Assuming text changes
   54 |
   55 |     // Wait for time to advance - check that current time is not 0:00
   56 |     // This requires the audio to actually play and time to update.
   57 |     // We might need a small delay or a more robust way to check time advancement.
   58 |     await page.waitForFunction(() => document.getElementById('timeDisplay').textContent?.startsWith('0:00') === false, null, { timeout: 5000 });
   59 |     const initialTime = await player.timeDisplay.textContent();
   60 |     expect(initialTime).not.toBe('0:00 / 0:00'); // Or more specific check if duration is known
   61 |     expect(initialTime?.startsWith('0:00')).toBe(false); // Current time should not be 0:00
   62 |
   63 |     // Click Pause
   64 |     await player.playPauseButton.click();
   65 |     await expect(player.playPauseButton).toHaveText('Play');
   66 |     const timeAfterPause = await player.timeDisplay.textContent();
   67 |     await page.waitForTimeout(500); // Wait again
   68 |     const timeAfterPauseAndDelay = await player.timeDisplay.textContent();
   69 |     expect(timeAfterPauseAndDelay).toBe(timeAfterPause); // Time should not change after pause
   70 |   });
   71 |
   72 |   test('should seek audio using the seek bar', async ({ page }) => {
   73 |     // This test assumes IELTS13-Tests1-4CD1Track_01.mp3 is longer than a few seconds
   74 |     await player.loadAudioFile('IELTS13-Tests1-4CD1Track_01.mp3');
   75 |     await player.expectControlsToBeEnabled();
   76 |     await player.playPauseButton.click(); // Start playback
   77 |
   78 |     // Wait for some playback to ensure duration is loaded and displayed
   79 |     await page.waitForFunction(() => document.getElementById('timeDisplay').textContent !== '0:00 / 0:00');
   80 |
   81 |     const initialTimeText = await player.timeDisplay.textContent();
   82 |     const durationSeconds = parseTimeToSeconds(initialTimeText.split(' / ')[1]);
   83 |     expect(durationSeconds).toBeGreaterThan(5); // Ensure file is reasonably long
   84 |
   85 |     // Seek to middle
   86 |     await player.seekToMiddle(); // This is the new method in PlayerPage
   87 |     await page.waitForTimeout(200); // Allow time for UI to update after seek
   88 |
   89 |     const timeAfterSeekText = await player.timeDisplay.textContent();
   90 |     const currentTimeAfterSeek = parseTimeToSeconds(timeAfterSeekText.split(' / ')[0]);
   91 |     const durationAfterSeek = parseTimeToSeconds(timeAfterSeekText.split(' / ')[1]);
   92 |
   93 |     // Expect current time to be roughly half of duration, allow some tolerance
   94 |     // This also verifies duration is still displayed correctly
   95 |     expect(currentTimeAfterSeek).toBeGreaterThanOrEqual(durationAfterSeek * 0.4);
   96 |     expect(currentTimeAfterSeek).toBeLessThanOrEqual(durationAfterSeek * 0.6);
   97 |     await expect(player.playPauseButton).toHaveText('Pause', { timeout: 2000 }); // Should still be playing
   98 |   });
   99 |
  100 |   test('should jump forward and backward', async ({ page }) => {
  101 |     await player.loadAudioFile('IELTS13-Tests1-4CD1Track_01.mp3');
  102 |     await player.expectControlsToBeEnabled();
  103 |     await player.playPauseButton.click(); // Start playing
  104 |
  105 |     // Wait for a couple of seconds of playback
  106 |     await page.waitForFunction(() => {
  107 |       const timeParts = document.getElementById('timeDisplay').textContent?.split(' / ')[0].split(':');
  108 |       if (!timeParts || timeParts.length < 2) return false;
  109 |       const currentTime = parseInt(timeParts[0], 10) * 60 + parseInt(timeParts[1], 10);
  110 |       return currentTime >= 2;
  111 |     }, null, { timeout: 10000 });
  112 |
  113 |     let currentTimeText = await player.timeDisplay.textContent();
  114 |     let currentTimeSeconds = parseTimeToSeconds(currentTimeText.split(' / ')[0]);
  115 |
  116 |     // Jump forward (default 5s)
  117 |     await player.jumpForward.click();
  118 |     await page.waitForTimeout(200); // Allow UI to update
  119 |     let timeAfterForwardJumpText = await player.timeDisplay.textContent();
  120 |     let timeAfterForwardJumpSeconds = parseTimeToSeconds(timeAfterForwardJumpText.split(' / ')[0]);
```