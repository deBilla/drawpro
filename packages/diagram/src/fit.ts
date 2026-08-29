import type { ExcalidrawElement } from './types';

const SHAPES = new Set(['rectangle', 'ellipse', 'diamond']);

/** Breathing room kept between text and the bottom edge of its box. */
const PADDING = 16;

export interface Resize {
  shapeId: string;
  shapeType: string;
  from: number;
  to: number;
}

/**
 * Grow any box whose text no longer fits inside it.
 *
 * Excalidraw regrows a container around text that is *bound* to it, but
 * hand-drawn diagrams usually have text merely positioned on top of a shape
 * with no binding — so nothing regrows and longer text spills out the bottom.
 *
 * Boxes are only ever grown, never shrunk, and nothing else moves. Reflowing
 * neighbours to make room would be the wholesale rewrite that editing a
 * hand-drawn sheet is supposed to avoid; a slightly taller box that the author
 * can nudge is a much smaller imposition than a re-laid-out diagram.
 */
export function growBoxesToFitText(
  elements: ExcalidrawElement[],
  changedTextIds: Set<string>,
): Resize[] {
  const shapes = elements.filter((el) => SHAPES.has(el.type));
  const resizes: Resize[] = [];

  for (const text of elements) {
    if (text.type !== 'text' || !changedTextIds.has(text.id)) continue;
    // Bound text is Excalidraw's own problem, and it solves it on load.
    if (text.containerId) continue;

    const cx = text.x + text.width / 2;
    const cy = text.y + text.height / 2;

    // Smallest containing shape, so text inside a nested region grows the inner
    // box rather than the whole region.
    const box = shapes
      .filter((sh) => cx >= sh.x && cx <= sh.x + sh.width && cy >= sh.y && cy <= sh.y + sh.height)
      .sort((a, b) => a.width * a.height - b.width * b.height)[0];
    if (!box) continue;

    const needed = Math.ceil(text.y - box.y + text.height + PADDING);
    if (needed > box.height) {
      resizes.push({ shapeId: box.id, shapeType: box.type, from: box.height, to: needed });
      box.height = needed;
      box.version = ((box.version as number) ?? 1) + 1;
      box.versionNonce = Math.floor(Math.random() * 2 ** 31);
      box.updated = Date.now();
    }
  }

  return resizes;
}
