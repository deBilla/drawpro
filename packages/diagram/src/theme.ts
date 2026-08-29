import type { Accent } from './types';

/**
 * Excalidraw's own default palette. Sticking to these keeps generated diagrams
 * looking native to the editor rather than like something pasted in.
 */
export const STROKE = '#1e1e1e';

const ACCENT_FILL: Record<Accent, string> = {
  blue: '#a5d8ff',
  green: '#b2f2bb',
  yellow: '#ffec99',
  red: '#ffc9c9',
  violet: '#d0bfff',
  grey: '#e9ecef',
  none: 'transparent',
};

export function fillFor(accent: Accent | undefined): string {
  return ACCENT_FILL[accent ?? 'none'];
}

export const FONT_SIZE = 20;
export const SUBLABEL_FONT_SIZE = 16;
export const EDGE_LABEL_FONT_SIZE = 16;

/** Excalifont — Excalidraw's default hand-drawn face. */
export const FONT_FAMILY = 5;
export const LINE_HEIGHT = 1.25;

/** Padding between a label and its container's edge. */
export const CONTAINER_PADDING = 16;

/** Labels wrap rather than stretching a box past this. */
export const MAX_LABEL_WIDTH = 220;

export const MIN_NODE_WIDTH = 120;
export const MIN_NODE_HEIGHT = 60;

/** Sizes snap to this grid so edges and columns line up. */
export const GRID = 20;

/** Shared style block applied to every generated element. */
export const BASE_STYLE = {
  angle: 0,
  strokeColor: STROKE,
  fillStyle: 'solid' as const,
  strokeWidth: 2,
  strokeStyle: 'solid' as const,
  roughness: 1,
  opacity: 100,
  groupIds: [] as string[],
  frameId: null,
  locked: false,
  link: null,
};

export function snap(n: number): number {
  return Math.ceil(n / GRID) * GRID;
}
