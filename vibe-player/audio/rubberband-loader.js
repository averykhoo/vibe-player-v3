// /vibe-player/audio/rubberband-loader.js
// --- START OF FILE rubberband-loader.js (Self-Contained Loader + Options) ---

// ** MODIFIED Emscripten Loader for AudioWorklet **
// Original source: Emscripten-generated loader for Rubberband library (@echogarden)
// Modifications:
// - Removed Node.js support, file loading, script path detection.
// - Executes via new Function(), expects WASM binary via moduleArg.wasmBinary.
// - Expects instantiation hook via moduleArg.instantiateWasm.
// - Includes RubberBandOptionFlag constants directly on the resolved Module object.
// - Removed 'export default'.
// - Structure adjusted to return the async loader function, not invoke it immediately.

var Rubberband = (() => { // Outer IIFE defines Rubberband scope

  // This async function is what the outer IIFE will return
  return (
    async function (moduleArg = {}) { // Accepts { wasmBinary, instantiateWasm, ... }
      var Module = moduleArg; // Use the provided argument object directly
      var moduleRtn;

      // --- Promise for readiness ---
      var readyPromiseResolve, readyPromiseReject;
      var readyPromise = new Promise((resolve, reject) => {
        readyPromiseResolve = resolve;
        readyPromiseReject = reject;
      });

      // --- Basic Environment (Assume Worker/Worklet like) ---
      // Use console.log/error directly in the Worklet scope
      var out = console.log.bind(console);
      var err = console.error.bind(console);

      // --- State ---
      var wasmMemory;
      var ABORT = false;
      var runtimeInitialized = false;
      var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;

      function updateMemoryViews() {
        if (!wasmMemory || !wasmMemory.buffer) {
           err("WASM Memory or buffer unavailable during updateMemoryViews!");
           return;
        }
        var b = wasmMemory.buffer;
        Module["HEAP8"] = HEAP8 = new Int8Array(b); Module["HEAP16"] = HEAP16 = new Int16Array(b);
        Module["HEAPU8"] = HEAPU8 = new Uint8Array(b); Module["HEAPU16"] = HEAPU16 = new Uint16Array(b);
        Module["HEAP32"] = HEAP32 = new Int32Array(b); Module["HEAPU32"] = HEAPU32 = new Uint32Array(b);
        Module["HEAPF32"] = HEAPF32 = new Float32Array(b); Module["HEAPF64"] = HEAPF64 = new Float64Array(b);
      }

      // --- Lifecycle Callbacks ---
      // These are simplified as we don't have a complex preRun/postRun scenario
      var __ATINIT__ = []; var __ATMAIN__ = []; var __ATEXIT__ = []; var __ATPOSTRUN__ = [];
      function addOnInit(cb) { __ATINIT__.unshift(cb) }
      function addOnPostRun(cb) { __ATPOSTRUN__.unshift(cb) }
      function callRuntimeCallbacks(callbacks) {
           while(callbacks.length>0){
               var callback=callbacks.shift();
               if(typeof callback=="function"){callback(Module);continue} // Pass Module
               var func=callback.func;
               if(typeof func=="number"){ // Simplified pointer check
                   if(callback.arg===undefined){
                       err("Missing callback.arg for function pointer call");
                   } else {
                       // Assuming WASM function pointers are handled by the Module object itself
                       // This part might need adjustment based on how WASM exports func ptrs
                       err("Function pointer callbacks not fully implemented in this loader version.");
                   }
               }else{
                   func(callback.arg===undefined?null:callback.arg)
               }
           }
       };

      // --- Dependency Tracking (Simplified for WASM only) ---
      var runDependencies = 0; var dependenciesFulfilled = null;
      function addRunDependency(id) { runDependencies++; }
      function removeRunDependency(id) {
        runDependencies--;
        if (runDependencies == 0 && dependenciesFulfilled) {
          var callback = dependenciesFulfilled; dependenciesFulfilled = null; callback();
        }
      }

      // --- Abort ---
      function abort(what) {
        Module["onAbort"]?.(what); // Optional user hook
        what = "Aborted(" + what + ")";
        err(what);
        ABORT = true;
        // Notify ready promise about the failure
        var e = new WebAssembly.RuntimeError(what);
        readyPromiseReject(e);
        throw e; // Also throw to stop execution
      }

      // --- WASM Instantiation ---
      var wasmExports;
      function createWasm() {
        // NOTE: 'env' or 'a' is the common import object name. Check WASM if it fails.
        // The import names ('b', 'a', 'j', 'i' etc.) MUST match the WASM file.
        var info = { a: wasmImports }; // Using 'a' based on previous file

        function receiveInstance(instance, module) {
          console.log("[Loader] receiveInstance called."); // Debug log
          wasmExports = instance.exports;
          Module["asm"] = wasmExports; // Common practice, though direct access below is used
          wasmMemory = wasmExports["n"]; // Hardcoded memory export name 'n'
          if (!wasmMemory) {
              abort("WASM instance received, but memory export 'n' not found.");
              return;
          }
          updateMemoryViews();
          addOnInit(wasmExports["o"]); // Hardcoded init function export name 'o'
          removeRunDependency("wasm-instantiate");
          console.log("[Loader] WASM instance processed, init queued."); // Debug log
          return wasmExports;
        }

        addRunDependency("wasm-instantiate");

        if (Module["instantiateWasm"] && Module["wasmBinary"]) {
          try {
            // The hook is responsible for calling receiveInstance
            var exports = Module["instantiateWasm"](info, receiveInstance);
            // Handle potential sync return (less likely for WASM)
            if (exports instanceof WebAssembly.Instance) {
                console.log("[Loader] instantiateWasm returned sync instance."); // Debug log
                receiveInstance(exports);
            } else if (exports instanceof Promise) {
                 console.log("[Loader] instantiateWasm returned a Promise."); // Debug log
                 exports.catch(e => { // Catch errors from the promise itself
                     err(`Error in instantiateWasm promise: ${e}`);
                     abort(`instantiateWasm promise failed: ${e}`);
                 });
            } else {
                 console.log("[Loader] instantiateWasm returned: ", exports); // Debug log
            }
          } catch (e) {
            err(`Module.instantiateWasm callback failed with error: ${e}`);
            abort(`instantiateWasm callback failed: ${e}`);
          }
        } else {
          var missing = !Module["instantiateWasm"] ? "'instantiateWasm' hook" : "'wasmBinary'";
          var missingHookError = new Error(`Fatal error: ${missing} not provided to the WASM loader module.`);
          err(missingHookError.message);
          readyPromiseReject(missingHookError); // Reject promise
          return {}; // Or throw error?
        }
        return {}; // Required for async preparation
      }

      // --- Minimal Stubs needed *before* assignExports/runtime ---
       // Need a *basic* UTF8ToString for error reporting during init
       const _UTF8ToString_stub = (ptr, maxBytesToRead = 1024) => {
           if (!ptr || !HEAPU8) return "[HEAPU8 unavailable]"; let str = ''; let i = ptr;
           let end = Math.min(i + maxBytesToRead, HEAPU8.length);
           while (HEAPU8[i] && i < end) {
              str += String.fromCharCode(HEAPU8[i++]);
           }
           if (i === end && i < ptr + maxBytesToRead) str += "[...]"; // Indicate truncation
           return str;
       };
       const ___assert_fail = (condition, filename, line, func) => { abort(`Assertion failed: ${_UTF8ToString_stub(condition)} at ${_UTF8ToString_stub(filename)}:${line} (${_UTF8ToString_stub(func)})`) };
       const ___cxa_throw = (ptr, type, destructor) => { abort(`Exception thrown from WASM: ptr=${ptr} type=${type} destructor=${destructor}`) };
       const __abort_js = () => { abort("wasm execution") };
       const __emscripten_memcpy_js = (dest, src, num) => { if (!HEAPU8) { err("HEAPU8 unavailable for memcpy"); return; } try { HEAPU8.copyWithin(dest, src, src + num); } catch (e) { abort(`memcpy error: ${e}`) } };
       const _emscripten_date_now = () => Date.now();
       const _emscripten_resize_heap = requestedSize => { err("_emscripten_resize_heap called - Not implemented."); return false; }; // Heap resizing not supported
       // --- WASI Stubs (minimal for things like printf / basic env) ---
       const _environ_get = (__environ, environ_buf) => 0; // No env vars
       const _environ_sizes_get = (penviron_count, penviron_buf_size) => { if(HEAPU32) { HEAPU32[penviron_count>>2]=0; HEAPU32[penviron_buf_size>>2]=0; } return 0; };
       const __tzset_js = (/* ignored */) => {}; // Timezone stub
       const _fd_close = (fd) => 0; // Assume close succeeds
       const _fd_read = (fd, iov, iovcnt, pnum) => { if(HEAPU32) HEAPU32[pnum >> 2] = 0; return 0; }; // Assume read gets 0 bytes
       const _fd_seek = (fd, offset_low, offset_high, whence, newOffset) => { if(HEAP32) { HEAP32[newOffset>>2]=0; HEAP32[newOffset+4>>2]=0; } return 0; }; // Assume seek succeeds, returns 0
       const _fd_write = (fd, iov, iovcnt, pnum) => { // Basic logging stub
         let num = 0; try { if (!HEAPU32 || !HEAPU8) { err("[fd_write stub: HEAP unavailable]"); return 0; } for (let i = 0; i < iovcnt; i++) { let ptr = HEAPU32[iov >> 2]; let len = HEAPU32[iov + 4 >> 2]; iov += 8; let str = _UTF8ToString_stub(ptr, len); /* Basic ASCII ok for debug */ if (fd === 1) out(str); else err(str); num += len; } HEAPU32[pnum >> 2] = num; } catch(e) { err(`[fd_write stub error: ${e}]`) } return 0; // Return 0 for success according to WASI spec often used
       };
       const _proc_exit = (code) => { abort(`proc_exit called with code ${code}`); }; // Process exit stub

      // --- Stack variables (will be assigned in assignExports) ---
      var stackSave, stackRestore, stackAlloc, _emscripten_stack_get_current;

      // --- WASM Imports Object ---
      // These keys ('a', 'b', 'c'...) MUST match what rubberband.wasm expects.
      // Based on the previous `realtime_test_rubberband.js` provided.
      // IMPORTANT: If rubberband.wasm is rebuilt, these keys might change!
      var wasmImports = {
        b: ___assert_fail, a: ___cxa_throw, j: __abort_js, i: __emscripten_memcpy_js,
        l: __tzset_js, h: _emscripten_date_now, e: _emscripten_resize_heap,
        m: _environ_get, d: _environ_sizes_get, f: _fd_close, g: _fd_read,
        k: _fd_seek, c: _fd_write,
        // Assuming proc_exit might be needed, map it. Check WASM if it breaks.
        _: _proc_exit,
      };

      // --- Runtime Initialization ---
      function initRuntime() {
           runtimeInitialized = true;
           console.log("[Loader] Running __ATINIT__ callbacks..."); // Debug log
           callRuntimeCallbacks(__ATINIT__);
           console.log("[Loader] __ATINIT__ callbacks finished."); // Debug log
      }
      function postRun() {
          console.log("[Loader] Running __ATPOSTRUN__ callbacks..."); // Debug log
          callRuntimeCallbacks(__ATPOSTRUN__);
          console.log("[Loader] __ATPOSTRUN__ callbacks finished."); // Debug log
      }

      // --- Main Execution Logic ---
      var calledRun;
      dependenciesFulfilled = function runCaller() {
          if (!calledRun) {
              console.log("[Loader] runCaller attempting run..."); // Debug log
              run();
          }
          if (!calledRun) {
              // console.log("[Loader] runCaller - run didn't happen yet, rescheduling."); // Debug log (can be noisy)
              dependenciesFulfilled = runCaller; // Reschedule if run() bailed
          }
      };
      function run() {
        if (runDependencies > 0) {
            console.log(`[Loader] run() delayed, ${runDependencies} dependencies remaining.`); // Debug log
            return; // Wait for WASM etc.
        }

        // No preRun steps needed in this simplified loader

        if (calledRun) {
            console.log("[Loader] run() called again, ignoring."); // Debug log
            return;
        }
        calledRun = true;
        Module["calledRun"] = true;

        if (ABORT) {
            console.warn("[Loader] run() aborted."); // Debug log
            readyPromiseReject(new Error("Runtime aborted before execution.")); // Ensure promise is rejected
            return;
        }

        try {
            initRuntime(); // Calls __ATINIT__ (which includes assignExports)

            // Resolve the main promise HERE - AFTER initRuntime completes
            console.log("[Loader] Runtime initialized, resolving ready promise."); // Debug log
            readyPromiseResolve(Module);

            Module["onRuntimeInitialized"]?.(); // User hook

            postRun(); // Calls __ATPOSTRUN__

        } catch (e) {
            err(`[Loader] Error during run/initRuntime/postRun: ${e}`);
            abort(`Runtime error during run(): ${e}`);
        }
      }

      // --- assignExports Function (Called via __ATINIT__) ---
      function assignExports() {
        console.log("[Loader] assignExports called."); // Debug log
        if (!wasmExports) {
            err("[Loader] WASM Exports not available during assignExports!");
            abort("WASM exports missing");
            return;
        }
        // Ensure memory views are updated *after* wasmMemory is assigned
        updateMemoryViews();
        if (!HEAPU8) {
             abort("HEAPU8 view not available after updateMemoryViews");
             return;
        }

        // Define helpers *locally* within this scope
        const getValue = (ptr,type="i8",noAssert=false)=>{if(!HEAPU8&&!noAssert){abort("HEAPU8 not ready for getValue");return 0;}if(type.endsWith("*"))type="*";switch(type){case"i1":return HEAP8[ptr];case"i8":return HEAP8[ptr];case"i16":return HEAP16[ptr>>1];case"i32":return HEAP32[ptr>>2];case"i64":if(!noAssert)abort("getValue i64 not supported");return 0;case"float":return HEAPF32[ptr>>2];case"double":return HEAPF64[ptr>>3];case"*":return HEAPU32[ptr>>2];default:if(!noAssert)abort(`invalid type for getValue: ${type}`);return 0;}};
        const setValue = (ptr,value,type="i8",noAssert=false)=>{if(!HEAPU8&&!noAssert){abort("HEAPU8 not ready for setValue");return;}if(type.endsWith("*"))type="*";switch(type){case"i1":HEAP8[ptr]=value;break;case"i8":HEAP8[ptr]=value;break;case"i16":HEAP16[ptr>>1]=value;break;case"i32":HEAP32[ptr>>2]=value;break;case"i64":if(!noAssert)abort("setValue i64 not supported");break;case"float":HEAPF32[ptr>>2]=value;break;case"double":HEAPF64[ptr>>3]=value;break;case"*":HEAPU32[ptr>>2]=value;break;default:if(!noAssert)abort(`invalid type for setValue: ${type}`);}};
        const UTF8Decoder = typeof TextDecoder!="undefined"?new TextDecoder('utf8'):undefined;
        const UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead = Infinity)=>{if(!heapOrArray){return""}var endIdx=heapOrArray.length;var endPtr=idx+maxBytesToRead;var str="";var i=idx;while(i<endPtr&&i<endIdx){var u0=heapOrArray[i++];if(!(u0&128)){str+=String.fromCharCode(u0);continue}var u1=heapOrArray[i++]&63;if((u0&224)==192){str+=String.fromCharCode((u0&31)<<6|u1);continue}var u2=heapOrArray[i++]&63;if((u0&240)==224){u0=(u0&15)<<12|u1<<6|u2}else{u0=(u0&7)<<18|u1<<12|u2<<6|heapOrArray[i++]&63}if(u0<0x10000){str+=String.fromCharCode(u0)}else{var ch=u0-0x10000;str+=String.fromCharCode(0xD800|(ch>>10),0xDC00|(ch&0x3FF))}}return str;};
        const UTF8ToString = (ptr, maxBytesToRead) => ptr&&HEAPU8 ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : "";
        const stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite)=>{if(!(maxBytesToWrite>0)||!heap)return 0;var startIdx=outIdx;var endIdx=outIdx+maxBytesToWrite-1;for(var i=0;i<str.length;++i){var u=str.charCodeAt(i);if(u>=0xD800&&u<=0xDFFF){var u1=str.charCodeAt(++i);u=0x10000+((u&0x3FF)<<10)|(u1&0x3FF)}if(u<=0x7F){if(outIdx>=endIdx)break;heap[outIdx++]=u}else if(u<=0x7FF){if(outIdx+1>=endIdx)break;heap[outIdx++]=0xC0|(u>>6);heap[outIdx++]=0x80|(u&63)}else if(u<=0xFFFF){if(outIdx+2>=endIdx)break;heap[outIdx++]=0xE0|(u>>12);heap[outIdx++]=0x80|((u>>6)&63);heap[outIdx++]=0x80|(u&63)}else{if(outIdx+3>=endIdx)break;heap[outIdx++]=0xF0|(u>>18);heap[outIdx++]=0x80|((u>>12)&63);heap[outIdx++]=0x80|((u>>6)&63);heap[outIdx++]=0x80|(u&63)}}heap[outIdx]=0;return outIdx-startIdx;};
        const stringToUTF8 = (str, outPtr, maxBytesToWrite) => str&&HEAPU8 ? stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite) : 0;
        const lengthBytesUTF8 = str => {let len=0;for(let i=0;i<str.length;++i){let c=str.charCodeAt(i);if(c<=0x7F)len++;else if(c<=0x7FF)len+=2;else if(c>=0xD800&&c<=0xDFFF){len+=4;++i;}else len+=3;}return len;};

        // Assign mapped WASM functions to Module object
        // Using the export names ('q', 'r', etc.) presumed from previous test harness version.
        // VERIFY THESE AGAINST THE ACTUAL rubberband.wasm IF ERRORS OCCUR.
        Module["_free"] = wasmExports["q"]; Module["_malloc"] = wasmExports["V"];
        Module["_rubberband_new"] = wasmExports["r"]; Module["_rubberband_delete"] = wasmExports["s"];
        Module["_rubberband_reset"] = wasmExports["t"]; Module["_rubberband_get_engine_version"] = wasmExports["u"];
        Module["_rubberband_set_time_ratio"] = wasmExports["v"]; Module["_rubberband_set_pitch_scale"] = wasmExports["w"];
        Module["_rubberband_get_time_ratio"] = wasmExports["x"]; Module["_rubberband_get_pitch_scale"] = wasmExports["y"];
        Module["_rubberband_set_formant_scale"] = wasmExports["z"]; Module["_rubberband_get_formant_scale"] = wasmExports["A"];
        Module["_rubberband_get_preferred_start_pad"] = wasmExports["B"]; Module["_rubberband_get_start_delay"] = wasmExports["C"];
        Module["_rubberband_get_latency"] = wasmExports["D"]; Module["_rubberband_set_transients_option"] = wasmExports["E"];
        Module["_rubberband_set_detector_option"] = wasmExports["F"]; Module["_rubberband_set_phase_option"] = wasmExports["G"];
        Module["_rubberband_set_formant_option"] = wasmExports["H"]; Module["_rubberband_set_pitch_option"] = wasmExports["I"];
        Module["_rubberband_set_expected_input_duration"] = wasmExports["J"]; Module["_rubberband_get_samples_required"] = wasmExports["K"];
        Module["_rubberband_set_max_process_size"] = wasmExports["L"]; Module["_rubberband_set_key_frame_map"] = wasmExports["M"];
        Module["_rubberband_study"] = wasmExports["N"]; Module["_rubberband_process"] = wasmExports["O"];
        Module["_rubberband_available"] = wasmExports["P"]; Module["_rubberband_retrieve"] = wasmExports["Q"];
        Module["_rubberband_get_channel_count"] = wasmExports["R"]; Module["_rubberband_calculate_stretch"] = wasmExports["S"];
        Module["_rubberband_set_debug_level"] = wasmExports["T"]; Module["_rubberband_set_default_debug_level"] = wasmExports["U"];

        // Assign Stack functions (CRITICAL) - Using names X, W, Y from test harness
        var __emscripten_stack_alloc = wasmExports["X"];
        var __emscripten_stack_restore = wasmExports["W"];
        _emscripten_stack_get_current = wasmExports["Y"];
        if (!__emscripten_stack_alloc || !__emscripten_stack_restore || !_emscripten_stack_get_current) {
            abort("Stack management exports (X, W, Y) not found!");
            return;
        }
        stackSave = _emscripten_stack_get_current; stackRestore = __emscripten_stack_restore; stackAlloc = __emscripten_stack_alloc;
        Module["stackSave"] = stackSave; Module["stackRestore"] = stackRestore; Module["stackAlloc"] = stackAlloc;

        // Assign locally defined helpers to Module object
        Module["getValue"] = getValue; Module["setValue"] = setValue; Module["UTF8ToString"] = UTF8ToString;
        Module["stringToUTF8"] = stringToUTF8; Module["lengthBytesUTF8"] = lengthBytesUTF8;

        // *** ADD RUBBERBAND OPTIONS FLAGS ***
        // These values are standard for Rubberband library v1.8.1+
        Module.RubberBandOption = {
            ProcessOffline: 0x00000000, ProcessRealTime: 0x00000001,
            StretchElastic: 0x00000000, StretchPrecise: 0x00000010, StretchShortenOnly: 0x00000020,
            TransientsCrisp: 0x00000000, TransientsMixed: 0x00000100, TransientsSmooth: 0x00000200,
            DetectorCompound: 0x00000000, DetectorPercussive: 0x00000400, DetectorSoft: 0x00000800,
            PhaseLaminar: 0x00000000, PhaseIndependent: 0x00002000,
            ThreadingAuto: 0x00000000, ThreadingNever: 0x00010000, ThreadingAlways: 0x00020000,
            WindowStandard: 0x00000000, WindowShort: 0x00100000, WindowLong: 0x00200000,
            SmoothingOff: 0x00000000, SmoothingOn: 0x00800000,
            FormantShifted: 0x00000000, FormantPreserved: 0x01000000,
            PitchHighSpeed: 0x00000000, PitchHighQuality: 0x02000000, PitchHighConsistency: 0x04000000,
            ChannelsApart: 0x00000000, ChannelsTogether: 0x10000000,
            EngineFaster: 0x00000000, EngineFiner: 0x20000000
        };
        // Alias for convenience
        Module.RubberbandOptions = Module.RubberBandOption;

        console.log("[Loader] assignExports finished."); // Debug log
      } // End assignExports

      // --- Start the process ---
      addOnInit(assignExports); // Queue exports assignment
      createWasm(); // Start WASM loading (async)

      moduleRtn = readyPromise; // The promise resolves with the populated Module object
      return moduleRtn; // Return the promise
    }
  ) // <--- Inner async function is RETURNED, not invoked here
})(); // Outer IIFE is invoked immediately

// NO export default
// /vibe-player/audio/rubberband-loader.js
