# DrawPro Ollama Bridge

A lightweight Chrome extension that enables DrawPro to connect to your local Ollama instance.

## Why is this needed?

Browsers block web pages from making requests to `localhost` for security reasons (CORS policy). This extension adds the necessary headers so DrawPro can communicate with Ollama running on your machine.

## Install (Developer Mode)

1. Download or clone this folder
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked** and select this `ollama-cors` folder
5. The extension icon should appear in your toolbar

## Packaging (for distribution)

The `.zip` is a build artifact and is not committed. Rebuild it from this folder:

```bash
cd extensions/ollama-cors
zip -r ../ollama-cors.zip manifest.json background.js icon48.png icon128.png README.md
```

## What it does

- Adds CORS headers to responses from `localhost:11434` (Ollama's default port)
- Only affects requests to Ollama — no other traffic is modified
- No data is collected or sent anywhere

## Permissions

- `declarativeNetRequest` — to modify response headers on Ollama requests
- `localhost:11434` and `127.0.0.1:11434` — only these hosts are affected
