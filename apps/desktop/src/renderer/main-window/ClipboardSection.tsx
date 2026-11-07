import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { ClipboardItemView, ClipboardView } from '../../shared/ipc.js';
import { CLIP_KIND_LABEL, clipAge, clipBarWidth, clipPreview } from '../../shared/clipboard.js';
import { ChevronIcon, EyeIcon, EyeOffIcon } from './icons.js';

/**
 * NAV-08 (D-86, D-127, D-128): the Clipboard section, docked at the foot of the side panel in
 * every state (it stays in place while the panel's content scrolls behind it). Windows' own
 * clipboard history, text items only, newest first: collapsed, its newest three; open, all of them,
 * scrolling (up to about 45 % of the panel); open or not is remembered on this machine.
 *
 * Screen sharing (D-128): at rest a row is a placeholder bar with its kind and age, never the text;
 * the text shows while the pointer rests on the section (300 ms without moving) and goes the moment
 * it leaves, or always with Always show contents (the eye). A click acts as a paste in the field
 * that has the keyboard (nothing here takes the focus); the right-click menu has Insert, Capture as
 * task and Copy.
 */

const OPEN_KEY = 'flint.clipboard.open';
/** D-128: how long the pointer rests on the section before its contents show. */
const REST_MS = 300;

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
        : { text: 'Copy some text and it shows here.', word: null, action: null };
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
    (item, index) => item.id === b.items[index]?.id && item.text === b.items[index]?.text,
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

export function ClipboardSection(props: {
  /** A click: the item into the field that has the keyboard (D-128 Q4). */
  readonly onInsert: (item: ClipboardItemView) => void;
  readonly onMenu: (item: ClipboardItemView, at: { x: number; y: number }) => void;
  readonly onSettings: () => void;
  readonly onShowContents: (show: boolean) => void;
}): ReactElement | null {
  const { onInsert, onMenu, onSettings, onShowContents } = props;
  const { view, now, refresh } = useClipboardView();
  const onRetry = (): void => refresh(true);
  const [open, setOpen] = useState(storedOpen);
  const [revealed, setRevealed] = useState(false);
  const [pressed, setPressed] = useState<string | null>(null);
  const resting = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resting.current), []);
  useEffect(() => {
    if (pressed === null) return;
    const timer = window.setTimeout(() => setPressed(null), 320);
    return () => window.clearTimeout(timer);
  }, [pressed]);

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
  const shown = view.showContents || revealed;
  const note = clipboardNote(view);
  const count = view.state === 'ok' || view.state === 'error' ? view.items.length : null;
  const word = note?.word ?? null;
  // Every row is there; folded, the section is three rows high (so it folds both ways smoothly).
  const rows = view.items;
  const keep = (event: React.MouseEvent): void => event.preventDefault();

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
            <div className="clip-rows">
              {rows.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  tabIndex={-1}
                  className={pressed === item.id ? 'clip-row pressed' : 'clip-row'}
                  data-kind={item.kind}
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
                  {shown ? (
                    <span className="clip-text">{clipPreview(item.text)}</span>
                  ) : (
                    <>
                      <span
                        className="clip-bar"
                        aria-hidden="true"
                        style={{ width: `${clipBarWidth(item.text)}%` }}
                      />
                      <span className="clip-kind">{CLIP_KIND_LABEL[item.kind]}</span>
                    </>
                  )}
                  <span className="clip-age">{clipAge(item.at, now)}</span>
                </button>
              ))}
            </div>
          )}
    </section>
  );
}
