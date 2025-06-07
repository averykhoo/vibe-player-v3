// tests-e2e/PlayerPage.js
const { expect } = require('@playwright/test');
const path = require('path');

exports.PlayerPage = class PlayerPage {
  constructor(page) {
    this.page = page;

    // --- Define UI Element Locators Here ---
    this.playPauseButton = page.locator('#playPause');
    this.fileNameDisplay = page.locator('#fileNameDisplay');
    this.dtmfDisplay = page.locator('#dtmfDisplay');
    this.cptDisplay = page.locator('#cpt-display-content');
    this.chooseFileButton = page.locator('#chooseFileButton');
    this.timeDisplay = page.locator('#timeDisplay');
    this.seekBar = page.locator('#seekBar');
    this.jumpBack = page.locator('#jumpBack');
    this.jumpForward = page.locator('#jumpForward');
    this.jumpTimeInput = page.locator('#jumpTime');
  }

  // --- Define User Actions Here ---
  async goto() {
    // Assumes server is running on localhost:8080
    await this.page.goto('http://localhost:8080/');
  }

  async loadAudioFile(fileName) {
    const fileChooserPromise = this.page.waitForEvent('filechooser');
    await this.chooseFileButton.click();
    const fileChooser = await fileChooserPromise;
    // NOTE: This assumes test-audio is at the project root. Adjust if needed.
    await fileChooser.setFiles(path.join(__dirname, `../test-audio/${fileName}`));
  }

  // --- Define Test Assertions Here ---
  async expectControlsToBeEnabled() {
    await expect(this.playPauseButton).toBeEnabled({ timeout: 20000 });
  }

  async expectFileName(fileName) {
    await expect(this.fileNameDisplay).toHaveText(fileName);
  }

  async seekToMiddle() {
    await this.seekBar.click(); // Playwright clicks in the center by default
  }
};
