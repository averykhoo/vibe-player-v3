// --- /vibe-player/js/vad/LocalWorkerStrategy.js ---
// This strategy handles VAD processing locally using a Web Worker.

/** @namespace AudioApp */
var AudioApp = AudioApp || {};

AudioApp.LocalWorkerStrategy = class {
    constructor() {
        this.worker = null;
        // Add a "ready" promise that resolves when the worker confirms model is loaded
        this.readyPromise = new Promise((resolve, reject) => {
            this._resolveReady = resolve;
            this._rejectReady = reject;
        });
    }

    init() {
        // Terminate any old worker to ensure a clean state.
        if (this.worker) {
            this.worker.terminate();
            // Re-create the promise for the new worker instance
            this.readyPromise = new Promise((resolve, reject) => {
                this._resolveReady = resolve;
                this._rejectReady = reject;
            });
        }

        // --- Step 1: Define the entire worker's code as a single string ---
        // This is the magic that makes it reliable. No more relative paths in importScripts!
        const workerScript = `
            // This code runs inside the worker.
            self.onmessage = async (event) => {
                const { type, payload } = event.data;

                if (type === 'init_and_load_scripts') {
                    // Use the absolute paths sent from the main thread.
                    const { basePath, onnxWasmPath, modelPath } = payload;
                    try {
                        // The 'basePath' ensures all these scripts load correctly.
                        importScripts(
                            basePath + 'js/constants.js',
                            basePath + 'js/utils.js',
                            basePath + 'lib/ort.min.js', // Load ONNX runtime inside worker
                            basePath + 'js/vad/sileroWrapper.js',
                            basePath + 'js/vad/sileroProcessor.js'
                        );

                        // IMPORTANT: Tell the ONNX runtime where its own .wasm files are.
                        self.ort.env.wasm.wasmPaths = onnxWasmPath;

                        // Now, initialize the VAD model using the correct path.
                        const modelReady = await AudioApp.sileroWrapper.create(AudioApp.Constants.VAD_SAMPLE_RATE, modelPath);

                        if (modelReady) {
                            self.postMessage({ type: 'model_ready' });
                        } else {
                            self.postMessage({ type: 'error', payload: { message: "Failed to create Silero VAD model in worker." } });
                            throw new Error("Failed to create Silero VAD model in worker.");
                        }
                    } catch (e) {
                        self.postMessage({ type: 'error', payload: { message: 'Worker script import or init failed: ' + e.message } });
                    }

                } else if (type === 'analyze') {
                    const { pcmData } = payload;

                    // This callback will post progress messages back to the main thread.
                    const progressCallback = (progress) => {
                        self.postMessage({ type: 'progress', payload: progress });
                    };

                    try {
                        const vadResult = await AudioApp.sileroProcessor.analyzeAudio(pcmData, { onProgress: progressCallback });
                        self.postMessage({ type: 'result', payload: vadResult });
                    } catch(e) {
                         self.postMessage({ type: 'error', payload: { message: 'VAD analysis failed: ' + e.message } });
                    }
                }
            };
        `;

        // --- Step 2: Create the worker from a Blob URL ---
        // This avoids needing a separate .js file on disk for the worker code.
        const blob = new Blob([workerScript], { type: 'application/javascript' });
        this.worker = new Worker(URL.createObjectURL(blob));

        // Set up the onmessage handler for the worker HERE, specifically to listen for the 'model_ready' signal
        this.worker.onmessage = (event) => {
            const { type, payload } = event.data;
            if (type === 'model_ready') {
                console.log("LocalWorkerStrategy: Worker reported model is ready.");
                this._resolveReady(true); // Resolve the ready promise
            } else if (type === 'error') {
                 // If an error happens during initialization, reject the ready promise
                 this._rejectReady(new Error(payload.message));
            }
            // After initialization, subsequent messages will be handled by the promise in `analyze`
        };

        this.worker.onerror = (err) => {
            this._rejectReady(new Error(`VAD Worker initialization error: ${err.message}`));
        };


        // --- Step 3: Immediately send it the correct paths for initialization ---
        // The main thread knows where everything is relative to index.html.
        const pageUrl = new URL('.', window.location.href);
        this.worker.postMessage({
            type: 'init_and_load_scripts',
            payload: {
                basePath: pageUrl.href,
                onnxWasmPath: new URL('lib/', pageUrl).href, // Full path to the lib folder
                modelPath: new URL('model/silero_vad.onnx', pageUrl).href // Full path to the model
            }
        });
    }

    async analyze(pcmData, options) {
        // First, AWAIT the ready promise. This ensures init is complete.
        await this.readyPromise;

        if (!this.worker) {
            return Promise.reject(new Error("VAD worker has not been initialized."));
        }

        // This returns a Promise that will resolve or reject when the worker sends back a final message.
        return new Promise((resolve, reject) => {
            // Set the message handler for this specific analysis task
            this.worker.onmessage = (event) => {
                const { type, payload } = event.data;
                if (type === 'result') {
                    resolve(payload); // Analysis was successful.
                } else if (type === 'progress') {
                    // Forward progress updates to the main app if a callback was provided.
                    if (options.onProgress) {
                        options.onProgress(payload);
                    }
                } else if (type === 'error') {
                    reject(new Error(payload.message)); // Analysis failed in the worker.
                }
            };

            this.worker.onerror = (err) => {
                reject(new Error(`VAD Worker Error: ${err.message}`));
            };

            // Send the audio data to the worker to start analysis.
            // The second argument `[pcmData.buffer]` is a Transferable object.
            // This is a very fast, zero-copy transfer of the data to the worker.
            this.worker.postMessage({
                type: 'analyze',
                payload: { pcmData }
            }, [pcmData.buffer]);
        });
    }

    terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            console.log("LocalWorkerStrategy: Worker terminated.");
        }
    }
};
