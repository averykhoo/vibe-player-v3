// Import the Rubberband library
// Make sure rubberband.js and rubberband.wasm are in the same directory
// or adjust the path accordingly.
import RubberbandModuleLoader from './rubberband.js';

// --- DOM Elements ---
const fileInput = document.getElementById('audioFile');
const stretchRatioSlider = document.getElementById('stretchRatio');
const ratioValueSpan = document.getElementById('ratioValue');
const processButton = document.getElementById('processButton');
const playButton = document.getElementById('playButton');
const statusDiv = document.getElementById('status');
const processingControlsDiv = document.getElementById('processingControls');
const playbackControlsDiv = document.getElementById('playbackControls');

// --- Web Audio API ---
let audioContext;
try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
} catch (e) {
    updateStatus('Web Audio API is not supported in this browser.', true);
    throw new Error('Web Audio API not supported.');
}

// --- Application State ---
let originalAudioBuffer = null;
let processedAudioBuffer = null;
let rubberbandStretcher = null; // Pointer to the C++ RubberbandStretcher object
let currentAudioSource = null; // To stop playback if needed

// --- Constants ---
const RubberbandOptions = {
    ProcessOffline: 0,
    EngineDefault: 0x0000,
    FormantPreserved: 0x01000000, // Using the value from the example's enum
    // Add other options if needed
};

// --- Utility Functions ---
function updateStatus(message, isError = false) {
    console.log(`[Status] ${message}`);
    statusDiv.textContent = `Status: ${message}`;
    statusDiv.style.color = isError ? 'red' : 'black';
}

function disableUI(disabled) {
    fileInput.disabled = disabled;
    stretchRatioSlider.disabled = disabled;
    processButton.disabled = disabled;
    playButton.disabled = disabled;
}

// --- Rubberband Initialization ---
let Module; // To hold the initialized WASM module

async function initializeRubberband() {
    updateStatus('Loading Rubberband WASM module...');
    try {
        Module = await RubberbandModuleLoader({}); // Assuming wasm is next to js
        updateStatus('Rubberband module loaded.');
        console.log("Rubberband Module Initialized:", Module);
    } catch (error) {
        updateStatus('Failed to load Rubberband WASM module. Check console.', true);
        console.error("Rubberband loading error:", error);
        disableUI(true);
    }
}

// --- Event Listeners ---
stretchRatioSlider.addEventListener('input', (event) => {
    const ratio = parseFloat(event.target.value);
    ratioValueSpan.textContent = `${ratio.toFixed(2)}x`;
});

fileInput.addEventListener('change', handleFileSelect);
processButton.addEventListener('click', processAudio);
playButton.addEventListener('click', playProcessedAudio);

// --- Core Logic ---

async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    updateStatus(`Loading file: ${file.name}...`);
    processingControlsDiv.style.display = 'none';
    playbackControlsDiv.style.display = 'none';
    originalAudioBuffer = null;
    processedAudioBuffer = null;
    disableUI(true);

    const reader = new FileReader();

    reader.onload = async (e) => {
        try {
            updateStatus('Decoding audio data...');
            originalAudioBuffer = await audioContext.decodeAudioData(e.target.result);
            updateStatus(`File loaded and decoded. Sample Rate: ${originalAudioBuffer.sampleRate} Hz, Channels: ${originalAudioBuffer.numberOfChannels}, Duration: ${originalAudioBuffer.duration.toFixed(2)}s`);
            processingControlsDiv.style.display = 'block';
            disableUI(false);
            playButton.disabled = true;
        } catch (error) {
            updateStatus(`Error decoding audio file: ${error.message}`, true);
            console.error('Decode Audio Error:', error);
            disableUI(false);
            fileInput.value = '';
        }
    };

    reader.onerror = (e) => {
        updateStatus(`Error reading file: ${e.target.error}`, true);
        disableUI(false);
        fileInput.value = '';
    };

    reader.readAsArrayBuffer(file);
}


