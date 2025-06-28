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
    this.hiddenFileInput = page.locator('#hiddenAudioFile');
    // ADDED: Locator for the file info status text
    this.fileInfoStatus = page.locator('#fileInfo');
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
    // REFACTORED: Wait for a more reliable signal of app initialization.
    // The uiManager sets this text to "No file selected." once it's fully ready.
    // This is much more robust than waiting for a static element to be visible.
    await expect(this.fileInfoStatus).toHaveText("No file selected.", { timeout: 10000 });
  }

  async loadAudioFile(fileName) {
    // This is the idiomatic and more robust way to handle file uploads in Playwright.
    // It targets the hidden input element directly and doesn't rely on clicking
    // the proxy button, which avoids the timeout issue.
    // Playwright's setInputFiles will correctly trigger the 'change' event
    // on the input that the application's uiManager is listening for.
    await this.hiddenFileInput.setInputFiles(path.join(__dirname, `../test-audio/${fileName}`));
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
