// --- START OF FILE fft.js ---
'use strict';

// =============================================
// == Fast Fourier Transform (FFT) Library ==
// Based on https://github.com/indutny/fft.js
// Adapted for direct browser use (global FFT constructor)
// =============================================

function FFT(size) {
  this.size = size | 0;
  if (this.size <= 1 || (this.size & (this.size - 1)) !== 0)
    throw new Error('FFT size must be a power of two and bigger than 1');

  this._csize = size << 1;

  // NOTE: Use of `var` is intentional for old V8 versions compatibility
  var table = new Array(this.size * 2);
  for (var i = 0; i < table.length; i += 2) {
    const angle = Math.PI * i / this.size;
    table[i] = Math.cos(angle);
    table[i + 1] = -Math.sin(angle);
  }
  this.table = table;

  // Find size's power of two
  var power = 0;
  for (var t = 1; this.size > t; t <<= 1)
    power++;

  // Calculate initial step's width:
  //   * If we are full radix-4 - it is 2x smaller to give inital len=8
  //   * Otherwise it is the same as `power` to give len=4
  this._width = power % 2 === 0 ? power - 1 : power;

  // Pre-compute bit-reversal patterns
  this._bitrev = new Array(1 << this._width);
  for (var j = 0; j < this._bitrev.length; j++) {
    this._bitrev[j] = 0;
    for (var shift = 0; shift < this._width; shift += 2) {
      var revShift = this._width - shift - 2;
      this._bitrev[j] |= ((j >>> shift) & 3) << revShift;
    }
  }

  this._out = null;
  this._data = null;
  this._inv = 0;
}
// NOTE: No module.exports needed for browser global script

// --- FFT Utility Methods ---

FFT.prototype.fromComplexArray = function fromComplexArray(complex, storage) {
  var res = storage || new Array(complex.length >>> 1);
  for (var i = 0; i < complex.length; i += 2)
    res[i >>> 1] = complex[i];
  return res;
};

FFT.prototype.createComplexArray = function createComplexArray() {
  const res = new Array(this._csize);
  for (var i = 0; i < res.length; i++)
    res[i] = 0;
  return res;
};

FFT.prototype.toComplexArray = function toComplexArray(input, storage) {
  var res = storage || this.createComplexArray();
  for (var i = 0; i < res.length; i += 2) {
    res[i] = input[i >>> 1];
    res[i + 1] = 0;
  }
  return res;
};

FFT.prototype.completeSpectrum = function completeSpectrum(spectrum) {
  var size = this._csize;
  var half = size >>> 1;
  for (var i = 2; i < half; i += 2) {
    spectrum[size - i] = spectrum[i];
    spectrum[size - i + 1] = -spectrum[i + 1];
  }
};

// --- FFT Core Transform Methods ---

FFT.prototype.transform = function transform(out, data) {
  if (out === data)
    throw new Error('Input and output buffers must be different');

  this._out = out;
  this._data = data;
  this._inv = 0;
  this._transform4();
  this._out = null;
  this._data = null;
};

FFT.prototype.realTransform = function realTransform(out, data) {
  if (out === data)
    throw new Error('Input and output buffers must be different');

  this._out = out;
  this._data = data;
  this._inv = 0;
  this._realTransform4();
  this._out = null;
  this._data = null;
};

FFT.prototype.inverseTransform = function inverseTransform(out, data) {
  if (out === data)
    throw new Error('Input and output buffers must be different');

  this._out = out;
  this._data = data;
  this._inv = 1;
  this._transform4();
  for (var i = 0; i < out.length; i++)
    out[i] /= this.size;
  this._out = null;
  this._data = null;
};

// --- FFT Internal Radix Implementations ---
// (These are complex internal details of the FFT algorithm)

