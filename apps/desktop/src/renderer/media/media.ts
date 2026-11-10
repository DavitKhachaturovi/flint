import { mediaUrl } from '../../shared/body-markdown.js';

/**
 * Pictures, videos and other attachments in notes and task bodies (MEDIA-01, MEDIA-03, D-84), one
 * element for the editor and the rendered body alike. A video plays inline with a first-frame
 * thumbnail; one that can't (HEVC from a phone) offers its default player; a large file linked where
 * it is carries a "Linked" badge; a file that is no longer there shows "File not found" with its
 * path, never a broken player. Documents show as a file chip that opens in their default app.
 */

const VIDEO = /\.(mp4|m4v|webm|mov)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i;

export const isVideoLink = (link: string): boolean => VIDEO.test(link.split(/[?#]/)[0] ?? '');
export const isImageLink = (link: string): boolean => IMAGE.test(link.split(/[?#]/)[0] ?? '');
export const isLinkedFile = (link: string): boolean => /^file:\/\//i.test(link);

/** The file's name, from an `attachments/…` or `file:///…` link. */
export function linkName(link: string): string {
  const last = link.split(/[\\/]/).pop() ?? link;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** The path a person recognises: a linked file's Windows path, else the link. */
export function displayPath(link: string): string {
  if (!isLinkedFile(link)) return link;
  try {
    return decodeURIComponent(new URL(link).pathname.replace(/^\/([A-Za-z]:)/, '$1')).replace(
      /\//g,
      '\\',
    );
  } catch {
    return link;
  }
}

/**
 * SYNC-01, D-161: linked files of synced notes, as sync last recorded them (`file:///` target →
 * the PC that has it and its size), and this PC's name. A linked file never syncs: its line shows a
 * crossed-out cloud with the explanation (mockup 13).
 */
interface LinkedSync {
  readonly device: string;
  readonly size: number;
}
let linkedSync: ReadonlyMap<string, LinkedSync> = new Map();
let thisDevice = '';
export function setLinkedSync(files: ReadonlyMap<string, LinkedSync>, device: string): void {
  linkedSync = files;
  thisDevice = device;
}

/** Copy into Flint from the explanation: the editor that shows the line handles it (live preview). */
let copyHandler: ((holder: HTMLElement, link: string) => boolean) | null = null;
export function onCopyIntoFlint(handler: (holder: HTMLElement, link: string) => boolean): void {
  copyHandler = handler;
}

function sizeLabel(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

const elsewhere = (info: LinkedSync): boolean =>
  info.device.toUpperCase() !== thisDevice.toUpperCase();

/** The explanation under the crossed-out cloud: on this PC, or on another one. */
function explain(holder: HTMLElement, anchor: HTMLElement, link: string, info: LinkedSync): void {
  document.querySelector('.fl-sync-explain')?.remove();
  const card = document.createElement('div');
  card.className = 'fl-sync-explain';
  card.setAttribute('role', 'dialog');
  const title = document.createElement('span');
  title.className = 'fl-sync-explain-title';
  const text = document.createElement('span');
  text.className = 'fl-sync-explain-text';
  card.append(title, text);
  if (elsewhere(info)) {
    title.textContent = 'Not synced to this device';
    text.textContent = `On ${info.device} this file is linked from outside the Flint folder, so it was never synced. To have it here, open this note on ${info.device} and choose Copy into Flint.`;
  } else {
    const path = displayPath(link);
    const folder = path.includes('\\') ? path.slice(0, path.lastIndexOf('\\')) : path;
    title.textContent = 'Not synced';
    text.textContent = `This file is linked from outside the Flint folder (${folder}), so it stays on this PC. Other devices show this line with a note.`;
    if (copyHandler) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'fl-sync-explain-action';
      action.textContent = 'Copy into Flint to sync it';
      action.addEventListener('mousedown', (event) => event.preventDefault());
      action.addEventListener('click', () => {
        card.remove();
        copyHandler?.(holder, link);
      });
      card.append(action);
    }
  }
  const box = anchor.getBoundingClientRect();
  card.style.left = `${Math.max(8, Math.min(box.left - 12, window.innerWidth - 352))}px`;
  card.style.top = `${box.bottom + 8}px`;
  document.body.append(card);
  const close = (event: MouseEvent): void => {
    if (card.contains(event.target as Node) || anchor.contains(event.target as Node)) return;
    card.remove();
    window.removeEventListener('mousedown', close, true);
  };
  window.addEventListener('mousedown', close, true);
  anchor.addEventListener('mouseleave', () => {
    window.setTimeout(() => {
      if (!card.matches(':hover') && !anchor.matches(':hover') && card.dataset['pinned'] !== '1')
        card.remove();
    }, 250);
  });
  card.addEventListener('mouseleave', () => {
    if (card.dataset['pinned'] !== '1') card.remove();
  });
}

/** The crossed-out cloud and the chip's "1.8 GB · Linked" / "1.8 GB · on DAVIT-LAPTOP". */
function markUnsynced(holder: HTMLElement, badge: HTMLElement, link: string): void {
  const info = linkedSync.get(link);
  if (!info) return;
  badge.textContent = elsewhere(info)
    ? `${sizeLabel(info.size)} · on ${info.device}`
    : `${sizeLabel(info.size)} · Linked`;
  const cloud = document.createElement('button');
  cloud.type = 'button';
  cloud.className = 'fl-media-cloud';
  cloud.setAttribute('aria-label', elsewhere(info) ? 'Not synced to this device' : 'Not synced');
  cloud.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18.5a4.5 4.5 0 0 1-.5-8.97A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 10Z"></path><path d="M4 4l16 16"></path></svg>'; // constant markup
  cloud.addEventListener('mousedown', (event) => event.preventDefault());
  cloud.addEventListener('mouseenter', () => explain(holder, cloud, link, info));
  cloud.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    explain(holder, cloud, link, info);
    const card = document.querySelector<HTMLElement>('.fl-sync-explain');
    if (card) card.dataset['pinned'] = '1';
  });
  badge.classList.add('with-cloud');
  badge.append(cloud);
}

const icon = (path: string): string =>
  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const FILE_ICON = icon(
  '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"></path><path d="M14 3v6h6"></path>',
);
const PLAY_ICON = icon('<path d="m8 5 11 7-11 7Z"></path>');

/** "File not found" (D-84), with the original path; replaces the media where it was. */
function notFound(holder: HTMLElement, link: string): void {
  const info = linkedSync.get(link);
  if (info && elsewhere(info)) {
    holder.classList.add('missing', 'elsewhere');
    const box = document.createElement('span');
    box.className = 'fl-media-missing';
    const title = document.createElement('span');
    title.className = 'fl-media-missing-title';
    title.textContent = linkName(link);
    box.append(title);
    const kept = [...holder.querySelectorAll('.fl-media-badge')];
    holder.replaceChildren(...kept, box);
    return;
  }
  holder.classList.add('missing');
  const box = document.createElement('span');
  box.className = 'fl-media-missing';
  const title = document.createElement('span');
  title.className = 'fl-media-missing-title';
  title.textContent = 'File not found';
  const path = document.createElement('span');
  path.className = 'fl-media-missing-path';
  path.textContent = displayPath(link);
  box.append(title, path);
  // A linked file keeps its badge (and, synced, its cloud).
  const kept = [...holder.querySelectorAll('.fl-media-badge')];
  holder.replaceChildren(...kept, box);
}

/** A video that can't play here: its default player instead (D-84). */
function cannotPlay(holder: HTMLElement, link: string): void {
  const box = document.createElement('span');
  box.className = 'fl-media-unplayable';
  const name = document.createElement('span');
  name.className = 'fl-media-name';
  name.textContent = linkName(link);
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'fl-media-open';
  open.innerHTML = `${PLAY_ICON}<span>Open in default player</span>`; // constant markup
  open.addEventListener('mousedown', (event) => event.preventDefault());
  open.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openAttachment(holder, link);
  });
  box.append(name, open);
  const kept = [...holder.querySelectorAll('.fl-media-badge')];
  holder.replaceChildren(...kept, box);
}

/**
 * MEDIA-02, D-87: a picture's menu items (thumbnails in bodies, notes and the composer, and the
 * image viewer): Copy image, Open in viewer (when there is one to open), Open in default app,
 * Show in folder. `source` is the picture's markdown link or its `app://` address.
 */
export function imageMenuItems(
  source: string,
  viewer?: () => void,
): { label: string; action: () => void }[] {
  const run = (action: 'copy' | 'show' | 'open', done?: string): void =>
    void window.flintMain.imageAction(source, action).then((ok) => {
      if (!ok) announce('That picture is no longer there');
      else if (done) announce(done);
    });
  return [
    { label: 'Copy image', action: () => run('copy', 'Copied image') },
    ...(viewer ? [{ label: 'Open in viewer', action: viewer }] : []),
    { label: 'Open in default app', action: () => run('open') },
    { label: 'Show in folder', action: () => run('show') },
  ];
}

/**
 * D-89: another attachment's menu items (a document, a video): Open in default app, Show in folder.
 * `holder` turns into "File not found" when the file is gone.
 */
export function fileMenuItems(
  link: string,
  holder: HTMLElement | null,
): { label: string; action: () => void }[] {
  return [
    { label: 'Open in default app', action: () => void openAttachment(holder, link) },
    {
      label: 'Show in folder',
      action: () =>
        void window.flintMain.imageAction(link, 'show').then((ok) => {
          if (!ok) announce('That file is no longer there');
        }),
    },
  ];
}

/** Opens the file in its default app; a missing one turns into "File not found". */
export async function openAttachment(holder: HTMLElement | null, link: string): Promise<void> {
  const outcome = await window.flintMain.openAttachment(link);
  if (outcome === 'missing' && holder) notFound(holder, link);
}

/** When the media fails: missing, or (a video) not playable here. */
function failed(holder: HTMLElement, link: string, video: boolean): void {
  void window.flintMain.attachmentExists(link).then((exists) => {
    if (!exists) notFound(holder, link);
    else if (video) cannotPlay(holder, link);
  });
}

/**
 * The element for a picture, video or other attachment at `link` (the markdown target, unchanged:
 * `attachments/…` or `file:///…`). `alt` is the image's alt text.
 */
export function mediaElement(link: string, alt: string): HTMLElement {
  const holder = document.createElement('span');
  holder.className = 'fl-media';
  holder.dataset['link'] = link;
  const src = mediaUrl(link);
  if (isLinkedFile(link)) {
    holder.classList.add('linked');
    const badge = document.createElement('span');
    badge.className = 'fl-media-badge';
    badge.textContent = 'Linked';
    badge.title = `Linked to ${displayPath(link)} (not copied into Flint)`;
    holder.append(badge);
    markUnsynced(holder, badge, link);
  }
  if (src && isVideoLink(link)) {
    holder.classList.add('video');
    const video = document.createElement('video');
    // `#t=0.1` shows the first frame as the thumbnail before it plays.
    video.src = `${src}#t=0.1`;
    video.controls = true;
    video.preload = 'metadata';
    video.addEventListener('error', () => failed(holder, link, true), { once: true });
    holder.prepend(video);
    return holder;
  }
  if (src && isImageLink(link)) {
    holder.classList.add('image');
    const image = document.createElement('img');
    image.src = src;
    image.alt = alt;
    image.dataset['src'] = src;
    image.addEventListener('error', () => failed(holder, link, false), { once: true });
    holder.prepend(image);
    return holder;
  }
  // Anything else Flint may open: a file chip (D-84), opened in its default app on a click.
  holder.classList.add('file');
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'fl-media-file';
  chip.innerHTML = FILE_ICON; // constant markup
  const name = document.createElement('span');
  name.textContent = alt || linkName(link);
  chip.append(name);
  chip.addEventListener('mousedown', (event) => event.preventDefault());
  chip.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openAttachment(holder, link);
  });
  holder.prepend(chip);
  return holder;
}

/** `](old)` → `](new)` everywhere in a text: Copy into Flint (D-84) relinks the attachment. */
export function relink(text: string, old: string, next: string): string {
  return text.split(`](${old})`).join(`](${next})`).split(`](<${old}>)`).join(`](${next})`);
}

/**
 * MEDIA-03, D-84: the notice for a large file linked where it is: it stays until acted on or
 * dismissed. `relink` swaps the link in the editor that added it, when that is still open.
 */
export interface LinkedNotice {
  readonly name: string;
  readonly link: string;
  readonly relink: (next: string) => boolean;
}

export function announceLinked(notice: LinkedNotice): void {
  window.dispatchEvent(new CustomEvent<LinkedNotice>('flint:linked', { detail: notice }));
}

/** D-87: pictures shown in the main window's viewer. */
export function showInViewer(images: string[], index: number): void {
  window.dispatchEvent(new CustomEvent('flint:image', { detail: { images, index } }));
}

/** A short message (a refused program, a failed copy) for the window's toast. */
export function announce(text: string): void {
  window.dispatchEvent(new CustomEvent<string>('flint:notice', { detail: text }));
}

/** An editor's change with its own Undo (a table's row deleted, NOTE-10): the window's toast. */
export interface UndoNotice {
  readonly text: string;
  readonly undo: () => void;
  /** Set by the window that shows it: takes this toast away, if it is still the one shown. */
  hide?: () => void;
}

/**
 * Shows the Undo toast; returns the way to take it away from the editor (D-144, Proposed: the
 * note edited again, so its Undo could only take back something else). Never another toast.
 */
export function announceUndo(text: string, undo: () => void): () => void {
  const notice: UndoNotice = { text, undo };
  window.dispatchEvent(new CustomEvent<UndoNotice>('flint:notice-undo', { detail: notice }));
  return () => notice.hide?.();
}

/**
 * D-144: an editor's question for the window's toast ("This deletes content in 2 cells", Delete /
 * Cancel). `confirm` and `cancel` run at most once between them; the window shows it with
 * `cancel` as the toast's end, so its time running out or another toast counts as Cancel.
 */
export interface ConfirmNotice {
  readonly text: string;
  readonly label: string;
  readonly confirm: () => void;
  readonly cancel: () => void;
  /** Set by the window that shows it: takes the toast away (Esc in the editor). */
  hide?: () => void;
}

/** How long a question stays up, longer than a notice: it waits for an answer (D-144). */
export const CONFIRM_MS = 8000;

/**
 * Asks in the window's toast; returns the way to cancel from the editor (Esc), which also takes
 * the toast away. With no window to show it (none listening), it is cancelled at once.
 */
export function announceConfirm(
  text: string,
  label: string,
  answer: { readonly confirm: () => void; readonly cancel: () => void },
): () => void {
  let settled = false;
  const once = (run: () => void) => (): void => {
    if (settled) return;
    settled = true;
    run();
  };
  const notice: ConfirmNotice = {
    text,
    label,
    confirm: once(answer.confirm),
    cancel: once(answer.cancel),
  };
  window.dispatchEvent(new CustomEvent<ConfirmNotice>('flint:notice-confirm', { detail: notice }));
  if (!notice.hide) notice.cancel();
  return () => {
    if (settled) return;
    notice.cancel();
    notice.hide?.();
  };
}
