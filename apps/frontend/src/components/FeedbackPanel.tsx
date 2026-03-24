import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Send, Settings, Loader2, Sparkles, Trash2, User, Bot } from 'lucide-react';
import {
  loadConfig,
  saveConfig,
  isConfigured,
  callLLM,
  buildUserContent,
  type LLMConfig,
  type ChatMessage,
} from '../lib/llm';

interface FeedbackPanelProps {
  open: boolean;
  onClose: () => void;
  getElements: () => unknown[];
  getScreenshot: () => Promise<string | null>;
}

const PROVIDERS: { value: LLMConfig['provider']; label: string; needsKey: boolean }[] = [
  { value: 'ollama', label: 'Ollama (local)', needsKey: false },
  { value: 'openai', label: 'OpenAI', needsKey: true },
  { value: 'anthropic', label: 'Anthropic', needsKey: true },
  { value: 'custom', label: 'Custom (OpenAI-compatible)', needsKey: false },
];

const DEFAULT_ENDPOINTS: Record<string, string> = {
  ollama: 'http://localhost:11434',
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  custom: '',
};

const DEFAULT_MODELS: Record<string, string> = {
  ollama: 'llava',
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  custom: '',
};

export default function FeedbackPanel({ open, onClose, getElements, getScreenshot }: FeedbackPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [sendScreenshot, setSendScreenshot] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState<LLMConfig>(loadConfig);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const screenshotRef = useRef<string | null>(null);

  // Inject spin keyframes once
  useMemo(() => {
    if (document.getElementById('feedback-spin-style')) return;
    const style = document.createElement('style');
    style.id = 'feedback-spin-style';
    style.textContent = `@keyframes feedback-spin { to { transform: rotate(360deg); } }`;
    document.head.appendChild(style);
  }, []);

  // Auto-show settings on first open if not configured
  const hasShownSettings = useRef(false);
  useEffect(() => {
    if (open && !hasShownSettings.current && !isConfigured(config)) {
      setShowSettings(true);
      hasShownSettings.current = true;
    }
  }, [open, config]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (open && !showSettings) inputRef.current?.focus();
  }, [open, loading, showSettings]);

  function handleConfigChange(field: keyof LLMConfig, value: string) {
    const updated = { ...config, [field]: value };

    // Auto-fill endpoint and model when provider changes
    if (field === 'provider') {
      const provider = value as LLMConfig['provider'];
      if (!config.endpoint || Object.values(DEFAULT_ENDPOINTS).includes(config.endpoint)) {
        updated.endpoint = DEFAULT_ENDPOINTS[provider] ?? '';
      }
      if (!config.model || Object.values(DEFAULT_MODELS).includes(config.model)) {
        updated.model = DEFAULT_MODELS[provider] ?? '';
      }
    }

    setConfig(updated);
    saveConfig(updated);
  }

  async function handleSend() {
    if (!isConfigured(config)) {
      setShowSettings(true);
      setError('Please configure your AI provider first.');
      return;
    }

    setLoading(true);
    setError(null);

    const isFirstMessage = messages.length === 0;
    const userMessage = prompt.trim() || (isFirstMessage ? 'Please review this design and provide feedback.' : '');

    if (!userMessage) {
      setLoading(false);
      return;
    }

    const updatedMessages: ChatMessage[] = [
      ...messages,
      { role: 'user', content: userMessage },
    ];
    setMessages(updatedMessages);
    setPrompt('');

    try {
      let screenshot: string | undefined;
      let elements: unknown[] | undefined;

      if (isFirstMessage) {
        elements = getElements();
        if (sendScreenshot) {
          const s = await getScreenshot();
          if (s) {
            screenshot = s;
            screenshotRef.current = s;
          }
        }
        if (!elements.length && !screenshot) {
          setError('Canvas is empty. Draw something first!');
          setMessages(messages);
          setLoading(false);
          return;
        }
      } else {
        screenshot = screenshotRef.current ?? undefined;
      }

      const userContent = buildUserContent(isFirstMessage ? elements : undefined, userMessage);
      const reply = await callLLM(config, userContent, isFirstMessage ? [] : messages, screenshot);

      setMessages([
        ...updatedMessages,
        { role: 'assistant', content: reply },
      ]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to get feedback';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function handleClearChat() {
    setMessages([]);
    setError(null);
    screenshotRef.current = null;
  }

  if (!open) return null;

  const providerInfo = PROVIDERS.find((p) => p.value === config.provider);
  const configured = isConfigured(config);

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <Sparkles size={16} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>AI Feedback</span>
        </div>
        <div style={styles.headerRight}>
          {messages.length > 0 && (
            <button style={styles.iconBtn} onClick={handleClearChat} title="Clear chat">
              <Trash2 size={15} />
            </button>
          )}
          <button
            style={{
              ...styles.iconBtn,
              ...(showSettings ? { color: '#7c3aed' } : {}),
            }}
            onClick={() => setShowSettings((s) => !s)}
            title="AI Settings"
          >
            <Settings size={15} />
          </button>
          <button style={styles.iconBtn} onClick={onClose} title="Close">
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Settings section */}
      {showSettings && (
        <div style={styles.settings}>
          <div style={styles.settingsTitle}>Your AI Configuration</div>
          <div style={{
            ...styles.badge,
            background: configured ? '#1e293b' : '#7f1d1d',
            color: configured ? '#64748b' : '#fca5a5',
          }}>
            {configured
              ? `${config.provider} / ${config.model}`
              : 'Not configured — set up below'}
          </div>

          <label style={styles.label}>
            Provider
            <select
              style={styles.select}
              value={config.provider}
              onChange={(e) => handleConfigChange('provider', e.target.value)}
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>

          <label style={styles.label}>
            Endpoint
            <input
              style={styles.input}
              type="text"
              placeholder={DEFAULT_ENDPOINTS[config.provider]}
              value={config.endpoint}
              onChange={(e) => handleConfigChange('endpoint', e.target.value)}
            />
          </label>

          <label style={styles.label}>
            Model
            <input
              style={styles.input}
              type="text"
              placeholder={DEFAULT_MODELS[config.provider]}
              value={config.model}
              onChange={(e) => handleConfigChange('model', e.target.value)}
            />
          </label>

          {providerInfo?.needsKey && (
            <label style={styles.label}>
              API Key
              <input
                style={styles.input}
                type="password"
                placeholder={config.provider === 'openai' ? 'sk-...' : 'sk-ant-...'}
                value={config.apiKey || ''}
                onChange={(e) => handleConfigChange('apiKey', e.target.value)}
              />
            </label>
          )}

          <div style={styles.settingsNote}>
            Your API keys are stored only in your browser and never sent to our server.
            {config.provider === 'ollama' && ' Make sure Ollama is running locally.'}
          </div>
        </div>
      )}

      {/* Chat messages */}
      <div style={styles.chatArea}>
        {messages.length === 0 && !loading && (
          <div style={styles.emptyState}>
            <Sparkles size={24} style={{ opacity: 0.3 }} />
            <p style={{ margin: '8px 0 0', opacity: 0.5, fontSize: 13 }}>
              Ask AI to review your design
            </p>
            <p style={{ margin: '4px 0 0', opacity: 0.35, fontSize: 11 }}>
              {configured
                ? 'You can ask follow-up questions after the initial review'
                : 'Configure your AI provider using the gear icon above'}
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              ...styles.messageBubble,
              ...(msg.role === 'user' ? styles.userBubble : styles.assistantBubble),
            }}
          >
            <div style={styles.messageIcon}>
              {msg.role === 'user' ? <User size={12} /> : <Bot size={12} />}
            </div>
            <div style={styles.messageContent}>{msg.content}</div>
          </div>
        ))}

        {loading && (
          <div style={{ ...styles.messageBubble, ...styles.assistantBubble }}>
            <div style={styles.messageIcon}><Bot size={12} /></div>
            <div style={styles.loadingDots}>
              <Loader2 size={14} style={{ animation: 'feedback-spin 1s linear infinite' }} />
              <span>Thinking...</span>
            </div>
          </div>
        )}

        {error && <div style={styles.errorMsg}>{error}</div>}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div style={styles.inputArea}>
        {messages.length === 0 && (
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={sendScreenshot}
              onChange={(e) => setSendScreenshot(e.target.checked)}
            />
            <span style={{ fontSize: 12 }}>Include screenshot</span>
          </label>
        )}

        <div style={styles.promptRow}>
          <input
            ref={inputRef}
            style={styles.promptInput}
            type="text"
            placeholder={
              messages.length === 0
                ? 'Ask for feedback, or press send for general review...'
                : 'Ask a follow-up question...'
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loading) handleSend();
            }}
            disabled={loading}
          />
          <button
            style={{ ...styles.sendBtn, opacity: loading ? 0.6 : 1 }}
            onClick={handleSend}
            disabled={loading}
            title="Send"
          >
            {loading ? <Loader2 size={16} style={{ animation: 'feedback-spin 1s linear infinite' }} /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 380,
    height: '100%',
    background: '#0f172a',
    color: '#e2e8f0',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 1000,
    boxShadow: '-4px 0 24px rgba(0,0,0,0.3)',
    borderLeft: '1px solid #1e293b',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid #1e293b',
    flexShrink: 0,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 8 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 4 },
  iconBtn: {
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer',
    padding: 6,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
  },
  settings: {
    padding: '12px 16px',
    borderBottom: '1px solid #1e293b',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    background: '#1e293b40',
    flexShrink: 0,
    maxHeight: 340,
    overflowY: 'auto' as const,
  },
  settingsTitle: {
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    color: '#94a3b8',
  },
  badge: {
    fontSize: 11,
    padding: '4px 8px',
    borderRadius: 4,
    width: 'fit-content',
  },
  label: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    fontSize: 12,
    color: '#94a3b8',
  },
  select: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 6,
    color: '#e2e8f0',
    padding: '6px 8px',
    fontSize: 13,
    outline: 'none',
  },
  input: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 6,
    color: '#e2e8f0',
    padding: '6px 8px',
    fontSize: 13,
    outline: 'none',
  },
  settingsNote: {
    fontSize: 11,
    color: '#475569',
    fontStyle: 'italic',
  },
  chatArea: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '12px 12px 4px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    color: '#94a3b8',
    textAlign: 'center' as const,
  },
  messageBubble: {
    display: 'flex',
    gap: 8,
    padding: '10px 12px',
    borderRadius: 10,
    fontSize: 13,
    lineHeight: 1.6,
  },
  userBubble: {
    background: '#1e3a5f',
    alignSelf: 'flex-end' as const,
    marginLeft: 32,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    background: '#1e293b',
    alignSelf: 'flex-start' as const,
    marginRight: 32,
    borderBottomLeftRadius: 4,
  },
  messageIcon: { flexShrink: 0, marginTop: 2, opacity: 0.5 },
  messageContent: {
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    flex: 1,
  },
  loadingDots: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: '#94a3b8',
    fontSize: 13,
  },
  errorMsg: {
    background: '#450a0a',
    color: '#fca5a5',
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 13,
    border: '1px solid #7f1d1d',
  },
  inputArea: {
    padding: '10px 12px 14px',
    borderTop: '1px solid #1e293b',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    flexShrink: 0,
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    color: '#94a3b8',
    cursor: 'pointer',
  },
  promptRow: { display: 'flex', gap: 8 },
  promptInput: {
    flex: 1,
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 8,
    color: '#e2e8f0',
    padding: '8px 12px',
    fontSize: 13,
    outline: 'none',
  },
  sendBtn: {
    background: '#7c3aed',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '8px 12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
};
