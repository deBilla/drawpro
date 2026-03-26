import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Sparkles } from 'lucide-react';
import { useSheetStore } from '../store/useSheetStore';
import Canvas, { type CanvasHandle } from '../components/Canvas';
import PasscodeModal from '../components/PasscodeModal';
import FeedbackPanel from '../components/FeedbackPanel';

export default function Editor() {
  const { workspaceId, sheetId } = useParams<{
    workspaceId: string;
    sheetId: string;
  }>();
  const navigate = useNavigate();
  const canvasRef = useRef<CanvasHandle>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const {
    currentSheet,
    encryptedSheet,
    saving,
    lastSaved,
    loadSheet,
    saveSheet,
    decryptAndLoad,
    clear,
  } = useSheetStore();

  useEffect(() => {
    if (workspaceId && sheetId) loadSheet(workspaceId, sheetId);
    return () => clear();
  }, [workspaceId, sheetId, loadSheet, clear]);

  if (!workspaceId || !sheetId) return null;

  async function handleSave() {
    if (!canvasRef.current || !currentSheet) return;
    const { elements, appState } = canvasRef.current.getSaveData();
    await saveSheet(workspaceId!, sheetId!, currentSheet.name, elements, appState);
  }

  const getElements = useCallback(
    () => canvasRef.current?.getSaveData().elements ?? [],
    [],
  );

  const getScreenshot = useCallback(
    () => canvasRef.current?.exportScreenshot() ?? Promise.resolve(null),
    [],
  );

  const hasSelection = useCallback(
    () => canvasRef.current?.hasSelection() ?? false,
    [],
  );

  const sheetName = currentSheet?.name ?? encryptedSheet?.name ?? 'Loading…';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={styles.header}>
        <button style={styles.backBtn} onClick={() => navigate('/')}>
          <ArrowLeft size={16} /> Dashboard
        </button>

        <span style={styles.sheetName}>{sheetName}</span>

        <div style={styles.actions}>
          <span style={styles.saveStatus}>
            {saving ? 'Saving…' : lastSaved ? `Saved ${lastSaved.toLocaleTimeString()}` : ''}
          </span>
          <button style={styles.saveBtn} onClick={handleSave} disabled={saving || !!encryptedSheet}>
            <Save size={14} /> Save
          </button>
          <button
            style={{
              ...styles.saveBtn,
              background: feedbackOpen ? '#6d28d9' : '#7c3aed',
            }}
            onClick={() => setFeedbackOpen((o) => !o)}
            disabled={!!encryptedSheet}
          >
            <Sparkles size={14} /> AI Feedback
          </button>
        </div>
      </header>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', position: 'relative' }}>
        {currentSheet ? (
          <Canvas
            ref={canvasRef}
            initialElements={(currentSheet.elements as unknown[]) ?? []}
            initialAppState={(currentSheet.appState as Record<string, unknown>) ?? {}}
          />
        ) : !encryptedSheet ? (
          <div style={styles.loading}>Loading sheet…</div>
        ) : null}

        <FeedbackPanel
          open={feedbackOpen}
          onClose={() => setFeedbackOpen(false)}
          getElements={getElements}
          getScreenshot={getScreenshot}
          hasSelection={hasSelection}
        />
      </div>

      {/* Passcode modal — rendered on top of everything when decryption is pending */}
      {encryptedSheet && (
        <PasscodeModal
          sheetName={encryptedSheet.name}
          onUnlock={decryptAndLoad}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 16px',
    height: 48,
    background: '#1e293b',
    color: '#e2e8f0',
    flexShrink: 0,
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: 13,
    padding: '4px 8px',
    borderRadius: 6,
    whiteSpace: 'nowrap',
  },
  sheetName: {
    flex: 1,
    fontWeight: 600,
    fontSize: 15,
    textAlign: 'center',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  saveStatus: {
    fontSize: 12,
    color: '#64748b',
    whiteSpace: 'nowrap',
  },
  saveBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 14px',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: 7,
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 13,
  },
  loading: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#94a3b8',
  },
};
