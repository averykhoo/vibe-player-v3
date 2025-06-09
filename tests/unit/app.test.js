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

global.Constants = {
  UI: {
    SYNC_DEBOUNCE_WAIT_MS: 50,
    DEBOUNCE_HASH_UPDATE_MS: 250,
  },
  VAD: { // Ensure this is comprehensive for the tests
    DEFAULT_POSITIVE_THRESHOLD: 0.5, // Default for tests if not overridden
    DEFAULT_NEGATIVE_THRESHOLD: 0.35, // Default for tests
    SAMPLE_RATE: 16000,
    DEFAULT_FRAME_SAMPLES: 512, // Example, ensure it matches typical use or is clear in tests
    MIN_SPEECH_DURATION_MS: 100, // Adjusted for easier testing of short segments
    SPEECH_PAD_MS: 50,          // Adjusted for easier testing of padding
    REDEMPTION_FRAMES: 3,       // Adjusted for easier testing of redemption
    PROGRESS_REPORT_INTERVAL: 100, // Not directly used by generateSpeechRegionsFromProbs
    YIELD_INTERVAL: 200,           // Not directly used by generateSpeechRegionsFromProbs
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

  describe('generateSpeechRegionsFromProbs logic', () => {
    let generateFunc;
    const MOCK_SAMPLE_RATE = global.Constants.VAD.SAMPLE_RATE; // 16000
    const MOCK_FRAME_SAMPLES = global.Constants.VAD.DEFAULT_FRAME_SAMPLES; // e.g., 512
    const MOCK_REDEMPTION_FRAMES = global.Constants.VAD.REDEMPTION_FRAMES; // e.g., 3

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
      const probabilities = new Float32Array([0.1, 0.2, 0.8, 0.9, 0.7, 0.2, 0.1]);
      const options = {
        frameSamples: global.Constants.VAD.DEFAULT_FRAME_SAMPLES, // Use global directly here too for clarity
        sampleRate: global.Constants.VAD.SAMPLE_RATE,         // Use global directly
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.3,
        redemptionFrames: global.Constants.VAD.REDEMPTION_FRAMES, // Use global directly
      };

      // DEBUGGING LOGS START
      console.log('TEST: Running "should detect a basic speech segment correctly"');
      console.log('TEST: Probabilities length:', probabilities ? probabilities.length : 'null');
      // console.log('TEST: Probabilities content:', probabilities); // Might be too verbose
      console.log('TEST: Options:', JSON.stringify(options));
      console.log('TEST: Constants.VAD.SAMPLE_RATE for frameDuration:', global.Constants.VAD.SAMPLE_RATE);
      console.log('TEST: Constants.VAD.DEFAULT_FRAME_SAMPLES for frameDuration:', global.Constants.VAD.DEFAULT_FRAME_SAMPLES);
      console.log('TEST: frameDuration(1):', frameDuration(1));
      console.log('TEST: frameDuration(2):', frameDuration(2));
      console.log('TEST: frameDuration(5):', frameDuration(5));
      console.log('TEST: Constants.VAD.SPEECH_PAD_MS:', global.Constants.VAD.SPEECH_PAD_MS);
      // DEBUGGING LOGS END

      const regions = generateFunc(probabilities, options);

      console.log('TEST: Regions received:', JSON.stringify(regions)); // Log received regions

      expect(regions.length).toBe(1);
      expect(regions[0].start).toBeCloseTo(Math.max(0, frameDuration(2) - (global.Constants.VAD.SPEECH_PAD_MS / 1000)));
      expect(regions[0].end).toBeCloseTo(Math.min(frameDuration(probabilities.length), frameDuration(5) + (global.Constants.VAD.SPEECH_PAD_MS / 1000)));
    });

    test('should not detect speech if probabilities are below positive threshold', () => {
      const probabilities = new Float32Array([0.1, 0.2, 0.4, 0.3, 0.2, 0.1]);
      const options = {
        frameSamples: MOCK_FRAME_SAMPLES,
        sampleRate: MOCK_SAMPLE_RATE,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.3,
        redemptionFrames: MOCK_REDEMPTION_FRAMES,
      };
      const regions = generateFunc(probabilities, options);
      expect(regions.length).toBe(0);
    });

    test('high positive threshold should detect less speech', () => {
      const probabilities = new Float32Array([0.1, 0.6, 0.8, 0.9, 0.7, 0.2, 0.1]);
      const options = {
        frameSamples: MOCK_FRAME_SAMPLES,
        sampleRate: MOCK_SAMPLE_RATE,
        positiveSpeechThreshold: 0.85, // Higher threshold
        negativeSpeechThreshold: 0.3,
        redemptionFrames: MOCK_REDEMPTION_FRAMES,
      };
      const regions = generateFunc(probabilities, options);
      // Expected: Only frame 3 (0.9) is speech. Start = 3*frameDur, End = 4*frameDur
      // Padded: start=max(0, frameDur(3)-pad), end=frameDur(4)+pad. Duration=frameDur(1)+2*pad
      // Original duration = 32ms. Padded dur = 32 + 100 = 132ms. This should pass.
      expect(regions.length).toBe(1);
      expect(regions[0].start).toBeCloseTo(Math.max(0, frameDuration(3) - (Constants.VAD.SPEECH_PAD_MS / 1000)));
      expect(regions[0].end).toBeCloseTo(Math.min(frameDuration(probabilities.length), frameDuration(4) + (Constants.VAD.SPEECH_PAD_MS / 1000)));
    });

    test('low positive threshold should detect more speech', () => {
      const probabilities = new Float32Array([0.1, 0.25, 0.3, 0.28, 0.1, 0.05]);
      const options = {
        frameSamples: MOCK_FRAME_SAMPLES,
        sampleRate: MOCK_SAMPLE_RATE,
        positiveSpeechThreshold: 0.2, // Lower threshold
        negativeSpeechThreshold: 0.1,
        redemptionFrames: MOCK_REDEMPTION_FRAMES,
      };
      const regions = generateFunc(probabilities, options);
      // Expected: Frames 1,2,3 are speech. Start=frameDur(1), End=frameDur(4)
      expect(regions.length).toBe(1);
      expect(regions[0].start).toBeCloseTo(Math.max(0, frameDuration(1) - (Constants.VAD.SPEECH_PAD_MS / 1000)));
      expect(regions[0].end).toBeCloseTo(Math.min(frameDuration(probabilities.length), frameDuration(4) + (Constants.VAD.SPEECH_PAD_MS / 1000)));
    });

    test('impact of negative threshold and redemption frames', () => {
      // Dip below negative threshold for less than redemptionFrames should continue speech
      const probabilities1 = new Float32Array([0.8, 0.8, 0.2, 0.2, 0.8, 0.8]); // Dip of 2 frames
      const options1 = {
        frameSamples: MOCK_FRAME_SAMPLES,
        sampleRate: MOCK_SAMPLE_RATE,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.3, // Dip is below this
        redemptionFrames: 3, // But dip length (2) < redemption (3)
      };
      const regions1 = generateFunc(probabilities1, options1);
      expect(regions1.length).toBe(1); // Should be one continuous region
      expect(regions1[0].start).toBeCloseTo(Math.max(0, frameDuration(0) - (Constants.VAD.SPEECH_PAD_MS / 1000)));
      expect(regions1[0].end).toBeCloseTo(Math.min(frameDuration(probabilities1.length), frameDuration(6) + (Constants.VAD.SPEECH_PAD_MS / 1000)));

      // Dip below negative threshold for redemptionFrames or more should break speech
      const probabilities2 = new Float32Array([0.8, 0.8, 0.2, 0.2, 0.2, 0.8, 0.8]); // Dip of 3 frames
      const options2 = { ...options1, redemptionFrames: 3 }; // Dip length (3) == redemption (3)
      const regions2 = generateFunc(probabilities2, options2);
      expect(regions2.length).toBe(2); // Should be two regions
    });

    test('should filter out segments shorter than MIN_SPEECH_DURATION_MS (after padding)', () => {
      // Frame duration = 32ms. MIN_SPEECH_DURATION_MS = 100ms. SPEECH_PAD_MS = 50ms.
      // A 1-frame speech segment (32ms) + 2*50ms padding = 132ms. This SHOULD pass.
      let probabilities = new Float32Array([0.1, 0.9, 0.1]); // 1 frame of speech
      const options = {
        frameSamples: MOCK_FRAME_SAMPLES,
        sampleRate: MOCK_SAMPLE_RATE,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.3,
        redemptionFrames: MOCK_REDEMPTION_FRAMES,
      };
      let regions = generateFunc(probabilities, options);
      expect(regions.length).toBe(1);

      // To make it fail, the original segment would need to be so short that padding doesn't save it.
      // Example: if MIN_SPEECH_DURATION_MS = 150ms. Then 1 frame (32ms) + 100ms padding = 132ms < 150ms.
      // For this, we'd mock Constants.VAD.MIN_SPEECH_DURATION_MS temporarily.
      const originalMinSpeech = Constants.VAD.MIN_SPEECH_DURATION_MS;
      Constants.VAD.MIN_SPEECH_DURATION_MS = 150;
      regions = generateFunc(probabilities, options); // Same 1-frame speech
      expect(regions.length).toBe(0);
      Constants.VAD.MIN_SPEECH_DURATION_MS = originalMinSpeech; // Restore
    });

    test('should apply SPEECH_PAD_MS to start and end of regions', () => {
      const probabilities = new Float32Array([0.1, 0.8, 0.8, 0.1]); // Speech frames 1, 2
      const options = {
        frameSamples: MOCK_FRAME_SAMPLES,
        sampleRate: MOCK_SAMPLE_RATE,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.3,
        redemptionFrames: MOCK_REDEMPTION_FRAMES,
      };
      const regions = generateFunc(probabilities, options);
      expect(regions.length).toBe(1);
      // Original start: frameDuration(1). Original end: frameDuration(3)
      const expectedStart = Math.max(0, frameDuration(1) - (Constants.VAD.SPEECH_PAD_MS / 1000));
      const expectedEnd = Math.min(frameDuration(probabilities.length), frameDuration(3) + (Constants.VAD.SPEECH_PAD_MS / 1000));
      expect(regions[0].start).toBeCloseTo(expectedStart);
      expect(regions[0].end).toBeCloseTo(expectedEnd);
    });

    test('should merge overlapping regions after padding', () => {
      // Two speech segments: frames 1-2 and frames 4-5.
      // Frame duration = 32ms. Pad = 50ms.
      // Seg1 (raw): 0.032s to 0.096s (frames 1,2. End is at start of frame 3)
      // Seg1 (padded): max(0, 0.032-0.05) = 0s to 0.096+0.05 = 0.146s
      // Seg2 (raw): 0.128s to 0.192s (frames 4,5. End is at start of frame 6)
      // Seg2 (padded): max(0, 0.128-0.05) = 0.078s to 0.192+0.05 = 0.242s
      // Padded Seg1 (0 to 0.146) and Padded Seg2 (0.078 to 0.242) overlap.
      // Expected merged: 0s to 0.242s.
      const probabilities = new Float32Array([0.1, 0.9, 0.9, 0.1, 0.9, 0.9, 0.1]);
      const options = {
        frameSamples: MOCK_FRAME_SAMPLES,
        sampleRate: MOCK_SAMPLE_RATE,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.3,
        redemptionFrames: MOCK_REDEMPTION_FRAMES,
      };
      const regions = generateFunc(probabilities, options);
      expect(regions.length).toBe(1);
      const expectedStart = Math.max(0, frameDuration(1) - (Constants.VAD.SPEECH_PAD_MS / 1000));
      const expectedEnd = Math.min(frameDuration(probabilities.length), frameDuration(6) + (Constants.VAD.SPEECH_PAD_MS / 1000));
      expect(regions[0].start).toBeCloseTo(expectedStart);
      expect(regions[0].end).toBeCloseTo(expectedEnd);
    });

    test('should return empty array for empty probabilities', () => {
      const probabilities = new Float32Array([]);
      const options = {
        frameSamples: MOCK_FRAME_SAMPLES,
        sampleRate: MOCK_SAMPLE_RATE,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.3,
        redemptionFrames: MOCK_REDEMPTION_FRAMES,
      };
      const regions = generateFunc(probabilities, options);
      expect(regions.length).toBe(0);
    });

    test('should handle probabilities all being 1.0', () => {
      const probabilities = new Float32Array([1.0, 1.0, 1.0, 1.0]);
      const options = {
        frameSamples: MOCK_FRAME_SAMPLES,
        sampleRate: MOCK_SAMPLE_RATE,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.3,
        redemptionFrames: MOCK_REDEMPTION_FRAMES,
      };
      const regions = generateFunc(probabilities, options);
      expect(regions.length).toBe(1);
      expect(regions[0].start).toBeCloseTo(Math.max(0, frameDuration(0) - (Constants.VAD.SPEECH_PAD_MS / 1000)));
      expect(regions[0].end).toBeCloseTo(Math.min(frameDuration(probabilities.length), frameDuration(4) + (Constants.VAD.SPEECH_PAD_MS / 1000)));
    });

    test('should handle probabilities all being 0.0', () => {
      const probabilities = new Float32Array([0.0, 0.0, 0.0, 0.0]);
      const options = {
        frameSamples: MOCK_FRAME_SAMPLES,
        sampleRate: MOCK_SAMPLE_RATE,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.3,
        redemptionFrames: MOCK_REDEMPTION_FRAMES,
      };
      const regions = generateFunc(probabilities, options);
      expect(regions.length).toBe(0);
    });

  });
});
