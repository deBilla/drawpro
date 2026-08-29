# @drawpro/mcp

Local MCP server for DrawPro. Lets Claude read and create diagrams in your
account from Claude Code, Claude Desktop, or any MCP client.

Full documentation:
[setup](https://github.com/deBilla/drawpro/blob/main/docs/connect-claude-code.md) ·
[tools](https://github.com/deBilla/drawpro/blob/main/docs/mcp-tools.md) ·
[diagram specs](https://github.com/deBilla/drawpro/blob/main/docs/diagram-specs.md) ·
[privacy](https://github.com/deBilla/drawpro/blob/main/docs/privacy.md)

## Setup

```bash
npx -y @drawpro/mcp connect dp_live_...
```

Mint the token in DrawPro under **Connect to Claude Code**. One command: it
verifies the token, registers the server with Claude Code for all projects, and
offers to unlock reading. Re-run it with a new token to rotate. Nothing changes
if the token is rejected.

`auth`, `login`, and `claude mcp add` remain available separately if you would
rather do the steps yourself.

`--scope user` registers it for every project on your machine. The scope
otherwise defaults to `local`, which loads the server only in the directory the
command was run in — diagramming is not a property of one repo, so that default
is almost never what you want here. Avoid `--scope project`: it writes
`.mcp.json` into whichever repo you are standing in, token included, where it
invites being committed.

To read existing sheets, unlock the account once:

```bash
DRAWPRO_TOKEN="dp_live_..." npx -y @drawpro/mcp login
```

`login --forget` clears the stored key again.

## Publishing

```bash
npm run build --workspace @drawpro/mcp
npm publish --workspace @drawpro/mcp --access public
```

`@drawpro/client` and `@drawpro/diagram` are workspace packages that are not
published; esbuild inlines them into `dist/server.js`. Everything else stays a
real dependency, which matters for `@phi-ag/argon2` — it loads its `.wasm` from
its own package directory, so bundling it would break unlocking.

## Why it runs locally

DrawPro is end-to-end encrypted: content is sealed in the client, and the server
stores only ciphertext.

A hosted remote MCP server would have to receive plaintext diagrams to encrypt
them, which would hand the server exactly what the encryption exists to withhold.
Running locally keeps sealing and opening on your machine, the same as the
browser does. This is a constraint, not a preference — "make it a hosted remote
server, it's easier to onboard" would quietly undo the product's core property.

## Why unlocking is a separate command

Writing needs only the account's public key, which the API hands out — so
creating a diagram never involves the passcode.

Reading needs the private key, which is wrapped with Argon2id over the passcode.
A stdio server cannot prompt for it, and routing it through a tool argument would
put the account's master secret into the model's context and the transcript.

So `login` handles it out of band: it prompts interactively, derives the key, and
stores **the key, not the passcode**, in the OS keychain (or a 0600 file under
`~/.drawpro` elsewhere — the same posture as `~/.ssh` private keys). The server
only reads from that store. When an account is locked, the read tools return an
instruction to run `login` and explicitly tell the model not to ask for the
passcode itself.

## Tools

| Tool | Needs unlock | Notes |
|---|---|---|
| `list_workspaces` | for names | ids work locked; names are ciphertext |
| `list_sheets` | for names | same |
| `read_sheet` | yes | returns a readable outline, not raw scene JSON |
| `validate_spec` | no | no side effects; check before writing |
| `create_diagram` | no | returns a link to the new sheet |
| `update_diagram` | no | replaces the sheet wholesale — regenerates layout |
| `edit_sheet_text` | yes | rewrites named text in place, preserving every other element |
| `import_sheet` | no | writes a local .excalidraw file into a sheet, coordinates verbatim |

### Editing a sheet a person drew

`update_diagram` builds the scene from a spec, so layout is derived and
hand-placed content cannot survive it: text elements positioned by hand, region
containers, and unbound annotation arrows all disappear, and the sheet comes
back as an auto-laid-out graph. Correct content, different diagram.

Use `edit_sheet_text` for those sheets. It reads the scene, rewrites only the
strings you name, and writes every other element back — so coordinates,
groupings, and annotations are untouched. Edits apply all-or-nothing: if any
`find` matches nothing, the sheet is left alone rather than half-updated.

The one geometry change it makes is growing a box whose text no longer fits.
Excalidraw regrows a container around text *bound* to it, but hand-drawn
diagrams usually have text merely sitting on top of a shape, so longer text
would otherwise spill out the bottom. Boxes are only ever grown, never shrunk,
and nothing else moves — reflowing neighbours would be the wholesale rewrite
this tool exists to avoid. Any box it grows is named in the result, so overlap
with a neighbour is easy to spot and one drag to fix.

It cannot add elements or move anything. A correction that needs a new box, a
repositioned column, or a re-anchored arrow is a geometry change, and no spec or
text edit can express one.

`import_sheet` covers that case. Point it at a local `.excalidraw` file and it
writes the scene in verbatim — every coordinate exactly as in the file. Because
the server runs on your machine it can simply read the file, so a geometry pass
can be done with a real editor, or by a model editing the file directly, and
then pushed without a clipboard round trip. The file's contents go into the
encrypted blob, never into the model's context.

`update_diagram` remains the right tool for sheets this package generated, where
regenerating the layout is the point.

`read_sheet` deliberately returns shapes and edges rather than Excalidraw JSON.
A real sheet's raw scene runs to tens of thousands of characters of coordinates,
seeds, and style; the outline is a few dozen lines carrying what the diagram
actually says.

Diagram specs describe *what connects to what*. Layout, sizing, text wrapping,
and arrow binding are derived by `@drawpro/diagram` — a spec never contains
coordinates.

## Usage log

Turning telemetry on is enough to start recording:

```bash
npx -y @drawpro/mcp telemetry      # show the state and the exact payload
npx -y @drawpro/mcp telemetry on   # records to ~/.drawpro/usage.jsonl and shares an aggregate
npx -y @drawpro/mcp telemetry off
npx -y @drawpro/mcp report         # send once, without turning anything on
```

Consenting to *send* usage implies consent to *record* it — recording is the
lesser act — so opting in does not also require configuring a log. The
implication does not run the other way: setting `DRAWPRO_MCP_LOG` records
locally and shares nothing.

To record without ever sharing, set the path yourself:

```bash
claude mcp add drawpro --scope user \
  -e DRAWPRO_TOKEN="dp_live_..." \
  -e DRAWPRO_MCP_LOG="$HOME/.drawpro/usage.jsonl" \
  -- npx -y @drawpro/mcp

npx -y @drawpro/mcp stats
```

> Run these from anywhere except a checkout of this repository. Inside it, npm
> resolves `@drawpro/mcp` to the workspace copy, whose bin is not linked, and
> npx fails with `drawpro-mcp: command not found`. Use
> `node packages/mcp/dist/server.js <command>` there instead.

```
5 calls  2026-08-29 .. 2026-08-29

  tool               calls  refused  failed  median
  read_sheet             2     0   0%       0    881ms
  edit_sheet_text        1     1 100%       0     62ms
```

Opt-in, and never transmitted. `logCall` does one thing — append to that file —
and the only outbound request this package can make is to your own DrawPro
account's sheets. Unset the variable and nothing is written at all; there is no
default path and no fallback.

### How that feeds back into the package

The raw log stays on your machine and carries workspace and sheet ids, so you
can correlate calls against your own account. `stats` is the aggregate: tool
names, counts, timings, and nothing that identifies an account, a workspace, a
sheet, or anything drawn on one.

That split is the point. Sharing is a decision you make, not a default the
package makes for you:

```bash
drawpro-mcp stats --json    # paste into an issue
```

There is no telemetry endpoint, and adding one to a product built on the server
never seeing your diagrams would be the wrong trade. If a tool is refusing
often, the aggregate says so without anyone learning what you were drawing.

The column worth watching is **refused**. A tool that frequently declines is one
whose description is not steering the model well, and that is cheaper to learn
from real use than from a synthetic eval — both `edit_sheet_text` and
`import_sheet` exist because real use found them missing, and no eval written
beforehand would have predicted either.

## Tests

```bash
DRAWPRO_TOKEN=dp_live_... npx tsx packages/mcp/tests/smoke.ts
```

Spawns the server as a subprocess and speaks MCP to it, because compiling proves
nothing about protocol behaviour. Read-only: it never creates or modifies a
sheet.
