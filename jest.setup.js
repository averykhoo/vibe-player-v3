// jest.setup.js
const fs = require('fs');
const path = require('path');
// const vm = require('vm'); // vm not used for this strategy

// --- 1. Mock Browser-Specific APIs ---
global.window = global; // JSDOM's global IS window. Make it explicit.
global.self = global;   // Common alias for window or worker global scope
global.document = global.document; // JSDOM provides document

// Mocks (ensure these are comprehensive enough for the scripts being loaded)
global.AudioContext = jest.fn(() => ({
  createGain: jest.fn(() => ({ connect: jest.fn(), gain: { value: 1, setTargetAtTime: jest.fn() } })),
  decodeAudioData: jest.fn((buffer, successCb, errorCb) => {
    if (typeof successCb === 'function') {
      successCb({ duration: 10, numberOfChannels: 1, sampleRate: 44100, getChannelData: () => new Float32Array(10) });
    }
    return Promise.resolve({ duration: 10, numberOfChannels: 1, sampleRate: 44100, getChannelData: () => new Float32Array(10) });
  }),
  audioWorklet: {
    addModule: jest.fn(() => Promise.resolve())
  },
  resume: jest.fn(() => Promise.resolve()),
  currentTime: 0,
  state: 'running',
  destination: {},
  createBufferSource: jest.fn(() => ({ buffer: null, connect: jest.fn(), start: jest.fn(), stop: jest.fn(), loop: false, onended: null })),
  createOscillator: jest.fn(() => ({ type: 'sine', frequency: { value: 440, setValueAtTime: jest.fn() }, connect: jest.fn(), start: jest.fn(), stop: jest.fn(), onended: null })),
}));
global.AudioWorkletNode = jest.fn().mockImplementation(() => ({ connect: jest.fn(), disconnect: jest.fn(), port: { postMessage: jest.fn(), onmessage: null }, onprocessorerror: null }));
global.Worker = jest.fn().mockImplementation(function(stringUrl) { this.postMessage = jest.fn(); this.terminate = jest.fn(); this.onmessage = null; this.onerror = null; });

// Mock for ONNX Runtime, crucial for sileroWrapper.js
if (typeof global.ort === 'undefined') {
    global.ort = {
        InferenceSession: {
            create: jest.fn(() => Promise.resolve({
                run: jest.fn(() => Promise.resolve({
                    // Ensure the 'output' tensor matches what sileroWrapper expects
                    output: new global.ort.Tensor('float32', [0.5], [1])
                }))
            }))
        },
        Tensor: jest.fn((type, data, dims) => ({ type, data, dims, ortType: type, input: true })),
        env: {wasm: {}} // For setting wasmPaths
    };
}

// Load FFT script into the global context using JSDOM's script execution
try {
    const fftScriptContent = fs.readFileSync(path.resolve(__dirname, 'vibe-player/lib/fft.js'), 'utf-8');
    const scriptEl = global.document.createElement('script');
    scriptEl.textContent = fftScriptContent;
    global.document.body.appendChild(scriptEl);
    // console.log('FFT script loaded via JSDOM script tag.');
} catch (e) {
    console.error("Failed to load lib/fft.js via JSDOM:", e.message);
}


// --- 2. Load Application Scripts in Order ---
const appRoot = path.resolve(__dirname, 'vibe-player');
global.AudioApp = global.AudioApp || {};
global.__jestLoadedScripts = global.__jestLoadedScripts || new Set(); // To prevent re-execution

const loadScriptInJsdom = (scriptPathFromAppRoot, isCritical = false) => {
  const absoluteScriptPath = path.join(appRoot, scriptPathFromAppRoot);
  if (global.__jestLoadedScripts.has(absoluteScriptPath)) {
    return;
  }
  try {
    const scriptCode = fs.readFileSync(absoluteScriptPath, 'utf-8');
    const scriptEl = global.document.createElement('script');
    scriptEl.textContent = scriptCode;
    global.document.body.appendChild(scriptEl); // JSDOM executes this
    global.__jestLoadedScripts.add(absoluteScriptPath);
  } catch (e) {
    console.error(`Error JSDOM loading script ${absoluteScriptPath}: ${e.message}`);
    if (isCritical) throw e;
  }
};

// List all scripts in a sensible dependency order
const orderedScripts = [
  { path: 'js/state/constants.js', critical: true },
  { path: 'js/state/appState.js', critical: true },
  { path: 'js/utils.js', critical: true },
  { path: 'js/goertzel.js', critical: true }, // Defines AudioApp.DTMFParser
  { path: 'js/app.js', critical: true },      // Instantiates AppState, defines AudioApp.state
  { path: 'js/uiManager.js', critical: false },
  { path: 'js/player/audioEngine.js', critical: false },
  { path: 'js/vad/RemoteApiStrategy.js', critical: false },
  { path: 'js/vad/sileroWrapper.js', critical: false }, // Uses self.ort
  { path: 'js/vad/sileroProcessor.js', critical: false }, // Uses Constants, Utils, AudioApp.sileroWrapper
  { path: 'js/vad/LocalWorkerStrategy.js', critical: false }, // Uses Constants
  { path: 'js/vad/vadAnalyzer.js', critical: false },
  { path: 'js/visualizers/waveformVisualizer.js', critical: false },
  { path: 'js/visualizers/spectrogramVisualizer.js', critical: false }, // Uses window.FFT
  { path: 'js/sparkles.js', critical: false } // Uses window, document
];

console.log("Loading application scripts for Jest environment using JSDOM script execution...");
orderedScripts.forEach(scriptInfo => {
  if (scriptInfo.path === 'js/constants.js') { // Skip old constants file if it was in a broader list
      console.log("Skipping obsolete js/constants.js");
      return;
  }
  loadScriptInJsdom(scriptInfo.path, scriptInfo.critical);
});

console.log('All specified scripts processed for Jest environment.');

// Optional: Final checks after all scripts are loaded
// These checks help confirm if the global variables are set as expected.
// if (typeof global.Constants === 'undefined') console.error('FINAL CHECK: global.Constants is undefined');
// if (typeof global.AppState === 'undefined') console.error('FINAL CHECK: global.AppState is undefined');
// if (!global.AudioApp || !global.AudioApp.Utils) console.error('FINAL CHECK: global.AudioApp.Utils is undefined');
// if (!global.AudioApp || !global.AudioApp.DTMFParser) console.error('FINAL CHECK: global.AudioApp.DTMFParser is undefined');
// if (!global.AudioApp || !global.AudioApp.state) console.error('FINAL CHECK: global.AudioApp.state is undefined');
