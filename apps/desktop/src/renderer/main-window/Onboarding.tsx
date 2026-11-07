import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import whatsNewText from '../../../../../docs/whats-new.md?raw';
import { bodyHtml } from '../../shared/body-markdown.js';
import {
  TODAY_ID,
  type FolderChoice,
  type OnboardingState,
  type TourEvent,
} from '../../shared/ipc.js';
import { entriesSince, readWhatsNew, type WhatsNewEntry } from '../../shared/whats-new.js';
import { CloseIcon } from './icons.js';
import { FolderChangePanel } from './Settings.js';

/**
 * APP-10, APP-13, APP-15 (D-113, D-115 to D-120): onboarding in the main window. The spotlight (a
 * soft dim with the step's targets cut out and ringed, only they take clicks; a card beside them
 * that never takes the keyboard), the 8-step walkthrough that moves on by itself when you do the
 * thing, and the What's new card.
 */

let asked: Promise<OnboardingState | null> | null = null;
/** What onboarding shows on this start, asked once for the page (StrictMode runs effects twice). */
export function onboardingOnce(): Promise<OnboardingState | null> {
  asked ??= window.flintMain.onboarding();
  return asked;
}

/** A floating layer that takes Esc first (a menu, a picker, the palette). */
const FLOATING = '.fl-menu, .fl-picker, .palette-layer';

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// D-116: main's events reach whichever walkthrough is running (one listener for the page's life).
const tourListeners = new Set<(event: TourEvent) => void>();
let listening = false;
function onTourEvent(listener: (event: TourEvent) => void): () => void {
  if (!listening) {
    listening = true;
    window.flintMain.onTourEvent((event) => {
      for (const each of tourListeners) each(event);
    });
  }
  tourListeners.add(listener);
  return () => tourListeners.delete(listener);
}

const Key = (props: { readonly children: ReactNode }): ReactElement => (
  <span className="keycap">{props.children}</span>
);
const Token = (props: { readonly children: ReactNode }): ReactElement => (
  <span className="chip">{props.children}</span>
);

interface Step {
  readonly title: string;
  readonly text: ReactNode;
  /** What the ring goes around (each a selector; the first found of each). None: centred card. */
  readonly targets: readonly string[];
  /** Used when none of `targets` is on screen (step 5 with an empty Inbox: Today). */
  readonly fallback?: readonly string[];
  /**
   * D-122: what the step's target opens, live too but not ringed, and not where the card goes
   * (step 4: the quick note just made, the new list's name field).
   */
  readonly also?: readonly string[];
  /** On Inbox (steps 3 to 6). */
  readonly inbox?: boolean;
  /** What moves it on by itself (main's event); `list`: a list, note or quick note made. */
  readonly until?: TourEvent | 'palette';
}

/** D-120: the words, card by card (step 5's: D-121, Proposed). */
const STEPS: readonly Step[] = [
  {
    title: 'Welcome to Flint',
    text: null, // The folder's path and Change…, in the card itself.
    targets: [],
  },
  {
    title: 'Capture from anywhere',
    text: (
      <>
        In any app, press <Key>Ctrl+Shift+Space</Key>, type, Enter: it lands in Inbox.{' '}
        <Key>Ctrl+Shift+X</Key> captures the text you&rsquo;ve selected. Try it now.
      </>
    ),
    targets: [],
    until: 'captured',
  },
  {
    title: 'Shorthand as you type',
    text: (
      <>
        Add a task here: <Token>!h</Token> sets priority, <Token>@15:00</Token> a reminder,{' '}
        <Token>##Work</Token> a list. Shift+Enter adds notes; paste screenshots and code straight
        in.
      </>
    ),
    targets: ['.main .composer'],
    inbox: true,
    until: 'shorthand',
  },
  {
    title: 'Lists, notes, quick notes',
    text: (
      <>
        <strong>+</strong> makes a task list, a note or a group. <Key>Ctrl+Shift+J</Key> opens a
        quick note for a thought that isn&rsquo;t a task yet.
      </>
    ),
    targets: ['[aria-label="New list or note"]', '[title="Quick note (Ctrl+Shift+J)"]'],
    also: ['.main .note-card', '.sidebar .name-field'],
    inbox: true,
    until: 'made',
  },
  {
    title: 'Today',
    text: (
      <>
        Pin a task and it shows on Today, whatever list it&rsquo;s in. Click its pin, or select it
        and press <Key>P</Key>.
      </>
    ),
    // D-122: the faint pin on the first open task (shown on every row during this step).
    targets: ['.main .row[data-key]:not(.done) .pin-hover'],
    fallback: [`.nav[data-key="${TODAY_ID}"]`],
    inbox: true,
    until: 'pinned',
  },
  {
    title: 'Reminders',
    text: (
      <>
        Give a task a time (type <Token>@15:00</Token> or use the bell) and Windows reminds you, by
        default even during Do Not Disturb. Missed ones wait in Today&rsquo;s Overdue card.
      </>
    ),
    targets: ['.main .composer [aria-label="Set reminder"]'],
    inbox: true,
    until: 'reminder',
  },
  {
    title: 'Everything, one key away',
    text: (
      <>
        <Key>Ctrl+K</Key> finds any list, task or command. Press <Key>?</Key> (outside a text field)
        to see every shortcut.
      </>
    ),
    targets: ['.palette-button'],
    until: 'palette',
  },
  {
    title: 'Mini mode',
    text: (
      <>
        A small Flint that stays on top, for calls and meetings, and is hidden when you share your
        screen: this button or <Key>Ctrl+Alt+Space</Key>.
      </>
    ),
    targets: ['.mini-toggle'],
    until: 'mini-open',
  },
];
/** After the eighth: You're set. */
const DONE_STEP = STEPS.length;

