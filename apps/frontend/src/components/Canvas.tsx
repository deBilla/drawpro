import { useRef, forwardRef, useImperativeHandle } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

export interface CanvasHandle {
  getSaveData: () => { elements: unknown[]; appState: Record<string, unknown> };
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
  }));

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <Excalidraw
        excalidrawAPI={(api) => { apiRef.current = api; }}
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
