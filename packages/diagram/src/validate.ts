import { boxesOverlap, distanceToPolyline } from './geometry';
import type { DiagramSpec, ExcalidrawElement } from './types';

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

/** Checks the *spec* before layout, so authoring mistakes surface as clear
 *  messages rather than a confusing diagram. */
export function validateSpec(spec: DiagramSpec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();

  if (spec.nodes.length === 0) {
    issues.push({ level: 'error', message: 'Diagram has no nodes.' });
  }

  for (const node of spec.nodes) {
    if (ids.has(node.id)) {
      issues.push({ level: 'error', message: `Duplicate node id '${node.id}'.` });
    }
    ids.add(node.id);
    if (!node.label?.trim()) {
      issues.push({ level: 'warning', message: `Node '${node.id}' has an empty label.` });
    }
  }

  spec.edges.forEach((edge, i) => {
    if (!ids.has(edge.from)) {
      issues.push({ level: 'error', message: `Edge ${i} references unknown node '${edge.from}'.` });
    }
    if (!ids.has(edge.to)) {
      issues.push({ level: 'error', message: `Edge ${i} references unknown node '${edge.to}'.` });
    }
  });

  const connected = new Set<string>();
  for (const e of spec.edges) {
    connected.add(e.from);
    connected.add(e.to);
  }
  for (const node of spec.nodes) {
    if (spec.nodes.length > 1 && !connected.has(node.id)) {
      issues.push({
        level: 'warning',
        message: `Node '${node.id}' is not connected to anything — it will float alone.`,
      });
    }
  }

  return issues;
}

/**
 * Checks the generated scene. These are the invariants that separate a clean
 * diagram from a messy one, so they are asserted rather than assumed.
 */
export function validateScene(elements: ExcalidrawElement[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byId = new Map(elements.map((el) => [el.id, el]));

  if (byId.size !== elements.length) {
    issues.push({ level: 'error', message: 'Duplicate element ids in scene.' });
  }

  for (const el of elements) {
    // Every binding must resolve, in both directions.
    for (const key of ['startBinding', 'endBinding'] as const) {
      const binding = el[key] as { elementId: string } | null | undefined;
      if (binding && !byId.has(binding.elementId)) {
        issues.push({
          level: 'error',
          message: `Arrow ${el.id} ${key} points at missing element ${binding.elementId}.`,
        });
      }
    }

    const bound = el.boundElements as Array<{ id: string }> | null | undefined;
    for (const ref of bound ?? []) {
      if (!byId.has(ref.id)) {
        issues.push({
          level: 'error',
          message: `Element ${el.id} boundElements references missing ${ref.id}.`,
        });
      }
    }

    const containerId = el.containerId as string | null | undefined;
    if (containerId) {
      const container = byId.get(containerId);
      if (!container) {
        issues.push({
          level: 'error',
          message: `Text ${el.id} has containerId ${containerId}, which does not exist.`,
        });
      } else {
        const back = (container.boundElements as Array<{ id: string }> | null) ?? [];
        if (!back.some((r) => r.id === el.id)) {
          issues.push({
            level: 'error',
            message: `Text ${el.id} names container ${containerId}, but the container does not list it back.`,
          });
        }
      }
    }
  }

  // Both checks below exist because a rendered diagram showed these defects
  // while every structural assertion passed. Cheap to assert, and they pin the
  // regressions permanently.
  for (const el of elements) {
    const containerId = el.containerId as string | undefined;
    if (el.type !== 'text' || !containerId) continue;
    const container = byId.get(containerId);
    if (!container) continue;

    // Text spilling out of its shape — the symptom of an under-measured label.
    if (['rectangle', 'ellipse', 'diamond'].includes(container.type)) {
      if (el.width > container.width - 8) {
        issues.push({
          level: 'error',
          message: `Label on ${container.id} is ${Math.round(el.width)}px wide inside a ${Math.round(container.width)}px shape — it will overflow.`,
        });
      }
    }

    // A label floating away from the arrow it belongs to.
    if (container.type === 'arrow') {
      const pts = (container.points as number[][]).map(([dx, dy]) => ({
        x: (container.x as number) + dx,
        y: (container.y as number) + dy,
      }));
      const centre = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
      const drift = distanceToPolyline(centre, pts);
      if (drift > 12) {
        issues.push({
          level: 'error',
          message: `Label on arrow ${container.id} sits ${Math.round(drift)}px off the line.`,
        });
      }
    }
  }

  let previousIndex = '';
  for (const el of elements) {
    const index = el.index as string | undefined;
    if (typeof index !== 'string' || index.length === 0) {
      issues.push({ level: 'error', message: `Element ${el.id} is missing a z-order index.` });
    } else if (index <= previousIndex) {
      issues.push({
        level: 'error',
        message: `Element ${el.id} index '${index}' does not follow '${previousIndex}'.`,
      });
    } else {
      previousIndex = index;
    }
  }

  // Overlapping shapes are the classic symptom of hand-placed coordinates.
  const shapes = elements.filter((el) => ['rectangle', 'ellipse', 'diamond'].includes(el.type));
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      if (boxesOverlap(shapes[i], shapes[j], 2)) {
        issues.push({
          level: 'error',
          message: `Shapes ${shapes[i].id} and ${shapes[j].id} overlap.`,
        });
      }
    }
  }

  return issues;
}
