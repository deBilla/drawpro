# Development

## Layout

```
apps/
  api-ts/      Express REST API — the one that runs
  frontend/    React + Vite + Excalidraw
  collab/      Yjs server, not wired up (see Operations)
  desktop/     Electron shell
packages/
  diagram/     spec → Excalidraw scene
  client/      Node port of the E2EE scheme, plus the API client
  mcp/         the MCP server, published as @drawpro/mcp
  shared-types/
```

`packages/mcp` bundles `client` and `diagram` into a single file at publish
time, since neither is published. Everything else stays a real dependency —
which matters for `@phi-ag/argon2`, as it loads its `.wasm` from its own package
directory and bundling would break unlocking.

## Tests

```bash
npm run eval --workspace @drawpro/mcp        # the MCP suite — no account needed
npm test --workspace @drawpro/diagram        # golden, describe, fit
npx tsx packages/client/src/selftest.ts      # crypto round trips
npx tsx packages/client/tests/prompt.ts      # hidden passcode input
DRAWPRO_TOKEN=dp_live_... npx tsx packages/mcp/tests/smoke.ts   # against production
```

The first two are what CI runs, because they need nothing. `smoke.ts` needs a
real token and talks to production, so it stays a local check; the eval covers
the same protocol ground against a DrawPro API running in-process, plus the
artefacts and refusals `smoke.ts` never looks at. See
[Evaluation](./evaluation.md).

### Golden tests

`packages/diagram/tests/` holds specs and their expected scenes. Ids, seeds,
nonces, and timestamps differ per run, so output is normalised — but ids are
**renumbered rather than dropped**, with every reference rewritten, so binding
structure stays visible and a broken binding shows up as a diff.

They answer "did anything change?", not "is it correct?" A wrong diagram blessed
once stays blessed. Re-bless deliberately, after reading the diff:

```bash
npm run test:update --workspace @drawpro/diagram
```

### A trap worth knowing

Testing generated output proves less than it appears. The generator binds every
label to its container, so any behaviour that only affects *unbound* text is
silently skipped. Two bugs hid behind exactly this: label recovery in
`describeScene`, and box growing in `edit_sheet_text`. Both now have fixtures
shaped like a hand-drawn diagram.

The same applies to the MCP server: compiling proves nothing about protocol
behaviour, so both `smoke.ts` and the eval spawn the server and speak MCP to it.

## Font metrics

`packages/diagram/src/font-metrics.ts` is generated from the Excalifont binary
that `@excalidraw/excalidraw` ships. Regenerate after upgrading it:

```bash
npx tsx packages/diagram/tools/generate-font-metrics.ts
```

The generator locates the Latin subset by probing glyph coverage rather than
hardcoding a content-hashed filename, so it survives version bumps.

Do not hand-edit the table. The estimated one it replaced was wrong by a mean of
7.7% of an em — `t` and `I` classed as narrow at 0.30 when they are nearer 0.55
— which let a label measure just under the wrap threshold and overflow its box.

## Publishing the MCP server

```bash
npm publish --workspace @drawpro/mcp --access public --otp=<code>
```

`prepublishOnly` rebuilds the bundle. Verify from the registry afterwards rather
than from the source tree — installing the published tarball in a clean
directory has caught a duplicated shebang that stopped the binary running at
all, and an eagerly-constructed API client that crashed before any command could
run.
