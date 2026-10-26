# qr3d

Turn any text into a **3D-printable QR code**. Two files, no dependencies, no
build step, no DOM. Runs in Node and in the browser.

```bash
node examples/make-stl.js "https://example.com" tag.stl --size 60
```

```
tag.stl  written

  content     https://example.com
  code        25 x 25 modules, version 2, level Q  (asked for M, got Q free)
  piece       60 x 60 x 3.2 mm
  module      2.07 mm
  geometry    166 boxes, 1992 triangles
```

Open `tag.stl` in any slicer and print it. No supports.

---

## Why this exists

Most QR libraries stop at the image. Getting from there to something a printer
can make is six steps through three programs — export a PNG, vectorise it,
import it into a modeller, extrude it, put it on a base — and you repeat the
whole thing every time the link changes.

This does it in one call, and it knows the two things that make printed codes
fail.

**A module has to be wide enough for two beads of plastic.** A printer lays
down a line about as wide as its nozzle. If a module is narrower than two of
them it comes out as a blob instead of a square, and the reader gives up. With
a 0.4 mm nozzle that floor is 0.8 mm. The CLI warns you when you cross it:

```
WARNING: under 0.8 mm a 0.4 mm nozzle cannot draw a square module.
```

**The code goes on top, not against the bed.** The first layer is the one the
nozzle squashes, and a squashed layer spreads sideways. Print the code face
down and the dark modules grow into the gaps between them until the code stops
being readable. Here the base is the first layer and the code sits fifteen
layers up, printed square in free air.

## Install

Clone it, or copy the two files in `src/`. There is nothing to install.

```js
const QRGen = require("./src/qr.js");
const { plate } = require("./src/plate.js");

const qr = QRGen.make("https://example.com", "M");
const p  = plate(qr, { size: 60 });

require("fs").writeFileSync("tag.stl", Buffer.from(p.toSTL()));
```

In a browser, two `<script>` tags give you `QRGen` and `qr3dPlate` as globals.

## API

### `QRGen.make(text, level)`

`level` is `"L"`, `"M"`, `"Q"` or `"H"`. Returns:

| | |
|---|---|
| `size` | modules per side |
| `version` | 1 to 40 |
| `ecl` | the level you actually got — see below |
| `mask` | which of the eight masks won |
| `get(x, y)` | 1 for dark, 0 for light, 0 outside |
| `isFinder(x, y)` | whether that module belongs to a corner square |

> Ask for `M` on a short string and you may get `Q` back. The encoder picks the
> smallest version that fits, and if that version has spare room it raises the
> correction level for free rather than waste it. `ecl` always tells you what
> you ended up with.

### `plate(qr, options)`

| option | default | |
|---|---|---|
| `size` | `60` | outer side of the piece, in mm |
| `base` | `2.6` | the solid slab under the code |
| `relief` | `0.6` | how far the code stands out |
| `quietZone` | `2` | blank modules on **each** side |

Returns `{ mesh, module, size, height, boxes, triangles, toSTL(name) }`.
`module` is the millimetres per module — the number that decides whether the
thing scans.

> **On `quietZone`.** The spec asks for 4 blank modules on every side. Printed
> pieces usually get away with 2, because the edge of the plate is itself a
> hard border the camera can see. If the piece will sit on a busy surface, or
> gets glued onto something patterned, put it back to 4.

### `toSTL(name)`

Binary STL as a `Uint8Array`. Normals are left at zero on purpose: every slicer
recomputes them from the winding order, and a wrong normal is worse than none.

## How the geometry stays small

One box per dark module would be honest and useless: a version-4 code has 563
dark modules, which is 6756 triangles of code alone. Consecutive dark modules
in a row are merged into a single box first, which takes that to about 190
boxes. Same shape, a third of the file.

## Tests

```bash
node test.js
```

23 checks, no framework. The one that earns its keep rebuilds the matrix back
out of the finished mesh and compares it module by module against the encoder,
because **a mirrored QR passes every other test there is** — the file opens,
the slicer is happy, the print looks perfect, and no phone on earth reads it.

## What this does not do

Colour. The interesting version of a printed QR is two-colour — a light base
with a dark code — and that needs a 3MF with two objects and their materials,
not an STL. That lives in the full tool:

**[qr3dcraft.com](https://qr3dcraft.com)** — same encoder, plus the two-colour
3MF, a 3D preview, keychain and plate shapes, and about thirty guides on
sizing, layer height, relief, filament contrast and why a code does not scan.
Free, no sign-up, and it runs entirely in your browser: the link you type never
leaves your machine.

---

## En español

`qr3d` convierte cualquier texto en un **código QR listo para imprimir en 3D**.
Dos archivos, sin dependencias, sin compilación. Funciona en Node y en el
navegador.

```bash
node examples/make-stl.js "https://ejemplo.com" chapa.stl --size 60
```

Sabe las dos cosas por las que fallan los códigos impresos: que **un módulo
necesita dos cordones de plástico de ancho** (0,8 mm con una boquilla de 0,4, y
avisa cuando no llegás), y que **el código va arriba y no contra la cama**,
porque la primera capa se aplasta y los módulos oscuros se comen el hueco de
los claros.

La versión completa, con los dos colores en un 3MF, vista previa 3D y las guías
de dimensionado, está en **[qr3dcraft.com](https://qr3dcraft.com)**.

---

MIT © Tiehl Roberto Matías
