[//]: # ( vibe-player-v3/docs/refactor-plan/appendix-h-hexagonal-architecture.md )
# Appendix H: Hexagonal Architecture Implementation in TypeScript

This appendix provides the definitive, mandatory patterns for implementing the Hexagonal Architecture using Dependency
Injection with Svelte's Context API.

## H.1. Ports as Explicit TypeScript `interface`s

* **Rule:** Every core service (Hexagon) **must** have a corresponding `interface` file defining its public API (its "
  Driving Port").
* **Location:** Interfaces must reside in `src/lib/types/` to create a neutral dependency location.
* **Rationale:** This is the cornerstone of Dependency Inversion. Components and other services will depend on the
  *interface*, not the concrete implementation, allowing for easy mocking and swapping.

## H.2. Dependency Injection via a Centralized Service Container

To ensure a clean, maintainable, and single source of truth for service instantiation, all services **must** be created and wired together in a dedicated `container.ts` file. This container is then used at the application root (`+layout.svelte`) to provide the singleton instances to the UI via Svelte's Context API. This pattern avoids scattering complex instantiation logic within a UI file and makes the application's dependency graph explicit and easy to manage.

### H.2.1. The `container.ts` Implementation Contract

*   **Location:** The container **must** be located at `src/lib/services/container.ts`.
*   **Structure:** It must be a simple object that exports the singleton instances of all services.
*   **Instantiation:** It is responsible for `new`-ing up each service and injecting dependencies (other services) via their constructors.

**Reference Implementation (`src/lib/services/container.ts`):**
```typescript
// src/lib/services/container.ts
import { AudioEngineService } from './audioEngine.service';
import { AnalysisService } from './analysis.service';
// ... import other services

// Instantiate services, injecting dependencies as needed.
// The order here matters and makes the dependency graph explicit.
const audioEngine = new AudioEngineService();
const analysisService = new AnalysisService(audioEngine); // <-- Constructor Injection
// ... const waveformService = new WaveformService(audioEngine);

/**
 * A centralized container holding singleton instances of all application services.
 * This is the single source of truth for service instantiation and dependency injection.
 */
export const serviceContainer = {
  audioEngine,
  analysisService,
  // ... waveformService,
};

// Export a type for convenience, derived from the container itself.
export type ServiceContainer = typeof serviceContainer;
```

### H.2.2. Providing Services to the UI via Svelte Context

With the container in place, the application root (`+layout.svelte`) becomes extremely simple. Its only job is to import the container and provide each service to the component tree.

**Reference Implementation (`src/routes/+layout.svelte`):**
```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { setContext } from 'svelte';
  import { serviceContainer } from '$lib/services/container';
  import type { IAudioEnginePort } from '$lib/types/audioEngine.d.ts';
  import type { IAnalysisPort } from '$lib/types/analysis.d.ts';

  // Provide each service instance from the container to all child components.
  // The key used for setContext ('audio-engine') must be unique and documented.
  setContext<IAudioEnginePort>('audio-engine', serviceContainer.audioEngine);
  setContext<IAnalysisPort>('analysis-service', serviceContainer.analysisService);
  // ... setContext for other services

</script>

<slot />
```

### H.2.3. Consuming Services in Components

The component-level logic remains the same as originally planned. Components use `getContext` with the documented key to retrieve a service instance, remaining blissfully unaware of the container or the concrete implementation.

```svelte
<!-- src/lib/components/Controls.svelte -->
<script lang="ts">
  import { getContext } from 'svelte';
  import type { IAudioEnginePort } from '$lib/types/audioEngine.d.ts';

  const engine = getContext<IAudioEnginePort>('audio-engine');
</script>

<button on:click={() => engine.play()}>Play</button>
```