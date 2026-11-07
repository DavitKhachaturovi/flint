import {
  isValidListName,
  normalizeListName,
  suggestLists,
  type ListInfo,
} from '@flint/core/shorthand';
import {
  DEFAULT_HOUR,
  describeTime,
  fromDate,
  parseTime,
  toDate,
  type LocalDateTime,
} from '@flint/core/time';
import { closeMenu, followAnchor, type MenuOptions } from '../menu/menu.js';
import { floatingArea } from '../ui/floating-area.js';

/**
 * The pickers of the composer and the capture popup (CAP-11, D-57; 09 §8): priority, list, and
 * date/time. One floating panel style for all three, anchored under the button that opened it,
 * fully usable from the keyboard (↑/↓ move, Enter picks, Esc closes back to the text). They insert
 * the same shorthand a user would type (shared/tokens.ts); the list picker is also "Move to…".
 * Framework-free, like the menus, so the React main window and the popup share them.
 */

export type Priority = 'high' | 'medium' | 'low';

export interface PickerHost {
  /** The button (or point) it opens from; the panel sits under it, or above if there's no room. */
  readonly anchor: DOMRect;
  /** Where the keyboard goes back to when the picker closes. */
  readonly returnFocus: HTMLElement | null;
  /** The capture popup grows its window while a picker needs the room (like its menus). */
  readonly room?: MenuOptions['room'];
  /** D-76: the button that opens it; pressing it again closes the picker. */
  readonly trigger?: HTMLElement;
}

/** Picker buttons: a press on one doesn't close the open picker, so the next can morph from it. */
const TRIGGERS = '[data-picker], [data-picker-trigger]';

const WIDTH = 280;
const GAP = 6;
/** Closes the open picker: fading out, or at once when another picker takes its place. */
let closeOpen: ((instant?: boolean) => void) | null = null;
let openPanelElement: HTMLElement | null = null;
let openTrigger: HTMLElement | null = null;

export function closePicker(): void {
  closeOpen?.();
}

