import { describe, expect, it } from 'vitest';
import {
  CLAUDE_LINK_LIMIT,
  CLAUDE_PASTE_NOTE,
  CLAUDE_PROMPT_LIMIT,
  buildPrompt,
  claudeLink,
  estimateTokens,
  folderName,
  planHandoff,
} from './claude.js';

const FLINT = 'C:\\Users\\Alex\\Flint';

describe('the prompt made from a task (TASK-18, D-151)', () => {
  it('has the title as a heading, the notes, then the subtasks with their state and notes', () => {
    const prompt = buildPrompt(
      {
        title: 'Fix the login redirect loop',
        body: 'After signing in on staging, the page bounces.\n![screenshot](attachments/2026-11-09-loop.png)',
        subtasks: [
          { title: 'Reproduce on staging', done: true, body: '' },
          {
            title: 'Check the cookie domain',
            done: false,
            body: 'It might be `.example`.\n\nOr not.',
          },
        ],
      },
      FLINT,
    );
    expect(prompt).toBe(
      [
        '# Fix the login redirect loop',
        '',
        'After signing in on staging, the page bounces.',
        '![screenshot](<C:\\Users\\Alex\\Flint\\attachments\\2026-11-09-loop.png>)',
        '',
        '## Subtasks',
        '- [x] Reproduce on staging',
        '- [ ] Check the cookie domain',
        '    It might be `.example`.',
        '',
        '    Or not.',
        '',
      ].join('\n'),
    );
  });

  it('is only the heading for a task with no notes or subtasks', () => {
    expect(buildPrompt({ title: 'Ship it', body: '  \n', subtasks: [] }, FLINT)).toBe(
      '# Ship it\n',
    );
  });

  it('puts a title on one line, and ends a subtask given alone with its parent', () => {
    const prompt = buildPrompt(
      { title: 'Check the\ncookie domain', body: '', subtasks: [], partOf: 'Fix the loop' },
      FLINT,
    );
    expect(prompt).toBe('# Check the cookie domain\n\nPart of: Fix the loop\n');
  });

  it('makes attachment and linked-file links absolute, but not inside fenced code', () => {
    const body = [
      '[log](<attachments/run log.txt>) and [clip](attachments/a%20b.mp4)',
      '![video](file:///D:/Videos/demo%20one.mp4)',
      '```md',
      '![kept](attachments/x.png)',
      '```',
      '[web](https://example.com/attachments/x.png)',
    ].join('\n');
    expect(buildPrompt({ title: 't', body, subtasks: [] }, `${FLINT}\\`)).toBe(
      [
        '# t',
        '',
        '[log](<C:\\Users\\Alex\\Flint\\attachments\\run log.txt>) and [clip](<C:\\Users\\Alex\\Flint\\attachments\\a b.mp4>)',
        '![video](<D:\\Videos\\demo one.mp4>)',
        '```md',
        '![kept](attachments/x.png)',
        '```',
        '[web](https://example.com/attachments/x.png)',
        '',
      ].join('\n'),
    );
  });
});

describe('attachment links with parentheses or a title (D-151)', () => {
  it('keeps the whole name in angle brackets, and a title after the path', () => {
    const body = [
      '[r](<attachments/report (1).pdf>)',
      '![s](attachments/a.png "The shot")',
      '[t](<attachments/b c.png> "Two words")',
    ].join('\n');
    expect(buildPrompt({ title: 't', body, subtasks: [] }, FLINT)).toBe(
      [
        '# t',
        '',
        '[r](<C:\\Users\\Alex\\Flint\\attachments\\report (1).pdf>)',
        '![s](<C:\\Users\\Alex\\Flint\\attachments\\a.png> "The shot")',
        '[t](<C:\\Users\\Alex\\Flint\\attachments\\b c.png> "Two words")',
        '',
      ].join('\n'),
    );
  });

  it('names a folder by its last part, a drive by itself', () => {
    expect(folderName('C:\\Code\\acme-web')).toBe('acme-web');
    expect(folderName('C:\\Code\\acme-web\\')).toBe('acme-web');
    expect(folderName('D:/work/contoso')).toBe('contoso');
    expect(folderName('C:\\')).toBe('C:\\');
  });
});

describe('the token estimate (D-151)', () => {
  it('counts about 4 Latin characters a token and 1 a character for other scripts', () => {
    expect(estimateTokens('abcd'.repeat(20))).toBe(20);
    expect(estimateTokens('ა'.repeat(50))).toBe(50);
    expect(estimateTokens('')).toBe(0);
  });

  it('rounds to two significant figures', () => {
    expect(estimateTokens('a'.repeat(4 * 1234))).toBe(1200);
    expect(estimateTokens('a'.repeat(4 * 315))).toBe(320);
    expect(estimateTokens('a'.repeat(4 * 99))).toBe(99);
  });
});

describe('the link, or the clipboard (D-151, Q2)', () => {
  const folder = 'C:\\Code\\acme web';

  it('encodes the prompt and the folder', () => {
    expect(claudeLink('Fix it & test', folder)).toBe(
      'claude://code/new?q=Fix%20it%20%26%20test&folder=C%3A%5CCode%5Cacme%20web',
    );
  });

  it('keeps a prompt within both limits in the link', () => {
    const prompt = 'a'.repeat(CLAUDE_PROMPT_LIMIT);
    const handoff = planHandoff(prompt, folder);
    expect(handoff.via).toBe('link');
    expect(handoff.characters).toBe(CLAUDE_PROMPT_LIMIT);
    expect(decodeURIComponent(new URL(handoff.url).searchParams.get('q') ?? '')).toBe(prompt);
    expect(handoff.url.length).toBeLessThanOrEqual(CLAUDE_LINK_LIMIT);
  });

  it('sends a prompt over Claude’s limit to the clipboard, the link carrying a note', () => {
    const handoff = planHandoff('a'.repeat(CLAUDE_PROMPT_LIMIT + 1), folder);
    expect(handoff.via).toBe('clipboard');
    expect(handoff.characters).toBe(CLAUDE_PROMPT_LIMIT + 1);
    expect(handoff.url).toBe(claudeLink(CLAUDE_PASTE_NOTE, folder));
  });

  it('sends a prompt whose link would be over Windows’ limit to the clipboard (Georgian)', () => {
    // 4,000 letters are well under Claude's limit, but 9 encoded characters each.
    const prompt = 'ა'.repeat(4_000);
    expect(prompt.length).toBeLessThan(CLAUDE_PROMPT_LIMIT);
    expect(planHandoff(prompt, folder).via).toBe('clipboard');
    expect(planHandoff('ა'.repeat(3_000), folder).via).toBe('link');
  });
});
