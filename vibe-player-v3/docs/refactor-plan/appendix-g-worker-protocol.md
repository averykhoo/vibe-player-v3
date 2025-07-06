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