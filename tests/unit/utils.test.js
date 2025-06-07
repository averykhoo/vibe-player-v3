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
