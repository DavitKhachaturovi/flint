/* eslint-disable @typescript-eslint/require-await -- an in-memory PC answers at once. */
/**
 * The sync engine against the fake Drive (SYNC-01, D-161): two simulated PCs editing the same list
 * and note, offline edits, deletes, stopping with and without removal from Drive, linked files,
 * groups, a full Drive and a trashed folder.
 */
import { describe, expect, it } from 'vitest';
import { FakeDrive } from './fake-drive.js';
import { SyncEngine } from './engine.js';
import { conflictTime } from './conflict.js';
import { emptyState, type SyncMode } from './state.js';
import type { BaseStore, LocalGroup, LocalItem, LocalSide, TaskTimes } from './drive.js';

class Pc implements LocalSide {
  readonly device: string;
  readonly lists = new Map<string, { name: string; text: string }>();
  groupList: LocalGroup[] = [];
  readonly trash: string[] = [];
  readonly trashedTasks: string[] = [];
  readonly attachments = new Map<string, Uint8Array>();
  readonly linked = new Map<string, number>();
  readonly times = new Map<string, Map<string, TaskTimes>>();
  readonly bases = new Map<string, string>();
  clock = Date.UTC(2026, 2, 10, 9, 0);
  readonly engine: SyncEngine;

  constructor(device: string, drive: FakeDrive, mode: SyncMode = 'everything') {
    this.device = device;
    const state = emptyState();
    state.mode = mode;
    const bases: BaseStore = {
      get: async (id) => this.bases.get(id) ?? null,
      set: async (id, text) => void this.bases.set(id, text),
      delete: async (id) => void this.bases.delete(id),
    };
    this.engine = new SyncEngine({
      drive: drive.as(),
      local: this,
      bases,
      state,
      folderName: 'Flint',
    });
  }

  sync() {
    return this.engine.run();
  }

  add(id: string, name: string, text: string): void {
    this.lists.set(id, { name, text });
  }

  text(id: string): string | undefined {
    return this.lists.get(id)?.text;
  }

  edit(id: string, change: (text: string) => string): void {
    const list = this.lists.get(id);
    if (list) list.text = change(list.text);
  }

  now(): number {
    return this.clock;
  }

  async items(): Promise<LocalItem[]> {
    return [...this.lists].map(([listId, list]) => ({
      listId,
      name: list.name,
      group: this.groupList.find((group) => group.lists.includes(listId))?.id ?? null,
      skip: list.text.trim() === '',
    }));
  }

  async read(id: string) {
    return this.lists.get(id)?.text ?? null;
  }

  private free(name: string, id: string): string {
    const taken = (candidate: string) =>
      [...this.lists].some(
        ([other, list]) => other !== id && list.name.toLowerCase() === candidate.toLowerCase(),
      );
    if (!taken(name)) return name;
    for (let number = 2; ; number++) if (!taken(`${name} ${number}`)) return `${name} ${number}`;
  }

  async write(id: string, text: string, name: string) {
    const known = this.lists.get(id);
    const used = known ? known.name : this.free(name, id);
    this.lists.set(id, { name: used, text });
    return used;
  }

  async rename(id: string, name: string) {
    const list = this.lists.get(id);
    const used = this.free(name, id);
    if (list) list.name = used;
    return used;
  }

  async trashList(id: string) {
    this.trash.push(id);
    this.lists.delete(id);
  }

  async trashTask(_id: string, block: string) {
    this.trashedTasks.push(block);
  }

  async groups() {
    return this.groupList;
  }

  async applyGroups(groups: readonly LocalGroup[], removed: readonly string[]) {
    this.groupList = this.groupList.filter((group) => !removed.includes(group.id));
    for (const group of groups) {
      const lists = group.lists.filter((id) => this.lists.has(id));
      const index = this.groupList.findIndex((entry) => entry.id === group.id);
      const next = { id: group.id, name: group.name, lists };
      if (index >= 0) this.groupList[index] = next;
      else this.groupList.push(next);
    }
  }

  async taskTimes(id: string) {
    return this.times.get(id) ?? new Map();
  }

  async applyTaskTimes(id: string, times: ReadonlyMap<string, TaskTimes>) {
    this.times.set(id, new Map(times));
  }

  async renamedTasks() {}

