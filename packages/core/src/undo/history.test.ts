import { describe, expect, it } from 'vitest';
import { allTasks, parseDocument, serializeDocument } from '../format/document.js';
import { prepareForSave } from '../format/save.js';
import { completeTask, deleteTask, editTitle, setPriority } from '../model/actions.js';
import { applyOp, type Documents } from '../model/ops.js';
import { emptyHistory, perform, redo, renameKeys, undo, type UndoHistory } from './history.js';

const TEXT = '- [ ] A [id:: aaaa]\n- [ ] B [id:: bbbb]\n';
const AT = { year: 2026, month: 10, day: 29, hour: 14, minute: 30, second: 0 };

function start(text = TEXT): { history: UndoHistory; documents: Documents } {
  return {
    history: emptyHistory,
    documents: new Map([['a', parseDocument(text, { keySeed: 'a' })]]),
  };
}

function text(documents: Documents): string {
  const document = documents.get('a');
  return document ? serializeDocument(document) : '';
}

describe('undo history (DATA-03)', () => {
  it('undoes and redoes structural changes across steps', () => {
    let { history, documents } = start();
    for (const [op, label] of [
      [setPriority('a', 'bbbb', 'high'), 'Priority'],
      [completeTask(documents.get('a') ?? parseDocument(''), 'a', 'aaaa', AT)?.op, 'Completed'],
    ] as const) {
      if (!op) throw new Error('no op');
      const performed = perform(history, documents, op, label);
      if (!performed) throw new Error('not performed');
      ({ history, documents } = performed);
    }
    const final = text(documents);
    let step = undo(history, documents);
    expect(step?.kind).toBe('applied');
    step = step && undo(step.history, step.documents);
    expect(step && text(step.documents)).toBe(TEXT);
    expect(step && undo(step.history, step.documents)).toBeNull();
    let forward = step && redo(step.history, step.documents);
    forward = forward && redo(forward.history, forward.documents);
    expect(forward && text(forward.documents)).toBe(final);
    expect(forward && redo(forward.history, forward.documents)).toBeNull();
  });

  it('a new change clears redo', () => {
    const { history, documents } = start();
    const first = perform(history, documents, setPriority('a', 'aaaa', 'low'), 'Priority');
    const undone = first && undo(first.history, first.documents);
    const next =
      undone &&
      perform(undone.history, undone.documents, setPriority('a', 'bbbb', 'low'), 'Priority');
    expect(next?.history.undone).toEqual([]);
  });

  it('merges quick edits of the same title into one step', () => {
    let { history, documents } = start();
    for (const [title, time] of [
      ['A1', 0],
      ['A12', 400],
      ['A123', 900],
    ] as const) {
      const performed = perform(history, documents, editTitle('a', 'aaaa', title), 'Edit', {
        mergeKey: 'title:a:aaaa',
        time,
      });
      if (!performed) throw new Error('not performed');
      ({ history, documents } = performed);
    }
    expect(history.done).toHaveLength(1);
    expect(text(documents)).toContain('- [ ] A123 [id:: aaaa]');
    const step = undo(history, documents);
    expect(step && text(step.documents)).toBe(TEXT);
    const again = step && redo(step.history, step.documents);
    expect(again && text(again.documents)).toContain('- [ ] A123 [id:: aaaa]');
  });

  it('does not merge after a pause or across tasks', () => {
    let { history, documents } = start();
    for (const [key, time] of [
      ['aaaa', 0],
      ['aaaa', 5_000],
      ['bbbb', 5_100],
    ] as const) {
      const performed = perform(history, documents, editTitle('a', key, `x${time}`), 'Edit', {
        mergeKey: `title:a:${key}`,
        time,
      });
      if (!performed) throw new Error('not performed');
      ({ history, documents } = performed);
    }
    expect(history.done).toHaveLength(3);
  });

  it('skips an undo whose task is gone, with a reason, and drops it', () => {
    const { history, documents } = start();
    const performed = perform(history, documents, setPriority('a', 'aaaa', 'high'), 'Priority');
    if (!performed) throw new Error('not performed');
    // Another program removed the task in the meantime.
    const removed = applyOp(performed.documents, deleteTask('a', 'aaaa'));
    const step = removed && undo(performed.history, removed.documents);
    expect(step?.kind).toBe('skipped');
    expect(step?.history.done).toEqual([]);
  });

  it('keeps only the newest entries', () => {
    let { history, documents } = start();
    for (let index = 0; index < 5; index++) {
      const performed = perform(history, documents, editTitle('a', 'aaaa', `t${index}`), 'Edit', {
        limit: 3,
      });
      if (!performed) throw new Error('not performed');
      ({ history, documents } = performed);
    }
    expect(history.done).toHaveLength(3);
  });

  it('follows tasks to the IDs a save gave them', () => {
    let { history, documents } = start('- [ ] from the CLI\n');
    const key = [...allTasks(documents.get('a') ?? parseDocument(''))][0]?.task.key ?? '';
    expect(key.startsWith('~')).toBe(true);
    const performed = perform(history, documents, setPriority('a', key, 'high'), 'Priority');
    if (!performed) throw new Error('not performed');
    const saved = prepareForSave(performed.documents.get('a') ?? parseDocument(''), {
      now: AT,
      isTaken: () => false,
      random: () => 0.5,
    });
    documents = new Map([['a', saved.document]]);
    history = renameKeys(performed.history, saved.renamed);
    const step = undo(history, documents);
    expect(step?.kind).toBe('applied');
    expect(step && text(step.documents)).toBe('- [ ] from the CLI [id:: iiii]\n');
  });
});
