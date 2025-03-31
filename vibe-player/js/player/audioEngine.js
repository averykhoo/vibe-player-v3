// --- /vibe-player/js/player/audioEngine.js --- // Updated Path
// Manages Web Audio API, AudioWorklet loading/communication, decoding, resampling, and playback control.
// Uses Rubberband WASM via an AudioWorkletProcessor for time-stretching and pitch/formant shifting.

var AudioApp = AudioApp || {}; // Ensure namespace exists

AudioApp.audioEngine = (function() {
    'use strict';

    // --- Web Audio API & Worklet State ---
    /** @type {AudioContext|null} */ let audioCtx = null;
    /** @type {GainNode|null} */ let gainNode = null;
    /** @type {AudioWorkletNode|null} */ let workletNode = null;
    /** @type {AudioBuffer|null} */ let currentDecodedBuffer = null;

    /** @type {boolean} */ let isPlaying = false; // Tracks the *desired* state sent to worklet
    /** @type {boolean} */ let workletReady = false;
    /** @type {number} */ let currentWorkletTime = 0.0; // Source time tracked by worklet/seek commands
    /** @type {number} */ let currentPlaybackSpeed = 1.0;
    /** @type {number} */ let currentPitchScale = 1.0;
    /** @type {number} */ let currentFormantScale = 1.0;

    // --- WASM Resources ---
    /** @type {ArrayBuffer|null} */ let wasmBinary = null;
    /** @type {string|null} */ let loaderScriptText = null;

    // --- Constants REMOVED - Now use AudioApp.Constants ---
    // const PROCESSOR_SCRIPT_URL = 'js/player/rubberbandProcessor.js'; // REMOVED
    // const PROCESSOR_NAME = 'rubberband-processor'; // REMOVED
    // const WASM_BINARY_URL = 'lib/rubberband.wasm'; // REMOVED
    // const LOADER_SCRIPT_URL = 'lib/rubberband-loader.js'; // REMOVED

    // --- Initialization ---

    /**
     * Initializes the Audio Engine.
     * @public
     */
    async function init() {
        console.log("AudioEngine: Initializing...");
        setupAudioContext();
        await preFetchWorkletResources();
        console.log("AudioEngine: Initialized.");
    }

    // --- Setup & Resource Fetching ---

    /**
     * Creates/resets the AudioContext and GainNode.
     * @private
     * @returns {boolean} True if context is ready.
     */
    function setupAudioContext() {
        // Check if context exists and is not closed
        if (audioCtx && audioCtx.state !== 'closed') { return true; }
        try {
            // Explicitly log if recreating a closed context
            if (audioCtx && audioCtx.state === 'closed') {
                 console.log("AudioEngine: Recreating closed AudioContext.");
            }
            // Create new AudioContext and GainNode
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            gainNode = audioCtx.createGain();
            gainNode.gain.value = 1.0; // Default gain
            gainNode.connect(audioCtx.destination);
            workletNode = null; // Reset worklet node reference
            workletReady = false; // Reset worklet ready state
            console.log(`AudioEngine: AudioContext created/reset (state: ${audioCtx.state}). Sample Rate: ${audioCtx.sampleRate}`);
            // Warn if context starts suspended (requires user interaction)
            if (audioCtx.state === 'suspended') {
                 console.warn("AudioEngine: AudioContext is suspended. User interaction needed.");
            }
            return true;
        } catch (e) {
             // Handle context creation errors
             console.error("AudioEngine: Failed to create AudioContext.", e);
             audioCtx = null; gainNode = null; workletNode = null; workletReady = false;
             dispatchEngineEvent('audioapp:engineError', { type: 'context', error: new Error("Web Audio API not supported") });
             return false;
        }
    }

    /**
     * Fetches WASM resources (binary and loader script).
     * Uses paths from AudioApp.Constants.
     * @private
     * @returns {Promise<void>}
     */
    async function preFetchWorkletResources() {
        console.log("AudioEngine: Pre-fetching WASM resources...");
        try {
            // Ensure Constants module is loaded
            if (!AudioApp.Constants) {
                throw new Error("AudioApp.Constants not found.");
            }

            // Fetch WASM binary
            const wasmResponse = await fetch(AudioApp.Constants.WASM_BINARY_URL); // Use Constant
            if (!wasmResponse.ok) throw new Error(`Fetch failed ${wasmResponse.status} for ${AudioApp.Constants.WASM_BINARY_URL}`);
            wasmBinary = await wasmResponse.arrayBuffer();
            console.log(`AudioEngine: Fetched WASM binary (${wasmBinary.byteLength} bytes).`);

            // Fetch loader script text
            const loaderResponse = await fetch(AudioApp.Constants.LOADER_SCRIPT_URL); // Use Constant
            if (!loaderResponse.ok) throw new Error(`Fetch failed ${loaderResponse.status} for ${AudioApp.Constants.LOADER_SCRIPT_URL}`);
            loaderScriptText = await loaderResponse.text();
            console.log(`AudioEngine: Fetched Loader Script text (${loaderScriptText.length} chars).`);
        } catch (fetchError) {
            // Handle fetch errors
            console.error("AudioEngine: Failed to fetch WASM/Loader resources:", fetchError);
            wasmBinary = null; loaderScriptText = null;
            dispatchEngineEvent('audioapp:engineError', { type: 'resource', error: fetchError });
        }
    }

    // --- Loading, Decoding, Resampling Pipeline ---

    /**
     * Loads the selected audio file, decodes it, and sets up the AudioWorklet.
     * Resampling for VAD is now handled separately by the caller (app.js).
     * @param {File} file - The audio file selected by the user.
     * @returns {Promise<void>} Resolves when setup is complete or rejects on error.
     * @throws {Error} If any critical step fails (context creation, decoding, worklet setup).
     * @public
     */
     async function loadAndProcessFile(file) {
        // Ensure AudioContext is ready, attempt resume if suspended
        if (!audioCtx || audioCtx.state === 'closed') {
             console.error("AudioEngine: AudioContext not available.");
             if (!setupAudioContext()) { throw new Error("AudioContext could not be created/reset."); }
        }
        if (audioCtx.state === 'suspended') {
             console.log("AudioEngine: Attempting to resume suspended AudioContext...");
             await audioCtx.resume().catch(e => console.warn("AudioEngine: Context resume failed.", e));
             if (audioCtx.state !== 'running') {
                 throw new Error(`AudioContext could not be resumed (state: ${audioCtx.state}). User interaction might be required.`);
             }
        }

        // Clean up previous worklet and reset state for the new file
        await cleanupCurrentWorklet();
        currentDecodedBuffer = null;
        isPlaying = false;
        currentWorkletTime = 0.0;
        currentPlaybackSpeed = 1.0; // Reset speed/pitch/formant on new file
        currentPitchScale = 1.0;
        currentFormantScale = 1.0;

        try {
            // Decode audio data
            const arrayBuffer = await file.arrayBuffer();
            console.log("AudioEngine: Decoding audio data...");
            currentDecodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            console.log(`AudioEngine: Decoded ${currentDecodedBuffer.duration.toFixed(2)}s @ ${currentDecodedBuffer.sampleRate}Hz`);
            // Dispatch event immediately after decoding
            dispatchEngineEvent('audioapp:audioLoaded', { audioBuffer: currentDecodedBuffer });

            // --- Resampling REMOVED from this pipeline ---

            // Setup AudioWorklet
            if (!wasmBinary || !loaderScriptText) {
                throw new Error("Cannot setup Worklet: WASM/Loader resources missing.");
            }
            await setupAndStartWorklet(currentDecodedBuffer);

        } catch (error) {
            // Catch errors during the loading pipeline
            console.error("AudioEngine: Error during load/decode/worklet setup:", error);
            currentDecodedBuffer = null; // Clear buffer on error
            // Determine specific error type for event dispatch
            const errorType = error.message.includes("decodeAudioData") ? 'decodingError'
                              : error.message.includes("Worklet") ? 'workletError'
                              : 'loadError';
            dispatchEngineEvent(`audioapp:${errorType}`, { error: error });
            throw error; // Re-throw for app.js to handle UI reset
        }
    }


    /**
     * Resamples an AudioBuffer to 16kHz mono Float32Array using OfflineAudioContext.
     * Uses VAD_SAMPLE_RATE from AudioApp.Constants.
     * @param {AudioBuffer} audioBuffer - The original decoded audio buffer.
     * @returns {Promise<Float32Array>} A promise resolving to the resampled PCM data.
     * @throws {Error} If resampling fails or OfflineAudioContext cannot be created.
     * @private
     */
    function convertAudioBufferTo16kHzMonoFloat32(audioBuffer) {
        // Ensure Constants module is loaded
        if (!AudioApp.Constants) {
            return Promise.reject(new Error("AudioApp.Constants not found for resampling."));
        }
        const targetSampleRate = AudioApp.Constants.VAD_SAMPLE_RATE; // Use Constant
        const targetLength = Math.ceil(audioBuffer.duration * targetSampleRate);

        // Handle zero-length audio gracefully
        if (!targetLength || targetLength <= 0) {
            console.warn("AudioEngine: Zero length calculated for resampling.");
            return Promise.resolve(new Float32Array(0));
        }

        try {
            // Use OfflineAudioContext for high-quality resampling
            const offlineCtx = new OfflineAudioContext(
                1, // Mono output
                targetLength,
                targetSampleRate
            );
            const src = offlineCtx.createBufferSource();
            src.buffer = audioBuffer;
            src.connect(offlineCtx.destination);
            src.start();
            // Start rendering and return the promise
            return offlineCtx.startRendering().then(renderedBuffer => {
                 return renderedBuffer.getChannelData(0); // Get the single channel data
            }).catch(err => {
                 console.error("AudioEngine: Resampling rendering error:", err);
                 throw new Error(`Audio resampling failed: ${err.message}`);
            });
        } catch (offlineCtxError) {
            // Catch potential errors creating the OfflineAudioContext
            console.error("AudioEngine: OfflineContext creation error:", offlineCtxError);
            return Promise.reject(new Error(`OfflineContext creation failed: ${offlineCtxError.message}`));
        }
    }

     /**
     * Public wrapper to resample an AudioBuffer to 16kHz mono Float32Array.
     * Calls the internal resampling logic.
     * @param {AudioBuffer} audioBuffer - The original decoded audio buffer.
     * @returns {Promise<Float32Array>} A promise resolving to the resampled PCM data.
     * @throws {Error} If resampling fails or OfflineAudioContext cannot be created.
     * @public
     */
    async function resampleTo16kMono(audioBuffer) {
        console.log("AudioEngine: Resampling audio to 16kHz mono...");
        // Delegate to the existing private function
        try {
             const pcm16k = await convertAudioBufferTo16kHzMonoFloat32(audioBuffer);
             console.log(`AudioEngine: Resampled to ${pcm16k.length} samples @ 16kHz`);
             return pcm16k;
        } catch(error) {
             console.error("AudioEngine: Error during public resampling call:", error);
             // Dispatch a specific resampling error event if needed by app.js
             dispatchEngineEvent('audioapp:resamplingError', { error: error });
             throw error; // Re-throw for the caller (app.js background task)
        }
    }

    // --- AudioWorklet Setup and Communication ---

    /**
     * Cleans up the existing AudioWorkletNode by disconnecting and nullifying references.
     * Sends a 'cleanup' message to the processor.
     * @private
     * @returns {Promise<void>} Resolves once cleanup attempt is complete.
     */
    async function cleanupCurrentWorklet() {
        workletReady = false; // Mark as not ready
        if (workletNode) {
            console.log("[AudioEngine] Cleaning up previous worklet node...");
            try {
                // Ask processor to clean up its internal state
                postWorkletMessage({ type: 'cleanup' });
                // Give processor a brief moment to handle message
                await new Promise(resolve => setTimeout(resolve, 50));

                // Remove listeners and disconnect node
                if (workletNode && workletNode.port) {
                    workletNode.port.onmessage = null;
                    workletNode.onprocessorerror = null;
                }
                if (workletNode) {
                    workletNode.disconnect();
                }
                console.log("[AudioEngine] Previous worklet node disconnected.");
            } catch (e) {
                console.warn("[AudioEngine] Error during worklet cleanup:", e);
            } finally {
                // Ensure node reference is cleared
                workletNode = null;
            }
        }
    }

    /**
     * Adds the AudioWorklet module, creates the AudioWorkletNode, connects it,
     * and sends initial configuration and audio data to the processor.
     * Uses paths/names from AudioApp.Constants.
     * @param {AudioBuffer} decodedBuffer - The decoded audio buffer to send to the worklet.
     * @private
     * @returns {Promise<void>} Resolves when the worklet node is set up and data sent.
     * @throws {Error} If prerequisites are missing or worklet setup fails.
     */
    async function setupAndStartWorklet(decodedBuffer) {
        // Verify all necessary components are available
        if (!audioCtx || !decodedBuffer || !wasmBinary || !loaderScriptText || !gainNode || !AudioApp.Constants) {
            throw new Error("Cannot setup worklet - prerequisites missing (context, buffer, wasm, gain, constants).");
        }

        // Ensure any previous worklet is cleaned up first
        await cleanupCurrentWorklet();

        try {
            // Add the processor script as a module using path from Constants
            console.log(`[AudioEngine] Adding AudioWorklet module: ${AudioApp.Constants.PROCESSOR_SCRIPT_URL}`);
            await audioCtx.audioWorklet.addModule(AudioApp.Constants.PROCESSOR_SCRIPT_URL); // Use Constant
            console.log("[AudioEngine] AudioWorklet module added.");

            // Prepare WASM data for transfer (create a copy)
            const wasmBinaryTransfer = wasmBinary.slice(0);

            // Prepare options to pass to the processor constructor
            // CRITICAL: Pass the actual context sample rate
            const processorOpts = {
                sampleRate: audioCtx.sampleRate,
                numberOfChannels: decodedBuffer.numberOfChannels,
                wasmBinary: wasmBinaryTransfer,
                loaderScriptText: loaderScriptText // Pass loader script text
            };
            const transferListWasm = [wasmBinaryTransfer]; // Mark binary for transfer

            console.log("[AudioEngine] Creating AudioWorkletNode with options:", processorOpts);
            // Create the AudioWorkletNode using name from Constants
            workletNode = new AudioWorkletNode(audioCtx, AudioApp.Constants.PROCESSOR_NAME, { // Use Constant
                numberOfInputs: 0, // No audio input from other nodes
                numberOfOutputs: 1, // One audio output
                outputChannelCount: [decodedBuffer.numberOfChannels], // Match source channel count
                processorOptions: processorOpts // Pass constructor options
            });

            // Setup message handler and error handler for the node
            setupWorkletMessageHandler();
            workletNode.onprocessorerror = (event) => {
                console.error(`[AudioEngine] Critical Processor Error:`, event);
                dispatchEngineEvent('audioapp:engineError', { type: 'workletProcessor', error: new Error("Processor crashed") });
                cleanupCurrentWorklet(); // Ensure cleanup on crash
                workletReady = false; // Mark as not ready
                isPlaying = false; // Reset playback state
                dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: false });
            };

            // Connect the worklet node to the gain node (which connects to destination)
            workletNode.connect(gainNode);
            console.log("[AudioEngine] AudioWorkletNode created and connected.");

            // Prepare audio channel data for transfer
            const channelData = [];
            const transferListAudio = [];
            for (let i = 0; i < decodedBuffer.numberOfChannels; i++) {
                const dataArray = decodedBuffer.getChannelData(i);
                // Create a copy of the underlying ArrayBuffer for transfer
                const bufferCopy = dataArray.buffer.slice(dataArray.byteOffset, dataArray.byteOffset + dataArray.byteLength);
                channelData.push(bufferCopy);
                transferListAudio.push(bufferCopy); // Add buffer copy to transfer list
            }

            // Send the initial audio data to the worklet
            console.log(`[AudioEngine] Sending audio data (${channelData.length} channels) to worklet...`);
            postWorkletMessage({ type: 'load-audio', channelData: channelData }, transferListAudio);

        } catch (error) {
            console.error("[AudioEngine] Error setting up Worklet Node:", error);
            await cleanupCurrentWorklet(); // Attempt cleanup on error
            throw error; // Re-throw for app.js
        }
    }

    /**
     * Sets up the onmessage handler for the current workletNode's port
     * to receive messages from the processor.
     * @private
     */
    function setupWorkletMessageHandler() {
        if (!workletNode || !workletNode.port) return; // Ensure node and port exist

        workletNode.port.onmessage = (event) => {
            const data = event.data;
            switch(data.type) {
                case 'status':
                    // Handle status updates from the worklet
                    console.log(`[WorkletStatus] ${data.message}`);
                    if (data.message === 'processor-ready') {
                        workletReady = true;
                        dispatchEngineEvent('audioapp:workletReady');
                    } else if (data.message === 'Playback ended') {
                        // Let app.js handle UI changes based on this event
                        dispatchEngineEvent('audioapp:playbackEnded');
                    } else if (data.message === 'Processor cleaned up') {
                        // Processor confirmed cleanup
                        workletReady = false;
                        isPlaying = false; // Ensure state consistency
                    }
                    break;
                case 'error':
                    // Handle errors reported by the worklet during runtime
                    console.error(`[WorkletError] ${data.message}`);
                    dispatchEngineEvent('audioapp:engineError', { type: 'workletRuntime', error: new Error(data.message) });
                    workletReady = false; // Mark as not ready on error
                    isPlaying = false; // Reset playback state
                    dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: false });
                    break;
                case 'playback-state':
                    // Worklet confirms its internal playback state
                    // Dispatch event for app.js to update its `isActuallyPlaying` flag
                    dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: data.isPlaying });
                    break;
                case 'time-update':
                    // Received time update from worklet (based on its internal calculation)
                    // Update the engine's internal `currentWorkletTime`
                    // This value is used as the base for seeks and the main thread's time calculation
                    if (typeof data.currentTime === 'number' && currentDecodedBuffer) {
                        currentWorkletTime = data.currentTime;
                        // NOTE: We no longer dispatch 'audioapp:timeUpdated' for UI updates from here.
                        // app.js uses requestAnimationFrame and AudioContext.currentTime for UI.
                    }
                    break;
                default:
                    console.warn("[AudioEngine] Unhandled message from worklet:", data.type);
            }
        };
    }

    /**
     * Helper function to safely post messages to the AudioWorkletProcessor.
     * Includes error handling for potential detached port issues.
     * @param {object} message - The message object to send.
     * @param {Transferable[]} [transferList=[]] - Optional array of transferable objects.
     * @private
     */
    function postWorkletMessage(message, transferList = []) {
        if (workletNode && workletNode.port) {
            try {
                // Attempt to post the message
                workletNode.port.postMessage(message, transferList);
            } catch (error) {
                // Handle errors, often occurs if the port is closed or detached
                console.error("[AudioEngine] Error posting message:", error, message.type);
                // Don't dispatch error during cleanup attempts
                if (message.type !== 'cleanup') {
                    dispatchEngineEvent('audioapp:engineError', { type: 'workletComm', error: error });
                }
                // Attempt cleanup or handle error state more gracefully
                cleanupCurrentWorklet();
                workletReady = false;
                isPlaying = false;
                dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: false });
            }
        } else {
            // Warn if trying to post when node/port isn't ready, unless it's a cleanup message
            if (workletReady || message.type !== 'cleanup') {
                console.warn(`[AudioEngine] Cannot post msg (${message.type}): Worklet node/port not ready.`);
            }
        }
    }

    // --- Playback Control Methods (Public) ---

    /**
     * Toggles the playback state (play/pause).
     * Resumes the AudioContext if necessary. Sends message to the worklet.
     * Updates the internal `isPlaying` flag which tracks the *desired* state.
     * @public
     */
    async function togglePlayPause() {
        // Ensure worklet and context are ready
        if (!workletReady) { console.warn("AudioEngine: Worklet not ready."); return; }
        if (!audioCtx) { console.error("AudioEngine: AudioContext missing."); return;}

        // Resume context if suspended
        if (audioCtx.state === 'suspended') {
            console.log("[AudioEngine] Resuming AC on user interaction...");
            try {
                await audioCtx.resume();
                console.log("[AudioEngine] AC resumed.");
            } catch (err) {
                console.error("[AudioEngine] Failed to resume AC:", err);
                dispatchEngineEvent('audioapp:engineError', { type: 'contextResume', error: err });
                return; // Abort if context cannot be resumed
            }
        }
        // Ensure context is running before proceeding
        if (audioCtx.state !== 'running') {
            console.error(`AudioEngine: AC not running (state: ${audioCtx.state}). Cannot toggle playback.`);
            return;
        }

        // Determine the target state and send message
        const targetIsPlaying = !isPlaying; // Toggle the desired state
        postWorkletMessage({ type: targetIsPlaying ? 'play' : 'pause' });
        isPlaying = targetIsPlaying; // Update internal *desired* state immediately
        console.log(`[AudioEngine] Sent ${targetIsPlaying ? 'play' : 'pause'} message.`);
        // Actual confirmation and UI update handled by app.js via 'playbackStateChanged' event
    }

    /**
     * Jumps the playback position relative to the current *source* time.
     * @param {number} seconds - The number of seconds to jump (positive or negative).
     * @public
     */
    function jumpBy(seconds) {
        if (!workletReady || !currentDecodedBuffer) return;
        // Seek relative to the internally tracked source time (`currentWorkletTime`)
        seek(currentWorkletTime + seconds);
    }

    /**
     * Seeks the playback position to an absolute *source* time.
     * Updates the internal source time tracker and sends a 'seek' message to the worklet.
     * @param {number} time - The target time in seconds within the source audio.
     * @public
     */
    function seek(time) {
        if (!workletReady || !currentDecodedBuffer || isNaN(currentDecodedBuffer.duration)) return;
        // Clamp the target time to the valid audio duration
        const targetTime = Math.max(0, Math.min(time, currentDecodedBuffer.duration));
        // Send seek command to the worklet processor
        postWorkletMessage({ type: 'seek', positionSeconds: targetTime });
        // Update the internal source time immediately
        // This is crucial for the main thread's time calculation if seek happens while paused
        currentWorkletTime = targetTime;
        console.log(`[AudioEngine] Sent seek message: ${targetTime.toFixed(2)}s`);
        // UI updates based on this seek are handled by app.js
    }

    /**
     * Sets the playback speed (rate). Sends message to the worklet.
     * Dispatches an internal event for app.js to track the speed change.
     * @param {number} speed - The desired playback speed (e.g., 1.0 is normal).
     * @public
     */
    function setSpeed(speed) {
         // Clamp speed to a reasonable range
         const rate = Math.max(0.25, Math.min(parseFloat(speed) || 1.0, 2.0));
         // Only send message and update state if the speed actually changes
         if (currentPlaybackSpeed !== rate) {
             currentPlaybackSpeed = rate;
             console.log(`[AudioEngine] Speed target set to ${rate.toFixed(2)}x`);
             if (workletReady) {
                 postWorkletMessage({ type: 'set-speed', value: rate });
             }
             // Notify app.js about the speed change for its time calculation
             dispatchEngineEvent('audioapp:internalSpeedChanged', { speed: rate });
         }
    }

    /**
     * Sets the pitch shift scale. Sends message to the worklet.
     * @param {number} pitch - The desired pitch scale (e.g., 1.0 is normal, 1.1 is higher).
     * @public
     */
    function setPitch(pitch) {
        // Clamp pitch scale to a reasonable range
        const scale = Math.max(0.25, Math.min(parseFloat(pitch) || 1.0, 2.0)); // Adjusted min to 0.25 to match slider
        // Only send message if the scale changes
        if (currentPitchScale !== scale) {
            currentPitchScale = scale;
            console.log(`[AudioEngine] Pitch target set to ${scale.toFixed(2)}x`);
            if (workletReady) {
                postWorkletMessage({ type: 'set-pitch', value: scale });
            }
        }
    }

    /**
     * Sets the formant shift scale. Sends message to the worklet.
     * @param {number} formant - The desired formant scale (e.g., 1.0 is normal).
     * @public
     */
    function setFormant(formant) {
        // Clamp formant scale to a reasonable range
        const scale = Math.max(0.5, Math.min(parseFloat(formant) || 1.0, 2.0));
        // Only send message if the scale changes
        if (currentFormantScale !== scale) {
            currentFormantScale = scale;
            console.log(`[AudioEngine] Formant target set to ${scale.toFixed(2)}x`);
            if (workletReady) {
                postWorkletMessage({ type: 'set-formant', value: scale });
            }
        }
    }

    /**
     * Sets the master gain (volume) level smoothly.
     * @param {number} gain - The desired gain level (e.g., 1.0 is normal, clamped 0.0 to 5.0).
     * @public
     */
    function setGain(gain) {
        // Ensure gainNode and context are available
        if (!gainNode || !audioCtx || audioCtx.state === 'closed') {
            console.warn("AudioEngine: Cannot set gain - GainNode/Context missing.");
            return;
        }
        // Clamp gain value
        const value = Math.max(0.0, Math.min(parseFloat(gain) || 1.0, 5.0)); // Range 0 to 5
        // Use setTargetAtTime for a smooth transition (avoids clicks)
        // The third parameter is the time constant for the exponential change
        gainNode.gain.setTargetAtTime(value, audioCtx.currentTime, 0.015);
    }

    /**
     * Gets the current internally tracked *source* playback time and the total audio duration.
     * Used as the base time for seeks and the main thread's time calculation.
     * @returns {{currentTime: number, duration: number}} Object containing currentTime and duration.
     * @public
     */
    function getCurrentTime() {
        // Returns the internally tracked source time (updated by worklet 'time-update' or seek actions)
        return {
            currentTime: currentWorkletTime,
            duration: currentDecodedBuffer ? currentDecodedBuffer.duration : 0
        };
    }

    /**
     * Provides access to the current AudioContext instance. Used by app.js for accurate timekeeping.
     * @returns {AudioContext|null} The active AudioContext, or null if none exists.
     * @public
     */
    function getAudioContext() {
        return audioCtx;
    }


     // --- Cleanup ---

    /**
     * Cleans up all audio resources, including the AudioContext and worklet.
     * Should be called when the application is closing or unloading.
     * @public
     */
    function cleanup() {
        console.log("AudioEngine: Cleaning up resources...");
        // First, try to clean up the worklet node gracefully
        cleanupCurrentWorklet().finally(() => {
            // Then, close the AudioContext if it exists and is not already closed
            if (audioCtx && audioCtx.state !== 'closed') {
                audioCtx.close().then(() => console.log("AudioEngine: AudioContext closed."))
                           .catch(e => console.warn("AudioEngine: Error closing AudioContext:", e));
            }
            // Nullify all references to allow garbage collection
            audioCtx = null;
            gainNode = null;
            workletNode = null;
            currentDecodedBuffer = null;
            wasmBinary = null;
            loaderScriptText = null;
            workletReady = false;
            isPlaying = false;
            currentWorkletTime = 0.0;
            currentPlaybackSpeed = 1.0;
            currentPitchScale = 1.0;
            currentFormantScale = 1.0;
        });
    }

    // --- Utility & Dispatch Helper ---

    /**
     * Dispatches a custom event on the main document.
     * @param {string} eventName - The name of the custom event.
     * @param {object} [detail={}] - Optional data to pass with the event.
     * @private
     */
    function dispatchEngineEvent(eventName, detail = {}) {
        document.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
    }

    // --- Public Interface ---
    // Expose the methods needed by other modules (primarily app.js)
    return {
        init: init,
        loadAndProcessFile: loadAndProcessFile,
        resampleTo16kMono: resampleTo16kMono, // Keep exposed
        togglePlayPause: togglePlayPause,
        jumpBy: jumpBy,
        seek: seek,
        setSpeed: setSpeed,
        setPitch: setPitch,
        setFormant: setFormant,
        setGain: setGain,
        getCurrentTime: getCurrentTime, // Provides source time base
        getAudioContext: getAudioContext, // Provides access to context time
        cleanup: cleanup
        // Internal state like currentPlaybackSpeed is not exposed directly
    };
})();
// --- /vibe-player/js/player/audioEngine.js --- // Updated Path
