<!-- /vibe-player/TODO.md -->

# Vibe Player - TODO & Future Ideas

This file tracks potential improvements, features, and known issues requiring further investigation for the Vibe Player
project. The list is prioritized, with the most impactful and straightforward tasks at the top.

---

### Priority 1: High-Impact UI/UX Features

These are "quick win" features that directly improve usability and the user experience.

* **Implement UI Control Buttons:**
    * **Task:** Add "Back to Start" and "Reset Controls" buttons to the main interface.
    * **Details:** The "Back to Start" button should seek playback to `0:00`. The "Reset Controls" button should reset
      Speed, Pitch, Gain, and VAD thresholds to their default values. This provides essential, convenient user actions.

* **Complete `jumpTime` Data Flow:**
    * **Task:** Refactor the "Jump Time" input to use the centralized `AppState`.
    * **Details:** Currently, the jump value is read directly from the DOM. This should be updated to follow the
      unidirectional data flow pattern: the input field should update `AppState`, and the jump logic should read its
      value from `AppState`. This is a code quality improvement that completes the state refactor.

---

### Priority 2: Core Functionality & Bug Fixes

This addresses the most significant known issue with an audio processing feature.

* **[INVESTIGATE] Formant Shift Functionality:**
    * **Task:** The formant shift feature is implemented but has no audible effect. Investigate the cause and either fix
      it or remove the control.
    * **Details:** This requires deep-diving into the Rubberband WASM library's flags and documentation. If a fix is not
      feasible, the formant slider should be removed from the UI to avoid user confusion.

---

### Priority 3: Advanced Features & Visualizations

These are larger features that build on the stable foundation to provide more power to the user.

* **VAD Probability Graph:**
    * **Task:** Add a new visualization that shows the raw VAD probability scores over time.
    * **Details:** This graph should align with the waveform and spectrogram. Ideally, it would include draggable
      horizontal lines for the positive/negative thresholds, making VAD tuning highly intuitive. This requires modifying
      the VAD worker to send back the full probability array.

* **Advanced Player Controls & Keybinds:**
    * **Task:** Investigate and potentially implement more granular controls (e.g., frame-by-frame stepping).
    * **Details:** Also, consider making keyboard shortcuts customizable by the user, with settings saved to
      `localStorage`.

---

### Priority 4: Long-Term Code Health & Robustness

These are ongoing tasks to ensure the project remains maintainable and reliable.

* **Expand Automated Testing:**
    * **Task:** Increase test coverage with more unit and integration tests.
    * **Details:** Now that the architecture is more modular, modules like `audioEngine` and `uiManager` can be more
      easily tested. This is crucial for preventing regressions as new features are added.

* **Continue `app.js` Refactoring:**
    * **Task:** Reduce the complexity of `app.js` by moving distinct responsibilities to more specialized modules.
    * **Details:** For example, the VAD and Tone analysis orchestration logic could be moved out of `app.js` into a
      dedicated `analysisOrchestrator.js` module. This improves separation of concerns and maintainability.

---

### Others

* **Improved Spectrogram Rendering:** Explore true progressive computation/rendering for the spectrogram, where slices
  are calculated and drawn incrementally, rather than computing all data upfront.
* Improve typing, docstrings, comment section headers, make the header and footer comment with the file path consistent 

---

### Done / Completed

* ~~**[DONE]** Refactor state management into a centralized `AppState` module.~~
* ~~**[DONE]** Move VAD processing to a Web Worker to prevent UI freezes.~~
* ~~**[DONE]** Offload Spectrogram FFT computation to a Web Worker.~~
* ~~**[DONE]** Fix critical script loading order and initialization bugs.~~
* ~~**[WON'T DO]** Implement Windows 98-style UI sounds for interactions

<!-- /vibe-player/TODO.md -->
