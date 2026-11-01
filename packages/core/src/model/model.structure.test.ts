import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  parseDocument,
  serializeDocument,
  type FlintDocument,
  type TaskNode,
} from '../format/document.js';
import { addTask, indentTask, outdentTask, placeTask, setBody } from './actions.js';
import { getBody } from './body.js';
import { applyOp, type Documents, type Op } from './ops.js';

/**
 * D-80: what Flint writes reads back as the same structure. A random run of edits (adding tasks
 * with bodies, indenting, outdenting, moving, changing bodies) is saved and read again; every task
 * keeps its title, ID, body and subtasks. Round trips alone can't see a task that reads back as
 * part of another one's body.
 */

const RUNS = Number(process.env.FLINT_FUZZ_RUNS ?? 2000);
const TIMEOUT = Math.max(5_000, RUNS * 4);

interface Shape {
  readonly id: string | undefined;
  readonly title: string;
  readonly body: string;
  readonly subtasks: readonly Shape[];
}

function shapeOf(node: TaskNode): Shape {
  return {
    id: node.line.fields.id?.value,
    title: node.line.title,
    body: getBody(node),
    subtasks: node.children.flatMap((child) => (child.kind === 'task' ? [shapeOf(child)] : [])),
  };
}

const shape = (document: FlintDocument): Shape[] =>
  document.blocks.flatMap((block) => (block.kind === 'task' ? [shapeOf(block)] : []));

const word = fc.constantFrom('fix', 'deploy', 'ქართული', 'cache', '日本', 'C#', 'a/b', 'v2');
const title = fc.array(word, { minLength: 1, maxLength: 4 }).map((words) => words.join(' '));
/** Bodies as typed: text, plain bullets, quotes, code with task-like lines, blank lines between. */
const body = fc
  .array(
    fc.oneof(
      title,
      title.map((text) => `- ${text}`),
      title.map((text) => `> ${text}`),
      title.map((text) => `\`\`\`\n${text}\n- [ ] inside code\n\`\`\``),
      fc.constant(''),
    ),
    { maxLength: 4 },
  )
  .map((lines) => lines.join('\n').trim());

type Step =
  | {
      readonly kind: 'add';
      readonly title: string;
      readonly body: string;
      readonly bottom: boolean;
    }
  | { readonly kind: 'indent' | 'outdent'; readonly pick: number }
  | { readonly kind: 'body'; readonly pick: number; readonly body: string }
  | { readonly kind: 'place'; readonly pick: number; readonly to: number };

const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({ kind: fc.constant('add' as const), title, body, bottom: fc.boolean() }),
  },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('indent' as const), pick: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('outdent' as const), pick: fc.nat() }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('body' as const), pick: fc.nat(), body }) },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant('place' as const), pick: fc.nat(), to: fc.nat() }),
  },
);

const START = [
  '---\nflint: 1\nmode: tasks\n---\n',
  '',
  '# Notes\n\nSome context.\n',
  '- [ ] Tab style [id:: tab1]\n\t- [ ] sub [id:: tab2]\n',
  '* [ ] Two-space style [id:: two1]\r\n  * [ ] sub [id:: two2]\r\n',
];

describe('property: what Flint writes reads back as the same structure (D-80)', () => {
  it(
    'after any run of edits, the saved file parses to the tasks in memory',
    () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...START),
          fc.array(step, { maxLength: 12 }),
          (start, steps) => {
            let documents: Documents = new Map([['a', parseDocument(start, { keySeed: 'a' })]]);
            let ids = 0;
            for (const item of steps) {
              const document = documents.get('a');
              if (!document) return;
              const keys = shape(document)
                .flatMap((task) => [task, ...task.subtasks])
                .map((task) => task.id ?? '');
              const pick = (n: number): string => keys[n % Math.max(1, keys.length)] ?? '';
              let op: Op | null = null;
              if (item.kind === 'add')
                op = addTask(
                  document,
                  'a',
                  { id: `n${++ids}`, title: item.title, body: item.body },
                  item.bottom ? { at: 'bottom' } : { at: 'top' },
                );
              else if (keys.length === 0) continue;
              else if (item.kind === 'indent') op = indentTask(document, 'a', pick(item.pick));
              else if (item.kind === 'outdent') op = outdentTask(document, 'a', pick(item.pick));
              else if (item.kind === 'body') op = setBody('a', pick(item.pick), item.body);
              else if (item.kind === 'place') {
                const tops = shape(document).map((task) => task.id ?? '');
                const key = pick(item.pick);
                const other = tops[item.to % tops.length];
                if (other && other !== key && tops.includes(key))
                  op = placeTask(document, 'a', key, { at: 'before', key: other });
              }
              const applied = op ? applyOp(documents, op) : null;
              if (applied) documents = applied.documents;
            }
            const document = documents.get('a');
            if (!document) return;
            const written = serializeDocument(document);
            expect(shape(parseDocument(written)), written).toEqual(shape(document));
          },
        ),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );
});
