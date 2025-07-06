# Chapter 1: The Vision & Guiding Principles

## 1.1. Executive Summary

The primary objective for Vibe Player V3 is to construct an audio player and analysis tool that is:

* **Fundamentally Robust:** By enforcing strict boundaries between the UI, application services, and core business
  logic, preventing architectural decay. This is achieved through a Hexagonal Architecture and an event-driven
  communication model.
* **Completely Testable:** Through a multi-layered testing strategy including unit, integration, and end-to-end (E2E)
  tests. We will leverage Dependency Injection to make UI components perfectly testable in isolation.
* **Highly Maintainable:** By leveraging a modern, strongly-typed language (TypeScript), a reactive, component-based UI
  architecture (Svelte), and a centralized configuration system.
* **Performant:** Using a compiled UI framework (Svelte) and offloading all computationally intensive tasks to
  single-threaded Web Workers, ensuring a smooth and responsive user experience.
* **Offline-Capable & Installable:** Built as a Progressive Web App (PWA) that can be installed on user devices and run
  reliably without an internet connection.
*   **Stateless & Shareable via URL:** The entire application session state—including the loaded audio URL, playback time, and all analysis/playback parameters—**must** be serialized into the URL's query string. The application will be otherwise stateless, meaning reloading the page with the same URL will perfectly reproduce the exact session. This enables robust sharing and bookmarking of analysis contexts. **Note: User preferences are not persisted locally (e.g., via `localStorage`) in this version.**
*   **Feature Scope Note:** This version of Vibe Player focuses on core playback and analysis. Advanced playback features such as reverse playback and looping are not within the scope of this refactor and will not be implemented in V3.0. Dark mode, local storage for preferences, remote API calls for VAD or other analyses, etc will also be held off until after 3.0.

## 1.2. Architectural Principles & Design Constraints

This section outlines the non-negotiable rules and rationales that govern all development decisions for V3. The
developer must adhere to these constraints at all times.

* **Constraint 1: Absolute Static Hostability (No Special Headers)**
    * **Description:** The final `build/` output **must** consist purely of static files (`.html`, `.js`, `.css`, image
      assets, `.wasm`, `.onnx`, `.woff2`, etc.). This means the application **must** be deployable and function
      correctly from any simple static file server (e.g., GitHub Pages, `python -m http.server`) **without requiring any
      server-side configuration for special HTTP headers** (such as `Cross-Origin-Opener-Policy` or
      `Cross-Origin-Embedder-Policy`).
    * **Rationale:** This guarantees maximum portability, zero-friction deployment, and true offline capability for PWA.
    * **Implication:** This constraint explicitly forbids the use of `SharedArrayBuffer` and, consequently, any form of
      **threaded WebAssembly (WASM threads)**. All WASM-based libraries (like ONNX Runtime and Rubberband) **must** be
      configured and used in their single-threaded versions. Performance for parallelizable tasks will be achieved by
      using multiple, separate Web Workers, each performing its task independently.

* **Constraint 2: Minimal, Standard Build Step (Vite + SvelteKit)**
    * **Description:** The application will be built using SvelteKit with its `adapter-static`. The standard
      `npm run build` command will compile the TypeScript and Svelte components into a clean, optimized, and fully
      self-contained static `build/` directory.
    * **Rationale:** This provides robust, industry-standard dependency management, TypeScript transpilation, and PWA
      generation via a fast, well-documented tool. This approach eliminates the fragility and maintenance burden of
      custom build scripts.

* **Constraint 3: First-Class TypeScript & Svelte**
    * **Description:** All application logic (core services, adapters, utilities) will be written in **TypeScript** (
      `.ts` files). The user interface will be constructed using **Svelte components** (`.svelte` files, with
      `<script lang="ts">`).
    * **Rationale:** TypeScript provides superior, ergonomic type safety, compile-time error checking, and better
      tooling support. Svelte's compile-time framework approach results in minimal runtime overhead, small bundle sizes,
      and highly performant UI updates.

* **Constraint 4: Component-Driven UI with Dependency Injection & Storybook**
    * **Description:** The UI will be composed of small, single-purpose Svelte components. Services and stores will be
      provided to components via **Svelte's Context API (Dependency Injection)**, not via direct imports. All components
      **must** be developed and verified in isolation in **Storybook** before integration.
    * **Rationale:** Dependency Injection decouples UI components from concrete service implementations, making them
      highly portable and easy to test. The Storybook-first workflow ensures components are robust and handles all their
      states correctly before they enter the main application.

