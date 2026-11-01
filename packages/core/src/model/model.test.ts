import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readFixture, readFixtures } from '../../test/fixtures.js';
import {
  allTasks,
  parseDocument,
  serializeDocument,
  type FlintDocument,
} from '../format/document.js';
import {
  addTask,
  bulk,
  completeTask,
  deleteTask,
  duplicateTask,
  editTitle,
  indentTask,
  moveDown,
  moveTasksToList,
  moveToList,
  moveUp,
  outdentTask,
  placeTask,
  setBody,
  setPriority,
  setMuted,
  setReminder,
  setToday,
  uncompleteTask,
} from './actions.js';
import { getBody } from './body.js';
import { convertToNote, convertToTasks, duplicateDocument } from './convert.js';
import { applyOp, rebase, type Documents, type Op } from './ops.js';
import { locate } from './tree.js';

const RUNS = Number(process.env.FLINT_FUZZ_RUNS ?? 2000);
const AT = { year: 2026, month: 10, day: 29, hour: 14, minute: 30, second: 0 };

function docs(entries: Record<string, string>): Documents {
  return new Map(
    Object.entries(entries).map(([list, text]) => [list, parseDocument(text, { keySeed: list })]),
  );
}

function text(documents: Documents, list = 'a'): string {
  const document = documents.get(list);
  if (!document) throw new Error(`no list ${list}`);
  return serializeDocument(document);
}

/** Applies an op, checks that its inverse restores every list byte-for-byte, returns the result. */
function apply(documents: Documents, op: Op | null): Documents {
  if (!op) throw new Error('no op');
  const applied = applyOp(documents, op);
  if (!applied) throw new Error('op did not apply');
  const undone = applyOp(applied.documents, applied.inverse);
  for (const list of documents.keys())
    expect(text(undone?.documents ?? new Map(), list)).toBe(text(documents, list));
  return applied.documents;
}

function only(documents: Documents, list = 'a'): FlintDocument {
  const document = documents.get(list);
  if (!document) throw new Error(`no list ${list}`);
  return document;
}

const LIST = `---
flint: 1
id: l7c2
mode: tasks
---
# Unicorn

- [ ] A [id:: aaaa]
## Backend
- [ ] B [id:: bbbb]
    - [ ] B1 [id:: bb11]
- [ ] C [id:: cccc]

## Completed
- [x] Z [completion:: 2026-10-28T14:03] [id:: zzzz]
`;

describe('adding tasks (CAP-02, D-22)', () => {
  it('puts a capture just before the first task, below the heading the file starts with', () => {
    const result = apply(
      docs({ a: LIST }),
      addTask(only(docs({ a: LIST })), 'a', {
        id: 'new1',
        title: 'New [id:: x]',
        priority: 'high',
        today: true,
      }),
    );
    expect(text(result)).toContain(
      '# Unicorn\n\n- [ ] New \\[id:: x] [today:: true] [priority:: high] [id:: new1]\n- [ ] A [id:: aaaa]\n',
    );
  });

  it('adds to a list without tasks after the frontmatter, and before the Completed section', () => {
    const empty = docs({ a: '---\nflint: 1\nmode: tasks\n---\n' });
    expect(text(apply(empty, addTask(only(empty), 'a', { id: 'n1', title: 'x' })))).toBe(
      '---\nflint: 1\nmode: tasks\n---\n- [ ] x [id:: n1]\n',
    );
    const done = docs({ a: '- [ ] gone\n' });
    const onlyCompleted = docs({ a: '\n## Completed\n- [x] z [id:: zzzz]\n' });
    expect(
      text(apply(onlyCompleted, addTask(only(onlyCompleted), 'a', { id: 'n1', title: 'x' }))),
    ).toBe('- [ ] x [id:: n1]\n\n## Completed\n- [x] z [id:: zzzz]\n');
    expect(
      text(apply(done, addTask(only(done), 'a', { id: 'n1', title: 'b' }, { at: 'bottom' }))),
    ).toBe('- [ ] gone\n- [ ] b [id:: n1]\n');
  });

  it('writes a body under the new task and copies the neighbouring bullet style', () => {
    const star = docs({ a: '* [ ] a [id:: aaaa]\n' });
    expect(
      text(
        apply(
          star,
          addTask(only(star), 'a', { id: 'n1', title: 'b', body: 'line\n\n```\ncode\n```' }),
        ),
      ),
    ).toBe('* [ ] b [id:: n1]\n    line\n\n    ```\n    code\n    ```\n* [ ] a [id:: aaaa]\n');
  });
});

