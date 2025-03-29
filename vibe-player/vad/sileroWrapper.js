// /vibe-player/vad/sileroWrapper.js

/**
 * Wraps the ONNX Runtime session for the Silero VAD model,
 * handling model loading, state management, and inference.
 */
const sileroWrapper = (() => {
    // --- Private Module State ---
    let config = null;
    let session = null;
    let stateTensorH = null; // State tensor H
    let stateTensorC = null; // State tensor C
    let sampleRateTensor = null; // Sample rate tensor (sr)
    let isReady = false;
    let isInitializing = false;

    // Default Silero VAD model constants (adjust if using a different version)
    const VAD_SAMPLE_RATE = 16000;
    const VAD_STATE_SIZE = 2 * 1 * 64; // Based on common Silero models [2, 1, 64]

    // --- Private Methods ---

    /** Creates the initial state tensors for the VAD model. */
    function createInitialState() {
        stateTensorH = new ort.Tensor('float32', new Float32Array(VAD_STATE_SIZE), [2, 1, 64]);
        stateTensorC = new ort.Tensor('float32', new Float32Array(VAD_STATE_SIZE), [2, 1, 64]);
        sampleRateTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(VAD_SAMPLE_RATE)]), []); // Scalar int64
    }

    // --- Public API ---
    return {
        /**
         * Initializes the Silero VAD wrapper.
         * @param {AudioAppConfig} appConfig The application configuration.
         */
        init(appConfig) {
            config = appConfig;
            // Doesn't load the model immediately, waits for analyze call in vadAnalyzer
            console.log("SileroWrapper initialized (model loading deferred).");
        },

        /**
         * Creates the ONNX InferenceSession for the Silero VAD model.
         * This is typically called by vadAnalyzer when analysis is first requested.
         * @returns {Promise<boolean>} True if the session was created successfully, false otherwise.
         */
        async createSession() {
            if (session) {
                console.log("[SileroWrapper] Session already exists.");
                return true;
            }
            if (isInitializing) {
                 console.warn("[SileroWrapper] Initialization already in progress.");
                 // Simple approach: wait a bit and check again, or implement a proper lock/promise queue
                 await new Promise(resolve => setTimeout(resolve, 100));
                 return !!session;
            }
            if (!config || typeof ort === 'undefined') {
                console.error("[SileroWrapper] Config or ONNX Runtime (ort) not available.");
                isReady = false;
                return false;
            }

            isInitializing = true;
            console.log("[SileroWrapper] Creating ONNX Inference Session...");

            try {
                // Configure ONNX Runtime environment if needed (e.g., WASM paths)
                // These paths should point to the directory containing ort-wasm*.wasm
                ort.env.wasm.wasmPaths = config.paths.onnxWasmRoot;
                ort.env.wasm.numThreads = 1; // Use single thread for simplicity/compatibility

                const modelPath = config.paths.onnxModel;
                console.log(`[SileroWrapper] Loading model from: ${modelPath}`);

                // Create the session
                session = await ort.InferenceSession.create(modelPath, {
                    executionProviders: ['wasm'], // Use WASM backend
                    // graphOptimizationLevel: 'all', // Optional optimization
                });

                if (!session) {
                    throw new Error("InferenceSession.create returned null or undefined.");
                }

                // Verify input names (adjust if your model differs)
                const expectedInputs = ['input', 'sr', 'h', 'c'];
                const actualInputs = session.inputNames;
                if (!expectedInputs.every(name => actualInputs.includes(name))) {
                     console.warn(`[SileroWrapper] Model input names mismatch. Expected: ${expectedInputs.join(', ')}. Actual: ${actualInputs.join(', ')}.`);
                     // Proceed cautiously, might fail during run
                } else {
                     console.log("[SileroWrapper] Model input names verified:", actualInputs.join(', '));
                }


                createInitialState(); // Initialize state tensors
                isReady = true;
                console.log("[SileroWrapper] ONNX Session created successfully.");
                return true;

            } catch (error) {
                console.error("[SileroWrapper] Failed to create ONNX session:", error);
                session = null;
                isReady = false;
                return false;
            } finally {
                 isInitializing = false;
            }
        },

        /** Returns true if the ONNX session is created and ready. */
        isReady() {
            return isReady && !!session;
        },

        /** Resets the internal state tensors (h, c) of the VAD model. */
        reset_state() {
            if (!isReady) {
                console.warn("[SileroWrapper] Cannot reset state: Wrapper not ready.");
                return;
            }
            console.log("[SileroWrapper] Resetting VAD state tensors.");
            createInitialState(); // Recreate initial zero tensors
        },

        /**
         * Processes a chunk of audio data through the VAD model.
         * @param {Float32Array} audioChunk PCM audio data chunk (at 16kHz).
         * @returns {Promise<{probability: number, newStateH: ort.Tensor, newStateC: ort.Tensor} | null>}
         *          An object containing the speech probability and updated state tensors, or null on error.
         */
        async process(audioChunk) {
            if (!this.isReady()) {
                console.error("[SileroWrapper] Cannot process: Session not ready.");
                return null;
            }
            if (!audioChunk || !(audioChunk instanceof Float32Array) || audioChunk.length === 0) {
                 console.error("[SileroWrapper] Invalid audio chunk provided for processing.");
                 return null;
             }


            try {
                // 1. Prepare Input Tensor for audio chunk
                 // Silero model typically expects shape [1, N] where N is chunk length
                 const inputTensor = new ort.Tensor('float32', audioChunk, [1, audioChunk.length]);

                // 2. Prepare Feed Dictionary
                 const feeds = {
                     'input': inputTensor,
                     'sr': sampleRateTensor, // Use the pre-created sample rate tensor
                     'h': stateTensorH,       // Use the current state H
                     'c': stateTensorC        // Use the current state C
                 };

                 // 3. Run Inference
                 const results = await session.run(feeds);

                // 4. Extract Results (adjust names based on your model's output)
                 const outputTensor = results['output'];   // Speech probability
                 const newStateH = results['hn'];        // Updated state H
                 const newStateC = results['cn'];        // Updated state C

                 if (!outputTensor || !newStateH || !newStateC) {
                     console.error("[SileroWrapper] Inference completed but expected outputs are missing.", results);
                     return null;
                 }

                // 5. Update Internal State for next call
                 // IMPORTANT: Replace the old state tensors with the new ones from the output
                 stateTensorH = newStateH;
                 stateTensorC = newStateC;

                // 6. Return probability and new state
                 const probability = outputTensor.data[0]; // Assuming scalar output or first element
                 return {
                     probability: probability,
                     // Optionally return new state if caller needs it, though usually managed internally
                     // newStateH: stateTensorH,
                     // newStateC: stateTensorC
                 };

            } catch (error) {
                console.error("[SileroWrapper] Error during VAD inference:", error);
                // Consider resetting state on error? Or let the caller decide?
                // this.reset_state();
                return null;
            }
        },

        /** Releases the ONNX session resources. */
        async releaseSession() {
             if (session && typeof session.release === 'function') {
                 console.log("[SileroWrapper] Releasing ONNX session...");
                 try {
                     await session.release();
                     console.log("[SileroWrapper] ONNX session released.");
                 } catch (e) {
                     console.error("[SileroWrapper] Error releasing ONNX session:", e);
                 }
             }
             session = null;
             stateTensorH = null;
             stateTensorC = null;
             sampleRateTensor = null;
             isReady = false;
             isInitializing = false; // Reset init flag too
         }
    };
})();

// Attach to the global AudioApp namespace
if (typeof window.AudioApp === 'undefined') {
    window.AudioApp = {};
}
window.AudioApp.sileroWrapper = sileroWrapper;
console.log("SileroWrapper module loaded.");

// /vibe-player/vad/sileroWrapper.js
