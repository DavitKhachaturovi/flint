import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from '../format/document.js';
import { applyOp } from '../model/ops.js';
import { editTitle, setPriority, deleteTask } from '../model/actions.js';
import { ChangeBudget, LIMIT_PRESETS } from './limits.js';
import { resolveRef, type Resolvable } from './resolve.js';
import { appendText, findInText, outline, replaceOnce, sliceText } from './text.js';
import { nowInfo, parseAgentTime, timeText } from './times.js';
import { opKeys, planInverse, planText, taskFingerprint } from './undo.js';

// Tuesday 10 March 2026, 10:00 local (the end-to-end tests' day, D-107).
const NOW = new Date(2026, 2, 10, 10, 0);

describe('agent times (AGENT-01, D-185 Q7)', () => {
  it('reads Flint’s phrases as capture does', () => {
    expect(parseAgentTime('tomorrow 9:00', NOW)).toEqual({
      kind: 'at',
      at: { year: 2026, month: 3, day: 11, hour: 9, minute: 0, second: 0 },
    });
  });

  it('reads ISO local times, and a day alone at 10:00', () => {
    expect(parseAgentTime('2026-03-14T09:30', NOW)).toMatchObject({
      at: { day: 14, hour: 9, minute: 30 },
    });
    expect(parseAgentTime('2026-03-14', NOW)).toMatchObject({
      at: { day: 14, hour: 10, minute: 0 },
    });
  });

  it('converts ISO times with an offset to local time', () => {
    const result = parseAgentTime('2026-03-14T09:30Z', NOW);
    const expected = new Date(Date.UTC(2026, 2, 14, 9, 30));
    expect(result).toMatchObject({
      at: { day: expected.getDate(), hour: expected.getHours(), minute: expected.getMinutes() },
    });
  });

  it('clears with none, refuses past and unreadable times with examples', () => {
    expect(parseAgentTime('none', NOW)).toEqual({ kind: 'none' });
    const past = parseAgentTime('2026-03-09T09:00', NOW);
    expect(past.kind).toBe('bad');
    const nonsense = parseAgentTime('when the cows come home', NOW);
    expect(nonsense).toMatchObject({ kind: 'bad' });
    if (nonsense.kind === 'bad') expect(nonsense.message).toContain('tomorrow 9:00');
    expect(parseAgentTime('2026-02-30T09:00', NOW).kind).toBe('bad');
  });

  it('echoes times and now in plain words', () => {
    expect(timeText({ year: 2026, month: 3, day: 14, hour: 9, minute: 0, second: 0 }, NOW)).toBe(
      'Sat 14 Mar, 09:00',
    );
    expect(timeText({ year: 2027, month: 1, day: 2, hour: 9, minute: 5, second: 0 }, NOW)).toBe(
      'Sat 2 Jan 2027, 09:05',
    );
    const info = nowInfo(NOW, 'Asia/Tbilisi');
    expect(info.local).toBe('2026-03-10T10:00');
    expect(info.text).toBe('Tue 10 Mar 2026, 10:00');
    expect(info.offset).toMatch(/^[+-]\d{2}:\d{2}$/);
  });
});

describe('the hourly budget (D-185 Q8)', () => {
  it('counts the last hour only and starts again on resume', () => {
    const budget = new ChangeBudget();
    budget.spend(400, 0);
    expect(budget.fits(100, LIMIT_PRESETS.medium.changesPerHour, 1000)).toBe(true);
    expect(budget.fits(101, LIMIT_PRESETS.medium.changesPerHour, 1000)).toBe(false);
    expect(budget.used(60 * 60 * 1000 + 1)).toBe(0);
    budget.spend(10, 5);
    budget.reset();
    expect(budget.used(6)).toBe(0);
  });

  it('has the presets Davit chose', () => {
    expect(LIMIT_PRESETS.low).toEqual({
      itemsPerRequest: 25,
      taskDeletesPerRequest: 10,
      listDeletesPerRequest: 2,
      changesPerHour: 150,
    });
    expect(LIMIT_PRESETS.high.changesPerHour).toBe(2000);
  });
});

describe('large content (D-185 Q10)', () => {
  const long = Array.from({ length: 450 }, (_, index) => `line ${index + 1}`).join('\n');

  it('cuts a long text at 200 lines and says how to read on', () => {
    const slice = sliceText(long);
    expect(slice.from).toBe(1);
    expect(slice.to).toBe(200);
    expect(slice.totalLines).toBe(450);
    expect(slice.truncated).toBe(true);
    expect(slice.hint).toContain('from: 201');
  });

  it('cuts at 8,000 characters too, never mid-line', () => {
    const wide = Array.from({ length: 100 }, () => 'x'.repeat(199)).join('\n');
    const slice = sliceText(wide);
    expect(slice.to).toBe(40);
    expect(slice.text.split('\n').every((line) => line.length === 199)).toBe(true);
  });

  it('returns a range, and a short text whole', () => {
    expect(sliceText(long, { from: 10, to: 12 }).text).toBe('line 10\nline 11\nline 12');
    expect(sliceText('a\nb\n')).toMatchObject({ text: 'a\nb', truncated: false, totalLines: 2 });
    expect(sliceText('')).toMatchObject({ text: '', totalLines: 0, truncated: false });
  });

  it('outlines headings outside code fences', () => {
    const text = '# Plan\n\nText\n```\n# not a heading\n```\n## Steps ##\n';
    expect(outline(text)).toEqual([
      { line: 1, level: 1, text: 'Plan' },
      { line: 7, level: 2, text: 'Steps' },
    ]);
  });

  it('finds a line with every word, as a snippet', () => {
    expect(findInText('first\nThe login loop is back\n', 'LOOP login')).toEqual({
      line: 2,
      snippet: 'The login loop is back',
    });
    expect(findInText('nothing here', 'login')).toBeNull();
  });

  it('replaces a passage only when it occurs once; appends on a new line', () => {
    expect(replaceOnce('a b a', 'b', 'c')).toEqual({ ok: true, text: 'a c a' });
    expect(replaceOnce('a b a', 'a', 'c')).toEqual({ ok: false, count: 2 });
    expect(replaceOnce('a', 'z', 'c')).toEqual({ ok: false, count: 0 });
    expect(appendText('one', 'two')).toBe('one\ntwo');
    expect(appendText('one\n', 'two')).toBe('one\ntwo');
  });
});

