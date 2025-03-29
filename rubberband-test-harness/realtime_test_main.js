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
                console.warn("AudioContext is suspended. User interaction needed.");
                updateStatusUI("AudioContext suspended. Click button after loading file.");
            } else {
                console.log("AudioContext state:", audioContext.state);
            }
        } catch (ctxError) {
            throw new Error(`Failed to create AudioContext: ${ctxError.message}`);
        }
        console.log(`AudioContext Sample Rate: ${audioContext.sampleRate}`);

        // --- Pre-fetch WASM ---
        updateStatusUI('Fetching WASM binary...');
        try {
            const wasmPath = 'rubberband.wasm';
            const response = await fetch(wasmPath);
            if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${wasmPath}`);
            wasmBinary = await response.arrayBuffer();
            console.log(`Fetched WASM binary (${wasmBinary.byteLength} bytes).`);
        } catch (fetchError) {
            updateStatusUI(`Failed to fetch WASM: ${fetchError.message}.`, true);
            console.error("WASM Fetch Error:", fetchError);
            wasmBinary = null;
        }

        // --- Pre-fetch Loader Script ---
        updateStatusUI('Fetching Loader Script text...');
        try {
            const loaderPath = 'rubberband.js';
            const response = await fetch(loaderPath);
            if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${loaderPath}`);
            loaderScriptText = await response.text();
            console.log(`Fetched Loader Script text (${loaderScriptText.length} chars).`);
        } catch (fetchError) {
            updateStatusUI(`Failed to fetch Loader Script: ${fetchError.message}.`, true);
            console.error("Loader Fetch Error:", fetchError);
            loaderScriptText = null;
        }

        setupEventListeners();
        if (wasmBinary && loaderScriptText) {
            if (audioContext.state !== 'suspended') updateStatusUI('Ready. Please upload an audio file.');
        } else {
            updateStatusUI('Initialization incomplete (WASM or Loader fetch failed).', true);
        }

    } catch (error) {
        updateStatusUI(`Initialization failed: ${error.message}`, true);
        console.error("Init error:", error);
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
        updateStatusUI("AudioContext missing.", true);
        return;
    }
    ;

    updateStatusUI(`Loading file: ${file.name}...`);
    await cleanupCurrentWorklet();
    originalAudioBuffer = null;
    isPlaying = false;
    workletIsPlaying = false;
    workletReady = false;
    playPauseButton.textContent = 'Play';
    playbackStatusSpan.textContent = 'Idle';
    playbackControlsDiv.style.display = 'none';
    fileInput.disabled = true;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            updateStatusUI('Decoding audio data...');
            originalAudioBuffer = await audioContext.decodeAudioData(e.target.result);
            if (!originalAudioBuffer || originalAudioBuffer.length === 0) throw new Error("Decoded buffer invalid.");
            console.log(`Decoded SR: ${originalAudioBuffer.sampleRate}, Context SR: ${audioContext.sampleRate}`);
            if (originalAudioBuffer.sampleRate !== audioContext.sampleRate) {
                console.warn(`[Main] Sample rate mismatch (${originalAudioBuffer.sampleRate} vs ${audioContext.sampleRate}).`);
            }
            updateStatusUI(`File loaded. SR: ${originalAudioBuffer.sampleRate}, Ch: ${originalAudioBuffer.numberOfChannels}, Dur: ${originalAudioBuffer.duration.toFixed(2)}s`);

            if (wasmBinary && loaderScriptText) {
                await setupAndStartWorklet();
            } else {
                throw new Error("WASM/Loader script missing.");
            }

        } catch (error) {
            updateStatusUI(`Error processing file: ${error.message}`, true);
            console.error('File Processing Error:', error);
            originalAudioBuffer = null;
            fileInput.disabled = false;
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
        console.log("[Main] Cleaning up previous worklet node...");
        try {
            postWorkletMessage({type: 'cleanup'});
            await new Promise(resolve => setTimeout(resolve, 50));
            workletNode.port.close();
            workletNode.disconnect();
            console.log("[Main] Previous worklet node disconnected and cleaned up.");
        } catch (e) {
            console.warn("[Main] Error during worklet cleanup:", e);
        } finally {
            workletNode = null;
            workletReady = false;
            workletIsPlaying = false;
        }
    }
}

