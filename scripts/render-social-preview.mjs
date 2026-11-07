// The repository's social preview (1280 × 640, GitHub → Settings → Social preview): Flint's ground,
// its icon, name and tagline in the bundled Onest (nothing fetched). Docs tooling, not the app.
// Usage: node scripts/render-social-preview.mjs  → docs/readme/social-preview.png
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const out = join(repo, 'docs', 'readme', 'social-preview.png');
const { chromium } = await import(
  pathToFileURL(join(repo, 'node_modules/@playwright/test/index.mjs')).href
);
const icon = readFileSync(join(repo, 'assets/icon/flint-icon-512.svg'), 'utf8');
const font = `data:font/woff2;base64,${readFileSync(join(repo, 'apps/desktop/src/renderer/fonts/Onest-Variable.woff2')).toString('base64')}`;
const html = `<!doctype html><html><head><style>
@font-face { font-family: Onest; src: url('${font}') format('woff2'); font-weight: 100 900; }
html, body { margin: 0; width: 1280px; height: 640px; background: #0D0E10; overflow: hidden; }
body { display: flex; align-items: center; justify-content: center; gap: 56px; font-family: Onest, sans-serif; }
.icon svg { width: 248px; height: 248px; display: block; filter: drop-shadow(0 18px 40px rgba(0,0,0,.55)); }
h1 { margin: 0; font-size: 112px; font-weight: 650; letter-spacing: -2px; color: #FFFFFF; line-height: 1; }
p { margin: 22px 0 0; font-size: 32px; font-weight: 450; color: #A4A7AB; line-height: 1.3; max-width: 700px; }
</style></head><body><div class="icon">${icon}</div>
<div><h1>Flint</h1><p>A fast, keyboard-first place for the tasks and notes that pop up while you work.</p></div>
</body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 640 },
  deviceScaleFactor: 1,
});
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate('document.fonts.ready');
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
