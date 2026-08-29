/**
 * The authoring format. This is what a human — or Claude — writes.
 *
 * The whole point of this package is that nobody hand-writes Excalidraw
 * coordinates. You describe *what connects to what*; layout, sizing, text
 * wrapping, and arrow binding are derived.
 */

export type ShapeKind = 'rectangle' | 'ellipse' | 'diamond';

/** Named accents from the theme, so a spec never hard-codes a hex value. */
export type Accent = 'blue' | 'green' | 'yellow' | 'red' | 'violet' | 'grey' | 'none';

export type Direction = 'TB' | 'BT' | 'LR' | 'RL';

export interface DiagramNode {
  id: string;
  label: string;
  /** Defaults to 'rectangle'. */
  shape?: ShapeKind;
  /** Defaults to 'none' (transparent fill). */
  accent?: Accent;
  /** Secondary line rendered smaller under the label. */
  sublabel?: string;
}

export type EdgeStyle = 'solid' | 'dashed' | 'dotted';

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  /** Defaults to 'solid'. */
  style?: EdgeStyle;
  /** Defaults to true. Set false for a plain connector line. */
  arrowhead?: boolean;
}

export interface DiagramSpec {
  title?: string;
  /** Layout flow. Defaults to 'TB' (top to bottom). */
  direction?: Direction;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** Overrides for spacing, in px. */
  spacing?: {
    /** Between nodes in the same rank. Default 60. */
    node?: number;
    /** Between ranks. Default 90. */
    rank?: number;
  };
}

// ─── Output ──────────────────────────────────────────────────────────────────

/**
 * A minimal structural type for an Excalidraw element. Deliberately loose:
 * Excalidraw's own types come from a browser-only package, and this generator
 * has to run in plain Node.
 */
export interface ExcalidrawElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  [key: string]: unknown;
}

/** The .excalidraw file shape, and what the API stores as `elements`. */
export interface ExcalidrawScene {
  type: 'excalidraw';
  version: 2;
  source: string;
  elements: ExcalidrawElement[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}
