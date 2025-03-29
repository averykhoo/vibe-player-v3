// --- /vibe-player/audio/rubberband-loader.js ---
/**
 * @fileoverview Modified Emscripten Loader for Rubberband WASM in AudioWorklet.
 * @description This script provides an asynchronous function factory (`Rubberband`)
 * designed to load and initialize the `rubberband.wasm` module within an
 * AudioWorklet environment. It expects the WASM binary (`moduleArg.wasmBinary`)
 * and an instantiation hook function (`moduleArg.instantiateWasm`) to be passed
 * to the factory function. It attaches necessary utility functions and Rubberband
 * option flags to the resolved module object.
 *
 * CRITICAL: The internal WASM export names (e.g., 'q', 'V', 'r') and import keys
 * (e.g., 'a', 'b', 'c') are hardcoded based on a specific Emscripten build of
 * rubberband.wasm. If rubberband.wasm is recompiled with different settings,
 * these names/keys MUST be updated in the `wasmImports` object and within the
 * `assignExports` function.
 */

// Define the factory function within a self-executing scope to avoid polluting global much.
// It returns the async loader function.
var Rubberband = (() => { // Outer IIFE defines the 'Rubberband' variable scope

    /**
     * Asynchronous factory function to load and initialize the Rubberband WASM module.
     * @param {object} moduleArg - Configuration object.
     * @param {ArrayBuffer} moduleArg.wasmBinary - The raw byte code of rubberband.wasm.
     * @param {Function} moduleArg.instantiateWasm - A function provided by the caller (AudioWorklet)
     *   that takes `(imports, successCallback)` and handles the actual `WebAssembly.instantiate` call,
     *   invoking `successCallback(instance, module)` upon success.
     * @param {Function} [moduleArg.print] - Optional function for standard output logging.
     * @param {Function} [moduleArg.printErr] - Optional function for error logging.
     * @param {Function} [moduleArg.onAbort] - Optional callback if WASM aborts.
     * @returns {Promise<object>} A promise that resolves with the fully initialized Rubberband module object
     *   (containing exported functions like _rubberband_new, helpers, and option flags), or rejects on error.
     */
    return async function RubberbandLoaderFactory(moduleArg = {}) {
            // --- Module Setup & Promise ---
            var Module = moduleArg; // Use the provided argument object as the Module context
            var readyPromiseResolve, readyPromiseReject;
            var readyPromise = new Promise((resolve, reject) => {
                readyPromiseResolve = resolve;
                readyPromiseReject = reject;
            });

            // --- Environment & Logging ---
            // Assume a Worker/Worklet-like environment. No direct DOM/Node.js access.
            var out = Module["print"] || console.log.bind(console);
            var err = Module["printErr"] || console.error.bind(console);

            // --- Core WASM State ---
            var wasmMemory; // Reference to the WASM memory instance
            var ABORT = false; // Flag indicating if the WASM runtime aborted
            var runtimeInitialized = false;
            // Heap views - these will be populated once wasmMemory is available
            var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;

            /** Updates the JS heap views after wasmMemory is initialized or resized. */
            function updateMemoryViews() {
                if (!wasmMemory || !wasmMemory.buffer) return; // Ensure memory and buffer exist
                var b = wasmMemory.buffer;
                Module["HEAP8"] = HEAP8 = new Int8Array(b); Module["HEAP16"] = HEAP16 = new Int16Array(b);
                Module["HEAPU8"] = HEAPU8 = new Uint8Array(b); Module["HEAPU16"] = HEAPU16 = new Uint16Array(b);
                Module["HEAP32"] = HEAP32 = new Int32Array(b); Module["HEAPU32"] = HEAPU32 = new Uint32Array(b);
                Module["HEAPF32"] = HEAPF32 = new Float32Array(b); Module["HEAPF64"] = HEAPF64 = new Float64Array(b);
            }

            // --- Lifecycle Callbacks (Emscripten pattern) ---
            var __ATINIT__ = []; // Called before main logic, after WASM setup
            var __ATPOSTRUN__ = []; // Called after main logic (if applicable)
            function addOnInit(cb) { __ATINIT__.unshift(cb); }
            function addOnPostRun(cb) { __ATPOSTRUN__.unshift(cb); }
            function callRuntimeCallbacks(callbacks) { while(callbacks.length > 0) { (callbacks.shift())(Module); } }

            // --- Dependency Tracking (Simplified for WASM load) ---
            var runDependencies = 0; var dependenciesFulfilled = null;
            function addRunDependency(/*id*/) { runDependencies++; }
            function removeRunDependency(/*id*/) {
                runDependencies--;
                if (runDependencies === 0 && dependenciesFulfilled) {
                    var callback = dependenciesFulfilled; dependenciesFulfilled = null; callback();
                }
            }

            // --- Abort Function ---
            /** Handles WASM runtime aborts. */
            function abort(what) {
                Module["onAbort"]?.(what); // Call user-provided hook if exists
                what = "Aborted(" + (what || "") + ")";
                err(what);
                ABORT = true;
                runtimeInitialized = false; // Prevent further execution attempts
                var e = new WebAssembly.RuntimeError(what + '. Check dev console.');
                readyPromiseReject(e); // Reject the main promise
                throw e; // Throw to stop current execution path
            }

            // --- WASM Instantiation Logic ---
            var wasmExports; // To hold the exported functions from the WASM instance

            /** Initiates the WASM loading and instantiation process using the provided hook. */
            function createWasm() {
                // The imports object passed to WebAssembly.instantiate.
                // The outer key ('a') must match what the Emscripten linker expects for the imports object.
                // The inner keys ('b', 'a', 'j', etc.) must match the import names expected by rubberband.wasm.
                var info = { a: wasmImports };

                /** Callback for the instantiateWasm hook, receives the instance and module. */
                function receiveInstance(instance, module) {
                    console.log("RubberbandLoader: receiveInstance called.");
                    wasmExports = instance.exports;
                    // Check for essential exports like memory and initialization function
                    if (!wasmExports.n) { // 'n' is the typical Emscripten name for exported memory
                        throw new Error("WASM module instance does not export memory ('n'). Check WASM build.");
                    }
                    if (!wasmExports.o) { // 'o' is the typical name for the initialization function (__wasm_call_ctors)
                         throw new Error("WASM module instance does not export init function ('o'). Check WASM build.");
                    }
                    wasmMemory = wasmExports["n"]; // Get memory reference
                    updateMemoryViews(); // Create HEAP views
                    addOnInit(wasmExports["o"]); // Add WASM init function to be called later
                    removeRunDependency("wasm-instantiate"); // Signal WASM is loaded
                    console.log("RubberbandLoader: WASM instance processed.");
                    return wasmExports; // Return exports (though hook might not use it)
                }

                addRunDependency("wasm-instantiate"); // Block 'run' until WASM is ready

                // Check if the required hook function was provided
                if (typeof Module["instantiateWasm"] === 'function') {
                    try {
                        console.log("RubberbandLoader: Calling provided instantiateWasm hook...");
                        // Call the hook provided by the AudioWorklet caller
                        var exportsOrPromise = Module["instantiateWasm"](info, receiveInstance);
                        // Handle rare case where hook might return instance synchronously
                        if (exportsOrPromise instanceof WebAssembly.Instance) {
                            receiveInstance(exportsOrPromise, null); // Module object might be missing here
                        }
                        // Otherwise, assume the hook handles the async instantiation and calls receiveInstance
                    } catch (e) {
                        err(`RubberbandLoader: Module.instantiateWasm hook failed: ${e}`);
                        readyPromiseReject(e); // Reject the main promise
                    }
                } else {
                    const missingHookError = new Error("Fatal: 'instantiateWasm' hook function was not provided to the Rubberband loader.");
                    err(missingHookError.message);
                    readyPromiseReject(missingHookError);
                    return {}; // Return empty object to avoid further errors
                }
                return {}; // Required by Emscripten async setup flow
            }

            // --- Minimal JS Stubs for WASM Imports ---
            // These functions are called *from* WASM. They need to exist before instantiation.
            // Provide basic implementations or stubs for functions rubberband.wasm might import.
            // NOTE: The keys ('b', 'a', 'j', etc.) MUST match the import names expected by *your* rubberband.wasm build.
            // Use tools like `wasm-objdump` or check browser console errors during instantiation to verify these.

            const _UTF8ToString_stub = (ptr) => { /* Basic stub - limited length, no full decoding */ if (!ptr || !HEAPU8) return ""; let str = ''; let i = ptr; try { while (HEAPU8[i] && i < ptr + 1024) { str += String.fromCharCode(HEAPU8[i++]); } } catch(e) {/* Might fail if HEAPU8 not ready */} return str; };
            const ___assert_fail = (condition, filename, line, func) => { abort(`Assertion failed: ${_UTF8ToString_stub(condition)} at ${_UTF8ToString_stub(filename)}:${line} (${_UTF8ToString_stub(func)})`) };
            const ___cxa_throw = (ptr, type, destructor) => { abort(`Exception thrown from WASM: ptr=${ptr} type=${type} destructor=${destructor}`) };
            const __abort_js = () => { abort("WASM called abort") };
            const __emscripten_memcpy_js = (dest, src, num) => { if(HEAPU8) HEAPU8.copyWithin(dest, src, src + num); else console.error("memcpy failed: HEAPU8 not ready"); };
            const _emscripten_date_now = () => Date.now();
            const _emscripten_resize_heap = (/*requestedSize*/) => { err("Warning: _emscripten_resize_heap called - Not implemented in this loader."); return false; }; // Heap resizing not supported here
            const _environ_get = (/*__environ, environ_buf*/) => 0; // No environment variables
            const _environ_sizes_get = (penviron_count, penviron_buf_size) => { if(HEAPU32) { HEAPU32[penviron_count>>2]=0; HEAPU32[penviron_buf_size>>2]=0; } return 0; };
            const __tzset_js = () => {}; // Timezone not handled
            // Basic File Descriptor stubs (return errors or minimal success)
            const _fd_close = (/*fd*/) => 0; // Pretend close succeeds
            const _fd_read = (/*fd, iov, iovcnt, pnum*/) => { if(HEAPU32 && pnum) HEAPU32[pnum >> 2] = 0; return 0; }; // Pretend read 0 bytes
            const _fd_seek = (/*fd, offset_low, offset_high, whence, newOffset*/) => { if(HEAP32 && newOffset) { HEAP32[newOffset>>2]=0; HEAP32[newOffset+4>>2]=0; } return 0; }; // Pretend seek succeeds at offset 0
            const _fd_write = (fd, iov, iovcnt, pnum) => { // Log attempts to write to stdout/stderr
                 let num = 0;
                 try {
                     if(HEAPU32) { // Basic safety check
                         for (let i = 0; i < iovcnt; i++) {
                             let ptr = HEAPU32[iov >> 2];
                             let len = HEAPU32[iov + 4 >> 2];
                             iov += 8;
                             if (ptr && len > 0 && HEAPU8) {
                                 let str = _UTF8ToString_stub(ptr); // Use basic stub
                                 if (fd === 1) out(`WASM_STDOUT: ${str}`);
                                 else if (fd === 2) err(`WASM_STDERR: ${str}`);
                                 num += len;
                             }
                         }
                         if (pnum) HEAPU32[pnum >> 2] = num;
                     }
                 } catch(e) { /* Ignore errors during logging attempt */ }
                 return 0; // Indicate success (or no error) to WASM
            };

            // --- WASM Imports Object ---
            // Map the stub functions to the keys expected by rubberband.wasm.
            // VERIFY THESE KEYS ('a', 'b', 'c', ...) AGAINST YOUR WASM FILE IMPORTS.
            var wasmImports = {
                 b: ___assert_fail,          // Often assertion failures
                 a: ___cxa_throw,            // C++ exceptions
                 j: __abort_js,              // Abort function
                 i: __emscripten_memcpy_js,  // Memory copy
                 l: __tzset_js,              // Timezone set (stubbed)
                 h: _emscripten_date_now,    // Current time
                 e: _emscripten_resize_heap, // Heap resize (stubbed)
                 m: _environ_get,            // Environment get (stubbed)
                 d: _environ_sizes_get,      // Environment size get (stubbed)
                 f: _fd_close,               // File close (stubbed)
                 g: _fd_read,                // File read (stubbed)
                 k: _fd_seek,                // File seek (stubbed)
                 c: _fd_write                // File write (stubbed to console)
                 // Add other imports here if your rubberband.wasm requires them.
                 // Check browser console errors during load if it fails.
            };

            // --- Runtime Initialization Control ---
            /** Calls registered __ATINIT__ callbacks. */
            function initRuntime() {
                 if (runtimeInitialized) return;
                 runtimeInitialized = true;
                 callRuntimeCallbacks(__ATINIT__); // Includes assignExports via addOnInit
            }
            /** Calls registered __ATPOSTRUN__ callbacks. */
            function postRun() { callRuntimeCallbacks(__ATPOSTRUN__); }

            // --- Main Execution Flow ---
            var calledRun = false;
            // This function will be called once dependencies (WASM) are met
            dependenciesFulfilled = function runCaller() {
                if (!calledRun) run();
                // If run() encounters further dependencies, it might reset dependenciesFulfilled
                if (!calledRun) dependenciesFulfilled = runCaller;
            };
            /** The main run function, called after WASM is ready. */
            function run() {
                 if (runDependencies > 0) return; // Should not happen if called via dependenciesFulfilled correctly
                 if (calledRun) return; calledRun = true; Module["calledRun"] = true;
                 if (ABORT) return;

                 initRuntime(); // This calls __ATINIT__, which should include assignExports

                 // --- RESOLVE THE MAIN PROMISE ---
                 // At this point, WASM is loaded, exports assigned, ready to use.
                 readyPromiseResolve(Module);

                 // Call optional user hook
                 Module["onRuntimeInitialized"]?.();

                 postRun(); // Call any post-run hooks (usually none needed here)
            }

            // --- Assign WASM Exports & Helpers to Module ---
            /**
             * Attaches WASM exported functions, helper functions (getValue, UTF8ToString, etc.),
             * stack management functions, and Rubberband option flags to the `Module` object.
             * This function is added to the __ATINIT__ callbacks.
             */
            function assignExports() {
                 if (!wasmExports) {
                    console.error("RubberbandLoader: WASM Exports not available during assignExports!");
                    abort("WASM exports missing");
                    return;
                 }
                 // Ensure heap views are ready before helpers are used
                 updateMemoryViews();

                 // --- Define Helper Functions (Scoped locally) ---
                 // These provide JS access to WASM memory and types.
                 const getValue=(ptr,type="i8")=>{ if(!HEAPU8) return 0; if(type.endsWith("*"))type="*"; switch(type){ case"i1":return HEAP8[ptr]; case"i8":return HEAP8[ptr]; case"i16":return HEAP16[ptr>>1]; case"i32":return HEAP32[ptr>>2]; case"i64":{console.error("getValue(i64) not supported without BigInt"); return 0;} case"float":return HEAPF32[ptr>>2]; case"double":return HEAPF64[ptr>>3]; case"*":return HEAPU32[ptr>>2]; default:abort(`invalid type for getValue: ${type}`); return 0;} };
                 const setValue=(ptr,value,type="i8")=>{ if(!HEAPU8) return; if(type.endsWith("*"))type="*"; switch(type){ case"i1":HEAP8[ptr]=value;break; case"i8":HEAP8[ptr]=value;break; case"i16":HEAP16[ptr>>1]=value;break; case"i32":HEAP32[ptr>>2]=value;break; case"i64":{console.error("setValue(i64) not supported without BigInt"); break;} case"float":HEAPF32[ptr>>2]=value;break; case"double":HEAPF64[ptr>>3]=value;break; case"*":HEAPU32[ptr>>2]=value;break; default:abort(`invalid type for setValue: ${type}`);}};
                 const UTF8Decoder = typeof TextDecoder!="undefined"?new TextDecoder('utf8'):undefined;
                 const UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead = Infinity)=>{ var endIdx=idx+maxBytesToRead;var endPtr = idx;while(heapOrArray[endPtr] && endPtr < endIdx) ++endPtr;if(endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder){return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));}else{var str = "";while(idx<endPtr){var u0=heapOrArray[idx++];if(!(u0&128)){str+=String.fromCharCode(u0);continue}var u1=heapOrArray[idx++]&63;if((u0&224)==192){str+=String.fromCharCode((u0&31)<<6|u1);continue}var u2=heapOrArray[idx++]&63;if((u0&240)==224){u0=(u0&15)<<12|u1<<6|u2}else{u0=(u0&7)<<18|u1<<12|u2<<6|heapOrArray[idx++]&63}if(u0<0x10000){str+=String.fromCharCode(u0)}else{var ch=u0-0x10000;str+=String.fromCharCode(0xD800|(ch>>10),0xDC00|(ch&0x3FF))}}return str;}};
                 const UTF8ToString = (ptr, maxBytesToRead) => ptr ? UTF8ArrayToString(HEAPU8 || [], ptr, maxBytesToRead) : ""; // Add HEAPU8 check
                 const stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite)=>{ if(!(maxBytesToWrite>0))return 0;var startIdx=outIdx;var endIdx=outIdx+maxBytesToWrite-1;for(var i=0;i<str.length;++i){var u=str.charCodeAt(i);if(u>=0xD800&&u<=0xDFFF){var u1=str.charCodeAt(++i);u=0x10000+((u&0x3FF)<<10)|(u1&0x3FF)}if(u<=0x7F){if(outIdx>=endIdx)break;heap[outIdx++]=u}else if(u<=0x7FF){if(outIdx+1>=endIdx)break;heap[outIdx++]=0xC0|(u>>6);heap[outIdx++]=0x80|(u&63)}else if(u<=0xFFFF){if(outIdx+2>=endIdx)break;heap[outIdx++]=0xE0|(u>>12);heap[outIdx++]=0x80|((u>>6)&63);heap[outIdx++]=0x80|(u&63)}else{if(outIdx+3>=endIdx)break;heap[outIdx++]=0xF0|(u>>18);heap[outIdx++]=0x80|((u>>12)&63);heap[outIdx++]=0x80|((u>>6)&63);heap[outIdx++]=0x80|(u&63)}}heap[outIdx]=0;return outIdx-startIdx;};
                 const stringToUTF8 = (str, outPtr, maxBytesToWrite) => stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
                 const lengthBytesUTF8 = str => { let len = 0; for (let i = 0; i < str.length; ++i) { let c = str.charCodeAt(i); if (c <= 0x7F) { len++; } else if (c <= 0x7FF) { len += 2; } else if (c >= 0xD800 && c <= 0xDFFF) { len += 4; ++i; } else { len += 3; } } return len; };

                 // --- Assign WASM Exported Functions ---
                 // Map the WASM export names (e.g., 'q', 'V', 'r') to the desired JS function names (e.g., '_free').
                 // VERIFY THESE EXPORT NAMES AGAINST YOUR rubberband.wasm FILE.
                 try {
                     Module["_free"] = wasmExports["q"]; Module["_malloc"] = wasmExports["V"];
                     Module["_rubberband_new"] = wasmExports["r"]; Module["_rubberband_delete"] = wasmExports["s"];
                     Module["_rubberband_reset"] = wasmExports["t"];
                     Module["_rubberband_set_time_ratio"] = wasmExports["v"]; Module["_rubberband_set_pitch_scale"] = wasmExports["w"];
                     Module["_rubberband_get_time_ratio"] = wasmExports["x"]; Module["_rubberband_get_pitch_scale"] = wasmExports["y"];
                     Module["_rubberband_set_formant_scale"] = wasmExports["z"]; Module["_rubberband_get_formant_scale"] = wasmExports["A"];
                     Module["_rubberband_get_latency"] = wasmExports["D"];
                     Module["_rubberband_set_transients_option"] = wasmExports["E"];
                     Module["_rubberband_set_detector_option"] = wasmExports["F"];
                     Module["_rubberband_set_phase_option"] = wasmExports["G"];
                     Module["_rubberband_set_formant_option"] = wasmExports["H"];
                     Module["_rubberband_set_pitch_option"] = wasmExports["I"];
                     Module["_rubberband_set_expected_input_duration"] = wasmExports["J"];
                     Module["_rubberband_get_samples_required"] = wasmExports["K"];
                     Module["_rubberband_set_max_process_size"] = wasmExports["L"];
                     Module["_rubberband_study"] = wasmExports["N"]; Module["_rubberband_process"] = wasmExports["O"];
                     Module["_rubberband_available"] = wasmExports["P"]; Module["_rubberband_retrieve"] = wasmExports["Q"];
                     Module["_rubberband_get_channel_count"] = wasmExports["R"];
                     // ... Add mappings for ALL other _rubberband_* functions you need ...

                     // --- Assign Stack Functions ---
                     // CRITICAL: Verify the export names for stack functions (e.g., 'W', 'X', 'Y').
                     const __emscripten_stack_alloc = wasmExports["X"];
                     const __emscripten_stack_restore = wasmExports["W"];
                     const _emscripten_stack_get_current = wasmExports["Y"];
                     // Check if stack functions were exported
                     if (!__emscripten_stack_alloc || !__emscripten_stack_restore || !_emscripten_stack_get_current) {
                          throw new Error("Essential stack management functions (X, W, Y) not found in WASM exports.");
                     }
                     stackSave = _emscripten_stack_get_current; stackRestore = __emscripten_stack_restore; stackAlloc = __emscripten_stack_alloc;
                     Module["stackSave"] = stackSave; Module["stackRestore"] = stackRestore; Module["stackAlloc"] = stackAlloc;

                     // --- Assign Helper Functions to Module ---
                     Module["getValue"] = getValue; Module["setValue"] = setValue; Module["UTF8ToString"] = UTF8ToString;
                     Module["stringToUTF8"] = stringToUTF8; Module["lengthBytesUTF8"] = lengthBytesUTF8;

                     // --- Add RubberBand Option Flags Enum ---
                     Module.RubberBandOptionFlag = Object.freeze({
                         ProcessOffline: 0x00000000, ProcessRealTime: 0x00000001,
                         StretchElastic: 0x00000000, StretchPrecise: 0x00000010,
                         TransientsCrisp: 0x00000000, TransientsMixed: 0x00000100, TransientsSmooth: 0x00000200,
                         DetectorCompound: 0x00000000, DetectorPercussive: 0x00000400, DetectorSoft: 0x00000800,
                         PhaseLaminar: 0x00000000, PhaseIndependent: 0x00002000,
                         ThreadingAuto: 0x00000000, ThreadingNever: 0x00010000, ThreadingAlways: 0x00020000,
                         WindowStandard: 0x00000000, WindowShort: 0x00100000, WindowLong: 0x00200000,
                         SmoothingOff: 0x00000000, SmoothingOn: 0x00800000,
                         FormantShifted: 0x00000000, FormantPreserved: 0x01000000,
                         PitchHighSpeed: 0x00000000, PitchHighQuality: 0x02000000, PitchHighConsistency: 0x04000000,
                         ChannelsApart: 0x00000000, ChannelsTogether: 0x10000000,
                         EngineFaster: 0x00000000, EngineFiner: 0x20000000,
                         // Add aliases or presets if needed
                         EngineDefault: 0, // Alias for EngineFaster often used
                     });
                     // Alias for convenience if used elsewhere
                     Module.RubberbandOptions = Module.RubberBandOptionFlag;

                 } catch (exportError) {
                     console.error("RubberbandLoader: Error assigning WASM exports:", exportError);
                     // If specific exports are missing, the error message might indicate which one.
                     abort(`Failed to assign required WASM exports. Check WASM build and loader mappings. Error: ${exportError.message}`);
                 }

            } // End assignExports

            // --- Start the Loading Process ---
            addOnInit(assignExports); // Ensure exports are assigned after WASM init but before run
            createWasm(); // Initiate WASM loading and instantiation

            // Return the promise that will resolve with the fully initialized Module object
            return readyPromise;
        }; // End of async factory function

})(); // End of outer IIFE

// This script defines the global `Rubberband` async factory function.
// It does NOT export anything via `export default` because it's intended
// to be loaded via <script> tag or eval/new Function.

// --- /vibe-player/audio/rubberband-loader.js ---
