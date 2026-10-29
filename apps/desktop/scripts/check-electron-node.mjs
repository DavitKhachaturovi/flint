// Embedded-Node guard (D-30): launches the Electron binary the app ships with and fails if the
// Node.js inside it is older than the security release that fixes CVE-2026-111497 (Node2Shell).
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const MINIMUM = [24, 22, 1];

const electron = createRequire(import.meta.url)('electron');
const output = execFileSync(electron, ['-p', 'JSON.stringify(process.versions)'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
});
const versions = JSON.parse(output);
const actual = versions.node.split('.').map(Number);

const older = MINIMUM.some((part, index) => {
  const previousEqual = MINIMUM.slice(0, index).every((value, i) => actual[i] === value);
  return previousEqual && actual[index] < part;
});
const sameMajor = actual[0] === MINIMUM[0];

const summary = `Electron ${versions.electron} embeds Node ${versions.node} (required: >= ${MINIMUM.join('.')} on ${MINIMUM[0]}.x)`;
if (older || !sameMajor) {
  console.error(`Embedded-Node check failed (D-30): ${summary}`);
  process.exit(1);
}
console.log(`Embedded-Node check passed: ${summary}`);
