import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { fuzzyMatch } from '../../shared/fuzzy.js';
import { BackIcon, SearchIcon } from './icons.js';
import type { SearchHit } from '../../shared/ipc.js';

/**
 * NAV-01, D-106: the Ctrl+K palette: a solid floating card like the capture popup, centred near
 * the top over a very light dim. One field searches every list and note, the places to go and the
 * commands; ↑/↓ and Enter. A command with choices (Move to…, Priority) is a second step inside the
 * palette, with a breadcrumb. Before anything is typed: recent places, the selected task's actions
 * and the most used commands. With a query, the last row searches Trash and the archive instead.
 * D-107: results always in one order (Go to, the task's actions, Commands, Tasks, Lists and notes,
 * lines in notes last); a step (or Trash and Archive) has a back arrow, and Esc or Backspace in the
 * empty field goes back one step; Esc closes only from the top; a footer shows the keys.
 */

export interface PaletteItem {
  readonly id: string;
  readonly label: string;
  /** Muted text after the label: a list's name, a task's notes line. */
  readonly detail?: string | undefined;
  /** A key shown on the right (from the shared shortcuts). */
  readonly hint?: string | undefined;
  /** More words it is found by. */
  readonly keywords?: string;
  /** The label's letters that matched (search results come with them). */
  readonly indices?: readonly number[];
  /** Completed or deleted: shown quieter. */
  readonly quiet?: boolean;
  readonly run?: () => void;
  /** A second step: its items, under a breadcrumb. */
  readonly step?: () => PaletteStep;
}

export interface PaletteStep {
  readonly title: string;
  readonly items: readonly PaletteItem[];
}

export interface PaletteSources {
  readonly recent: readonly PaletteItem[];
  /** The selected task's actions, when one is selected. */
  readonly task: readonly PaletteItem[];
  /** Fixed places: Today, Settings and its sections, Trash, Snapshots. */
  readonly places: readonly PaletteItem[];
  /** Lists, notes and groups by name. */
  readonly lists: readonly PaletteItem[];
  readonly commands: readonly PaletteItem[];
}

interface Group {
  readonly name: string;
  readonly items: readonly PaletteItem[];
}

const USAGE_KEY = 'flint.palette.used';

