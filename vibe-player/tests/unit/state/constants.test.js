// tests/unit/state/constants.test.js

describe('Constants Class', () => {
    test('should be defined globally and accessible in tests', () => {
        // This is the primary check. If Constants is not defined here, jest.setup.js
        // and the self-exporting mechanism in constants.js are not working as expected.
        expect(typeof Constants).not.toBe('undefined');
        if (typeof Constants === 'undefined') {
            console.error("Test Error: Constants class is undefined in constants.test.js");
            // Throw an error to make it very clear in test output if this fails.
            throw new Error("Test Error: Constants class is undefined in constants.test.js. Check jest.setup.js and the global assignment in constants.js.");
        }
    });

    // Only proceed with these if the above test passes or if we want to see detailed failures.
    // These tests assume 'Constants' is available.
    test('should have correct AudioEngine structure and key values', () => {
        if (typeof Constants === 'undefined') return; // Guard for cleaner output if first test fails
        expect(Constants.AudioEngine).toBeDefined();
        expect(Constants.AudioEngine.PROCESSOR_NAME).toBe('rubberband-processor');
        expect(Constants.AudioEngine.WASM_BINARY_URL).toBe('lib/rubberband.wasm');
    });

    test('should have correct VAD structure and key values', () => {
        if (typeof Constants === 'undefined') return;
        expect(Constants.VAD).toBeDefined();
        expect(Constants.VAD.SAMPLE_RATE).toBe(16000);
        expect(Constants.VAD.DEFAULT_POSITIVE_THRESHOLD).toBe(0.5);
    });

    test('should have correct UI structure and key values', () => {
        if (typeof Constants === 'undefined') return;
        expect(Constants.UI).toBeDefined();
        expect(Constants.UI.DEBOUNCE_HASH_UPDATE_MS).toBe(500);
    });

    test('should have correct Visualizer structure and key values', () => {
        if (typeof Constants === 'undefined') return;
        expect(Constants.Visualizer).toBeDefined();
        expect(Constants.Visualizer.WAVEFORM_COLOR_SPEECH).toBe('#FDE725');
    });

    test('should have correct URLHashKeys structure and key values', () => {
        if (typeof Constants === 'undefined') return;
        expect(Constants.URLHashKeys).toBeDefined();
        expect(Constants.URLHashKeys.SPEED).toBe('speed');
        expect(Constants.URLHashKeys.TIME).toBe('time');
    });

    test('should have correct DTMF structure and key values', () => {
        if (typeof Constants === 'undefined') return;
        expect(Constants.DTMF).toBeDefined();
        expect(Constants.DTMF.SAMPLE_RATE).toBe(16000);
    });
});