export function isPickerOpen(): boolean {
  return closeOpen !== null;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The floating panel: placed, closed by Esc, a click elsewhere or the window losing focus. */
function openPanel(
  host: PickerHost,
  label: string,
): { panel: HTMLElement; close: () => void; show: (focus: HTMLElement) => void } | null {
  // D-76: its own button closes an open picker.
  if (closeOpen && host.trigger && openTrigger === host.trigger) {
    closePicker();
    return null;
  }
  // D-76, D-77: another picker gives way to this one: a copy of it stays for the animation (it
  // morphs into this one when they are close, or fades out where it is).
  const previous =
    closeOpen && openPanelElement && !reducedMotion()
      ? {
          rect: openPanelElement.getBoundingClientRect(),
          ghost: openPanelElement.cloneNode(true) as HTMLElement,
        }
      : null;
  // Pickers and menus never stack.
  closeOpen?.(true);
  closeMenu();
  // D-78: what it was opened from, to move with it while the page scrolls.
  const anchorElement =
    host.trigger ??
    document.elementFromPoint(
      host.anchor.left + host.anchor.width / 2,
      host.anchor.top + host.anchor.height / 2,
    );
  const panel = element('div', 'fl-picker');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', label);
  panel.style.visibility = 'hidden';
  // The picker owns the keyboard while it has the focus: Tab, digits and arrows are its own, never
  // the list's Navigate keys (docs/03 §2).
  panel.addEventListener('keydown', (event) => event.stopPropagation());
  document.body.append(panel);
  let grown = false;
  const place = (): void => {
    const { height } = panel.getBoundingClientRect();
    // D-115: within the window's visible part (mini's window reaches past the screen's edge).
    const area = floatingArea();
    const x = Math.max(area.left + GAP, Math.min(host.anchor.left, area.right - WIDTH - GAP));
    let y = host.anchor.bottom + GAP;
    if (y + height > area.bottom - GAP) {
      if (host.anchor.top - GAP - height >= area.top + GAP) y = host.anchor.top - GAP - height;
      else if (host.room && !grown) {
        grown = true;
        host.room.grow(y + height + 3 * GAP - area.bottom);
      } else {
        // D-77: no room above or below: as close to the button as the window allows.
        y = area.bottom - GAP - height;
      }
    }
    panel.style.left = `${Math.round(x)}px`;
    panel.style.top = `${Math.round(Math.max(area.top + GAP, y))}px`;
    // D-76: it grows out of its button's side.
    const above = y < host.anchor.top;
    panel.style.transformOrigin = `${Math.round(host.anchor.left + host.anchor.width / 2 - x)}px ${above ? '100%' : '0'}`;
    panel.style.visibility = '';
  };
  const onPointer = (event: MouseEvent): void => {
    const target = event.target as Element;
    if (panel.contains(target) || target.closest?.(TRIGGERS)) return;
    close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    // Esc in a wheel being typed into cancels the typing, not the picker (D-76).
    if ((event.target as Element).closest?.('.fl-wheel.editing')) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  const close = (instant = false): void => {
    if (closeOpen !== close) return;
    closeOpen = null;
    openPanelElement = null;
    openTrigger = null;
    stopFollowing();
    document.removeEventListener('mousedown', onPointer, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('resize', place);
    if (grown) host.room?.release();
    if (!instant) host.returnFocus?.focus({ preventScroll: true });
    // D-77: it fades out; nothing waits for that (it takes no input any more).
    if (instant || reducedMotion()) panel.remove();
    else fadeOut(panel);
  };
  const onBlur = (): void => close();
  const stopFollowing = followAnchor(
    anchorElement,
    (dx, dy) => {
      panel.style.translate = `${dx}px ${dy}px`;
    },
    () => close(),
  );
  closeOpen = close;
  openPanelElement = panel;
  openTrigger = host.trigger ?? null;
  document.addEventListener('mousedown', onPointer, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('resize', place);
  // Placed once its content is in, then focused: a hidden element can't take the focus.
  const show = (focus: HTMLElement): void => {
    place();
    if (previous) {
      const to = panel.getBoundingClientRect();
      // Neighbouring pickers morph; one far away fades out while this one opens from its button.
      if (Math.hypot(previous.rect.left - to.left, previous.rect.top - to.top) <= MORPH_REACH) {
        panel.classList.add('fl-morph');
        morph(previous.rect, previous.ghost, panel);
      } else {
        previous.ghost.style.left = `${previous.rect.left}px`;
        previous.ghost.style.top = `${previous.rect.top}px`;
        document.body.append(previous.ghost);
        fadeOut(previous.ghost);
      }
    }
    focus.focus({ preventScroll: true });
  };
  return { panel, close: () => close(), show };
}

/** D-77: pickers further apart than this don't morph into each other (px). */
const MORPH_REACH = 240;

/** A closing picker (or the copy of one) fades and shrinks out, then goes. */
function fadeOut(panel: HTMLElement): void {
  // No longer a picker for lookups (.fl-picker), only its look.
  panel.classList.replace('fl-picker', 'fl-picker-ghost');
  panel.setAttribute('aria-hidden', 'true');
  panel
    .animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translateY(-4px) scale(0.95)' },
      ],
      // D-79: long enough to read as closing.
      { duration: durationOf('--fl-dur-fast', 120) * 1.5, easing: 'ease-in', fill: 'forwards' },
    )
    .finished.then(
      () => panel.remove(),
      () => panel.remove(),
    );
}

function durationOf(token: string, fallback: number): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token));
  return Number.isFinite(value) ? value : fallback;
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * D-76: one picker turning into the next: the old panel's copy and the new panel move between the
 * old and the new place and height while their contents crossfade.
 */
function morph(from: DOMRect, ghost: HTMLElement, panel: HTMLElement): void {
  const to = panel.getBoundingClientRect();
  const duration = durationOf('--fl-dur-base', 200);
  const options: KeyframeAnimationOptions = { duration, easing: 'cubic-bezier(.2, .9, .3, 1)' };
  const shift = (x: number, y: number): string => `translate(${x}px, ${y}px)`;
  ghost.classList.replace('fl-picker', 'fl-picker-ghost');
  ghost.classList.add('fl-morph');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.left = `${from.left}px`;
  ghost.style.top = `${from.top}px`;
  document.body.append(ghost);
  ghost
    .animate(
      [
        { transform: 'none', height: `${from.height}px`, opacity: 1 },
        {
          transform: shift(to.left - from.left, to.top - from.top),
          height: `${to.height}px`,
          opacity: 0,
        },
      ],
      { ...options, fill: 'forwards' },
    )
    .finished.then(
      () => ghost.remove(),
      () => ghost.remove(),
    );
  panel.animate(
    [
      {
        transform: shift(from.left - to.left, from.top - to.top),
        height: `${from.height}px`,
        opacity: 0,
      },
      { transform: 'none', height: `${to.height}px`, opacity: 1 },
    ],
    options,
  );
}

