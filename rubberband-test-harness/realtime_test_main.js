// --- DOM Elements ---
const fileInput = document.getElementById('audioFile');
const playbackControlsDiv = document.getElementById('playbackControls');
const playPauseButton = document.getElementById('playPauseButton');
const playbackStatusSpan = document.getElementById('playbackStatus');
const speedSlider = document.getElementById('speedSlider');
const speedValueSpan = document.getElementById('speedValue');
const sourceToggleButton = document.getElementById('sourceToggleButton');
const statusDiv = document.getElementById('status');

// --- Web Audio API ---
let audioContext = null;
let workletNode = null;

// --- Application State ---
let originalAudioBuffer = null;
let isPlaying = false; // UI/Main thread desired state
let workletIsPlaying = false; // State confirmed by worklet
let useSlowSource = false;
const SIMULATED_SLOW_SPEED = 0.25;
let workletReady = false;
let wasmBinary = null;
let loaderScriptText = null;

// --- Utility ---
function updateStatusUI(message, isError = false) {
    console.log(`[MainStatus] ${message}`);
    statusDiv.textContent = `Status: ${message}`;
    statusDiv.style.color = isError ? 'red' : 'black';
}

// --- Initialization ---
async function initialize() {
    updateStatusUI('Initializing...');
    try {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (!audioContext) throw new Error("AudioContext not supported.");
             if (audioContext.state === 'suspended') {
                 console.warn("AudioContext is suspended. User interaction (e.g., button click) needed to resume.");
                 updateStatusUI("AudioContext suspended. Click button after loading file.");
             } else {
                 console.log("AudioContext state:", audioContext.state);
             }
        } catch (ctxError) { throw new Error(`Failed to create AudioContext: ${ctxError.message}`); }
        console.log(`AudioContext Sample Rate: ${audioContext.sampleRate}`);

        // --- Pre-fetch WASM ---
        updateStatusUI('Fetching WASM binary...');
        try {
            const wasmPath = 'rubberband.wasm'; // Ensure this path is correct
            const response = await fetch(wasmPath);
            if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${wasmPath}`);
            wasmBinary = await response.arrayBuffer();
            console.log(`Fetched WASM binary (${wasmBinary.byteLength} bytes).`);
        } catch(fetchError) { updateStatusUI(`Failed to fetch WASM: ${fetchError.message}.`, true); console.error("WASM Fetch Error:", fetchError); wasmBinary = null; }

        // --- Pre-fetch Loader Script ---
        updateStatusUI('Fetching Loader Script text...');
         try {
             const loaderPath = 'rubberband.js'; // Ensure this path is correct
             const response = await fetch(loaderPath);
             if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${loaderPath}`);
             loaderScriptText = await response.text();
             console.log(`Fetched Loader Script text (${loaderScriptText.length} chars).`);
         } catch(fetchError) { updateStatusUI(`Failed to fetch Loader Script: ${fetchError.message}.`, true); console.error("Loader Fetch Error:", fetchError); loaderScriptText = null; }

        setupEventListeners();
        if (wasmBinary && loaderScriptText) {
            if (audioContext.state !== 'suspended') updateStatusUI('Ready. Please upload an audio file.');
        } else { updateStatusUI('Initialization incomplete (WASM or Loader fetch failed). Processing will fail.', true); }

    } catch (error) {
        updateStatusUI(`Initialization failed: ${error.message}`, true);
        console.error("Initialization error:", error); fileInput.disabled = true;
    }
}

function setupEventListeners() {
    fileInput.addEventListener('change', handleFileSelect);
    playPauseButton.addEventListener('click', handlePlayPause);
    speedSlider.addEventListener('input', handleSpeedChange);
    sourceToggleButton.addEventListener('click', handleSourceToggle);
    // Initialize UI elements
    speedValueSpan.textContent = `${parseFloat(speedSlider.value).toFixed(2)}x`;
    updateSourceButtonText();
}