  async readAttachment(name: string) {
    return this.attachments.get(name) ?? null;
  }

  async attachmentSize(name: string) {
    return this.attachments.get(name)?.length ?? null;
  }

  async writeAttachment(name: string, content: Uint8Array) {
    this.attachments.set(name, content);
  }

  async linkedFileSize(target: string) {
    return this.linked.get(target) ?? null;
  }
}

const head = (id: string, mode = 'tasks') => `---\nflint: 1\nid: ${id}\nmode: ${mode}\n---\n`;
const groceries = head('groc') + '- [ ] Oat milk [id:: aaaaaa]\n- [ ] Dry cleaning [id:: bbbbbb]\n';
const trip =
  head('trip', 'note') + '# Kazbegi weekend\n\nLeave Friday after work.\n\nWhere to stay\n';

async function twoPcs(mode: SyncMode = 'everything') {
  const drive = new FakeDrive();
  const laptop = new Pc('DAVIT-LAPTOP', drive, mode);
  const work = new Pc('WORK-PC', drive, mode);
  laptop.add('groc', 'Groceries', groceries);
  laptop.add('trip', 'Trip ideas', trip);
  expect((await laptop.sync()).status).toBe('synced');
  expect((await work.sync()).status).toBe('synced');
  return { drive, laptop, work };
}

