<!-- /vibe-player/architecture.md -->
# Vibe Player Architecture

## 1. Overview

*   **Purpose:** Browser-based audio player focused on playback speed/pitch manipulation, voice activity detection (VAD) visualization, and waveform/spectrogram display. Designed for static file deployment.
*   **Core Philosophy:** Prioritize simplicity and minimal dependencies by using Vanilla JS, HTML, and CSS. Leverage WebAssembly (WASM) via standardized Web APIs (`AudioWorklet`, `ONNX Runtime Web`) for computationally intensive tasks (audio processing, ML inference) that would otherwise be difficult or impossible client-side. The application follows an event-driven interaction flow managed by a central controller (`app.js`).

## 2. Key Technologies

*   **Frontend:** HTML5, CSS3 (98.css for styling + custom `styles.css`), Vanilla JavaScript (ES6 Modules via IIFE pattern on `AudioApp` namespace)
*   **Audio Engine:** Web Audio API (`AudioContext`, `GainNode`, `AudioWorkletNode`, `OfflineAudioContext` for resampling)
*   **Time/Pitch Shifting:** Rubberband WASM library (via `rubberbandProcessor.js` AudioWorklet)
*   **VAD:** Silero VAD model (`.onnx`) executed via ONNX Runtime Web (WASM backend)
*   **Visualizations:** HTML Canvas API (2D Context), FFT.js (for spectrogram calculation)

## 3. Code Structure (`js/` directory)

*   **`app.js` (Controller):**
    *   Initializes all modules (`uiManager`, `audioEngine`, `visualizer`, etc.).
    *   Orchestrates the main application flow: file loading sequence, triggering initial visuals, initiating background VAD, handling playback state.
    *   Listens for and handles events dispatched from `uiManager.js` (user actions) and `audioEngine.js` (audio processing events, worklet status).
    *   Manages core application state (e.g., `currentAudioBuffer`, `currentFile`, `workletPlaybackReady`, `isActuallyPlaying`, `currentVadResults`).
    *   Manages the main-thread playback time tracking using `AudioContext.currentTime` and `requestAnimationFrame` for accurate UI updates (seek bar, time display, visualizer progress).
*   **`uiManager.js` (View/UI Logic):**
    *   Handles all direct DOM manipulation (getting element references, updating text content, styles, input values, enabling/disabling elements).
    *   Attaches event listeners to UI elements (buttons, sliders, file input).
    *   Dispatches `audioapp:` custom events on the `document` based on user interaction (e.g., `audioapp:playPauseClicked`, `audioapp:speedChanged`).
    *   Manages the visual state of the VAD progress bar.
*   **`audioEngine.js` (Audio Backend):**
    *   Manages the Web Audio API `AudioContext` and the main output `GainNode`.
    *   Handles loading and decoding audio files using `AudioContext.decodeAudioData`. Dispatches `audioapp:audioLoaded`.
    *   Manages the lifecycle of the `AudioWorkletNode` (`rubberbandProcessor.js`), including fetching WASM resources and passing initial data.
    *   Handles communication *to* the AudioWorklet Processor via `port.postMessage` (play, pause, seek, set speed/pitch parameters).
    *   Listens for messages *from* the AudioWorklet Processor via `port.onmessage` (status updates like `processor-ready`, `Playback ended`, playback state confirmation, worklet-calculated time updates, errors). Dispatches corresponding `audioapp:` events.
    *   Provides audio buffer resampling capability (`resampleTo16kMono`) using `OfflineAudioContext` for VAD preprocessing. Dispatches `audioapp:resamplingError` on failure.
    *   Provides public methods for controlling playback (`togglePlayPause`, `seek`, etc.) and accessing the `AudioContext`.
