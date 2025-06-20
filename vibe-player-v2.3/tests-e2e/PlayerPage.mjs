// vibe-player-v2.3/tests-e2e/PlayerPage.mjs
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
    await expect(
      this.timeDisplay,
      "Time display did not update with audio duration",
    ).not.toHaveText("0:00 / 0:00", { timeout: 10000 });
    await expect(
      this.playButton,
      "Play button was not enabled after file load",
    ).toBeEnabled({
      timeout: 5000,
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
    const slider = await sliderInputLocator.boundingBox();
    if (!slider) throw new Error("Could not get bounding box for slider.");

    const max = parseFloat(
      (await sliderInputLocator.getAttribute("max")) || "1",
    );
    const ratio = targetValue / max;
    const x = slider.width * ratio;

    await sliderInputLocator.click({
      position: { x: x, y: slider.height / 2 },
    });
    // Allow a brief moment for the service and store to update
    await this.page.waitForTimeout(200);
  }

  /**
   * Gets the current value of a slider input.
   * @param {import('@playwright/test').Locator} sliderInputLocator
   * @returns {Promise<string>}
   */
  async getSliderInputValue(sliderInputLocator) {
    return sliderInputLocator.inputValue();
  }

  /**
   * Gets the current playback time from the time display element.
   * Assumes the time display format is "currentTimeFormatted / durationFormatted".
   * @returns {Promise<number>} The current time in seconds.
   */
  async getCurrentTime() {
    const timeDisplayText = await this.timeDisplay.textContent();
    if (!timeDisplayText)
      throw new Error("Time display text content is empty or null.");

    const timeParts = timeDisplayText.split(" / ");
    if (timeParts.length < 1)
      throw new Error(`Unexpected time display format: ${timeDisplayText}`);

    const currentTimeStr = timeParts[0].trim(); // "M:SS" or "H:MM:SS"
    const segments = currentTimeStr.split(":").map(Number);
    let currentTimeInSeconds = 0;
    if (segments.length === 3) {
      // H:MM:SS
      currentTimeInSeconds =
        segments[0] * 3600 + segments[1] * 60 + segments[2];
    } else if (segments.length === 2) {
      // M:SS
      currentTimeInSeconds = segments[0] * 60 + segments[1];
    } else if (segments.length === 1) {
      // SS (less likely for current time but robust)
      currentTimeInSeconds = segments[0];
    } else {
      throw new Error(
        `Unexpected current time segment format: ${currentTimeStr}`,
      );
    }
    return currentTimeInSeconds;
  }
}
