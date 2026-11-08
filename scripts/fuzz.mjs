// Long fuzzing on demand and nightly (D-141 Q13): every test file that uses fast-check (core's
// format, model, shorthand and time tests, the note editor's randomised editing), in rounds with a
// new random seed each, for a time budget (`FLINT_FUZZ_MINUTES`, default 15). Each round's seed is
// printed; a failing round stops the run with the command that repeats it.
import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const minutes = Number(process.env.FLINT_FUZZ_MINUTES ?? 15);
const runs = process.env.FLINT_FUZZ_RUNS ?? '20000';
const editorRuns = process.env.FLINT_EDITOR_FUZZ_RUNS ?? '3000';

function testsUsingFastCheck(folder) {
  const found = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...testsUsingFastCheck(path));
    else if (/\.test\.ts$/.test(entry.name) && readFileSync(path, 'utf8').includes("'fast-check'"))
      found.push(relative(root, path).replaceAll('\\', '/'));
  }
  return found;
}

const files = [
  ...testsUsingFastCheck(join(root, 'packages')),
  ...testsUsingFastCheck(join(root, 'apps/desktop/src')),
];
const vitest = join(root, 'node_modules/vitest/vitest.mjs');
const deadline = Date.now() + minutes * 60_000;
console.log(
  `Fuzzing ${files.length} test files for ${minutes} min (runs ${runs}, editor ${editorRuns}).`,
);

for (let round = 1; Date.now() < deadline; round++) {
  const seed = randomInt(2 ** 31);
  console.log(`\nRound ${round}: seed ${seed}`);
  const env = {
    ...process.env,
    FLINT_FUZZ_SEED: String(seed),
    FLINT_FUZZ_RUNS: runs,
    FLINT_EDITOR_FUZZ_RUNS: editorRuns,
  };
  const result = spawnSync(process.execPath, [vitest, 'run', ...files], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(
      `\nRound ${round} failed with seed ${seed}. Repeat it with:\n` +
        `  FLINT_FUZZ_SEED=${seed} FLINT_FUZZ_RUNS=${runs} FLINT_EDITOR_FUZZ_RUNS=${editorRuns} ` +
        `node node_modules/vitest/vitest.mjs run ${files.join(' ')}`,
    );
    process.exit(1);
  }
}
console.log('\nNo failures.');
