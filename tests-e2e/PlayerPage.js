// tests-e2e/PlayerPage.js
const { expect } = require('@playwright/test');
const path = require('path');

exports.PlayerPage = class PlayerPage {
  constructor(page) {
    this.page = page;
    this.devServerUrl = 'http://localhost:4173/'; // CHANGED TO 4173

    // FIX: Changed from a fragile CSS selector to a stable data-testid attribute
    this.appBarTitle = page.getByTestId('app-bar-title');

    // FileLoader.svelte locators (assuming data-testid attributes will be added)
    this.fileInput = page.locator('input[type="file"]'); // General locator, refine if possible
    this.fileNameDisplay = page.getByTestId('file-name-display');
    this.fileStatusDisplay = page.getByTestId('file-status-display');
    this.fileErrorDisplay = page.getByTestId('file-error-display');

    // Controls.svelte locators (assuming data-testid attributes)
    this.playButton = page.getByTestId('play-button'); // Should toggle text Play/Pause
    this.stopButton = page.getByTestId('stop-button');
    this.timeDisplay = page.getByTestId('time-display');

    this.seekSliderInput = page.getByTestId('seek-slider-input');

    this.speedSliderInput = page.getByTestId('speed-slider-input');
    this.speedValueDisplay = page.getByTestId('speed-value');

    this.pitchSliderInput = page.getByTestId('pitch-slider-input');
    this.pitchValueDisplay = page.getByTestId('pitch-value');

    this.gainSliderInput = page.getByTestId('gain-slider-input');
    this.gainValueDisplay = page.getByTestId('gain-value');

    this.vadPositiveSliderInput = page.getByTestId('vad-positive-slider-input');
    this.vadPositiveValueDisplay = page.getByTestId('vad-positive-value');

    this.vadNegativeSliderInput = page.getByTestId('vad-negative-slider-input');
    this.vadNegativeValueDisplay = page.getByTestId('vad-negative-value');
  }

  async goto() {
    await this.page.goto(this.devServerUrl);
    await expect(this.appBarTitle).toHaveText('Vibe Player V2', { timeout: 15000 });
    // Wait for the file input to be visible as a sign of FileLoader.svelte being ready
    await expect(this.fileInput).toBeVisible({timeout: 10000});
  }

  async loadAudioFile(fileName) {
    // FIX: Corrected relative path from `../../` to `../`
    const filePath = path.resolve(__dirname, '../test-audio/', fileName); // Path relative to PlayerPage.js
    await this.fileInput.setInputFiles(filePath);
    // Add a small wait for file processing to start, if necessary
    await this.page.waitForTimeout(200);
  }

  async expectControlsToBeReadyForPlayback() {
    await expect(this.playButton).toBeEnabled({ timeout: 20000 });
  }

  async getPlayButtonText() {
    return this.playButton.textContent(); // Assumes button text changes Play/Pause
  }

  async setSliderValue(sliderInputLocator, value) {
    await sliderInputLocator.fill(String(value));
    await sliderInputLocator.dispatchEvent('input'); // For live updates if component listens to input
    await sliderInputLocator.dispatchEvent('change'); // For final value commit
    await this.page.waitForTimeout(150); // Allow UI to react
  }

  async getSliderInputValue(sliderInputLocator) { // Renamed to avoid conflict with Playwright's own getValue
    return sliderInputLocator.inputValue();
  }
};
