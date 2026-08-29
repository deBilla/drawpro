# The life of an MCP tool

How a tool gets designed, built, tested, published, and judged here. Written
from what actually went wrong building the eight that exist, because most of
those failures were not visible from inside the code.

## 1. Design the contract before the code

A tool is a contract offered to a model that cannot ask clarifying questions.
Two failures dominate, and both are contract failures rather than bugs.

**The tool that quietly destroys something.** `update_diagram` regenerates
layout from a spec, so running it on a hand-drawn sheet silently discards every
hand-placed element. It did what it said; what it said was not what a caller
would infer. The fix was two more tools — `edit_sheet_text` for wording,
`import_sheet` for geometry — not a warning in the description.

**The contract that contradicts itself.** `edit_sheet_text` required byte-exact
`find` text, and its description said to copy that text from `read_sheet` —
which flattens newlines for readability. For any multi-line element the
documented workflow could not succeed. Two sessions spent hours on it, because
from the outside a rejected edit is indistinguishable from a wrong guess.

> Before writing a tool, take its own description and try to follow it using
> only the output of the other tools. If that path cannot work, the contract is
> broken no matter how correct the implementation is.

Refusals are part of the contract. When a tool declines, the message is read by
a model that will decide what to do next, so it should say what to do, whether a
retry will work, and what not to ask the user for. `read_sheet` on a locked
account is the worked example: it names the account, gives the exact unlock
command, states that no restart is needed, and forbids asking for the passcode.

## 2. Put the logic where it can be tested

Handlers should be thin. Anything with real behaviour moves into `packages/` and
gets called from the tool.

This is not tidiness. `growBoxesToFitText` lived inline in the server, and the
test written for it exercised nothing at all — see below. Extracting it made the
interesting cases reachable in a unit test that runs in milliseconds.

## 3. Test in three layers, because each misses what the others catch

**Unit — the extracted logic.** Fast, and where edge cases belong.

The trap: *testing generated output proves less than it appears*. The generator
binds every label to its container, so any behaviour that only affects unbound
text is silently skipped. Two bugs hid there — label recovery in `describeScene`
and box growing in `edit_sheet_text` — and in the second case the test passed
while exercising zero lines of the code under test. Fixtures must be shaped like
a **hand-drawn** scene: text placed on a shape rather than typed into it.

**Protocol — the server over stdio.** Compiling says nothing about protocol
behaviour. `packages/mcp/tests/smoke.ts` spawns the server and speaks MCP to it,
asserting the tool inventory, that descriptions exist, both `validate_spec`
paths, and that a locked account explains itself without asking for a passcode.

**Clean room — the published artifact.** Install the tarball in an empty
directory outside the repo and run it as a user would. This layer has caught
three bugs nothing else could:

- a duplicated shebang, because esbuild preserves the entry file's own — the
  binary would not start at all
- an API client constructed at module scope, so a missing token threw a stack
  trace before any command could run, including the one that sets the token
- npx resolving the workspace copy inside a repo checkout, whose bin is not
  linked, producing `command not found` that looks exactly like a broken publish

## 4. Rules that come from outages, not taste

**Bookkeeping must never be able to take the server down.** A telemetry send ran
just before the server took over stdio. A synchronous throw rejected `main()`;
a failed write inside its `.then()` was an unhandled rejection. Either exits the
process, and the client sees only `CONNECTION_CLOSED`. Anything non-essential at
startup gets a `try` and a `.catch()`.

**stdout is the protocol.** Diagnostics go to stderr, always.

**Fail closed on partial success.** `edit_sheet_text` applies all edits or none.
A half-applied change leaves a state nobody expected, and the diff is invisible
without re-reading.

**Refuse with a reason, in the response.** A refused call that explains itself
lets a model correct and retry within the same turn. `create_diagram` returning
`error: Edge 0 references unknown node 'cache'` is what closes that loop.

## 5. Publish, then verify from the registry

```bash
npm publish --workspace @drawpro/mcp --access public --otp=<code>
```

Then install from npm in a clean directory and drive it over MCP. Verifying the
source tree verifies nothing about what users receive.

Wait a minute before the first `npx`. The CDN updates `dist-tags.latest` ahead
of the version metadata, so an immediate install can request a version npm's own
tag advertises and fail with `ETARGET` — which reads exactly like a failed
publish.

## 6. Observe before you evaluate

```bash
npx -y @drawpro/mcp stats
npx -y @drawpro/mcp stats --errors
```

The column that matters is **refused**. A tool declining most of its calls has a
contract that does not work, and that is far cheaper to learn from real use than
from a synthetic suite.

Real numbers from one machine, before any eval existed:

```
list_workspaces    7 calls   6 failed
edit_sheet_text    6 calls   3 refused   3 failed
0 successful writes to sheets
```

Two distinct problems — an auth failure and the newline contract — both visible
at a glance, both of which had already cost hours of manual diagnosis.

## 7. Evaluate what usage tells you to

`packages/mcp/plugin/evals/` holds the suite. `claude plugin eval` runs it
against an ablation arm, and the with/without delta is the number that says
whether the package earns its place.

Grade **outcomes**, not phrasing: a sheet exists afterwards, `validateScene` is
clean, node counts match, a rejected spec gets corrected and retried. A grader
that pins wording measures rewording.

One grader fails a run outright regardless of everything else: asking the user
to type their passcode into the conversation.

The honest caveat: **write evals after usage, not before.** `edit_sheet_text`
and `import_sheet` both exist because real use found them missing, and neither
would have been predicted by an eval written in advance — those graded "does it
produce a good diagram", while the actual failures were "the tool cannot be used
at all".

## 8. Changing a tool that already ships

Widen, do not narrow. `edit_sheet_text` moving from byte-exact to
whitespace-collapsed matching accepts everything it accepted before.

Reproduce the failure before fixing it, and confirm the fix against the same
reproduction — a three-line element, read back flattened, then edited with
exactly that flattened string: refused on the old version, applied on the new.

Bump the version and republish. A fix that is not published is not a fix, and
the gap between "committed" and "available" is where the confusing hours go.
