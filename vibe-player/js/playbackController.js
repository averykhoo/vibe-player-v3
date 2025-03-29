// /vibe-player/js/playbackController.js

/**
 * Manages playback state, translates UI events into audio engine commands,
 * and updates the UI based on worklet feedback.
 */
const playbackController = (() => {
    // --- Private Module State ---
    let audioContext = null;
    let config = null;
    let uiManager = null; // Reference to AudioApp.uiManager
    let workletManager = null; // Reference to AudioApp.workletManager
    let vadAnalyzer = null; // Reference to AudioApp.vadAnalyzer

    let isPlaying = false; // Primary playback state holder
    let isAudioReadyForPlayback = false; // Has audio loaded AND worklet ready?
    let currentTime = 0.0;
    let duration = 0.0;

    let gainNode = null; // GainNode for volume control

    // --- Private Methods ---

    /** Connects the worklet node to the gain node and destination. */
    function connectAudioGraph() {
        if (!audioContext || !workletManager) {
             console.error("[PlaybackCtrl] Cannot connect graph: Missing context or workletManager.");
             return;
        }
        const node = workletManager.getNode();
        if (!node) {
            console.error("[PlaybackCtrl] Cannot connect graph: Worklet node not available.");
            return;
        }

        // Create GainNode if it doesn't exist
        if (!gainNode) {
             try {
                 gainNode = audioContext.createGain();
                 gainNode.gain.value = config?.playback?.defaultGain ?? 1.0; // Set initial gain
                 console.log("[PlaybackCtrl] GainNode created.");
             } catch (error) {
                 console.error("[PlaybackCtrl] Failed to create GainNode:", error);
                 uiManager?.showError("Failed to create volume control node.");
                 return; // Don't connect if gain creation failed
             }
         }

        try {
            console.log("[PlaybackCtrl] Connecting WorkletNode -> GainNode -> Destination");
            node.disconnect(); // Ensure no previous connections interfere
            node.connect(gainNode).connect(audioContext.destination);
        } catch (error) {
            console.error("[PlaybackCtrl] Error connecting audio graph:", error);
            uiManager?.showError("Failed to connect audio processing graph.");
        }
    }

    /** Updates the state and UI when audio/worklet becomes ready. */
    function handleAudioAndWorkletReady() {
         // Check if *both* audio is loaded (from audioLoader event)
         // and worklet is initialized (from workletManager event)
         // This function could be called by listeners for both events.
         const buffer = AudioApp.audioLoader?.getOriginalBuffer(); // Check if audioLoader has buffer

         if (buffer && workletManager?.isReady()) {
             if (!isAudioReadyForPlayback) { // Only act on the first time both are ready
                  console.log("[PlaybackCtrl] Audio and Worklet are ready for playback.");
                  isAudioReadyForPlayback = true;
                  duration = buffer.duration;
                  currentTime = 0;
                  isPlaying = false; // Ensure starts paused
                  uiManager?.enableControls(true); // Enable playback controls etc.
                  uiManager?.setPlayButtonState('Play'); // Set initial button state
                  uiManager?.updateTimeDisplay(currentTime, duration);
                  // Set initial slider values from config/defaults
                  const initialGain = config?.playback?.defaultGain ?? 1.0;
                  const initialSpeed = config?.playback?.defaultSpeed ?? 1.0;
                  uiManager?.setGain(initialGain);
                  uiManager?.setSpeed(initialSpeed);
                   // Apply initial gain/speed to worklet
                   if(gainNode) gainNode.gain.setValueAtTime(initialGain, audioContext.currentTime);
                   workletManager.setSpeed(initialSpeed);

                  connectAudioGraph(); // Connect the nodes now that the worklet exists
             }
         } else {
              // console.log("[PlaybackCtrl] Waiting for both audio and worklet to be ready...");
         }
    }


    // --- Event Handlers (Listening to UI Events) ---

    function handlePlayPauseToggle() {
        if (!isAudioReadyForPlayback || !workletManager) {
             console.warn("[PlaybackCtrl] Cannot toggle play/pause: Not ready.");
             return;
         }

         // Resume AudioContext if suspended (essential for user interaction start)
         if (audioContext.state === 'suspended') {
             console.log("[PlaybackCtrl] Resuming AudioContext on play/pause toggle...");
             audioContext.resume().then(() => {
                 console.log("[PlaybackCtrl] AudioContext resumed, proceeding with toggle.");
                 performPlayPauseToggle();
             }).catch(err => {
                 console.error("[PlaybackCtrl] Failed to resume AudioContext:", err);
                 uiManager?.showError(`Could not start audio: ${err.message}`);
             });
         } else {
             performPlayPauseToggle();
         }
     }

    function performPlayPauseToggle() {
        if (!isAudioReadyForPlayback || !workletManager) return; // Double check after potential resume

        if (isPlaying) {
            workletManager.pause();
            // UI state update will be handled by 'workletPlaybackState' event listener
        } else {
            workletManager.play();
            // UI state update will be handled by 'workletPlaybackState' event listener
        }
         // We optimistically update the button text here, but the confirmation
         // from the worklet via 'workletPlaybackState' is the source of truth for the `isPlaying` flag.
        // uiManager?.setPlayButtonState(isPlaying ? 'Pause...' : 'Play...'); // Indicate pending state
    }

    function handleSpeedChange(event) {
        if (!workletManager) return;
        const speed = parseFloat(event.detail.value ?? config?.playback?.defaultSpeed ?? 1.0);
        workletManager.setSpeed(speed);
        uiManager?.updateSpeedDisplay(speed); // Update UI immediately
    }

    function handleGainChange(event) {
        if (!gainNode || !audioContext) {
            console.warn("[PlaybackCtrl] Cannot change gain: GainNode or AudioContext not available.");
            return;
        }
        const gain = parseFloat(event.detail.value ?? config?.playback?.defaultGain ?? 1.0);
        // Use setTargetAtTime for smooth gain changes, avoiding clicks
        // gainNode.gain.setTargetAtTime(gain, audioContext.currentTime, 0.01); // 0.01s smoothing time constant
        gainNode.gain.setValueAtTime(gain, audioContext.currentTime); // Immediate change (simpler for now)

        uiManager?.updateGainDisplay(gain); // Update UI immediately
    }

    function handleJump(event) {
        if (!isAudioReadyForPlayback || !workletManager) return;
        const seconds = parseFloat(event.detail.seconds ?? 0);
        workletManager.jump(seconds);
    }

    function handleSeek(event) {
        if (!isAudioReadyForPlayback || !workletManager) return;
        const positionSeconds = parseFloat(event.detail.positionSeconds ?? 0);
        // Clamp seek position just in case
        const clampedPosition = Math.max(0, Math.min(positionSeconds, duration));
        workletManager.seek(clampedPosition);
         // Optional: Immediately update UI time display for responsiveness
        // currentTime = clampedPosition;
        // uiManager?.updateTimeDisplay(currentTime, duration);
        // visualizer?.updateProgressIndicator(currentTime / duration);
    }

    function handleVadThresholdChange(event) {
         if (!vadAnalyzer || !AudioApp.visualizer) return; // Check dependencies exist
         const { threshold, negative_threshold } = event.detail;
         // Update VAD Analyzer state
         vadAnalyzer.setThresholds(threshold, negative_threshold);
         // Get the recalculated regions
         const newVadResults = vadAnalyzer.getResults(); // Assume getResults returns the latest { regions, stats }
         // Update VAD text display
         uiManager?.updateVadDisplay(newVadResults);
         // Redraw waveform highlights
         AudioApp.visualizer.redrawWaveformHighlight(newVadResults?.regions);
         console.log("[PlaybackCtrl] VAD Thresholds updated and visualization refreshed.");
    }


    // --- Event Handlers (Listening to WorkletManager Events) ---

    function handleWorkletReady() {
        // Called when worklet posts 'processor-ready'
        console.log("[PlaybackCtrl] Received workletReady event.");
        handleAudioAndWorkletReady(); // Check if audio is also ready
    }

    function handleWorkletTimeUpdate(event) {
        if (!isAudioReadyForPlayback) return; // Ignore if not fully ready
        currentTime = event.detail.currentTime ?? 0;
        uiManager?.updateTimeDisplay(currentTime, duration);
        // Visualizer listens for this event separately
    }

    function handleWorkletPlaybackEnded() {
        console.log("[PlaybackCtrl] Received workletPlaybackEnded event.");
        isPlaying = false;
        isAudioReadyForPlayback = true; // Still ready to play again
        currentTime = duration; // Ensure time shows end
        uiManager?.setPlayButtonState('Play');
        uiManager?.updateTimeDisplay(currentTime, duration);
         // Visualizer updates progress via time update events, but ensure final state
         AudioApp.visualizer?.updateProgressIndicator(1.0);
    }

     function handleWorkletPlaybackState(event) {
         const workletIsPlaying = event.detail.isPlaying;
         console.log(`[PlaybackCtrl] Received workletPlaybackState: ${workletIsPlaying}`);
         if (isPlaying !== workletIsPlaying) {
              isPlaying = workletIsPlaying;
              uiManager?.setPlayButtonState(isPlaying ? 'Pause' : 'Play');
              console.log(`[PlaybackCtrl] Playback state updated to: ${isPlaying}`);
         }
     }

    function handleWorkletError(event) {
        console.error(`[PlaybackCtrl] Received workletError event: ${event.detail.message}`);
        isAudioReadyForPlayback = false; // No longer ready
        isPlaying = false;
        uiManager?.setPlayButtonState('Play');
        uiManager?.enableControls(false); // Disable controls on error
        uiManager?.showError(`Playback Error: ${event.detail.message}`); // Show error to user
    }

    // --- Event Handlers (Listening to AudioLoader Events) ---
     function handleAudioReady(event) {
         // Called when audioLoader finishes decoding and VAD
         console.log("[PlaybackCtrl] Received audioReady event.");
         const buffer = event.detail.buffer;
         if (buffer) {
              duration = buffer.duration;
              currentTime = 0;
              uiManager?.updateTimeDisplay(currentTime, duration); // Update duration display
              handleAudioAndWorkletReady(); // Check if worklet is also ready
         } else {
              console.error("[PlaybackCtrl] audioReady event missing buffer detail.");
         }
     }

    // --- Public API ---
    return {
        /**
         * Initializes the PlaybackController.
         * @param {AudioContext} ctx The main AudioContext.
         * @param {AudioAppConfig} appConfig The application configuration.
         * @param {object} uiMgr Instance of UI Manager.
         * @param {object} workletMgr Instance of Worklet Manager.
         * @param {object} analyzerInstance Instance of VAD Analyzer.
         */
        init(ctx, appConfig, uiMgr, workletMgr, analyzerInstance) {
            if (!ctx || !appConfig || !uiMgr || !workletMgr || !analyzerInstance) {
                throw new Error("PlaybackController init requires AudioContext, Config, UI Manager, Worklet Manager, and VAD Analyzer instances.");
            }
            audioContext = ctx;
            config = appConfig;
            uiManager = uiMgr;
            workletManager = workletMgr;
            vadAnalyzer = analyzerInstance; // Store VAD Analyzer reference

            // Create GainNode early
            try {
                 gainNode = audioContext.createGain();
                 gainNode.gain.value = config?.playback?.defaultGain ?? 1.0; // Set initial gain
                 console.log("[PlaybackCtrl] GainNode created during init.");
                 // Connect to destination immediately
                 gainNode.connect(audioContext.destination);
                 console.log("[PlaybackCtrl] GainNode connected to destination.");
            } catch (error) {
                 console.error("[PlaybackCtrl] Failed to create or connect GainNode during init:", error);
                 uiManager?.showError("Failed to initialize volume control.");
             }


            // Listen to events from UI Manager
            document.addEventListener('audioapp:playPauseClicked', handlePlayPauseToggle);
            document.addEventListener('audioapp:speedChanged', handleSpeedChange);
            document.addEventListener('audioapp:gainChanged', handleGainChange);
            document.addEventListener('audioapp:jumpClicked', handleJump);
            document.addEventListener('audioapp:vadThresholdChanged', handleVadThresholdChange);

            // Listen to events from Visualizer
            document.addEventListener('audioapp:seekRequested', handleSeek);

            // Listen to events from WorkletManager
            document.addEventListener('audioapp:workletReady', handleWorkletReady);
            document.addEventListener('audioapp:workletTimeUpdate', handleWorkletTimeUpdate);
            document.addEventListener('audioapp:workletPlaybackEnded', handleWorkletPlaybackEnded);
            document.addEventListener('audioapp:workletError', handleWorkletError);
            document.addEventListener('audioapp:workletPlaybackState', handleWorkletPlaybackState);

            // Listen to events from AudioLoader
             document.addEventListener('audioapp:audioReady', handleAudioReady);

            console.log("[PlaybackCtrl] Initialized and listening for events.");
        },

         /** Gets the main GainNode (for connecting the worklet). */
        getGainNode() {
            return gainNode;
        }
    };
})();

// Attach to the global AudioApp namespace
if (typeof window.AudioApp === 'undefined') {
    window.AudioApp = {};
}
window.AudioApp.playbackController = playbackController;
console.log("PlaybackController module loaded.");

// /vibe-player/js/playbackController.js
