// --- /vibe-player/js/audioEngine.js ---
// Manages Web Audio API, the <audio> element, loading, decoding, resampling, and playback controls.
// Dispatches events related to audio state changes.

var AudioApp = AudioApp || {}; // Ensure namespace exists

// Design Decision: Use IIFE to encapsulate audio logic.
AudioApp.audioEngine = (function() {
    'use strict';

    // --- Web Audio API & State ---
    /** @type {AudioContext|null} The main audio context */
    let audioCtx = null;
    /** @type {GainNode|null} Node for controlling volume */
    let gainNode = null;
    /** @type {MediaElementAudioSourceNode|null} Connects <audio> to AudioContext */
    let mediaSource = null;
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
     * Initializes the Audio Engine: gets the <audio> element, sets up AudioContext.
     * @public
     */
    function init() {
        console.log("AudioEngine: Initializing...");
        audioEl = document.getElementById('player');
        if (!audioEl) {
            console.error("AudioEngine: CRITICAL - <audio id='player'> element not found!");
            // Dispatch an error? For now, just log. The app won't work.
            return;
        }
        setupAudioContext();
        setupAudioElementListeners();
        console.log("AudioEngine: Initialized.");
    }

    // --- Setup ---

    /**
     * Creates the AudioContext and GainNode. Must be called after user interaction likely.
     * Handles potential browser limitations.
     * @private
     */
    function setupAudioContext() {
        // Design Decision: Create context immediately on init. User interaction will be needed
        // to resume it if suspended by autoplay policies.
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            gainNode = audioCtx.createGain();
            // Set initial gain from UI? Or default to 1? Default to 1 for simplicity.
            gainNode.gain.value = 1.0;
            gainNode.connect(audioCtx.destination);
            console.log(`AudioEngine: AudioContext created (state: ${audioCtx.state}).`);
        } catch (e) {
            console.error("AudioEngine: Web Audio API is not supported by this browser.", e);
            // Dispatch an error event for app.js to handle (e.g., disable features)
            dispatchEngineEvent('audioapp:engineError', { type: 'context', error: new Error("Web Audio API not supported") });
        }
    }

    /**
     * Sets up event listeners on the HTMLAudioElement.
     * These listeners dispatch custom events for the app controller.
     * @private
     */
    function setupAudioElementListeners() {
        if (!audioEl) return;

        audioEl.addEventListener('play', () => {
            isPlaying = true;
            // Ensure context is running when playback starts
            if (audioCtx?.state === 'suspended') {
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
            dispatchEngineEvent('audioapp:playbackStateChanged', { isPlaying: false }); // Ensure state is updated
        });

        audioEl.addEventListener('timeupdate', () => {
            // Avoid dispatching if duration isn't valid yet
            if (audioEl.duration && !isNaN(audioEl.duration)) {
                dispatchEngineEvent('audioapp:timeUpdated', { currentTime: audioEl.currentTime, duration: audioEl.duration });
            }
        });

        audioEl.addEventListener('loadedmetadata', () => {
            // Metadata (like duration) is loaded. We can connect the source node now if not already.
            // This is a good point to ensure connection, as `src` is definitely set.
            console.log("AudioEngine: Metadata loaded. Duration:", audioEl.duration);
            connectAudioElementSource();
            // Dispatch initial time update
             if (audioEl.duration && !isNaN(audioEl.duration)) {
                dispatchEngineEvent('audioapp:timeUpdated', { currentTime: audioEl.currentTime, duration: audioEl.duration });
            }
        });

        audioEl.addEventListener('durationchange', () => {
            // Duration might change (e.g., for streams, though not applicable here)
            console.log("AudioEngine: Duration changed to", audioEl.duration);
             if (audioEl.duration && !isNaN(audioEl.duration)) {
                dispatchEngineEvent('audioapp:timeUpdated', { currentTime: audioEl.currentTime, duration: audioEl.duration });
            }
        });

         audioEl.addEventListener('error', (e) => {
            // Handle errors from the <audio> element itself
            const error = audioEl.error;
            console.error("AudioEngine: HTMLAudioElement error - Code:", error?.code, "Message:", error?.message);
             dispatchEngineEvent('audioapp:playbackError', { error: error || new Error("Unknown playback error") });
         });
    }

    /**
     * Connects the HTMLAudioElement to the Web Audio API graph via a MediaElementAudioSourceNode.
     * This is necessary for applying effects like GainNode.
     * Should only be called once per audio element load. Idempotency handled by checking `mediaSource`.
     * @private
     */
    function connectAudioElementSource() {
        if (!audioCtx || !audioEl || !audioEl.src || mediaSource) {
             // console.log("AudioEngine: Skipping connectAudioElementSource (conditions not met).", {audioCtx, src: audioEl?.src, mediaSource});
            return; // Don't connect if context missing, no src, or already connected
        }

        try {
            // Attempt to resume context if suspended, might be needed before creating source node
            if (audioCtx.state === 'suspended') {
                audioCtx.resume().catch(e => console.warn("AudioEngine: Error resuming context before connect", e));
            }

            // Create the source node from the <audio> element.
            mediaSource = audioCtx.createMediaElementSource(audioEl);

            // Connect the source to the gain node (which is connected to destination).
            mediaSource.connect(gainNode);
            console.log("AudioEngine: Audio element connected to Web Audio graph.");

        } catch (e) {
            // Catch potential errors (e.g., trying to create source node multiple times on same element)
            console.error("AudioEngine: Error connecting audio element source:", e);
            mediaSource = null; // Ensure mediaSource is null if connection failed
            // Dispatch an error?
            dispatchEngineEvent('audioapp:engineError', { type: 'connect', error: e });
        }
    }

     // --- Loading, Decoding, Resampling Pipeline ---

    /**
     * Loads a File, sets it as the <audio> source, decodes it using Web Audio API,
     * then resamples it to 16kHz mono PCM for VAD.
     * Dispatches events 'audioapp:audioLoaded' and 'audioapp:resamplingComplete' on success,
     * or error events on failure.
     * @param {File} file - The audio file selected by the user.
     * @returns {Promise<void>} A promise that resolves when processing is complete or rejects on error.
     * @throws {Error} If initial setup fails (e.g., no AudioContext).
     * @public
     */
     async function loadAndProcessFile(file) {
        if (!audioCtx || !audioEl) {
             // Cannot proceed without context and audio element
             throw new Error("AudioContext or AudioElement not available.");
        }

        // --- 1. Set <audio> Source & Reset ---
        // Revoke previous Object URL to free memory
        if (currentObjectURL) {
            URL.revokeObjectURL(currentObjectURL);
            console.log("AudioEngine: Revoked previous Object URL:", currentObjectURL);
            currentObjectURL = null;
        }
        // Stop current playback if any
        if (!audioEl.paused) { audioEl.pause(); }
        audioEl.removeAttribute('src'); // Clear previous source
        audioEl.load(); // Reset element state

        // Create a new Object URL for the selected file.
        currentObjectURL = URL.createObjectURL(file);

        // Disconnect the previous source node if it exists
        if (mediaSource) {
            try { mediaSource.disconnect(); } catch (e) { /* ignore potential errors */ }
            mediaSource = null; // Reset mediaSource reference
            console.log("AudioEngine: Disconnected previous MediaElementSource.");
        }

        // Set the new source for the <audio> element and load it.
        audioEl.src = currentObjectURL;
        audioEl.load(); // Explicitly tell the audio element to load the new source.
        // The 'loadedmetadata' event listener will handle connecting the new source node.

        // --- 2. Read File & Decode ---
        try {
            const arrayBuffer = await file.arrayBuffer();
            console.log("AudioEngine: Decoding audio data...");

            // Ensure context is running before decoding (important after user interaction might be needed)
            if (audioCtx.state === 'suspended') await audioCtx.resume();

            // Decode the ArrayBuffer into an AudioBuffer using the Web Audio API.
            currentDecodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
             console.log(`AudioEngine: Decoded ${currentDecodedBuffer.duration.toFixed(2)}s @ ${currentDecodedBuffer.sampleRate}Hz`);

            // Notify app that the original buffer is ready (includes duration, sample rate etc.)
            dispatchEngineEvent('audioapp:audioLoaded', { audioBuffer: currentDecodedBuffer });

            // --- 3. Resample for VAD ---
            console.log("AudioEngine: Resampling audio for VAD...");
            const pcm16k = await convertAudioBufferTo16kHzMonoFloat32(currentDecodedBuffer);
            console.log(`AudioEngine: Resampled to ${pcm16k.length} samples @ 16kHz`);

            // Notify app that resampling is complete, providing the PCM data
            dispatchEngineEvent('audioapp:resamplingComplete', { pcmData: pcm16k });

        } catch (error) {
            console.error("AudioEngine: Error during load/decode/resample pipeline:", error);
            currentDecodedBuffer = null; // Clear buffer state on error
            // Determine error type for more specific event dispatch
            if (error.message.includes("decodeAudioData") || error instanceof DOMException && error.name === 'EncodingError') {
                 dispatchEngineEvent('audioapp:decodingError', { error: error });
            } else if (error.message.includes("resampling")) {
                  dispatchEngineEvent('audioapp:resamplingError', { error: error });
            } else {
                 dispatchEngineEvent('audioapp:engineError', { type: 'load', error: error });
            }
            // Re-throw the error so app.js can also catch it and handle overall state
            throw error;
        }
    }


    /**
     * Converts an AudioBuffer to 16kHz mono Float32Array PCM using OfflineAudioContext.
     * Required format for the Silero VAD model.
     * @param {AudioBuffer} audioBuffer - The original decoded audio buffer.
     * @returns {Promise<Float32Array>} A promise resolving to the 16kHz mono PCM data.
     * @throws {Error} If resampling fails or AudioContext is unavailable.
     * @private
     */
    function convertAudioBufferTo16kHzMonoFloat32(audioBuffer) {
        const targetSampleRate = 16000;
        if (!audioCtx) {
             // Should ideally not happen if init was successful, but check anyway.
            return Promise.reject(new Error("AudioContext not available for resampling"));
        }

        // Use an Offline context to process the audio graph without playing it.
        // Calculate target length carefully.
        const targetLength = Math.ceil(audioBuffer.duration * targetSampleRate);
        const offlineCtx = new OfflineAudioContext(
            1, // Number of channels (Mono)
            targetLength, // Target buffer length in samples
            targetSampleRate // Target sample rate
        );

        // Create a buffer source node for the original audio.
        const src = offlineCtx.createBufferSource();
        src.buffer = audioBuffer;

        // Connect the source to the destination (the output of the context).
        src.connect(offlineCtx.destination);

        // Start the source node (required for offline rendering).
        src.start();

        console.log(`AudioEngine: Starting offline rendering to resample from ${audioBuffer.sampleRate}Hz to ${targetSampleRate}Hz mono.`);

        // Start rendering the audio graph. This returns a Promise.
        return offlineCtx.startRendering().then(renderedBuffer => {
            // Get the raw Float32Array data from the first (and only) channel.
            return renderedBuffer.getChannelData(0);
        }).catch(err => {
            console.error("AudioEngine: Error during audio resampling via OfflineAudioContext:", err);
            // Add context to the error message for better debugging
            throw new Error(`Audio resampling failed: ${err.message}`);
        });
    }

    // --- Playback Control Methods (Public) ---

    /**
     * Toggles the playback state between play and pause.
     * Resumes AudioContext if suspended.
     * @public
     */
    function togglePlayPause() {
        if (!audioEl || !audioEl.src || audioEl.readyState < audioEl.HAVE_METADATA) {
            console.warn("AudioEngine: Cannot toggle play/pause - audio not ready.");
            return;
        }
        // Attempt to resume context if suspended (often needed on first interaction)
        if (audioCtx?.state === 'suspended') {
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
     * @param {number} seconds - The amount to jump (positive for forward, negative for backward).
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
     * Clamps the time within the valid duration range [0, duration].
     * @param {number} time - The target time in seconds.
     * @public
     */
    function seek(time) {
        if (!audioEl || isNaN(audioEl.duration)) {
             console.warn("AudioEngine: Cannot seek - duration unknown.");
            return;
        }
        // Ensure the target time is within the bounds of the audio duration.
        const newTime = Math.max(0, Math.min(time, audioEl.duration));
        if (Math.abs(audioEl.currentTime - newTime) > 0.01) { // Avoid seeking to the exact same spot
            audioEl.currentTime = newTime;
            console.log(`AudioEngine: Seeked to ${formatTime(newTime)}`);
            // The 'timeupdate' event will eventually fire and notify the app controller.
        }
    }

    /**
     * Sets the playback speed (rate).
     * Clamps the value between 0.25 and 2.0.
     * @param {number} speed - The desired playback speed (e.g., 1.0 for normal).
     * @public
     */
    function setSpeed(speed) {
         if (!audioEl) return;
         const rate = Math.max(0.25, Math.min(parseFloat(speed) || 1.0, 2.0)); // Clamp and ensure number
         audioEl.playbackRate = rate;
         // Ensure pitch correction is enabled (most browsers default to true now)
         audioEl.preservesPitch = true;
         audioEl.mozPreservesPitch = true; // For older Firefox
         console.log(`AudioEngine: Playback speed set to ${rate.toFixed(2)}x`);
    }

    /**
     * Sets the gain (volume) level.
     * Clamps the value between 0.0 and 2.0.
     * @param {number} gain - The desired gain multiplier (0.0 to 2.0).
     * @public
     */
    function setGain(gain) {
        if (!gainNode || !audioCtx) {
            console.warn("AudioEngine: Cannot set gain - GainNode or AudioContext missing.");
            return;
        }
        const value = Math.max(0.0, Math.min(parseFloat(gain) || 1.0, 2.0)); // Clamp and ensure number
        // Use setTargetAtTime for a smooth (exponential) transition to the new value.
        // A short time constant (e.g., 0.015) makes it react quickly but avoid clicks.
        gainNode.gain.setTargetAtTime(value, audioCtx.currentTime, 0.015);
        console.log(`AudioEngine: Gain set to ${value.toFixed(2)}x`);
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
     * Cleans up resources: revokes Object URL, closes AudioContext.
     * Should be called when the application is closing (e.g., beforeunload).
     * @public
     */
    function cleanup() {
        console.log("AudioEngine: Cleaning up resources...");
        // Pause playback
        if (audioEl && !audioEl.paused) {
            audioEl.pause();
        }
        // Revoke Object URL
        if (currentObjectURL) {
            URL.revokeObjectURL(currentObjectURL);
            console.log("AudioEngine: Revoked Object URL:", currentObjectURL);
            currentObjectURL = null;
        }
         // Disconnect source node
         if (mediaSource) {
            try { mediaSource.disconnect(); } catch(e) {/* ignore */}
            mediaSource = null;
        }
        // Close AudioContext
        if (audioCtx && audioCtx.state !== 'closed') {
            audioCtx.close().then(() => console.log("AudioEngine: AudioContext closed."))
                           .catch(e => console.warn("AudioEngine: Error closing AudioContext:", e));
            audioCtx = null; // Nullify ref
        }
        // Reset audio element source
        if (audioEl) {
            audioEl.removeAttribute('src');
            audioEl.load(); // Important to reset internal state
        }
        currentDecodedBuffer = null; // Clear buffer cache
    }

    // --- Utility & Dispatch Helper ---

    /**
     * Dispatches a custom event specific to the audio engine.
     * @param {string} eventName - The name of the event (e.g., 'audioapp:timeUpdated').
     * @param {object} [detail={}] - Data payload for the event.
     * @private
     */
    function dispatchEngineEvent(eventName, detail = {}) {
        document.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
    }

    /**
     * Formats time in seconds to MM:SS string (Utility).
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
    // Expose methods needed by app.js to control audio processing and playback.
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
