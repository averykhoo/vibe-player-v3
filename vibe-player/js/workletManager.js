// /vibe-player/js/workletManager.js

/**
 * Manages the AudioWorkletNode lifecycle, communication,
 * and pre-fetching of WASM assets for the Rubberband processor.
 */
const workletManager = (() => {
    // --- Private Module State ---
    let audioContext = null;
    let workletNode = null;
    let isWorkletReady = false; // Is the processor initialized and ready for audio?
    let isAudioLoadedInWorklet = false; // Has audio data been successfully sent?
    let wasmBinary = null;
    let loaderScriptText = null;
    let config = null; // Will be set during init

    const PROCESSOR_NAME = 'rubberband-processor'; // MUST match the name in registerProcessor

    // --- Private Methods ---

    /**
     * Fetches the WASM binary and the loader script text.
     * @returns {Promise<boolean>} True if both assets fetched successfully, false otherwise.
     */
    async function preFetchWasmAssets() {
        if (wasmBinary && loaderScriptText) {
            console.log("[WorkletManager] WASM assets already fetched.");
            return true;
        }
        if (!config || !config.paths) {
            console.error("[WorkletManager] Config not available for fetching WASM assets.");
            return false;
        }

        try {
            console.log("[WorkletManager] Fetching WASM assets...");
            const [wasmResponse, loaderResponse] = await Promise.all([
                fetch(config.paths.rubberbandWasm),
                fetch(config.paths.rubberbandLoader)
            ]);

            if (!wasmResponse.ok) throw new Error(`Fetch failed ${wasmResponse.status} for ${config.paths.rubberbandWasm}`);
            if (!loaderResponse.ok) throw new Error(`Fetch failed ${loaderResponse.status} for ${config.paths.rubberbandLoader}`);

            wasmBinary = await wasmResponse.arrayBuffer();
            loaderScriptText = await loaderResponse.text();

            console.log(`[WorkletManager] Fetched WASM binary (${wasmBinary.byteLength} bytes).`);
            console.log(`[WorkletManager] Fetched Loader Script text (${loaderScriptText.length} chars).`);
            return true;
        } catch (error) {
            console.error("[WorkletManager] Failed to fetch WASM assets:", error);
            wasmBinary = null;
            loaderScriptText = null;
            dispatchWorkletError(`Failed to fetch WASM assets: ${error.message}`);
            return false;
        }
    }

    /**
     * Handles messages received from the AudioWorkletProcessor.
     * @param {MessageEvent} event
     */
    function handleWorkletMessage(event) {
        const data = event.data;
        if (!data || !data.type) {
            console.warn("[WorkletManager] Received invalid message from worklet:", event.data);
            return;
        }

        // console.log(`[WorkletManager] Received message: ${data.type}`, data); // Can be verbose

        switch (data.type) {
            case 'status':
                console.log(`[WorkletStatus] ${data.message}`);
                if (data.message === 'processor-ready') {
                    if (!isWorkletReady) {
                        isWorkletReady = true;
                         // Only dispatch general 'workletReady' once after initial setup.
                        // Subsequent 'processor-ready' after loading audio just confirm state.
                        // However, for simplicity now, we might dispatch it again.
                        // Consider adding a flag if only one initial dispatch is desired.
                        dispatchWorkletReady();
                    }
                     // If audio was just loaded, this confirms the processor is ready for it.
                    if (isAudioLoadedInWorklet) {
                       console.log("[WorkletManager] Processor confirmed ready after audio load.");
                    }
                } else if (data.message === 'Playback ended') {
                    isAudioLoadedInWorklet = true; // Keep audio loaded status
                    dispatchWorkletPlaybackEnded();
                } else if (data.message === 'Processor cleaned up') {
                    isWorkletReady = false;
                    isAudioLoadedInWorklet = false;
                    console.log("[WorkletManager] Worklet confirmed cleanup.");
                }
                break;

            case 'error':
                console.error(`[WorkletError] ${data.message}`);
                isWorkletReady = false; // Assume processor is unusable on error
                isAudioLoadedInWorklet = false;
                dispatchWorkletError(data.message);
                cleanupInternalState(); // Attempt cleanup on error
                break;

            case 'playback-state':
                console.log(`[WorkletManager] Received playback state confirmation: isPlaying=${data.isPlaying}`);
                dispatchWorkletPlaybackState(data.isPlaying);
                break;

            case 'time-update':
                 // Directly dispatch time update event for other modules
                dispatchWorkletTimeUpdate(data.currentTime ?? 0);
                break;

            default:
                console.warn("[WorkletManager] Unrecognized message type from worklet:", data.type);
        }
    }

    /**
     * Handles critical errors reported by the AudioWorkletNode itself.
     * @param {Event} event
     */
    function handleProcessorError(event) {
        console.error(`[WorkletManager] Critical AudioWorkletProcessor error event:`, event);
        isWorkletReady = false;
        isAudioLoadedInWorklet = false;
        dispatchWorkletError("Critical processor error. Playback stopped.");
        cleanupInternalState(); // Attempt cleanup
    }

    /**
     * Posts a message to the worklet node if it exists and the port is open.
     * @param {object} message The message object to send.
     * @param {Transferable[]} [transferList=[]] Optional array of transferable objects.
     */
    function postWorkletMessage(message, transferList = []) {
        if (workletNode && workletNode.port) {
            try {
                // console.log(`[WorkletManager] Posting message: ${message.type}`); // Verbose
                workletNode.port.postMessage(message, transferList);
            } catch (error) {
                // Errors here often relate to closed ports or invalid transferable objects
                console.error("[WorkletManager] Error posting message:", error, "Message:", message);
                dispatchWorkletError(`Comms error sending ${message.type}: ${error.message}`);
                // Consider cleanup if communication breaks down
                // cleanupInternalState();
            }
        } else {
            // Only warn if we expected the worklet to be ready
            if (isWorkletReady) {
                console.warn(`[WorkletManager] Cannot post message '${message.type}': WorkletNode or port not available/closed?`);
            }
        }
    }

    /** Cleans up the internal state, disconnects node, closes port. */
    function cleanupInternalState() {
        if (workletNode) {
            console.log("[WorkletManager] Cleaning up worklet node...");
            try {
                 // Attempt to tell the processor to clean up its internal WASM state
                postWorkletMessage({ type: 'cleanup' });

                // Give the processor a moment to potentially cleanup before disconnecting
                // setTimeout(() => { // Using timeout can be brittle
                    if (workletNode) { // Check again in case it was cleaned up async
                         workletNode.port.onmessage = null; // Remove listener
                         workletNode.onprocessorerror = null; // Remove listener
                         workletNode.disconnect();
                         workletNode.port.close(); // Close the message channel
                         console.log("[WorkletManager] Worklet node disconnected and port closed.");
                    }
                // }, 50); // 50ms delay - adjust or remove if problematic

            } catch (e) {
                console.warn("[WorkletManager] Error during worklet node cleanup:", e);
            } finally {
                workletNode = null; // Ensure it's nulled out
            }
        }
        isWorkletReady = false;
        isAudioLoadedInWorklet = false;
        // Don't clear wasmBinary/loaderScriptText, allow reuse if a new file is loaded
    }

    // --- Event Dispatchers ---
    // These dispatch events on `document` for other modules to listen to.

    function dispatchWorkletReady() {
        document.dispatchEvent(new CustomEvent('audioapp:workletReady'));
    }

    function dispatchWorkletPlaybackEnded() {
        document.dispatchEvent(new CustomEvent('audioapp:workletPlaybackEnded'));
    }

    function dispatchWorkletError(message) {
        document.dispatchEvent(new CustomEvent('audioapp:workletError', { detail: { message } }));
    }

    function dispatchWorkletTimeUpdate(currentTime) {
        document.dispatchEvent(new CustomEvent('audioapp:workletTimeUpdate', { detail: { currentTime } }));
    }

    function dispatchWorkletPlaybackState(isPlaying) {
        document.dispatchEvent(new CustomEvent('audioapp:workletPlaybackState', { detail: { isPlaying } }));
    }


    // --- Public API ---
    return {
        /**
         * Initializes the WorkletManager.
         * Must be called after AudioContext is created and config is loaded.
         * @param {AudioContext} ctx The main AudioContext.
         * @param {AudioAppConfig} appConfig The application configuration.
         */
        async init(ctx, appConfig) {
            if (!ctx || !(ctx instanceof BaseAudioContext)) {
                throw new Error("WorkletManager requires a valid AudioContext.");
            }
            if (!appConfig) {
                throw new Error("WorkletManager requires application configuration.");
            }
            audioContext = ctx;
            config = appConfig; // Store config locally
            console.log("[WorkletManager] Initializing...");

            // Start fetching WASM assets immediately
            await preFetchWasmAssets();

             // Listen for audio readiness to set up the node
             document.addEventListener('audioapp:audioReady', this.setupWorkletNode.bind(this));
             console.log("[WorkletManager] Initialized and listening for audioReady.");
        },

        /**
         * Creates the AudioWorkletNode and loads audio data into it.
         * Triggered when 'audioapp:audioReady' event is dispatched.
         * @param {CustomEvent} event Event containing { buffer, vad }
         */
        async setupWorkletNode(event) {
            if (!event.detail || !event.detail.buffer) {
                 console.error("[WorkletManager] Invalid audioReady event detail.");
                 dispatchWorkletError("Internal error: Invalid audio data for worklet setup.");
                 return;
            }
            const audioBuffer = event.detail.buffer;

            if (!audioContext || audioContext.state === 'closed') {
                console.error("[WorkletManager] AudioContext not available or closed.");
                dispatchWorkletError("AudioContext not available for worklet setup.");
                return;
            }
            if (!wasmBinary || !loaderScriptText) {
                console.error("[WorkletManager] Cannot setup worklet: WASM assets not loaded.");
                 // Error already dispatched by preFetchWasmAssets if it failed
                return;
            }

            // Cleanup any existing node before creating a new one
            cleanupInternalState();

            try {
                console.log("[WorkletManager] Setting up AudioWorkletNode...");
                const workletUrl = 'audio/hybrid-processor.js'; // Path to the processor script
                try {
                     // Ensure the module is added before creating the node
                    console.log(`[WorkletManager] Adding AudioWorklet module: ${workletUrl}`);
                    await audioContext.audioWorklet.addModule(workletUrl);
                    console.log("[WorkletManager] AudioWorklet module added successfully.");
                } catch (e) {
                     // Check if module already exists (can happen on hot-reloads or retries)
                     if (e.message.includes("already been loaded")) {
                          console.warn(`[WorkletManager] Worklet module '${workletUrl}' was already loaded.`);
                     } else {
                          throw new Error(`Failed to add AudioWorklet module '${workletUrl}': ${e.message}`);
                     }
                 }


                // Create a copy of the WASM binary ArrayBuffer to transfer
                // Avoid transferring the original `wasmBinary` used for potential retries/reloads
                const wasmBinaryTransfer = wasmBinary.slice(0);
                const wasmTransferList = [wasmBinaryTransfer]; // Transfer ownership of the copy

                console.log("[WorkletManager] Creating AudioWorkletNode...");
                workletNode = new AudioWorkletNode(audioContext, PROCESSOR_NAME, {
                    numberOfInputs: 0, // Rubberband processor does not need audio input nodes
                    numberOfOutputs: 1,
                    outputChannelCount: [audioBuffer.numberOfChannels], // Match output channels to source
                    processorOptions: {
                        sampleRate: audioContext.sampleRate, // Use context's sample rate
                        numberOfChannels: audioBuffer.numberOfChannels,
                        timeUpdateFrequencyHz: config?.visualization?.timeUpdateFrequencyHz || 15,
                        wasmBinary: wasmBinaryTransfer, // Pass the transferable copy
                        loaderScriptText: loaderScriptText // Pass the script text (copied)
                    }
                }); // Note: wasmTransferList is NOT passed here, but in postMessage

                workletNode.port.onmessage = handleWorkletMessage;
                workletNode.onprocessorerror = handleProcessorError;
                console.log("[WorkletManager] AudioWorkletNode created and listeners attached.");

                // Connect the node to the audio graph (e.g., gain node or destination)
                // This connection happens in playbackController typically
                // workletNode.connect(audioContext.destination); // Connect directly for now if no gain

                console.log("[WorkletManager] Preparing audio data for transfer...");
                const channelData = [];
                const transferListAudio = [];
                for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
                    // Get channel data, which is a Float32Array view
                    const dataArray = audioBuffer.getChannelData(i);
                    // Create a *copy* of the underlying ArrayBuffer to transfer
                    // This is crucial: transferring the original buffer detaches it from the AudioBuffer
                    const bufferCopy = dataArray.buffer.slice(dataArray.byteOffset, dataArray.byteOffset + dataArray.byteLength);
                    channelData.push(bufferCopy);
                    transferListAudio.push(bufferCopy); // Add the copy to the transfer list
                }

                console.log(`[WorkletManager] Sending ${channelData.length} channel data buffers (transferable)...`);
                isAudioLoadedInWorklet = false; // Mark as loading
                 postWorkletMessage({type: 'load-audio', channelData: channelData}, transferListAudio);
                 isAudioLoadedInWorklet = true; // Assume success for now, errors handled by messages

                 // Worklet will send 'processor-ready' message once it initializes with this audio

            } catch (error) {
                console.error("[WorkletManager] Error setting up WorkletNode:", error);
                dispatchWorkletError(`Error setting up WorkletNode: ${error.message}`);
                cleanupInternalState(); // Cleanup on setup failure
            }
        },

         /** Returns the worklet node instance (used by playbackController to connect). */
        getNode() {
            return workletNode;
        },

        /** Returns true if the worklet is initialized and ready for commands. */
        isReady() {
            return isWorkletReady && isAudioLoadedInWorklet;
        },

        // --- Playback Control Methods ---
        play() {
            if (!this.isReady()) { console.warn("[WorkletManager] Cannot play: Worklet not ready."); return; }
            postWorkletMessage({ type: 'play' });
        },
        pause() {
            if (!this.isReady()) { console.warn("[WorkletManager] Cannot pause: Worklet not ready."); return; }
            postWorkletMessage({ type: 'pause' });
        },
        seek(positionSeconds) {
            if (!this.isReady()) { console.warn("[WorkletManager] Cannot seek: Worklet not ready."); return; }
            postWorkletMessage({ type: 'seek', positionSeconds: positionSeconds });
        },
        jump(seconds) {
             if (!this.isReady()) { console.warn("[WorkletManager] Cannot jump: Worklet not ready."); return; }
            postWorkletMessage({ type: 'jump', seconds: seconds });
        },
        setSpeed(speed) {
             // Allow setting speed even if not fully ready, processor might buffer it
             if (!workletNode) { console.warn("[WorkletManager] Cannot set speed: Node not created."); return; }
            postWorkletMessage({ type: 'set-speed', value: speed });
        },
        setGain(gain) {
             // Allow setting gain even if not fully ready
             if (!workletNode) { console.warn("[WorkletManager] Cannot set gain: Node not created."); return; }
            postWorkletMessage({ type: 'set-gain', value: gain });
        },
        cleanup() {
            console.log("[WorkletManager] External cleanup requested.");
            cleanupInternalState();
        }
    };
})();

// Attach to the global AudioApp namespace
if (typeof window.AudioApp === 'undefined') {
    window.AudioApp = {};
}
window.AudioApp.workletManager = workletManager;
console.log("WorkletManager module loaded.");

// /vibe-player/js/workletManager.js
