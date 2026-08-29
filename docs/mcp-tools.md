# MCP tools

Eight tools. The one decision that matters is which of the three writing tools
to use, because two of them are destructive in ways that are not obvious.

| Tool | Needs unlock | |
|---|---|---|
| `list_workspaces` | for names | ids work locked; names are ciphertext |
| `list_sheets` | for names | same |
| `read_sheet` | yes | returns an outline, not raw Excalidraw JSON |
| `validate_spec` | no | no side effects; check before writing |
| `create_diagram` | no | new sheet from a spec |
| `update_diagram` | no | **replaces a sheet wholesale**, regenerating layout |
| `edit_sheet_text` | yes | rewrites named text, preserving everything else |
| `import_sheet` | no | writes a local `.excalidraw` file in verbatim |

## When an account is locked

Reads fail softly. `list_workspaces` and `list_sheets` still return ids with
ciphertext names; `read_sheet` returns an instruction to run `login`.

The instruction is written for the model as much as the user, and says two
things explicitly: that no restart is needed — retry the same tool after
unlocking — and that it must never ask for the passcode itself. A model that
asks you to type your passcode into the conversation has moved your account's
master secret into a transcript, which is the failure the out-of-band unlock
exists to prevent.

## Choosing a writing tool

**Was the sheet generated from a spec?** `update_diagram` is correct.
Regenerating the layout is the point.

**Did a person draw it?** `update_diagram` will destroy it. Layout is *derived*
from the spec, and hand-placed text, region containers, and unbound annotation
arrows have no representation in a spec at all — the sheet comes back as an
auto-laid-out graph. Right content, different diagram.

- To change wording: `edit_sheet_text`.
- To change geometry: `import_sheet`.

## `edit_sheet_text`

Reads the scene, rewrites only the strings you name, writes every other element
back untouched.

```
edit_sheet_text(workspace_id, sheet_id, edits: [{ find, replace }])
```

`find` matches with **whitespace collapsed**, so the flattened single-line form
`read_sheet` prints works even for an element that contains line breaks. Strip
the leading `[rectangle]` marker first — that is outline formatting, not part of
the text.

This matters because `read_sheet` renders newlines as spaces to keep the outline
one line per element. Requiring byte-exact `find` therefore made its own output
unusable for any multi-line text, while the instructions said to copy from
there. Identifying *which* element to change should not require reproducing line
breaks that are invisible in every rendering of it.
Edits are **all-or-nothing**: if any `find` matches nothing, the sheet is left
alone. A half-applied edit is worse than none — the result is a state nobody
expected, and the diff is invisible without re-reading.

Its one geometry change is growing a box whose text no longer fits. Excalidraw
regrows a container around text *bound* to it, but hand-drawn diagrams usually
have text merely sitting on a shape, so longer text would otherwise spill out.
Boxes are only ever grown, never shrunk, and nothing else moves — reflowing
neighbours would be the wholesale rewrite this tool exists to avoid. Any box it
grows is named in the result.

It cannot add elements.

## `import_sheet`

```
import_sheet(workspace_id, file_path, name, sheet_id?)
```

Writes a local `.excalidraw` file in exactly as it is — every coordinate
preserved. Use it when geometry has to change: repositioning, resizing,
re-anchoring arrows, adding elements. Do the pass in a real editor, or by
editing the file directly, then push it.

This works only because the server runs on your machine. The file's contents go
into the encrypted blob and never into the model's context, so a large scene
costs nothing to transfer.

`validateScene` runs on import but only reports. It is your drawing; overlapping
boxes and unbound arrows are your business.

## `read_sheet`

Returns shapes and edges, not raw Excalidraw JSON:

```
shapes (10):
  [rectangle] Browser — React + Excalidraw
  [ellipse] Postgres 17
edges (9):
  encryptMessage() — in the browser -> nginx :80  "ciphertext only"
```

A real sheet's raw scene runs to tens of thousands of characters of
coordinates, seeds, and style. The outline is what the diagram means, in a few
dozen lines.

Labels are recovered from bindings where they exist, and otherwise from geometry
— text inside a shape becomes that shape's label, text near an arrow becomes the
arrow's. Without that fallback, a hand-drawn diagram reads back as a list of
unlabelled boxes, since people place labels on shapes rather than typing into
them.
