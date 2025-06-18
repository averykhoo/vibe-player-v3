// vibe-player-v2/tests-e2e/PlayerPage.mjs
import { expect } from '@playwright/test';

export class PlayerPage {
	/**
	 * A Page Object Model for the Vibe Player V2 application.
	 * Encapsulates locators and actions for interacting with the player UI.
	 * @param {import('@playwright/test').Page} page
	 */
	constructor(page) {
		this.page = page;
		this.devServerUrl = 'http://localhost:4173/';
		this.appBarTitle = page.getByTestId('app-bar-title');
		this.fileInput = page.locator('input[type="file"]');
		this.fileNameDisplay = page.getByTestId('file-name-display');
		this.fileStatusDisplay = page.getByTestId('file-status-display');
		this.fileErrorDisplay = page.getByTestId('file-error-display');
		this.playButton = page.getByTestId('play-button');
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
		this.dtmfDisplay = page.getByTestId('dtmf-display');
	}

	/**
	 * Navigates to the application's base URL and verifies the page has loaded.
	 */
	async goto() {
		await this.page.goto(this.devServerUrl);
		await expect(this.appBarTitle).toHaveText('Vibe Player V2', {
			timeout: 15000
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
			timeout: 20000
		});
		await expect(this.timeDisplay, 'Time display did not update with audio duration').not.toHaveText(
			'0:00 / 0:00',
			{ timeout: 1000 }
		);
		await expect(this.playButton, 'Play button was not enabled after file load').toBeEnabled({
			timeout: 1000
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
	 * [FIXED & LOGGING ADDED] Sets the value of a range slider by programmatically dispatching events.
	 * This directly triggers the on:mousedown, on:input, and on:mouseup handlers in Svelte.
	 * @param {import('@playwright/test').Locator} sliderInputLocator - The locator for the slider input element.
	 * @param {string} valueStr - The target value as a string.
	 */
	async setSliderValue(sliderInputLocator, valueStr) {
		const testId = await sliderInputLocator.getAttribute('data-testid');
		// Initial log from the test runner's context
		console.log(`[TEST RUNNER] Setting slider '${testId}' to value: ${valueStr}`);

		// Use page.evaluate to run code in the browser context, dispatching events on the element.
		await sliderInputLocator.evaluate(
			(element, { value, id }) => {
				// These logs will appear in the browser console, captured by Playwright
				
				// 1. Dispatch 'mousedown'
				console.log(`[BROWSER-SIDE LOG] Firing 'mousedown' on slider '${id}'`);
				element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

				// 2. Set the value
				element.value = value;

				// 3. Dispatch 'input'
				console.log(`[BROWSER-SIDE LOG] Firing 'input' on slider '${id}' with value=${value}`);
				element.dispatchEvent(new Event('input', { bubbles: true }));

				// 4. Dispatch 'mouseup'
				console.log(`[BROWSER-SIDE LOG] Firing 'mouseup' on slider '${id}'`);
				element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
			},
			{ value: valueStr, id: testId } // Pass both value and id into the browser context
		);

		// A small delay for debounced functions or other async updates in Svelte to fire.
		await this.page.waitForTimeout(350);
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