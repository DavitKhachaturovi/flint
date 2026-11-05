/** Shared timing and presence hooks (UI-04, TODAY-03), for the main window and mini mode (D-110). */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { reducedMotion } from './motion.js';

/** D-92: the time, ticking every `step` ms (on the step), for countdowns and the now line. */
export function useNow(step = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    const tick = (): void => {
      const at = new Date();
      setNow(at);
      timer = window.setTimeout(tick, step - (at.getTime() % step) + 5);
    };
    timer = window.setTimeout(tick, step - (Date.now() % step) + 5);
    return () => window.clearTimeout(timer);
  }, [step]);
  return now;
}

/** `YYYY-MM-DDTHH:MM` as a local time. */
export function parseAt(at: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(at);
  if (!match) return null;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
}

/**
 * D-92: items that went away stay a moment, `leaving`, so they can animate out (at once under
 * reduce-motion); `gone` takes one away when its animation ends.
 */
export function usePresence<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): {
  readonly entries: readonly {
    readonly item: T;
    readonly key: string;
    readonly leaving: boolean;
  }[];
  readonly gone: (key: string) => void;
} {
  const [leaving, setLeaving] = useState<
    ReadonlyMap<string, { readonly item: T; readonly after: string | null }>
  >(new Map());
  const last = useRef(items);
  const keys = items.map(keyOf).join('\n');
  useLayoutEffect(() => {
    const before = last.current;
    last.current = items;
    if (reducedMotion()) return;
    const here = new Set(items.map(keyOf));
    const went = before.filter((item) => !here.has(keyOf(item)));
    if (went.length === 0) return;
    setLeaving((current) => {
      const next = new Map(current);
      for (const item of went) {
        const at = before.indexOf(item);
        const after = before
          .slice(0, at)
          .reverse()
          .find((other) => here.has(keyOf(other)));
        next.set(keyOf(item), { item, after: after ? keyOf(after) : null });
      }
      return next;
    });
    // The items' keys say whether anything changed; the array itself is new on every tick.
  }, [keys]);
  const gone = useCallback((key: string): void => {
    setLeaving((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }, []);
  // A leaving item whose animation never ends (hidden, interrupted) still goes.
  useEffect(() => {
    if (leaving.size === 0) return;
    const timer = window.setTimeout(() => setLeaving(new Map()), 800);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  const present = new Set(items.map(keyOf));
  const waiting = [...leaving.entries()].filter(([key]) => !present.has(key));
  const entries: { item: T; key: string; leaving: boolean }[] = [];
  const place = (after: string | null): void => {
    for (const [key, each] of waiting)
      if (each.after === after) entries.push({ item: each.item, key, leaving: true });
  };
  place(null);
  for (const item of items) {
    const key = keyOf(item);
    entries.push({ item, key, leaving: false });
    place(key);
  }
  return { entries, gone };
}

/** "in 2 h 30 min" ("in 2 h 30" when `short`), "in 5 min", "in 40 s", "now". */
export function untilLabel(at: string, now: Date, short = false): string {
  const when = parseAt(at);
  if (!when) return '';
  const seconds = Math.ceil((when.getTime() - now.getTime()) / 1000);
  if (seconds <= 0) return 'now';
  if (seconds < 60) return `in ${seconds} s`;
  const minutes = Math.ceil(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `in ${rest} min`;
  if (rest === 0) return `in ${hours} h`;
  return short ? `in ${hours} h ${rest}` : `in ${hours} h ${rest} min`;
}
