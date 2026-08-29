import { EXCALIFONT_ADVANCE, FALLBACK_ADVANCE } from './font-metrics';
import { LINE_HEIGHT } from './theme';

/**
 * Text measurement using real Excalifont advance widths, extracted from the
 * font binary that @excalidraw/excalidraw ships (see tools/generate-font-metrics.ts).
 *
 * This replaced a hand-estimated width table that was wrong by a mean of 7.7%
 * of an em, with individual characters off by up to 25% — 't' and 'I' were
 * classed as narrow at 0.30 when they are nearer 0.55, and 'm' as wide at 0.88
 * when it is 0.66. That error is what let a label measure 219px, slip under the
 * 220px wrap threshold, and overflow its box on screen.
 *
 * Kerning is not modelled; see the note in font-metrics.ts for why that is
 * within tolerance.
 */
function charWidth(ch: string): number {
  return EXCALIFONT_ADVANCE[ch] ?? FALLBACK_ADVANCE;
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
