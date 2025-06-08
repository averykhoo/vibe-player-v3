# Vibe Player - Refactoring and Enhancement Plan

This document outlines proposed refactoring tasks, feature enhancements (some derived from `TODO.md`), and general code
health improvements for the Vibe Player project. The goal is to enhance performance, modularity, user experience, and
maintainability.

## Theme 1: Performance & Responsiveness (Offloading to Web Workers)

### 1.1. Implement VAD Processing in a Web Worker

* **Goal:** Move Silero VAD model inference and associated audio processing (resampling if specific to VAD, frame
  iteration) to a Web Worker.
* **Description/Rationale:** VAD analysis, especially on longer audio files, can be computationally intensive and block
  the main thread, leading to UI sluggishness. Offloading to a worker will improve UI responsiveness. Addresses "VAD
  Worker" TODO.
* **Affected Components:**
    * `vibe-player/js/vad/sileroWrapper.js`
    * `vibe-player/js/vad/sileroProcessor.js`
    * `vibe-player/js/vad/vadAnalyzer.js`
    * `vibe-player/js/app.js` (orchestration)
    * `vibe-player/js/player/audioEngine.js` (for resampling, if worker needs raw data)
* **Proposed Action/Implementation Steps:**
    1. Create `vad.worker.js` that will host `sileroWrapper` and `sileroProcessor` logic.
    2. Modify `sileroWrapper` and `sileroProcessor` to operate with message passing for audio data input and VAD results
       output.
    3. Update `vadAnalyzer.js` to manage communication (postMessage/onmessage) with `vad.worker.js`.
    4. `app.js` will initiate VAD processing via `vadAnalyzer` and receive results asynchronously.
    5. Handle ONNX model and library loading within the worker context (e.g., `importScripts` for `ort.min.js`).
    6. Ensure resampling to 16kHz mono is handled efficiently, either in `audioEngine` before sending to worker or
       within the worker if it receives the full `AudioBuffer`.
* **(Optional) Related TODOs:** "VAD Worker: Move VAD to a worker thread to prevent UI freezes."

### 1.2. Offload Waveform Data Computation to a Web Worker

* **Goal:** Move the computation of waveform visual data (peak values for drawing) to a Web Worker.
* **Description/Rationale:** For very long audio files, iterating through the entire `AudioBuffer` to compute min/max
  samples per pixel can be time-consuming and delay the initial display or cause jank during resizing.
* **Affected Components:**
    * `vibe-player/js/visualizers/waveformVisualizer.js`
    * `vibe-player/js/app.js` (if orchestration changes)
* **Proposed Action/Implementation Steps:**
    1. Create `waveform.worker.js`.
    2. Transfer `AudioBuffer` data (or relevant channel data) to the worker.
    3. The worker computes the array of min/max values or the points for the path and sends it back to
       `waveformVisualizer.js`.
    4. `waveformVisualizer.js` then focuses only on rendering the pre-computed data.
* **(Optional) Related TODOs:** "Visualizer Worker: Waveform + Spectrogram processing in worker?" (partially addresses)

### 1.3. Offload Spectrogram FFT Computation to a Web Worker

* **Goal:** Move the FFT computation for the spectrogram to a Web Worker.
* **Description/Rationale:** FFT calculation across the entire audio duration is a significant computational load.
  Offloading will prevent UI freezes during initial spectrogram generation.
* **Affected Components:**
    * `vibe-player/js/visualizers/spectrogramVisualizer.js`
    * `vibe-player/lib/fft.js` (or its usage)
* **Proposed Action/Implementation Steps:**
    1. Create `spectrogram.worker.js`.
    2. Transfer `AudioBuffer` data to the worker.
    3. The worker performs all FFT calculations (potentially in chunks) and sends back the spectrogram data (e.g.,
       magnitude arrays) for rendering.
    4. `spectrogramVisualizer.js` receives this data and handles drawing to the canvas.
* **(Optional) Related TODOs:** "Visualizer Worker: Waveform + Spectrogram processing in worker?" (partially addresses)

### 1.4. Investigate Progressive Spectrogram Computation/Rendering

* **Goal:** Improve perceived performance of spectrogram display by rendering it progressively as data is computed.
* **Description/Rationale:** Instead of waiting for the entire spectrogram to be computed before drawing, display chunks
  as they become available. This would be particularly beneficial if full worker offloading (1.3) is complex or has
  large data transfer overhead for the complete result.
* **Affected Components:**
    * `vibe-player/js/visualizers/spectrogramVisualizer.js`
    * (Potentially) `spectrogram.worker.js` if implemented.
