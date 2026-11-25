import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { ListsMergeContext } from '../sync/merge.js';
import { FakeSpaceStore } from './fake-store.js';
import { readSpaceArchive, writeSpaceArchive, type SpaceArchive } from './space-archive.js';
import { mergeSpaceLists, spaceMerge3 } from './space-merge.js';
import { writeSafely } from './write-safely.js';
import type { ZipCodec } from './zip.js';

/** SPACE-02 (D-190): a whole space merged with personal sync's rules, on the fake provider. */
const codec: ZipCodec = {
  deflate: (data) => new Uint8Array(deflateRawSync(data)),
  inflate: (data, size) => new Uint8Array(inflateRawSync(data, { maxOutputLength: size })),
};
const context = (device: string): ListsMergeContext => ({
  mineDevice: device,
  theirsDevice: () => 'OTHER-PC',
  when: () => '10 Mar 09:00',
  touched: () => null,
  isTaken: () => false,
});
const list = (id: string, body: string): string =>
  `---\nflint: 1\nid: ${id}\nmode: tasks\n---\n${body}`;
const space = (lists: [string, string][]): SpaceArchive => ({
  lists: new Map(lists),
  meta: new Map([['space.json', '{"flint":1,"id":"s-home1","name":"Home"}']]),
});
const groceries = list('gro1', '- [ ] Eggs [id:: eg01]\n- [ ] Milk [id:: mi01]\n');

describe('merging a space (SPACE-02, D-190)', () => {
  it('Alex and Sam change different tasks of one list at once (and Sam’s write lands in Drive’s gap): both kept', async () => {
    const cloud = new FakeSpaceStore();
    const alex = cloud.as('alex@example.com');
    const start = writeSpaceArchive(space([['Groceries', groceries]]), codec);
    const { id } = await alex.create('Home.flintspace', 'application/vnd.flintnotes.space', start);
    await alex.share([id], 'sam@example.com');
    const samVersion = writeSpaceArchive(
      space([
        [
          'Groceries',
          list(
            'gro1',
            '- [x] Eggs [completion:: 2026-03-10T09:00] [id:: eg01]\n- [ ] Milk [id:: mi01]\n',
          ),
        ],
      ]),
      codec,
    );
    // Sam's write slips in between Alex's check and Alex's write.
    cloud.beforeWrite = () => {
      cloud.beforeWrite = null;
      cloud.writeNow(id, samVersion);
    };
    const alexVersion = writeSpaceArchive(
      space([['Groceries', list('gro1', '- [ ] Eggs [id:: eg01]\n- [ ] Milk, oat [id:: mi01]\n')]]),
      codec,
    );
    await writeSafely(alex, id, start, alexVersion, spaceMerge3(codec, context('ALEX-PC')));
    const final = readSpaceArchive(cloud.content(id) ?? new Uint8Array(), codec);
    expect(final.lists.get('Groceries')).toBe(
      list(
        'gro1',
        '- [x] Eggs [completion:: 2026-03-10T09:00] [id:: eg01]\n- [ ] Milk, oat [id:: mi01]\n',
      ),
    );
  });

  it('a list one side deleted and the other left alone is gone; deleted on one side and edited on the other, it stays', () => {
    const base = new Map([
      ['Groceries', groceries],
      ['Repairs', list('rep1', '- [ ] Fix the tap [id:: ft01]\n')],
    ]);
    const mine = new Map([['Repairs', list('rep1', '- [ ] Fix the tap [id:: ft01]\n')]]);
    const theirs = new Map([['Groceries', groceries]]);
    const gone = mergeSpaceLists(base, mine, theirs, context('ALEX-PC'));
    expect([...gone.lists.keys()]).toEqual([]);
    expect([...gone.deleted].sort()).toEqual(['gro1', 'rep1']);
    const edited = new Map([
      [
        'Groceries',
        list('gro1', '- [ ] Eggs [id:: eg01]\n- [ ] Milk [id:: mi01]\n- [ ] Tea [id:: te01]\n'),
      ],
    ]);
    const kept = mergeSpaceLists(base, mine, edited, context('ALEX-PC'));
    expect(kept.lists.get('Groceries')).toContain('Tea');
  });

  it('a rename on one side is taken; two new lists of one name are told apart the same way on both sides', () => {
    const base = new Map([['Groceries', groceries]]);
    const renamed = mergeSpaceLists(
      base,
      base,
      new Map([['Shopping', groceries]]),
      context('ALEX-PC'),
    );
    expect([...renamed.lists.keys()]).toEqual(['Shopping']);
    const mine = new Map([...base, ['Trip', list('trA1', '- [ ] Book [id:: bk01]\n')]]);
    const theirs = new Map([...base, ['Trip', list('trB1', '- [ ] Pack [id:: pk01]\n')]]);
    const onAlex = mergeSpaceLists(base, mine, theirs, context('ALEX-PC'));
    const onSam = mergeSpaceLists(base, theirs, mine, context('SAM-PC'));
    expect([...onAlex.lists.keys()].sort()).toEqual(['Groceries', 'Trip', 'Trip 2']);
    expect(onAlex.lists.get('Trip')).toBe(onSam.lists.get('Trip'));
    expect(onAlex.lists.get('Trip 2')).toBe(onSam.lists.get('Trip 2'));
  });
});

