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
  readonly trashedTasks: string[] = [];
  readonly metaFiles = new Map<SpaceMetaName, string>([['space.json', spaceJson]]);
  editing: { name: string; text: string } | null = null;
  /** Throws ("the PC stopped") before the rename after this many. */
  crashAfterRenames: number | null = null;
  /** The PC stops before the local change after this many (any kind). */
  crashAfterOps: number | null = null;
  /** Whether this change is dropped: the PC stopped (now or before). */
  private stopped(): boolean {
    if (this.crashAfterOps !== null) {
      if (this.crashAfterOps === 0) {
        this.crashAfterOps = null;
        this.frozen = true;
        this.onCrash?.();
      } else this.crashAfterOps--;
    }
    return this.frozen;
  }
  /** A bookkeeping edit made during the round (seen from the second `meta()`). */
  metaDuringRound: string | null = null;
  /** After a crash: every change is dropped, as if the process had ended. */
  frozen = false;
  onCrash: (() => void) | null = null;
  private metaReads = 0;

  lists(): Promise<ReadonlyMap<string, string>> {
    return Promise.resolve(new Map(this.files));
  }
  meta(): Promise<ReadonlyMap<SpaceMetaName, string>> {
    this.metaReads++;
    if (this.metaReads === 2 && this.metaDuringRound !== null) {
      this.metaFiles.set('space.json', this.metaDuringRound);
      this.metaDuringRound = null;
    }
    return Promise.resolve(new Map(this.metaFiles));
  }
  changedSince(name: string, text: string): Promise<boolean> {
    if (this.editing?.name === name) {
      this.files.set(name, this.editing.text);
      this.editing = null;
    }
    return Promise.resolve(this.files.get(name) !== text);
  }
  write(name: string, text: string): Promise<void> {
    if (this.stopped()) return Promise.resolve();
    this.files.set(name, text);
    return Promise.resolve();
  }
  /** Windows: names compared without case. */
  private taken(name: string, except?: string): boolean {
    return [...this.files.keys()].some(
      (key) => key !== except && key.toUpperCase() === name.toUpperCase(),
    );
  }
  create(name: string, text: string): Promise<void> {
    if (this.stopped()) return Promise.resolve();
    if (this.taken(name)) return Promise.reject(new Error(`${name} exists`));
    this.files.set(name, text);
    return Promise.resolve();
  }
  rename(from: string, to: string): Promise<void> {
    if (this.crashAfterRenames !== null) {
      if (this.crashAfterRenames === 0) {
        // The PC stops here: nothing after this lands, the base included.
        this.crashAfterRenames = null;
        this.frozen = true;
        this.onCrash?.();
      } else this.crashAfterRenames--;
    }
    if (this.stopped()) return Promise.resolve();
    if (this.taken(to, from)) return Promise.reject(new Error(`${to} is taken`));
    const text = this.files.get(from);
    this.files.delete(from);
    if (text !== undefined) this.files.set(to, text);
    return Promise.resolve();
  }
  trash(name: string): Promise<void> {
    if (this.stopped()) return Promise.resolve();
    this.files.delete(name);
    this.trashed.push(name);
    return Promise.resolve();
  }
  trashTask(_name: string, block: string): Promise<void> {
    this.trashedTasks.push(block);
    return Promise.resolve();
  }
  writeMeta(name: SpaceMetaName, text: string): Promise<void> {
    if (this.stopped()) return Promise.resolve();
    this.metaFiles.set(name, text);
    return Promise.resolve();
  }
}

