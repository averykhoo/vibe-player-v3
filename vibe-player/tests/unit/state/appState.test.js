// tests/unit/state/appState.test.js

describe('AppState Class', () => {
    let appState;

    beforeEach(() => {
        // Ensure Constants is available if AppState relies on it for defaults
        if (typeof Constants === 'undefined') {
            // This error will fail the test suite if Constants isn't loaded by jest.setup.js
            throw new Error("AppState tests require Constants to be globally available.");
        }
        // Create a new AppState instance for each test to ensure isolation
        // This also relies on AppState being globally available via jest.setup.js
        if (typeof AppState === 'undefined') {
            throw new Error("AppState tests require AppState to be globally available to instantiate.");
        }
        appState = new AppState();
    });

    test('should be defined globally and instantiable', () => {
        expect(typeof AppState).not.toBe('undefined');
        // The check below is redundant due to beforeEach, but good for explicit clarity
        if (typeof AppState === 'undefined') {
            throw new Error("Test Error: AppState class is undefined in appState.test.js.");
        }
        expect(appState).toBeInstanceOf(AppState);
    });

    describe('Constructor and Default Values', () => {
        test('should initialize params with default values', () => {
            expect(appState.params.speed).toBe(1.0);
            expect(appState.params.pitch).toBe(1.0);
            expect(appState.params.gain).toBe(1.0);
            // Constants should be defined here due to the check in beforeEach
            expect(appState.params.vadPositive).toBe(Constants.VAD.DEFAULT_POSITIVE_THRESHOLD);
            expect(appState.params.vadNegative).toBe(Constants.VAD.DEFAULT_NEGATIVE_THRESHOLD);
            expect(appState.params.audioUrl).toBe("");
            expect(appState.params.jumpTime).toBe(5);
            expect(appState.params.initialSeekTime).toBeNull();
        });

        test('should initialize runtime with default values', () => {
            expect(appState.runtime.currentAudioBuffer).toBeNull();
            expect(appState.runtime.currentVadResults).toBeNull();
            expect(appState.runtime.currentFile).toBeNull();
            expect(appState.runtime.playbackStartTimeContext).toBeNull();
            expect(appState.runtime.playbackStartSourceTime).toBe(0.0);
            expect(appState.runtime.currentSpeedForUpdate).toBe(1.0);
        });

        test('should initialize status with default values', () => {
            expect(appState.status.isActuallyPlaying).toBe(false);
            expect(appState.status.workletPlaybackReady).toBe(false);
            expect(appState.status.vadModelReady).toBe(false);
            expect(appState.status.isVadProcessing).toBe(false);
            expect(appState.status.playbackNaturallyEnded).toBe(false);
            expect(appState.status.urlInputStyle).toBe('default');
            expect(appState.status.fileInfoMessage).toBe("No file selected.");
            expect(appState.status.urlLoadingErrorMessage).toBe("");
        });
    });

    describe('State Update Methods', () => {
        test('updateParam should update a param and notify subscribers', () => {
            const mockSpecificSubscriber = jest.fn();
            const mockGenericSubscriber = jest.fn();
            appState.subscribe('param:speed:changed', mockSpecificSubscriber);
            appState.subscribe('param:changed', mockGenericSubscriber);

            appState.updateParam('speed', 1.5);

            expect(appState.params.speed).toBe(1.5);
            expect(mockSpecificSubscriber).toHaveBeenCalledWith(1.5);
            expect(mockSpecificSubscriber).toHaveBeenCalledTimes(1);
            expect(mockGenericSubscriber).toHaveBeenCalledWith({ param: 'speed', value: 1.5 });
            expect(mockGenericSubscriber).toHaveBeenCalledTimes(1);
        });

        test('updateParam should not notify if value is unchanged', () => {
            appState.updateParam('speed', 1.5); // Set initial value
            const mockSubscriber = jest.fn();
            const mockGenericSubscriber = jest.fn();
            appState.subscribe('param:speed:changed', mockSubscriber);
            appState.subscribe('param:changed', mockGenericSubscriber);

            appState.updateParam('speed', 1.5); // Update with same value

            expect(mockSubscriber).not.toHaveBeenCalled();
            expect(mockGenericSubscriber).not.toHaveBeenCalled();
        });

        test('updateParam should warn for unknown param and not update', () => {
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            const originalParams = JSON.parse(JSON.stringify(appState.params)); // Deep copy

            appState.updateParam('unknownParam', 999);

            expect(appState.params).toEqual(originalParams); // Ensure params object is not changed
            expect(consoleWarnSpy).toHaveBeenCalledWith('AppState: Attempted to update unknown param "unknownParam"');
            consoleWarnSpy.mockRestore();
        });


        test('updateRuntime should update a runtime property and notify', () => {
            const mockSubscriber = jest.fn();
            appState.subscribe('runtime:currentAudioBuffer:changed', mockSubscriber);
            const newBuffer = { id: 'testBuffer' }; // Mock buffer
            appState.updateRuntime('currentAudioBuffer', newBuffer);
            expect(appState.runtime.currentAudioBuffer).toEqual(newBuffer);
            expect(mockSubscriber).toHaveBeenCalledWith(newBuffer);
        });

        test('updateStatus should update a status flag and notify', () => {
            const mockSubscriber = jest.fn();
            appState.subscribe('status:isActuallyPlaying:changed', mockSubscriber);
            appState.updateStatus('isActuallyPlaying', true);
            expect(appState.status.isActuallyPlaying).toBe(true);
            expect(mockSubscriber).toHaveBeenCalledWith(true);
        });
    });

    describe('Publisher/Subscriber System', () => {
        test('should allow subscription and unsubscription', () => {
            const mockCallback = jest.fn();
            appState.subscribe('testEvent', mockCallback);
            appState._notify('testEvent', 'testData');
            expect(mockCallback).toHaveBeenCalledWith('testData');

            appState.unsubscribe('testEvent', mockCallback);
            appState._notify('testEvent', 'testData2');
            expect(mockCallback).toHaveBeenCalledTimes(1); // Should not be called again
        });

        test('unsubscribe should remove event key if no callbacks remain', () => {
            const cb1 = jest.fn();
            appState.subscribe('emptyEvent', cb1);
            expect(appState._subscribers['emptyEvent']).toBeDefined();
            appState.unsubscribe('emptyEvent', cb1);
            expect(appState._subscribers['emptyEvent']).toBeUndefined();
        });

        test('should handle multiple subscribers for an event', () => {
            const cb1 = jest.fn();
            const cb2 = jest.fn();
            appState.subscribe('multiEvent', cb1);
            appState.subscribe('multiEvent', cb2);
            appState._notify('multiEvent', 'data');
            expect(cb1).toHaveBeenCalledWith('data');
            expect(cb2).toHaveBeenCalledWith('data');
        });

        test('subscribe should not add same callback multiple times', () => {
            const cb1 = jest.fn();
            appState.subscribe('singleCbTest', cb1);
            appState.subscribe('singleCbTest', cb1);
            expect(appState._subscribers['singleCbTest'].length).toBe(1);
        });

        test('_notify should handle errors in callbacks gracefully', () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const cb1 = jest.fn(() => { throw new Error("Test CB Error"); });
            const cb2 = jest.fn();

            appState.subscribe('errorTestEvent', cb1);
            appState.subscribe('errorTestEvent', cb2);
            appState._notify('errorTestEvent', 'data');

            expect(cb1).toHaveBeenCalledWith('data');
            expect(cb2).toHaveBeenCalledWith('data'); // cb2 should still be called
            expect(consoleErrorSpy).toHaveBeenCalled();
            consoleErrorSpy.mockRestore();
        });
    });

    describe('Serialization/Deserialization', () => {
        test('serialize should produce correct hash string for non-default values', () => {
            appState.updateParam('speed', 1.25);
            appState.updateParam('pitch', 0.75);
            appState.updateParam('audioUrl', 'http://example.com/audio.mp3');
            // Deliberately set one VAD param to non-default
            appState.updateParam('vadPositive', 0.6);


            const hash = appState.serialize(123.45);
            const searchParams = new URLSearchParams(hash);

            expect(searchParams.get(Constants.URLHashKeys.SPEED)).toBe('1.25');
            expect(searchParams.get(Constants.URLHashKeys.PITCH)).toBe('0.75');
            expect(searchParams.get(Constants.URLHashKeys.AUDIO_URL)).toBe('http://example.com/audio.mp3');
            expect(searchParams.get(Constants.URLHashKeys.TIME)).toBe('123.45');
            expect(searchParams.get(Constants.URLHashKeys.VAD_POSITIVE)).toBe('0.60');
            // Ensure non-changed defaults are not in the hash
            expect(searchParams.has(Constants.URLHashKeys.GAIN)).toBe(false);
            expect(searchParams.has(Constants.URLHashKeys.VAD_NEGATIVE)).toBe(false);
        });

        test('serialize should return empty string if all params are default and no time', () => {
            // All params are already default in a new instance
            const hash = appState.serialize(0); // time 0 or undefined should not be included
            expect(hash).toBe('');
            const hash2 = appState.serialize();
            expect(hash2).toBe('');
        });

        test('deserialize should update params correctly from hash string', () => {
            const hash = 'speed=1.5&pitch=0.8&url=test.mp3&time=10.5&vadPositive=0.75&gain=0.5';
            // Mock updateParam to check calls if direct state checking is complex
            // For this test, we'll check the state directly after deserialize
            appState.deserialize(hash);

            expect(appState.params.speed).toBe(1.5);
            expect(appState.params.pitch).toBe(0.8);
            expect(appState.params.audioUrl).toBe('test.mp3');
            expect(appState.params.initialSeekTime).toBe(10.5);
            expect(appState.params.vadPositive).toBe(0.75);
            expect(appState.params.gain).toBe(0.5);
            // Ensure params not in hash remain default
            expect(appState.params.vadNegative).toBe(Constants.VAD.DEFAULT_NEGATIVE_THRESHOLD);
            expect(appState.params.jumpTime).toBe(5); // Assuming default jumpTime is 5
        });

        test('deserialize should handle empty, null, or undefined hash string gracefully', () => {
            // Spy on updateParam to ensure it's not called
            const updateParamSpy = jest.spyOn(appState, 'updateParam');
            appState.deserialize('');
            expect(updateParamSpy).not.toHaveBeenCalled();
            appState.deserialize(null);
            expect(updateParamSpy).not.toHaveBeenCalled();
            appState.deserialize(undefined);
            expect(updateParamSpy).not.toHaveBeenCalled();
            updateParamSpy.mockRestore();
        });

        test('deserialize should not update params if values are invalid', () => {
            const hash = 'speed=abc&pitch=xyz&gain=foo&vadPositive=bar&vadNegative=baz&time=qux';
            const originalParamsJSON = JSON.stringify(appState.params);

            appState.deserialize(hash);

            // Check that params object is unchanged because all parsed values would be NaN
            expect(JSON.stringify(appState.params)).toEqual(originalParamsJSON);
        });
    });
});
