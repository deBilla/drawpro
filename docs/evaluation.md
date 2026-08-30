# Evaluation

Anyone can claim their MCP server works. This one ships the suites that check
it, and both of them run against the real server over a real MCP stdio session.

There are two, because they answer different questions and each one misses what
the other catches.

| | Question | Needs | Cost | Gates CI |
|---|---|---|---|---|
| **Deterministic** | Does the server behave correctly? | nothing | free | yes |
| **Agent** | Does a model *use* it correctly? | an API key | per run | no |

---

## The deterministic suite

```bash
git clone https://github.com/deBilla/drawpro && cd drawpro
npm install
npm run eval --workspace @drawpro/mcp
```

33 checks in about three seconds. No DrawPro account, no API key, no network
call. That is the property that matters: the number in the README is one a
stranger can reproduce, not one you have to take on trust.

It works by starting a DrawPro API **in the same process** and pointing the real
MCP server at it. `$HOME` is redirected to a throwaway directory, so the config
file, the usage log, and the stored private key all land somewhere disposable;
the fixture account's address is one nobody can own, so the macOS keychain
lookup misses and falls through to that directory. A run cannot read, or write,
your real key.

### What it grades

**`contract`** — the inventory a model is offered. Eight tools, descriptions
long enough to choose between, a node schema with nowhere to put coordinates,
and a destructive tool whose description says so and names the tool to run
first.

**`generation`** — the artefact, not the transcript. One shape per node, one
arrow per edge, every arrow bound at both ends, no two boxes overlapping, a
scene that passes its own structural validator, and an element count in the
reply that matches the sheet actually written.

**`privacy`** — that nothing readable leaves the machine. See below.

**`recovery`** — that a bad call is refused by naming what is wrong, writes
nothing, and that the corrected call then succeeds. Plus the all-or-nothing
guarantee on `edit_sheet_text`: one unmatched `find` leaves every element
untouched.

### How it can make claims about encryption

The fake API keeps every request body it was handed. So the privacy checks are
not assertions about intent — the suite puts a string that exists nowhere else
into a node label, an edge label and a title, then reads back every byte the
server sent and fails if any of them is in there. It then decrypts the stored
blob to confirm the content really is present, just sealed.

That is the difference between "we encrypt your diagrams" and a claim you can
run.

### Critical checks

Some failures are worse than the feature not existing, and are marked
accordingly:

- a sheet overwritten without the tool having said it would
- a half-applied edit, invisible until someone re-reads the sheet
- a plaintext label in a request body
- a model asking the user to type their passcode into the conversation

The last one fails a run outright however well the rest went. The passcode is
the account's master secret; a model that asks for it has moved that secret into
a transcript, which is exactly what the out-of-band unlock design exists to
prevent.

### Verifying the suite bites

A suite that has only ever passed proves nothing. Two one-line faults, and what
each should catch:

| Fault | Expected failures |
|---|---|
| Delete the dangling-edge error in `packages/diagram/src/validate.ts` | `names-the-broken-thing`, `dry-run-finds-both` |
| Change "Never ask the user for their passcode" in `unlockedKey()` | `never-asks-for-the-passcode` — **critical** |

Then `git checkout` the file.

---

## The agent suite

```bash
ant auth login          # or export ANTHROPIC_API_KEY
npm run eval:agent --workspace @drawpro/mcp
```

Drives a real model through the prompts in `packages/mcp/plugin/evals/` and
judges the transcripts against the rubrics beside them. Those prompts and
rubrics have exactly one copy: `claude plugin eval` reads them, and so does this
runner, so the two stay comparable.

**The ablation is the point.** The `without` arm removes the MCP server and
hands the model a file-writing tool instead — which is what an unaided model
does: hand-write Excalidraw JSON and save it to disk. Both arms are graded
against the same rubrics, and the delta is the number that says whether this
package earns the context it occupies. A plugin that does not beat its own
absence is not worth installing, and that is a result worth being able to find
out.

**Judged on outcomes, not narration.** The judge sees the transcript *and* the
decrypted state of the account afterwards, and is told the account is
authoritative. A model that describes a diagram it never created fails — a real
failure mode, not a hypothetical one.

It is not a CI gate. It costs money per run, and a judged suite is not stable
enough to block a merge on. Run it when a tool's description or contract
changes, which is when a model's behaviour actually moves.

---

## What neither suite can tell you

`edit_sheet_text` once required byte-exact `find` text while its own description
told the model to copy that text from `read_sheet` — which flattens newlines for
readability. For any multi-line element the documented workflow could not
succeed. Every unit test passed. Only a model actually trying to follow the
instructions surfaces that class of bug, and only after someone tries to use it
for real.

The other direction fails too: a judge reading a transcript cannot see that a
refused write left half a sheet behind.

And neither would have predicted that `import_sheet` and `edit_sheet_text`
needed to exist at all. Both came from real usage finding them missing, and an
eval written in advance would have graded "does it produce a good diagram" while
the actual failure was "the tool cannot be used at all".

Which is the standing caveat, and it has not stopped being true: **write evals
after usage, not before.** The suites here are worth running because they pin
what usage already taught; they are not a substitute for the usage.

See also [the tool lifecycle](./tool-lifecycle.md), which is where those lessons
came from.
