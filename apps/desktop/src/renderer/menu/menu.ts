/**
 * Right-click menus (UI-08, D-55, D-64), drawn in the page with the tokens in every window, so they
 * look the same everywhere (09 §8). Framework-free: the React main window and the capture popup
 * both use it. Keyboard: ↑/↓ move, Enter picks, Esc closes; a click elsewhere closes it.
 */

export interface MenuItem {
  readonly label: string;
  /** A key shown on the right, e.g. `Del`. */
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly action: () => void;
}

export type MenuEntry = MenuItem | 'divider';

export interface MenuOptions {
  /**
   * Called when the window is too small for the menu below and above the point: the capture popup
   * grows its window by `height` pixels while the menu is open, and calls `release` on close.
   */
  readonly room?: { readonly grow: (height: number) => void; readonly release: () => void };
  /** Opened from the keyboard: the first item is active at once. */
  readonly keyboard?: boolean;
}

const GAP = 8;
let close: (() => void) | null = null;

export function closeMenu(): void {
  close?.();
}

export function isMenuOpen(): boolean {
  return close !== null;
}

export function openMenu(
  entries: readonly MenuEntry[],
  at: { readonly x: number; readonly y: number },
  options: MenuOptions = {},
): void {
  closeMenu();
  if (entries.every((entry) => entry === 'divider')) return;
  const menu = document.createElement('div');
  menu.className = 'fl-menu';
  menu.setAttribute('role', 'menu');
  const buttons: { readonly button: HTMLButtonElement; readonly item: MenuItem }[] = [];
  for (const entry of entries) {
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
    if (entry.hint)
      button.append(
        Object.assign(document.createElement('span'), {
          className: 'fl-menu-hint',
          textContent: entry.hint,
        }),
      );
    buttons.push({ button, item: entry });
    menu.append(button);
  }

  let active = options.keyboard ? buttons.findIndex(({ item }) => !item.disabled) : -1;
  /** D-68: the mouse highlights only while over the menu; the keyboard's highlight stays. */
  let byKeyboard = options.keyboard === true;
  const paint = (): void =>
    buttons.forEach(({ button }, index) => button.classList.toggle('active', index === active));
  const pick = (index: number): void => {
    const chosen = buttons[index];
    if (!chosen || chosen.item.disabled) return;
    closeMenu();
    chosen.item.action();
  };
  buttons.forEach(({ button }, index) => {
    button.addEventListener('mouseenter', () => {
      byKeyboard = false;
      active = index;
      paint();
    });
    // Mouse down keeps the focus (and the text selection) where it was.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => pick(index));
  });
  paint();
  menu.addEventListener('mouseleave', () => {
    if (byKeyboard) return;
    active = -1;
    paint();
  });

  menu.style.visibility = 'hidden';
  document.body.append(menu);
  let grown = false;
  const place = (): void => {
    const { width, height } = menu.getBoundingClientRect();
    let x = at.x;
    let y = at.y;
    if (x + width > window.innerWidth - GAP) x = Math.max(GAP, at.x - width);
    if (y + height > window.innerHeight - GAP) {
      if (at.y - height >= GAP) y = at.y - height;
      else if (options.room && !grown) {
        grown = true;
        options.room.grow(y + height + 3 * GAP - window.innerHeight);
      }
    }
    menu.style.left = `${Math.round(x)}px`;
    menu.style.top = `${Math.round(Math.max(GAP, y))}px`;
    menu.style.visibility = '';
  };
  place();
  const onResize = (): void => place();

  const step = (direction: 1 | -1): void => {
    if (buttons.length === 0) return;
    let next = active;
    for (let tries = 0; tries < buttons.length; tries++) {
      next = (next + direction + buttons.length) % buttons.length;
      if (!buttons[next]?.item.disabled) break;
    }
    active = next;
    paint();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      byKeyboard = true;
      step(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' || event.key === ' ') pick(active);
    else if (event.key === 'Escape' || event.key === 'Tab') closeMenu();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const onPointer = (event: MouseEvent): void => {
    if (!menu.contains(event.target as Node)) closeMenu();
  };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onPointer, true);
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', onResize);
  close = () => {
    close = null;
    menu.remove();
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