// --- File Handling ---
async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file || !audioContext) { updateStatusUI("AudioContext not available.", true); return; };

    updateStatusUI(`Loading file: ${file.name}...`);
    await cleanupCurrentWorklet(); // Cleanup before loading new file
    originalAudioBuffer = null; isPlaying = false; workletIsPlaying = false; workletReady = false;
    playPauseButton.textContent = 'Play'; playbackStatusSpan.textContent = 'Idle';
    playbackControlsDiv.style.display = 'none'; fileInput.disabled = true; // Disable while processing

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            updateStatusUI('Decoding audio data...');
            originalAudioBuffer = await audioContext.decodeAudioData(e.target.result);
            if (!originalAudioBuffer || originalAudioBuffer.length === 0) throw new Error("Decoded audio buffer invalid.");
            console.log(`Decoded SR: ${originalAudioBuffer.sampleRate}, Context SR: ${audioContext.sampleRate}`);
            // *** Compatibility Check: Ensure audio sample rate matches context ***
            // Resampling might be needed if they differ significantly, but for now, just warn.
            if (originalAudioBuffer.sampleRate !== audioContext.sampleRate) {
                console.warn(`[Main] Audio sample rate (${originalAudioBuffer.sampleRate}) differs from AudioContext rate (${audioContext.sampleRate}). Playback might be at wrong speed/pitch without resampling.`);
                // updateStatusUI(`Warning: Sample rate mismatch (${originalAudioBuffer.sampleRate} vs ${audioContext.sampleRate}).`, false); // Optional warning UI
            }
            updateStatusUI(`File loaded. SR: ${originalAudioBuffer.sampleRate}, Ch: ${originalAudioBuffer.numberOfChannels}, Dur: ${originalAudioBuffer.duration.toFixed(2)}s`);

            if (wasmBinary && loaderScriptText) {
               await setupAndStartWorklet(); // Now setup worklet
            } else { throw new Error("WASM binary or Loader script missing. Cannot proceed."); }

        } catch (error) {
            updateStatusUI(`Error processing file: ${error.message}`, true); console.error('File Processing Error:', error);
            originalAudioBuffer = null; fileInput.disabled = false; // Re-enable on error
        }
    };
    reader.onerror = (e) => { updateStatusUI(`Error reading file: ${e.target.error}`, true); fileInput.disabled = false; };
    reader.readAsArrayBuffer(file);
}

// --- Cleanup existing worklet ---
async function cleanupCurrentWorklet() {
     if (workletNode) {
         console.log("[Main] Cleaning up previous worklet node...");
         try {
             // Attempt to send cleanup message *before* disconnecting
             postWorkletMessage({ type: 'cleanup' });
             await new Promise(resolve => setTimeout(resolve, 50)); // Short delay for message processing
             workletNode.port.close(); // Close port
             workletNode.disconnect(); // Disconnect from destination
             console.log("[Main] Previous worklet node disconnected and cleaned up.");
         }
         catch (e) { console.warn("[Main] Error during worklet cleanup:", e); }
         finally { workletNode = null; workletReady = false; workletIsPlaying = false; }
     }
}

