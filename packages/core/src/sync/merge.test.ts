import { describe, expect, it } from 'vitest';
import { countConflicts, findConflicts, resolveConflict } from './conflict.js';
import { diffLines } from './diff.js';
import { mergeLists, mergeFrontmatter } from './merge.js';
import { mergeText } from './text-merge.js';
import { splitLines } from '../format/lines.js';

const labels = { mine: 'WORK-PC', theirs: 'DAVIT-LAPTOP', when: '10 Nov 14:02' };

describe('diffLines (SYNC-01)', () => {
  it('finds the changed lines', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([
      { aStart: 1, aEnd: 2, bStart: 1, bEnd: 2 },
    ]);
    expect(diffLines(['a', 'b'], ['a', 'b'])).toEqual([]);
    expect(diffLines([], ['a'])).toEqual([{ aStart: 0, aEnd: 0, bStart: 0, bEnd: 1 }]);
    expect(diffLines(['a', 'b', 'c', 'd'], ['b', 'c', 'e'])).toEqual([
      { aStart: 0, aEnd: 1, bStart: 0, bEnd: 0 },
      { aStart: 3, aEnd: 4, bStart: 2, bEnd: 3 },
    ]);
  });

  it('turns any text into any other (random)', () => {
    const random = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const next = random(7);
    for (let run = 0; run < 300; run++) {
      const make = () =>
        Array.from(
          { length: Math.floor(next() * 12) },
          () => 'abcd'[Math.floor(next() * 4)] as string,
        );
      const a = make();
      const b = make();
      const out: string[] = [];
      let x = 0;
      for (const hunk of diffLines(a, b)) {
        out.push(...a.slice(x, hunk.aStart), ...b.slice(hunk.bStart, hunk.bEnd));
        x = hunk.aEnd;
      }
      out.push(...a.slice(x));
      expect(out).toEqual(b);
    }
  });
});

