// --- DOM Elements ---
const fileInput = document.getElementById('audioFile');
const speedSlider = document.getElementById('speedSlider');
const speedValueSpan = document.getElementById('speedValue');
const playPauseButton = document.getElementById('playPauseButton');
const statusDisplay = document.getElementById('status');

// --- Web Audio API State ---
let audioContext = null;
let soundtouchNode = null;
let audioSource = null; // Can be BufferSourceNode
let audioBuffer = null; // To store the decoded audio data
let isPlaying = false;
let isWorkletReady = false;
let currentPlaybackSpeed = 1.0;

// --- Initialization ---

// Function to setup the AudioContext and load the worklet
// Must be called after a user interaction (like file selection)
async function setupAudioContext() {
    if (audioContext) return; // Already initialized

    try {
        statusDisplay.textContent = "Initializing Audio Engine...";
        audioContext = new AudioContext();

        // Load the SoundTouch AudioWorklet Processor from the local file
        await audioContext.audioWorklet.addModule('./soundtouch-worklet.js'); // <--- Uses the local file
        console.log("SoundTouch AudioWorklet registered.");
        isWorkletReady = true;
        statusDisplay.textContent = "Audio Engine Ready. Load a file.";

    } catch (error) {
        console.error("Error setting up AudioContext or Worklet:", error);
        // Common issue: If running from file://, addModule might fail. Use a local server.
        statusDisplay.textContent = `Error: ${error.message}. AudioWorklets often require HTTPS or localhost. Try serving this folder via a local web server.`;
        isWorkletReady = false;
    }
}

// --- Event Listeners ---

fileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Ensure AudioContext is running (required by Safari/Firefox sometimes)
    if (!audioContext) {
         // Try to setup context on first file interaction. Needs user gesture.
         // Wrap in a try/catch in case user blocks AudioContext creation.
        try {
             await setupAudioContext();
         } catch (setupError) {
             console.error("Failed to setup AudioContext:", setupError);
             statusDisplay.textContent = "Failed to initialize Audio Engine. Please allow audio playback.";
             return;
         }
    }
     if (!isWorkletReady) {
        statusDisplay.textContent = "Audio Worklet failed to load. Cannot process audio.";
        return;
    }
     // Ensure context is running after user gesture
    if (audioContext.state === 'suspended') {
        try {
            await audioContext.resume();
        } catch (resumeError) {
             console.error("Failed to resume AudioContext:", resumeError);
             statusDisplay.textContent = "Failed to resume audio context.";
             return;
        }
    }


    playPauseButton.disabled = true;
    statusDisplay.textContent = `Loading "${file.name}"...`;
    isPlaying = false; // Reset playback state
    updatePlayButton();

    // Stop any existing playback and clean up nodes
    cleanupAudioNodes();

    try {
        const arrayBuffer = await file.arrayBuffer();
        statusDisplay.textContent = `Decoding "${file.name}"...`;
        // Decode audio data using the AudioContext
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        statusDisplay.textContent = `Ready to play "${file.name}"`;
        playPauseButton.disabled = false;
        console.log("Audio decoded successfully:", audioBuffer);
    } catch (error) {
        console.error("Error loading or decoding audio file:", error);
        statusDisplay.textContent = `Error decoding "${file.name}": ${error.message}`;
        audioBuffer = null;
        playPauseButton.disabled = true;
    }
});

speedSlider.addEventListener('input', () => {
    currentPlaybackSpeed = parseFloat(speedSlider.value);
    speedValueSpan.textContent = `${currentPlaybackSpeed.toFixed(2)}x`;

    // Update tempo parameter in real-time if the node exists
    if (soundtouchNode && audioContext) { // Check audioContext too
        const tempoParam = soundtouchNode.parameters.get('tempo');
        if (tempoParam) {
            // Use setTargetAtTime for smoother transitions
            tempoParam.setTargetAtTime(currentPlaybackSpeed, audioContext.currentTime, 0.01);
        } else {
            console.warn("Could not find 'tempo' parameter on soundtouchNode.");
        }
    }
});

