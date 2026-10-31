// Re-renders docs/design/screenshots from the HTML mockups (docs/09 §10) with Playwright's Chromium,
// at 2x like the originals. Usage: node scripts/render-mockups.mjs [01 02 …] [--out <dir>]
// The mockups load their fonts from Google Fonts: that is docs tooling, not the app (APP-09 covers the app).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const mockups = join(root, 'docs', 'design', 'mockups');

/** CSS-pixel viewport per screen; the PNGs are 2x these sizes. */
const SCREENS = {
  '01': { file: '01-main-inbox', width: 1280, height: 1020 },
  '02': { file: '02-quick-capture', width: 1280, height: 760 },
  '03': { file: '03-today', width: 1280, height: 900 },
  '04': { file: '04-note-mode', width: 1280, height: 820 },
  '05': { file: '05-mini-mode', width: 440, height: 640 },
  '06': { file: '06-design-system', width: 1280, height: 1000 },
  '07': { file: '07-code-highlighting', width: 1280, height: 1040 },
};

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args[outIndex + 1] : join(root, 'docs', 'design', 'screenshots');
const wanted = args.filter(
  (arg, index) => !arg.startsWith('--') && (outIndex < 0 || index !== outIndex + 1),
);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
try {
  for (const key of wanted.length > 0 ? wanted : Object.keys(SCREENS)) {
    const screen = SCREENS[key];
    if (!screen) throw new Error(`unknown screen ${key}`);
    const page = await browser.newPage({
      viewport: { width: screen.width, height: screen.height },
      deviceScaleFactor: 2,
    });
    await page.goto(`file:///${join(mockups, `${screen.file}.html`).replace(/\\/g, '/')}`);
    await page.evaluate('document.fonts.ready');
    // Let entry animations (≤ 150 ms, docs/09 §9) finish.
    await page.waitForTimeout(400);
    const path = join(out, `${screen.file}.png`);
    await page.screenshot({ path });
    console.log(`rendered ${path}`);
    await page.close();
  }
} finally {
  await browser.close();
}
