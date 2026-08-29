import type { ShapeKind } from './types';

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function centerOf(b: Box): Point {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * Where a ray leaving the centre of `box` toward `target` crosses the shape's
 * outline. Used to start/end arrows on the border instead of the centre, so
 * arrowheads sit against the shape rather than buried inside it.
 */
export function boundaryPoint(box: Box, kind: ShapeKind, target: Point): Point {
  const c = centerOf(box);
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  if (dx === 0 && dy === 0) return c;

  const hw = box.width / 2;
  const hh = box.height / 2;

  if (kind === 'ellipse') {
    // Scale the direction vector until it lands on the ellipse.
    const denom = Math.hypot((dx / hw), (dy / hh));
    return { x: c.x + dx / denom, y: c.y + dy / denom };
  }

  if (kind === 'diamond') {
    // |x|/hw + |y|/hh = 1
    const t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    return { x: c.x + dx * t, y: c.y + dy * t };
  }

  // Rectangle: clip against whichever pair of edges the ray hits first.
  const t = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** Pull a point back along the direction it came from, leaving a visual gap. */
export function retract(from: Point, toward: Point, gap: number): Point {
  const dx = from.x - toward.x;
  const dy = from.y - toward.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return from;
  return { x: from.x + (dx / len) * gap, y: from.y + (dy / len) * gap };
}

export function boxesOverlap(a: Box, b: Box, tolerance = 0): boolean {
  return (
    a.x < b.x + b.width - tolerance &&
    a.x + a.width - tolerance > b.x &&
    a.y < b.y + b.height - tolerance &&
    a.y + a.height - tolerance > b.y
  );
}

/** Excalidraw tolerates fractional coordinates, but they serialise noisily and
 *  render on half-pixels. Everything this package emits snaps to whole pixels. */
export function roundPoint(p: Point): Point {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}
