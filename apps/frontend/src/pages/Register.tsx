import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../lib/api';
import { useAuthStore } from '../store/useAuthStore';

export default function Register() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const tokens = await authApi.register({ email, password, name: name || undefined });
      login(tokens);
      navigate('/');
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Registration failed',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>DrawPro</h1>
        <h2 style={styles.subtitle}>Create account</h2>
        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>
            Name (optional)
            <input
              style={styles.input}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </label>
          <label style={styles.label}>
            Email
            <input
              style={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label style={styles.label}>
            Password (min 8 chars)
            <input
              style={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.button} type="submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p style={styles.footer}>
          Have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f8f9fa' },
  card: { background: '#fff', padding: '2.5rem', borderRadius: 12, boxShadow: '0 2px 16px rgba(0,0,0,0.1)', width: '100%', maxWidth: 380 },
  title: { margin: '0 0 4px', fontSize: 28, fontWeight: 700, color: '#1a1a1a' },
  subtitle: { margin: '0 0 24px', fontSize: 16, fontWeight: 400, color: '#555' },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 500, color: '#333' },
  input: { padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 15, outline: 'none' },
  error: { color: '#d32f2f', margin: 0, fontSize: 14 },
  button: { padding: '10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  footer: { marginTop: 20, textAlign: 'center', fontSize: 14, color: '#666' },
};
