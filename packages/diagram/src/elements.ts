import { elementId, elementMeta } from './ids';
import { measureText } from './text';
import { polylineMidpoint, roundPoint, type Point } from './geometry';
import type { Accent, EdgeStyle, ExcalidrawElement, ShapeKind } from './types';
import {
  BASE_STYLE,
  EDGE_LABEL_FONT_SIZE,
  FONT_FAMILY,
  FONT_SIZE,
  LINE_HEIGHT,
  MAX_LABEL_WIDTH,
  STROKE,
  fillFor,
} from './theme';

/** Excalidraw's ROUNDNESS enum: 2 = proportional radius, 3 = adaptive radius. */
const ROUNDNESS: Record<ShapeKind, { type: number } | null> = {
  rectangle: { type: 3 },
  diamond: { type: 2 },
  ellipse: null,
};

const STROKE_STYLE: Record<EdgeStyle, string> = {
  solid: 'solid',
  dashed: 'dashed',
  dotted: 'dotted',
};

/**
 * A shape plus its label, wired together as a container/bound-text pair.
 *
 * This pairing is the difference between a label that is merely *sitting on
 * top of* a box and one that belongs to it: bound text re-centres, re-wraps,
 * and moves with the container, and is edited by double-clicking the shape.
 */
export function createLabeledShape(opts: {
  kind: ShapeKind;
  accent?: Accent;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}): { shape: ExcalidrawElement; text: ExcalidrawElement } {
  const shapeId = elementId();
  const textId = elementId();

  const metrics = measureText(opts.label, FONT_SIZE, Math.max(opts.width - 16, 40));

  const shape: ExcalidrawElement = {
    id: shapeId,
    type: opts.kind,
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    ...BASE_STYLE,
    backgroundColor: fillFor(opts.accent),
    roundness: ROUNDNESS[opts.kind],
    boundElements: [{ type: 'text', id: textId }],
    ...elementMeta(),
  };

  const text: ExcalidrawElement = {
    id: textId,
    type: 'text',
    // Centred within the container; Excalidraw recomputes this on first render.
    x: Math.round(opts.x + (opts.width - metrics.width) / 2),
    y: Math.round(opts.y + (opts.height - metrics.height) / 2),
    width: metrics.width,
    height: metrics.height,
    ...BASE_STYLE,
    backgroundColor: 'transparent',
    roundness: null,
    boundElements: null,
    text: metrics.lines.join('\n'),
    originalText: opts.label,
    fontSize: FONT_SIZE,
    fontFamily: FONT_FAMILY,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: shapeId,
    lineHeight: LINE_HEIGHT,
    autoResize: true,
    ...elementMeta(),
  };

  return { shape, text };
}

/**
 * An arrow bound to the shapes at both ends.
 *
 * startBinding/endBinding are what make the arrow follow its shapes when they
 * are dragged. They only work if the *shapes* also list this arrow in their
 * boundElements — see attachArrow() — so the relationship is recorded on both
 * sides. Hand-written Excalidraw JSON almost always misses this half, which is
 * why its arrows detach the moment anything moves.
 */
export function createArrow(opts: {
  points: Point[];
  startElementId: string;
  endElementId: string;
  style?: EdgeStyle;
  arrowhead?: boolean;
  gap?: number;
}): ExcalidrawElement {
  const pts = opts.points.map(roundPoint);
  const [origin, ...rest] = pts;
  const relative = [[0, 0], ...rest.map((p) => [p.x - origin.x, p.y - origin.y])];

  const xs = relative.map((p) => p[0]);
  const ys = relative.map((p) => p[1]);

  return {
    id: elementId(),
    type: 'arrow',
    x: origin.x,
    y: origin.y,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    ...BASE_STYLE,
    backgroundColor: 'transparent',
    strokeStyle: STROKE_STYLE[opts.style ?? 'solid'],
    roundness: { type: 2 },
    points: relative,
    lastCommittedPoint: null,
    startBinding: { elementId: opts.startElementId, focus: 0, gap: opts.gap ?? 4 },
    endBinding: { elementId: opts.endElementId, focus: 0, gap: opts.gap ?? 4 },
    startArrowhead: null,
    endArrowhead: opts.arrowhead === false ? null : 'arrow',
    elbowed: false,
    boundElements: null,
    ...elementMeta(),
  };
}

/** Record the arrow on the shape's side of the binding. */
export function attachArrow(shape: ExcalidrawElement, arrowId: string): void {
  const bound = (shape.boundElements as Array<{ type: string; id: string }> | null) ?? [];
  bound.push({ type: 'arrow', id: arrowId });
  shape.boundElements = bound;
}

/** A label bound to an arrow, so it rides along when the arrow is edited. */
export function createArrowLabel(arrow: ExcalidrawElement, label: string): ExcalidrawElement {
  const metrics = measureText(label, EDGE_LABEL_FONT_SIZE, MAX_LABEL_WIDTH);
  const textId = elementId();

  const bound = (arrow.boundElements as Array<{ type: string; id: string }> | null) ?? [];
  bound.push({ type: 'text', id: textId });
  arrow.boundElements = bound;

  // Reconstruct the arrow's absolute path — `points` are relative to x/y.
  const relative = arrow.points as number[][];
  const absolute = relative.map(([dx, dy]) => ({
    x: (arrow.x as number) + dx,
    y: (arrow.y as number) + dy,
  }));
  const mid = polylineMidpoint(absolute);
  const labelX = Math.round(mid.x - metrics.width / 2);
  const labelY = Math.round(mid.y - metrics.height / 2);

  return {
    id: textId,
    type: 'text',
    x: labelX,
    y: labelY,
    width: metrics.width,
    height: metrics.height,
    ...BASE_STYLE,
    strokeColor: STROKE,
    backgroundColor: 'transparent',
    roundness: null,
    boundElements: null,
    text: metrics.lines.join('\n'),
    originalText: label,
    fontSize: EDGE_LABEL_FONT_SIZE,
    fontFamily: FONT_FAMILY,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: arrow.id,
    lineHeight: LINE_HEIGHT,
    autoResize: true,
    ...elementMeta(),
  };
}