// --- AudioWorklet Setup ---
async function setupAndStartWorklet() {
    if (!audioContext || !originalAudioBuffer || !wasmBinary || !loaderScriptText) {
        updateStatusUI("Cannot setup playback - missing context, audio, WASM, or loader script.", true);
        fileInput.disabled = false; return;
    }

    try {
        updateStatusUI("Setting up audio processing worklet...");
        await cleanupCurrentWorklet(); // Ensure clean slate

        const processorName = 'hybrid-processor';
        const processorUrl = 'realtime_test_processor.js';

        try {
            console.log(`[Main] Adding AudioWorklet module: ${processorUrl}`);
            await audioContext.audioWorklet.addModule(processorUrl);
            console.log("[Main] AudioWorklet module added successfully.");
        } catch (e) {
            console.error(`[Main] Failed to add AudioWorklet module '${processorUrl}':`, e);
            throw new Error(`Failed to add AudioWorklet module: ${e.message}`);
        }

        // --- Prepare data for processor ---
        // WASM binary needs to be transferable
        const wasmBinaryTransfer = wasmBinary.slice(0);
        const wasmTransferList = [wasmBinaryTransfer]; // List for transferring WASM

        console.log("[Main] Creating AudioWorkletNode...");
        workletNode = new AudioWorkletNode(audioContext, processorName, {
            // Worklet Options
            numberOfInputs: 1,
            numberOfOutputs: 1,
            // Provide output channel count matching the audio data
            outputChannelCount: [originalAudioBuffer.numberOfChannels], // *** THIS IS THE KEY FIX ***

            // Custom options passed to the processor constructor
            processorOptions: {
                sampleRate: audioContext.sampleRate, // *** Use AudioContext sample rate ***
                numberOfChannels: originalAudioBuffer.numberOfChannels,
                initialSlowSpeed: SIMULATED_SLOW_SPEED,
                wasmBinary: wasmBinaryTransfer, // Pass transferable buffer
                loaderScriptText: loaderScriptText // Pass loader text (will be copied)
            }
        });
        // ---> REMOVED INCORRECT POSTMESSAGE WASM TRANSFER <---

        console.log("[Main] Setting up worklet message listener...");
        // --- Message Listener from Worklet ---
        workletNode.port.onmessage = (event) => {
            const data = event.data;
            // console.log("[Main] Message from worklet:", data.type); // Optional: Log message types
            if (data.type === 'status') {
                console.log(`[WorkletStatus] ${data.message}`);
                if (data.message === 'processor-ready') {
                    workletReady = true;
                    playbackControlsDiv.style.display = 'block'; // Show controls
                    updateStatusUI("Ready to play.");
                    fileInput.disabled = false; // Re-enable file input
                    // Send initial settings
                    postWorkletMessage({ type: 'set-speed', value: parseFloat(speedSlider.value) });
                    postWorkletMessage({ type: 'set-source', useSlow: useSlowSource });
                } else if (data.message === 'Playback ended') {
                    if (isPlaying || workletIsPlaying) {
                        isPlaying = false; workletIsPlaying = false;
                        playPauseButton.textContent = 'Play'; playbackStatusSpan.textContent = 'Finished';
                        updateStatusUI("Playback finished.");
                    }
                } else if (data.message === 'Processor cleaned up') {
                    workletReady = false; workletIsPlaying = false;
                }
            } else if (data.type === 'error') {
                 console.error(`[WorkletError] ${data.message}`); updateStatusUI(`Worklet Error: ${data.message}`, true);
                 isPlaying = false; workletIsPlaying = false; workletReady = false;
                 playPauseButton.textContent = 'Play'; playbackStatusSpan.textContent = 'Error';
                 playbackControlsDiv.style.display = 'none'; fileInput.disabled = false;
                 cleanupCurrentWorklet();
            } else if (data.type === 'playback-state') {
                // Update main thread state based on worklet confirmation
                console.log(`[Main] Received playback state confirmation from worklet: isPlaying=${data.isPlaying}`);
                workletIsPlaying = data.isPlaying;
                // Sync UI state variable only if necessary
                if (isPlaying !== workletIsPlaying) {
                    console.warn("[Main] Worklet state differs from UI state, syncing UI.");
                    isPlaying = workletIsPlaying;
                    playPauseButton.textContent = isPlaying ? 'Pause' : 'Play';
                    playbackStatusSpan.textContent = isPlaying ? 'Playing' : (workletReady ? 'Stopped' : 'Error'); // Update status text
                } else {
                    // Update status text even if state matches (e.g., Playing... -> Playing)
                    playbackStatusSpan.textContent = isPlaying ? 'Playing' : (workletReady ? 'Stopped' : 'Error');
                }
            }
        };
        workletNode.onprocessorerror = (event) => {
             console.error(`[Main] AudioWorkletProcessor error event:`, event); updateStatusUI(`Critical Worklet Processor Error! Playback stopped.`, true);
             isPlaying = false; workletIsPlaying = false; workletReady = false;
             playPauseButton.textContent = 'Play'; playbackStatusSpan.textContent = 'Error';
             playbackControlsDiv.style.display = 'none'; fileInput.disabled = false;
             cleanupCurrentWorklet();
        };

        console.log("[Main] Connecting worklet node to destination...");
        workletNode.connect(audioContext.destination);
        console.log("[Main] AudioWorkletNode created and connected.");

        // --- Transfer Audio Data ---
        console.log("[Main] Preparing audio data for transfer...");
        const channelData = [];
        const transferListAudio = [];
        try {
             for (let i = 0; i < originalAudioBuffer.numberOfChannels; i++) {
                 const dataArray = originalAudioBuffer.getChannelData(i);
                 const bufferCopy = dataArray.buffer.slice(dataArray.byteOffset, dataArray.byteOffset + dataArray.byteLength);
                 channelData.push(bufferCopy); transferListAudio.push(bufferCopy);
             }
        } catch (error) { throw new Error(`Failed to prepare channel data for transfer: ${error.message}`); }

        console.log(`[Main] Sending ${channelData.length} channel data buffers to worklet (transferable)...`);
        // Send audio data AFTER node is created and connected
        postWorkletMessage({ type: 'load-audio', channelData: channelData }, transferListAudio);

    } catch (error) {
        updateStatusUI(`Error setting up AudioWorklet: ${error.message}`, true);
        console.error("[Main] AudioWorklet Setup Error:", error);
        await cleanupCurrentWorklet();
        playbackControlsDiv.style.display = 'none';
        fileInput.disabled = false; // Re-enable on setup error
    }
}

