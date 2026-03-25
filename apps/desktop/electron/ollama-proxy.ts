/**
 * Ollama proxy — runs in Electron's main process (Node.js).
 * No CORS restrictions apply here.
 */
export async function ollamaFetch(
  url: string,
  body: unknown,
): Promise<{ data?: unknown; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      return { error: `Ollama error ${res.status}: ${text}` };
    }

    const data = await res.json();
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { error: `Cannot reach Ollama: ${message}` };
  }
}
