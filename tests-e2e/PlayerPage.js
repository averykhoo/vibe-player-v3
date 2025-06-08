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
    // ADDED: Explicitly wait for a key UI element to be ready.
    // This ensures that all the app's JavaScript, including event listeners,
    // has been initialized before the test proceeds.
    await this.chooseFileButton.waitFor({ state: 'visible', timeout: 10000 });
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