* **Proposed Action/Implementation Steps:**
    1. Modify `spectrogramVisualizer.js` (and worker, if applicable) to process the audio in segments.
    2. After each segment's FFT data is ready, send it back to the main thread and draw that portion of the spectrogram.
    3. Provide visual feedback that computation is ongoing.
* **(Optional) Related TODOs:** "Visualizer: Progressive Spectrogram: Compute/draw in chunks to show progress."

## Theme 2: State Management & Modularity

### 2.1. Introduce a Dedicated State Management Module

* **Goal:** Centralize and manage shared application state more formally, reducing direct state manipulation in `app.js`
  and improving predictability.
* **Description/Rationale:** Currently, `app.js` holds much of the core state (`currentAudioBuffer`,
  `workletPlaybackReady`, VAD results, etc.). A dedicated module could use a simple pub/sub model or a more structured
  approach (like a simplified Redux-like store) for state updates and notifications.
* **Affected Components:**
    * `vibe-player/js/app.js` (major refactor)
    * All modules that currently read/write state directly from/to `app.js` (e.g., `uiManager.js`, `audioEngine.js`,
      `vadAnalyzer.js`).
* **Proposed Action/Implementation Steps:**
    1. Design a simple state store (e.g., `stateStore.js`) with methods like `getState()`, `setState()`, `subscribe()`.
    2. Identify core shared state variables.
    3. Refactor `app.js` and other modules to interact with `stateStore.js` for state changes and reads.
    4. Use subscriptions to trigger UI updates or dependent logic.
* **(Optional) Related TODOs:** "State: Central state management (event bus or simple store)."

### 2.2. Refactor `app.js` for Better Modularity

* **Goal:** Reduce the size and complexity of `app.js` by delegating more responsibilities to specialized modules.
* **Description/Rationale:** `app.js` currently handles a wide range of tasks (initialization, event handling for UI and
  audio engine, VAD orchestration, tone detection orchestration, time display). Breaking this down will improve
  maintainability.
* **Affected Components:**
    * `vibe-player/js/app.js` (major refactor)
    * Potentially create new modules for specific orchestrations (e.g., `analysisCoordinator.js` for VAD/Tones).
* **Proposed Action/Implementation Steps:**
    1. Identify distinct responsibilities within `app.js`.
    2. Consider moving VAD and Tone detection orchestration logic into a new module (e.g., `analysisOrchestrator.js`)
       that `app.js` calls.
    3. Ensure event handling is clearly delineated, perhaps with more focused handlers or sub-modules.
    4. If a state store (2.1) is implemented, `app.js` would become more of a central coordinator of modules and less of
       a state container.

## Theme 3: UI/UX Enhancements & Features

### 3.1. Implement Enhanced Error Handling UI

* **Goal:** Provide more specific and user-friendly error messages and recovery options.
* **Description/Rationale:** Current error handling is often via `console.error` or generic alerts. A dedicated UI
  component for errors would improve UX.
* **Affected Components:**
    * `vibe-player/js/uiManager.js`
    * Error-prone areas in `audioEngine.js`, `sileroWrapper.js`, `app.js`.
* **Proposed Action/Implementation Steps:**
    1. Design a non-intrusive UI element for displaying errors (e.g., a toast notification, a modal, or a dedicated
       error panel).
    2. Categorize common errors (e.g., file load/decode, VAD model load, audio processing).
    3. Implement a global error handling function or service that `uiManager.js` can use to display formatted error
       messages.
    4. Provide context-specific recovery actions where possible (e.g., "Try another file?").
* **(Optional) Related TODOs:** "Error Handling: More specific error messages + UI display (not just console/alert)."

### 3.2. Add VAD Probability Graph / Enhanced Tuning UI

* **Goal:** Visualize VAD probabilities over time and provide a more intuitive interface for tuning VAD thresholds.
* **Description/Rationale:** Currently, VAD tuning is done with sliders after processing. Seeing the probability curve
  could help users set thresholds more effectively.
* **Affected Components:**
    * `vibe-player/js/uiManager.js`
    * `vibe-player/js/vad/vadAnalyzer.js` (to expose probability data)
    * `vibe-player/js/vad/sileroProcessor.js` (to collect/store detailed probabilities)
    * New visualization component.
* **Proposed Action/Implementation Steps:**
    1. Modify `sileroProcessor.js` to store or stream frame-by-frame VAD probabilities.
    2. Expose this data via `vadAnalyzer.js`.
    3. Create a new canvas-based component in `uiManager.js` to draw the probability curve, aligning it with the
       waveform.
    4. Allow users to drag threshold lines directly on this graph, or link sliders to update lines on the graph.
