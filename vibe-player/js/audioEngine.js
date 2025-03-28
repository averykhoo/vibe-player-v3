// --- /vibe-player/js/audioEngine.js ---
// Manages Web Audio API, the <audio> element, loading, decoding, resampling, and playback controls.
// Dispatches events related to audio state changes.
// Attempt 4: Create AudioContext once, create MediaElementSourceNode only ONCE, never disconnect it.

var AudioApp = AudioApp || {}; // Ensure namespace exists

AudioApp.audioEngine = (function() {
    'use strict';

    // --- Web Audio API & State ---
    /** @type {AudioContext|null} The single, persistent audio context */
    let audioCtx = null;
    /** @type {GainNode|null} Node for controlling volume */
    let gainNode = null;
    /**
     * MediaElementSourceNode. IMPORTANT: Should be created only ONCE per <audio> element
     * for the lifetime of the application's AudioContext.
     * @type {MediaElementAudioSourceNode|null}
     */
    let mediaSource = null; // <<< Will be created once and persist
    /** @type {HTMLAudioElement|null} Reference to the hidden <audio> element */
    let audioEl = null;
    /** @type {string|null} Stores the current Blob URL for the <audio> element source */
    let currentObjectURL = null;
    /** @type {boolean} Internal track of playback state (playing vs paused/stopped) */
    let isPlaying = false;
     /** @type {AudioBuffer|null} Cache the original decoded buffer within this module */
    let currentDecodedBuffer = null;

    // --- Initialization ---

    /**
     * Initializes the Audio Engine: gets the <audio> element, creates the persistent AudioContext, sets up listeners.
     * @public
     */
    function init() {
        console.log("AudioEngine: Initializing...");
        audioEl = document.getElementById('player');
        if (!audioEl) {
            console.error("AudioEngine: CRITICAL - <audio id='player'> element not found!");
            return;
        }
        // Create context immediately on init (or on first interaction if preferred)
        // Ensures context exists before any audio loading attempts.
        setupAudioContext();
        setupAudioElementListeners();
        console.log("AudioEngine: Initialized.");
    }

    // --- Setup & Reset ---

    /**
     * Creates the persistent AudioContext and GainNode if they don't exist or are closed.
     * @private
     */
    function setupAudioContext() {
        // Only create if it doesn't exist or is closed
        if (audioCtx && audioCtx.state !== 'closed') {
            console.log("AudioEngine: AudioContext already exists and is open.");
            return; // Already exists and is valid
        }
        try {
            // If context existed but was closed, log it
            if (audioCtx && audioCtx.state === 'closed') {
                console.log("AudioEngine: Recreating closed AudioContext.");
            }
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            gainNode = audioCtx.createGain();
            gainNode.gain.value = 1.0; // Set default gain
            gainNode.connect(audioCtx.destination); // Connect gain to output
            mediaSource = null; // Ensure mediaSource is null when context is (re)created
            console.log(`AudioEngine: AudioContext created/reset (state: ${audioCtx.state}).`);

            // Attempt to resume immediately if suspended (due to browser autoplay policies)
            if (audioCtx.state === 'suspended') {
                // It's often better to resume on user interaction (like play), but trying here might work sometimes.
                audioCtx.resume().catch(e => console.warn("AudioEngine: Error resuming context immediately after creation", e));
            }
        } catch (e) {
            console.error("AudioEngine: Failed to create AudioContext.", e);
            audioCtx = null; gainNode = null; mediaSource = null;
            dispatchEngineEvent('audioapp:engineError', { type: 'context', error: new Error("Web Audio API not supported or context creation failed") });
        }
    }

    /**
     * Sets up event listeners on the HTMLAudioElement.
     * @private
     */
    function setupAudioElementListeners() {
        if (!audioEl) return;

        audioEl.addEventListener('play', () => {
            isPlaying = true;
            // Ensure context exists and is running when playback starts
            if (!audioCtx || audioCtx.state === 'closed') {
                 console.error("AudioEngine: Playback failed - AudioContext not available.");
                 // Optionally try to recreate context here? Might be too late.
                 audioEl.pause(); // Stop attempted playback
                 return;
            }
            if (audioCtx.state === 'suspended') {
                 audioCtx.resume().catch(e => console.warn("AudioEngine: Error resuming context on play", e));
            }
            dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: true });
        });

        audioEl.addEventListener('pause', () => {
            isPlaying = false;
            dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: false });
        });

        audioEl.addEventListener('ended', () => {
            isPlaying = false;
            dispatchEngineEvent('audioapp:playbackEnded');
            dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: false });
        });

        audioEl.addEventListener('timeupdate', () => {
            // Dispatch time updates frequently for UI feedback
            if (audioEl.duration && !isNaN(audioEl.duration)) {
                dispatchEngineEvent('audioapp:timeUpdated', { currentTime: audioEl.currentTime, duration: audioEl.duration });
            }
        });

        audioEl.addEventListener('loadedmetadata', () => {
            console.log("AudioEngine: Metadata loaded. Duration:", audioEl.duration);
            // --- Ensure connection is established (will create node only if null) ---
            // This function ensures the single MediaElementSourceNode is created if it hasn't been already.
            ensureAudioGraphConnected();
            // --- End ensure connection ---
            // Dispatch initial time update now that duration is known
            if (audioEl.duration && !isNaN(audioEl.duration)) {
                dispatchEngineEvent('audioapp:timeUpdated', { currentTime: audioEl.currentTime, duration: audioEl.duration });
            }
        });

        audioEl.addEventListener('durationchange', () => {
            // Handle potential changes in duration (less common for static files)
            console.log("AudioEngine: Duration changed to", audioEl.duration);
             if (audioEl.duration && !isNaN(audioEl.duration)) {
                dispatchEngineEvent('audioapp:timeUpdated', { currentTime: audioEl.currentTime, duration: audioEl.duration });
            }
        });

         audioEl.addEventListener('error', (e) => {
            // Handle media errors reported by the <audio> element itself
            const error = audioEl.error;
            console.error("AudioEngine: HTMLAudioElement error - Code:", error?.code, "Message:", error?.message);
             dispatchEngineEvent('audioapp:playbackError', { error: error || new Error("Unknown playback error") });
         });
    }

    /**
     * Ensures the MediaElementSourceNode exists and is connected to the GainNode.
     * Creates the source node only if `mediaSource` is currently `null`.
     * Designed to be called safely multiple times (e.g., on 'loadedmetadata').
     * @private
     */
    function ensureAudioGraphConnected() {
        // --- Robust Check: Only CREATE if mediaSource is null ---
        // If mediaSource already exists, the graph is set up. Changing audioEl.src
        // is handled internally by the existing node.
        if (!audioCtx || audioCtx.state === 'closed' || !audioEl || mediaSource !== null) {
            return; // Exit if context is invalid or source node already exists
        }
        // --- End Check ---

        // Ensure context is running before creating source node
        // (May be redundant if called after user interaction like 'play')
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(e => console.warn("AudioEngine: Error resuming context before connect", e));
        }

        try {
            console.log("AudioEngine: Creating MediaElementSourceNode (ONCE)...");
            // --- Create the source node ---
            mediaSource = audioCtx.createMediaElementSource(audioEl);
            // --- Connect it permanently to the gain node ---
            mediaSource.connect(gainNode);
            console.log("AudioEngine: Audio element connected to Web Audio graph.");
        } catch (e) {
            // This error should ideally not happen now if the check above is solid,
            // but catch it just in case the browser state is unexpected.
            console.error("AudioEngine: Error creating or connecting audio element source node:", e);
            mediaSource = null; // Reset on failure to allow potential retry? Unlikely to help.
            dispatchEngineEvent('audioapp:engineError', { type: 'connect', error: e });
        }
    }

     // --- Loading, Decoding, Resampling Pipeline ---

    /**
     * Loads a File, sets <audio> source, decodes, and resamples.
     * Uses the single persistent AudioContext. Does NOT disconnect/reconnect MediaElementSourceNode.
     * @param {File} file - The audio file selected by the user.
     * @returns {Promise<void>} A promise that resolves when processing is complete or rejects on error.
     * @throws {Error} If context is unavailable or processing fails.
     * @public
     */
     async function loadAndProcessFile(file) {
        // Ensure context exists (should have been created in init)
        if (!audioCtx || audioCtx.state === 'closed') {
            console.error("AudioEngine: AudioContext not available for loading file.");
            // Attempt to recreate context? Or rely on user interaction? For now, throw.
            if(!setupAudioContext()) { // Try creating/resetting context
                 throw new Error("AudioContext could not be created/reset.");
            }
        }

        // --- 1. Set <audio> Source & Reset ---
        if (currentObjectURL) {
            URL.revokeObjectURL(currentObjectURL);
            // console.log("AudioEngine: Revoked previous Object URL:", currentObjectURL); // Less noise
            currentObjectURL = null;
        }
        // Stop playback and reset buffer state
        if (audioEl && !audioEl.paused) { audioEl.pause(); }
        currentDecodedBuffer = null;

        // --- No Disconnection of mediaSource Needed ---

        // Reset src and load to clear previous state reliably
        if(audioEl){
            audioEl.removeAttribute('src');
            audioEl.load(); // Reset element internal state
        }

        // --- Set New Source ---
        currentObjectURL = URL.createObjectURL(file);
        audioEl.src = currentObjectURL; // Set the new source
        audioEl.load(); // Tell the element to load the new source.
        // 'loadedmetadata' event listener will call ensureAudioGraphConnected. If mediaSource
        // already exists (from first load), ensureAudioGraphConnected will simply return.

        // --- 2. Read File & Decode ---
        try {
            const arrayBuffer = await file.arrayBuffer();
            console.log("AudioEngine: Decoding audio data...");
            // Ensure context is running before decoding
            if (audioCtx.state === 'suspended') await audioCtx.resume();

            currentDecodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
             console.log(`AudioEngine: Decoded ${currentDecodedBuffer.duration.toFixed(2)}s @ ${currentDecodedBuffer.sampleRate}Hz`);
            dispatchEngineEvent('audioapp:audioLoaded', { audioBuffer: currentDecodedBuffer });

            // --- 3. Resample for VAD ---
            console.log("AudioEngine: Resampling audio for VAD...");
            const pcm16k = await convertAudioBufferTo16kHzMonoFloat32(currentDecodedBuffer); // Uses separate OfflineAudioContext
            console.log(`AudioEngine: Resampled to ${pcm16k.length} samples @ 16kHz`);
            dispatchEngineEvent('audioapp:resamplingComplete', { pcmData: pcm16k });

        } catch (error) {
            console.error("AudioEngine: Error during load/decode/resample pipeline:", error);
            currentDecodedBuffer = null; // Clear buffer on error
            // Dispatch specific error types
            if (error.message.includes("decodeAudioData") || (error instanceof DOMException && error.name === 'EncodingError')) {
                 dispatchEngineEvent('audioapp:decodingError', { error: error });
            } else if (error.message.includes("resampling")) {
                  dispatchEngineEvent('audioapp:resamplingError', { error: error });
            } else {
                 // General load error
                 dispatchEngineEvent('audioapp:engineError', { type: 'load', error: error });
            }
            throw error; // Re-throw for app.js to handle global state/UI
        }
    }


    /**
     * Converts AudioBuffer to 16kHz mono PCM using OfflineAudioContext.
     * @param {AudioBuffer} audioBuffer
     * @returns {Promise<Float32Array>}
     * @throws {Error}
     * @private
     */
    function convertAudioBufferTo16kHzMonoFloat32(audioBuffer) {
        // This function creates its own temporary context, so it's independent of the main audioCtx state.
        const targetSampleRate = 16000;
        const targetLength = Math.ceil(audioBuffer.duration * targetSampleRate);
        try {
            const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
            const src = offlineCtx.createBufferSource();
            src.buffer = audioBuffer;
            src.connect(offlineCtx.destination);
            src.start();
            // console.log(`AudioEngine: Starting offline rendering...`); // Less noise
            return offlineCtx.startRendering().then(renderedBuffer => {
                return renderedBuffer.getChannelData(0);
            }).catch(err => {
                console.error("AudioEngine: Error during audio resampling via OfflineAudioContext:", err);
                // Throw a more specific error
                throw new Error(`Audio resampling failed: ${err.message}`);
            });
        } catch (offlineCtxError) {
             // Catch potential errors creating OfflineAudioContext itself
             console.error("AudioEngine: Error creating OfflineAudioContext for resampling:", offlineCtxError);
             return Promise.reject(new Error(`Failed to create OfflineContext for resampling: ${offlineCtxError.message}`));
        }
    }

    // --- Playback Control Methods (Public) ---

    /**
     * Toggles the playback state. Ensures AudioContext is ready.
     * @public
     */
    function togglePlayPause() {
        if (!audioEl || !audioEl.src || audioEl.readyState < audioEl.HAVE_METADATA) {
             console.warn("AudioEngine: Cannot toggle play/pause - audio not ready.");
             return;
        }
        // Ensure context exists and is running before playing
        if (!audioCtx || audioCtx.state === 'closed') {
             console.error("AudioEngine: Play toggle failed - AudioContext not available.");
             // Try to recreate? May be too late if user interaction context is lost.
             if(!setupAudioContext()){ return; } // Attempt recreation
             ensureAudioGraphConnected(); // Ensure connection for the new context
        } else if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(e => console.warn("AudioEngine: Error resuming context on toggle", e));
        }

        if (audioEl.paused) {
            audioEl.play().catch(e => {
                 console.error("AudioEngine: Error starting playback:", e);
                  dispatchEngineEvent('audioapp:playbackError', { error: e });
            });
        } else {
            audioEl.pause();
        }
    }

    /**
     * Jumps the playback position by a specified number of seconds.
     * @param {number} seconds - The amount to jump.
     * @public
     */
    function jumpBy(seconds) {
        if (!audioEl || isNaN(audioEl.duration)) {
            console.warn("AudioEngine: Cannot jump - duration unknown.");
            return;
        }
        seek(audioEl.currentTime + seconds);
    }

    /**
     * Seeks the playback position to a specific time.
     * @param {number} time - The target time in seconds.
     * @public
     */
    function seek(time) {
        if (!audioEl || isNaN(audioEl.duration)) {
             console.warn("AudioEngine: Cannot seek - duration unknown.");
            return;
        }
        const newTime = Math.max(0, Math.min(time, audioEl.duration));
        // Only update currentTime if the change is significant enough to avoid redundant seeks
        if (Math.abs(audioEl.currentTime - newTime) > 0.01) {
            audioEl.currentTime = newTime;
            // console.log(`AudioEngine: Seeked to ${formatTime(newTime)}`); // Less noise
        }
    }

    /**
     * Sets the playback speed (rate).
     * @param {number} speed - The desired playback speed.
     * @public
     */
    function setSpeed(speed) {
         if (!audioEl) return;
         const rate = Math.max(0.25, Math.min(parseFloat(speed) || 1.0, 2.0));
         if (audioEl.playbackRate !== rate) { // Avoid setting if unchanged
            audioEl.playbackRate = rate;
            audioEl.preservesPitch = true;
            audioEl.mozPreservesPitch = true;
            console.log(`AudioEngine: Playback speed set to ${rate.toFixed(2)}x`);
         }
    }

    /**
     * Sets the gain (volume) level. Checks if GainNode exists for current context.
     * @param {number} gain - The desired gain multiplier (0.0 to 2.0).
     * @public
     */
    function setGain(gain) {
        // Check for valid context AND gainNode associated with that context
        if (!gainNode || !audioCtx || audioCtx.state === 'closed') {
            console.warn("AudioEngine: Cannot set gain - GainNode or valid AudioContext missing.");
            return;
        }
        const value = Math.max(0.0, Math.min(parseFloat(gain) || 1.0, 2.0));
        // Use setTargetAtTime for smooth transitions
        gainNode.gain.setTargetAtTime(value, audioCtx.currentTime, 0.015);
        // console.log(`AudioEngine: Gain set to ${value.toFixed(2)}x`); // Less noise
    }

    /**
     * Gets the current playback time and duration.
     * @returns {{currentTime: number, duration: number}}
     * @public
     */
    function getCurrentTime() {
        return {
            currentTime: audioEl ? audioEl.currentTime : 0,
            duration: (audioEl && !isNaN(audioEl.duration)) ? audioEl.duration : 0
        };
    }

     // --- Cleanup ---

    /**
     * Cleans up resources: revokes Object URL, closes the persistent AudioContext.
     * Called on page unload.
     * @public
     */
    function cleanup() {
        console.log("AudioEngine: Cleaning up resources...");
        // Stop playback
        if (audioEl && !audioEl.paused) { audioEl.pause(); }
        // Revoke URL
        if (currentObjectURL) {
            URL.revokeObjectURL(currentObjectURL);
            console.log("AudioEngine: Revoked Object URL:", currentObjectURL);
            currentObjectURL = null;
        }

        // Close the persistent AudioContext if it exists and isn't already closed
        if (audioCtx && audioCtx.state !== 'closed') {
            audioCtx.close().then(() => console.log("AudioEngine: AudioContext closed."))
                           .catch(e => console.warn("AudioEngine: Error closing AudioContext:", e));
        }
        // Reset all context-related references
        audioCtx = null;
        gainNode = null;
        mediaSource = null; // Node is invalid once context is closed

        // Reset audio element
        if (audioEl) {
            audioEl.removeAttribute('src');
            audioEl.load();
        }
        currentDecodedBuffer = null; // Clear buffer cache
    }

    // --- Utility & Dispatch Helper ---

    /**
     * Dispatches a custom event specific to the audio engine.
     * @param {string} eventName - The name of the event.
     * @param {object} [detail={}] - Data payload.
     * @private
     */
    function dispatchEngineEvent(eventName, detail = {}) {
        document.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
    }

    /**
     * Formats time in seconds to MM:SS string.
     * @param {number} sec - Seconds.
     * @returns {string} Formatted string.
     * @private
     */
     function formatTime(sec) {
        if (isNaN(sec) || sec < 0) sec = 0;
        const minutes = Math.floor(sec / 60);
        const seconds = Math.floor(sec % 60);
        return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
    }


    // --- Public Interface ---
    return {
        init: init,
        loadAndProcessFile: loadAndProcessFile,
        togglePlayPause: togglePlayPause,
        jumpBy: jumpBy,
        seek: seek,
        setSpeed: setSpeed,
        setGain: setGain,
        getCurrentTime: getCurrentTime,
        cleanup: cleanup
    };
})();
