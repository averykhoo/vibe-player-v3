# README: Rubberband Hybrid Audio Processor Design

## 1. Goal

This application provides interactive, real-time time stretching, pitch shifting, and formant shifting for audio files, employing a hybrid processing strategy to optimize quality, especially for significant slowdowns. It also serves as a tool to compare the audio quality results of different Rubberband processing paths.

The primary goals are:

1.  Allow dynamic, real-time adjustment of playback speed, pitch, and formants via UI controls.
2.  Implement a **hybrid approach:**
    *   Pre-compute a high-quality slow version using Rubberband's offline mode (`_study` + `_process`).
    *   Use Rubberband's real-time mode (`ProcessRealTime`) in an `AudioWorklet` for interactive playback.
    *   Dynamically switch the real-time processor's input between the original audio and the pre-computed slow version based on a configurable speed threshold.
3.  Enable direct **A/B comparison** between:
    *   Pure real-time processing vs. hybrid (offline + real-time) path.
    *   Pure offline processing vs. pure real-time processing (at the pre-computed slow speed).
4.  Implement **configurable source-switching behaviors** (Abrupt, Mute, Micro-Fade) to manage transitions at the speed threshold.
5.  Allow user configuration of the **speed threshold** and the **initial slow speed** for pre-processing.
6.  (Optional) Allow configuration of real-time quality flags.

## 2. Core Concept

*   **Offline Pre-processing:** Upon loading an audio file, an offline Rubberband process (`_study` + `_process`) generates a high-quality version stretched to a user-defined `initialSlowSpeed` (e.g., 0.25x), stored as `slowBuffer`.
*   **Real-time Processing:** An `AudioWorkletProcessor` (`hybrid-processor.js`) handles continuous audio output using Rubberband's `ProcessRealTime` mode.
*   **Hybrid Source Selection:** Based on the `currentTargetSpeed` and a configurable `speedThreshold`:
    *   If `speed <= threshold`, the worklet reads from `slowBuffer` and applies a real-time speed-up ratio (`initialSlowSpeed / currentTargetSpeed`).
    *   If `speed > threshold`, the worklet reads from `originalBuffer` and applies a real-time stretch ratio (`1.0 / currentTargetSpeed`).
*   **Dynamic Parameters:** Target speed, pitch, formant, threshold, and switching behavior are updated dynamically via messages or `SharedArrayBuffer` from the main thread to the worklet.
*   **Configurable Transitions:** The worklet implements logic for "Abrupt", "Mute", or "Micro-Fade" transitions when switching input sources at the threshold.
*   **WASM Loading:** Uses the same strategy as the test harness: main thread fetches WASM binary and loader script text; worklet receives these, uses `eval` on loader text, and the `instantiateWasm` hook with the binary to initialize WASM.

## 3. System Architecture

*   **UI Layer (`index.html`, `style.css`):** Extends test harness UI with Pitch, Formant, Threshold sliders, Initial Slow Speed input, and Switching Behavior selector.
*   **`main.js` (Main Thread):**
    *   Handles all UI logic and state mirroring.
    *   Initializes `AudioContext`, pre-fetches WASM/loader text.
    *   Manages file loading/decoding (`originalBuffer`).
    *   **Runs the offline pre-processing step (`preprocessSlowVersion`)** to create `slowBuffer` after decoding.
    *   Creates `AudioWorkletNode` (`hybrid-processor.js`), passing WASM binary, loader text, and initial config.
    *   Transfers `originalBuffer` and `slowBuffer` data (ideally via SAB, fallback to message).
    *   Sends parameter updates to the worklet based on UI interactions.
    *   Manages global playback state (play/pause).
