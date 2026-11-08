// The note editor's spec fixtures (D-141 Q13): the CommonMark spec's examples and GFM's extension
// examples as compact JSON (markdown, example number, section; no HTML, which the editor tests
// don't use). Test data only, never shipped.
//
// Usage: node scripts/editor-spec-fixtures.mjs <commonmark spec.json> <gfm spec.txt>
//   CommonMark 0.31.2: https://spec.commonmark.org/0.31.2/spec.json
//   GFM 0.29-gfm:      https://raw.githubusercontent.com/github/cmark-gfm/master/test/spec.txt
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [commonmarkPath, gfmPath] = process.argv.slice(2);
if (!commonmarkPath || !gfmPath) {
  console.error('Usage: node scripts/editor-spec-fixtures.mjs <spec.json> <spec.txt>');
  process.exit(1);
}
const out = (name) =>
  fileURLToPath(
    new URL(`../apps/desktop/src/renderer/editor/fixtures/spec/${name}`, import.meta.url),
  );

const commonmark = JSON.parse(readFileSync(commonmarkPath, 'utf8')).map((each) => ({
  example: each.example,
  section: each.section,
  markdown: each.markdown,
}));

// GFM's spec.txt: examples are fenced by 32 backticks with `example <extension>` for the
// extensions; the markdown ends at a line holding only `.`; `→` stands for a tab.
const FENCE = '`'.repeat(32);
const gfm = [];
let section = '';
let example = 0;
const lines = readFileSync(gfmPath, 'utf8').split('\n');
for (let at = 0; at < lines.length; at++) {
  const line = lines[at];
  const heading = /^#{1,6} (.*)$/.exec(line);
  if (heading) section = heading[1].trim();
  if (!line.startsWith(`${FENCE} example`)) continue;
  example++;
  const extension = line.slice(`${FENCE} example`.length).trim();
  const markdown = [];
  for (at++; at < lines.length && lines[at] !== '.'; at++) markdown.push(lines[at]);
  while (at < lines.length && lines[at] !== FENCE) at++;
  if (extension === '') continue;
  gfm.push({
    example,
    section,
    extension,
    markdown: `${markdown.join('\n')}\n`.replaceAll('→', '\t'),
  });
}

writeFileSync(out('commonmark-0.31.2.json'), `${JSON.stringify(commonmark, null, 1)}\n`);
writeFileSync(out('gfm-0.29-extensions.json'), `${JSON.stringify(gfm, null, 1)}\n`);
console.log(`CommonMark: ${commonmark.length} examples; GFM extensions: ${gfm.length} examples`);
