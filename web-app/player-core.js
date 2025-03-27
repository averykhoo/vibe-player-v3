// --- START OF FILE player-core.js ---
'use strict';

/**
 * Manages the core audio playback logic, state, and AudioContext interaction.
 * Emits events for state changes.
 */
const PlayerCore = (function() {
    let audioEl = null;
    let audioCtx = null;
    let gainNode = null;
    let mediaSource = null;

    let isPlaying = false;
    let currentTime = 0;
    let duration = 0;
    let currentSpeed = 1.0;
    let currentVolume = 1.0; // Represents gain node value
    let isReady = false; // Is audio loaded and ready to play?

    const eventListeners = {
        'timeupdate': [],
        'statechange': [], // play, pause, ended
        'ready': [],       // metadata loaded, duration available
        'loadstart': [],
        'error': []
    };

    // --- Private Methods ---

    function emit(eventName, data) {
        if (eventListeners[eventName]) {
            eventListeners[eventName].forEach(callback => {
                try {
                    callback(data);
                } catch (e) {
                    console.error(`Error in ${eventName} listener:`, e);
                }
            });
        }
    }

    function setupAudioContext() {
        if (!audioCtx) {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                gainNode = audioCtx.createGain();
                gainNode.gain.setValueAtTime(currentVolume, audioCtx.currentTime);
                gainNode.connect(audioCtx.destination);
                console.log("PlayerCore: AudioContext and GainNode created.");
            } catch (e) {
                console.error("PlayerCore: Web Audio API not supported.", e);
                emit('error', { message: "Web Audio API not supported" });
            }
        }
    }

    function connectAudioElementSource() {
        if (!audioCtx || !audioEl || !audioEl.src || mediaSource) return;
        try {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            mediaSource = audioCtx.createMediaElementSource(audioEl);
            mediaSource.connect(gainNode);
            console.log("PlayerCore: Audio element connected to Web Audio graph.");
        } catch (e) {
            console.error("PlayerCore: Error connecting audio element source:", e);
            mediaSource = null;
            emit('error', { message: "Error connecting audio source", details: e });
        }
    }

    function disconnectAudioElementSource() {
         if (mediaSource) {
            try {
                mediaSource.disconnect();
                console.log("PlayerCore: Disconnected audio element source.");
            } catch(e) {
                 console.warn("PlayerCore: Error disconnecting audio source", e);
            }
            mediaSource = null;
         }
    }

    function setupAudioElementListeners() {
        if (!audioEl) return;

        audioEl.addEventListener('loadedmetadata', () => {
            duration = audioEl.duration;
            isReady = !isNaN(duration) && duration > 0;
            console.log(`PlayerCore: Metadata loaded, duration=${duration.toFixed(2)}s, isReady=${isReady}`);
            emit('ready', { duration });
        });

        audioEl.addEventListener('durationchange', () => {
             duration = audioEl.duration;
             isReady = !isNaN(duration) && duration > 0;
             console.log(`PlayerCore: Duration changed, duration=${duration.toFixed(2)}s, isReady=${isReady}`);
             emit('ready', { duration }); // Emit ready again as duration is key
        });

        audioEl.addEventListener('timeupdate', () => {
            currentTime = audioEl.currentTime;
            emit('timeupdate', { currentTime, duration });
        });

        audioEl.addEventListener('play', () => {
            isPlaying = true;
            // Resume context if needed (important!)
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
            emit('statechange', { state: 'playing' });
        });

        audioEl.addEventListener('pause', () => {
            isPlaying = false;
            emit('statechange', { state: 'paused' });
        });

        audioEl.addEventListener('ended', () => {
            isPlaying = false;
            // Optionally reset currentTime? No, browser usually does.
            currentTime = duration; // Ensure currentTime reflects the end
            emit('timeupdate', { currentTime, duration }); // Final timeupdate
            emit('statechange', { state: 'ended' });
        });

        audioEl.addEventListener('error', (e) => {
            console.error("PlayerCore: Audio Element Error", audioEl.error);
            isReady = false;
            isPlaying = false;
            emit('error', { message: "Audio element error", details: audioEl.error });
        });

         audioEl.addEventListener('loadstart', () => {
             console.log("PlayerCore: Load start.");
             isReady = false;
             isPlaying = false;
             duration = 0;
             currentTime = 0;
             emit('loadstart');
             emit('timeupdate', { currentTime, duration });
         });

         // Handle stalled playback
         audioEl.addEventListener('stalled', () => {
             console.warn("PlayerCore: Audio stalled.");
             // Could potentially emit a specific event or try to recover
         });
         audioEl.addEventListener('waiting', () => {
             console.log("PlayerCore: Audio waiting for data.");
             // Could indicate buffering
         });
    }

    // --- Public Methods ---

    function init(audioElement) {
        if (!audioElement) {
            throw new Error("PlayerCore init requires an audio element.");
        }
        audioEl = audioElement;
        setupAudioContext();
        setupAudioElementListeners();
        console.log("PlayerCore initialized.");
    }

    function load(url) {
        if (!audioEl) return;
        console.log("PlayerCore: Loading URL:", url);
        isReady = false;
        isPlaying = false;
        disconnectAudioElementSource(); // Disconnect old source if exists
        audioEl.src = url;
        audioEl.load(); // Trigger load process
        connectAudioElementSource(); // Connect the new source
    }

    function play() {
        if (isReady && audioEl && audioEl.paused) {
             if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume().then(() => {
                     console.log("PlayerCore: AudioContext resumed on play.");
                     audioEl.play().catch(e => {
                         console.error("PlayerCore: Error playing audio after resume:", e);
                         emit('error', { message: "Error playing audio", details: e });
                     });
                }).catch(e => {
                     console.error("PlayerCore: Error resuming AudioContext:", e);
                     emit('error', { message: "Error resuming audio context", details: e });
                });
            } else {
                 audioEl.play().catch(e => {
                     console.error("PlayerCore: Error playing audio:", e);
                     emit('error', { message: "Error playing audio", details: e });
                 });
            }
        } else if (!isReady) {
             console.warn("PlayerCore: Cannot play, audio not ready.");
        }
    }

    function pause() {
        if (audioEl && !audioEl.paused) {
            audioEl.pause();
        }
    }

    function seek(time) {
        if (isReady && audioEl) {
            const newTime = Math.max(0, Math.min(time, duration));
            if (Math.abs(audioEl.currentTime - newTime) > 0.1) { // Avoid tiny seeks if already close
                 console.log(`PlayerCore: Seeking to ${newTime.toFixed(2)}s`);
                 audioEl.currentTime = newTime;
                 // Event listener will emit timeupdate
            }
        } else {
            console.warn("PlayerCore: Cannot seek, audio not ready.");
        }
    }

    function setVolume(volume /* 0 to N, where 1 is normal */) {
        currentVolume = Math.max(0, volume);
        if (gainNode && audioCtx) {
            // Use exponential ramp for smoother perceived volume change? Or linear is fine.
            // gainNode.gain.linearRampToValueAtTime(currentVolume, audioCtx.currentTime + 0.05); // Ramp over 50ms
             gainNode.gain.setValueAtTime(currentVolume, audioCtx.currentTime); // Immediate change
            console.log(`PlayerCore: Volume set to ${currentVolume.toFixed(2)}`);
        }
    }

    function setSpeed(speed) {
        currentSpeed = Math.max(0.25, Math.min(speed, 4.0)); // Example bounds
        if (audioEl) {
            audioEl.playbackRate = currentSpeed;
            audioEl.preservesPitch = true; // Usually desired
            audioEl.mozPreservesPitch = true;
            console.log(`PlayerCore: Speed set to ${currentSpeed.toFixed(2)}x`);
        }
    }

    function on(eventName, callback) {
        if (eventListeners[eventName] && typeof callback === 'function') {
            eventListeners[eventName].push(callback);
        }
    }

    function off(eventName, callback) {
        if (eventListeners[eventName]) {
            eventListeners[eventName] = eventListeners[eventName].filter(cb => cb !== callback);
        }
    }

    function cleanup() {
        if (!audioEl) return;
        pause();
        disconnectAudioElementSource();
        audioEl.removeAttribute('src'); // Remove source
        audioEl.load(); // Abort loading/playback
        // Remove specific listeners added by this module? Or assume they die with the element.
        // Close audio context? Only if this module owns it exclusively.
        if (audioCtx && audioCtx.state !== 'closed') {
             audioCtx.close().then(() => console.log("PlayerCore: AudioContext closed.")).catch(e => console.warn("PlayerCore: Error closing context", e));
             audioCtx = null;
        }
        console.log("PlayerCore: Cleaned up.");
    }


    // --- Getters ---
    function getCurrentTime() { return currentTime; }
    function getDuration() { return duration; }
    function getIsPlaying() { return isPlaying; }
    function getIsReady() { return isReady; }


    // Public API
    return {
        init,
        load,
        play,
        pause,
        seek,
        setVolume,
        setSpeed,
        on,
        off,
        cleanup,
        // Getters
        getCurrentTime,
        getDuration,
        getIsPlaying,
        getIsReady
    };
})();

