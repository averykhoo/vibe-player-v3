// vibe-player-v2.3/tests-e2e/PlayerPage.mjs
import { expect } from "@playwright/test";

export class PlayerPage {
  /**
   * A Page Object Model for the Vibe Player V2 application.
   * Encapsulates locators and actions for interacting with the player UI.
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    console.log("[Test Runner Log] Initializing PlayerPage object.");
    this.page = page;
    this.devServerUrl = "http://localhost:4173/";

    // --- Locators ---
    this.appBarTitle = page.getByTestId("app-bar-title");
    this.fileInput = page.getByLabel("Load Audio File");
    this.fileNameDisplay = page.getByTestId("file-name-display");
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
    this.dtmfDisplay = page.getByTestId("dtmf-display");
    console.log("[Test Runner Log] PlayerPage locators initialized.");
  }

  /**
   * Navigates to the application's base URL and verifies the page has loaded.
   */
  async goto() {
    console.log(`[Test Runner Log] Navigating to page: ${this.devServerUrl}`);
    await this.page.goto(this.devServerUrl);
    await expect(this.appBarTitle).toHaveText("Vibe Player V2.3", {
      timeout: 15000,
    });
    await expect(this.fileInput).toBeVisible({ timeout: 10000 });
    console.log("[Test Runner Log] Page navigation and initial load confirmed.");
  }

  /**
   * Loads an audio file using the file input.
   * @param {string} fileName - The path to the file, usually within the 'static' directory.
   */
  async loadAudioFile(fileName) {
    const filePath = `${fileName}`;
    console.log(`[Test Runner Log] Loading audio file from path: ${filePath}`);
    await this.fileInput.setInputFiles(filePath);
    console.log(`[Test Runner Log] File input set for: ${fileName}`);
  }

  /**
   * --- THIS IS THE RESTORED METHOD ---
   * Waits for the UI to be in a state where playback is possible after a file load.
   */
  async expectControlsToBeReadyForPlayback() {
    console.log("[Test Runner Log] Waiting for controls to be ready for playback...");
    // The single, most reliable indicator that the application is fully ready for playback
    // is that the play button has become enabled. We wait for this state directly.
    await expect(
      this.playButton,
      "Play button was not enabled after file load",
    ).toBeEnabled({
      timeout: 15000,
    });
    console.log("[Test Runner Log] Play button is enabled.");

    // After the button is enabled, we can safely and quickly check other post-load states.
    await expect(
      this.timeDisplay,
      "Time display did not update with audio duration",
    ).not.toHaveText("0:00 / 0:00", { timeout: 1000 });
    console.log("[Test Runner Log] Time display has updated. Controls are ready.");
  }

  /**
   * Gets the current text content of the play/pause button.
   * @returns {Promise<string|null>}
   */
  async getPlayButtonText() {
    console.log("[Test Runner Log] Getting play button text content.");
    const text = await this.playButton.textContent();
    console.log(`[Test Runner Log] Play button text is: "${text}"`);
    return text;
  }

  /**
   * Sets the value of a real-time control slider (e.g., Speed, Pitch, Gain) by
   * calculating the position and performing a single click.
   * @param {import('@playwright/test').Locator} sliderInputLocator - The locator for the slider's <input type="range"> element.
   * @param {string} valueStr - The target value as a string (e.g., "1.5").
   */
  async setSliderValue(sliderInputLocator, valueStr) {
    const testId = await sliderInputLocator.getAttribute("data-testid");
    console.log(`[Test Runner Log] Setting value on real-time slider '${testId}' to: ${valueStr}`);

    const targetValue = parseFloat(valueStr);
    const slider = await sliderInputLocator.boundingBox();
    if (!slider) {
      throw new Error(`Could not get bounding box for slider '${testId}'`);
    }

    const min = parseFloat((await sliderInputLocator.getAttribute("min")) || "0");
    const max = parseFloat((await sliderInputLocator.getAttribute("max")) || "1");
    const ratio = (targetValue - min) / (max - min);
    const x = slider.width * ratio;

    await sliderInputLocator.click({
      position: { x: x, y: slider.height / 2 },
    });
    console.log(`[Test Runner Log] Clicked '${testId}' at position corresponding to value ${valueStr}.`);
  }

