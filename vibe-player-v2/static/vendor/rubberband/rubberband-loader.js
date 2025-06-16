// vibe-player-v2/static/vendor/rubberband/rubberband-loader.js

// ** MODIFIED Emscripten Loader for AudioWorklet **
// Original source: Emscripten-generated loader for Rubberband library (@echogarden)
// Modifications:
// - Removed Node.js support, file loading, script path detection.
// - Executes via new Function(), expects WASM binary via moduleArg.wasmBinary.
// - Expects instantiation hook via moduleArg.instantiateWasm.
// - Includes RubberBandOptionFlag constants directly on the resolved Module object.
// - Removed 'export default'.
// - Structure adjusted to return the async loader function, not invoke it immediately.

var Rubberband = (() => {
  // Outer IIFE defines Rubberband scope

  // This async function is what the outer IIFE will return
  return async function (moduleArg = {}) {
    // Accepts { wasmBinary, instantiateWasm, ... }
    var Module = moduleArg; // Use the provided argument object directly
    var moduleRtn;

    // --- Promise for readiness ---
    var readyPromiseResolve, readyPromiseReject;
    var readyPromise = new Promise((resolve, reject) => {
      readyPromiseResolve = resolve;
      readyPromiseReject = reject;
    });

    // --- Basic Environment (Assume Worker/Worklet like) ---
    var out = Module["print"] || console.log.bind(console);
    var err = Module["printErr"] || console.error.bind(console);

    // --- State ---
    var wasmMemory;
    var ABORT = false;
    var runtimeInitialized = false;
    var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;

    function updateMemoryViews() {
      if (!wasmMemory) return; // Prevent errors if called too early
      var b = wasmMemory.buffer;
      Module["HEAP8"] = HEAP8 = new Int8Array(b);
      Module["HEAP16"] = HEAP16 = new Int16Array(b);
      Module["HEAPU8"] = HEAPU8 = new Uint8Array(b);
      Module["HEAPU16"] = HEAPU16 = new Uint16Array(b);
      Module["HEAP32"] = HEAP32 = new Int32Array(b);
      Module["HEAPU32"] = HEAPU32 = new Uint32Array(b);
      Module["HEAPF32"] = HEAPF32 = new Float32Array(b);
      Module["HEAPF64"] = HEAPF64 = new Float64Array(b);
    }

    // --- Lifecycle Callbacks ---
    var __ATINIT__ = [];
    var __ATPOSTRUN__ = [];

    function addOnInit(cb) {
      __ATINIT__.unshift(cb);
    }

    function addOnPostRun(cb) {
      __ATPOSTRUN__.unshift(cb);
    }

    function callRuntimeCallbacks(callbacks) {
      callbacks.forEach((f) => f(Module));
    }

    // --- Dependency Tracking (Simplified) ---
    var runDependencies = 0;
    var dependenciesFulfilled = null;

    function addRunDependency(id) {
      runDependencies++;
    }

    function removeRunDependency(id) {
      runDependencies--;
      if (runDependencies == 0 && dependenciesFulfilled) {
        var callback = dependenciesFulfilled;
        dependenciesFulfilled = null;
        callback();
      }
    }

    // --- Abort ---
    function abort(what) {
      Module["onAbort"]?.(what);
      what = "Aborted(" + what + ")";
      err(what);
      ABORT = true;
      var e = new WebAssembly.RuntimeError(what);
      readyPromiseReject(e);
      throw e;
    }

    // --- WASM Instantiation ---
    var wasmExports;

    function createWasm() {
      // NOTE: 'a' is the expected import object name, 'n' is memory, 'o' is init func.
      // These might change if rubberband.wasm is rebuilt with different settings.
      var info = { a: wasmImports };

      function receiveInstance(instance, module) {
        wasmExports = instance.exports;
        wasmMemory = wasmExports["n"]; // Hardcoded memory export name
        updateMemoryViews();
        addOnInit(wasmExports["o"]); // Hardcoded init function export name
        removeRunDependency("wasm-instantiate");
        return wasmExports;
      }

      addRunDependency("wasm-instantiate");

      if (Module["instantiateWasm"]) {
        try {
          var exports = Module["instantiateWasm"](info, receiveInstance);
          // Handle potential sync return (less likely for WASM)
          if (exports instanceof WebAssembly.Instance) {
            receiveInstance(exports);
          }
        } catch (e) {
          err(`Module.instantiateWasm callback failed with error: ${e}`);
          readyPromiseReject(e);
        }
      } else {
        var missingHookError = new Error(
          "Fatal error: 'instantiateWasm' hook not provided to the WASM loader module.",
        );
        err(missingHookError.message);
        readyPromiseReject(missingHookError);
        return {};
      }
      return {}; // Required for async preparation
    }

    // --- Minimal Stubs needed *before* assignExports/runtime ---
    // Need a *basic* UTF8ToString for error reporting during init
    const _UTF8ToString_stub = (ptr) => {
      if (!ptr || !HEAPU8) return "";
      let str = "";
      let i = ptr;
      while (HEAPU8[i] && i < ptr + 1024) {
        // Limit length for safety
        str += String.fromCharCode(HEAPU8[i++]);
      }
      return str;
    };
    const ___assert_fail = (condition, filename, line, func) => {
      abort(`Assertion failed: ${_UTF8ToString_stub(condition)}`);
    };
    const ___cxa_throw = (ptr, type, destructor) => {
      abort(`Exception thrown from WASM: ptr=${ptr} type=${type}`);
    };
    const __abort_js = () => {
      abort("");
    };
    const __emscripten_memcpy_js = (dest, src, num) =>
      HEAPU8?.copyWithin(dest, src, src + num); // Check HEAPU8 exists
    const _emscripten_date_now = () => Date.now();
    const _emscripten_resize_heap = (requestedSize) => {
      err("_emscripten_resize_heap called - Not implemented.");
      return false;
    };
    const _environ_get = (__environ, environ_buf) => 0;
    const _environ_sizes_get = (penviron_count, penviron_buf_size) => {
      HEAPU32[penviron_count >> 2] = 0;
      HEAPU32[penviron_buf_size >> 2] = 0;
      return 0;
    };
    const __tzset_js = () => {};
    const _fd_close = (fd) => 0;
    const _fd_read = (fd, iov, iovcnt, pnum) => {
      HEAPU32[pnum >> 2] = 0;
      return 0;
    };
    const _fd_seek = (fd, offset_low, offset_high, whence, newOffset) => {
      HEAP32[newOffset >> 2] = 0;
      HEAP32[(newOffset + 4) >> 2] = 0;
      return 0;
    };
    const _fd_write = (fd, iov, iovcnt, pnum) => {
      // Basic logging stub
      let num = 0;
      try {
        for (let i = 0; i < iovcnt; i++) {
          let ptr = HEAPU32[iov >> 2];
          let len = HEAPU32[(iov + 4) >> 2];
          iov += 8;
          let str = _UTF8ToString_stub(ptr); /* Basic ASCII ok for debug */
          if (fd === 1) out(str);
          else err(str);
          num += len;
        }
        HEAPU32[pnum >> 2] = num;
      } catch (e) {
        /* ignore errors during logging */
      }
      return 0;
    };

    // --- Stack variables (will be assigned in assignExports) ---
    var stackSave,
      stackRestore,
      stackAlloc,
      __emscripten_stack_alloc,
      __emscripten_stack_restore,
      _emscripten_stack_get_current;

    // --- WASM Imports Object ---
    // These keys ('a', 'b', 'c'...) MUST match what rubberband.wasm expects.
    var wasmImports = {
      b: ___assert_fail,
      a: ___cxa_throw,
      j: __abort_js,
      i: __emscripten_memcpy_js,
      l: __tzset_js,
      h: _emscripten_date_now,
      e: _emscripten_resize_heap,
      m: _environ_get,
      d: _environ_sizes_get,
      f: _fd_close,
      g: _fd_read,
      k: _fd_seek,
      c: _fd_write,
      // Add other imports if rubberband.wasm requires them (check browser console errors)
    };

    // --- Runtime Initialization ---
    function initRuntime() {
      runtimeInitialized = true;
      callRuntimeCallbacks(__ATINIT__);
    }

    function postRun() {
      callRuntimeCallbacks(__ATPOSTRUN__);
    }

    // --- Main Execution Logic ---
    var calledRun;
    dependenciesFulfilled = function runCaller() {
      if (!calledRun) run();
      if (!calledRun) dependenciesFulfilled = runCaller;
    };

    function run() {
      if (runDependencies > 0) return; // Wait for WASM etc.
      // No preRun needed unless user adds callbacks
      if (calledRun) return;
      calledRun = true;
      Module["calledRun"] = true;
      if (ABORT) return;
      initRuntime(); // Calls __ATINIT__ (which includes assignExports)
      readyPromiseResolve(Module); // Resolve the main promise HERE
      Module["onRuntimeInitialized"]?.();
      postRun();
    }

    // --- assignExports Function (Called via __ATINIT__) ---
    function assignExports() {
      if (!wasmExports) {
        console.error("WASM Exports not available during assignExports!");
        abort("WASM exports missing");
        return;
      }

      // Define helpers *locally* within this scope
      updateMemoryViews(); // Ensure HEAP views are ready

      const getValue = (ptr, type = "i8") => {
        /* ... as in previous correct version ... */
        if (!HEAPU8) return 0;
        if (type.endsWith("*")) type = "*";
        switch (type) {
          case "i1":
            return HEAP8[ptr];
          case "i8":
            return HEAP8[ptr];
          case "i16":
            return HEAP16[ptr >> 1];
          case "i32":
            return HEAP32[ptr >> 2];
          case "i64":
            abort("getValue(i64)");
            return 0;
          case "float":
            return HEAPF32[ptr >> 2];
          case "double":
            return HEAPF64[ptr >> 3];
          case "*":
            return HEAPU32[ptr >> 2];
          default:
            abort(`invalid type for getValue: ${type}`);
            return 0;
        }
      };
      const setValue = (ptr, value, type = "i8") => {
        /* ... as in previous correct version ... */
        if (!HEAPU8) return;
        if (type.endsWith("*")) type = "*";
        switch (type) {
          case "i1":
            HEAP8[ptr] = value;
            break;
          case "i8":
            HEAP8[ptr] = value;
            break;
          case "i16":
            HEAP16[ptr >> 1] = value;
            break;
          case "i32":
            HEAP32[ptr >> 2] = value;
            break;
          case "i64":
            abort("setValue(i64)");
            break;
          case "float":
            HEAPF32[ptr >> 2] = value;
            break;
          case "double":
            HEAPF64[ptr >> 3] = value;
            break;
          case "*":
            HEAPU32[ptr >> 2] = value;
            break;
          default:
            abort(`invalid type for setValue: ${type}`);
        }
      };
      const UTF8Decoder =
        typeof TextDecoder != "undefined" ? new TextDecoder("utf8") : undefined;
      const UTF8ArrayToString = (
        heapOrArray,
        idx = 0,
        maxBytesToRead = Infinity,
      ) => {
        /* ... as in previous correct version ... */
        var endIdx = Math.min(idx + maxBytesToRead, heapOrArray.length);
        var endPtr = idx;
        while (heapOrArray[endPtr] && endPtr < endIdx) ++endPtr;
        if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
          return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
        } else {
          var str = "";
          while (idx < endPtr) {
            var u0 = heapOrArray[idx++];
            if (!(u0 & 128)) {
              str += String.fromCharCode(u0);
              continue;
            }
            var u1 = heapOrArray[idx++] & 63;
            if ((u0 & 224) == 192) {
              str += String.fromCharCode(((u0 & 31) << 6) | u1);
              continue;
            }
            var u2 = heapOrArray[idx++] & 63;
            if ((u0 & 240) == 224) {
              u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
            } else {
              u0 =
                ((u0 & 7) << 18) |
                (u1 << 12) |
                (u2 << 6) |
                (heapOrArray[idx++] & 63);
            }
            if (u0 < 0x10000) {
              str += String.fromCharCode(u0);
            } else {
              var ch = u0 - 0x10000;
              str += String.fromCharCode(
                0xd800 | (ch >> 10),
                0xdc00 | (ch & 0x3ff),
              );
            }
          }
          return str;
        }
      };
      const UTF8ToString = (ptr, maxBytesToRead) =>
        ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : "";
      const stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {
        /* ... as in previous correct version ... */
        if (!(maxBytesToWrite > 0)) return 0;
        var startIdx = outIdx;
        var endIdx = outIdx + maxBytesToWrite - 1;
        for (var i = 0; i < str.length; ++i) {
          var u = str.charCodeAt(i);
          if (u >= 0xd800 && u <= 0xdfff) {
            var u1 = str.charCodeAt(++i);
            u = (0x10000 + ((u & 0x3ff) << 10)) | (u1 & 0x3ff);
          }
          if (u <= 0x7f) {
            if (outIdx >= endIdx) break;
            heap[outIdx++] = u;
          } else if (u <= 0x7ff) {
            if (outIdx + 1 >= endIdx) break;
            heap[outIdx++] = 0xc0 | (u >> 6);
            heap[outIdx++] = 0x80 | (u & 63);
          } else if (u <= 0xffff) {
            if (outIdx + 2 >= endIdx) break;
            heap[outIdx++] = 0xe0 | (u >> 12);
            heap[outIdx++] = 0x80 | ((u >> 6) & 63);
            heap[outIdx++] = 0x80 | (u & 63);
          } else {
            if (outIdx + 3 >= endIdx) break;
            heap[outIdx++] = 0xf0 | (u >> 18);
            heap[outIdx++] = 0x80 | ((u >> 12) & 63);
            heap[outIdx++] = 0x80 | ((u >> 6) & 63);
            heap[outIdx++] = 0x80 | (u & 63);
          }
        }
        heap[outIdx] = 0;
        return outIdx - startIdx;
      };
      const stringToUTF8 = (str, outPtr, maxBytesToWrite) =>
        stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
      const lengthBytesUTF8 = (str) => {
        /* ... as in previous correct version ... */
        let len = 0;
        for (let i = 0; i < str.length; ++i) {
          let c = str.charCodeAt(i);
          if (c <= 0x7f) {
            len++;
          } else if (c <= 0x7ff) {
            len += 2;
          } else if (c >= 0xd800 && c <= 0xdfff) {
            len += 4;
            ++i;
          } else {
            len += 3;
          }
        }
        return len;
      };

      // Assign mapped WASM functions to Module object
      // Using the export names ('q', 'r', etc.) presumed from previous attempts
      Module["_free"] = wasmExports["q"];
      Module["_malloc"] = wasmExports["V"];
      Module["_rubberband_new"] = wasmExports["r"];
      Module["_rubberband_delete"] = wasmExports["s"];
      Module["_rubberband_reset"] = wasmExports["t"];
      Module["_rubberband_get_engine_version"] = wasmExports["u"];
      Module["_rubberband_set_time_ratio"] = wasmExports["v"];
      Module["_rubberband_set_pitch_scale"] = wasmExports["w"];
      Module["_rubberband_get_time_ratio"] = wasmExports["x"];
      Module["_rubberband_get_pitch_scale"] = wasmExports["y"];
      Module["_rubberband_set_formant_scale"] = wasmExports["z"];
      Module["_rubberband_get_formant_scale"] = wasmExports["A"];
      Module["_rubberband_get_preferred_start_pad"] = wasmExports["B"];
      Module["_rubberband_get_start_delay"] = wasmExports["C"];
      Module["_rubberband_get_latency"] = wasmExports["D"];
      Module["_rubberband_set_transients_option"] = wasmExports["E"];
      Module["_rubberband_set_detector_option"] = wasmExports["F"];
      Module["_rubberband_set_phase_option"] = wasmExports["G"];
      Module["_rubberband_set_formant_option"] = wasmExports["H"];
      Module["_rubberband_set_pitch_option"] = wasmExports["I"];
      Module["_rubberband_set_expected_input_duration"] = wasmExports["J"];
      Module["_rubberband_get_samples_required"] = wasmExports["K"];
      Module["_rubberband_set_max_process_size"] = wasmExports["L"];
      Module["_rubberband_set_key_frame_map"] = wasmExports["M"];
      Module["_rubberband_study"] = wasmExports["N"];
      Module["_rubberband_process"] = wasmExports["O"];
      Module["_rubberband_available"] = wasmExports["P"];
      Module["_rubberband_retrieve"] = wasmExports["Q"];
      Module["_rubberband_get_channel_count"] = wasmExports["R"];
      Module["_rubberband_calculate_stretch"] = wasmExports["S"];
      Module["_rubberband_set_debug_level"] = wasmExports["T"];
      Module["_rubberband_set_default_debug_level"] = wasmExports["U"];

      // Assign Stack functions (CRITICAL)
      __emscripten_stack_alloc = wasmExports["X"];
      __emscripten_stack_restore = wasmExports["W"];
      _emscripten_stack_get_current = wasmExports["Y"];
      stackSave = _emscripten_stack_get_current;
      stackRestore = __emscripten_stack_restore;
      stackAlloc = __emscripten_stack_alloc;
      Module["stackSave"] = stackSave;
      Module["stackRestore"] = stackRestore;
      Module["stackAlloc"] = stackAlloc;

      // Assign locally defined helpers to Module object
      Module["getValue"] = getValue;
      Module["setValue"] = setValue;
      Module["UTF8ToString"] = UTF8ToString;
      Module["stringToUTF8"] = stringToUTF8;
      Module["lengthBytesUTF8"] = lengthBytesUTF8;

      // *** ADD RUBBERBAND OPTIONS FLAGS ***
      Module.RubberBandOptionFlag = {
        ProcessOffline: 0x00000000,
        ProcessRealTime: 0x00000001,
        StretchElastic: 0x00000000,
        StretchPrecise: 0x00000010,
        TransientsCrisp: 0x00000000,
        TransientsMixed: 0x00000100,
        TransientsSmooth: 0x00000200,
        DetectorCompound: 0x00000000,
        DetectorPercussive: 0x00000400,
        DetectorSoft: 0x00000800,
        PhaseLaminar: 0x00000000,
        PhaseIndependent: 0x00002000,
        ThreadingAuto: 0x00000000,
        ThreadingNever: 0x00010000,
        ThreadingAlways: 0x00020000,
        WindowStandard: 0x00000000,
        WindowShort: 0x00100000,
        WindowLong: 0x00200000,
        SmoothingOff: 0x00000000,
        SmoothingOn: 0x00800000,
        FormantShifted: 0x00000000,
        FormantPreserved: 0x01000000,
        PitchHighSpeed: 0x00000000,
        PitchHighQuality: 0x02000000,
        PitchHighConsistency: 0x04000000,
        ChannelsApart: 0x00000000,
        ChannelsTogether: 0x10000000,
        EngineFaster: 0x00000000,
        EngineFiner: 0x20000000,
        // Add presets too if desired
        // DefaultOptions: 0x00000000, PercussiveOptions: 0x00102000,
        // Convenience aliases from your example (might be slightly different from direct enum names)
        EngineDefault: 0, // Alias for EngineFaster
        // PitchHighQuality: 0x02000000, // Already defined above
      };
      // Make sure the specific options used in the processor are available
      // These are just copies/aliases for clarity if the names differ slightly.
      Module.RubberbandOptions = Module.RubberBandOptionFlag; // Alias the whole object
    } // End assignExports

    // --- Start the process ---
    addOnInit(assignExports); // Queue exports assignment
    createWasm(); // Start WASM loading (async)

    moduleRtn = readyPromise;
    return moduleRtn; // Return the promise that resolves with the Module object
  }; // <--- Inner async function is RETURNED, not invoked here
})(); // Outer IIFE is invoked immediately

// NO export default
// --- END OF FILE rubberband.js ---
