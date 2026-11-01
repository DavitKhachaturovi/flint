import {
  isValidListName,
  normalizeListName,
  suggestLists,
  type ListInfo,
} from '@flint/core/shorthand';
import { describeTime, fromDate, parseTime, toDate, type LocalDateTime } from '@flint/core/time';
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
  /** Shows these rows' highlight, starting at the keyboard's row `index`. */
  readonly set: (rows: readonly Row[], index?: number) => void;
  /** ↑/↓ move from the highlighted row, Enter picks it; true if the key was used. */
  readonly keys: (event: KeyboardEvent) => boolean;
}

/**
 * The highlight in a list of rows (D-68, D-69): the keyboard's row stays highlighted, the mouse's
 * only while the pointer is over it; leaving `area` gives the highlight back to the keyboard's row.
 */
function rowList(area: HTMLElement): RowList {
  let rows: readonly Row[] = [];
  let index = 0;
  let hover: number | null = null;
  const paint = (): void => {
    const shown = hover ?? index;
    rows.forEach((row, at) => row.button.classList.toggle('active', at === shown));
  };
  area.addEventListener('mouseleave', () => {
    hover = null;
    paint();
  });
  return {
    set(next, start = 0) {
      rows = next;
      index = start;
      hover = null;
      rows.forEach((row, at) =>
        // A real move, not a row appearing under a resting pointer (that fires mouseenter).
        row.button.addEventListener('mousemove', () => {
          if (hover === at) return;
          hover = at;
          paint();
        }),
      );
      paint();
    },
    keys(event) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (rows.length === 0) return true;
        index =
          ((hover ?? index) + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
        hover = null;
        paint();
        rows[index]?.button.scrollIntoView({ block: 'nearest' });
        return true;
      }
      if (event.key === 'Enter') {
        rows[hover ?? index]?.pick();
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

/** Times offered for a picked day (D-68); today only those still ahead. */
const COMMON_TIMES = [
  '09:00',
  '10:00',
  '11:00',
  '12:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
  '18:00',
  '20:00',
];

/**
 * Date and time (REM-01, REM-02, D-68): a natural-language field reading the same grammar as `@`,
 * presets, and a month grid. Picking a day opens a time-of-day view: common times and a custom time
 * field, with a way back to the calendar. Everything works from the keyboard: ↑/↓ and Enter in the
 * lists, arrow keys in the grid, ← or Backspace from the times back to the calendar. Only times in
 * the future can be picked.
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

  // The time-of-day view.
  const times = element('div', 'fl-times');
  times.hidden = true;
  const back = element('button', 'fl-times-back');
  back.type = 'button';
  const timeList = element('div', 'fl-picker-rows fl-times-list');
  timeList.tabIndex = -1;
  const custom = element('label', 'fl-cal-time');
  const time = element('input', 'fl-cal-time-input');
  time.spellcheck = false;
  time.placeholder = '13:45';
  custom.append(element('span', '', 'Other time'), time);
  times.append(back, timeList, custom);

  panel.append(text, rowsBox, calendar, times);

  const at = (date: Date, value: string): LocalDateTime | null => {
    const match = /^(\d{1,2})[:.]?(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    const moment = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes);
    return moment.getTime() > now.getTime() ? fromDate(moment) : null;
  };

  // Presets, or what the typed text means.
  const highlight = rowList(rowsBox);
  const presets = (): { label: string; at: Date }[] => {
    const inHour = new Date(Math.ceil((now.getTime() + 3_600_000) / 60_000) * 60_000);
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 9, 0);
    const monday = new Date(today);
    monday.setDate(today.getDate() + ((8 - today.getDay()) % 7 || 7));
    monday.setHours(9, 0, 0, 0);
    return [
      { label: 'In 1 hour', at: inHour },
      { label: 'Tomorrow morning', at: tomorrow },
      { label: 'Next Monday', at: monday },
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

  // The time-of-day view for the picked day.
  const timeHighlight = rowList(timeList);
  const openTimes = (date: Date): void => {
    day = date;
    marked = true;
    const label = describeTime(
      fromDate(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9)),
      now,
    );
    const dayName = label.replace(/ \d\d:\d\d$/, '');
    back.textContent = `‹  ${dayName}`;
    back.setAttribute('aria-label', `${dayName}, back to the calendar`);
    const timeRows = COMMON_TIMES.flatMap((value) => {
      const moment = at(date, value);
      return moment ? [makeRow(value, null, () => choose(moment))] : [];
    });
    timeList.replaceChildren(...timeRows.map((row) => row.button));
    if (timeRows.length === 0)
      timeList.append(element('p', 'fl-picker-empty', 'Type a later time below'));
    // Changing a reminder on its own day starts from its current time.
    const was =
      start && sameDay(start, date)
        ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
        : '';
    const wasIndex = timeRows.findIndex((row) => row.button.textContent === was);
    timeHighlight.set(timeRows, was !== '' && wasIndex >= 0 ? wasIndex : 0);
    timeRows[Math.max(0, wasIndex)]?.button.scrollIntoView({ block: 'nearest' });
    time.value = was !== '' && wasIndex < 0 ? was : '';
    calendar.hidden = true;
    rowsBox.hidden = true;
    times.hidden = false;
    (timeRows.length > 0 ? timeList : time).focus();
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
  timeList.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'Backspace') {
      event.preventDefault();
      openCalendar();
    } else if (timeHighlight.keys(event)) event.preventDefault();
  });
  time.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const moment = at(day, time.value);
    if (moment) choose(moment);
    else time.classList.add('invalid');
  });
  time.addEventListener('input', () => time.classList.remove('invalid'));

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
