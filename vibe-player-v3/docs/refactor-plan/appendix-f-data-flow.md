[//]: # ( vibe-player-v3/docs/refactor-plan/appendix-f-data-flow.md )
# Appendix F: Core Data Flow & State Management Principles

This appendix formalizes the data flow principles that govern how services, stores, and the UI interact.

## F.1. Event-Driven & Unidirectional Data Flow

Data and commands flow in a predictable, unidirectional manner:

1.  **User Interaction -> UI Event:** A user interacts with a Svelte component, which emits a type-safe event to the `appEmitter`.
2.  **Orchestrator Reaction -> Service Command:** The `AudioOrchestratorService` listens for UI events and orchestrates the response. It issues a direct command by calling a method on the appropriate service's injected interface (e.g., `this.audioEnginePort.play()`).
3.  **Service Logic -> Store Update:** The service executes its business logic and updates one or more Svelte stores with the new state.
4.  **Store Notification -> UI Reaction:** Svelte's reactivity automatically notifies subscribed UI components, which re-render to reflect the new state.
5.  **Service-to-Service Communication (Events):** When a service needs to notify the application that something has happened (e.g., playback ended), it emits an event. The `AudioOrchestratorService` is the primary listener for these events. This preserves decoupling, as the emitting service has no knowledge of the consumers.

## F.2. Controlled Exception: The "Hot Path"

* **What:** For the high-frequency `currentTime` update during playback, the `AudioEngineService` runs a
  `requestAnimationFrame` loop and writes **directly** to the dedicated `timeStore` (a Svelte `writable` store).
* **Why:** This is a deliberate exception to achieve smooth, 60fps UI updates for the seek bar and time display.
* **Limitations:** This is the *only* such exception. The `timeStore` is for display purposes only. Changes to it **must
  not** trigger any other application logic.

## F.3. Strict Large Data Handling Protocol

To maintain performance, the following protocol for large, static binary data is mandatory:

1. **No Stores:** Large data payloads **must not** be placed in any Svelte store.
2. **Exclusive Ownership:** Each large data object has a single, exclusive owner.
    * The **`AudioBuffer`** is owned exclusively by the **`AudioEngineService`**.
    * The **VAD Probability Array** is owned exclusively by the **`AnalysisService`**.
3. **Data on Request:** When another service needs access to this data (e.g., the `AnalysisService` needing the
   `AudioBuffer`), it must request it from the owner service.
4. **Readiness Flags:** Services publish simple boolean flags to the stores to indicate data readiness (e.g.,
   `playerStore.update(s => ({ ...s, isPlayable: true }))`). UI components react to these flags to enable functionality.