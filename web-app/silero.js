// --- START OF FILE silero.js ---
(function(global) {
  // onnxruntime-web should already be loaded and available as window.ort
  function Silero(session, sampleRate) {
    this.session = session;
    // Create a tensor holding the sample rate (as int64)
    this.sampleRate = new ort.Tensor("int64", [sampleRate]);
    // Initialize hidden state tensors (using 2x64 dimensions)
    this.c = new ort.Tensor("float32", new Float32Array(2 * 64).fill(0), [2, 1, 64]);
    this.h = new ort.Tensor("float32", new Float32Array(2 * 64).fill(0), [2, 1, 64]);
  }

  Silero.create = async function(sampleRate, uri) {
    uri = uri || "./model/silero_vad.onnx";
    const opt = {
      executionProviders: ["wasm"],
      logSeverityLevel: 3,
      logVerbosityLevel: 3
    };
    // Load the ONNX model from the given URI.
    const session = await ort.InferenceSession.create(uri, opt);
    return new Silero(session, sampleRate);
  };

  Silero.prototype.process = async function(audio) {
    // Create a tensor from the provided audio frame
    const t = new ort.Tensor("float32", audio, [1, audio.length]);
    const input = {
      input: t,
      h: this.h,
      c: this.c,
      sr: this.sampleRate
    };
    const output = await this.session.run(input);
    // Update the internal states
    this.h = output.hn;
    this.c = output.cn;
    // Assume the model returns a single probability value.
    return output.output.data[0];
  };

  // Expose Silero to the global scope.
  global.Silero = Silero;
})(window);
// --- END OF FILE silero.js ---
