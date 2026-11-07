import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { hasPresetLink } from '../../shared/link-patterns.js';
import { TIPS, tipParts, type TipId } from '../../shared/tips.js';
import { CloseIcon } from './icons.js';
import { onboardingOnce } from './Onboarding.js';

/**
 * APP-14 (D-113, D-118, D-125): the contextual tips in the main window. A pattern anywhere says so
 * with `tipHappened` (or the `flint:tip` event); main counts it and says when its tip is due (at
 * most two a session, ten minutes apart). The tip
 * then waits for 2 s without typing, with no menu, picker, palette or dialog open, and not while
 * the walkthrough, triage or What's new is up; it shows in the bottom-right corner, never taking
 * the focus, until × or Got it or the window is hidden. It counts as seen after about 3 s on
 * screen, or when closed; hidden sooner, it comes back the next time it can.
 */

/** A pattern happened (anywhere in the page; mini mode's page has no tips and ignores it). */
export function tipHappened(tip: TipId): void {
  window.dispatchEvent(new CustomEvent<TipId>('flint:tip', { detail: tip }));
}

/** What a tip waits for to go away. */
const OPEN = '.fl-menu, .fl-picker, .palette-layer, .cheat-sheet, [role="dialog"]';
const QUIET_MS = 2000;
const SEEN_MS = 3000;
/** D-113: a task added within this long of bringing Flint to the front (the capture tip). */
const FRONT_MS = 60_000;

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function TipLayer(props: {
  /** The walkthrough, triage or What's new is up (D-118). */
  readonly blocked: boolean;
  /** Don't show tips, from the card. */
  readonly onOff: () => void;
}): ReactElement | null {
  const { blocked, onOff } = props;
  const [due, setDue] = useState<{ readonly tip: TipId; readonly at: number } | null>(null);
  const [shown, setShown] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const seen = useRef(false);
  const typedAt = useRef(0);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  // The patterns: said by the page (`flint:tip`), and the two this layer sees itself.
  useEffect(() => {
    const ask = (tip: TipId): void => {
      void window.flintMain.tipEvent(tip).then((now) => {
        if (now) setDue((current) => current ?? { tip, at: Date.now() });
      });
    };
    const onTip = (event: Event): void => ask((event as CustomEvent<TipId>).detail);
    const onKey = (): void => {
      typedAt.current = Date.now();
    };
    // D-113: the first paste of an Azure DevOps, GitHub or Jira link.
    const onPaste = (event: ClipboardEvent): void => {
      if (hasPresetLink(event.clipboardData?.getData('text/plain') ?? '')) ask('links');
    };
    window.addEventListener('flint:tip', onTip);
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('paste', onPaste, true);
    return () => {
      window.removeEventListener('flint:tip', onTip);
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('paste', onPaste, true);
    };
  }, []);

  // Whether the window is on screen (main says: a hidden window's page may not know).
  const onScreen = useRef(false);
  const hiddenNow = useRef<() => void>(() => undefined);
  useEffect(() => {
    void onboardingOnce().then((state) => {
      onScreen.current = state?.visible ?? true;
    });
    window.flintMain.onShown(() => {
      onScreen.current = true;
    });
    window.flintMain.onHidden(() => {
      onScreen.current = false;
      hiddenNow.current();
    });
  }, []);

  // D-118: shown once things are quiet; hidden with the window before it was seen, it comes back.
  useEffect(() => {
    if (!due) return;
    if (shown) {
      hiddenNow.current = () => {
        setShown(false);
        // Seen already: it goes with the window; not yet: it comes back.
        if (seen.current) setDue(null);
      };
      return () => {
        hiddenNow.current = () => undefined;
      };
    }
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (
        now - due.at >= QUIET_MS &&
        now - typedAt.current >= QUIET_MS &&
        onScreen.current &&
        !blockedRef.current &&
        !document.querySelector(OPEN)
      )
        setShown(true);
    }, 250);
    return () => window.clearInterval(timer);
  }, [due, shown]);

  useEffect(() => {
    seen.current = false;
  }, [due]);
  const markSeen = useCallback((): void => {
    if (!due || seen.current) return;
    seen.current = true;
    void window.flintMain.tipShown(due.tip);
  }, [due]);
  // About 3 s on screen: seen.
  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(markSeen, SEEN_MS);
    return () => window.clearTimeout(timer);
  }, [shown, markSeen]);

  const close = (): void => {
    markSeen();
    if (reducedMotion()) {
      setDue(null);
      setShown(false);
    } else setLeaving(true);
  };

  if (!due || !shown) return null;
  return (
    <aside
      className={leaving ? 'tip-card leaving' : 'tip-card'}
      aria-label="Tip"
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) {
          setDue(null);
          setShown(false);
          setLeaving(false);
        }
      }}
    >
      <p className="tip-text">
        {tipParts(TIPS[due.tip].text).map((part, index) =>
          part.key ? (
            <span key={index} className="keycap">
              {part.text}
            </span>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </p>
      <div className="tip-actions">
        <button
          type="button"
          tabIndex={-1}
          className="tip-off"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onOff();
            close();
          }}
        >
          Don&rsquo;t show tips
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="trash-action"
          onMouseDown={(event) => event.preventDefault()}
          onClick={close}
        >
          Got it
        </button>
      </div>
      <button
        type="button"
        tabIndex={-1}
        className="tip-close"
        aria-label="Close"
        onMouseDown={(event) => event.preventDefault()}
        onClick={close}
      >
        <CloseIcon size={12} />
      </button>
    </aside>
  );
}

/**
 * D-113: the capture tip's pattern: a task added in the main window within a minute of bringing
 * Flint to the front from another app (once for each time it came to the front).
 */
export function useFrontAdds(): () => void {
  const frontAt = useRef(0);
  useEffect(() => {
    const onFocus = (): void => {
      frontAt.current = Date.now();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  return useCallback((): void => {
    if (frontAt.current !== 0 && Date.now() - frontAt.current < FRONT_MS) {
      frontAt.current = 0;
      tipHappened('captureAnywhere');
    }
  }, []);
}
