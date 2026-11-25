import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from '../format/document.js';
import {
  mergeMine,
  mineFields,
  pruneMine,
  readMineFile,
  recordMine,
  writeMineFile,
  type MineFile,
} from './mine-file.js';
import { applyPersonal, splitPersonal } from './personal.js';

/** SPACE-09 (D-190 Q10, Q22; docs/04 §9): `<Space>.flintmine`, your fields across your devices. */
const header = '---\nflint: 1\nid: gro1\nmode: tasks\n---\n';
const space = 's-home1';
const empty: MineFile = { space, tasks: new Map() };
const at = (iso: string): Date => new Date(iso);
const far = at('2099-01-01T00:00:00Z');
const mineOf = (lines: string) => splitPersonal(parseDocument(header + lines)).mine;
const read = (text: string, notAfter = far): MineFile => {
  const result = readMineFile(text, space, notAfter);
  if (result.kind !== 'ok') throw new Error(result.kind);
  return result.file;
};

/**
 * One device's round, in the documented order: record its local state against the file it last
 * applied (`own`), merge that with the provider's copy, prune it, apply the result to its local list.
 * Returns the local list and the merged file (uploaded, and the next round's `own`).
 */
function turn(
  local: string,
  own: MineFile,
  provider: MineFile,
  now: Date,
): { local: string; file: MineFile } {
  const ids = new Set([...local.matchAll(/\[id:: ([a-z0-9]+)\]/g)].map((match) => match[1] ?? ''));
  const { shared, mine } = splitPersonal(parseDocument(local));
  const recorded = recordMine(own, mine, ids, now);
  const merged = pruneMine(mergeMine(recorded, provider), now);
  return { local: serializeDocument(applyPersonal(shared, mineFields(merged))), file: merged };
}

