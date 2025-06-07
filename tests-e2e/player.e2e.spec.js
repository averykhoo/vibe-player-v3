// tests-e2e/player.e2e.spec.js
const { test, expect } = require('@playwright/test');
const { PlayerPage } = require('./PlayerPage');

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
    await expect(player.cptDisplay).toContainText('Busy Signal', { timeout: 15000 });
  });
});
