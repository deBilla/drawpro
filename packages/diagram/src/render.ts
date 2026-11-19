/**
 * Render Excalidraw elements to SVG — so a model can *look* at what it drew.
 *
 * The outline from describeScene says what is connected; it cannot say that a
 * label spills out of its box, that two arrows cross on top of a node, or that
 * the whole thing is 4000px wide and unreadable. A picture can.
 *
 * Deliberately not Excalidraw's own exporter: that needs a DOM and rough.js,
 * and the MCP server runs in plain Node. Strokes are clean rather than
 * hand-drawn, which is the one visible difference — and a helpful one, since
 * jitter only makes overlaps harder to judge. Geometry, text positions, fonts,
 * fills and stroke styles follow the stored elements exactly, so what is out of
 * place here is out of place in the editor too.
 */
import type { ExcalidrawElement } from './types';

/** Excalidraw's fontFamily ids → the face to draw with. Helvetica (2) maps to
 *  Liberation Sans, which is metric-compatible with it. */
const FONT_FACE: Record<number, string> = {
  1: 'Virgil',
  2: 'Liberation Sans',
  3: 'Cascadia Code',
  5: 'Excalifont',
  6: 'Liberation Sans',
  7: 'Liberation Sans',
  8: 'Cascadia Code',
  9: 'Liberation Sans',
};

export interface RenderOptions {
  /** Margin around the drawing, in scene px. Default 40. */
  padding?: number;
  /** Override the scene's own background. */
  background?: string;
}

export interface RenderedSvg {
  svg: string;
  /** Bounds of the drawing in scene coordinates, before padding. */
  bounds: { x: number; y: number; width: number; height: number };
}

type Pt = [number, number];

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function dash(el: ExcalidrawElement): string {
  const w = num(el.strokeWidth, 2);
  if (el.strokeStyle === 'dashed') return ` stroke-dasharray="${w * 4} ${w * 3}"`;
  if (el.strokeStyle === 'dotted') return ` stroke-dasharray="${w} ${w * 2.5}" stroke-linecap="round"`;
  return '';
}

function paint(el: ExcalidrawElement, filled: boolean): string {
  const stroke = (el.strokeColor as string) || '#1e1e1e';
  const bg = el.backgroundColor as string | undefined;
  const fill = filled && bg && bg !== 'transparent' ? bg : 'none';
  const opacity = num(el.opacity, 100) / 100;
  return (
    ` fill="${esc(fill)}" stroke="${esc(stroke === 'transparent' ? 'none' : stroke)}"` +
    ` stroke-width="${num(el.strokeWidth, 2)}" stroke-linejoin="round"${dash(el)}` +
    (opacity < 1 ? ` opacity="${opacity}"` : '')
  );
}

/** Rotation about the element's centre, as Excalidraw applies it. */
function rotate(el: ExcalidrawElement): string {
  const a = num(el.angle);
  if (!a) return '';
  const cx = num(el.x) + num(el.width) / 2;
  const cy = num(el.y) + num(el.height) / 2;
  return ` transform="rotate(${(a * 180) / Math.PI} ${cx} ${cy})"`;
}

function rectangle(el: ExcalidrawElement): string {
  const w = num(el.width);
  const h = num(el.height);
  // Excalidraw's adaptive radius: 32px, capped at a quarter of the short side.
  const r = el.roundness ? Math.min(32, Math.min(w, h) * 0.25) : 0;
  return `<rect x="${el.x}" y="${el.y}" width="${w}" height="${h}" rx="${r}"${paint(el, true)}${rotate(el)}/>`;
}

function ellipse(el: ExcalidrawElement): string {
  const w = num(el.width);
  const h = num(el.height);
  return `<ellipse cx="${num(el.x) + w / 2}" cy="${num(el.y) + h / 2}" rx="${w / 2}" ry="${h / 2}"${paint(el, true)}${rotate(el)}/>`;
}

