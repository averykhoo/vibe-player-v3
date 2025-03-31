// --- /vibe-player/js/vad/sileroWrapper.js --- // Updated Path
// Wraps the ONNX Runtime session for the Silero VAD model.
// Manages ONNX session creation, state tensors, and inference calls.

var AudioApp = AudioApp || {}; // Ensure namespace exists

// Design Decision: Use IIFE, pass the global `ort` object dependency.
AudioApp.sileroWrapper = (function(globalOrt) {
    'use strict';

    // Check if ONNX Runtime is loaded
    if (!globalOrt) {
        console.error("SileroWrapper: CRITICAL - ONNX Runtime (ort) object not found on window!");
        return { // Return a non-functional public interface
            create: () => Promise.resolve(false),
            process: () => Promise.reject(new Error("ONNX Runtime not available")),
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
     * Resets internal state (h, c) upon successful creation or if session already exists.
     * @param {number} sampleRate - The required sample rate (must match model, e.g., 16000).
     * @param {string} [uri='./model/silero_vad.onnx'] - Path to the ONNX model file, relative to the HTML file.
     * @returns {Promise<boolean>} - True if session exists or was created successfully, false otherwise.
     * @public
     */
    async function create(sampleRate, uri = './model/silero_vad.onnx') {
        // --- Idempotency Check ---
        if (session) {
            console.log("SileroWrapper: Session already exists. Resetting state.");
            try {
                reset_state(); // Ensure state is reset for potentially new audio
            } catch (e) {
                console.warn("SileroWrapper: Error resetting state for existing session:", e);
            }
            return true; // Session already created
        }
        // --- End Idempotency Check ---

        // Configure ONNX Runtime options
        const opt = {
            executionProviders: ["wasm"], // Use WebAssembly backend
            logSeverityLevel: 3, // 0:V, 1:I, 2:W, 3:E, 4:F
            logVerbosityLevel: 3,
            // CRITICAL: Configure WASM options
            wasm: {
                // Provide the path where the .wasm files are located relative to index.html
                wasmPaths: 'lib/' // Assumes .wasm files are in the /lib/ folder
            }
        };

        try {
            console.log(`SileroWrapper: Creating ONNX InferenceSession from ${uri}...`);
            console.log("SileroWrapper: Using options:", opt);
            // --- Session Creation ---
            session = await globalOrt.InferenceSession.create(uri, opt);
            // --- End Session Creation ---

            // Create the sample rate tensor (int64 requires BigInt)
            // This tensor is reused for all process() calls.
            sampleRateTensor = new globalOrt.Tensor("int64", [BigInt(sampleRate)]);

            // Initialize state tensors immediately after session creation.
            reset_state();

            console.log("SileroWrapper: ONNX session created successfully.");
            return true; // Indicate success
        } catch (e) {
            console.error("SileroWrapper: Failed to create ONNX InferenceSession:", e);
            if (e.message.includes("WebAssembly") || e.message.includes(".wasm")) {
                console.error("SileroWrapper: Hint - Check if ONNX WASM files (e.g., ort-wasm.wasm) are present in the 'lib/' folder and served correctly.");
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
     * @throws {Error} If ONNX Runtime `ort.Tensor` constructor is unavailable.
     */
    function reset_state() {
        if (!globalOrt?.Tensor) { // Check if Tensor constructor exists
            console.error("SileroWrapper: Cannot reset state - ONNX Runtime Tensor constructor not available.");
            // Set states to null to prevent errors in process()
            state_c = null;
            state_h = null;
            throw new Error("ONNX Runtime Tensor constructor not available.");
        }
        try {
            // Create zero-filled Float32Arrays and wrap them in Tensors.
            state_c = new globalOrt.Tensor("float32", new Float32Array(stateSize).fill(0), stateDims);
            state_h = new globalOrt.Tensor("float32", new Float32Array(stateSize).fill(0), stateDims);
            // console.log("SileroWrapper: Model state tensors reset."); // Keep console less noisy
        } catch (tensorError) {
             console.error("SileroWrapper: Error creating state tensors:", tensorError);
             state_c = null; // Ensure states are null on error
             state_h = null;
             throw tensorError; // Re-throw
        }
    }

    /**
     * Processes a single audio frame through the loaded VAD model.
     * Requires `create()` to have been called successfully first.
     * Updates the internal state tensors (h, c) for the next frame.
     * @param {Float32Array} audioFrame - The audio data for one frame (e.g., 1536 samples). Must be Float32Array.
     * @returns {Promise<number>} - The VAD probability score (typically 0.0 to 1.0) for the frame.
     * @throws {Error} If the session is not initialized, state is missing, input is invalid, or inference fails.
     * @public
     */
    async function process(audioFrame) {
        // --- Pre-conditions Check ---
        if (!session || !state_c || !state_h || !sampleRateTensor) {
            throw new Error("SileroWrapper: VAD session/state not initialized. Call create() first.");
        }
        if (!(audioFrame instanceof Float32Array)) {
             // Input validation - model expects Float32Array
             throw new Error(`SileroWrapper: Input audioFrame must be a Float32Array, received ${typeof audioFrame}`);
        }
        // --- End Pre-conditions Check ---

        try {
            // Create input tensor for the audio frame. Shape [batch_size = 1, num_samples].
            const inputTensor = new globalOrt.Tensor("float32", audioFrame, [1, audioFrame.length]);

            // Prepare the 'feeds' object mapping input names expected by the Silero model to tensors.
            // These names ('input', 'h', 'c', 'sr') must match the model's definition.
            const feeds = {
                input: inputTensor,
                h: state_h,       // Previous state h
                c: state_c,       // Previous state c
                sr: sampleRateTensor // Sample rate tensor (created once in create())
            };

            // Run inference using the session
            const outputMap = await session.run(feeds);

            // IMPORTANT: Update the internal state tensors with the new states returned by the model.
            // The model outputs are typically named 'hn' and 'cn'. Check if they exist.
            if (outputMap.hn && outputMap.cn) {
                state_h = outputMap.hn; // Update state_h for the next call
                state_c = outputMap.cn; // Update state_c for the next call
            } else {
                 console.warn("SileroWrapper: Model did not return outputs named 'hn' and 'cn'. State will not be updated correctly for subsequent frames.");
                 // Consider throwing an error here if state update is critical for model function? For now, just warn.
            }

            // Extract the primary VAD probability output. Assume it's named 'output'.
            // The output is usually a tensor containing a single float value.
            if (outputMap.output && outputMap.output.data && typeof outputMap.output.data[0] === 'number') {
                return outputMap.output.data[0]; // Return the probability score
            } else {
                 console.error("SileroWrapper: Model output map:", outputMap); // Log the actual output for debugging
                 throw new Error("SileroWrapper: Expected output tensor named 'output' with numeric data not found in model results.");
            }
        } catch (e) {
            console.error("SileroWrapper: ONNX session run failed:", e);
            // Don't reset state here, let the caller handle recovery if needed.
            throw e; // Re-throw the error for the caller (sileroProcessor) to handle.
        }
    }

    // --- Public Interface ---
    return {
        create: create,
        process: process,
        reset_state: reset_state,
        isAvailable: true // Mark as available if globalOrt was found initially
    };

})(window.ort); // Pass the global 'ort' object provided by ort.min.js
// --- /vibe-player/js/vad/sileroWrapper.js --- // Updated Path
