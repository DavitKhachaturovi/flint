/** TASK-01, D-54, D-80: the units a task row drags as, in a card of rows (shared, D-110). */
import type { DragUnit } from './drag.js';

/**
 * TASK-01, D-54: the units a row drags among: the top-level tasks of the card (each with its
 * subtasks' rows), or a subtask's siblings. Headings and paragraphs between tasks stay put.
 */
export function rowDragUnits(
  card: HTMLElement,
  row: HTMLElement,
): { unit: DragUnit; peers: DragUnit[] } | null {
  const own = row.parentElement?.classList.contains('row-group') ? row.parentElement : row;
  const keyOf = (element: HTMLElement): string | undefined =>
    (element.matches('.row') ? element : element.querySelector<HTMLElement>(':scope > .row'))
      ?.dataset['key'];
  const isTask = (element: Element): element is HTMLElement =>
    element.matches('.row[data-key], .row-group') && !element.matches('.leaving');
  // Top-level units, each with the subtask rows that follow it.
  const tops: { key: string; elements: HTMLElement[]; subtasks: HTMLElement[] }[] = [];
  let current: (typeof tops)[number] | null = null;
  for (const element of card.children) {
    if (!isTask(element)) {
      if (!element.matches('.leaving')) current = null;
      continue;
    }
    const key = keyOf(element);
    if (!key) continue;
    if (element.classList.contains('subtask')) {
      if (current) {
        current.elements.push(element);
        current.subtasks.push(element);
      }
      continue;
    }
    current = { key, elements: [element], subtasks: [] };
    tops.push(current);
  }
  if (!own.classList.contains('subtask')) {
    const peers = tops.map(({ key, elements }) => ({ key, elements }));
    const unit = peers.find((peer) => peer.elements[0] === own);
    return unit ? { unit, peers } : null;
  }
  const parent = tops.find((top) => top.subtasks.includes(own));
  if (!parent) return null;
  const peers = parent.subtasks.flatMap((element) => {
    const key = keyOf(element);
    return key ? [{ key, elements: [element] }] : [];
  });
  const unit = peers.find((peer) => peer.elements[0] === own);
  return unit ? { unit, peers } : null;
}
