// vibe-player/tests/unit/app.test.js
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

global.Constants = {
  UI: {
    SYNC_DEBOUNCE_WAIT_MS: 50,
    DEBOUNCE_HASH_UPDATE_MS: 250,
  },
  VAD: {
    DEFAULT_POSITIVE_THRESHOLD: 0.5,
    DEFAULT_NEGATIVE_THRESHOLD: 0.35,
    SAMPLE_RATE: 16000,
    DEFAULT_FRAME_SAMPLES: 1536, // CHANGED from 512
    MIN_SPEECH_DURATION_MS: 100,
    SPEECH_PAD_MS: 50,
    REDEMPTION_FRAMES: 3,
    PROGRESS_REPORT_INTERVAL: 100,
    YIELD_INTERVAL: 200,
  },
  DTMF: {
    SAMPLE_RATE: 16000,
    BLOCK_SIZE: 1024,
  },
  // Add other Constants sub-objects if app.js uses them and they aren't mocked elsewhere
};

// Mock AppState constructor for app.js IIFE
global.AppState = jest.fn().mockImplementation(() => global.AudioApp.state);


// To capture event handlers
const eventListeners = {};
const originalAddEventListener = document.addEventListener;
let addEventListenerSpy;

// --- Load app.js AFTER all mocks are set up ---
// The IIFE in app.js will use the mocked global.AudioApp
require('../../js/app.js');
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

  describe('generateSpeechRegionsFromProbs logic', () => {
    let generateFunc;
    // const MOCK_REDEMPTION_FRAMES = global.Constants.VAD.REDEMPTION_FRAMES; // Kept if still used locally, or remove if all direct global access

    // Helper to calculate duration of N frames
    // Directly uses global.Constants.VAD to ensure values are picked up after mock setup.
    const frameDuration = (numFrames) => {
      const sampleRate = global.Constants.VAD.SAMPLE_RATE;
      const frameSamples = global.Constants.VAD.DEFAULT_FRAME_SAMPLES;
      if (typeof sampleRate !== 'number' || typeof frameSamples !== 'number' || sampleRate === 0) {
        // This case should ideally not be hit if Constants.VAD is mocked correctly.
        console.error('frameDuration: Invalid sampleRate or frameSamples from global.Constants.VAD', global.Constants.VAD);
        return NaN;
      }
      return (numFrames * frameSamples) / sampleRate;
    };

    beforeAll(() => {
      // Ensure app.js is loaded and testExports is available
      if (AudioApp.testExports && AudioApp.testExports.generateSpeechRegionsFromProbs) {
        generateFunc = AudioApp.testExports.generateSpeechRegionsFromProbs;
      } else {
        throw new Error('generateSpeechRegionsFromProbs not exposed on AudioApp.testExports. Make sure app.js is correctly refactored for testing.');
      }
    });

    test('should detect a basic speech segment correctly', () => {
      const probabilities = new Float32Array([0.1, 0.8, 0.9, 0.2, 0.1]); // Speech: frames 1, 2
      const options = {
        frameSamples: global.Constants.VAD.DEFAULT_FRAME_SAMPLES,
        sampleRate: global.Constants.VAD.SAMPLE_RATE,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.3,
        redemptionFrames: global.Constants.VAD.REDEMPTION_FRAMES,
        minSpeechDurationMs: global.Constants.VAD.MIN_SPEECH_DURATION_MS,
        speechPadMs: global.Constants.VAD.SPEECH_PAD_MS,
      };
      const regions = generateFunc(probabilities, options);
      expect(regions.length).toBe(1);
      // lastPositiveFrameIndex = 2. Raw region start: fd(1), end: fd(3)
      const expectedRawStart = frameDuration(1);
      const expectedRawEnd = frameDuration(3);
      const expectedPaddedStart = Math.max(0, expectedRawStart - (global.Constants.VAD.SPEECH_PAD_MS / 1000));
      const expectedPaddedEnd = Math.min(frameDuration(probabilities.length), expectedRawEnd + (global.Constants.VAD.SPEECH_PAD_MS / 1000));
      expect(regions[0].start).toBeCloseTo(expectedPaddedStart);
      expect(regions[0].end).toBeCloseTo(expectedPaddedEnd);
    });

    test('should not detect speech if probabilities are below positive threshold', () => {
      const probabilities = new Float32Array([0.1, 0.2, 0.4, 0.3, 0.2, 0.1]);
      const options = {
        frameSamples: global.Constants.VAD.DEFAULT_FRAME_SAMPLES,
        sampleRate: global.Constants.VAD.SAMPLE_RATE,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.3,
        redemptionFrames: global.Constants.VAD.REDEMPTION_FRAMES,
        minSpeechDurationMs: global.Constants.VAD.MIN_SPEECH_DURATION_MS,
        speechPadMs: global.Constants.VAD.SPEECH_PAD_MS,
      };
      const regions = generateFunc(probabilities, options);
      expect(regions.length).toBe(0);
    });

    test('high positive threshold should detect less speech', () => {
      const probabilities = new Float32Array([0.1, 0.6, 0.8, 0.9, 0.7, 0.2, 0.1]); // Speech frame: 3 (0.9)
      const options = {
        frameSamples: global.Constants.VAD.DEFAULT_FRAME_SAMPLES,
        sampleRate: global.Constants.VAD.SAMPLE_RATE,
        positiveSpeechThreshold: 0.85,
        negativeSpeechThreshold: 0.3,
        redemptionFrames: global.Constants.VAD.REDEMPTION_FRAMES,
        minSpeechDurationMs: global.Constants.VAD.MIN_SPEECH_DURATION_MS,
        speechPadMs: global.Constants.VAD.SPEECH_PAD_MS,
      };
      const regions = generateFunc(probabilities, options);
      expect(regions.length).toBe(1);
      // lastPositiveFrameIndex = 3. Raw region start: fd(3), end: fd(4)
      const expectedRawStart = frameDuration(3);
      const expectedRawEnd = frameDuration(4);
      const expectedPaddedStart = Math.max(0, expectedRawStart - (global.Constants.VAD.SPEECH_PAD_MS / 1000));
      const expectedPaddedEnd = Math.min(frameDuration(probabilities.length), expectedRawEnd + (global.Constants.VAD.SPEECH_PAD_MS / 1000));
      expect(regions[0].start).toBeCloseTo(expectedPaddedStart);
      expect(regions[0].end).toBeCloseTo(expectedPaddedEnd);
    });

    test('low positive threshold should detect more speech', () => {
      const probabilities = new Float32Array([0.1, 0.25, 0.3, 0.28, 0.1, 0.05]); // Speech: frames 1,2,3
      const options = {
        frameSamples: global.Constants.VAD.DEFAULT_FRAME_SAMPLES,
        sampleRate: global.Constants.VAD.SAMPLE_RATE,
        positiveSpeechThreshold: 0.2, // Lower threshold
        negativeSpeechThreshold: 0.1,
        redemptionFrames: global.Constants.VAD.REDEMPTION_FRAMES,
        minSpeechDurationMs: global.Constants.VAD.MIN_SPEECH_DURATION_MS,
        speechPadMs: global.Constants.VAD.SPEECH_PAD_MS,
      };
      const regions = generateFunc(probabilities, options);
      expect(regions.length).toBe(1);
      // lastPositiveFrameIndex = 3. Raw region start: fd(1), end: fd(4)
      const expectedRawStart = frameDuration(1);
      const expectedRawEnd = frameDuration(4);
      const expectedPaddedStart = Math.max(0, expectedRawStart - (global.Constants.VAD.SPEECH_PAD_MS / 1000));
      const expectedPaddedEnd = Math.min(frameDuration(probabilities.length), expectedRawEnd + (global.Constants.VAD.SPEECH_PAD_MS / 1000));
      expect(regions[0].start).toBeCloseTo(expectedPaddedStart);
      expect(regions[0].end).toBeCloseTo(expectedPaddedEnd);
    });

    test('impact of negative threshold and redemption frames', () => {
      // Dip below negative threshold for less than redemptionFrames should continue speech
      const probabilities1 = new Float32Array([0.8, 0.8, 0.2, 0.2, 0.8, 0.8]); // Dip of 2 frames
      const options1 = {
        frameSamples: global.Constants.VAD.DEFAULT_FRAME_SAMPLES,
        sampleRate: global.Constants.VAD.SAMPLE_RATE,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.3, // Dip is below this
        redemptionFrames: 3, // But dip length (2) < redemption (3)
        minSpeechDurationMs: global.Constants.VAD.MIN_SPEECH_DURATION_MS,
        speechPadMs: global.Constants.VAD.SPEECH_PAD_MS,
      };
      const regions1 = generateFunc(probabilities1, options1);
      expect(regions1.length).toBe(1); // Should be one continuous region
      // lastPositiveFrameIndex = 5. Raw region start: fd(0), end: fd(6)
      const expectedRawStart1 = frameDuration(0);
      const expectedRawEnd1 = frameDuration(6);
      const expectedPaddedStart1 = Math.max(0, expectedRawStart1 - (global.Constants.VAD.SPEECH_PAD_MS / 1000));
      const expectedPaddedEnd1 = Math.min(frameDuration(probabilities1.length), expectedRawEnd1 + (global.Constants.VAD.SPEECH_PAD_MS / 1000));
      expect(regions1[0].start).toBeCloseTo(expectedPaddedStart1);
      expect(regions1[0].end).toBeCloseTo(expectedPaddedEnd1);

      // Dip below negative threshold for redemptionFrames or more should break speech
      const probabilities2 = new Float32Array([0.8, 0.8, 0.2, 0.2, 0.2, 0.8, 0.8]); // Dip of 3 frames
      const options2 = { ...options1, redemptionFrames: 3 }; // Dip length (3) == redemption (3)
      const regions2 = generateFunc(probabilities2, options2);
      expect(regions2.length).toBe(2); // Should be two regions
      // Region 1: lastPositiveFrameIndex = 1. Raw start fd(0), end fd(2)
      // Region 2: lastPositiveFrameIndex = 6 (relative to its own start). Raw start fd(5), end fd(7)
    });

    test('should filter out segments shorter than MIN_SPEECH_DURATION_MS (after padding)', () => {
      const probabilities = new Float32Array([0.1, 0.9, 0.1]); // 1 frame of speech (index 1)
      const originalMinSpeechMs = global.Constants.VAD.MIN_SPEECH_DURATION_MS;
      global.Constants.VAD.MIN_SPEECH_DURATION_MS = 200; // Raw 96ms + Pad 100ms = 196ms. This should fail.

      const options = {
        frameSamples: global.Constants.VAD.DEFAULT_FRAME_SAMPLES,
        sampleRate: global.Constants.VAD.SAMPLE_RATE,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.3,
        redemptionFrames: global.Constants.VAD.REDEMPTION_FRAMES,
        minSpeechDurationMs: global.Constants.VAD.MIN_SPEECH_DURATION_MS, // Uses the mocked 200ms
        speechPadMs: global.Constants.VAD.SPEECH_PAD_MS,
      };
      const regions = generateFunc(probabilities, options);
      expect(regions.length).toBe(0);
      global.Constants.VAD.MIN_SPEECH_DURATION_MS = originalMinSpeechMs; // Restore
    });

    test('should apply SPEECH_PAD_MS to start and end of regions', () => {
      const probabilities = new Float32Array([0.1, 0.8, 0.8, 0.1]); // Speech frames 1, 2
      const options = {
        frameSamples: global.Constants.VAD.DEFAULT_FRAME_SAMPLES,
        sampleRate: global.Constants.VAD.SAMPLE_RATE,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.3,
        redemptionFrames: global.Constants.VAD.REDEMPTION_FRAMES,
        minSpeechDurationMs: global.Constants.VAD.MIN_SPEECH_DURATION_MS,
        speechPadMs: global.Constants.VAD.SPEECH_PAD_MS,
      };
      const regions = generateFunc(probabilities, options);
      expect(regions.length).toBe(1);
      // lastPositiveFrameIndex = 2. Raw region start: fd(1), end: fd(3)
      const expectedRawStart = frameDuration(1);
      const expectedRawEnd = frameDuration(3);
      const expectedPaddedStart = Math.max(0, expectedRawStart - (global.Constants.VAD.SPEECH_PAD_MS / 1000));
      const expectedPaddedEnd = Math.min(frameDuration(probabilities.length), expectedRawEnd + (global.Constants.VAD.SPEECH_PAD_MS / 1000));
      expect(regions[0].start).toBeCloseTo(expectedPaddedStart);
      expect(regions[0].end).toBeCloseTo(expectedPaddedEnd);
    });

    test('should merge overlapping regions after padding', () => {
      const probabilities = new Float32Array([0.1, 0.9, 0.9, 0.1, 0.9, 0.9, 0.1]); // Seg1: fr 1-2, Seg2: fr 4-5
      const options = {
        frameSamples: global.Constants.VAD.DEFAULT_FRAME_SAMPLES,
        sampleRate: global.Constants.VAD.SAMPLE_RATE,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.3,
        redemptionFrames: global.Constants.VAD.REDEMPTION_FRAMES, // Short redemption to prevent merging inside core logic
        minSpeechDurationMs: global.Constants.VAD.MIN_SPEECH_DURATION_MS,
        speechPadMs: global.Constants.VAD.SPEECH_PAD_MS, // 50ms pad
      };
      // Seg1 raw: fd(1) to fd(3). Padded: max(0, fd(1)-0.05) to fd(3)+0.05. -> 0.046 to 0.288+0.05=0.338
      // Seg2 raw: fd(4) to fd(6). Padded: max(0, fd(4)-0.05) to fd(6)+0.05. -> 0.384-0.05=0.334 to 0.576+0.05=0.626
      // These are now just touching or barely overlapping due to pad.
      // fd(1)=0.096, fd(3)=0.288. Padded S1: [0.046, 0.338]
      // fd(4)=0.384, fd(6)=0.576. Padded S2: [0.334, 0.626]
      // They overlap: 0.334 < 0.338. Merged: [0.046, 0.626]
      const regions = generateFunc(probabilities, options);
      expect(regions.length).toBe(1);
      const expectedMergedStart = Math.max(0, frameDuration(1) - (global.Constants.VAD.SPEECH_PAD_MS / 1000));
      const expectedMergedEnd = Math.min(frameDuration(probabilities.length), frameDuration(6) + (global.Constants.VAD.SPEECH_PAD_MS / 1000));
      expect(regions[0].start).toBeCloseTo(expectedMergedStart);
      expect(regions[0].end).toBeCloseTo(expectedMergedEnd);
    });

    test('should return empty array for empty probabilities', () => {
      const probabilities = new Float32Array([]);
      const options = {
        frameSamples: global.Constants.VAD.DEFAULT_FRAME_SAMPLES,
        sampleRate: global.Constants.VAD.SAMPLE_RATE,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.3,
        redemptionFrames: global.Constants.VAD.REDEMPTION_FRAMES,
        minSpeechDurationMs: global.Constants.VAD.MIN_SPEECH_DURATION_MS,
        speechPadMs: global.Constants.VAD.SPEECH_PAD_MS,
      };
      const regions = generateFunc(probabilities, options);
      expect(regions.length).toBe(0);
    });

    test('should handle probabilities all being 1.0', () => {
      const probabilities = new Float32Array([1.0, 1.0, 1.0, 1.0]);
      const options = {
        frameSamples: global.Constants.VAD.DEFAULT_FRAME_SAMPLES,
        sampleRate: global.Constants.VAD.SAMPLE_RATE,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.3,
        redemptionFrames: global.Constants.VAD.REDEMPTION_FRAMES,
        minSpeechDurationMs: global.Constants.VAD.MIN_SPEECH_DURATION_MS,
        speechPadMs: global.Constants.VAD.SPEECH_PAD_MS,
      };
      const regions = generateFunc(probabilities, options);
      expect(regions.length).toBe(1);
      // lastPositiveFrameIndex = 3. Raw region start: fd(0), end: fd(4)
      const expectedRawStart = frameDuration(0);
      const expectedRawEnd = frameDuration(4);
      const expectedPaddedStart = Math.max(0, expectedRawStart - (global.Constants.VAD.SPEECH_PAD_MS / 1000));
      const expectedPaddedEnd = Math.min(frameDuration(probabilities.length), expectedRawEnd + (global.Constants.VAD.SPEECH_PAD_MS / 1000));
      expect(regions[0].start).toBeCloseTo(expectedPaddedStart);
      expect(regions[0].end).toBeCloseTo(expectedPaddedEnd);
    });

    test('should handle probabilities all being 0.0', () => {
      const probabilities = new Float32Array([0.0, 0.0, 0.0, 0.0]);
      const options = {
        frameSamples: global.Constants.VAD.DEFAULT_FRAME_SAMPLES,
        sampleRate: global.Constants.VAD.SAMPLE_RATE,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.3,
        redemptionFrames: global.Constants.VAD.REDEMPTION_FRAMES,
        minSpeechDurationMs: global.Constants.VAD.MIN_SPEECH_DURATION_MS,
        speechPadMs: global.Constants.VAD.SPEECH_PAD_MS,
      };
      const regions = generateFunc(probabilities, options);
      expect(regions.length).toBe(0);
    });

  });
});
