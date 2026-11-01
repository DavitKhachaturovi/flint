import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseDocument, type FlintDocument, type TaskNode } from './document.js';
import { joinLines } from './lines.js';

/**
 * D-80: the parsed structure, not only the round trip. A file written from a known structure
 * (tasks, subtasks, bodies, non-task content), in the indentation styles Flint, Obsidian and VS Code
 * use, must read back as that structure. The hidden-subtasks bug (0.4.14) round-tripped exactly and
 * still lost every subtask after the first.
 */

const RUNS = Number(process.env.FLINT_FUZZ_RUNS ?? 2000);
const TIMEOUT = Math.max(5_000, RUNS * 2);

interface ModelTask {
  readonly title: string;
  readonly id: string;
  readonly done: boolean;
  /** Body lines, relative to the body's indentation; no leading or trailing blank lines. */
  readonly body: readonly string[];
  readonly subtasks: readonly ModelTask[];
}

type ModelBlock =
  | { readonly kind: 'task'; readonly task: ModelTask }
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string };

/** What the parser should see: tasks with their parts, and the non-blank non-task lines. */
type Shape =
  | {
      readonly title: string;
      readonly id: string | undefined;
      readonly done: boolean;
      readonly body: readonly string[];
      readonly subtasks: readonly Shape[];
    }
  | { readonly other: string };

const word = fc.constantFrom(
  'fix',
  'deploy',
  'tenant',
  'ქართული',
  'cache',
  'résumé',
  '日本',
  'v2.1',
  'C#',
  'a/b',
);
const title = fc.array(word, { minLength: 1, maxLength: 5 }).map((words) => words.join(' '));

/** Body content that must stay body: text, quotes, plain bullets, code fences (with task-like lines). */
const bodyPiece = fc.oneof(
  title.map((text) => [text]),
  title.map((text) => [`> ${text}`]),
  title.map((text) => [`- ${text}`]),
  title.map((text) => [`1. ${text}`]),
  fc
    .tuple(fc.constantFrom('', 'json', 'ts'), fc.array(title, { minLength: 1, maxLength: 3 }))
    .map(([lang, lines]) => ['```' + lang, ...lines, '- [ ] not a task inside code', '```']),
  // A paragraph after a blank line stays in the body when it is indented.
  title.map((text) => ['', text]),
);
const body = fc
  .array(bodyPiece, { maxLength: 3 })
  .map((pieces) => pieces.flat())
  .map((lines) => {
    // No leading blank line: the body starts right under its task.
    while (lines[0] === '') lines.shift();
    return lines;
  });

let idSeq = 0;
const subtask: fc.Arbitrary<ModelTask> = fc
  .tuple(title, fc.boolean(), body)
  .map(([text, done, lines]) => ({
    title: text,
    id: `s${(++idSeq).toString(36)}`,
    done,
    body: lines,
    subtasks: [],
  }));
const task: fc.Arbitrary<ModelTask> = fc
  .tuple(title, fc.boolean(), body, fc.array(subtask, { maxLength: 4 }))
  .map(([text, done, lines, subtasks]) => ({
    title: text,
    id: `t${(++idSeq).toString(36)}`,
    done,
    body: lines,
    subtasks,
  }));
const block: fc.Arbitrary<ModelBlock> = fc.oneof(
  { weight: 5, arbitrary: task.map((value) => ({ kind: 'task', task: value }) as const) },
  { weight: 1, arbitrary: title.map((text) => ({ kind: 'heading', text: `## ${text}` }) as const) },
  { weight: 1, arbitrary: title.map((text) => ({ kind: 'paragraph', text }) as const) },
);

interface Style {
  readonly name: string;
  /** One indentation level. */
  readonly unit: string;
  readonly marker: string;
}
const STYLES: readonly Style[] = [
  { name: 'Flint (4 spaces)', unit: '    ', marker: '-' },
  { name: 'Obsidian (tabs)', unit: '\t', marker: '-' },
  { name: 'VS Code (2 spaces)', unit: '  ', marker: '-' },
  { name: 'asterisks, 4 spaces', unit: '    ', marker: '*' },
];

function taskLine(model: ModelTask, marker: string): string {
  return `${marker} [${model.done ? 'x' : ' '}] ${model.title} [id:: ${model.id}]`;
}

