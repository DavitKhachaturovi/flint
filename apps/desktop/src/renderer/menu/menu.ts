/**
 * Right-click menus (UI-08, D-55, D-64), drawn in the page with the tokens in every window, so they
 * look the same everywhere (09 §8). Framework-free: the React main window and the capture popup
 * both use it. Keyboard: ↑/↓ move, Enter picks, → opens a submenu and ← closes it (D-78), Esc
 * closes; a click elsewhere closes it. A menu moves with what it was opened on while the page
 * scrolls, and closes when that scrolls out of view (D-78).
 */

export interface MenuItem {
  readonly label: string;
  /** A key shown on the right, e.g. `Del`. */
  readonly hint?: string;
  readonly disabled?: boolean;
  /** What the item does; an item with a submenu opens that instead (D-78). */
  readonly action?: () => void;
  readonly submenu?: readonly MenuEntry[];
}

export type MenuEntry = MenuItem | 'divider';

export interface MenuOptions {
  /**
   * Called when the window is too small for the menu below and above the point: the capture popup
   * grows its window by `height` pixels while the menu is open, and calls `release` on close.
   */
  readonly room?: { readonly grow: (height: number) => void; readonly release: () => void };
}

const GAP = 8;
let close: (() => void) | null = null;

export function closeMenu(): void {
  close?.();
}

export function isMenuOpen(): boolean {
  return close !== null;
}

/**
 * D-78: keeps a floating panel with what it was opened on while the page scrolls: `move` gets how
 * far the anchor has moved since; `gone` runs once the anchor leaves its scroll area (or the page).
 * Scrolling inside a floating panel itself doesn't count. Returns the function that stops it.
 */
export function followAnchor(
  anchor: Element | null,
  move: (dx: number, dy: number) => void,
  gone: () => void,
): () => void {
  if (!anchor) return () => undefined;
  const start = anchor.getBoundingClientRect();
  const onScroll = (event: Event): void => {
    if (event.target instanceof Element && event.target.closest('.fl-menu, .fl-picker')) return;
    const now = anchor.getBoundingClientRect();
    const area = anchor.closest('.scroller')?.getBoundingClientRect() ?? {
      top: 0,
      bottom: window.innerHeight,
    };
    if (!anchor.isConnected || now.bottom < area.top || now.top > area.bottom) gone();
    else move(now.left - start.left, now.top - start.top);
  };
  document.addEventListener('scroll', onScroll, true);
  return () => document.removeEventListener('scroll', onScroll, true);
}

interface Level {
  readonly menu: HTMLElement;
  readonly buttons: readonly { readonly button: HTMLButtonElement; readonly item: MenuItem }[];
  active: number;
  /** D-68: the mouse highlights only while over the menu; the keyboard's highlight stays. */
  byKeyboard: boolean;
}