interface Hole {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
}

/** D-61: the ring sits this far outside its target. */
const RING_OFFSET = 6;

/** The step's targets on screen now, as holes in the dim (empty: none found). */
function findHoles(selectors: readonly string[]): Hole[] {
  return selectors.flatMap((selector): Hole[] => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) return [];
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return [];
    const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
    return [
      {
        x: Math.round(rect.left - RING_OFFSET),
        y: Math.round(rect.top - RING_OFFSET),
        width: Math.round(rect.width + 2 * RING_OFFSET),
        height: Math.round(rect.height + 2 * RING_OFFSET),
        radius: Math.round(radius + RING_OFFSET),
      },
    ];
  });
}

const sameHoles = (a: readonly Hole[], b: readonly Hole[]): boolean =>
  a.length === b.length &&
  a.every(
    (hole, index) =>
      hole.x === b[index]?.x &&
      hole.y === b[index]?.y &&
      hole.width === b[index]?.width &&
      hole.height === b[index]?.height,
  );

interface Holes {
  /** Around the step's targets: ringed, and what the card sits beside. */
  readonly ringed: readonly Hole[];
  /** What a target opened (`also`): live, not ringed. */
  readonly open: readonly Hole[];
}
const NO_HOLES: Holes = { ringed: [], open: [] };

/** Where the step's targets are, followed every frame while it shows (they scroll and resize). */
function useHoles(step: Step | null): Holes {
  const [holes, setHoles] = useState<Holes>(NO_HOLES);
  useEffect(() => {
    if (!step) {
      setHoles(NO_HOLES);
      return;
    }
    let frame = 0;
    let last: Holes = NO_HOLES;
    const tick = (): void => {
      let ringed = findHoles(step.targets);
      if (ringed.length === 0 && step.fallback) ringed = findHoles(step.fallback);
      const open = step.also ? findHoles(step.also) : [];
      if (!sameHoles(ringed, last.ringed) || !sameHoles(open, last.open)) {
        last = { ringed, open };
        setHoles(last);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [step]);
  return holes;
}

/** The dim's outline with the holes cut out (even-odd), in window pixels. */
function dimPath(holes: readonly Hole[], width: number, height: number): string {
  const outer = `M0 0H${width}V${height}H0Z`;
  const cut = holes.map(({ x, y, width: w, height: h, radius }) => {
    const r = Math.min(radius, w / 2, h / 2);
    return (
      `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}` +
      `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
      `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
    );
  });
  return `path(evenodd, '${outer}${cut.join('')}')`;
}

/** The window's size, kept current. */
function useWindowSize(): { readonly width: number; readonly height: number } {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const resized = (): void => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resized);
    return () => window.removeEventListener('resize', resized);
  }, []);
  return size;
}

/** D-122: how long typing must pause before a step made by typing moves on (ms). */
const TYPING_PAUSE = 1500;

const CARD_GAP = 14;
const EDGE = 16;

/**
 * Where the card goes: beside the targets (to the right of the sidebar's, below or above the
 * others), or in the middle when there are none.
 */
function cardPlace(
  holes: readonly Hole[],
  card: { readonly width: number; readonly height: number },
  view: { readonly width: number; readonly height: number },
): { readonly left: number; readonly top: number } {
  const clampX = (x: number): number => Math.max(EDGE, Math.min(x, view.width - card.width - EDGE));
  const clampY = (y: number): number =>
    Math.max(EDGE, Math.min(y, view.height - card.height - EDGE));
  if (holes.length === 0)
    return {
      left: clampX((view.width - card.width) / 2),
      top: clampY((view.height - card.height) / 2.4),
    };
  const left = Math.min(...holes.map((hole) => hole.x));
  const top = Math.min(...holes.map((hole) => hole.y));
  const right = Math.max(...holes.map((hole) => hole.x + hole.width));
  const bottom = Math.max(...holes.map((hole) => hole.y + hole.height));
  const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
  if (sidebar && right <= sidebar.right + RING_OFFSET)
    return { left: clampX(right + CARD_GAP), top: clampY(top) };
  if (bottom + CARD_GAP + card.height <= view.height - EDGE)
    return { left: clampX(left), top: bottom + CARD_GAP };
  return { left: clampX(left), top: clampY(top - CARD_GAP - card.height) };
}