async function processAudio() {
    if (!originalAudioBuffer || !Module) {
        updateStatus('Load an audio file and wait for Rubberband module first.', true);
        return;
    }
    if (currentAudioSource) {
        try { currentAudioSource.stop(); } catch(e) {/*ignore*/}
        currentAudioSource = null;
    }

    const sampleRate = originalAudioBuffer.sampleRate;
    const channels = originalAudioBuffer.numberOfChannels;
    // This is the playback speed factor from the slider (e.g., 0.25, 1.0, 2.0)
    const timeRatio = parseFloat(stretchRatioSlider.value);
    const pitchScale = 1.0;

    console.log(`\n--- Starting Process Audio (Two-Pass Method / Inverse Ratio) ---`);
    console.log(`Sample Rate: ${sampleRate}, Channels: ${channels}`);
    console.log(`Input Duration: ${originalAudioBuffer.duration.toFixed(3)}s (${originalAudioBuffer.length} frames)`);
    console.log(`Target Playback Speed (from slider): ${timeRatio}`); // Log the slider value
    console.log(`Target Pitch Scale: ${pitchScale}`);

    updateStatus(`Processing... Target Speed: ${timeRatio.toFixed(2)}x`);
    disableUI(true);
    playbackControlsDiv.style.display = 'none';
    processedAudioBuffer = null;

    let inputPtrs = 0;
    let outputPtrs = 0;
    const inputChannelBuffers = [];
    const outputChannelBuffers = [];
    const outputData = Array.from({ length: channels }, () => []);

    try {
        // 1. Create RubberbandStretcher instance
        const options = RubberbandOptions.ProcessOffline | RubberbandOptions.EngineDefault | RubberbandOptions.FormantPreserved;
        console.log(`Using Rubberband Options: ${options}`);

        rubberbandStretcher = Module._rubberband_new(sampleRate, channels, options, 1.0, 1.0); // Use default ratios initially
        if (!rubberbandStretcher) throw new Error("Failed to create Rubberband stretcher instance.");
        console.log(`Rubberband Stretcher Pointer: ${rubberbandStretcher}`);

        // *** THE FIX: Calculate and pass the INVERSE ratio ***
        // If slider is 0.25 (slow down), stretchRatio should be 1/0.25 = 4.0
        // If slider is 2.0 (speed up), stretchRatio should be 1/2.0 = 0.5
        const stretchRatio = 1.0 / timeRatio;
        console.log(`Calculated Stretch Ratio (1 / target speed): ${stretchRatio}`);
        Module._rubberband_set_time_ratio(rubberbandStretcher, stretchRatio); // Pass the inverse
        Module._rubberband_set_pitch_scale(rubberbandStretcher, pitchScale);

        // Check internal state - expect get_time_ratio to now report the stretchRatio (e.g., 4.0)
        const actualTimeRatio = Module._rubberband_get_time_ratio(rubberbandStretcher);
        const latency = Module._rubberband_get_latency(rubberbandStretcher);
        console.log(`Internal Time Ratio (get_time_ratio - should be stretch factor): ${actualTimeRatio}, Latency: ${latency} frames`);

        if (Math.abs(actualTimeRatio - stretchRatio) > 0.001) {
             console.warn(`WARNING: Rubberband internal time ratio (${actualTimeRatio}) does not precisely match calculated stretch ratio (${stretchRatio}) after setting!`);
        }

        // 2. Define block size
        const blockSize = 1024;

        // 3. Allocate memory
        inputPtrs = Module._malloc(channels * 4);
        outputPtrs = Module._malloc(channels * 4);
        if (!inputPtrs || !outputPtrs) throw new Error("Failed to allocate pointer arrays.");

        for (let i = 0; i < channels; ++i) {
            const inputBuf = Module._malloc(blockSize * 4);
            const outputBuf = Module._malloc(blockSize * 4);
            if (!inputBuf || !outputBuf) throw new Error(`Failed to allocate channel buffer ${i}.`);
            inputChannelBuffers.push(inputBuf);
            outputChannelBuffers.push(outputBuf);
            Module.HEAPU32[inputPtrs / 4 + i] = inputBuf;
            Module.HEAPU32[outputPtrs / 4 + i] = outputBuf;
        }
        console.log(`Allocated ${channels} input/output buffers of size ${blockSize * 4} bytes each.`);

        Module._rubberband_set_expected_input_duration(rubberbandStretcher, originalAudioBuffer.length);
        console.log(`Set expected input duration: ${originalAudioBuffer.length}`);

        // ===============================================================
        // == PASS 1: STUDY ==
        // ===============================================================
        console.log(`--- Starting Study Pass ---`);
        let studyInputFramesRemaining = originalAudioBuffer.length;
        let studyInputFrameOffset = 0;
        let studyBlockCount = 0;

        while (studyInputFramesRemaining > 0) {
            studyBlockCount++;
            const framesToStudy = Math.min(blockSize, studyInputFramesRemaining);
            const isFinalStudyBlock = (framesToStudy === studyInputFramesRemaining);

            for (let i = 0; i < channels; ++i) {
                const channelData = originalAudioBuffer.getChannelData(i);
                const inputSlice = channelData.subarray(studyInputFrameOffset, studyInputFrameOffset + framesToStudy);
                Module.HEAPF32.set(inputSlice, inputChannelBuffers[i] / 4);
                if (framesToStudy < blockSize) {
                    Module.HEAPF32.fill(0.0, (inputChannelBuffers[i] / 4) + framesToStudy, (inputChannelBuffers[i] / 4) + blockSize);
                }
            }
            Module._rubberband_study(rubberbandStretcher, inputPtrs, framesToStudy, isFinalStudyBlock ? 1 : 0);
            studyInputFramesRemaining -= framesToStudy;
            studyInputFrameOffset += framesToStudy;
             if (studyBlockCount > (originalAudioBuffer.length / blockSize) + 10) throw new Error("Study loop runaway.");
        }
        console.log(`--- Finished Study Pass (${studyBlockCount} blocks) ---`);

        // ===============================================================
        // == PASS 2: PROCESS & RETRIEVE ==
        // ===============================================================
        console.log(`--- Starting Process Pass ---`);
        let processInputFramesRemaining = originalAudioBuffer.length;
        let processInputFrameOffset = 0;
        let totalOutputFramesCollected = 0;
        let finalProcessBlockSignaled = false;
        let processBlockCount = 0;

        while (processInputFramesRemaining > 0 || !finalProcessBlockSignaled) {
            processBlockCount++;
            const framesToProcess = Math.min(blockSize, processInputFramesRemaining);
            const isFinalProcessCall = (framesToProcess > 0 && framesToProcess === processInputFramesRemaining);

            if (framesToProcess > 0) {
                for (let i = 0; i < channels; ++i) {
                    const channelData = originalAudioBuffer.getChannelData(i);
                    const inputSlice = channelData.subarray(processInputFrameOffset, processInputFrameOffset + framesToProcess);
                    Module.HEAPF32.set(inputSlice, inputChannelBuffers[i] / 4);
                    if (framesToProcess < blockSize) {
                        Module.HEAPF32.fill(0.0, (inputChannelBuffers[i] / 4) + framesToProcess, (inputChannelBuffers[i] / 4) + blockSize);
                    }
                }
                processInputFramesRemaining -= framesToProcess;
                processInputFrameOffset += framesToProcess;
            } else if (!finalProcessBlockSignaled) {
                 // console.log(`Process Block ${processBlockCount}: Input exhausted, performing final flush call (0 frames).`);
            }

            let finalFlagToSend = isFinalProcessCall || (framesToProcess === 0 && !finalProcessBlockSignaled);
            Module._rubberband_process(rubberbandStretcher, inputPtrs, framesToProcess, finalFlagToSend ? 1 : 0);

            if (finalFlagToSend) {
                finalProcessBlockSignaled = true;
                // console.log(`Process Block ${processBlockCount}: Final signal sent.`);
            }

            // --- Retrieve ALL available processed data ---
            let available = 0;
            let retrievedInBlockTotal = 0;
            do {
                available = Module._rubberband_available(rubberbandStretcher);
                if (available > 0) {
                    const framesToRetrieve = Math.min(available, blockSize);
                    const retrieved = Module._rubberband_retrieve(rubberbandStretcher, outputPtrs, framesToRetrieve);
                    if (retrieved > 0) {
                        retrievedInBlockTotal += retrieved;
                        for (let i = 0; i < channels; ++i) {
                            const outputView = Module.HEAPF32.subarray(outputChannelBuffers[i] / 4, outputChannelBuffers[i] / 4 + retrieved);
                            outputData[i].push(outputView.slice());
                        }
                    } else if (available > 0) {
                         console.warn(`Process Block ${processBlockCount}: Available was ${available} but retrieved 0 frames!`);
                         available = 0;
                    }
                }
            } while (available > 0);

            // if (retrievedInBlockTotal > 0) { console.log(`Process Block ${processBlockCount}: Retrieved ${retrievedInBlockTotal} frames.`); }
            totalOutputFramesCollected += retrievedInBlockTotal;

            // --- Process Loop Exit Condition ---
            if (finalProcessBlockSignaled && available <= 0 && retrievedInBlockTotal === 0) {
                // console.log(`Process Block ${processBlockCount+1}: Final block signaled and no more output. Exiting.`);
                break;
            }

             if (processBlockCount > (originalAudioBuffer.length / blockSize) * 3 + 50) {
                throw new Error("Process loop runaway (safety break).");
             }
        } // End while loop for process pass
        console.log(`--- Finished Process Pass (${processBlockCount} blocks) ---`);

        // ===============================================================
        // == POST-PROCESSING ==
        // ===============================================================

        const outputLength = outputData[0].reduce((sum, chunk) => sum + chunk.length, 0);
        console.log(`Total Input Frames: ${originalAudioBuffer.length}`);
        console.log(`Total Output Frames Collected: ${outputLength}`);
        // *** Expected length uses the actual STRETCH ratio reported by the getter ***
        const expectedOutputLength = Math.round(originalAudioBuffer.length * actualTimeRatio); // Input * StretchRatio
        console.log(`Approx. Expected Output Frames (Input * Actual Stretch Ratio ${actualTimeRatio}): ${expectedOutputLength}`);

        if (outputLength === 0 && originalAudioBuffer.length > 0) {
            throw new Error("Processing resulted in zero output samples for non-empty input.");
        }
        const deviation = Math.abs(outputLength - expectedOutputLength);
        const tolerance = Math.max(blockSize * 2 + latency, expectedOutputLength * 0.1);
        if (originalAudioBuffer.length > 0 && deviation > tolerance) {
             console.warn(`WARNING: Output length (${outputLength}) differs significantly from expected (${expectedOutputLength}) by ${deviation} frames (tolerance ${tolerance.toFixed(0)}).`);
        } else if (originalAudioBuffer.length > 0) {
             console.log(`Output length (${outputLength}) is within tolerance (${tolerance.toFixed(0)}) of expected (${expectedOutputLength}).`);
        }

        if (outputLength > 0) {
            processedAudioBuffer = audioContext.createBuffer(channels, outputLength, sampleRate);
            for (let i = 0; i < channels; ++i) {
                const targetChannel = processedAudioBuffer.getChannelData(i);
                let offset = 0;
                for (const chunk of outputData[i]) {
                    if (chunk.length > 0) {
                        targetChannel.set(chunk, offset);
                        offset += chunk.length;
                    }
                }
                 if (offset !== outputLength) console.error(`Error constructing buffer: Ch ${i} offset (${offset}) != outputLength (${outputLength}).`);
            }
            console.log(`Created processed AudioBuffer. Length: ${processedAudioBuffer.length}, Duration: ${processedAudioBuffer.duration.toFixed(3)}s`);
            updateStatus(`Processing complete! Output duration: ${processedAudioBuffer.duration.toFixed(2)}s`);
            playbackControlsDiv.style.display = 'block';
            playButton.disabled = false;
        } else {
            updateStatus('Processing complete, but resulted in zero output length.', originalAudioBuffer.length > 0);
            playbackControlsDiv.style.display = 'none';
        }

    } catch (error) {
        updateStatus(`Error during processing: ${error.message}`, true);
        console.error("Processing Error:", error);
        processedAudioBuffer = null;
        playbackControlsDiv.style.display = 'none';
    } finally {
        console.log(`--- Starting WASM Cleanup ---`);
        if (Module && rubberbandStretcher) {
             try { Module._rubberband_delete(rubberbandStretcher); console.log(`Deleted Rubberband instance.`); }
             catch (e) { console.error(`Error deleting instance: ${e}`); }
             rubberbandStretcher = 0;
        }
        if (Module) {
             inputChannelBuffers.forEach((ptr) => { if (ptr) { try { Module._free(ptr); } catch (e) { console.error(`Free input err: ${e}`);} }});
             outputChannelBuffers.forEach((ptr) => { if (ptr) { try { Module._free(ptr); } catch (e) { console.error(`Free output err: ${e}`);} }});
             if (inputPtrs) { try { Module._free(inputPtrs); } catch (e) { console.error(`Free inputPtrs err: ${e}`);} inputPtrs = 0; }
             if (outputPtrs) { try { Module._free(outputPtrs); } catch (e) { console.error(`Free outputPtrs err: ${e}`);} outputPtrs = 0; }
             console.log("Freed WASM memory buffers and pointers.");
        }
        inputChannelBuffers.length = 0;
        outputChannelBuffers.length = 0;

        disableUI(false);
        if (!processedAudioBuffer) { playButton.disabled = true; }
        console.log(`--- WASM Cleanup Complete ---`);
    }
}


function playProcessedAudio() {
    if (!processedAudioBuffer || !audioContext) {
        updateStatus('No processed audio available to play.', true);
        return;
    }
    if (currentAudioSource) {
        try { currentAudioSource.stop(); currentAudioSource.disconnect(); console.log("Stopped previous playback."); }
        catch (e) { console.warn("Could not stop previous source:", e); }
        currentAudioSource = null;
    }

    currentAudioSource = audioContext.createBufferSource();
    currentAudioSource.buffer = processedAudioBuffer;
    currentAudioSource.connect(audioContext.destination);

    currentAudioSource.onended = () => {
        updateStatus('Playback finished.');
        playButton.textContent = 'Play Processed Audio';
        if (currentAudioSource) { currentAudioSource.disconnect(); currentAudioSource = null; }
        console.log("Playback ended.");
    };

    updateStatus('Playing processed audio...');
    console.log(`Starting playback of buffer with duration: ${processedAudioBuffer.duration.toFixed(3)}s`);
    currentAudioSource.start(0);
}

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    initializeRubberband();
    ratioValueSpan.textContent = `${parseFloat(stretchRatioSlider.value).toFixed(2)}x`;
});