* **(Optional) Related TODOs:** "VAD UI: Graph of VAD probabilities to help threshold tuning."

### 3.3. Implement "Back to Start" and Control Reset Buttons

* **Goal:** Add UI buttons for quickly jumping to the start of the audio and resetting all playback/VAD controls to
  their default values.
* **Description/Rationale:** Improves usability for common actions.
* **Affected Components:**
    * `vibe-player/js/uiManager.js` (new buttons and event listeners)
    * `vibe-player/js/app.js` (handlers for these actions)
    * `vibe-player/js/player/audioEngine.js` (for seek to 0)
    * `vibe-player/js/vad/vadAnalyzer.js` (for resetting VAD thresholds)
* **Proposed Action/Implementation Steps:**
    1. Add "Back to Start" (seek to 0) and "Reset Controls" buttons to `index.html`.
    2. In `uiManager.js`, add event listeners for these buttons, dispatching appropriate events.
    3. In `app.js`, handle these events:
        * For "Back to Start": Call `audioEngine.seek(0)`.
        * For "Reset Controls": Reset speed, pitch, gain sliders/values to default; reset VAD thresholds in
          `vadAnalyzer` and update UI.
* **(Optional) Related TODOs:** "UI: 'Back to Start' button.", "UI: 'Reset Controls' button (speed, pitch, gain, VAD
  thresholds)."

### 3.4. Implement Windows 98 Style UI Sounds

* **Goal:** Add auditory feedback for UI interactions, mimicking classic Windows 98 UI sounds for a nostalgic feel.
* **Description/Rationale:** Enhances the "98.css" aesthetic and provides user feedback.
* **Affected Components:**
    * `vibe-player/js/uiManager.js`
    * New audio assets for UI sounds.
* **Proposed Action/Implementation Steps:**
    1. Source or create short, appropriate UI sound effects (e.g., click, error, notification).
    2. In `uiManager.js`, preload these sounds.
    3. Attach `play()` calls for these sounds to relevant UI event handlers (button clicks, slider changes, errors).
    4. Ensure sounds are subtle and can be optionally disabled if a settings panel is implemented later.
* **(Optional) Related TODOs:** "UI Sounds: Add Win98 style UI sounds for interactions."

### 3.5. Advanced Player Controls & Keybinds (Further Investigation)

* **Goal:** Implement more granular controls (e.g., frame-by-frame stepping) and customizable keybinds.
* **Description/Rationale:** Offers more power to users for detailed audio analysis.
* **Affected Components:**
    * `vibe-player/js/uiManager.js`
    * `vibe-player/js/app.js`
    * `vibe-player/js/player/audioEngine.js`
* **Proposed Action/Implementation Steps:**
    1. Investigate feasibility of precise frame-stepping with current `AudioEngine` and Rubberband.
    2. Design UI for new controls if feasible.
    3. Implement logic for new playback actions.
    4. Design a system for managing and customizing keyboard shortcuts (potentially stored in `localStorage`).
* **(Optional) Related TODOs:** "Advanced Controls: Frame-by-frame step (investigate feasibility).", "Keybinds:
  Customizable keyboard shortcuts."

### 3.6. Implement Preset Management

* **Goal:** Allow users to save and load sets of playback and VAD parameters as named presets.
* **Description/Rationale:** Useful for users who frequently switch between different analysis settings.
* **Affected Components:**
    * `vibe-player/js/uiManager.js` (UI for preset management)
    * `vibe-player/js/app.js` (logic for saving/loading presets)
    * Potentially `localStorage` for storing presets.
* **Proposed Action/Implementation Steps:**
    1. Design UI for saving current settings (speed, pitch, gain, VAD thresholds) as a named preset, and for
       listing/loading saved presets.
    2. Implement functions in `app.js` to get current parameters, store them (e.g., as JSON in `localStorage`), and
       apply stored parameters.
    3. Update `uiManager.js` to reflect loaded preset values.
* **(Optional) Related TODOs:** "Presets: Save/Load settings (speed, pitch, gain, VAD thresholds)."

## Theme 4: Audio Processing Enhancements & Fixes

### 4.1. Investigate/Address Formant Shift Non-Functionality

* **Goal:** Determine why formant shifting has no audible effect and either fix it or remove the UI element.
* **Description/Rationale:** The formant shift control is currently implemented but does not appear to change the audio
  output. This needs investigation.
* **Affected Components:**
    * `vibe-player/js/player/rubberbandProcessor.js`
    * `vibe-player/js/player/audioEngine.js`
    * `vibe-player/js/uiManager.js` (if UI needs to be removed/changed)
