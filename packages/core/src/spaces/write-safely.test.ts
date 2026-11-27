import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FakeSpaceStore } from './fake-store.js';
import { SpaceStoreError } from './store.js';
import { WRITE_TRIES, writeSafely, type Merge3 } from './write-safely.js';

/**
 * D-190 Q9: a space's file written whole without losing another member's write, on a store whose
 * writes are only checked before writing (Drive) and on one whose writes are conditional (OneDrive).
 */
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);
const lines = (bytes: Uint8Array | null): Set<string> =>
  new Set(
    decode(bytes ?? new Uint8Array())
      .split('\n')
      .filter((line) => line !== ''),
  );
const text = (set: Set<string>): Uint8Array => encode([...set].sort().join('\n'));

/** A merge of line sets: added on either side kept, removed on either side gone. */
const merge: Merge3 = (base, mine, theirs) => {
  const was = lines(base);
  const ours = lines(mine);
  const their = lines(theirs);
  const out = new Set<string>();
  for (const line of ours) if (their.has(line) || !was.has(line)) out.add(line);
  for (const line of their) if (!was.has(line) && !out.has(line)) out.add(line);
  return text(out);
};

async function setup(conditional: boolean) {
  const cloud = new FakeSpaceStore();
  cloud.conditionalWrites = conditional;
  const alex = cloud.as('alex@example.com');
  const created = await alex.create(
    'Home.flintspace',
    'application/vnd.flintnotes.space',
    text(new Set(['start'])),
  );
  await alex.share([created.id], 'sam@example.com');
  return {
    cloud,
    alex,
    sam: cloud.as('sam@example.com'),
    id: created.id,
    base: text(new Set(['start'])),
  };
}

describe('writing a space file safely (D-190 Q9)', () => {
  for (const conditional of [false, true]) {
    const kind = conditional ? 'OneDrive (conditional)' : 'Drive (checked before writing)';

    it(`${kind}: a plain write lands once`, async () => {
      const { cloud, alex, id, base } = await setup(conditional);
      const done = await writeSafely(alex, id, base, text(new Set(['start', 'eggs'])), merge);
      expect(done.wrote).toBe(true);
      expect(lines(cloud.content(id) ?? null)).toEqual(new Set(['start', 'eggs']));
    });

    it(`${kind}: Sam writing in the gap is never lost`, async () => {
      const { cloud, alex, id, base } = await setup(conditional);
      let raced = false;
      cloud.beforeWrite = () => {
        if (raced) return;
        raced = true;
        cloud.writeNow(id, text(new Set(['start', 'milk'])));
      };
      const done = await writeSafely(alex, id, base, text(new Set(['start', 'eggs'])), merge);
      expect(lines(cloud.content(id) ?? null)).toEqual(new Set(['start', 'eggs', 'milk']));
      expect(lines(done.content)).toEqual(new Set(['start', 'eggs', 'milk']));
    });

    it(`${kind}: written by Sam since it was read: merged, nothing lost`, async () => {
      const { cloud, alex, sam, id, base } = await setup(conditional);
      // Sam writes between Alex's read and write: Alex's write is refused as changed, merged again.
      const read = alex.read.bind(alex);
      let first = true;
      const racing = {
        ...alex,
        conditionalWrites: alex.conditionalWrites,
        read: async (fileId: string) => {
          const got = await read(fileId);
          if (first) {
            first = false;
            await writeSafely(sam, id, base, text(new Set(['start', 'tea'])), merge);
          }
          return got;
        },
      };
      await writeSafely(racing, id, base, text(new Set(['start', 'eggs'])), merge);
      expect(lines(cloud.content(id) ?? null)).toEqual(new Set(['start', 'eggs', 'tea']));
    });

    it(`${kind}: an unchanged file isn't written`, async () => {
      const { cloud, alex, id, base } = await setup(conditional);
      const before = cloud.calls.filter((call) => call.includes('write')).length;
      const done = await writeSafely(alex, id, base, base, merge);
      expect(done.wrote).toBe(false);
      expect(cloud.calls.filter((call) => call.includes('write')).length).toBe(before);
    });

    it(`${kind}: someone writing all the time: it gives up (changed), never overwrites`, async () => {
      const { cloud, alex, id, base } = await setup(conditional);
      let n = 0;
      cloud.beforeWrite = () => cloud.writeNow(id, text(new Set(['start', `sam ${n++}`])));
      await expect(
        writeSafely(alex, id, base, text(new Set(['start', 'eggs'])), merge),
      ).rejects.toEqual(
        new SpaceStoreError('changed', 'the file kept changing while it was written'),
      );
      expect(n).toBeLessThanOrEqual(WRITE_TRIES);
    });
  }

  it('fuzzed: whatever other members slip in, every line anyone added is kept', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 2 }), fc.boolean()), {
          minLength: 1,
          maxLength: 8,
        }),
        async (conditional, plan) => {
          const { cloud, alex, sam, id } = await setup(conditional);
          const members = [alex, sam, cloud.as('alex@example.com')];
          const added = new Set(['start']);
          let racer = 0;
          for (const [index, [who, race]] of plan.entries()) {
            const line = `line ${index}`;
            added.add(line);
            // A racing member's whole-file write slipped into the gap (as a stale Flint might).
            cloud.beforeWrite = race
              ? () => {
                  cloud.beforeWrite = null;
                  const stale = lines(cloud.content(id) ?? null);
                  const extra = `race ${racer++}`;
                  added.add(extra);
                  stale.add(extra);
                  cloud.writeNow(id, text(stale));
                }
              : null;
            const store = members[who] ?? alex;
            const before = (await store.read(id)).content;
            const mine = lines(before);
            mine.add(line);
            await writeSafely(store, id, before, text(mine), merge);
          }
          expect(lines(cloud.content(id) ?? null)).toEqual(added);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('a write whose gap check didn’t run (the sync round’s third review, R2)', () => {
  it('the next run finds what that write replaced and merges it back', async () => {
    const { cloud, alex, sam, id, base } = await setup(false);
    const pending: { value: import('./write-safely.js').PendingWrite | null } = { value: null };
    const journal = {
      read: () => Promise.resolve(pending.value),
      write: (value: import('./write-safely.js').PendingWrite | null) => {
        pending.value = value;
        return Promise.resolve();
      },
    };
    // Alex's write lands in Sam's gap; Sam's connection drops right after his own write.
    cloud.beforeWrite = () => {
      cloud.beforeWrite = null;
      cloud.writeNow(id, text(new Set(['start', 'alex tea'])));
    };
    const revisions = sam.revisions.bind(sam);
    let offline = true;
    const flaky = {
      ...sam,
      conditionalWrites: false,
      revisions: (fileId: string) => {
        if (offline) {
          offline = false;
          return Promise.reject(new SpaceStoreError('offline'));
        }
        return revisions(fileId);
      },
    };
    await expect(
      writeSafely(flaky, id, base, text(new Set(['start', 'sam milk'])), merge, { journal }),
    ).rejects.toMatchObject({ problem: 'offline' });
    expect(pending.value).not.toBeNull();
    expect(lines(cloud.content(id) ?? null).has('alex tea')).toBe(false);
    // Back online: the next run (nothing new of Sam's) merges Alex's replaced write back.
    const now = text(new Set(['start', 'sam milk']));
    await writeSafely(flaky, id, now, now, merge, { journal });
    expect(lines(cloud.content(id) ?? null)).toEqual(new Set(['start', 'sam milk', 'alex tea']));
    expect(pending.value).toBeNull();
    void alex;
  });
});
