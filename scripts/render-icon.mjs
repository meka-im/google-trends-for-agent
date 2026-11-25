import { readFile } from 'node:fs/promises';

// Render .actor/icon.svg to a 512×512 PNG when sharp is already installed.
// Nothing is installed here; without sharp the SVG remains the only icon.
const svg = await readFile(new URL('../.actor/icon.svg', import.meta.url));
let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.log('sharp is not installed; skipped .actor/icon.png. Render .actor/icon.svg at 512×512 before publishing.');
  process.exit(0);
}
const output = new URL('../.actor/icon.png', import.meta.url);
await sharp(svg).resize(512, 512).png().toFile(output);
console.log('Wrote .actor/icon.png (512×512).');