playPauseButton.addEventListener('click', async () => {
    if (!audioContext || !audioBuffer || !isWorkletReady) {
        console.error("Audio not ready.");
        if (!isWorkletReady && audioContext) {
             statusDisplay.textContent = "Worklet not loaded. Cannot play.";
        } else if (!audioBuffer) {
            statusDisplay.textContent = "No audio file loaded/decoded.";
        }
        return;
    }

    // Resume context if it was suspended (important!)
     if (audioContext.state === 'suspended') {
        try {
            await audioContext.resume();
        } catch (resumeError) {
             console.error("Failed to resume AudioContext:", resumeError);
             statusDisplay.textContent = "Could not resume audio context. Please interact with the page.";
             return; // Don't proceed if context can't be resumed
        }
    }
     // Double-check context state after attempting resume
    if (audioContext.state !== 'running') {
        console.error("AudioContext is not running.");
        statusDisplay.textContent = "Audio engine not running. Please interact or reload.";
        return;
    }


    if (isPlaying) {
        // Pause Logic
        if (audioSource) {
            // Stopping the source is preferred for pausing/restarting with BufferSource
            audioSource.stop();
            // Note: You can't restart a BufferSource after stopping.
            // We rely on creating a new one in the Play logic.
        }
        isPlaying = false;
        statusDisplay.textContent = "Paused.";
    } else {
        // Play Logic
        cleanupAudioNodes(); // Ensure clean state before playing

        try {
            // 1. Create the source node
            audioSource = audioContext.createBufferSource();
            audioSource.buffer = audioBuffer;

            // 2. Create the SoundTouch node
            soundtouchNode = new AudioWorkletNode(audioContext, 'soundtouch-processor');
            console.log("Created SoundTouchNode:", soundtouchNode);
            // console.log("Available parameters:", [...soundtouchNode.parameters.keys()]);

            // 3. Set the initial tempo and ensure correct pitch settings
            const tempoParam = soundtouchNode.parameters.get('tempo');
             if (tempoParam) {
                 tempoParam.value = currentPlaybackSpeed; // Set initial value directly
            } else {
                 console.error("FATAL: 'tempo' parameter not found on initial node creation.");
                 statusDisplay.textContent = "Error: SoundTouch node missing 'tempo'. Cannot play.";
                 cleanupAudioNodes();
                 return;
             }
            const rateParam = soundtouchNode.parameters.get('rate');
            if (rateParam) rateParam.value = 1.0; // Ensure playback rate is normal
            const pitchParam = soundtouchNode.parameters.get('pitch');
            if (pitchParam) pitchParam.value = 1.0; // Ensure pitch is normal


            // 4. Connect the nodes: Source -> SoundTouch -> Destination
            audioSource.connect(soundtouchNode);
            soundtouchNode.connect(audioContext.destination);

            // 5. Handle playback ending
            audioSource.onended = () => {
                // Check isPlaying flag: only reset UI if playback finished naturally,
                // not if it was manually stopped by cleanupAudioNodes or pause.
                if (isPlaying) {
                    isPlaying = false;
                    updatePlayButton();
                    statusDisplay.textContent = "Playback finished.";
                    // Don't cleanup nodes here automatically, allow replaying
                }
            };

            // 6. Start playback
            audioSource.start(0); // Start playing immediately
            isPlaying = true;
            statusDisplay.textContent = "Playing...";

        } catch (error) {
             console.error("Error during playback setup:", error);
             statusDisplay.textContent = `Playback error: ${error.message}`;
             cleanupAudioNodes(); // Clean up on error
             isPlaying = false; // Ensure state is correct
        }
    }
    updatePlayButton();
});

// --- Helper Functions ---

function updatePlayButton() {
    playPauseButton.textContent = isPlaying ? "Pause" : "Play";
}

function cleanupAudioNodes() {
     // Stop source first if it exists and is playing
    if (audioSource) {
        try {
            // Remove the onended listener before stopping to prevent conflicts
            // if stop() triggers onended immediately.
            audioSource.onended = null;
            audioSource.stop();
        } catch (e) {
             // Ignore errors like "InvalidStateNode" if already stopped
             // console.warn("Ignoring error during audioSource.stop():", e.message);
        }
        audioSource.disconnect(); // Disconnect from downstream nodes
        audioSource = null;
         // console.log("AudioSource stopped and disconnected.");
    }
    if (soundtouchNode) {
        soundtouchNode.disconnect(); // Disconnect from downstream nodes
        soundtouchNode = null;
         // console.log("SoundTouchNode disconnected.");
    }
     // Setting isPlaying false here ensures the UI updates correctly
     // if cleanup is called during unexpected scenarios.
     // isPlaying = false; // Let the caller manage isPlaying state ideally
     // updatePlayButton(); // Reflect potential state change
}

// --- Initial UI State ---
speedValueSpan.textContent = `${parseFloat(speedSlider.value).toFixed(2)}x`;
playPauseButton.disabled = true; // Disabled until file is loaded