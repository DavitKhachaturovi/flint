/**
 * APP-14, D-113, D-118, D-125: the contextual tips: each shown once, at most two a session ten
 * minutes apart, counted
 * locally (app data's `tips.json`). A tip is due once its pattern has happened `after` times. In
 * the text, `…` is a key (a keycap).
 */
export type TipId =
  | 'shorthand'
  | 'paletteKey'
  | 'captureAnywhere'
  | 'keyboardComplete'
  | 'slash'
  | 'trash'
  | 'links'
  | 'triage'
  | 'panel';

export interface Tip {
  /** How many times the pattern happens before the tip is due. */
  readonly after: number;
  readonly text: string;
}

export const TIPS: Readonly<Record<TipId, Tip>> = {
  // The composer's priority, list or reminder button used on a task added, 3 times.
  shorthand: {
    after: 3,
    text: 'Type `!h`, `##list` or `@15:00` as you write a task: no buttons needed.',
  },
  // D-107: the palette opened with the mouse, 3 times.
  paletteKey: {
    after: 3,
    text: 'Press `Ctrl+K` to search or run any command, from anywhere in Flint.',
  },
  // Five tasks added in the main window right after bringing Flint to the front.
  captureAnywhere: {
    after: 5,
    text: '`Ctrl+Shift+Space` captures a task from any app, without opening Flint.',
  },
  // Tasks completed by clicking their checkbox, 10 times.
  keyboardComplete: { after: 10, text: '`↑` `↓` move between tasks and `Space` completes one.' },
  // The first note opened.
  slash: { after: 1, text: 'Type `/` in a note for headings, code blocks, tables and more.' },
  // The first delete.
  trash: { after: 1, text: 'Deleted items stay in Trash for 30 days: restore them any time.' },
  // The first paste of an Azure DevOps, GitHub or Jira link.
  links: { after: 1, text: 'Make your own short links in Settings → Links.' },
  // Inbox with 20 or more open tasks.
  triage: { after: 1, text: 'Press `T` in Inbox to sort it one task at a time.' },
  // The window wide enough for the side panel, the first time.
  panel: { after: 1, text: 'Select a task to see and edit its details here.' },
};

/** D-125: at most this many tips a session… */
export const TIPS_PER_SESSION = 2;
/** …and at least this long between two of them (ms), so they never come back to back. */
export const TIP_GAP_MS = 10 * 60_000;

/**
 * D-125: whether a session that showed tips at `shownAt` (ms, in order) may show another `now`.
 */
export function tipAllowed(shownAt: readonly number[], now: number): boolean {
  const last = shownAt.at(-1);
  return shownAt.length < TIPS_PER_SESSION && (last === undefined || now - last >= TIP_GAP_MS);
}

export const isTipId = (value: unknown): value is TipId =>
  typeof value === 'string' && Object.hasOwn(TIPS, value);

/** The tip's text in parts: plain text, and keys (between backticks). */
export function tipParts(text: string): { readonly key: boolean; readonly text: string }[] {
  return text
    .split('`')
    .map((part, index) => ({ key: index % 2 === 1, text: part }))
    .filter((part) => part.text !== '');
}
