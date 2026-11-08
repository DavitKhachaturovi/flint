import { fuzzyMatch } from '../shared/fuzzy.js';
import type { ListView, SearchHit, TaskRow, TrashView } from '../shared/ipc.js';

/**
 * NAV-01, D-106: the Ctrl+K palette's search over every list and note (task titles and notes, the
 * lines of notes), or, asked for, over Trash and the archive. Best first; capped.
 */

const LIMIT = 60;

/** A body's line that matched, shortened around the match. */
function snippet(text: string, query: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const clean = line.trim();
    if (clean !== '' && fuzzyMatch(query, clean))
      return clean.length > 90 ? `${clean.slice(0, 89)}…` : clean;
  }
  return null;
}

export function searchLists(views: readonly ListView[], query: string): SearchHit[] {
  const hits: SearchHit[] = [];
  // D-143: one word that isn't a piece of a line matched it only by its letters (fuzzyMatch).
  const words = query
    .trim()
    .toLowerCase()
    .split(/s+/)
    .filter((word) => word !== '');
  const loose = (text: string): boolean =>
    words.length === 1 && !text.toLowerCase().includes(words[0] ?? '');
  for (const view of views) {
    if (view.mode === 'note') {
      const lines = (view.noteText ?? '').split(/\r?\n/);
      lines.forEach((line, index) => {
        const text = line.trim();
        if (text === '' || text === '---') return;
        const match = fuzzyMatch(query, text);
        if (match)
          hits.push({
            kind: 'line',
            listId: view.id,
            listName: view.name,
            text: text.length > 120 ? `${text.slice(0, 119)}…` : text,
            line: index,
            score: match.score,
            indices: match.indices.filter((at) => at < 119),
            ...(loose(text) && { loose: true }),
          });
      });
      continue;
    }
    const visit = (task: TaskRow): void => {
      const title = fuzzyMatch(query, task.title);
      const body = title || task.body === '' ? null : fuzzyMatch(query, task.body);
      if (title || body)
        hits.push({
          kind: 'task',
          listId: view.id,
          listName: view.name,
          key: task.key,
          text: task.title === '' ? task.label : task.title,
          ...(body && { detail: snippet(task.body, query) ?? undefined }),
          done: task.done,
          // A match in its notes counts less than one in its title.
          score: title ? title.score : (body?.score ?? 0) * 0.6,
          indices: title ? title.indices : [],
        });
      task.subtasks.forEach(visit);
    };
    for (const item of view.items) if (item.kind === 'task') visit(item.task);
    view.completed.forEach(visit);
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, LIMIT);
}

export function searchTrash(trash: TrashView, query: string): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const item of trash.deleted) {
    const match = fuzzyMatch(query, item.title);
    if (match)
      hits.push({
        kind: 'deleted',
        listId: '',
        listName: item.from ?? (item.kind === 'note' ? 'a note' : 'a list'),
        text: item.title,
        trashId: item.id,
        score: match.score,
        indices: match.indices,
      });
  }
  for (const list of trash.archived)
    for (const task of list.tasks) {
      const match = fuzzyMatch(query, task.title);
      if (match)
        hits.push({
          kind: 'archived',
          listId: list.listId,
          listName: list.listName,
          key: task.key,
          text: task.title,
          score: match.score,
          indices: match.indices,
        });
    }
  return hits.sort((a, b) => b.score - a.score).slice(0, LIMIT);
}