* **Proposed Action/Implementation Steps:**
    1. Deep-dive into Rubberband WASM documentation and examples regarding formant shifting.
    2. Verify the `_rubberband_set_formant_scale` call and its parameters are correctly used.
    3. Test with various audio files and formant scale values.
    4. If a fix is found, ensure it integrates correctly.
    5. If it's confirmed non-functional with the current WASM build or too complex to fix, remove the formant slider
       from the UI.
* **(Optional) Related TODOs:** Referenced in `architecture.md` known issues.

### 4.2. Investigate Parameter Smoothing for Speed/Pitch

* **Goal:** Explore options for smoother transitions when changing playback speed and pitch, reducing abrupt audio
  changes.
* **Description/Rationale:** Rapid changes to speed/pitch sliders can cause somewhat jarring audio output. Rubberband
  might have internal smoothing options, or this could be implemented in `audioEngine.js` by ramping parameter values
  sent to the worklet.
* **Affected Components:**
    * `vibe-player/js/player/audioEngine.js`
    * `vibe-player/js/player/rubberbandProcessor.js`
* **Proposed Action/Implementation Steps:**
    1. Review Rubberband library options for parameter change smoothing.
    2. If not available externally, implement ramping logic in `audioEngine.js` to gradually change speed/pitch values
       over a short duration (e.g., 50-100ms) when slider values are adjusted.
    3. Test for perceived smoothness.

## Theme 5: Code Quality & Testability

### 5.1. Plan for Automated Testing

* **Goal:** Improve code robustness and reduce regression risk by introducing an automated testing strategy.
* **Description/Rationale:** Currently, testing is manual. Automated tests (unit, integration) would provide a safety
  net for refactoring and new feature development.
* **Affected Components:** Entire codebase.
* **Proposed Action/Implementation Steps:**
    1. Choose a testing framework (e.g., Jest, Mocha).
    2. Start by writing unit tests for utility functions (`utils.js`, `goertzel.js`) and core logic in modules like
       `vadAnalyzer.js`, `audioEngine.js` (mocking Web Audio API where necessary).
    3. Investigate options for integration testing of UI interactions and audio processing pipeline (might require tools
       like Puppeteer or Playwright for browser environment).
    4. Set up CI (e.g., GitHub Actions) to run tests automatically.
* **(Optional) Related TODOs:** "Testing: Implement unit/integration tests."

### 5.2. General Code Cleanup During Refactoring

* **Goal:** Improve overall code clarity, consistency, and maintainability as other refactoring tasks are undertaken.
* **Description/Rationale:** Address any minor code smells, inconsistencies, or areas lacking clarity that are
  encountered during the implementation of the above themes.
* **Affected Components:** Entire codebase.
* **Proposed Action/Implementation Steps:**
    1. While working on specific refactoring tasks, also address:
        * Inconsistent naming conventions.
        * Lack of comments for complex logic.
        * Opportunities to simplify functions or reduce redundancy.
        * Ensuring JSDoc annotations are accurate and complete.
    2. This is an ongoing activity integrated with all other refactoring work.
* **(Optional) Related TODOs:** "Code Quality: General cleanup during other refactors."

### 5.3. Review and Update JSDoc Documentation

* **Goal:** Ensure all JSDoc comments are accurate, complete, and reflect the current state of the code, especially
  after refactoring.
* **Description/Rationale:** Good documentation is crucial for maintainability and for other developers (or AI
  assistants) to understand the codebase.
* **Affected Components:** Entire codebase, focusing on `*.js` files.
* **Proposed Action/Implementation Steps:**
    1. Systematically review JSDoc blocks for all functions, classes, and significant variables.
    2. Verify parameter types, return types, and descriptions.
    3. Add missing JSDoc where necessary.
    4. Ensure consistency in style and level of detail.
    5. Consider using a JSDoc generation tool to produce HTML documentation that can be easily browsed.

### 5.4. Consolidate Constants and Configuration

* **Goal:** Ensure all magic numbers, string literals used in multiple places, and configuration parameters are defined
  in `constants.js` or a dedicated configuration module.
* **Description/Rationale:** Improves maintainability by centralizing configurable values and making the code easier to
  understand.
* **Affected Components:** Entire codebase.
* **Proposed Action/Implementation Steps:**
    1. Scan the codebase for hardcoded values that should be constants (e.g., VAD sample rates, UI string labels,
       default thresholds).
    2. Move these to `constants.js`, organized into logical sections.
    3. Replace hardcoded values with references to the constants.
    4. Review if any constants are specific enough to a module that they should remain local but clearly marked.
