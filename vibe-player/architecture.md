<!-- /vibe-player/architecture.md -->
# Vibe Player - Architecture Design

## 1. Introduction

This document outlines the technical architecture of the Vibe Player application, focusing on its modular design, communication patterns, and the integration of real-time audio processing using Rubberband WASM within an AudioWorklet, alongside VAD analysis using ONNX Runtime.

The primary goal of this architecture is to enable complex audio analysis and manipulation features within a browser environment using only static files, adhering to the constraints of no build tools or server-side logic. Modularity and clear separation of concerns are prioritized to facilitate maintenance and potential future development, particularly involving LLM assistants.

## 2. Core Components & Responsibilities

The application is structured into several distinct modules, primarily coordinated by `main.js`.

*   **`main.js` (Main Thread Orchestrator):**
    *   **Role:** Central coordinator of the application lifecycle and data flow.
    *   **Responsibilities:**
        *   Initializes all other modules (`uiManager`, `visualizer`, VAD modules indirectly, AudioWorklet).
        *   Manages the main `AudioContext`.
        *   Handles user interactions relayed via events from `uiManager`.
        *   Loads external assets (fetches Rubberband WASM/loader for the worklet).
        *   Orchestrates the **offline processing pipeline**:
            1.  File Loading & Decoding (`decodeAudioFile`) -> `originalBuffer`.
            2.  Resampling to 16kHz mono (`resampleForVAD`) -> `pcm16k`.
            3.  VAD Model Loading (via `AudioApp.sileroWrapper.create`).
            4.  VAD Analysis (via `AudioApp.vadAnalyzer.analyze`) -> `vadResults`.
            5.  Rubberband Slow Version Preprocessing (`preprocessSlowVersion`) -> `slowBuffer`.
        *   Manages the `AudioWorkletNode` (`hybrid-processor`) lifecycle (creation, termination).
        *   Handles communication with the AudioWorklet (`postMessage` for commands/data, `onmessage` for status/time).
        *   Relays worklet time updates to `uiManager` and `visualizer`.
        *   Manages global application state relevant to orchestration (e.g., `audioReady`, `workletReady`).

*   **`js/uiManager.js` (UI Layer):**
    *   **Role:** Interface between the user and the application logic.
    *   **Responsibilities:**
        *   Caches references to all relevant DOM elements.
        *   Attaches event listeners to UI controls (buttons, sliders, inputs, selectors).
        *   Dispatches `CustomEvent` (e.g., `audioapp:fileSelected`, `audioapp:paramChanged`) to `document` when user interacts.
        *   Provides public methods for `main.js` to update the UI state (e.g., `setFileInfo`, `setPlayButtonState`, `updateTimeDisplay`, `updateVadDisplay`, `enableControls`).
        *   Retrieves current parameter/configuration values from UI elements when requested (`getCurrentParams`, `getCurrentConfig`).
        *   Handles keyboard shortcut detection and dispatches events.

*   **`js/visualizer.js` (Visualization Layer):**
    *   **Role:** Renders audio data graphically onto canvas elements.
    *   **Responsibilities:**
        *   Manages Waveform and Spectrogram canvases and their 2D contexts.
        *   Computes waveform data (`computeWaveformData`) from `AudioBuffer`.
        *   Computes spectrogram data (`computeSpectrogram`) using `fft.js`.
        *   Draws waveform, highlighting VAD regions (`drawWaveform`).
        *   Draws spectrogram asynchronously (`drawSpectrogramAsync`), caching results in an offscreen canvas for efficient resizing.
        *   Handles canvas resizing (`resizeAndRedraw`).
        *   Updates playback progress indicators (`updateProgressIndicator`) based on time updates from `main.js`.
        *   Handles canvas clicks and dispatches `audioapp:seekRequested` event.

*   **`js/config.js` (Configuration):**
    *   **Role:** Centralized location for constants and default values.
    *   **Responsibilities:**
        *   Defines file paths (WASM, models, scripts), default parameters (speed, pitch, thresholds), VAD settings, visualizer settings, enums (`SWITCH_BEHAVIOR`).
        *   Exports an immutable configuration object `AudioApp.config`.

*   **`vad/` Modules (VAD Pipeline):**
    *   **`sileroWrapper.js`:** Manages ONNX Runtime session for the VAD model, including WASM loading and state tensor handling (`create`, `process`, `reset_state`). Depends on global `ort`.
    *   **`sileroProcessor.js`:** Performs frame-by-frame VAD analysis using the `sileroWrapper`, calculates speech regions based on thresholds (`analyzeAudio`, `recalculateSpeechRegions`). Depends on `sileroWrapper`.
    *   **`vadAnalyzer.js`:** Manages VAD results state, handles threshold updates from the UI, and triggers recalculations using the `sileroProcessor`. Depends on `sileroProcessor`.

