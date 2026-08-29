# @drawpro/diagram

Turns a small JSON spec into a well-laid-out Excalidraw scene.

The problem this solves: hand-written Excalidraw JSON is messy because whoever
writes it has to guess x/y coordinates, guess text widths, and emit arrows as
free-floating lines. Boxes overlap, labels sit off-centre, and arrows detach the
moment anything is dragged. Here you describe *what connects to what*, and
layout, sizing, wrapping, and binding are derived.

## Use

```bash
npx tsx packages/diagram/src/cli.ts spec.json out.excalidraw
```

Validation problems print to stderr; errors exit non-zero and write nothing, so
a bad spec can be corrected and retried rather than producing a bad diagram.

## Spec

```json
{
  "title": "Auth flow",
  "direction": "TB",
  "nodes": [
    { "id": "client", "label": "Browser", "accent": "blue" },
    { "id": "api",    "label": "API",     "shape": "rectangle" },
    { "id": "check",  "label": "valid?",  "shape": "diamond", "accent": "yellow" }
  ],
  "edges": [
    { "from": "client", "to": "api",   "label": "POST /login" },
    { "from": "api",    "to": "check" },
    { "from": "check",  "to": "client", "label": "401", "style": "dashed" }
  ]
}
```

| Field | Values | Default |
|---|---|---|
| `direction` | `TB` `BT` `LR` `RL` | `TB` |
| `node.shape` | `rectangle` `ellipse` `diamond` | `rectangle` |
| `node.accent` | `blue` `green` `yellow` `red` `violet` `grey` `none` | `none` |
| `edge.style` | `solid` `dashed` `dotted` | `solid` |
| `edge.arrowhead` | `true` `false` | `true` |
| `spacing.node` / `spacing.rank` | px | `60` / `90` |

Colours are named rather than hex so a diagram stays consistent with
Excalidraw's own palette.

## What it gets right

- **Layout** is done by dagre — rank assignment, crossing minimisation, and edge
  routing around nodes. Pure JS, no DOM, so it runs in a plain Node CLI.
- **Labels are bound text**, not floating text on top of a shape. They re-centre,
  re-wrap, and move with their container, and are edited by double-clicking it.
- **Arrows are bound at both ends** — `startBinding`/`endBinding` on the arrow
  *and* a matching entry in each shape's `boundElements`. Recording only one side
  is the usual reason hand-written arrows detach when a box is dragged.
- **Endpoints sit on the shape outline**, computed per shape kind (rectangle
  clip, ellipse parametric, diamond rhombus), with a small gap so arrowheads
  rest against the border instead of inside it.
- **Z-order indices** use the same fractional-indexing algorithm Excalidraw
  depends on, so array order and z-order agree.

## Tests

```bash
npm test --workspace @drawpro/diagram          # compare against goldens
npm run test:update --workspace @drawpro/diagram   # re-bless after an intended change
```

Golden-file tests under `tests/`: each spec in `cases/` is generated and diffed
against a committed scene in `golden/`. Verified to fail on a 2px padding change
and to exit non-zero, so it is usable as a CI gate.

Ids, seeds, nonces, and timestamps differ on every run, so output is normalised
before comparison. Rather than dropping ids, they are renumbered in array order
and every reference is rewritten, which keeps the binding structure visible in
the golden file — a broken `containerId` or arrow binding shows up as a diff
instead of normalising away.

These answer "did anything change?", not "is it correct?" A wrong diagram
blessed once stays blessed, so they complement `validateScene`, which asserts
what is actually wrong.

## Known approximation

Text is measured with a per-character width table approximating Excalifont,
because there is no canvas to measure real glyphs in Node. Containers are sized
from that estimate. Excalidraw re-measures with the real font and re-wraps bound
text whenever a container is touched, so small errors self-correct — but a very
long single word can produce a slightly wider box than necessary on first render.
