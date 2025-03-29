<!-- /vibe-player/architecture.md -->
# Vibe Player - Architecture Design (Rubberband Real-time Engine)

## 1. Introduction

This document outlines the technical architecture of the Vibe Player application, focusing on its modular design, communication patterns, and the integration of real-time audio processing using Rubberband WASM within an AudioWorklet, alongside VAD analysis using ONNX Runtime.

The primary goal of this architecture is to enable high-quality variable-speed playback and audio analysis features within a browser environment using only static files, adhering to the constraints of no build tools or server-side logic. Modularity and clear separation of concerns are prioritized to facilitate maintenance and potential future development, particularly involving LLM assistants. This version uses a real-time Rubberband engine, replacing the standard HTML audio element and previous hybrid attempts.

## 2. Core Components & Responsibilities (Refactored Structure)

The application is structured into distinct modules, initialized and coordinated at the top level by `main.js`. A global `AudioApp` namespace is used to hold shared instances and facilitate interaction.

*   **`main.js` (Top-Level Initializer):**
    *   **Role:** Initializes the application, creates the master `AudioContext`, and sets up the `AudioApp` namespace.
    *   **Responsibilities:**
        *   Creates the main `AudioContext`.
        *   Initializes all other primary modules (`config`, `uiManager`, `audioLoader`, `workletManager`, `playbackController`, `visualizer`, `vadAnalyzer`, `sileroWrapper`, `sileroProcessor`).
        *   Attaches necessary module instances/interfaces to the global `AudioApp` object (e.g., `AudioApp.uiManager`, `AudioApp.workletManager`).
        *   Orchestrates the very basic startup sequence (primarily ensuring all modules are loaded and initialized).

*   **`js/config.js` (Configuration):**
    *   **Role:** Centralized location for constants and default values.
    *   **Responsibilities:** Defines file paths (WASM, models, loader script), default parameters (speed, gain, VAD thresholds), constants. Exports an immutable configuration object.

*   **`js/uiManager.js` (UI Layer):**
    *   **Role:** Interface between the user and the application logic.
    *   **Responsibilities:**
        *   Caches DOM element references.
        *   Attaches UI event listeners (buttons, sliders, file input, keyboard).
        *   Dispatches `CustomEvent` on `document` for user actions (e.g., `audioapp:fileSelected`, `audioapp:playPauseClicked`, `audioapp:speedChanged`, `audioapp:gainChanged`, `audioapp:jumpClicked`, `audioapp:vadThresholdChanged`).
        *   Provides public methods for other modules (mainly `playbackController`) to update UI state (e.g., `setFileInfo`, `setPlayButtonState`, `updateTimeDisplay`, `updateVadDisplay`, `enableControls`).

*   **`js/audioLoader.js` (Audio Loading & VAD):**
    *   **Role:** Handles loading, decoding, and initiating analysis of audio files.
    *   **Responsibilities:**
        *   Listens for `audioapp:fileSelected` event.
        *   Uses `FileReader` to read the file `ArrayBuffer`.
        *   Uses `AudioContext.decodeAudioData` to get the `originalAudioBuffer`.
        *   Stores the `originalAudioBuffer`.
        *   **Triggers Offline VAD:** Resamples audio for VAD, calls `AudioApp.vadAnalyzer.analyze()`. Stores `vadResults`.
        *   Dispatches `audioapp:audioReady` event with `{ buffer: originalAudioBuffer, vad: vadResults }` when decoding and VAD are complete.

*   **`js/workletManager.js` (Worklet Interface):**
    *   **Role:** Manages the entire lifecycle and communication for the `AudioWorkletNode`.
    *   **Responsibilities:**
        *   Pre-fetches `rubberband.wasm` and `audio/rubberband-loader.js` script text.
        *   Listens for `audioapp:audioReady` event.
        *   Creates and manages the `AudioWorkletNode` instance (`hybrid-processor.js`).
        *   Handles *all* `postMessage` sending to the worklet (commands: `load-audio`, `play`, `pause`, `seek`, `set-speed`, `jump`, `set-gain`, `cleanup`).
        *   Handles *all* incoming messages (`onmessage`) from the worklet (status, time updates, errors).
        *   Dispatches internal `CustomEvent`s based on worklet messages (`audioapp:workletReady`, `audioapp:workletTimeUpdate`, `audioapp:workletPlaybackEnded`, `audioapp:workletError`, `audioapp:workletPlaybackState`).
        *   Provides public methods for `playbackController` to interact with the worklet (`play()`, `pause()`, `seek()`, `setSpeed()`, `jump()`, `setGain()`, `cleanup()`).