interface Row {
  readonly button: HTMLButtonElement;
  readonly pick: () => void;
}

interface RowList {
  /**
   * Shows these rows with nothing highlighted (D-76), or with row `index` highlighted when `shown`
   * (typing highlights the top match); the first arrow key reveals row `index`.
   */
  readonly set: (rows: readonly Row[], index?: number, shown?: boolean) => void;
  /** ↑/↓ reveal or move the highlight, Enter picks it if visible; true if the key was used. */
  readonly keys: (event: KeyboardEvent) => boolean;
}

/**
 * The highlight in a list of rows (D-74, D-76): it follows the last input used. Nothing is
 * highlighted at first; the mouse highlights the row it is on, and leaving `area` hides the
 * highlight again (as in the menus); an arrow key reveals it, then moves it on from where it is.
 * Enter acts only on a visible highlight.
 */
function rowList(area: HTMLElement): RowList {
  let rows: readonly Row[] = [];
  let index = 0;
  let shown = false;
  const paint = (): void =>
    rows.forEach((row, at) => row.button.classList.toggle('active', shown && at === index));
  area.addEventListener('mouseleave', (event) => {
    // D-122: only a pointer that really moves away. Rows shrinking under a resting pointer (typing
    // narrows them) give Chromium's synthetic leave, without movement: the highlight stays, so
    // Enter still picks what was typed for (it didn't on CI's machine).
    if (event.movementX === 0 && event.movementY === 0) return;
    shown = false;
    paint();
  });
  return {
    set(next, start = 0, show = false) {
      rows = next;
      index = start;
      shown = show && next.length > 0;
      rows.forEach((row, at) =>
        // A real move, not a row appearing under a resting pointer (that fires mouseenter).
        row.button.addEventListener('mousemove', () => {
          if (shown && index === at) return;
          index = at;
          shown = true;
          paint();
        }),
      );
      paint();
    },
    keys(event) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (rows.length === 0) return true;
        if (shown)
          index = (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
        shown = true;
        paint();
        rows[index]?.button.scrollIntoView({ block: 'nearest' });
        return true;
      }
      if (event.key === 'Enter') {
        // Something typed: Enter takes the highlighted match, the first if none shows.
        const typed = event.target instanceof HTMLInputElement && event.target.value.trim() !== '';
        if (shown || typed) rows[index]?.pick();
        return true;
      }
      return false;
    },
  };
}

function makeRow(label: string, hint: string | null, pick: () => void, lead?: HTMLElement): Row {
  const button = element('button', 'fl-picker-row');
  button.type = 'button';
  button.tabIndex = -1;
  if (lead) button.append(lead);
  button.append(element('span', 'fl-picker-label', label));
  if (hint) button.append(element('span', 'fl-picker-hint', hint));
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', pick);
  return { button, pick };
}

/** Priority (TASK-03): High, Medium, Low, None; 3 / 2 / 1 / 0 pick directly. */
export function openPriorityPicker(
  host: PickerHost,
  current: Priority | null,
  onPick: (priority: Priority | null) => void,
): void {
  const opened = openPanel(host, 'Priority');
  if (!opened) return;
  const { panel, close, show } = opened;
  const choose = (priority: Priority | null): void => {
    close();
    onPick(priority);
  };
  const options: { label: string; key: string; value: Priority | null }[] = [
    { label: 'High', key: '3', value: 'high' },
    { label: 'Medium', key: '2', value: 'medium' },
    { label: 'Low', key: '1', value: 'low' },
    { label: 'None', key: '0', value: null },
  ];
  const rows = options.map((option) =>
    makeRow(
      option.label,
      option.key,
      () => choose(option.value),
      element('span', `fl-picker-stripe p-${option.value ?? 'none'}`),
    ),
  );
  panel.append(...rows.map((row) => row.button));
  const list = rowList(panel);
  list.set(
    rows,
    Math.max(
      0,
      options.findIndex((option) => option.value === current),
    ),
  );
  panel.tabIndex = -1;
  panel.addEventListener('keydown', (event) => {
    const direct = options.find((option) => option.key === event.key);
    if (direct) {
      event.preventDefault();
      choose(direct.value);
    } else if (list.keys(event)) event.preventDefault();
  });
  show(panel);
}