function readUsage(): Record<string, number> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(USAGE_KEY) ?? '{}') as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function noteUsage(id: string): void {
  try {
    const usage = readUsage();
    usage[id] = (usage[id] ?? 0) + 1;
    window.localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch {
    // Nothing to keep: the order is only a convenience.
  }
}

/** The best of `items` for the query, with their matched letters. */
function matching(items: readonly PaletteItem[], query: string, limit: number): PaletteItem[] {
  return items
    .flatMap((item) => {
      const match = fuzzyMatch(query, item.label);
      const other = match ? null : fuzzyMatch(query, `${item.label} ${item.keywords ?? ''}`);
      const found = match ?? other;
      return found
        ? [
            {
              item: { ...item, indices: match ? match.indices : [] },
              score: found.score - (match ? 0 : 20),
            },
          ]
        : [];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

function highlighted(text: string, indices: readonly number[] | undefined): ReactNode {
  if (!indices || indices.length === 0) return text;
  const marks = new Set(indices);
  const parts: ReactElement[] = [];
  let at = 0;
  while (at < text.length) {
    const hit = marks.has(at);
    let end = at;
    while (end < text.length && marks.has(end) === hit) end++;
    const piece = text.slice(at, end);
    parts.push(
      hit ? (
        <span key={at} className="palette-hit">
          {piece}
        </span>
      ) : (
        <Fragment key={at}>{piece}</Fragment>
      ),
    );
    at = end;
  }
  return parts;
}

export function Palette(props: {
  readonly sources: PaletteSources;
  readonly search: (query: string, scope: 'live' | 'trash') => Promise<readonly SearchHit[]>;
  /** A search result as an item (opening it). */
  readonly hitItem: (hit: SearchHit) => PaletteItem;
  readonly onClose: () => void;
}): ReactElement {
  const { sources, search, hitItem, onClose } = props;
  const [query, setQuery] = useState('');
  const [steps, setSteps] = useState<readonly PaletteStep[]>([]);
  const [scope, setScope] = useState<'live' | 'trash'>('live');
  const [hits, setHits] = useState<readonly SearchHit[]>([]);
  const [selected, setSelected] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const pending = useRef<(() => void) | null>(null);
  const usage = useMemo(readUsage, []);
  const step = steps.at(-1) ?? null;

  useLayoutEffect(() => field.current?.focus(), []);
  // The lists and notes are searched in the main process, a moment after the last key.
  useEffect(() => {
    const text = query.trim();
    if (step || text === '') {
      setHits([]);
      return;
    }
    let current = true;
    // What the last query or scope found goes at once (never shown under another).
    setHits([]);
    const timer = window.setTimeout(() => {
      void search(text, scope).then((found) => {
        if (current) setHits(found);
      });
    }, 70);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [query, scope, step, search]);

  const groups: Group[] = useMemo(() => {
    const text = query.trim();
    if (step)
      return [
        { name: step.title, items: text === '' ? step.items : matching(step.items, text, 40) },
      ];
    if (text === '') {
      const used = [...sources.commands].sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0));
      return [
        { name: 'Recent', items: sources.recent.slice(0, 5) },
        { name: 'This task', items: sources.task },
        { name: 'Commands', items: used.slice(0, 6) },
      ].filter((group) => group.items.length > 0);
    }
    if (scope === 'trash') return [{ name: 'Trash and Archive', items: hits.map(hitItem) }];
    const tasks = hits.filter((hit) => hit.kind === 'task');
    const open = tasks.filter((hit) => !hit.done);
    const done = tasks.filter((hit) => hit.done);
    // D-107: always this order; what is inside notes comes last.
    const found: Group[] = [
      { name: 'Go to', items: matching(sources.places, text, 6) },
      { name: 'This task', items: matching(sources.task, text, 4) },
      { name: 'Commands', items: matching(sources.commands, text, 8) },
      { name: 'Tasks', items: [...open.slice(0, 8), ...done.slice(0, 4)].map(hitItem) },
      { name: 'Lists and notes', items: matching(sources.lists, text, 8) },
      {
        name: 'In notes',
        items: hits
          .filter((hit) => hit.kind === 'line')
          .slice(0, 5)
          .map(hitItem),
      },
    ].filter((group) => group.items.length > 0);
    return [
      ...found,
      {
        name: '',
        items: [
          {
            id: 'search-trash',
            label: 'Search Trash and Archive',
            detail: found.length === 0 ? 'Nothing else matches.' : undefined,
            run: () => {
              setScope('trash');
              setSelected(0);
            },
          },
        ],
      },
    ];
  }, [query, step, scope, hits, sources, usage, hitItem]);
  const flat = groups.flatMap((group) => group.items);
  const safe = Math.min(selected, Math.max(0, flat.length - 1));

  useLayoutEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${safe}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [safe, groups]);

  /** D-107: one step back (Trash and Archive, then the steps); false at the top. */
  const back = (): boolean => {
    if (scope === 'trash') setScope('live');
    else if (steps.length > 0) setSteps(steps.slice(0, -1));
    else return false;
    setQuery('');
    setSelected(0);
    field.current?.focus();
    return true;
  };
  const deep = scope === 'trash' || steps.length > 0;
  const close = (then?: () => void): void => {
    pending.current = then ?? null;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else setLeaving(true);
  };
  const finish = (): void => {
    const then = pending.current;
    pending.current = null;
    onClose();
    then?.();
  };
  const choose = (item: PaletteItem | undefined): void => {
    if (!item) return;
    if (item.step) {
      setSteps([...steps, item.step()]);
      setQuery('');
      setSelected(0);
      return;
    }
    if (item.id === 'search-trash') {
      item.run?.();
      return;
    }
    noteUsage(item.id);
    close(item.run);
  };

  let index = -1;
  return (
    <div
      className={leaving ? 'palette-layer leaving' : 'palette-layer'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) finish();
      }}
    >
      <div className="palette" role="dialog" aria-label="Search or run a command">
        <div className="palette-head">
          {deep && (
            <button
              type="button"
              className="palette-back"
              aria-label="Back"
              title="Back (Esc)"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => back()}
            >
              <BackIcon size={14} />
            </button>
          )}
          {steps.map((each) => (
            <span key={each.title} className="palette-crumb">
              {each.title} ›
            </span>
          ))}
          {scope === 'trash' && <span className="palette-crumb">Trash and Archive ›</span>}
          <input
            ref={field}
            className="palette-field"
            value={query}
            placeholder={step ? 'Choose…' : 'Search or run a command'}
            aria-label="Search or run a command"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const count = Math.max(1, flat.length);
                setSelected((safe + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                choose(flat[safe]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                if (!back()) close();
              } else if (event.key === 'Backspace' && query === '') {
                if (back()) event.preventDefault();
              }
            }}
          />
        </div>
        {/* D-137: data-query says which keystroke's results are on screen (the performance check). */}
        <div
          ref={list}
          className="palette-results"
          role="listbox"
          aria-label="Results"
          data-query={query}
        >
          {flat.length === 0 && (
            <p className="palette-empty">
              {scope === 'trash' ? 'Nothing in Trash or the archive matches.' : 'Nothing matches.'}
            </p>
          )}
          {groups.map((group) => (
            <div key={group.name || 'more'} className="palette-group">
              {group.name && <div className="palette-label">{group.name}</div>}
              {group.items.map((item) => {
                index++;
                const at = index;
                return (
                  <div
                    key={`${group.name}:${item.id}`}
                    role="option"
                    aria-selected={at === safe}
                    data-index={at}
                    className={[
                      'palette-item',
                      at === safe ? 'on' : '',
                      item.quiet ? 'quiet' : '',
                    ].join(' ')}
                    onMouseMove={() => {
                      if (at !== safe) setSelected(at);
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(item)}
                  >
                    <span className="palette-text">{highlighted(item.label, item.indices)}</span>
                    {item.detail && <span className="palette-detail">{item.detail}</span>}
                    {item.step && <span className="palette-more">›</span>}
                    {item.hint && <span className="keycap">{item.hint}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {/* D-107: the keys, and Ctrl+K for whoever came by mouse. */}
        <div className="palette-foot" aria-hidden="true">
          <span>
            <span className="keycap">↑↓</span> navigate
          </span>
          <span>
            <span className="keycap">Enter</span> open
          </span>
          <span>
            <span className="keycap">Esc</span> {deep ? 'back' : 'close'}
          </span>
          <span className="palette-foot-open">
            <span className="keycap">Ctrl K</span> opens this anywhere
          </span>
        </div>
      </div>
    </div>
  );
}

/** NAV-01, D-107: the sidebar header's search button (next to the Flint mark). */
export function PaletteButton(props: { readonly onOpen: () => void }): ReactElement {
  return (
    <button
      type="button"
      className="palette-button"
      aria-label="Search or run a command"
      title="Search or run a command (Ctrl+K)"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        // APP-14, D-107, D-113: opened with the mouse (the Ctrl+K tip counts it).
        window.dispatchEvent(new CustomEvent('flint:tip', { detail: 'paletteKey' }));
        props.onOpen();
      }}
    >
      <SearchIcon size={15} />
    </button>
  );
}
