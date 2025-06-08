// tests/unit/app.test.js
/* eslint-env jest */

// Mock dependencies BEFORE app.js is loaded
global.AudioApp = global.AudioApp || {};

global.AudioApp.state = {
  params: {
    jumpTime: 5, // Default
    speed: 1.0,
    pitch: 1.0,
    gain: 1.0,
    audioUrl: '',
    initialSeekTime: null,
    vadPositive: 0.8,
    vadNegative: 0.4,
  },
  runtime: {
    currentAudioBuffer: { duration: 100 },
    playbackStartSourceTime: 0,
    playbackStartTimeContext: null,
    currentSpeedForUpdate: 1,
    currentFile: null,
    currentVadResults: null,
  },
  status: {
    workletPlaybackReady: true,
    isActuallyPlaying: false,
    urlInputStyle: 'default',
    fileInfoMessage: '',
    urlLoadingErrorMessage: '',
    isVadProcessing: false,
    playbackNaturallyEnded: false,
  },
  updateParam: jest.fn(),
  updateRuntime: jest.fn(),
  updateStatus: jest.fn(),
  serialize: jest.fn().mockReturnValue('serialized=hash'),
  deserialize: jest.fn(),
  subscribe: jest.fn(), // Added from uiManager tests, though app.js doesn't directly use it.
};

global.AudioApp.audioEngine = {
  seek: jest.fn(),
  getAudioContext: jest.fn().mockReturnValue({ currentTime: 0 }), // Mock audio context
  getCurrentTime: jest.fn().mockReturnValue({ currentTime: 0 }),
  init: jest.fn(),
  loadAndProcessFile: jest.fn(),
  setSpeed: jest.fn(),
  setPitch: jest.fn(),
  setGain: jest.fn(),
  togglePlayPause: jest.fn(),
  cleanup: jest.fn(),
  resampleTo16kMono: jest.fn().mockResolvedValue(new Float32Array(16000)), // For VAD/tone
};

global.AudioApp.uiManager = {
  init: jest.fn(),
  resetUI: jest.fn(),
  setFileInfo: jest.fn(),
  updateFileName: jest.fn(),
  setPlayButtonState: jest.fn(),
  updateTimeDisplay: jest.fn(),
  updateSeekBar: jest.fn(),
  setSpeechRegionsText: jest.fn(),
  updateVadDisplay: jest.fn(),
  enablePlaybackControls: jest.fn(),
  enableSeekBar: jest.fn(),
  updateVadProgress: jest.fn(),
  showVadProgress: jest.fn(),
  setUrlLoadingError: jest.fn(),
  setUrlInputStyle: jest.fn(),
  unfocusUrlInput: jest.fn(),
  setAudioUrlInputValue: jest.fn(),
  getAudioUrlInputValue: jest.fn().mockReturnValue(''),
  setJumpTimeValue: jest.fn(),
  showDropZone: jest.fn(),
  hideDropZone: jest.fn(),
  // getJumpTime: jest.fn(), // This should not be used by app.js anymore
};

global.AudioApp.waveformVisualizer = {
  init: jest.fn(),
  clearVisuals: jest.fn(),
  updateProgressIndicator: jest.fn(),
  computeAndDrawWaveform: jest.fn(),
  redrawWaveformHighlight: jest.fn(),
  resizeAndRedraw: jest.fn(),
};

global.AudioApp.spectrogramVisualizer = {
  init: jest.fn(),
  clearVisuals: jest.fn(),
  showSpinner: jest.fn(),
  updateProgressIndicator: jest.fn(),
  computeAndDrawSpectrogram: jest.fn(),
  resizeAndRedraw: jest.fn(),
};

global.AudioApp.vadAnalyzer = {
  init: jest.fn(),
  analyze: jest.fn().mockResolvedValue({ regions: [], initialPositiveThreshold: 0.8, initialNegativeThreshold: 0.4, probabilities: {}, frameSamples:0, sampleRate:0, redemptionFrames:0 }),
  recalculateSpeechRegions: jest.fn().mockReturnValue([]),
};

global.AudioApp.DTMFParser = jest.fn().mockImplementation(() => ({
    processAudioBlock: jest.fn().mockReturnValue(null)
}));
global.AudioApp.CallProgressToneParser = jest.fn().mockImplementation(() => ({
    processAudioBlock: jest.fn().mockReturnValue(null)
}));


global.AudioApp.Utils = {
  debounce: jest.fn((fn) => fn), // Executes immediately
  formatTime: jest.fn(time => `${time}s`), // From uiManager tests
};

global.Constants = { // From uiManager tests, expanded if app.js needs more
  UI: {
    SYNC_DEBOUNCE_WAIT_MS: 50,
    DEBOUNCE_HASH_UPDATE_MS: 250,
  },
  VAD: {
    DEFAULT_POSITIVE_THRESHOLD: 0.8,
    DEFAULT_NEGATIVE_THRESHOLD: 0.4,
  },
  DTMF: { // Added for tone processing parts of app.js
    SAMPLE_RATE: 16000,
    BLOCK_SIZE: 1024, // Or whatever value app.js might implicitly rely on
  }
};

