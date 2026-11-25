import { describe, expect, it } from 'vitest';
import { allTasks, parseDocument, serializeDocument } from '../format/document.js';
import { applyPersonal, splitPersonal } from './personal.js';

/** SPACE-09 (docs/04 §9, D-190 Q22): your fields out of the shared copy, and back by task ID. */
const header = '---\nflint: 1\nid: gro1\nmode: tasks\n---\n';

describe('the personal-field split (SPACE-09)', () => {
  it('takes your reminder, muted and pinned out of every task with an ID, subtasks too; the rest of each line stays as written', () => {
    const text =
      header +
      '- [ ] Eggs [reminder:: 2026-03-10T15:00] [muted:: true] [pinned:: true] [priority:: high] [id:: eg01]\n' +
      '    - [ ] Free range [pinned:: true] [due:: 2026-03-11] [id:: fr01]\n' +
      '- [ ] Milk [priority:: low] [id:: mi01]\n';
    const { shared, mine, unkeyed } = splitPersonal(parseDocument(text));
    expect(serializeDocument(shared)).toBe(
      header +
        '- [ ] Eggs [priority:: high] [id:: eg01]\n' +
        '    - [ ] Free range [due:: 2026-03-11] [id:: fr01]\n' +
        '- [ ] Milk [priority:: low] [id:: mi01]\n',
    );
    expect([...mine.keys()]).toEqual(['eg01', 'fr01']);
    expect(unkeyed).toBe(0);
    expect(mine.get('eg01')?.reminder?.value.value).toMatchObject({
      year: 2026,
      month: 3,
      day: 10,
      hour: 15,
      minute: 0,
    });
    expect(mine.get('fr01')?.pinned?.value).toBe(true);
  });

  it('a task without your fields keeps its line exactly as written', () => {
    const text = header + '-   [ ]   Odd   spacing  (priority::low)   [id:: od01]\n';
    const document = parseDocument(text);
    const { shared, mine } = splitPersonal(document);
    expect(shared).toBe(document);
    expect(serializeDocument(shared)).toBe(text);
    expect(mine.size).toBe(0);
  });

  it('`today`, the earlier name of pinned, is yours too', () => {
    const { shared, mine } = splitPersonal(
      parseDocument(header + '- [ ] Call [today:: true] [id:: ca01]\n'),
    );
    expect(serializeDocument(shared)).toBe(header + '- [ ] Call [id:: ca01]\n');
    expect(mine.get('ca01')?.pinned?.value).toBe(true);
  });

  it('puts your fields back by task ID: a gone task loses them, a new one has none', () => {
    const local = parseDocument(
      header +
        '- [ ] Eggs [pinned:: true] [id:: eg01]\n' +
        '- [ ] Bread [reminder:: 2026-03-12T09:00] [id:: br01]\n',
    );
    const { mine } = splitPersonal(local);
    // The merged shared copy: Bread gone, Sam's new Tea, Eggs renamed by Sam.
    const merged = parseDocument(
      header + '- [ ] Tea [id:: te01]\n- [ ] Eggs, a dozen [id:: eg01]\n',
    );
    expect(serializeDocument(applyPersonal(merged, mine))).toBe(
      header + '- [ ] Tea [id:: te01]\n- [ ] Eggs, a dozen [pinned:: true] [id:: eg01]\n',
    );
  });

  it('pinning someone’s task never rewrites their line in the shared copy (Q22)', () => {
    const theirs = header + '- [ ] Call [id:: ca01] Bob (priority::high) [foo:: bar]\n';
    const { mine } = splitPersonal(
      parseDocument(header + '- [ ] Call Bob [pinned:: true] [id:: ca01]\n'),
    );
    const local = applyPersonal(parseDocument(theirs), mine);
    expect(serializeDocument(local)).toBe(
      header + '- [ ] Call [pinned:: true] [id:: ca01] Bob (priority::high) [foo:: bar]\n',
    );
    expect(serializeDocument(splitPersonal(local).shared)).toBe(theirs);
    // And through the file.
    expect(serializeDocument(splitPersonal(parseDocument(serializeDocument(local))).shared)).toBe(
      theirs,
    );
  });

  it('the same text in a code span is title, never cut or written into (found by the fuzz tests)', () => {
    const theirs = header + '- [ ] Use `[pinned:: true]` [id:: ab01] fix\n';
    const { mine } = splitPersonal(parseDocument(header + '- [ ] x [pinned:: true] [id:: ab01]\n'));
    const local = applyPersonal(parseDocument(theirs), mine);
    expect(serializeDocument(local)).toBe(
      header + '- [ ] Use `[pinned:: true]` [pinned:: true] [id:: ab01] fix\n',
    );
    expect(serializeDocument(splitPersonal(local).shared)).toBe(theirs);
  });

  it('a shared copy carrying someone’s personal fields loses them before yours go on (D-190 Q11)', () => {
    const foreign = parseDocument(
      header +
        '- [ ] Tea [pinned:: true] [reminder:: 2026-03-10T08:00] [id:: te01]\n' +
        '- [ ] Eggs [muted:: true] [id:: eg01]\n',
    );
    const { mine } = splitPersonal(
      parseDocument(header + '- [ ] Eggs [pinned:: true] [id:: eg01]\n'),
    );
    expect(serializeDocument(applyPersonal(foreign, mine))).toBe(
      header + '- [ ] Tea [id:: te01]\n- [ ] Eggs [pinned:: true] [id:: eg01]\n',
    );
  });

  it('a line without an ID is text, shared as written and never lost (Q22)', () => {
    const text =
      '---\nflint: 1\nid: no01\nmode: note\n---\n' +
      '- [ ] Call the bank [reminder:: 2026-03-11T09:00] [pinned:: true]\n' +
      '- [ ] One [pinned:: true] [id:: du01]\n- [ ] Two [muted:: true] [id:: du01]\n';
    const { shared, mine, unkeyed } = splitPersonal(parseDocument(text));
    // The second `du01` has a provisional key: it stays as written, like the line with no ID.
    expect(unkeyed).toBe(2);
    expect([...mine.keys()]).toEqual(['du01']);
    expect(serializeDocument(applyPersonal(shared, mine))).toBe(text);
  });

  it('keeps the exact text of your fields for the local file (Dataview sees what it saw)', () => {
    const local = parseDocument(header + '- [ ] Call [PINNED:: TRUE] [id:: ca01]\n');
    const { shared, mine } = splitPersonal(local);
    const back = applyPersonal(shared, mine);
    expect([...allTasks(back)].map(({ task }) => task.line.fields.pinned?.raw)).toEqual([
      { key: 'PINNED', value: 'TRUE' },
    ]);
    expect(serializeDocument(back)).toBe(header + '- [ ] Call [PINNED:: TRUE] [id:: ca01]\n');
  });

  it('in someone’s task list, a task without an ID carries none of their pins or reminders onto your PC', () => {
    // Their Flint gives every task an ID before sharing; a copy that doesn't is handled safely.
    const theirs = parseDocument(
      header +
        '- [ ] Sam task [reminder:: 2026-03-11T09:00] [pinned:: true]\n- [ ] Tea [id:: te01]\n',
    );
    expect(serializeDocument(applyPersonal(theirs, new Map()))).toBe(
      header + '- [ ] Sam task\n- [ ] Tea [id:: te01]\n',
    );
  });

  it('spaces around a field at the line’s end come back exactly (found by CI’s longer fuzz run)', () => {
    const text =
      '---\nflint: 1\nmode: tasks\n---\n- [ ] [PINNED:: TRUE] [Vec::new][id:: abcd]  fix  [reminder:: 2026-10-30]\n';
    const doc = parseDocument(text);
    const { shared, mine } = splitPersonal(doc);
    const theirs = serializeDocument(shared);
    expect(theirs.split('\n').at(-2)).toBe('- [ ] [Vec::new][id:: abcd]  fix ');
    const local = applyPersonal(parseDocument(theirs), mine);
    expect(serializeDocument(splitPersonal(local).shared)).toBe(theirs);
    expect(serializeDocument(splitPersonal(parseDocument(serializeDocument(local))).shared)).toBe(
      theirs,
    );
  });

  it('a tab before your field stays a tab in the shared copy', () => {
    const theirs = header + '- [ ]\tTask\t[id:: ab01]\n';
    const { mine } = splitPersonal(parseDocument(header + '- [ ] x [pinned:: true] [id:: ab01]\n'));
    const local = applyPersonal(parseDocument(theirs), mine);
    expect(serializeDocument(splitPersonal(local).shared)).toBe(theirs);
  });

  it('`today` is cut from the line’s own text too (the rest of the line as written)', () => {
    const { shared } = splitPersonal(
      parseDocument(header + '- [ ]  Call  (priority::low) [TODAY:: true] [id:: ca01]\n'),
    );
    expect(serializeDocument(shared)).toBe(header + '- [ ]  Call  (priority::low) [id:: ca01]\n');
  });
});
