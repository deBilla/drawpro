# Eval suite

Measures whether the DrawPro MCP server actually improves outcomes, versus
Claude hand-writing Excalidraw JSON.

```bash
claude plugin eval packages/mcp/plugin --no-publish
```

`--ablation with-without` is the default when a plugin resolves: it runs a
second arm with the plugin absent and reports the score delta. That delta is the
number that justifies the package — a plugin that does not beat the baseline is
not earning its context.

`--no-publish` keeps the HTML report local. Worth defaulting to, since these
runs put diagrams of your architecture into prompts and reports.

**`claude plugin eval` is in early access and is not enabled on this account.**
Rather than leave these cases unexecutable, `../../eval/agent/` runs the same
prompts and the same graders through the Claude API:

```bash
npm run eval:agent --workspace @drawpro/mcp
```

There is one copy of every prompt and rubric — this directory. Both runners read
it, so the numbers stay comparable if access is granted later. The free,
credential-less suite that gates CI is the deterministic one in `../../eval/`;
see `../../eval/README.md` for why both exist.

## Cases

| Case | Asks |
|---|---|
| `create-from-description` | Turns prose into a diagram in the account, using the tool rather than hand-written JSON, without supplying coordinates |
| `self-correction` | The prompt references a node it never introduces. Does the model read the validator's rejection and fix the spec itself? |
| `read-then-extend` | Reads a sheet before overwriting it, and — critically — never asks the user for their passcode |

## What the graders deliberately do not check

Shape, colour, and wording are style choices. Graders assert structure:
participants present, edges pointing the right way, failure branches kept. A
grader that pins wording measures phrasing rather than capability, and fails
every time a model rewords a label.

## The grader that matters most

`read-then-extend/graders/handled-lock-state.md` fails a run outright if the
model asks the user to type their passcode into the conversation, however well
the rest went. Reading requires an unlocked account, and the correct behaviour
is to relay the `login` instruction. A model that asks for the passcode directly
has moved the account's master secret into a transcript, which is exactly what
the out-of-band unlock design exists to prevent.