*   **`js/playbackController.js` (Playback Logic):**
    *   **Role:** Connects UI actions to audio engine commands and manages playback state.
    *   **Responsibilities:**
        *   Listens for user action events from `uiManager` (`audioapp:playPauseClicked`, `audioapp:speedChanged`, etc.) and seek events from `visualizer` (`audioapp:seekRequested`).
        *   Calls the corresponding methods on `AudioApp.workletManager` (e.g., `AudioApp.workletManager.play()`).
        *   Listens for events dispatched by `workletManager` (`audioapp:workletTimeUpdate`, `audioapp:workletPlaybackEnded`, `audioapp:workletPlaybackState`).
        *   Maintains the primary playback state (`isPlaying`, `currentTime`, `duration`).
        *   Calls methods on `AudioApp.uiManager` to update the UI based on state changes (e.g., `AudioApp.uiManager.updateTimeDisplay()`, `AudioApp.uiManager.setPlayButtonState()`).
        *   Manages the `GainNode` for volume control (creates it, connects worklet -> gain -> destination, updates `gain.value`).

*   **`js/visualizer.js` (Visualization Layer):**
    *   **Role:** Renders audio data graphically.
    *   **Responsibilities:**
        *   Manages Waveform and Spectrogram canvases.
        *   Listens for `audioapp:audioReady`. Computes and draws initial waveform (with VAD) and spectrogram.
        *   Listens for `audioapp:workletTimeUpdate`. Updates playback progress indicators on canvases.
        *   Handles canvas clicks and dispatches `audioapp:seekRequested` event.
        *   Handles VAD threshold changes (via event) by redrawing waveform highlights (`AudioApp.vadAnalyzer.getRegions()`).

*   **`vad/*` Modules (VAD Pipeline):**
    *   **`sileroWrapper.js`:** Manages ONNX Runtime session.
    *   **`sileroProcessor.js`:** Performs frame-by-frame VAD analysis.
    *   **`vadAnalyzer.js`:** Manages VAD results state, handles threshold updates (`audioapp:vadThresholdChanged` listener), provides regions (`getRegions`). Triggered by `audioLoader`.

*   **`audio/hybrid-processor.js` (AudioWorkletProcessor):**
    *   **Role:** Real-time audio processing via Rubberband. Runs on the audio thread.
    *   **Responsibilities:**
        *   Initializes its own Rubberband WASM instance using provided binary and loader script.
        *   Receives audio data (`originalChannels`).
        *   Handles commands (`play`, `pause`, `seek`, `set-speed`, `jump`, `cleanup`).
        *   Maintains internal playback state (`isPlaying`, `playbackPositionInSeconds`).
        *   In `process()`: calculates Rubberband ratio, reads from source buffer, calls `_rubberband_process`, retrieves output, copies to worklet output buffers.
        *   Sends status (`processor-ready`, `Playback ended`), errors, playback state confirmation, and regular time updates (`time-update`) back via `this.port.postMessage()`.

*   **`audio/rubberband-loader.js` (WASM Loader):**
    *   **Role:** Custom script to load Rubberband WASM inside the worklet.
    *   **Responsibilities:** Uses `eval`/`new Function` and `instantiateWasm` hook pattern.

## 3. Data Flow & Event Sequence Example (Play)

