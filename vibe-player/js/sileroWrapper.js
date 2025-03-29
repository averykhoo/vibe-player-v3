// --- /vibe-player/js/sileroWrapper.js ---
// Wraps the ONNX Runtime session for the Silero VAD model.
// Manages ONNX session creation, state tensors, and inference calls.

var AudioApp = AudioApp || {}; // Ensure namespace exists

// Design Decision: Use IIFE, pass the global `ort` object dependency.
// This makes the dependency explicit and allows for easier testing/mocking if needed.
AudioApp.sileroWrapper = (function(globalOrt) {
    'use strict';

    // Check if ONNX Runtime is loaded
    if (!globalOrt) {
        console.error("SileroWrapper: CRITICAL - ONNX Runtime (ort) object not found on window!");
        // Return a non-functional public interface
        return {
            /** @returns {Promise<boolean>} */ create: () => Promise.resolve(false),
            /** @returns {Promise<number>} */ process: () => Promise.reject(new Error("ONNX Runtime not available")),
            reset_state: () => { console.error("ONNX Runtime not available"); },
            isAvailable: false
        };
    }

    // --- Module State ---
    /** @type {ort.InferenceSession|null} The ONNX inference session. Stays null until create() succeeds. */
    let session = null;
    /** @type {ort.Tensor|null} Tensor holding the required sample rate (e.g., 16000). */
    let sampleRateTensor = null;
    /** @type {ort.Tensor|null} Hidden state 'c' tensor for the VAD model's RNN. */
    let state_c = null;
     /** @type {ort.Tensor|null} Hidden state 'h' tensor for the VAD model's RNN. */
    let state_h = null;

    // Design Decision: Hardcode state dimensions based on typical Silero VAD models.
    /** @const {number[]} Standard Silero state tensor dimensions [num_layers*num_directions, batch_size, hidden_size] */
    const stateDims = [2, 1, 64]; // [2*1, 1, 64]
    /** @const {number} Total number of elements in a state tensor. */
    const stateSize = 2 * 1 * 64; // 128

    // --- Public Methods ---

    /**
     * Creates and loads the Silero VAD ONNX InferenceSession if it doesn't already exist.
     * Configures ONNX Runtime Web options, especially WASM paths.
     * Idempotent: Safe to call multiple times; will only create the session once.
     * @param {number} sampleRate - The required sample rate (must match model, e.g., 16000).
     * @param {string} [uri='./model/silero_vad.onnx'] - Path to the ONNX model file, relative to the HTML file.
     * @returns {Promise<boolean>} - True if session exists or was created successfully, false otherwise.
     * @public
     */
    async function create(sampleRate, uri = './model/silero_vad.onnx') {
        // --- Idempotency Check ---
        // Design Decision: If the session object already exists, assume it was created successfully before.
        // Don't try to recreate it, just return true. Optionally reset state for the new run.
        if (session) {
            console.log("SileroWrapper: Session already exists.");
            // Ensure state is reset for potentially new audio, even if session exists
            // This is important if loading multiple files without page refresh.
            try {
                reset_state();
            } catch (e) {
                console.warn("SileroWrapper: Error resetting state for existing session:", e);
                // Proceed anyway, but state might be stale if tensor creation failed
            }
            return true; // Session already created
        }
        // --- End Idempotency Check ---

        // Design Decision: Default path assumes model is in 'model/' relative to index.html.
        const opt = {
            executionProviders: ["wasm"], // Use WebAssembly backend
            logSeverityLevel: 3, // 0:V, 1:I, 2:W, 3:E, 4:F - Reduce console noise
            logVerbosityLevel: 3, // Default is 0
            // CRITICAL: Configure WASM options
            wasm: {
                // Provide the path where the .wasm files (ort-wasm.wasm, etc.) are located,
                // relative to the main HTML file.
                wasmPaths: 'lib/' // Assumes .wasm files are in the /lib/ folder
            }
        };

        try {
            console.log(`SileroWrapper: Creating ONNX InferenceSession from ${uri}...`);
            console.log("SileroWrapper: Using options:", opt);
            // --- Session Creation ---
            // Assign the created session to the module's 'session' variable.
            session = await globalOrt.InferenceSession.create(uri, opt);
            // --- End Session Creation ---

            // Create the sample rate tensor (int64 requires BigInt)
            sampleRateTensor = new globalOrt.Tensor("int64", [BigInt(sampleRate)]);

            reset_state(); // Initialize state tensors immediately after session creation.

            console.log("SileroWrapper: ONNX session created successfully.");
            return true; // Indicate success
        } catch (e) {
            console.error("SileroWrapper: Failed to create ONNX InferenceSession:", e);
            // Log potential WASM loading issues
            if (e.message.includes("WebAssembly") || e.message.includes(".wasm")) {
                console.error("SileroWrapper: Hint - Check if WASM files (e.g., ort-wasm.wasm) are present in the 'lib/' folder and served correctly.");
            }
            session = null; // Ensure session is null on failure
            return false; // Indicate failure
        }
    }

    /**
     * Resets the hidden state tensors (h, c) of the VAD model to zero.
     * Should be called before processing a new audio file or segment.
     * Safe to call even if session creation failed (will just log error if ort is missing).
     * @public
     */
    function reset_state() {
        if (!globalOrt) {
            console.error("SileroWrapper: Cannot reset state - ONNX Runtime not available.");
            return;
        }
        // Create zero-filled Float32Arrays and wrap them in Tensors.
        // This ensures state_c and state_h are valid Tensor objects (or null if ort is missing)
        state_c = new globalOrt.Tensor("float32", new Float32Array(stateSize).fill(0), stateDims);
        state_h = new globalOrt.Tensor("float32", new Float32Array(stateSize).fill(0), stateDims);
        // console.log("SileroWrapper: Model state tensors reset."); // Keep console less noisy
    }

    /**
     * Processes a single audio frame through the loaded VAD model.
     * Requires `create()` to have been called successfully first (checked via `session` variable).
     * Updates the internal state tensors (h, c) for the next frame.
     * @param {Float32Array} audioFrame - The audio data for one frame (e.g., 1536 samples).
     * @returns {Promise<number>} - The VAD probability score (typically 0.0 to 1.0) for the frame.
     * @throws {Error} If the session is not initialized or inference fails.
     * @public
     */
    async function process(audioFrame) {
        // --- Pre-conditions Check ---
        // This check now correctly identifies if `create` failed or was never called,
        // or if state tensors failed to initialize.
        if (!session || !state_c || !state_h || !sampleRateTensor) {
            throw new Error("SileroWrapper: VAD session not initialized or state missing. Call create() first.");
        }
        // --- End Pre-conditions Check ---

        // Ensure input is Float32Array (model expects this)
        if (!(audioFrame instanceof Float32Array)) {
             console.warn("SileroWrapper: Input audioFrame is not Float32Array. Attempting conversion.");
             try {
                 audioFrame = new Float32Array(audioFrame);
             } catch (convError) {
                 throw new Error(`SileroWrapper: Failed to convert audioFrame to Float32Array. ${convError.message}`);
             }
        }

        try {
            // Create input tensor for the audio frame. Shape [batch_size, num_samples].
            const inputTensor = new globalOrt.Tensor("float32", audioFrame, [1, audioFrame.length]);

            // Prepare the 'feeds' object mapping input names (expected by model) to tensors.
            const feeds = {
                input: inputTensor,
                h: state_h,       // Previous state h
                c: state_c,       // Previous state c
                sr: sampleRateTensor // Sample rate tensor
            };

            // Run inference
            const outputMap = await session.run(feeds);

            // IMPORTANT: Update the internal state tensors with the new states returned by the model.
            // The model outputs are typically named 'hn' and 'cn'.
            if (outputMap.hn && outputMap.cn) {
                state_h = outputMap.hn;
                state_c = outputMap.cn;
            } else {
                 // If state names differ, log a warning. User might need to check model outputs.
                 console.warn("SileroWrapper: Model did not return outputs named 'hn' and 'cn'. State will not be updated correctly for subsequent frames.");
                 // Should this throw? For now, just warn. Processing might still yield 'output'.
            }


            // Extract the primary VAD probability output. Assume it's named 'output'.
            if (outputMap.output && outputMap.output.data) {
                // The output is usually a tensor with a single value.
                return outputMap.output.data[0];
            } else {
                 // If the output name is different, throw an error. User needs to inspect the model.
                 console.error("SileroWrapper: Model output map:", outputMap);
                 throw new Error("SileroWrapper: Expected output tensor named 'output' not found in model results.");
            }
        } catch (e) {
            console.error("SileroWrapper: ONNX session run failed:", e);
            // Consider resetting state on error? Maybe not, let the caller decide.
            throw e; // Re-throw the error for the caller (sileroProcessor) to handle.
        }
    }

    // --- Public Interface ---
    // Design Decision: Expose necessary functions for VAD processing.
    return {
        create: create,
        process: process,
        reset_state: reset_state,
        isAvailable: true // Mark as available if globalOrt was found initially
    };

})(window.ort); // Pass the global 'ort' object provided by ort.min.js