describe('.flintmine (SPACE-09)', () => {
  it('records your fields by task and field, writes canonically and reads back', () => {
    const file = recordMine(
      empty,
      mineOf(
        '- [ ] Eggs [reminder:: 2026-03-10T15:00] [pinned:: true] [id:: eg01]\n' +
          '- [ ] Milk [muted:: true] [reminder:: 2026-03-11] [id:: mi01]\n' +
          '- [ ] Tea [id:: te01]\n',
      ),
      new Set(['eg01', 'mi01', 'te01']),
      at('2026-03-10T09:00:00Z'),
    );
    const text = writeMineFile(file);
    const t = '2026-03-10T09:00:00.000Z';
    expect(JSON.parse(text)).toEqual({
      flint: 1,
      space,
      tasks: {
        eg01: {
          pinned: { value: true, at: t },
          reminder: { value: '2026-03-10T15:00', at: t },
        },
        mi01: { reminder: { value: '2026-03-11', at: t }, muted: { value: true, at: t } },
      },
    });
    expect(read(text)).toEqual(file);
  });

  it('says what a file it can’t use is: a newer Flint’s (never overwritten), another space’s, unreadable', () => {
    expect(readMineFile(JSON.stringify({ flint: 2, space, tasks: {} }), space, far)).toEqual({
      kind: 'newer',
    });
    expect(readMineFile(JSON.stringify({ flint: 1, space: 's-x', tasks: {} }), space, far)).toEqual(
      { kind: 'other-space' },
    );
    expect(readMineFile('not json', space, far)).toEqual({ kind: 'unreadable' });
  });

  it('applied on another device: the same fields; a day alone stays a day (never midnight)', () => {
    const file = recordMine(
      empty,
      mineOf('- [ ] Milk [reminder:: 2026-03-11] [pinned:: true] [id:: mi01]\n'),
      new Set(['mi01']),
      at('2026-03-10T09:00:00Z'),
    );
    const shared = parseDocument(header + '- [ ] Milk [id:: mi01]\n');
    expect(serializeDocument(applyPersonal(shared, mineFields(file)))).toBe(
      header + '- [ ] Milk [reminder:: 2026-03-11] [pinned:: true] [id:: mi01]\n',
    );
  });

  it('two devices change different fields of one task while apart: both changes survive (Q22)', () => {
    // The laptop, offline, pins it; the desktop sets a reminder.
    const laptop = turn(
      header + '- [ ] Eggs [pinned:: true] [id:: eg01]\n',
      empty,
      empty,
      at('2026-03-10T09:00:00Z'),
    );
    const desktop = turn(
      header + '- [ ] Eggs [reminder:: 2026-03-12T08:00] [id:: eg01]\n',
      empty,
      empty,
      at('2026-03-10T10:00:00Z'),
    );
    // Each then merges the other's copy.
    const onLaptop = turn(laptop.local, laptop.file, desktop.file, at('2026-03-10T11:00:00Z'));
    const onDesktop = turn(desktop.local, desktop.file, laptop.file, at('2026-03-10T11:00:00Z'));
    const both = header + '- [ ] Eggs [reminder:: 2026-03-12T08:00] [pinned:: true] [id:: eg01]\n';
    expect(onLaptop.local).toBe(both);
    expect(onDesktop.local).toBe(both);
    expect(writeMineFile(onLaptop.file)).toBe(writeMineFile(onDesktop.file));
  });

  it('a clear travels: unpinned on one device, it is unpinned on the other', () => {
    const pinned = turn(
      header + '- [ ] Eggs [pinned:: true] [id:: eg01]\n',
      empty,
      empty,
      at('2026-03-10T09:00:00Z'),
    );
    const other = turn(
      header + '- [ ] Eggs [id:: eg01]\n',
      empty,
      pinned.file,
      at('2026-03-10T09:30:00Z'),
    );
    expect(other.local).toContain('[pinned:: true]');
    const unpinned = turn(
      header + '- [ ] Eggs [id:: eg01]\n',
      pinned.file,
      pinned.file,
      at('2026-03-10T10:00:00Z'),
    );
    expect(unpinned.file.tasks.get('eg01')?.pinned?.value).toBe(false);
    const after = turn(other.local, other.file, unpinned.file, at('2026-03-10T11:00:00Z'));
    expect(after.local).toBe(header + '- [ ] Eggs [id:: eg01]\n');
  });

  it('a device whose clock is ahead can’t win forever (D-161 Q4): times past the upload count as the upload, and a change comes after the one it replaces', () => {
    const ahead = writeMineFile({
      space,
      tasks: new Map([['eg01', { pinned: { value: true, at: '2027-03-10T09:00:00.000Z' } }]]),
    });
    // Uploaded (or read) at the real time: the future time counts as that.
    const file = read(ahead, at('2026-03-10T09:00:00Z'));
    expect(file.tasks.get('eg01')?.pinned?.at).toBe('2026-03-10T09:00:00.000Z');
    // Unpinned here, even at an earlier clock, comes after the pin and wins.
    const unpinned = recordMine(file, new Map(), new Set(['eg01']), at('2026-03-10T08:00:00Z'));
    expect(unpinned.tasks.get('eg01')?.pinned).toEqual({
      value: false,
      at: '2026-03-10T09:00:00.001Z',
    });
    expect(mergeMine(file, unpinned).tasks.get('eg01')?.pinned?.value).toBe(false);
  });

  it('an entry for a task missing from the space waits, saying since when; 90 days after that it goes', () => {
    const file: MineFile = {
      space,
      tasks: new Map([['wa01', { pinned: { value: true, at: '2025-01-01T09:00:00.000Z' } }]]),
    };
    // A long-standing pin is old, not gone: missing now, it waits.
    const missing = recordMine(file, new Map(), new Set(), at('2026-03-01T09:00:00Z'));
    expect(missing.tasks.get('wa01')).toEqual({
      pinned: { value: true, at: '2025-01-01T09:00:00.000Z' },
      gone: '2026-03-01T09:00:00.000Z',
    });
    const later = (iso: string) =>
      recordMine(missing, new Map(), new Set(), at(iso)).tasks.has('wa01');
    expect(later('2026-05-01T09:00:00Z')).toBe(true);
    expect(later('2026-06-01T09:00:00Z')).toBe(false);
    // Back in the space, it isn't gone any more and keeps its pin.
    const back = recordMine(
      missing,
      mineOf('- [ ] Wait [pinned:: true] [id:: wa01]\n'),
      new Set(['wa01']),
      at('2026-03-02T09:00:00Z'),
    );
    expect(back.tasks.get('wa01')).toEqual({
      pinned: { value: true, at: '2025-01-01T09:00:00.000Z' },
      seen: '2026-03-02T09:00:00.000Z',
    });
  });

  it('through real rounds on two devices: a task gone from the space is dropped 90 days later, not before', () => {
    const list = header + '- [ ] Old [pinned:: true] [id:: ol01]\n';
    let laptop = turn(list, empty, empty, at('2026-01-01T09:00:00Z'));
    let desktop = turn(laptop.local, empty, laptop.file, at('2026-01-01T10:00:00Z'));
    // The task is deleted from the space; both keep syncing every day.
    const without = header;
    let provider = desktop.file;
    let day = Date.parse('2026-01-02T09:00:00Z');
    const has = (): boolean => provider.tasks.has('ol01');
    for (let n = 0; n < 89; n++, day += 86_400_000) {
      laptop = turn(without, laptop.file, provider, new Date(day));
      provider = laptop.file;
      desktop = turn(without, desktop.file, provider, new Date(day + 3_600_000));
      provider = desktop.file;
    }
    expect(has()).toBe(true);
    for (let n = 0; n < 3; n++, day += 86_400_000) {
      laptop = turn(without, laptop.file, provider, new Date(day));
      provider = laptop.file;
      desktop = turn(without, desktop.file, provider, new Date(day + 3_600_000));
      provider = desktop.file;
    }
    expect(has()).toBe(false);
  });

  it('a device whose clock is ahead: its own copy is read with the upload time too, so a later unpin elsewhere wins', () => {
    // The laptop's clock reads 2027; the copy it uploaded got the provider's time, 2026-03-10.
    const ahead = turn(
      header + '- [ ] Eggs [pinned:: true] [id:: eg01]\n',
      empty,
      empty,
      at('2027-03-10T09:00:00Z'),
    );
    const uploaded = at('2026-03-10T09:00:00Z');
    const laptopOwn = read(writeMineFile(ahead.file), uploaded);
    // The desktop unpins at the real time, after the upload.
    const desktopFirst = turn(ahead.local, empty, laptopOwn, at('2026-03-10T09:30:00Z'));
    const desktop = turn(
      header + '- [ ] Eggs [id:: eg01]\n',
      desktopFirst.file,
      laptopOwn,
      at('2026-03-10T10:00:00Z'),
    );
    const provider = read(writeMineFile(desktop.file), at('2026-03-10T10:00:01Z'));
    // Back on the laptop (its clock still ahead), the unpin wins.
    const laptop = turn(ahead.local, laptopOwn, provider, at('2027-03-10T10:00:00Z'));
    expect(laptop.local).toBe(header + '- [ ] Eggs [id:: eg01]\n');
  });

  it('reads tolerantly: malformed fields, times and IDs are left out, the rest kept', () => {
    const ok = { value: true, at: '2026-03-10T09:00:00Z' };
    const text = JSON.stringify({
      flint: 1,
      space,
      tasks: {
        ok01: { pinned: ok, muted: { value: 'yes', at: '2026-03-10T09:00:00Z' } },
        bad1: { pinned: { value: true, at: '1' } },
        bad2: { reminder: { value: 'tomorrow', at: '2026-03-10T09:00:00Z' } },
        bad3: { pinned: { value: true, at: '2026-03-10T09:00:00' } },
        'no/slash': { pinned: ok },
      },
    });
    const file = read(text);
    expect([...file.tasks.keys()]).toEqual(['ok01']);
    expect(file.tasks.get('ok01')).toEqual({ pinned: ok });
  });

  it('a task ID like `__proto__` is an ordinary entry', () => {
    const file: MineFile = {
      space,
      tasks: new Map([['__proto__', { pinned: { value: true, at: '2026-03-10T09:00:00.000Z' } }]]),
    };
    expect(read(writeMineFile(file)).tasks.get('__proto__')?.pinned?.value).toBe(true);
  });

  it('a reminder with seconds keeps them', () => {
    const file = recordMine(
      empty,
      mineOf('- [ ] Call [reminder:: 2026-03-11T09:00:30] [id:: ca01]\n'),
      new Set(['ca01']),
      at('2026-03-10T09:00:00Z'),
    );
    expect(file.tasks.get('ca01')?.reminder?.value).toBe('2026-03-11T09:00:30');
  });
});

