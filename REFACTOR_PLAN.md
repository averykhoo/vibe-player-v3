[//]: # ( REFACTOR_PLAN.md )
# **Vibe Player V3: The Hexagonal Refactoring Plan**

## 1. Vision & Executive Summary

This document outlines the complete architectural blueprint for Vibe Player V3. It is not an incremental fix, but a
ground-up redesign based on the principles of **Hexagonal (Ports and Adapters) Architecture**.

The primary impetus for this refactor stems from the architectural weaknesses discovered in the V2.3 implementation.
Despite using modern tools like Svelte and TypeScript, the V2.3 system suffered from subtle but critical flaws in its
handling of asynchronous operations, leading to race conditions, deadlocks, and fragile inter-service communication.
These issues proved difficult to debug and indicated that the architecture, while more modern than V1, had not fully
escaped V1's monolithic design thinking.

The vision for V3 is to create a system that is:

* **Fundamentally Testable:** Every piece of core application logic must be testable in complete isolation, without
  depending on a UI framework, browser APIs, or live Web Workers. This will be achieved by treating every major domain
  of functionality as its own independent, self-contained hexagon.
* **Decoupled and Maintainable:** The application's core business logic will be completely separated from the external "
  technologies" that drive it (the UI) and that it drives (Web Workers, state stores). This allows any piece of
  technology to be swapped out without affecting the core application.
* **Framework Agnostic:** The core application will be written in pure, platform-agnostic TypeScript. The UI will be
  treated as just one of many possible "adapters," allowing for a future migration to React, Vanilla JS, or any other
  view layer with minimal effort.
* **Robust and Predictable:** By enforcing strict boundaries and unidirectional data flow between highly specialized
  modules, we will eliminate the entire class of race conditions and state management bugs that plagued previous
  versions.

## 2. Critique of Previous Architectures (V1 & V2)

To justify this comprehensive redesign, we must first perform a critical analysis of the previous versions,
acknowledging what worked and identifying the root causes of what failed.

### 2.1. Analysis of V1 (The Working-but-Brittle Monolith)

The original `vibe-player` in Vanilla JS was functionally complete and, importantly, **it worked**.

* **What Worked:** It successfully integrated complex technologies like the Web Audio API, ONNX Runtime, and Rubberband
  WASM. Its "analyze once, tune in real-time" model for VAD was highly effective.
* **Tradeoffs & Flaws:**
    * **Tight Coupling:** Its success was dependent on a fragile, manually-enforced script loading order in
      `index.html`. A change in this order would break the entire application.
    * **Monolithic Controller:** `app.js` was a "God Object" that knew about and controlled every other module, from UI
      management to audio processing to VAD analysis. This made it extremely difficult to test or modify any single
      piece of functionality in isolation.
    * **Global State:** State was managed via properties on the global `AudioApp` namespace, making it difficult to
      track when and where state was being changed.
    * **Main-Thread Blocking:** Intensive tasks like VAD and Spectrogram analysis were performed on the main thread with
      `async/await` and `setTimeout` hacks to yield control. While this worked for moderately sized files, it was not a
      truly non-blocking solution and could lead to UI stuttering.

### 2.2. Analysis of V2.3 (The Flawed Refactor)

The V2.3 SvelteKit refactor was a positive step towards modernization, but it failed to address the core architectural
problems, instead "porting the monolith" into a new framework.

* **What Improved:** It introduced a proper build system, TypeScript for type safety, and a reactive UI layer with
  Svelte. It correctly moved intensive tasks into dedicated Web Workers.
* **The Architectural Failure:** The core flaw was the **decentralized and fragile worker communication contract**. Each
  service (`audioEngine.service`, `analysis.service`, etc.) independently implemented its own manual, error-prone system
  for managing asynchronous communication with its worker. This involved:
    1. Manually creating and storing promise `resolve`/`reject` callbacks.
    2. Manually generating unique message IDs.
    3. Manually managing a `Map` of pending requests.
    4. Requiring the worker to perfectly echo back the message ID.
* **The Consequence:** This fragile, duplicated boilerplate was the direct cause of the bugs we chased. A missing
  `messageId` in `sileroVad.worker.ts` caused its `initialize()` promise to hang forever. When we fixed that, we
  immediately discovered the *exact same bug* in `rubberband.worker.ts`. This pattern of repeated, identical bugs is a
  clear sign that the architecture itself, not the implementation, is the problem.

## 3. The V3 Architectural Model: A Federation of Hexagons

V3 will be built as a **federation of collaborating, self-contained hexagons**. This is an advanced application of the
Ports and Adapters pattern where each domain of functionality is its own "micro-application."

* **The Hexagon (Application Core):** A module containing pure, isolated business logic with no dependencies on external
  technologies.
* **Ports:** The formal interfaces (e.g., TypeScript `interface` or public class methods) that define how data and
  commands flow into or out of the hexagon.
* **Adapters:** The "pluggable" pieces of technology that connect to the ports.
    * **Driving Adapters:** Initiate action *on* the hexagon (e.g., the UI, a test suite).
    * **Driven Adapters:** Are driven *by* the hexagon to perform a task (e.g., a Web Worker, a state store, the
      browser's URL bar).

## 4. The V3 System Components (The Hexagons)

### 4.1. The `AppHexagon` (The Orchestrator)

* **Core Responsibility:** Manages the application's top-level state machine (`Initializing`, `Idle`, `Loading`,
  `Ready`, `Error`) and defines the high-level user stories. It is the primary client of all other domain hexagons.
* **Inside (`AppService`):** Contains the logic for coordinating services to fulfill use cases like `initializeApp()`
  and `loadAudio(source)`.
* **Ports:**
    * **Driving (`IAppDriver`):** The public methods of the `AppService`.
    * **Driven (`ILoaderPort`, `IPlaybackPort`, `IAnalysisPort`):** Interfaces used to command the other hexagons.
* **Adapters:**
    * **Driving:** The UI Framework Adapter, Keyboard Input Adapter.
    * **Driven:** The other Hexagons (`PlaybackHexagon`, `VADHexagon`, etc.) are the adapters that plug into this
      hexagon's driven ports.

### 4.2. The `UIHexagon`

* **Core Responsibility:** To translate the application's central state into a pure, framework-agnostic view model, and
  to map raw user inputs into formal application commands.
* **Inside (`UIViewLogic`):** Contains pure presentation logic (e.g., "if status is 'loading', the play button view
  model should have an `isDisabled` property set to `true`"). It produces a virtual representation of the UI.
* **Ports:**
    * **Driving (`IStateProvider`):** A port that receives state updates from the outside world.
    * **Driven (`ICommandPort`, `IRenderPort`):** Ports used to send application commands out and to send rendering
      instructions to the DOM.
* **Adapters:**
    * **Driving:** The `StateStoreAdapter` pushes state changes *into* the UIHexagon.
    * **Driven:**
        * The `AppHexagon` implements the `ICommandPort`.
        * The **`DOMAdapter` (Svelte/React/VanillaJS)** implements the `IRenderPort`, translating the view model into
          actual HTML/CSS.

### 4.3. The `PlaybackHexagon`

* **Core Responsibility:** The pure state machine for a time-stretchable audio player. It knows nothing of the Web Audio
  API.
* **Inside (`PlaybackService`):** Manages properties like `duration`, `currentTime`, `speed`, and states like `playing`
  or `paused`.
* **Ports:**
    * **Driving (`IPlaybackDriver`):** Public methods like `play()`, `pause()`, `seek()`.
    * **Driven (`IAudioOutput`, `IPlayerStatePublisher`):** Interfaces to command an audio backend and to publish state
      updates.
* **Adapters:**
    * **Driven:**
        * **`WebAudioAdapter`**: The implementation of `IAudioOutput` that manages the `AudioContext` and the
          `rubberband.worker` via a `WorkerManager`. This is the *only* place with Web Audio API code.
        * **`StateStoreAdapter`**: The implementation of `IPlayerStatePublisher`.

### 4.4. The Visualization Hexagons (`WaveformHexagon`, `SpectrogramHexagon`)

* **Core Responsibility:** Pure data transformation.
* **Inside (`WaveformService`, `SpectrogramService`):** Contain the algorithms to convert an `AudioBuffer` into visual
  data (peak arrays or frequency-magnitude arrays).
* **Ports:**
    * **Driven (`IFFTEngine`):** The `SpectrogramService` depends on a port to perform FFT calculations.
* **Adapters:**
    * **Driven:**
        * **`FFTJsWorkerAdapter`**: An adapter for the `IFFTEngine` port that uses a `WorkerManager` to run `fft.js` in
          a background thread.
        * **Canvas Adapters (`Waveform.svelte`, `Spectrogram.svelte`):** These are now "dumb" driven adapters that only
          know how to render the data they receive.

### 4.5. The Analysis Hexagons (`VADHexagon`, `DTMFHexagon`)

* **Core Responsibility:** Pure signal processing and analysis logic.
* **Inside (`VADService`, `DTMFService`):** Contain the algorithms for VAD region merging and Goertzel-based tone
  detection.
* **Ports:**
    * **Driven (`IInferenceEngine`):** The `VADService` depends on a port to get raw speech probabilities.
* **Adapters:**
    * **Driven:**
        * **`SileroVadWorkerAdapter`**: Implements `IInferenceEngine`, managing the `sileroVad.worker`.
        * **`DTMFWorkerAdapter`**: Manages the `dtmf.worker`.

### 4.6. The Infrastructure Hexagon (`WorkerManagerHexagon`)

* **Core Responsibility:** To provide a robust, promise-based request/response communication channel.
* **Inside (`WorkerManagerService`):** The logic for managing pending promises, IDs, and timeouts.
* **Ports & Adapters:** It is driven by the application services and drives the browser's `Worker` API. This isolates
  all other services from the mechanics of `postMessage`.

---

## 5. Detailed State Sequences & Event Flows

### Flow 1: Application Initialization

1. **UI Adapter** (`main.ts` or equivalent) -> calls `AppHexagon.initializeApp()`.
2. **AppHexagon** -> updates `StateStore` to `Status: Initializing`.
3. **AppHexagon** -> calls `initialize()` on all domain hexagons (`Playback`, `VAD`, `DTMF`, etc.) in parallel.
4. Each **Domain Hexagon** -> creates its required **Driven Adapters** (e.g., `WebAudioAdapter`,
   `SileroVadWorkerAdapter`).
5. Each **Adapter** -> creates its `WorkerManager` and sends an `INIT` message to its respective **Worker**.
6. Each **Worker** -> performs its setup (loading WASM/models).
7. Each **Worker** -> posts `INIT_SUCCESS` back to its `WorkerManager`.
8. Each **WorkerManager** -> resolves the promise its service is awaiting.
9. **AppHexagon** -> The `Promise.all` resolves.
10. **AppHexagon** -> checks the **URL Adapter**. If a source URL exists, it proceeds to Flow 2. Otherwise, it updates
    `StateStore` to `Status: Idle`.

### Flow 2: Successful File Load

1. **UI Adapter** (e.g., File input) -> calls `AppHexagon.loadAudio(source)`.
2. **AppHexagon** -> updates `StateStore` to `Status: Loading`.
3. **AppHexagon** -> `await`s **AudioLoaderService** `decode(source)`.
4. **AudioLoaderService** -> returns the `AudioBuffer`.
5. **AppHexagon** -> `await`s **PlaybackHexagon** `prepare(audioBuffer)`.
6. **AppHexagon** -> `await`s **WaveformHexagon** `generatePeaks(audioBuffer)`. The result is published to the
   `StateStore`.
7. **AppHexagon** -> **IMMEDIATELY** updates `StateStore` to `Status: Ready` and `isPlayable: true`.
8. **UI** -> Controls become enabled. The waveform appears instantly.
9. **AppHexagon** -> In the background (not awaited), calls `process()` on the `VADHexagon`, `DTMFHexagon`, and
   `SpectrogramHexagon`.
10. As each of these hexagons completes, they update their respective parts of the `StateStore`.
11. **UI** -> VAD highlights, DTMF results, and the spectrogram "pop in" as their data becomes available.

### Flow 3: Seeking

1. **UI Adapter** `mousedown` on seek bar -> calls `AppHexagon.beginSeek()`.
2. **AppHexagon** -> checks `StateStore`. If `Player.isPlaying` is true, it saves this fact (`wasPlaying = true`).
3. **AppHexagon** -> calls `PlaybackHexagon.pause()`.
4. **AppHexagon** -> updates `StateStore` to `Status: Seeking`.
5. **UI Adapter** `input` on seek bar -> updates `StateStore` with new `Player.currentTime`.
6. **UI Adapter** `mouseup` on seek bar -> calls `AppHexagon.endSeek(finalTime)`.
7. **AppHexagon** -> calls `PlaybackHexagon.seek(finalTime)`.
8. **AppHexagon** -> if `wasPlaying` was true, calls `PlaybackHexagon.play()`.
9. **AppHexagon** -> updates `StateStore` to `Status: Playing` or `Status: Paused`.

---

## 6. Other Key Architectural Decisions & V1 Tradeoff Analysis

* **Waveform Rendering Fix:** The `WaveformHexagon`'s `generatePeaks` method will explicitly implement the V1 `min/max`
  peak detection algorithm. V1's tradeoff was doing this calculation on the main thread, which was acceptable because
  it's a very fast, single-pass operation. V3 will keep this synchronous logic, as moving it to a worker would add
  unnecessary complexity for little performance gain. This is a pragmatic choice inspired by V1's success.
* **URL State Management:** The `URLAdapter` (on init) and `URLWriterAdapter` (on state change) formalize this process.
  The `URLWriterAdapter` will subscribe to the `StateStore` and, using a `debounce` function, will update the browser's
  URL bar. This decouples the application core from the browser's History API.
* **Unified Status:** The single `Status` object in the `StateStore` provides a single source of truth for the UI's
  state, preventing conflicts between different "isLoading" or "error" flags.
* **Error Handling:** Errors will propagate up through the promise chain. An error in a worker will reject the
  `WorkerManager`'s promise. This rejection will be caught by the service that called it. If the error is unrecoverable,
  the service will reject its own promise, which will be caught by the `AppHexagon`, which will then update the
  `StateStore` to the `Error` status. This provides a clear and traceable path for all errors.

---

### **Appendix A: V3 State Management & Data Flow**

This appendix provides a concrete and detailed implementation guide for the state management and data flow principles of the V3 Hexagonal Architecture. It specifies where each piece of state is owned, the strict communication pathways between components, and the step-by-step flow for every user interaction.

#### **1. The State Store: A Driven Adapter, Not a Hexagon**

A foundational principle of this architecture is the clear separation of business logic (Hexagons) from technology (Adapters). The "State Store" (e.g., a collection of Svelte stores) is a technology choice for enabling reactive UI updates. It is not a hexagon itself.

*   **Role**: The State Store acts as a centralized, write-only message bus for the application's core logic.
*   **Management**: No single hexagon "manages" the store. Instead, multiple hexagons **drive** it through a `StateStoreAdapter`.
*   **Data Flow**: A hexagon calculates a new state, calls its driven port (e.g., `IPlayerStatePublisher`), and the `StateStoreAdapter`'s implementation of that port is what actually writes to the Svelte store. The hexagon remains pure, with no knowledge of Svelte.

#### **2. Communication Hierarchy: Who Can Talk to Whom**

To prevent the tight coupling of previous versions, communication follows these strict rules:

| From | Can Call / Drive | CANNOT Call / Drive | Example |
| :--- | :--- | :--- | :--- |
| **Driving Adapter** (e.g., UI Component) | A **Hexagon's** driving port. | Another adapter, the State Store, or a worker directly. | The "Play" button component calls `AppHexagon.play()`. |
| **Hexagon** (e.g., `PlaybackHexagon`) | A **Driven Adapter's** port (e.g., `StateStoreAdapter`, `WebAudioAdapter`). | Another Hexagon directly. | `PlaybackHexagon` calls `this.statePublisher.publish(...)` which the `StateStoreAdapter` implements. |
| **Technology Adapter** (e.g., `WebAudioAdapter`) | A **Worker** (via the `WorkerManager`) or Browser APIs (`AudioContext`). | A Hexagon. | `WebAudioAdapter` calls `this.workerManager.postRequest(...)` to communicate with the `rubberband.worker`. |

The **`AppHexagon`** is the only exception: it is the orchestrator and is allowed to call the driving ports of other domain hexagons (e.g., `PlaybackHexagon`, `VADHexagon`) to coordinate complex use cases.

#### **3. State Ownership and Pathways**

The following table details every piece of application state, its official "owner," and its location in the central state store.

| State Item | Owning Hexagon | Location in Store | Description |
| :--- | :--- | :--- | :--- |
| `status` (`loading`, `ready`, etc.) | `AppHexagon` | `statusStore` | The single source of truth for the application's overall state. |
| `error` | `AppHexagon` | `statusStore` | The global error message, if any. |
| `fileName`, `duration`, `isPlayable` | `AppHexagon` | `playerStore` | High-level metadata about the loaded audio, managed by the orchestrator. |
| `isPlaying`, `isLooping` | `PlaybackHexagon` | `playerStore` | The canonical boolean playback state. |
| `currentTime` | `PlaybackHexagon` | `timeStore` (Hot), `playerStore` (Cold) | The canonical playback time. Updated on the "hot path" by the `WebAudioAdapter` for UI, and synced on the "cold path" by the `PlaybackHexagon` on pause/seek. |
| `speed`, `pitchShift`, `gain` | `PlaybackHexagon` | `playerStore` | Playback manipulation parameters. |
| `isSeeking`, `wasPlayingBeforeSeek` | `AppHexagon` | *Internal to `AppHexagon`* | Ephemeral UI state for managing the seek interaction. Not needed by the rest of the app, so it is not published to the store. |
| `vadProbabilities` | `VADHexagon` | `analysisStore` | The raw frame-by-frame speech probabilities from the ML model. |
| `vadRegions` | `VADHexagon` | `analysisStore` | The calculated speech time segments, derived from `vadProbabilities` and the current thresholds. |
| `vadPositiveThreshold`, etc. | `VADHexagon` | `analysisStore` | The tuning parameters for VAD region calculation. |
| `dtmfResults` | `DTMFHexagon` | `dtmfStore` | The list of detected DTMF tones. |
| `spectrogramData` | `SpectrogramHexagon` | `analysisStore` | The calculated spectrogram data (frequency-magnitude arrays). |
| `waveformData` | `WaveformHexagon` | `playerStore` | The calculated peak data for waveform visualization. |

---
#### **4. Detailed Interaction Flows**

The following sections detail the end-to-end data flow for every user interaction.

##### **4.1 Application Initialization & URL Loading**

This flow describes what happens when a user first loads the page with URL parameters.

1.  **Driving Adapter (`+page.ts`)**: The SvelteKit `load` function reads parameters (`url`, `time`, `speed`, etc.) from the page's URL search params. It bundles these into an `initialState` object.
2.  **Driving Adapter (UI - `+page.svelte`)**: The `initialState` is passed as a prop. In `onMount`, it checks if `initialState.url` exists.
3.  **Port Call**: If a URL exists, it calls `AppHexagon.loadAudio(initialState.url, initialState)`.
4.  **`AppHexagon` (Orchestrator)**: It sets `statusStore` to `loading`. It then drives the `AudioLoaderService` to fetch the URL content.
5.  **`AudioLoaderService`**: Returns a decoded `AudioBuffer`.
6.  **`AppHexagon`**: It receives the `AudioBuffer` and begins driving all other hexagons in parallel:
    *   `PlaybackHexagon.prepare(audioBuffer, initialState)`: Sets the duration, initial seek time, speed, etc.
    *   `WaveformHexagon.generatePeaks(audioBuffer)`: Generates the waveform visualization data.
    *   *Fire-and-forget calls:* `VADHexagon.analyze()`, `DTMFHexagon.analyze()`, `SpectrogramHexagon.generate()`.
7.  **Hexagons Publish State**: As each hexagon completes its task, it publishes its data (`waveformData`, `duration`, `isPlayable=true`, etc.) to the `StateStoreAdapter`.
8.  **`AppHexagon`**: Once the *critical path* (playback prep and waveform) is complete, it sets `statusStore` to `ready`.
9.  **UI Reaction**: All components subscribed to the stores (`playerStore`, `statusStore`) update to show the waveform and enable the playback controls. The background analysis results (`vadRegions`, `spectrogramData`) pop in later as they become available.

##### **4.2 Loading Audio (User Interaction)**

This flow is nearly identical to URL loading, but is initiated by a user click.

*   **Load from File**: `FileLoader.svelte` -> `on:change` -> `AppHexagon.loadAudio(file)`. The flow proceeds as in 4.1.
*   **Load from URL Input**: `FileLoader.svelte` -> `on:click` on "Load" button -> `AppHexagon.loadAudio(url)`. The flow proceeds as in 4.1.

##### **4.3 Playback Control (Cold Path)**

*   **Play/Pause (Button or Keyboard)**
    1.  **Driving Adapter (UI)**: `Controls.svelte` button click or global keybind fires.
    2.  **Port Call**: Calls `AppHexagon.togglePlayPause()`.
    3.  **`AppHexagon`**: Delegates by calling `PlaybackHexagon.togglePlayPause()`.
    4.  **`PlaybackHexagon`**: Flips its internal `isPlaying` boolean. It then publishes the new state (`isPlaying: true`) via its driven port. It also calls `this.audioOutput.play()`, which is implemented by the `WebAudioAdapter`.
    5.  **`WebAudioAdapter`**: Starts the `rAF` loop for the "Hot Path" time updates.
    6.  **`StateStoreAdapter`**: Updates `playerStore`. The UI's play button icon changes.

*   **Stop Button**
    1.  **Driving Adapter (UI)**: `Controls.svelte` "Stop" button click.
    2.  **Port Call**: Calls `AppHexagon.stop()`.
    3.  **`AppHexagon`**: Orchestrates the stop sequence. It calls `PlaybackHexagon.stop()` and `PlaybackHexagon.seek(0)`.
    4.  **`PlaybackHexagon`**: Pauses playback, sets its internal `currentTime` to 0, and publishes both `isPlaying: false` and `currentTime: 0` to the store.
    5.  **`WebAudioAdapter`**: The `rAF` loop stops. The `URLWriterAdapter` sees the time is 0 and removes the `t=` parameter from the URL.

*   **Jump Forward/Backward**
    1.  **Driving Adapter (UI)**: `Controls.svelte` jump button click or keybind fires.
    2.  **Port Call**: Calls `AppHexagon.jump(direction)`.
    3.  **`AppHexagon`**: Reads the `jumpSeconds` and `currentTime` from the `playerStore`. It calculates the `newTime` and calls `PlaybackHexagon.seek(newTime)`.
    4.  **`PlaybackHexagon`**: Updates its internal time and publishes the change. The UI updates.

##### **4.4 Parameter Sliders (Cold Path)**

*   **Speed, Pitch, Gain, VAD Thresholds**
    1.  **Driving Adapter (UI)**: A slider in `Controls.svelte` is moved.
    2.  **Port Call**: The `on:input` event triggers a debounced call to `AppHexagon.setSpeed(value)` (or `setPitch`, `setVadThreshold`, etc.).
    3.  **`AppHexagon`**: Delegates the call to the appropriate domain hexagon (e.g., `PlaybackHexagon.setSpeed(value)`).
    4.  **`PlaybackHexagon`/`VADHexagon`**: The hexagon updates its internal parameter. It then publishes the new value to the `StateStoreAdapter`. For VAD, it also re-runs its internal region calculation and publishes the new `vadRegions`.
    5.  **UI/Adapter Reaction**:
        *   The slider's label, subscribed to the store, updates its text.
        *   The `WebAudioAdapter`, subscribed to the `playerStore`, sees the new speed and sends a command to the `rubberband.worker`.
        *   The `Waveform.svelte` component, subscribed to the `analysisStore`, sees the new `vadRegions` and redraws the highlights.

##### **4.5 The Seek Interaction (Special Case)**

The seek bar is unique because it involves a continuous user drag action that must temporarily override the real-time playback updates.

*   **State Owner**: The temporary `isSeeking` and `wasPlayingBeforeSeek` flags are owned internally by the **`AppHexagon`**. They are ephemeral UI orchestration state and do not belong in the `PlaybackHexagon` or the global state store.

*   **Flow**:
    1.  **`mousedown` / `touchstart`**: The user presses the seek bar.
        *   **Driving Adapter (UI - `+page.svelte`)**: Calls `AppHexagon.beginSeek()`.
        *   **`AppHexagon`**: Sets its internal `this.isSeeking = true`. It checks the `playerStore` for the current `isPlaying` status and saves it: `this.wasPlayingBeforeSeek = isPlaying`. If it was playing, it immediately calls `PlaybackHexagon.pause()`.
    2.  **`input` / `touchmove`**: The user drags the seek bar.
        *   **Driving Adapter (UI)**: The slider's value changes. It directly updates the "hot" `timeStore` with the new value. The `TimeDisplay` and the slider's thumb update instantly, providing responsive feedback *without* repeatedly commanding the audio engine.
    3.  **`mouseup` / `touchend`**: The user releases the seek bar.
        *   **Driving Adapter (UI)**: Calls `AppHexagon.endSeek(finalTime)`.
        *   **`AppHexagon`**: It calls `PlaybackHexagon.seek(finalTime)`. Then, it checks its internal flag: if `this.wasPlayingBeforeSeek` was true, it calls `PlaybackHexagon.play()`. Finally, it resets its internal flags: `this.isSeeking = false`, `this.wasPlayingBeforeSeek = false`.

*   **Why This Separation?**
    *   **Decoupling**: The `PlaybackHexagon`'s job is simple: play, pause, seek. It doesn't need to know *why* it's being paused or sought. The complex UI logic of "pause-for-seek-then-resume" is an application-level concern, perfectly suited for the `AppHexagon` orchestrator.
    *   **Performance**: The `input` events update the UI directly via the `timeStore`, providing a smooth dragging experience without sending dozens of `seek` commands to the audio engine and worker, which would be slow and cause audible glitching.

##### **4.6 Real-time UI Updates (The Hot Path)**

This flow is the high-performance, read-only path for UI elements that must update on every frame.

1.  **Initiator**: The **`WebAudioAdapter`**. When it is told to play by the `PlaybackHexagon`, it starts a `requestAnimationFrame` loop.
2.  **Calculation**: On each frame, the loop calculates the precise `estimatedTime` based on `AudioContext.currentTime` and the current speed from the `playerStore`.
3.  **Direct Store Update**: The loop calls `timeStore.set(estimatedTime)`.
4.  **Targeted UI Reaction**: Only the `SeekBar.svelte` thumb and the `TimeDisplay.svelte` text subscribe to `timeStore`. They are the only components that re-render at 60fps. The rest of the application is unaffected.
5.  **Termination**: When the `WebAudioAdapter` is told to pause, it cancels the `requestAnimationFrame` loop.