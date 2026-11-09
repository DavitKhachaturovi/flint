import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLAUDE_PASTE_NOTE, CLAUDE_PROMPT_LIMIT, claudeLink } from '../shared/claude.js';
import { claudeState, giveToClaude, readGiveRequest, withFolder, withRecent } from './claude.js';
import { defaultSettings, isAbsoluteFolder, readSettings, type Settings } from './settings.js';

let folder = '';
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'flint-claude-'));
});
afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

/** Effects that record instead of opening or copying. */
function recorder(options: { installed?: boolean; refuse?: boolean } = {}) {
  const opened: string[] = [];
  const copied: string[] = [];
  return {
    opened,
    copied,
    effects: {
      installed: () => options.installed ?? true,
      open: (url: string): Promise<void> => {
        if (options.refuse) return Promise.reject(new Error('Failed to open'));
        opened.push(url);
        return Promise.resolve();
      },
      copy: (text: string) => void copied.push(text),
    },
  };
}

const settings = (changes: Partial<Settings> = {}): Settings => ({
  ...defaultSettings(),
  ...changes,
});

describe('giving a task to Claude (TASK-18, D-151)', () => {
  it('opens the claude:// link with the prompt and the folder, first among the recent folders', async () => {
    const { opened, copied, effects } = recorder();
    const result = await giveToClaude(
      { prompt: '# Fix it\n', folder, list: 'unicorn', makeDefault: false },
      settings({ claudeRecentFolders: ['C:\\Code\\other', folder.toUpperCase()] }),
      effects,
    );
    expect(result.outcome).toBe('opened');
    expect(opened).toEqual([claudeLink('# Fix it\n', folder)]);
    expect(copied).toEqual([]);
    expect(result.changes).toEqual({ claudeRecentFolders: [folder, 'C:\\Code\\other'] });
  });

  it('makes the folder the list’s own with Shift+Enter', async () => {
    const { effects } = recorder();
    const result = await giveToClaude(
      { prompt: 'x', folder, list: 'unicorn', makeDefault: true },
      settings({ claudeFolders: { errands: 'C:\\Code\\e' } }),
      effects,
    );
    expect(result.changes?.claudeFolders).toEqual({ errands: 'C:\\Code\\e', unicorn: folder });
  });

  it('puts a prompt too long for a link on the clipboard, once the link has opened', async () => {
    const { opened, copied, effects } = recorder();
    const prompt = 'a'.repeat(CLAUDE_PROMPT_LIMIT + 1);
    const result = await giveToClaude(
      { prompt, folder, list: null, makeDefault: false },
      settings(),
      effects,
    );
    expect(result.outcome).toBe('copied');
    expect(opened).toEqual([claudeLink(CLAUDE_PASTE_NOTE, folder)]);
    expect(copied).toEqual([prompt]);
  });

  it('says Claude isn’t installed, and touches neither the clipboard nor the settings', async () => {
    for (const options of [{ installed: false }, { refuse: true }]) {
      const { copied, effects } = recorder(options);
      const prompt = 'a'.repeat(CLAUDE_PROMPT_LIMIT + 1);
      const result = await giveToClaude(
        { prompt, folder, list: null, makeDefault: true },
        settings(),
        effects,
      );
      expect(result).toEqual({ outcome: 'not-installed', changes: null });
      expect(copied).toEqual([]);
    }
  });

  it('refuses a folder that no longer exists', async () => {
    const { opened, effects } = recorder();
    const gone = join(folder, 'gone');
    const result = await giveToClaude(
      { prompt: 'x', folder: gone, list: null, makeDefault: false },
      settings(),
      effects,
    );
    expect(result.outcome).toBe('no-folder');
    expect(opened).toEqual([]);
  });

  it('takes only a prompt and an absolute folder from the window', () => {
    const ok = { prompt: 'x', folder: 'C:\\Code', list: null, makeDefault: true };
    expect(readGiveRequest(ok)).toEqual(ok);
    expect(readGiveRequest({ ...ok, list: 'unicorn', makeDefault: 'yes' })).toEqual({
      ...ok,
      list: 'unicorn',
      makeDefault: false,
    });
    for (const bad of [
      null,
      'claude://code/new?q=x',
      { ...ok, prompt: '' },
      { ...ok, folder: 'Code' },
      { ...ok, folder: 'https://example.com' },
      { ...ok, folder: 'C:\\Code\nx' },
      { ...ok, list: '' },
    ])
      expect(readGiveRequest(bad)).toBeNull();
  });
});

describe('the folders remembered (D-151)', () => {
  it('keeps five recent folders, each once whatever its letter case', () => {
    const recent = ['C:\\a', 'C:\\b', 'C:\\c', 'C:\\d', 'C:\\e'];
    expect(withRecent(recent, 'c:\\C')).toEqual(['c:\\C', 'C:\\a', 'C:\\b', 'C:\\d', 'C:\\e']);
    expect(withRecent(recent, 'C:\\f')).toEqual(['C:\\f', 'C:\\a', 'C:\\b', 'C:\\c', 'C:\\d']);
  });

  it('sets and forgets a list’s folder', () => {
    expect(withFolder({ a: 'C:\\a' }, 'b', 'C:\\b')).toEqual({ a: 'C:\\a', b: 'C:\\b' });
    expect(withFolder({ a: 'C:\\a', b: 'C:\\b' }, 'a', null)).toEqual({ b: 'C:\\b' });
  });

  it('reads them tolerantly from settings.json', () => {
    const read = readSettings({
      claudeFolders: { unicorn: 'C:\\Code\\u', bad: 'relative', '': 'C:\\x', n: 3 },
      claudeRecentFolders: [
        'C:\\a',
        'C:\\a',
        'nope',
        7,
        '\\\\server\\share',
        'D:/b',
        'C:\\c',
        'C:\\d',
        'C:\\e',
      ],
    });
    expect(read.claudeFolders).toEqual({ unicorn: 'C:\\Code\\u' });
    expect(read.claudeRecentFolders).toEqual([
      'C:\\a',
      '\\\\server\\share',
      'D:/b',
      'C:\\c',
      'C:\\d',
    ]);
    expect(readSettings({ claudeFolders: ['C:\\a'], claudeRecentFolders: 'C:\\a' })).toMatchObject({
      claudeFolders: {},
      claudeRecentFolders: [],
    });
    expect(isAbsoluteFolder('C:')).toBe(false);
    expect(isAbsoluteFolder('\\\\')).toBe(false);
  });

  it('shows which folders are gone', async () => {
    const gone = join(folder, 'gone');
    const state = await claudeState(
      settings({ claudeFolders: { a: folder }, claudeRecentFolders: [gone, folder] }),
      'C:\\Flint',
      true,
    );
    expect(state).toEqual({
      installed: true,
      flintFolder: 'C:\\Flint',
      folders: { a: folder },
      recent: [gone, folder],
      missing: [gone],
    });
  });
});