describe('editing (TASK-03, TASK-05, REM-01, TODAY-01)', () => {
  const documents = docs({ a: LIST });

  it('changes only the edited line', () => {
    const result = apply(documents, setPriority('a', 'bbbb', 'high'));
    expect(text(result)).toBe(
      LIST.replace('- [ ] B [id:: bbbb]', '- [ ] B [priority:: high] [id:: bbbb]'),
    );
  });

  it('sets reminder and star in canonical order, and clears them', () => {
    let result = apply(
      documents,
      setReminder('a', 'cccc', { ...AT, day: 30, hour: 15, minute: 0 }),
    );
    result = apply(result, setToday('a', 'cccc', true));
    expect(text(result)).toContain(
      '- [ ] C [reminder:: 2026-10-30T15:00] [today:: true] [id:: cccc]\n',
    );
    result = apply(result, setReminder('a', 'cccc', null));
    expect(text(result)).toContain('- [ ] C [today:: true] [id:: cccc]\n');
  });

  it('duplicates a task below it, open, with new IDs and without its reminder (TASK-16, D-74)', () => {
    const source = `---\nflint: 1\nid: l7c2\nmode: tasks\n---\n- [ ] Ship it [reminder:: 2026-10-30T09:00] [muted:: true] [today:: true] [priority:: high] [id:: aaaa] ^blk\n    Notes here.\n    - [ ] Sub [reminder:: 2026-10-30T10:00] [id:: bb11]\n- [ ] Next [id:: cccc]\n`;
    const ids = ['new1', 'new2'];
    const result = apply(
      docs({ a: source }),
      duplicateTask(only(docs({ a: source })), 'a', 'aaaa', () => ids.shift() ?? 'none'),
    );
    expect(text(result)).toBe(
      `---\nflint: 1\nid: l7c2\nmode: tasks\n---\n- [ ] Ship it [reminder:: 2026-10-30T09:00] [muted:: true] [today:: true] [priority:: high] [id:: aaaa] ^blk\n    Notes here.\n    - [ ] Sub [reminder:: 2026-10-30T10:00] [id:: bb11]\n- [ ] Ship it [priority:: high] [id:: new1]\n    Notes here.\n    - [ ] Sub [id:: new2]\n- [ ] Next [id:: cccc]\n`,
    );
  });

  it('turns a reminder off and on; a new time turns it back on (REM-12, D-66)', () => {
    let result = apply(
      documents,
      setReminder('a', 'cccc', { ...AT, day: 30, hour: 15, minute: 0 }),
    );
    result = apply(result, setMuted('a', 'cccc', true));
    expect(text(result)).toContain(
      '- [ ] C [reminder:: 2026-10-30T15:00] [muted:: true] [id:: cccc]\n',
    );
    expect(text(apply(result, setMuted('a', 'cccc', false)))).toContain(
      '- [ ] C [reminder:: 2026-10-30T15:00] [id:: cccc]\n',
    );
    result = apply(result, setReminder('a', 'cccc', { ...AT, day: 31, hour: 9, minute: 0 }));
    expect(text(result)).toContain('- [ ] C [reminder:: 2026-10-31T09:00] [id:: cccc]\n');
  });

  it('escapes typed titles', () => {
    expect(
      text(apply(documents, editTitle('a', 'aaaa', 'Use [priority:: high] in docs'))),
    ).toContain('- [ ] Use \\[priority:: high] in docs [id:: aaaa]\n');
  });

  it('reads and writes bodies before subtasks', () => {
    const result = apply(documents, setBody('a', 'bbbb', 'Context\n\n```js\nfoo()\n```'));
    expect(text(result)).toContain(
      '- [ ] B [id:: bbbb]\n    Context\n\n    ```js\n    foo()\n    ```\n    - [ ] B1 [id:: bb11]\n',
    );
    const task = locate(only(result), 'bbbb')?.task;
    expect(task && getBody(task)).toBe('Context\n\n```js\nfoo()\n```');
  });
});

