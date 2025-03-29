// /vibe-player/js/main.js

// Polyfill for requestAnimationFrame (used by some modules potentially)
window.requestAnimationFrame = window.requestAnimationFrame || window.mozRequestAnimationFrame || window.webkitRequestAnimationFrame || window.msRequestAnimationFrame;
window.cancelAnimationFrame = window.cancelAnimationFrame || window.mozCancelAnimationFrame;

// Create the main application namespace
window.AudioApp = window.AudioApp || {};

/**
 * Main application entry point. Initializes modules and coordinates setup.
 */
AudioApp.init = async () => {
    console.log("AudioApp initializing...");

    // --- 1. Configuration ---
    // Config should be loaded first via its own script tag
    const config = AudioApp.config;
    if (!config) {
        console.error("FATAL: Configuration (AudioApp.config) not found. Ensure config.js is loaded before main.js.");
        alert("Application configuration failed to load. Cannot continue.");
        return;
    }
    console.log("Configuration loaded.");

    // --- 2. AudioContext ---
    let audioContext;
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (!audioContext) {
            throw new Error("Web Audio API not supported by this browser.");
        }
        console.log(`AudioContext created. Sample Rate: ${audioContext.sampleRate}Hz, State: ${audioContext.state}`);
        // Store context globally for modules that need it directly (less ideal, but simple)
        AudioApp.audioContext = audioContext;

        // Handle suspended state - user interaction will be needed later
        if (audioContext.state === 'suspended') {
            console.warn("AudioContext is suspended. User interaction (e.g., click) will be required to resume.");
            // Optionally show a UI message here via uiManager if it's initialized
        }
    } catch (error) {
        console.error("FATAL: Failed to create AudioContext:", error);
        alert(`Failed to initialize audio: ${error.message}. The application cannot run.`);
        return;
    }

    // --- 3. Module Initialization ---
    // Initialize modules that don't have heavy async dependencies first.
    // Order can matter based on dependencies.

    try {
        // UI Manager (Handles DOM elements)
        if (!AudioApp.uiManager || typeof AudioApp.uiManager.init !== 'function') throw new Error("uiManager not loaded");
        AudioApp.uiManager.init(config); // Pass config for initial values/settings
        console.log("UIManager initialized.");

        // Visualizer (Handles Canvas drawing)
        if (!AudioApp.visualizer || typeof AudioApp.visualizer.init !== 'function') throw new Error("visualizer not loaded");
        AudioApp.visualizer.init(config); // Pass config for colors, sizes etc.
        console.log("Visualizer initialized.");

        // VAD Pipeline (Wrapper, Processor, Analyzer)
        // These might have internal dependencies or async init steps.
        if (!AudioApp.sileroWrapper || typeof AudioApp.sileroWrapper.init !== 'function') throw new Error("sileroWrapper not loaded");
        AudioApp.sileroWrapper.init(config); // Pass config for ONNX paths
        console.log("SileroWrapper initialized.");

        if (!AudioApp.sileroProcessor || typeof AudioApp.sileroProcessor.init !== 'function') throw new Error("sileroProcessor not loaded");
        AudioApp.sileroProcessor.init(AudioApp.sileroWrapper); // Pass wrapper instance
        console.log("SileroProcessor initialized.");

        if (!AudioApp.vadAnalyzer || typeof AudioApp.vadAnalyzer.init !== 'function') throw new Error("vadAnalyzer not loaded");
        // vadAnalyzer's init might load the ONNX model via the wrapper
        await AudioApp.vadAnalyzer.init(config.vad, AudioApp.sileroProcessor); // Pass VAD config and processor
        console.log("VadAnalyzer initialized.");

        // Worklet Manager (Handles worklet lifecycle and WASM fetching)
        if (!AudioApp.workletManager || typeof AudioApp.workletManager.init !== 'function') throw new Error("workletManager not loaded");
        await AudioApp.workletManager.init(audioContext, config); // Async init likely fetches WASM
        console.log("WorkletManager initialized.");

        // Audio Loader (Handles file reading, decoding, triggers VAD)
        if (!AudioApp.audioLoader || typeof AudioApp.audioLoader.init !== 'function') throw new Error("audioLoader not loaded");
        AudioApp.audioLoader.init(audioContext, config, AudioApp.vadAnalyzer, AudioApp.uiManager); // Pass dependencies
        console.log("AudioLoader initialized.");

        // Playback Controller (Connects UI events to worklet manager, manages state)
        if (!AudioApp.playbackController || typeof AudioApp.playbackController.init !== 'function') throw new Error("playbackController not loaded");
        AudioApp.playbackController.init(audioContext, config, AudioApp.uiManager, AudioApp.workletManager, AudioApp.vadAnalyzer); // Pass dependencies
        console.log("PlaybackController initialized.");

        console.log("All modules initialized successfully.");
        AudioApp.uiManager?.showStatus("Ready. Please load an audio file.");

    } catch (error) {
        console.error("FATAL: Initialization error:", error);
        const errorMsg = `Application initialization failed: ${error.message}. Please check console for details.`;
        alert(errorMsg); // Simple alert for critical errors
        AudioApp.uiManager?.showError(errorMsg, true); // Also try showing in UI
        // Disable relevant UI elements?
        AudioApp.uiManager?.enableControls(false);
        AudioApp.uiManager?.disableFileInput(true);
        return; // Stop initialization
    }

    // --- 4. Post-Initialization ---
    // Any actions needed after all modules are loaded and initialized.
    // For now, modules are set up to listen for events (file selection etc.).

    console.log("AudioApp initialization complete. Waiting for user action.");
};

// --- Global Error Handling (Optional) ---
window.addEventListener('error', (event) => {
    console.error('Unhandled global error:', event.error, event);
    // Optionally display a generic error message to the user
    // AudioApp.uiManager?.showError(`An unexpected error occurred: ${event.message}`, true);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason, event);
    // AudioApp.uiManager?.showError(`An unexpected error occurred (async): ${event.reason}`, true);
});


// --- Start Initialization on DOMContentLoaded ---
// Design Decision: Use DOMContentLoaded to ensure HTML is parsed before trying
// to access elements (in uiManager.init) or initialize the app.
document.addEventListener('DOMContentLoaded', () => {
    AudioApp.init(); // Initialize the application
});

// /vibe-player/js/main.js
