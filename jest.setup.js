// jest.setup.js
const fs = require('fs');
const path = require('path');
// const vm = require('vm'); // Not using vm for this approach

// --- 1. Mock Browser-Specific APIs ---
global.window = global; // JSDOM's global IS window. Make it explicit.

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
global.ort = { InferenceSession: { create: jest.fn(() => Promise.resolve({ run: jest.fn(() => Promise.resolve({ output: new global.ort.Tensor('float32', [0.5], [1])}) ) })) }, Tensor: jest.fn((type, data, dims) => ({ type, data, dims, ortType: type, input: true })), env: { wasm: {} } };

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

if (!global.__jestLoadedScriptsInJsdom) {
    global.__jestLoadedScriptsInJsdom = new Set();
}

const loadScriptViaJsdom = (scriptPathFromAppRoot) => {
  const absoluteScriptPath = path.join(appRoot, scriptPathFromAppRoot);

  if (global.__jestLoadedScriptsInJsdom.has(absoluteScriptPath)) {
    // console.log(`JSDOM script ${absoluteScriptPath} already loaded.`);
    return;
  }

  try {
    // console.log(`JSDOM loading script: ${absoluteScriptPath}`);
    const scriptCode = fs.readFileSync(absoluteScriptPath, 'utf-8');
    const scriptEl = global.document.createElement('script');
    scriptEl.textContent = scriptCode;
    global.document.body.appendChild(scriptEl); // JSDOM should execute this
    global.__jestLoadedScriptsInJsdom.add(absoluteScriptPath);
  } catch (e) {
    console.error(`Error JSDOM loading script ${scriptPathFromAppRoot}: ${e.message}`);
    // For critical scripts, re-throw to fail the setup early.
    if (scriptPathFromAppRoot.includes('constants.js') ||
        scriptPathFromAppRoot.includes('appState.js') ||
        scriptPathFromAppRoot.includes('app.js') ||
        scriptPathFromAppRoot.includes('utils.js') ||
        scriptPathFromAppRoot.includes('goertzel.js') ) {
        throw e;
    }
  }
};

const scriptsToLoad = [
  'js/state/constants.js',
  'js/state/appState.js',
  'js/utils.js',
  'js/goertzel.js',
  'js/app.js',
  'js/uiManager.js',
  'js/player/audioEngine.js',
  'js/vad/RemoteApiStrategy.js',
  'js/vad/sileroWrapper.js',
  'js/vad/sileroProcessor.js',
  'js/vad/LocalWorkerStrategy.js',
  'js/vad/vadAnalyzer.js',
  'js/visualizers/waveformVisualizer.js',
  'js/visualizers/spectrogramVisualizer.js',
  'js/sparkles.js'
];

console.log("Loading application scripts for Jest environment using JSDOM script execution...");
scriptsToLoad.forEach(scriptPath => {
    if (scriptPath === 'js/constants.js') { // old constants file, skip
        console.log("Skipping obsolete js/constants.js");
        return;
    }
    loadScriptViaJsdom(scriptPath);
});

console.log('All specified scripts processed for Jest environment.');

// Final checks to see if critical globals are defined.
if (typeof global.Constants === 'undefined') console.error("FINAL CHECK FAIL: global.Constants is undefined.");
if (typeof global.AppState === 'undefined') console.error("FINAL CHECK FAIL: global.AppState is undefined.");
if (!global.AudioApp || typeof global.AudioApp.Utils === 'undefined') console.error("FINAL CHECK FAIL: global.AudioApp.Utils is undefined.");
if (!global.AudioApp || typeof global.AudioApp.DTMFParser === 'undefined') console.error("FINAL CHECK FAIL: global.AudioApp.DTMFParser is undefined.");
if (!global.AudioApp || typeof global.AudioApp.state === 'undefined') console.error("FINAL CHECK FAIL: global.AudioApp.state is undefined.");