describe('completing (TASK-06, TASK-04)', () => {
  const documents = docs({ a: LIST });

  it('moves a top-level task to the top of Completed and completes its open subtasks', () => {
    const completion = completeTask(only(documents), 'a', 'bbbb', AT);
    expect(completion?.completedAfter).toBe('aaaa');
    const result = apply(documents, completion?.op ?? null);
    expect(text(result)).toBe(`---
flint: 1
id: l7c2
mode: tasks
---
# Unicorn

- [ ] A [id:: aaaa]
## Backend
- [ ] C [id:: cccc]

## Completed
- [x] B [completion:: 2026-10-29T14:30] [id:: bbbb]
    - [x] B1 [completion:: 2026-10-29T14:30] [id:: bb11]
- [x] Z [completion:: 2026-10-28T14:03] [id:: zzzz]
`);
  });

  it('adds the Completed heading when the list has none', () => {
    const plain = docs({ a: '- [ ] a [id:: aaaa]\n- [ ] b [id:: bbbb]' });
    const result = apply(plain, completeTask(only(plain), 'a', 'aaaa', AT)?.op ?? null);
    expect(text(result)).toBe(
      '- [ ] b [id:: bbbb]\n\n## Completed\n- [x] a [completion:: 2026-10-29T14:30] [id:: aaaa]',
    );
  });

  it('leaves a completed subtask under its parent', () => {
    const result = apply(documents, completeTask(only(documents), 'a', 'bb11', AT)?.op ?? null);
    expect(text(result)).toContain(
      '- [ ] B [id:: bbbb]\n    - [x] B1 [completion:: 2026-10-29T14:30] [id:: bb11]\n- [ ] C',
    );
  });

  it('un-checks back to the previous position, or the bottom when that task is gone', () => {
    const completed = apply(documents, completeTask(only(documents), 'a', 'bbbb', AT)?.op ?? null);
    const back = apply(
      completed,
      uncompleteTask(only(completed), 'a', 'bbbb', () => 'aaaa'),
    );
    expect(text(back)).toContain(
      '- [ ] A [id:: aaaa]\n- [ ] B [id:: bbbb]\n    - [x] B1 [completion:: 2026-10-29T14:30] [id:: bb11]\n## Backend\n- [ ] C',
    );
    const bottom = apply(
      completed,
      uncompleteTask(only(completed), 'a', 'bbbb', () => 'gone'),
    );
    expect(text(bottom)).toContain('- [ ] C [id:: cccc]\n- [ ] B [id:: bbbb]\n');
  });

  it('un-checking a subtask of a completed parent reopens the parent', () => {
    const completed = apply(documents, completeTask(only(documents), 'a', 'bbbb', AT)?.op ?? null);
    const result = apply(
      completed,
      uncompleteTask(only(completed), 'a', 'bb11', () => null),
    );
    expect(text(result)).toContain(
      '- [ ] C [id:: cccc]\n- [ ] B [id:: bbbb]\n    - [ ] B1 [id:: bb11]\n',
    );
  });
});