// radix-4 implementation
FFT.prototype._transform4 = function _transform4() {
  var out = this._out;
  var size = this._csize;
  var width = this._width;
  var step = 1 << width;
  var len = (size / step) << 1;
  var bitrev = this._bitrev;
  var outOff, t;

  if (len === 4) {
    for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
      const off = bitrev[t];
      this._singleTransform2(outOff, off, step);
    }
  } else { // len === 8
    for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
      const off = bitrev[t];
      this._singleTransform4(outOff, off, step);
    }
  }

  var inv = this._inv ? -1 : 1;
  var table = this.table;
  for (step >>= 2; step >= 2; step >>= 2) {
    len = (size / step) << 1;
    var quarterLen = len >>> 2;

    for (outOff = 0; outOff < size; outOff += len) {
      var limit = outOff + quarterLen;
      for (var i = outOff, k = 0; i < limit; i += 2, k += step) {
        const A = i, B = A + quarterLen, C = B + quarterLen, D = C + quarterLen;
        const Ar = out[A], Ai = out[A + 1], Br = out[B], Bi = out[B + 1];
        const Cr = out[C], Ci = out[C + 1], Dr = out[D], Di = out[D + 1];

        const MAr = Ar, MAi = Ai;
        const tableBr = table[k], tableBi = inv * table[k + 1];
        const MBr = Br * tableBr - Bi * tableBi, MBi = Br * tableBi + Bi * tableBr;
        const tableCr = table[2 * k], tableCi = inv * table[2 * k + 1];
        const MCr = Cr * tableCr - Ci * tableCi, MCi = Cr * tableCi + Ci * tableCr;
        const tableDr = table[3 * k], tableDi = inv * table[3 * k + 1];
        const MDr = Dr * tableDr - Di * tableDi, MDi = Dr * tableDi + Di * tableDr;

        const T0r = MAr + MCr, T0i = MAi + MCi, T1r = MAr - MCr, T1i = MAi - MCi;
        const T2r = MBr + MDr, T2i = MBi + MDi, T3r = inv * (MBr - MDr), T3i = inv * (MBi - MDi);

        const FAr = T0r + T2r, FAi = T0i + T2i, FCr = T0r - T2r, FCi = T0i - T2i;
        const FBr = T1r + T3i, FBi = T1i - T3r, FDr = T1r - T3i, FDi = T1i + T3r;

        out[A] = FAr; out[A + 1] = FAi; out[B] = FBr; out[B + 1] = FBi;
        out[C] = FCr; out[C + 1] = FCi; out[D] = FDr; out[D + 1] = FDi;
      }
    }
  }
};

// radix-2 implementation (called for len=4)
FFT.prototype._singleTransform2 = function _singleTransform2(outOff, off, step) {
  const out = this._out, data = this._data;
  const evenR = data[off], evenI = data[off + 1];
  const oddR = data[off + step], oddI = data[off + step + 1];
  const leftR = evenR + oddR, leftI = evenI + oddI;
  const rightR = evenR - oddR, rightI = evenI - oddI;
  out[outOff] = leftR; out[outOff + 1] = leftI;
  out[outOff + 2] = rightR; out[outOff + 3] = rightI;
};

// radix-4 implementation (called for len=8)
FFT.prototype._singleTransform4 = function _singleTransform4(outOff, off, step) {
  const out = this._out, data = this._data;
  const inv = this._inv ? -1 : 1;
  const step2 = step * 2, step3 = step * 3;
  const Ar = data[off], Ai = data[off + 1], Br = data[off + step], Bi = data[off + step + 1];
  const Cr = data[off + step2], Ci = data[off + step2 + 1], Dr = data[off + step3], Di = data[off + step3 + 1];
  const T0r = Ar + Cr, T0i = Ai + Ci, T1r = Ar - Cr, T1i = Ai - Ci;
  const T2r = Br + Dr, T2i = Bi + Di, T3r = inv * (Br - Dr), T3i = inv * (Bi - Di);
  const FAr = T0r + T2r, FAi = T0i + T2i, FBr = T1r + T3i, FBi = T1i - T3r;
  const FCr = T0r - T2r, FCi = T0i - T2i, FDr = T1r - T3i, FDi = T1i + T3r;
  out[outOff] = FAr; out[outOff + 1] = FAi; out[outOff + 2] = FBr; out[outOff + 3] = FBi;
  out[outOff + 4] = FCr; out[outOff + 5] = FCi; out[outOff + 6] = FDr; out[outOff + 7] = FDi;
};

