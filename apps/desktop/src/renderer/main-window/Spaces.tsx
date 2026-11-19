/**
 * Spaces in the main window (SPACE-02, SPACE-03, SPACE-05; D-189, D-190; mockup 18 concept 1,
 * "the space line"; values in docs/09 §8): the space tile, the switcher under the line with its
 * menu (Ctrl+Shift+S, 1–9), New space ("On this PC" until S3), and the space's letter that rows
 * from a shared space carry outside the sidebar (a click switches the sidebar to that space).
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { SpaceView } from '../../shared/ipc.js';
import { spaceLetter } from '../ui/SpaceLetter.js';
import { CheckIcon, ChevronDownIcon, PersonIcon, PlusIcon } from './icons.js';
import { SyncDialog, useDismiss } from './Sync.js';

export const PERSONAL_SPACE = 'personal';

/** The space tile (09 §8): 22 px in the switcher, 28 in the menu, 38 in dialogs. */
export function SpaceTile(props: {
  readonly space: Pick<SpaceView, 'name' | 'kind'>;
  readonly size?: 'm' | 'menu' | 'xl';
  readonly pop?: boolean;
}): ReactElement {
  const { space, size = 'm' } = props;
  const glyph = size === 'xl' ? 19 : size === 'menu' ? 15 : 13;
  return (
    <span className={`stile ${size}${props.pop ? ' tpop' : ''}`} aria-hidden="true">
      {space.kind === 'personal' ? <PersonIcon size={glyph} /> : spaceLetter(space.name)}
    </span>
  );
}

/** The line under a space's name in the menu (SPACE-03). */
function spaceSub(space: SpaceView): string {
  return space.kind === 'personal' ? 'Only you · your devices' : 'Only you · on this PC';
}

/**
 * The switcher row (SPACE-02): the space's tile, name and chevron (a click opens the menu), then
 * the space's tools (its cloud, sort and +), passed in. `morph` replays the name's arrival.
 */
export function SpaceHead(props: {
  readonly space: SpaceView;
  readonly menuOpen: boolean;
  readonly pop: boolean;
  readonly onMenu: (at: DOMRect) => void;
  readonly children: ReactNode;
}): ReactElement {
  const { space } = props;
  return (
    <div className="space-head">
      <button
        type="button"
        className={props.menuOpen ? 'space-btn open' : 'space-btn'}
        title="Switch space (Ctrl+Shift+S)"
        aria-haspopup="menu"
        aria-expanded={props.menuOpen}
        onClick={(event) => props.onMenu(event.currentTarget.getBoundingClientRect())}
      >
        {/* The key replays the switch's arrival (rise and fade, 09 §8) on every new space. */}
        <span className="space-btn-parts" key={space.id}>
          <SpaceTile space={space} pop={props.pop} />
          <span className="space-name">{space.name}</span>
          <span className="space-chev">
            <ChevronDownIcon />
          </span>
        </span>
      </button>
      {props.children}
    </div>
  );
}

/**
 * The space menu (SPACE-03): every space with its tile, name, sub line, the current one's check and
 * its number key; then New space…. ↑/↓ and Enter as in menus (nothing highlighted when it opens,
 * D-76), 1–9 pick, Esc or a click outside closes.
 */
