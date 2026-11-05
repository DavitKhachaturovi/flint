import { describe, expect, it } from 'vitest';
import { NoteEditors, type EditorWindow } from './note-editors.js';

function setup(answer: 'save' | 'silent' = 'save') {
  const log: string[] = [];
  const editors: NoteEditors = new NoteEditors(
    {
      release: (to, noteId) => {
        log.push(`release ${to} ${noteId}`);
        // The owner saves, then hands over its text.
        if (answer === 'save') queueMicrotask(() => editors.released(noteId, to, `${to} text`));
      },
      live: (to, noteId, text) => log.push(`live ${to} ${noteId} ${text}`),
      editor: (noteId, editor: EditorWindow | null) => log.push(`editor ${noteId} ${editor}`),
    },
    50,
  );
  return { editors, log };
}

describe('one window edits a note at a time (MINI-01, D-109)', () => {
  it('a free note is claimed at once', async () => {
    const { editors, log } = setup();
    expect(await editors.claim('n1', 'mini')).toBe(true);
    expect(editors.owner('n1')).toBe('mini');
    expect(log).toEqual(['editor n1 mini']);
  });

  it('a note the other window edits is saved and handed over first', async () => {
    const { editors, log } = setup();
    await editors.claim('n1', 'main');
    await editors.claim('n1', 'mini');
    expect(editors.owner('n1')).toBe('mini');
    expect(log).toEqual([
      'editor n1 main',
      'release main n1',
      // The saved text reaches the new owner before its first key.
      'live mini n1 main text',
      'editor n1 mini',
    ]);
  });

  it("only the owner's typing goes live, to the other window", async () => {
    const { editors, log } = setup();
    await editors.claim('n1', 'main');
    editors.live('n1', 'main', 'hello');
    editors.live('n1', 'mini', 'not the owner');
    expect(log.slice(1)).toEqual(['live mini n1 hello']);
  });

  it('a window that leaves, or goes away, edits nothing', async () => {
    const { editors, log } = setup();
    await editors.claim('n1', 'mini');
    await editors.claim('n2', 'mini');
    editors.leave('n1', 'main');
    expect(editors.owner('n1')).toBe('mini');
    editors.leaveAll('mini');
    expect([editors.owner('n1'), editors.owner('n2')]).toEqual([null, null]);
    expect(log.slice(-2)).toEqual(['editor n1 null', 'editor n2 null']);
  });

  it("a window that doesn't answer is passed by after the timeout", async () => {
    const { editors } = setup('silent');
    await editors.claim('n1', 'main');
    expect(await editors.claim('n1', 'mini')).toBe(true);
    expect(editors.owner('n1')).toBe('mini');
  });
});
