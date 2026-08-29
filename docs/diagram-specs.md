# Diagram specs

The authoring format for `create_diagram` and `update_diagram`. You describe
what connects to what; layout, sizing, text wrapping, and arrow binding are
derived.

```json
{
  "title": "Auth flow",
  "direction": "TB",
  "nodes": [
    { "id": "client", "label": "Browser", "accent": "blue" },
    { "id": "api",    "label": "API" },
    { "id": "check",  "label": "valid?", "shape": "diamond", "accent": "yellow" }
  ],
  "edges": [
    { "from": "client", "to": "api",    "label": "POST /login" },
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

## Why there are no coordinates

Hand-written Excalidraw JSON comes out messy because whoever writes it has to
guess x/y and text widths, and emits arrows as free-floating lines. Boxes
overlap, labels sit off-centre, and arrows detach the moment anything is
dragged.

Supplying coordinates here is not merely unnecessary; it is the failure this
format exists to prevent. What you get instead:

- **Layout** by dagre — rank assignment, crossing minimisation, edge routing
  around nodes.
- **Labels as bound text**, which re-centre, re-wrap, and move with their shape.
- **Arrows bound at both ends** — on the arrow *and* in each shape's
  `boundElements`. Recording only one side is the usual reason hand-written
  arrows detach.
- **Endpoints on the real outline**, computed per shape kind, with a gap so
  arrowheads rest against the border.
- **Text measured from the real font**, using advance widths read from the
  Excalifont binary rather than estimated.

## Validation

`validate_spec` catches duplicate ids, edges referencing unknown nodes, and
orphaned nodes before anything is created. `create_diagram` and
`update_diagram` run the same checks and refuse rather than write a broken
diagram, reporting what to fix.

The generated scene is checked too: bindings must resolve in both directions,
shapes must not overlap, z-order indices must ascend, labels must fit their
boxes, and arrow labels must sit on their arrow rather than float beside it.
