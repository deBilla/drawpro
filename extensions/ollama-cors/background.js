// Listen for messages from DrawPro web app to confirm extension is installed
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.type === 'DRAWPRO_OLLAMA_PING') {
    sendResponse({ installed: true, version: chrome.runtime.getManifest().version });
  }
});