*   **`visualizer.js` (Rendering):**
    *   Handles drawing the waveform and spectrogram visuals onto HTML Canvas elements.
    *   Uses FFT.js library to compute spectrogram data from the audio buffer.
    *   Provides `computeAndDrawVisuals` for the initial render (drawing waveform in loading color if VAD not done) and `redrawWaveformHighlight` for updating waveform colors post-VAD.
    *   Manages canvas resizing based on window events and redraws visuals appropriately (using cached spectrogram data if possible).
    *   Updates the red playback position indicator overlays on both canvases.
    *   Handles click events on canvases to dispatch `audioapp:seekRequested` events.
*   **`vadAnalyzer.js` (VAD State Manager):**
    *   Acts as an intermediary between `app.js` and the VAD processing modules.
    *   Holds the latest VAD results (`currentVadResults` object containing regions, probabilities, parameters used).
    *   Manages the *currently active* VAD thresholds (`currentPositiveThreshold`, `currentNegativeThreshold`) which might differ from initial analysis if the user adjusts sliders.
    *   Provides the `analyze` method (called by `app.js` background task) which delegates to `sileroProcessor.analyzeAudio`.
    *   Provides `handleThresholdUpdate` (called by `app.js` on slider input) which updates internal thresholds and delegates to `sileroProcessor.recalculateSpeechRegions`.
    *   Provides `getCurrentRegions` for easy access by other modules (e.g., `visualizer`, `uiManager`).
*   **`sileroProcessor.js` (VAD Frame Logic):**
    *   Consumes a 16kHz mono `Float32Array`.
    *   Iterates through the audio data in frames (e.g., 1536 samples).
    *   Calls `sileroWrapper.process()` for each frame to get the raw speech probability from the ONNX model.
    *   Uses `async/await` and helper `yieldToMainThread` (`setTimeout(0)`) periodically during frame iteration to prevent completely blocking the main thread during long analyses.
    *   Calculates speech start/end time regions based on the sequence of probabilities and the provided thresholds (positive, negative, redemption frames).
    *   Provides progress updates via an `onProgress` callback function passed during analysis.
    *   Provides `recalculateSpeechRegions` function which quickly re-evaluates regions based on stored probabilities and new thresholds (used for slider adjustments).
*   **`sileroWrapper.js` (VAD ONNX Interface):**
    *   Wraps the `ort.InferenceSession` from ONNX Runtime Web.
    *   Handles loading the `silero_vad.onnx` model and configuring the ONNX Runtime WASM execution provider (paths must be correct).
    *   Manages the Silero VAD model's recurrent state tensors (`state_h`, `state_c`), resetting them as needed.
    *   Provides the `process(audioFrame)` method which performs inference on a single frame and returns the VAD probability.
*   **`rubberbandProcessor.js` (AudioWorklet Processor):**
    *   Runs in a separate `AudioWorkletGlobalScope` thread managed by the browser.
    *   Loads and interfaces with the Rubberband WASM module using a custom loader (`rubberband-loader.js`) and `instantiateWasm` hook provided by `audioEngine.js`.
    *   Receives audio channel data (`Float32Array` buffers) and commands (play, pause, seek, speed, pitch, formant) from `audioEngine.js` via `port.postMessage`.
    *   Feeds input audio frames to the Rubberband instance (`_rubberband_process`).
    *   Retrieves processed (time-stretched, pitch-shifted) audio frames (`_rubberband_retrieve`).
    *   Writes the processed audio to the `outputs` array provided by the `process` method's arguments, connecting back to the main Web Audio graph.
    *   Sends messages back to `audioEngine.js` via `port.postMessage` (status updates, errors, worklet-internal time updates, playback state confirmation).
    *   Manages WASM memory allocation (`_malloc`, `_free`) for audio buffers passed to Rubberband functions.

## 4. Interaction Flow & State Management

