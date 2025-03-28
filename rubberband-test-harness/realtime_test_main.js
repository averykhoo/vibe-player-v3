// Import the Rubberband library
import RubberbandModuleLoader from './rubberband.js'; // Assuming rubberband.js/wasm are here

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
let audioContext;
let workletNode = null;

// --- Application State ---
let Module; // Holds the WASM module
let originalAudioBuffer = null;
let isPlaying = false;
let useSlowSource = false; // Mirror worklet state for UI update
const SIMULATED_SLOW_SPEED = 0.25; // The speed the "slow" buffer *would* represent

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
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log(`AudioContext Sample Rate: ${audioContext.sampleRate}`);

        updateStatusUI('Loading Rubberband WASM module...');
        Module = await RubberbandModuleLoader({});
        updateStatusUI('Rubberband module loaded.');
        console.log("Rubberband Module Initialized:", Module);

        setupEventListeners();
        updateStatusUI('Ready. Please upload an audio file.');

    } catch (error) {
        updateStatusUI(`Initialization failed: ${error.message}`, true);
        console.error("Initialization error:", error);
        // Disable relevant UI elements if needed
        fileInput.disabled = true;
    }
}

function setupEventListeners() {
    fileInput.addEventListener('change', handleFileSelect);
    playPauseButton.addEventListener('click', handlePlayPause);
    speedSlider.addEventListener('input', handleSpeedChange);
    sourceToggleButton.addEventListener('click', handleSourceToggle);

    // Initial display
    speedValueSpan.textContent = `${parseFloat(speedSlider.value).toFixed(2)}x`;
    updateSourceButtonText();
}

// --- File Handling ---
async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file || !audioContext) return;

    updateStatusUI(`Loading file: ${file.name}...`);
    // Reset state if a new file is loaded
    if (workletNode) {
        workletNode.disconnect();
        workletNode = null; // Allow garbage collection
        console.log("Disconnected previous worklet node.");
    }
    originalAudioBuffer = null;
    isPlaying = false;
    playPauseButton.textContent = 'Play';
    playbackStatusSpan.textContent = 'Idle';
    playbackControlsDiv.style.display = 'none';
    fileInput.disabled = true; // Disable while loading/processing

    const reader = new FileReader();

    reader.onload = async (e) => {
        try {
            updateStatusUI('Decoding audio data...');
            originalAudioBuffer = await audioContext.decodeAudioData(e.target.result);

            // Basic validation
            if (!originalAudioBuffer || originalAudioBuffer.length === 0) {
                throw new Error("Decoded audio buffer is invalid or empty.");
            }
             if (originalAudioBuffer.sampleRate !== audioContext.sampleRate) {
                // Resampling is complex; for this test, we'll require matching rates or accept potential issues.
                 console.warn(`Audio file sample rate (${originalAudioBuffer.sampleRate}Hz) differs from AudioContext rate (${audioContext.sampleRate}Hz). Playback might be at incorrect pitch/speed if not handled by Rubberband correctly. For best results, use audio matching the context rate or resample first.`);
                 // Alternatively, throw an error:
                 // throw new Error(`Audio file sample rate (${originalAudioBuffer.sampleRate}Hz) must match AudioContext rate (${audioContext.sampleRate}Hz) for this test app.`);
             }


            updateStatusUI(`File loaded and decoded. Sample Rate: ${originalAudioBuffer.sampleRate} Hz, Channels: ${originalAudioBuffer.numberOfChannels}, Duration: ${originalAudioBuffer.duration.toFixed(2)}s`);

            // Now setup the worklet
            await setupAndStartWorklet();

        } catch (error) {
            updateStatusUI(`Error processing file: ${error.message}`, true);
            console.error('File Processing Error:', error);
            originalAudioBuffer = null; // Ensure buffer is null on error
        } finally {
            fileInput.disabled = false; // Re-enable file input
        }
    };

    reader.onerror = (e) => {
        updateStatusUI(`Error reading file: ${e.target.error}`, true);
        fileInput.disabled = false;
    };

    reader.readAsArrayBuffer(file);
}

