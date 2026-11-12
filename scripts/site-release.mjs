// The website's "Latest release" line (WEB-01, D-184): the app's version (apps/desktop/package.json)
// and the day of its section in docs/release-notes.md ("## 1.7.0 (11 Nov 2026)" gives "11 Nov / 1.7.0"),
// written into site/index.html's <dd id="release">. The site has no build step, so the Pages
// workflow runs this before it uploads site/, and a version bump redeploys the site (pages.yml).
// Usage: node scripts/site-release.mjs [--check]  (--check: fail if the page is out of date)
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const fail = (message) => {
  console.error(`site-release: ${message}`);
  process.exit(1);
};

const version = JSON.parse(
  readFileSync(new URL('apps/desktop/package.json', root), 'utf8'),
).version;
const notes = readFileSync(new URL('docs/release-notes.md', root), 'utf8').replace(/\r\n/g, '\n');
// Plain-text match on the heading, as release-notes.mjs does, so no version character needs escaping.
const heading = notes
  .split('\n')
  .find((line) => line.startsWith(`## ${version} (`) && line.endsWith(')'));
if (!heading) fail(`docs/release-notes.md has no "## ${version} (…)" section`);
const date = /\((\d{1,2} [A-Z][a-z]{2})[a-z]* \d{4}\)$/.exec(heading);
if (!date) fail(`can't read a date like "11 Nov 2026" in "${heading}"`);
const line = `${date[1]} / ${version}`;

const page = new URL('site/index.html', root);
const html = readFileSync(page, 'utf8');
const pattern = /(<dd id="release">)([^<]*)(<\/dd>)/;
const found = pattern.exec(html);
if (!found) fail('site/index.html has no <dd id="release">');
if (found[2] === line) {
  console.log(`site-release: ${line} (up to date)`);
} else if (process.argv.includes('--check')) {
  fail(
    `site/index.html says "${found[2]}", the release is "${line}": run node scripts/site-release.mjs`,
  );
} else {
  writeFileSync(page, html.replace(pattern, `$1${line}$3`));
  console.log(`site-release: ${found[2]} -> ${line}`);
}
