import { useRef, forwardRef, useImperativeHandle } from 'react';
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

export interface CanvasHandle {
  getSaveData: () => { elements: unknown[]; appState: Record<string, unknown> };
  /** Export canvas as a base64 PNG — selected elements only, or all if nothing selected */
  exportScreenshot: () => Promise<string | null>;
  /** Returns true if the user has selected specific elements */
  hasSelection: () => boolean;
}

interface CanvasProps {
  initialElements?: unknown[];
  initialAppState?: Record<string, unknown>;
  readOnly?: boolean;
}

const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(
  { initialElements = [], initialAppState = {}, readOnly = false },
  ref,
) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);

  useImperativeHandle(ref, () => ({
    getSaveData: () => ({
      elements: (apiRef.current?.getSceneElements() ?? []) as unknown[],
      appState: (apiRef.current?.getAppState() ?? {}) as Record<string, unknown>,
    }),
    hasSelection: () => {
      const api = apiRef.current;
      if (!api) return false;
      const appState = api.getAppState() as { selectedElementIds?: Record<string, boolean> };
      const selectedIds = appState.selectedElementIds ?? {};
      return Object.values(selectedIds).some(Boolean);
    },
    exportScreenshot: async () => {
      const api = apiRef.current;
      if (!api) return null;
      try {
        const allElements = api.getSceneElements();
        const appState = api.getAppState() as { selectedElementIds?: Record<string, boolean> };
        const selectedIds = appState.selectedElementIds ?? {};
        const hasSelected = Object.values(selectedIds).some(Boolean);

        // Export only selected elements, or all if nothing selected
        const elements = hasSelected
          ? allElements.filter((el) => selectedIds[(el as { id: string }).id])
          : allElements;

        const blob = await exportToBlob({
          elements,
          appState: { ...api.getAppState(), exportWithDarkMode: false },
          files: api.getFiles(),
        });
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    },
  }));

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <Excalidraw
        excalidrawAPI={(api: ExcalidrawImperativeAPI) => { apiRef.current = api; }}
        initialData={{
          elements: initialElements as never,
          appState: {
            ...initialAppState,
            viewBackgroundColor: '#ffffff',
            collaborators: new Map(),
          } as never,
        }}
        viewModeEnabled={readOnly}
        UIOptions={{ canvasActions: { saveToActiveFile: false, loadScene: false } }}
      />
    </div>
  );
});

export default Canvas;
