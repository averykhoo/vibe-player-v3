// --- /vibe-player/js/uiManager.js ---
// Handles DOM manipulation, UI event listeners, and dispatches UI events.

var AudioApp = AudioApp || {}; // Ensure namespace exists

AudioApp.uiManager = (function() {
    'use strict';

    // --- DOM Element References ---
    // ... (All element references remain the same) ...
    let fileInput, fileInfo, playPauseButton, jumpBackButton, jumpForwardButton, jumpTimeInput, timeDisplay, playbackSpeedControl, speedValueDisplay, speedTooltip, speedMarkers, pitchControl, pitchValueDisplay, pitchTooltip, pitchMarkers, formantControl, formantValueDisplay, formantTooltip, formantMarkers, gainControl, gainValueDisplay, gainTooltip, gainMarkers, vadThresholdSlider, vadThresholdValueDisplay, vadNegativeThresholdSlider, vadNegativeThresholdValueDisplay, waveformCanvas, spectrogramCanvas, spectrogramSpinner, waveformProgressIndicator, spectrogramProgressIndicator, speechRegionsDisplay;


    // --- Initialization ---
    /** @public */
    function init() {
        console.log("UIManager: Initializing...");
        assignDOMElements();
        initializeSliderMarkers();
        setupEventListeners();
        resetUI();
        console.log("UIManager: Initialized.");
    }

    // --- DOM Element Assignment ---
    /** @private */
    function assignDOMElements() {
        // ... (Assignments remain the same) ...
        fileInput = document.getElementById('audioFile'); fileInfo = document.getElementById('fileInfo'); playPauseButton = document.getElementById('playPause'); jumpBackButton = document.getElementById('jumpBack'); jumpForwardButton = document.getElementById('jumpForward'); jumpTimeInput = document.getElementById('jumpTime'); timeDisplay = document.getElementById('timeDisplay'); playbackSpeedControl = document.getElementById('playbackSpeed'); speedValueDisplay = document.getElementById('speedValue'); speedTooltip = document.getElementById('speedTooltip'); speedMarkers = document.getElementById('speedMarkers'); pitchControl = document.getElementById('pitchControl'); pitchValueDisplay = document.getElementById('pitchValue'); pitchTooltip = document.getElementById('pitchTooltip'); pitchMarkers = document.getElementById('pitchMarkers'); formantControl = document.getElementById('formantControl'); formantValueDisplay = document.getElementById('formantValue'); formantTooltip = document.getElementById('formantTooltip'); formantMarkers = document.getElementById('formantMarkers'); gainControl = document.getElementById('gainControl'); gainValueDisplay = document.getElementById('gainValue'); gainTooltip = document.getElementById('gainTooltip'); gainMarkers = document.getElementById('gainMarkers'); vadThresholdSlider = document.getElementById('vadThreshold'); vadThresholdValueDisplay = document.getElementById('vadThresholdValue'); vadNegativeThresholdSlider = document.getElementById('vadNegativeThreshold'); vadNegativeThresholdValueDisplay = document.getElementById('vadNegativeThresholdValue'); waveformCanvas = document.getElementById('waveformCanvas'); spectrogramCanvas = document.getElementById('spectrogramCanvas'); spectrogramSpinner = document.getElementById('spectrogramSpinner'); waveformProgressIndicator = document.getElementById('waveformProgressIndicator'); spectrogramProgressIndicator = document.getElementById('spectrogramProgressIndicator'); speechRegionsDisplay = document.getElementById('speechRegionsDisplay');
        if (!fileInput || !playbackSpeedControl || !pitchControl || !formantControl || !gainControl ) { console.warn("UIManager: Could not find all required UI elements!"); }
    }

    // --- Slider Marker Positioning ---
    /** @private */
    function initializeSliderMarkers() {
        // ... (Marker positioning logic remains the same) ...
        const markerConfigs = [ { slider: playbackSpeedControl, markersDiv: speedMarkers }, { slider: pitchControl, markersDiv: pitchMarkers }, { slider: formantControl, markersDiv: formantMarkers }, { slider: gainControl, markersDiv: gainMarkers } ]; markerConfigs.forEach(config => { const { slider, markersDiv } = config; if (!slider || !markersDiv) return; const min = parseFloat(slider.min); const max = parseFloat(slider.max); const range = max - min; if (range <= 0) return; const markers = markersDiv.querySelectorAll('span[data-value]'); markers.forEach(span => { const value = parseFloat(span.dataset.value); if (!isNaN(value)) { const percent = ((value - min) / range) * 100; span.style.left = `${percent}%`; } }); });
    }

    // --- Event Listener Setup ---
    /** @private */
    function setupEventListeners() {
        // ... (Listeners remain the same) ...
        fileInput?.addEventListener('change', (e) => { const file = e.target.files?.[0]; if (file) dispatchUIEvent('audioapp:fileSelected', { file: file }); fileInput.blur(); });
        playPauseButton?.addEventListener('click', () => dispatchUIEvent('audioapp:playPauseClicked')); jumpBackButton?.addEventListener('click', () => dispatchUIEvent('audioapp:jumpClicked', { seconds: -getJumpTime() })); jumpForwardButton?.addEventListener('click', () => dispatchUIEvent('audioapp:jumpClicked', { seconds: getJumpTime() }));
        setupSliderListeners(playbackSpeedControl, speedValueDisplay, speedTooltip, 'audioapp:speedChanged', 'speed'); setupSliderListeners(pitchControl, pitchValueDisplay, pitchTooltip, 'audioapp:pitchChanged', 'pitch'); setupSliderListeners(formantControl, formantValueDisplay, formantTooltip, 'audioapp:formantChanged', 'formant'); setupSliderListeners(gainControl, gainValueDisplay, gainTooltip, 'audioapp:gainChanged', 'gain');
        speedMarkers?.addEventListener('click', (e) => handleMarkerClick(e, playbackSpeedControl)); pitchMarkers?.addEventListener('click', (e) => handleMarkerClick(e, pitchControl)); formantMarkers?.addEventListener('click', (e) => handleMarkerClick(e, formantControl)); gainMarkers?.addEventListener('click', (e) => handleMarkerClick(e, gainControl));
        vadThresholdSlider?.addEventListener('input', handleVadSliderInput); vadNegativeThresholdSlider?.addEventListener('input', handleVadSliderInput);
        document.addEventListener('keydown', handleKeyDown);
    }

    /** Helper to set up slider listeners. @private */
    function setupSliderListeners(slider, valueDisplay, tooltip, eventName, detailKey) {
        // ... (Listener setup logic remains the same) ...
        if (!slider || !valueDisplay || !tooltip) return; const updateStaticDisplay = () => { const value = parseFloat(slider.value); valueDisplay.textContent = value.toFixed(2) + "x"; }; slider.addEventListener('input', () => { updateStaticDisplay(); updateTooltip(slider, tooltip); dispatchUIEvent(eventName, { [detailKey]: parseFloat(slider.value) }); }); const showTooltip = () => { if (slider.disabled) return; updateTooltip(slider, tooltip); tooltip.style.visibility = 'visible'; }; const hideTooltip = () => { tooltip.style.visibility = 'hidden'; }; slider.addEventListener('mousedown', showTooltip); slider.addEventListener('touchstart', showTooltip, { passive: true }); slider.addEventListener('mouseup', hideTooltip); slider.addEventListener('touchend', hideTooltip); slider.addEventListener('mouseleave', hideTooltip);
    }

     // --- Specific Event Handlers ---
    /** Handles keydown. @param {KeyboardEvent} e @private */
     function handleKeyDown(e) { /* ... (No changes) ... */ const target = e.target; const isTextInput = target.tagName === 'INPUT' && (target.type === 'text' || target.type === 'number' || target.type === 'search' || target.type === 'email' || target.type === 'password' || target.type === 'url'); const isTextArea = target.tagName === 'TEXTAREA'; if (isTextInput || isTextArea) return; let handled = false; let eventKey = null; switch (e.code) { case 'Space': eventKey = 'Space'; handled = true; break; case 'ArrowLeft': eventKey = 'ArrowLeft'; handled = true; break; case 'ArrowRight': eventKey = 'ArrowRight'; handled = true; break; } if (eventKey) dispatchUIEvent('audioapp:keyPressed', { key: eventKey }); if (handled) e.preventDefault(); }
    /** Handles VAD slider input. @param {Event} e @private */
    function handleVadSliderInput(e) { /* ... (No changes) ... */ const slider = /** @type {HTMLInputElement} */ (e.target); const value = parseFloat(slider.value); let type = null; if (slider === vadThresholdSlider && vadThresholdValueDisplay) { vadThresholdValueDisplay.textContent = value.toFixed(2); type = 'positive'; } else if (slider === vadNegativeThresholdSlider && vadNegativeThresholdValueDisplay) { vadNegativeThresholdValueDisplay.textContent = value.toFixed(2); type = 'negative'; } if (type) dispatchUIEvent('audioapp:thresholdChanged', { type: type, value: value }); }
    /** Handles marker clicks. @param {MouseEvent} event @param {HTMLInputElement | null} sliderElement @private */
    function handleMarkerClick(event, sliderElement) { /* ... (No changes) ... */ if (!sliderElement || sliderElement.disabled) return; const target = event.target; if (target.tagName === 'SPAN' && target.dataset.value) { const value = parseFloat(target.dataset.value); if (!isNaN(value)) { sliderElement.value = String(value); sliderElement.dispatchEvent(new Event('input', { bubbles: true })); } } }

    // --- Tooltip Update ---

    /**
     * Updates the position and text content of a slider's tooltip based on percentage.
     * @param {HTMLInputElement} slider - The slider element.
     * @param {HTMLSpanElement} tooltip - The tooltip element for this slider.
     * @private
     */
    function updateTooltip(slider, tooltip) {
        if (!slider || !tooltip) return;

        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        const val = parseFloat(slider.value);
        const range = max - min;

        // Calculate the percentage position of the value within the range
        const percent = range === 0 ? 0 : (val - min) / range;

        // Set the 'left' style directly as a percentage.
        // The CSS 'transform: translateX(-50%)' will center the tooltip.
        const leftPercent = percent * 100;

        tooltip.textContent = val.toFixed(2) + "x";
        tooltip.style.left = `${leftPercent}%`;
        // Visibility is handled by mouse/touch event listeners
    }


    // --- Helper to Dispatch Custom Events ---
    /** Dispatches event. @param {string} eventName @param {object} [detail={}] @private */
    function dispatchUIEvent(eventName, detail = {}) { /* ... (No changes) ... */ document.dispatchEvent(new CustomEvent(eventName, { detail: detail })); }

    // --- Public Methods for Updating UI ---
    /** Resets UI elements. @public */
    function resetUI() { /* ... (No changes needed here) ... */ console.log("UIManager: Resetting UI"); setFileInfo("No file selected."); setPlayButtonState(false); updateTimeDisplay(0, 0); setSpeechRegionsText("None"); updateVadDisplay(0.5, 0.35, true); if (playbackSpeedControl) playbackSpeedControl.value = "1.0"; if (speedValueDisplay) speedValueDisplay.textContent = "1.00x"; if (pitchControl) pitchControl.value = "1.0"; if (pitchValueDisplay) pitchValueDisplay.textContent = "1.00x"; if (formantControl) formantControl.value = "1.0"; if (formantValueDisplay) formantValueDisplay.textContent = "1.00x"; if (gainControl) gainControl.value = "1.0"; if (gainValueDisplay) gainValueDisplay.textContent = "1.00x"; if (jumpTimeInput) jumpTimeInput.value = "5"; [speedTooltip, pitchTooltip, formantTooltip, gainTooltip].forEach(tip => { if(tip) tip.style.visibility = 'hidden'; }); enablePlaybackControls(false); enableVadControls(false); }
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
