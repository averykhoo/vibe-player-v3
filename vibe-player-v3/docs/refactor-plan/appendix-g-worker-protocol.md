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

## G.5. Mandatory Refactoring of the Rubberband Loader

The V1 and V2.3 implementations used a legacy, non-standard method for loading the Rubberband WASM module inside a Web Worker. This involved fetching the Emscripten-generated `rubberband-loader.js` script as a plain text string and executing it at runtime using `new Function()`. **This pattern is strictly forbidden in V3** as it violates **Constraint #11 (Statically Analyzable Code & No Runtime Evaluation)** and the rules in this appendix. It prevents the Vite bundler from analyzing, optimizing, and securing the code.

To ensure compliance with the V3 architecture, the Rubberband loader **must** be refactored into a modern, type-safe ES Module.

### G.5.1. The Implementation Contract

1.  **Create a New Module:** A new, manually created TypeScript module **must** be placed at `src/lib/vendor/rubberband/loader.ts`.

2.  **Refactor to an Exported Function:** The logic from the original `rubberband-loader.js` **must** be refactored into a single, exported asynchronous function: `export async function createRubberbandModule(wasmBinary: ArrayBuffer): Promise<RubberbandModule>`.

3.  **Dependency via Argument:** This function **must** accept the raw `rubberband.wasm` binary as an `ArrayBuffer` argument. It is the responsibility of the calling code (the worker) to fetch or receive this binary.

4.  **Worker Integration:** The `rubberband.worker.ts` **must not** contain any logic related to fetching scripts as text or using `new Function()`. It **must** use a standard ES Module `import` to use the new loader.

### G.5.2. Code Implementation Example

**New Loader (`src/lib/vendor/rubberband/loader.ts`):**

```typescript
// src/lib/vendor/rubberband/loader.ts
// NOTE: This is a conceptual representation. The actual implementation involves
// porting the complex setup logic from the original loader file.

// Define a type for the created module for type safety.
// This should be moved to a types file, e.g., src/lib/types/rubberband.d.ts
export interface RubberbandModule {
    _malloc: (size: number) => number;
    _free: (ptr: number) => void;
    _rubberband_new: (...args: any[]) => number;
    _rubberband_delete: (stretcher: number) => void;
    // ... all other exported C++ functions
    HEAPF32: Float32Array;
    // ... other Emscripten helper properties
}

/**
 * Creates and initializes the Rubberband WASM module from a provided binary.
 * @param wasmBinary The ArrayBuffer of the rubberband.wasm file.
 * @returns A promise that resolves with the fully initialized WASM module.
 */
export async function createRubberbandModule(wasmBinary: ArrayBuffer): Promise<RubberbandModule> {
    const wasmImports = { /* ... imports required by the WASM binary (e.g., for logging, memory management) ... */ };

    // Instantiate the WebAssembly module
    const { instance } = await WebAssembly.instantiate(wasmBinary, { a: wasmImports });
    const wasmExports = instance.exports;

    // The 'Module' object will be populated with all the necessary exports and memory views.
    const Module: Partial<RubberbandModule> = {};
    
    // ... all the setup logic from the old loader file goes here to populate 
    // the Module object with memory views (HEAPF32), stack functions, and exported C++ functions...
    // This is the main part of the porting effort.

    // Finally, cast the partially populated object to the full interface and return it.
    return Module as RubberbandModule;
}
```

**Updated Worker (`src/lib/workers/rubberband.worker.ts`):**

```typescript
// src/lib/workers/rubberband.worker.ts

// 1. Import the new loader function and its type definition
import { createRubberbandModule } from '$lib/vendor/rubberband/loader';
import type { RubberbandModule } from '$lib/vendor/rubberband/loader';

let wasmModule: RubberbandModule | null = null;
let stretcher: number = 0; // Pointer to the C++ instance

self.onmessage = async (event) => {
    if (event.data.type === 'INIT') {
        const { wasmBinary, sampleRate, channels } = event.data.payload;

        // 2. Call the new, safe, statically analyzable loader function
        wasmModule = await createRubberbandModule(wasmBinary);
        
        // 3. Use the returned module to initialize the stretcher
        stretcher = wasmModule._rubberband_new(sampleRate, channels, /* options */);
        
        self.postMessage({ type: 'INIT_SUCCESS' });
    }
    // ... other message handlers
};
```