export function openMenu(
  entries: readonly MenuEntry[],
  at: { readonly x: number; readonly y: number },
  options: MenuOptions = {},
): void {
  closeMenu();
  if (entries.every((entry) => entry === 'divider')) return;
  // D-78: what the menu was opened on, to move with it.
  const anchor = document.elementFromPoint(at.x, at.y);
  let shift = { x: 0, y: 0 };
  const levels: Level[] = [];

  const paint = (level: Level): void =>
    level.buttons.forEach(({ button }, index) =>
      button.classList.toggle('active', index === level.active),
    );
  const closeFrom = (depth: number): void => {
    for (const level of levels.splice(depth)) level.menu.remove();
  };
  const pick = (depth: number, index: number, byKeyboard: boolean): void => {
    const chosen = levels[depth]?.buttons[index];
    if (!chosen || chosen.item.disabled) return;
    if (chosen.item.submenu) {
      openLevel(chosen.item.submenu, depth + 1, chosen.button, byKeyboard);
      return;
    }
    closeMenu();
    chosen.item.action?.();
  };

  /** One menu panel: the menu itself (depth 0) or a submenu beside its item. */
  const openLevel = (
    items: readonly MenuEntry[],
    depth: number,
    beside: HTMLElement | null,
    byKeyboard: boolean,
  ): void => {
    closeFrom(depth);
    const menu = document.createElement('div');
    menu.className = depth === 0 ? 'fl-menu' : 'fl-menu fl-submenu';
    menu.setAttribute('role', 'menu');
    const buttons: { button: HTMLButtonElement; item: MenuItem }[] = [];
    for (const entry of items) {
      if (entry === 'divider') {
        menu.append(Object.assign(document.createElement('div'), { className: 'fl-menu-divider' }));
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fl-menu-item';
      button.setAttribute('role', 'menuitem');
      button.disabled = entry.disabled === true;
      button.append(Object.assign(document.createElement('span'), { textContent: entry.label }));
      const hint = entry.submenu ? '›' : entry.hint;
      if (hint)
        button.append(
          Object.assign(document.createElement('span'), {
            className: entry.submenu ? 'fl-menu-hint fl-menu-more' : 'fl-menu-hint',
            textContent: hint,
          }),
        );
      if (entry.submenu) button.setAttribute('aria-haspopup', 'menu');
      buttons.push({ button, item: entry });
      menu.append(button);
    }
    // D-76: nothing is highlighted until the mouse or an arrow key; Enter acts only on a highlight.
    // A submenu opened from the keyboard starts on its first item.
    const level: Level = { menu, buttons, active: byKeyboard ? 0 : -1, byKeyboard };
    buttons.forEach(({ button, item }, index) => {
      button.addEventListener('mouseenter', () => {
        level.byKeyboard = false;
        level.active = index;
        paint(level);
        if (item.submenu && !item.disabled) openLevel(item.submenu, depth + 1, button, false);
        else closeFrom(depth + 1);
      });
      // Mouse down keeps the focus (and the text selection) where it was.
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => pick(depth, index, false));
    });
    menu.addEventListener('mouseleave', (event) => {
      // Into its own submenu, the item stays highlighted.
      if (level.byKeyboard || levels[depth + 1]?.menu.contains(event.relatedTarget as Node)) return;
      level.active = -1;
      paint(level);
    });
    paint(level);
    menu.style.visibility = 'hidden';
    document.body.append(menu);
    levels[depth] = level;
    place(level, beside);
  };

  let grown = false;
  const place = (level: Level, beside: HTMLElement | null): void => {
    const { menu } = level;
    const { width, height } = menu.getBoundingClientRect();
    let x = at.x;
    let y = at.y;
    if (beside) {
      // A submenu: to the right of its item, or to the left if there's no room.
      const item = beside.getBoundingClientRect();
      x = item.right + 2 - shift.x;
      y = item.top - 5 - shift.y;
      if (x + shift.x + width > window.innerWidth - GAP) x = item.left - width - 2 - shift.x;
      if (y + shift.y + height > window.innerHeight - GAP)
        y = window.innerHeight - GAP - height - shift.y;
    } else {
      if (x + width > window.innerWidth - GAP) x = Math.max(GAP, at.x - width);
      if (y + height > window.innerHeight - GAP) {
        if (at.y - height >= GAP) y = at.y - height;
        else if (options.room && !grown) {
          grown = true;
          options.room.grow(y + height + 3 * GAP - window.innerHeight);
        }
      }
    }
    menu.style.left = `${Math.round(x)}px`;
    menu.style.top = `${Math.round(Math.max(GAP, y))}px`;
    menu.style.translate = `${shift.x}px ${shift.y}px`;
    menu.style.visibility = '';
  };
  openLevel(entries, 0, null, false);
  const onResize = (): void => {
    const first = levels[0];
    closeFrom(1);
    if (first) place(first, null);
  };

  const step = (level: Level, direction: 1 | -1): void => {
    const { buttons } = level;
    if (buttons.length === 0) return;
    let next = level.active;
    for (let tries = 0; tries < buttons.length; tries++) {
      next = (next + direction + buttons.length) % buttons.length;
      if (!buttons[next]?.item.disabled) break;
    }
    level.active = next;
    paint(level);
  };
  const onKey = (event: KeyboardEvent): void => {
    const depth = levels.length - 1;
    const level = levels[depth];
    if (!level) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      level.byKeyboard = true;
      step(level, event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'ArrowRight' && level.buttons[level.active]?.item.submenu)
      pick(depth, level.active, true);
    else if ((event.key === 'ArrowLeft' || event.key === 'Escape') && depth > 0) closeFrom(depth);
    else if (event.key === 'Enter' || event.key === ' ') pick(depth, level.active, true);
    else if (event.key === 'Escape' || event.key === 'Tab') closeMenu();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const onPointer = (event: MouseEvent): void => {
    if (!levels.some((level) => level.menu.contains(event.target as Node))) closeMenu();
  };
  const stopFollowing = followAnchor(
    anchor,
    (dx, dy) => {
      shift = { x: dx, y: dy };
      for (const level of levels) level.menu.style.translate = `${dx}px ${dy}px`;
    },
    () => closeMenu(),
  );
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onPointer, true);
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', onResize);
  close = () => {
    close = null;
    closeFrom(0);
    stopFollowing();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onPointer, true);
    window.removeEventListener('blur', closeMenu);
    window.removeEventListener('resize', onResize);
    if (grown) options.room?.release();
  };
}

/** Text fields (inputs, text areas): what is selected decides Cut and Copy. */
export function isTextField(
  target: EventTarget | null,
): target is HTMLInputElement | HTMLTextAreaElement {
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && ['text', 'search', ''].includes(target.type))
  );
}

/**
 * The standard menu every text field keeps (UI-08): Electron shows none by default. The commands
 * run in the main process on this window (`webContents.cut()` and so on), so Paste behaves exactly
 * like Ctrl+V, the popup's screenshot and code paste included.
 */
export function textFieldMenu(
  field: HTMLInputElement | HTMLTextAreaElement,
  edit: (command: 'cut' | 'copy' | 'paste' | 'selectAll') => void,
): MenuEntry[] {
  const selected = (field.selectionEnd ?? 0) > (field.selectionStart ?? 0);
  const editable = !field.readOnly && !field.disabled;
  return [
    { label: 'Cut', hint: 'Ctrl+X', disabled: !selected || !editable, action: () => edit('cut') },
    { label: 'Copy', hint: 'Ctrl+C', disabled: !selected, action: () => edit('copy') },
    { label: 'Paste', hint: 'Ctrl+V', disabled: !editable, action: () => edit('paste') },
    'divider',
    { label: 'Select all', hint: 'Ctrl+A', action: () => edit('selectAll') },
  ];
}