function diamond(el: ExcalidrawElement): string {
  const x = num(el.x);
  const y = num(el.y);
  const w = num(el.width);
  const h = num(el.height);
  const pts = `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`;
  return `<polygon points="${pts}"${paint(el, true)}${rotate(el)}/>`;
}

function absolutePoints(el: ExcalidrawElement): Pt[] {
  const pts = (el.points as number[][] | undefined) ?? [];
  return pts.map(([dx, dy]) => [num(el.x) + dx, num(el.y) + dy]);
}

/** A curve through the points, matching the softened look of Excalidraw's
 *  rounded arrows; straight segments when roundness is off or elbowed. */
function pathThrough(pts: Pt[], curved: boolean): string {
  if (pts.length === 0) return '';
  if (!curved || pts.length < 3) return 'M' + pts.map((p) => p.join(' ')).join(' L');
  // Catmull-Rom → cubic Bézier, so the line passes through every point.
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1.join(' ')} ${c2.join(' ')} ${p2.join(' ')}`;
  }
  return d;
}

function arrowhead(tip: Pt, from: Pt, kind: string, el: ExcalidrawElement): string {
  const stroke = (el.strokeColor as string) || '#1e1e1e';
  const sw = num(el.strokeWidth, 2);
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const len = 10 + sw * 3;
  const spread = kind === 'arrow' ? Math.PI / 7 : Math.PI / 6;
  const a: Pt = [tip[0] - len * Math.cos(ang - spread), tip[1] - len * Math.sin(ang - spread)];
  const b: Pt = [tip[0] - len * Math.cos(ang + spread), tip[1] - len * Math.sin(ang + spread)];
  if (kind === 'dot' || kind === 'circle' || kind === 'circle_outline') {
    const fill = kind === 'circle_outline' ? 'white' : stroke;
    return `<circle cx="${tip[0]}" cy="${tip[1]}" r="${4 + sw}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  }
  if (kind === 'bar') {
    const p = ang + Math.PI / 2;
    const h = 8 + sw * 2;
    return `<line x1="${tip[0] + h * Math.cos(p)}" y1="${tip[1] + h * Math.sin(p)}" x2="${tip[0] - h * Math.cos(p)}" y2="${tip[1] - h * Math.sin(p)}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>`;
  }
  if (kind.startsWith('triangle')) {
    const fill = kind === 'triangle_outline' ? 'white' : stroke;
    return `<polygon points="${tip.join(',')} ${a.join(',')} ${b.join(',')}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  }
  // 'arrow' and anything unrecognised: an open chevron.
  return `<polyline points="${a.join(',')} ${tip.join(',')} ${b.join(',')}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function linear(el: ExcalidrawElement): string {
  const pts = absolutePoints(el);
  if (pts.length < 2) return '';
  const curved = !!el.roundness && !el.elbowed;
  const closed = el.type === 'line' && pts.length > 2 &&
    pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
  let out = `<path d="${pathThrough(pts, curved)}${closed ? ' Z' : ''}"${paint(el, closed)} stroke-linecap="round"/>`;

  // Aim each head along the last stretch of the line, not the chord to the
  // previous point, so a curved arrow's head follows the curve it ends on.
  const end = el.endArrowhead as string | null | undefined;
  const start = el.startArrowhead as string | null | undefined;
  if (end) out += arrowhead(pts[pts.length - 1], pts[pts.length - 2], end, el);
  if (start) out += arrowhead(pts[0], pts[1], start, el);
  return out;
}