export function SpaceMenu(props: {
  readonly at: DOMRect;
  readonly spaces: readonly SpaceView[];
  readonly current: string;
  readonly onPick: (id: string) => void;
  readonly onNew: () => void;
  readonly onClose: () => void;
}): ReactElement {
  const { at, spaces, current, onPick, onNew, onClose } = props;
  const card = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  useDismiss(card, onClose);
  useLayoutEffect(() => card.current?.focus(), []);
  const count = spaces.length + 1;
  const choose = (index: number): void => {
    const space = spaces[index];
    if (space) onPick(space.id);
    else if (index === spaces.length) onNew();
  };
  return (
    <div
      ref={card}
      className="space-menu"
      role="menu"
      aria-label="Spaces"
      tabIndex={-1}
      style={{ left: Math.max(8, at.left - 2), top: at.bottom + 6 }}
      onKeyDown={(event) => {
        const digit = /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
        if (digit >= 0 && digit < spaces.length && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          event.stopPropagation();
          choose(digit);
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          const step = event.key === 'ArrowDown' ? 1 : -1;
          setActive((now) =>
            now === null ? (step > 0 ? 0 : count - 1) : (now + step + count) % count,
          );
          return;
        }
        if (event.key === 'Enter' && active !== null) {
          event.preventDefault();
          event.stopPropagation();
          choose(active);
        }
      }}
    >
      <div className="space-menu-label">
        <span>Spaces</span>
        <span className="k">Ctrl+Shift+S</span>
      </div>
      {spaces.map((space, index) => (
        <button
          key={space.id}
          type="button"
          role="menuitemradio"
          aria-checked={space.id === current}
          className={active === index ? 'sm-row active' : 'sm-row'}
          onMouseEnter={() => setActive(index)}
          onClick={() => onPick(space.id)}
        >
          <SpaceTile space={space} size="menu" />
          <span className="sm-txt">
            <span className="sm-name">{space.name}</span>
            <span className="sm-sub">{spaceSub(space)}</span>
          </span>
          <span className="sm-state">
            <span
              className="sm-cur"
              title={space.id === current ? 'The space you are in' : undefined}
            >
              {space.id === current && <CheckIcon size={13} />}
            </span>
            {index < 9 && <span className="kc">{index + 1}</span>}
          </span>
        </button>
      ))}
      <div className="space-menu-divider" />
      <button
        type="button"
        role="menuitem"
        className={active === spaces.length ? 'space-menu-item active' : 'space-menu-item'}
        onMouseEnter={() => setActive(spaces.length)}
        onClick={onNew}
      >
        <PlusIcon size={14} />
        <span className="grow">New space…</span>
      </button>
    </div>
  );
}

/**
 * New space… (SPACE-05, D-190 Q14; until S3 a space "On this PC": the kind choice and sharing
 * come with Google, drawn in mockup 18's style first). `onCreate` answers a problem or null.
 */
export function NewSpaceDialog(props: {
  readonly onCreate: (name: string) => Promise<string | null>;
  readonly onClose: () => void;
}): ReactElement {
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  return (
    <SyncDialog label="New space" className="space-dialog" onClose={props.onClose}>
      {(close) => {
        const create = async (): Promise<void> => {
          if (busy) return;
          setBusy(true);
          const answer = await props.onCreate(name);
          setBusy(false);
          if (answer) setProblem(answer);
          else close();
        };
        return (
          <>
            <div className="space-dialog-head">
              <SpaceTile space={{ name: name.trim() || 'N', kind: 'local' }} size="xl" />
              <div className="space-dialog-titles">
                <span className="space-dialog-title">New space</span>
                <span className="space-dialog-sub">
                  On this PC · its own lists, notes and groups
                </span>
              </div>
            </div>
            <p className="space-dialog-text">
              A space has its own sidebar. Today, Inbox, reminders and search still show everything,
              and captures still go to your Inbox.
            </p>
            <label className="space-field-label" htmlFor="space-name">
              Name
            </label>
            <input
              id="space-name"
              ref={field}
              className={problem ? 'space-field problem' : 'space-field'}
              value={name}
              maxLength={60}
              placeholder="Home, Work, Trip…"
              onChange={(event) => {
                setName(event.target.value);
                setProblem(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void create();
                }
              }}
            />
            {problem && <span className="space-field-problem">{problem}</span>}
            <div className="sync-dialog-foot">
              <div className="sync-dialog-buttons">
                <button type="button" className="quiet-button" onClick={close}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={name.trim() === '' || busy}
                  onClick={() => void create()}
                >
                  Create
                </button>
              </div>
            </div>
          </>
        );
      }}
    </SyncDialog>
  );
}

/** SPACE-03: the letter lives in ui/ (mini mode and the popup use it too). */
export { SpaceLetter, spaceLetter } from '../ui/SpaceLetter.js';
