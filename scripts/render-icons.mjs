// Renders the icons the app needs from the SVG logos in assets/icon (docs/01 Brand): the tray PNGs
// and the multi-size app icon (UI-07, D-52, D-65, D-68), since Electron and Windows can't use SVG.
// Usage: node scripts/render-icons.mjs
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const resources = join(root, 'apps', 'desktop', 'resources');

/** [source SVG, CSS size, device scale, output] */
const TRAY = [
  ['flint-taskbar-16.svg', 16, 1, 'tray-16.png'],
  ['flint-taskbar-32.svg', 32, 1, 'tray-32.png'],
  ['flint-taskbar-48.svg', 48, 1, 'tray-48.png'],
];

/**
 * The sizes in `icon.ico`: Windows' title bar, taskbar and Start sizes at 100–400 % scaling
 * (docs/09 §8). Everything up to 96 px comes from the taskbar logos, drawn to one rule (D-74): a
 * full-bleed tile with the master logo's corner proportions and a rim that stays visible on the dark
 * taskbar, the leaf spanning 65 % of its diagonal; 256 px from the 512 px master. Each size comes
 * from the nearest logo drawn for it (D-148: 16, 24, 32 and 48 px, all with the master's facets and
 * a hairline outline), so no small drawing is stretched. The in-app logos (flint-icon-16.svg, the
 * master) are not used here.
 */
const ICO = [
  [16, 'flint-taskbar-16.svg'],
  [20, 'flint-taskbar-24.svg'],
  [24, 'flint-taskbar-24.svg'],
  [30, 'flint-taskbar-32.svg'],
  [32, 'flint-taskbar-32.svg'],
  [36, 'flint-taskbar-32.svg'],
  [40, 'flint-taskbar-48.svg'],
  [48, 'flint-taskbar-48.svg'],
  [60, 'flint-taskbar-48.svg'],
  [64, 'flint-taskbar-48.svg'],
  [72, 'flint-taskbar-48.svg'],
  [96, 'flint-taskbar-48.svg'],
  [256, 'flint-icon-512.svg'],
];

/** A Windows .ico holding PNG images (supported since Vista), smallest first. */
function icoFile(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

const browser = await chromium.launch();
try {
  const render = async (svg, size, scale) => {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: scale,
    });
    const markup = readFileSync(join(root, 'assets', 'icon', svg), 'utf8');
    // The first width/height attributes win, so the injected size takes effect.
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${markup.replace('<svg', `<svg width="${size}" height="${size}"`)}</body></html>`,
    );
    const png = await page.screenshot({
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    await page.close();
    return png;
  };

  for (const [svg, size, scale, out] of TRAY) {
    const path = join(resources, out);
    writeFileSync(path, await render(svg, size, scale));
    console.log(`rendered ${path}`);
  }
  const images = [];
  for (const [size, svg] of ICO) images.push({ size, png: await render(svg, size, 1) });
  const path = join(resources, 'icon.ico');
  writeFileSync(path, icoFile(images));
  console.log(`rendered ${path} (${ICO.map(([size]) => size).join(', ')} px)`);
} finally {
  await browser.close();
}
