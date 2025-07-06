[//]: # ( vibe-player-v3/docs/refactor-plan/appendix-g-worker-protocol.md )
# Appendix G: Worker Communication Protocol & Timeout Handling

This appendix provides a definitive implementation contract for the mandatory `WorkerChannel` utility.

## G.1. The Type-Safe `WorkerChannel` Utility Class

A reusable TypeScript class named `WorkerChannel` **must** be created in `src/lib/utils/workerChannel.ts`. This class
provides a generic, **fully type-safe**, Promise-based request/response communication layer.

## G.2. Mandatory Mechanisms

The `WorkerChannel` class **must** implement:

1. **Type Safety:** Use TypeScript generics and discriminated unions for message and payload types to prevent errors.
2. **Timeout Mechanism:** A robust, Promise-based timeout for all operations to prevent hung workers.
3. **Observability:** Hooks or logging for latency tracing, traffic logging, and error metrics for debugging and
   monitoring.

## G.3. Type-Safe Reference Implementation Pattern

```typescript
// src/lib/types/worker.events.ts
// Example for a specific worker (e.g., VAD)
export type VadWorkerRequest =
    | { type: 'INIT'; payload: { model: ArrayBuffer }; }
    | { type: 'PROCESS'; payload: { pcmData: Float32Array }; };

export type VadWorkerResponse =
    | { type: 'INIT_COMPLETE'; }
    | { type: 'PROCESS_COMPLETE'; payload: { probabilities: Float32Array }; };

// src/lib/utils/workerChannel.ts

const DEFAULT_WORKER_TIMEOUT_MS = 30000;

export class WorkerTimeoutError extends Error { /* ... */
}

// Generic class, typed for a specific worker's message contract
export class WorkerChannel<Req, Res> {
    private worker: Worker;
    private messageIdCounter = 0;
    private pendingRequests = new Map<number, { resolve: (res: Res) => void, reject: (err: Error) => void }>();

    constructor(worker: Worker) {
        this.worker = worker;
        this.worker.onmessage = (event: MessageEvent<{ id: number, response: Res }>) => {
            const {id, response} = event.data;
            const request = this.pendingRequests.get(id);
            if (request) {
                request.resolve(response);
                this.pendingRequests.delete(id);
            }
        };
        // Add onerror handling
    }

    public post(request: Req, transferables: Transferable[] = []): Promise<Res> {
        const messageId = this.messageIdCounter++;
        // Start performance mark for latency tracing
        performance.mark(`worker_req_${messageId}_start`);

        const promise = new Promise<Res>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new WorkerTimeoutError(`Worker request ${messageId} timed out.`));
            }, DEFAULT_WORKER_TIMEOUT_MS);

            this.pendingRequests.set(messageId, {
                resolve: (response) => {
                    clearTimeout(timeoutId);
                    resolve(response);
                },
                reject: (err) => {
                    clearTimeout(timeoutId);
                    reject(err);
                }
            });

            this.worker.postMessage({id: messageId, request}, transferables);
        });

        // Add logging and complete performance mark in .finally()
        promise.finally(() => {
            performance.mark(`worker_req_${messageId}_end`);
            performance.measure(`Worker Request: ${request.type}`, `worker_req_${messageId}_start`, `worker_req_${messageId}_end`);
        });

        return promise;
    }

    public terminate() {
        this.worker.terminate();
    }
}
```

## G.4. Worker Implementation Contract

Beyond the communication protocol, the implementation of the worker files (`.ts` files) themselves **must** adhere to the following rules to ensure they are compliant with the project's build and security principles:

1.  **Dependency Imports:** All external code required by a worker (e.g., `fft.js` for the spectrogram worker, `onnxruntime-web` for the VAD worker) **must** be imported using standard `import` statements at the top of the worker's TypeScript file.

    ```typescript
    // CORRECT: Static import that Vite can analyze
    import { FFT } from '../../vendor/fft-es-module.js';
    import * as ort from 'onnxruntime-web';
    ```

2.  **No `importScripts()`:** The use of the legacy `importScripts()` function is forbidden.

3.  **No `new Function()` or `eval()`:** Dynamically fetching script content as a string and executing it via `new Function()` or `eval()` is strictly forbidden, as it violates **Constraint 11**.

4.  **Bundler Integration:** The main application **must** import worker files using Vite's `?worker&inline` suffix. This signals to the build tool to correctly bundle the worker and all of its imported dependencies into a single, optimized, self-contained module.

    ```typescript
    // CORRECT: In a service file on the main thread
    import MyWorker from '$lib/workers/my.worker.ts?worker&inline';
    const worker = new MyWorker();
    ```

**Rationale:** Adherence to these implementation rules is mandatory. It ensures that all code is visible to the Vite bundler, allowing for complete tree-shaking, minification, and static analysis. This results in the most performant and secure application, free from the "import shenanigans" of previous versions.

## G.5. Mandatory WASM Integration Strategy (Rubberband Loader)

The V1 and V2.3 implementations used a legacy, non-standard method for loading the Rubberband WASM module inside a Web Worker. This involved fetching the Emscripten-generated `rubberband-loader.js` script as a plain text string and executing it at runtime using `new Function()`. **This pattern is strictly forbidden in V3** as it violates **Constraint #11 (Statically Analyzable Code & No Runtime Evaluation)**.

The V3 implementation **must** use Vite's modern asset handling capabilities to load and instantiate WASM modules in a safe, secure, and performant way that is fully compatible with the build process.

### G.5.1. The V3 Integration Contract

1.  **Refactor the "Glue" Code:** The complex setup logic from the original `rubberband-loader.js` **must** be refactored into a new, type-safe ES Module at `src/lib/vendor/rubberband/loader.ts`. This module will export a single asynchronous function: `export async function createRubberbandModule(wasmUrl: string): Promise<RubberbandModule>`.

2.  **Use Vite `?url` Import in Worker:** The `rubberband.worker.ts` **must** get the path to the WASM binary by using Vite's `?url` import suffix. This ensures the path is always correct after the build process. `import wasmUrl from '$lib/vendor/rubberband/rubberband.wasm?url';`

3.  **Fetch and Instantiate in Loader:** The `createRubberbandModule` function is responsible for fetching the `wasmUrl` and using the efficient `WebAssembly.instantiateStreaming()` method.

4.  **Worker as Orchestrator:** The `rubberband.worker.ts` is responsible for importing the loader and the WASM URL, and then orchestrating the initialization on an `INIT` command.

### G.5.2. Code Implementation Example

This example demonstrates the complete, compliant flow.

**Type Definition (`src/lib/types/rubberband.d.ts`):**
```typescript
// src/lib/types/rubberband.d.ts
export interface RubberbandModule {
    _malloc: (size: number) => number;
    _free: (ptr: number) => void;
    _rubberband_new: (...args: any[]) => number;
    _rubberband_delete: (stretcher: number) => void;
    // ... all other exported C++ functions
    HEAPF32: Float32Array;
    // ... other Emscripten helper properties
}
```

**New Loader (`src/lib/vendor/rubberband/loader.ts`):**
```typescript
// src/lib/vendor/rubberband/loader.ts
import type { RubberbandModule } from '$lib/types/rubberband.d.ts';

/**
 * Creates and initializes the Rubberband WASM module by fetching it from the provided URL.
 * @param wasmUrl The URL to the rubberband.wasm file, provided by Vite's `?url` import.
 * @returns A promise that resolves with the fully initialized WASM module.
 */
export async function createRubberbandModule(wasmUrl: string): Promise<RubberbandModule> {
    const wasmImports = { /* ... imports required by the WASM binary ... */ };

    // Fetch and instantiate the module in one step for maximum efficiency.
    const { instance } = await WebAssembly.instantiateStreaming(
        fetch(wasmUrl), 
        { a: wasmImports }
    );
    
    const wasmExports = instance.exports;
    const Module: Partial<RubberbandModule> = {};
    
    // ... all the complex setup logic from the old loader file goes here to populate 
    // the Module object with memory views (HEAPF32), stack functions, and exported C++ functions...
    // This is the main part of the porting effort.

    return Module as RubberbandModule;
}
```

**Updated Worker (`src/lib/workers/rubberband.worker.ts`):**
```typescript
// src/lib/workers/rubberband.worker.ts
import { createRubberbandModule } from '$lib/vendor/rubberband/loader';
import type { RubberbandModule } from '$lib/types/rubberband.d.ts';
import wasmUrl from '$lib/vendor/rubberband/rubberband.wasm?url'; // Vite handles this path

let wasmModule: RubberbandModule | null = null;
let stretcher: number = 0; // Pointer to the C++ instance

self.onmessage = async (event: MessageEvent) => {
    if (event.data.type === 'INIT') {
        const { sampleRate, channels } = event.data.payload;

        // 1. Call the new loader, passing the URL Vite provided.
        wasmModule = await createRubberbandModule(wasmUrl);
        
        // 2. Use the returned module to initialize the stretcher instance.
        stretcher = wasmModule._rubberband_new(sampleRate, channels, /* options */);
        
        self.postMessage({ type: 'INIT_SUCCESS' });
    }
    // ... other message handlers
};
```