describe('mergeText (SYNC-01, D-161 Q5)', () => {
  const base = 'Kazbegi weekend\n\nLeave Friday after work.\n\nWhere to stay\n';

  it('takes the side that changed, byte for byte', () => {
    const mine = base.replace('Friday', 'Saturday');
    expect(mergeText(base, mine, base, labels)).toEqual({ text: mine, conflicts: 0 });
    expect(mergeText(base, base, mine, labels)).toEqual({ text: mine, conflicts: 0 });
  });

  it('combines changes to different lines', () => {
    const mine = base.replace('Kazbegi', 'Kazbegi trip');
    const theirs = base.replace('Where to stay', 'Where to stay: the guesthouse');
    expect(mergeText(base, mine, theirs, labels)).toEqual({
      text: 'Kazbegi trip weekend\n\nLeave Friday after work.\n\nWhere to stay: the guesthouse\n',
      conflicts: 0,
    });
  });

  it("keeps both versions of the same lines in a callout below this PC's", () => {
    const mine = base.replace('Leave Friday after work.', 'Leave Friday at six.');
    const theirs = base.replace('Leave Friday after work.', 'Leave Saturday morning instead.');
    const result = mergeText(base, mine, theirs, labels);
    expect(result.conflicts).toBe(1);
    expect(result.text).toBe(
      'Kazbegi weekend\n\nLeave Friday at six.\n' +
        "> [!conflict] Also changed on DAVIT-LAPTOP, 10 Nov 14:02 (the 1 line above is WORK-PC's)\n" +
        '> Leave Saturday morning instead.\n\nWhere to stay\n',
    );
    expect(countConflicts(result.text)).toBe(1);
  });

  it('resolves a conflict three ways', () => {
    const mine = base.replace('Leave Friday after work.', 'Leave Friday at six.');
    const theirs = base.replace('Leave Friday after work.', 'Leave Saturday morning instead.');
    const { text } = mergeText(base, mine, theirs, labels);
    expect(resolveConflict(text, 0, 'theirs')).toBe(theirs);
    expect(resolveConflict(text, 0, 'mine')).toBe(mine);
    expect(resolveConflict(text, 0, 'both')).toBe(
      base.replace(
        'Leave Friday after work.',
        'Leave Friday at six.\nLeave Saturday morning instead.',
      ),
    );
    expect(resolveConflict(text, 1, 'mine')).toBe(text);
  });

  it('records a delete against an edit', () => {
    const mine = base.replace('Leave Friday after work.\n', '');
    const theirs = base.replace('Leave Friday after work.', 'Leave Saturday.');
    const { text } = mergeText(base, mine, theirs, labels);
    const [block] = findConflicts(splitLines(text).map((line) => line.text));
    expect(block?.mineCount).toBe(0);
    expect(block?.lines).toEqual(['Leave Saturday.']);
    expect(resolveConflict(text, 0, 'theirs')).toBe(theirs);
    const other = mergeText(base, theirs, mine, labels).text;
    expect(other).toContain('> (deleted these lines)');
    expect(resolveConflict(other, 0, 'theirs')).toBe(mine);
  });

  it('never puts a callout inside a code block', () => {
    const code = 'Steps\n```bash\nnpm ci\nnpm test\n```\nDone\n';
    const mine = code.replace('npm test', 'npm run test:unit');
    const theirs = code.replace('npm test', 'npm run e2e');
    const { text, conflicts } = mergeText(code, mine, theirs, labels);
    expect(conflicts).toBe(1);
    expect(text).toBe(
      'Steps\n```bash\nnpm ci\nnpm run test:unit\n```\n' +
        "> [!conflict] Also changed on DAVIT-LAPTOP, 10 Nov 14:02 (WORK-PC's version is in the code block above)\n" +
        '> npm run e2e\nDone\n',
    );
    expect(resolveConflict(text, 0, 'theirs')).toBe(text);
    expect(resolveConflict(text, 0, 'mine')).toBe(mine);
  });

  it('keeps line endings and a BOM', () => {
    const crlf = '﻿a\r\nb\r\nc\r\n';
    const result = mergeText(crlf, crlf.replace('a', 'A'), crlf.replace('c', 'C'), labels);
    expect(result.text).toBe('﻿A\r\nb\r\nC\r\n');
  });

  it('a first meeting keeps what both have once', () => {
    const result = mergeText(null, 'a\nb\nc\n', 'a\nx\nc\n', labels);
    expect(result.conflicts).toBe(1);
    expect(result.text.startsWith('a\nb\n> [!conflict]')).toBe(true);
    expect(result.text.endsWith('> x\nc\n')).toBe(true);
  });
});

describe('mergeFrontmatter (SYNC-01)', () => {
  const lines = (text: string) => splitLines(text);
  it('merges key by key', () => {
    const base = lines('---\nflint: 1\nid: n4d8\nmode: note\n---\n');
    const mine = lines('---\nflint: 1\nid: n4d8\nmode: note\ntags: [a]\n---\n');
    const theirs = lines('---\nflint: 1\nid: n4d8\nmode: tasks\n---\n');
    expect(mergeFrontmatter(base, mine, theirs).map((line) => line.text)).toEqual([
      '---',
      'flint: 1',
      'id: n4d8',
      'mode: tasks',
      'tags: [a]',
      '---',
    ]);
  });
});

const context = (touched: Record<string, [number, number]> = {}) => ({
  mineDevice: 'WORK-PC',
  theirsDevice: () => 'DAVIT-LAPTOP',
  when: () => '10 Nov 14:02',
  touched: (side: 'mine' | 'theirs', key: string) => {
    const pair = touched[key];
    return pair ? pair[side === 'mine' ? 0 : 1] : null;
  },
  isTaken: () => false,
  random: (() => {
    let seed = 1;
    return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  })(),
});

const head = (id: string) => `---\nflint: 1\nid: ${id}\nmode: tasks\n---\n`;