// --- AudioWorklet Setup ---
async function setupAndStartWorklet() {
    if (!audioContext || !originalAudioBuffer || !Module) {
        updateStatusUI("Cannot setup playback - missing context, audio buffer, or WASM module.", true);
        return;
    }

    try {
        updateStatusUI("Setting up audio processing...");
        // Ensure previous node is disconnected
        if (workletNode) {
            workletNode.disconnect();
            workletNode = null;
        }

        // Path to the processor script
        const processorName = 'hybrid-processor'; // Must match the name used inside the script
        const processorUrl = 'realtime_test_processor.js';

        await audioContext.audioWorklet.addModule(processorUrl);
        console.log("AudioWorklet module added.");

        // Data to pass to the worklet - **CRITICAL**
        // Using SharedArrayBuffer is ideal but requires cross-origin isolation headers.
        // For simplicity in this test, we might pass channel data via message,
        // but be aware this is inefficient for large files and can block the main thread.
        // Let's structure assuming message passing for now.
        const channelData = [];
        for (let i = 0; i < originalAudioBuffer.numberOfChannels; i++) {
            // Get a *copy* to avoid issues if the buffer is detached later
            channelData.push(originalAudioBuffer.getChannelData(i).slice());
        }

        workletNode = new AudioWorkletNode(audioContext, processorName, {
            processorOptions: {
                wasmModule: Module, // Pass the loaded module
                sampleRate: originalAudioBuffer.sampleRate, // Use the audio file's rate
                numberOfChannels: originalAudioBuffer.numberOfChannels,
                // channelData: channelData, // Pass copied data (inefficient for large files)
                initialSlowSpeed: SIMULATED_SLOW_SPEED,
                // If using SAB: pass SharedArrayBuffer views here instead
            }
        });

        // Send initial channel data via message (alternative to processorOptions)
        // This can take time for large files!
        console.log("Sending channel data to worklet...");
        workletNode.port.postMessage({
            type: 'load-audio',
            channelData: channelData
        });
        console.log("Channel data message posted.");


        // Setup message listener *from* worklet (e.g., for status updates)
        workletNode.port.onmessage = (event) => {
            if (event.data.type === 'status') {
                console.log(`[WorkletStatus] ${event.data.message}`);
                // Optionally update UI based on worklet status
                 if (event.data.message === 'Audio loaded') {
                      playbackControlsDiv.style.display = 'block'; // Show controls only when worklet is ready
                      updateStatusUI("Ready to play.");
                 }
                 if (event.data.currentPlaybackTime !== undefined) {
                     // Update seek bar / time display if implemented
                 }
            } else if (event.data.type === 'error') {
                 console.error(`[WorkletError] ${event.data.message}`);
                 updateStatusUI(`Worklet Error: ${event.data.message}`, true);
                 // Consider stopping playback or disabling UI on worklet error
                 handlePlayPause(true); // Force pause
            }
        };

        workletNode.connect(audioContext.destination);
        console.log("AudioWorkletNode created and connected.");

        // Send initial parameters
        postWorkletMessage({ type: 'set-speed', value: parseFloat(speedSlider.value) });
        postWorkletMessage({ type: 'set-source', useSlow: useSlowSource });


    } catch (error) {
        updateStatusUI(`Error setting up AudioWorklet: ${error.message}`, true);
        console.error("AudioWorklet Setup Error:", error);
        if (workletNode) { workletNode.disconnect(); workletNode = null; }
        playbackControlsDiv.style.display = 'none';
    }
}

// --- Playback Controls ---
function handlePlayPause(forcePause = false) {
    if (!audioContext || !workletNode) return;

    if (audioContext.state === 'suspended') {
        audioContext.resume(); // Needed if context suspended by browser
    }

    if (forcePause) {
        isPlaying = false;
    } else {
        isPlaying = !isPlaying;
    }

    postWorkletMessage({ type: isPlaying ? 'play' : 'pause' });

    playPauseButton.textContent = isPlaying ? 'Pause' : 'Play';
    playbackStatusSpan.textContent = isPlaying ? 'Playing' : (forcePause ? 'Paused' : 'Stopped');
    console.log(`Playback state: ${isPlaying ? 'Playing' : 'Paused/Stopped'}`);
}

function handleSpeedChange(event) {
    const speed = parseFloat(event.target.value);
    speedValueSpan.textContent = `${speed.toFixed(2)}x`;
    postWorkletMessage({ type: 'set-speed', value: speed });
}

function handleSourceToggle() {
    useSlowSource = !useSlowSource;
    updateSourceButtonText();
    postWorkletMessage({ type: 'set-source', useSlow: useSlowSource });
    console.log(`Source toggled. Now using: ${useSlowSource ? 'Slow (Simulated)' : 'Original'}`);
}

function updateSourceButtonText() {
     sourceToggleButton.textContent = `Use ${useSlowSource ? `Slow (${SIMULATED_SLOW_SPEED}x)` : 'Original (1.0x)'}`;
}


// --- Communication with Worklet ---
function postWorkletMessage(message) {
    if (workletNode && workletNode.port) {
        try {
            // console.log("Posting message to worklet:", message); // DEBUG
            workletNode.port.postMessage(message);
        } catch (error) {
            console.error("Error posting message to worklet:", error);
            // Handle potential errors (e.g., if context/node becomes invalid)
        }
    } else {
        console.warn("Cannot post message: WorkletNode not ready or invalid.");
    }
}


// --- Start Initialization ---
document.addEventListener('DOMContentLoaded', initialize);