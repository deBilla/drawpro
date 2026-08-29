#!/usr/bin/env node
/**
 * Regenerate src/font-metrics.ts from the Excalifont binary that
 * @excalidraw/excalidraw ships.
 *
 *   npx tsx packages/diagram/tools/generate-font-metrics.ts
 *
 * Run this after upgrading @excalidraw/excalidraw. fontkit is a devDependency
 * used only here — the generated table is plain data, so the runtime package
 * gains no dependency.
 *
 * Excalifont is shipped as several unicode-range subsets with content-hashed
 * filenames, so the Latin subset is located by probing coverage rather than by
 * hardcoding a path that would break on the next upgrade.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fontkit from 'fontkit';

const FONT_DIR = join(
  __dirname,
  '../../../node_modules/@excalidraw/excalidraw/dist/prod/fonts/Excalifont',
);
const OUT = join(__dirname, '../src/font-metrics.ts');

/** Codepoint ranges worth carrying: ASCII, Latin-1, punctuation, arrows, math. */
const RANGES: [number, number][] = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x2010, 0x203a],
  [0x2190, 0x21ff],
  [0x2200, 0x22ff],
];

function findLatinSubset(): fontkit.Font {
  const probe = [...'AaWmil0'].map((c) => c.codePointAt(0)!);
  for (const file of readdirSync(FONT_DIR).filter((f) => f.endsWith('.woff2'))) {
    const font = fontkit.openSync(join(FONT_DIR, file)) as fontkit.Font;
    if (probe.every((cp) => font.hasGlyphForCodePoint(cp))) return font;
  }
  throw new Error('No Excalifont subset covers basic Latin — did the package layout change?');
}

function main() {
  const font = findLatinSubset();
  const entries: [string, number][] = [];

  for (const [lo, hi] of RANGES) {
    for (let cp = lo; cp <= hi; cp++) {
      if (!font.hasGlyphForCodePoint(cp)) continue;
      const glyph = font.glyphForCodePoint(cp);
      // Advance as a fraction of the em, which is how text.ts applies it.
      entries.push([String.fromCodePoint(cp), glyph.advanceWidth / font.unitsPerEm]);
    }
  }

  const rows = entries
    .map(([ch, w]) => `  ${JSON.stringify(ch)}: ${w.toFixed(4)},`)
    .join('\n');

  const fallback =
    entries.reduce((sum, [, w]) => sum + w, 0) / entries.length;

  writeFileSync(
    OUT,
    `/**
 * GENERATED — do not edit by hand.
 * Run: npx tsx packages/diagram/tools/generate-font-metrics.ts
 *
 * Advance widths from the Excalifont binary shipped with
 * @excalidraw/excalidraw, as a fraction of the em. Source of truth for text
 * measurement, replacing the hand-estimated table that preceded it.
 *
 * Kerning is not represented. Excalifont has no kern table and only light
 * GPOS adjustment: measured against fontkit's full layout, real diagram labels
 * came out within 0.31%, and a deliberately kern-heavy string within 3.7%.
 * The container safety margin in index.ts more than covers that.
 */

export const EXCALIFONT_ADVANCE: Record<string, number> = {
${rows}
};

/** Mean advance, used for characters outside the font's coverage. */
export const FALLBACK_ADVANCE = ${fallback.toFixed(4)};

export const GLYPH_COUNT = ${entries.length};
`,
  );

  console.log(`  wrote ${entries.length} advances to src/font-metrics.ts`);
  console.log(`  family=${font.familyName} unitsPerEm=${font.unitsPerEm} fallback=${fallback.toFixed(4)}`);
}

main();
