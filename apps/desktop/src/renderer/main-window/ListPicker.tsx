import { useMemo, useState, type ReactElement } from 'react';
import {
  isValidListName,
  normalizeListName,
  suggestLists,
  type ListInfo,
} from '@flint/core/shorthand';
import type { ListSummary } from '../../shared/ipc.js';
import { ListIcon } from './icons.js';

/** Where a picked task goes: an existing list, or a new one with the typed name. */
export type PickedList = { readonly list: string } | { readonly newList: string };

/**
 * The list picker (CAP-11, D-57; 09 §8): a search field, then the most recently used lists, or the
 * matches for what is typed (D-25 matching), and "New list" for a new name. ↑/↓ move, Enter
 * picks, Esc closes. Used by "Move to…" (TASK-11) and, in step 5, by the composer's # button.
 */
export function ListPicker(props: {
  readonly lists: readonly ListSummary[];
  /** The list the task is in: not offered. */
  readonly exclude: string;
  readonly at: { readonly x: number; readonly y: number };
  readonly onPick: (picked: PickedList) => void;
  readonly onClose: () => void;
}): ReactElement {
  const { lists, exclude, at, onPick, onClose } = props;
  const [typed, setTyped] = useState('');
  const [active, setActive] = useState(0);

  const options = useMemo((): { readonly label: string; readonly pick: PickedList }[] => {
    const infos = lists.map((list): ListInfo => ({
      id: list.id,
      name: list.name,
      mode: list.mode,
      ...(list.recentRank === undefined ? {} : { recentRank: list.recentRank }),
    }));
    const found = suggestLists(typed, infos)
      .filter((list) => list.id !== exclude)
      .slice(0, typed.trim() === '' ? 5 : 6)
      .map((list): { readonly label: string; readonly pick: PickedList } => ({
        label: list.name,
        pick: { list: list.id },
      }));
    const name = typed.trim();
    const taken = lists.some((list) => normalizeListName(list.name) === normalizeListName(name));
    if (name !== '' && !taken && isValidListName(name))
      found.push({ label: `New list "${name}"`, pick: { newList: name } });
    return found;
  }, [lists, exclude, typed]);

  const left = Math.max(8, Math.min(at.x, window.innerWidth - 288));
  const top = Math.max(8, Math.min(at.y, window.innerHeight - 320));
  return (
    <div className="picker-layer" onMouseDown={onClose}>
      <div
        className="picker"
        role="dialog"
        aria-label="Move to list"
        style={{ left, top }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          className="picker-search"
          autoFocus
          placeholder="Move to list…"
          value={typed}
          spellCheck={false}
          onChange={(event) => {
            setTyped(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setActive(
                (current) => (current + step + options.length) % Math.max(1, options.length),
              );
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const chosen = options[active];
              if (chosen) onPick(chosen.pick);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
        />
        {options.length === 0 && <p className="picker-empty">No other task lists</p>}
        {options.map((option, index) => (
          <button
            key={'list' in option.pick ? option.pick.list : 'new'}
            type="button"
            className={index === active ? 'picker-item active' : 'picker-item'}
            onMouseEnter={() => setActive(index)}
            onClick={() => onPick(option.pick)}
          >
            <span className="tile">
              <ListIcon />
            </span>
            <span className="picker-name">{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