describe('reordering and nesting (TASK-01, TASK-02, TASK-04, D-22)', () => {
  const documents = docs({ a: LIST });

  it('Alt+↑ swaps with the previous task and leaves headings where they are', () => {
    const result = apply(documents, moveUp(only(documents), 'a', 'bbbb'));
    expect(text(result)).toContain(
      '# Unicorn\n\n- [ ] B [id:: bbbb]\n    - [ ] B1 [id:: bb11]\n- [ ] A [id:: aaaa]\n## Backend\n- [ ] C',
    );
    expect(moveUp(only(documents), 'a', 'aaaa')).toBeNull();
    expect(moveDown(only(documents), 'a', 'cccc')).toBeNull();
    expect(moveUp(only(documents), 'a', 'zzzz')).toBeNull();
  });

  it('a drag places a task next to another at its level only (D-54)', () => {
    const result = apply(
      documents,
      placeTask(only(documents), 'a', 'cccc', { at: 'before', key: 'aaaa' }),
    );
    expect(text(result)).toContain(
      '# Unicorn\n\n- [ ] C [id:: cccc]\n- [ ] A [id:: aaaa]\n## Backend\n- [ ] B [id:: bbbb]\n    - [ ] B1',
    );
    // Not across levels, not into Completed, not onto itself.
    expect(placeTask(only(documents), 'a', 'bb11', { at: 'after', key: 'cccc' })).toBeNull();
    expect(placeTask(only(documents), 'a', 'aaaa', { at: 'before', key: 'zzzz' })).toBeNull();
    expect(placeTask(only(documents), 'a', 'aaaa', { at: 'after', key: 'aaaa' })).toBeNull();
  });

  it('Tab nests under the task above; Shift+Tab puts a subtask after its parent group', () => {
    const indented = apply(documents, indentTask(only(documents), 'a', 'cccc'));
    expect(text(indented)).toContain(
      '- [ ] B [id:: bbbb]\n    - [ ] B1 [id:: bb11]\n    - [ ] C [id:: cccc]\n\n## Completed',
    );
    const outdented = apply(documents, outdentTask(only(documents), 'a', 'bb11'));
    expect(text(outdented)).toContain('- [ ] B [id:: bbbb]\n- [ ] B1 [id:: bb11]\n- [ ] C');
  });

  it('refuses a second level, a first task and a subtask', () => {
    // B has a subtask: nesting it would make two levels (TASK-04).
    expect(indentTask(only(documents), 'a', 'bbbb')).toBeNull();
    expect(indentTask(only(documents), 'a', 'aaaa')).toBeNull();
    expect(indentTask(only(documents), 'a', 'bb11')).toBeNull();
    expect(
      applyOp(documents, {
        type: 'move',
        list: 'a',
        key: 'bbbb',
        where: { at: 'child', parent: 'cccc', index: 'last' },
      }),
    ).toBeNull();
  });

  it('re-indents bodies and uses tabs in a tab-indented file', () => {
    const tabbed = docs({
      a: '- [ ] a [id:: aaaa]\n\t- [ ] s [id:: ssss]\n- [ ] b [id:: bbbb]\n\tbody\n',
    });
    expect(text(apply(tabbed, indentTask(only(tabbed), 'a', 'bbbb')))).toBe(
      '- [ ] a [id:: aaaa]\n\t- [ ] s [id:: ssss]\n\t- [ ] b [id:: bbbb]\n\t\tbody\n',
    );
  });
});