describe('.flintmine merge, fuzzed (SPACE-09)', () => {
  const time = fc.constantFrom(
    '2026-03-10T09:00:00.000Z',
    '2026-03-10T09:00:00.000Z',
    '2026-03-10T10:00:00.000Z',
    '2026-03-11T08:30:00.000Z',
  );
  const entry = fc.record(
    {
      pinned: fc.record({ value: fc.boolean(), at: time }),
      reminder: fc.record({
        value: fc.constantFrom(null, '2026-03-10T15:00', '2026-03-11'),
        at: time,
      }),
      muted: fc.record({ value: fc.boolean(), at: time }),
      gone: time,
      seen: time,
    },
    { requiredKeys: [] },
  );
  const file = fc
    .array(fc.tuple(fc.constantFrom('aa01', 'bb02', 'cc03', 'dd04'), entry), { maxLength: 6 })
    .map((pairs): MineFile => ({ space, tasks: new Map(pairs) }));
  it('the same on every device: commutative, associative, idempotent', () => {
    fc.assert(
      fc.property(file, file, file, (a, b, c) => {
        const text = (x: MineFile): string => writeMineFile(x);
        expect(text(mergeMine(a, b))).toBe(text(mergeMine(b, a)));
        expect(text(mergeMine(mergeMine(a, b), c))).toBe(text(mergeMine(a, mergeMine(b, c))));
        expect(text(mergeMine(a, a))).toBe(text(a));
      }),
      { numRuns: 2000 },
    );
  });
});

