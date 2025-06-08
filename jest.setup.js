// jest.setup.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// --- 1. Mock Browser-Specific APIs ---
// JSDOM (Jest's default environment) provides `window`, `document`, `navigator`.
// `global` in this context IS the JSDOM window. Explicitly alias for clarity/scripts expecting `window`.
global.window = global;

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
  createBufferSource: jest.fn(() => ({
    buffer: null,
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    loop: false,
    onended: null,
  })),
  createOscillator: jest.fn(() => ({
    type: 'sine',
    frequency: { value: 440, setValueAtTime: jest.fn() },
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    onended: null,
  })),
}));
global.AudioWorkletNode = jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    port: {
        postMessage: jest.fn(),
        onmessage: null,
    },
    onprocessorerror: null,
}));

global.Worker = jest.fn().mockImplementation(function(stringUrl) {
  this.postMessage = jest.fn();
  this.terminate = jest.fn();
  this.onmessage = null;
  this.onerror = null;
  if (stringUrl && stringUrl.includes('blob:')) {
    setTimeout(() => {
      if (typeof this.onmessage === 'function') {
        // this.onmessage({ data: { type: 'model_ready' } });
      }
    }, 0);
  }
});

global.ort = {
  InferenceSession: { create: jest.fn(() => Promise.resolve({ run: jest.fn(() => Promise.resolve({ output: new global.ort.Tensor('float32', [0.5], [1])}) ) })) },
  Tensor: jest.fn((type, data, dims) => ({ type, data, dims, ortType: type, input: true })),
  env: { wasm: {} }
};

// Load FFT script into the global context.
try {
    const fftScriptContent = fs.readFileSync(path.resolve(__dirname, 'vibe-player/lib/fft.js'), 'utf-8');
    new vm.Script(fftScriptContent, { filename: 'lib/fft.js' }).runInThisContext();
} catch (e) {
    console.error("Failed to load lib/fft.js:", e.message);
}

// --- 2. Load Application Scripts in Order ---
const appRoot = path.resolve(__dirname, 'vibe-player');

// Ensure AudioApp namespace exists globally
global.AudioApp = global.AudioApp || {};

// Use a global marker object to ensure each script's code is executed only once
// across all test suites if Jest re-runs jest.setup.js in a shared global scope.
if (!global.__jestScriptsLoaded) {
    global.__jestScriptsLoaded = {};
}

const loadScript = (scriptPathFromAppRoot, isCritical = false) => {
  const absoluteScriptPath = path.join(appRoot, scriptPathFromAppRoot);
  const scriptNameKey = scriptPathFromAppRoot.replace(/\//g, '_'); // Create a unique key

  if (global.__jestScriptsLoaded[scriptNameKey]) {
    // console.log(`Script ${scriptPathFromAppRoot} already executed in this global context.`);
    return;
  }

  try {
    // console.log(`Loading script: ${scriptPathFromAppRoot}`);
    const scriptCode = fs.readFileSync(absoluteScriptPath, 'utf-8');
    new vm.Script(scriptCode, { filename: scriptPathFromAppRoot }).runInThisContext();
    global.__jestScriptsLoaded[scriptNameKey] = true;
  } catch (e) {
    console.error(`Error loading script ${scriptPathFromAppRoot}: ${e.message}`);
    if (isCritical) {
        // For critical scripts, re-throw to fail the setup early.
        throw e;
    }
    // For non-critical scripts, log and continue if desired, or throw as well.
    // throw e;
  }
};

// Defined load order based on dependencies
const orderedScripts = [
  { path: 'js/state/constants.js', critical: true },    // Defines global Constants
  { path: 'js/state/appState.js', critical: true },     // Defines global AppState, uses Constants
  { path: 'js/utils.js', critical: true },              // Attaches AudioApp.Utils
  { path: 'js/goertzel.js', critical: true },           // Attaches AudioApp.DTMFParser etc.
  { path: 'js/app.js', critical: true },                // Instantiates AppState, needs AudioApp, Constants, AppState

  { path: 'js/uiManager.js', critical: false },          // Needs AudioApp, Constants, AppState
  { path: 'js/player/audioEngine.js', critical: false }, // Needs AudioApp, Constants

  { path: 'js/vad/RemoteApiStrategy.js', critical: false },
  { path: 'js/vad/sileroWrapper.js', critical: false },      // Uses self.ort (global.ort in JSDOM)
  { path: 'js/vad/sileroProcessor.js', critical: false },  // Uses Constants, Utils, AudioApp.sileroWrapper
  { path: 'js/vad/LocalWorkerStrategy.js', critical: false },// Uses Constants (in worker string)
  { path: 'js/vad/vadAnalyzer.js', critical: false },      // Uses the strategies

  { path: 'js/visualizers/waveformVisualizer.js', critical: false },   // Uses AudioApp, Constants
  { path: 'js/visualizers/spectrogramVisualizer.js', critical: false },// Uses AudioApp, Constants, window.FFT

  { path: 'js/sparkles.js', critical: false } // Uses window, document
];

console.log("Loading application scripts for Jest environment...");
orderedScripts.forEach(scriptInfo => {
    // Skip old constants file if it's somehow in a list (it shouldn't be here)
    if (scriptInfo.path === 'js/constants.js') {
        console.log("Skipping obsolete js/constants.js");
        return;
    }
    loadScript(scriptInfo.path, scriptInfo.critical);
});

console.log('All specified scripts processed for Jest environment.');
// global.AudioApp, global.Constants, global.AppState should be available to tests.
// `window` in JSDOM is `global`, so `window.Constants` etc., should also work.