describe('SyncEngine (SYNC-01, D-161)', () => {
  it('uploads, then brings everything to the second PC', async () => {
    const { drive, work } = await twoPcs();
    expect(drive.contents()).toEqual(
      new Map([
        ['Groceries', groceries],
        ['Trip ideas', trip],
      ]),
    );
    expect(work.text('groc')).toBe(groceries);
    expect(work.lists.get('trip')?.name).toBe('Trip ideas');
  });

  it('an idle run only lists the folder', async () => {
    const { drive, laptop } = await twoPcs();
    drive.calls.length = 0;
    await laptop.sync();
    expect(drive.calls).toEqual(['folder', 'list']);
  });

  it('two PCs editing the same list and note merge', async () => {
    const { drive, laptop, work } = await twoPcs();
    laptop.edit('groc', (text) => text.replace('Oat milk', 'Oat milk, eggs'));
    work.edit('groc', (text) => text + '- [ ] Light bulbs [id:: cccccc]\n');
    laptop.edit('trip', (text) => text.replace('Leave Friday after work.', 'Leave Friday at six.'));
    work.edit('trip', (text) =>
      text.replace('Leave Friday after work.', 'Leave Saturday morning.'),
    );
    await laptop.sync();
    drive.clock += 60_000;
    const report = await work.sync();
    await laptop.sync();
    const expected =
      head('groc') +
      '- [ ] Oat milk, eggs [id:: aaaaaa]\n- [ ] Dry cleaning [id:: bbbbbb]\n- [ ] Light bulbs [id:: cccccc]\n';
    expect(work.text('groc')).toBe(expected);
    expect(laptop.text('groc')).toBe(expected);
    expect(report.conflicts.get('trip')).toBe(1);
    expect(work.text('trip')).toContain(
      `Leave Saturday morning.\n> [!conflict] Also changed on DAVIT-LAPTOP, ${conflictTime(new Date(Date.UTC(2026, 2, 10, 9, 0)))} (the 1 line above is WORK-PC's)\n> Leave Friday at six.\n`,
    );
    expect(laptop.text('trip')).toBe(work.text('trip'));
  });

  it('offline edits sync when back', async () => {
    const { drive, laptop, work } = await twoPcs();
    drive.offline = true;
    laptop.edit('groc', (text) => text.replace('Dry cleaning', 'Dry cleaning, Sat'));
    expect((await laptop.sync()).status).toBe('offline');
    work.edit('groc', (text) => text.replace('Oat milk', 'Oat milk (2)'));
    expect((await work.sync()).status).toBe('offline');
    drive.offline = false;
    await laptop.sync();
    await work.sync();
    await laptop.sync();
    expect(laptop.text('groc')).toContain('Oat milk (2)');
    expect(laptop.text('groc')).toContain('Dry cleaning, Sat');
    expect(work.text('groc')).toBe(laptop.text('groc'));
  });

  it('a deleted list goes to Trash on the other PC; edited there, it stays', async () => {
    const { drive, laptop, work } = await twoPcs();
    laptop.lists.delete('groc');
    await laptop.sync();
    expect(drive.contents().has('Groceries')).toBe(false);
    await work.sync();
    expect(work.trash).toEqual(['groc']);
    expect(work.lists.has('groc')).toBe(false);

    laptop.lists.delete('trip');
    work.edit('trip', (text) => text + 'Book the guesthouse.\n');
    await laptop.sync();
    await work.sync();
    expect(work.text('trip')).toContain('Book the guesthouse.');
    expect(drive.contents().get('Trip ideas')).toContain('Book the guesthouse.');
  });

  it("a deleted task goes to the other PC's Trash", async () => {
    const { laptop, work } = await twoPcs();
    laptop.edit('groc', (text) => text.replace('- [ ] Dry cleaning [id:: bbbbbb]\n', ''));
    await laptop.sync();
    await work.sync();
    expect(work.text('groc')).not.toContain('Dry cleaning');
    expect(work.trashedTasks).toEqual(['- [ ] Dry cleaning [id:: bbbbbb]']);
  });

  it('stop syncing on this PC only: kept here, not downloaded again, others keep syncing', async () => {
    const { drive, laptop, work } = await twoPcs();
    work.engine.stop(['groc'], false, () => []);
    await work.sync();
    laptop.edit('groc', (text) => text.replace('Oat milk', 'Oat milk, eggs'));
    await laptop.sync();
    await work.sync();
    expect(work.text('groc')).toBe(groceries);
    expect(drive.contents().get('Groceries')).toContain('Oat milk, eggs');
  });

  it('also remove from Drive: every PC keeps its copy, stops, and says so', async () => {
    const { drive, laptop, work } = await twoPcs();
    work.engine.stop(['groc'], true, () => []);
    await work.sync();
    expect(drive.contents().has('Groceries')).toBe(false);
    await laptop.sync();
    expect(laptop.text('groc')).toBe(groceries);
    expect(laptop.engine.state.notices).toEqual(['groc']);
    expect(laptop.trash).toEqual([]);
    laptop.edit('groc', (text) => text + '- [ ] Eggs [id:: dddddd]\n');
    await laptop.sync();
    expect(drive.contents().has('Groceries')).toBe(false);
  });

  it('removed in Drive itself counts as unsynced, never as deleted', async () => {
    const { drive, laptop } = await twoPcs();
    drive.trashInDrive('Groceries');
    await laptop.sync();
    expect(laptop.text('groc')).toBe(groceries);
    expect(laptop.engine.state.notices).toEqual(['groc']);
  });

  it('only what I choose: nothing goes up or comes down until chosen (Q1)', async () => {
    const drive = new FakeDrive();
    const laptop = new Pc('DAVIT-LAPTOP', drive, 'everything');
    laptop.add('groc', 'Groceries', groceries);
    laptop.add('trip', 'Trip ideas', trip);
    await laptop.sync();
    const work = new Pc('WORK-PC', drive, 'chosen');
    work.add('backend', 'Backend', head('backend') + '- [ ] Fix the gateway [id:: kkkkkk]\n');
    const report = await work.sync();
    expect(work.lists.has('groc')).toBe(false);
    expect(drive.contents().has('Backend')).toBe(false);
    expect(report.remoteOnly.map((item) => item.name).sort()).toEqual(['Groceries', 'Trip ideas']);
    work.engine.start(['trip']);
    await work.sync();
    expect(work.text('trip')).toBe(trip);
    expect(work.lists.has('groc')).toBe(false);
  });

  it('a first meeting: one Inbox, a same-name list renamed (Q2)', async () => {
    const drive = new FakeDrive();
    const laptop = new Pc('DAVIT-LAPTOP', drive);
    laptop.add('inbox', 'Inbox', head('inbox') + '- [ ] Call the bank [id:: xxxxxx]\n');
    laptop.add('groc', 'Groceries', groceries);
    await laptop.sync();
    const work = new Pc('WORK-PC', drive);
    work.add('inbox', 'Inbox', head('inbox') + '- [ ] Buy stamps [id:: xxxxxx]\n');
    work.add('other', 'Groceries', head('other') + '- [ ] Printer paper [id:: pppppp]\n');
    await work.sync();
    const inbox = work.text('inbox') ?? '';
    // The incoming task (the laptop's) gets a new ID; this PC's keeps its own.
    expect(inbox).toContain('Buy stamps [id:: xxxxxx]');
    expect(inbox).toMatch(/Call the bank \[id:: [a-z0-9]{4,6}\]/);
    expect(inbox).not.toContain('Call the bank [id:: xxxxxx]');
    expect(work.lists.get('groc')?.name).toBe('Groceries 2');
    expect(work.lists.get('other')?.name).toBe('Groceries');
    await laptop.sync();
    expect(laptop.text('inbox')).toBe(inbox);
  });

  it('linked files: which PC has them, never in the markdown', async () => {
    const { laptop, work } = await twoPcs();
    laptop.linked.set('file:///D:/Videos/Drone/kazbegi-flight.mp4', 1_932_735_283);
    laptop.edit(
      'trip',
      (text) => text + '\n![kazbegi-flight.mp4](file:///D:/Videos/Drone/kazbegi-flight.mp4)\n',
    );
    await laptop.sync();
    await work.sync();
    expect(work.text('trip')).toContain('file:///D:/Videos/Drone/kazbegi-flight.mp4');
    expect(work.engine.state.linked['trip']).toEqual({
      'file:///D:/Videos/Drone/kazbegi-flight.mp4': { device: 'DAVIT-LAPTOP', size: 1_932_735_283 },
    });
  });

  it('attachments inside the Flint folder travel; a full Drive syncs text first, smallest first', async () => {
    const { drive, laptop, work } = await twoPcs();
    laptop.attachments.set('small.png', new Uint8Array(10));
    laptop.attachments.set('big.mp4', new Uint8Array(5000));
    laptop.edit(
      'trip',
      (text) => text + '\n![](attachments/small.png)\n![](attachments/big.mp4)\n',
    );
    drive.quota = 2000;
    const report = await laptop.sync();
    expect(report.status).toBe('quota');
    expect(report.didNotFit).toEqual([{ name: 'big.mp4', size: 5000 }]);
    expect(drive.contents().get('Trip ideas')).toContain('small.png');
    await work.sync();
    expect(work.attachments.get('small.png')?.length).toBe(10);
    drive.quota = Number.POSITIVE_INFINITY;
    expect((await laptop.sync()).status).toBe('synced');
    await work.sync();
    expect(work.attachments.get('big.mp4')?.length).toBe(5000);
  });

  it('groups carry name and members (Q3)', async () => {
    const { laptop, work } = await twoPcs();
    laptop.groupList = [{ id: 'g-pers', name: 'Personal', lists: ['groc', 'trip'] }];
    await laptop.sync();
    await work.sync();
    expect(work.groupList).toEqual([{ id: 'g-pers', name: 'Personal', lists: ['groc', 'trip'] }]);
    work.groupList = [{ id: 'g-pers', name: 'Home', lists: ['groc'] }];
    await work.sync();
    await laptop.sync();
    expect(laptop.groupList).toEqual([{ id: 'g-pers', name: 'Home', lists: ['groc'] }]);
  });

  it('an unchanged group is not applied again on every run (D-183)', async () => {
    const { laptop, work } = await twoPcs();
    laptop.groupList = [{ id: 'g-pers', name: 'Personal', lists: ['groc', 'trip'] }];
    await laptop.sync();
    await work.sync();
    // Applying it told the workspace something changed, which asked for another run, for ever.
    const applied: string[] = [];
    for (const pc of [laptop, work]) {
      const apply = pc.applyGroups.bind(pc);
      pc.applyGroups = async (groups, removed) => {
        applied.push(...groups.map((group) => group.id), ...removed);
        await apply(groups, removed);
      };
    }
    for (let run = 0; run < 3; run++) {
      await laptop.sync();
      await work.sync();
    }
    expect(applied).toEqual([]);
    // A real change still comes through: renamed on the laptop.
    laptop.groupList = [{ id: 'g-pers', name: 'Home', lists: ['groc', 'trip'] }];
    await laptop.sync();
    await work.sync();
    expect(applied).toEqual(['g-pers']);
    expect(work.groupList).toEqual([{ id: 'g-pers', name: 'Home', lists: ['groc', 'trip'] }]);
  });

  it('a trashed Drive folder pauses sync and never touches local data (Q8)', async () => {
    const { drive, laptop } = await twoPcs();
    drive.trashFolder(laptop.engine.state.folderId as string);
    laptop.edit('groc', (text) => text + '- [ ] Eggs [id:: dddddd]\n');
    const before = new Map([...laptop.lists].map(([id, list]) => [id, list.text]));
    expect((await laptop.sync()).status).toBe('folder-gone');
    expect(new Map([...laptop.lists].map(([id, list]) => [id, list.text]))).toEqual(before);
    drive.restoreFolder(laptop.engine.state.folderId as string);
    expect((await laptop.sync()).status).toBe('synced');
    expect(drive.contents().get('Groceries')).toContain('Eggs');
  });

  it('a renamed or moved Drive folder is found by its ID', async () => {
    const { drive, laptop } = await twoPcs();
    drive.renameFolder(laptop.engine.state.folderId as string, 'Archive › Flint');
    expect((await laptop.sync()).status).toBe('synced');
    expect(laptop.engine.state.folderPath).toBe('My Drive › Archive › Flint');
  });

  it('a revoked sign-in says so and loses nothing', async () => {
    const { drive, laptop } = await twoPcs();
    drive.signedOut = true;
    laptop.edit('groc', (text) => text + '- [ ] Eggs [id:: dddddd]\n');
    expect((await laptop.sync()).status).toBe('auth');
    drive.signedOut = false;
    await laptop.sync();
    expect(drive.contents().get('Groceries')).toContain('Eggs');
  });

  it('a run that has to run again says why, for the log (D-181)', async () => {
    const { drive, work } = await twoPcs();
    await work.sync();
    work.edit('groc', (text) => text + '- [ ] Stamps [id:: ssssss]\n');
    drive.beforeWrite = (file) => {
      drive.beforeWrite = null;
      // Another PC writes the list between this run's read and its write.
      const theirs = `${drive.contents().get('Groceries') ?? ''}- [ ] Tape [id:: tttttt]\n`;
      drive.update(file, new TextEncoder().encode(theirs), { device: 'laptop' });
    };
    const report = await work.sync();
    expect(report.again).toBe(true);
    expect(report.againWhy).toEqual(['groc: changed in Drive (changed)']);
    // The next run merges it and has nothing more to do.
    const next = await work.sync();
    expect(next.again).toBe(false);
    expect(next.againWhy).toEqual([]);
    expect(work.text('groc')).toContain('Tape');
  });

  it('a write racing another PC merges again on the next run', async () => {
    const { drive, laptop, work } = await twoPcs();
    laptop.edit('groc', (text) => text.replace('Oat milk', 'Oat milk, eggs'));
    work.edit('groc', (text) => text.replace('Dry cleaning', 'Dry cleaning, Sat'));
    await work.sync();
    let raced = false;
    work.edit('groc', (text) => text + '- [ ] Stamps [id:: ssssss]\n');
    drive.beforeWrite = () => {
      if (raced) return;
      raced = true;
      drive.beforeWrite = null;
      // The laptop writes between the work PC's read and write.
      void laptop.sync();
    };
    const report = await work.sync();
    drive.beforeWrite = null;
    await laptop.sync();
    if (report.again) await work.sync();
    await laptop.sync();
    await work.sync();
    for (const pc of [laptop, work]) {
      expect(pc.text('groc')).toContain('Oat milk, eggs');
      expect(pc.text('groc')).toContain('Dry cleaning, Sat');
      expect(pc.text('groc')).toContain('Stamps');
    }
  });

  it('task times travel: the newer wins, a future clock is clamped (Q4)', async () => {
    const { drive, laptop, work } = await twoPcs();
    laptop.times.set('groc', new Map([['aaaaaa', { c: 100, t: Date.UTC(2030, 0, 1) }]]));
    laptop.edit('groc', (text) => text.replace('Oat milk', 'Oat milk, eggs'));
    await laptop.sync();
    await work.sync();
    const t = work.times.get('groc')?.get('aaaaaa')?.t ?? 0;
    expect(t).toBeLessThanOrEqual(drive.clock);
  });
});