export type ListPick = { readonly list: ListInfo } | { readonly newList: string };

/**
 * A list (CAP-05, TASK-11): a search field, then every task list, the most recently used first,
 * or the matches for what is typed (D-25), and "New list" for a name no list has. The list
 * scrolls (D-68).
 */
export function openListPicker(
  host: PickerHost,
  lists: readonly ListInfo[],
  options: { readonly exclude?: string; readonly placeholder: string },
  onPick: (pick: ListPick) => void,
): void {
  const opened = openPanel(host, options.placeholder);
  if (!opened) return;
  const { panel, close, show } = opened;
  const search = element('input', 'fl-picker-search');
  search.placeholder = options.placeholder;
  search.spellcheck = false;
  const box = element('div', 'fl-picker-rows');
  panel.append(search, box);
  const choose = (pick: ListPick): void => {
    close();
    onPick(pick);
  };
  const highlight = rowList(box);
  const render = (): void => {
    const typed = search.value.trim();
    const found = suggestLists(typed, lists).filter((list) => list.id !== options.exclude);
    const rows = found.map((list) => makeRow(list.name, null, () => choose({ list }), listIcon()));
    const taken = lists.some((list) => normalizeListName(list.name) === normalizeListName(typed));
    if (typed !== '' && !taken && isValidListName(typed))
      rows.push(makeRow(`New list "${typed}"`, null, () => choose({ newList: typed }), listIcon()));
    box.replaceChildren(...rows.map((row) => row.button));
    if (rows.length === 0) box.append(element('p', 'fl-picker-empty', 'No other task lists'));
    highlight.set(rows, 0, typed !== '');
  };
  search.addEventListener('input', render);
  search.addEventListener('keydown', (event) => {
    if (highlight.keys(event)) event.preventDefault();
  });
  render();
  show(search);
}

/** A note for mini's Open a note… (D-122). */
export interface NotePick {
  readonly id: string;
  /** What it is called: a quick note's first line or time, a note's name. */
  readonly label: string;
  /** Muted beside it: "Quick note", or when it was made. */
  readonly hint: string | null;
}

/**
 * D-122: mini mode's Open a note…: a search field, then the notes (quick notes and notes), newest
 * first, five in view and the rest scrolling; or those whose name has what is typed.
 */
export function openNotePicker(
  host: PickerHost,
  notes: readonly NotePick[],
  onPick: (id: string) => void,
): void {
  const opened = openPanel(host, 'Open a note');
  if (!opened) return;
  const { panel, close, show } = opened;
  const search = element('input', 'fl-picker-search');
  search.placeholder = 'Open a note…';
  search.spellcheck = false;
  const box = element('div', 'fl-picker-rows five');
  panel.append(search, box);
  const highlight = rowList(box);
  const render = (): void => {
    const typed = search.value.trim().toLowerCase();
    const found = notes.filter((note) => typed === '' || note.label.toLowerCase().includes(typed));
    const rows = found.map((note) =>
      makeRow(
        note.label,
        note.hint,
        () => {
          close();
          onPick(note.id);
        },
        noteIcon(),
      ),
    );
    box.replaceChildren(...rows.map((row) => row.button));
    if (rows.length === 0)
      box.append(
        element('p', 'fl-picker-empty', typed === '' ? 'No notes yet' : 'No note by that name'),
      );
    highlight.set(rows, 0, typed !== '');
  };
  search.addEventListener('input', render);
  search.addEventListener('keydown', (event) => {
    if (highlight.keys(event)) event.preventDefault();
  });
  render();
  show(search);
}

