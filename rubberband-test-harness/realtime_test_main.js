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
let isPlaying = false;
let useSlowSource = false; // UI mirror state
const SIMULATED_SLOW_SPEED = 0.25;
let workletReady = false;
let wasmBinary = null; // Holds pre-fetched WASM ArrayBuffer

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
        // Attempt to create AudioContext
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (!audioContext) {
                throw new Error("AudioContext not supported.");
            }
            // If context starts suspended, it needs user interaction to resume later
             if (audioContext.state === 'suspended') {
                 console.warn("AudioContext is suspended. User interaction (like button click) will be needed to resume.");
             }
        } catch (ctxError) {
             throw new Error(`Failed to create AudioContext: ${ctxError.message}`);
        }
        console.log(`AudioContext Sample Rate: ${audioContext.sampleRate}`);

        // --- Pre-fetch WASM ---
        updateStatusUI('Fetching WASM binary...');
        try {
            const wasmPath = 'rubberband.wasm'; // Adjust if needed
            const response = await fetch(wasmPath);
            if (!response.ok) {
                throw new Error(`Failed to fetch ${wasmPath}: ${response.status} ${response.statusText}`);
            }
            wasmBinary = await response.arrayBuffer();
            console.log(`Fetched WASM binary (${wasmBinary.byteLength} bytes).`);
            updateStatusUI('WASM binary fetched.');
        } catch(fetchError) {
            // Don't completely fail init, maybe user can still load file later?
            // But disable playback setup.
            updateStatusUI(`Failed to fetch WASM: ${fetchError.message}. Real-time processing will fail.`, true);
            console.error("WASM Fetch Error:", fetchError);
            wasmBinary = null; // Ensure it's null if fetch failed
        }
        // --- End WASM Fetch ---

        setupEventListeners();
        updateStatusUI('Ready. Please upload an audio file.');

    } catch (error) {
        updateStatusUI(`Initialization failed: ${error.message}`, true);
        console.error("Initialization error:", error);
        fileInput.disabled = true;
    }
}

function setupEventListeners() {
    fileInput.addEventListener('change', handleFileSelect);
    playPauseButton.addEventListener('click', handlePlayPause);
    speedSlider.addEventListener('input', handleSpeedChange);
    sourceToggleButton.addEventListener('click', handleSourceToggle);

    speedValueSpan.textContent = `${parseFloat(speedSlider.value).toFixed(2)}x`;
    updateSourceButtonText();
}

// --- File Handling ---
async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file || !audioContext) {
         updateStatusUI("AudioContext not available.", true);
         return;
    };

    updateStatusUI(`Loading file: ${file.name}...`);
    await cleanupCurrentWorklet();
    originalAudioBuffer = null;
    isPlaying = false;
    workletReady = false;
    playPauseButton.textContent = 'Play';
    playbackStatusSpan.textContent = 'Idle';
    playbackControlsDiv.style.display = 'none'; // Hide controls until worklet ready
    fileInput.disabled = true; // Disable during load/decode/setup

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            updateStatusUI('Decoding audio data...');
            originalAudioBuffer = await audioContext.decodeAudioData(e.target.result);

            if (!originalAudioBuffer || originalAudioBuffer.length === 0) {
                throw new Error("Decoded audio buffer is invalid or empty.");
            }
            console.log(`Decoded SR: ${originalAudioBuffer.sampleRate}, Context SR: ${audioContext.sampleRate}`);
            updateStatusUI(`File loaded and decoded. SR: ${originalAudioBuffer.sampleRate}, Ch: ${originalAudioBuffer.numberOfChannels}, Dur: ${originalAudioBuffer.duration.toFixed(2)}s`);

            // --- Trigger Worklet Setup ---
            if (wasmBinary) { // Check WASM was fetched successfully during init
               await setupAndStartWorklet();
               // File input re-enabled inside setup or its error handler
            } else {
                throw new Error("WASM binary was not loaded during initialization. Cannot proceed.");
            }

        } catch (error) {
            updateStatusUI(`Error processing file: ${error.message}`, true);
            console.error('File Processing Error:', error);
            originalAudioBuffer = null;
            fileInput.disabled = false; // Re-enable if file processing fails
        }
    };
    reader.onerror = (e) => {
        updateStatusUI(`Error reading file: ${e.target.error}`, true);
        fileInput.disabled = false;
    };
    reader.readAsArrayBuffer(file);
}

