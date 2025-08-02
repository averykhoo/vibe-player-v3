[//]: # ( vibe-player-v3-docs/docs/refactor-plan/chapter-2-components-and-structure.md )
# Chapter 2: Core Components & Folder Structure

## 2.1. Overall Repository Structure

```
.
├── .github/                      # GitHub Actions CI/CD workflows
├── .storybook/                   # Storybook configuration and setup
├── build/                        # **STATIC PRODUCTION BUILD OUTPUT** (deployable)
├── src/                          # Main application source code
│   ├── lib/
│   │   ├── components/           # Svelte UI Components
│   │   │   ├── _ui/              # Small, highly reusable, generic UI elements (atoms)
│   │   │   ├── feedback/         # Components for user feedback (toasts, spinners)
│   │   │   ├── layout/           # Major page structure components
│   │   │   ├── views/            # Composite components for specific features
│   │   │   └── visualizations/   # Complex canvas-based visualization components
│   │   ├── services/             # Pure Business Logic Modules (Hexagons) (.ts)
│   │   ├── adapters/             # Technology-Specific Code (Driven & Driving Adapters) (.ts)
│   │   ├── stores/               # Central Application State (Svelte Stores) (.ts)
│   │   ├── types/                # TypeScript Interfaces and Type Definitions (Ports) (.ts)
│   │   ├── utils/                # General Utilities and Helpers (.ts)
│   │   ├── workers/              # Web Worker scripts (.ts)
│   │   └── config.ts             # Central application configuration
│   ├── routes/                   # SvelteKit page routes (e.g., +page.svelte)
│   ├── app.html                  # SvelteKit main HTML template
│   └── app.css                   # Global CSS styles
├── static/                       # Static assets (copied directly to build output)
│   └── ... (favicon, models, vendor libraries)
├── tests/                        # All test code
│   ├── e2e/                      # End-to-End Tests (Playwright, Gherkin-driven)
│   │   └── features/             # Gherkin .feature files (Behavioral Specifications)
│   ├── unit/                     # Vitest Unit and Integration Tests
│   └── characterization_vectors/ # JSON files capturing V1 behavior for testing
├── svelte.config.js              # SvelteKit configuration
├── vite.config.ts                # Vite build tool configuration
├── tsconfig.json                 # TypeScript configuration
└── package.json                  # Project dependencies and scripts
```

## 2.2. Key Hexagons (Services) and Their Responsibilities

All services are implemented as **Singleton TypeScript Classes**. They are instantiated once at the application root and
provided to the UI via Svelte's Context API.

* **`appEmitter` (`src/lib/services/emitter.service.ts`)**
    * **Role:** The application's central nervous system. A type-safe event bus for inter-service communication.
    * **Responsibility:** To decouple services from one another. Services emit events to the bus, and other services
      subscribe to those events.

* **`AudioOrchestratorService` (`src/lib/services/audioOrchestrator.service.ts`)**
    * **Role:** The central application coordinator.
    * **Responsibility:** Listens for events from the UI and other services. Manages the overall application state
      machine (see Chapter 4). Dispatches commands to other services based on state transitions. Manages global error
      state. **It does not contain any business logic itself.**
    * **Key State:** `status` (overall app state), `fileName`, `duration`, `isPlayable`, `sourceUrl`.

* **`AudioEngineService` (`src/lib/services/audioEngine.service.ts`)**
    * **Role:** The core playback engine (the PlaybackHexagon), implementing the `IAudioEnginePort`.
    * **Responsibility:** Manages the Web Audio API. Communicates with the `rubberband.worker`. Handles audio decoding
      and playback scheduling. Manages `isPlaying` state and directly updates `timeStore` on a `requestAnimationFrame`
      loop.
    * **Key State:** `isPlaying`, `speed`, `pitchShift`, `gain`.

* **`AnalysisService` (`src/lib/services/analysis.service.ts`)**
    * **Role:** Manages Voice Activity Detection (VAD) analysis (the VADHexagon), implementing the `IAnalysisPort`.
    * **Responsibility:** Orchestrates VAD processing via the `sileroVad.worker`. Holds raw VAD probabilities
      internally. Recalculates speech regions based on user-tunable thresholds.
    * **Key State:** `vadProbabilities` (internal), `vadRegions`, `vadPositiveThreshold`, `vadNegativeThreshold`.

* **`DtmfService` (`src/lib/services/dtmf.service.ts`)**
    * **Role:** Manages DTMF and CPT detection (the DTMFHexagon), implementing the `IDtmfPort`.
    * **Responsibility:** Communicates with the `dtmf.worker` to perform tone detection.
    * **Key State:** `dtmfResults`, `cptResults`.

* **`WaveformService` (`src/lib/services/waveform.service.ts`)**
    * **Role:** Manages all data generation for the waveform visualization.
    * **Responsibility:** Listens for a loaded `AudioBuffer`. Computes `waveformData` (peak data) for the waveform
      display.
    * **Key State:**  `waveformData` (internal).

* **`SpectrogramService` (`src/lib/services/spectrogram.service.ts`)**
    * **Role:** Manages spectrogram computation (the SpectrogramHexagon), implementing the `ISpectrogramPort`.
    * **Responsibility:** Communicates with the `spectrogram.worker` to perform FFT calculations.
    * **Key State:** `spectrogramData` (internal).

### 2.3. Port Interface Contracts

In accordance with the Hexagonal Architecture, the public API of each core service **must** be defined by a TypeScript `interface` (a Port). These interfaces serve as the formal contract for dependency injection and **must** be created before their corresponding service is implemented.

**Location:** All Port interfaces **must** reside in the `src/lib/types/` directory.

**Initial Port Definitions:**

*   **`IAudioEnginePort`** (`src/lib/types/audioEngine.d.ts`):
    *   `play(): void`
    *   `pause(): void`
    *   `stop(): void`
    *   `seek(time: number): void`
    *   `setSpeed(speed: number): void`
    *   `setPitch(pitchScale: number): void`
    *   `setGain(gain: number): void`
    *   `getAudioBuffer(): AudioBuffer | null`
    *   `decodeAudio(file: File): Promise<AudioBuffer>`

*   **`IAnalysisPort`** (`src/lib/types/analysis.d.ts`):
    *   `startAnalysis(buffer: AudioBuffer): Promise<void>`
    *   `recalculateRegions(params: { vadPositive: number; vadNegative: number }): void`
    *   `getVadProbabilities(): Float32Array | null`

*   **`IDtmfPort`** (`src/lib/types/dtmf.d.ts`):
    *   `startAnalysis(buffer: AudioBuffer): Promise<void>`

*   **`IWaveformPort`** (`src/lib/types/waveform.d.ts`):
    *   `generatePeakData(buffer: AudioBuffer): Promise<void>`
    *   `getWaveformData(): number[][] | null`

*   **`ISpectrogramPort`** (`src/lib/types/spectrogram.d.ts`):
    *   `generateFFTData(buffer: AudioBuffer): Promise<void>`
    *   `getSpectrogramData(): Float32Array[] | null`