// Real input radix-4 implementation
FFT.prototype._realTransform4 = function _realTransform4() {
  var out = this._out;
  var size = this._csize;
  var width = this._width;
  var step = 1 << width;
  var len = (size / step) << 1;
  var bitrev = this._bitrev;
  var outOff, t;

  if (len === 4) {
    for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
      const off = bitrev[t];
      this._singleRealTransform2(outOff, off >>> 1, step >>> 1);
    }
  } else { // len === 8
    for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
      const off = bitrev[t];
      this._singleRealTransform4(outOff, off >>> 1, step >>> 1);
    }
  }

  var inv = this._inv ? -1 : 1;
  var table = this.table;
  for (step >>= 2; step >= 2; step >>= 2) {
    len = (size / step) << 1;
    var halfLen = len >>> 1, quarterLen = halfLen >>> 1, hquarterLen = quarterLen >>> 1;

    for (outOff = 0; outOff < size; outOff += len) {
      for (var i = 0, k = 0; i <= hquarterLen; i += 2, k += step) {
        var A = outOff + i, B = A + quarterLen, C = B + quarterLen, D = C + quarterLen;
        var Ar = out[A], Ai = out[A + 1], Br = out[B], Bi = out[B + 1];
        var Cr = out[C], Ci = out[C + 1], Dr = out[D], Di = out[D + 1];

        var MAr = Ar, MAi = Ai;
        var tableBr = table[k], tableBi = inv * table[k + 1];
        var MBr = Br * tableBr - Bi * tableBi, MBi = Br * tableBi + Bi * tableBr;
        var tableCr = table[2 * k], tableCi = inv * table[2 * k + 1];
        var MCr = Cr * tableCr - Ci * tableCi, MCi = Cr * tableCi + Ci * tableCr;
        var tableDr = table[3 * k], tableDi = inv * table[3 * k + 1];
        var MDr = Dr * tableDr - Di * tableDi, MDi = Dr * tableDi + Di * tableDr;

        var T0r = MAr + MCr, T0i = MAi + MCi, T1r = MAr - MCr, T1i = MAi - MCi;
        var T2r = MBr + MDr, T2i = MBi + MDi, T3r = inv * (MBr - MDr), T3i = inv * (MBi - MDi);

        var FAr = T0r + T2r, FAi = T0i + T2i, FBr = T1r + T3i, FBi = T1i - T3r;
        out[A] = FAr; out[A + 1] = FAi; out[B] = FBr; out[B + 1] = FBi;

        if (i === 0) { // Output final middle point
          var FCr = T0r - T2r, FCi = T0i - T2i;
          out[C] = FCr; out[C + 1] = FCi;
          continue;
        }
        if (i === hquarterLen) continue; // Do not overwrite ourselves

        // In the flipped case: calculations for mirrored frequencies
        var ST0r = T1r, ST0i = -T1i, ST1r = T0r, ST1i = -T0i;
        var ST2r = -inv * T3i, ST2i = -inv * T3r, ST3r = -inv * T2i, ST3i = -inv * T2r;
        var SFAr = ST0r + ST2r, SFAi = ST0i + ST2i, SFBr = ST1r + ST3i, SFBi = ST1i - ST3r;
        var SA = outOff + quarterLen - i, SB = outOff + halfLen - i;
        out[SA] = SFAr; out[SA + 1] = SFAi; out[SB] = SFBr; out[SB + 1] = SFBi;
      }
    }
  }
};

// Real input radix-2 (called for len=4)
FFT.prototype._singleRealTransform2 = function _singleRealTransform2(outOff, off, step) {
  const out = this._out, data = this._data;
  const evenR = data[off], oddR = data[off + step];
  const leftR = evenR + oddR, rightR = evenR - oddR;
  out[outOff] = leftR; out[outOff + 1] = 0;
  out[outOff + 2] = rightR; out[outOff + 3] = 0;
};

// Real input radix-4 (called for len=8)
FFT.prototype._singleRealTransform4 = function _singleRealTransform4(outOff, off, step) {
  const out = this._out, data = this._data;
  const inv = this._inv ? -1 : 1;
  const step2 = step * 2, step3 = step * 3;
  const Ar = data[off], Br = data[off + step], Cr = data[off + step2], Dr = data[off + step3];
  const T0r = Ar + Cr, T1r = Ar - Cr, T2r = Br + Dr, T3r = inv * (Br - Dr);
  const FAr = T0r + T2r, FBr = T1r, FBi = -T3r, FCr = T0r - T2r, FDr = T1r, FDi = T3r;
  out[outOff] = FAr; out[outOff + 1] = 0; out[outOff + 2] = FBr; out[outOff + 3] = FBi;
  out[outOff + 4] = FCr; out[outOff + 5] = 0; out[outOff + 6] = FDr; out[outOff + 7] = FDi;
};

// --- END OF FILE fft.js ---