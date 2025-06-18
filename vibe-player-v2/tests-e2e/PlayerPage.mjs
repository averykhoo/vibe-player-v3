// vibe-player-v2/tests-e2e/PlayerPage.mjs
import { expect } from "@playwright/test";

export class PlayerPage {
  /**
   * A Page Object Model for the Vibe Player V2 application.
   * Encapsulates locators and actions for interacting with the player UI.
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;
    this.devServerUrl = "http://localhost:4173/";
    this.appBarTitle = page.getByTestId("app-bar-title");
    this.fileInput = page.locator('input[type="file"]');
    this.fileNameDisplay = page.getByTestId("file-name-display");
    this.fileStatusDisplay = page.getByTestId("file-status-display");
    this.fileErrorDisplay = page.getByTestId("file-error-display");
    this.playButton = page.getByTestId("play-button");
    this.stopButton = page.getByTestId("stop-button");
    this.timeDisplay = page.getByTestId("time-display");
    this.seekSliderInput = page.getByTestId("seek-slider-input");
    this.speedSliderInput = page.getByTestId("speed-slider-input");
    this.speedValueDisplay = page.getByTestId("speed-value");
    this.pitchSliderInput = page.getByTestId("pitch-slider-input");
    this.pitchValueDisplay = page.getByTestId("pitch-value");
    this.gainSliderInput = page.getByTestId("gain-slider-input");
    this.gainValueDisplay = page.getByTestId("gain-value");
    this.vadPositiveSliderInput = page.getByTestId("vad-positive-slider-input");
    this.vadPositiveValueDisplay = page.getByTestId("vad-positive-value");
    this.vadNegativeSliderInput = page.getByTestId("vad-negative-slider-input");
    this.vadNegativeValueDisplay = page.getByTestId("vad-negative-value");
    this.dtmfDisplay = page.getByTestId("dtmf-display");
  }

  /**
   * Navigates to the application's base URL and verifies the page has loaded.
   */
  async goto() {
    await this.page.goto(this.devServerUrl);
    await expect(this.appBarTitle).toHaveText("Vibe Player V2", {
      timeout: 15000,
    });
    await expect(this.fileInput).toBeVisible({ timeout: 10000 });
  }

  /**
   * Loads an audio file using the file input.
   * @param {string} fileName - The path to the file within the 'static' directory.
   */
  async loadAudioFile(fileName) {
    const filePath = `static/${fileName}`;
    await this.fileInput.setInputFiles(filePath);
  }

  /**
   * Waits for the UI to be in a state where playback is possible after a file load.
   */
  async expectControlsToBeReadyForPlayback() {
    await expect(this.fileStatusDisplay).toHaveText(/Ready/, {
      timeout: 20000,
    });
    await expect(
      this.timeDisplay,
      "Time display did not update with audio duration",
    ).not.toHaveText("0:00 / 0:00", { timeout: 1000 });
    await expect(
      this.playButton,
      "Play button was not enabled after file load",
    ).toBeEnabled({
      timeout: 1000,
    });
  }

  /**
   * Gets the current text content of the play/pause button.
   * @returns {Promise<string|null>}
   */
  async getPlayButtonText() {
    return this.playButton.textContent();
  }

  /**
   * Sets the value of a slider by calculating the click position based on the desired value.
   * @param {import('@playwright/test').Locator} sliderInputLocator - The locator for the slider's <input type="range"> element.
   * @param {string} valueStr - The target value as a string (e.g., "1.5").
   */
  async setSliderValue(sliderInputLocator, valueStr) {
    const targetValue = parseFloat(valueStr);
    const boundingBox = await sliderInputLocator.boundingBox();
    if (!boundingBox) throw new Error(`Could not get bounding box for slider.`);

    const { min, max } = await sliderInputLocator.evaluate((el) => ({
        min: parseFloat(el.getAttribute('min') || '0'),
        max: parseFloat(el.getAttribute('max') || '100')
    }));

    const ratio = (targetValue - min) / (max - min);
    // Ensure ratio is within [0, 1] to prevent clicking outside the slider track for out-of-bound values
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    const clickX = boundingBox.x + boundingBox.width * clampedRatio;
    const clickY = boundingBox.y + boundingBox.height / 2;

    await this.page.mouse.click(clickX, clickY);
    await this.page.waitForTimeout(350); // Allow for debounced updates
  }

  /**
   * Gets the current value of a slider input.
   * @param {import('@playwright/test').Locator} sliderInputLocator
   * @returns {Promise<string>}
   */
  async getSliderInputValue(sliderInputLocator) {
    return sliderInputLocator.inputValue();
  }
}
