import { deflateRawSync, inflateRawSync } from 'node:zlib';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ListsMergeContext } from '../sync/merge.js';
import { FakeSpaceStore } from './fake-store.js';
import { readSpaceArchive, writeSpaceArchive, type SpaceMetaName } from './space-archive.js';
import { spaceRound, type LocalSpace, type SpaceBase } from './space-sync.js';
import type { SpaceStore } from './store.js';
import type { ZipCodec } from './zip.js';

/** SPACE-02 (D-190): a space's sync round between members, each with their own folder. */
const codec: ZipCodec = {
  deflate: (data) => new Uint8Array(deflateRawSync(data)),
  inflate: (data, size) => new Uint8Array(inflateRawSync(data, { maxOutputLength: size })),
};
const list = (id: string, body: string): string =>
  `---\nflint: 1\nid: ${id}\nmode: tasks\n---\n${body}`;
const spaceJson = '{"flint":1,"id":"s-home1","name":"Home"}';

/** A member's folder in memory, with Trash; `editing` simulates an edit during the round. */
class Folder implements LocalSpace {
  readonly files = new Map<string, string>();
  readonly trashed: string[] = [];
  editing: { name: string; text: string } | null = null;

  lists(): Promise<ReadonlyMap<string, string>> {
    return Promise.resolve(new Map(this.files));
  }
  meta(): Promise<ReadonlyMap<SpaceMetaName, string>> {
    return Promise.resolve(new Map([['space.json', spaceJson]]));
  }
  changedSince(name: string, text: string): Promise<boolean> {
    if (this.editing?.name === name) {
      this.files.set(name, this.editing.text);
      this.editing = null;
    }
    return Promise.resolve(this.files.get(name) !== text);
  }
  write(name: string, text: string): Promise<void> {
    this.files.set(name, text);
    return Promise.resolve();
  }
  rename(from: string, to: string): Promise<void> {
    if (this.files.has(to)) throw new Error(`${to} is taken`);
    const text = this.files.get(from);
    this.files.delete(from);
    if (text !== undefined) this.files.set(to, text);
    return Promise.resolve();
  }
  trash(name: string): Promise<void> {
    this.files.delete(name);
    this.trashed.push(name);
    return Promise.resolve();
  }
}

class Base implements SpaceBase {
  content: Uint8Array | null = null;
  read(): Promise<Uint8Array | null> {
    return Promise.resolve(this.content);
  }
  write(content: Uint8Array): Promise<void> {
    this.content = content;
    return Promise.resolve();
  }
}

const context = (device: string): ListsMergeContext => ({
  mineDevice: device,
  theirsDevice: () => 'OTHER-PC',
  when: () => '10 Mar 09:00',
  touched: () => null,
  isTaken: () => false,
});

async function members() {
  const cloud = new FakeSpaceStore();
  const start = list('gro1', '- [ ] Eggs [id:: eg01]\n- [ ] Milk [id:: mi01]\n');
  const owner = cloud.as('alex@example.com');
  const { id } = await owner.create(
    'Home.flintspace',
    'application/vnd.flintnotes.space',
    writeSpaceArchive(
      { lists: new Map([['Groceries', start]]), meta: new Map([['space.json', spaceJson]]) },
      codec,
    ),
  );
  await owner.share([id], 'sam@example.com');
  const make = (address: string, device: string) => {
    const folder = new Folder();
    folder.files.set('Groceries', start);
    // Each starts as in use: the space's file synced once (its base), the list in the folder.
    const base = new Base();
    base.content = cloud.content(id) ?? null;
    const store: SpaceStore = cloud.as(address);
    const round = () =>
      spaceRound({ store, fileId: id, local: folder, base, codec, context: context(device) });
    return { folder, base, round };
  };
  return {
    cloud,
    id,
    alex: make('alex@example.com', 'ALEX-PC'),
    sam: make('sam@example.com', 'SAM-PC'),
  };
}

