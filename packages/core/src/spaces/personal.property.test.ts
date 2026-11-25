import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allTasks,
  documentMode,
  isProvisionalKey,
  parseDocument,
  serializeDocument,
  type FlintDocument,
  type TaskNode,
} from '../format/document.js';
import { prepareForSave } from '../format/save.js';
import { applyPersonal, splitPersonal, type PersonalFields } from './personal.js';

/**
 * SPACE-09 (docs/04 §9): the personal-field split is a file-format change in all but name, so it is
 * fuzzed: over messy markdown (the format's own hard cases), your fields never reach the shared
 * copy, a task's shared part never changes by being stripped and re-applied, and your fields come
 * back as they were, through the text as well as in memory.
 */
const RUNS = Number(process.env.FLINT_FUZZ_RUNS ?? 2000);
const TIMEOUT = Math.max(20_000, RUNS * 10);

const word = fc.constantFrom(
  'fix',
  'deploy',
  'ქართული',
  '🙂',
  '[Vec::new]',
  'Foo::Bar',
  '`code`',
  '`[pinned:: true]`',
  '[[Tenant cache]]',
  '[link](https://x.y/a::b)',
  '\\[',
  '[',
  ']',
  '::',
  '^blk',
);

const field = fc.constantFrom(
  '[priority:: high]',
  '(priority::low)',
  '[id:: abcd]',
  '[id:: has space]',
  '[today:: true]',
  '[today:: false]',
  '[pinned:: true]',
  '[PINNED:: TRUE]',
  '(pinned::true)',
  '[muted:: true]',
  '(muted::TRUE)',
  '[muted:: no]',
  '[reminder:: 2026-10-30T15:00]',
  '[reminder:: 2026-10-30]',
  '[reminder:: tomorrow]',
  '[completion:: 2026-10-27]',
  '[due:: 2026-11-02]',
  '[note::x]',
  '[source:: [[Note]]]',
  '^cache-review',
);

// Words and fields with the gaps people leave: a space mostly, sometimes two, a tab or none.
const content = fc
  .array(fc.oneof({ weight: 3, arbitrary: word }, { weight: 3, arbitrary: field }), {
    maxLength: 8,
  })
  .chain((parts) =>
    fc
      .array(fc.constantFrom(' ', ' ', ' ', '  ', '\t', ''), {
        minLength: parts.length,
        maxLength: parts.length,
      })
      .map((gaps) =>
        parts.map((part, index) => `${index === 0 ? '' : gaps[index]}${part}`).join(''),
      ),
  );

const listLine = fc
  .tuple(
    fc.constantFrom('', '', '', '  ', '    ', '\t'),
    fc.constantFrom('-', '-', '*', '+'),
    fc.constantFrom('[ ]', '[ ]', '[x]'),
    content,
  )
  .map(([indent, marker, box, text]) => `${indent}${marker} ${box} ${text}`);

const otherLine = fc.oneof(
  fc.constantFrom('', '# Heading', '## Completed', '```', '> quote', '    indented body'),
  content,
);

const file = fc
  .tuple(
    fc.array(fc.tuple(fc.oneof({ weight: 3, arbitrary: listLine }, otherLine)), {
      maxLength: 20,
    }),
    fc.constantFrom('\n', '\r\n'),
    fc.constantFrom('tasks', 'tasks', 'tasks', 'note'),
  )
  .map(
    ([lines, eol, mode]) =>
      `---${eol}flint: 1${eol}mode: ${mode}${eol}---${eol}${lines.join(eol)}${eol}`,
  );

/** As Flint has it after a save: every task with its own ID (`prepareForSave`). */
function saved(text: string): FlintDocument {
  let seed = 1;
  return prepareForSave(parseDocument(text), {
    now: { year: 2026, month: 3, day: 10, hour: 10, minute: 0, second: 0 },
    isTaken: () => false,
    random: () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646,
  }).document;
}

/** A file as Flint may get it: saved (a task list), or as written (a note, a file not saved yet). */
const document = fc.tuple(file, fc.boolean()).map(([text, save]) => {
  const parsed = parseDocument(text);
  // A task list is always saved before it is split (docs/04 §9); a note may be as written.
  return save || documentMode(parsed) === 'tasks' ? saved(text) : parsed;
});