* **Constraint 5: V1 Logic is the "Golden Master" for Core Algorithms**
    * **Description:** For core signal processing and analysis algorithms (specifically VAD region calculation, DTMF/CPT
      parsing, and waveform peak generation), the V3 implementation **must** be functionally identical to the V1
      implementation. The V1 JavaScript code serves as the "golden master" reference.
    * **Rationale:** V1's algorithms are proven to work correctly. The initial goal of V3 is to fix the architecture and
      improve the development experience, not re-invent core processing. Characterization tests will be the arbiter of
      success.

* **Constraint 6: Future-Proofing for Remote VAD API**
    * **Description:** The architecture must be designed to allow the local, in-browser VAD processing to be easily
      replaced by an asynchronous HTTP call to a remote VAD API endpoint in the future.
    * **Rationale:** This provides flexibility. The Hexagonal Architecture addresses this by defining an
      `IInferenceEnginePort` that can be implemented by either a local Web Worker adapter or a remote `fetch`-based API
      adapter, with no changes required to the core `AnalysisService` logic.

* **Constraint 7: Main-Thread-Authoritative Timekeeping (for UI)**
    * **Description:** The application **must** implement a main-thread-authoritative timekeeping model to ensure a
      smooth UI. The UI's time display and seek bar will be driven by a `requestAnimationFrame` loop on the main thread,
      managed by the `AudioEngineService`.
    * **Rationale:** Audio processing worklets can have inherent latency and their time reporting can drift. Trusting
      the worklet's time for UI updates leads to a poor user experience. Synchronization with the audio engine will
      occur explicitly upon seek or parameter changes.

* **Constraint 8: Eager Asset Initialization**
    * **Description:** To optimize user experience, the application **should** pre-fetch and pre-initialize heavy
      assets (like WASM and ONNX models) at startup.
    * **Rationale:** This prevents race conditions and provides a more responsive feel, as the user does not have to
      wait for large assets to download *after* they have selected a file.

* **Constraint 9: Centralized & Typed Configuration**
    * **Description:** All tunable parameters, magic numbers, and environmental constants (e.g., VAD thresholds, FFT
      sizes, API keys) **must** be defined in a central `src/lib/config.ts` file. Modules must import configuration from
      this single source of truth.
    * **Rationale:** This eliminates hard-coded values scattered throughout the codebase, making the system transparent
      and easy to reconfigure or A/B test in the future.

* **Constraint 10: Decoupled Services via Event Emitter**
    * **Description:** Services **must not** call each other's methods directly. Communication between services will be
      handled by a **type-safe event emitter**. For example, the `AudioEngineService` will `emit('playbackEnded')`
      instead of calling a method on the orchestrator.
    * **Rationale:** This enforces a true Hexagonal Architecture where core services are completely decoupled from each
      other, improving maintainability and testability.

---

* **Principle 1: Clarity, Functionality, and Clean Design**
    * **Description:** The user interface design **must** prioritize clarity, information density, and functional
      utility. The goal is to create a powerful tool, not a purely aesthetic piece.
    * **Implication:** Developers should produce simple, functional Svelte components that render standard, accessible
      HTML. This avoids complex third-party UI libraries for core controls, ensuring full control and reliable E2E
      testability.

* **Principle 2: Human-Readable Keys and Constants**
    * **Description:** All string keys used for state serialization (e.g., URL query parameters) or internal messaging *
      *must** use full, descriptive, human-readable English words.
    * **Rationale:** This makes the system transparent and easy to debug. A URL like `?url=...&speed=1.5&time=30` is
      self-documenting. Obscure keys like `?s=1.5&t=30` are forbidden.
    * **Implication:** Constants should use `SCREAMING_SNAKE_CASE` (e.g., `URL_PARAM_SPEED`), and property keys should
      use `camelCase` (e.g., `speed`).

* **Principle 3: Stable Selectors for E2E Testing**
    * **Description:** All UI elements that are interactive (e.g., buttons, inputs) or that display dynamic data subject
      to assertions in tests (e.g., time displays, file names) **must** be assigned a unique `data-testid` attribute.
    * **Rationale:** This decouples automated tests from fragile implementation details like CSS class names or DOM
      structure. It creates a stable, explicit contract between the application's view and its test suite, dramatically
      increasing the reliability and maintainability of E2E tests.
    * **Implication:** Developers are required to add these attributes during component creation. E2E tests **must** use
      `getByTestId()` selectors as their primary method for locating elements.

* **Principle 4: End-to-End Traceability**
    * **Description:** All user-initiated operations **must** be traceable across services, event emitters, and workers.
      This is a non-negotiable requirement for debugging the decoupled architecture.
    * **Implication:** A unique `traceId` **must** be generated at the start of any new operation (e.g., loading a file,
      playing). This `traceId` must be propagated through all subsequent service calls, event payloads, and worker
      messages related to that operation. The full implementation contract is defined in **Appendix K**.