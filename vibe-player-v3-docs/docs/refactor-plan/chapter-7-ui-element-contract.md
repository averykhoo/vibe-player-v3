[//]: # ( vibe-player-v3/docs/refactor-plan/chapter-7-ui-element-contract.md )
# Chapter 7: UI Element Contract

In accordance with **Principle 3 (Stable Selectors for E2E Testing)**, this chapter defines the mandatory `data-testid`
attributes that serve as a stable contract between the application's UI and the automated test suite. These IDs are the
single source of truth for locating elements in Playwright tests. All interactive or dynamically updated elements
relevant to a user flow must be included here.

| Component Group        | Svelte Component (File)                    | Test ID                     | Description                                                  |
|:-----------------------|:-------------------------------------------|:----------------------------|:-------------------------------------------------------------|
| **File Handling**      | `<FileLoader.svelte>`                      | `file-input`                | The `<input type="file">` element.                           |
|                        |                                            | `url-input`                 | The `<input type="text">` for audio URLs.                    |
|                        |                                            | `file-name-display`         | Displays the name of the loaded file.                        |
| **Playback Controls**  | `<Controls.svelte>`                        | `play-button`               | The main play/pause toggle button.                           |
|                        |                                            | `stop-button`               | The stop playback button.                                    |
|                        |                                            | `jump-back-button`          | Jumps playback backward.                                     |
|                        |                                            | `jump-forward-button`       | Jumps playback forward.                                      |
|                        | `<CustomRangeSlider.svelte>`               | `seek-slider-input`         | The `<input type="range">` for seeking.                      |
|                        | `+page.svelte`                             | `time-display`              | Displays current time and duration.                          |
| **Parameter Controls** | `<CustomRangeSlider.svelte>`               | `speed-slider-input`        | Controls playback speed.                                     |
|                        |                                            | `pitch-slider-input`        | Controls pitch shift.                                        |
|                        |                                            | `gain-slider-input`         | Controls output gain.                                        |
|                        | `<Controls.svelte>`                        | `reset-controls-button`     | Resets speed, pitch, and gain to defaults.                   |
| **Analysis Controls**  | `<CustomRangeSlider.svelte>`               | `vad-positive-slider-input` | Adjusts VAD positive threshold.                              |
|                        |                                            | `vad-negative-slider-input` | Adjusts VAD negative threshold.                              |
| **Analysis Displays**  | `<ToneDisplay.svelte>`                     | `dtmf-display`              | Displays detected DTMF tones.                                |
|                        |                                            | `cpt-display`               | Displays detected Call Progress Tones.                       |
| **Visualizations**     | `<Waveform.svelte>`                        | `waveform-canvas`           | The `<canvas>` for the audio waveform.                       |
|                        | `<Spectrogram.svelte>`                     | `spectrogram-canvas`        | The `<canvas>` for the spectrogram.                          |
| **Application State**  | `+layout.svelte` or `GlobalSpinner.svelte` | `loading-spinner`           | The global spinner element shown during the `LOADING` state. |