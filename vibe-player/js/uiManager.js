// --- /vibe-player/js/uiManager.js ---
// Handles DOM manipulation, UI event listeners, and dispatches UI events.
// Interacts with the DOM but does not contain application logic (playback, analysis).

var AudioApp = AudioApp || {}; // Ensure namespace exists

// Design Decision: Use IIFE to encapsulate UI logic.
AudioApp.uiManager = (function() {
    'use strict';

    // --- DOM Element References ---
    // ... (Keep all previous element references) ...
    /** @type {HTMLInputElement|null} */ let fileInput;
    /** @type {HTMLParagraphElement|null} */ let fileInfo;
    /** @type {HTMLButtonElement|null} */ let playPauseButton;
    /** @type {HTMLButtonElement|null} */ let jumpBackButton;
    /** @type {HTMLButtonElement|null} */ let jumpForwardButton;
    /** @type {HTMLInputElement|null} */ let jumpTimeInput;
    /** @type {HTMLDivElement|null} */ let timeDisplay;
    /** @type {HTMLInputElement|null} */ let playbackSpeedControl;
    /** @type {HTMLSpanElement|null} */ let speedValueDisplay;
    /** @type {HTMLSpanElement|null} */ let speedTooltip;
    /** @type {HTMLDivElement|null} */ let speedMarkers;
    /** @type {HTMLInputElement|null} */ let pitchControl;
    /** @type {HTMLSpanElement|null} */ let pitchValueDisplay;
    /** @type {HTMLSpanElement|null} */ let pitchTooltip;
    /** @type {HTMLDivElement|null} */ let pitchMarkers;
    /** @type {HTMLInputElement|null} */ let formantControl;
    /** @type {HTMLSpanElement|null} */ let formantValueDisplay;
    /** @type {HTMLSpanElement|null} */ let formantTooltip;
    /** @type {HTMLDivElement|null} */ let formantMarkers;
    /** @type {HTMLInputElement|null} */ let gainControl;
    /** @type {HTMLSpanElement|null} */ let gainValueDisplay;
    /** @type {HTMLSpanElement|null} */ let gainTooltip;
    /** @type {HTMLDivElement|null} */ let gainMarkers;
    /** @type {HTMLInputElement|null} */ let vadThresholdSlider;
    /** @type {HTMLSpanElement|null} */ let vadThresholdValueDisplay;
    /** @type {HTMLInputElement|null} */ let vadNegativeThresholdSlider;
    /** @type {HTMLSpanElement|null} */ let vadNegativeThresholdValueDisplay;
    /** @type {HTMLCanvasElement|null} */ let waveformCanvas;
    /** @type {HTMLCanvasElement|null} */ let spectrogramCanvas;
    /** @type {HTMLSpanElement|null} */ let spectrogramSpinner;
    /** @type {HTMLDivElement|null} */ let waveformProgressIndicator;
    /** @type {HTMLDivElement|null} */ let spectrogramProgressIndicator;
    /** @type {HTMLPreElement|null} */ let speechRegionsDisplay;


    // --- Initialization ---

    /**
     * Initializes the UI Manager: finds elements, sets up listeners, positions markers.
     * @public
     */
    function init() {
        console.log("UIManager: Initializing...");
        assignDOMElements();
        initializeSliderMarkers(); // Position the markers based on slider range
        setupEventListeners();
        resetUI();
        console.log("UIManager: Initialized.");
    }

    // --- DOM Element Assignment ---

    /**
     * Gets references to all needed DOM elements by their ID.
     * @private
     */
    function assignDOMElements() {
        // ... (Assignments remain the same as the previous version) ...
        fileInput = document.getElementById('audioFile'); fileInfo = document.getElementById('fileInfo'); playPauseButton = document.getElementById('playPause'); jumpBackButton = document.getElementById('jumpBack'); jumpForwardButton = document.getElementById('jumpForward'); jumpTimeInput = document.getElementById('jumpTime'); timeDisplay = document.getElementById('timeDisplay'); playbackSpeedControl = document.getElementById('playbackSpeed'); speedValueDisplay = document.getElementById('speedValue'); speedTooltip = document.getElementById('speedTooltip'); speedMarkers = document.getElementById('speedMarkers'); pitchControl = document.getElementById('pitchControl'); pitchValueDisplay = document.getElementById('pitchValue'); pitchTooltip = document.getElementById('pitchTooltip'); pitchMarkers = document.getElementById('pitchMarkers'); formantControl = document.getElementById('formantControl'); formantValueDisplay = document.getElementById('formantValue'); formantTooltip = document.getElementById('formantTooltip'); formantMarkers = document.getElementById('formantMarkers'); gainControl = document.getElementById('gainControl'); gainValueDisplay = document.getElementById('gainValue'); gainTooltip = document.getElementById('gainTooltip'); gainMarkers = document.getElementById('gainMarkers'); vadThresholdSlider = document.getElementById('vadThreshold'); vadThresholdValueDisplay = document.getElementById('vadThresholdValue'); vadNegativeThresholdSlider = document.getElementById('vadNegativeThreshold'); vadNegativeThresholdValueDisplay = document.getElementById('vadNegativeThresholdValue'); waveformCanvas = document.getElementById('waveformCanvas'); spectrogramCanvas = document.getElementById('spectrogramCanvas'); spectrogramSpinner = document.getElementById('spectrogramSpinner'); waveformProgressIndicator = document.getElementById('waveformProgressIndicator'); spectrogramProgressIndicator = document.getElementById('spectrogramProgressIndicator'); speechRegionsDisplay = document.getElementById('speechRegionsDisplay');
        // Simple check
        if (!fileInput || !playbackSpeedControl || !pitchControl || !formantControl || !gainControl ) { console.warn("UIManager: Could not find all required UI elements!"); }
    }

    // --- Slider Marker Positioning ---

    /**
     * Calculates and sets the absolute position of slider markers based on their value.
     * Should be called once during initialization after elements are assigned.
     * @private
     */
    function initializeSliderMarkers() {
        const markerConfigs = [
            { slider: playbackSpeedControl, markersDiv: speedMarkers },
            { slider: pitchControl, markersDiv: pitchMarkers },
            { slider: formantControl, markersDiv: formantMarkers },
            { slider: gainControl, markersDiv: gainMarkers }
        ];

        markerConfigs.forEach(config => {
            const { slider, markersDiv } = config;
            if (!slider || !markersDiv) return; // Skip if elements are missing

            const min = parseFloat(slider.min);
            const max = parseFloat(slider.max);
            const range = max - min;
            if (range <= 0) return; // Avoid division by zero

            const markers = markersDiv.querySelectorAll('span[data-value]');
            markers.forEach(span => {
                const value = parseFloat(span.dataset.value);
                if (!isNaN(value)) {
                    const percent = ((value - min) / range) * 100;
                    span.style.left = `${percent}%`;
                }
            });
        });
    }

    // --- Event Listener Setup ---

    /**
     * Sets up event listeners for user interactions on UI elements.
     * @private
     */
    function setupEventListeners() {
        // File Input
        fileInput?.addEventListener('change', (e) => { const file = e.target.files?.[0]; if (file) dispatchUIEvent('audioapp:fileSelected', { file: file }); fileInput.blur(); });
        // Playback Buttons
        playPauseButton?.addEventListener('click', () => dispatchUIEvent('audioapp:playPauseClicked'));
        jumpBackButton?.addEventListener('click', () => dispatchUIEvent('audioapp:jumpClicked', { seconds: -getJumpTime() }));
        jumpForwardButton?.addEventListener('click', () => dispatchUIEvent('audioapp:jumpClicked', { seconds: getJumpTime() }));
        // Sliders (Speed, Pitch, Formant, Gain)
        setupSliderListeners(playbackSpeedControl, speedValueDisplay, speedTooltip, 'audioapp:speedChanged', 'speed');
        setupSliderListeners(pitchControl, pitchValueDisplay, pitchTooltip, 'audioapp:pitchChanged', 'pitch');
        setupSliderListeners(formantControl, formantValueDisplay, formantTooltip, 'audioapp:formantChanged', 'formant');
        setupSliderListeners(gainControl, gainValueDisplay, gainTooltip, 'audioapp:gainChanged', 'gain');
        // Marker Clicks
        speedMarkers?.addEventListener('click', (e) => handleMarkerClick(e, playbackSpeedControl));
        pitchMarkers?.addEventListener('click', (e) => handleMarkerClick(e, pitchControl));
        formantMarkers?.addEventListener('click', (e) => handleMarkerClick(e, formantControl));
        gainMarkers?.addEventListener('click', (e) => handleMarkerClick(e, gainControl));
        // VAD Tuning Sliders
        vadThresholdSlider?.addEventListener('input', handleVadSliderInput);
        vadNegativeThresholdSlider?.addEventListener('input', handleVadSliderInput);
        // Global Keyboard Shortcuts
        document.addEventListener('keydown', handleKeyDown);
    }

    /**
     * Helper to set up common listeners for a slider (input, tooltip visibility).
     * @param {HTMLInputElement | null} slider
     * @param {HTMLSpanElement | null} valueDisplay
     * @param {HTMLSpanElement | null} tooltip
     * @param {string} eventName
     * @param {string} detailKey
     */
    function setupSliderListeners(slider, valueDisplay, tooltip, eventName, detailKey) {
        // ... (This helper function remains the same as previous version) ...
        if (!slider || !valueDisplay || !tooltip) return; const updateStaticDisplay = () => { const value = parseFloat(slider.value); valueDisplay.textContent = value.toFixed(2) + "x"; }; slider.addEventListener('input', () => { updateStaticDisplay(); updateTooltip(slider, tooltip); dispatchUIEvent(eventName, { [detailKey]: parseFloat(slider.value) }); }); const showTooltip = () => { if (slider.disabled) return; updateTooltip(slider, tooltip); tooltip.style.visibility = 'visible'; }; const hideTooltip = () => { tooltip.style.visibility = 'hidden'; }; slider.addEventListener('mousedown', showTooltip); slider.addEventListener('touchstart', showTooltip, { passive: true }); slider.addEventListener('mouseup', hideTooltip); slider.addEventListener('touchend', hideTooltip); slider.addEventListener('mouseleave', hideTooltip);
    }

     // --- Specific Event Handlers ---

    /** Handles keydown. @param {KeyboardEvent} e @private */
     function handleKeyDown(e) { /* ... (No changes) ... */ const target = e.target; const isTextInput = target.tagName === 'INPUT' && (target.type === 'text' || target.type === 'number' || target.type === 'search' || target.type === 'email' || target.type === 'password' || target.type === 'url'); const isTextArea = target.tagName === 'TEXTAREA'; if (isTextInput || isTextArea) return; let handled = false; let eventKey = null; switch (e.code) { case 'Space': eventKey = 'Space'; handled = true; break; case 'ArrowLeft': eventKey = 'ArrowLeft'; handled = true; break; case 'ArrowRight': eventKey = 'ArrowRight'; handled = true; break; } if (eventKey) dispatchUIEvent('audioapp:keyPressed', { key: eventKey }); if (handled) e.preventDefault(); }
    /** Handles VAD slider input. @param {Event} e @private */
    function handleVadSliderInput(e) { /* ... (No changes) ... */ const slider = /** @type {HTMLInputElement} */ (e.target); const value = parseFloat(slider.value); let type = null; if (slider === vadThresholdSlider && vadThresholdValueDisplay) { vadThresholdValueDisplay.textContent = value.toFixed(2); type = 'positive'; } else if (slider === vadNegativeThresholdSlider && vadNegativeThresholdValueDisplay) { vadNegativeThresholdValueDisplay.textContent = value.toFixed(2); type = 'negative'; } if (type) dispatchUIEvent('audioapp:thresholdChanged', { type: type, value: value }); }
    /** Handles marker clicks. @param {MouseEvent} event @param {HTMLInputElement | null} sliderElement @private */
    function handleMarkerClick(event, sliderElement) { /* ... (No changes needed, already uses data-value) ... */ if (!sliderElement || sliderElement.disabled) return; const target = event.target; if (target.tagName === 'SPAN' && target.dataset.value) { const value = parseFloat(target.dataset.value); if (!isNaN(value)) { sliderElement.value = String(value); sliderElement.dispatchEvent(new Event('input', { bubbles: true })); } } }

    // --- Tooltip Update ---

    /**
     * Updates tooltip position and text.
     * @param {HTMLInputElement} slider
     * @param {HTMLSpanElement} tooltip
     * @private
     */
    function updateTooltip(slider, tooltip) {
        // ... (Tooltip positioning logic remains the same as previous version) ...
        if (!slider || !tooltip) return; const min = parseFloat(slider.min); const max = parseFloat(slider.max); const val = parseFloat(slider.value); const sliderWidth = slider.clientWidth; const thumbWidth = 16; const range = max - min; const percent = range === 0 ? 0 : (val - min) / range; let thumbCenterPx = percent * sliderWidth; const offsetCorrection = thumbWidth * (percent - 0.5) * -1; const finalLeftPx = thumbCenterPx + offsetCorrection; tooltip.textContent = val.toFixed(2) + "x"; tooltip.style.left = `${finalLeftPx}px`;
    }

    // --- Helper to Dispatch Custom Events ---
    /** Dispatches event. @param {string} eventName @param {object} [detail={}] @private */
    function dispatchUIEvent(eventName, detail = {}) { /* ... (No changes) ... */ document.dispatchEvent(new CustomEvent(eventName, { detail: detail })); }

    // --- Public Methods for Updating UI ---
    /** Resets UI elements. @public */
    function resetUI() { /* ... (Reset logic remains the same) ... */ console.log("UIManager: Resetting UI"); setFileInfo("No file selected."); setPlayButtonState(false); updateTimeDisplay(0, 0); setSpeechRegionsText("None"); updateVadDisplay(0.5, 0.35, true); if (playbackSpeedControl) playbackSpeedControl.value = "1.0"; if (speedValueDisplay) speedValueDisplay.textContent = "1.00x"; if (pitchControl) pitchControl.value = "1.0"; if (pitchValueDisplay) pitchValueDisplay.textContent = "1.00x"; if (formantControl) formantControl.value = "1.0"; if (formantValueDisplay) formantValueDisplay.textContent = "1.00x"; if (gainControl) gainControl.value = "1.0"; if (gainValueDisplay) gainValueDisplay.textContent = "1.00x"; if (jumpTimeInput) jumpTimeInput.value = "5"; [speedTooltip, pitchTooltip, formantTooltip, gainTooltip].forEach(tip => { if(tip) tip.style.visibility = 'hidden'; }); enablePlaybackControls(false); enableVadControls(false); }
    /** Sets file info text. @param {string} text @public */
    function setFileInfo(text) { /* ... (No changes) ... */ if (fileInfo) fileInfo.textContent = text; }
    /** Sets play/pause button text. @param {boolean} isPlaying @public */
    function setPlayButtonState(isPlaying) { /* ... (No changes) ... */ if (playPauseButton) playPauseButton.textContent = isPlaying ? 'Pause' : 'Play'; }
    /** Updates time display. @param {number} currentTime @param {number} duration @public */
    function updateTimeDisplay(currentTime, duration) { /* ... (No changes) ... */ if (timeDisplay) timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`; }
    /** Sets speech regions text. @param {string | Array<{start: number, end: number}>} regionsOrText @public */
    function setSpeechRegionsText(regionsOrText) { /* ... (No changes) ... */ if (!speechRegionsDisplay) return; if (typeof regionsOrText === 'string') { speechRegionsDisplay.textContent = regionsOrText; } else if (Array.isArray(regionsOrText)) { if (regionsOrText.length > 0) { speechRegionsDisplay.textContent = regionsOrText.map(r => `Start: ${r.start.toFixed(2)}s, End: ${r.end.toFixed(2)}s`).join('\n'); } else { speechRegionsDisplay.textContent = "No speech detected."; } } else { speechRegionsDisplay.textContent = "None"; } }
    /** Updates VAD displays. @param {number} positive @param {number} negative @param {boolean} [isNA=false] @public */
    function updateVadDisplay(positive, negative, isNA = false) { /* ... (No changes) ... */ if (isNA) { if (vadThresholdValueDisplay) vadThresholdValueDisplay.textContent = "N/A"; if (vadNegativeThresholdValueDisplay) vadNegativeThresholdValueDisplay.textContent = "N/A"; if (vadThresholdSlider) vadThresholdSlider.value = "0.5"; if (vadNegativeThresholdSlider) vadNegativeThresholdSlider.value = "0.35"; } else { if (vadThresholdSlider) vadThresholdSlider.value = String(positive); if (vadThresholdValueDisplay) vadThresholdValueDisplay.textContent = positive.toFixed(2); if (vadNegativeThresholdSlider) vadNegativeThresholdSlider.value = String(negative); if (vadNegativeThresholdValueDisplay) vadNegativeThresholdValueDisplay.textContent = negative.toFixed(2); } }
    /** Enables/disables playback controls. @param {boolean} enable @public */
    function enablePlaybackControls(enable) { /* ... (No changes) ... */ if (playPauseButton) playPauseButton.disabled = !enable; if (jumpBackButton) jumpBackButton.disabled = !enable; if (jumpForwardButton) jumpForwardButton.disabled = !enable; if (playbackSpeedControl) playbackSpeedControl.disabled = !enable; if (pitchControl) pitchControl.disabled = !enable; if (formantControl) formantControl.disabled = !enable; }
    /** Enables/disables VAD controls. @param {boolean} enable @public */
    function enableVadControls(enable) { /* ... (No changes) ... */ if (vadThresholdSlider) vadThresholdSlider.disabled = !enable; if (vadNegativeThresholdSlider) vadNegativeThresholdSlider.disabled = !enable; }
    /** Gets jump time value. @returns {number} @public */
    function getJumpTime() { /* ... (No changes) ... */ return parseFloat(jumpTimeInput?.value) || 5; }
    /** Formats time. @param {number} sec @returns {string} @private */
    function formatTime(sec) { /* ... (No changes) ... */ if (isNaN(sec) || sec < 0) sec = 0; const minutes = Math.floor(sec / 60); const seconds = Math.floor(sec % 60); return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`; }

    // --- Public Interface ---
    return {
        init: init, resetUI: resetUI, setFileInfo: setFileInfo, setPlayButtonState: setPlayButtonState, updateTimeDisplay: updateTimeDisplay, setSpeechRegionsText: setSpeechRegionsText, updateVadDisplay: updateVadDisplay, enablePlaybackControls: enablePlaybackControls, enableVadControls: enableVadControls, getJumpTime: getJumpTime
    };
})(); // End of uiManager IIFE
// --- /vibe-player/js/uiManager.js ---
