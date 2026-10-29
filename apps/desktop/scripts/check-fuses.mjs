// Checks the Electron fuses of a packaged build (D-34, electron-builder.yml `electronFuses`).
// Usage: node scripts/check-fuses.mjs [path to the packaged exe]; runs after `npm run dist`.
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { FuseV1Options, getCurrentFuseWire } = require('@electron/fuses');

const exe =
  process.argv[2] ?? join(import.meta.dirname, '..', 'dist-installer', 'win-unpacked', 'Flint.exe');

const expected = {
  RunAsNode: false,
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  GrantFileProtocolExtraPrivileges: false,
};
// The fuse wire stores each fuse as the character '0' (off) or '1' (on).
const OFF = '0'.charCodeAt(0);
const ON = '1'.charCodeAt(0);

const wire = await getCurrentFuseWire(exe);
const problems = Object.entries(expected)
  .filter(([name, on]) => wire[FuseV1Options[name]] !== (on ? ON : OFF))
  .map(
    ([name, on]) => `${name}: expected ${on ? 'on' : 'off'}, found ${wire[FuseV1Options[name]]}`,
  );

if (problems.length > 0) {
  console.error(`Electron fuses of ${exe} are not as configured:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Electron fuses OK: ${exe}`);