window.PlayerCore = PlayerCore; // Expose to global scope
// --- END OF FILE player-core.js ---// --- START OF FILE player-core.js ---
// 'use strict';
//
// /**
//  * Manages the core audio playback logic, state, and AudioContext interaction.
//  * Emits events for state changes.
//  */
// const PlayerCore = (function() {
//     let audioEl = null;
//     let audioCtx = null;
//     let gainNode = null;
//     let mediaSource = null;
//
//     let isPlaying = false;
//     let currentTime = 0;
//     let duration = 0;
//     let currentSpeed = 1.0;
//     let currentVolume = 1.0; // Represents gain node value
//     let isReady = false; // Is audio loaded and ready to play?
//
//     const eventListeners = {
//         'timeupdate': [],
//         'statechange': [], // play, pause, ended
//         'ready': [],       // metadata loaded, duration available
//         'loadstart': [],
//         'error': []
//     };
//
//     // --- Private Methods ---
//
//     function emit(eventName, data) {
//         if (eventListeners[eventName]) {
//             eventListeners[eventName].forEach(callback => {
//                 try {
//                     callback(data);
//                 } catch (e) {
//                     console.error(`Error in ${eventName} listener:`, e);
//                 }
//             });
//         }
//     }
//
//     function setupAudioContext() {
//         if (!audioCtx) {
//             try {
//                 audioCtx = new (window.AudioContext || window.webkitAudioContext)();
//                 gainNode = audioCtx.createGain();
//                 gainNode.gain.setValueAtTime(currentVolume, audioCtx.currentTime);
//                 gainNode.connect(audioCtx.destination);
//                 console.log("PlayerCore: AudioContext and GainNode created.");
//             } catch (e) {
//                 console.error("PlayerCore: Web Audio API not supported.", e);
//                 emit('error', { message: "Web Audio API not supported" });
//             }
//         }
//     }
//
//     function connectAudioElementSource() {
//         if (!audioCtx || !audioEl || !audioEl.src || mediaSource) return;
//         try {
//             if (audioCtx.state === 'suspended') audioCtx.resume();
//             mediaSource = audioCtx.createMediaElementSource(audioEl);
//             mediaSource.connect(gainNode);
//             console.log("PlayerCore: Audio element connected to Web Audio graph.");
//         } catch (e) {
//             console.error("PlayerCore: Error connecting audio element source:", e);
//             mediaSource = null;
//             emit('error', { message: "Error connecting audio source", details: e });
//         }
//     }
//
//     function disconnectAudioElementSource() {
//          if (mediaSource) {
//             try {
//                 mediaSource.disconnect();
//                 console.log("PlayerCore: Disconnected audio element source.");
//             } catch(e) {
//                  console.warn("PlayerCore: Error disconnecting audio source", e);
//             }
//             mediaSource = null;
//          }
//     }
//
//     function setupAudioElementListeners() {
//         if (!audioEl) return;
//
//         audioEl.addEventListener('loadedmetadata', () => {
//             duration = audioEl.duration;
//             isReady = !isNaN(duration) && duration > 0;
//             console.log(`PlayerCore: Metadata loaded, duration=${duration.toFixed(2)}s, isReady=${isReady}`);
//             emit('ready', { duration });
//         });
//
//         audioEl.addEventListener('durationchange', () => {
//              duration = audioEl.duration;
//              isReady = !isNaN(duration) && duration > 0;
//              console.log(`PlayerCore: Duration changed, duration=${duration.toFixed(2)}s, isReady=${isReady}`);
//              emit('ready', { duration }); // Emit ready again as duration is key
//         });
//
//         audioEl.addEventListener('timeupdate', () => {
//             currentTime = audioEl.currentTime;
//             emit('timeupdate', { currentTime, duration });
//         });
//
//         audioEl.addEventListener('play', () => {
//             isPlaying = true;
//             // Resume context if needed (important!)
//             if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
//             emit('statechange', { state: 'playing' });
//         });
//
//         audioEl.addEventListener('pause', () => {
//             isPlaying = false;
//             emit('statechange', { state: 'paused' });
//         });
//
//         audioEl.addEventListener('ended', () => {
//             isPlaying = false;
//             // Optionally reset currentTime? No, browser usually does.
//             currentTime = duration; // Ensure currentTime reflects the end
//             emit('timeupdate', { currentTime, duration }); // Final timeupdate
//             emit('statechange', { state: 'ended' });
//         });
//
//         audioEl.addEventListener('error', (e) => {
//             console.error("PlayerCore: Audio Element Error", audioEl.error);
//             isReady = false;
//             isPlaying = false;
//             emit('error', { message: "Audio element error", details: audioEl.error });
//         });
//
//          audioEl.addEventListener('loadstart', () => {
//              console.log("PlayerCore: Load start.");
//              isReady = false;
//              isPlaying = false;
//              duration = 0;
//              currentTime = 0;
//              emit('loadstart');
//              emit('timeupdate', { currentTime, duration });
//          });
//
//          // Handle stalled playback
//          audioEl.addEventListener('stalled', () => {
//              console.warn("PlayerCore: Audio stalled.");
//              // Could potentially emit a specific event or try to recover
//          });
//          audioEl.addEventListener('waiting', () => {
//              console.log("PlayerCore: Audio waiting for data.");
//              // Could indicate buffering
//          });
//     }
//
//     // --- Public Methods ---
//
//     function init(audioElement) {
//         if (!audioElement) {
//             throw new Error("PlayerCore init requires an audio element.");
//         }
//         audioEl = audioElement;
//         setupAudioContext();
//         setupAudioElementListeners();
//         console.log("PlayerCore initialized.");
//     }
//
//     function load(url) {
//         if (!audioEl) return;
//         console.log("PlayerCore: Loading URL:", url);
//         isReady = false;
//         isPlaying = false;
//         disconnectAudioElementSource(); // Disconnect old source if exists
//         audioEl.src = url;
//         audioEl.load(); // Trigger load process
//         connectAudioElementSource(); // Connect the new source
//     }
//
//     function play() {
//         if (isReady && audioEl && audioEl.paused) {
//              if (audioCtx && audioCtx.state === 'suspended') {
//                 audioCtx.resume().then(() => {
//                      console.log("PlayerCore: AudioContext resumed on play.");
//                      audioEl.play().catch(e => {
//                          console.error("PlayerCore: Error playing audio after resume:", e);
//                          emit('error', { message: "Error playing audio", details: e });
//                      });
//                 }).catch(e => {
//                      console.error("PlayerCore: Error resuming AudioContext:", e);
//                      emit('error', { message: "Error resuming audio context", details: e });
//                 });
//             } else {
//                  audioEl.play().catch(e => {
//                      console.error("PlayerCore: Error playing audio:", e);
//                      emit('error', { message: "Error playing audio", details: e });
//                  });
//             }
//         } else if (!isReady) {
//              console.warn("PlayerCore: Cannot play, audio not ready.");
//         }
//     }
//
//     function pause() {
//         if (audioEl && !audioEl.paused) {
//             audioEl.pause();
//         }
//     }
//
//     function seek(time) {
//         if (isReady && audioEl) {
//             const newTime = Math.max(0, Math.min(time, duration));
//             if (Math.abs(audioEl.currentTime - newTime) > 0.1) { // Avoid tiny seeks if already close
//                  console.log(`PlayerCore: Seeking to ${newTime.toFixed(2)}s`);
//                  audioEl.currentTime = newTime;
//                  // Event listener will emit timeupdate
//             }
//         } else {
//             console.warn("PlayerCore: Cannot seek, audio not ready.");
//         }
//     }
//
//     function setVolume(volume /* 0 to N, where 1 is normal */) {
//         currentVolume = Math.max(0, volume);
//         if (gainNode && audioCtx) {
//             // Use exponential ramp for smoother perceived volume change? Or linear is fine.
//             // gainNode.gain.linearRampToValueAtTime(currentVolume, audioCtx.currentTime + 0.05); // Ramp over 50ms
//              gainNode.gain.setValueAtTime(currentVolume, audioCtx.currentTime); // Immediate change
//             console.log(`PlayerCore: Volume set to ${currentVolume.toFixed(2)}`);
//         }
//     }
//
//     function setSpeed(speed) {
//         currentSpeed = Math.max(0.25, Math.min(speed, 4.0)); // Example bounds
//         if (audioEl) {
//             audioEl.playbackRate = currentSpeed;
//             audioEl.preservesPitch = true; // Usually desired
//             audioEl.mozPreservesPitch = true;
//             console.log(`PlayerCore: Speed set to ${currentSpeed.toFixed(2)}x`);
//         }
//     }
//
//     function on(eventName, callback) {
//         if (eventListeners[eventName] && typeof callback === 'function') {
//             eventListeners[eventName].push(callback);
//         }
//     }
//
//     function off(eventName, callback) {
//         if (eventListeners[eventName]) {
//             eventListeners[eventName] = eventListeners[eventName].filter(cb => cb !== callback);
//         }
//     }
//
//     function cleanup() {
//         if (!audioEl) return;
//         pause();
//         disconnectAudioElementSource();
//         audioEl.removeAttribute('src'); // Remove source
//         audioEl.load(); // Abort loading/playback
//         // Remove specific listeners added by this module? Or assume they die with the element.
//         // Close audio context? Only if this module owns it exclusively.
//         if (audioCtx && audioCtx.state !== 'closed') {
//              audioCtx.close().then(() => console.log("PlayerCore: AudioContext closed.")).catch(e => console.warn("PlayerCore: Error closing context", e));
//              audioCtx = null;
//         }
//         console.log("PlayerCore: Cleaned up.");
//     }
//
//
//     // --- Getters ---
//     function getCurrentTime() { return currentTime; }
//     function getDuration() { return duration; }
//     function getIsPlaying() { return isPlaying; }
//     function getIsReady() { return isReady; }
//
//
//     // Public API
//     return {
//         init,
//         load,
//         play,
//         pause,
//         seek,
//         setVolume,
//         setSpeed,
//         on,
//         off,
//         cleanup,
//         // Getters
//         getCurrentTime,
//         getDuration,
//         getIsPlaying,
//         getIsReady
//     };
// })();
//
// window.PlayerCore = PlayerCore; // Expose to global scope
// // --- END OF FILE player-core.js ---