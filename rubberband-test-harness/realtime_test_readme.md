# README: Rubberband Real-time Test Harness Design

## 1. Goal

This application serves as a focused test harness to validate the core real-time capabilities of the Rubberband WASM library within a browser's `AudioWorklet` environment *before* building a more complex hybrid application.

The primary goals are to:

*   Verify successful loading and instantiation of the Rubberband WASM module **inside** an `AudioWorkletProcessor`.
*   Confirm basic audio processing using Rubberband's **`ProcessRealTime`** mode within the worklet's processing loop.
*   Test the ability to **dynamically change** the time stretch ratio (`_rubberband_set_time_ratio`) during playback via UI controls.
*   Implement and test the fundamental logic for **switching between conceptual audio sources** (even if initially using the same underlying audio data) and managing the associated state changes (`_rubberband_reset`).
*   Assess the **performance and stability** of real-time Rubberband processing on the audio thread.

## 2. Core Concept

*   **Real-time Processing:** Exclusively uses Rubberband's `ProcessRealTime` mode. No offline pre-processing (`_study` pass) is performed.
*   **AudioWorklet:** All Rubberband processing occurs within a custom `AudioWorkletProcessor` (`realtime_test_processor.js`) running on the dedicated audio thread to avoid blocking the main UI thread.
*   **WASM Loading in Worklet:** The main thread pre-fetches the WASM binary (`.wasm`) and the loader script (`rubberband.js`) text. These are passed to the worklet, which then uses `eval` (or `new Function`) on the loader text and the `instantiateWasm` hook (with the provided binary) to initialize the WASM module within its own scope.
*   **Simulated Source Switching:** A UI toggle allows switching between processing logic paths that *simulate* reading from either an "Original (1.0x)" buffer or a "Slow (0.25x)" buffer. Initially, both paths read from the same loaded `originalAudioBuffer`, but the ratio calculations and internal state management differ, allowing testing of the switching mechanics.
*   **Dynamic Speed Control:** A slider allows the user to change the target playback speed during playback, sending updates to the worklet.
*   **Abrupt Switching:** Only the simplest source switching logic is implemented (resetting Rubberband state and applying the new ratio immediately) to test the core mechanism without the complexity of fading.

## 3. System Architecture

*   **`realtime_test_index.html` / `realtime_test_style.css`:** UI layout and styling. Provides file input, play/pause, speed slider, source toggle button, status display.
*   **`realtime_test_main.js` (Main Thread):**
    *   Initializes `AudioContext`.
    *   Pre-fetches WASM binary (`ArrayBuffer`) and Loader Script (`string`).
    *   Handles file loading/decoding into `originalAudioBuffer`.
    *   Creates the `AudioWorkletNode`, passing WASM binary and loader text via `processorOptions`.
    *   Transfers audio channel data (`ArrayBuffer`s) to the worklet via `postMessage`.
    *   Manages UI state (button text, slider values).
    *   Handles UI events (play/pause, slider change, toggle click) and sends corresponding messages to the worklet.
    *   Listens for status/error messages from the worklet.
*   **`realtime_test_processor.js` (AudioWorklet Thread):**
    *   Receives WASM binary and loader text via `processorOptions`.
    *   Receives audio data via `postMessage`.
    *   On first audio load, triggers asynchronous WASM initialization (`initializeWasmAndRubberband`):
        *   Uses `eval`/`new Function` on loader text to get the loader function.
        *   Calls loader function with `instantiateWasm` hook (using the provided WASM binary).
        *   Creates a `ProcessRealTime` Rubberband instance.
        *   Allocates persistent WASM memory buffers (`_malloc`).
        *   Signals readiness back to the main thread.
    *   Handles messages from the main thread (`play`, `pause`, `set-speed`, `set-source`).
    *   In `process()` loop:
        *   Checks `isPlaying` state.
        *   Determines active source path (Original vs. Slow simulation).
        *   Calculates required real-time stretch ratio.
        *   If source or ratio changes significantly (or `resetNeeded` flag is set), calls `_rubberband_reset` and `_rubberband_set_time_ratio`.
        *   Calculates read position in the source buffer based on conceptual playback time.
        *   Copies input chunk from source buffer to WASM memory.
        *   Calls `_rubberband_process`.
        *   Retrieves output chunk(s) using `_available`/`_retrieve`.
        *   Copies retrieved output to the worklet's output buffers.
        *   Updates conceptual playback time based on input consumed.