class Base implements SpaceBase {
  content: Uint8Array | null = null;
  carried: string | null = null;
  frozen = false;
  readState(): Promise<string | null> {
    return Promise.resolve(this.carried);
  }
  writeState(text: string): Promise<void> {
    if (this.frozen) return Promise.resolve();
    this.carried = text;
    return Promise.resolve();
  }
  read(): Promise<Uint8Array | null> {
    return Promise.resolve(this.content);
  }
  write(content: Uint8Array): Promise<void> {
    if (this.frozen) return Promise.resolve();
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

describe('the sync round’s review findings (SPACE-02, D-190)', () => {
  const text = (folder: Folder): string => [...folder.files.values()].join('\n');

  it('H1: two members make a list of one name: both lists live on, nothing is lost or trashed', async () => {
    const { alex, sam } = await members();
    alex.folder.files.set('Shopping', list('aaa1', '- [ ] Alex thing [id:: al01]\n'));
    sam.folder.files.set('Shopping', list('zzz1', '- [ ] Sam thing [id:: sm01]\n'));
    await alex.round();
    for (let n = 0; n < 3; n++) {
      await sam.round();
      await alex.round();
    }
    for (const folder of [alex.folder, sam.folder]) {
      expect(text(folder)).toContain('Alex thing');
      expect(text(folder)).toContain('Sam thing');
      expect(folder.trashed).toEqual([]);
    }
  });

  it('H2, H3: a rename plus a new list of the old name (and typing meanwhile): the renamed list and the typing are kept', async () => {
    const { alex, sam } = await members();
    // Alex renames Groceries to "Groceries old" and starts a fresh Groceries.
    const old = alex.folder.files.get('Groceries') ?? '';
    alex.folder.files.delete('Groceries');
    alex.folder.files.set('Groceries old', old);
    alex.folder.files.set('Groceries', list('gro2', '- [ ] Fresh [id:: fr01]\n'));
    await alex.round();
    // Sam types into Groceries during his round.
    sam.folder.editing = {
      name: 'Groceries',
      text: list(
        'gro1',
        '- [ ] Eggs [id:: eg01]\n- [ ] Milk [id:: mi01]\n- [ ] Typed [id:: ty01]\n',
      ),
    };
    for (let n = 0; n < 3; n++) {
      await sam.round();
      await alex.round();
    }
    for (const folder of [alex.folder, sam.folder]) {
      expect(text(folder)).toContain('Typed');
      expect(text(folder)).toContain('Fresh');
      expect(text(folder)).toContain('Eggs');
      expect(folder.trashed).toEqual([]);
    }
    expect([...sam.folder.files.keys()].sort()).toEqual(['Groceries', 'Groceries old']);
  });

  it('H4: swapping two lists’ names replaces neither; the swap comes across', async () => {
    const { alex, sam } = await members();
    alex.folder.files.set('Repairs', list('rep1', '- [ ] Fix the tap [id:: ft01]\n'));
    await alex.round();
    await sam.round();
    const groceries = alex.folder.files.get('Groceries') ?? '';
    const repairs = alex.folder.files.get('Repairs') ?? '';
    alex.folder.files.set('Groceries', repairs);
    alex.folder.files.set('Repairs', groceries);
    await alex.round();
    const report = await sam.round();
    expect(report.renamed.length).toBeGreaterThan(0);
    expect(sam.folder.files.get('Groceries')).toContain('Fix the tap');
    expect(sam.folder.files.get('Repairs')).toContain('Eggs');
    expect([...sam.folder.files.keys()].some((name) => name.startsWith('~flint-moving'))).toBe(
      false,
    );
  });

  it('H5, M1: two files with one list ID, or a task list with unsaved tasks: the round refuses before uploading', async () => {
    const { cloud, id, alex } = await members();
    const before = cloud.content(id);
    alex.folder.files.set('Groceries copy', alex.folder.files.get('Groceries') ?? '');
    await expect(alex.round()).rejects.toMatchObject({ problem: 'duplicate-id' });
    alex.folder.files.delete('Groceries copy');
    alex.folder.files.set('Notes', list('not1', '- [ ] Call [pinned:: true]\n'));
    await expect(alex.round()).rejects.toMatchObject({ problem: 'unsaved' });
    expect(cloud.content(id)).toEqual(before);
  });

  it('H6: the space renamed by one member stays renamed for everyone', async () => {
    const { alex, sam } = await members();
    alex.folder.metaFiles.set('space.json', '{"flint":1,"id":"s-home1","name":"Our home"}');
    await alex.round();
    await sam.round();
    await sam.round();
    await alex.round();
    expect(sam.folder.metaFiles.get('space.json')).toContain('Our home');
    expect(alex.folder.metaFiles.get('space.json')).toContain('Our home');
  });

  it('M2: a task another member deleted goes to Trash here', async () => {
    const { alex, sam } = await members();
    sam.folder.files.set('Groceries', list('gro1', '- [ ] Eggs [id:: eg01]\n'));
    await sam.round();
    const report = await alex.round();
    expect(report.trashedTasks).toEqual([['Groceries', 'mi01']]);
    expect(alex.folder.trashedTasks).toEqual(['- [ ] Milk [id:: mi01]']);
    expect(alex.folder.files.get('Groceries')).not.toContain('Milk');
  });
});

describe('the sync round’s second review (SPACE-02, D-190)', () => {
  const all = (folder: Folder): string => [...folder.files.values()].join('\n');
  const moving = (folder: Folder): boolean =>
    [...folder.files.keys()].some((name) => name.startsWith('~flint-moving'));
  const settle = async (...people: { round: () => Promise<unknown> }[]) => {
    for (let pass = 0; pass < 3; pass++) for (const who of people) await who.round();
  };

  it('N1: a PC stopping half-way through a swap loses nothing, and no temporary name spreads', async () => {
    const { alex, sam } = await members();
    alex.folder.files.set('Repairs', list('rep1', '- [ ] Fix the tap [id:: ft01]\n'));
    await alex.round();
    await sam.round();
    const groceries = alex.folder.files.get('Groceries') ?? '';
    alex.folder.files.set('Groceries', alex.folder.files.get('Repairs') ?? '');
    alex.folder.files.set('Repairs', groceries);
    await alex.round();
    // Sam's PC stops after setting one aside and moving the other in.
    sam.folder.crashAfterRenames = 2;
    sam.folder.onCrash = () => {
      sam.base.frozen = true;
    };
    await sam.round();
    expect(moving(sam.folder)).toBe(true);
    // Flint starts again.
    sam.folder.frozen = false;
    sam.base.frozen = false;
    await settle(sam, alex);
    for (const folder of [alex.folder, sam.folder]) {
      expect(moving(folder)).toBe(false);
      expect(folder.files.get('Groceries')).toContain('Fix the tap');
      expect(folder.files.get('Repairs')).toContain('Eggs');
      expect(folder.trashed).toEqual([]);
    }
  });

  it('N2: a rename chain waiting on a list being edited leaves no temporary name', async () => {
    const { alex, sam } = await members();
    alex.folder.files.set('B', list('idb1', '- [ ] b [id:: bb01]\n'));
    alex.folder.files.set('C', list('idc1', '- [ ] c [id:: cc01]\n'));
    await alex.round();
    await sam.round();
    // Alex: C → D, B → C, Groceries → B.
    const [g, b, c] = ['Groceries', 'B', 'C'].map((name) => alex.folder.files.get(name) ?? '');
    alex.folder.files.delete('Groceries');
    alex.folder.files.set('D', c ?? '');
    alex.folder.files.set('C', b ?? '');
    alex.folder.files.set('B', g ?? '');
    await alex.round();
    sam.folder.editing = {
      name: 'C',
      text: list('idc1', '- [ ] c [id:: cc01]\n- [ ] typed [id:: ty01]\n'),
    };
    await sam.round();
    expect(moving(sam.folder)).toBe(false);
    await settle(sam, alex);
    for (const folder of [alex.folder, sam.folder]) {
      expect(moving(folder)).toBe(false);
      expect([...folder.files.keys()].sort()).toEqual(['B', 'C', 'D']);
      expect(all(folder)).toContain('typed');
      expect(folder.files.get('D')).toContain('cc01');
    }
  });

  it('N3: the space renamed here during a round stays renamed', async () => {
    const { alex, sam } = await members();
    sam.folder.metaDuringRound = '{"flint":1,"id":"s-home1","name":"Mid round"}';
    await sam.round();
    expect(sam.folder.metaFiles.get('space.json')).toContain('Mid round');
    await settle(sam, alex);
    expect(alex.folder.metaFiles.get('space.json')).toContain('Mid round');
    expect(sam.folder.metaFiles.get('space.json')).toContain('Mid round');
  });

  it('N4: a pinned task another member moves into a list being edited here keeps its pin', async () => {
    const { alex, sam } = await members();
    alex.folder.files.set('Repairs', list('rep1', '- [ ] Fix the tap [id:: ft01]\n'));
    await alex.round();
    await sam.round();
    sam.folder.files.set(
      'Groceries',
      list('gro1', '- [ ] Eggs [pinned:: true] [id:: eg01]\n- [ ] Milk [id:: mi01]\n'),
    );
    // Alex moves Eggs into Repairs.
    alex.folder.files.set('Groceries', list('gro1', '- [ ] Milk [id:: mi01]\n'));
    alex.folder.files.set(
      'Repairs',
      list('rep1', '- [ ] Fix the tap [id:: ft01]\n- [ ] Eggs [id:: eg01]\n'),
    );
    await alex.round();
    sam.folder.editing = {
      name: 'Repairs',
      text: list('rep1', '- [ ] Fix the tap [id:: ft01]\n- [ ] Typed [id:: ty01]\n'),
    };
    await sam.round();
    await settle(sam, alex);
    expect(sam.folder.files.get('Repairs')).toContain('Eggs [pinned:: true] [id:: eg01]');
    expect(sam.folder.files.get('Repairs')).toContain('Typed');
    expect(alex.folder.files.get('Repairs')).not.toContain('pinned');
  });

  it('N5: a list ID that isn’t Flint’s form is never used as a name or path', async () => {
    const { listIdOf } = await import('./space-merge.js');
    expect(listIdOf('Evil', list('a\\..\\..\\Desktop\\x', ''))).toBe('file:Evil');
    expect(listIdOf('Fine', list('gro1', ''))).toBe('gro1');
  });

  it('N6: a rename that only changes case comes across (Windows sees one name)', async () => {
    const { alex, sam } = await members();
    const text = alex.folder.files.get('Groceries') ?? '';
    alex.folder.files.delete('Groceries');
    alex.folder.files.set('groceries', text);
    await alex.round();
    await sam.round();
    expect([...sam.folder.files.keys()]).toEqual(['groceries']);
  });

  it('N7: a note’s checkbox without an ID, ticked by another member, isn’t put in Trash', async () => {
    const { alex, sam } = await members();
    const note = (box: string) =>
      `---\nflint: 1\nid: not1\nmode: note\n---\n- [${box}] Call the bank\n`;
    alex.folder.files.set('Plans', note(' '));
    await alex.round();
    await sam.round();
    alex.folder.files.set('Plans', note('x'));
    await alex.round();
    const report = await sam.round();
    expect(report.trashedTasks).toEqual([]);
    expect(sam.folder.files.get('Plans')).toBe(note('x'));
  });
});

describe('the sync round’s third review (SPACE-02, D-190)', () => {
  it('R1: a pin cleared while a round left the list alone stays cleared', async () => {
    const { alex } = await members();
    alex.folder.files.set(
      'Groceries',
      list('gro1', '- [ ] Eggs [pinned:: true] [id:: eg01]\n- [ ] Milk [id:: mi01]\n'),
    );
    await alex.round();
    // Alex unpins Eggs during the next round (the list is left for the round after).
    alex.folder.editing = {
      name: 'Groceries',
      text: list('gro1', '- [ ] Eggs [id:: eg01]\n- [ ] Milk [id:: mi01]\n'),
    };
    await alex.round();
    await alex.round();
    await alex.round();
    expect(alex.folder.files.get('Groceries')).toBe(
      list('gro1', '- [ ] Eggs [id:: eg01]\n- [ ] Milk [id:: mi01]\n'),
    );
  });

  it('R3: a list named like a temporary name never makes others undo renames', async () => {
    const { alex, sam } = await members();
    alex.folder.files.set('~flint-moving Notes', list('not1', '- [ ] x [id:: xx01]\n'));
    await alex.round();
    await sam.round();
    // Sam renames Groceries; it stays renamed for both.
    const text = sam.folder.files.get('Groceries') ?? '';
    sam.folder.files.delete('Groceries');
    sam.folder.files.set('Food', text);
    for (let n = 0; n < 2; n++) {
      await sam.round();
      await alex.round();
    }
    for (const folder of [alex.folder, sam.folder])
      expect([...folder.files.keys()].sort()).toEqual(['Food', 'Notes']);
  });
});

describe('a space’s sync rounds, fuzzed (SPACE-02, D-190)', () => {
  type Step =
    | { kind: 'add'; who: number; where: number }
    | { kind: 'done'; who: number }
    | { kind: 'pin'; who: number }
    | { kind: 'unpin'; who: number }
    | { kind: 'list'; who: number }
    | { kind: 'rename'; who: number }
    | { kind: 'same'; who: number }
    | { kind: 'swap'; who: number }
    | { kind: 'delete'; who: number }
    | { kind: 'meta'; who: number }
    | { kind: 'move'; who: number }
    | { kind: 'crash'; who: number; after: number }
    | { kind: 'round'; who: number; typing: boolean };
  const step: fc.Arbitrary<Step> = fc.oneof(
    fc.record({ kind: fc.constant('add' as const), who: fc.nat(2), where: fc.nat(3) }),
    fc.record({ kind: fc.constant('done' as const), who: fc.nat(2) }),
    fc.record({ kind: fc.constant('pin' as const), who: fc.nat(2) }),
    fc.record({ kind: fc.constant('unpin' as const), who: fc.nat(2) }),
    fc.record({ kind: fc.constant('list' as const), who: fc.nat(2) }),
    fc.record({ kind: fc.constant('rename' as const), who: fc.nat(2) }),
    fc.record({ kind: fc.constant('same' as const), who: fc.nat(2) }),
    fc.record({ kind: fc.constant('swap' as const), who: fc.nat(2) }),
    fc.record({ kind: fc.constant('delete' as const), who: fc.nat(2) }),
    fc.record({ kind: fc.constant('meta' as const), who: fc.nat(2) }),
    fc.record({ kind: fc.constant('move' as const), who: fc.nat(2) }),
    fc.record({ kind: fc.constant('crash' as const), who: fc.nat(2), after: fc.nat(4) }),
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
        /** Lists someone deleted (their tasks may rightly be gone): by list ID. */
        const deletedLists = new Set<string>();
        /** Tasks that were in a file someone deleted. */
        const excused = new Set<string>();
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
          } else if (s.kind === 'unpin') {
            const name = names.find((each) => (files.get(each) ?? '').includes('[pinned:: true]'));
            if (!name) continue;
            const text = files.get(name) ?? '';
            const match = /\[pinned:: true\] \[id:: ([a-z0-9]+)\]/.exec(text);
            if (!match) continue;
            pinned[s.who]?.delete(match[1] ?? '');
            files.set(name, text.replace(match[0], `[id:: ${match[1]}]`));
          } else if (s.kind === 'list') {
            const listId = `l${n++}`;
            files.set(`List ${listId}`, list(listId, ''));
          } else if (s.kind === 'same') {
            // Lists of one name made on several sides (the merge tells them apart).
            if (files.has('Shared')) continue;
            const listId = `s${n++}`;
            files.set('Shared', list(listId, ''));
          } else if (s.kind === 'swap') {
            const [first, second] = names;
            if (!first || !second) continue;
            const a = files.get(first) ?? '';
            files.set(first, files.get(second) ?? '');
            files.set(second, a);
          } else if (s.kind === 'delete') {
            const name = names[0];
            if (!name) continue;
            const listId = /\nid: ([^\n]+)\n/.exec(files.get(name) ?? '')?.[1];
            if (listId) deletedLists.add(listId);
            for (const match of (files.get(name) ?? '').matchAll(/\[id:: ([a-z0-9]+)\]/g))
              excused.add(match[1] ?? '');
            // The member's own pins went with the file they deleted.
            for (const match of (files.get(name) ?? '').matchAll(/\[id:: ([a-z0-9]+)\]/g))
              pinned[s.who]?.delete(match[1] ?? '');
            files.delete(name);
          } else if (s.kind === 'move') {
            // The first task of the first list moved to the end of the second.
            const [from, to] = names;
            if (!from || !to) continue;
            const source = files.get(from) ?? '';
            const line = /^- \[[ x]\] [^\n]*\n/m.exec(source)?.[0];
            if (!line) continue;
            files.set(from, source.replace(line, ''));
            files.set(to, `${files.get(to) ?? ''}${line}`);
          } else if (s.kind === 'crash') {
            // The PC stops part-way through applying a round, then Flint starts again.
            who.folder.crashAfterOps = s.after;
            who.folder.onCrash = () => {
              who.base.frozen = true;
            };
            await who.round();
            who.folder.crashAfterOps = null;
            who.folder.frozen = false;
            who.base.frozen = false;
          } else if (s.kind === 'meta') {
            who.folder.metaFiles.set(
              'space.json',
              `{"flint":1,"id":"s-home1","name":"Home ${n++}"}`,
            );
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
        expect(sam.folder.metaFiles).toEqual(alex.folder.metaFiles);
        expect(nino.folder.metaFiles).toEqual(alex.folder.metaFiles);
        // Nothing to Trash, and no temporary name left, unless someone deleted something.
        if (deletedLists.size === 0)
          for (const person of people) expect(person.folder.trashed).toEqual([]);
        for (const person of people)
          expect(
            [...person.folder.files.keys()].some((name) => name.startsWith('~flint-moving')),
          ).toBe(false);
        const cloudText = [
          ...readSpaceArchive(cloud.content(id) ?? new Uint8Array(), codec).lists.values(),
        ].join('\n');
        expect(cloudText).not.toContain('pinned');
        const everything = [...alex.folder.files.values()].join('\n');
        // Every task anyone added is here, unless it was in a list someone deleted.
        const trashedText = people.flatMap((person) => person.folder.trashedTasks).join('\n');
        for (const task of added)
          if (!excused.has(task)) expect(everything).toContain(`[id:: ${task}]`);
        if (deletedLists.size === 0) expect(trashedText).toBe('');
        // Pins stay their member's own. (A list someone deleted goes to a member's Trash with that
        // member's pins in it, restorable there, even if another's edit brings the list back.)
        people.forEach((person, index) => {
          const text = [...person.folder.files.values()].join('\n');
          // Any pin here is one this member set and didn't clear (never another's, never back).
          for (const match of text.matchAll(/\[pinned:: true\] \[id:: ([a-z0-9]+)\]/g))
            expect(pinned[index]?.has(match[1] ?? '')).toBe(true);
          if (person.folder.trashed.length > 0) return;
          for (const task of pinned[index] ?? [])
            if (text.includes(`[id:: ${task}]`))
              expect(text).toContain(`[pinned:: true] [id:: ${task}]`);
        });
      }),
      { numRuns: Math.max(100, Math.ceil(Number(process.env.FLINT_FUZZ_RUNS ?? 2000) / 10)) },
    );
  }, 300_000);
});
