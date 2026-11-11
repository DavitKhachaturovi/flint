/**
 * MINI-04, D-177 Q1: mini at the screen's edge, as main sees it from the cursor (it already checks
 * the cursor for click-through, `mini.ts`). Three views: **collapsed** (only the tab), **peek** (the
 * card out of the tab without the keyboard, from resting on the tab) and **open** (the card with
 * the keyboard, from a click; it stays until collapsed). Pure, so it is unit-tested on a fake clock.
 */

export type EdgeView = 'collapsed' | 'peek' | 'open';

export interface EdgeState {
  readonly view: EdgeView;
  /** Since when the cursor rests on the tab (collapsed), unpressed. */
  readonly hoverSince: number | null;
  /** Since when the cursor is outside the card's place (peek). */
  readonly outSince: number | null;
  /** The tab was pressed (a click or a drag): no peek until the cursor leaves it. */
  readonly pressed: boolean;
}

/** One look at the cursor. */
export interface EdgeSample {
  readonly now: number;
  /** Over the tab. */
  readonly overTab: boolean;
  /** Over the card's place: the card and the strip between it and the edge. */
  readonly inZone: boolean;
  /** A button is held in the page (a press on the tab, a drag). */
  readonly held: boolean;
  /** Settings → Mini mode → Open on hover. */
  readonly hoverOpens: boolean;
  /** A reminder holds a peek out (Show reminders in Flint: Always, opening mini mode). */
  readonly alertHold: boolean;
}

/** Resting on the tab this long peeks (Baymard's and NN/g's 300–500 ms; Proposed). */
export const PEEK_DELAY_MS = 350;
/** Away from the card's place this long, a peek slides back (Proposed). */
export const PEEK_LEAVE_MS = 1000;

export const edgeAt = (view: EdgeView): EdgeState => ({
  view,
  hoverSince: null,
  outSince: null,
  pressed: false,
});

/** Whether the tab shows the cursor on it (it nudges out). */
export const tabHovered = (state: EdgeState): boolean =>
  state.view === 'collapsed' && state.hoverSince !== null;

export function edgeStep(state: EdgeState, sample: EdgeSample): EdgeState {
  if (state.view === 'collapsed') {
    if (!sample.overTab) {
      return state.hoverSince === null && !state.pressed
        ? state
        : { ...state, hoverSince: null, pressed: false };
    }
    if (sample.held || state.pressed) {
      return state.pressed && state.hoverSince === null
        ? state
        : { ...state, pressed: true, hoverSince: null };
    }
    const since = state.hoverSince ?? sample.now;
    if (sample.hoverOpens && sample.now - since >= PEEK_DELAY_MS) return edgeAt('peek');
    return since === state.hoverSince ? state : { ...state, hoverSince: since };
  }
  if (state.view === 'peek') {
    if (sample.alertHold || sample.inZone || sample.overTab || sample.held)
      return state.outSince === null ? state : { ...state, outSince: null };
    const since = state.outSince ?? sample.now;
    if (sample.now - since >= PEEK_LEAVE_MS) return edgeAt('collapsed');
    return since === state.outSince ? state : { ...state, outSince: since };
  }
  return state;
}
