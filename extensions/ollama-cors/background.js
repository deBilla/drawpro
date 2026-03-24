// DrawPro Ollama Bridge — proxies Ollama requests from the extension's
// service worker context, which is not subject to CORS restrictions.

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.type === 'DRAWPRO_OLLAMA_PING') {
    sendResponse({ installed: true, version: chrome.runtime.getManifest().version });
    return;
  }

  if (message.type === 'DRAWPRO_OLLAMA_REQUEST') {
    const { url, body } = message;

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          sendResponse({ error: `Ollama error ${res.status}: ${text}` });
        } else {
          const data = await res.json();
          sendResponse({ data });
        }
      })
      .catch((err) => {
        sendResponse({ error: `Cannot reach Ollama: ${err.message}` });
      });

    // Return true to indicate async sendResponse
    return true;
  }
});
