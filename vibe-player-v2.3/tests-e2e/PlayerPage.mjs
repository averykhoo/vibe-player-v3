// vibe-player-v2.3/tests-e2e/PlayerPage.mjs
// Defines interactions with the main player page for E2E tests.

export class PlayerPage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;
    this.appBarTitle = page.getByTestId("app-bar-title");
    this.fileInput = page.getByLabel("Upload Audio File");
    this.fileNameDisplay = page.getByTestId("file-name-display");
    this.playButton = page.getByRole("button", { name: "Play" });
    this.pauseButton = page.getByRole("button", { name: "Pause" });
    this.stopButton = page.getByRole("button", { name: "Stop" });
    this.seekSliderInput = page.getByTestId("seek-slider-input"); // The actual <input type="range">
    this.timeDisplay = page.getByTestId("time-display");
    this.waveform = page.locator("#waveform canvas");
    this.spectrogram = page.locator("#spectrogram canvas");
    this.toneActivity = page.locator("#tone-display canvas"); // Assuming it's a canvas
  }

  async goto() {
    await this.page.goto("/");
  }

  async loadAudioFile(filePath) {
    await this.fileInput.setInputFiles(filePath);
  }

  /**
   * --- REPLACE THE OLD METHOD WITH THIS ---
   * Performs a robust, multi-stage interactive seek on the main seek slider's wrapper div.
   * Uses programmatic event dispatching inside `evaluate` to ensure Svelte listeners are triggered.
   * This pattern is adapted from the working v2.0 implementation.
   * @param {number} targetTime The time in seconds to seek to.
   */
  async performInteractiveSeek(targetTime) {
    const testId = await this.seekSliderInput.getAttribute("data-testid");
    console.log(
      `[Test Runner Log] Starting interactive seek on '${testId}' to value: ${targetTime}`,
    );

    // Get the wrapper div which has the listeners.
    const sliderWrapper = this.seekSliderInput.locator("..");

    // This block runs code inside the browser, directly on the wrapper and slider elements
    await sliderWrapper.evaluate(
      (wrapper, { value }) => {
        const browserLog = (message) =>
          console.log(`[Browser-Side Log] ${message}`);
        const sliderInput = wrapper.querySelector('input[type="range"]');
        if (!sliderInput)
          throw new Error("Could not find slider input inside wrapper");

        // Stage 1: Dispatch 'mousedown' on the WRAPPER to trigger handleSeekStart
        browserLog("Dispatching 'mousedown' event on wrapper...");
        wrapper.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

        // Stage 2: Set the value and dispatch 'input' on the SLIDER to trigger handleSeekInput
        browserLog(
          `Setting slider value to ${value} and dispatching 'input' event.`,
        );
        sliderInput.value = String(value);
        sliderInput.dispatchEvent(new Event("input", { bubbles: true }));

        // Stage 3: Dispatch 'mouseup' on the WRAPPER to trigger handleSeekEnd
        browserLog("Dispatching 'mouseup' event on wrapper.");
        wrapper.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      },
      { value: targetTime },
    );

    console.log(`[Test Runner Log] Finished interactive seek on '${testId}'.`);
  }

  async getPlayButtonState() {
    return {
      isVisible: await this.playButton.isVisible(),
      isEnabled: await this.playButton.isEnabled(),
    };
  }

  async getPauseButtonState() {
    return {
      isVisible: await this.pauseButton.isVisible(),
      isEnabled: await this.pauseButton.isEnabled(),
    };
  }

  async getStopButtonState() {
    return {
      isVisible: await this.stopButton.isVisible(),
      isEnabled: await this.stopButton.isEnabled(),
    };
  }

  async getSeekSliderValue() {
    return parseFloat(await this.seekSliderInput.inputValue());
  }

  async getTimeDisplay() {
    const text = await this.timeDisplay.textContent();
    const parts = text.split(" / ");
    return {
      currentTime: parts[0],
      duration: parts[1],
    };
  }
}
