import { describe, expect, it } from 'vitest';
import type { ListView, TaskRow, TrashView } from '../shared/ipc.js';
import { searchLists, searchTrash } from './search.js';

const task = (key: string, title: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ key, title, label: title, done: false, body: '', subtasks: [], ...extra }) as TaskRow;

const views: ListView[] = [
  {
    id: 'w1',
    name: 'Work',
    mode: 'tasks',
    open: 2,
    readOnly: null,
    noteText: null,
    items: [
      { kind: 'task', task: task('a', 'Ask Alex about the DNS change') },
      {
        kind: 'task',
        task: task('b', 'Deploy', {
          body: 'remember the DNS TTL first',
          subtasks: [task('c', 'DNS records check')],
        }),
      },
    ],
    completed: [task('d', 'DNS cutover', { done: true })],
  },
  {
    id: 'n1',
    name: 'Meeting notes',
    mode: 'note',
    open: 0,
    readOnly: null,
    noteText: '# Meeting\n\nWe agreed on the DNS move.\n',
    items: [],
    completed: [],
  },
];

describe('NAV-01, D-106: the palette search', () => {
  it('finds tasks by title and notes, subtasks, completed ones and note lines', () => {
    const hits = searchLists(views, 'dns');
    expect(hits.map((hit) => `${hit.kind}:${hit.key ?? hit.line}`).sort()).toEqual(
      ['line:2', 'task:a', 'task:b', 'task:c', 'task:d'].sort(),
    );
    const deploy = hits.find((hit) => hit.key === 'b');
    expect(deploy?.detail).toBe('remember the DNS TTL first');
    // A title match ranks above a match in the notes.
    expect(hits.findIndex((hit) => hit.key === 'c')).toBeLessThan(
      hits.findIndex((hit) => hit.key === 'b'),
    );
    expect(hits.find((hit) => hit.key === 'd')?.done).toBe(true);
  });

  it('says when a note line matched only loosely (D-143: the note lights its whole text)', () => {
    const line = (query: string) => searchLists(views, query).find((hit) => hit.kind === 'line');
    expect(line('dns move')?.loose).toBeUndefined();
    expect(line('agreed')?.loose).toBeUndefined();
    // One word whose letters are in the line, but not the word itself.
    expect(line('wgdm')?.loose).toBe(true);
  });

  it('Trash and the archive, when asked', () => {
    const trash: TrashView = {
      deleted: [
        {
          id: 't1.md',
          kind: 'task',
          title: 'Old DNS plan',
          from: 'Work',
          deleted: '2026-11-04T10:00',
        },
      ],
      archived: [
        {
          listId: 'w1',
          listName: 'Work',
          tasks: [{ key: 'z', title: 'DNS audit', completed: '2026-10-01' }],
        },
      ],
    };
    expect(
      searchTrash(trash, 'dns')
        .map((hit) => hit.kind)
        .sort(),
    ).toEqual(['archived', 'deleted']);
  });
});