/** The model as markdown, a blank line before every non-task block and the task after it. */
function write(blocks: readonly ModelBlock[], style: Style, eol: string): string {
  const lines: string[] = [];
  let afterOther = false;
  const bodyLines = (lines_: readonly string[], indent: string): string[] =>
    lines_.map((line) => (line === '' ? '' : indent + line));
  for (const item of blocks) {
    if (item.kind !== 'task') {
      if (lines.length > 0) lines.push('');
      lines.push(item.text);
      afterOther = true;
      continue;
    }
    if (afterOther) lines.push('');
    afterOther = false;
    const model = item.task;
    lines.push(taskLine(model, style.marker));
    lines.push(...bodyLines(model.body, style.unit));
    for (const sub of model.subtasks) {
      lines.push(style.unit + taskLine(sub, style.marker));
      lines.push(...bodyLines(sub.body, style.unit + style.unit));
    }
  }
  return lines.join(eol) + eol;
}

const expectedTask = (model: ModelTask): Shape => ({
  title: model.title,
  id: model.id,
  done: model.done,
  body: model.body.filter((line) => line.trim() !== '').map((line) => line.trim()),
  subtasks: model.subtasks.map(expectedTask),
});

function expected(blocks: readonly ModelBlock[]): Shape[] {
  return blocks.map((item) =>
    item.kind === 'task' ? expectedTask(item.task) : { other: item.text },
  );
}

/** Non-blank lines of a text, trimmed (structure, not indentation, is checked here). */
const content = (text: string): string[] =>
  text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => line.trim());

function shapeOf(node: TaskNode): Shape {
  return {
    title: node.line.title,
    id: node.line.fields.id?.value,
    done: node.line.status !== ' ',
    body: node.children.flatMap((child) =>
      child.kind === 'text' ? content(joinLines(child.lines)) : [],
    ),
    subtasks: node.children.flatMap((child) => (child.kind === 'task' ? [shapeOf(child)] : [])),
  };
}

function shape(document: FlintDocument): Shape[] {
  return document.blocks.flatMap((item): Shape[] =>
    item.kind === 'task'
      ? [shapeOf(item)]
      : content(joinLines(item.lines)).map((line) => ({ other: line })),
  );
}

describe('structure: hand-written files read as written (D-80)', () => {
  it('a task with several subtasks, each with its own body', () => {
    const text =
      '- [ ] parent [id:: p1]\n' +
      '    parent body\n' +
      '    - [ ] first [id:: s1]\n' +
      '        first body\n' +
      '    - [x] second [id:: s2]\n' +
      '    - [ ] third [id:: s3]\n' +
      '        ```\n' +
      '        - [ ] code, not a subtask\n' +
      '        ```\n' +
      '- [ ] next [id:: n1]\n';
    expect(shape(parseDocument(text))).toEqual([
      {
        title: 'parent',
        id: 'p1',
        done: false,
        body: ['parent body'],
        subtasks: [
          { title: 'first', id: 's1', done: false, body: ['first body'], subtasks: [] },
          { title: 'second', id: 's2', done: true, body: [], subtasks: [] },
          {
            title: 'third',
            id: 's3',
            done: false,
            body: ['```', '- [ ] code, not a subtask', '```'],
            subtasks: [],
          },
        ],
      },
      { title: 'next', id: 'n1', done: false, body: [], subtasks: [] },
    ]);
  });

  it('a plain bullet in a body is body text, a checkbox is a subtask', () => {
    const text = '- [ ] parent [id:: p1]\n    - a plain point\n    - [ ] a subtask [id:: s1]\n';
    expect(shape(parseDocument(text))).toEqual([
      {
        title: 'parent',
        id: 'p1',
        done: false,
        body: ['- a plain point'],
        subtasks: [{ title: 'a subtask', id: 's1', done: false, body: [], subtasks: [] }],
      },
    ]);
  });

  it('headings and paragraphs between tasks stay outside them', () => {
    const text = '# Sprint\n- [ ] a [id:: a1]\n\nSome context.\n\n- [ ] b [id:: b1]\n## Later\n';
    expect(shape(parseDocument(text))).toEqual([
      { other: '# Sprint' },
      { title: 'a', id: 'a1', done: false, body: [], subtasks: [] },
      { other: 'Some context.' },
      { title: 'b', id: 'b1', done: false, body: [], subtasks: [] },
      { other: '## Later' },
    ]);
  });
});

describe('property: any written structure reads back as that structure (D-80)', () => {
  for (const style of STYLES) {
    it(
      style.name,
      () => {
        fc.assert(
          fc.property(
            fc.array(block, { maxLength: 8 }),
            fc.constantFrom('\n', '\r\n'),
            (blocks, eol) => {
              const text = write(blocks, style, eol);
              expect(shape(parseDocument(text)), text).toEqual(expected(blocks));
            },
          ),
          { numRuns: RUNS },
        );
      },
      TIMEOUT,
    );
  }
});