// --- AudioWorklet Setup ---
async function setupAndStartWorklet() {
    if (!audioContext || !originalAudioBuffer || !wasmBinary || !loaderScriptText) {
        updateStatusUI("Cannot setup - missing context, audio, WASM, or loader.", true);
        fileInput.disabled = false;
        return;
    }

    try {
        updateStatusUI("Setting up audio processing worklet...");
        await cleanupCurrentWorklet();

        const processorName = 'hybrid-processor';
        const processorUrl = 'realtime_test_processor.js';

        try {
            console.log(`[Main] Adding AudioWorklet module: ${processorUrl}`);
            await audioContext.audioWorklet.addModule(processorUrl);
            console.log("[Main] AudioWorklet module added successfully.");
        } catch (e) {
            throw new Error(`Failed to add AudioWorklet module: ${e.message}`);
        }

        const wasmBinaryTransfer = wasmBinary.slice(0);
        const wasmTransferList = [wasmBinaryTransfer];

        console.log("[Main] Creating AudioWorkletNode...");
        workletNode = new AudioWorkletNode(audioContext, processorName, {
            numberOfInputs: 1, numberOfOutputs: 1,
            outputChannelCount: [originalAudioBuffer.numberOfChannels],
            processorOptions: {
                sampleRate: audioContext.sampleRate,
                numberOfChannels: originalAudioBuffer.numberOfChannels,
                initialSlowSpeed: SIMULATED_SLOW_SPEED,
                wasmBinary: wasmBinaryTransfer, // Pass copy
                loaderScriptText: loaderScriptText
            }
        }, wasmTransferList); // Transfer wasmBinary

        console.log("[Main] Setting up worklet message listener...");
        workletNode.port.onmessage = (event) => {
            const data = event.data;
            console.log("[Main] Raw message received from worklet:", event.data); // <-- ADDED LOG

            if (data.type === 'status') {
                console.log(`[WorkletStatus] ${data.message}`);
                if (data.message === 'processor-ready') {
                    console.log("[Main] 'processor-ready' status received. Updating UI."); // <-- ADDED LOG
                    workletReady = true;
                    playbackControlsDiv.style.display = 'block';
                    updateStatusUI("Ready to play.");
                    fileInput.disabled = false;
                    postWorkletMessage({type: 'set-speed', value: parseFloat(speedSlider.value)});
                    postWorkletMessage({type: 'set-source', useSlow: useSlowSource});
                } else if (data.message === 'Playback ended') {
                    if (isPlaying || workletIsPlaying) {
                        isPlaying = false;
                        workletIsPlaying = false;
                        playPauseButton.textContent = 'Play';
                        playbackStatusSpan.textContent = 'Finished';
                        updateStatusUI("Playback finished.");
                    }
                } else if (data.message === 'Processor cleaned up') {
                    workletReady = false;
                    workletIsPlaying = false;
                }
            } else if (data.type === 'error') {
                console.error(`[WorkletError] ${data.message}`);
                updateStatusUI(`Worklet Error: ${data.message}`, true);
                isPlaying = false;
                workletIsPlaying = false;
                workletReady = false;
                playPauseButton.textContent = 'Play';
                playbackStatusSpan.textContent = 'Error';
                playbackControlsDiv.style.display = 'none';
                fileInput.disabled = false;
                cleanupCurrentWorklet();
            } else if (data.type === 'playback-state') {
                console.log(`[Main] Received playback state confirmation: isPlaying=${data.isPlaying}`);
                workletIsPlaying = data.isPlaying;
                if (isPlaying !== workletIsPlaying) {
                    console.warn("[Main] Syncing UI state to worklet state.");
                    isPlaying = workletIsPlaying;
                    playPauseButton.textContent = isPlaying ? 'Pause' : 'Play';
                    playbackStatusSpan.textContent = isPlaying ? 'Playing' : (workletReady ? 'Stopped' : 'Error');
                } else {
                    playbackStatusSpan.textContent = isPlaying ? 'Playing' : (workletReady ? 'Stopped' : 'Error');
                }
            } else {
                console.warn("[Main] Unrecognized message type from worklet:", data.type); // <-- ADDED LOG
            }
        };
        workletNode.onprocessorerror = (event) => {
            console.error(`[Main] AudioWorkletProcessor error event:`, event);
            updateStatusUI(`Critical Processor Error! Playback stopped.`, true);
            isPlaying = false;
            workletIsPlaying = false;
            workletReady = false;
            playPauseButton.textContent = 'Play';
            playbackStatusSpan.textContent = 'Error';
            playbackControlsDiv.style.display = 'none';
            fileInput.disabled = false;
            cleanupCurrentWorklet();
        };

        console.log("[Main] Connecting worklet node to destination...");
        workletNode.connect(audioContext.destination);
        console.log("[Main] AudioWorkletNode created and connected.");

        console.log("[Main] Preparing audio data for transfer...");
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
            throw new Error(`Failed to prepare channel data: ${error.message}`);
        }

        console.log(`[Main] Sending ${channelData.length} channel data buffers (transferable)...`);
        postWorkletMessage({type: 'load-audio', channelData: channelData}, transferListAudio);

    } catch (error) {
        updateStatusUI(`Error setting up Worklet: ${error.message}`, true);
        console.error("[Main] Worklet Setup Error:", error);
        await cleanupCurrentWorklet();
        playbackControlsDiv.style.display = 'none';
        fileInput.disabled = false;
    }
}

