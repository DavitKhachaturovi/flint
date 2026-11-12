/**
 * AGENT-02 (D-185 Q1): `flint.exe`'s entry point, bundled by scripts/build-sea.mjs into
 * `dist/flint.cjs` and the single executable `dist/flint.exe`.
 */
import { runCli } from './cli.js';
import { processDeps, processIo } from './wiring.js';

const io = processIo();
runCli(process.argv.slice(2), io, processDeps(io.env)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`flint: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 5;
  },
);
