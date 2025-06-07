// jest.setup.js
const fs = require('fs');
const path = require('path');
const { Script } = require('vm');

// --- 1. Mock Browser-Specific APIs ---
global.AudioContext = jest.fn(() => ({
  createGain: jest.fn(() => ({ connect: jest.fn(), gain: { value: 1, setTargetAtTime: jest.fn() } })),
  decodeAudioData: jest.fn((buffer, successCb) => successCb({ duration: 10 })),
  audioWorklet: { addModule: jest.fn(() => Promise.resolve()) },
  resume: jest.fn(() => Promise.resolve()),
  currentTime: 0,
  state: 'running',
  destination: {},
}));
global.AudioWorkletNode = jest.fn();

global.ort = {
  InferenceSession: { create: jest.fn(() => Promise.resolve({ run: jest.fn(() => Promise.resolve({})) })) },
  Tensor: jest.fn(),
};

const fftScript = fs.readFileSync(path.resolve(__dirname, 'vibe-player/lib/fft.js'), 'utf-8');
new Script(fftScript).runInThisContext();

// --- 2. Load Application Scripts in Order ---
const appRoot = path.resolve(__dirname, 'vibe-player');
const indexHtml = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf-8');

const scriptRegex = /<script src="(.+?)"><\/script>/g; // g flag is important
const scriptsToLoad = [];
const lines = indexHtml.split('\n');

for (const line of lines) {
  // Skip lines that are clearly HTML comments to avoid picking up commented-out scripts.
  // This is a heuristic and might not cover all edge cases of HTML commenting.
  if (line.trim().startsWith('<!--') && line.trim().endsWith('-->')) {
      if (line.includes("<script src=")) {
          console.log(`Skipping commented-out script line: ${line.trim()}`);
          continue;
      }
  }

  let match;
  // Important: Reset lastIndex before each exec in a loop if regex is global (has 'g' flag)
  // However, since we are creating a new regex effectively per line or should be careful,
  // it's better to apply regex per line if possible or manage lastIndex carefully.
  // For this loop structure, applying regex to each line individually is safer.
  // Let's re-evaluate the regex application. The original while loop was fine if indexHtml was the target.
  // Sticking to iterating lines:
  scriptRegex.lastIndex = 0; // Reset for current line processing
  while ((match = scriptRegex.exec(line)) !== null) {
    if (match[1] && match[1].startsWith('js/')) {
      if (!scriptsToLoad.includes(match[1])) { // Avoid duplicates
        scriptsToLoad.push(match[1]);
      }
    }
  }
}
// Log the scripts that will be loaded
console.log("Scripts to load for Jest:", scriptsToLoad);

console.log('Is window defined before loading app scripts?', typeof window);

// Create a single, shared context for all application scripts
const sharedContext = {
  ...global, // Includes window, document, etc. from JSDOM's global
  AudioApp: {}, // Initialize AudioApp namespace
  console: console, // Forward console
};
// Make AudioApp available on the window object within the shared context,
// as some scripts might expect to find it via window.AudioApp
if (sharedContext.window) { // window might not exist if JSDOM didn't set it up
  sharedContext.window.AudioApp = sharedContext.AudioApp;
}


console.log('Loading application scripts for Jest environment...');
scriptsToLoad.forEach(scriptPath => {
  const fullPath = path.join(appRoot, scriptPath);
  const scriptContent = fs.readFileSync(fullPath, 'utf-8');
  console.log(`Loading ${scriptPath}... Is window defined in sharedContext?`, typeof sharedContext.window);
  const script = new Script(scriptContent);
  script.runInNewContext(sharedContext); // Run all scripts in the SAME context
});
console.log('...AudioApp namespace is now available for tests. Is window defined?', typeof sharedContext.window);
// After all scripts, AudioApp in sharedContext should be populated.
// Make it available on the test's global scope as well for expect(AudioApp.Utils...)
global.AudioApp = sharedContext.AudioApp;