// --- Playback Controls ---
async function handlePlayPause() {
    if (!audioContext) { updateStatusUI("AudioContext not available.", true); return; }
    if (!workletNode || !workletReady) {
        console.warn("[Main] Cannot play/pause: Worklet not ready or not initialized.");
        if (!originalAudioBuffer) updateStatusUI("Load audio first.", true);
        else if (!wasmBinary || !loaderScriptText) updateStatusUI("Init failed (missing WASM/Loader).", true);
        else updateStatusUI("Worklet not ready. Please wait.", true);
        return;
    }

    // --- Resume AudioContext on user interaction ---
    if (audioContext.state === 'suspended') {
        console.log("[Main] Attempting to resume AudioContext...");
        try {
            await audioContext.resume();
            console.log("[Main] AudioContext resumed successfully. State:", audioContext.state);
             updateStatusUI("AudioContext resumed.");
        } catch (err) {
            updateStatusUI(`Failed to resume AudioContext: ${err.message}`, true); console.error("[Main] Failed to resume AudioContext:", err); return;
        }
    }
     if (audioContext.state !== 'running') {
         updateStatusUI(`AudioContext is not running (state: ${audioContext.state}). Cannot play.`, true); return;
     }

    // --- Toggle Play/Pause ---
    const targetIsPlaying = !isPlaying; // User's intent
    console.log(`[Main] Play/Pause toggled. Desired state: ${targetIsPlaying ? 'Play' : 'Pause'}`);
    postWorkletMessage({ type: targetIsPlaying ? 'play' : 'pause' });

    // --- Optimistic UI Update ---
    isPlaying = targetIsPlaying;
    playPauseButton.textContent = isPlaying ? 'Pause' : 'Play';
    playbackStatusSpan.textContent = isPlaying ? 'Playing...' : 'Paused'; // Initial UI feedback
}

function handleSpeedChange(event) { if (!workletReady) return; const speed = parseFloat(event.target.value); speedValueSpan.textContent = `${speed.toFixed(2)}x`; postWorkletMessage({ type: 'set-speed', value: speed }); }
function handleSourceToggle() { if (!workletReady) return; useSlowSource = !useSlowSource; updateSourceButtonText(); postWorkletMessage({ type: 'set-source', useSlow: useSlowSource }); console.log(`[Main] Source toggled. Sending useSlow: ${useSlowSource}`); }
function updateSourceButtonText() { sourceToggleButton.textContent = `Using ${useSlowSource ? `Slow (${SIMULATED_SLOW_SPEED}x)` : 'Original (1.0x)'}`; }

// --- Communication with Worklet ---
function postWorkletMessage(message, transferList = []) {
    if (workletNode && workletNode.port) {
        try {
             // console.log("[Main] Posting message to worklet:", message.type); // Debug
             workletNode.port.postMessage(message, transferList);
        }
        catch (error) {
            console.error("[Main] Error posting message to worklet:", error); updateStatusUI(`Comms error: ${error.message}`, true);
            isPlaying = false; workletIsPlaying = false; workletReady = false;
            playPauseButton.textContent = 'Play'; playbackStatusSpan.textContent = 'Error';
            playbackControlsDiv.style.display = 'none'; fileInput.disabled = false;
            cleanupCurrentWorklet();
        }
    } else {
        // Ignore if worklet isn't set up or port is closed
         if (workletReady) console.warn("[Main] Cannot post message: WorkletNode port not available or closed.");
    }
}

// --- Start Initialization ---
document.addEventListener('DOMContentLoaded', initialize);
// --- END OF FILE realtime_test_main.js ---