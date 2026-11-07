// The release text for a version tag (D-136): checks that the tag (v1.2.3) is the app's version and
// prints that version's section of docs/whats-new.md (what the app's What's new card shows), with
// a short note about the unsigned installer. Usage: node scripts/release-notes.mjs v1.2.3
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const tag = process.argv[2] ?? '';
const fail = (message) => {
  console.error(`release-notes: ${message}`);
  process.exit(1);
};

const version = JSON.parse(
  readFileSync(new URL('apps/desktop/package.json', root), 'utf8'),
).version;
if (tag !== `v${version}`) fail(`the tag "${tag}" is not v${version}, the app's version`);

const whatsNew = readFileSync(new URL('docs/whats-new.md', root), 'utf8').replace(/\r\n/g, '\n');
const heading = new RegExp(`^## ${version.replace(/\./g, '\\.')} \\(.*\\)$`, 'm');
const start = whatsNew.search(heading);
if (start < 0) fail(`docs/whats-new.md has no "## ${version} (…)" section`);
const body = whatsNew.slice(start).split('\n').slice(1);
const next = body.findIndex((line) => line.startsWith('## '));
const section = (next < 0 ? body : body.slice(0, next)).join('\n').trim();
if (!section) fail(`the ${version} section of docs/whats-new.md is empty`);

process.stdout.write(
  `${section}\n\n---\n\n` +
    '**Installing:** download `Flint-Setup-' +
    version +
    '.exe` below and run it; it installs for you only, no admin rights needed. ' +
    'The installer is not code-signed yet, so Windows SmartScreen may ask once: **More info → Run anyway**. ' +
    'An installed Flint updates itself (Settings → About).\n',
);
