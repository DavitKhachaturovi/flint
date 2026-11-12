/** AGENT-02: the default, human output of find, read and status (every ID shown). */
import type { FindResult, ReadResult, StatusResult, TaskOut } from '@flint/core/agents';
import { describe, expect, it } from 'vitest';
import { PLAIN, renderResult } from './render.js';
import { NOW } from './test-helpers.js';

const REMINDER = {
  at: '2026-11-14T09:00',
  text: 'Sat 14 Nov, 09:00',
  muted: false,
  overdue: false,
};
const BACKEND = { id: 'l8c2m4', name: 'Backend' };

const task = (fields: Partial<TaskOut> = {}): TaskOut => ({
  kind: 'task',
  id: 'k3f9a2',
  title: 'Fix login loop',
  list: BACKEND,
  done: false,
  ...fields,
});

describe('find', () => {
  it('renders hits, one line each, with snippets', () => {
    const result: FindResult = {
      hits: [
        {
          kind: 'task',
          id: 'k3f9a2',
          name: 'Fix login loop',
          list: BACKEND,
          priority: 'high',
          reminder: REMINDER,
          pinned: true,
        },
        {
          kind: 'task',
          id: 'p7d1x0',
          name: 'Old',
          done: true,
          reminder: { ...REMINDER, overdue: true, muted: true },
        },
        {
          kind: 'note',
          id: 'n1',
          name: 'Meeting notes',
          group: { id: 'g1', name: 'Work' },
          match: { line: 12, snippet: '…login…' },
        },
        { kind: 'list', id: 'l8c2m4', name: 'Backend', open: 5 },
      ],
      more: true,
    };
    expect(renderResult('find', result, NOW, PLAIN)).toEqual([
      '[ ] Fix login loop · k3f9a2 · Backend · !high · pinned · Sat 14 Nov, 09:00',
      '[x] Old · p7d1x0 · Sat 14 Nov, 09:00 (muted) (overdue)',
      'Note Meeting notes · n1 · Work',
      '    12: …login…',
      'List Backend · l8c2m4 · 5 open',
      'More results: narrow the search or raise --limit (at most 100).',
    ]);
  });

  it('says when nothing is found', () => {
    expect(renderResult('find', { hits: [], more: false }, NOW, PLAIN)).toEqual(['Nothing found.']);
  });

  it('renders the overview with now', () => {
    const result: FindResult = {
      overview: {
        lists: [
          { kind: 'list', id: 'inbox1', name: 'Inbox', open: 3, inbox: true },
          { kind: 'note', id: 'n1', name: 'Meeting notes', group: 'Work' },
        ],
        groups: [{ id: 'g1', name: 'Work', lists: ['n1'] }],
        today: [
          { kind: 'task', id: 'k3f9a2', name: 'Fix login loop', list: BACKEND, pinned: true },
        ],
        reminders: [],
      },
    };
    expect(renderResult('find', result, NOW, PLAIN)).toEqual([
      'Now: Tue 10 Mar 2026, 10:00 (Asia/Tbilisi, +04:00)',
      '',
      'Lists and notes',
      '  Inbox · inbox1 · 3 open',
      '  Meeting notes · n1 · note · Work',
      '',
      'Groups',
      '  Work · g1 · 1 list',
      '',
      'Today',
      '  [ ] Fix login loop · k3f9a2 · Backend · pinned',
      '',
      'Reminders',
      '  None to come.',
    ]);
  });
});