*   **`audio/` Modules (Playback Engine):**
    *   **`rubberband-loader.js`:** **Custom** Emscripten loader script specifically modified for loading `rubberband.wasm` within the AudioWorklet environment via `eval`/`new Function` and an `instantiateWasm` hook. Included via `<script>` tag, potentially defining a global `Rubberband` async function factory.
    *   **`hybrid-processor.js` (AudioWorkletProcessor):**
        *   **Role:** Real-time audio processing and output. Runs on the dedicated audio thread.
        *   **Responsibilities:**
            *   Receives WASM binary and loader script text via `processorOptions`.
            *   Loads and initializes its own Rubberband WASM instance using the custom loader.
            *   Receives `originalChannels` and `slowChannels` data via `postMessage`.
            *   Handles commands from `main.js` (`play`, `pause`, `seek`, `jump`, `set-params`, `cleanup`).
            *   Maintains internal playback state (`isPlaying`, `conceptualPlaybackTime`).
            *   Implements the core `process()` loop:
                *   Selects source buffer (original vs. slow) based on current speed, threshold, and override settings.
                *   Manages source switching transitions (Abrupt, Mute, MicroFade).
                *   Calculates real-time stretch/pitch/formant parameters for Rubberband based on target values and selected source.
                *   Calls Rubberband WASM functions (`_reset`, `_set_*`, `_process`, `_available`, `_retrieve`).
                *   Copies processed audio to the worklet's output buffers.
            *   Sends status (`processor-ready`, `Playback ended`), errors, and time updates (`time-update`) back to `main.js` via `this.port.postMessage()`.

## 3. Data Flow

1.  **File Load:** `uiManager` -> `audioapp:fileSelected` -> `main.js`.
2.  **Offline Processing Pipeline (in `main.js`):**
    *   `File` -> `ArrayBuffer` -> `decodeAudioData` -> `originalBuffer` (AudioBuffer).
    *   `originalBuffer` -> `resampleForVAD` -> `pcm16k` (Float32Array @ 16kHz).
    *   `pcm16k` -> `sileroWrapper.create` (loads ORT) -> `vadAnalyzer.analyze` (uses `sileroProcessor` which uses `sileroWrapper.process`) -> `vadResults` (object).
    *   `originalBuffer` -> `preprocessSlowVersion` (uses temporary Rubberband instance) -> `slowBuffer` (AudioBuffer).
3.  **Worklet Setup & Data Transfer:**
    *   `main.js` -> Creates `AudioWorkletNode`, passing WASM assets in `processorOptions`.
    *   `main.js` -> `postMessage('load-audio', {originalChannels, slowChannels}, [transferList])` -> `hybrid-processor.js`.
    *   `hybrid-processor.js` -> Receives data, initializes WASM -> `postMessage('status', {message: 'processor-ready'})` -> `main.js`.
4.  **Visualization:** `main.js` -> `visualizer.computeAndDrawVisuals(originalBuffer, vadResults.regions)`.
5.  **Playback Start:** `uiManager` -> `audioapp:playPauseClicked` -> `main.js` -> `postMessage('play')` -> `hybrid-processor.js`.
6.  **Real-time Audio:** `hybrid-processor.js::process()` -> Selects Source Buffer -> Calculates Read Pos/Params -> Calls Rubberband -> Copies to Output Buffer -> Web Audio API -> Speakers.
7.  **Time Update:** `hybrid-processor.js` -> `postMessage('time-update', {currentTime})` -> `main.js` -> `uiManager.updateTimeDisplay`, `visualizer.updateProgressIndicator`.
8.  **Parameter Change:** `uiManager` -> `audioapp:paramChanged` -> `main.js` -> `postMessage('set-params', {params})` -> `hybrid-processor.js`.
9.  **VAD Threshold Change:** `uiManager` -> `audioapp:vadThresholdChanged` -> `main.js` -> `vadAnalyzer.handleThresholdUpdate` -> `visualizer.redrawWaveformHighlight`. (Does *not* affect audio playback directly).
10. **Seek:** `visualizer` -> `audioapp:seekRequested` -> `main.js` -> `postMessage('seek', {positionSeconds})` -> `hybrid-processor.js`.

## 4. Communication Patterns

