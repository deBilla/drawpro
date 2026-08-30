import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../lib/api';
import { GoogleSignInCancelled, isGoogleAuthConfigured, signInWithGoogle } from '../lib/firebase';
import { useAuthStore } from '../store/useAuthStore';

interface Props {
  /** Surfaces the failure in the host page's existing error slot. */
  onError: (message: string) => void;
  /** Lets the page disable its own form while the popup is open. */
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}

/**
 * Google sign-in. Renders nothing when the build has no Firebase config, so
 * self-hosted deployments without a Firebase project see the plain email form.
 *
 * Sign-in and sign-up are the same action: the API creates the account on
 * first use, so there is no separate "Sign up with Google" path.
 */
export default function GoogleSignInButton({ onError, onBusyChange, disabled }: Props) {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [loading, setLoading] = useState(false);

  if (!isGoogleAuthConfigured) return null;

  async function handleClick() {
    onError('');
    setLoading(true);
    onBusyChange?.(true);
    try {
      const idToken = await signInWithGoogle();
      const { user } = await authApi.google({ idToken });
      login(user);
      navigate('/');
    } catch (err: unknown) {
      if (err instanceof GoogleSignInCancelled) return; // user closed the popup
      onError(
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ??
          'Google sign-in failed',
      );
    } finally {
      setLoading(false);
      onBusyChange?.(false);
    }
  }

  const isDisabled = disabled || loading;

  return (
    <>
      <div style={styles.divider}>
        <span style={styles.dividerLine} />
        <span style={styles.dividerText}>or</span>
        <span style={styles.dividerLine} />
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isDisabled}
        style={{ ...styles.button, ...(isDisabled ? styles.buttonDisabled : null) }}
      >
        <GoogleMark />
        {loading ? 'Connecting…' : 'Continue with Google'}
      </button>
    </>
  );
}

/** Google's four-colour 'G', inlined so the button works offline. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  divider: { display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 16px' },
  dividerLine: { flex: 1, height: 1, background: '#e5e7eb' },
  dividerText: { fontSize: 13, color: '#9ca3af' },
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    padding: '10px',
    background: '#fff',
    color: '#3c4043',
    border: '1px solid #dadce0',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 500,
    cursor: 'pointer',
  },
  buttonDisabled: { opacity: 0.6, cursor: 'not-allowed' },
};
