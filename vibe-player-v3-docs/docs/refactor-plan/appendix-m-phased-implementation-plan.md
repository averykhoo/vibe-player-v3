[//]: # ( vibe-player-v3/docs/refactor-plan/appendix-m-phased-implementation-plan.md )
# Appendix M: Phased Implementation & Validation Plan

This appendix outlines the official, sequential plan for executing the Vibe Player V3 refactor. Each phase builds upon the previous one, ensuring a stable and verifiable development process. Adherence to this phased plan is mandatory.

---

## Phase 0: Foundation & Tooling Setup

**Goal:** To establish a fully configured, clean project environment with all necessary tooling, quality gates, and architectural enforcement in place before any feature code is written.

### Milestone 0.1: Project Initialization
*   **Expectations:** A new SvelteKit project is created and all initial dependencies from the V2.3 `package.json` are installed.
*   **Validation:**
    *   The command `npm install` completes without errors.
    *   The command `npm run dev` starts the Vite server, and the default SvelteKit page is viewable in a browser.

### Milestone 0.2: Tooling Configuration
*   **Expectations:** Storybook, Vitest, Playwright, and ESLint are installed and configured.
*   **Validation:**
    *   `npm run storybook` launches the Storybook UI without errors.
    *   `npm run test` (Vitest) runs successfully, even if no tests are found.
    *   `npx playwright test` runs successfully, even if no tests are found.
    *   `npm run lint` runs without errors on the clean project skeleton.

### Milestone 0.3: Architectural Linting Rules
*   **Expectations:** The project's ESLint configuration is updated with `eslint-plugin-import` rules to enforce the Hexagonal Architecture boundaries as defined in **Chapter 6.2**.
*   **Validation:**
    *   Create a temporary test file in `src/lib/services` that attempts to `import` a UI component from `src/lib/components`.
    *   Confirm that `npm run lint` **fails** with an error about this forbidden import path.
    *   Delete the temporary file and confirm `npm run lint` passes again.

---

## Phase 1: Core Architectural Plumbing

**Goal:** To implement the foundational, non-feature-specific code that enables the entire V3 architecture.

### Milestone 1.1: Port Interface Definitions
*   **Expectations:** All Port interfaces (e.g., `IAudioEnginePort`, `IAnalysisPort`) are defined as TypeScript files in `src/lib/types/` as specified in **Chapter 2.3**.
*   **Validation:**
    *   The project successfully compiles (`svelte-check` passes).
    *   Code review confirms all specified interfaces exist in the correct location.

### Milestone 1.2: Core Utilities & Configuration
*   **Expectations:** The following core utilities are created and unit-tested:
    *   `src/lib/config.ts`: Central configuration.
    *   `src/lib/services/emitter.service.ts`: Type-safe event emitter.
    *   `src/lib/utils/workerChannel.ts`: Promise-based worker communication channel.
    *   `src/lib/utils/urlState.ts`: URL serialization utility.
    *   `src/lib/utils/trace.ts`: `traceId` generator.
*   **Validation:**
    *   Each utility has a corresponding `.test.ts` file in `tests/unit/`.
    *   Unit tests for these utilities achieve 100% statement and branch coverage.

### Milestone 1.3: Service & Store Skeletons
*   **Expectations:** All service classes (e.g., `AudioOrchestratorService`, `AudioEngineService`) are created, implementing their respective Port interfaces. Methods can be empty or throw a "Not Implemented" error. All Svelte stores are created with their initial states. The **`container.ts`** file is created.
*   **Validation:**
    *   The `src/lib/services/container.ts` file can instantiate all service skeletons, injecting mock dependencies where necessary, without any TypeScript errors.
    *   The application's root layout (`+layout.svelte`) successfully imports `serviceContainer` and provides each service to Svelte's context via `setContext` without any compilation errors.

---

## Phase 2: Core Service & Worker Implementation (TDD)

**Goal:** To build out the business logic of each core service and its associated Web Worker, driven by unit tests.

### Milestone 2.1: AudioEngineService & Rubberband WASM Loader
*   **Expectations:** The `AudioEngineService` is fully implemented. The legacy `rubberband-loader.js` is refactored into a modern ES Module as defined in **Appendix G.5**.
*   **Validation:**
    *   All unit tests for `AudioEngineService` and the new `loader.ts` pass.
    *   A Storybook story is created for a test component that receives the real `AudioEngineService` via context. The story demonstrates that it can successfully initialize the service and its worker, and that the service transitions to a "ready" state.

### Milestone 2.2: Analysis Services (VAD, DTMF, Spectrogram)
*   **Expectations:** The `AnalysisService`, `DtmfService`, `SpectrogramService`, and `WaveformService` are implemented, along with their corresponding Web Workers.
*   **Validation:**
    *   All unit tests for these services pass.
    *   This includes the **characterization tests**, which validate the output of the V3 algorithms against "golden master" test vectors from the V1 implementation.

---

## Phase 3: UI Component Development (Storybook-First)

**Goal:** To build and visually verify all UI components in isolation using Storybook.

### Milestone 3.1: Atomic UI Elements
*   **Expectations:** Custom, unstyled Svelte components for core controls like `<CustomRangeSlider>` and `<CustomButton>` are created.
*   **Validation:**
    *   Each component has a `.stories.ts` file.
    *   Stories exist to demonstrate all states, including default, `disabled`, and different value bindings.

### Milestone 3.2: Composite View Components
*   **Expectations:** Higher-level components like `FileLoader.svelte` and `Controls.svelte` are built using the atomic elements.
*   **Validation:**
    *   Each component has stories that provide mock services and stores via the Svelte Context API.
    *   Stories demonstrate that the components correctly render different states (e.g., `isPlayable`, `isLoading`) and dispatch the correct events.

### Milestone 3.3: Visualization Components
*   **Expectations:** The `Waveform.svelte` and `Spectrogram.svelte` components are created.
*   **Validation:**
    *   Stories exist that demonstrate the components can receive mock data from a context-provided service and render it correctly to a canvas.

---

## Phase 4: Integration & E2E Feature Validation

**Goal:** To assemble the tested services and components into a functional application and validate the complete user flows against the Gherkin specifications.

### Milestone 4.1: File Loading & Orchestration
*   **Expectations:** The `FileLoader` component is integrated into `+page.svelte`, and its events are wired to the `AudioOrchestratorService`.
*   **Validation:**
    *   All scenarios in `file_loading.feature` are automated in a Playwright test and **must pass**.

### Milestone 4.2: Playback Control Integration
*   **Expectations:** The `Controls.svelte` and seek slider components are integrated.
*   **Validation:**
    *   All scenarios in `playback_controls.feature` are automated and **must pass**.

### Milestone 4.3: Parameter Adjustment Integration
*   **Expectations:** The parameter sliders in `Controls.svelte` are wired up.
*   **Validation:**
    *   All scenarios in `parameter_adjustment.feature` are automated and **must pass**.

### Milestone 4.4: Analysis & Visualization Integration
*   **Expectations:** The analysis services are triggered after file load, and the visualization components are wired to receive real data.
*   **Validation:**
    *   All scenarios in `tone_analysis.feature` and `vad_analysis.feature` are automated and **must pass**.
    *   Manual verification confirms that the waveform and spectrogram canvases render correctly with real audio data.

### Milestone 4.5: URL State Integration
*   **Expectations:** The `urlState` utility is integrated with the orchestrator.
*   **Validation:**
    *   All scenarios in `url_state.feature` are automated and **must pass**.

---

## Phase 5: Finalization & Release Preparation

**Goal:** To add final PWA features, perform documentation updates, and prepare the application for a V3.0 release.

### Milestone 5.1: PWA Configuration
*   **Expectations:** A web app manifest and service worker are configured in `vite.config.ts` and `svelte.config.js` to make the application installable and offline-capable.
*   **Validation:**
    *   A Lighthouse audit in Chrome DevTools shows the app passes the "Installable" PWA check.

### Milestone 5.2: Final Documentation
*   **Expectations:** The project's root `README.md` is updated to reflect the new V3 architecture, features, and usage instructions.
*   **Validation:**
    *   Code review of the `README.md`.

### Milestone 5.3: V3.0 Release Candidate
*   **Expectations:** A final, clean build is produced. A `v3.0.0` Git tag is created.
*   **Validation:**
    *   All CI checks (lint, test, build, e2e) pass on the release commit.
    *   A final manual smoke test is performed on the production build output.

---

## Phase 6: Future Enhancements (Post-V3.0)

**Goal:** To document and scope major new features that can be built upon the stable V3.0 architecture.

### Milestone 6.1: Constant-Q Transform (CQT) Visualization
*   **Impetus:** The standard FFT-based spectrogram provides a linear view of frequency, which is useful for technical analysis. However, a **Constant-Q Transform (CQT)** provides a logarithmic frequency scale that more closely aligns with human pitch perception and musical notation. This would be a powerful enhancement for musical or tonal analysis.
*   **Chosen Technology:** The **`librosa-js`** NPM package has been identified as the ideal library for this task.
*   **Rationale:**
    *   It is a direct port of the industry-standard Python `librosa` library, ensuring the algorithm's correctness.
    *   It is a modern ES Module with TypeScript support, making it fully compliant with the V3 architecture and Vite build process.
    *   It is a reputable, community-vetted package.
*   **Implementation Plan:** This feature will be implemented by creating a new `CqtService` and a `cqt.worker.ts` that uses `librosa-js` to perform the CQT analysis. A new Svelte component, `CqtSpectrogram.svelte`, will be created to visualize the results.