describe('resolving references (D-185 Q6)', () => {
  const lists: Resolvable[] = [
    { kind: 'list', id: 'l1', name: 'Backend' },
    { kind: 'list', id: 'l2', name: 'Groceries' },
    { kind: 'note', id: 'n1', name: 'Release plan' },
  ];
  const tasks: Resolvable[] = [
    {
      kind: 'task',
      id: 'k3f9a2',
      name: 'Fix login loop',
      list: 'Backend',
      listId: 'l1',
      done: false,
    },
    {
      kind: 'task',
      id: 'k3f9a3',
      name: 'Fix login loop',
      list: 'Backend',
      listId: 'l1',
      done: true,
    },
    { kind: 'task', id: 'b2', name: 'Buy milk', list: 'Groceries', listId: 'l2', done: false },
    { kind: 'task', id: 'b3', name: 'Buy milk', list: 'Inbox', listId: 'inbox', done: false },
  ];

  it('takes an ID, or an exact name ignoring case and spaces', () => {
    expect(resolveRef('l2', lists)).toMatchObject({ ok: true, item: { id: 'l2' } });
    expect(resolveRef('  release   PLAN ', lists)).toMatchObject({ ok: true, item: { id: 'n1' } });
  });

  it('prefers open tasks on a title', () => {
    expect(resolveRef('fix login loop', tasks, { preferOpen: true })).toMatchObject({
      ok: true,
      item: { id: 'k3f9a2' },
    });
  });

  it('never guesses: two matches are ambiguous, with the candidates', () => {
    const result = resolveRef('Buy milk', tasks, { preferOpen: true });
    expect(result).toMatchObject({ ok: false, code: 'ambiguous' });
    if (!result.ok && result.code === 'ambiguous')
      expect(result.candidates.map((each) => each.id)).toEqual(['b2', 'b3']);
  });

  it('suggests close matches for an unknown name, never acting on them', () => {
    const result = resolveRef('Backed', lists);
    expect(result).toMatchObject({ ok: false, code: 'not_found' });
    if (!result.ok && result.code === 'not_found') expect(result.suggestions[0]?.id).toBe('l1');
  });
});

describe('undoing an agent change (AGENT-07, D-185 Q5)', () => {
  const LIST = 'Backend.md';
  const text = '- [ ] Fix login loop [id:: aaaa]\n- [ ] Write docs [id:: bbbb]\n';
  const start = new Map([[LIST, parseDocument(text)]]);

  /** Applies `op` as the agent would, returning the documents after and the change's record. */
  function agentDoes(op: Parameters<typeof applyOp>[1]) {
    const applied = applyOp(start, op);
    if (!applied) throw new Error('not applied');
    const document = applied.documents.get(LIST);
    if (!document) throw new Error('no document');
    const after = Object.fromEntries(
      opKeys(applied.inverse).map((key) => [key, taskFingerprint(document, key)]),
    );
    return { documents: applied.documents, document, inverse: applied.inverse, after };
  }

  it('undoes a change to a task that is still as the agent left it', () => {
    const change = agentDoes(editTitle(LIST, 'aaaa', 'Fix the login loop'));
    const plan = planInverse(change.document, change.inverse, change.after);
    expect(plan.skipped).toEqual([]);
    const undone = applyOp(change.documents, plan.op!);
    expect(serializeDocument(undone!.documents.get(LIST)!)).toBe(text);
  });

  it('skips a task the user changed since', () => {
    const change = agentDoes(setPriority(LIST, 'aaaa', 'high'));
    const later = applyOp(change.documents, editTitle(LIST, 'aaaa', 'Fix it now'))!;
    const plan = planInverse(later.documents.get(LIST)!, change.inverse, change.after);
    expect(plan.op).toBeNull();
    expect(plan.skipped).toEqual(['aaaa']);
  });

  it('brings back a deleted task only while it is still gone', () => {
    const change = agentDoes(deleteTask(LIST, 'bbbb'));
    expect(change.after).toEqual({ bbbb: null });
    const plan = planInverse(change.document, change.inverse, change.after);
    expect(plan.op).not.toBeNull();
    const back = applyOp(change.documents, plan.op!)!;
    expect(serializeDocument(back.documents.get(LIST)!)).toBe(text);
  });

  it('survives a reload from disk (the fingerprint is the written text)', () => {
    const change = agentDoes(editTitle(LIST, 'aaaa', 'Fix the login loop'));
    const reloaded = parseDocument(serializeDocument(change.document));
    expect(planInverse(reloaded, change.inverse, change.after).skipped).toEqual([]);
  });

  it('undoes a note by a three-way merge, keeping the user’s later typing', () => {
    const before = 'one\ntwo\nthree\n';
    const after = 'one\ntwo\nthree\nadded by the agent\n';
    const now = 'ONE (typed later)\ntwo\nthree\nadded by the agent\n';
    expect(planText(before, after, now)).toBe('ONE (typed later)\ntwo\nthree\n');
    expect(planText(before, after, after)).toBe(before);
    expect(
      planText(before, after, 'one\ntwo\nthree\nadded by the agent, then edited\n'),
    ).toBeNull();
  });
});
