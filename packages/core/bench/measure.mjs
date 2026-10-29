// M1 measurements for docs/06 §1: format speed, shorthand speed, and the size of what the capture
// popup loads. Runs against the built package: `npm run measure`.
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { build } from 'rolldown';
import { parseDocument, serializeDocument, prepareForSave } from '../dist/format/index.js';
import { applyOp, setPriority } from '../dist/model/index.js';
import { parseCapture } from '../dist/shorthand/index.js';

function median(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function time(runs, work) {
  for (let warm = 0; warm < Math.min(20, runs); warm++) work();
  const samples = [];
  for (let run = 0; run < runs; run++) {
    const start = performance.now();
    work();
    samples.push(performance.now() - start);
  }
  return median(samples);
}

/** A busy list: 1,000 tasks with fields, some bodies and subtasks, a Completed section. */
function bigList() {
  let text = '---\nflint: 1\nid: big1\nmode: tasks\n---\n# Backlog\n\n';
  for (let index = 0; index < 900; index++) {
    const fields = [
      index % 7 === 0 ? '[reminder:: 2026-11-02T09:00]' : '',
      index % 5 === 0 ? '[today:: true]' : '',
      index % 3 === 0 ? '[priority:: high]' : '',
      `[id:: t${index.toString(36).padStart(3, '0')}]`,
    ].filter(Boolean);
    text += `- [ ] Task ${index}: fix the [[tenant]] cache for \`Vec::new\` ${fields.join(' ')}\n`;
    if (index % 10 === 0)
      text +=
        '    Body line with a link https://dev.azure.com/x/_git/y/pullrequest/42\n    ```\n    stack trace line\n    ```\n';
    if (index % 25 === 0) text += `    - [ ] Subtask of ${index} [id:: s${index.toString(36)}]\n`;
  }
  text += '\n## Completed\n';
  for (let index = 0; index < 100; index++) {
    text += `- [x] Done ${index} [completion:: 2026-10-2${index % 9}T10:00] [id:: d${index.toString(36).padStart(3, '0')}]\n`;
  }
  return text;
}

const text = bigList();
const document = parseDocument(text);
const lists = Array.from({ length: 30 }, (_, index) => ({
  id: `l${index}`,
  name: index === 0 ? 'Inbox' : index === 1 ? 'Unicorn' : `Project ${index}`,
  mode: index % 6 === 5 ? 'note' : 'tasks',
}));
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