*   **Loading Sequence:**
    1.  `UI (Choose File)` -> `uiManager` dispatches `audioapp:fileSelected`.
    2.  `app.js (handleFileSelected)`: Resets state/UI, shows spinner, calls `audioEngine.loadAndProcessFile`.
    3.  `audioEngine`: Decodes audio, dispatches `audioapp:audioLoaded`. Sets up worklet asynchronously.
    4.  `app.js (handleAudioLoaded)`: Stores `currentAudioBuffer`, updates time/seek UI, calls `visualizer.computeAndDrawVisuals([])` (triggers gray waveform + spectrogram draw), hides main spinner, calls `runVadInBackground` (async).
    5.  `audioEngine`: When worklet setup is complete, dispatches `audioapp:workletReady`.
    6.  `app.js (handleWorkletReady)`: Sets `workletPlaybackReady=true`, enables playback controls/seek bar. **Playback is now possible.**
    7.  `app.js (runVadInBackground)` (Running concurrently):
        *   Initializes VAD model if needed (`sileroWrapper.create`).
        *   Shows VAD progress bar (`uiManager`).
        *   Calls `audioEngine.resampleTo16kMono`.
        *   Calls `vadAnalyzer.analyze` (which calls `sileroProcessor.analyzeAudio` with progress callback).
        *   `sileroProcessor`: Iterates frames, calls `sileroWrapper.process`, yields, calls progress callback -> `uiManager.updateVadProgress`.
        *   On VAD completion/error: Updates VAD results in `app.js`, updates VAD slider UI (`uiManager`), redraws waveform highlights (`visualizer.redrawWaveformHighlight`), updates progress bar to 100% or 0%.
*   **Playback Control:** `UI (Button Click)` -> `uiManager` dispatches event -> `app.js (handlePlayPause/Jump/Seek)` -> `audioEngine` (sends command message) -> `rubberbandProcessor`. Status feedback: `rubberbandProcessor` (sends state message) -> `audioEngine` (dispatches event) -> `app.js (handlePlaybackStateChange)` -> `uiManager` (updates button).
*   **Parameter Control (Speed/Pitch/Gain):** `UI (Slider Input)` -> `uiManager` dispatches event -> `app.js (handleSpeed/Pitch/GainChange)` -> `audioEngine`. Gain applied directly via `GainNode`. Speed/Pitch command message sent to `rubberbandProcessor`.
*   **VAD Threshold Tuning:** `UI (Slider Input)` -> `uiManager` dispatches `audioapp:thresholdChanged` -> `app.js (handleThresholdChange)` (checks if VAD done) -> `vadAnalyzer.handleThresholdUpdate` -> `sileroProcessor.recalculateSpeechRegions` -> `app.js` receives new regions -> `visualizer.redrawWaveformHighlight` & `uiManager.setSpeechRegionsText`.
*   **State:** Core state (`currentAudioBuffer`, playback flags, `currentVadResults`) managed centrally in `app.js`. `audioEngine` manages worklet communication state. `vadAnalyzer` manages VAD results/thresholds. `uiManager` reflects state in the DOM. `sileroWrapper` and `rubberbandProcessor` manage internal WASM state.

## 5. Design Decisions, Constraints & Tradeoffs

*   **Static Hosting:** Simplifies deployment, no backend required. Limits features requiring server interaction. (Constraint C1)
*   **Vanilla JS:** Reduces dependency footprint, avoids framework overhead/learning curve. Requires manual implementation of patterns (modules, state management). (Constraint C2)
*   **IIFE Module Pattern:** Provides simple namespacing (`AudioApp`) without requiring a build step. Relies on careful script loading order.
*   **Custom Events (`audioapp:*`):** Decouples UI Manager and Audio Engine from the main App controller, allowing modules to signal state changes or requests without direct dependencies on `app.js`'s internal methods. (Constraint C3)
*   **AudioWorklet for Rubberband:** Essential for performing complex audio processing (time-stretching) off the main thread without blocking UI or audio playback. Adds architectural complexity for message passing and state synchronization between main thread (`audioEngine`) and worklet thread (`rubberbandProcessor`).
    *   **Alternative Considered (SoundTouchJS):** SoundTouchJS was evaluated, but the audio quality, especially at slower speeds, was significantly worse than Rubberband. Rubberband's computational cost was deemed acceptable for the quality improvement. Native Web Audio playback rate changes were also too choppy at low speeds.
    *   **Rubberband Flags:** The primary goal for flag tuning was improving voice quality. The current flag set (`ProcessRealTime`, `PitchHighQuality`, `PhaseIndependent`, `TransientsCrisp`) represents a balance. `EngineFiner` was tested but resulted in stuttering playback, likely due to exceeding CPU limits on the test machine; the default (faster) engine is currently used.
