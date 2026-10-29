import { parseDocument } from '@flint/core';
import { describe, expect, it } from 'vitest';
import { completionLabel, listView } from './views.js';

const now = new Date(2026, 9, 30, 14, 0);
const meta = { id: 'inbox', name: 'Inbox', mode: 'tasks', readOnly: null } as const;

const file = [
  '---',
  'flint: 1',
  'id: inbox',
  'mode: tasks',
  '---',
  'Captured things.',
  '',
  '- [ ] Fix null ref [reminder:: 2026-10-30T15:00] [priority:: high] [id:: k3f9]',
  '    Seen on staging.',
  '    - [ ] Add a regression test [id:: s1a2]',
  '- [ ] [id:: c0d3]',
  '    ```json',
  '    {',
  '      "died_at": "2026-09-10T07:55:31Z",',
  '      "exit_code": 0',
  '    }',
  '    ```',
  '## Later',
  '- [ ] Bump the CI agent image [priority:: low] [id:: b4mp]',
  '',
  '## Completed',
  '- [x] Rotate secret [completion:: 2026-10-30T11:42] [id:: r0t8]',
  '- [x] Send notes [completion:: 2026-10-26T09:00] [id:: s3nd]',
  '',
].join('\n');

describe('the main window list view (M4, TASK-01..06, TASK-15, D-45)', () => {
  const view = listView(parseDocument(file), meta, now);

  it('shows tasks with the non-task content around them, read-only', () => {
    expect(
      view.items.map((item) =>
        item.kind === 'task' ? item.task.label : `${item.kind}: ${item.text}`,
      ),
    ).toEqual([
      'text: Captured things.',
      'Fix null ref',
      'JSON · died_at',
      'heading: Later',
      'Bump the CI agent image',
    ]);
    expect(view.open).toBe(3);
  });

  it('carries priority, reminder, body and subtasks', () => {
    const first = view.items[1];
    if (first?.kind !== 'task') throw new Error('not a task');
    expect(first.task).toMatchObject({
      key: 'k3f9',
      priority: 'high',
      reminder: 'Today 15:00',
      done: false,
    });
    expect(first.task.body).toContain('Seen on staging.');
    expect(first.task.subtasks.map((subtask) => subtask.title)).toEqual(['Add a regression test']);
  });

  it('shows an untitled code task as a collapsed code row (D-45)', () => {
    const untitled = view.items[2];
    if (untitled?.kind !== 'task') throw new Error('not a task');
    expect(untitled.task.title).toBe('');
    expect(untitled.task.code).toEqual({ kind: 'JSON', lines: 4, peek: 'died_at' });
  });

  it('lists the Completed section with when each was completed', () => {
    expect(view.completed.map((task) => [task.title, task.completed])).toEqual([
      ['Rotate secret', 'Today 11:42'],
      ['Send notes', 'Mon'],
    ]);
  });

  it('labels completion times like the mockup', () => {
    const at = (day: number, hour = 9) => ({
      year: 2026,
      month: 10,
      day,
      hour,
      minute: 5,
      second: 0,
    });
    expect(completionLabel(at(30, 11), now)).toBe('Today 11:05');
    expect(completionLabel(at(29), now)).toBe('Yesterday');
    expect(completionLabel(at(26), now)).toBe('Mon');
    expect(completionLabel(at(12), now)).toBe('Oct 12');
  });
});
