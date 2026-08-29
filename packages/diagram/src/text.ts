import { LINE_HEIGHT } from './theme';

/**
 * Advance widths as a fraction of font size, approximating Excalifont.
 *
 * We cannot measure real glyphs in Node — there is no canvas — so this table
 * exists to size containers sensibly on first render. Excalidraw re-measures
 * with the real font and re-wraps bound text whenever the container is touched,
 * so small errors self-correct; being roughly right beats a flat average, which
 * makes "Wm" and "il" the same width and produces visibly wrong boxes.
 */
const NARROW = new Set([...'ijltfIr.,:;!|\'`()[]{}-']);
const WIDE = new Set([...'mwMW@%']);
const UPPER_OR_DIGIT = /[A-Z0-9]/;

function charWidth(ch: string): number {
  if (ch === ' ') return 0.3;
  if (NARROW.has(ch)) return 0.3;
  if (WIDE.has(ch)) return 0.88;
  if (UPPER_OR_DIGIT.test(ch)) return 0.62;
  return 0.52;
}

export function measureLine(line: string, fontSize: number): number {
  let w = 0;
  for (const ch of line) w += charWidth(ch);
  return w * fontSize;
}

/** Greedy word wrap. Words longer than maxWidth get their own line rather than
 *  being broken mid-word — a hard break reads worse than a slightly wide box. */
export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${current} ${words[i]}`;
      if (measureLine(candidate, fontSize) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }

  return lines;
}

export interface TextMetrics {
  lines: string[];
  width: number;
  height: number;
}

export function measureText(text: string, fontSize: number, maxWidth: number): TextMetrics {
  const lines = wrapText(text, fontSize, maxWidth);
  const width = Math.max(...lines.map((l) => measureLine(l, fontSize)), 0);
  // Excalidraw derives line height from fontSize * lineHeight and rounds up.
  const height = Math.ceil(lines.length * fontSize * LINE_HEIGHT);
  return { lines, width: Math.ceil(width), height };
}
