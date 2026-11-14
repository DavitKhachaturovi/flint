/**
 * What the app around the editor provides (D-165): the desktop's right-click menus and its pictures,
 * videos and attachments (through Electron); the phone's own, or none. Everything else in the editor
 * is plain CodeMirror and DOM, the same in both apps. An app calls `setEditorHost` once, before its
 * first editor.
 */

export interface MenuItem {
  readonly label: string;
  /** A key shown on the right, e.g. `Del`. */
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly checked?: boolean;
  readonly state?: 'done' | 'overdue';
  readonly action?: () => void;
  readonly submenu?: readonly MenuEntry[];
}

export type MenuEntry = MenuItem | 'divider';

export interface EditorHost {
  /** A right-click menu at a point; the phone has none (a long press selects text there). */
  readonly openMenu: (
    entries: readonly MenuEntry[],
    at: { readonly x: number; readonly y: number },
  ) => void;
  /** A picture, video or attachment chip for a link in a note (MEDIA-01). */
  readonly mediaElement: (link: string, alt: string) => HTMLElement;
  /** A picture's own menu items (copy, show in folder, open). */
  readonly imageMenuItems: (source: string, viewer?: () => void) => readonly MenuItem[];
  /** An attachment's menu items (open in its default app, show in folder). */
  readonly fileMenuItems: (link: string, holder: HTMLElement | null) => readonly MenuItem[];
  /** Copy into Flint for a linked large file (MEDIA-03): the app calls `handler` when asked. */
  readonly onCopyIntoFlint: (handler: (holder: HTMLElement, link: string) => boolean) => void;
  /** Copies a linked file into the Flint folder: its new link, or why not (null: nothing done). */
  readonly copyIntoFlint: (
    link: string,
  ) => Promise<
    | { readonly ok: true; readonly link: string }
    | { readonly ok: false; readonly problem: string }
    | null
  >;
}

function plainMedia(link: string, alt: string): HTMLElement {
  const holder = document.createElement('span');
  holder.className = 'fl-media';
  holder.textContent = alt || link;
  return holder;
}

let current: EditorHost = {
  openMenu: () => undefined,
  mediaElement: plainMedia,
  imageMenuItems: () => [],
  fileMenuItems: () => [],
  onCopyIntoFlint: () => undefined,
  copyIntoFlint: () => Promise.resolve(null),
};

let copyHandler: ((holder: HTMLElement, link: string) => boolean) | null = null;

/** The app's parts; what it leaves out keeps the plain default. */
export function setEditorHost(host: Partial<EditorHost>): void {
  current = { ...current, ...host };
  if (copyHandler) current.onCopyIntoFlint(copyHandler);
}

export function editorHost(): EditorHost {
  return current;
}

/** The editor's Copy into Flint, handed to the app now or when it sets its host. */
export function registerCopyIntoFlint(
  handler: (holder: HTMLElement, link: string) => boolean,
): void {
  copyHandler = handler;
  current.onCopyIntoFlint(handler);
}

/** A large file linked where it is (MEDIA-03), not copied into the Flint folder. */
export const isLinkedFile = (link: string): boolean => /^file:\/\//i.test(link);
