/*
 * qr-encoder.js -- minimal offline QR Code generator for the COMEDY ATLAS
 * poster maker (poster.html). No network, no dependencies.
 *
 * MIT License
 *
 * Copyright (c) 2026 COMEDY ATLAS / Paris Comedy
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * PROVENANCE: written from the public ISO/IEC 18004 algorithm, because the
 * build machine had no network to fetch a third-party library. Scope: byte
 * mode only, versions 1-10, error correction L or M (M is tried first).
 * That fits any ticket URL up to about 213 characters (271 at level L).
 * Checked module-for-module against the Python "qrcode" package for every
 * mask pattern (see the poster maker build notes).
 *
 * API: AtlasQR.encode(text, forcedMask) ->
 *   { size, version, ecc, mask, get(x, y) -> boolean (true = dark) }
 *   or null when the text is empty or too long. forcedMask (0-7) is only
 *   for testing; leave it out to pick the best mask automatically.
 */
(function (root) {
  "use strict";

  var ECC_PER_BLOCK = {
    L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
    M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
  };
  var NUM_BLOCKS = {
    L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
    M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
  };
  var FORMAT_BITS = { L: 1, M: 0 };
  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  function utf8(text) {
    if (typeof TextEncoder !== "undefined") {
      return Array.prototype.slice.call(new TextEncoder().encode(text));
    }
    var s = unescape(encodeURIComponent(text)), out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  function rawDataModules(v) {
    var r = (16 * v + 128) * v + 64;
    if (v >= 2) {
      var na = Math.floor(v / 7) + 2;
      r -= (25 * na - 10) * na - 55;
      if (v >= 7) r -= 36;
    }
    return r;
  }

  function dataCodewords(v, ecc) {
    return Math.floor(rawDataModules(v) / 8) - ECC_PER_BLOCK[ecc][v] * NUM_BLOCKS[ecc][v];
  }

  // ---- Reed-Solomon over GF(256), polynomial 0x11D
  var EXP = [], LOG = [];
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  function rsGenerator(deg) {
    var g = [1];
    for (var i = 0; i < deg; i++) {
      var next = [];
      for (var k = 0; k <= g.length; k++) next.push(0);
      for (var j = 0; j < g.length; j++) {
        next[j] ^= g[j];
        next[j + 1] ^= gmul(g[j], EXP[i]);
      }
      g = next;
    }
    return g; // highest degree first, leading coefficient 1
  }

  function rsRemainder(data, deg) {
    var gen = rsGenerator(deg);
    var rem = [];
    for (var i = 0; i < deg; i++) rem.push(0);
    data.forEach(function (b) {
      var factor = b ^ rem.shift();
      rem.push(0);
      for (var k = 0; k < deg; k++) rem[k] ^= gmul(gen[k + 1], factor);
    });
    return rem;
  }

  function bit(x, i) { return ((x >>> i) & 1) !== 0; }

  function buildCodewords(bytes, v, ecc) {
    var cap = dataCodewords(v, ecc);
    var bits = [];
    function push(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    push(4, 4);                       // byte mode
    push(bytes.length, v >= 10 ? 16 : 8);
    bytes.forEach(function (b) { push(b, 8); });
    var capBits = cap * 8;
    push(0, Math.min(4, capBits - bits.length));
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
      data.push(b);
    }
    for (var pad = 0xEC; data.length < cap; pad ^= 0xEC ^ 0x11) data.push(pad);

    var nb = NUM_BLOCKS[ecc][v], eccLen = ECC_PER_BLOCK[ecc][v];
    var rawCw = Math.floor(rawDataModules(v) / 8);
    var shortLen = Math.floor(rawCw / nb), numShort = nb - rawCw % nb;
    var blocks = [], p = 0;
    for (var bi = 0; bi < nb; bi++) {
      var dl = shortLen - eccLen + (bi < numShort ? 0 : 1);
      var dat = data.slice(p, p + dl);
      p += dl;
      var e = rsRemainder(dat, eccLen);
      if (bi < numShort) dat.push(0);
      blocks.push(dat.concat(e));
    }
    var out = [];
    for (var x = 0; x < blocks[0].length; x++) {
      for (var j = 0; j < nb; j++) {
        if (x !== shortLen - eccLen || j >= numShort) out.push(blocks[j][x]);
      }
    }
    return out;
  }

  function Matrix(v) {
    this.v = v;
    this.size = v * 4 + 17;
    this.m = [];
    this.fn = [];
    for (var y = 0; y < this.size; y++) {
      var r = [], f = [];
      for (var x = 0; x < this.size; x++) { r.push(false); f.push(false); }
      this.m.push(r); this.fn.push(f);
    }
  }
  Matrix.prototype.setFn = function (x, y, dark) {
    this.m[y][x] = dark; this.fn[y][x] = true;
  };
  Matrix.prototype.drawFinder = function (cx, cy) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.setFn(x, y, d !== 2 && d !== 4);
      }
    }
  };
  Matrix.prototype.drawAlign = function (cx, cy) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        this.setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };
  Matrix.prototype.drawFormat = function (ecc, mask) {
    var data = (FORMAT_BITS[ecc] << 3) | mask, rem = data, i, s = this.size;
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    for (i = 0; i <= 5; i++) this.setFn(8, i, bit(bits, i));
    this.setFn(8, 7, bit(bits, 6));
    this.setFn(8, 8, bit(bits, 7));
    this.setFn(7, 8, bit(bits, 8));
    for (i = 9; i < 15; i++) this.setFn(14 - i, 8, bit(bits, i));
    for (i = 0; i < 8; i++) this.setFn(s - 1 - i, 8, bit(bits, i));
    for (i = 8; i < 15; i++) this.setFn(8, s - 15 + i, bit(bits, i));
    this.setFn(8, s - 8, true);
  };
  Matrix.prototype.drawFunctionPatterns = function () {
    var s = this.size, i, j;
    for (i = 0; i < s; i++) { this.setFn(6, i, i % 2 === 0); this.setFn(i, 6, i % 2 === 0); }
    this.drawFinder(3, 3); this.drawFinder(s - 4, 3); this.drawFinder(3, s - 4);
    var pos = ALIGN[this.v], n = pos.length;
    for (i = 0; i < n; i++) {
      for (j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        this.drawAlign(pos[i], pos[j]);
      }
    }
    this.drawFormat("L", 0); // placeholder, redrawn after the mask is chosen
    if (this.v >= 7) {
      var rem = this.v;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var bits = (this.v << 12) | rem;
      for (i = 0; i < 18; i++) {
        var a = s - 11 + (i % 3), b = Math.floor(i / 3), c = bit(bits, i);
        this.setFn(a, b, c); this.setFn(b, a, c);
      }
    }
  };
  Matrix.prototype.drawCodewords = function (data) {
    var s = this.size, i = 0;
    for (var right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < s; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j, upward = ((right + 1) & 2) === 0;
          var y = upward ? s - 1 - vert : vert;
          if (!this.fn[y][x] && i < data.length * 8) {
            this.m[y][x] = bit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  };
  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x, y) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return x * y % 2 + x * y % 3 === 0; },
    function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
  ];
  Matrix.prototype.applyMask = function (mask) {
    var f = MASKS[mask];
    for (var y = 0; y < this.size; y++) {
      for (var x = 0; x < this.size; x++) {
        if (!this.fn[y][x] && f(x, y)) this.m[y][x] = !this.m[y][x];
      }
    }
  };
  Matrix.prototype.penalty = function () {
    var s = this.size, m = this.m, total = 0, x, y, k;
    function runs(get) {
      var p = 0, i, j;
      for (i = 0; i < s; i++) {
        var run = 1, line = "";
        for (j = 0; j < s; j++) {
          var c = get(i, j);
          line += c ? "1" : "0";
          if (j > 0) {
            if (c === get(i, j - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; }
            else run = 1;
          }
        }
        var re = /10111010000|00001011101/g, mm;
        while ((mm = re.exec(line)) !== null) { p += 40; re.lastIndex = mm.index + 1; }
      }
      return p;
    }
    total += runs(function (i, j) { return m[i][j]; });
    total += runs(function (i, j) { return m[j][i]; });
    var dark = 0;
    for (y = 0; y < s; y++) {
      for (x = 0; x < s; x++) {
        if (m[y][x]) dark++;
        if (x < s - 1 && y < s - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) total += 3;
      }
    }
    k = Math.ceil(Math.abs(dark * 20 - s * s * 10) / (s * s)) - 1;
    total += Math.max(0, k) * 10;
    return total;
  };

  function build(bytes, v, ecc, forcedMask) {
    var cw = buildCodewords(bytes, v, ecc);
    var mx = new Matrix(v);
    mx.drawFunctionPatterns();
    mx.drawCodewords(cw);
    var best = -1, bestPen = Infinity, mask;
    if (forcedMask >= 0 && forcedMask <= 7) {
      best = forcedMask;
    } else {
      for (mask = 0; mask < 8; mask++) {
        mx.applyMask(mask);
        mx.drawFormat(ecc, mask);
        var pen = mx.penalty();
        if (pen < bestPen) { bestPen = pen; best = mask; }
        mx.applyMask(mask); // undo
      }
    }
    mx.applyMask(best);
    mx.drawFormat(ecc, best);
    return { size: mx.size, version: v, ecc: ecc, mask: best,
      get: function (x, y) { return x >= 0 && y >= 0 && x < mx.size && y < mx.size && mx.m[y][x]; } };
  }

  function encode(text, forcedMask) {
    if (!text) return null;
    var bytes = utf8(String(text));
    var levels = ["M", "L"];
    for (var li = 0; li < levels.length; li++) {
      for (var v = 1; v <= 10; v++) {
        var lenBits = v >= 10 ? 16 : 8;
        if (4 + lenBits + bytes.length * 8 <= dataCodewords(v, levels[li]) * 8) {
          return build(bytes, v, levels[li], forcedMask === undefined ? -1 : forcedMask);
        }
      }
    }
    return null;
  }

  root.AtlasQR = { encode: encode };
})(typeof window !== "undefined" ? window : globalThis);
