// --- /vibe-player/vad/sileroWrapper.js ---
/**
 * @namespace AudioApp.sileroWrapper
 * @description Wraps the ONNX Runtime session for the Silero VAD model.
 * Manages ONNX session creation (including WASM backend loading), state tensors (_h, _c),
 * and performs inference calls. This module makes the ONNX Runtime interaction specific
 * to the Silero VAD model structure.
 * Depends on the global 'ort' object (from ort.min.js) and AudioApp.config.
 */
var AudioApp = AudioApp || {}; // Ensure namespace exists

AudioApp.sileroWrapper = (function(globalOrt) { // Pass global ort object
    'use strict';

    // --- Dependency Checks ---
    if (!globalOrt) {
        console.error("SileroWrapper: CRITICAL - ONNX Runtime (ort) object not found globally! Ensure ort.min.js is loaded before this script.");
        // Return a non-functional public interface
        return {
            /** @returns {Promise<boolean>} */ create: () => { console.error("SileroWrapper disabled: ONNX Runtime missing."); return Promise.resolve(false); },
            /** @returns {Promise<number>} */ process: () => Promise.reject(new Error("ONNX Runtime not available")),
            reset_state: () => { console.error("SileroWrapper disabled: ONNX Runtime missing."); },
            isAvailable: false // Public flag indicating usability
        };
    }
    if (typeof AudioApp.config === 'undefined') {
        console.error("SileroWrapper: CRITICAL - AudioApp.config not found! Ensure config.js is loaded before this script.");
        // Return non-functional interface
        return {
             create: () => { console.error("SileroWrapper disabled: Config missing."); return Promise.resolve(false); },
             process: () => Promise.reject(new Error("Config missing")), reset_state: () => {}, isAvailable: false
        };
    }

    // --- Module State ---
    /** @type {ort.InferenceSession|null} The ONNX inference session. Null until create() succeeds. */
    let session = null;
    /** @type {ort.Tensor|null} Tensor holding the required sample rate (e.g., 16000). */
    let _sr = null; // Sample rate tensor (name matches model input)
    /** @type {ort.Tensor|null} Hidden state 'h' tensor for the VAD model's RNN. */
    let _h = null;
    /** @type {ort.Tensor|null} Hidden state 'c' tensor for the VAD model's RNN. */
    let _c = null;

    // --- Constants based on Silero VAD model structure ---
    // These dimensions [num_layers*num_directions, batch_size, hidden_size] are typical for Silero.
    const STATE_DIMS = [2, 1, 64];
    const STATE_SIZE = STATE_DIMS.reduce((a, b) => a * b, 1); // Calculate total elements (128)

    // --- Public Methods ---

    /**
     * Creates and loads the Silero VAD ONNX InferenceSession if it doesn't already exist.
     * Configures ONNX Runtime Web options, especially WASM paths from AudioApp.config.
     * This function is idempotent: safe to call multiple times; will only create the session once.
     * It implicitly handles loading the ORT WASM backend on the first successful call.
     * @param {number} sampleRate - The required sample rate (must match model, e.g., 16000 from config).
     * @param {string} [uri=AudioApp.config.VAD_MODEL_PATH] - Path to the ONNX model file.
     * @returns {Promise<boolean>} - True if session exists or was created successfully, false otherwise.
     * @public
     */
    async function create(sampleRate, uri = AudioApp.config.VAD_MODEL_PATH) {
        // --- Idempotency Check ---
        if (session) {
            // console.log("SileroWrapper: Session already exists.");
            // Ensure state is reset if called again (e.g., for a new file processing sequence)
            try { reset_state(); } catch (e) { console.warn("SileroWrapper: Error resetting state for existing session:", e); }
            return true; // Session already created and ready
        }
        // --- End Idempotency Check ---

        // ONNX Runtime Web Execution Provider options
        const options = {
            executionProviders: ["wasm"], // Use WebAssembly backend is primary target
            logSeverityLevel: 3, // 0:V, 1:I, 2:W, 3:E(Error), 4:F(Fatal) - Reduce console noise
            logVerbosityLevel: 3, // Default is 0
            // Configure WASM options using path from config.js
            wasm: {
                // This tells ORT where to find ort-wasm.wasm, ort-wasm-simd.wasm, etc.
                // Path should be relative to the main HTML file (index.html).
                wasmPaths: AudioApp.config.LIB_PATH
            }
        };

        try {
            console.log(`SileroWrapper: Attempting to create ONNX InferenceSession from ${uri}...`);
            console.log("SileroWrapper: Using ONNX Runtime options:", options);

            // --- Session Creation ---
            // This promise handles loading the WASM backend and the .onnx model file.
            session = await globalOrt.InferenceSession.create(uri, options);
            // --- End Session Creation ---

            // --- Create Persistent Tensors ---
            // Sample Rate Tensor (_sr): int64, requires BigInt
            _sr = new globalOrt.Tensor("int64", [BigInt(sampleRate)], [1]);

            // Initialize State Tensors (_h, _c)
            reset_state(); // Creates zero-filled tensors

            console.log("SileroWrapper: ONNX session and initial tensors created successfully.");
            return true; // Indicate success

        } catch (e) {
            console.error("SileroWrapper: Failed to create ONNX InferenceSession:", e);
            // Provide hints for common issues
            if (e.message.includes("WebAssembly") || e.message.includes(".wasm") || e.message.includes("404")) {
                console.error(`SileroWrapper: Hint - Check if ONNX Runtime WASM files (e.g., ort-wasm.wasm) exist in '${AudioApp.config.LIB_PATH}' and are served correctly. Also verify model path '${uri}'.`);
            } else if (e.message.includes("model")) {
                 console.error(`SileroWrapper: Hint - Verify the ONNX model file exists at '${uri}' and is valid.`);
            }
            // Ensure state is null on failure
            session = null; _sr = null; _h = null; _c = null;
            return false; // Indicate failure
        }
    }

    /**
     * Resets the hidden state tensors (_h, _c) of the VAD model RNN to zero.
     * MUST be called before processing a new audio file or independent segment.
     * Safe to call even if session creation failed (will do nothing gracefully).
     * @public
     */
    function reset_state() {
        // Requires globalOrt to create new tensors. If it's missing, we can't reset.
        if (!globalOrt) {
            // console.error("SileroWrapper: Cannot reset state - ONNX Runtime not available.");
            return; // Gracefully do nothing if ORT is missing
        }
        try {
            // Create zero-filled Float32Arrays for the state tensors.
            const stateZeros = new Float32Array(STATE_SIZE).fill(0);
            // Create new Tensor objects for _h and _c.
            _h = new globalOrt.Tensor("float32", stateZeros, STATE_DIMS);
            _c = new globalOrt.Tensor("float32", stateZeros, STATE_DIMS);
             // console.log("SileroWrapper: Model state tensors (_h, _c) reset."); // Optional: Less verbose logging
        } catch (tensorError) {
             // This might happen if globalOrt exists but tensor creation fails
             console.error("SileroWrapper: Error creating state tensors during reset:", tensorError);
             _h = null; _c = null; // Ensure state is invalid if creation fails
        }
    }

    /**
     * Processes a single audio frame through the loaded VAD model.
     * Requires `create()` to have been called successfully first.
     * Updates the internal state tensors (_h, _c) for the next frame's context.
     * @param {Float32Array} audioFrame - The audio data for one frame (e.g., 1536 samples @ 16kHz).
     *                                     Data MUST be Float32Array.
     * @returns {Promise<number>} - The VAD probability score (typically 0.0 to 1.0) for the frame.
     * @throws {Error} If the session is not initialized, tensors are missing, or inference fails.
     * @public
     */
    async function process(audioFrame) {
        // --- Pre-conditions Check ---
        if (!session || !_sr || !_h || !_c) {
            // This error means create() likely failed or state tensors weren't initialized.
            throw new Error("SileroWrapper.process: VAD session or required tensors not initialized. Call create() successfully first and ensure reset_state() worked.");
        }
        if (!(audioFrame instanceof Float32Array)) {
            // Silero model strictly expects Float32Array input.
             console.error("SileroWrapper.process: Input audioFrame MUST be a Float32Array.");
             // Attempting conversion here might hide performance issues elsewhere.
             // It's better to ensure the caller provides the correct type.
             throw new Error("SileroWrapper: Invalid audioFrame type. Expected Float32Array.");
        }
        // --- End Pre-conditions Check ---

        try {
            // 1. Create Input Tensor for the audio frame
            // Shape [batch_size, num_samples], batch_size is 1 for single frame processing.
            const inputTensor = new globalOrt.Tensor("float32", audioFrame, [1, audioFrame.length]);

            // 2. Prepare the 'feeds' object
            // Keys MUST match the exact input names expected by the silero_vad.onnx model.
            const feeds = {
                "input": inputTensor, // Model expects input named "input"
                "sr": _sr,           // Sample rate tensor (int64)
                "h": _h,             // Previous hidden state h
                "c": _c              // Previous cell state c
            };

            // 3. Run Inference
            // The result is a map where keys are output names defined in the model.
            const outputMap = await session.run(feeds);

            // 4. Update Internal State Tensors
            // The Silero VAD model typically outputs the new state tensors named 'hn' and 'cn'.
            if (outputMap.hn && outputMap.cn) {
                // IMPORTANT: Replace the old state tensors with the new ones returned by the model.
                _h = outputMap.hn;
                _c = outputMap.cn;
            } else {
                 // If state names differ in a specific model version, log a warning.
                 console.warn("SileroWrapper: Model did not return expected state outputs named 'hn' and 'cn'. RNN state will not update correctly for subsequent frames.");
                 // Decide if this should be a fatal error. For now, warn and proceed to get probability.
            }

            // 5. Extract VAD Probability Output
            // The primary output containing the VAD score is usually named 'output'.
            if (outputMap.output && outputMap.output.data) {
                // The output tensor usually contains a single probability value.
                // Ensure data exists and access the first element.
                const probability = outputMap.output.data[0];
                // Optional: Clamp probability just in case model outputs slightly outside [0, 1]
                // return Math.max(0.0, Math.min(1.0, probability));
                return probability;
            } else {
                 // If the output name is different, the user needs to inspect the model structure.
                 console.error("SileroWrapper: Expected output tensor named 'output' not found in model results. Available outputs:", Object.keys(outputMap));
                 throw new Error("SileroWrapper: Could not find VAD probability in model output.");
            }
        } catch (e) {
            console.error("SileroWrapper: ONNX session run failed during inference:", e);
            // Consider resetting state on error? Maybe not, let caller handle retries/resets.
            throw e; // Re-throw the error for the caller (sileroProcessor) to handle.
        }
    }

    // --- Public Interface ---
    return {
        create: create,
        process: process,
        reset_state: reset_state,
        isAvailable: true // Mark as available because globalOrt was found initially
    };

})(window.ort); // Pass the global 'ort' object dependency

// --- /vibe-player/vad/sileroWrapper.js ---
