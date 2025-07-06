[//]: # ( vibe-player-v3/docs/refactor-plan/chapter-3-adapters-and-data-flow.md )
# Chapter 3: Adapters, Infrastructure & Data Flow

## 3.1. Driving Adapters (User Input & External Triggers)

These components initiate commands *on* the core services.

* **Svelte UI Components (`src/lib/components/` & `src/routes/`):**
    * **Role:** The primary driving adapter. Components receive service instances via `getContext`. They handle DOM
      events and either call methods on the `AudioOrchestratorService` (for state-changing commands) or emit events to
      the `appEmitter`.
    * **Key Example (`RangeSlider.svelte`):** This custom component wraps a standard `<input type="range">`. It attaches
      `on:mousedown`, `on:input`, and `on:mouseup` event handlers that dispatch commands like
      `AudioOrchestratorService.beginSeek()`, `updateSeek()`, and `endSeek()`.

* **URL State Listener (`src/routes/+page.ts`):**
    * **Role:** On startup, the SvelteKit `load` function parses URL query parameters and provides an `initialState`
      object to the main page component.
    * **Implementation:** The SvelteKit `load` function in `src/routes/+page.ts` parses `url.searchParams` and provides
      an `initialState` object to the main page component, which then passes it to the `AudioOrchestratorService`.

## 3.2. Driven Adapters (External Interactions & State Output)

These components are driven *by* the core services to perform a task.

* **Svelte Stores (`src/lib/stores/`):**
    * **Role:** The primary mechanism for pushing state updates from services to the UI. Services update Svelte
      `writable` stores, and UI components reactively consume these updates.

* **Web Workers (`src/lib/workers/`):**
    * **Role:** Perform computationally intensive tasks off the main thread. Communication is managed by the
      `WorkerChannel` utility.

* **`WorkerChannel` Utility (`src/lib/utils/workerChannel.ts`):**
    * **Role:** A mandatory, reusable class providing a **type-safe, Promise-based request/response communication
      channel** over the native Web Worker API. It will use TypeScript discriminated unions to ensure type safety of
      message payloads and implement robust timeout and observability mechanisms.

* **URL State Adapter (`src/lib/utils/urlState.ts`):**
    * **Role:** Serializes key application state into the URL's query string.
    * **Implementation:** The `AudioOrchestratorService` subscribes to relevant Svelte Stores. On changes to key
      parameters, it calls a debounced function in `urlState.ts` to update `window.history.replaceState()`.

* **Toast Notifications:**
    * **Role:** A top-level component will subscribe to the `statusStore`. When it detects a new error object, it will
      display a user-friendly toast notification.

## 3.3. Core Data Flow Principles

* **Unidirectional Data Flow:** Data flows in one direction: UI Interaction -> Service Command -> Store Update -> UI
  Reaction. This creates a predictable and debuggable system.

* **Controlled Exception: The "Hot Path"**
    * **What:** For the high-frequency `currentTime` update during playback, the `AudioEngineService` runs a
      `requestAnimationFrame` loop and writes **directly** to the dedicated `timeStore`.
    * **Why:** This is a deliberate exception to achieve smooth 60fps UI updates for the seek bar and time display
      without burdening the entire application with constant re-renders.
    * **Synchronization:** This is the *only* such exception. The `timeStore` is for display purposes only. To maintain
      a single source of truth, when a "cold" event occurs (e.g., `pause`, `endSeek`), the `AudioOrchestratorService` *
      *must** command the `AudioEngineService` to report its final authoritative time. The orchestrator then commits
      this value to the main `playerStore`, ensuring the canonical application state is always correct.

* **Large Data Handling Protocol**
    * **What:** Services generating large, static data (e.g., `vadProbabilities`) **must** hold it internally. They
      publish a simple boolean flag to a store to indicate readiness. UI components then call a synchronous accessor
      method on the service to retrieve the data for rendering.
    * **Why:** This prevents large data payloads from polluting reactive stores and causing performance issues.

## 3.4. State Ownership & Data Pathways

| State Item | Owning Service/Hexagon | Location in Store(s) | Primary Writer(s) | Primary Reader(s) | Description |
|:---|:---|:---|:---|:---|:---|
| `status` (`loading`, `ready`, etc.) | `AudioOrchestratorService` | `playerStore` (`status`) | **`AudioOrchestratorService`** | UI Components, Other Services (via derived stores) | The single source of truth for the application's overall state. |
| **`isPlaying`** (Derived State) | - | `isPlaying` (derived) | **(Derived from `playerStore`)** | UI Components | A read-only derived store for UI convenience. Cannot be written to directly. |
| `error` | `AudioOrchestratorService` | `playerStore` (`error`) | **`AudioOrchestratorService`** | UI Components (Toast notifications) | A structured object with details for user-facing toasts and logs. |
| `fileName`, `duration`, `sourceUrl` | `AudioOrchestratorService` | `playerStore` | **`AudioOrchestratorService`** | UI Components | High-level metadata about the loaded audio. |
| **`audioBuffer`** | **`AudioEngineService`** | **_Internal to Service_** | **`AudioEngineService`** | `AnalysisService`, `WaveformService` (on request) | Raw decoded audio data. **Not in a store.** Accessed via method call. |
| `currentTime` (Hot Path) | `AudioEngineService` | `timeStore` | **`AudioEngineService`** (on `rAF` loop) | UI Components (Seek bar, time display) | **"Hot Path"** for smooth 60fps UI updates during playback. |
| `currentTime` (Cold Path) | `AudioOrchestratorService` | `playerStore` (`currentTime`) | **`AudioOrchestratorService`** | `urlState` utility, Services | **"Cold Path"** sync. Updated on state changes (pause, seek end) for canonical state. |
| **Session Parameters** (e.g., `speed`, `vadPositiveThreshold`) | `AudioOrchestratorService` | `playerStore`, `settingsStore` | **UI Components** -> `AudioOrchestratorService` | `AnalysisService`, `AudioEngineService`, `urlState` utility | Shareable parameters that define the current session. **Mirrored to the URL.** |
| `vadProbabilities` | `AnalysisService` | **_Internal to Service_** | **`AnalysisService`** | `AnalysisService` | Raw VAD data. **Not in a store.** Internal implementation detail. |
| `vadRegions` | `AnalysisService` | `analysisStore` | **`AnalysisService`** | UI Components (Waveform visualization) | Calculated speech time segments. |
| `dtmfResults`, `cptResults` | `DtmfService` | `dtmfStore` | **`DtmfService`** | UI Components (Tone display) | Detected DTMF and Call Progress Tones. |
| **`spectrogramData`** | **`SpectrogramService`** | **_Internal to Service_** | **`SpectrogramService`** | UI Components (on request) | Calculated spectrogram data. **Not in a store.** Accessed via method call. |
| **`waveformData`** | **`WaveformService`** | **_Internal to Service_** | **`WaveformService`** | UI Components (on request) | Peak data for waveform visualization. **Not in a store.** Accessed via method call. |

## 3.5. Detailed Error Propagation from Workers

1. **Error in Worker:** A worker encountering a fatal error **must** post a specific error message back to the main
   thread.
2. **`WorkerChannel` Rejection:** The `WorkerChannel`, upon receiving this error or timing out, **must** reject the
   outstanding Promise with a custom `WorkerError`.
3. **Service Catches & Re-throws:** The calling service **must** catch this `WorkerError`, wrap it in a more specific
   high-level `Error` if needed, and **re-throw** it.
4. **Orchestrator Handles State:** The `AudioOrchestratorService` catches the re-thrown error and is the sole authority
   to transition the application into the `ERROR` state, updating the `playerStore` with details for the UI.

## 3.6. State Loading & Persistence Rules

This section defines the mandatory state hierarchy, which prioritizes a shareable, stateless session model. **The application must not use `localStorage` for any session or preference state.** All state is either derived from the URL or reset to application defaults.

*   **Rule 3.6.1: Two-Tiered State Loading Sequence (on startup)**
    *   The application **must** determine its initial state using the following order of precedence:
    1.  **Tier 1 (Lowest Precedence): Application Defaults.** The `AudioOrchestratorService` initializes all configurable parameters in the Svelte stores with their hardcoded default values from `src/lib/config.ts`.
    2.  **Tier 2 (Highest Precedence): Session State.** It then parses the URL query parameters. If any valid parameters are present, these values **must** overwrite the corresponding Application Defaults.

*   **Rule 3.6.2: URL-Only Persistence on Change**
    *   When a user adjusts any configurable parameter (e.g., `speed`, `vadPositiveThreshold`, `currentTime`), the change **must** be written **only** to the URL query string via the `urlState` utility.

*   **Rule 3.6.3: Loading a New Local File**
    *   When a user loads a new local audio file, the following sequence **must** occur:
        1.  The `urlState` utility **must clear all query parameters from the URL**.
        2.  The `AudioOrchestratorService` **must reset all configurable parameters to their Tier 1 Application Defaults** as defined in `src/lib/config.ts`.
    *   **Rationale:** This ensures that loading a new local file provides a clean, default analysis environment, free from any state carried over from a previous shared session.