/**
 * PasscodeModal — shown in the Editor when a sheet is encrypted and the user
 * hasn't yet entered their passcode for this session.
 *
 * On success it calls `onUnlock`, which the Editor uses to trigger decryption.
 * On wrong passcode it shows an error (the decryption itself throws a DOMException).
 */

import { useState, useRef, useEffect } from 'react';
import { Lock, Loader } from 'lucide-react';

interface Props {
  sheetName: string;
  onUnlock: (passcode: string) => Promise<void>;
}

export default function PasscodeModal({ sheetName, onUnlock }: Props) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  function handleChange(idx: number, value: string) {
    const v = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[idx] = v;
    setDigits(next);
    if (v && idx < 5) inputRefs.current[idx + 1]?.focus();
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const passcode = digits.join('');
    if (passcode.length !== 6) {
      setError('Please enter all 6 digits.');
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await onUnlock(passcode);
    } catch {
      setError('Wrong passcode — decryption failed.');
      setDigits(Array(6).fill(''));
      setTimeout(() => inputRefs.current[0]?.focus(), 0);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.icon}>
          <Lock size={28} color="#6366f1" />
        </div>

        <h2 style={styles.title}>Sheet Encrypted</h2>
        <p style={styles.subtitle}>
          {sheetName === '[encrypted]'
            ? 'Enter your passcode to decrypt this sheet.'
            : <>Enter your passcode to decrypt <strong>{sheetName}</strong>.</>}
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.digitRow}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="password"
                inputMode="numeric"
                maxLength={1}
                value={d}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                style={{
                  ...styles.digitInput,
                  borderColor: error ? '#ef4444' : '#cbd5e1',
                }}
              />
            ))}
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" style={styles.btn} disabled={busy}>
            {busy ? (
              <>
                <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
                Decrypting…
              </>
            ) : (
              'Unlock Sheet'
            )}
          </button>
        </form>

        <p style={styles.note}>
          Your passcode is never sent to the server.
        </p>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#fff',
    borderRadius: 16,
    padding: '32px 28px',
    width: 340,
    textAlign: 'center',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: '#eef2ff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 16px',
  },
  title: {
    margin: '0 0 8px',
    fontSize: 20,
    fontWeight: 700,
    color: '#1e293b',
  },
  subtitle: {
    margin: '0 0 24px',
    fontSize: 14,
    color: '#64748b',
    lineHeight: 1.5,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
  },
  digitRow: {
    display: 'flex',
    gap: 8,
  },
  digitInput: {
    width: 44,
    height: 52,
    textAlign: 'center' as const,
    fontSize: 22,
    border: '1.5px solid #cbd5e1',
    borderRadius: 8,
    background: '#f8fafc',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  error: {
    color: '#ef4444',
    fontSize: 13,
    margin: 0,
  },
  btn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '10px 28px',
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
    width: '100%',
  },
  note: {
    marginTop: 16,
    fontSize: 11,
    color: '#94a3b8',
  },
};