describe('read', () => {
  it('renders a list with headings, paragraphs, subtasks and paging', () => {
    const result: ReadResult = {
      items: [
        {
          kind: 'list',
          id: 'l8c2m4',
          name: 'Backend',
          group: { id: 'g1', name: 'Work' },
          open: 12,
          done: 4,
          entries: [
            { kind: 'heading', text: '## This week' },
            task({ subtasks: [task({ id: 's1', title: 'Write the test', parent: 'k3f9a2' })] }),
            { kind: 'text', text: 'Notes about the release.' },
          ],
          total: 12,
          offset: 0,
          more: true,
        },
      ],
    };
    expect(renderResult('read', result, NOW, PLAIN)).toEqual([
      'List Backend · l8c2m4 · Work · 12 open, 4 done',
      '## This week',
      '[ ] Fix login loop · k3f9a2 · Backend',
      '  [ ] Write the test · s1',
      'Notes about the release.',
      'More tasks (12 in all): read on with --offset 1',
    ]);
  });

  it('renders a note range, an outline, a truncated hint, and items apart', () => {
    const result: ReadResult = {
      items: [
        {
          kind: 'note',
          id: 'n1',
          name: 'Meeting notes',
          text: '# Agenda\n- Release',
          from: 1,
          to: 2,
          totalLines: 400,
          totalChars: 9000,
          truncated: true,
          hint: 'Read on with lines {from: 3, to: 200}.',
          createdBy: 'Claude',
        },
        {
          kind: 'note',
          id: 'n2',
          name: 'Plan',
          totalLines: 30,
          totalChars: 900,
          truncated: false,
          outline: [
            { line: 1, level: 1, text: 'Plan' },
            { line: 12, level: 2, text: 'Risks' },
          ],
        },
      ],
    };
    expect(renderResult('read', result, NOW, PLAIN)).toEqual([
      'Note Meeting notes · n1 · lines 1–2 of 400',
      '# Agenda',
      '- Release',
      'Read on with lines {from: 3, to: 200}.',
      '  by Claude',
      '',
      'Note Plan · n2 · 30 lines',
      '     1  # Plan',
      '    12  ## Risks',
    ]);
  });

  it('renders a task with its body, a group and the Archived tab', () => {
    const result: ReadResult = {
      items: [
        task({
          body: 'Steps:\n1. Log in',
          bodyTruncated: true,
          bodyLines: 80,
          createdBy: 'Cursor',
        }),
        {
          kind: 'group',
          id: 'g1',
          name: 'Work',
          lists: [{ id: 'n1', name: 'Meeting notes', kind: 'note' }],
        },
        {
          kind: 'archived',
          list: BACKEND,
          tasks: [{ id: 'a1', title: 'Shipped', completed: '2026-03-01' }],
        },
      ],
    };
    expect(renderResult('read', result, NOW, PLAIN)).toEqual([
      '[ ] Fix login loop · k3f9a2 · Backend',
      '    Steps:',
      '    1. Log in',
      '    … 80 lines in all: read on with --lines from:to',
      '  by Cursor',
      '',
      'Group Work · g1',
      '  Meeting notes · n1 · note',
      '',
      'Archived Backend · l8c2m4',
      '[x] Shipped · a1 · 2026-03-01',
    ]);
  });
});

describe('status', () => {
  it('renders the version, writes, limits and now', () => {
    const status: StatusResult = {
      version: '1.8.0',
      protocol: 1,
      readOnly: false,
      paused: true,
      agent: 'Command line',
      limits: {
        preset: 'medium',
        itemsPerRequest: 100,
        taskDeletesPerRequest: 25,
        listDeletesPerRequest: 5,
        changesPerHour: 500,
        usedThisHour: 500,
      },
    };
    expect(renderResult('status', status, NOW, PLAIN)).toEqual([
      'Flint 1.8.0 (protocol 1) · agent: Command line',
      'Writes: paused',
      'Limits (medium): 100 items per request, 25 task deletes, 5 list deletes, 500 changes an hour (500 used)',
      'Now: Tue 10 Mar 2026, 10:00 (Asia/Tbilisi, +04:00)',
    ]);
  });
});

describe('writes and link patterns', () => {
  it("print Flint's own sentences", () => {
    expect(
      renderResult(
        'update',
        { changed: [], text: ['Completed "A".', 'Completed "B".'] },
        NOW,
        PLAIN,
      ),
    ).toEqual(['Completed "A".', 'Completed "B".']);
    expect(
      renderResult('linkPatterns', { patterns: [], text: ['No link patterns.'] }, NOW, PLAIN),
    ).toEqual(['No link patterns.']);
  });
});