/** Your fields' values by task ID (their exact text aside). */
function values(mine: ReadonlyMap<string, PersonalFields>): Record<string, unknown> {
  return Object.fromEntries(
    [...mine].map(([id, fields]) => [
      id,
      {
        reminder: fields.reminder?.value,
        muted: fields.muted?.value,
        pinned: fields.pinned?.value,
      },
    ]),
  );
}

const personalOn = (task: TaskNode): boolean => {
  const { reminder, muted, pinned } = task.line.fields;
  return reminder !== undefined || muted !== undefined || pinned !== undefined;
};

/** Each task line by key: its text as written (`raw`, or as Flint writes it). */
const linesByKey = (doc: FlintDocument): Map<string, string> =>
  new Map([...allTasks(doc)].map(({ task }) => [task.key, task.raw ?? '']));

describe('the personal-field split, fuzzed (SPACE-09, docs/04 §9, D-190 Q22)', () => {
  it(
    'no task with an ID carries your fields in the shared copy (read back from its text); a line without one stays exactly as written',
    () => {
      fc.assert(
        fc.property(document, (doc) => {
          const { shared, unkeyed } = splitPersonal(doc);
          const reread = parseDocument(serializeDocument(shared));
          for (const { task } of allTasks(reread))
            if (!isProvisionalKey(task.key)) expect(personalOn(task)).toBe(false);
          const before = linesByKey(doc);
          let kept = 0;
          for (const { task } of allTasks(shared))
            if (isProvisionalKey(task.key) && personalOn(task)) {
              kept++;
              expect(task.raw).toBe(before.get(task.key));
            }
          expect(kept).toBe(unkeyed);
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'stripped and re-applied, the shared part is unchanged (in memory and through the text); stripping twice changes nothing',
    () => {
      fc.assert(
        fc.property(document, (doc) => {
          const { shared, mine } = splitPersonal(doc);
          const sharedText = serializeDocument(shared);
          const local = applyPersonal(shared, mine);
          expect(serializeDocument(splitPersonal(local).shared)).toBe(sharedText);
          const reread = parseDocument(serializeDocument(local));
          expect(serializeDocument(splitPersonal(reread).shared)).toBe(sharedText);
          expect(serializeDocument(splitPersonal(parseDocument(sharedText)).shared)).toBe(
            sharedText,
          );
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'a merged copy from others comes back byte for byte after your fields go on and come off (the sync path)',
    () => {
      fc.assert(
        fc.property(document, document, (theirsDoc, mineDoc) => {
          const theirs = serializeDocument(splitPersonal(theirsDoc).shared);
          const { mine } = splitPersonal(mineDoc);
          const local = applyPersonal(parseDocument(theirs), mine);
          expect(serializeDocument(splitPersonal(local).shared)).toBe(theirs);
          const reread = parseDocument(serializeDocument(local));
          expect(serializeDocument(splitPersonal(reread).shared)).toBe(theirs);
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'your fields come back as they were, by task ID, through the text',
    () => {
      fc.assert(
        fc.property(document, (doc) => {
          const { shared, mine } = splitPersonal(doc);
          const reread = parseDocument(serializeDocument(applyPersonal(shared, mine)));
          expect(values(splitPersonal(reread).mine)).toEqual(values(mine));
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'only your fields end up on a task with an ID, whatever the shared copy carried (through the text)',
    () => {
      fc.assert(
        fc.property(document, document, (theirsDoc, mineDoc) => {
          const { mine } = splitPersonal(mineDoc);
          const applied = parseDocument(serializeDocument(applyPersonal(theirsDoc, mine)));
          for (const { task } of allTasks(applied)) {
            if (isProvisionalKey(task.key)) continue;
            const own = mine.get(task.key);
            const { reminder, muted, pinned } = task.line.fields;
            expect(reminder?.value).toEqual(own?.reminder?.value);
            expect(muted?.value).toEqual(own?.muted?.value);
            expect(pinned?.value).toEqual(own?.pinned?.value);
          }
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );
});