describe('a space’s sync round (SPACE-02, D-190)', () => {
  it('a task Alex adds reaches Sam; Alex’s pin stays Alex’s, never in the shared file or Sam’s copy', async () => {
    const { cloud, id, alex, sam } = await members();
    alex.folder.files.set(
      'Groceries',
      list(
        'gro1',
        '- [ ] Eggs [pinned:: true] [id:: eg01]\n- [ ] Milk [id:: mi01]\n- [ ] Tea [id:: te01]\n',
      ),
    );
    await alex.round();
    expect(alex.folder.files.get('Groceries')).toContain('Eggs [pinned:: true] [id:: eg01]');
    const shared = readSpaceArchive(cloud.content(id) ?? new Uint8Array(), codec);
    expect(shared.lists.get('Groceries')).not.toContain('pinned');
    await sam.round();
    expect(sam.folder.files.get('Groceries')).toBe(
      list('gro1', '- [ ] Eggs [id:: eg01]\n- [ ] Milk [id:: mi01]\n- [ ] Tea [id:: te01]\n'),
    );
  });

  it('a list Sam deletes goes to Alex’s Trash; a rename comes across', async () => {
    const { alex, sam } = await members();
    sam.folder.files.set('Repairs', list('rep1', '- [ ] Fix the tap [id:: ft01]\n'));
    await sam.round();
    await alex.round();
    expect(alex.folder.files.has('Repairs')).toBe(true);
    // Sam renames Groceries and deletes Repairs.
    const groceries = sam.folder.files.get('Groceries') ?? '';
    sam.folder.files.delete('Groceries');
    sam.folder.files.set('Shopping', groceries);
    sam.folder.files.delete('Repairs');
    await sam.round();
    const report = await alex.round();
    expect(report.trashed).toEqual(['Repairs']);
    expect(alex.folder.trashed).toEqual(['Repairs']);
    expect(report.renamed).toEqual([['Groceries', 'Shopping']]);
    expect([...alex.folder.files.keys()]).toEqual(['Shopping']);
  });

  it('a list edited during the round is never overwritten; the next round merges the edit', async () => {
    const { alex, sam } = await members();
    sam.folder.files.set(
      'Groceries',
      list('gro1', '- [ ] Eggs [id:: eg01]\n- [ ] Milk [id:: mi01]\n- [ ] Bread [id:: br01]\n'),
    );
    await sam.round();
    const typing = list('gro1', '- [ ] Eggs, a dozen [id:: eg01]\n- [ ] Milk [id:: mi01]\n');
    alex.folder.editing = { name: 'Groceries', text: typing };
    const first = await alex.round();
    expect(first.skipped).toEqual(['Groceries']);
    expect(alex.folder.files.get('Groceries')).toBe(typing);
    await alex.round();
    expect(alex.folder.files.get('Groceries')).toBe(
      list(
        'gro1',
        '- [ ] Eggs, a dozen [id:: eg01]\n- [ ] Milk [id:: mi01]\n- [ ] Bread [id:: br01]\n',
      ),
    );
  });
});

