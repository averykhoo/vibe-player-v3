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
    // ADD THE FOLLOWING TWO LINES:
    this.urlInput = page.getByLabel("Audio URL");
    this.urlLoadButton = page.getByRole("button", { name: "Load", exact: true });
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
   * Sets the value of a slider input by dispatching mousedown, input, and mouseup events.
   * This method is designed to simulate user interaction more closely for Svelte components.
   * @param {import('@playwright/test').Locator} sliderInputLocator - The locator for the slider's <input type="range"> element.
   * @param {string} valueStr - The target value as a string (e.g., "1.5").
   */
  async setSliderValue(sliderInputLocator, valueStr) {
    const testId = await sliderInputLocator.getAttribute("data-testid");
    const inputName = await sliderInputLocator.getAttribute("name");
    const inputId = await sliderInputLocator.getAttribute("id");

    console.log(
      `[TEST RUNNER] Simulating events on slider (Test ID: '${testId}', Name: '${inputName}', ID: '${inputId}') to set value: ${valueStr}`,
    );

    await sliderInputLocator.evaluate(
      (element, { value, testId_b, name_b, id_b }) => {
        const browserLog = (message) =>
          console.log(
            `[Browser-Side Log for Slider (TestID: ${testId_b}, Name: ${name_b}, ID: ${id_b})] ${message}`,
          );

        if (
          !(element instanceof HTMLInputElement && element.type === "range")
        ) {
          browserLog(
            `ERROR: Target element is not an HTMLInputElement of type 'range'. TagName: ${element.tagName}, Type: ${element.getAttribute("type")}`,
          );
          throw new Error(
            "Target element for setSliderValue is not an input[type=range]",
          );
        }
        const inputElement = element;
        browserLog(
          `Target input element identified. Current value: '${inputElement.value}'. Attempting to set to '${value}'.`,
        );

        browserLog("Dispatching 'mousedown' event on the input element.");
        inputElement.dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );

        browserLog(
          `Setting input element value to '${value}' and then dispatching 'input' event.`,
        );
        inputElement.value = value; // value is valueStr from the outer scope
        inputElement.dispatchEvent(
          new Event("input", {
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
        browserLog(
          `Input element value is now '${inputElement.value}' post-dispatch.`,
        );

        browserLog("Dispatching 'mouseup' event on the input element.");
        inputElement.dispatchEvent(
          new MouseEvent("mouseup", {
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
        browserLog("All events dispatched for slider interaction.");
      },
      { value: valueStr, testId_b: testId, name_b: inputName, id_b: inputId }, // Pass valueStr and identifiers for logging
    );
    console.log(
      `[TEST RUNNER] Event simulation complete for slider (Test ID: '${testId}') with value: ${valueStr}`,
    );
  }

  /**
   * Gets the current playback time from the time display element.
   * @returns {Promise<number>} The current time in seconds.
   */
  async getCurrentTime() {
    console.log("[Test Runner Log] Getting current time from display.");
    const timeDisplayText = await this.timeDisplay.textContent();
    if (!timeDisplayText)
      throw new Error("Time display text content is empty or null.");

    const currentTimeStr = timeDisplayText.split(" / ")[0].trim();
    const segments = currentTimeStr.split(":").map(Number);
    let currentTimeInSeconds = 0;

    if (segments.length === 2) {
      // M:SS
      currentTimeInSeconds = segments[0] * 60 + segments[1];
    } else if (segments.length === 3) {
      // H:MM:SS
      currentTimeInSeconds =
        segments[0] * 3600 + segments[1] * 60 + segments[2];
    } else {
      throw new Error(
        `Unexpected current time segment format: ${currentTimeStr}`,
      );
    }
    console.log(
      `[Test Runner Log] Parsed current time as: ${currentTimeInSeconds} seconds.`,
    );
    return currentTimeInSeconds;
  }

  /**
   * Performs a robust, multi-stage interactive seek on the main seek slider's wrapper div.
   * This method is distinct from setSliderValue and is tailored for the main seek bar if it
   * requires events on its wrapper.
   * @param {number} targetTime The time in seconds to seek to.
   */
  async performInteractiveSeek(targetTime) {
    const testId = await this.seekSliderInput.getAttribute("data-testid");
    const inputName = await this.seekSliderInput.getAttribute("name");
    const inputId = await this.seekSliderInput.getAttribute("id");

    console.log(
      `[Test Runner Log] Starting interactive seek via wrapper (Test ID: '${testId}', Name: '${inputName}', ID: '${inputId}') to value: ${targetTime}`,
    );

    const sliderWrapper = this.seekSliderInput.locator("..");

    await sliderWrapper.evaluate(
      (wrapper, { value, testId_b, name_b, id_b }) => {
        const browserLog = (message) =>
          console.log(
            `[Browser-Side Log for Seek Wrapper (Input TestID: ${testId_b}, Name: ${name_b}, ID: ${id_b})] ${message}`,
          );
        browserLog(
          `Wrapper element identified. TagName: ${wrapper.tagName}, ID: ${wrapper.id}, Class: ${wrapper.className}`,
        );

        const sliderInput = wrapper.querySelector('input[type="range"]');
        if (!sliderInput) {
          browserLog(
            `ERROR: Could not find slider input <input type="range"> inside wrapper.`,
          );
          throw new Error("Could not find slider input inside wrapper");
        }
        browserLog(
          `Found input element (id: ${sliderInput.id}, name: ${sliderInput.name}, testId: ${sliderInput.getAttribute("data-testid")}) inside wrapper.`,
        );

        browserLog(`Dispatching 'mousedown' event on wrapper.`);
        wrapper.dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );

        browserLog(
          `Setting slider input value to '${value}' (id: ${sliderInput.id}) and dispatching 'input' event.`,
        );
        sliderInput.value = String(value); // value is targetTime
        sliderInput.dispatchEvent(
          new Event("input", {
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
        browserLog(
          `Input element value is now '${sliderInput.value}' post-dispatch.`,
        );

        browserLog(`Dispatching 'mouseup' event on wrapper.`);
        wrapper.dispatchEvent(
          new MouseEvent("mouseup", {
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
        browserLog("All events dispatched for interactive seek.");
      },
      {
        value: targetTime,
        testId_b: testId,
        name_b: inputName,
        id_b: inputId,
      },
    );

    console.log(
      `[Test Runner Log] Finished interactive seek via wrapper for slider (Test ID: '${testId}').`,
    );
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

    if (segments.length === 2) {
      // M:SS
      durationInSeconds = segments[0] * 60 + segments[1];
    } else if (segments.length === 3) {
      // H:MM:SS
      durationInSeconds = segments[0] * 3600 + segments[1] * 60 + segments[2];
    } else {
      throw new Error(`Unexpected duration segment format: ${durationStr}`);
    }
    console.log(
      `[Test Runner Log] Parsed duration as: ${durationInSeconds} seconds.`,
    );
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
    console.log(
      `[Test Runner Log] Formatted time for assertion: ${sec}s -> "${formatted}"`,
    );
    return formatted;
  }
}
