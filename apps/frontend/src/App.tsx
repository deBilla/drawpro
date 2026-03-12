import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Editor from './pages/Editor';
import PasscodeSetup from './components/PasscodeSetup';
import GlobalUnlockModal from './components/GlobalUnlockModal';

function RequireAuth({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function RequireGuest({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <Navigate to="/" replace /> : <>{children}</>;
}

/**
 * Wraps all authenticated pages.
 *
 * - No publicKey yet   → show PasscodeSetup as a fullscreen modal overlay.
 * - Has publicKey, no cachedPrivateKey (and not currently restoring from session)
 *                      → show GlobalUnlockModal so the user enters their passcode once.
 * - keyRestoring       → wait silently (prevents false flash of unlock modal on refresh).
 * - All unlocked       → render children normally.
 */
function EncryptionGate({ children }: { children: ReactNode }) {
  const { user, cachedPrivateKey, keyRestoring } = useAuthStore();

  const needsSetup = !user?.publicKey;
  const needsUnlock = !!user?.publicKey && !cachedPrivateKey && !keyRestoring;

  return (
    <>
      {children}
      {needsSetup && <PasscodeSetupModal />}
      {needsUnlock && <GlobalUnlockModal />}
    </>
  );
}

/** PasscodeSetup wrapped in a full-screen modal overlay. */
function PasscodeSetupModal() {
  return (
    <div style={overlayStyle}>
      <div style={modalWrapStyle}>
        <PasscodeSetup />
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
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
  overflowY: 'auto',
  padding: '24px 16px',
};

const modalWrapStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 480,
  animation: 'slideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)',
};

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <RequireGuest>
              <Login />
            </RequireGuest>
          }
        />
        <Route
          path="/register"
          element={
            <RequireGuest>
              <Register />
            </RequireGuest>
          }
        />
        <Route
          path="/"
          element={
            <RequireAuth>
              <EncryptionGate>
                <Dashboard />
              </EncryptionGate>
            </RequireAuth>
          }
        />
        <Route
          path="/workspace/:workspaceId/sheet/:sheetId"
          element={
            <RequireAuth>
              <EncryptionGate>
                <Editor />
              </EncryptionGate>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
