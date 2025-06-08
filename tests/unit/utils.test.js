// tests/unit/utils.test.js

describe('AudioApp.Utils', () => {
  test('formatTime should correctly format seconds into mm:ss', () => {
    expect(AudioApp.Utils.formatTime(0)).toBe('0:00');
    expect(AudioApp.Utils.formatTime(59)).toBe('0:59');
    expect(AudioApp.Utils.formatTime(61)).toBe('1:01');
    expect(AudioApp.Utils.formatTime(150)).toBe('2:30');
    expect(AudioApp.Utils.formatTime(NaN)).toBe('0:00');
  });
});

describe('AudioApp.DTMFParser', () => {
  test('should be able to be instantiated', () => {
    const parser = new AudioApp.DTMFParser();
    expect(parser).toBeDefined();
    expect(typeof parser.processAudioBlock).toBe('function');
  });
});

// Updated to test the new global Constants class
describe('Constants', () => {
  test('should exist and contain essential constants structured correctly', () => {
    expect(Constants).toBeDefined();
    expect(Constants.AudioEngine.PROCESSOR_SCRIPT_URL).toBe('js/player/rubberbandProcessor.js');
    expect(Constants.VAD.SAMPLE_RATE).toBe(16000);
    expect(Constants.Visualizer.WAVEFORM_COLOR_SPEECH).toBe('#FDE725');
    // Add checks for other important constants if necessary
    expect(Constants.URLHashKeys.SPEED).toBe('speed');
    expect(Constants.UI.DEBOUNCE_HASH_UPDATE_MS).toBe(500);
    expect(Constants.DTMF.BLOCK_SIZE).toBe(410);
  });
});
