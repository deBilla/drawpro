import { useEffect, useState, type CSSProperties } from 'react';
import { Check, Copy, KeyRound, Terminal, Trash2, TriangleAlert, X } from 'lucide-react';
import type { ApiTokenSummary } from '@drawpro/shared-types';
import { tokensApi } from '../lib/api';

/**
 * Mint and manage the personal API tokens that let Claude Code (through the
 * DrawPro CLI) read and write sheets in this account.
 *
 * The token routes are session-only on the server — a token cannot manage
 * tokens — so this panel is the only place one can be created.
 */
/**
 * A shell command with its own copy button.
 *
 * The token is interpolated into the command rather than left as a placeholder,
 * so the whole line can be pasted straight into a terminal. It is the same
 * secret already shown above this block, so nothing extra is exposed.
 */
function CommandBlock({ step, command }: { step: string; command: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <>
      <div style={styles.stepsLabel}>{step}</div>
      <div style={styles.codeWrap}>
        <pre style={styles.code}>{command}</pre>
        <button style={styles.codeCopyBtn} onClick={copy} title="Copy command">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </>
  );
}

export default function ConnectClaudeCode({ onClose }: { onClose: () => void }) {
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  /** Held in memory only, and only until this panel is dismissed. */
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    try {
      setTokens(await tokensApi.list());
      setError(null);
    } catch {
      setError('Could not load your tokens.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleCreate() {
    const label = name.trim();
    if (!label || creating) return;
    setCreating(true);
    try {
      const created = await tokensApi.create({ name: label });
      setFreshToken(created.token);
      setName('');
      setError(null);
      await refresh();
    } catch {
      setError('Could not create the token.');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(token: ApiTokenSummary) {
    if (!window.confirm(`Revoke "${token.name}"? Anything using it stops working immediately.`)) {
      return;
    }
    try {
      await tokensApi.revoke(token.id);
      await refresh();
    } catch {
      setError('Could not revoke the token.');
    }
  }

  function copyToken() {
    if (!freshToken) return;
    void navigator.clipboard.writeText(freshToken).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>
            <Terminal size={18} />
            Connect to Claude Code
          </span>
          <button style={styles.iconBtn} onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <p style={styles.blurb}>
          A token lets Claude Code create and edit sheets in this account from your terminal.
          Treat it like a password — anyone holding it can act as you.
        </p>

        {freshToken ? (
          <div style={styles.tokenPanel}>
            <div style={styles.warnRow}>
              <TriangleAlert size={15} />
              <span>Copy this now — it is shown once and cannot be retrieved again.</span>
            </div>
            <div style={styles.tokenRow}>
              <code style={styles.tokenText}>{freshToken}</code>
              <button style={styles.copyBtn} onClick={copyToken}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <CommandBlock
              step="Run this in a terminal"
              command={`npx -y @drawpro/mcp connect ${freshToken}`}
            />

            <p style={styles.footnote}>
              This checks the token, registers the server with Claude Code, and offers to
              unlock reading. Restart Claude Code afterwards.
              <br />
              <br />
              Run it again any time with a new token to rotate — it replaces whatever was
              there. Reading asks for your passcode, which unwraps your private key on your
              own machine and is never sent anywhere. Claude will never ask you for it.
            </p>
            <button style={styles.doneBtn} onClick={() => setFreshToken(null)}>
              I&apos;ve saved it
            </button>
          </div>
        ) : (
          <div style={styles.createRow}>
            <input
              style={styles.input}
              placeholder="What is this token for? e.g. laptop"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
              }}
              maxLength={100}
            />
            <button
              style={{ ...styles.primaryBtn, opacity: name.trim() && !creating ? 1 : 0.5 }}
              onClick={() => void handleCreate()}
              disabled={!name.trim() || creating}
            >
              <KeyRound size={14} />
              {creating ? 'Generating…' : 'Generate'}
            </button>
          </div>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.listLabel}>Active tokens</div>
        {loading ? (
          <div style={styles.muted}>Loading…</div>
        ) : tokens.length === 0 ? (
          <div style={styles.muted}>No tokens yet.</div>
        ) : (
          <ul style={styles.list}>
            {tokens.map((t) => (
              <li key={t.id} style={styles.listItem}>
                <div style={styles.listMain}>
                  <div style={styles.listName}>{t.name}</div>
                  <div style={styles.listMeta}>
                    <code style={styles.prefix}>{t.prefix}…</code>
                    {' · '}
                    {t.lastUsedAt
                      ? `last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                      : 'never used'}
                  </div>
                </div>
                <button
                  style={styles.iconBtn}
                  onClick={() => void handleRevoke(t)}
                  title="Revoke token"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.72)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    padding: '24px 16px',
    overflowY: 'auto',
  },
  modal: {
    width: '100%',
    maxWidth: 560,
    background: '#fff',
    borderRadius: 12,
    padding: 24,
    boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700 },
  blurb: { margin: '0 0 18px', fontSize: 13, color: '#64748b', lineHeight: 1.5 },
  createRow: { display: 'flex', gap: 8, marginBottom: 8 },
  input: { flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14 },
  primaryBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  tokenPanel: {
    border: '1px solid #fde68a',
    background: '#fffbeb',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  warnRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12.5,
    fontWeight: 600,
    color: '#92400e',
    marginBottom: 10,
  },
  tokenRow: { display: 'flex', gap: 8, alignItems: 'center' },
  tokenText: {
    flex: 1,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    padding: '8px 10px',
    overflowX: 'auto',
    whiteSpace: 'nowrap',
  },
  copyBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '8px 12px',
    background: '#1e293b',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  stepsLabel: { fontSize: 12, fontWeight: 600, color: '#92400e', margin: '14px 0 6px' },
  codeWrap: { position: 'relative' },
  codeCopyBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 8px',
    background: '#334155',
    color: '#e2e8f0',
    border: 'none',
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
  code: {
    margin: 0,
    background: '#1e293b',
    color: '#e2e8f0',
    borderRadius: 6,
    padding: '10px 12px',
    paddingRight: 78,
    fontSize: 12,
    overflowX: 'auto',
    lineHeight: 1.6,
  },
  footnote: { fontSize: 11.5, color: '#78716c', margin: '10px 0 0', lineHeight: 1.6 },
  doneBtn: {
    marginTop: 14,
    padding: '7px 14px',
    background: '#fff',
    border: '1px solid #d6d3d1',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  error: { fontSize: 13, color: '#b91c1c', marginTop: 8 },
  listLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#94a3b8',
    margin: '22px 0 8px',
  },
  muted: { fontSize: 13, color: '#94a3b8' },
  list: { listStyle: 'none', margin: 0, padding: 0 },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 0',
    borderTop: '1px solid #f1f5f9',
  },
  listMain: { flex: 1, minWidth: 0 },
  listName: { fontSize: 14, fontWeight: 500 },
  listMeta: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  prefix: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 4,
    display: 'flex',
    alignItems: 'center',
    color: 'inherit',
    opacity: 0.7,
  },
};
