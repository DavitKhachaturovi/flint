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

const icon = (path: string): string =>
  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const FILE_ICON = icon(
  '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"></path><path d="M14 3v6h6"></path>',
);
const PLAY_ICON = icon('<path d="m8 5 11 7-11 7Z"></path>');

/** "File not found" (D-84), with the original path; replaces the media where it was. */
function notFound(holder: HTMLElement, link: string): void {
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
  // A linked file keeps its badge.
  const badge = holder.querySelector('.fl-media-badge');
  holder.replaceChildren(...(badge ? [badge] : []), box);
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
  const badge = holder.querySelector('.fl-media-badge');
  holder.replaceChildren(...(badge ? [badge] : []), box);
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

/** A short message (a refused program, a failed copy) for the window's toast. */
export function announce(text: string): void {
  window.dispatchEvent(new CustomEvent<string>('flint:notice', { detail: text }));
}