/** The note icon of the sidebar (icon tile). */
function noteIcon(): HTMLElement {
  const tile = element('span', 'fl-picker-tile');
  tile.innerHTML =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>';
  return tile;
}

/** The list icon of the sidebar (icon tile). */
function listIcon(): HTMLElement {
  const tile = element('span', 'fl-picker-tile');
  tile.innerHTML =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/></svg>';
  return tile;
}

const WEEKDAY_HEAD = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `Today`, `Tomorrow`, `Wed 4 Nov`, or `Wed 4 Nov 2027` in another year (mockup 08). */
function dayLabel(date: Date, today: Date): string {
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, tomorrow)) return 'Tomorrow';
  const year = date.getFullYear() === today.getFullYear() ? '' : ` ${date.getFullYear()}`;
  const month = MONTHS[date.getMonth()]?.slice(0, 3) ?? '';
  return `${WEEKDAYS_SHORT[date.getDay()] ?? ''} ${date.getDate()} ${month}${year}`;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** One stop of a wheel, in px (mockup 08: 40 px rows, the centre band 80 px from the top). */
const STOP = 40;
const BAND_TOP = 80;
/** Touchpad scrolling settles on the nearest value once its events, inertia included, stop. */
const SETTLE_MS = 140;

interface Wheel {
  readonly element: HTMLElement;
  readonly value: () => number;
  /** Selects `value`, adding it as an extra stop if the wheel doesn't have it (14:37). */
  readonly set: (value: number) => void;
}

/**
 * One column of the time wheels (D-70, D-76, mockup 08): its values top to bottom, the selected one
 * on the centre band. A touchpad scrolls it freely, pixel by pixel, and it settles on the nearest
 * value when the movement stops; a mouse-wheel notch moves exactly one value; dragging follows the
 * pointer and snaps. ↓ goes to the next value and ↑ to the previous one. A click on a value, or a
 * digit typed in the column, makes the value editable: `4_`, then `47`, any value up to `max`;
 * Tab, Enter or leaving commits, Esc cancels. Values don't wrap around.
 */
