# Privacy

Two separate questions, with different answers: what happens to your **diagrams**,
and what happens to **usage data**.

## Diagrams

Content is encrypted in the client before it is sent. The server stores an
opaque blob and holds your public key, which is enough to seal data *to* you and
not enough to open it.

| | |
|---|---|
| Key agreement | X25519 |
| Content | AES-256-GCM, AAD `drawpro-e2ee-message` |
| KDF | HKDF-SHA512 |
| Passcode → private key | Argon2id, 128 MB / 4 iterations / 2 parallelism |
| Wire format | `ephPub(32) \| iv(16) \| tag(16) \| ciphertext`, base64 |

Sheet names travel inside the encrypted blob; the server stores `[encrypted]`.
Workspace names are encrypted separately by the same scheme.

The API **rejects** plaintext content from an account that has encryption keys,
rather than accepting it and encrypting server-side. Failing closed is what
makes the guarantee enforceable instead of merely intended.

### Why the MCP server runs locally

A hosted MCP server would have to receive plaintext diagrams in order to encrypt
them — handing the server exactly what the encryption exists to withhold.
Running on your machine keeps sealing and opening where the browser does.

This is a constraint, not a preference. "Make it a hosted remote server, it is
easier to onboard" would quietly undo the property the product is built on.

### Why unlocking is a separate command

Writing needs only your public key, so creating a diagram never involves your
passcode.

Reading needs the private key, which is wrapped with Argon2id over the passcode.
A stdio server cannot prompt for it, and passing it as a tool argument would put
your master secret into the model's context and the transcript. So `login`
handles it out of band: it prompts in the terminal, derives the key, and stores
**the key, not the passcode**, in the OS keychain — or a `0600` file under
`~/.drawpro` elsewhere, the same posture as `~/.ssh` private keys.

## Usage data

Off by default. Nothing is recorded and nothing is sent until you choose.

```bash
npx -y @drawpro/mcp telemetry      # show the state and the exact payload
npx -y @drawpro/mcp telemetry on
npx -y @drawpro/mcp telemetry off
npx -y @drawpro/mcp report         # send once, without turning anything on
```

`telemetry` prints the entire payload before you decide. Consent to something
unseen is not consent.

### The two artifacts

**The raw log** stays on your machine. It carries workspace and sheet ids so you
can correlate calls against your own account, plus timing broken into `api_ms`
and `local_ms` — because "the network is slow" and "argon2 is slow" look
identical in a single total and need different fixes.

**The aggregate** is what `stats` prints and what telemetry sends: tool names,
counts, timings. Nothing identifying an account, a workspace, a sheet, or
anything drawn on one.

```bash
npx -y @drawpro/mcp stats           # counts, refusals, timings
npx -y @drawpro/mcp stats --json    # safe to paste into an issue
npx -y @drawpro/mcp stats --errors  # why calls failed — local only
```

`--errors` groups failures by message from the raw log. It is the counterpart to
the aggregate carrying no error text: a run of failures shows in `stats` as a
count with no cause, and the cause is in the same file. It reads locally and
sends nothing.

One function produces both, so what you are shown and what would be sent cannot
drift apart.

### What the choices actually do

| You want | Do this |
|---|---|
| Nothing recorded, nothing sent | nothing — this is the default |
| Record locally, share nothing | set `DRAWPRO_MCP_LOG` |
| Record and share aggregates | `telemetry on` |

Opting in starts recording on its own, at `~/.drawpro/usage.jsonl`. Consenting to
*send* usage implies consent to *record* it, recording being the lesser act.
**The implication does not run the other way**: setting `DRAWPRO_MCP_LOG` records
locally and shares nothing.

Reports carry an install id generated on your machine and never derived from
your account, so repeated reports group together without identifying whose.
`POST /telemetry` is unauthenticated for the same reason — requiring a token
would tie every report to an account.

### What is never recorded

No labels, no node names, no file contents, no token, no passcode. Asserted by
tests rather than by intention.
