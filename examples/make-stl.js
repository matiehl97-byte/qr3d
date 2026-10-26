#!/usr/bin/env node
/* Turn anything into a printable QR plate, from the command line.
 *
 *   node examples/make-stl.js "https://example.com"
 *   node examples/make-stl.js "WIFI:T:WPA;S:MyNetwork;P:hunter2;;" wifi.stl --size 90
 *   node examples/make-stl.js "hello" --preview
 *
 * Options: --size (mm, default 60), --base, --relief, --quiet-zone, --ecl,
 *          --preview to also draw it in the terminal.
 */

"use strict";

var fs = require("fs");
var path = require("path");
var QRGen = require(path.join(__dirname, "..", "src", "qr.js"));
var P = require(path.join(__dirname, "..", "src", "plate.js"));

var args = process.argv.slice(2);
var texto = null, salida = null, preview = false;
var opts = {};
var NUM = { "--size": "size", "--base": "base", "--relief": "relief", "--quiet-zone": "quietZone" };
var ecl = "M";

for (var i = 0; i < args.length; i++) {
  var a = args[i];
  if (NUM[a]) { opts[NUM[a]] = parseFloat(args[++i]); continue; }
  if (a === "--ecl") { ecl = String(args[++i] || "M").toUpperCase(); continue; }
  if (a === "--preview") { preview = true; continue; }
  if (a.charAt(0) === "-") { console.error("unknown option: " + a); process.exit(2); }
  if (texto === null) texto = a; else if (salida === null) salida = a;
}

if (!texto) {
  console.error("usage: node examples/make-stl.js \"text or url\" [out.stl] [--size 60] [--preview]");
  process.exit(2);
}
if (!salida) salida = "qr.stl";
if ("LMQH".indexOf(ecl) < 0) { console.error("--ecl must be L, M, Q or H"); process.exit(2); }

var qr = QRGen.make(texto, ecl);
var p = P.plate(qr, opts);

if (preview) {
  /* Two characters wide per module, because a terminal cell is about half as
     wide as it is tall and a squashed QR does not scan.

     The polarity looks inverted and is not: dark modules are printed as
     SPACES and light ones as blocks. On a dark terminal the spaces read as
     the dark modules and the blocks as the light ones, which is the way round
     a phone camera needs. Swap them and it stops scanning. */
  var linea, y, x;
  console.log("");
  for (y = -1; y <= qr.size; y++) {
    linea = "";
    for (x = -1; x <= qr.size; x++) linea += qr.get(x, y) ? "  " : "██";
    console.log(linea);
  }
  console.log("");
}

fs.writeFileSync(salida, Buffer.from(p.toSTL(texto.slice(0, 40))));

var aviso = p.module < 0.8
  ? "  WARNING: under 0.8 mm a 0.4 mm nozzle cannot draw a square module.\n" +
    "           Raise --size or shorten the text. https://qr3dcraft.com/en/qr-code-minimum-size.html"
  : "";

console.log([
  salida + "  written",
  "",
  "  content     " + (texto.length > 52 ? texto.slice(0, 49) + "..." : texto),
  "  code        " + qr.size + " x " + qr.size + " modules, version " + qr.version + ", level " + qr.ecl +
    (ecl !== qr.ecl ? "  (asked for " + ecl + ", got " + qr.ecl + " free)" : ""),
  "  piece       " + p.size + " x " + p.size + " x " + p.height + " mm",
  "  module      " + p.module.toFixed(2) + " mm",
  "  geometry    " + p.boxes + " boxes, " + p.triangles + " triangles",
  aviso
].filter(function (l) { return l !== ""; }).join("\n"));
