interface Window {
  electronAPI?: {
    /** Proxy Ollama requests through Electron's Node.js process (no CORS) */
    ollamaFetch: (url: string, body: unknown) => Promise<{ data?: unknown; error?: string }>;
  };
}
