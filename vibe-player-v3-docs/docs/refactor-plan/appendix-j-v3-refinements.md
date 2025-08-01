[//]: # ( vibe-player-v3/docs/refactor-plan/appendix-j-v3-refinements.md )
# Appendix J: V3 Implementation Refinements Summary

This appendix summarizes the key architectural decisions and refinements adopted for the V3 rewrite, superseding any
conflicting information in the main body or older appendices.

## 1. Architecture:
* **Dependency Injection:** Services are provided to UI components via Svelte's Context API, not direct imports.
  This enforces decoupling and dramatically simplifies component testing.
* **Event-Driven Services:** Services are decoupled and communicate via a type-safe global event emitter (
  `appEmitter`). They do not hold direct references to each other, preventing tangled dependencies.
* **Strict Data Ownership:** To ensure high performance, large binary data payloads **are not placed in reactive
  Svelte stores**. They are held as internal properties of their single, exclusive owner service. This includes:
    * `AudioBuffer`: Owned by `AudioEngineService`.
    * VAD `probabilities`: Owned by `AnalysisService`.
    * `waveformData`: Owned by `WaveformService`.
    * `spectrogramData`: Owned by `SpectrogramService`.
* **Service Responsibility & Specialization:** The `AudioOrchestratorService` is a pure coordinator, managing state
  transitions only. To adhere to the Single Responsibility Principle, logic for generating visual data has been
  delegated to specialized services: the **`WaveformService`** and **`SpectrogramService`**. These services
  encapsulate the heavy computation required to generate peak and FFT data, respectively.

## 2. Infrastructure & Tooling:
* **Static Hosting First:** The application must be deployable on any static host without special headers, meaning *
  *no `SharedArrayBuffer` or threaded WASM**. This guarantees maximum portability and simplifies deployment.
* **Type-Safe Workers:** Communication with Web Workers will be managed by a robust, type-safe `WorkerChannel`
  utility that includes mandatory timeout handling and observability hooks.
* **Centralized Configuration:** All tunable parameters and constants are managed in a single `src/lib/config.ts`
  file to eliminate magic numbers and simplify reconfiguration.

## 3. User Experience & Workflow:
* **Structured Error Handling:** Errors are managed as structured objects in the `statusStore` and displayed to the
  user via non-blocking toast notifications, separating error state from core application state.
* **Storybook-First Development:** UI components must be fully developed and verified in Storybook, using the
  Context API for mock injection, before being integrated into the main application. This de-risks UI development
  and ensures components are robust and reusable.
* **URL-Only State Persistence:** The entire application session state (including loaded audio URL, playback time, and all parameters) **must** be serialized exclusively to the URL's query string for shareability. No state or user preferences are persisted locally via `localStorage` in this version. A strict two-tiered loading hierarchy (Application Defaults -> URL Parameters) ensures predictable state initialization on startup.