## 4. Key Features Tested

*   Loading audio file.
*   Play/Pause control.
*   Dynamic playback speed adjustment via slider (0.25x - 2.0x).
*   Manual toggling between "Original" and "Simulated Slow" source logic paths.
*   Basic real-time audio processing via Rubberband WASM in an AudioWorklet.

## 5. WASM/Library Integration Strategy

1.  Main thread fetches `rubberband.wasm` -> `wasmBinary` (ArrayBuffer).
2.  Main thread fetches `rubberband.js` -> `loaderScriptText` (String).
3.  Main thread creates `AudioWorkletNode`, passing `wasmBinary` (transferred) and `loaderScriptText` (cloned) in `processorOptions`.
4.  Worklet receives audio data via message, triggering `initializeWasmAndRubberband`.
5.  Worklet uses `eval`/`new Function` on `loaderScriptText` to get the `RubberbandModuleLoader` async function factory.
6.  Worklet calls the factory to get the loader function.
7.  Worklet calls the loader function, providing an `instantiateWasm` hook that uses `WebAssembly.instantiate(this.wasmBinary, ...)`
8.  Loader resolves, providing the `wasmModule` (exports) to the worklet.
9.  Worklet creates Rubberband instance and allocates buffers using `this.wasmModule`.

## 6. Challenges & Known Issues

*   **WASM Loading in Worklet:** The primary challenge addressed by the chosen integration strategy. Relies on `eval` which can be sensitive to the structure of `rubberband.js`.
*   **Real-time Performance:** The WASM processing must complete within the `process` call timeframe (~2.6ms @ 48kHz/128 samples). Performance bottlenecks may cause glitches.
*   **Playback Position Tracking:** Accurately mapping the conceptual playback time to the correct sample index in the source buffer, especially when the ratio changes, requires careful calculation.
*   **Switching Glitches:** The abrupt source switching logic implemented will likely cause audible clicks/pops when toggled during playback. This is expected for this test harness.
*   **AudioContext `suspended` State:** Requires user interaction (like clicking Play) to resume the `AudioContext` if it starts suspended.

## 7. Testing Strategy

*   **WASM Load:** Verify no errors occur during worklet initialization and the "processor-ready" message is received.
*   **Basic Playback:** Play audio at fixed 1.0x speed. Verify clear audio output for the full duration.
*   **Fixed Speed Stretch:** Play audio at fixed speeds (e.g., 0.5x, 1.5x). Verify output speed matches target and audio is mostly intelligible.
*   **Dynamic Speed Change:** While playing, move the speed slider. Verify the playback speed changes audibly and reasonably smoothly (accepting potential minor glitches).
*   **Source Toggle:** While playing, click the source toggle button. Verify playback continues and the internal ratio calculation (visible via console logs if added) changes appropriately. Listen for the expected abrupt switch glitch.
*   **Performance:** Use browser developer tools (Profiler) to monitor audio thread CPU usage during playback, especially while changing speed. Look for high sustained load or spikes causing dropouts.
*   **Console Errors:** Monitor console closely for any errors from the main thread or worklet.

## 8. File Structure

```
./
├── realtime_test_index.html
├── realtime_test_style.css
├── realtime_test_main.js (Main Thread Logic)
├── realtime_test_processor.js (AudioWorklet Logic)
├── rubberband.js (~~Original~~ heavily modified Library Loader)
└── rubberband.wasm (Original Library WASM)
```
