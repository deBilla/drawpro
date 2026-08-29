# Connect Claude Code

Lets Claude create and edit diagrams in your DrawPro account from the terminal.

## 1. Mint a token

In DrawPro, open **Connect to Claude Code** in the sidebar and generate a token.
It is shown once and cannot be retrieved afterwards — only its SHA-256 is
stored, so a database leak yields no working credentials.

Treat it like a password. Anyone holding it can act as you.

## 2. Register the server

```bash
claude mcp add drawpro --scope user \
  -e DRAWPRO_TOKEN="dp_live_..." \
  -- npx -y @drawpro/mcp
```

Restart Claude Code afterwards. The server runs as a subprocess started with
each session, so a restart is also how you pick up a new version.

**`--scope user` matters.** Without it the scope defaults to `local`, which
loads the server only in the directory you ran the command in — and diagramming
is not a property of one repository. Avoid `--scope project`: it writes
`.mcp.json` into whichever repo you are standing in, token included, where it
invites being committed.

## 3. Unlock reading (optional)

Creating diagrams needs only the token. **Reading** them needs your passcode,
which unwraps your private key:

```bash
npx -y @drawpro/mcp login
```

It prompts in the terminal, derives the key, and stores **the key, not the
passcode**, in your OS keychain. `login --forget` clears it again.

This is deliberately a separate command rather than a tool. A stdio server
cannot prompt, and routing a passcode through a tool argument would put your
account's master secret into the model's context and the transcript. If you ask
Claude to read a sheet while locked, it will relay this instruction — it should
never ask you for the passcode directly.

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
