# Evals

Two suites, answering two different questions. Neither substitutes for the
other, and the honest reason both exist is that each one misses what the other
catches.

| | Question | Needs | Cost | Gates CI |
|---|---|---|---|---|
| **Deterministic** (`eval/`) | Does the server behave correctly? | nothing | free | yes |
| **Agent** (`eval/agent/`) | Does a model use it correctly? | an API key | per run | no |

Both drive the **real server over a real MCP stdio session**. Neither talks to
production DrawPro, and neither needs an account.

---

## Deterministic

```bash
npm run eval --workspace @drawpro/mcp
```

33 checks across four suites, in about three seconds. This is the number in the
README, and the point of it is that a stranger can reproduce it with one command
and no credentials.

**How it can make claims about encryption.** The suite runs a DrawPro API in the
same process, and that fake keeps every request body it was handed. So the
privacy checks are not assertions about intent — they put a string that exists
nowhere else into a node label, then read back every byte the server sent and
fail if the string is in any of them. `$HOME` is redirected to a throwaway
directory and the fixture account's address is one nobody can own, so a run
cannot reach a developer's real key, in the keychain or on disk.

| Suite | What it grades |
|---|---|
| `contract` | The inventory a model is offered: eight tools, real descriptions, no place to put coordinates, and a destructive tool that says so |
| `generation` | The artefact: one shape per node, arrows bound at both ends, no overlapping boxes, a scene that passes its own validator |
| `privacy` | That no label, edge label, or sheet name appears in any request body — and that a locked account explains itself without ever asking for the passcode |
| `recovery` | That a bad call is refused by naming what is wrong, writes nothing, and that the corrected call then succeeds |

Some checks are marked **critical**. Those are the ones where failing is worse
than the feature not existing: a silent overwrite, a half-applied edit, a
plaintext label on the wire, a request for the user's passcode.

**Verify the suite bites.** A suite that has only ever passed proves nothing.
Break something and watch it fail — remove the dangling-edge error from
`packages/diagram/src/validate.ts`, or the "never ask for the passcode" line
from `unlockedKey()` in `packages/mcp/src/server.ts`, and re-run. Both are
caught, the second as a critical failure. Then `git checkout` the file.

Output lands in `eval/results.json` (machine-readable) and `eval/SCORECARD.md`
(the table published to the docs site).

---

## Agent

```bash
ant auth login            # or export ANTHROPIC_API_KEY
npm run eval:agent --workspace @drawpro/mcp
npm run eval:agent --workspace @drawpro/mcp -- --cases self-correction --arms with
```

Drives a model through the prompts in `../plugin/evals/` and judges the
transcripts against the rubrics sitting next to them. The prompts and graders
have exactly one copy: `claude plugin eval` reads them, and so does this runner,
so if early access is granted later the two are measuring the same thing.

**The ablation is the point.** The `without` arm hands the model a file-writing
tool instead of the MCP server — which is what an unaided model does: hand-write
Excalidraw JSON and save it. Both arms are graded against the same rubrics, and
the delta is the number that says whether this package earns the context it
occupies. A plugin that does not beat the baseline is not worth installing, and
that is a result worth being able to discover.

**Judging is over outcomes, not narration.** The judge is given the transcript
*and* the decrypted state of the account afterwards, and told the account is
authoritative. A model that describes a diagram it never created fails — which
is a real failure mode, not a hypothetical one.

Not a CI gate: it costs money per run, and a judged suite is not stable enough
to block a merge on. Run it when a tool's description or contract changes,
which is when a model's behaviour actually moves.

---

## Why these are separate

The deterministic suite cannot tell you that `edit_sheet_text` required
byte-exact `find` text while its own description told the model to copy that
text from `read_sheet`'s flattened output. Every unit test passed; the documented
workflow could not succeed. Only a model actually trying to follow the
instructions surfaces that class of bug.

The agent suite cannot tell you that a refused write left half a sheet behind,
because a judge reading a transcript has no way to see it.

And neither would have predicted `import_sheet` or `edit_sheet_text` existing at
all — both came from real usage finding them missing. That is the standing
caveat in `docs/tool-lifecycle.md`, and it has not stopped being true: **write
evals after usage, not before.**
