# MCP eval scorecard

`@drawpro/mcp` **0.6.5** — **33/33** checks passing (100%), generated 2026-08-30.

Produced by `npm run eval --workspace @drawpro/mcp`, which drives the real server over a real MCP stdio session against a fake DrawPro API. No account, no API key, no network. Every check below states what it protects, because a check that cannot say that is measuring its own implementation.

## contract — 6/6

The tool inventory a model is offered, and what it promises.

| | Check | Guards against |
|---|---|---|
| ✅ | exposes exactly the eight documented tools | A tool that exists but is undocumented gets used by guesswork. |
| ✅ | every tool describes itself in more than a label | Selection between eight tools is made from these strings alone. |
| ✅ | the node schema offers no place to put coordinates | Hand-supplied geometry is what produces the overlapping boxes. |
| ✅ | update_diagram announces that it overwrites, and names the tool to run first | Silent wholesale replacement of a hand-drawn sheet is unrecoverable. |
| ✅ | edit_sheet_text points at itself as the safe path for a drawn sheet | Otherwise every wording fix reaches for the tool that regenerates layout. |
| ✅ | validate_spec needs no workspace, so it cannot write anywhere | A dry run that could write is not a dry run. |

## generation — 10/10

A coordinate-free spec becomes a diagram that renders cleanly.

| | Check | Guards against |
|---|---|---|
| ✅ | a valid spec creates a sheet and returns a link to it | Without the link the user cannot find what was just made. |
| ✅ | one shape per node in the spec | A dropped participant is a diagram that lies about the system. |
| ✅ | one arrow per edge in the spec | A dropped edge is a connection the reader will not know exists. |
| ✅ | every node label appears in the scene | Boxes without their labels are the failure this tool replaces. |
| ✅ | every arrow is bound to a shape at both ends | Unbound arrows detach the moment anyone moves a box in the editor. |
| ✅ | the generated scene passes its own structural validator | Broken bindings and spilled text render as a visibly wrong diagram. |
| ✅ | no two node boxes overlap | Overlapping boxes are the single most common hand-written-JSON defect. |
| ✅ | a spec title becomes a title element | An untitled sheet in a list of sheets is unidentifiable. |
| ✅ | the element count in the reply matches the sheet that was written | A model relays this number to the user; a wrong one is a quiet lie. |
| ✅ | read_sheet reports back every participant it just wrote | Extending an existing diagram starts by reading it. |

## privacy — 8/8

Nothing readable leaves the machine, and the passcode is never requested.

| | Check | Guards against |
|---|---|---|
| ✅ | no node label, edge label, or title appears in any request body | This is the entire end-to-end encryption claim. If it fails, the claim is false. |
| ✅ | the sheet name sent to the server is the [encrypted] sentinel | Sheet names are content: a dashboard of readable titles leaks the whole map. |
| ✅ | the blob the server stored decrypts back to the diagram | Sending nothing readable is only useful if the real content is in there. |
| ✅ | the workspace id is sent, but no diagram content rides along with it | Metadata leaks are how "encrypted" products turn out to be readable. |
| ✅ | a locked read returns the exact unlock command instead of an opaque error | An unexplained failure gets retried forever or reported as a broken product. |
| ✅ | the message says the same tool can simply be retried afterwards | Otherwise the model tells the user to restart Claude, which is not needed. |
| ✅ | the message forbids asking the user for their passcode | The passcode is the account master secret. A model that asks for it puts it in a transcript, which is exactly what the out-of-band unlock exists to prevent. |
| ✅ | listing still returns ids while names stay unreadable | A locked account should be navigable, not bricked. |

## recovery — 9/9

Bad calls are refused with enough information to fix them.

| | Check | Guards against |
|---|---|---|
| ✅ | a dangling edge is refused by naming the node that is missing | Without the name, the fix is a guess and the model retries blind. |
| ✅ | a refused create leaves no sheet behind | A half-created diagram is worse than none — nobody knows it is there. |
| ✅ | the corrected spec the message implies is accepted | A refusal that cannot be satisfied is a dead end dressed as guidance. |
| ✅ | validate_spec reports the duplicate id and the dangling edge | Checking before writing is only worth doing if it finds what writing would. |
| ✅ | validate_spec creates nothing | A dry run with side effects is a trap. |
| ✅ | one unmatched find leaves every element untouched | A partially applied edit is invisible until someone re-reads the sheet. |
| ✅ | the refusal reports that nothing was written | Silence here reads as success and the wrong text ships. |
| ✅ | a successful edit changes the text and no coordinate | Rewriting a label must not silently redraw a hand-placed diagram. |
| ✅ | importing a file that is not there explains itself instead of crashing | A stack trace here tells the model nothing it can act on. |