describe('mergeLists, task lists by ID (SYNC-01, D-161 Q2, Q4)', () => {
  const base =
    head('l1') +
    '- [ ] Oat milk [id:: aaaaaa]\n- [ ] Dry cleaning [priority:: medium] [id:: bbbbbb]\n- [ ] Light bulbs [id:: cccccc]\n';

  const one = (b: string | null, m: string | null, t: string | null, touched = {}) =>
    mergeLists([{ listId: 'l1', base: b, mine: m, theirs: t }], context(touched));

  it('combines edits to different tasks and keeps untouched lines', () => {
    const mine = base.replace('Oat milk', 'Oat milk, eggs');
    const theirs = base.replace('[priority:: medium]', '[priority:: high]');
    const result = one(base, mine, theirs);
    expect(result.texts.get('l1')).toBe(
      head('l1') +
        '- [ ] Oat milk, eggs [id:: aaaaaa]\n- [ ] Dry cleaning [priority:: high] [id:: bbbbbb]\n- [ ] Light bulbs [id:: cccccc]\n',
    );
  });

  it("adds the other side's new task after the task it follows there", () => {
    const theirs = base.replace(
      '- [ ] Light bulbs',
      '- [ ] Return the parcel [id:: dddddd]\n- [ ] Light bulbs',
    );
    const mine = base + '- [ ] Birthday present [id:: eeeeee]\n';
    expect(one(base, mine, theirs).texts.get('l1')).toBe(
      head('l1') +
        '- [ ] Oat milk [id:: aaaaaa]\n- [ ] Dry cleaning [priority:: medium] [id:: bbbbbb]\n- [ ] Return the parcel [id:: dddddd]\n- [ ] Light bulbs [id:: cccccc]\n- [ ] Birthday present [id:: eeeeee]\n',
    );
  });

  it('done wins when both changed the task', () => {
    const mine = base
      .replace('- [ ] Oat milk', '- [x] Oat milk')
      .replace('[id:: aaaaaa]', '[completion:: 2026-11-10T10:00] [id:: aaaaaa]');
    const theirs = base.replace('Oat milk', 'Oat milk (2 l)');
    const text = one(base, mine, theirs, { aaaaaa: [1, 2] }).texts.get('l1') ?? '';
    expect(text).toContain('- [x] Oat milk (2 l) [completion:: 2026-11-10T10:00] [id:: aaaaaa]');
  });

  it('a value changed on both: the later change wins', () => {
    const mine = base.replace('[priority:: medium]', '[priority:: low]');
    const theirs = base.replace('[priority:: medium]', '[priority:: high]');
    expect(one(base, mine, theirs, { bbbbbb: [5, 9] }).texts.get('l1')).toContain(
      'Dry cleaning [priority:: high]',
    );
    expect(one(base, mine, theirs, { bbbbbb: [9, 5] }).texts.get('l1')).toContain(
      'Dry cleaning [priority:: low]',
    );
  });

  it('a title changed on both keeps the other in the body', () => {
    const mine = base.replace('Light bulbs', 'Light bulbs E27');
    const theirs = base.replace('Light bulbs', 'Light bulbs, warm');
    const text = one(base, mine, theirs, { cccccc: [1, 2] }).texts.get('l1') ?? '';
    expect(text).toContain(
      '- [ ] Light bulbs, warm [id:: cccccc]\n    Other version (WORK-PC): Light bulbs E27\n',
    );
  });

  it('edited beats deleted; deleted and untouched goes to Trash', () => {
    const mine = base
      .replace('- [ ] Oat milk [id:: aaaaaa]\n', '')
      .replace('Light bulbs', 'Light bulbs E27');
    const theirs = base
      .replace('Oat milk', 'Oat milk, eggs')
      .replace('- [ ] Light bulbs [id:: cccccc]\n', '');
    const result = one(base, mine, theirs);
    expect(result.texts.get('l1')).toBe(
      head('l1') +
        '- [ ] Oat milk, eggs [id:: aaaaaa]\n- [ ] Dry cleaning [priority:: medium] [id:: bbbbbb]\n- [ ] Light bulbs E27 [id:: cccccc]\n',
    );
    const other = one(base, base, theirs.replace('Oat milk, eggs', 'Oat milk'));
    expect(other.trashed.map((entry) => entry.node.key)).toEqual(['cccccc']);
    expect(other.texts.get('l1')).not.toContain('Light bulbs');
  });

  it('the later move wins; one side moving it moves it', () => {
    const theirs =
      head('l1') +
      '- [ ] Light bulbs [id:: cccccc]\n- [ ] Oat milk [id:: aaaaaa]\n- [ ] Dry cleaning [priority:: medium] [id:: bbbbbb]\n';
    const mine = base.replace('Oat milk', 'Oat milk, eggs');
    expect(one(base, mine, theirs).texts.get('l1')).toBe(
      head('l1') +
        '- [ ] Light bulbs [id:: cccccc]\n- [ ] Oat milk, eggs [id:: aaaaaa]\n- [ ] Dry cleaning [priority:: medium] [id:: bbbbbb]\n',
    );
  });

  it('a task moved to another list on one PC and edited on the other moves with the edit', () => {
    const other = head('l2') + '- [ ] Watch Dune [id:: ffffff]\n';
    const mineL1 = base.replace('- [ ] Dry cleaning [priority:: medium] [id:: bbbbbb]\n', '');
    const mineL2 = other + '- [ ] Dry cleaning [priority:: medium] [id:: bbbbbb]\n';
    const theirsL1 = base.replace('[priority:: medium]', '[priority:: high]');
    const result = mergeLists(
      [
        { listId: 'l1', base, mine: mineL1, theirs: theirsL1 },
        { listId: 'l2', base: other, mine: mineL2, theirs: other },
      ],
      context(),
    );
    expect(result.texts.get('l1')).not.toContain('Dry cleaning');
    expect(result.texts.get('l2')).toBe(
      other + '- [ ] Dry cleaning [priority:: high] [id:: bbbbbb]\n',
    );
  });

  it('a first meeting: Inbox merges, the same task once, a colliding ID re-IDed (Q2)', () => {
    const mine =
      head('inbox') + '- [ ] Call the bank [id:: aaaaaa]\n- [ ] Same on both [id:: zzzzzz]\n';
    const theirs =
      head('inbox') + '- [ ] Buy stamps [id:: aaaaaa]\n- [ ] Same on both [id:: zzzzzz]\n';
    const result = mergeLists([{ listId: 'inbox', base: null, mine, theirs }], context());
    const text = result.texts.get('inbox') ?? '';
    expect(text.match(/Same on both/g)).toHaveLength(1);
    expect(text).toContain('- [ ] Call the bank [id:: aaaaaa]');
    const incoming = result.reIded.get('aaaaaa');
    expect(incoming).toMatch(/^[a-z0-9]{4,6}$/);
    expect(text).toContain(`- [ ] Buy stamps [id:: ${incoming}]`);
  });

  it('merges subtasks by ID and bodies as text', () => {
    const b =
      head('l1') + '- [ ] Trip [id:: aaaaaa]\n    Pack light.\n    - [ ] Boots [id:: bbbbbb]\n';
    const mine = b.replace('Pack light.', 'Pack light. Bring a jacket.');
    const theirs = b + '    - [ ] Map [id:: cccccc]\n';
    expect(one(b, mine, theirs).texts.get('l1')).toBe(
      head('l1') +
        '- [ ] Trip [id:: aaaaaa]\n    Pack light. Bring a jacket.\n    - [ ] Boots [id:: bbbbbb]\n    - [ ] Map [id:: cccccc]\n',
    );
  });

  it('notes merge as text and keep the frontmatter', () => {
    const note = '---\nflint: 1\nid: n1\nmode: note\n---\n# Trip\n\nLeave Friday.\n';
    const result = mergeLists(
      [
        {
          listId: 'n1',
          base: note,
          mine: note.replace('# Trip', '# Kazbegi trip'),
          theirs: note.replace('Friday', 'Saturday'),
        },
      ],
      context(),
    );
    expect(result.texts.get('n1')).toBe(
      '---\nflint: 1\nid: n1\nmode: note\n---\n# Kazbegi trip\n\nLeave Saturday.\n',
    );
  });
});