*   **`hybrid-processor.js` (AudioWorklet Thread):**
    *   Receives WASM binary, loader text, initial config via `processorOptions`.
    *   Receives audio buffer data via message/SAB.
    *   Initializes WASM/Rubberband instance (`ProcessRealTime`) asynchronously after receiving audio data.
    *   Handles parameter update messages/SAB reads.
    *   Maintains conceptual playback time relative to the *original* audio.
    *   In `process()` loop:
        *   Determines required source (`original` vs `slow`) based on speed/threshold.
        *   Detects source switch needs.
        *   Executes configured switching behavior (Abrupt, Mute, Micro-Fade state machine).
        *   Calculates required real-time stretch ratio based on active source and target speed.
        *   Calculates read position in the *selected* source buffer based on conceptual time.
        *   Updates Rubberband instance (`_reset`, `_set_time_ratio`, `_set_pitch_scale`, `_set_formant_scale`).
        *   Copies input, calls `_process`, retrieves output.
        *   Applies gain for fades.
        *   Copies final audio to worklet output.
        *   Updates conceptual playback time.

## 4. Key Features

*   File loading and playback.
*   Interactive real-time control of Speed (0.25x-2.0x), Pitch (+/- semitones), Formant shift.
*   Offline pre-computation of a high-quality slow version.
*   Hybrid processing path automatically selected based on configurable speed threshold.
*   UI toggle to manually force using "Original" or "Pre-Processed (Slow)" source for comparison.
*   Configurable transition behavior (Abrupt, Mute, Micro-Fade) at the threshold switch point.
*   Direct A/B quality comparison capabilities.

## 5. WASM/Library Integration Strategy

*   Identical to the strategy proven in the "Real-time Test Harness":
    1.  Main thread fetches WASM binary (`ArrayBuffer`) & Loader Script (`string`).
    2.  Passes both to Worklet via `processorOptions` (binary transferred, text cloned).
    3.  Worklet `eval`s loader text to get loader function.
    4.  Worklet calls loader function with `instantiateWasm` hook using the provided binary.
    5.  Worklet creates `ProcessRealTime` Rubberband instance using the loaded WASM module exports.

## 6. Challenges & Known Issues

*   **Complexity:** Significantly more complex than a simple offline processor or the test harness due to hybrid logic, state management across threads, and switching behaviors.
*   **Memory Usage:** Requires storing both `originalBuffer` and `slowBuffer` in memory.
*   **Upfront Delay:** User waits for both decoding and offline pre-processing before playback is available.
*   **Synchronization:** Accurately mapping conceptual playback time to the correct read index in two different-length buffers (original vs. slow) requires careful math, especially during/after ratio changes or switches.
*   **Switching Glitches/Quality:** Even with Mute/Micro-Fade, transitions might not be perfectly seamless. The quality benefit of the hybrid approach vs. added complexity needs validation. Crossfading is complex to implement correctly.
*   **Real-time Performance:** CPU load on the audio thread is critical, especially if implementing crossfading (potentially running two instances) or using many quality flags.

## 7. Testing Strategy

*   Includes all tests from the "Test Harness" README.
*   **Offline Pre-processing:** Verify `slowBuffer` is generated correctly with expected length and quality at `initialSlowSpeed`.
*   **Hybrid Path Quality:** Perform extensive A/B testing using the source toggle at various speeds, pitch shifts, and formant shifts. Focus on speeds below 1.0x to evaluate the benefit of the hybrid approach.
*   **Threshold Behavior:** Systematically test the automatic switching at the `speedThreshold`. Use the threshold slider to move the switch point while listening.
*   **Switching Behavior Tests:** Test "Abrupt", "Mute", and "Micro-Fade" modes thoroughly. Evaluate the subjective quality of each transition type. Tune mute/fade durations.
*   **Parameter Interaction:** Test changing speed, pitch, formants, threshold, and source toggle in various combinations and sequences during playback.

## 8. File Structure

```
./
├── index.html (UI Layout)
├── style.css (Styling)
├── main.js (Main Thread Logic)
├── hybrid-processor.js (AudioWorklet Logic)
├── rubberband.js (Original Library Loader)
└── rubberband.wasm (Original Library WASM)
```