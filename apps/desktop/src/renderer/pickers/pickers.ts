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
import { closeMenu, type MenuOptions } from '../menu/menu.js';

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
}

const WIDTH = 280;
const GAP = 6;
let closeOpen: (() => void) | null = null;

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
): { panel: HTMLElement; close: () => void; show: (focus: HTMLElement) => void } {
  // Pickers and menus never stack.
  closePicker();
  closeMenu();
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
    const x = Math.max(GAP, Math.min(host.anchor.left, window.innerWidth - WIDTH - GAP));
    let y = host.anchor.bottom + GAP;
    if (y + height > window.innerHeight - GAP) {
      if (host.anchor.top - GAP - height >= GAP) y = host.anchor.top - GAP - height;
      else if (host.room && !grown) {
        grown = true;
        host.room.grow(y + height + 3 * GAP - window.innerHeight);
      }
    }
    panel.style.left = `${Math.round(x)}px`;
    panel.style.top = `${Math.round(Math.max(GAP, y))}px`;
    panel.style.visibility = '';
  };
  const onPointer = (event: MouseEvent): void => {
    if (!panel.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  const close = (): void => {
    if (closeOpen !== close) return;
    closeOpen = null;
    panel.remove();
    document.removeEventListener('mousedown', onPointer, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('resize', place);
    if (grown) host.room?.release();
    host.returnFocus?.focus();
  };
  closeOpen = close;
  document.addEventListener('mousedown', onPointer, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', close);
  window.addEventListener('resize', place);
  // Placed once its content is in, then focused: a hidden element can't take the focus.
  const show = (focus: HTMLElement): void => {
    place();
    focus.focus();
  };
  return { panel, close, show };
}

interface Row {
  readonly button: HTMLButtonElement;
  readonly pick: () => void;
}

interface RowList {
  /** Shows these rows, highlighting row `index`. */
  readonly set: (rows: readonly Row[], index?: number) => void;
  /** ↑/↓ move the highlight, Enter picks the current row; true if the key was used. */
  readonly keys: (event: KeyboardEvent) => boolean;
}

/**
 * The highlight in a list of rows (D-74): it follows the last input used. The mouse moves the
 * current row and highlights it; when the mouse leaves `area`, nothing is highlighted (as in the
 * menus); an arrow key brings the highlight back, moving on from the row the mouse was last on.
 * Enter picks the current row.
 */
function rowList(area: HTMLElement): RowList {
  let rows: readonly Row[] = [];
  let index = 0;
  let shown = true;
  const paint = (): void =>
    rows.forEach((row, at) => row.button.classList.toggle('active', shown && at === index));
  area.addEventListener('mouseleave', () => {
    shown = false;
    paint();
  });
  return {
    set(next, start = 0) {
      rows = next;
      index = start;
      shown = true;
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
        index = (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
        shown = true;
        paint();
        rows[index]?.button.scrollIntoView({ block: 'nearest' });
        return true;
      }
      if (event.key === 'Enter') {
        rows[index]?.pick();
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
  const { panel, close, show } = openPanel(host, 'Priority');
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
  const { panel, close, show } = openPanel(host, options.placeholder);
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
    highlight.set(rows);
  };
  search.addEventListener('input', render);
  search.addEventListener('keydown', (event) => {
    if (highlight.keys(event)) event.preventDefault();
  });
  render();
  show(search);
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
/** Touchpad scrolling: pixels per stop (D-74); a mouse notch is always one stop. */
const TOUCHPAD_STEP = 80;
/** A pause in wheel events this long drops a partial step. */
const WHEEL_PAUSE_MS = 200;
/** Two digits typed within this time make one value (`1`, `4` → 14). */
const DIGIT_MS = 1000;

interface Wheel {
  readonly element: HTMLElement;
  readonly value: () => number;
  /** Selects `value`, adding it as an extra stop if the wheel doesn't have it (14:37). */
  readonly set: (value: number) => void;
}

/**
 * One column of the time wheels (D-70, mockup 08): its values top to bottom, the selected one on
 * the centre band. The mouse wheel and dragging move it a stop at a time and it snaps; a click picks
 * a value. From the keyboard ↓ goes to the next value and ↑ to the previous one, and digits type a
 * value (up to `max`). Values don't wrap around.
 */
function wheel(label: string, values: readonly number[], max: number, onChange: () => void): Wheel {
  const stops = [...values];
  let index = 0;
  const column = element('div', 'fl-wheel');
  column.tabIndex = 0;
  column.setAttribute('role', 'listbox');
  column.setAttribute('aria-label', label);
  const track = element('div', 'fl-wheel-track');
  column.append(track);
  const id = `fl-wheel-${label.toLowerCase()}`;

  const render = (offset = 0): void => {
    track.replaceChildren(
      ...stops.map((value, at) => {
        const item = element('span', 'fl-wheel-item', pad(value));
        item.id = `${id}-${value}`;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(at === index));
        const distance = Math.abs(at - index);
        if (distance === 0) item.classList.add('center');
        else if (distance === 1) item.classList.add('near');
        return item;
      }),
    );
    track.style.transform = `translateY(${BAND_TOP - index * STOP + offset}px)`;
    column.setAttribute('aria-activedescendant', `${id}-${stops[index] ?? 0}`);
  };
  const select = (next: number): void => {
    const clamped = Math.max(0, Math.min(stops.length - 1, next));
    if (clamped === index) return;
    index = clamped;
    render();
    onChange();
  };
  const set = (value: number): void => {
    let at = stops.indexOf(value);
    if (at < 0) {
      at = stops.findIndex((stop) => stop > value);
      if (at < 0) at = stops.length;
      stops.splice(at, 0, value);
    }
    index = at;
    render();
    onChange();
  };

  // Typed digits: one that can't start a two-digit value is the value; otherwise wait a moment
  // for a second one.
  let pending: { digit: number; at: number } | null = null;
  column.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      pending = null;
      select(index + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (!/^\d$/.test(event.key)) return;
    event.preventDefault();
    const digit = Number(event.key);
    const time = performance.now();
    if (pending && time - pending.at < DIGIT_MS && pending.digit * 10 + digit <= max) {
      set(pending.digit * 10 + digit);
      pending = null;
    } else {
      set(digit);
      pending = digit * 10 <= max ? { digit, at: time } : null;
    }
  });

  // D-74: a mouse notch is one stop. A touchpad sends many small pixel deltas: they add up, one
  // stop per TOUCHPAD_STEP, the rest kept for the next; a pause starts afresh.
  let wheeled = 0;
  let lastWheel = 0;
  column.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      if (event.timeStamp - lastWheel > WHEEL_PAUSE_MS) wheeled = 0;
      lastWheel = event.timeStamp;
      const legacy = (event as WheelEvent & { readonly wheelDeltaY?: number }).wheelDeltaY ?? 0;
      if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL && legacy !== 0 && legacy % 120 === 0) {
        wheeled = 0;
        select(index + Math.sign(event.deltaY));
        return;
      }
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? TOUCHPAD_STEP / 3
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? TOUCHPAD_STEP * 5
            : 1;
      wheeled += event.deltaY * unit;
      const steps = Math.trunc(wheeled / TOUCHPAD_STEP);
      if (steps === 0) return;
      wheeled -= steps * TOUCHPAD_STEP;
      select(index + steps);
    },
    { passive: false },
  );

  // Dragging follows the pointer, then snaps to the nearest stop; a click without a drag picks the
  // value under the pointer.
  column.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    column.focus();
    column.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startIndex = index;
    let moved = false;
    column.classList.add('dragging');
    const move = (next: PointerEvent): void => {
      const dy = next.clientY - startY;
      if (Math.abs(dy) > 3) moved = true;
      if (!moved) return;
      const reach = Math.max(-startIndex, Math.min(stops.length - 1 - startIndex, -dy / STOP));
      track.style.transform = `translateY(${BAND_TOP - (startIndex + reach) * STOP}px)`;
    };
    const up = (last: PointerEvent): void => {
      column.removeEventListener('pointermove', move);
      column.removeEventListener('pointerup', up);
      column.removeEventListener('pointercancel', up);
      column.classList.remove('dragging');
      if (moved) {
        const target = Math.round(startIndex - (last.clientY - startY) / STOP);
        if (Math.max(0, Math.min(stops.length - 1, target)) === index) render();
        else select(target);
      } else {
        const top = column.getBoundingClientRect().top;
        select(index + Math.floor((last.clientY - top - BAND_TOP) / STOP));
      }
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
  const { panel, close, show } = openPanel(host, 'Reminder');
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
    highlight.set(rows);
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