const DEVICE_RUNS = Math.max(200, Math.ceil(Number(process.env.FLINT_FUZZ_RUNS ?? 2000) / 5));

describe('.flintmine across devices, fuzzed (SPACE-09, Q22)', () => {
  type Field = 'pinned' | 'muted' | 'reminder';
  const step = fc.record({
    device: fc.constantFrom(0, 1),
    task: fc.constantFrom('aa01', 'bb02'),
    field: fc.constantFrom<Field>('pinned', 'muted', 'reminder'),
    on: fc.boolean(),
    sync: fc.boolean(),
  });
  const tasks = ['aa01', 'bb02'];
  /** A list with each task's fields as given. */
  const listOf = (state: Record<string, Record<Field, boolean>>): string =>
    header +
    tasks
      .map((id) => {
        const f = state[id] ?? { pinned: false, muted: false, reminder: false };
        const parts = [
          f.reminder ? '[reminder:: 2026-03-12T08:00]' : '',
          f.muted ? '[muted:: true]' : '',
          f.pinned ? '[pinned:: true]' : '',
        ].filter((part) => part !== '');
        return `- [ ] Task ${id} ${[...parts, `[id:: ${id}]`].join(' ')}\n`;
      })
      .join('');
  const stateOf = (text: string): Record<string, Record<Field, boolean>> => {
    const mine = splitPersonal(parseDocument(text)).mine;
    return Object.fromEntries(
      tasks.map((id) => {
        const f = mine.get(id);
        return [
          id,
          {
            pinned: f?.pinned !== undefined,
            muted: f?.muted !== undefined,
            reminder: f?.reminder !== undefined,
          },
        ];
      }),
    );
  };

  it(
    'after both exchange, both devices have the same list, each field at its latest change',
    () => {
      fc.assert(
        fc.property(fc.array(step, { maxLength: 25 }), (steps) => {
          let clock = Date.parse('2026-03-10T09:00:00Z');
          const local = [listOf({}), listOf({})];
          const own: MineFile[] = [empty, empty];
          let provider = empty;
          // The model: a device's change is what differs, at its round, from what it last applied
          // (a set and a clear between two rounds is no change); the latest such change wins.
          const applied = [stateOf(local[0] ?? ''), stateOf(local[1] ?? '')];
          const latest: Record<string, Partial<Record<Field, boolean>>> = {};
          const round = (device: number): void => {
            clock += 60_000;
            const now = stateOf(local[device] ?? '');
            for (const id of tasks)
              for (const field of ['pinned', 'muted', 'reminder'] as const)
                if (now[id]?.[field] !== applied[device]?.[id]?.[field])
                  (latest[id] ??= {})[field] = now[id]?.[field] ?? false;
            const done = turn(local[device] ?? '', own[device] ?? empty, provider, new Date(clock));
            local[device] = done.local;
            own[device] = done.file;
            provider = done.file;
            applied[device] = stateOf(done.local);
          };
          for (const s of steps) {
            clock += 60_000;
            const state = stateOf(local[s.device] ?? '');
            const task = state[s.task];
            if (task) task[s.field] = s.on;
            local[s.device] = listOf(state);
            if (s.sync) round(s.device);
          }
          // Both devices sync, twice each: then everyone has everything.
          round(0);
          round(1);
          round(0);
          expect(local[0]).toBe(local[1]);
          const final = stateOf(local[0] ?? '');
          for (const [id, fields] of Object.entries(latest))
            for (const [field, value] of Object.entries(fields))
              expect(final[id]?.[field as Field]).toBe(value);
        }),
        // Each run plays whole rounds on two devices: a fifth of the fuzz runs (2,000 in CI).
        { numRuns: DEVICE_RUNS },
      );
    },
    Math.max(20_000, DEVICE_RUNS * 30),
  );
});
