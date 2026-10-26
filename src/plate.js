/*!
 * qr3d / plate.js - turn a QR matrix into a 3D-printable plate and a binary STL.
 *
 * No dependencies, no DOM, no canvas: the mesh is built straight from the
 * module matrix, so this runs in Node and in the browser alike.
 *
 * The geometry is two slabs. The base is one box. The code sits on top of it,
 * raised, and is NOT one box per dark module: consecutive dark modules in a
 * row are merged into a single box first. A version-4 code has 563 dark
 * modules and merges down to about 190 boxes, which is the difference between
 * an STL your slicer opens instantly and one it chews on.
 *
 * Why the code goes on top and not against the bed: the first layer is the one
 * the nozzle squashes, and a squashed layer grows sideways. Put the code there
 * and the dark modules eat into the gaps between them. Put the base there and
 * the code is fifteen layers up, printed in free air, square.
 *
 * MIT licensed. See LICENSE.
 */

"use strict";

var DEFAULTS = {
  size: 60,        /* outer side of the plate, in mm */
  quietZone: 2,    /* blank modules on EACH side, see the README */
  base: 2.6,       /* thickness of the solid slab, in mm */
  relief: 0.6      /* how far the code stands out of it, in mm */
};

/* ------------------------------------------------------------------ mesh */

function Mesh() {
  this.tris = [];   /* each entry: [ax,ay,az, bx,by,bz, cx,cy,cz] */
}

Mesh.prototype.tri = function (a, b, c) {
  this.tris.push([a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]]);
};

/* An axis-aligned box, as twelve triangles with outward winding. */
Mesh.prototype.box = function (x0, y0, z0, x1, y1, z1) {
  var p = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
  ];
  var f = [
    [0, 3, 2], [0, 2, 1],   /* bottom */
    [4, 5, 6], [4, 6, 7],   /* top    */
    [0, 1, 5], [0, 5, 4],   /* front  */
    [1, 2, 6], [1, 6, 5],   /* right  */
    [2, 3, 7], [2, 7, 6],   /* back   */
    [3, 0, 4], [3, 4, 7]    /* left   */
  ];
  for (var i = 0; i < 12; i++) this.tri(p[f[i][0]], p[f[i][1]], p[f[i][2]]);
};

Mesh.prototype.count = function () { return this.tris.length; };

/* ------------------------------------------------- merging the modules */

/* Walks each row and returns [x, y, width] runs of dark modules. Merging only
   along rows, and not in both directions, is deliberate: it is one pass, it
   never produces overlapping boxes, and it already removes two thirds of the
   geometry. */
function runs(qr) {
  var out = [];
  for (var y = 0; y < qr.size; y++) {
    var x = 0;
    while (x < qr.size) {
      if (!qr.get(x, y)) { x++; continue; }
      var w = 1;
      while (x + w < qr.size && qr.get(x + w, y)) w++;
      out.push([x, y, w]);
      x += w;
    }
  }
  return out;
}

/* ----------------------------------------------------------------- plate */

/**
 * Build the plate.
 *
 * @param {object} qr      what QRGen.make() returned
 * @param {object} [opts]  see DEFAULTS
 * @returns {{mesh: Mesh, module: number, size: number, height: number,
 *            boxes: number, triangles: number, toSTL: function}}
 */
function plate(qr, opts) {
  var o = {}, k;
  for (k in DEFAULTS) o[k] = DEFAULTS[k];
  for (k in (opts || {})) if (opts[k] !== undefined) o[k] = opts[k];

  if (!qr || typeof qr.get !== "function") throw new Error("plate(): first argument must be a QR from QRGen.make()");
  if (!(o.size > 0)) throw new Error("plate(): size must be a positive number of millimetres");
  if (!(o.base > 0) || !(o.relief > 0)) throw new Error("plate(): base and relief must be positive");
  if (!(o.quietZone >= 0)) throw new Error("plate(): quietZone cannot be negative");

  var across = qr.size + 2 * o.quietZone;      /* modules from edge to edge */
  var mod = o.size / across;                   /* millimetres per module */
  var off = o.quietZone * mod;                 /* where the code starts */

  var mesh = new Mesh();
  mesh.box(0, 0, 0, o.size, o.size, o.base);

  /* The matrix counts rows downwards and the printer counts Y upwards, so the
     row index is flipped. Skip it and the code comes out mirrored, which a
     reader will not forgive. */
  var r = runs(qr), i, x, y, w;
  for (i = 0; i < r.length; i++) {
    x = r[i][0]; y = r[i][1]; w = r[i][2];
    mesh.box(
      off + x * mod,
      off + (qr.size - 1 - y) * mod,
      o.base,
      off + (x + w) * mod,
      off + (qr.size - y) * mod,
      o.base + o.relief
    );
  }

  return {
    mesh: mesh,
    module: mod,
    size: o.size,
    height: o.base + o.relief,
    boxes: r.length + 1,
    triangles: mesh.count(),
    toSTL: function (name) { return toSTL(mesh, name); }
  };
}

/* ------------------------------------------------------------------- STL */

/* Binary STL: 80 bytes of header, a uint32 with the triangle count, then 50
   bytes per triangle. The normal is left at zero on purpose - every slicer
   recomputes it from the winding order, and writing a wrong one is worse than
   writing none. */
function toSTL(mesh, name) {
  var n = mesh.tris.length;
  var buf = new ArrayBuffer(84 + n * 50);
  var view = new DataView(buf);
  var bytes = new Uint8Array(buf);

  var header = "qr3d - https://qr3dcraft.com" + (name ? " - " + name : "");
  for (var h = 0; h < header.length && h < 79; h++) bytes[h] = header.charCodeAt(h) & 0x7f;
  view.setUint32(80, n, true);

  var p = 84;
  for (var i = 0; i < n; i++) {
    var t = mesh.tris[i];
    view.setFloat32(p, 0, true);
    view.setFloat32(p + 4, 0, true);
    view.setFloat32(p + 8, 0, true);
    for (var j = 0; j < 9; j++) view.setFloat32(p + 12 + j * 4, t[j], true);
    view.setUint16(p + 48, 0, true);
    p += 50;
  }
  return bytes;
}

var qr3dPlate = { plate: plate, toSTL: toSTL, Mesh: Mesh, DEFAULTS: DEFAULTS };

if (typeof module !== "undefined" && module.exports) module.exports = qr3dPlate;
if (typeof globalThis !== "undefined") globalThis.qr3dPlate = qr3dPlate;
