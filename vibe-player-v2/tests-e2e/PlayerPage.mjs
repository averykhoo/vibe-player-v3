// tests-e2e/PlayerPage.mjs
import {expect} from "@playwright/test";

export class PlayerPage {
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

    async goto() {
        await this.page.goto(this.devServerUrl);
        await expect(this.appBarTitle).toHaveText("Vibe Player V2", {
            timeout: 15000,
        });
        await expect(this.fileInput).toBeVisible({timeout: 10000});
    }

    async loadAudioFile(fileName) {
        // --- THE FIX ---
        // The previous implementation used `page.request.get` which is good, but let's
        // simplify and use `setInputFiles` with a local path, which is more robust
        // for CI and local testing. Playwright will handle serving it.
        // We also need to construct the correct path relative to the project root.
        const filePath = `static/${fileName}`; // Assumes tests run from vibe-player-v2/

        await this.fileInput.setInputFiles(filePath);
    }

    async expectControlsToBeReadyForPlayback() {
        // *** REPLACE with robust wait ***
        await expect(
            this.timeDisplay,
            "Time display did not update with audio duration",
        ).not.toHaveText("0:00 / 0:00", {timeout: 20000});

        await expect(
            this.playButton,
            "Play button was not enabled after file load",
        ).toBeEnabled({timeout: 1000});
    }

    async getPlayButtonText() {
        return this.playButton.textContent();
    }

    async setSliderValue(sliderInputLocator, value) {
        await sliderInputLocator.evaluate((el, val) => {
            const inputElement = el; // as HTMLInputElement; <-- not valid in mjs
            inputElement.value = val;
            inputElement.dispatchEvent(new Event("input", {bubbles: true}));
            inputElement.dispatchEvent(new Event("change", {bubbles: true}));
        }, String(value));
        await this.page.waitForTimeout(150);
    }

    async getSliderInputValue(sliderInputLocator) {
        return sliderInputLocator.inputValue();
    }
}
