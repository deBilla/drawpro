import { attachArrow, createArrow, createArrowLabel, createLabeledShape } from './elements';
import { boundaryPoint, centerOf, retract, type Point } from './geometry';
import { assignIndices, elementId, elementMeta } from './ids';
import { layoutDiagram, type SizedEdgeLabel, type SizedNode } from './layout';
import { measureText } from './text';
import {
  BASE_STYLE,
  CONTAINER_PADDING,
  EDGE_LABEL_FONT_SIZE,
  FONT_FAMILY,
  FONT_SIZE,
  LINE_HEIGHT,
  MAX_LABEL_WIDTH,
  MIN_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  snap,
} from './theme';
import { validateScene, validateSpec, type ValidationIssue } from './validate';
import type { DiagramSpec, ExcalidrawElement, ExcalidrawScene, ShapeKind } from './types';

export * from './types';
export { validateSpec, validateScene, type ValidationIssue } from './validate';

const ARROW_GAP = 4;
const TITLE_FONT_SIZE = 28;

export interface BuildResult {
  scene: ExcalidrawScene;
  issues: ValidationIssue[];
}

/** Ellipses and diamonds need more area than a rectangle to fit the same text. */
function shapePadding(kind: ShapeKind): number {
  if (kind === 'ellipse') return CONTAINER_PADDING * 2.2;
  if (kind === 'diamond') return CONTAINER_PADDING * 2.6;
  return CONTAINER_PADDING;
}

/** Text measurement is an approximation, so leave headroom. A slightly wide box
 *  reads fine; text touching or crossing the border reads as broken. */
const WIDTH_SAFETY = 1.06;

function sizeNode(label: string, kind: ShapeKind): { width: number; height: number } {
  const metrics = measureText(label, FONT_SIZE, MAX_LABEL_WIDTH);
  const pad = shapePadding(kind);
  return {
    width: Math.max(snap(metrics.width * WIDTH_SAFETY + pad * 2), MIN_NODE_WIDTH),
    height: Math.max(snap(metrics.height + pad * 2), MIN_NODE_HEIGHT),
  };
}

/**
 * Turn a spec into a complete Excalidraw scene.
 *
 * Errors are returned rather than thrown, so a caller (or Claude) can read the
 * issue list, fix the spec, and try again instead of guessing.
 */
export function buildDiagram(spec: DiagramSpec): BuildResult {
  const specIssues = validateSpec(spec);
  if (specIssues.some((i) => i.level === 'error')) {
    return { scene: emptyScene(), issues: specIssues };
  }

  const kinds = new Map<string, ShapeKind>();
  const sizes: SizedNode[] = spec.nodes.map((node) => {
    const kind = node.shape ?? 'rectangle';
    kinds.set(node.id, kind);
    return { id: node.id, ...sizeNode(node.label, kind) };
  });

  const edgeLabels: (SizedEdgeLabel | null)[] = spec.edges.map((edge) => {
    if (!edge.label) return null;
    const m = measureText(edge.label, EDGE_LABEL_FONT_SIZE, MAX_LABEL_WIDTH);
    return { width: m.width + 12, height: m.height + 8 };
  });

  const layout = layoutDiagram(spec, sizes, edgeLabels);

  const elements: ExcalidrawElement[] = [];
  const shapesById = new Map<string, ExcalidrawElement>();

  for (const node of spec.nodes) {
    const placed = layout.nodes.get(node.id)!;
    const { shape, text } = createLabeledShape({
      kind: kinds.get(node.id)!,
      accent: node.accent,
      label: node.label,
      x: placed.x,
      y: placed.y,
      width: placed.width,
      height: placed.height,
    });
    shapesById.set(node.id, shape);
    elements.push(shape, text);
  }

  const arrowElements: ExcalidrawElement[] = [];

  spec.edges.forEach((edge, i) => {
    const fromShape = shapesById.get(edge.from)!;
    const toShape = shapesById.get(edge.to)!;
    const fromBox = layout.nodes.get(edge.from)!;
    const toBox = layout.nodes.get(edge.to)!;

    // Trim dagre's polyline back to each shape's outline, then leave a small
    // gap so the arrowhead sits against the border rather than touching it.
    const routed = layout.edges[i].points;
    const interior = routed.length > 2 ? routed.slice(1, -1) : [];

    const towardTarget: Point = interior[0] ?? centerOf(toBox);
    const towardSource: Point = interior[interior.length - 1] ?? centerOf(fromBox);

    const rawStart = boundaryPoint(fromBox, kinds.get(edge.from)!, towardTarget);
    const rawEnd = boundaryPoint(toBox, kinds.get(edge.to)!, towardSource);

    const start = retract(rawStart, centerOf(fromBox), ARROW_GAP);
    const end = retract(rawEnd, centerOf(toBox), ARROW_GAP);

    const arrow = createArrow({
      points: [start, ...interior, end],
      startElementId: fromShape.id,
      endElementId: toShape.id,
      style: edge.style,
      arrowhead: edge.arrowhead,
      gap: ARROW_GAP,
    });

    attachArrow(fromShape, arrow.id);
    attachArrow(toShape, arrow.id);
    arrowElements.push(arrow);

    if (edge.label) {
      arrowElements.push(createArrowLabel(arrow, edge.label));
    }
  });

  elements.push(...arrowElements);

  if (spec.title) {
    elements.unshift(createTitle(spec.title, elements));
  }

  return { scene: toScene(elements), issues: [...specIssues, ...validateScene(elements)] };
}

function createTitle(title: string, elements: ExcalidrawElement[]): ExcalidrawElement {
  const minX = Math.min(...elements.map((e) => e.x));
  const minY = Math.min(...elements.map((e) => e.y));
  const metrics = measureText(title, TITLE_FONT_SIZE, 600);

  return {
    id: elementId(),
    type: 'text',
    x: minX,
    y: Math.round(minY - metrics.height - 32),
    width: metrics.width,
    height: metrics.height,
    ...BASE_STYLE,
    backgroundColor: 'transparent',
    roundness: null,
    boundElements: null,
    text: metrics.lines.join('\n'),
    originalText: title,
    fontSize: TITLE_FONT_SIZE,
    fontFamily: FONT_FAMILY,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    lineHeight: LINE_HEIGHT,
    autoResize: true,
    ...elementMeta(),
  };
}

function toScene(elements: ExcalidrawElement[]): ExcalidrawScene {
  assignIndices(elements);
  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://drawpro.kithly.app',
    elements,
    appState: { viewBackgroundColor: '#ffffff', gridSize: null },
    files: {},
  };
}

function emptyScene(): ExcalidrawScene {
  return toScene([]);
}
