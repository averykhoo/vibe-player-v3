<!-- /vibe-player/TODO.md -->
# Vibe Player - TODO & Future Ideas

This file tracks potential improvements, features, and known issues requiring further investigation for the Vibe Player project.

## Bugs / Issues

*   **[INVESTIGATE] Formant Shift:** The formant shift feature provided by Rubberband WASM is currently non-functional (no audible effect despite parameter being set). Requires deeper investigation into Rubberband flags, potential WASM build issues, or alternative approaches if the library feature is fundamentally broken in this context.

## Potential Enhancements / Features

*   **VAD Probability Graph:** Add a visualization showing the raw VAD probability scores over time, with draggable horizontal lines indicating the current positive/negative thresholds. This would make the VAD process more transparent and tuning more intuitive.
*   **VAD Worker:** Migrate Silero VAD processing (`sileroProcessor`, `sileroWrapper`) to a separate Web Worker. This would eliminate potential UI jank during analysis and allow VAD to complete even if the tab is backgrounded. Requires setting up worker communication.
*   **Visualizer Computation Worker(s):** Migrate Waveform and/or Spectrogram *computation* logic to Web Worker(s). The main thread would only handle Canvas drawing based on received data, further improving responsiveness, especially for long files.
*   **Improved Spectrogram Rendering:** Explore true progressive computation/rendering for the spectrogram, where slices are calculated and drawn incrementally, rather than computing all data upfront.
*   **Error Handling UI:** Display user-friendly error messages in the UI for issues like decoding failures, VAD errors, etc., instead of relying solely on `console.error` and generic file info updates.
*   **State Management Module (`audioPlayerState.js`):** Consider creating a dedicated module to manage playback-related state (`isPlaying`, `currentTime`, speed/pitch targets) currently spread between `app.js` and `audioEngine.js`. This could improve separation of concerns if the application grows more complex.
*   **Parameter Smoothing:** Investigate if parameter changes (speed, pitch) sent to Rubberband could benefit from smoother transitions (if supported by the library/worklet) to avoid abrupt audio changes.
*   **Preset Management:** Allow saving/loading sets of Speed/Pitch/Gain/VAD settings.
* Windows 98 sounds on click etc
* Hide VAD tuning or add a graph to show the probs, start and stop thresholds, and color that too but faded?
* more player controls? maybe up and down to change speed by 0.25? enter also to play/pause? make the keybinds modifiable? and savable in local storage? and a reset button too if so
* add a 'back to start' button near play/pause and a 'reset' button to controls / vad controls

## Code Health / Refactoring Ideas

*   **Review `app.js` Complexity:** As features are added, monitor the size and complexity of `app.js`. If it becomes too large, revisit introducing a more formal state management pattern or further decomposing its responsibilities.
*   **Review `audioEngine.js` State:** Re-evaluate if `audioEngine` can be made more stateless regarding playback parameters (see `audioPlayerState.js` idea above).
*   **Automated Testing:** Introduce some form of automated testing (e.g., unit tests for utility functions, potentially integration tests for core flows if feasible without excessive mocking) to improve regression safety (currently relies on manual testing - C5).

<!-- /vibe-player/TODO.md -->