describe('merging a space, fuzzed (SPACE-02, D-190 Q9)', () => {
  it('members adding tasks and lists at once, writes slipping into the gap: every task anyone added is kept', async () => {
    const { default: fc } = await import('fast-check');
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            who: fc.constantFrom('alex@example.com', 'sam@example.com', 'nino@example.com'),
            where: fc.constantFrom('Groceries', 'Trip', 'Repairs'),
            race: fc.boolean(),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        async (plan) => {
          const cloud = new FakeSpaceStore();
          const owner = cloud.as('alex@example.com');
          const ids: Record<string, string> = { Groceries: 'gro1', Trip: 'trp1', Repairs: 'rep1' };
          const start = writeSpaceArchive(space([['Groceries', groceries]]), codec);
          const { id } = await owner.create(
            'Home.flintspace',
            'application/vnd.flintnotes.space',
            start,
          );
          await owner.share([id], 'sam@example.com');
          await owner.share([id], 'nino@example.com');
          const added = new Set(['eg01', 'mi01']);
          let n = 0;
          /** A member's version: what they last read, plus one task in `where`. */
          const withTask = (archive: SpaceArchive, where: string, task: string): Uint8Array => {
            const lists = new Map(archive.lists);
            const listId = ids[where] ?? 'x';
            const current = lists.get(where) ?? list(listId, '');
            lists.set(where, `${current}- [ ] Task ${task} [id:: ${task}]\n`);
            return writeSpaceArchive({ lists, meta: archive.meta }, codec);
          };
          for (const step of plan) {
            const store = cloud.as(step.who);
            const before = (await store.read(id)).content;
            const task = `t${n++}`;
            added.add(task);
            if (step.race)
              cloud.beforeWrite = () => {
                cloud.beforeWrite = null;
                const stale = readSpaceArchive(cloud.content(id) ?? start, codec);
                const racer = `r${n++}`;
                added.add(racer);
                cloud.writeNow(id, withTask(stale, 'Groceries', racer));
              };
            await writeSafely(
              store,
              id,
              before,
              withTask(readSpaceArchive(before, codec), step.where, task),
              spaceMerge3(codec, context(step.who)),
            );
            cloud.beforeWrite = null;
          }
          const final = readSpaceArchive(cloud.content(id) ?? start, codec);
          const text = [...final.lists.values()].join('\n');
          for (const task of added) expect(text).toContain(`[id:: ${task}]`);
        },
      ),
      { numRuns: Math.max(100, Math.ceil(Number(process.env.FLINT_FUZZ_RUNS ?? 2000) / 10)) },
    );
  }, 120_000);
});
