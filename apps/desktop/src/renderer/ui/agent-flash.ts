import { reducedMotion } from './motion.js';

/**
 * AGENT-07 (D-185 Q12): an agent's change lights each changed task row on screen once (the
 * existing `fl-flash`), at most 20 a change, in the main window and in mini mode. Only a class on
 * the row: never the focus, the scroll, the selection or the open list. A row still arriving (the
 * refresh after the change) is waited for a moment, and its own motion (easing in, a glide) plays
 * first. A hidden window replays nothing; under reduce motion nothing flashes.
 */

const MOST = 20;
/** How long a changed row may take to appear (the window's refresh after the change). */
const WAIT_MS = 1500;
const FLASH_MS = 900;

function flashOnce(row: HTMLElement): void {
  const go = (): void => {
    row.classList.remove('fl-flash');
    void row.offsetWidth;
    row.classList.add('fl-flash');
    window.setTimeout(() => row.classList.remove('fl-flash'), FLASH_MS);
  };
  // Its own arrival or glide first (fl-flash would replace a running animation).
  const running = row
    .getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    .map((animation) => animation.finished);
  if (running.length === 0) go();
  else void Promise.allSettled(running).then(go);
}

/** Flashes the rows of these task keys now on screen, and those that appear in a moment. */
export function flashAgentRows(keys: readonly string[], root: ParentNode = document): void {
  if (reducedMotion() || document.visibilityState === 'hidden') return;
  const waiting = new Set(keys.slice(0, MOST));
  const tryNow = (): void => {
    for (const key of [...waiting]) {
      const rows = [
        ...root.querySelectorAll<HTMLElement>(`.row[data-key="${CSS.escape(key)}"]`),
      ].filter((row) => !row.closest('[aria-hidden="true"]'));
      if (rows.length === 0) continue;
      waiting.delete(key);
      for (const row of rows) flashOnce(row);
    }
  };
  tryNow();
  if (waiting.size === 0) return;
  const watcher = new MutationObserver(() => {
    tryNow();
    if (waiting.size === 0) stop();
  });
  const timer = window.setTimeout(() => stop(), WAIT_MS);
  function stop(): void {
    watcher.disconnect();
    window.clearTimeout(timer);
  }
  watcher.observe(document.body, { childList: true, subtree: true });
}
