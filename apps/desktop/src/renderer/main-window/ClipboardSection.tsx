import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type { ClipboardItemView, ClipboardView } from '../../shared/ipc.js';
import { CLIP_KIND_LABEL, clipAge, clipBarWidth, clipPreview } from '../../shared/clipboard.js';
import { usePresence } from '../ui/presence.js';
import { ChevronIcon, EyeIcon, EyeOffIcon } from './icons.js';

/**
 * NAV-08 (D-86, D-127 to D-129): the Clipboard section, docked at the foot of the side panel in
 * every state (it stays in place while the panel's content scrolls behind it). Windows' own
 * clipboard history, newest first, text and pictures (thumbnails, D-129): folded, its newest three;
 * open, all of them, scrolling (up to about 45 % of the panel); open or not is remembered here.
 *
 * Screen sharing (D-128): at rest a row is a placeholder (a bar sized to the text, a tile for a
 * picture) with its kind and age, never the content; the content crossfades in once the pointer
 * rests on the section (300 ms without moving) and out the moment it leaves, or shows always with
 * the eye. A click acts as a paste in the field that has the keyboard (nothing here takes the
 * focus); right-click: Insert, Capture as task, Copy, Delete. Items arriving slide in, items going
 * fold away (D-89, D-129). Clear all asks first, inline.
 */

const OPEN_KEY = 'flint.clipboard.open';
/** D-128: how long the pointer rests on the section before its contents show. */
const REST_MS = 300;
/** D-129: how long the content takes to fade out (the page's fast duration). */
const FADE_MS = 140;

function storedOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** D-128 Q7: the note an open section shows instead of rows, and the collapsed header's word. */
export function clipboardNote(view: ClipboardView): {
  readonly text: string;
  readonly word: string | null;
  readonly action: 'settings' | 'retry' | null;
} | null {
  switch (view.state) {
    case 'off':
      return {
        text: 'Clipboard history is off in Windows. Turn it on to see what you copy here.',
        word: 'off',
        action: 'settings',
      };
    case 'policy':
      return {
        text: 'Clipboard history is turned off on this PC, possibly by your organisation.',
        word: 'off',
        action: null,
      };
    case 'paused':
      return {
        text: 'Reading clipboard history stopped Flint last time, so it’s paused.',
        word: 'paused',
        action: 'retry',
      };
    case 'error':
      return view.items.length > 0
        ? null
        : { text: 'Clipboard history couldn’t be read.', word: 'unavailable', action: 'retry' };
    case 'ok':
      return view.items.length > 0
        ? null
        : { text: 'Copy something and it shows here.', word: null, action: null };
    default:
      return null;
  }
}

/** Two views that show the same (no new render for a poll that found nothing new). */
const sameView = (a: ClipboardView | null, b: ClipboardView): boolean =>
  a !== null &&
  a.state === b.state &&
  a.showContents === b.showContents &&
  a.items.length === b.items.length &&
  a.items.every(
    (item, index) =>
      item.id === b.items[index]?.id &&
      item.text === b.items[index]?.text &&
      item.thumb === b.items[index]?.thumb,
  );

/** D-128: how often the section asks main (main reads only when something new was copied). */
const POLL_MS = 1000;

/**
 * D-128: Windows' clipboard history while the section is on screen: asked when it appears, when
 * the window comes to the front and every second; the last items stay meanwhile. Its own state, so
 * a poll never renders more than the section; the ages' clock moves once a minute.
 */
function useClipboardView(): {
  readonly view: ClipboardView | null;
  readonly now: number;
  readonly refresh: (retry?: boolean) => void;
} {
  const [view, setView] = useState<ClipboardView | null>(null);
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));
  const refresh = useCallback((retry = false): void => {
    void window.flintMain.clipboard(retry).then((next) => {
      if (!next) return;
      setView((before) => (sameView(before, next) ? before : next));
      setMinute(Math.floor(Date.now() / 60_000));
    });
  }, []);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => refresh(), POLL_MS);
    const front = (): void => refresh();
    window.addEventListener('focus', front);
    window.addEventListener('flint:clipboard', front);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', front);
      window.removeEventListener('flint:clipboard', front);
    };
  }, [refresh]);
  return { view, now: minute * 60_000 + 59_999, refresh };
}

