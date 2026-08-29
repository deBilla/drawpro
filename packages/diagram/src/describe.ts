import type { ExcalidrawElement } from './types';

/**
 * Turn an Excalidraw scene back into a readable outline.
 *
 * This is the inverse of the generator, and it is what `read_sheet` should hand
 * a model: raw scene JSON is thousands of tokens of coordinates and style, while
 * what matters is which boxes exist and what points at what. Bindings make that
 * recoverable — an arrow names its endpoints, and bound text names its container.
 */

const SHAPES = new Set(['rectangle', 'ellipse', 'diamond']);

/** How far from an arrow a floating text may sit and still read as its label. */
const ARROW_LABEL_RADIUS = 60;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function centre(b: Box) {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

function contains(box: Box, p: { x: number; y: number }): boolean {
  return p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;
}

/** Distance from a point to a polyline, for matching loose labels to arrows. */
function distanceToPath(p: { x: number; y: number }, pts: { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t =
      dx === 0 && dy === 0
        ? 0
        : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

export interface SceneOutline {
  shapes: { id: string; type: string; label: string }[];
  edges: { from: string; to: string; label: string }[];
  /** Text not bound to any shape or arrow — titles, stray notes. */
  looseText: string[];
  counts: Record<string, number>;
}

export function describeScene(elements: ExcalidrawElement[]): SceneOutline {
  const byId = new Map(elements.map((el) => [el.id, el]));
  const textOf = (el: ExcalidrawElement | undefined): string =>
    ((el?.originalText ?? el?.text) as string | undefined)?.replace(/\n/g, ' ').trim() ?? '';

  // Text a generator bound to its container.
  const boundLabel = (id: string): string => {
    const owner = byId.get(id);
    const bound = (owner?.boundElements as { type: string; id: string }[] | null) ?? [];
    const ref = bound.find((b) => b.type === 'text');
    return ref ? textOf(byId.get(ref.id)) : '';
  };

  // Text belonging to no container. Hand-drawn diagrams are full of it: people
  // place a label over a shape rather than typing into the shape, so the text
  // is visually a label but structurally unrelated. Bindings alone therefore
  // recover nothing from a human's diagram, which is most of them.
  const ownedText = new Set(
    elements.flatMap((el) =>
      (((el.boundElements as { type: string; id: string }[] | null) ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.id)),
    ),
  );
  const floating = elements.filter((el) => el.type === 'text' && !ownedText.has(el.id));
  const adopted = new Set<string>();

  /** Fall back to the nearest sensible floating text, the way a reader would. */
  const labelFor = (id: string): string => {
    const bound = boundLabel(id);
    if (bound) return bound;

    const owner = byId.get(id);
    if (!owner) return '';

    if (SHAPES.has(owner.type)) {
      // A label sitting inside the shape's outline.
      const hit = floating.find((t) => !adopted.has(t.id) && contains(owner as Box, centre(t as Box)));
      if (hit) {
        adopted.add(hit.id);
        return textOf(hit);
      }
      return '';
    }

    if (owner.type === 'arrow') {
      const pts = ((owner.points as number[][]) ?? []).map(([dx, dy]) => ({
        x: (owner.x as number) + dx,
        y: (owner.y as number) + dy,
      }));
      if (pts.length < 2) return '';
      // A hand-placed label sits beside the line rather than on it, so the
      // radius has to be generous. Shapes claim their labels first and the
      // nearest candidate wins, which keeps this from stealing another
      // element's text.
      let best: { id: string; text: string; d: number } | null = null;
      for (const t of floating) {
        if (adopted.has(t.id)) continue;
        const d = distanceToPath(centre(t as Box), pts);
        if (d <= ARROW_LABEL_RADIUS && (!best || d < best.d)) {
          best = { id: t.id, text: textOf(t), d };
        }
      }
      if (best) {
        adopted.add(best.id);
        return best.text;
      }
    }
    return '';
  };

  const counts: Record<string, number> = {};
  for (const el of elements) counts[el.type] = (counts[el.type] ?? 0) + 1;

  // Shapes claim their labels first, so an arrow cannot steal a shape's text.
  const shapes = elements
    .filter((el) => SHAPES.has(el.type))
    .map((el) => ({ id: el.id, type: el.type, label: labelFor(el.id) }));
  const shapeLabel = new Map(shapes.map((s) => [s.id, s.label]));

  const edges = elements
    .filter((el) => el.type === 'arrow')
    .map((el) => {
      const start = el.startBinding as { elementId: string } | null;
      const end = el.endBinding as { elementId: string } | null;
      const name = (id: string | undefined) =>
        id ? shapeLabel.get(id) || labelFor(id) || `<${id.slice(0, 6)}>` : '(unbound)';
      return {
        from: name(start?.elementId),
        to: name(end?.elementId),
        label: labelFor(el.id),
      };
    });

  // Whatever is still floating after label adoption is genuinely loose —
  // titles, annotations, notes.
  const looseText = floating.filter((el) => !adopted.has(el.id)).map((el) => textOf(el));

  return { shapes, edges, looseText, counts };
}

/** Human-readable rendering of the outline. */
export function formatOutline(outline: SceneOutline): string {
  const lines: string[] = [];
  for (const t of outline.looseText) lines.push(`# ${t}`);
  if (outline.looseText.length) lines.push('');

  lines.push(`shapes (${outline.shapes.length}):`);
  for (const s of outline.shapes) lines.push(`  [${s.type}] ${s.label || '(no label)'}`);

  lines.push('');
  lines.push(`edges (${outline.edges.length}):`);
  for (const e of outline.edges) {
    lines.push(`  ${e.from} -> ${e.to}${e.label ? `  "${e.label}"` : ''}`);
  }

  lines.push('');
  lines.push(
    'element counts: ' +
      Object.entries(outline.counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(' '),
  );
  return lines.join('\n');
}
