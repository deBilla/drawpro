# Connect Claude Code

Lets Claude create and edit diagrams in your DrawPro account from the terminal.

## Connect

Generate a token in DrawPro under **Connect to Claude Code**, then run the one
command it gives you:

```bash
npx -y @drawpro/mcp connect dp_live_...
```

It checks the token, registers the server with Claude Code for all your
projects, and offers to unlock reading. Restart Claude Code afterwards.

Run it again with a new token to rotate — it replaces whatever was there, rather
than failing with "already exists".

Nothing is changed if the token is rejected.

### What it does, if you would rather do it by hand

```bash
claude mcp add drawpro --scope user -- npx -y @drawpro/mcp
npx -y @drawpro/mcp auth dp_live_...
npx -y @drawpro/mcp login          # only needed to read existing sheets
```

The registration deliberately carries no `-e DRAWPRO_TOKEN`. Claude Code can add
and remove a server but not edit one, so a token passed that way can only be
changed by removing and re-adding the whole server — and it then sits in
`~/.claude.json`, in your shell history, and in the process list. Stored
separately it lives in a `0600` file, and rotating is one command.

`DRAWPRO_TOKEN` in the environment still takes precedence where it is set, which
is worth knowing: it makes a stored token look like it was ignored.

## Reading needs your passcode

Creating diagrams needs only the token. Reading needs the private key, which is
wrapped with Argon2id over your passcode:

```bash
npx -y @drawpro/mcp login          # login --forget clears it
```

`connect` offers this at the end, so usually you will not run it separately.

**No restart is needed.** The key is read from the keychain on every read, not
cached when the server starts, so unlocking in another terminal takes effect on
the very next tool call. If Claude reports a locked account, run `login` and ask
it to try again — the same session picks it up.

It prompts in the terminal and stores **the key, not the passcode**, in your OS
keychain. This is deliberately not a tool: a stdio server cannot prompt, and
passing a passcode as a tool argument would put your account's master secret
into the model's context and the transcript. If you ask Claude to read while
locked, it will relay this instruction — it should never ask you for the
passcode directly.

The key is stored per account, so connecting a token for a different account
means unlocking that one too. Rotating a token for the *same* account does not
require unlocking again.

## Checking it worked

Ask Claude to list your DrawPro workspaces. If the tools are missing, they were
probably registered with the default `local` scope; re-run step 2 with
`--scope user`.

## Troubleshooting

### `CONNECTION_CLOSED` / "Failed to reconnect"

The server process exited on spawn. Reconnect with `/mcp`, and if it persists:

```bash
npm cache clean --force
```

`npx -y @drawpro/mcp` re-resolves on every spawn, so a half-written cache entry
after a version bump makes the process exit immediately. Clearing it is the
usual fix.

If it still fails, pin the version so npx stops resolving:

```bash
claude mcp remove drawpro -s user
claude mcp add drawpro -s user -- npx -y @drawpro/mcp@0.6.5
```

To see the actual error, run the same command by hand — Claude Code shows only
that the connection closed:

```bash
printf '' | npx -y @drawpro/mcp; echo "exit=$?"
```

A clean exit code 0 with no output means the server is fine and the problem is
in the client's spawn. Anything on stderr is the real cause.

### `ETARGET` — "No matching version found"

A propagation race, not a missing version: npm's CDN updates `dist-tags.latest`
before the version metadata reaches every edge, so npm asks for a version its
own tag advertises and cannot find it. Wait a minute and retry, or
`npm cache clean --force`.

### Reads say the account is locked

Run `npx -y @drawpro/mcp login`. **No restart is needed** — the key is read on
every call, so retrying the same tool immediately afterwards works.

### Known trap: running from a checkout of this repository

Inside a clone of `drawpro`, npm resolves `@drawpro/mcp` to the workspace copy,
whose bin is not linked, and npx fails with:

```
sh: drawpro-mcp: command not found
```

That is not a fault in the published package. Run the commands from anywhere
else, or use `node packages/mcp/dist/server.js <command>` in the repo.
