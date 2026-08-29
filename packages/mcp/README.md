# @drawpro/mcp

Local MCP server for DrawPro. Lets Claude read and create diagrams in your
account from Claude Code, Claude Desktop, or any MCP client.

## Setup

```bash
claude mcp add drawpro --scope user -e DRAWPRO_TOKEN="dp_live_..." -- npx -y @drawpro/mcp
```

Mint the token in DrawPro under **Connect to Claude Code**.

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

## Tests

```bash
DRAWPRO_TOKEN=dp_live_... npx tsx packages/mcp/tests/smoke.ts
```

Spawns the server as a subprocess and speaks MCP to it, because compiling proves
nothing about protocol behaviour. Read-only: it never creates or modifies a
sheet.
