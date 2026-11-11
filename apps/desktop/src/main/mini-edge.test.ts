import { describe, expect, it } from 'vitest';
import {
  edgeAt,
  edgeStep,
  PEEK_DELAY_MS,
  PEEK_LEAVE_MS,
  tabHovered,
  type EdgeSample,
  type EdgeState,
} from './mini-edge.js';

const sample = (now: number, over: Partial<EdgeSample> = {}): EdgeSample => ({
  now,
  overTab: false,
  inZone: false,
  held: false,
  hoverOpens: true,
  alertHold: false,
  ...over,
});

/** The cursor's looks, every 16 ms (main's check near mini), from `from` to `to` (both looked at). */
function run(state: EdgeState, from: number, to: number, over: Partial<EdgeSample>): EdgeState {
  let next = state;
  let now = from;
  for (; now < to; now += 16) next = edgeStep(next, sample(now, over));
  return edgeStep(next, sample(to, over));
}

describe('mini at the edge (MINI-04, D-177 Q1)', () => {
  it('resting on the tab peeks after 350 ms; the tab shows the cursor at once', () => {
    let state = edgeStep(edgeAt('collapsed'), sample(1000, { overTab: true }));
    expect(tabHovered(state)).toBe(true);
    state = run(state, 1016, 1000 + PEEK_DELAY_MS - 1, { overTab: true });
    expect(state.view).toBe('collapsed');
    state = edgeStep(state, sample(1000 + PEEK_DELAY_MS, { overTab: true }));
    expect(state.view).toBe('peek');
    expect(tabHovered(state)).toBe(false);
  });

  it('leaving the tab before then: nothing, and the wait starts again', () => {
    let state = run(edgeAt('collapsed'), 0, 300, { overTab: true });
    state = edgeStep(state, sample(316));
    expect(state).toEqual(edgeAt('collapsed'));
    state = run(state, 332, 332 + PEEK_DELAY_MS - 20, { overTab: true });
    expect(state.view).toBe('collapsed');
  });

  it('a press on the tab (a click or a drag) never peeks, until the cursor leaves it', () => {
    let state = run(edgeAt('collapsed'), 0, 100, { overTab: true });
    state = edgeStep(state, sample(116, { overTab: true, held: true }));
    expect(state.pressed).toBe(true);
    expect(tabHovered(state)).toBe(false);
    // Let go and rest there: still no peek.
    state = run(state, 132, 2000, { overTab: true });
    expect(state.view).toBe('collapsed');
    // Away and back: the wait again.
    state = edgeStep(state, sample(2016));
    state = run(state, 2032, 2032 + PEEK_DELAY_MS, { overTab: true });
    expect(state.view).toBe('peek');
  });

  it('Open on hover off: the tab shows the cursor, but only a click opens', () => {
    const state = run(edgeAt('collapsed'), 0, 5000, { overTab: true, hoverOpens: false });
    expect(state.view).toBe('collapsed');
    expect(tabHovered(state)).toBe(true);
  });

  it('a peek slides back 1 s after the cursor leaves the card’s place; back within it, it stays', () => {
    let state = run(edgeAt('peek'), 0, 400, { inZone: true });
    state = run(state, 416, 416 + PEEK_LEAVE_MS - 20, {});
    expect(state.view).toBe('peek');
    state = edgeStep(state, sample(416 + PEEK_LEAVE_MS - 4, { inZone: true }));
    expect(state.outSince).toBeNull();
    state = run(state, 2000, 2000 + PEEK_LEAVE_MS, {});
    expect(state).toEqual(edgeAt('collapsed'));
  });

  it('the tab and a held button count as staying', () => {
    expect(run(edgeAt('peek'), 0, 3000, { overTab: true }).view).toBe('peek');
    expect(run(edgeAt('peek'), 0, 3000, { held: true }).view).toBe('peek');
  });

  it('a reminder holds a peek out until it is dealt with', () => {
    let state = run(edgeAt('peek'), 0, 5000, { alertHold: true });
    expect(state.view).toBe('peek');
    state = run(state, 5016, 5016 + PEEK_LEAVE_MS, {});
    expect(state.view).toBe('collapsed');
  });

  it('open stays open whatever the cursor does', () => {
    expect(run(edgeAt('open'), 0, 10_000, {}).view).toBe('open');
  });

  it('returns the same state when nothing changes (main sends only changes)', () => {
    const resting = edgeAt('collapsed');
    expect(edgeStep(resting, sample(10))).toBe(resting);
    const peek = edgeAt('peek');
    expect(edgeStep(peek, sample(10, { inZone: true }))).toBe(peek);
  });
});
