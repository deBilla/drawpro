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

It prompts in the terminal and stores **the key, not the passcode**, in your OS
keychain. This is deliberately not a tool: a stdio server cannot prompt, and
passing a passcode as a tool argument would put your account's master secret
into the model's context and the transcript. If you ask Claude to read while
locked, it will relay this instruction — it should never ask you for the
passcode directly.

The key is stored per account, so connecting a token for a different account
means unlocking that one too.

## Checking it worked

Ask Claude to list your DrawPro workspaces. If the tools are missing, they were
probably registered with the default `local` scope; re-run step 2 with
`--scope user`.

## Known trap: running from a checkout of this repository

Inside a clone of `drawpro`, npm resolves `@drawpro/mcp` to the workspace copy,
whose bin is not linked, and npx fails with:

```
sh: drawpro-mcp: command not found
```

That is not a fault in the published package. Run the commands from anywhere
else, or use `node packages/mcp/dist/server.js <command>` in the repo.
