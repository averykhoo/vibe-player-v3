<!-- /vibe-player/README.md -->
# Vibe Player (Rubberband Real-time Engine)

## Overview

This project is a web-based audio player and analysis tool, **Vibe Player**.

This version features a **Real-time Audio Playback Engine** using the **Rubberband** library (compiled to WebAssembly) for high-quality, real-time time stretching (speed control). Playback is handled via the Web Audio API's `AudioWorklet` standard, allowing for smooth speed adjustments without the quality degradation often seen with the standard HTML `<audio>` element at slower speeds.

Vibe Player analyzes audio files for Voice Activity Detection (VAD) using the Silero VAD model via ONNX Runtime Web. It displays the audio waveform with detected speech regions highlighted, a spectrogram visualization, and provides flexible playback controls.

The application uses **vanilla HTML, CSS, and JavaScript**, structured into distinct modules for better maintainability. It is designed explicitly for **static file hosting** without requiring build tools, frameworks, or package managers. The structure prioritizes clarity for potential maintenance by LLM assistants.

## Features

*   Load local audio files (various formats supported by browser `decodeAudioData`).
*   **Real-time Playback Engine (Rubberband WASM via AudioWorklet):**
    *   High-quality real-time time stretching (Speed control: 0.25x - 2.0x) using Rubberband library.
    *   Playback managed via `AudioContext` and `AudioWorkletNode`.
*   Standard playback controls: Play/Pause, Seek (via click on visuals), Jump Back/Forward.
*   Adjustable main volume (gain).
*   **Voice Activity Detection (VAD):**
    *   Uses the pre-trained Silero VAD model via ONNX Runtime Web.
    *   Highlights detected speech regions on the waveform in orange.
    *   Adjustable VAD thresholds (Positive/Negative) for real-time sensitivity tuning (redraws waveform highlighting).
    *   Displays start/end times of detected speech segments.
*   **Visualizations:**
    *   Real-time waveform display.
    *   Spectrogram display (computed using FFT).
    *   Playback progress indicator overlaid on visualizations, synchronized with the audio worklet.
*   Keyboard shortcuts for playback.
*   Responsive canvas visualizations.
*   Pure static deployment - works via simple file serving.
*   Modular code structure for improved maintainability.

## Technology Stack

*   **HTML5:** Structure and content.
*   **CSS3:** Styling and layout.
*   **JavaScript (ES6 Modules):** Application logic, DOM manipulation, modular structure.
*   **Web Audio API:** `AudioContext`, `AudioWorklet` for real-time processing, `GainNode`.
*   **Rubberband WASM:** Core library for time stretching.
*   **ONNX Runtime Web:** Runs the Silero VAD ONNX model directly in the browser (via WASM).
*   **fft.js:** Simple Fast Fourier Transform library for spectrogram calculation.

## Setup & Running (For Users)

