/**
 * Browser-side LLM client — calls the user's own LLM endpoint directly.
 * API keys never leave the user's browser.
 */

/** Thrown when Ollama is unreachable due to CORS — UI should prompt extension install */
export class OllamaCorsError extends Error {
  constructor() {
    super(
      'Cannot connect to Ollama. Install the "DrawPro Ollama Bridge" browser extension to enable the connection.',
    );
    this.name = 'OllamaCorsError';
  }
}

export interface LLMConfig {
  provider: 'ollama' | 'openai' | 'anthropic' | 'custom';
  endpoint: string;
  model: string;
  apiKey?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const STORAGE_KEY = 'drawpro_llm_config';

const DEFAULT_CONFIG: LLMConfig = {
  provider: 'ollama',
  endpoint: 'http://localhost:11434',
  model: 'llava',
};

export function loadConfig(): LLMConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: Partial<LLMConfig>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function isConfigured(config: LLMConfig): boolean {
  if (!config.endpoint || !config.model) return false;
  // Ollama doesn't need an API key
  if (config.provider === 'ollama') return true;
  // Others need an API key
  return !!config.apiKey;
}

const SYSTEM_PROMPT = `You are a senior technical reviewer. You are given a whiteboard, diagram, or document created in Excalidraw.

Your ONLY job is to verify:
1. **Factual correctness** — are the statements, data, numbers, and labels factually accurate? Flag anything that is wrong or misleading.
2. **Relationships** — are the connections, arrows, flows, and dependencies between elements correct? Do they represent the real-world relationships accurately? Are there any missing or incorrect links?

Do NOT comment on:
- Visual design, layout, spacing, colors, or formatting
- Completeness or missing features (unless a shown relationship is broken)
- Ambiguity, clarity, or presentation style
- Accessibility or usability

Be concise and specific. Reference the actual text/labels you see. If a relationship or fact is wrong, explain what is incorrect and what it should be. If everything checks out, say so briefly.`;

export function buildUserContent(
  elements: unknown[] | undefined,
  userPrompt: string | undefined,
): string {
  const parts: string[] = [];

  if (userPrompt) {
    parts.push(userPrompt);
  } else {
    parts.push('Please review this design and provide feedback.');
  }

  if (elements && elements.length > 0) {
    const summary = elements.map((el: unknown) => {
      const e = el as Record<string, unknown>;
      return `- ${e.type ?? 'unknown'}${e.text ? `: "${e.text}"` : ''} at (${e.x}, ${e.y}) size ${e.width}x${e.height}`;
    });
    parts.push('\nExcalidraw elements:\n' + summary.join('\n'));
  }

  return parts.join('\n\n');
}

// ─── Chrome extension messaging (type-safe wrappers) ────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chromeRuntime = (globalThis as any).chrome?.runtime as
  | {
      sendMessage: (id: string, msg: unknown, cb: (resp: any) => void) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
      lastError?: { message?: string };
    }
  | undefined;

/** Send a request to Ollama via the DrawPro Ollama Bridge extension */
function sendViaExtension(
  extensionId: string,
  url: string,
  body: unknown,
): Promise<{ data?: unknown; error?: string }> {
  return new Promise((resolve) => {
    try {
      if (!chromeRuntime) { resolve({ error: 'Extension not available' }); return; }
      chromeRuntime.sendMessage(extensionId, {
        type: 'DRAWPRO_OLLAMA_REQUEST',
        url,
        body,
      }, (response) => {
        if (chromeRuntime.lastError) {
          resolve({ error: chromeRuntime.lastError.message });
        } else {
          resolve(response ?? { error: 'No response from extension' });
        }
      });
    } catch {
      resolve({ error: 'Extension not available' });
    }
  });
}

/** Try to detect the extension by sending a ping */
async function detectExtension(extensionId: string): Promise<boolean> {
  if (!extensionId || !chromeRuntime) return false;
  return new Promise((resolve) => {
    try {
      chromeRuntime.sendMessage(extensionId, { type: 'DRAWPRO_OLLAMA_PING' }, (response) => {
        resolve(!chromeRuntime.lastError && response?.installed === true);
      });
    } catch {
      resolve(false);
    }
  });
}

// ─── Ollama ──────────────────────────────────────────────────────────────────

async function callOllama(
  config: LLMConfig,
  userContent: string,
  history: ChatMessage[],
  screenshot?: string,
): Promise<string> {
  const messages: unknown[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  if (history.length === 0) {
    const msg: Record<string, unknown> = { role: 'user', content: userContent };
    if (screenshot) {
      msg.images = [screenshot.replace(/^data:image\/\w+;base64,/, '')];
    }
    messages.push(msg);
  } else {
    const first = history[0];
    const firstMsg: Record<string, unknown> = { role: first.role, content: first.content };
    if (screenshot && first.role === 'user') {
      firstMsg.images = [screenshot.replace(/^data:image\/\w+;base64,/, '')];
    }
    messages.push(firstMsg);
    for (let i = 1; i < history.length; i++) {
      messages.push({ role: history[i].role, content: history[i].content });
    }
    messages.push({ role: 'user', content: userContent });
  }

  const url = `${config.endpoint}/api/chat`;
  const body = { model: config.model, messages, stream: false };

  // 1. Electron IPC — no CORS, no extension needed
  if (window.electronAPI) {
    const result = await window.electronAPI.ollamaFetch(url, body);
    if (result.error) throw new Error(result.error);
    const data = result.data as { message?: { content?: string } };
    return data?.message?.content ?? 'No response from model.';
  }

  // 2. Try Chrome extension if ID is configured
  const extId = localStorage.getItem('drawpro_ollama_ext_id') || '';
  if (extId) {
    const hasExtension = await detectExtension(extId);
    if (hasExtension) {
      const result = await sendViaExtension(extId, url, body);
      if (result.error) {
        throw new Error(result.error);
      }
      const data = result.data as { message?: { content?: string } };
      return data?.message?.content ?? 'No response from model.';
    }
  }

  // 3. Direct fetch — works on localhost or if OLLAMA_ORIGINS is set
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new OllamaCorsError();
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? 'No response from model.';
}

// ─── OpenAI-compatible ───────────────────────────────────────────────────────

async function callOpenAICompatible(
  config: LLMConfig,
  userContent: string,
  history: ChatMessage[],
  screenshot?: string,
): Promise<string> {
  const messages: unknown[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  function makeUserMsg(text: string, withImage: boolean): Record<string, unknown> {
    if (withImage && screenshot) {
      return {
        role: 'user',
        content: [
          { type: 'text', text },
          {
            type: 'image_url',
            image_url: {
              url: screenshot.startsWith('data:') ? screenshot : `data:image/png;base64,${screenshot}`,
            },
          },
        ],
      };
    }
    return { role: 'user', content: text };
  }

  if (history.length === 0) {
    messages.push(makeUserMsg(userContent, true));
  } else {
    messages.push(
      history[0].role === 'user'
        ? makeUserMsg(history[0].content, true)
        : { role: history[0].role, content: history[0].content },
    );
    for (let i = 1; i < history.length; i++) {
      messages.push({ role: history[i].role, content: history[i].content });
    }
    messages.push({ role: 'user', content: userContent });
  }

  const endpoint = config.endpoint.replace(/\/$/, '');
  const res = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: config.model, messages, max_tokens: 2048 }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? 'No response from model.';
}

// ─── Anthropic ───────────────────────────────────────────────────────────────

async function callAnthropic(
  config: LLMConfig,
  userContent: string,
  history: ChatMessage[],
  screenshot?: string,
): Promise<string> {
  function makeUserContent(text: string, withImage: boolean): unknown[] {
    const parts: unknown[] = [];
    if (withImage && screenshot) {
      const base64 = screenshot.replace(/^data:image\/\w+;base64,/, '');
      parts.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: base64 },
      });
    }
    parts.push({ type: 'text', text });
    return parts;
  }

  const messages: unknown[] = [];

  if (history.length === 0) {
    messages.push({ role: 'user', content: makeUserContent(userContent, true) });
  } else {
    messages.push({
      role: history[0].role,
      content: history[0].role === 'user' ? makeUserContent(history[0].content, true) : history[0].content,
    });
    for (let i = 1; i < history.length; i++) {
      messages.push({ role: history[i].role, content: history[i].content });
    }
    messages.push({ role: 'user', content: userContent });
  }

  const endpoint = config.endpoint.replace(/\/$/, '');
  const res = await fetch(`${endpoint}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey ?? '',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  return data.content?.map((b) => b.text).join('') ?? 'No response from model.';
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export async function callLLM(
  config: LLMConfig,
  userContent: string,
  history: ChatMessage[],
  screenshot?: string,
): Promise<string> {
  switch (config.provider) {
    case 'ollama':
      return callOllama(config, userContent, history, screenshot);
    case 'openai':
    case 'custom':
      return callOpenAICompatible(config, userContent, history, screenshot);
    case 'anthropic':
      return callAnthropic(config, userContent, history, screenshot);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
