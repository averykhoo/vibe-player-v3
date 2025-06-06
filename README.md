<!-- README.md -->
# Vibe Player

Vibe Player is a simple, browser-based audio player designed for analyzing and manipulating audio files, inspired by classic desktop application aesthetics. It runs entirely client-side using static files.

**Live Demo: [Vibe Player](https://averykhoo.github.io/vibe-player/)**

## Features

*   Load local audio files (common formats supported by browser `decodeAudioData`) and from URLs.
*   Real-time playback control (Play, Pause, Seek).
*   Adjust playback Speed (0.25x - 2.0x) using Rubberband WASM.
*   Adjust playback Pitch (0.25x - 2.0x) using Rubberband WASM.
*   Adjust playback Gain (Volume Boost up to 5x).
*   Voice Activity Detection (VAD) using Silero VAD model (ONNX Runtime):
    *   Displays VAD progress during analysis.
    *   Highlights detected speech segments on the waveform.
    *   Allows tuning VAD thresholds (Positive/Negative) after initial analysis.
*   Visualizations:
    *   Real-time Waveform display.
    *   Spectrogram display.
*   **DTMF and Call Progress Tone (CPT) detection and display.**
*   Keyboard shortcuts for common actions (visible in the application UI).

## Usage

1.  Serve the project files using a simple static file server (e.g., `python -m http.server` or VS Code Live Server). The server should be run from the project root directory.
2.  Open `vibe-player/index.html` in your web browser (Chrome/Edge/Firefox recommended).
3.  Click "Choose File..." and select an audio file, or provide a URL.
4.  Wait for the initial processing (decoding, visuals). The waveform and spectrogram will appear.
5.  Playback controls (Play, Seek, Speed, Pitch, Gain) become active once the audio engine is ready.
6.  VAD processing runs in the background. Its progress is shown, and waveform highlights appear upon completion. VAD tuning sliders become active then.
7.  Use the controls or click on the waveform/spectrogram to interact.

## Controls

*   **Choose File...:** Select a local audio file.
*   **Load URL:** Load audio from a URL.
*   **Speed Slider:** Adjust playback speed (0.25x - 2.0x).
*   **Pitch Slider:** Adjust playback pitch scale (0.25x - 2.0x).
*   **Gain Slider:** Adjust output volume boost (1x - 5x).
*   **Play/Pause Button:** Toggle playback.
*   **Back/Forward Buttons & Input:** Jump backward or forward by the specified number of seconds.
*   **Seek Bar / Time Display:** Shows current position / total duration. Click or drag seek bar to jump.
*   **Waveform/Spectrogram:** Click to seek to that position.
*   **VAD Threshold Sliders:** (Enabled after VAD) Adjust positive/negative thresholds to re-evaluate speech segments based on the initial analysis probabilities.
*   **(Keyboard Shortcuts are listed within the application UI)**

## Developer Notes

*   **Static Environment:** This application is designed to run entirely client-side without any build steps or server-side logic. See `vibe-player/architecture.md` for more details.
*   **Key Technologies/Dependencies:** Vanilla JS (ES6), Web Audio API, ONNX Runtime Web (`ort.min.js`), Rubberband WASM (`rubberband.wasm`, `rubberband-loader.js`), FFT.js. These are included in the `vibe-player/lib/` directory.
*   **Code Structure:** Uses Vanilla JS (ES6) with an IIFE module pattern. See `vibe-player/architecture.md` for more details.

## Contributing / LLM Collaboration

Development involving LLM assistance should follow the guidelines outlined in `vibe-player/CONTRIBUTING-LLM.md`. Please ensure this file is loaded into the LLM's context before starting work. If the file is missing, please request it.

<!-- README.md -->