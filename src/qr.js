/*!
 * qr3d / qr.js - QR Code encoder, byte mode, versions 1 to 40.
 *
 * Written from scratch for https://qr3dcraft.com - no dependencies, no DOM,
 * runs the same in Node and in the browser.
 *
 * It does the whole standard: the four error-correction levels, Reed-Solomon
 * over GF(256), block interleaving, the alignment-pattern grid, and it tries
 * all eight masks and keeps the one with the lowest penalty score, which is
 * what the spec asks for and what most small encoders skip.
 *
 * One behaviour worth knowing: ask for level M on a short string and you may
 * get Q back. The encoder picks the smallest version that fits and then, if
 * that version has room to spare, raises the correction level for free. The
 * returned object always tells you what you actually got, in `ecl`.
 *
 * MIT licensed. See LICENSE.
 */

const QRGen = (function () {
  const ECL_IDX = { L: 0, M: 1, Q: 2, H: 3 };
  const FMT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  const ECC_CW = [
    [-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
    [-1,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    [-1,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30]
  ];
  const NUM_BLK = [
    [-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],
    [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],
    [-1,1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],
    [-1,1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81]
  ];

  function rawDataModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(ver, e) {
    return Math.floor(rawDataModules(ver) / 8) - ECC_CW[e][ver] * NUM_BLK[e][ver];
  }
  function alignPositions(ver) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2;
    const size = ver * 4 + 17;
    const step = (ver === 32) ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const out = [6];
    for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  /* --- aritmética en GF(256) --- */
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }
  function rsGenerator(deg) {
    const r = new Uint8Array(deg);
    r[deg - 1] = 1;
    let root = 1;
    for (let i = 0; i < deg; i++) {
      for (let j = 0; j < deg; j++) {
        r[j] = gfMul(r[j], root);
        if (j + 1 < deg) r[j] ^= r[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return r;
  }
  function rsRemainder(data, gen) {
    const res = new Uint8Array(gen.length);
    for (let k = 0; k < data.length; k++) {
      const factor = data[k] ^ res[0];
      res.copyWithin(0, 1);
      res[res.length - 1] = 0;
      for (let i = 0; i < res.length; i++) res[i] ^= gfMul(gen[i], factor);
    }
    return res;
  }

  function interleave(dataCw, ver, e) {
    const numBlocks = NUM_BLK[e][ver], eccLen = ECC_CW[e][ver];
    const rawCw = Math.floor(rawDataModules(ver) / 8);
    const shortLen = Math.floor(rawCw / numBlocks) - eccLen;
    const numShort = numBlocks - (rawCw % numBlocks);
    const gen = rsGenerator(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const len = shortLen + (i < numShort ? 0 : 1);
      const dat = dataCw.slice(k, k + len); k += len;
      blocks.push({ dat: dat, ecc: rsRemainder(dat, gen) });
    }
    const out = [];
    for (let i = 0; i <= shortLen; i++)
      for (let j = 0; j < numBlocks; j++)
        if (i < shortLen || j >= numShort) out.push(blocks[j].dat[i]);
    for (let i = 0; i < eccLen; i++)
      for (let j = 0; j < numBlocks; j++) out.push(blocks[j].ecc[i]);
    return Uint8Array.from(out);
  }

  function make(text, eclName) {
    const bytes = new TextEncoder().encode(text);
    let e = ECL_IDX[eclName] != null ? ECL_IDX[eclName] : 3;
    let ver = 0;
    for (let v = 1; v <= 40; v++) {
      const need = 4 + (v <= 9 ? 8 : 16) + bytes.length * 8;
      if (need <= dataCodewords(v, e) * 8) { ver = v; break; }
    }
    if (!ver) throw new Error("El contenido es demasiado largo para un código QR.");
    const need = 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8;
    for (let hi = 3; hi > e; hi--) {
      if (need <= dataCodewords(ver, hi) * 8) { e = hi; break; }
    }
    const eclOut = ["L", "M", "Q", "H"][e];

    /* --- bits de datos --- */
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4);
    push(bytes.length, ver <= 9 ? 8 : 16);
    for (let i = 0; i < bytes.length; i++) push(bytes[i], 8);
    const capBits = dataCodewords(ver, e) * 8;
    push(0, Math.min(4, capBits - bits.length));
    push(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xEC; bits.length < capBits; pad ^= 0xEC ^ 0x11) push(pad, 8);
    const dataCw = new Uint8Array(capBits / 8);
    for (let i = 0; i < bits.length; i++) dataCw[i >>> 3] |= bits[i] << (7 - (i & 7));
    const allCw = interleave(dataCw, ver, e);

    /* --- matriz --- */
    const size = ver * 4 + 17;
    const mod = new Uint8Array(size * size);
    const fn = new Uint8Array(size * size);
    const setFn = (x, y, v) => { mod[y * size + x] = v ? 1 : 0; fn[y * size + x] = 1; };
    const bitOf = (v, i) => (v >>> i) & 1;

    function finder(x, y) {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, d !== 2 && d !== 4);
      }
    }
    function align(x, y) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        setFn(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const ap = alignPositions(ver);
    for (let i = 0; i < ap.length; i++) for (let j = 0; j < ap.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
      align(ap[i], ap[j]);
    }
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const vb = ver << 12 | rem;
      for (let i = 0; i < 18; i++) {
        const b = bitOf(vb, i), a = size - 11 + i % 3, c = Math.floor(i / 3);
        setFn(a, c, b); setFn(c, a, b);
      }
    }
    function formatBits(mask) {
      const d = FMT_BITS[eclOut] << 3 | mask;
      let rem = d;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = ((d << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setFn(8, i, bitOf(b, i));
      setFn(8, 7, bitOf(b, 6)); setFn(8, 8, bitOf(b, 7)); setFn(7, 8, bitOf(b, 8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, bitOf(b, i));
      for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bitOf(b, i));
      for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bitOf(b, i));
      setFn(8, size - 8, 1);
    }
    formatBits(0);

    /* --- volcado de codewords en zigzag --- */
    let idx = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!fn[y * size + x] && idx < allCw.length * 8) {
            mod[y * size + x] = bitOf(allCw[idx >>> 3], 7 - (idx & 7));
            idx++;
          }
        }
      }
    }

    const maskFn = [
      (x, y) => (x + y) % 2 === 0,
      (x, y) => y % 2 === 0,
      (x, y) => x % 3 === 0,
      (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
      (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
      (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0
    ];
    function applyMask(m) {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
        if (!fn[y * size + x] && maskFn[m](x, y)) mod[y * size + x] ^= 1;
    }
    function penalty() {
      let p = 0;
      const at = (x, y) => mod[y * size + x];
      // regla 1: rachas de 5 o más
      for (let y = 0; y < size; y++) {
        let run = 1;
        for (let x = 1; x < size; x++) {
          if (at(x, y) === at(x - 1, y)) { run++; if (run === 5) p += 3; else if (run > 5) p++; }
          else run = 1;
        }
      }
      for (let x = 0; x < size; x++) {
        let run = 1;
        for (let y = 1; y < size; y++) {
          if (at(x, y) === at(x, y - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; }
          else run = 1;
        }
      }
      // regla 2: bloques 2x2
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
        const c = at(x, y);
        if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) p += 3;
      }
      // regla 3: patrón tipo localizador
      const pa = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
      const pb = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
      const match = (get, i, pat) => { for (let k = 0; k < 11; k++) if (get(i + k) !== pat[k]) return false; return true; };
      for (let y = 0; y < size; y++) {
        const get = i => at(i, y);
        for (let x = 0; x + 11 <= size; x++) { if (match(get, x, pa)) p += 40; if (match(get, x, pb)) p += 40; }
      }
      for (let x = 0; x < size; x++) {
        const get = i => at(x, i);
        for (let y = 0; y + 11 <= size; y++) { if (match(get, y, pa)) p += 40; if (match(get, y, pb)) p += 40; }
      }
      // regla 4: proporción de módulos oscuros
      let dark = 0;
      for (let i = 0; i < mod.length; i++) dark += mod[i];
      const total = size * size;
      p += 10 * Math.floor(Math.abs(dark * 100 / total - 50) / 5);
      return p;
    }

    let best = 0, bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); formatBits(m);
      const s = penalty();
      if (s < bestScore) { bestScore = s; best = m; }
      applyMask(m);
    }
    applyMask(best); formatBits(best);

    return {
      size: size,
      version: ver,
      ecl: eclOut,
      mask: best,
      get: (x, y) => (x < 0 || y < 0 || x >= size || y >= size) ? 0 : mod[y * size + x],
      isFinder: (x, y) =>
        (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7)
    };
  }

  return { make: make };
})();

/* Both module systems, because this file is meant to be dropped into a page
   with a <script> tag just as happily as imported in Node. */
if (typeof module !== "undefined" && module.exports) module.exports = QRGen;
if (typeof globalThis !== "undefined") globalThis.QRGen = QRGen;