function wheel(label: string, values: readonly number[], max: number, onChange: () => void): Wheel {
  const stops = [...values];
  let index = 0;
  /** Where the column is scrolled to, in px: `index * STOP` when settled. */
  let offset = 0;
  /** The digits being typed, or null when the value isn't being edited. */
  let typed: string | null = null;
  const column = element('div', 'fl-wheel');
  column.tabIndex = 0;
  column.setAttribute('role', 'listbox');
  column.setAttribute('aria-label', label);
  const track = element('div', 'fl-wheel-track');
  column.append(track);
  const id = `fl-wheel-${label.toLowerCase()}`;
  const last = (): number => (stops.length - 1) * STOP;

  const render = (): void => {
    const nearest = Math.round(offset / STOP);
    track.replaceChildren(
      ...stops.map((value, at) => {
        const editing = typed !== null && at === index;
        const shown = editing ? typed : null;
        const text = !shown ? pad(value) : shown.length === 1 ? `${shown}_` : shown;
        const item = element('span', 'fl-wheel-item', text);
        item.id = `${id}-${value}`;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(at === index));
        const distance = Math.abs(at - nearest);
        if (distance === 0) item.classList.add('center');
        else if (distance === 1) item.classList.add('near');
        if (editing) item.classList.add('editing');
        return item;
      }),
    );
    track.style.transform = `translateY(${BAND_TOP - offset}px)`;
    column.classList.toggle('editing', typed !== null);
    column.setAttribute('aria-activedescendant', `${id}-${stops[index] ?? 0}`);
  };
  /** Settles on value `next` (clamped), gliding there. */
  const select = (next: number): void => {
    const clamped = Math.max(0, Math.min(stops.length - 1, next));
    const changed = clamped !== index;
    index = clamped;
    offset = index * STOP;
    column.classList.remove('free');
    render();
    if (changed) onChange();
  };
  const set = (value: number): void => {
    let at = stops.indexOf(value);
    if (at < 0) {
      at = stops.findIndex((stop) => stop > value);
      if (at < 0) at = stops.length;
      stops.splice(at, 0, value);
    }
    index = at;
    offset = index * STOP;
    render();
    onChange();
  };

  // Editing a value by typing (D-76).
  const startEditing = (first = ''): void => {
    typed = first;
    render();
  };
  const commit = (): void => {
    if (typed === null) return;
    const value = typed === '' ? null : Number(typed);
    typed = null;
    if (value === null) render();
    else set(value);
  };
  const cancel = (): void => {
    typed = null;
    render();
  };
  column.addEventListener('keydown', (event) => {
    if (typed !== null) {
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        const next = typed.length >= 2 ? event.key : typed + event.key;
        // A second digit that would pass the limit is not taken.
        if (next.length === 1 || Number(next) <= max) typed = next;
        render();
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        typed = typed.slice(0, -1);
        render();
      } else if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Enter') commit();
        else cancel();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') commit();
      if (typed !== null || event.key === 'Enter' || event.key === 'Escape') return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      select(index + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (/^\d$/.test(event.key)) {
      event.preventDefault();
      startEditing(event.key);
    }
  });
  // Tab, or a click elsewhere: what was typed is taken.
  column.addEventListener('blur', commit);

  // The mouse wheel and the touchpad.
  let settle: number | undefined;
  column.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      commit();
      const legacy = (event as WheelEvent & { readonly wheelDeltaY?: number }).wheelDeltaY ?? 0;
      if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL && legacy !== 0 && legacy % 120 === 0) {
        window.clearTimeout(settle);
        select(index + Math.sign(event.deltaY));
        return;
      }
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? STOP
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? STOP * 5
            : 1;
      offset = Math.max(0, Math.min(last(), offset + event.deltaY * unit));
      column.classList.add('free');
      const nearest = Math.round(offset / STOP);
      if (nearest !== index) {
        index = nearest;
        onChange();
      }
      render();
      window.clearTimeout(settle);
      settle = window.setTimeout(() => select(Math.round(offset / STOP)), SETTLE_MS);
    },
    { passive: false },
  );

  // Dragging follows the pointer, then snaps to the nearest stop; a click on a value selects it and
  // makes it editable.
  column.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    // D-77: a click goes straight to the value clicked; unfinished typing is dropped, not taken
    // first.
    if (typed !== null) cancel();
    column.focus();
    column.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const start = offset;
    let moved = false;
    const move = (next: PointerEvent): void => {
      const dy = next.clientY - startY;
      if (Math.abs(dy) > 3) moved = true;
      if (!moved) return;
      column.classList.add('free');
      offset = Math.max(0, Math.min(last(), start - dy));
      render();
    };
    const up = (end: PointerEvent): void => {
      column.removeEventListener('pointermove', move);
      column.removeEventListener('pointerup', up);
      column.removeEventListener('pointercancel', up);
      if (moved) {
        select(Math.round(offset / STOP));
        return;
      }
      const top = column.getBoundingClientRect().top;
      select(index + Math.floor((end.clientY - top - BAND_TOP) / STOP));
      startEditing();
    };
    column.addEventListener('pointermove', move);
    column.addEventListener('pointerup', up);
    column.addEventListener('pointercancel', up);
  });

  render();
  return { element: column, value: () => stops[index] ?? 0, set };
}

/**
 * Date and time (REM-01, REM-02, D-68, D-70): a natural-language field reading the same grammar as
 * `@` (exact minutes: `14:37`, `3pm`), presets, and a month grid. Picking a day opens the time
 * wheels (mockup 08): hours and minutes in 5-minute steps, starting at the reminder's time, or the
 * next quarter hour today and 10:00 on another day, then "Set". From the keyboard: arrows move the
 * day and Enter picks it; in the wheels ↑/↓ or digits, ←/→ (or Tab) between hours and minutes,
 * Enter sets, ← from the hours goes back to the calendar. Only times in the future can be set.
 */