  /**
   * Gets the current playback time from the time display element.
   * @returns {Promise<number>} The current time in seconds.
   */
  async getCurrentTime() {
    console.log("[Test Runner Log] Getting current time from display.");
    const timeDisplayText = await this.timeDisplay.textContent();
    if (!timeDisplayText) throw new Error("Time display text content is empty or null.");

    const currentTimeStr = timeDisplayText.split(" / ")[0].trim();
    const segments = currentTimeStr.split(":").map(Number);
    let currentTimeInSeconds = 0;

    if (segments.length === 2) { // M:SS
      currentTimeInSeconds = segments[0] * 60 + segments[1];
    } else if (segments.length === 3) { // H:MM:SS
      currentTimeInSeconds = segments[0] * 3600 + segments[1] * 60 + segments[2];
    } else {
      throw new Error(`Unexpected current time segment format: ${currentTimeStr}`);
    }
    console.log(`[Test Runner Log] Parsed current time as: ${currentTimeInSeconds} seconds.`);
    return currentTimeInSeconds;
  }

  /**
   * Performs a robust, multi-stage interactive seek on the main seek slider's wrapper div.
   * @param {number} targetTime The time in seconds to seek to.
   */
  async performInteractiveSeek(targetTime) {
    const testId = await this.seekSliderInput.getAttribute("data-testid");
    console.log(`[Test Runner Log] Starting interactive seek on '${testId}' to value: ${targetTime}`);
    
    const sliderWrapper = this.seekSliderInput.locator('..');

    await sliderWrapper.evaluate((wrapper, { value }) => {
      const browserLog = (message) => console.log(`[Browser-Side Log] ${message}`);
      const sliderInput = wrapper.querySelector('input[type="range"]');
      if (!sliderInput) throw new Error("Could not find slider input inside wrapper");

      browserLog("Dispatching 'mousedown' event on wrapper...");
      wrapper.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      browserLog(`Setting slider value to ${value} and dispatching 'input' event.`);
      sliderInput.value = String(value);
      sliderInput.dispatchEvent(new Event('input', { bubbles: true }));

      browserLog("Dispatching 'mouseup' event on wrapper.");
      wrapper.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    }, { value: targetTime });

    console.log(`[Test Runner Log] Finished interactive seek on '${testId}'.`);
  }

  /**
   * Gets the total duration from the time display element.
   * @returns {Promise<number>} The total duration in seconds.
   */
  async getDuration() {
    console.log("[Test Runner Log] Getting total duration from display.");
    const timeDisplayText = await this.timeDisplay.textContent();
    if (!timeDisplayText) throw new Error("Time display text is empty.");

    const durationStr = timeDisplayText.split(" / ")[1].trim();
    const segments = durationStr.split(":").map(Number);
    let durationInSeconds = 0;

    if (segments.length === 2) { // M:SS
      durationInSeconds = segments[0] * 60 + segments[1];
    } else if (segments.length === 3) { // H:MM:SS
      durationInSeconds = segments[0] * 3600 + segments[1] * 60 + segments[2];
    } else {
      throw new Error(`Unexpected duration segment format: ${durationStr}`);
    }
    console.log(`[Test Runner Log] Parsed duration as: ${durationInSeconds} seconds.`);
    return durationInSeconds;
  }

  /**
   * Formats seconds into a "M:SS" string for exact text matching in assertions.
   * @param {number} sec - Time in seconds.
   * @returns {string} The formatted time string.
   */
  formatTimeForAssertion(sec) {
    if (isNaN(sec) || sec < 0) sec = 0;
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    const formatted = `${minutes}:${seconds < 10 ? "0" + seconds : seconds}`;
    console.log(`[Test Runner Log] Formatted time for assertion: ${sec}s -> "${formatted}"`);
    return formatted;
  }
}