*   **ONNX Runtime Web for VAD:** Enables use of standard ML models (like Silero VAD) directly in the browser via WASM. Avoids needing a dedicated VAD implementation.
*   **Main-Thread VAD (Async):** VAD processing (`sileroProcessor`) runs on the main thread but uses `async/await` and `setTimeout(0)` to yield periodically.
    *   **Tradeoff:** Simpler implementation for MVP compared to setting up a dedicated Web Worker for VAD. Avoids additional complexity of worker communication and state transfer.
    *   **Downside:** Can still cause minor UI sluggishness during intense computation phases within `sileroWrapper.process`. Susceptible to browser throttling in background tabs (prevents VAD completion if tab is unfocused for a long time).
    *   **(Clarification):** VAD processing currently does *not* run in a Web Worker. The idea was considered to allow completion even when the tab is backgrounded, but not implemented yet.
*   **VAD Progress Updates:** Initial attempts at direct UI updates or simple `setTimeout(0)` from the VAD loop were unreliable for progress bar updates. The current solution uses a callback function passed down to `sileroProcessor` which calls `uiManager.updateVadProgress`.
*   **JSDoc:** Chosen standard for JavaScript documentation in this project. (Constraint C7)
*   **Manual Testing:** Adopted for rapid iteration during MVP phase. Lacks automated checks for regressions. (Constraint C5)
*   **Visualizer Computation:** Waveform data calculated per-pixel. Spectrogram data computed entirely upfront (using FFT.js) before being drawn asynchronously chunk-by-chunk.
    *   **Tradeoff:** Faster waveform display. Spectrogram has an initial computation delay before drawing starts, but avoids the complexity of streaming FFT computation. Async drawing prevents blocking during render.
*   **File Structure:** Modular approach with separate files for distinct responsibilities (UI, Engine, VAD components, Visualizer, Controller). Asset types (CSS, Fonts) organized into folders. (Constraint C6, Asset Reorg)

## 6. Known Issues & Development Log

*   **Formant Shifting (Non-Functional):** Currently disabled/commented out.
    *   **Details:** Attempts were made to enable formant scaling using `_rubberband_set_formant_scale`. Rubberband flags tested included permutations of `EngineFiner`, `PhaseIndependent`, `FormantPreserved`, and the current default flag set. Formant scaling was tested alone and in combination with phase/speed shifting (0.25x to 2.0x). Debugging confirmed the target scale value was successfully passed to the WASM function via the correct API call.
    *   **Result:** No errors were thrown, but **no audible effect** from formant shifting was ever observed. The feature was abandoned as non-functional in the current Rubberband WASM build/configuration. It's uncertain if the issue is in the WASM compilation, the underlying library's formant preservation interaction with other flags, or a misunderstanding of the scale parameter (though multiplier is standard).
*   **VAD Performance & Backgrounding:** Runs on the main thread (see Tradeoffs in Section 5). May cause minor UI jank on slower devices or very long files. Processing **pauses** when the tab is not focused due to browser throttling of `setTimeout`.
*   **Spectrogram Latency:** Spectrogram display starts only after the full spectrogram data is computed, leading to an initial delay.
*   **Rubberband Engine Choice:** `EngineFiner` caused stuttering during tests; using the default (faster) engine. Voice quality might be further tunable with different flag combinations, but `EngineFiner` seems too computationally expensive currently.

<!-- /vibe-player/architecture.md -->
