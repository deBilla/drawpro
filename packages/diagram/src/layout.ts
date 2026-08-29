import dagre from '@dagrejs/dagre';
import type { Point } from './geometry';
import type { DiagramSpec } from './types';

export interface LaidOutNode {
  id: string;
  /** Top-left, converted from dagre's centre-origin coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutEdge {
  from: string;
  to: string;
  /** Polyline dagre routed between the two nodes. */
  points: Point[];
}

export interface Layout {
  nodes: Map<string, LaidOutNode>;
  edges: LaidOutEdge[];
}

export interface SizedNode {
  id: string;
  width: number;
  height: number;
}

export interface SizedEdgeLabel {
  width: number;
  height: number;
}

/**
 * Rank-based layered layout. Dagre is doing the genuinely hard part here —
 * assigning ranks, ordering within a rank to minimise crossings, and routing
 * edges around nodes. It is pure JS with no DOM, which is why it works in a
 * plain Node CLI where mermaid would not.
 */
export function layoutDiagram(
  spec: DiagramSpec,
  sizes: SizedNode[],
  edgeLabels: (SizedEdgeLabel | null)[],
): Layout {
  const g = new dagre.graphlib.Graph({ multigraph: true });

  g.setGraph({
    rankdir: spec.direction ?? 'TB',
    nodesep: spec.spacing?.node ?? 60,
    ranksep: spec.spacing?.rank ?? 90,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const s of sizes) {
    g.setNode(s.id, { width: s.width, height: s.height });
  }

  spec.edges.forEach((edge, i) => {
    const label = edgeLabels[i];
    // Giving dagre the label's dimensions makes it reserve room, so labels
    // don't land on top of other nodes.
    g.setEdge(
      edge.from,
      edge.to,
      label ? { width: label.width, height: label.height, labelpos: 'c' } : {},
      `e${i}`,
    );
  });

  dagre.layout(g);

  const nodes = new Map<string, LaidOutNode>();
  for (const s of sizes) {
    const n = g.node(s.id) as { x: number; y: number; width: number; height: number };
    nodes.set(s.id, {
      id: s.id,
      x: Math.round(n.x - n.width / 2),
      y: Math.round(n.y - n.height / 2),
      width: n.width,
      height: n.height,
    });
  }

  const edges: LaidOutEdge[] = spec.edges.map((edge, i) => {
    const e = g.edge({ v: edge.from, w: edge.to, name: `e${i}` }) as { points?: Point[] };
    return {
      from: edge.from,
      to: edge.to,
      points: (e?.points ?? []).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    };
  });

  return { nodes, edges };
}
