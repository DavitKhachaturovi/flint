import {
  getBody,
  isCompletedStatus,
  serializeDocument,
  type FlintDocument,
  type TaskNode,
} from '@flint/core';
import { classifyPaste, taskLabel } from '@flint/core/shorthand';
import { describeTime, toDate, type LocalDateTime } from '@flint/core/time';
import type { ListItem, ListView, TaskRow } from '../shared/ipc.js';

/**
 * A list file as the main window shows it (M4): active tasks with the non-task content around them
 * (read-only, TASK-15), and the Completed section (TASK-06). Pure, so it is unit-tested.
 */

const KIND_LABEL: Readonly<Record<string, string>> = {
  json: 'JSON',
  'stack-trace': 'Stack trace',
  code: 'Code',
  text: 'Code',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** When a task was completed, as the mockup shows it: `Today 11:42`, `Yesterday`, `Mon`, `Oct 21`. */
export function completionLabel(value: LocalDateTime, now: Date): string {
  const day = new Date(value.year, value.month - 1, value.day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  const time = `${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`;
  if (days <= 0) return `Today ${time}`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return WEEKDAYS[day.getDay()] ?? '';
  return `${MONTHS[value.month - 1] ?? ''} ${value.day}`;
}

/** An untitled task whose body is one fenced block: a collapsed code row (D-45). */
function codeSummary(body: string): TaskRow['code'] {
  const fence = /^(`{3,}|~{3,})(\w*)[^\n]*\n([\s\S]*?)\n\1\s*$/.exec(body.trim());
  if (!fence) return null;
  const content = fence[3] ?? '';
  const kind = fence[2] === 'json' ? 'json' : classifyPaste(content);
  const label = taskLabel('', body);
  const prefix = `${KIND_LABEL[kind] ?? 'Code'} · `;
  return {
    kind: KIND_LABEL[kind] ?? 'Code',
    lines: content.split('\n').length,
    peek: label.startsWith(prefix) ? label.slice(prefix.length) : '',
  };
}

function taskRow(task: TaskNode, now: Date): TaskRow {
  const { line } = task;
  const body = getBody(task);
  const title = line.title.trim();
  const reminder = line.fields.reminder?.value.value ?? null;
  const completion = line.fields.completion?.value.value ?? null;
  const done = isCompletedStatus(line.status);
  const muted = line.fields.muted !== undefined;
  return {
    key: task.key,
    title,
    label: taskLabel(title, body),
    code: title === '' ? codeSummary(body) : null,
    priority: line.fields.priority?.value ?? null,
    reminder: reminder ? describeTime(reminder, now) : null,
    // REM-11, REM-12: a turned-off reminder is never overdue; a completed task never is either.
    reminderState: !reminder
      ? null
      : muted
        ? 'muted'
        : !done && toDate(reminder).getTime() <= now.getTime()
          ? 'overdue'
          : 'on',
    done,
    completed: completion ? completionLabel(completion, now) : null,
    body,
    subtasks: task.children
      .filter((child): child is TaskNode => child.kind === 'task')
      .map((child) => taskRow(child, now)),
  };
}

export interface ListMeta {
  readonly id: string;
  readonly name: string;
  readonly mode: 'tasks' | 'note';
  readonly readOnly: string | null;
}

export function listView(document: FlintDocument, meta: ListMeta, now: Date): ListView {
  if (meta.mode === 'note') {
    return {
      ...meta,
      open: 0,
      items: [],
      completed: [],
      noteText: serializeDocument(document).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ''),
    };
  }
  const items: ListItem[] = [];
  const completed: TaskRow[] = [];
  let inCompleted = false;
  for (const block of document.blocks) {
    if (block.kind === 'other') {
      if (block.completedHeading) {
        inCompleted = true;
        continue;
      }
      if (inCompleted) continue;
      // Non-task content, read-only (TASK-15): headings as quiet labels, the rest as text.
      const lines = block.lines.map((line) => line.text);
      let text: string[] = [];
      const flush = (): void => {
        const joined = text.join('\n').trim();
        if (joined !== '') items.push({ kind: 'text', text: joined });
        text = [];
      };
      for (const line of lines) {
        const heading = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/.exec(line);
        if (heading) {
          flush();
          items.push({ kind: 'heading', text: heading[1] ?? '' });
        } else text.push(line);
      }
      flush();
      continue;
    }
    const row = taskRow(block, now);
    if (inCompleted) completed.push(row);
    else items.push({ kind: 'task', task: row });
  }
  const open = items.filter((item) => item.kind === 'task' && !item.task.done).length;
  return { ...meta, open, items, completed, noteText: null };
}