// --- Cleanup existing worklet ---
async function cleanupCurrentWorklet() {
     if (workletNode) {
         console.log("Cleaning up previous worklet node...");
         try {
             // Optional: Send cleanup message if needed by worklet
             // postWorkletMessage({ type: 'cleanup' });
             workletNode.port.close();
             workletNode.disconnect();
         } catch (cleanupError) {
             console.warn("Error during worklet cleanup:", cleanupError);
         } finally {
             workletNode = null;
             workletReady = false;
         }
         console.log("Previous worklet node disconnected.");
     }
     if (audioContext && audioContext.state === 'suspended') {
         try { await audioContext.resume(); } catch(e) {} // Try to ensure context is running
     }
}

// --- AudioWorklet Setup ---
async function setupAndStartWorklet() {
    if (!audioContext || !originalAudioBuffer || !wasmBinary) {
        updateStatusUI("Cannot setup playback - missing context, audio buffer, or WASM binary.", true);
        fileInput.disabled = false;
        return;
    }

    try {
        updateStatusUI("Setting up audio processing worklet...");
        await cleanupCurrentWorklet(); // Ensure no old node exists

        const processorName = 'hybrid-processor';
        const processorUrl = 'realtime_test_processor.js';

        try {
           await audioContext.audioWorklet.addModule(processorUrl);
           console.log("AudioWorklet module added.");
        } catch (addModuleError) {
            throw new Error(`Failed to add AudioWorklet module '${processorUrl}': ${addModuleError.message}. Check console for script errors.`);
        }

        // --- Transfer WASM binary buffer ---
        // Slice to create a transferable copy (original wasmBinary is kept)
        const wasmBinaryTransfer = wasmBinary.slice(0);
        const wasmTransferList = [wasmBinaryTransfer]; // Array for transfer argument

        workletNode = new AudioWorkletNode(audioContext, processorName, {
            processorOptions: {
                sampleRate: originalAudioBuffer.sampleRate,
                numberOfChannels: originalAudioBuffer.numberOfChannels,
                initialSlowSpeed: SIMULATED_SLOW_SPEED,
                wasmBinary: wasmBinaryTransfer, // Pass the copy
            }
        }, wasmTransferList ); // Transfer ownership of the ArrayBuffer copy

        // --- Message Listener from Worklet ---
        workletNode.port.onmessage = (event) => {
            const data = event.data;
            if (data.type === 'status') {
                console.log(`[WorkletStatus] ${data.message}`);
                if (data.message === 'processor-ready') {
                    workletReady = true;
                    playbackControlsDiv.style.display = 'block';
                    updateStatusUI("Ready to play.");
                    fileInput.disabled = false; // Enable file input now
                    // Send initial state
                    postWorkletMessage({ type: 'set-speed', value: parseFloat(speedSlider.value) });
                    postWorkletMessage({ type: 'set-source', useSlow: useSlowSource });
                } else if (data.message === 'Playback ended') {
                    if (isPlaying) {
                       isPlaying = false;
                       playPauseButton.textContent = 'Play';
                       playbackStatusSpan.textContent = 'Finished';
                    }
                }
            } else if (data.type === 'error') {
                 console.error(`[WorkletError] ${data.message}`);
                 updateStatusUI(`Worklet Error: ${data.message}`, true);
                 handlePlayPause(true);
                 workletReady = false;
                 playbackControlsDiv.style.display = 'none';
                 fileInput.disabled = false;
            }
        };

        workletNode.onprocessorerror = (event) => {
             console.error(`AudioWorkletProcessor error event:`, event);
             updateStatusUI(`Critical Worklet Processor Error! Check console.`, true);
             workletReady = false;
             playbackControlsDiv.style.display = 'none';
             fileInput.disabled = false;
             cleanupCurrentWorklet(); // Attempt cleanup
        };

        workletNode.connect(audioContext.destination);
        console.log("AudioWorkletNode created and connected.");

        // --- Transfer Audio Data ---
        const channelData = [];
        const transferListAudio = [];
        try {
             for (let i = 0; i < originalAudioBuffer.numberOfChannels; i++) {
                 const dataArray = originalAudioBuffer.getChannelData(i);
                 const bufferCopy = dataArray.buffer.slice(dataArray.byteOffset, dataArray.byteOffset + dataArray.byteLength);
                 channelData.push(bufferCopy);
                 transferListAudio.push(bufferCopy);
             }
        } catch (error) {
            throw new Error(`Failed to prepare channel data for transfer: ${error.message}`);
        }

        console.log(`Sending ${channelData.length} channel data buffers to worklet (transferable)...`);
        postWorkletMessage({
            type: 'load-audio',
            channelData: channelData
        }, transferListAudio);

    } catch (error) {
        updateStatusUI(`Error setting up AudioWorklet: ${error.message}`, true);
        console.error("AudioWorklet Setup Error:", error);
        await cleanupCurrentWorklet();
        playbackControlsDiv.style.display = 'none';
        fileInput.disabled = false; // Ensure file input is usable after failure
    }
}

