// Renders the PNG icons the app needs (tray, window) from the SVG logos in assets/icon (docs/01
// Brand): Electron can't load SVG images. Usage: node scripts/render-icons.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));

/** [source SVG, CSS size, device scale, output] */
const ICONS = [
  ['flint-icon-16.svg', 16, 1, 'tray-16.png'],
  ['flint-icon-16.svg', 16, 2, 'tray-32.png'],
  ['flint-icon-24.svg', 24, 2, 'tray-48.png'],
  ['flint-icon-512.svg', 256, 1, 'icon-256.png'],
];

const browser = await chromium.launch();
try {
  for (const [svg, size, scale, out] of ICONS) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: scale,
    });
    const markup = readFileSync(join(root, 'assets', 'icon', svg), 'utf8');
    // The first width/height attributes win, so the injected size takes effect.
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${markup.replace('<svg', `<svg width="${size}" height="${size}"`)}</body></html>`,
    );
    const path = join(root, 'apps', 'desktop', 'resources', out);
    await page.screenshot({
      path,
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    console.log(`rendered ${path}`);
    await page.close();
  }
} finally {
  await browser.close();
}
