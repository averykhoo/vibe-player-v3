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

    // VAD Controls
    this.vadPositiveSliderInput = page.getByTestId("vad-positive-slider-input");
    this.vadPositiveValueDisplay = page.getByTestId("vad-positive-value");
    this.vadNegativeSliderInput = page.getByTestId("vad-negative-slider-input");
    this.vadNegativeValueDisplay = page.getByTestId("vad-negative-value");

    console.log("[Test Runner Log] PlayerPage locators initialized.");
  }

  /**
   * Navigates to the application's base URL and verifies the page has loaded.
   */
  async goto() {
    console.log(`[Test Runner Log] Navigating to page: ${this.devServerUrl}`);
    await this.page.goto(this.devServerUrl);
    await expect(this.appBarTitle).toHaveText("Vibe Player", {
      timeout: 15000,
    });
    await expect(this.fileInput).toBeVisible({ timeout: 10000 });
    console.log(
      "[Test Runner Log] Page navigation and initial load confirmed.",
    );
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
   * Waits for the UI to be in a state where playback is possible after a file load.
   */
  async expectControlsToBeReadyForPlayback() {
    console.log(
      "[Test Runner Log] Waiting for controls to be ready for playback...",
    );
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
    console.log(
      "[Test Runner Log] Time display has updated. Controls are ready.",
    );
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
   * [RE-RE-FIXED] The most robust method. Programmatically sets the value on the native input
   * element and then dispatches the events that the Svelte component handlers are listening for.
   * @param {import('@playwright/test').Locator} sliderInputLocator - The locator for the slider's <input type="range"> element.
   * @param {string} valueStr - The target value as a string.
   */
  async setSliderValue(sliderInputLocator, valueStr) {
    const testId = await sliderInputLocator.getAttribute("data-testid");
    console.log(
        `[TEST RUNNER] Forcing events on slider '${testId}' to value: ${valueStr}`,
    );

    // Use page.evaluate to run code in the browser context, dispatching events on the element.
    await sliderInputLocator.evaluate((element, value) => {
      const inputElement = element;

      // Log from the browser to confirm we're targeting the right element.
      console.log(
          `[BROWSER-SIDE LOG] Firing 'mousedown' on input with id: '${inputElement.id}'`,
      );
      inputElement.dispatchEvent(
          new MouseEvent("mousedown", {bubbles: true}),
      );

      console.log(
          `[BROWSER-SIDE LOG] Setting value to ${value} and firing 'input'`,
      );
      inputElement.value = value;
      inputElement.dispatchEvent(new Event("input", {bubbles: true}));

      console.log(`[BROWSER-SIDE LOG] Firing 'mouseup'`);
      inputElement.dispatchEvent(new MouseEvent("mouseup", {bubbles: true}));
    }, valueStr);
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
    console.log(
      `[Test Runner Log] Formatted time for assertion: ${sec}s -> "${formatted}"`,
    );
    return formatted;
  }
}