describe('a space’s sync rounds, fuzzed (SPACE-02, D-190)', () => {
  type Step =
    | { kind: 'add'; who: number; where: number }
    | { kind: 'done'; who: number }
    | { kind: 'pin'; who: number }
    | { kind: 'list'; who: number }
    | { kind: 'rename'; who: number }
    | { kind: 'round'; who: number; typing: boolean };
  const step: fc.Arbitrary<Step> = fc.oneof(
    fc.record({ kind: fc.constant('add' as const), who: fc.nat(2), where: fc.nat(3) }),
    fc.record({ kind: fc.constant('done' as const), who: fc.nat(2) }),
    fc.record({ kind: fc.constant('pin' as const), who: fc.nat(2) }),
    fc.record({ kind: fc.constant('list' as const), who: fc.nat(2) }),
    fc.record({ kind: fc.constant('rename' as const), who: fc.nat(2) }),
    fc.record({ kind: fc.constant('round' as const), who: fc.nat(2), typing: fc.boolean() }),
  );

  it('after everyone syncs, all members hold the same space; no added task is lost; pins stay each member’s own', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { maxLength: 18 }), async (steps) => {
        const { cloud, id, alex, sam } = await members();
        const nino = (() => {
          const folder = new Folder();
          const base = new Base();
          const store = cloud.as('nino@example.com');
          return {
            folder,
            base,
            round: () =>
              spaceRound({
                store,
                fileId: id,
                local: folder,
                base,
                codec,
                context: context('NINO-PC'),
              }),
          };
        })();
        await cloud.as('alex@example.com').share([id], 'nino@example.com');
        await nino.round();
        const people = [alex, sam, nino];
        const added = new Set(['eg01', 'mi01']);
        const pinned: Set<string>[] = [new Set(), new Set(), new Set()];
        let n = 0;
        for (const s of steps) {
          const who = people[s.who];
          if (!who) continue;
          const files = who.folder.files;
          const names = [...files.keys()].sort();
          if (s.kind === 'add') {
            const name = names[s.where % Math.max(1, names.length)];
            if (!name) continue;
            const task = `t${n++}`;
            added.add(task);
            files.set(name, `${files.get(name) ?? ''}- [ ] Task ${task} [id:: ${task}]\n`);
          } else if (s.kind === 'done') {
            const name = names[0];
            if (!name) continue;
            files.set(name, (files.get(name) ?? '').replace('- [ ] ', '- [x] '));
          } else if (s.kind === 'pin') {
            const name = names[0];
            const text = name ? (files.get(name) ?? '') : '';
            const match = /- \[[ x]\] ([^\n[]+)\[id:: ([a-z0-9]+)\]/.exec(text);
            if (!name || !match || text.includes(`[pinned:: true] [id:: ${match[2]}]`)) continue;
            pinned[s.who]?.add(match[2] ?? '');
            files.set(
              name,
              text.replace(`[id:: ${match[2]}]`, `[pinned:: true] [id:: ${match[2]}]`),
            );
          } else if (s.kind === 'list') {
            const listId = `l${n++}`;
            files.set(`List ${listId}`, list(listId, ''));
          } else if (s.kind === 'rename') {
            const name = names[0];
            if (!name || files.has(`${name} renamed`)) continue;
            const text = files.get(name) ?? '';
            files.delete(name);
            files.set(`${name} renamed`, text);
          } else {
            if (s.typing) {
              const name = names[0];
              if (name) {
                const task = `t${n++}`;
                added.add(task);
                who.folder.editing = {
                  name,
                  text: `${files.get(name) ?? ''}- [ ] Typed ${task} [id:: ${task}]\n`,
                };
              }
            }
            await who.round();
            who.folder.editing = null;
          }
        }
        // Everyone syncs, twice round: then all hold the same space.
        for (let pass = 0; pass < 2; pass++) for (const who of people) await who.round();
        const sharedOf = (folder: Folder): string =>
          [...folder.files.entries()]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([name, text]) => `${name}\n${text.replace(/ \[pinned:: true\]/g, '')}`)
            .join('\n---\n');
        expect(sharedOf(sam.folder)).toBe(sharedOf(alex.folder));
        expect(sharedOf(nino.folder)).toBe(sharedOf(alex.folder));
        const cloudText = [
          ...readSpaceArchive(cloud.content(id) ?? new Uint8Array(), codec).lists.values(),
        ].join('\n');
        expect(cloudText).not.toContain('pinned');
        const everything = [...alex.folder.files.values()].join('\n');
        for (const task of added) expect(everything).toContain(`[id:: ${task}]`);
        people.forEach((person, index) => {
          const text = [...person.folder.files.values()].join('\n');
          for (const task of pinned[index] ?? [])
            if (text.includes(`[id:: ${task}]`))
              expect(text).toContain(`[pinned:: true] [id:: ${task}]`);
        });
      }),
      { numRuns: Math.max(100, Math.ceil(Number(process.env.FLINT_FUZZ_RUNS ?? 2000) / 10)) },
    );
  }, 300_000);
});
