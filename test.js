/* Tests. No framework: `node test.js` and read the output.
 *
 * The one that matters is the mirror test. A mirrored QR is the failure that
 * survives every other check - the file opens, the slicer is happy, the print
 * looks perfect and no phone on earth reads it. So the plate is rebuilt back
 * into a matrix from its own boxes and compared module by module against the
 * encoder's. */

"use strict";

var QRGen = require("./src/qr.js");
var P = require("./src/plate.js");

var fallos = 0, hechas = 0;

function ok(nombre, cond, extra) {
  hechas++;
  if (cond) { console.log("  ok    " + nombre); return; }
  fallos++;
  console.log("  FALLA " + nombre + (extra ? "  -> " + extra : ""));
}

/* --------------------------------------------------------------- encoder */
console.log("\nencoder");

/* This URL is test DATA, not a link: its length is what makes the code come
   out 33x33 at version 4, which the next three checks assert. Do not "update"
   it to a newer address - a different length moves the version and the tests
   fail for a reason that has nothing to do with the encoder. */
var q = QRGen.make("https://qr3dcraft.com/tamano-minimo-qr-3d.html", "M");
ok("33x33 for a 46-character URL", q.size === 33, "got " + q.size);
ok("version 4", q.version === 4, "got " + q.version);
ok("asked M, got Q for free", q.ecl === "Q", "got " + q.ecl);
ok("mask is one of the eight", q.mask >= 0 && q.mask <= 7, "got " + q.mask);

var finders = [[0, 0], [q.size - 7, 0], [0, q.size - 7]];
var finderOK = finders.every(function (f) {
  for (var y = 0; y < 7; y++) for (var x = 0; x < 7; x++) {
    var borde = (x === 0 || x === 6 || y === 0 || y === 6);
    var centro = (x >= 2 && x <= 4 && y >= 2 && y <= 4);
    var esperado = borde || centro ? 1 : 0;
    if (q.get(f[0] + x, f[1] + y) !== esperado) return false;
  }
  return true;
});
ok("the three finder patterns are intact", finderOK);
ok("out of bounds reads as light", q.get(-1, 0) === 0 && q.get(0, q.size) === 0);

var vacio = QRGen.make("a", "L");
ok("one character still encodes", vacio.size === 21, "got " + vacio.size);
var largo = QRGen.make(new Array(400).join("x"), "L");
ok("400 characters pick a bigger version", largo.size > 33, "got " + largo.size);

/* ----------------------------------------------------------------- plate */
console.log("\nplate");

var p = P.plate(q, { size: 60 });
ok("module size is side / (modules + 2 x quiet zone)",
  Math.abs(p.module - 60 / (33 + 4)) < 1e-9, p.module);
ok("height is base + relief", Math.abs(p.height - 3.2) < 1e-9, p.height);
ok("merging beats one box per module", p.boxes < 300, p.boxes + " boxes");
ok("twelve triangles per box", p.triangles === p.boxes * 12,
  p.triangles + " for " + p.boxes);

/* ------------------------------------------------------- the mirror test */
console.log("\nnot mirrored");

var mod = p.module, zona = 2 * mod, limpio = true, discrepancias = 0;
var rejilla = [];
for (var i = 0; i < q.size; i++) rejilla.push(new Array(q.size).fill(0));

p.mesh.tris.forEach(function (t) {
  /* only the triangles of the raised slab describe the code */
  var zmax = Math.max(t[2], t[5], t[8]);
  if (zmax < 3.1) return;
  var xs = [t[0], t[3], t[6]], ys = [t[1], t[4], t[7]];
  var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
  var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
  if (x1 - x0 < 1e-9 || y1 - y0 < 1e-9) return;      /* a side face */
  var cx = Math.round((x0 - zona) / mod), ancho = Math.round((x1 - x0) / mod);
  var fila = q.size - 1 - Math.round((y0 - zona) / mod);
  for (var k = 0; k < ancho; k++) {
    if (fila < 0 || fila >= q.size || cx + k < 0 || cx + k >= q.size) { limpio = false; return; }
    rejilla[fila][cx + k] = 1;
  }
});

for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) {
  if (rejilla[y][x] !== q.get(x, y)) discrepancias++;
}
ok("every box lands inside the plate", limpio);
ok("the plate rebuilt from its own geometry equals the matrix",
  discrepancias === 0, discrepancias + " modules differ");

/* the asymmetric corner: a mirrored plate would move the lone finder */
var abajoIzq = rejilla[q.size - 1][0], arribaDer = rejilla[0][q.size - 1];
ok("the corner without a finder stays where it was",
  abajoIzq === q.get(0, q.size - 1) && arribaDer === q.get(q.size - 1, 0));

/* ------------------------------------------------------------------- STL */
console.log("\nSTL");

var stl = p.toSTL("test");
ok("84 bytes of header plus 50 per triangle",
  stl.length === 84 + p.triangles * 50, stl.length);
var dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
ok("the count in the header matches the body",
  dv.getUint32(80, true) === p.triangles, dv.getUint32(80, true));

var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
for (var t2 = 0; t2 < p.triangles; t2++) {
  for (var v = 0; v < 3; v++) for (var c = 0; c < 3; c++) {
    var f = dv.getFloat32(84 + t2 * 50 + 12 + v * 12 + c * 4, true);
    if (f < mn[c]) mn[c] = f;
    if (f > mx[c]) mx[c] = f;
  }
}
ok("the bounding box is exactly the piece",
  mn.join() === "0,0,0" && Math.abs(mx[0] - 60) < 1e-4 &&
  Math.abs(mx[1] - 60) < 1e-4 && Math.abs(mx[2] - 3.2) < 1e-4,
  mn.join(",") + " -> " + mx.join(","));

/* --------------------------------------------------------------- guards */
console.log("\nbad input");

function tira(nombre, fn) {
  try { fn(); ok(nombre, false, "it did not throw"); }
  catch (e) { ok(nombre, true); }
}
tira("plate() without a QR", function () { P.plate(null); });
tira("negative size", function () { P.plate(q, { size: -1 }); });
tira("zero relief", function () { P.plate(q, { relief: 0 }); });
tira("negative quiet zone", function () { P.plate(q, { quietZone: -1 }); });

var sinZona = P.plate(q, { size: 33, quietZone: 0 });
ok("quietZone 0 gives one millimetre per module",
  Math.abs(sinZona.module - 1) < 1e-9, sinZona.module);

console.log("\n" + (hechas - fallos) + "/" + hechas + (fallos ? "  FAILURES" : "  all good") + "\n");
process.exit(fallos ? 1 : 0);