/** A button on the card: a click works, the keyboard stays where it was (D-115). */
function CardButton(props: {
  readonly primary?: boolean;
  readonly children: ReactNode;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={props.primary ? 'primary-button' : 'trash-action'}
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** How the walkthrough ended, for App (D-115: Esc and Skip all say where to replay it). */
export type TourEnd = 'done' | 'skipped' | 'remove';

/**
 * APP-10: the walkthrough, from `from` (0-based). It tells main each step (D-119: a restart in
 * step 1 goes on at step 2), and moves on when the step's thing happens.
 */
export function Walkthrough(props: {
  readonly from: number;
  readonly folder: string;
  readonly paletteOpen: boolean;
  /** Steps 3 to 6 are on Inbox. */
  readonly onInbox: () => void;
  readonly onEnd: (how: TourEnd) => void;
}): ReactElement | null {
  const { from, folder, paletteOpen, onInbox, onEnd } = props;
  const [step, setStep] = useState(from);
  const [choice, setChoice] = useState<FolderChoice | null>(null);
  const current = step < DONE_STEP ? (STEPS[step] ?? null) : null;
  const holes = useHoles(current);
  const view = useWindowSize();
  const card = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  // A fresh tour (or a replay) says so; a resumed one (D-119) goes on where it was.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (from === 0) void window.flintMain.tour({ kind: 'start' });
  }, [from]);

  const next = useCallback((): void => {
    setChoice(null);
    setStep((now) => {
      const after = Math.min(now + 1, DONE_STEP);
      void window.flintMain.tour({ kind: 'step', step: after });
      return after;
    });
  }, []);

  // Steps 3 to 6 on Inbox.
  const inbox = current?.inbox === true;
  useEffect(() => {
    if (inbox) onInbox();
  }, [inbox, step, onInbox]);

  // What moves the step on: main's events. D-122: the dim and the card stay while the capture
  // popup or mini mode is open (they float above them).
  const until = current?.until;
  useEffect(() => {
    let waiting: number | undefined;
    let typedLast = 0;
    const onKey = (): void => {
      typedLast = Date.now();
    };
    window.addEventListener('keydown', onKey, true);
    const stop = onTourEvent((event) => {
      if (event !== until) return;
      // D-122: something made while typing in it (a quick note's text) moves on once the typing
      // pauses, so the note isn't left mid-sentence.
      const typing = (): boolean => {
        const active = document.activeElement;
        return (
          active instanceof HTMLElement &&
          (active.isContentEditable || active instanceof HTMLTextAreaElement) &&
          Date.now() - typedLast < TYPING_PAUSE
        );
      };
      if (event !== 'made' || !typing()) {
        next();
        return;
      }
      const check = (): void => {
        if (typing()) waiting = window.setTimeout(check, 300);
        else next();
      };
      waiting = window.setTimeout(check, 300);
    });
    return () => {
      stop();
      window.clearTimeout(waiting);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [until, next]);
  // D-122: step 5 rings a row's faint pin, shown on every open row while it is up.
  useEffect(() => {
    document.body.dataset['tourStep'] = String(step + 1);
    return () => {
      delete document.body.dataset['tourStep'];
    };
  }, [step]);
  // Step 7: the palette opened (Ctrl+K or its button).
  useEffect(() => {
    if (until === 'palette' && paletteOpen) next();
  }, [until, paletteOpen, next]);

  // D-115: Esc ends it (as Skip all), unless a menu, picker or the palette takes it first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || document.querySelector(FLOATING)) return;
      event.preventDefault();
      event.stopPropagation();
      onEnd(step >= DONE_STEP ? 'done' : 'skipped');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onEnd, step]);

  // The card beside its targets, measured once it is laid out.
  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const placed = cardPlace(holes.ringed, { width, height }, view);
    setPlace((now) => (now?.left === placed.left && now.top === placed.top ? now : placed));
  });

  const ringed = current !== null && current.targets.length > 0;
  const dim = useMemo(
    () =>
      ringed && holes.ringed.length === 0
        ? null
        : dimPath(ringed ? [...holes.ringed, ...holes.open] : [], view.width, view.height),
    [ringed, holes, view],
  );

  const body =
    step >= DONE_STEP ? (
      <>
        <div className="spotlight-head">
          <span className="spotlight-title">You&rsquo;re set</span>
        </div>
        <p className="spotlight-text">
          Replay this tour any time from Settings. Flint will point out a few more things as you go;
          you can turn tips off in Settings.
        </p>
        <div className="spotlight-actions">
          <CardButton onClick={() => onEnd('remove')}>
            Remove what I created during the tour
          </CardButton>
          <CardButton primary onClick={() => onEnd('done')}>
            Done
          </CardButton>
        </div>
      </>
    ) : (
      <>
        <div className="spotlight-head">
          <span className="spotlight-title">{current?.title}</span>
          <span className="spotlight-count">
            {step + 1} / {STEPS.length}
          </span>
        </div>
        {step === 0 ? (
          <>
            <p className="spotlight-text">
              Your lists and notes are plain markdown files in{' '}
              <span className="settings-path">{folder}</span>, readable in Obsidian or any editor.
              Nothing leaves your computer.
            </p>
            {choice ? (
              <FolderChangePanel
                choice={choice}
                onChooseAgain={() =>
                  void window.flintMain.chooseFolder().then((again) => setChoice(again))
                }
                onCancel={() => setChoice(null)}
              />
            ) : (
              <div className="spotlight-folder">
                <CardButton
                  onClick={() =>
                    void window.flintMain.chooseFolder().then((picked) => setChoice(picked))
                  }
                >
                  Change…
                </CardButton>
              </div>
            )}
            <p className="spotlight-note">Skip now, replay any time from Settings.</p>
          </>
        ) : (
          <p className="spotlight-text">{current?.text}</p>
        )}
        <div className="spotlight-actions">
          <CardButton onClick={() => onEnd('skipped')}>Skip all</CardButton>
          <CardButton primary onClick={next}>
            Next
          </CardButton>
        </div>
      </>
    );

  return (
    <div className="spotlight" data-step={step + 1}>
      {dim !== null && (
        <div className="spotlight-dim" style={{ clipPath: dim }} aria-hidden="true" />
      )}
      {ringed &&
        holes.ringed.map((hole, index) => (
          <div
            key={index}
            className="spotlight-ring"
            aria-hidden="true"
            style={{
              left: hole.x,
              top: hole.y,
              width: hole.width,
              height: hole.height,
              borderRadius: hole.radius,
            }}
          />
        ))}
      <div
        key={step}
        ref={card}
        className={`spotlight-card${step >= DONE_STEP ? ' wide' : ''}${place ? '' : ' measuring'}`}
        role="dialog"
        aria-label={step >= DONE_STEP ? 'You’re set' : (current?.title ?? '')}
        style={place ? { left: place.left, top: place.top } : undefined}
      >
        {body}
      </div>
    </div>
  );
}