// --- Playback Controls ---
async function handlePlayPause() {
    if (!audioContext) {
        updateStatusUI("AudioContext missing.", true);
        return;
    }
    if (!workletNode || !workletReady) {
        console.warn("[Main] Cannot play/pause: Worklet not ready.");
        if (!originalAudioBuffer) updateStatusUI("Load audio first.", true);
        else if (!wasmBinary || !loaderScriptText) updateStatusUI("Init failed.", true);
        else updateStatusUI("Worklet not ready. Wait.", true);
        return;
    }

    if (audioContext.state === 'suspended') {
        console.log("[Main] Attempting to resume AudioContext...");
        try {
            await audioContext.resume();
            console.log("[Main] AudioContext resumed. State:", audioContext.state);
            updateStatusUI("AudioContext resumed.");
        } catch (err) {
            updateStatusUI(`Failed to resume AC: ${err.message}`, true);
            console.error("[Main] Failed to resume AC:", err);
            return;
        }
    }
    if (audioContext.state !== 'running') {
        updateStatusUI(`AC not running (state: ${audioContext.state}).`, true);
        return;
    }

    const targetIsPlaying = !isPlaying;
    console.log(`[Main] Play/Pause toggled. Desired state: ${targetIsPlaying ? 'Play' : 'Pause'}`);
    postWorkletMessage({type: targetIsPlaying ? 'play' : 'pause'});

    isPlaying = targetIsPlaying;
    playPauseButton.textContent = isPlaying ? 'Pause' : 'Play';
    playbackStatusSpan.textContent = isPlaying ? 'Playing...' : 'Paused';
}

function handleSpeedChange(event) {
    if (!workletReady) return;
    const speed = parseFloat(event.target.value);
    speedValueSpan.textContent = `${speed.toFixed(2)}x`;
    postWorkletMessage({type: 'set-speed', value: speed});
}

function handleSourceToggle() {
    if (!workletReady) return;
    useSlowSource = !useSlowSource;
    updateSourceButtonText();
    postWorkletMessage({type: 'set-source', useSlow: useSlowSource});
    console.log(`[Main] Source toggled. Sending useSlow: ${useSlowSource}`);
}

function updateSourceButtonText() {
    sourceToggleButton.textContent = `Using ${useSlowSource ? `Slow (${SIMULATED_SLOW_SPEED}x)` : 'Original (1.0x)'}`;
}

// --- Communication with Worklet ---
function postWorkletMessage(message, transferList = []) {
    if (workletNode && workletNode.port) {
        try {
            // console.log("[Main] Posting message to worklet:", message.type);
            workletNode.port.postMessage(message, transferList);
        } catch (error) {
            console.error("[Main] Error posting message:", error);
            updateStatusUI(`Comms error: ${error.message}`, true);
            isPlaying = false;
            workletIsPlaying = false;
            workletReady = false;
            playPauseButton.textContent = 'Play';
            playbackStatusSpan.textContent = 'Error';
            playbackControlsDiv.style.display = 'none';
            fileInput.disabled = false;
            cleanupCurrentWorklet();
        }
    } else {
        if (workletReady) console.warn("[Main] Cannot post message: Port not available/closed?");
    }
}

// --- Start Initialization ---
document.addEventListener('DOMContentLoaded', initialize);