export function openTimePicker(
  host: PickerHost,
  now: Date,
  current: LocalDateTime | null,
  onPick: (at: LocalDateTime) => void,
): void {
  const opened = openPanel(host, 'Reminder');
  if (!opened) return;
  const { panel, close, show } = opened;
  const choose = (at: LocalDateTime): void => {
    close();
    onPick(at);
  };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = current ? toDate(current) : null;
  let day =
    start && start.getTime() > now.getTime()
      ? new Date(start.getFullYear(), start.getMonth(), start.getDate())
      : today;
  let month = new Date(day.getFullYear(), day.getMonth(), 1);
  // D-69: the strong tile marks a chosen day (the reminder's, or one the arrow keys moved to); a new
  // reminder starts with none, so today shows only its own marker.
  let marked = day !== today;

  const text = element('input', 'fl-picker-search');
  text.placeholder = 'in 2h, fri 10, 2 nov 15:00…';
  text.spellcheck = false;
  const rowsBox = element('div', 'fl-picker-rows');

  // The calendar view.
  const calendar = element('div', 'fl-cal');
  const head = element('div', 'fl-cal-head');
  const prev = element('button', 'fl-cal-step', '‹');
  const next = element('button', 'fl-cal-step', '›');
  prev.type = next.type = 'button';
  prev.setAttribute('aria-label', 'Previous month');
  next.setAttribute('aria-label', 'Next month');
  const title = element('span', 'fl-cal-title');
  head.append(prev, title, next);
  const grid = element('div', 'fl-cal-grid');
  calendar.append(head, grid);

  // The time wheels for the picked day (D-70).
  const times = element('div', 'fl-wheels');
  times.hidden = true;
  const timesHead = element('div', 'fl-wheels-head');
  const back = element('button', 'fl-wheels-back');
  back.type = 'button';
  timesHead.append(back, element('span', 'fl-wheels-label', 'Time'));
  const well = element('div', 'fl-wheels-well');
  const set = element('button', 'fl-wheels-set');
  set.type = 'button';
  const chosen = (): LocalDateTime => {
    const moment = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      hours.value(),
      minutes.value(),
    );
    return fromDate(moment);
  };
  const isLater = (): boolean => toDate(chosen()).getTime() > now.getTime();
  const update = (): void => {
    const later = isLater();
    set.disabled = !later;
    set.textContent = later
      ? `Set · ${dayLabel(day, today)}, ${pad(hours.value())}:${pad(minutes.value())}`
      : 'Pick a later time';
  };
  const hours = wheel(
    'Hours',
    Array.from({ length: 24 }, (_, hour) => hour),
    23,
    () => update(),
  );
  const minutes = wheel(
    'Minutes',
    Array.from({ length: 12 }, (_, step) => step * 5),
    59,
    () => update(),
  );
  well.append(
    element('div', 'fl-wheels-band'),
    hours.element,
    element('span', 'fl-wheels-colon', ':'),
    minutes.element,
  );
  times.append(timesHead, well, set);

  panel.append(text, rowsBox, calendar, times);

  // Presets, or what the typed text means.
  const highlight = rowList(rowsBox);
  const presets = (): { label: string; at: Date }[] => {
    // D-69: whole minutes, rounded up, so "in 10 minutes" is never less.
    const inMinutes = (minutes: number): Date =>
      new Date(Math.ceil((now.getTime() + minutes * 60_000) / 60_000) * 60_000);
    const tomorrow = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1,
      DEFAULT_HOUR,
    );
    return [
      { label: 'In 10 minutes', at: inMinutes(10) },
      { label: 'In 1 hour', at: inMinutes(60) },
      { label: 'Tomorrow 10:00', at: tomorrow },
    ];
  };
  const renderRows = (): void => {
    const typed = text.value.trim();
    let rows: Row[];
    if (typed === '') {
      rows = presets().map(({ label, at: moment }) =>
        makeRow(label, describeTime(fromDate(moment), now), () =>
          choose({ ...fromDate(moment), second: 0 }),
        ),
      );
    } else {
      const parsed = parseTime(typed, { now });
      rows = parsed ? [makeRow(describeTime(parsed, now), 'Enter', () => choose(parsed))] : [];
    }
    rowsBox.replaceChildren(...rows.map((row) => row.button));
    if (typed !== '' && rows.length === 0)
      rowsBox.append(element('p', 'fl-picker-empty', 'Not a time Flint knows yet'));
    highlight.set(rows, 0, typed !== '');
  };

  let dayButtons: { date: Date; button: HTMLButtonElement }[] = [];
  const renderGrid = (): void => {
    title.textContent = `${MONTHS[month.getMonth()]} ${month.getFullYear()}`;
    prev.disabled =
      month.getFullYear() < today.getFullYear() ||
      (month.getFullYear() === today.getFullYear() && month.getMonth() <= today.getMonth());
    grid.replaceChildren(...WEEKDAY_HEAD.map((name) => element('span', 'fl-cal-weekday', name)));
    const offset = (month.getDay() + 6) % 7;
    for (let blank = 0; blank < offset; blank++) grid.append(element('span', 'fl-cal-blank'));
    dayButtons = [];
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    for (let date = 1; date <= days; date++) {
      const value = new Date(month.getFullYear(), month.getMonth(), date);
      const button = element('button', 'fl-cal-day', String(date));
      button.type = 'button';
      button.disabled = value.getTime() < today.getTime();
      button.tabIndex = sameDay(value, day) ? 0 : -1;
      button.classList.toggle('today', sameDay(value, today));
      button.classList.toggle('on', marked && sameDay(value, day));
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => openTimes(value));
      dayButtons.push({ date: value, button });
      grid.append(button);
    }
  };
  const moveDay = (delta: number): void => {
    const target = new Date(day);
    target.setDate(day.getDate() + delta);
    if (target.getTime() < today.getTime()) return;
    day = target;
    marked = true;
    month = new Date(day.getFullYear(), day.getMonth(), 1);
    renderGrid();
    dayButtons.find(({ date }) => sameDay(date, day))?.button.focus();
  };

  /** D-70: the reminder's time, or the next quarter hour today, or 10:00 on another day. */
  const startTime = (date: Date): { hour: number; minute: number } => {
    if (start) return { hour: start.getHours(), minute: start.getMinutes() };
    if (!sameDay(date, today)) return { hour: DEFAULT_HOUR, minute: 0 };
    const quarter = new Date(Math.floor(now.getTime() / 900_000 + 1) * 900_000);
    return sameDay(quarter, today)
      ? { hour: quarter.getHours(), minute: quarter.getMinutes() }
      : { hour: 23, minute: 55 };
  };
  const openTimes = (date: Date): void => {
    day = date;
    marked = true;
    const name = dayLabel(date, today);
    back.textContent = `‹  ${name}`;
    back.setAttribute('aria-label', `${name}, back to the calendar`);
    const { hour, minute } = startTime(date);
    hours.set(hour);
    minutes.set(minute);
    calendar.hidden = true;
    rowsBox.hidden = true;
    times.hidden = false;
    hours.element.focus();
  };
  const openCalendar = (): void => {
    times.hidden = true;
    calendar.hidden = false;
    rowsBox.hidden = false;
    renderGrid();
    dayButtons.find(({ date }) => sameDay(date, day))?.button.focus();
  };

  for (const [button, step] of [
    [prev, -1],
    [next, 1],
  ] as const) {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      month = new Date(month.getFullYear(), month.getMonth() + step, 1);
      renderGrid();
    });
  }
  grid.addEventListener('keydown', (event) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      moveDay(delta);
    }
  });
  back.addEventListener('mousedown', (event) => event.preventDefault());
  back.addEventListener('click', openCalendar);
  set.addEventListener('mousedown', (event) => event.preventDefault());
  set.addEventListener('click', () => {
    if (isLater()) choose(chosen());
  });
  times.addEventListener('keydown', (event) => {
    const inHours = event.target === hours.element;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (isLater()) choose(chosen());
    } else if (event.key === 'ArrowLeft' && event.target !== set) {
      event.preventDefault();
      if (inHours) openCalendar();
      else hours.element.focus();
    } else if (event.key === 'ArrowRight' && inHours) {
      event.preventDefault();
      minutes.element.focus();
    }
  });

  text.addEventListener('input', () => {
    // Typing always goes back to the typed result, whatever view was open.
    if (!times.hidden) openCalendar();
    renderRows();
    text.focus();
  });
  text.addEventListener('keydown', (event) => {
    if (highlight.keys(event)) event.preventDefault();
  });

  renderRows();
  renderGrid();
  show(text);
}