*   **UI -> App (`main.js`):** Custom DOM Events (`audioapp:*`) dispatched by `uiManager` on `document`. `main.js` listens.
*   **App (`main.js`) -> Worklet (`hybrid-processor.js`):** `workletNode.port.postMessage(message, [transferList])`. Used for commands (`play`, `pause`, `seek`, `jump`, `set-params`, `cleanup`) and initial data transfer (`load-audio`).
*   **Worklet (`hybrid-processor.js`) -> App (`main.js`):** `this.port.postMessage(message)`. Used for status reports (`processor-ready`, `Playback ended`), errors, and regular time updates (`time-update`).
*   **App (`main.js`) -> Other Modules:** Direct method calls (e.g., `AudioApp.uiManager.setFileInfo()`, `AudioApp.visualizer.computeAndDrawVisuals()`, `AudioApp.vadAnalyzer.analyze()`).

## 5. Key Algorithms & Challenges

*   **Hybrid Switching Logic (`hybrid-processor.js`):**
    *   Determining the target source (`original` vs. `slow`) based on `targetSpeed` and `hybridThreshold`.
    *   Implementing state machines for `switchBehavior` (Abrupt, Mute, MicroFade) involving gain changes and `_rubberband_reset`.
    *   Ensuring smooth transitions (difficult, especially without crossfading).
*   **Time Synchronization (`hybrid-processor.js`):**
    *   Maintaining a `conceptualPlaybackTime` relative to the *original* audio duration.
    *   Accurately calculating the read index within the *currently selected* source buffer (`originalChannels` or `slowChannels`), considering the source's inherent speed (1.0x or `initialSlowSpeed`). This requires careful mapping:
        *   If reading `originalBuffer`: `readIndex = conceptualPlaybackTime * originalSampleRate`.
        *   If reading `slowBuffer`: `readIndex = (conceptualPlaybackTime / initialSlowSpeed) * originalSampleRate`. (Conceptual time progresses slower relative to the slow buffer's timeline).
    *   Updating `conceptualPlaybackTime` based on the amount of *original source time consumed* by Rubberband in each `process` block. This depends on the input frames provided and the *current stretch ratio being applied relative to the source being read*.
*   **WASM Loading in Worklet (`hybrid-processor.js`, `rubberband-loader.js`):**
    *   Requires the main thread to pre-fetch the WASM binary (`ArrayBuffer`) and the custom loader script (`string`).
    *   Requires the worklet to use `eval` or `new Function` on the loader text.
    *   Relies on the loader script correctly implementing the `instantiateWasm` hook pattern provided by the worklet.
    *   **Brittleness:** The loader script is tightly coupled to the specific export/import names of the `rubberband.wasm` binary. Recompiling the WASM likely requires updating the loader.
*   **Offline Preprocessing (`main.js`):**
    *   Requires instantiating and running VAD analysis (including ORT loading) and a separate, offline Rubberband process on the main thread.
    *   Can block the UI for significant durations, especially the Rubberband step for long files. (Potential future optimization: Move to separate Worker thread).
    *   Requires careful memory management for the temporary Rubberband instance.
*   **Real-time Performance (`hybrid-processor.js`):**
    *   The entire `process()` loop, including state checks, calculations, Rubberband calls, and data copying, must complete within the audio buffer time slice (~2.6ms for 128 frames @ 48kHz).
    *   Complex switching logic or high processing demands can cause glitches or dropouts.

## 6. Error Handling

*   `main.js` catches errors during the processing pipeline and displays messages via `uiManager.showError`.
*   `AudioContext` creation failures are handled in `main.js`.
*   Worklet errors (initialization or processing) are sent back via `postMessage` to `main.js`, which updates the UI and attempts cleanup.
*   Unrecoverable worklet errors trigger `onprocessorerror` in `main.js`.
*   VAD model loading/inference errors are handled within the VAD pipeline, propagating back to `main.js`.

## 7. Future Considerations

*   Move offline preprocessing (VAD, Rubberband slow version) to a `Worker` thread to prevent UI blocking.
*   Implement more sophisticated source switching (e.g., crossfading) for smoother transitions, potentially requiring running two Rubberband instances briefly in the worklet.
*   Explore `SharedArrayBuffer` for parameter updates and potentially audio data transfer to reduce latency and main thread load (requires specific server headers: COOP/COEP).
*   Add user configuration for more Rubberband quality options (transients, phase, etc.).
*   Optimize visualization performance (e.g., WebGL for spectrogram).

<!-- /vibe-player/architecture.md -->
