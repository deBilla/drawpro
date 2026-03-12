import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, FileText, LogOut, FolderOpen, Lock } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { authApi } from '../lib/api';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout, cachedPrivateKey } = useAuthStore();
  const {
    workspaces,
    activeWorkspace,
    decryptedNames,
    decryptedSheetNames,
    loading,
    fetchWorkspaces,
    fetchWorkspace,
    createWorkspace,
    deleteWorkspace,
    createSheet,
    deleteSheet,
    decryptWorkspaceNames,
    decryptSheetNames,
  } = useWorkspaceStore();

  const [newWsName, setNewWsName] = useState('');
  const [newSheetName, setNewSheetName] = useState('');
  const [showNewWs, setShowNewWs] = useState(false);
  const [showNewSheet, setShowNewSheet] = useState(false);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  // When private key becomes available, decrypt all workspace + sheet names
  useEffect(() => {
    if (cachedPrivateKey && workspaces.length > 0) {
      decryptWorkspaceNames(cachedPrivateKey);
    }
  }, [cachedPrivateKey, workspaces.length, decryptWorkspaceNames]);

  useEffect(() => {
    if (cachedPrivateKey && activeWorkspace) {
      decryptSheetNames(cachedPrivateKey);
    }
  }, [cachedPrivateKey, activeWorkspace?.id, decryptSheetNames]);

  async function handleLogout() {
    const refreshToken = localStorage.getItem('refreshToken') ?? '';
    await authApi.logout(refreshToken).catch(() => {});
    logout();
    navigate('/login');
  }

  async function handleCreateWorkspace() {
    if (!newWsName.trim()) return;
    const ws = await createWorkspace(newWsName.trim());
    setNewWsName('');
    setShowNewWs(false);
    fetchWorkspace(ws.id);
  }

  async function handleCreateSheet() {
    if (!newSheetName.trim() || !activeWorkspace) return;
    await createSheet(activeWorkspace.id, newSheetName.trim());
    setNewSheetName('');
    setShowNewSheet(false);
  }

  return (
    <div style={styles.root}>
      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <span style={styles.logo}>DrawPro</span>
          <button style={styles.iconBtn} onClick={handleLogout} title="Logout">
            <LogOut size={18} />
          </button>
        </div>
        <div style={styles.sidebarUser}>{user?.name ?? user?.email}</div>

        <div style={styles.sidebarSection}>
          <div style={styles.sectionHeader}>
            <span>Workspaces</span>
            <button style={styles.iconBtn} onClick={() => setShowNewWs(true)} title="New workspace">
              <Plus size={16} />
            </button>
          </div>

          {showNewWs && (
            <div style={styles.inlineForm}>
              <input
                style={styles.inlineInput}
                placeholder="Workspace name"
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateWorkspace()}
                autoFocus
              />
              <button style={styles.smallBtn} onClick={handleCreateWorkspace}>Add</button>
              <button style={{ ...styles.smallBtn, background: '#eee', color: '#333' }} onClick={() => setShowNewWs(false)}>Cancel</button>
            </div>
          )}

          {loading && <p style={styles.hint}>Loading…</p>}
          {workspaces.map((ws) => (
            <div
              key={ws.id}
              style={{
                ...styles.wsItem,
                ...(activeWorkspace?.id === ws.id ? styles.wsItemActive : {}),
              }}
              onClick={() => fetchWorkspace(ws.id)}
            >
              <FolderOpen size={15} style={{ marginRight: 6, flexShrink: 0 }} />
              <span style={styles.wsName}>
                {decryptedNames[ws.id] ?? (ws.encryptedName
                  ? <span style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: 0.6 }}><Lock size={11} />Locked</span>
                  : ws.name)}
              </span>
              <button
                style={styles.iconBtn}
                onClick={(e) => { e.stopPropagation(); deleteWorkspace(ws.id); }}
                title="Delete workspace"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Main */}
      <main style={styles.main}>
        {!activeWorkspace ? (
          <div style={styles.empty}>
            <h2>Select or create a workspace</h2>
          </div>
        ) : (
          <>
            <div style={styles.mainHeader}>
              <h2 style={styles.wsTitle}>
                {decryptedNames[activeWorkspace.id] ?? (activeWorkspace.encryptedName
                  ? <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#94a3b8' }}><Lock size={18} />Encrypted Workspace</span>
                  : activeWorkspace.name)}
              </h2>
              <button style={styles.primaryBtn} onClick={() => setShowNewSheet(true)}>
                <Plus size={16} /> New sheet
              </button>
            </div>

            {showNewSheet && (
              <div style={styles.inlineForm}>
                <input
                  style={styles.inlineInput}
                  placeholder="Sheet name"
                  value={newSheetName}
                  onChange={(e) => setNewSheetName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateSheet()}
                  autoFocus
                />
                <button style={styles.smallBtn} onClick={handleCreateSheet}>Create</button>
                <button style={{ ...styles.smallBtn, background: '#eee', color: '#333' }} onClick={() => setShowNewSheet(false)}>Cancel</button>
              </div>
            )}

            <div style={styles.sheetGrid}>
              {activeWorkspace.sheets.map((sheet) => (
                <div key={sheet.id} style={styles.sheetCard}>
                  <div
                    style={styles.sheetPreview}
                    onClick={() => navigate(`/workspace/${activeWorkspace.id}/sheet/${sheet.id}`)}
                    title={sheet.isEncrypted ? (decryptedSheetNames[sheet.id] ?? 'Encrypted sheet') : sheet.name}
                  >
                    {sheet.isEncrypted
                      ? <Lock size={36} color="#a5b4fc" />
                      : <FileText size={40} color="#94a3b8" />}
                  </div>
                  <div style={styles.sheetFooter}>
                    <span style={styles.sheetName}>
                      {sheet.isEncrypted
                        ? decryptedSheetNames[sheet.id]
                          ?? <span style={{ color: '#6366f1', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Lock size={11} />
                              {new Date(sheet.updatedAt).toLocaleDateString()}
                            </span>
                        : sheet.name}
                    </span>
                    <button
                      style={styles.iconBtn}
                      onClick={() => deleteSheet(activeWorkspace.id, sheet.id)}
                      title="Delete sheet"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {activeWorkspace.sheets.length === 0 && (
              <p style={styles.hint}>No sheets yet. Create one above.</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', height: '100vh', overflow: 'hidden' },
  sidebar: { width: 240, background: '#1e293b', color: '#e2e8f0', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' },
  sidebarHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 16px 8px' },
  logo: { fontWeight: 700, fontSize: 18, color: '#f8fafc' },
  sidebarUser: { padding: '0 16px 16px', fontSize: 13, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  sidebarSection: { padding: '8px 12px', flex: 1 },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 8px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#94a3b8' },
  wsItem: { display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 14, color: '#cbd5e1', marginBottom: 2 },
  wsItemActive: { background: '#334155', color: '#f8fafc' },
  wsName: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  main: { flex: 1, overflowY: 'auto', padding: 32 },
  mainHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  wsTitle: { margin: 0, fontSize: 24, fontWeight: 700 },
  primaryBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  sheetGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 },
  sheetCard: { background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' },
  sheetPreview: { height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', cursor: 'pointer' },
  sheetFooter: { display: 'flex', alignItems: 'center', padding: '8px 10px', gap: 6 },
  sheetName: { flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', color: 'inherit', opacity: 0.7 },
  empty: { display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' },
  hint: { color: '#94a3b8', fontSize: 14 },
  inlineForm: { display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' },
  inlineInput: { flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14 },
  smallBtn: { padding: '6px 12px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' },
};