describe('deleting and moving between lists (TASK-11, TASK-12)', () => {
  it('undoing a delete puts the task back under the same heading', () => {
    const documents = docs({ a: LIST });
    const result = apply(documents, deleteTask('a', 'bbbb'));
    expect(text(result)).not.toContain('B1');
  });

  it("moves a task with its subtasks to the top of another list, in that list's line endings", () => {
    const documents = docs({ a: LIST, b: '- [ ] x [id:: xxxx]\r\n' });
    const result = apply(documents, moveToList(documents, 'a', 'bbbb', 'b'));
    expect(text(result, 'b')).toBe(
      '- [ ] B [id:: bbbb]\r\n    - [ ] B1 [id:: bb11]\r\n- [ ] x [id:: xxxx]\r\n',
    );
    expect(text(result, 'a')).not.toContain('bbbb');
  });

  it('a subtask moved alone becomes a top-level task', () => {
    const documents = docs({ a: LIST, b: '' });
    expect(text(apply(documents, moveToList(documents, 'a', 'bb11', 'b')), 'b')).toBe(
      '- [ ] B1 [id:: bb11]\n',
    );
  });

  it('a bulk move lands at the top in the original relative order (D-29)', () => {
    const documents = docs({ a: LIST, b: '- [ ] x [id:: xxxx]\n' });
    // Selected in another order, and a subtask whose parent moves too.
    const op = moveTasksToList(documents, 'a', ['cccc', 'bb11', 'aaaa', 'bbbb'], 'b');
    expect(text(apply(documents, op), 'b')).toBe(
      '- [ ] A [id:: aaaa]\n- [ ] B [id:: bbbb]\n    - [ ] B1 [id:: bb11]\n- [ ] C [id:: cccc]\n- [ ] x [id:: xxxx]\n',
    );
  });

  it('bulk actions are one undo step', () => {
    const documents = docs({ a: LIST });
    const op = bulk([setPriority('a', 'aaaa', 'low'), setPriority('a', 'cccc', 'low'), null]);
    expect(text(apply(documents, op)).match(/\[priority:: low\]/g)).toHaveLength(2);
  });
});

describe('mode conversion (LIST-04, D-22)', () => {
  it('duplicates a list with new IDs and without reminders (LIST-01, D-74)', () => {
    const source =
      '---\nflint: 1\nid: l7c2\nmode: tasks\n---\n# Plan\n- [ ] A [reminder:: 2026-10-30T09:00] [muted:: true] [priority:: low] [id:: aaaa] [owner:: me]\n    - [ ] A1 [id:: bbbb]\n- [x] Z [completion:: 2026-10-28T14:03] [id:: zzzz]\n';
    const ids = ['n1', 'n2', 'n3'];
    expect(
      duplicateDocument(parseDocument(source, { keySeed: 'a' }), 'cop1', () => ids.shift() ?? 'x'),
    ).toBe(
      '---\nflint: 1\nid: cop1\nmode: tasks\n---\n# Plan\n- [ ] A [priority:: low] [id:: n1] [owner:: me]\n    - [ ] A1 [id:: n2]\n- [x] Z [completion:: 2026-10-28T14:03] [id:: n3]\n',
    );
  });

  it('task list → note → task list is lossless', () => {
    const documents = docs({ a: LIST });
    const note = apply(documents, convertToNote(only(documents), 'a'));
    expect(text(note)).toBe(LIST.replace('mode: tasks', 'mode: note'));
    const back = apply(note, convertToTasks(only(note), 'a'));
    expect(text(back)).toBe(LIST);
  });

  it('note → task list: bullets and plain lines become tasks, headings stay (D-77)', () => {
    const documents = docs({ a: readFixture('note-unheadered.md') });
    const result = apply(documents, convertToTasks(only(documents), 'a'));
    expect(text(result)).toBe(`---
mode: tasks
---
# Sprint planning 29 Oct

- [ ] Discussed staging DNS
- [ ] Davit: check VPN gateway logs
- [x] Share the gateway diff

- [ ] **Decision:** keep the hotfix on staging until Monday.
`);
  });

  it('note → task list: code and quotes go under the task before them (D-77)', () => {
    const documents = docs({
      a: '# Standup\nCheck the DNS\n```\ndig flint.dev\n```\n> from Alex\n\n## Later\n---\n| a | b |\n<!-- note\n- not a task\n-->\nRead the logs\n',
    });
    expect(text(apply(documents, convertToTasks(only(documents), 'a')))).toBe(
      '---\nmode: tasks\n---\n# Standup\n- [ ] Check the DNS\n    ```\n    dig flint.dev\n    ```\n    > from Alex\n\n## Later\n---\n| a | b |\n<!-- note\n- not a task\n-->\n- [ ] Read the logs\n',
    );
  });

  it('converts bullets one level down to subtasks, not code or deeper items', () => {
    const documents = docs({
      a: '- parent\n    - child\n        - deeper\n    ```\n    - code\n    ```\n1. numbered\n',
    });
    const result = text(apply(documents, convertToTasks(only(documents), 'a')));
    expect(result).toBe(
      '---\nmode: tasks\n---\n- [ ] parent\n    - [ ] child\n        - deeper\n    ```\n    - code\n    ```\n- [ ] numbered\n',
    );
  });
});