1.  **File Load:** `uiManager` (File Input Change) -> `audioapp:fileSelected` event -> `audioLoader` listens.
2.  **Decoding & VAD:** `audioLoader` reads file -> `decodeAudioData` -> `originalBuffer`. Triggers VAD analysis -> `vadResults`.
3.  **Audio Ready:** `audioLoader` dispatches `audioapp:audioReady` event `{ buffer, vad }`.
4.  **Worklet Setup:** `workletManager` listens for `audioapp:audioReady`, creates `AudioWorkletNode`, sends `load-audio` message with channel data.
5.  **Visualization:** `visualizer` listens for `audioapp:audioReady`, draws waveform/spectrogram.
6.  **Worklet Ready:** `hybrid-processor` initializes WASM -> `postMessage('status', 'processor-ready')` -> `workletManager` receives -> dispatches `audioapp:workletReady` event.
7.  **UI Ready:** `playbackController` listens for `audioapp:workletReady`. Calls `uiManager.enableControls()`.
8.  **User Play:** `uiManager` (Play Button Click) -> `audioapp:playPauseClicked` event -> `playbackController` listens.
9.  **Command Worklet:** `playbackController` calls `AudioApp.workletManager.play()`.
10. **Worklet Action:** `workletManager` -> `postMessage({type: 'play'})` -> `hybrid-processor` receives, sets `isPlaying=true`, confirms state via `postMessage({type: 'playback-state', isPlaying: true})`.
11. **State Sync & UI Update:** `workletManager` receives state -> dispatches `audioapp:workletPlaybackState` -> `playbackController` listens, updates internal state, calls `AudioApp.uiManager.setPlayButtonState('Pause')`.
12. **Real-time Audio:** `hybrid-processor::process()` -> Reads source -> Calls Rubberband -> Copies to Output Buffer -> Web Audio API -> `GainNode` -> Speakers.
13. **Time Update:** `hybrid-processor` (periodically) -> `postMessage('time-update', {currentTime})` -> `workletManager` receives -> dispatches `audioapp:workletTimeUpdate` event.
14. **UI/Visual Update:** `playbackController` listens for `audioapp:workletTimeUpdate` -> calls `AudioApp.uiManager.updateTimeDisplay()`. `visualizer` listens -> calls `updateProgressIndicator()`.

## 4. Communication Patterns

*   **UI -> App Logic:** `CustomEvent` (`audioapp:*`) dispatched by `uiManager` on `document`. Listened to by `playbackController`, `audioLoader`, `vadAnalyzer`.
*   **App Logic <-> Worklet:** Strictly via `workletManager`. It uses `postMessage` to send commands/data and `onmessage` to receive status/time/errors.
*   **Worklet -> App Logic:** `workletManager` receives messages from worklet and dispatches specific `CustomEvent`s (`audioapp:worklet*`) on `document` for other modules (`playbackController`, `visualizer`) to consume.
*   **Internal App Communication:** Primarily direct method calls via the `AudioApp` namespace (e.g., `AudioApp.workletManager.play()`, `AudioApp.uiManager.updateTimeDisplay()`, `AudioApp.vadAnalyzer.analyze()`). Events (`audioapp:audioReady`, `audioapp:worklet*`) are used for broader state change notifications.

## 5. Key Algorithms & Challenges

*   **WASM Loading in Worklet (`workletManager`, `rubberband-loader`, `hybrid-processor`):** Main thread fetches assets, worklet uses custom loader script via `eval`/`new Function` and `instantiateWasm` hook. Requires careful coordination and a correctly modified loader script.
*   **Time Synchronization (`hybrid-processor`, `workletManager`, `playbackController`, `visualizer`):** Worklet calculates `playbackPositionInSeconds`, sends via `time-update` message, `workletManager` dispatches event, `playbackController` updates state/UI time display, `visualizer` updates progress indicator. Frequency of updates needs balancing for performance.
*   **Real-time Performance (`hybrid-processor`):** Rubberband processing (`_rubberband_process`) loop must complete within the audio buffer timeslice (~2.6ms @ 48kHz/128 frames) to avoid glitches.
*   **VAD Integration (`audioLoader`, `vad/*`, `visualizer`):** VAD analysis is performed offline by `audioLoader` after decoding. Threshold changes update `vadAnalyzer` state and trigger `visualizer` redraws, independent of audio playback.
*   **State Management (`playbackController`, `workletManager`):** Ensuring consistent state (`isPlaying`, `currentTime`) between the main thread logic, the UI, and the worklet's internal state requires careful handling of messages and events.

## 6. Error Handling

*   `audioLoader` catches decoding errors.
*   `workletManager` catches WASM fetch/load errors and worklet creation errors. It also listens for errors sent from the worklet (`error` message type) and the `onprocessorerror` event. Errors are propagated via `audioapp:workletError` events or UI updates.
*   `hybrid-processor` uses `try...catch` in `process()` and message handling, sending errors back via `postMessage`.
*   VAD module errors are handled within their scope, potentially propagating back to `audioLoader`.
*   UI updates via `uiManager` reflect error states.

## 7. Future Considerations

*   Move VAD analysis to a `Worker` thread if it blocks the UI during the `audioLoader` phase for very long files.
*   Explore `SharedArrayBuffer` for worklet communication (requires COOP/COEP headers).
*   Add more Rubberband options configurable via UI.
*   Optimize visualizations (WebGL).
<!-- /vibe-player/architecture.md -->
