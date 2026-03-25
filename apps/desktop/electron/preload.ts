import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  /** Proxy Ollama requests through Node.js (no CORS restrictions) */
  ollamaFetch: (url: string, body: unknown): Promise<unknown> =>
    ipcRenderer.invoke('ollama:fetch', url, body),
});