const ALL_ENTRIES = readWhatsNew(whatsNewText);

/**
 * APP-15, D-117: What's new: the plain-language entries of `docs/whats-new.md` since the last
 * version seen (`since` undefined: every entry, from the palette or Settings). A floating card
 * without a dim; Esc or × closes it.
 */
export function WhatsNew(props: {
  readonly version: string;
  readonly since: string | null | undefined;
  readonly onClose: () => void;
}): ReactElement | null {
  const { version, since, onClose } = props;
  const entries: WhatsNewEntry[] = useMemo(
    () => entriesSince(ALL_ENTRIES, since === undefined ? '0.0.0' : since, version),
    [since, version],
  );
  const [leaving, setLeaving] = useState(false);
  const close = useCallback((): void => {
    if (reducedMotion()) onClose();
    else setLeaving(true);
  }, [onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || document.querySelector(FLOATING)) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);
  useEffect(() => {
    if (entries.length === 0) onClose();
  }, [entries, onClose]);
  if (entries.length === 0) return null;
  return (
    <div
      className={leaving ? 'spotlight-card whats-new leaving' : 'spotlight-card whats-new'}
      role="dialog"
      aria-label="What’s new"
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="spotlight-head">
        <span className="spotlight-title">What&rsquo;s new</span>
        <button
          type="button"
          tabIndex={-1}
          className="whats-new-close"
          aria-label="Close"
          onMouseDown={(event) => event.preventDefault()}
          onClick={close}
        >
          <CloseIcon size={13} />
        </button>
      </div>
      <div className="whats-new-entries">
        {entries.map((entry) => (
          <section key={entry.version} className="whats-new-entry">
            <h3 className="whats-new-version">
              Flint {entry.version}
              {entry.date && <span className="whats-new-date">{entry.date}</span>}
            </h3>
            <div
              className="whats-new-text"
              dangerouslySetInnerHTML={{ __html: bodyHtml(entry.markdown) }}
            />
          </section>
        ))}
      </div>
      <div className="spotlight-actions">
        <CardButton primary onClick={close}>
          Got it
        </CardButton>
      </div>
    </div>
  );
}