function freedraw(el: ExcalidrawElement): string {
  const pts = absolutePoints(el);
  if (pts.length < 2) return '';
  return `<path d="${pathThrough(pts, true)}" fill="none" stroke="${esc((el.strokeColor as string) || '#1e1e1e')}" stroke-width="${num(el.strokeWidth, 2) * 1.5}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function text(
  el: ExcalidrawElement,
  byId: Map<string, ExcalidrawElement>,
  bg: string,
): string {
  const content = String(el.text ?? '');
  if (!content) return '';
  const size = num(el.fontSize, 20);
  const lineHeight = num(el.lineHeight, 1.25) * size;
  const lines = content.split('\n');
  const face = FONT_FACE[num(el.fontFamily, 5)] ?? 'Excalifont';
  const align = (el.textAlign as string) ?? 'left';

  // Stored x/y, which is what the editor paints from. Excalidraw only
  // recomputes bound-text placement when the container is edited.
  const x = num(el.x);
  const y = num(el.y);
  const width = num(el.width);
  const container = el.containerId ? byId.get(el.containerId as string) : undefined;

  const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
  const ax = align === 'center' ? x + width / 2 : align === 'right' ? x + width : x;
  const color = (el.strokeColor as string) || '#1e1e1e';
  const opacity = num(el.opacity, 100) / 100;

  // Baseline at ~0.8em into each line box, close to how browsers place it for
  // these faces at Excalidraw's 1.25 line height.
  const tspans = lines
    .map((line, i) => {
      const by = y + i * lineHeight + (lineHeight - size) / 2 + size * 0.8;
      return `<tspan x="${ax}" y="${by}">${esc(line) || ' '}</tspan>`;
    })
    .join('');

  // Excalidraw cuts the arrow behind its label; a background-coloured plate
  // does the same, so the line does not strike through the words.
  const plate =
    container?.type === 'arrow'
      ? `<rect x="${x - 4}" y="${y - 2}" width="${width + 8}" height="${num(el.height) + 4}" fill="${esc(bg)}"/>`
      : '';

  return (
    plate +
    `<text font-family="${esc(face)}" font-size="${size}" fill="${esc(color)}" text-anchor="${anchor}"` +
    ` xml:space="preserve"${opacity < 1 ? ` opacity="${opacity}"` : ''}${rotate(el)}>${tspans}</text>`
  );
}

/** Where an image element was — its pixels live in `files`, which this
 *  renderer does not read, so mark the spot instead of omitting it silently. */
function imagePlaceholder(el: ExcalidrawElement): string {
  return (
    `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="#f1f3f5" stroke="#adb5bd" stroke-dasharray="6 4"/>` +
    `<text x="${num(el.x) + num(el.width) / 2}" y="${num(el.y) + num(el.height) / 2}" font-family="Liberation Sans" font-size="14" fill="#868e96" text-anchor="middle">[image]</text>`
  );
}

function bounds(elements: ExcalidrawElement[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const el of elements) {
    if (el.points && Array.isArray(el.points)) {
      for (const [x, y] of absolutePoints(el)) take(x, y);
    } else {
      take(num(el.x), num(el.y));
      take(num(el.x) + num(el.width), num(el.y) + num(el.height));
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function renderSvg(
  elements: ExcalidrawElement[],
  appState: Record<string, unknown> = {},
  opts: RenderOptions = {},
): RenderedSvg {
  const live = elements.filter((el) => !el.isDeleted);
  const byId = new Map(live.map((el) => [el.id, el]));
  const b = bounds(live);
  const pad = opts.padding ?? 40;
  const bg = opts.background ?? (appState.viewBackgroundColor as string | undefined) ?? '#ffffff';

  const body: string[] = [];
  for (const el of live) {
    switch (el.type) {
      case 'rectangle':
      case 'frame':
      case 'magicframe':
      case 'embeddable':
      case 'iframe':
        body.push(rectangle(el));
        break;
      case 'ellipse':
        body.push(ellipse(el));
        break;
      case 'diamond':
        body.push(diamond(el));
        break;
      case 'arrow':
      case 'line':
        body.push(linear(el));
        break;
      case 'freedraw':
        body.push(freedraw(el));
        break;
      case 'text':
        body.push(text(el, byId, bg));
        break;
      case 'image':
        body.push(imagePlaceholder(el));
        break;
    }
  }

  const vx = b.x - pad;
  const vy = b.y - pad;
  const vw = Math.max(b.width + pad * 2, 1);
  const vh = Math.max(b.height + pad * 2, 1);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}">` +
    `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="${esc(bg)}"/>` +
    body.join('') +
    `</svg>`;

  return { svg, bounds: b };
}