/** D-128: a setting changed elsewhere (the palette, Settings): the section asks again at once. */
export function clipboardChanged(): void {
  window.dispatchEvent(new Event('flint:clipboard'));
}

/**
 * D-129: shown and fading: content stays drawn while it fades out (FADE_MS) after `shown` turns
 * off, then leaves the page (D-128: no content in the page at rest).
 */
function useFading(shown: boolean): boolean {
  const [fading, setFading] = useState(false);
  const was = useRef(shown);
  useEffect(() => {
    const before = was.current;
    was.current = shown;
    if (before && !shown) {
      setFading(true);
      const timer = window.setTimeout(() => setFading(false), FADE_MS);
      return () => window.clearTimeout(timer);
    }
    if (shown) setFading(false);
    return undefined;
  }, [shown]);
  return fading;
}

export function ClipboardSection(props: {
  /** A click: the item into the field that has the keyboard (D-128 Q4). */
  readonly onInsert: (item: ClipboardItemView) => void;
  readonly onMenu: (item: ClipboardItemView, at: { x: number; y: number }) => void;
  readonly onSettings: () => void;
  readonly onShowContents: (show: boolean) => void;
  /** D-129: Clear all, confirmed; resolves once Windows cleared it. */
  readonly onClear: () => Promise<void>;
}): ReactElement | null {
  const { onInsert, onMenu, onSettings, onShowContents, onClear } = props;
  const { view, now, refresh } = useClipboardView();
  const onRetry = (): void => refresh(true);
  const [open, setOpen] = useState(storedOpen);
  const [revealed, setRevealed] = useState(false);
  const [pressed, setPressed] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const resting = useRef<number | undefined>(undefined);
  const rowsBox = useRef<HTMLDivElement>(null);
  useEffect(() => () => window.clearTimeout(resting.current), []);
  useEffect(() => {
    if (pressed === null) return;
    const timer = window.setTimeout(() => setPressed(null), 320);
    return () => window.clearTimeout(timer);
  }, [pressed]);
  const shown = (view?.showContents ?? false) || revealed;
  const fading = useFading(shown);
  // D-89, D-129: an item that went (deleted, cleared, fallen off) folds away where it was.
  const { entries: rows, gone } = usePresence(view?.items ?? [], (item) => item.id);
  // Folded, the section is as high as its first three rows (pictures make rows taller).
  useLayoutEffect(() => {
    const box = rowsBox.current;
    if (!box) return;
    const heights = [...box.querySelectorAll<HTMLElement>('.clip-row:not(.leaving)')]
      .slice(0, 3)
      .map((row) => row.offsetHeight);
    box.style.setProperty('--clip-folded', `${heights.reduce((sum, each) => sum + each, 0)}px`);
  });

  const flip = (): void => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    } catch {
      // Not remembered; it still opens.
    }
  };
  // D-128: shown only after the pointer rests (a pointer passing by shows nothing).
  const rest = (): void => {
    if (revealed) return;
    window.clearTimeout(resting.current);
    resting.current = window.setTimeout(() => setRevealed(true), REST_MS);
  };
  const leave = (): void => {
    window.clearTimeout(resting.current);
    setRevealed(false);
  };

  if (!view || view.state === 'disabled') return null;
  const note = clipboardNote(view);
  const count = view.state === 'ok' || view.state === 'error' ? view.items.length : null;
  const word = note?.word ?? null;
  const keep = (event: React.MouseEvent): void => event.preventDefault();
  const canClear = (view.state === 'ok' || view.state === 'error') && view.items.length > 0;

  return (
    <section
      className={`clip-section${open ? ' open' : ''}${shown ? ' shown' : ''}`}
      aria-label="Clipboard"
      onPointerEnter={rest}
      onPointerMove={rest}
      onPointerLeave={leave}
    >
      <div className="clip-head">
        <button
          type="button"
          tabIndex={-1}
          className="clip-fold"
          aria-expanded={open}
          onMouseDown={keep}
          onClick={flip}
        >
          <span className="chev">
            <ChevronIcon size={10} />
          </span>
          <span className="panel-label">Clipboard</span>
          {word !== null ? (
            <span className="clip-count">{word}</span>
          ) : (
            count !== null && <span className="clip-count">{count}</span>
          )}
        </button>
        {canClear && (
          <button
            type="button"
            tabIndex={-1}
            className="clip-clear"
            onMouseDown={keep}
            onClick={() => setConfirming((now) => !now)}
          >
            Clear all
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          className={view.showContents ? 'clip-eye on' : 'clip-eye'}
          aria-pressed={view.showContents}
          aria-label="Always show contents"
          title={view.showContents ? 'Hide contents until pointed at' : 'Always show contents'}
          onMouseDown={keep}
          onClick={() => onShowContents(!view.showContents)}
        >
          {view.showContents ? <EyeIcon size={13} /> : <EyeOffIcon size={13} />}
        </button>
      </div>
      {confirming && canClear && (
        <div className="clip-confirm" role="alertdialog" aria-label="Clear clipboard history">
          <p>
            Clear clipboard history? This also clears Win+V and can’t be undone. Pinned items in
            Win+V are kept.
          </p>
          <div className="clip-confirm-actions">
            <button
              type="button"
              tabIndex={-1}
              className="trash-action danger"
              onMouseDown={keep}
              onClick={() => {
                setConfirming(false);
                void onClear().then(() => refresh());
              }}
            >
              Clear
            </button>
            <button
              type="button"
              tabIndex={-1}
              className="trash-action"
              onMouseDown={keep}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {note
        ? open && (
            <div className="clip-note">
              <p>{note.text}</p>
              {note.action && (
                <button
                  type="button"
                  tabIndex={-1}
                  className="trash-action"
                  onMouseDown={keep}
                  onClick={note.action === 'settings' ? onSettings : onRetry}
                >
                  {note.action === 'settings' ? 'Open clipboard settings' : 'Try again'}
                </button>
              )}
            </div>
          )
        : rows.length > 0 && (
            <div className="clip-rows" ref={rowsBox}>
              {rows.map(({ item, key, leaving }) => (
                <button
                  key={key}
                  type="button"
                  tabIndex={-1}
                  className={`clip-row${item.kind === 'image' ? ' image' : ''}${pressed === item.id ? ' pressed' : ''}${leaving ? ' leaving' : ''}`}
                  data-kind={item.kind}
                  inert={leaving}
                  onAnimationEnd={(event) => {
                    if (leaving && event.target === event.currentTarget) gone(key);
                  }}
                  onMouseDown={keep}
                  onClick={() => {
                    setPressed(item.id);
                    onInsert(item);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onMenu(item, { x: event.clientX, y: event.clientY });
                  }}
                >
                  <span className="clip-face">
                    <span className={shown ? 'clip-rest out' : 'clip-rest'} aria-hidden={shown}>
                      {item.kind === 'image' ? (
                        <span className="clip-tile" />
                      ) : (
                        <span
                          className="clip-bar"
                          style={{ width: `${clipBarWidth(item.text)}%` }}
                        />
                      )}
                      <span className="clip-kind">{CLIP_KIND_LABEL[item.kind]}</span>
                    </span>
                    {(shown || fading) &&
                      (item.kind === 'image' ? (
                        <img
                          className={shown ? 'clip-thumb' : 'clip-thumb out'}
                          src={item.thumb}
                          alt="Picture"
                          draggable={false}
                        />
                      ) : (
                        <span className={shown ? 'clip-text' : 'clip-text out'}>
                          {clipPreview(item.text)}
                        </span>
                      ))}
                  </span>
                  <span className="clip-age">{clipAge(item.at, now)}</span>
                </button>
              ))}
            </div>
          )}
    </section>
  );
}
