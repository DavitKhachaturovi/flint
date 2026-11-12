// AGENT-02 (D-185 Q1): builds flint.exe, a Node single-executable application.
//
// 1. rolldown bundles src/main.ts into one CommonJS file, dist/flint.cjs (no dependencies at run
//    time; `node apps/cli/dist/flint.cjs …` runs it directly in development and tests).
// 2. Node 24 makes the preparation blob (`--experimental-sea-config`; `--build-sea` is Node 25.5+
//    and not on the 24.x line), and postject injects it into a copy of the running node.exe:
//    dist/flint.exe. The toolchain's Node (24.22.1+, .node-version) is the one shipped.
//
// Usage: node scripts/build-sea.mjs [--bundle-only]
// (npm run build -w @flint/cli: the bundle; npm run build:exe -w @flint/cli: also flint.exe.)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const dist = path('../dist/');
const bundle = join(dist, 'flint.cjs');
const blob = join(dist, 'flint.blob');
const seaConfig = join(dist, 'sea-config.json');
const exe = join(dist, 'flint.exe');

/** Node's own sentinel for the single-executable fuse (docs: Single executable applications). */
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
/** The oldest Node that may be shipped (D-30: the security release). */
const MIN_NODE = [24, 22, 1];

const bundleOnly = process.argv.includes('--bundle-only');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  input: path('../src/main.ts'),
  platform: 'node',
  resolve: {
    // Only the protocol's types and constants: no core logic in flint.exe (docs/05 §5).
    alias: { '@flint/core/agents': path('../../../packages/core/src/agents/protocol.ts') },
  },
  output: { file: bundle, format: 'cjs', sourcemap: false },
  logLevel: 'warn',
});
console.log(`Bundled ${bundle}`);
if (bundleOnly) process.exit(0);

const [major, minor, patch] = process.versions.node.split('.').map(Number);
const tooOld =
  major !== MIN_NODE[0] || minor < MIN_NODE[1] || (minor === MIN_NODE[1] && patch < MIN_NODE[2]);
if (tooOld) {
  console.error(
    `flint.exe must be built with Node ${MIN_NODE.join('.')}+ on 24.x (this is ${process.versions.node}).`,
  );
  process.exit(1);
}
if (process.platform !== 'win32') {
  console.error('flint.exe is built on Windows (it copies the running node.exe).');
  process.exit(1);
}

writeFileSync(
  seaConfig,
  `${JSON.stringify(
    { main: bundle, output: blob, disableExperimentalSEAWarning: true, useCodeCache: true },
    null,
    2,
  )}\n`,
);
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

copyFileSync(process.execPath, exe);
// node.exe's Authenticode signature doesn't cover the injected blob; Windows runs it anyway
// (unsigned, as Flint's installer, docs/05 §6). Signing flint.exe is part of code signing.
const { inject } = await import('postject');
await inject(exe, 'NODE_SEA_BLOB', readFileSync(blob), { sentinelFuse: SEA_FUSE });
rmSync(blob);
rmSync(seaConfig);

// A smoke check: the executable runs and prints its help.
const help = execFileSync(exe, ['--help'], { encoding: 'utf8' });
if (!help.startsWith('flint:')) {
  console.error(`flint.exe --help printed something unexpected:\n${help}`);
  process.exit(1);
}
console.log(`Built ${exe} (Node ${process.versions.node})`);
