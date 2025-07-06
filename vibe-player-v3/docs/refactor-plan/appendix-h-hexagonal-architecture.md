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

## H.2. Dependency Injection with Svelte's Context API

This pattern replaces direct imports of services within components, enforcing decoupling.

1. **Instantiate & Provide Services at the Root:**
   In the main application layout (`+layout.svelte` or `+page.svelte`), all singleton services are instantiated and
   provided to the component tree using `setContext`.

   ```svelte
   <!-- src/routes/+layout.svelte -->
   <script lang="ts">
     import { setContext } from 'svelte';
     import type { IAudioEnginePort } from '$lib/types/audioEngine.d.ts';
     import { AudioEngineService } from '$lib/services/audioEngine.service';
     
     // Instantiate the service
     const audioEngine = new AudioEngineService();

     // Provide the instance to all child components under a specific key
     setContext<IAudioEnginePort>('audio-engine', audioEngine);
   </script>
   
   <slot />
   ```

2. **Consume Services in Components:**
   Components use `getContext` to retrieve a service instance. They only need to know the context *key* and the service
   *interface*, not the concrete implementation or file path.

   ```svelte
   <!-- src/lib/components/Controls.svelte -->
   <script lang="ts">
     import { getContext } from 'svelte';
     import type { IAudioEnginePort } from '$lib/types/audioEngine.d.ts';

     // Retrieve the service using its key and type interface
     const engine = getContext<IAudioEnginePort>('audio-engine');
   </script>

   <button on:click={() => engine.play()}>Play</button>
   ```

3. **Mocking Services in Tests (Simplified):**
   Component tests become incredibly simple. You provide a mock object using `setContext` during the render call. **This
   completely replaces the need for `vi.mock` for component tests.**

   ```typescript
   // tests/unit/components/Controls.test.ts
   import { test, expect, vi } from 'vitest';
   import { render, fireEvent, getContext, setContext } from '@testing-library/svelte';
   import Controls from '$lib/components/Controls.svelte';
   import type { IAudioEnginePort } from '$lib/types/audioEngine.d.ts';

   test('clicking play calls the audio engine service from context', async () => {
     // 1. Create a simple mock object that conforms to the service interface
     const mockEngine: IAudioEnginePort = {
       play: vi.fn(),
       // ... mock other methods as needed
     };

     // 2. Render the component and provide the mock via setContext
     const { getByText } = render(Controls, {
       context: new Map([
         ['audio-engine', mockEngine]
       ])
     });

     // 3. Interact and assert
     await fireEvent.click(getByText('Play'));
     expect(mockEngine.play).toHaveBeenCalledOnce();
   });
   ```

### H.3. Service-to-Service Dependency Injection

While UI components receive services via Svelte's `getContext`, services themselves may have dependencies on other core services. To maintain decoupling, these dependencies **must** be injected via the service's constructor, and the dependency **must** be typed against the Port (interface), not the concrete class. This allows services to make direct, efficient data requests (e.g., `getAudioBuffer()`) without violating the principles of the Hexagonal Architecture.

**Example:** The `AnalysisService` needs the `AudioBuffer` from the `AudioEngineService`.

```typescript
// src/lib/services/analysis.service.ts
import type { IAudioEnginePort } from '$lib/types/audioEngine.d.ts';
import type { IAnalysisPort } from '$lib/types/analysis.d.ts';
 
export class AnalysisService implements IAnalysisPort {
  // Depend on the INTERFACE, not the concrete class
  constructor(private audioEngine: IAudioEnginePort) {}
 
  public async startAnalysis() {
    // Now it can safely request data from its injected dependency.
    const buffer = this.audioEngine.getAudioBuffer();
    // ...
  }
}
```

```svelte
// src/routes/+layout.svelte (Application Root)
// ...
const audioEngine = new AudioEngineService();
// Inject the engine instance into the analysis service constructor
const analysisService = new AnalysisService(audioEngine); 
 
setContext<IAudioEnginePort>('audio-engine', audioEngine);
setContext<IAnalysisPort>('analysis-service', analysisService);
```