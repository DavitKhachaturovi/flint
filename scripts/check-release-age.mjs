// Supply-chain cooldown guard (D-30): every package in package-lock.json must have been published at
// least MIN_DAYS days ago, unless it is a recorded security exception below. npm's own
// `min-release-age` (.npmrc) applies when versions are resolved; this re-checks the committed lockfile,
// which `npm ci` installs as-is.
import { readFileSync } from 'node:fs';

const MIN_DAYS = 7;

/** One-off exceptions for security fixes from the project's official maintainers (D-30). */
const EXCEPTIONS = {
  // Electron 45.1.0 (27 Oct 2026) embeds Node 24.22.1, the fix for CVE-2026-111497 "Node2Shell".
  electron: '45.1.0',
};

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const packages = new Map();
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (!path.startsWith('node_modules/') && !path.includes('/node_modules/')) continue;
  if (entry.link || !entry.version || !entry.resolved?.startsWith('https://registry.npmjs.org/'))
    continue;
  const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  packages.set(`${name}@${entry.version}`, { name, version: entry.version });
}

const cutoff = Date.now() - MIN_DAYS * 86_400_000;
const failures = [];
const queue = [...packages.values()];
async function worker() {
  for (let item = queue.shift(); item; item = queue.shift()) {
    const response = await fetch(`https://registry.npmjs.org/${item.name.replace('/', '%2f')}`);
    if (!response.ok) {
      failures.push(`${item.name}@${item.version}: registry returned ${response.status}`);
      continue;
    }
    const published = (await response.json()).time?.[item.version];
    if (!published) failures.push(`${item.name}@${item.version}: no publish time`);
    else if (Date.parse(published) > cutoff && EXCEPTIONS[item.name] !== item.version) {
      failures.push(
        `${item.name}@${item.version}: published ${published.slice(0, 10)}, under ${MIN_DAYS} days`,
      );
    }
  }
}
await Promise.all(Array.from({ length: 12 }, worker));

if (failures.length > 0) {
  console.error(`Release-age check failed (D-30):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(
  `Release-age check passed: ${packages.size} packages are at least ${MIN_DAYS} days old (or recorded exceptions).`,
);