// --- Playback Controls ---
async function handlePlayPause(forcePause = false) {
    if (!audioContext) { console.warn("AudioContext not available."); return; }

    if (audioContext.state === 'suspended') {
        try {
            await audioContext.resume();
            console.log("AudioContext resumed.");
        } catch (err) { /* ... error handling ... */ return; }
    }

    if (!workletNode || !workletReady) {
         console.warn("Cannot play/pause: Worklet not ready.");
         if (!originalAudioBuffer) updateStatusUI("Please load an audio file first.", true);
         else if (!wasmBinary) updateStatusUI("WASM binary failed to load.", true);
         else updateStatusUI("Worklet processor not ready.", true);
         return;
    }

    const targetIsPlaying = forcePause ? false : !isPlaying;
    postWorkletMessage({ type: targetIsPlaying ? 'play' : 'pause' });
    isPlaying = targetIsPlaying;
    playPauseButton.textContent = isPlaying ? 'Pause' : 'Play';
    playbackStatusSpan.textContent = isPlaying ? 'Playing' : (forcePause ? 'Paused' : 'Stopped');
    console.log(`Playback state set to: ${isPlaying ? 'Playing' : 'Paused/Stopped'}`);
}

function handleSpeedChange(event) {
    if (!workletReady) return;
    const speed = parseFloat(event.target.value);
    speedValueSpan.textContent = `${speed.toFixed(2)}x`;
    postWorkletMessage({ type: 'set-speed', value: speed });
}

function handleSourceToggle() {
    if (!workletReady) return;
    useSlowSource = !useSlowSource;
    updateSourceButtonText();
    postWorkletMessage({ type: 'set-source', useSlow: useSlowSource });
    console.log(`Source toggled. Sending useSlow: ${useSlowSource}`);
}

function updateSourceButtonText() {
     sourceToggleButton.textContent = `Using ${useSlowSource ? `Slow (${SIMULATED_SLOW_SPEED}x)` : 'Original (1.0x)'}`;
}


// --- Communication with Worklet ---
function postWorkletMessage(message, transferList = []) {
    if (workletNode && workletNode.port) {
        try {
            workletNode.port.postMessage(message, transferList);
        } catch (error) {
            console.error("Error posting message to worklet:", error);
            updateStatusUI(`Communication error: ${error.message}`, true);
            cleanupCurrentWorklet(); // Attempt cleanup on comms error
        }
    } else {
        // Avoid warning spam if worklet just hasn't been created yet
        if (originalAudioBuffer) { // Only warn if we expected a worklet to exist
            console.warn("Cannot post message: WorkletNode not ready or invalid port.");
        }
    }
}

// --- Start Initialization ---
document.addEventListener('DOMContentLoaded', initialize);
