// jest.setup.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// --- 1. Mock Browser-Specific APIs ---
global.window = global; // JSDOM's global IS window. Make it explicit.
global.self = global;   // Common alias for window or worker global scope
global.document = global.document; // JSDOM provides document

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
    new vm.Script(fftScriptContent, { filename: 'lib/fft.js' }).runInThisContext();
} catch (e) { console.error("Failed to load lib/fft.js:", e.message); }


// --- 2. Load Application Scripts in Order ---
const appRoot = path.resolve(__dirname, 'vibe-player');
global.AudioApp = global.AudioApp || {};
global.__jestLoadedScripts = global.__jestLoadedScripts || new Set(); // Prevent re-runs

const loadAndExposeScript = (scriptPathFromAppRoot, details) => {
  const absoluteScriptPath = path.join(appRoot, scriptPathFromAppRoot);

  if (global.__jestLoadedScripts.has(absoluteScriptPath)) {
    // console.log(`Script ${scriptPathFromAppRoot} already loaded.`);
    return;
  }

  // For classes, check if the global variable already exists.
  // This helps prevent "Identifier 'ClassName' has already been declared".
  if (details.type === 'class' && typeof global[details.name] !== 'undefined') {
    // console.log(`Global class ${details.name} already defined. Assuming ${scriptPathFromAppRoot} was loaded.`);
    global.__jestLoadedScripts.add(absoluteScriptPath); // Mark as loaded to prevent re-reading
    return;
  }

  try {
    const scriptCode = fs.readFileSync(absoluteScriptPath, 'utf-8');
    let codeToRun = scriptCode;

    if (details.type === 'class') {
      // Assuming the class is the main export, append a line to assign it to global if not already.
      // This is a bit of a hack due to vm.runInThisContext not always making classes global as expected.
      // A better way is if the script itself ensures global.ClassName = ClassName;
      // For now, we hope runInThisContext defines it globally.
      // The check will happen after execution.
    } else if (details.type === 'namespace') {
      // Scripts that attach to AudioApp (which is global.AudioApp) should just work.
    }

    new vm.Script(codeToRun, { filename: absoluteScriptPath }).runInThisContext();
    global.__jestLoadedScripts.add(absoluteScriptPath);

    // Post-execution checks
    if (details.type === 'class') {
      if (typeof global[details.name] === 'undefined') {
        console.error(`CRITICAL ERROR (post-exec): global.${details.name} is undefined after loading ${scriptPathFromAppRoot}`);
        if(details.critical) throw new Error(`global.${details.name} not defined by ${scriptPathFromAppRoot}`);
      } else {
        // console.log(`Successfully loaded class ${details.name} from ${scriptPathFromAppRoot}`);
      }
    } else if (details.type === 'namespace') {
      const nameParts = details.name.split('.'); // e.g., "Utils" or "state" for AudioApp.state
      let obj = global.AudioApp;
      let partDefined = true;
      for (const part of nameParts) {
        if (typeof obj[part] === 'undefined') {
          partDefined = false;
          break;
        }
        obj = obj[part];
      }
      if (!partDefined) {
        console.error(`CRITICAL ERROR (post-exec): global.AudioApp.${details.name} is undefined after loading ${scriptPathFromAppRoot}`);
        if(details.critical) throw new Error(`global.AudioApp.${details.name} not defined by ${scriptPathFromAppRoot}`);
      } else {
         // console.log(`Successfully loaded namespace AudioApp.${details.name} from ${scriptPathFromAppRoot}`);
      }
    }
  } catch (e) {
    console.error(`Error loading script ${scriptPathFromAppRoot} (${details.name}): ${e.message}`);
    if (details.critical) throw e;
  }
};

const orderedScriptsAndDetails = [
  { path: 'js/state/constants.js', type: 'class', name: 'Constants', critical: true },
  { path: 'js/state/appState.js', type: 'class', name: 'AppState', critical: true },
  { path: 'js/utils.js', type: 'namespace', name: 'Utils', critical: true },
  { path: 'js/goertzel.js', type: 'namespace', name: 'DTMFParser', critical: true }, // Also defines GoertzelFilter, CPT_CONSTANTS on AudioApp
  { path: 'js/app.js', type: 'namespace', name: 'state', critical: true } // Checks AudioApp.state which app.js defines
];

console.log("Loading CRITICAL application scripts for Jest environment...");
orderedScriptsAndDetails.forEach(scriptInfo => {
    loadAndExposeScript(scriptInfo.path, scriptInfo);
});

// Do NOT load other scripts like UI, VAD, visualizers for this focused test.

console.log('Minimal critical scripts processed for Jest environment.');

// Final overall checks
if (typeof global.Constants === 'undefined') console.error("FINAL OVERALL CHECK FAIL: global.Constants is undefined.");
if (typeof global.AppState === 'undefined') console.error("FINAL OVERALL CHECK FAIL: global.AppState is undefined.");
if (!global.AudioApp || typeof global.AudioApp.Utils === 'undefined') console.error("FINAL OVERALL CHECK FAIL: global.AudioApp.Utils is undefined.");
if (!global.AudioApp || typeof global.AudioApp.DTMFParser === 'undefined') console.error("FINAL OVERALL CHECK FAIL: global.AudioApp.DTMFParser is undefined.");
if (!global.AudioApp || typeof global.AudioApp.state === 'undefined') console.error("FINAL OVERALL CHECK FAIL: global.AudioApp.state is undefined.");
