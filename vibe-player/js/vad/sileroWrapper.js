// --- /vibe-player/js/vad/sileroWrapper.js --- // Updated Path
// Wraps the ONNX Runtime session for the Silero VAD model.
// Manages ONNX session creation, state tensors, and inference calls.

/** @namespace AudioApp */
var AudioApp = AudioApp || {};

/**
 * @namespace AudioApp.sileroWrapper
 * @description Wraps the ONNX Runtime session for the Silero VAD (Voice Activity Detection) model.
 * This module handles the creation of an ONNX inference session, manages the model's
 * recurrent state tensors (h, c), and provides methods to process audio frames for VAD.
 * @param {object} globalOrt - The global ONNX Runtime object (typically `window.ort`).
 */
AudioApp.sileroWrapper = (function(globalOrt) {
    'use strict';

    if (!globalOrt) {
        console.error("SileroWrapper: CRITICAL - ONNX Runtime (ort) object not found globally!");
        /** @type {SileroWrapperPublicInterface} */
        const nonFunctionalInterface = {
            create: () => Promise.resolve(false),
            process: () => Promise.reject(new Error("ONNX Runtime not available")),
            reset_state: () => { console.error("SileroWrapper: ONNX Runtime not available, cannot reset state."); },
            isAvailable: () => false // Changed to a function
        };
        return nonFunctionalInterface;
    }

    /** @type {ort.InferenceSession|null} The ONNX inference session. */
    let session = null;
    /** @type {ort.Tensor|null} Tensor holding the sample rate (e.g., 16000), required as int64 by some models. */
    let sampleRateTensor = null;
    /** @type {ort.Tensor|null} Hidden state 'c' tensor for the VAD model's RNN. */
    let state_c = null;
    /** @type {ort.Tensor|null} Hidden state 'h' tensor for the VAD model's RNN. */
    let state_h = null;

    /**
     * @const
     * @private
     * @type {number[]} Standard Silero state tensor dimensions: [num_layers*num_directions, batch_size, hidden_size].
     * Example: [2*1, 1, 64] for a common configuration.
     */
    const stateDims = [2, 1, 64];
    /**
     * @const
     * @private
     * @type {number} Total number of elements in a state tensor (product of stateDims).
     */
    const stateSize = stateDims.reduce((a, b) => a * b, 1); // Calculate product of dimensions


    /**
     * Creates and loads the Silero VAD ONNX InferenceSession.
     * This function is idempotent; it will only create the session once.
     * It also initializes or resets the model's recurrent state tensors.
     * @public
     * @async
     * @param {number} sampleRate - The sample rate required by the model (e.g., 16000 Hz).
     * @param {string} [uri='./model/silero_vad.onnx'] - Path to the ONNX model file.
     * @returns {Promise<boolean>} True if the session is ready, false on failure.
     */
    async function create(sampleRate, uri = './model/silero_vad.onnx') {
        if (session) {
            console.log("SileroWrapper: Session already exists. Resetting state for potential new audio stream.");
            try { reset_state(); } catch (e) { console.warn("SileroWrapper: Error resetting state for existing session:", e); }
            return true;
        }

        /** @type {ort.InferenceSession.SessionOptions} */
        const opt = {
            executionProviders: ["wasm"],
            logSeverityLevel: 3, // 0:Verbose, 1:Info, 2:Warning, 3:Error, 4:Fatal
            logVerbosityLevel: 3, // Corresponds to logSeverityLevel for most cases
            wasm: {
                wasmPaths: 'lib/' // Path to ort-wasm.wasm, ort-wasm-simd.wasm etc. relative to HTML
            }
        };

        try {
            console.log(`SileroWrapper: Creating ONNX InferenceSession from URI: ${uri} with options:`, JSON.stringify(opt));
            session = await globalOrt.InferenceSession.create(uri, opt);
            // Sample rate tensor needs to be int64 for some Silero models
            sampleRateTensor = new globalOrt.Tensor("int64", [BigInt(sampleRate)], [1]); // Shape [1] for scalar
            reset_state(); // Initialize state tensors
            console.log("SileroWrapper: ONNX session and initial states created successfully.");
            return true;
        } catch (e) {
            const err = /** @type {Error} */ (e);
            console.error("SileroWrapper: Failed to create ONNX InferenceSession:", err.message, err.stack);
            if (err.message.includes("WebAssembly") || err.message.includes(".wasm")) {
                console.error("SileroWrapper: Hint - Ensure ONNX WASM files (e.g., ort-wasm.wasm) are in the 'lib/' folder and served correctly by the web server.");
            }
            session = null; // Ensure session is null if creation fails
            return false;
        }
    }

    /**
     * Resets the hidden state tensors (h, c) of the VAD model to zero.
     * This should be called before processing a new independent audio stream.
     * @public
     * @throws {Error} If the ONNX Runtime `ort.Tensor` constructor is not available.
     */
    function reset_state() {
        if (!globalOrt?.Tensor) {
            console.error("SileroWrapper: Cannot reset state - ONNX Runtime (ort.Tensor) is not available.");
            state_c = null; state_h = null; // Prevent further errors if process is called
            throw new Error("ONNX Runtime Tensor constructor not available. Silero VAD cannot function.");
        }
        try {
            state_c = new globalOrt.Tensor("float32", new Float32Array(stateSize).fill(0.0), stateDims);
            state_h = new globalOrt.Tensor("float32", new Float32Array(stateSize).fill(0.0), stateDims);
        } catch (tensorError) {
             const err = /** @type {Error} */ (tensorError);
             console.error("SileroWrapper: Error creating zero-filled state tensors:", err.message, err.stack);
             state_c = null; state_h = null; // Invalidate state on error
             throw err; // Re-throw to indicate failure
        }
    }

    /**
     * Processes a single audio frame through the Silero VAD model.
     * `create()` must have been successfully called before using this method.
     * The internal recurrent state of the model is updated after each call.
     * @public
     * @async
     * @param {Float32Array} audioFrame - A Float32Array of audio samples for one frame (e.g., 1536 samples at 16kHz).
     * @returns {Promise<number>} The VAD probability score (0.0 to 1.0) for the frame.
     * @throws {Error} If the session is not initialized, state tensors are missing, input is invalid, or inference fails.
     */
    async function process(audioFrame) {
        if (!session || !state_c || !state_h || !sampleRateTensor) {
            throw new Error("SileroWrapper: VAD session or state not initialized. Call create() and ensure it succeeds before processing audio.");
        }
        if (!(audioFrame instanceof Float32Array)) {
             throw new Error(`SileroWrapper: Input audioFrame must be a Float32Array, but received type ${typeof audioFrame}.`);
        }

        try {
            const inputTensor = new globalOrt.Tensor("float32", audioFrame, [1, audioFrame.length]); // Shape: [batch_size=1, num_samples]
            /** @type {Record<string, ort.Tensor>} */
            const feeds = {
                input: inputTensor,
                h: state_h,
                c: state_c,
                sr: sampleRateTensor
            };

            const outputMap = await session.run(feeds);

            if (outputMap.hn && outputMap.cn) { // 'hn' and 'cn' are typical output names for new states
                state_h = outputMap.hn;
                state_c = outputMap.cn;
            } else {
                 console.warn("SileroWrapper: Model outputs 'hn' and 'cn' for recurrent state update were not found. Subsequent VAD results may be incorrect.");
            }

            // The primary VAD probability is typically named 'output'
            if (outputMap.output?.data instanceof Float32Array && typeof outputMap.output.data[0] === 'number') {
                return outputMap.output.data[0];
            } else {
                 console.error("SileroWrapper: Unexpected model output structure. 'output' tensor with numeric data not found. Actual output:", outputMap);
                 throw new Error("SileroWrapper: Invalid model output structure for VAD probability.");
            }
        } catch (e) {
            const err = /** @type {Error} */ (e);
            console.error("SileroWrapper: ONNX session run (inference) failed:", err.message, err.stack);
            // Consider whether to reset state here or let the caller decide. For now, re-throw.
            throw err;
        }
    }

    /**
     * Checks if the Silero VAD wrapper is available and operational (ONNX Runtime loaded).
     * @public
     * @returns {boolean} True if available, false otherwise.
     */
    function isAvailable() {
        return !!globalOrt;
    }

    /**
     * @typedef {Object} SileroWrapperPublicInterface
     * @property {function(number, string=): Promise<boolean>} create - Creates the ONNX session.
     * @property {function(Float32Array): Promise<number>} process - Processes an audio frame.
     * @property {function(): void} reset_state - Resets the model's recurrent state.
     * @property {function(): boolean} isAvailable - Checks if the ONNX runtime is available.
     */

    /** @type {SileroWrapperPublicInterface} */
    return {
        create: create,
        process: process,
        reset_state: reset_state,
        isAvailable: isAvailable // Changed to a function
    };

})(window.ort);
// --- /vibe-player/js/vad/sileroWrapper.js --- // Updated Path
