// M1 measurements for docs/06 §1: format speed, shorthand speed, and the size of what the capture
// popup loads. Runs against the built package: `npm run measure`.
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { build } from 'rolldown';
import { parseDocument, serializeDocument, prepareForSave } from '../dist/format/index.js';
import { applyOp, setPriority } from '../dist/model/index.js';
import { parseCapture } from '../dist/shorthand/index.js';
import { benchmarkList, benchmarkLists, medianDuration } from '../dist/bench/index.js';

const time = (runs, work) => medianDuration(runs, work, () => performance.now());
const text = benchmarkList();
const document = parseDocument(text);
const lists = benchmarkLists();
const now = new Date(2026, 9, 29, 14, 30);

const results = {
  'Parse 1,000-task list (ms)': time(200, () => parseDocument(text)),
  'Serialize 1,000-task list (ms)': time(200, () => serializeDocument(document)),
  'Edit one task + prepare + serialize (save path, ms)': time(200, () => {
    const edited = applyOp(
      new Map([['a', document]]),
      setPriority('a', 't000', 'low'),
    ).documents.get('a');
    serializeDocument(
      prepareForSave(edited, {
        now: { year: 2026, month: 10, day: 29, hour: 14, minute: 30, second: 0 },
        isTaken: () => false,
      }).document,
    );
  }),
  'Shorthand parse per keystroke (ms)': time(5000, () =>
    parseCapture('fix token refresh in the importer !h ##unicorn @tomorrow 10', { now, lists }),
  ),
};

for (const entry of ['shorthand/index.js', 'time/index.js']) {
  const bundle = await build({
    input: new URL(`../dist/${entry}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    output: { format: 'esm', minify: true },
    write: false,
    logLevel: 'silent',
  });
  const code = bundle.output.map((chunk) => (chunk.type === 'chunk' ? chunk.code : '')).join('');
  results[`Bundle ${entry} min+gz (KB)`] = gzipSync(code).length / 1024;
}

for (const [name, value] of Object.entries(results)) {
  console.log(`${name.padEnd(56)} ${value.toFixed(3)}`);
}
