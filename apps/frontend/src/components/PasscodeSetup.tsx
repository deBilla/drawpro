/**
 * PasscodeSetup — 3-step flow to enable Client-Controlled Encryption at Rest.
 *
 * Rendered inside a modal overlay (see App.tsx → PasscodeSetupModal).
 *
 * Step 1 — Enter passcode (×2 for confirmation)
 * Step 2 — Display recovery key + require download/acknowledge before continuing
 * Step 3 — Success → updateUser() sets publicKey → parent modal unmounts
 *
 * Nothing sensitive ever leaves the browser.
 */

import { useState, useRef } from 'react';
import {
  Shield, Download, Copy, Check, Loader, AlertTriangle, ChevronRight, Lock,
} from 'lucide-react';
import { generateUserKeys } from '../lib/crypto';
import { keysApi } from '../lib/api';
import { useAuthStore } from '../store/useAuthStore';

type Step = 'passcode' | 'recovery' | 'done';

interface GeneratedKeys {
  publicKey: string;
  encryptedPrivateKey: string;
  recoveryEncryptedPrivateKey: string;
  recoveryKeyDisplay: string;
}

export default function PasscodeSetup() {
  const updateUser = useAuthStore((s) => s.updateUser);

  const [step, setStep] = useState<Step>('passcode');
  const [passcode, setPasscode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keys, setKeys] = useState<GeneratedKeys | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);

  const passcodeRefs = useRef<(HTMLInputElement | null)[]>([]);
  const confirmRefs = useRef<(HTMLInputElement | null)[]>([]);

  // ── Step 1 helpers ──────────────────────────────────────────────────────────

  function handleDigitChange(idx: number, value: string, isConfirm = false) {
    const v = value.replace(/\D/g, '').slice(-1);
    const current = isConfirm ? confirm : passcode;
    const setter = isConfirm ? setConfirm : setPasscode;
    const refs = isConfirm ? confirmRefs : passcodeRefs;

    const chars = current.padEnd(6, '\0').split('');
    chars[idx] = v;
    setter(chars.join('').replace(/\0/g, '').slice(0, 6));

    if (v && idx < 5) refs.current[idx + 1]?.focus();
    else if (v && idx === 5 && !isConfirm) confirmRefs.current[0]?.focus();
  }

  function handleDigitKeyDown(idx: number, e: React.KeyboardEvent, isConfirm = false) {
    if (e.key !== 'Backspace') return;
    const current = isConfirm ? confirm : passcode;
    const refs = isConfirm ? confirmRefs : passcodeRefs;
    if (!current[idx] && idx > 0) refs.current[idx - 1]?.focus();
  }

  async function handleGenerateKeys(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!/^\d{6}$/.test(passcode)) {
      setError('Passcode must be exactly 6 digits.');
      return;
    }
    if (passcode !== confirm) {
      setError('Passcodes do not match.');
      return;
    }

    setBusy(true);
    try {
      const generated = await generateUserKeys(passcode);
      setKeys(generated);
      setStep('recovery');
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Key generation failed.');
    } finally {
      setBusy(false);
    }
  }

  // ── Step 2 helpers ──────────────────────────────────────────────────────────

  function handleDownload() {
    if (!keys) return;
    const lines = [
      'DrawPro Encryption Recovery Key',
      '================================',
      '',
      'Recovery Key:',
      `  ${keys.recoveryKeyDisplay}`,
      '',
      'Instructions:',
      '  • Store this key in a secure location (password manager, printed copy in a safe, etc.).',
      '  • If you forget your 6-digit passcode, this key lets you recover access to your',
      '    encrypted drawings.',
      '  • This key was generated on your device and is NOT stored on DrawPro servers.',
      '  • If you lose BOTH your passcode AND this recovery key, your encrypted drawings',
      '    CANNOT be recovered by anyone, including DrawPro support.',
      '',
      `Generated: ${new Date().toISOString()}`,
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'drawpro-recovery-key.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCopy() {
    if (!keys) return;
    await navigator.clipboard.writeText(keys.recoveryKeyDisplay);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleEnableEncryption() {
    if (!keys || !acknowledged) return;
    setUploading(true);
    setError(null);
    try {
      const updatedUser = await keysApi.setKeys({
        publicKey: keys.publicKey,
        encryptedPrivateKey: keys.encryptedPrivateKey,
        recoveryEncryptedPrivateKey: keys.recoveryEncryptedPrivateKey,
      });
      updateUser(updatedUser); // sets user.publicKey → EncryptionGate unmounts this modal
      setStep('done');
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Failed to save keys to server.');
    } finally {
      setUploading(false);
    }
  }

  // ── Step 3: success ────────────────────────────────────────────────────────

  if (step === 'done') {
    return (
      <div style={st.card}>
        <div style={{ ...st.iconRing, background: 'linear-gradient(135deg,#dcfce7,#bbf7d0)' }}>
          <Shield size={26} color="#16a34a" />
        </div>
        <h2 style={st.title}>Encryption Enabled</h2>
        <p style={{ fontSize: 14, color: '#475569', margin: '0 0 8px', lineHeight: 1.6 }}>
          Your drawings will now be encrypted before they reach the database.
          Only you can unlock them with your passcode.
        </p>
      </div>
    );
  }

  // ── Step 2: recovery key display ───────────────────────────────────────────

  if (step === 'recovery' && keys) {
    return (
      <div style={st.card}>
        <div style={st.iconRing}>
          <Shield size={26} color="#6366f1" />
        </div>
        <div style={st.headerRow}>
          <h2 style={st.title}>Save Your Recovery Key</h2>
          <span style={st.stepBadge}>Step 2 of 2</span>
        </div>

        <div style={st.warningBox}>
          <AlertTriangle size={15} color="#b45309" style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>
            If you forget your passcode, <strong>this recovery key is the only way</strong> to
            unlock your encrypted drawings. DrawPro cannot recover it for you.
          </p>
        </div>

        <p style={st.fieldLabel}>Your recovery key</p>
        <div style={st.recoveryKeyBox}>
          <code style={st.recoveryKeyText}>{keys.recoveryKeyDisplay}</code>
          <button style={st.iconBtn} onClick={handleCopy} title="Copy to clipboard">
            {copied ? <Check size={15} color="#16a34a" /> : <Copy size={15} />}
          </button>
        </div>

        <button style={st.downloadBtn} onClick={handleDownload}>
          <Download size={14} />
          Download drawpro-recovery-key.txt
        </button>

        <label style={st.checkLabel}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            style={{ marginRight: 8, width: 16, height: 16, flexShrink: 0, marginTop: 2 }}
          />
          <span>
            I have saved my recovery key and understand it{' '}
            <strong>cannot be recovered</strong> if lost.
          </span>
        </label>

        {error && <p style={st.error}>{error}</p>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            style={st.secondaryBtn}
            onClick={() => { setStep('passcode'); setError(null); setAcknowledged(false); }}
          >
            Back
          </button>
          <button
            style={{ ...st.primaryBtn, opacity: acknowledged ? 1 : 0.45, flex: 1 }}
            onClick={handleEnableEncryption}
            disabled={!acknowledged || uploading}
          >
            {uploading ? (
              <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
            ) : (
              <><Shield size={14} /> Enable Encryption</>
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 1: passcode entry ─────────────────────────────────────────────────

  return (
    <div style={st.card}>
      <div style={st.iconRing}>
        <Lock size={26} color="#6366f1" />
      </div>
      <div style={st.headerRow}>
        <h2 style={st.title}>Set Your Passcode</h2>
        <span style={st.stepBadge}>Step 1 of 2</span>
      </div>

      <p style={st.desc}>
        Choose a <strong>6-digit passcode</strong> to encrypt your drawings before they reach
        the database. The server never sees this passcode — only you can decrypt your data.
      </p>

      <form onSubmit={handleGenerateKeys} style={st.form}>
        <p style={st.fieldLabel}>Passcode</p>
        <div style={st.digitRow}>
          {Array.from({ length: 6 }).map((_, i) => (
            <input
              key={i}
              ref={(el) => { passcodeRefs.current[i] = el; }}
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={passcode[i] ?? ''}
              onChange={(e) => handleDigitChange(i, e.target.value)}
              onKeyDown={(e) => handleDigitKeyDown(i, e)}
              style={st.digitInput}
            />
          ))}
        </div>

        <p style={st.fieldLabel}>Confirm Passcode</p>
        <div style={st.digitRow}>
          {Array.from({ length: 6 }).map((_, i) => (
            <input
              key={i}
              ref={(el) => { confirmRefs.current[i] = el; }}
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={confirm[i] ?? ''}
              onChange={(e) => handleDigitChange(i, e.target.value, true)}
              onKeyDown={(e) => handleDigitKeyDown(i, e, true)}
              style={st.digitInput}
            />
          ))}
        </div>

        {error && <p style={st.error}>{error}</p>}

        <div style={st.hintBox}>
          ⚠ A recovery key will be generated next. Store it safely — it's your only backup if
          you forget your passcode.
        </div>

        <button type="submit" style={st.primaryBtn} disabled={busy}>
          {busy ? (
            <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Generating keys…</>
          ) : (
            <>Next <ChevronRight size={14} /></>
          )}
        </button>
      </form>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const st: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff',
    borderRadius: 20,
    padding: '32px 28px 28px',
    boxShadow: '0 24px 80px rgba(0,0,0,0.22)',
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
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 800,
    color: '#0f172a',
    letterSpacing: '-0.3px',
  },
  stepBadge: {
    fontSize: 11,
    color: '#6366f1',
    background: '#eef2ff',
    borderRadius: 20,
    padding: '3px 10px',
    fontWeight: 700,
    whiteSpace: 'nowrap' as const,
  },
  desc: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 1.65,
    margin: '0 0 20px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    margin: 0,
  },
  digitRow: {
    display: 'flex',
    gap: 8,
  },
  digitInput: {
    width: 46,
    height: 52,
    textAlign: 'center' as const,
    fontSize: 22,
    fontWeight: 700,
    border: '2px solid #e2e8f0',
    borderRadius: 10,
    background: '#f8fafc',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  error: {
    color: '#ef4444',
    fontSize: 13,
    margin: 0,
    padding: '8px 12px',
    background: '#fef2f2',
    borderRadius: 8,
    border: '1px solid #fecaca',
  },
  hintBox: {
    fontSize: 12,
    color: '#92400e',
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: 8,
    padding: '10px 12px',
    margin: 0,
    lineHeight: 1.5,
  },
  warningBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    fontSize: 13,
    color: '#92400e',
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 12,
  },
  fieldLabel2: {
    fontSize: 12,
    fontWeight: 600,
    color: '#64748b',
    margin: '12px 0 4px',
  },
  recoveryKeyBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: '#f1f5f9',
    border: '1.5px solid #cbd5e1',
    borderRadius: 10,
    padding: '14px 16px',
    marginBottom: 10,
    gap: 10,
  },
  recoveryKeyText: {
    fontFamily: 'monospace',
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: '#0f172a',
    userSelect: 'all' as const,
    wordBreak: 'break-all' as const,
  },
  iconBtn: {
    background: '#fff',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    padding: '6px 8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    color: '#475569',
    flexShrink: 0,
  },
  downloadBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '9px 14px',
    background: '#f8fafc',
    border: '1.5px solid #cbd5e1',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    color: '#334155',
    marginBottom: 14,
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    fontSize: 13,
    color: '#374151',
    lineHeight: 1.55,
    cursor: 'pointer',
    marginBottom: 14,
  },
  primaryBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(99,102,241,0.35)',
  },
  secondaryBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px 16px',
    background: 'none',
    color: '#64748b',
    border: '1.5px solid #e2e8f0',
    borderRadius: 10,
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  },
};
