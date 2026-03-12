/**
 * GlobalUnlockModal — shown app-wide when the user has encryption set up
 * but hasn't unlocked their private key this session (e.g. after a page refresh).
 *
 * Decrypts the private key with the user's passcode and caches it in the auth store,
 * which unblocks all encrypted content across the app.
 */

import { useState, useRef, useEffect } from 'react';
import { Lock, Loader, KeyRound } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { decryptPrivateKey } from '../lib/crypto';

export default function GlobalUnlockModal() {
  const { user, setCachedPrivateKey } = useAuthStore();
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    // Small delay so the modal animation settles before grabbing focus
    const t = setTimeout(() => inputRefs.current[0]?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  function handleChange(idx: number, value: string) {
    const v = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[idx] = v;
    setDigits(next);
    if (v && idx < 5) inputRefs.current[idx + 1]?.focus();
    // Auto-submit when all 6 digits are entered
    if (v && idx === 5) {
      const full = [...next].join('');
      if (full.length === 6) submitPasscode(full);
    }
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    }
  }

  async function submitPasscode(passcode: string) {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const privateKey = await decryptPrivateKey(user!.encryptedPrivateKey!, passcode, user!.salt!);
      setCachedPrivateKey(privateKey);
    } catch {
      setError('Wrong passcode — please try again.');
      setDigits(Array(6).fill(''));
      setBusy(false);
      setTimeout(() => inputRefs.current[0]?.focus(), 0);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const passcode = digits.join('');
    if (passcode.length !== 6) {
      setError('Please enter all 6 digits.');
      return;
    }
    await submitPasscode(passcode);
  }

  return (
    <div style={st.overlay}>
      <div style={st.card}>
        {/* Icon */}
        <div style={st.iconRing}>
          <Lock size={26} color="#6366f1" />
        </div>

        {/* Header */}
        <h2 style={st.title}>Unlock DrawPro</h2>
        <p style={st.subtitle}>
          Your data is encrypted. Enter your <strong>6-digit passcode</strong> to continue.
        </p>
        <p style={st.email}>{user?.email}</p>

        {/* Digit inputs */}
        <form onSubmit={handleSubmit} style={st.form}>
          <div style={st.digitRow}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="password"
                inputMode="numeric"
                maxLength={1}
                value={d}
                disabled={busy}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                style={{
                  ...st.digitInput,
                  borderColor: error ? '#ef4444' : d ? '#6366f1' : '#cbd5e1',
                  background: busy ? '#f1f5f9' : '#fff',
                }}
              />
            ))}
          </div>

          {error && (
            <div style={st.errorBox}>
              <span>{error}</span>
            </div>
          )}

          <button type="submit" style={st.btn} disabled={busy || digits.join('').length !== 6}>
            {busy ? (
              <>
                <Loader size={15} style={{ animation: 'spin 1s linear infinite' }} />
                Unlocking…
              </>
            ) : (
              <>
                <KeyRound size={15} />
                Unlock
              </>
            )}
          </button>
        </form>

        <p style={st.hint}>Your passcode never leaves this device.</p>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
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
    animation: 'fadeIn 0.18s ease',
  },
  card: {
    background: '#fff',
    borderRadius: 20,
    padding: '36px 32px 28px',
    width: 360,
    textAlign: 'center' as const,
    boxShadow: '0 24px 80px rgba(0,0,0,0.25)',
    animation: 'slideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)',
  },
  iconRing: {
    width: 60,
    height: 60,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 20px',
    boxShadow: '0 0 0 8px #f0f4ff',
  },
  title: {
    margin: '0 0 8px',
    fontSize: 22,
    fontWeight: 800,
    color: '#0f172a',
    letterSpacing: '-0.3px',
  },
  subtitle: {
    margin: '0 0 6px',
    fontSize: 14,
    color: '#475569',
    lineHeight: 1.55,
  },
  email: {
    margin: '0 0 24px',
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: 500,
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 16,
  },
  digitRow: {
    display: 'flex',
    gap: 10,
  },
  digitInput: {
    width: 46,
    height: 56,
    textAlign: 'center' as const,
    fontSize: 24,
    fontWeight: 700,
    border: '2px solid #cbd5e1',
    borderRadius: 10,
    outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  errorBox: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 8,
    padding: '8px 14px',
    fontSize: 13,
    color: '#ef4444',
    width: '100%',
    boxSizing: 'border-box' as const,
    textAlign: 'center' as const,
  },
  btn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '12px 24px',
    background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontWeight: 700,
    fontSize: 15,
    cursor: 'pointer',
    width: '100%',
    boxShadow: '0 4px 14px rgba(99,102,241,0.35)',
    transition: 'opacity 0.15s',
  },
  hint: {
    marginTop: 18,
    fontSize: 11,
    color: '#94a3b8',
    letterSpacing: '0.02em',
  },
};