describe('rebase (docs/04 §6)', () => {
  it('re-applies pending changes on top of a file another program changed', () => {
    const pending = [setPriority('a', 'cccc', 'high'), deleteTask('a', 'aaaa')];
    const onDisk = docs({
      a: LIST.replace(
        '- [ ] C [id:: cccc]\n',
        '- [ ] C [id:: cccc]\n- [ ] From the CLI [id:: cli1]\n',
      ),
    });
    const result = text(rebase(onDisk, pending));
    expect(result).toContain(
      '- [ ] C [priority:: high] [id:: cccc]\n- [ ] From the CLI [id:: cli1]\n',
    );
    expect(result).not.toContain('aaaa');
  });
});

describe('property: every action undoes byte-for-byte', () => {
  const lists = readFixtures().filter((fixture) => !fixture.name.startsWith('note'));

  it(
    'random action sequences on the fixtures',
    () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...lists),
          fc.array(fc.tuple(fc.integer({ min: 0, max: 13 }), fc.nat(), fc.nat()), {
            minLength: 1,
            maxLength: 8,
          }),
          (fixture, steps) => {
            let documents = docs({ a: fixture.text, b: '- [ ] other [id:: othr]\n' });
            let counter = 0;
            for (const [action, pickA, pickB] of steps) {
              const document = only(documents);
              const keys = [...allTasks(document)].map(({ task }) => task.key);
              const key = keys[pickA % Math.max(keys.length, 1)];
              const other = keys[pickB % Math.max(keys.length, 1)];
              const ops: (Op | null | undefined)[] = [
                addTask(document, 'a', { id: `p${counter++}`, title: 'added' }),
                key ? setPriority('a', key, 'high') : null,
                key ? setPriority('a', key, null) : null,
                key ? editTitle('a', key, 'edited [x:: y]') : null,
                key ? setBody('a', key, 'body\n- item') : null,
                key ? completeTask(document, 'a', key, AT)?.op : null,
                key ? uncompleteTask(document, 'a', key, () => other ?? null) : null,
                key ? moveUp(document, 'a', key) : null,
                key ? moveDown(document, 'a', key) : null,
                key ? indentTask(document, 'a', key) : null,
                key ? outdentTask(document, 'a', key) : null,
                key ? deleteTask('a', key) : null,
                key ? moveToList(documents, 'a', key, 'b') : null,
                key && other
                  ? { type: 'move', list: 'a', key, where: { at: 'before', key: other } }
                  : null,
              ];
              const op = ops[action];
              if (!op) continue;
              const applied = applyOp(documents, op);
              if (!applied) continue;
              const undone = applyOp(applied.documents, applied.inverse);
              expect(undone).not.toBeNull();
              for (const list of ['a', 'b']) {
                expect(text(undone?.documents ?? new Map(), list)).toBe(text(documents, list));
              }
              documents = applied.documents;
            }
          },
        ),
        { numRuns: Math.max(200, RUNS / 4) },
      );
    },
    Math.max(10_000, RUNS * 5),
  );
});
