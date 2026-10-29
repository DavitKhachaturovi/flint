import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allTasks,
  documentLines,
  parseDocument,
  serializeDocument,
  type Block,
  type FlintDocument,
  type TaskNode,
} from './document.js';
import { escapeTitle, flintField, parseTaskContent, type TaskContent } from './fields.js';
import { formatTaskLine, parseTaskLine, type TaskLine } from './task-line.js';

const RUNS = Number(process.env.FLINT_FUZZ_RUNS ?? 2000);
// Deep runs (FLINT_FUZZ_RUNS=50000) take longer than the default 5 s timeout.
const TIMEOUT = Math.max(5_000, RUNS * 2);

const word = fc.constantFrom(
  'fix',
  'deploy',
  'tenant',
  'ქართული',
  '日本',
  '🙂',
  '[Vec::new]',
  '(std::move)',
  'Foo::Bar',
  '`code`',
  '`[id:: abcd]`',
  '``a`b``',
  '`',
  '[[Tenant cache]]',
  '[link](https://x.y/a::b)',
  '#123',
  '##infra',
  '!h',
  '@30m',
  '\\[',
  '\\',
  '[',
  ']',
  '(',
  ')',
  '::',
  '^blk',
  'x^2',
  '<!--',
  '-->',
);

const field = fc.constantFrom(
  '[priority:: high]',
  '(priority::low)',
  '[Priority:: HIGHEST]',
  '[priority:: urgent]',
  '[id:: abcd]',
  '[id:: a1b2c3]',
  '[id:: has space]',
  '[today:: true]',
  '[today:: false]',
  '[reminder:: 2026-10-30T15:00]',
  '[reminder:: tomorrow]',
  '[completion:: 2026-10-27]',
  '[completion:: 2026-10-28T14:03:59]',
  '[due:: 2026-11-02]',
  '(due:: 2026-11-02)',
  '[note::x]',
  '[source:: [[Note]]]',
  '[cmd:: `npm test`]',
  '^cache-review',
);

const content = fc
  .array(fc.oneof({ weight: 3, arbitrary: word }, { weight: 2, arbitrary: field }), {
    maxLength: 8,
  })
  .chain((parts) =>
    fc
      .array(fc.constantFrom(' ', ' ', ' ', '  ', '\t', ''), {
        minLength: parts.length,
        maxLength: parts.length,
      })
      .map((gaps) => parts.map((part, index) => `${gaps[index] ?? ''}${part}`).join('')),
  );

const indent = fc.constantFrom(
  '',
  '',
  '',
  ' ',
  '  ',
  '   ',
  '    ',
  '\t',
  '      ',
  '        ',
  '\t\t',
);
const marker = fc.constantFrom('-', '-', '*', '+', '1.', '2)');
const checkbox = fc.constantFrom('[ ]', '[ ]', '[x]', '[X]', '[-]', '[/]', '[]', '');

const listLine = fc
  .tuple(
    indent,
    marker,
    fc.constantFrom(' ', ' ', '  ', '\t'),
    checkbox,
    fc.constantFrom(' ', '', '  '),
    content,
  )
  .map(([i, m, g, c, s, t]) => `${i}${m}${g}${c}${s}${t}`);

const otherLine = fc.oneof(
  fc.constantFrom(
    '',
    '',
    '   ',
    '# Heading',
    '## Completed',
    '## completed ##',
    '```',
    '```js',
    '~~~',
    '````',
    '<!-- note',
    '-->',
    '---',
    '...',
    '> quote',
    '* * *',
    'flint: 1',
    'mode: tasks',
    'id: l7c2',
    '    indented code',
    '\tbody with tab',
  ),
  content,
);

const eol = fc.constantFrom('\n', '\n', '\n', '\r\n', '\r');

