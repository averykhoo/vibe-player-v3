[//]: # ( vibe-player-v3-docs/docs/refactor-plan/appendix-b-v1-analysis.md )
# Appendix B: V1 Architectural Analysis & Tradeoffs (Historical Context)

This section migrates the key insights from the original V1 plan. It serves as historical context to understand the "
why" behind certain V3 design decisions.

* **V1 Core Philosophy:** Prioritized simplicity and minimal dependencies using Vanilla JS, HTML, and CSS. Leveraged
  WebAssembly (WASM) via standard Web APIs for computationally intensive tasks.

* **Time/Pitch Shifting (Rubberband WASM):**
    * **Temporal Inaccuracy Tradeoff:** The V1 plan explicitly noted that Rubberband prioritizes audio quality over
      strict temporal accuracy, causing its time reporting to drift relative to the Web Audio clock.
    * **V1 Solution (Adopted by V3):** This drift necessitated the use of **main-thread `requestAnimationFrame` time
      calculation** for the UI indicator and periodic seek-based synchronization to keep the audio engine aligned with
      the UI's authoritative time. V3 formalizes this as the "Hot Path" pattern.

* **VAD (Silero ONNX):**
    * **Main-Thread VAD (Async):** In V1, VAD processing ran on the main thread but used `async/await` and
      `setTimeout(0)` to yield periodically.
    * **Tradeoff:** This was simpler for an MVP but could cause UI sluggishness and was susceptible to throttling.
    * **V3 Improvement:** V3 moves this to a dedicated Web Worker to solve these issues, but the core VAD logic remains
      the "golden master" for characterization testing.

* **DTMF & CPT Detection (Goertzel Algorithm):**
    * **Main-Thread Processing:** This was implemented in pure JavaScript and ran on the main thread after audio was
      resampled.
    * **V3 Improvement:** V3 moves this logic into a dedicated Web Worker for better performance and isolation,
      preventing it from blocking the UI on long audio files.

* **IIFE Module Pattern & Script Order:**
    * **Fragility:** V1 used an IIFE (Immediately Invoked Function Expression) pattern which relied on a carefully
      managed `<script>` loading order in `index.html`, a primary source of fragility.
    * **V3 Improvement:** V3's use of ES Modules with Vite's build process completely eliminates this problem by
      creating a dependency graph and producing a correctly bundled output.