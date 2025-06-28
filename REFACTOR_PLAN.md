[//]: # ( REFACTOR_PLAN.md )

# **Vibe Player V3: The Hexagonal Refactoring Plan**

### **0. Context & Justification**

The primary impetus for this refactor stems from a careful analysis of the project's history: the successes and limitations of the original `vibe-player` (V1), and the architectural failures of the subsequent `vibe-player-v2.3` refactor attempt. V3 is not an incremental fix but a necessary redesign based on the lessons learned from both.

#### **0.1 Analysis of V1: The Working-but-Fragile Implementation**

The original implementation, located in the `/vibe-player` directory, is the current production version for a reason: **it works.** It successfully integrates complex technologies like the Web Audio API, Rubberband WASM, and ONNX Runtime to deliver all core features. Critically, it correctly offloads intensive tasks like VAD analysis to a Web Worker, as seen in `js/vad/LocalWorkerStrategy.js`.

However, its success is achieved through an architecture that is brittle and difficult to maintain or extend. Its key weaknesses are observable in the code:

*   **Ad-Hoc and Non-Reusable Worker Logic:** While V1 correctly uses a Web Worker for VAD, the implementation is entirely bespoke. The `LocalWorkerStrategy.js` module manually constructs the entire worker's script as a single, monolithic string. This "worker-in-a-string" pattern is difficult to debug, has no syntax highlighting, and the communication protocol (`onmessage` handling a switch-case) is custom-built for this one purpose. It is not a reusable or robust pattern for managing asynchronous, threaded tasks.

*   **The "God Object" Controller:** `vibe-player/js/app.js` acts as a monolithic controller. It directly orchestrates every aspect of the application, from UI event handling (`handlePlayPause`) to kicking off analysis tasks (`runVadInBackground`, `processAudioForTones`) and managing central state. This tight coupling makes it exceedingly difficult to test any single piece of functionality in isolation.

*   **Implicit Dependencies via Script Order:** The entire application's stability relies on the manual `<script>` loading order in `vibe-player/index.html`. Modules attach themselves to the global `AudioApp` namespace and assume their dependencies will be present. A change to this sequence can lead to cascading runtime errors.

*   **Global, Mutable State:** State is managed via properties attached directly to the global `AudioApp` namespace (e.g., `AudioApp.state.runtime.currentAudioBuffer`). This makes it difficult to trace where and when state is being changed, creating a high risk of unpredictable side effects and making state management a source of potential bugs.

#### **0.2 Analysis of V2.3: The Failed Refactor**

The `vibe-player-v2.3` project was a well-intentioned effort to modernize the stack with SvelteKit and TypeScript. However, it is non-functional, suffering from critical flaws that rendered it unusable. The CI pipeline (`.github/workflows/ci-v2.yml`) confirms this, with most build and test steps commented out.

Its failure was not due to the choice of Svelte or TypeScript, but because it **inherited and amplified the architectural weaknesses of V1** instead of solving them.

*   **The Root Failure: Duplication of Fragile Worker Communication:** The core flaw was taking V1's ad-hoc worker communication pattern and duplicating it across the new, service-oriented architecture. As seen in `vibe-player-v2.3/src/lib/services/analysis.service.ts` and `audioEngine.service.ts`, each service independently implemented its own manual, error-prone system for talking to its worker. This involved manually managing promise `resolve`/`reject` callbacks in a `Map` and tracking unique message IDs—a fragile, complex, and repetitive pattern.

*   **The Consequence: Catastrophic, Silent Failures:** This duplicated boilerplate was the direct cause of the project's instability. A simple bug, such as a worker forgetting to echo back a `messageId`, caused its corresponding service's `initialize()` promise to hang forever, silently deadlocking a major part of the application. This exact bug pattern was discovered in multiple services (`sileroVad.worker.ts`, `rubberband.worker.ts`), proving that the architecture itself—which encouraged this pattern—was the problem.

*   **Behavioral Regressions:** The V2.3 refactor also introduced functional regressions. For example, the waveform visualization, defined in `vibe-player-v2.3/src/lib/utils/waveform.ts`, implemented a simple peak-finding algorithm (`maxAmplitude`) instead of the `min/max` peak detection used in V1. This resulted in the observed visual bug where the waveform displayed as incorrect, equal-height bars, losing the visual fidelity of the original.

In summary, V1 proved the features were viable but the architecture was unsustainable. V2.3 proved that modern tools without a sound architecture are insufficient and will amplify existing problems. V3 is the direct response: a ground-up redesign using the **Hexagonal (Ports and Adapters) Architecture** to create a system that is fundamentally testable, decoupled, and robust, with a dedicated, reusable solution for all asynchronous worker communication.

## 1. Vision & Executive Summary

This document outlines the complete architectural blueprint for Vibe Player V3. It is not an incremental fix, but a
ground-up redesign based on the principles of **Hexagonal (Ports and Adapters) Architecture**.

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

This appendix provides a concrete and detailed implementation guide for the state management and data flow principles of
the V3 Hexagonal Architecture. It specifies where each piece of state is owned, the strict communication pathways
between components, and the step-by-step flow for every user interaction.

#### **1. The State Store: A Driven Adapter, Not a Hexagon**

A foundational principle of this architecture is the clear separation of business logic (Hexagons) from technology (
Adapters). The "State Store" (e.g., a collection of Svelte stores) is a technology choice for enabling reactive UI
updates. It is not a hexagon itself.

* **Role**: The State Store acts as a centralized, write-only message bus for the application's core logic.
* **Management**: No single hexagon "manages" the store. Instead, multiple hexagons **drive** it through a
  `StateStoreAdapter`.
* **Data Flow**: A hexagon calculates a new state, calls its driven port (e.g., `IPlayerStatePublisher`), and the
  `StateStoreAdapter`'s implementation of that port is what actually writes to the Svelte store. The hexagon remains
  pure, with no knowledge of Svelte.

#### **2. Communication Hierarchy: Who Can Talk to Whom**

To prevent the tight coupling of previous versions, communication follows these strict rules:

| From                                             | Can Call / Drive                                                            | CANNOT Call / Drive                                     | Example                                                                                                    |
|:-------------------------------------------------|:----------------------------------------------------------------------------|:--------------------------------------------------------|:-----------------------------------------------------------------------------------------------------------|
| **Driving Adapter** (e.g., UI Component)         | A **Hexagon's** driving port.                                               | Another adapter, the State Store, or a worker directly. | The "Play" button component calls `AppHexagon.play()`.                                                     |
| **Hexagon** (e.g., `PlaybackHexagon`)            | A **Driven Adapter's** port (e.g., `StateStoreAdapter`, `WebAudioAdapter`). | Another Hexagon directly.                               | `PlaybackHexagon` calls `this.statePublisher.publish(...)` which the `StateStoreAdapter` implements.       |
| **Technology Adapter** (e.g., `WebAudioAdapter`) | A **Worker** (via the `WorkerManager`) or Browser APIs (`AudioContext`).    | A Hexagon.                                              | `WebAudioAdapter` calls `this.workerManager.postRequest(...)` to communicate with the `rubberband.worker`. |

The **`AppHexagon`** is the only exception: it is the orchestrator and is allowed to call the driving ports of other
domain hexagons (e.g., `PlaybackHexagon`, `VADHexagon`) to coordinate complex use cases.

#### **3. State Ownership and Pathways**

The following table details every piece of application state, its official "owner," and its location in the central
state store.

| State Item                           | Owning Hexagon       | Location in Store                       | Description                                                                                                                                                   |
|:-------------------------------------|:---------------------|:----------------------------------------|:--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `status` (`loading`, `ready`, etc.)  | `AppHexagon`         | `statusStore`                           | The single source of truth for the application's overall state.                                                                                               |
| `error`                              | `AppHexagon`         | `statusStore`                           | The global error message, if any.                                                                                                                             |
| `fileName`, `duration`, `isPlayable` | `AppHexagon`         | `playerStore`                           | High-level metadata about the loaded audio, managed by the orchestrator.                                                                                      |
| `isPlaying`, `isLooping`             | `PlaybackHexagon`    | `playerStore`                           | The canonical boolean playback state.                                                                                                                         |
| `currentTime`                        | `PlaybackHexagon`    | `timeStore` (Hot), `playerStore` (Cold) | The canonical playback time. Updated on the "hot path" by the `WebAudioAdapter` for UI, and synced on the "cold path" by the `PlaybackHexagon` on pause/seek. |
| `speed`, `pitchShift`, `gain`        | `PlaybackHexagon`    | `playerStore`                           | Playback manipulation parameters.                                                                                                                             |
| `isSeeking`, `wasPlayingBeforeSeek`  | `AppHexagon`         | *Internal to `AppHexagon`*              | Ephemeral UI state for managing the seek interaction. Not needed by the rest of the app, so it is not published to the store.                                 |
| `vadProbabilities`                   | `VADHexagon`         | `analysisStore`                         | The raw frame-by-frame speech probabilities from the ML model.                                                                                                |
| `vadRegions`                         | `VADHexagon`         | `analysisStore`                         | The calculated speech time segments, derived from `vadProbabilities` and the current thresholds.                                                              |
| `vadPositiveThreshold`, etc.         | `VADHexagon`         | `analysisStore`                         | The tuning parameters for VAD region calculation.                                                                                                             |
| `dtmfResults`                        | `DTMFHexagon`        | `dtmfStore`                             | The list of detected DTMF tones.                                                                                                                              |
| `spectrogramData`                    | `SpectrogramHexagon` | `analysisStore`                         | The calculated spectrogram data (frequency-magnitude arrays).                                                                                                 |
| `waveformData`                       | `WaveformHexagon`    | `playerStore`                           | The calculated peak data for waveform visualization.                                                                                                          |

---

#### **4. Detailed Interaction Flows**

The following sections detail the end-to-end data flow for every user interaction.

##### **4.1 Application Initialization & URL Loading**

This flow describes what happens when a user first loads the page with URL parameters.

1. **Driving Adapter (`+page.ts`)**: The SvelteKit `load` function reads parameters (`url`, `time`, `speed`, etc.) from
   the page's URL search params. It bundles these into an `initialState` object.
2. **Driving Adapter (UI - `+page.svelte`)**: The `initialState` is passed as a prop. In `onMount`, it checks if
   `initialState.url` exists.
3. **Port Call**: If a URL exists, it calls `AppHexagon.loadAudio(initialState.url, initialState)`.
4. **`AppHexagon` (Orchestrator)**: It sets `statusStore` to `loading`. It then drives the `AudioLoaderService` to fetch
   the URL content.
5. **`AudioLoaderService`**: Returns a decoded `AudioBuffer`.
6. **`AppHexagon`**: It receives the `AudioBuffer` and begins driving all other hexagons in parallel:
    * `PlaybackHexagon.prepare(audioBuffer, initialState)`: Sets the duration, initial seek time, speed, etc.
    * `WaveformHexagon.generatePeaks(audioBuffer)`: Generates the waveform visualization data.
    * *Fire-and-forget calls:* `VADHexagon.analyze()`, `DTMFHexagon.analyze()`, `SpectrogramHexagon.generate()`.
7. **Hexagons Publish State**: As each hexagon completes its task, it publishes its data (`waveformData`, `duration`,
   `isPlayable=true`, etc.) to the `StateStoreAdapter`.
8. **`AppHexagon`**: Once the *critical path* (playback prep and waveform) is complete, it sets `statusStore` to
   `ready`.
9. **UI Reaction**: All components subscribed to the stores (`playerStore`, `statusStore`) update to show the waveform
   and enable the playback controls. The background analysis results (`vadRegions`, `spectrogramData`) pop in later as
   they become available.

##### **4.2 Loading Audio (User Interaction)**

This flow is nearly identical to URL loading, but is initiated by a user click.

* **Load from File**: `FileLoader.svelte` -> `on:change` -> `AppHexagon.loadAudio(file)`. The flow proceeds as in 4.1.
* **Load from URL Input**: `FileLoader.svelte` -> `on:click` on "Load" button -> `AppHexagon.loadAudio(url)`. The flow
  proceeds as in 4.1.

##### **4.3 Playback Control (Cold Path)**

* **Play/Pause (Button or Keyboard)**
    1. **Driving Adapter (UI)**: `Controls.svelte` button click or global keybind fires.
    2. **Port Call**: Calls `AppHexagon.togglePlayPause()`.
    3. **`AppHexagon`**: Delegates by calling `PlaybackHexagon.togglePlayPause()`.
    4. **`PlaybackHexagon`**: Flips its internal `isPlaying` boolean. It then publishes the new state (
       `isPlaying: true`) via its driven port. It also calls `this.audioOutput.play()`, which is implemented by the
       `WebAudioAdapter`.
    5. **`WebAudioAdapter`**: Starts the `rAF` loop for the "Hot Path" time updates.
    6. **`StateStoreAdapter`**: Updates `playerStore`. The UI's play button icon changes.

* **Stop Button**
    1. **Driving Adapter (UI)**: `Controls.svelte` "Stop" button click.
    2. **Port Call**: Calls `AppHexagon.stop()`.
    3. **`AppHexagon`**: Orchestrates the stop sequence. It calls `PlaybackHexagon.stop()` and
       `PlaybackHexagon.seek(0)`.
    4. **`PlaybackHexagon`**: Pauses playback, sets its internal `currentTime` to 0, and publishes both
       `isPlaying: false` and `currentTime: 0` to the store.
    5. **`WebAudioAdapter`**: The `rAF` loop stops. The `URLWriterAdapter` sees the time is 0 and removes the `t=`
       parameter from the URL.

* **Jump Forward/Backward**
    1. **Driving Adapter (UI)**: `Controls.svelte` jump button click or keybind fires.
    2. **Port Call**: Calls `AppHexagon.jump(direction)`.
    3. **`AppHexagon`**: Reads the `jumpSeconds` and `currentTime` from the `playerStore`. It calculates the `newTime`
       and calls `PlaybackHexagon.seek(newTime)`.
    4. **`PlaybackHexagon`**: Updates its internal time and publishes the change. The UI updates.

##### **4.4 Parameter Sliders (Cold Path)**

* **Speed, Pitch, Gain, VAD Thresholds**
    1. **Driving Adapter (UI)**: A slider in `Controls.svelte` is moved.
    2. **Port Call**: The `on:input` event triggers a debounced call to `AppHexagon.setSpeed(value)` (or `setPitch`,
       `setVadThreshold`, etc.).
    3. **`AppHexagon`**: Delegates the call to the appropriate domain hexagon (e.g., `PlaybackHexagon.setSpeed(value)`).
    4. **`PlaybackHexagon`/`VADHexagon`**: The hexagon updates its internal parameter. It then publishes the new value
       to the `StateStoreAdapter`. For VAD, it also re-runs its internal region calculation and publishes the new
       `vadRegions`.
    5. **UI/Adapter Reaction**:
        * The slider's label, subscribed to the store, updates its text.
        * The `WebAudioAdapter`, subscribed to the `playerStore`, sees the new speed and sends a command to the
          `rubberband.worker`.
        * The `Waveform.svelte` component, subscribed to the `analysisStore`, sees the new `vadRegions` and redraws the
          highlights.

##### **4.5 The Seek Interaction (Special Case)**

The seek bar is unique because it involves a continuous user drag action that must temporarily override the real-time
playback updates.

* **State Owner**: The temporary `isSeeking` and `wasPlayingBeforeSeek` flags are owned internally by the **`AppHexagon`
  **. They are ephemeral UI orchestration state and do not belong in the `PlaybackHexagon` or the global state store.

* **Flow**:
    1. **`mousedown` / `touchstart`**: The user presses the seek bar.
        * **Driving Adapter (UI - `+page.svelte`)**: Calls `AppHexagon.beginSeek()`.
        * **`AppHexagon`**: Sets its internal `this.isSeeking = true`. It checks the `playerStore` for the current
          `isPlaying` status and saves it: `this.wasPlayingBeforeSeek = isPlaying`. If it was playing, it immediately
          calls `PlaybackHexagon.pause()`.
    2. **`input` / `touchmove`**: The user drags the seek bar.
        * **Driving Adapter (UI)**: The slider's value changes. It directly updates the "hot" `timeStore` with the new
          value. The `TimeDisplay` and the slider's thumb update instantly, providing responsive feedback *without*
          repeatedly commanding the audio engine.
    3. **`mouseup` / `touchend`**: The user releases the seek bar.
        * **Driving Adapter (UI)**: Calls `AppHexagon.endSeek(finalTime)`.
        * **`AppHexagon`**: It calls `PlaybackHexagon.seek(finalTime)`. Then, it checks its internal flag: if
          `this.wasPlayingBeforeSeek` was true, it calls `PlaybackHexagon.play()`. Finally, it resets its internal
          flags: `this.isSeeking = false`, `this.wasPlayingBeforeSeek = false`.

* **Why This Separation?**
    * **Decoupling**: The `PlaybackHexagon`'s job is simple: play, pause, seek. It doesn't need to know *why* it's being
      paused or sought. The complex UI logic of "pause-for-seek-then-resume" is an application-level concern, perfectly
      suited for the `AppHexagon` orchestrator.
    * **Performance**: The `input` events update the UI directly via the `timeStore`, providing a smooth dragging
      experience without sending dozens of `seek` commands to the audio engine and worker, which would be slow and cause
      audible glitching.

##### **4.6 Real-time UI Updates (The Hot Path)**

This flow is the high-performance, read-only path for UI elements that must update on every frame.

1. **Initiator**: The **`WebAudioAdapter`**. When it is told to play by the `PlaybackHexagon`, it starts a
   `requestAnimationFrame` loop.
2. **Calculation**: On each frame, the loop calculates the precise `estimatedTime` based on `AudioContext.currentTime`
   and the current speed from the `playerStore`.
3. **Direct Store Update**: The loop calls `timeStore.set(estimatedTime)`.
4. **Targeted UI Reaction**: Only the `SeekBar.svelte` thumb and the `TimeDisplay.svelte` text subscribe to `timeStore`.
   They are the only components that re-render at 60fps. The rest of the application is unaffected.
5. **Termination**: When the `WebAudioAdapter` is told to pause, it cancels the `requestAnimationFrame` loop.

---

## Appendix B: Advanced State Protocol & Edge Case Handling

This appendix provides a concrete and detailed implementation guide for the state management and data flow principles of
the V3 Hexagonal Architecture. It specifies where each piece of state is owned, the strict communication pathways
between components, and the step-by-step flow for every user interaction, including edge case handling.

### 1. Architectural Principles

#### 1.1. The Command vs. Event Pattern

To eliminate race conditions and enforce a predictable, sequential flow of logic, the system adheres to a strict
Command/Event pattern:

* **Commands (Input):** Originate from a **Driving Adapter** (e.g., the UI). They are requests for the application to
  *do something* (e.g., `play()`, `seek()`, `setSpeed()`). The flow is always `UI -> AppHexagon -> Domain Hexagon`.
* **Events (Output):** Originate from a **Driven Adapter** (e.g., `WebAudioAdapter`) or a worker. They are notifications
  that a *system event has occurred* (e.g., `playbackFinished`, `workerCrashed`). The flow is always
  `Adapter -> Domain Hexagon -> AppHexagon`.

#### 1.2. The `AppHexagon`: A Transactional State Machine

The `AppHexagon` is the sole authority for all major state transitions. Domain hexagons (like `PlaybackHexagon`) do not
change their own state based on system events. They report these events up to the `AppHexagon`, which then consults its
current state (`this.status`) and issues explicit commands back down to the domain hexagons to update their canonical
state. This makes the system robust and transactional.

#### 1.3. The "Hot Path" Reflex Arc

For high-frequency UI updates (e.g., the seek bar position during playback), a controlled bypass mechanism is used.
This "hot path" is a **read-only, UI-specific data flow** that does not alter the core application state.

* The `WebAudioAdapter` runs a `requestAnimationFrame` loop during playback.
* Inside the loop, it calculates the estimated time and writes **directly** to a dedicated, lightweight UI store (
  `timeStore`).
* Only UI components that need 60fps updates subscribe to this "hot" store.
* The application's core hexagons are not involved or burdened by this loop.

#### 1.4. Debouncing at the Adapter Layer

To prevent flooding the application core with commands from continuous user input (e.g., wiggling a slider), debouncing
is handled at the **Driving Adapter** layer. The UI component (`Controls.svelte`) is responsible for debouncing the
user's input before sending a final, clean command to the `AppHexagon`.

#### 1.5. Large Data Handling

To maintain UI performance, large, static data payloads (like the VAD probabilities array) are **not** stored in
reactive Svelte stores. Instead, the owning hexagon (`VADHexagon`) holds the data internally and provides a synchronous
accessor method on its port (`getProbabilityData()`). The store will only hold a boolean flag (
`hasProbabilities: true`), which signals to the relevant UI component that it can now call the accessor to retrieve the
data for rendering.

### 2. Communication Hierarchy

Communication follows these strict rules to maintain decoupling:

| From                                             | Can Call / Drive                                                            | CANNOT Call / Drive                                     | Example                                                                                                    |
|:-------------------------------------------------|:----------------------------------------------------------------------------|:--------------------------------------------------------|:-----------------------------------------------------------------------------------------------------------|
| **Driving Adapter** (e.g., UI Component)         | A **Hexagon's** driving port.                                               | Another adapter, the State Store, or a worker directly. | The "Play" button component calls `AppHexagon.play()`.                                                     |
| **Hexagon** (e.g., `PlaybackHexagon`)            | A **Driven Adapter's** port (e.g., `StateStoreAdapter`, `WebAudioAdapter`). | Another Hexagon directly. (Exception: `AppHexagon`).    | `PlaybackHexagon` calls `this.statePublisher.publish(...)` which the `StateStoreAdapter` implements.       |
| **Technology Adapter** (e.g., `WebAudioAdapter`) | A **Worker** (via the `WorkerManager`) or Browser APIs (`AudioContext`).    | A Hexagon.                                              | `WebAudioAdapter` calls `this.workerManager.postRequest(...)` to communicate with the `rubberband.worker`. |

### 3. State Ownership and Pathways

| State Item                                  | Owning Hexagon       | Location in Store                       | Description                                                                                                                                                   |
|:--------------------------------------------|:---------------------|:----------------------------------------|:--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `status` (`loading`, `ready`, etc.)         | `AppHexagon`         | `statusStore`                           | The single source of truth for the application's overall state.                                                                                               |
| `error`                                     | `AppHexagon`         | `statusStore`                           | The global error message, if any.                                                                                                                             |
| `fileName`, `duration`, `isPlayable`        | `AppHexagon`         | `playerStore`                           | High-level metadata about the loaded audio, managed by the orchestrator.                                                                                      |
| `isPlaying`, `isLooping`                    | `PlaybackHexagon`    | `playerStore`                           | The canonical boolean playback state.                                                                                                                         |
| `currentTime`                               | `PlaybackHexagon`    | `timeStore` (Hot), `playerStore` (Cold) | The canonical playback time. Updated on the "hot path" by the `WebAudioAdapter` for UI, and synced on the "cold path" by the `PlaybackHexagon` on pause/seek. |
| `speed`, `pitchShift`, `gain`               | `PlaybackHexagon`    | `playerStore`                           | Playback manipulation parameters.                                                                                                                             |
| **`isSeeking`**, **`wasPlayingBeforeSeek`** | **`AppHexagon`**     | **Internal to `AppHexagon`**            | Ephemeral UI state for managing the seek interaction. **Not published to the store.**                                                                         |
| **`vadProbabilities`**                      | **`VADHexagon`**     | **Internal to `VADHexagon`**            | The raw frame-by-frame speech probabilities. **Not published to the store.**                                                                                  |
| `hasVadProbabilities`                       | `VADHexagon`         | `analysisStore`                         | A boolean flag indicating that the probability data is available for retrieval.                                                                               |
| `vadRegions`                                | `VADHexagon`         | `analysisStore`                         | The calculated speech time segments.                                                                                                                          |
| `vadPositiveThreshold`, etc.                | `VADHexagon`         | `analysisStore`                         | The tuning parameters for VAD region calculation.                                                                                                             |
| `dtmfResults`                               | `DTMFHexagon`        | `dtmfStore`                             | The list of detected DTMF tones.                                                                                                                              |
| `spectrogramData`                           | `SpectrogramHexagon` | `analysisStore`                         | The calculated spectrogram data.                                                                                                                              |
| `waveformData`                              | `WaveformHexagon`    | `playerStore`                           | The calculated peak data for waveform visualization.                                                                                                          |

### 4. Detailed Interaction Flows & Edge Case Handling

#### 4.1. File Loading (with Cancellation)

1. **Initiation**: User selects a new file. `UI` -> `AppHexagon.loadAudio(file)`.
2. **`AppHexagon` (Cancellation)**:
    * It immediately calls its internal `this.cancelCurrentOperation()`. This dispatches a cancellation signal down to
      all adapters via an `AbortController`. Any ongoing `fetch` or long worker task is aborted.
    * It transitions the application state: `this.status = 'loading'`. It publishes this to the `statusStore`. The UI
      shows a global spinner and disables controls.
3. **`AppHexagon` (Orchestration)**: It proceeds with the standard loading sequence (driving `AudioLoaderService`, then
   other hexagons in parallel).
4. **Completion/Error**:
    * On success, once critical path hexagons complete, `AppHexagon` sets `this.status = 'ready'`.
    * If any critical step (e.g., decoding, `rubberband.worker` init) fails, the error propagates up to the
      `AppHexagon`. It sets `this.status = 'error'`, publishes a descriptive error message to the `statusStore`, and
      ensures all UI controls are in a safe, disabled state.

#### 4.2. Playback Control (Command/Event Pattern)

* **Play Command**:
    1. `UI` -> `AppHexagon.play()`.
    2. `AppHexagon` Gatekeeper: Checks `this.status`. If `'ready'`, it proceeds.
    3. `AppHexagon` -> `PlaybackHexagon.play()`.
    4. `PlaybackHexagon` -> `WebAudioAdapter.play()`.
    5. `WebAudioAdapter` **activates the "Hot Path" `rAF` loop**.
    6. `PlaybackHexagon` publishes `{ isPlaying: true }` to `playerStore`.

* **Playback Finished Event (System-Generated)**:
    1. `WebAudioAdapter` detects the stream has ended. It **emits an event**: `playbackFinished`.
    2. `PlaybackHexagon` receives this event and **forwards it** to the `AppHexagon.onPlaybackFinished()`.
    3. `AppHexagon` Gatekeeper: Checks `this.status`. If `'playing'`, it transitions `this.status = 'ready'`.
    4. `AppHexagon` **issues a command**: `PlaybackHexagon.updateState({ isPlaying: false, currentTime: [duration] })`.
    5. `PlaybackHexagon` obeys, updates its internal state, and publishes the final state to the `playerStore`. The
       `WebAudioAdapter`'s `rAF` loop is already stopped.

#### 4.3. The Seek Interaction (Stateful Orchestration)

1. **`mousedown`**:
    * `UI` -> `AppHexagon.beginSeek()`.
    * **`AppHexagon`**:
        * Sets its internal state: `this.isSeeking = true`.
        * Reads `isPlaying` from `playerStore` and sets `this.wasPlayingBeforeSeek`.
        * If `wasPlayingBeforeSeek` is true, it commands `PlaybackHexagon.pause()`. The `WebAudioAdapter` stops its
          `rAF` loop upon receiving the pause command.

2. **`input`**:
    * `UI` -> `timeStore.set(newValue)`. The seek bar thumb and time display update instantly via the **Hot Path**. The
      application core is not involved.

3. **`mouseup`**:
    * `UI` -> `AppHexagon.endSeek(finalTime)`.
    * **`AppHexagon`**:
        * Issues command: `PlaybackHexagon.seek(finalTime)`.
        * Checks internal state: `if (this.wasPlayingBeforeSeek) { AppHexagon.play(); }`.
        * Resets internal state: `this.isSeeking = false; this.wasPlayingBeforeSeek = false;`.

#### 4.4. Slider Input (Debounced)

1. **User Action**: User wiggles the "Speed" slider.
2. **Driving Adapter (`Controls.svelte`)**:
    * The slider's value is bound to a local variable, `localSpeed`.
    * A reactive statement (`$:`) watches `localSpeed` and calls a **debounced function**:
      `debouncedSetSpeed(localSpeed)`.
    * The debouncer is configured with a 200-300ms wait time.
3. **Command Path**: After the user stops wiggling the slider for the configured wait time, the debounced function
   finally executes.
    * `debouncedSetSpeed` -> `AppHexagon.setSpeed(finalValue)`.
    * The command proceeds cleanly down the chain: `AppHexagon` -> `PlaybackHexagon` -> `StateStoreAdapter` and
      `WebAudioAdapter`.

This ensures that even with frantic, simultaneous input across multiple sliders, the core application only receives a
few clean, final commands after the user's actions have settled.

---

### **Appendix C: V3 Testing and Quality Assurance Strategy**

This appendix outlines the multi-layered testing and quality assurance strategy for Vibe Player V3. The primary philosophy is to "shift left," enabling the developer to catch as many issues as possible locally with fast, offline tools before relying on the more comprehensive, slower checks in the CI/CD pipeline. This strategy is designed to enforce the architectural principles of V3, prevent regressions, and ensure a high degree of code quality and maintainability.

#### **1. The Testing Pyramid**

Our strategy is structured as a testing pyramid, with a broad base of fast, local checks and a narrow top of slower, end-to-end tests.

| Layer | Tool(s) | Purpose | Runs Locally? | Runs in CI? | Speed |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Static Analysis** | `tsc`, Biome, `dependency-cruiser` | Type safety, code quality, style, architectural rules | **Yes** | **Yes** | Blazing Fast |
| **Unit Tests** | Vitest / Jest | Test individual hexagons/functions in isolation | **Yes** | **Yes** | Fast |
| **Integration Tests**| Vitest / Jest | Test how hexagons and adapters collaborate | **Yes** | **Yes** | Fast |
| **CI Static Analysis**| SonarCloud, GitHub CodeQL | Tech debt, maintainability, deep security scans | No | **Yes** | Slow |
| **End-to-End Tests**| Playwright | Verify user flows in a real browser | No | **Yes** | Slow |
| **Visual Tests** | Playwright (`toHaveScreenshot`) | Prevent visual bugs in UI and visualizations | No | **Yes (Future)** | Slow |

---

#### **2. Local Development Checks (The Inner Loop)**

These checks are designed to be run by the developer locally, providing instant feedback. They are fully offline after the initial `npm install`.

*   **Type Safety (`tsc`):**
    *   **Tool:** The TypeScript compiler running in "checkJs" mode.
    *   **Command:** `tsc --noEmit --project jsconfig.json`
    *   **Enforcement:** A `jsconfig.json` file will be configured with `"strict": true` and `"checkJs": true`. This forces every function, parameter, and variable to be explicitly typed via JSDoc. It is the direct equivalent of running `mypy` in a Python project and will fail on any untyped or incorrectly typed code.

*   **Code Quality & Formatting (Biome):**
    *   **Tool:** Biome.
    *   **Command:** `npx @biomejs/biome check --apply .`
    *   **Enforcement:** Biome will replace both ESLint and Prettier. It will be configured with a strict set of rules to catch code smells, enforce best practices (e.g., `no-var`), identify overly complex code, and check for unused variables. Its `--apply` flag will also auto-format the code, ensuring 100% consistency.

*   **Architectural Rules (`dependency-cruiser`):**
    *   **Tool:** `dependency-cruiser`.
    *   **Command:** `npx depcruise src`
    *   **Enforcement:** This is critical for maintaining the Hexagonal Architecture. A `.dependency-cruiser.js` config file will enforce rules such as:
        *   Hexagons (`src/lib/hexagons/`) **cannot** import from Adapters (`src/lib/adapters/`).
        *   Adapters **can** import their corresponding Hexagon's port definitions.
        *   UI-layer adapters **cannot** import from backend adapters (e.g., `DOMAdapter` cannot import `WebAudioAdapter`).
        This prevents architectural decay over time.

---

#### **3. Automated Testing (Unit & Integration)**

These tests are run locally via a single command (`npm run test`) and are also a mandatory check in the CI pipeline.

*   **Unit Tests & V1 Characterization Testing:**
    *   **Concept:** For core algorithms (VAD region calculation, DTMF parsing, waveform downsampling), we will use V1 as the "golden master."
    *   **Process:**
        1.  **Generate Test Vectors:** We will run the pure logic from the V1 codebase with specific inputs and save the inputs and their exact outputs to JSON files (e.g., `vad-test-vector-01.json`). These vectors will be checked into the repository.
        2.  **Write V3 Unit Tests:** The unit tests for the V3 hexagons will load these JSON files. They will feed the `input` from the vector into the new V3 function and assert that the `output` is deeply equal to the `expectedOutput`.
    *   **Benefit:** This proves that the V3 refactor has perfectly preserved the trusted logic of the original working application, dramatically reducing the risk of regressions.

*   **Integration Tests:**
    *   **Concept:** To verify the collaboration between hexagons and their ports without the overhead of a browser.
    *   **Example:** A test could instantiate the `AppHexagon` and a real `PlaybackHexagon`, but inject a *mock* `WebAudioAdapter`. The test would then call `AppHexagon.play()` and assert that the mock `WebAudioAdapter` received the correct `{type: 'play'}` command. This validates the entire internal command chain quickly.

---

#### **4. CI/CD Pipeline Checks (The Final Gate)**

The CI pipeline on GitHub Actions runs all of the above checks and adds two final, deeper layers of analysis.

*   **Deep Security Analysis (CodeQL):**
    *   **Tool:** GitHub CodeQL.
    *   **Process:** A GitHub Actions workflow will run on every pull request to perform a deep semantic analysis of the code, scanning for a wide range of security vulnerabilities (XSS, injection flaws, etc.). Results are reported directly on the PR.

*   **Code Maintainability Analysis (SonarCloud):**
    *   **Tool:** SonarCloud, which is free for public repositories.
    *   **Process:** After a build passes, a workflow will send the code to SonarCloud for analysis. It will report on code smells, complexity, duplication, and technical debt.
    *   **Developer Feedback Loop:** Since a local SonarLint IDE extension will not be used, the developer's feedback loop for this analysis will be the comments and quality gate status that the SonarCloud bot posts on each GitHub pull request.

*   **End-to-End Testing (Playwright):**
    *   **Tool:** Playwright.
    *   **Process:** After all other checks pass, the full application will be built and served, and Playwright will run E2E tests to simulate user flows (loading a file, clicking play, adjusting a slider) in a real browser.

#### **5. Future Testing Additions**

*   **Visual Regression Testing:**
    *   **Status:** To be implemented after V3 has a stable UI.
    *   **Plan:** We will use Playwright's built-in `toHaveScreenshot` capability. This will be invaluable for the `<canvas>`-based waveform and spectrogram visualizations, as it is the only way to automatically detect if a code change has unintentionally altered their graphical output. This will catch visual bugs that E2E and unit tests cannot.

---

### **Appendix D: V3 Implementation Strategy & Process**

This appendix details the practical, step-by-step process for developing Vibe Player V3. It translates the architectural goals from the main document and the quality assurances from Appendix C into an actionable workflow. This is the definitive implementation plan.

#### **1. Guiding Principles**

The V3 development process is guided by three core principles to ensure a robust, maintainable, and high-quality result.

*   **Inside-Out Development:** We will build the application from its pure business logic core (the hexagons) outwards towards the browser-specific technologies (the adapters). We will explicitly avoid the "GUI-first" approach that leads to tightly-coupled, monolithic architectures. Core logic will be proven correct before any UI is assembled.

*   **Test-Driven Development (TDD):** Every new piece of logic will begin with a test that defines its requirements. Code will only be written to make a failing test pass. For refactoring existing logic from V1, this will take the form of **Characterization Testing**, where we capture the behavior of the old system and test that the new system is identical. This minimizes the risk of regressions.

*   **Early & Continuous Integration:** The CI/CD pipeline and its automated quality gates are not an afterthought; they are a foundational piece of the development environment. Every commit will be validated against strict standards for type safety, code quality, architectural integrity, and documentation.

#### **2. Phase 1: Project Foundation & CI Setup (The First Commit)**

This phase is completed once at the very beginning of the project. The goal is to create a robust development environment where quality is enforced from the start.

1.  **Initialize Project Structure:**
    *   Create the `vibe-player-v3/` project directory.
    *   Initialize `package.json` with `npm init -y`.
    *   Create the source directory structure which makes the hexagonal architecture explicit:
        ```
        vibe-player-v3/
        ├── src/
        │   ├── lib/
        │   │   ├── hexagons/  # Core business logic (e.g., VADHexagon.js)
        │   │   ├── adapters/  # Technology-specific code (e.g., WebAudioAdapter.js)
        │   │   └── ports/     # JSDoc @typedefs for port interfaces
        │   ├── app.js         # Main entry point; the final driving adapter
        │   └── index.html     # The final application shell
        ├── harnesses/         # For temporary, isolated HTML files for manual validation
        ├── tests/
        │   ├── unit/
        │   ├── integration/
        │   └── vectors/       # JSON files capturing V1 behavior for characterization tests
        └── ...
        ```

2.  **Install & Configure Core Tooling:**
    *   **Dependencies:** Install all development dependencies: `npm install --save-dev vitest typescript @biomejs/biome dependency-cruiser`.
    *   **TypeScript Config (`jsconfig.json`):** Create this file to enable `tsc` to type-check Vanilla JS with JSDoc. It will be configured with the strictest settings: `"strict": true` (which implies `"noImplicitAny": true`), `"checkJs": true`, and `"noEmit": true`. This makes `tsc --noEmit` the project's official static type-checker, equivalent to `mypy`.
    *   **Biome Config (`biome.json`):** Create this file to replace ESLint and Prettier. It will be configured with a strict set of linting rules (`no-var`, `noUnusedVariables`, `eqeqeq`, complexity checks) and formatting rules to ensure 100% code consistency.
    *   **Architecture Enforcement (`.dependency-cruiser.js`):** Create the configuration file. Its most critical rule will be `{ from: { path: "src/lib/hexagons" }, to: { path: "src/lib/adapters" }, severity: "error" }`, making it impossible for pure business logic to depend on technology-specific code.

3.  **Implement CI/CD Workflows:**
    *   Create the initial GitHub Actions workflows (`ci.yml`, `codeql.yml`, `sonarcloud.yml`).
    *   The `ci.yml` workflow will be configured to run `tsc --noEmit`, `biome check .`, and `npm run test` on every pull request.
    *   The first commit to the `main` branch will contain this foundational setup. The primary goal is to have a "green" build on an empty but fully configured project, proving the toolchain works.

#### **3. Phase 2: The Core Development Loop (Iterative)**

This is the iterative process for building each feature of the application.

1.  **Characterization Test (If Applicable):**
    *   If refactoring a feature from V1 (e.g., VAD region calculation), first generate a "test vector" JSON file. This involves running the pure logic from the V1 codebase with a curated set of inputs and saving both the inputs and the exact outputs. These vectors are the "golden master" standard and are checked into the repository under `tests/vectors/`.

2.  **Hexagon Implementation (TDD):**
    *   Create a new `.test.js` file for the V3 hexagon (e.g., `VADHexagon.test.js`).
    *   Write a test that loads the JSON vector and asserts that the (not-yet-written) V3 function's output `deeplyEquals` the expected V1 output. Run the test and watch it fail.
    *   Implement the pure logic inside the hexagon file (e.g., `VADHexagon.js`) until the unit test passes. No browser APIs or platform-specific code are allowed in this step.

3.  **Interface Discovery & Refinement:**
    *   During TDD, the precise methods and data contracts for the ports (interfaces) will be discovered. If the hexagon needs a new capability from an adapter, the developer will:
        1.  Update the JSDoc `@typedef` for the port in `src/lib/ports/` to reflect the new requirement.
        2.  Update the hexagon's unit test to provide the new data/functionality via its mock adapter.
        3.  Modify the hexagon's code to use the new interface method.
        4.  Finally, implement the change in the real adapter. The type-checker will guide this process, flagging any adapter that no longer conforms to the port's contract.

#### **4. Phase 3: Visual & Interactive Validation (The Human-in-the-Loop)**

This phase runs in parallel with Phase 2, providing crucial manual validation that complements the automated tests.

1.  **Development Harnesses / Storybook:**
    *   For each major feature, a developer can create a minimal HTML "harness" file (e.g., `harnesses/vad-harness.html`) to visually and manually validate the integrated hexagon and its adapter. This is for quick, scrappy validation.
    *   Once UI components (`<PlaybackControls>`, etc.) are being built, the project will adopt **Storybook**.

2.  **Storybook Workflow & Quality Gates:**
    *   **Story Coverage Check:** The CI pipeline will include a script that fails the build if a UI component is committed without a corresponding `.stories.js` file. This enforces Storybook as a **Definition of Done**.
    *   **PR Integration:** For every pull request, the Storybook instance will be automatically deployed to a preview URL. This URL will be the **single source of truth for design and developer reviews.**
    *   **Essential Add-on Starter Pack:** The Storybook setup will include a pre-configured set of high-value add-ons:
        *   `@storybook/addon-essentials`: For interactive prop controls and documentation.
        *   `@storybook/addon-a11y`: For automated accessibility testing.
        *   `@storybook/addon-interactions`: For testing component behavior via simulated user input.
        *   `storybook-addon-pseudo-states`: For testing CSS hover/focus/active states.
        *   `msw-storybook-addon`: For mocking network requests (e.g., for the "Load from URL" feature).
        *   `@storybook/addon-performance`: For analyzing component render performance.

#### **5. Phase 4: Final Application Assembly & E2E Testing**

1.  **Application Integration (`app.js`):**
    *   The main `app.js` file will be the final "driving adapter." Its role is to perform dependency injection: instantiate all hexagons and adapters, plug them into each other, and wire up the final UI event listeners.

2.  **Static Asset Management:**
    *   Place all static assets like fonts, images, and the final `index.html` in the appropriate static directory (e.g., `/public`). A build tool (like Vite) will be configured to handle these assets.

3.  **End-to-End & Visual Regression Testing (CI Only):**
    *   **Playwright E2E Tests:** These tests will run against a full production build in the CI pipeline to simulate complete user journeys.
    *   **Visual Regression (Future):** After the V3 UI is stable, Playwright's `toHaveScreenshot` will be added to the E2E suite to take snapshots of the waveform and spectrogram canvases, preventing visual regressions.

#### **6. Phase 5: Documentation & Handover**

1.  **Update Project Documentation:**
    *   Upon completion, the root `README.md` will be updated to reflect the new V3 architecture and setup. The `REFACTOR_PLAN.md` and this appendix will be moved to a `/docs` directory to preserve the project's history.
    *   The `vibe-player` (V1) and `vibe-player-v2.3` directories will be archived or removed.

2.  **Final Quality Review:**
    *   A final review of the SonarCloud dashboard will be conducted to identify and address any remaining high-priority issues before the official V3 release.