/** Markdown-ish files built from the pieces that make parsing hard. */
const markdownFile = fc
  .tuple(
    fc.boolean(),
    fc.boolean(),
    fc.array(fc.tuple(fc.oneof(listLine, otherLine), eol), { maxLength: 30 }),
    fc.boolean(),
  )
  .map(([bom, frontmatter, lines, finalNewline]) => {
    let text = frontmatter ? '---\nflint: 1\nmode: tasks\n---\n' : '';
    lines.forEach(([line, ending], index) => {
      text += line + (index < lines.length - 1 || finalNewline ? ending : '');
    });
    return (bom ? String.fromCharCode(0xfeff) : '') + text;
  });

function withLine(
  document: FlintDocument,
  key: string,
  update: (line: TaskLine) => TaskLine,
): FlintDocument {
  const visit = (node: TaskNode): TaskNode =>
    node.key === key
      ? { ...node, line: update(node.line), raw: null }
      : {
          ...node,
          children: node.children.map((child) => (child.kind === 'task' ? visit(child) : child)),
        };
  return {
    ...document,
    blocks: document.blocks.map((block: Block) => (block.kind === 'task' ? visit(block) : block)),
  };
}

/** `escaped` is `original` with only backslashes inserted (escaping keeps the rendered text). */
function isOriginalWithBackslashes(original: string, escaped: string): boolean {
  let index = 0;
  for (let position = 0; position < escaped.length; position++) {
    const unit = escaped[position];
    if (unit === original[index]) index++;
    else if (unit !== '\\') return false;
  }
  return index === original.length;
}

function sameContent(a: TaskContent, b: TaskContent): void {
  expect(isOriginalWithBackslashes(a.title, b.title), `${a.title} → ${b.title}`).toBe(true);
  expect(b.blockId).toBe(a.blockId);
  expect(b.unknown).toEqual(a.unknown);
  for (const key of ['reminder', 'today', 'completion', 'priority', 'id'] as const) {
    expect(b.fields[key]?.value).toEqual(a.fields[key]?.value);
  }
}

describe('property: untouched files round-trip byte-for-byte (docs/04 §3)', () => {
  it(
    'for any string',
    () => {
      fc.assert(
        fc.property(fc.string({ unit: 'binary', maxLength: 400 }), (text) => {
          expect(serializeDocument(parseDocument(text))).toBe(text);
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'for markdown-like files with tasks, fields, fences and mixed line endings',
    () => {
      fc.assert(
        fc.property(markdownFile, (text) => {
          expect(serializeDocument(parseDocument(text))).toBe(text);
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );
});

describe('property: editing one task changes only its line', () => {
  it(
    'setting a priority leaves every other line byte-identical',
    () => {
      fc.assert(
        fc.property(markdownFile, fc.nat(), (text, pick) => {
          const document = parseDocument(text);
          const tasks = [...allTasks(document)];
          fc.pre(tasks.length > 0);
          const target = tasks[pick % tasks.length]?.task;
          if (!target) return;
          const before = documentLines(document);
          const after = documentLines(
            withLine(document, target.key, (line) => ({
              ...line,
              fields: { ...line.fields, priority: flintField('high' as const) },
            })),
          );
          expect(after).toHaveLength(before.length);
          const changed = after.filter(
            (line, index) => line.text !== before[index]?.text || line.eol !== before[index]?.eol,
          );
          expect(changed.length).toBeLessThanOrEqual(1);
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );
});

describe('property: a written task line reads back the same', () => {
  it(
    'canonical form of any parsed task line is stable',
    () => {
      fc.assert(
        fc.property(listLine, (text) => {
          const line = parseTaskLine(text);
          fc.pre(line !== null);
          if (!line) return;
          const written = formatTaskLine(line);
          const reread = parseTaskLine(written);
          expect(reread).not.toBeNull();
          if (!reread) return;
          sameContent(line, reread);
          expect(formatTaskLine(reread)).toBe(written);
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'a title typed by a user survives as title text next to fields',
    () => {
      fc.assert(
        fc.property(content, (typed) => {
          const title = escapeTitle(typed).replace(/^[ \t]+|[ \t]+$/g, '');
          const reread = parseTaskContent(`${title} [priority:: high] [id:: abcd]`);
          expect(reread.title).toBe(title);
          expect(reread.fields.priority?.value).toBe('high');
          expect(reread.fields.id?.value).toBe('abcd');
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );
});
