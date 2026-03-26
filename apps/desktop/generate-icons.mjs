import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';

// Use sharp to render SVG to PNG at various sizes
const sharp = (await import('sharp')).default;
const svg = readFileSync(join(import.meta.dirname, 'icon.svg'));

const sizes = [16, 32, 64, 128, 256, 512, 1024];
const iconsetDir = join(import.meta.dirname, 'icon.iconset');

// Clean and create iconset directory
try { rmSync(iconsetDir, { recursive: true }); } catch {}
mkdirSync(iconsetDir, { recursive: true });

// Generate PNGs for macOS iconset
for (const size of sizes) {
  const buf = await sharp(svg).resize(size, size).png().toBuffer();
  writeFileSync(join(iconsetDir, `icon_${size}x${size}.png`), buf);

  // @2x variants (half the named size, full resolution)
  if (size <= 512) {
    const buf2x = await sharp(svg).resize(size * 2, size * 2).png().toBuffer();
    writeFileSync(join(iconsetDir, `icon_${size}x${size}@2x.png`), buf2x);
  }
}

// Generate .icns using macOS iconutil
execSync(`iconutil -c icns "${iconsetDir}" -o "${join(import.meta.dirname, 'icon.icns')}"`);
console.log('Created icon.icns');

// Generate icon.png (256x256) for Linux/Windows
const png256 = await sharp(svg).resize(256, 256).png().toBuffer();
writeFileSync(join(import.meta.dirname, 'icon.png'), png256);
console.log('Created icon.png');

// Clean up iconset
rmSync(iconsetDir, { recursive: true });
console.log('Done!');
