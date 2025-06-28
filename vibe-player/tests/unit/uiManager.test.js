// tests/unit/uiManager.test.js
/* eslint-env jest */

// Mock AudioApp and its dependencies before uiManager is loaded
global.AudioApp = global.AudioApp || {};
global.AudioApp.Utils = {
  formatTime: jest.fn(time => `${time}s`), // Minimal mock for Utils used in init/reset path
};
global.Constants = { // Minimal mock for Constants used in init/reset path
  VAD: {
    DEFAULT_POSITIVE_THRESHOLD: 0.8,
    DEFAULT_NEGATIVE_THRESHOLD: 0.4,
  },
  UI: {}, // if uiManager accesses anything under UI
};

// Mock AudioApp.state and its subscribe method
global.AudioApp.state = {
  subscribe: jest.fn(),
  params: {}, // For setJumpTimeValue if it tries to read state, though current impl doesn't
  runtime: {},
  status: {},
};

// Now load the uiManager after mocks are in place
require('../../js/uiManager.js'); // Assuming path from tests/unit/ to js/

describe('AudioApp.uiManager', () => {
  let jumpTimeInput;
  let jumpBackButton;
  let jumpForwardButton;
  let dispatchEventSpy;

  beforeEach(() => {
    // Create and append mock DOM elements
    jumpTimeInput = document.createElement('input');
    jumpTimeInput.id = 'jumpTime';
    jumpTimeInput.type = 'number';
    jumpTimeInput.value = '5'; // Default value
    document.body.appendChild(jumpTimeInput);

    jumpBackButton = document.createElement('button');
    jumpBackButton.id = 'jumpBack';
    document.body.appendChild(jumpBackButton);

    jumpForwardButton = document.createElement('button');
    jumpForwardButton.id = 'jumpForward';
    document.body.appendChild(jumpForwardButton);

    // Other elements uiManager.init() might try to access to avoid errors
    const chooseFileButton = document.createElement('button'); // Added to silence warning
    chooseFileButton.id = 'chooseFileButton';
    document.body.appendChild(chooseFileButton);

    const playPauseButton = document.createElement('button');
    playPauseButton.id = 'playPause';
    document.body.appendChild(playPauseButton);

    const seekBar = document.createElement('input');
    seekBar.id = 'seekBar';
    document.body.appendChild(seekBar);

    const fileNameDisplay = document.createElement('span');
    fileNameDisplay.id = 'fileNameDisplay';
    document.body.appendChild(fileNameDisplay);

    const fileInfo = document.createElement('p');
    fileInfo.id = 'fileInfo';
    document.body.appendChild(fileInfo);

    const timeDisplay = document.createElement('div');
    timeDisplay.id = 'timeDisplay';
    document.body.appendChild(timeDisplay);

    const speechRegionsDisplay = document.createElement('pre');
    speechRegionsDisplay.id = 'speechRegionsDisplay';
    document.body.appendChild(speechRegionsDisplay);

    const vadThresholdValueDisplay = document.createElement('span');
    vadThresholdValueDisplay.id = 'vadThresholdValue';
    document.body.appendChild(vadThresholdValueDisplay);

    const vadNegativeThresholdValueDisplay = document.createElement('span');
    vadNegativeThresholdValueDisplay.id = 'vadNegativeThresholdValue';
    document.body.appendChild(vadNegativeThresholdValueDisplay);

    const vadThresholdSlider = document.createElement('input');
    vadThresholdSlider.id = 'vadThreshold';
    document.body.appendChild(vadThresholdSlider);

    const vadNegativeThresholdSlider = document.createElement('input');
    vadNegativeThresholdSlider.id = 'vadNegativeThreshold';
    document.body.appendChild(vadNegativeThresholdSlider);

    const vadProgressContainer = document.createElement('div');
    vadProgressContainer.id = 'vadProgressContainer';
    document.body.appendChild(vadProgressContainer);

    const vadProgressBar = document.createElement('span');
    vadProgressBar.id = 'vadProgressBar';
    document.body.appendChild(vadProgressBar);

    const dtmfDisplay = document.createElement('div');
    dtmfDisplay.id = 'dtmfDisplay';
    document.body.appendChild(dtmfDisplay);

    const cptDisplay = document.createElement('div');
    cptDisplay.id = 'cpt-display-content';
    document.body.appendChild(cptDisplay);

    const urlLoadingErrorDisplay = document.createElement('span');
    urlLoadingErrorDisplay.id = 'urlLoadingErrorDisplay';
    document.body.appendChild(urlLoadingErrorDisplay);

    const audioUrlInput = document.createElement('input');
    audioUrlInput.id = 'audioUrlInput';
    document.body.appendChild(audioUrlInput);

    const playbackSpeedControl = document.createElement('input');
    playbackSpeedControl.id = 'playbackSpeed';
    playbackSpeedControl.min = "0.5"; playbackSpeedControl.max = "2"; playbackSpeedControl.value = "1";
    document.body.appendChild(playbackSpeedControl);
    const speedValueDisplay = document.createElement('span');
    speedValueDisplay.id = 'speedValue';
    document.body.appendChild(speedValueDisplay);

    const pitchControl = document.createElement('input');
    pitchControl.id = 'pitchControl';
    pitchControl.min = "0.5"; pitchControl.max = "2"; pitchControl.value = "1";
    document.body.appendChild(pitchControl);
    const pitchValueDisplay = document.createElement('span');
    pitchValueDisplay.id = 'pitchValue';
    document.body.appendChild(pitchValueDisplay);

    const gainControl = document.createElement('input');
    gainControl.id = 'gainControl';
    gainControl.min = "0"; gainControl.max = "2"; gainControl.value = "1";
    document.body.appendChild(gainControl);
    const gainValueDisplay = document.createElement('span');
    gainValueDisplay.id = 'gainValue';
    document.body.appendChild(gainValueDisplay);

    // Spy on document.dispatchEvent
    dispatchEventSpy = jest.spyOn(document, 'dispatchEvent');

    // Initialize uiManager
    // This will call assignDOMElements and setupEventListeners
    AudioApp.uiManager.init();
  });

  afterEach(() => {
    // Clean up DOM elements
    document.body.innerHTML = '';
    // Restore spies
    dispatchEventSpy.mockRestore();
    // Clear mocks state
    AudioApp.state.subscribe.mockClear();
  });

  describe('setupEventListeners - jumpTimeInput', () => {
    test('should dispatch audioapp:jumpTimeChanged with correct value on valid input', () => {
      jumpTimeInput.value = '10';
      jumpTimeInput.dispatchEvent(new Event('input'));
      expect(dispatchEventSpy).toHaveBeenCalledWith(expect.any(CustomEvent));
      const event = dispatchEventSpy.mock.calls[0][0];
      expect(event.type).toBe('audioapp:jumpTimeChanged');
      expect(event.detail).toEqual({ value: 10 });
    });

    test('should dispatch audioapp:jumpTimeChanged with value 1 on empty input', () => {
      jumpTimeInput.value = '';
      jumpTimeInput.dispatchEvent(new Event('input'));
      expect(dispatchEventSpy).toHaveBeenCalledWith(expect.any(CustomEvent));
      const event = dispatchEventSpy.mock.calls[0][0];
      expect(event.type).toBe('audioapp:jumpTimeChanged');
      expect(event.detail).toEqual({ value: 1 });
    });

    test('should dispatch audioapp:jumpTimeChanged with value 1 on non-numeric input', () => {
      jumpTimeInput.value = 'abc';
      jumpTimeInput.dispatchEvent(new Event('input'));
      expect(dispatchEventSpy).toHaveBeenCalledWith(expect.any(CustomEvent));
      const event = dispatchEventSpy.mock.calls[0][0];
      expect(event.type).toBe('audioapp:jumpTimeChanged');
      expect(event.detail).toEqual({ value: 1 });
    });

    test('should dispatch audioapp:jumpTimeChanged with value 1 on zero input', () => {
      jumpTimeInput.value = '0';
      jumpTimeInput.dispatchEvent(new Event('input'));
      expect(dispatchEventSpy).toHaveBeenCalledWith(expect.any(CustomEvent));
      const event = dispatchEventSpy.mock.calls[0][0];
      expect(event.type).toBe('audioapp:jumpTimeChanged');
      expect(event.detail).toEqual({ value: 1 });
    });

    test('should dispatch audioapp:jumpTimeChanged with value 1 on negative input', () => {
      jumpTimeInput.value = '-5';
      jumpTimeInput.dispatchEvent(new Event('input'));
      expect(dispatchEventSpy).toHaveBeenCalledWith(expect.any(CustomEvent));
      const event = dispatchEventSpy.mock.calls[0][0];
      expect(event.type).toBe('audioapp:jumpTimeChanged');
      expect(event.detail).toEqual({ value: 1 });
    });
  });

  describe('Jump Button/Key Event Dispatch', () => {
    test('jumpBackButton click should dispatch audioapp:jumpClicked with direction -1', () => {
      jumpBackButton.dispatchEvent(new Event('click'));
      expect(dispatchEventSpy).toHaveBeenCalledWith(expect.any(CustomEvent));
      const event = dispatchEventSpy.mock.calls[0][0];
      expect(event.type).toBe('audioapp:jumpClicked');
      expect(event.detail).toEqual({ direction: -1 });
    });

    test('jumpForwardButton click should dispatch audioapp:jumpClicked with direction 1', () => {
      jumpForwardButton.dispatchEvent(new Event('click'));
      expect(dispatchEventSpy).toHaveBeenCalledWith(expect.any(CustomEvent));
      const event = dispatchEventSpy.mock.calls[0][0];
      expect(event.type).toBe('audioapp:jumpClicked');
      expect(event.detail).toEqual({ direction: 1 });
    });

    test('ArrowLeft keydown should dispatch audioapp:jumpClicked with direction -1', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' }));
      // Note: handleKeyDown is attached to 'document', so we dispatch on document.
      // The spy should capture this.
      const jumpClickedEvent = dispatchEventSpy.mock.calls.find(call => call[0].type === 'audioapp:jumpClicked');
      expect(jumpClickedEvent).toBeDefined();
      expect(jumpClickedEvent[0].detail).toEqual({ direction: -1 });
    });

    test('ArrowRight keydown should dispatch audioapp:jumpClicked with direction 1', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }));
      const jumpClickedEvent = dispatchEventSpy.mock.calls.find(call => call[0].type === 'audioapp:jumpClicked');
      expect(jumpClickedEvent).toBeDefined();
      expect(jumpClickedEvent[0].detail).toEqual({ direction: 1 });
    });

    test('Space keydown should dispatch audioapp:keyPressed with key Space', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      const keyPressedEvent = dispatchEventSpy.mock.calls.find(call => call[0].type === 'audioapp:keyPressed');
      expect(keyPressedEvent).toBeDefined();
      expect(keyPressedEvent[0].detail).toEqual({ key: 'Space' });
    });

    test('ArrowLeft keydown should NOT dispatch audioapp:keyPressed', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' }));
      const keyPressedEvent = dispatchEventSpy.mock.calls.find(call => call[0].type === 'audioapp:keyPressed');
      expect(keyPressedEvent).toBeUndefined();
    });

    test('ArrowRight keydown should NOT dispatch audioapp:keyPressed', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }));
      const keyPressedEvent = dispatchEventSpy.mock.calls.find(call => call[0].type === 'audioapp:keyPressed');
      expect(keyPressedEvent).toBeUndefined();
    });
  });

  describe('setJumpTimeValue(value)', () => {
    beforeEach(() => {
        // Reset jumpTimeInput for these specific tests if needed, though init() does set it.
        // AudioApp.uiManager.init() is called in global beforeEach, so jumpTimeInput exists.
        // Ensure a known state if previous tests could modify it and init() doesn't reset it perfectly for tests.
        jumpTimeInput.value = '5'; // Explicitly set before each setJumpTimeValue test
    });

    test('should update jumpTimeInput.value for a new valid string number', () => {
      AudioApp.uiManager.setJumpTimeValue("10");
      expect(jumpTimeInput.value).toBe("10");
    });

    test('should not change jumpTimeInput.value if new string value is same as current', () => {
      AudioApp.uiManager.setJumpTimeValue("5"); // Current is "5"
      expect(jumpTimeInput.value).toBe("5");
    });

    test('should update jumpTimeInput.value for a new valid number', () => {
      AudioApp.uiManager.setJumpTimeValue(15);
      expect(jumpTimeInput.value).toBe("15");
    });

    test('should not change jumpTimeInput.value if new numeric value is effectively the same (e.g. "5.0" vs 5)', () => {
      jumpTimeInput.value = "5.0";
      AudioApp.uiManager.setJumpTimeValue(5);
      expect(jumpTimeInput.value).toBe("5.0"); // Value remains "5.0" because 5.0 === 5
    });

    test('should not change jumpTimeInput.value if new numeric value is effectively the same (e.g. "5" vs 5.0)', () => {
      jumpTimeInput.value = "5";
      AudioApp.uiManager.setJumpTimeValue(5.0);
      // parseFloat("5") is 5, parseFloat("5.0") is 5. Values are same.
      expect(jumpTimeInput.value).toBe("5");
    });

    test('should not update jumpTimeInput.value for an invalid input like "invalid"', () => {
      jumpTimeInput.value = "7"; // Set a known valid state
      AudioApp.uiManager.setJumpTimeValue("invalid");
      expect(jumpTimeInput.value).toBe("7"); // Should remain unchanged
    });

    test('should not update jumpTimeInput.value for NaN', () => {
      jumpTimeInput.value = "8"; // Set a known valid state
      AudioApp.uiManager.setJumpTimeValue(NaN);
      expect(jumpTimeInput.value).toBe("8"); // Should remain unchanged
    });
  });
});