1.  **Get the Files:** Ensure you have the complete project folder, including `js/`, `audio/`, `vad/`, `lib/`, `model/`, and `wasm/` subdirectories with their contents.
2.  **Download ONNX Runtime Web (One-time setup):**
    *   Go to the [ONNX Runtime GitHub Releases](https://github.com/microsoft/onnxruntime/releases).
    *   Find a recent release (e.g., v1.17.0 or later).
    *   Download the **web** package zip file (e.g., `onnxruntime-web-*.zip`).
    *   Extract the archive. From the `dist/` directory inside, copy the following files into this project's `lib/` folder:
        *   `ort.min.js`
        *   `ort-wasm.wasm`
        *   `ort-wasm-simd.wasm` (Recommended)
        *   *(Optional: `ort-wasm-threaded.wasm`)*
3.  **Get Rubberband WASM & Loader (One-time setup):**
    *   You need the `rubberband.wasm` file compiled from the Rubberband library. Place it into the project's `wasm/` folder.
    *   You need the **custom modified** `rubberband-loader.js` file (provided with this project source). Place it into the project's `audio/` folder. **Do not use a standard Emscripten-generated loader.**
4.  **Serve Statically:** You need a simple local HTTP server due to `AudioWorklet` and potential future `SharedArrayBuffer` usage.
    *   **Option A: Using Python:**
        *   Open your terminal.
        *   Navigate (`cd`) into the main project directory (`vibe-player/`).
        *   Run: `python -m http.server 8000` (or `python3 -m http.server 8000`).
    *   **Option B: Other static servers (Node `http-server`, VS Code Live Server, etc.).**
5.  **Access:** Open your web browser (Chrome, Firefox, Edge recommended) and go to `http://localhost:8000`.
6.  **Use:** Load an audio file. Wait for processing (VAD). Use controls to play, adjust speed/volume, seek, and tune VAD.

## Project Structure (Refactored)

```
./ (e.g., vibe-player/)
├── index.html # Main HTML file.
├── styles.css # All CSS styling.
│
├── js/ # Core Main Thread Application Modules
│ ├── main.js # NEW: Top-level init, AudioContext, coordination.
│ ├── config.js # Constants, paths, default values.
│ ├── uiManager.js # Handles DOM interactions & UI events.
│ ├── audioLoader.js # NEW: File reading, decoding, VAD triggering.
│ ├── workletManager.js # NEW: Manages AudioWorklet lifecycle & communication.
│ ├── playbackController.js # NEW: Translates UI events to playback actions, manages playback state.
│ └── visualizer.js # Handles canvas drawing (Waveform, Spectrogram).
│
├── audio/ # Audio Playback Engine Modules
│ ├── hybrid-processor.js # AudioWorkletProcessor (Real-time Rubberband)
│ └── rubberband-loader.js# Custom WASM loader for Rubberband (for Worklet).
│
├── vad/ # Voice Activity Detection Modules
│ ├── sileroWrapper.js # Wraps ONNX Runtime session for Silero VAD.
│ ├── sileroProcessor.js # Core VAD processing logic using the wrapper.
│ └── vadAnalyzer.js # Manages VAD results, thresholds, and recalculations.
│
├── lib/ # External, third-party libraries (ort.min.js, fft.js, ort-*.wasm).
├── model/ # Machine Learning Models (silero_vad.onnx).
├── wasm/ # Non-library WASM Binaries (rubberband.wasm).
│
├── README.md # This file.
└── architecture.md # Updated Architecture Document.
```


---
---

## Developer Notes (For LLM Assistants)

**(LLM Assistant: Adhere to these patterns based on the refactoring for maintainability under static-hosting constraints.)**

**Core Constraints & Design Philosophy:**

1.  **Static Files Only:** No server-side logic.
2.  **No Build Tools:** Vanilla JS (using ES6 Modules), runs directly in modern browsers.
3.  **No Frameworks:** Vanilla JavaScript, HTML, CSS.
4.  **LLM Maintenance:** Structure prioritizes clarity, modularity (smaller files), and adherence to established patterns for future LLM interaction.

**Architectural Pattern: ES6 Modules + Global Namespace (`AudioApp`)**

*   Single global `AudioApp` created by `main.js`.
*   Modules (`js/`, `audio/`, `vad/`) define functions/classes and `main.js` attaches necessary instances/interfaces to `AudioApp` during initialization (e.g., `AudioApp.uiManager = uiManagerInstance;`).
*   Use `import`/`export` (though might be simplified via script loading order and direct attachment in `main.js` for static hosting compatibility without build tools - TBD during implementation). *Initial approach assumes IIFE-like pattern where modules return objects/functions attached in `main.js`.*
*   **LLM Task:** Place new logic in appropriate modules, respect the modular structure, and ensure interfaces are correctly exposed/accessed via the `AudioApp` namespace established in `main.js`.

**Communication Pattern:**

*   **UI -> App:** `uiManager.js` dispatches `CustomEvent` (e.g., `audioapp:playPauseClicked`) on `document`. `playbackController.js` listens.
*   **App <-> Worklet:** `workletManager.js` uses `workletNode.port.postMessage()` to send commands/data. It receives messages via `workletNode.port.onmessage` and dispatches internal `CustomEvent`s (e.g., `audioapp:workletTimeUpdate`) for other modules (`playbackController`, `visualizer`) to listen to.
*   **Internal App Calls:** Modules primarily interact via methods exposed on the `AudioApp` namespace (e.g., `AudioApp.workletManager.play()`, `AudioApp.uiManager.updateTimeDisplay()`). Events are used for broader notifications (audio ready, time updates).
*   **LLM Task:** Use `CustomEvent` for UI->App and for broadcasting Worklet updates. Use direct method calls via `AudioApp.moduleName.method()` for commands between modules. Use `postMessage` *only* within `workletManager.js` for App<->Worklet comms.

**Module Responsibilities (Summary):**

*   `main.js`: **Top-Level Initializer.** Creates `AudioContext`. Initializes all other modules and attaches them to `AudioApp`. Starts the process.
*   `js/config.js`: Static configuration values, paths, defaults.
*   `js/uiManager.js`: DOM elements, UI event listeners -> dispatches events, UI update methods.
*   `js/audioLoader.js`: Handles file selection event, reads file, decodes audio, triggers VAD (`AudioApp.vadAnalyzer.analyze`), dispatches `audioapp:audioReady`.
*   `js/workletManager.js`: Fetches WASM/Loader. Listens for `audioapp:audioReady`. Creates `AudioWorkletNode`. Manages *all* communication with the worklet processor. Exposes control methods (`play`, `pause`, `seek`, etc.). Dispatches worklet status/time events (`audioapp:worklet*`).
*   `js/playbackController.js`: Listens for UI action events. Calls methods on `AudioApp.workletManager`. Listens for worklet status/time events. Updates `AudioApp.uiManager`. Holds primary playback state (`isPlaying`, `currentTime`).
*   `js/visualizer.js`: Canvas drawing, FFT usage, spectrogram caching, progress bars, resize handling. Listens for `audioapp:audioReady` and `audioapp:workletTimeUpdate`. Dispatches `audioapp:seekRequested`.
*   `vad/*`: VAD analysis pipeline. Triggered offline by `audioLoader.js`. Threshold updates flow UI -> Controller? -> `vadAnalyzer` -> `visualizer`.
*   `audio/rubberband-loader.js`: **Custom** WASM loader script.
*   `audio/hybrid-processor.js`: **AudioWorkletProcessor.** Real-time audio output via Rubberband. Receives commands/buffers, sends time/status/errors.

**Key Integration Points:**

*   Playback is now entirely managed by `AudioContext` -> `workletManager` -> `hybrid-processor.js`. The `<audio>` element is gone.
*   `audioLoader.js` orchestrates the loading, decoding, and VAD analysis sequence.
*   `workletManager.js` isolates the complexities of worklet interaction.
*   `playbackController.js` acts as the intermediary between UI actions and the audio engine backend (`workletManager`).
*   Time updates originate from the worklet -> `workletManager` -> dispatched event -> listened to by `playbackController` (for UI) and `visualizer`.

**Critical Dependencies & Configuration:**

*   **`lib/` Folder:** `ort.min.js`, `ort-*.wasm`, `fft.js`. **Must be present.**
*   **`model/` Folder:** `silero_vad.onnx`. **Must be present.**
*   **`wasm/` Folder:** `rubberband.wasm`. **Must be present.**
*   **`audio/` Folder:** `rubberband-loader.js` (custom). **Must be present.**
*   **`index.html` Script Load Order:** CRITICAL. Libraries -> Config -> Modules (`uiManager`, `audioLoader`, `workletManager`, `playbackController`, `visualizer`, VAD) -> `main.js` -> Init call.
*   **Paths in `js/config.js`:** Must correctly point to WASM, model, loader script relative to `index.html`.
*   **`sileroWrapper.js` (`wasmPaths`):** Must point to `lib/` correctly.
*   **`audio/rubberband-loader.js`:** Must be the *custom* loader compatible with the worklet `instantiateWasm` hook.

**(LLM Assistant: Focus on implementing the logic within the designated modules, using the specified communication patterns. Ensure `main.js` correctly initializes and connects the modules via the `AudioApp` namespace.)**
<!-- /vibe-player/README.md -->
