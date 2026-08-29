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

export interface SceneOutline {
  shapes: { id: string; type: string; label: string }[];
  edges: { from: string; to: string; label: string }[];
  /** Text not bound to any shape or arrow — titles, stray notes. */
  looseText: string[];
  counts: Record<string, number>;
}

export function describeScene(elements: ExcalidrawElement[]): SceneOutline {
  const byId = new Map(elements.map((el) => [el.id, el]));
  const labelFor = (id: string): string => {
    const owner = byId.get(id);
    const bound = (owner?.boundElements as { type: string; id: string }[] | null) ?? [];
    const textRef = bound.find((b) => b.type === 'text');
    const text = textRef ? byId.get(textRef.id) : undefined;
    return ((text?.originalText ?? text?.text) as string | undefined)?.replace(/\n/g, ' ') ?? '';
  };

  const counts: Record<string, number> = {};
  for (const el of elements) counts[el.type] = (counts[el.type] ?? 0) + 1;

  const shapes = elements
    .filter((el) => SHAPES.has(el.type))
    .map((el) => ({ id: el.id, type: el.type, label: labelFor(el.id) }));

  const edges = elements
    .filter((el) => el.type === 'arrow')
    .map((el) => {
      const start = el.startBinding as { elementId: string } | null;
      const end = el.endBinding as { elementId: string } | null;
      return {
        from: start ? labelFor(start.elementId) || start.elementId : '(unbound)',
        to: end ? labelFor(end.elementId) || end.elementId : '(unbound)',
        label: labelFor(el.id),
      };
    });

  const owned = new Set(
    elements.flatMap((el) =>
      (((el.boundElements as { type: string; id: string }[] | null) ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.id)),
    ),
  );
  const looseText = elements
    .filter((el) => el.type === 'text' && !owned.has(el.id))
    .map((el) => ((el.originalText ?? el.text) as string) ?? '');

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
