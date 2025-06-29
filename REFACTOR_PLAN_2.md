[//]: # ( REFACTOR_PLAN.md )

# **Vibe Player V3: The Hexagonal Architecture Blueprint**

### **0. Context & Executive Summary: Building with Unwavering Precision**

This document outlines the complete architectural blueprint and detailed implementation strategy for Vibe Player V3. It represents a fundamental, ground-up redesign, moving beyond incremental fixes, driven by a rigorous analysis of past architectural failures and the explicit commitment to **AI/LLM-driven development**.

The primary objective for V3 is to construct an audio player and analysis tool that is:

*   **Fundamentally Robust and Predictable:** By enforcing strict boundaries, formal contracts, and unidirectional data flow, we will eliminate classes of bugs related to race conditions, inconsistent state, and fragile inter-module communication.
*   **Completely Testable and Verifiable:** Every piece of core application logic will be testable in isolation, detached from browser APIs and UI frameworks. This is paramount for AI agents, as automated tests become the primary validation mechanism.
*   **Decoupled and Maintainable:** Core business logic will be entirely separated from external technologies (UI, Web Workers, state stores), allowing independent evolution and technology swaps.
*   **Transparent and Debuggable:** Through formalized error handling, structured logging, and dedicated observability, AI agents will have the necessary feedback loops to self-diagnose and correct issues.
*   **Built in Pure JavaScript with Strict JSDoc:** To optimize for simplicity, control, and explicit type checking without a complex build toolchain. Robustness will be achieved through meticulous JSDoc annotations and a comprehensive static analysis suite.
*   **Behavior-Driven:** High-level behaviors will be defined in **Gherkin scenarios**, which serve as executable specifications for both AI implementation and automated end-to-end testing.
*   **Shareable via URL Hash:** The entire application state—including the loaded audio URL, playback time, and all parameters—will be serialized into the URL's **hash fragment (`#`)**, enabling users to share a link that perfectly reproduces their session.

This plan serves as the definitive source of truth for all AI agents tasked with V3 development. **Every instruction within this document is a mandatory directive.**

---

### **1. Architectural Principles & Design Constraints**

This section outlines the non-negotiable rules and rationales that govern all development decisions for V3. The AI agent must adhere to these constraints at all times.

*   **Constraint 1: 100% Client-Side Static Execution**
    *   **Description:** The application must run entirely in the browser from static files (`.html`, `.js`, `.css`, `.wasm`, `.onnx`). It **must not** have a server-side backend for its core logic.
    *   **Rationale:** This enables simple, free hosting on platforms like GitHub Pages, GitLab Pages, or via a basic `http-server`. It ensures portability and offline capability (once assets are cached).
    *   **Implication for AI:** The agent **must not** generate any code that assumes a Node.js environment (e.g., `fs`, `http.createServer`) or a dynamic server-side language for the application's core operation. All necessary assets must be fetched via standard browser `fetch` APIs.

*   **Constraint 2: Full Word Naming Convention**
    *   **Description:** All string keys used for state names, event names, command names, and type definitions **must** use full, descriptive English words.
    *   **Rationale:** "We don't pay per character." Clarity and self-documentation are paramount for both human and AI comprehension, reducing the risk of misinterpretation from ambiguous abbreviations.
    *   **Implication for AI:** The agent **must** use formats like `SCREAMING_SNAKE_CASE` for constants (e.g., `COMMAND_LOAD_AUDIO`, `EVENT_LOAD_SUCCESS`) and `camelCase` for other identifiers, avoiding short forms.

*   **Constraint 3: Future-Proofing for Remote VAD API**
    *   **Description:** The architecture must be designed to allow the local, in-browser VAD processing to be easily replaced by an asynchronous HTTP call to a remote VAD API endpoint in the future.
    *   **Rationale:** This provides flexibility. Local VAD is great for privacy and offline use, but a remote API could offer more powerful models or reduce client-side CPU load.
    *   **Implication for AI:** This is a key justification for the Hexagonal Architecture. The AI will implement a `VADHexagon` that depends on a port (`IInferenceEnginePort`). Initially, this port will be implemented by a `SileroVadAdapter` using the local `WorkerChannel`. In the future, a new `RemoteVadApiAdapter` can be created to implement the same port using `fetch`, with no changes required to the `VADHexagon` or the rest of the application. The UI must also be able to handle a generic "indeterminate" loading state for analysis, not just a granular progress bar.

---

### **2. The `AppHexagon` State Machine**

The `AppHexagon` orchestrates the application's primary lifecycle. Its state transitions are strictly defined to ensure predictable behavior.

#### **2.1. State Diagram**

```mermaid
stateDiagram-v2
    direction LR

    [*] --> IDLE
    IDLE --> LOADING: COMMAND_LOAD_AUDIO

    LOADING --> READY: EVENT_LOAD_SUCCESS
    LOADING --> ERROR: EVENT_LOAD_FAILURE

    READY --> PLAYING: COMMAND_PLAY
    READY --> SEEK_AND_HOLD: COMMAND_BEGIN_SEEK
    READY --> LOADING: COMMAND_LOAD_AUDIO

    PLAYING --> READY: COMMAND_PAUSE
    PLAYING --> READY: EVENT_PLAYBACK_ENDED
    PLAYING --> SEEK_AND_RESUME: COMMAND_BEGIN_SEEK
    PLAYING --> LOADING: COMMAND_LOAD_AUDIO
    PLAYING --> ERROR: EVENT_PLAYBACK_FAILURE

    SEEK_AND_RESUME --> PLAYING: COMMAND_END_SEEK
    SEEK_AND_RESUME --> SEEK_AND_HOLD: COMMAND_PAUSE

    SEEK_AND_HOLD --> READY: COMMAND_END_SEEK
    SEEK_AND_HOLD --> SEEK_AND_RESUME: COMMAND_PLAY

    ERROR --> LOADING: COMMAND_LOAD_AUDIO

    note for READY
      State: Audio is loaded, playable, and paused.
      (Covers both initial "ready" and subsequent "paused" conditions.)
    end note

    note for SEEK_AND_RESUME
        State: Paused for seeking.
        Intent: Resume playback after seek.
    end note

    note for SEEK_AND_HOLD
        State: Paused for seeking.
        Intent: Remain paused (in READY state) after seek.
    end note
```

#### **2.2. State Definition Table**

This table provides the granular detail an AI agent needs to implement the state machine correctly.


| State Item                           | Owning Hexagon       | Location in Store                       | Description                                                                                                                                                   |
| :----------------------------------- | :--------------------- | :---------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status` (`loading`, `ready`, etc.)  | `AppHexagon`         | `statusStore`                           | The single source of truth for the application's overall state.                                                                                               |
| `error`                              | `AppHexagon`         | `statusStore`                           | The global error message, if any.                                                                                                                             |
| `fileName`, `duration`, `isPlayable`, `sourceUrl` | `AppHexagon`         | `playerStore`                           | High-level metadata about the loaded audio, managed by the orchestrator.                                                                                      |
| `isPlaying`                          | `PlaybackHexagon`    | `playerStore`                           | The canonical boolean playback state.                                                                                                                         |
| `currentTime`                        | `PlaybackHexagon`    | `timeStore` (Hot), `playerStore` (Cold) | The canonical playback time. Updated on the "hot path" by the `WebAudioAdapter` for UI, and synced on the "cold path" by the `PlaybackHexagon` on pause/seek. |
| `speed`, `pitchShift`, `gain`        | `PlaybackHexagon`    | `playerStore`                           | Playback manipulation parameters.                                                                                                                             |
| `isSeeking`, `wasPlayingBeforeSeek`  | `AppHexagon`         | *Internal to `AppHexagon`*              | Ephemeral UI state for managing the seek interaction. **Not published to the store.**                                                                       |
| `vadProbabilities`                   | `VADHexagon`         | *Internal to `VADHexagon`*              | The raw frame-by-frame speech probabilities. **Not published to the store.**                                                                                  |
| `hasVadProbabilities`                | `VADHexagon`         | `analysisStore`                         | A boolean flag indicating that the probability data is available for retrieval via accessor.                                                                  |
| `vadRegions`                         | `VADHexagon`         | `analysisStore`                         | The calculated speech time segments, derived from `vadProbabilities` and the current thresholds.                                                              |
| `vadPositiveThreshold`, etc.         | `VADHexagon`         | `analysisStore`                         | The tuning parameters for VAD region calculation.                                                                                                             |
| `dtmfResults`                        | `DTMFHexagon`        | `dtmfStore`                             | The list of detected DTMF tones.                                                                                                                              |
| `spectrogramData`                    | `SpectrogramHexagon` | *Internal to `SpectrogramHexagon`*      | The calculated spectrogram data. **Not published to the store.**                                                                                              |
| `hasSpectrogramData`                 | `SpectrogramHexagon` | `analysisStore`                         | A boolean flag indicating spectrogram data is available for retrieval via accessor.                                                                           |
| `waveformData`                       | `WaveformHexagon`    | `playerStore`                           | The calculated peak data for waveform visualization.                                                                                                          |



---

### **3. Detailed State Management & Data Flow**

This section defines the strict rules for state ownership and data flow in V3.

#### **3.1. Core Principles**

*   **Unidirectional Data Flow:** Data flows in one direction: Driving Adapters (UI) -> `AppHexagon` (commands) -> Domain Hexagons (logic) -> Driven Adapters (effects, e.g., worker calls, store updates). Updates then flow back (Driven Adapters -> Store -> Driving UI Adapter).
*   **State Store as a Write-Only Bus:** The centralized "State Store" (a collection of plain JavaScript objects with a pub/sub mechanism) is a **Driven Adapter**, not a Hexagon. Hexagons **drive** the `StateStoreAdapter` to write state; they do not read from it.
*   **Command vs. Event Pattern:**
    *   **Commands (Input):** Originate from a **Driving Adapter** (e.g., `uiManager.js`) or the `AppHexagon`. They are requests for the application to *do something* (e.g., `COMMAND_PLAY`, `COMMAND_SEEK`).
    *   **Events (Output):** Originate from a **Driven Adapter** (e.g., `WebAudioAdapter`). They are notifications that a *system event has occurred* (e.g., `EVENT_PLAYBACK_ENDED`, `EVENT_WORKER_CRASHED`).
*   **`AppHexagon` as Transactional Authority:** The `AppHexagon` is the sole authority for all major state transitions. It receives events, consults its current status, and issues explicit commands back down to the domain hexagons to update the canonical state.
*   **URL State Management (via Hash Fragment):**
    *   The **`AppHexagon`** is responsible for both reading and writing the application state to the URL.
    *   **On Initialization:** It drives a `URLStateAdapter` to parse `window.location.hash`. If a state is present, the `AppHexagon` issues commands to other hexagons to apply that state. If a `url` parameter exists in the hash, it triggers the file loading flow.
    *   **On State Change:** It is driven by the state store. On changes to key parameters, a debounced call to the `URLStateAdapter` is made, which serializes the current state into the hash fragment using `history.replaceState`.
*   **Controlled Exception: The "Hot Path"**
    *   **What:** For high-frequency UI updates like the seek bar's position during playback, the `WebAudioAdapter` runs a `requestAnimationFrame` loop. Inside this loop, it calculates the estimated time and writes **directly** to a dedicated, lightweight UI store (`timeStore`).
    *   **Why:** This is a deliberate, controlled exception to achieve smooth 60fps UI updates without burdening the core application logic with `rAF` loops.
    *   **Limitations:** This is the *only* such exception. The `timeStore` is treated as a read-only sink for UI display purposes and does not trigger core application logic.
*   **Large Data Handling Protocol:** To maintain UI performance, large, static data payloads (like the `vadProbabilities` array) are **not** stored in reactive state stores. The owning hexagon (`VADHexagon`) holds the data internally. The state store will only hold a boolean flag (e.g., `hasVadProbabilities: true`), signaling to the UI that it can now call a synchronous accessor method on the hexagon's port (e.g., `VADHexagon.getProbabilityData()`) to retrieve the data for rendering.

#### **3.2. State Ownership & Pathways**

(This table remains unchanged from the previous version, as the state ownership logic is sound.)

| State Item                           | Owning Hexagon       | Location in Store                       | Description                                                                                                                                                   |
|:-------------------------------------|:---------------------|:----------------------------------------|:--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `status` (`loading`, `ready`, etc.)  | `AppHexagon`         | `statusStore`                           | The single source of truth for the application's overall state.                                                                                               |
| `error`                              | `AppHexagon`         | `statusStore`                           | The global error message, if any.                                                                                                                             |
| `fileName`, `duration`, `isPlayable`, `sourceUrl` | `AppHexagon`         | `playerStore`                           | High-level metadata about the loaded audio, managed by the orchestrator.                                                                                      |
| `isPlaying`, `isLooping`             | `PlaybackHexagon`    | `playerStore`                           | The canonical boolean playback state.                                                                                                                         |
| `currentTime`                        | `PlaybackHexagon`    | `timeStore` (Hot), `playerStore` (Cold) | The canonical playback time. Updated on the "hot path" by the `WebAudioAdapter` for UI, and synced on the "cold path" by the `PlaybackHexagon` on pause/seek. |
| `speed`, `pitchShift`, `gain`        | `PlaybackHexagon`    | `playerStore`                           | Playback manipulation parameters.                                                                                                                             |
| `isSeeking`, `wasPlayingBeforeSeek`  | `AppHexagon`         | *Internal to `AppHexagon`*              | Ephemeral UI state for managing the seek interaction. **Not published to the store.**                                                                       |
| `vadProbabilities`                   | `VADHexagon`         | *Internal to `VADHexagon`*              | The raw frame-by-frame speech probabilities. **Not published to the store.**                                                                                  |
| `hasVadProbabilities`                | `VADHexagon`         | `analysisStore`                         | A boolean flag indicating that the probability data is available for retrieval via accessor.                                                                  |
| `vadRegions`                         | `VADHexagon`         | `analysisStore`                         | The calculated speech time segments, derived from `vadProbabilities` and the current thresholds.                                                              |
| `vadPositiveThreshold`, etc.         | `VADHexagon`         | `analysisStore`                         | The tuning parameters for VAD region calculation.                                                                                                             |
| `dtmfResults`                        | `DTMFHexagon`        | `dtmfStore`                             | The list of detected DTMF tones.                                                                                                                              |
| `spectrogramData`                    | `SpectrogramHexagon` | *Internal to `SpectrogramHexagon`*      | The calculated spectrogram data. **Not published to the store.**                                                                                              |
| `hasSpectrogramData`                 | `SpectrogramHexagon` | `analysisStore`                         | A boolean flag indicating spectrogram data is available for retrieval via accessor.                                                                           |
| `waveformData`                       | `WaveformHexagon`    | `playerStore`                           | The calculated peak data for waveform visualization.                                                                                                          |

---

### **4. V3 Implementation Strategy & Process for AI Agents**

This section details the practical, step-by-step process for AI agents to develop Vibe Player V3. It translates the architectural goals and quality assurances into an actionable workflow.

#### **4.1. Guiding Principles for AI Agent Development**

*   **Inside-Out Development:** The AI agent **must** build the application from its pure business logic core (the Hexagons) outwards towards the browser-specific technologies (the Adapters and UI). The AI agent **must explicitly avoid** a "GUI-first" approach. Core logic **must** be proven correct before any UI is assembled.
*   **Test-Driven Development (TDD):** Every new piece of logic **must** begin with a test (unit or integration) that defines its requirements. Code **must** only be written to make a failing test pass. For refactoring existing logic from V1, this **must** take the form of **Characterization Testing**.
*   **Early & Continuous Integration:** The CI/CD pipeline and its automated quality gates are foundational. The AI agent **must** ensure every commit is validated against strict standards for type safety, code quality, architectural integrity, and documentation.
*   **Gherkin-Driven Behavior:** For all user-facing features, the AI agent **must** refer to Gherkin scenarios as the source of truth for desired behavior.
*   **Strict Adherence to `CONTRIBUTING-LLM.md`:** All directives within `CONTRIBUTING-LLM.md` and **Appendix A** of this document **must be followed rigorously**.

#### **4.2. Phase 1: Project Foundation & CI Setup (The First Commit)**

1.  **Initialize Project Structure:**
    *   The AI agent **must** create the `vibe-player-v3/` project directory as a **completely new, clean Pure JavaScript project**. This is not an in-place refactor of `vibe-player-v2.3/`.
    *   The AI agent **must** initialize `package.json` with `npm init -y` and install development dependencies (Vitest, Playwright, Biome, `dependency-cruiser`, `cucumber`, etc.).
    *   The AI agent **must** create the source directory structure as outlined in **Appendix B**.
2.  **Configure Core Tooling (Strictly):**
    *   **`jsconfig.json`:** Configure for strict JSDoc type checking (`"strict": true`, `"checkJs": true`, `"noEmit": true`, `"lib": ["es2017", "dom", "webworker"]`).
    *   **`biome.json`:** Configure with a strict set of linting and formatting rules.
    *   **`.dependency-cruiser.js`:** Configure to enforce the Hexagonal Architecture rules defined in the testing strategy.
    *   **`cucumber.js`:** Configure to work with Playwright for running `.feature` files.
    *   **Component Isolation Tool:** Set up a simple "Component Explorer" (e.g., using HTML files in `harnesses/`) for isolated UI development.
3.  **Implement CI/CD Workflows:**
    *   The AI agent **must** create initial GitHub Actions workflows (`ci.yml`, `e2e.yml`, CodeQL, SonarCloud).
    *   The `ci.yml` workflow **must** be configured to run all static analysis checks and unit/integration tests on every pull request.
    *   The `e2e.yml` workflow **must** be configured to run the Playwright/Cucumber.js E2E suite.
4.  **First Commit:** The AI agent **must** commit this foundational setup to the `main` branch, ensuring a "green" build on an empty but fully configured project.

#### **4.3. Phase 2: The Core Development Loop (Iterative AI Process)**

1.  **Task Assignment:** A human (or higher-level AI) assigns a feature task (e.g., "Implement PlaybackHexagon and its `IAudioOutputPort` via `WebAudioAdapter`").
2.  **Gherkin Review (Mandatory for Features):**
    *   The AI agent **must** review the relevant Gherkin scenarios in `tests/features/` that describe the desired external behavior for the task.
    *   If no relevant Gherkin scenario exists, the AI agent **must halt** and **propose a new Gherkin scenario** for human review and approval.
3.  **Characterization Test (If Applicable):**
    *   If refactoring a feature from V1 (e.g., VAD region calculation, waveform generation), the AI agent **must first generate a "test vector" JSON file** by running the pure logic from the V1 codebase with curated inputs and saving exact outputs. These vectors are the "golden master" standard and are checked into `tests/characterization_vectors/`.
4.  **Hexagon Implementation (TDD with JSDoc):**
    *   The AI agent **must** create a new `*.test.js` file for the V3 Hexagon (e.g., `PlaybackService.test.js`).
    *   The AI agent **must** write a test that initially fails, defining the Hexagon's behavior (or loads the JSON vector for characterization tests).
    *   The AI agent **must** implement the pure logic inside the Hexagon file (`src/lib/hexagons/`, e.g., `PlaybackService.js`) until the unit test passes. **No browser APIs or platform-specific code are allowed in this step.** All code **must** be fully JSDoc-typed.
5.  **Adapter Implementation (Driving & Driven):**
    *   Once a Hexagon's core logic is stable, the AI agent **must** implement its associated Adapters (e.g., `WebAudioAdapter.js` for `PlaybackService`).
    *   This involves interacting with browser APIs (Web Audio, DOM) or `WorkerChannel`.
    *   All Adapter code **must** be fully JSDoc-typed and adhere to strict linting rules.

#### **4.4. Phase 3: Final Application Assembly & E2E Testing**

1.  **Application Integration (`src/app.js` and `src/main.js`):**
    *   The AI agent **must** implement `src/app.js` as the `AppHexagon` orchestrator. Its role is to perform dependency injection: instantiate all Hexagons and Adapters, plug them into each other, and wire up the final UI event listeners (from `uiManager`).
    *   The `src/main.js` will be the initial entry point, responsible for initializing the `uiManager` and the `AppHexagon`.
2.  **E2E Testing (CI Only):**
    *   The AI agent **must** run the full Playwright E2E test suite (driven by Cucumber.js) against a production build in the CI pipeline to simulate user flows defined in Gherkin (`.feature` files).
    *   For `<canvas>`-based visualizations, the AI agent **must** use Playwright's `toHaveScreenshot` capability in the E2E suite to automatically detect if code changes unintentionally altered their graphical output. This is a mandatory check.

#### **4.5. Phase 4: Documentation & Handover**

1.  **Update Project Documentation:**
    *   Upon completion, the AI agent **must** update the root `README.md` to reflect the new V3 architecture and setup.
    *   The `REFACTOR_PLAN.md` and related appendices **must be moved** to a `docs/` directory to preserve the project's history.
    *   The old `vibe-player` (V1) and `vibe-player-v2.3` directories **must be archived or removed** to ensure `vibe-player-v3` is the sole, definitive codebase.
2.  **Final Quality Review:** The AI agent **must** perform a final review of the SonarCloud dashboard to identify and address any remaining high-priority issues before the official V3 release.

---
**APPENDICES**
---

### **Appendix A: AI Agent Collaboration Guidelines & Operational Instructions**

(This appendix integrates the `CONTRIBUTING-LLM.md` file and adds our new development principles.)

*   **P0: Agent Autonomy & Minimized Interaction:** The agent should operate with a high degree of autonomy once a task and its objectives are clearly defined. Default to making reasonable, well-documented decisions to keep work flowing.
*   **P1: Task-Driven Workflow & Initial Confirmation:** Complex tasks require an initial proposal and user confirmation before full implementation.
*   **P2: Clarity & Explicit Communication:** Proactively seek clarification for ambiguous tasks. Explain all changes and their rationale in a structured manner (e.g., commit messages).
*   **P3: Maintainability & Consistency:**
    *   **P3.1:** Strictly adhere to the V3 architectural patterns defined in this document.
    *   **P3.2:** Generate high-quality JSDoc comments for all public functions, classes, and types. Preserve existing meaningful comments.
    *   **P3.4 & P3.5:** All full files must include file identification comments at the start and end. Use section headers for long files.
*   **P4: Guideline Adherence & Conflict Reporting:** The agent must report if its knowledge suggests a guideline is suboptimal for a task, and must report any direct conflicts between user instructions and established guidelines, seeking explicit direction.
*   **P5: Full Word Naming Convention:** All string keys for states, events, commands, and types must use full, descriptive English words in `SCREAMING_SNAKE_CASE` for constants and `camelCase` for other identifiers.
*   **P6: README Generation Requirement:** The main `README.md` must contain a reference to this collaboration guide.
*   **P7: Branch-Based Code Submission:** The agent must submit all work by committing to feature branches and pushing to the remote repository.
*   **P8: Gherkin-Driven Implementation and Testing:**
    *   When implementing a new feature, the agent **must** consult the relevant Gherkin scenarios (`tests/features/*.feature`) to understand the desired external behavior.
    *   The agent **must** ensure that its generated code passes the automated E2E tests derived from these Gherkin scenarios.
    *   If no relevant Gherkin scenario exists for a new feature, the agent **must first propose a new Gherkin scenario** for human review and approval before proceeding with implementation.

---

### **Appendix B: Detailed Folder Structure**

```
vibe-player-v3/
├── .github/                           # CI/CD Workflows
│   └── workflows/
│       ├── ci.yml                     # Main CI (static analysis, unit/integration tests)
│       └── e2e.yml                    # E2E & Visual Regression Tests (Gherkin-driven)
├── docs/                              # Project history and detailed explanations
│   └── architecture/
├── src/                               # Main application source code (Pure JS + JSDoc)
│   ├── lib/
│   │   ├── hexagons/                  # Pure Business Logic Modules (Hexagons)
│   │   ├── adapters/                  # Technology-Specific Code (Driven & Driving)
│   │   ├── infrastructure/            # Core Infrastructure Utilities
│   │   ├── stores/                    # Central Application State
│   │   ├── types/                     # JSDoc @typedefs
│   │   └── utils/                     # General Utilities
│   ├── workers/                       # Actual Web Worker scripts
│   └── main.js                        # Main application entry point
├── public/                            # Static assets (copied directly to build output)
│   ├── lib/                           # Third-party JS/WASM
│   ├── models/
│   ├── css/
│   ├── fonts/
│   └── index.html                     # Main application HTML file
├── tests/                             # All test code
│   ├── unit/                          # Unit tests
│   ├── integration/                   # Integration tests
│   ├── e2e/                           # End-to-End Tests (Gherkin-driven, Playwright)
│   │   ├── features/                  # Gherkin .feature files
│   │   ├── step_definitions/          # JavaScript files mapping Gherkin steps to Playwright
│   │   └── page_objects/              # Playwright Page Object Models
│   └── characterization_vectors/      # JSON files capturing V1 behavior
├── CONTRIBUTING-LLM.md                # AI Agent Collaboration Guidelines
├── package.json                       # Project dependencies and scripts
└── ... (config files: jsconfig.json, biome.json, cucumber.js, etc.)
```
---

### **Appendix C: Gherkin Feature Specifications**

This appendix contains the executable specifications that define the application's behavior. The AI agent **must** ensure the implemented code passes tests derived from these scenarios.

#### **File: `tests/features/file_loading.feature`**

```gherkin
Feature: File Loading
  As a user, I want to load audio files from my computer or a URL
  so that I can analyze and play them in the application.

  Background:
    Given the user is on the main application page

  Scenario: Successfully loading a local audio file
    When the user selects the valid audio file "test-audio/IELTS13-Tests1-4CD1Track_01.mp3"
    Then the file name display should show "IELTS13-Tests1-4CD1Track_01.mp3"
    And the player controls should be enabled
    And the time display should show a duration greater than "0:00"

  Scenario: Attempting to load an unsupported local file type
    When the user selects the invalid file "README.md"
    Then an error message "Invalid file type" should be displayed
    And the player controls should remain disabled

  Scenario: Loading a new file while another is already loaded
    Given the audio file "test-audio/IELTS13-Tests1-4CD1Track_01.mp3" is loaded and ready
    When the user selects the new valid audio file "test-audio/dtmf-123A456B789C(star)0(hex)D.mp3"
    Then the file name display should show "dtmf-123A456B789C(star)0(hex)D.mp3"
    And the player state should be fully reset for the new file
    And the time display should show the duration of the new file
```

#### **File: `tests/features/playback_controls.feature`**

```gherkin
Feature: Playback Controls
  As a user with a loaded audio file, I want to control its playback
  by playing, pausing, stopping, seeking, and jumping through the audio.

  Background:
    Given the audio file "test-audio/Michael Jackson - Bad.mp3" is loaded and the player is ready

  Scenario: Play, Pause, and Resume functionality
    Given the player is paused at "0:00"
    When the user clicks the "Play" button
    Then the "Play" button's text should change to "Pause"
    And after "2" seconds, the current time should be greater than "0:01"
    When the user clicks the "Pause" button
    Then the "Pause" button's text should change to "Play"
    And the current time should stop advancing

  Scenario: Stopping playback
    Given the audio is playing and the current time is "0:15"
    When the user clicks the "Stop" button
    Then the current time should be "0:00"
    And the "Pause" button's text should change to "Play"
    And the player should be paused

  Scenario: Seeking with the progress bar
    When the user drags the seek bar handle to the 50% position
    Then the current time should be approximately half of the total duration

  Scenario Outline: Jumping forwards and backwards
    Given the current time is "0:10"
    When the user jumps <direction> by "5" seconds
    Then the current time should be "<new_time>"

    Examples:
      | direction  | new_time |
      | "forward"  | "0:15"   |
      | "backward" | "0:05"   |
```

#### **File: `tests/features/parameter_adjustment.feature`**

```gherkin
Feature: Playback Parameter Adjustment
  As a user, I want to adjust playback parameters like speed, pitch, and gain
  to change how the audio sounds in real-time.

  Background:
    Given the audio file "test-audio/LearningEnglishConversations-20250325-TheEnglishWeSpeakTwistSomeonesArm.mp3" is loaded and the player is ready

  Scenario Outline: Adjusting a playback parameter slider
    When the user sets the "<Parameter>" slider to "<Value>"
    Then the "<Parameter>" value display should show "<Display>"
    And the audio playback characteristics should reflect the new "<Parameter>" setting

    Examples:
      | Parameter | Value | Display    |
      | "Speed"   | "1.5" | "1.50x"    |
      | "Pitch"   | "1.2" | "1.20x"    |
      | "Gain"    | "2.0" | "2.00x"    |

  Scenario: Resetting parameters to default
    Given the "Speed" slider is at "1.5"
    And the "Pitch" slider is at "0.8"
    When the user clicks the "Reset Controls" button
    Then the "Speed" slider should be at "1.0"
    And the "Pitch" slider should be at "1.0"
    And the "Gain" slider should be at "1.0"
```

#### **File: `tests/features/vad_analysis.feature`**

```gherkin
Feature: Voice Activity Detection (VAD)
  As a user, I want the application to automatically detect speech in an audio file
  and allow me to tune the detection parameters.

  Background:
    Given the audio file "test-audio/IELTS13-Tests1-4CD1Track_01.mp3" is loaded and the player is ready

  Scenario: VAD highlights appear automatically after analysis
    Then the VAD progress bar should appear and complete within "15" seconds
    And the waveform should display one or more speech regions highlighted in yellow

  Scenario: Tuning VAD thresholds updates highlights in real-time
    Given the VAD analysis is complete and highlights are visible
    When the user sets the "VAD Positive Threshold" slider to a very high value of "0.95"
    Then the number of highlighted speech regions on the waveform should decrease or become zero
    When the user sets the "VAD Positive Threshold" slider to a very low value of "0.20"
    Then the number of highlighted speech regions on the waveform should increase
```

#### **File: `tests/features/tone_analysis.feature`**

```gherkin
Feature: Tone Detection
  As a user analyzing call audio, I want the application to detect and display
  standard DTMF and Call Progress Tones.

  Scenario: DTMF tones are detected and displayed correctly
    Given the audio file "test-audio/dtmf-123A456B789C(star)0(hex)D.mp3" is loaded and the player is ready
    Then the DTMF display should eventually contain the sequence "1, 2, 3, A, 4, 5, 6, B, 7, 8, 9, C, *, 0, #, D"

  Scenario: CPT (Busy Tone) is detected and displayed
    Given the audio file "test-audio/Dial DTMF sound _Busy Tone_ (480Hz+620Hz) [OnlineSound.net].mp3" is loaded and the player is ready
    Then the CPT display should eventually contain "Busy Signal"
```

#### **File: `tests/features/url_hash_state.feature`**

```gherkin
Feature: URL Hash Fragment State Management
  As a user, I want to share a link to the player that includes my exact session state,
  and have the application automatically load and apply that state from the URL hash.

  Background:
    Given the application has fully initialized

  Scenario: Application state is serialized to the URL hash fragment
    Given the audio file "test-audio/Michael Jackson - Bad.mp3" is loaded and ready
    When the user sets the "Speed" slider to "1.5"
    And the user sets the "VAD Positive Threshold" slider to "0.8"
    And the user seeks to "0:45" and then pauses playback
    Then the browser URL's hash fragment should contain "speed=1.50"
    And the browser URL's hash fragment should contain "vadPositive=0.80"
    And the browser URL's hash fragment should contain "time=45.00"

  Scenario: Loading an audio file from a URL parameter in the hash fragment
    Given the user navigates to the application with the hash fragment "#url=http://example.com/audio.mp3"
    When the application finishes loading the audio from the URL
    Then the file name display should show "http://example.com/audio.mp3"
    And the player controls should be enabled

  Scenario: Loading a full session state from the hash fragment on startup
    Given the user navigates to the application with the hash fragment "#url=http://example.com/audio.mp3&speed=0.75&pitch=0.90&time=15.00"
    When the application finishes loading the audio from the URL
    Then the "Speed" value display should show "0.75x"
    And the "Pitch" value display should show "0.90x"
    And the current time should be approximately "0:15"

  Scenario: Hash fragment is cleared when loading a new local file
    Given the user is on a page with the hash fragment "#speed=1.50&time=20.00"
    When the user selects the new local audio file "test-audio/IELTS13-Tests1-4CD1Track_01.mp3"
    Then the browser URL's hash fragment should be cleared or only contain the new file's information
```