// Mock AppState constructor for app.js IIFE
global.AppState = jest.fn().mockImplementation(() => global.AudioApp.state);


// To capture event handlers
const eventListeners = {};
const originalAddEventListener = document.addEventListener;
let addEventListenerSpy;

// --- Load app.js AFTER all mocks are set up ---
// The IIFE in app.js will use the mocked global.AudioApp
require('../../vibe-player/js/app.js');
// --- End of app.js loading ---


describe('AudioApp (app.js logic)', () => {
  let capturedHandlers = {};
  let debouncedUpdateUrlHashMock;


  beforeAll(() => {
    // Spy on addEventListener to capture handlers
    addEventListenerSpy = jest.spyOn(document, 'addEventListener').mockImplementation((event, handler) => {
      capturedHandlers[event] = handler;
    });

    // Mocking the result of debounce specifically for updateUrlHashFromState
    // updateUrlHashFromState is not directly exported, so we mock its debounced version
    debouncedUpdateUrlHashMock = jest.fn();
    global.AudioApp.Utils.debounce.mockImplementation((fn, delay) => {
        if (fn.name === 'updateUrlHashFromState') {
            return debouncedUpdateUrlHashMock;
        }
        return fn; // For other debounced functions, return them directly
    });

    // Call init to setup event listeners etc.
    // app.init is assigned by the IIFE.
    AudioApp.init();
  });

  afterAll(() => {
    // Restore original addEventListener
    addEventListenerSpy.mockRestore();
  });

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Restore debounce mock for updateUrlHashFromState for each test if needed,
    // or ensure it's freshly created.
    global.AudioApp.Utils.debounce.mockImplementation((fn, delay) => {
        if (fn.name === 'updateUrlHashFromState') {
            return debouncedUpdateUrlHashMock;
        }
        return fn;
    });

    // Default states (can be overridden in specific tests)
    global.AudioApp.state.params.jumpTime = 5;
    global.AudioApp.state.runtime.currentAudioBuffer = { duration: 100 };
    global.AudioApp.state.runtime.playbackStartSourceTime = 0;
    global.AudioApp.state.runtime.playbackStartTimeContext = null;
    global.AudioApp.state.runtime.currentSpeedForUpdate = 1;
    global.AudioApp.state.status.workletPlaybackReady = true;
    global.AudioApp.state.status.isActuallyPlaying = false;
    global.AudioApp.audioEngine.getAudioContext.mockReturnValue({ currentTime: 0 });
    global.AudioApp.audioEngine.getCurrentTime.mockReturnValue({ currentTime: 0 });

  });

  describe('handleJumpTimeChange', () => {
    const handleJumpTimeChange = () => capturedHandlers['audioapp:jumpTimeChanged'];

    test('valid input should update jumpTime and call debouncedUpdateUrlHash', () => {
      handleJumpTimeChange()({ detail: { value: 15 } });
      expect(AudioApp.state.updateParam).toHaveBeenCalledWith('jumpTime', 15);
      expect(debouncedUpdateUrlHashMock).toHaveBeenCalled();
    });

    test('zero input should not update jumpTime', () => {
      handleJumpTimeChange()({ detail: { value: 0 } });
      expect(AudioApp.state.updateParam).not.toHaveBeenCalled();
      expect(debouncedUpdateUrlHashMock).not.toHaveBeenCalled();
    });

    test('negative input should not update jumpTime', () => {
      handleJumpTimeChange()({ detail: { value: -5 } });
      expect(AudioApp.state.updateParam).not.toHaveBeenCalled();
      expect(debouncedUpdateUrlHashMock).not.toHaveBeenCalled();
    });

    test('non-numeric input should not update jumpTime', () => {
      handleJumpTimeChange()({ detail: { value: 'abc' } });
      expect(AudioApp.state.updateParam).not.toHaveBeenCalled();
      expect(debouncedUpdateUrlHashMock).not.toHaveBeenCalled();
    });
  });

  describe('handleJump', () => {
    const handleJump = () => capturedHandlers['audioapp:jumpClicked'];

    // Mocking calculateEstimatedSourceTime by controlling its inputs
    // For these tests, assume calculateEstimatedSourceTime returns playbackStartSourceTime when paused,
    // or a calculated value if playing. We'll control playbackStartSourceTime and mock audioContext.currentTime.

    test('jump forward within bounds', () => {
      AudioApp.state.runtime.playbackStartSourceTime = 50; // current time
      handleJump()({ detail: { direction: 1 } }); // jumpTime is 5
      expect(AudioApp.audioEngine.seek).toHaveBeenCalledWith(55);
      expect(debouncedUpdateUrlHashMock).toHaveBeenCalled();
    });

    test('jump backward within bounds', () => {
      AudioApp.state.runtime.playbackStartSourceTime = 50;
      handleJump()({ detail: { direction: -1 } });
      expect(AudioApp.audioEngine.seek).toHaveBeenCalledWith(45);
      expect(debouncedUpdateUrlHashMock).toHaveBeenCalled();
    });

    test('jump backward resulting in time before 0 seconds', () => {
      AudioApp.state.runtime.playbackStartSourceTime = 3;
      handleJump()({ detail: { direction: -1 } }); // 3 - 5 = -2 -> 0
      expect(AudioApp.audioEngine.seek).toHaveBeenCalledWith(0);
    });

    test('jump forward resulting in time after duration', () => {
      AudioApp.state.runtime.playbackStartSourceTime = 98;
      AudioApp.state.runtime.currentAudioBuffer.duration = 100;
      handleJump()({ detail: { direction: 1 } }); // 98 + 5 = 103 -> 100
      expect(AudioApp.audioEngine.seek).toHaveBeenCalledWith(100);
    });

    test('when playing, should update playbackStartTimeContext', () => {
      AudioApp.state.status.isActuallyPlaying = true;
      AudioApp.state.runtime.playbackStartSourceTime = 50;
      AudioApp.audioEngine.getAudioContext.mockReturnValue({ currentTime: 10 }); // Simulate context time

      handleJump()({ detail: { direction: 1 } });

      expect(AudioApp.audioEngine.seek).toHaveBeenCalledWith(55);
      expect(AudioApp.state.updateRuntime).toHaveBeenCalledWith('playbackStartSourceTime', 55);
      expect(AudioApp.state.updateRuntime).toHaveBeenCalledWith('playbackStartTimeContext', 10);
    });

    test('when paused, should set playbackStartTimeContext to null and call updateUIWithTime', () => {
      AudioApp.state.status.isActuallyPlaying = false;
      AudioApp.state.runtime.playbackStartSourceTime = 50;

      // Mock updateUIWithTime by checking calls to uiManager functions it calls
      AudioApp.uiManager.updateTimeDisplay.mockClear();
      AudioApp.uiManager.updateSeekBar.mockClear();

      handleJump()({ detail: { direction: 1 } });

      expect(AudioApp.audioEngine.seek).toHaveBeenCalledWith(55);
      expect(AudioApp.state.updateRuntime).toHaveBeenCalledWith('playbackStartSourceTime', 55);
      expect(AudioApp.state.updateRuntime).toHaveBeenCalledWith('playbackStartTimeContext', null);

      // Check if updateUIWithTime was effectively called
      expect(AudioApp.uiManager.updateTimeDisplay).toHaveBeenCalledWith(55, AudioApp.state.runtime.currentAudioBuffer.duration);
      expect(AudioApp.uiManager.updateSeekBar).toHaveBeenCalled(); // Argument depends on fraction
    });
     test('should not jump if worklet not ready', () => {
        AudioApp.state.status.workletPlaybackReady = false;
        handleJump()({ detail: { direction: 1 } });
        expect(AudioApp.audioEngine.seek).not.toHaveBeenCalled();
    });

    test('should not jump if no audio buffer', () => {
        AudioApp.state.runtime.currentAudioBuffer = null;
        handleJump()({ detail: { direction: 1 } });
        expect(AudioApp.audioEngine.seek).not.toHaveBeenCalled();
    });
  });

  describe('handleKeyPress', () => {
    let handlePlayPauseMock;
    const handleKeyPress = () => capturedHandlers['audioapp:keyPressed'];

    beforeEach(() => {
        // To test if handlePlayPause is called, we can spy on it.
        // Since handlePlayPause is internal to app.js, we'd typically have to
        // trigger the 'Space' key and check its side effects (e.g., audioEngine.togglePlayPause).
        // For simplicity here, if we could mock 'handlePlayPause' itself, that would be easier.
        // Given the structure, we'll check the call to audioEngine.togglePlayPause,
        // as handlePlayPause directly calls it.
        AudioApp.audioEngine.togglePlayPause.mockClear();
    });

    test('ArrowLeft should not trigger seek', () => {
      handleKeyPress()({ detail: { key: 'ArrowLeft' } });
      expect(AudioApp.audioEngine.seek).not.toHaveBeenCalled();
      expect(AudioApp.audioEngine.togglePlayPause).not.toHaveBeenCalled();
    });

    test('ArrowRight should not trigger seek', () => {
      handleKeyPress()({ detail: { key: 'ArrowRight' } });
      expect(AudioApp.audioEngine.seek).not.toHaveBeenCalled();
      expect(AudioApp.audioEngine.togglePlayPause).not.toHaveBeenCalled();
    });

    test('Space key should call togglePlayPause (via handlePlayPause)', () => {
      handleKeyPress()({ detail: { key: 'Space' } });
      expect(AudioApp.audioEngine.togglePlayPause).toHaveBeenCalled();
    });

    test('should not process key press if worklet not ready', () => {
        AudioApp.state.status.workletPlaybackReady = false;
        handleKeyPress()({ detail: { key: 'Space' } });
        expect(AudioApp.audioEngine.togglePlayPause).not.toHaveBeenCalled();
    });
  });
});
