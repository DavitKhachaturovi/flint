import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { blockFor, type BlockKind } from '@flint/core/shorthand';
import { MarkdownEditor } from '../editor/MarkdownEditor.js';
import { bodyHtml, removeBodyPart } from '../../shared/body-markdown.js';
import { linkPatternsVersion } from '../../shared/link-patterns.js';
import { codeLanguage } from '../../shared/code-language.js';
import { highlightLines } from '../highlight/highlight.js';
import { highlightLanguage } from '../highlight/languages.js';
import { openMenu } from '../menu/menu.js';
import {
  announce,
  imageMenuItems,
  isLinkedFile,
  mediaElement,
  openAttachment,
  relink,
} from '../media/media.js';

const COPY_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2.5"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>';

const TRASH_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"></path></svg>';

/** D-80: a part of a body that can be removed (a code block or an image), as numbered in the HTML. */
interface Part {
  readonly kind: 'code' | 'image';
  readonly index: number;
}

/** D-80: the small trash button in a code card's or an image's corner. */
function trashButton(part: Part, onRemove: (part: Part, from: HTMLElement) => void): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'part-trash';
  const label = part.kind === 'code' ? 'Delete code block' : 'Delete image';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = TRASH_ICON;
  button.addEventListener('mousedown', (event) => event.stopPropagation());
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onRemove(part, button);
  });
  return button;
}

/**
 * The code blocks of rendered body HTML, highlighted in place (UI-06): JSON and stack traces. Each
 * becomes a small code card with its kind and a copy button (D-77, mockup 01), and, when the body
 * can be changed, a trash button (D-80); so does every image.
 */
function highlightCode(
  root: HTMLElement,
  onRemove: ((part: Part, from: HTMLElement) => void) | null,
): void {
  for (const pre of root.querySelectorAll<HTMLElement>('pre.body-code')) {
    const code = pre.querySelector('code');
    if (!code) continue;
    const text = code.textContent ?? '';
    const lang = (pre.dataset['lang'] ?? '').toLowerCase();
    const kind: BlockKind = lang === 'json' ? 'json' : blockFor(text).kind;
    code.replaceChildren(...highlightLines(kind, text.split('\n')));
    // D-84: any other language CodeMirror knows, once it has loaded (plain until then).
    if (lang !== '' && lang !== 'json' && kind !== 'stack-trace')
      void highlightLanguage(code, text, lang);
    const card = document.createElement('div');
    card.className = 'code-card';
    const head = document.createElement('div');
    head.className = 'code-head';
    const label = document.createElement('span');
    label.className = 'code-kind';
    // D-79: the detected language (yaml, json, stack trace…), never just "code" when it can tell.
    label.textContent = codeLanguage(text, lang);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'code-copy';
    copy.title = 'Copy';
    copy.setAttribute('aria-label', 'Copy code');
    copy.innerHTML = COPY_ICON;
    copy.addEventListener('click', (event) => {
      event.stopPropagation();
      void navigator.clipboard.writeText(text).then(() => {
        copy.classList.add('copied');
        copy.title = 'Copied';
        window.setTimeout(() => {
          copy.classList.remove('copied');
          copy.title = 'Copy';
        }, 1200);
      });
    });
    head.append(label, copy);
    const part = Number(pre.dataset['part']);
    if (onRemove && Number.isInteger(part))
      head.append(trashButton({ kind: 'code', index: part }, onRemove));
    pre.replaceWith(card);
    card.append(head, pre);
  }
  // D-84: videos and linked files: Flint's media element (badge, not-found, default player).
  for (const slot of root.querySelectorAll<HTMLElement>('.fl-media-slot')) {
    const media = mediaElement(slot.dataset['link'] ?? '', slot.dataset['alt'] ?? '');
    media.dataset['part'] = slot.dataset['part'] ?? '';
    slot.replaceWith(media);
  }
  if (!onRemove) return;
  for (const image of root.querySelectorAll<HTMLElement>('img[data-part], .fl-media[data-part]')) {
    const holder = document.createElement('span');
    holder.className = 'body-image';
    image.replaceWith(holder);
    holder.append(
      image,
      trashButton({ kind: 'image', index: Number(image.dataset['part']) }, onRemove),
    );
  }
}

/**
 * D-80: where a removed part was, a copy of it folds away (its height and opacity) while the body
 * already shows without it: the change is made at once (D-75). A part that sits in a paragraph of
 * its own (an image on its line) folds with that paragraph; one inside text just goes.
 */
interface Leaving {
  readonly copy: HTMLElement;
  /** Its place among the body's blocks. */
  readonly at: number;
}

function leavingCopy(root: HTMLElement, from: HTMLElement): Leaving | null {
  const part = from.closest<HTMLElement>('.code-card, .body-image');
  if (!part) return null;
  let block: HTMLElement = part;
  while (block.parentElement && block.parentElement !== root) block = block.parentElement;
  if (block.parentElement !== root) return null;
  // An image inside text: nothing to fold.
  if (part.matches('.body-image') && (block.textContent ?? '').trim() !== '') return null;
  const copy = block.cloneNode(true) as HTMLElement;
  copy.classList.add('part-leaving');
  copy.setAttribute('aria-hidden', 'true');
  copy.style.height = `${block.offsetHeight}px`;
  return { copy, at: [...root.children].indexOf(block) };
}

function foldAwayCopy(root: HTMLElement, leaving: Leaving): void {
  const { copy, at } = leaving;
  root.insertBefore(copy, root.children[at] ?? null);
  const style = getComputedStyle(document.documentElement);
  const duration = parseFloat(style.getPropertyValue('--fl-dur-state')) || 260;
  copy
    .animate(
      [
        { height: copy.style.height, opacity: 1 },
        { height: '0px', opacity: 0, marginTop: '0px', marginBottom: '0px' },
      ],
      { duration, easing: 'cubic-bezier(.2, .9, .3, 1)', fill: 'forwards' },
    )
    .finished.then(
      () => copy.remove(),
      () => copy.remove(),
    );
}

/** D-79: opens the lightbox on one of the body's images. */
export type ShowImage = (images: readonly string[], index: number) => void;

/**
 * A task's body, rendered (TASK-05, D-49): markdown with its line breaks (D-76), highlighted code,
 * images from the Flint folder. A click on a link opens it in the browser, on an image the lightbox
 * (D-79); a click anywhere else starts editing.
 */
function BodyView(props: {
  readonly body: string;
  readonly onEdit: () => void;
  readonly onImage?: ShowImage | undefined;
  /** D-80: the body without a removed code block or image, to save. */
  readonly onRemovePart?: ((body: string, kind: Part['kind']) => void) | undefined;
  /** D-84: the body with a linked file copied into Flint. */
  readonly onRelink?: ((body: string) => void) | undefined;
}): ReactElement {
  const { body, onEdit, onImage, onRemovePart, onRelink } = props;
  const box = useRef<HTMLDivElement>(null);
  // D-84: made again when the link patterns arrive or change.
  const patterns = linkPatternsVersion();
  const html = useMemo(() => bodyHtml(body), [body, patterns]);
  const leaving = useRef<Leaving | null>(null);
  const latest = useRef({ body, onRemovePart });
  latest.current = { body, onRemovePart };
  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    const remove = (part: Part, from: HTMLElement): void => {
      const save = latest.current.onRemovePart;
      if (!save) return;
      const next = removeBodyPart(latest.current.body, part.kind, part.index);
      if (next === latest.current.body) return;
      leaving.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? null
        : leavingCopy(root, from);
      save(next, part.kind);
    };
    highlightCode(root, onRemovePart ? remove : null);
    const copy = leaving.current;
    leaving.current = null;
    if (copy) foldAwayCopy(root, copy);
    // Only a new body is rendered again (the cards are built on its HTML once); the handlers are
    // read through `latest`.
  }, [html]);
  return (
    <div
      ref={box}
      className="body-view"
      dangerouslySetInnerHTML={{ __html: html }}
      onContextMenu={(event) => {
        // D-84: an attachment's own menu: open it, copy a linked one in, or delete it.
        const media = (event.target as HTMLElement).closest<HTMLElement>('.body-image');
        const link = media?.querySelector<HTMLElement>('[data-link]')?.dataset['link'] ?? '';
        if (!media || link === '') return;
        event.preventDefault();
        event.stopPropagation();
        const trash = media.querySelector<HTMLButtonElement>('.part-trash');
        // MEDIA-02, D-87: a picture's menu: copy it, see it large, open it, find it.
        const picture = media.querySelector('img');
        const pictures = box.current
          ? [...box.current.querySelectorAll('img')].filter(
              (item) => !item.closest('.fl-media.missing'),
            )
          : [];
        openMenu(
          [
            ...(picture
              ? imageMenuItems(link, () =>
                  onImage?.(
                    pictures.map((item) => item.getAttribute('src') ?? ''),
                    pictures.indexOf(picture),
                  ),
                )
              : [{ label: 'Open in default app', action: () => void openAttachment(media, link) }]),
            ...(isLinkedFile(link) && onRelink
              ? [
                  {
                    label: 'Copy into Flint',
                    action: () =>
                      void window.flintMain.copyIntoFlint(link).then((outcome) => {
                        if (outcome?.ok) onRelink(relink(latest.current.body, link, outcome.link));
                        else if (outcome) announce(outcome.problem);
                      }),
                  },
                ]
              : []),
            ...(trash
              ? ['divider' as const, { label: 'Delete', action: () => trash.click() }]
              : []),
          ],
          { x: event.clientX, y: event.clientY },
        );
      }}
      onClick={(event) => {
        const link = (event.target as HTMLElement).closest('a');
        if (link) {
          event.preventDefault();
          const href = link.getAttribute('href') ?? '';
          // D-84: an attachment link (a document) opens in its default app, by Flint's rules.
          if (/^(https?|mailto):/i.test(href)) window.flintMain.openLink(link.href);
          else void openAttachment(null, href);
          return;
        }
        const image = (event.target as HTMLElement).closest('img');
        if (image && onImage && box.current) {
          const all = [...box.current.querySelectorAll('img')].filter(
            (item) => !item.closest('.fl-media.missing'),
          );
          onImage(
            all.map((item) => item.getAttribute('src') ?? ''),
            all.indexOf(image),
          );
          return;
        }
        if ((event.target as HTMLElement).closest('button')) return;
        // Selecting text in the body doesn't start editing.
        if (window.getSelection()?.isCollapsed !== false) onEdit();
      }}
    />
  );
}

/**
 * A body being edited, in the note editor's live preview (M5, D-79; replaces M4's plain field), in
 * the rendered text's place and type, so starting to edit moves nothing (D-76). Esc or leaving it
 * saves; Enter is a new line. Pasting follows CAP-06 (code fenced, images attached).
 */
function BodyEditor(props: {
  readonly initial: string;
  readonly placeholder?: string;
  readonly onDone: (body: string) => void;
  /** D-87: saves what is typed as it is typed (debounced), and if the editor goes unexpectedly. */
  readonly onSave?: ((body: string) => void) | undefined;
  readonly onImage?: ShowImage | undefined;
}): ReactElement {
  const { initial, placeholder, onDone, onImage } = props;
  const done = useRef(false);
  const autosave = useAutosave(initial, props.onSave);
  const leave = (value: string): void => {
    if (done.current) return;
    done.current = true;
    autosave.settle(value);
    onDone(value);
  };
  return (
    <div onMouseDown={(event) => event.stopPropagation()}>
      <MarkdownEditor
        text={initial}
        className="body-editor"
        ariaLabel="Body"
        autoFocus
        caretAtEnd
        {...(placeholder ? { placeholder } : {})}
        handlers={{
          openLink: (href) => window.flintMain.openLink(href),
          openImage: (images, index) => onImage?.(images, index),
        }}
        onChange={autosave.change}
        onBlur={leave}
        onEscape={leave}
      />
    </div>
  );
}

const SAVE_AFTER_MS = 600;

/**
 * D-87: a notes editor never loses what was typed: each change is saved a moment later (as notes
 * are), and what is still unsaved is saved when the editor goes, whether or not it was left first.
 * `settle` marks a value as saved by the caller (leaving the editor saves it itself).
 */
export function useAutosave(
  initial: string,
  save: ((text: string) => void) | undefined,
): { readonly change: (text: string) => void; readonly settle: (text: string) => void } {
  const state = useRef({ value: initial, saved: initial, timer: 0 });
  const saveRef = useRef(save);
  saveRef.current = save;
  const flush = (): void => {
    const current = state.current;
    window.clearTimeout(current.timer);
    if (current.value === current.saved) return;
    current.saved = current.value;
    saveRef.current?.(current.value);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);
  return {
    change: (text) => {
      state.current.value = text;
      window.clearTimeout(state.current.timer);
      state.current.timer = window.setTimeout(() => flushRef.current(), SAVE_AFTER_MS);
    },
    settle: (text) => {
      window.clearTimeout(state.current.timer);
      state.current.value = text;
      state.current.saved = text;
    },
  };
}

/**
 * A task's body in its place (TASK-05, D-49, D-76, D-77): rendered, or in its plain field while
 * edited. Inline, in its task's raised card, a body longer than about eight lines shows only its
 * top lines, fading out; it isn't edited there: a click on it, or "Open as page", opens the page.
 * On the task's page it shows in full.
 */
export function BodyBlock(props: {
  readonly body: string;
  readonly inline: boolean;
  readonly editing: boolean;
  readonly editable: boolean;
  readonly onEdit: () => void;
  readonly onDone: (body: string) => void;
  readonly onOpenPage?: () => void;
  readonly onImage?: ShowImage;
  /** D-80: a code block or an image removed with its trash button: the body to save. */
  readonly onRemovePart?: (body: string, kind: 'code' | 'image') => void;
  /** D-84: Copy into Flint on a linked file: the body to save. */
  readonly onRelink?: (body: string) => void;
  /** D-87: saves while typing (debounced) and when the editor goes; never loses text. */
  readonly onSave?: (body: string) => void;
  readonly placeholder?: string;
}): ReactElement {
  const { body, inline, editing, editable, onEdit, onDone, onOpenPage, onImage, placeholder } =
    props;
  const onRemovePart = editable ? props.onRemovePart : undefined;
  const onRelink = editable ? props.onRelink : undefined;
  const clip = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const box = clip.current;
    if (!inline || editing || !box) {
      setLong(false);
      return;
    }
    // Images loading change the height: measured again whenever the content resizes.
    const measure = (): void => setLong(box.scrollHeight > box.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    if (box.firstElementChild) observer.observe(box.firstElementChild);
    return () => observer.disconnect();
  }, [body, inline, editing]);
  const classes = ['body-block', inline ? 'inline' : 'full'];
  if (editing) classes.push('editing');
  if (long) classes.push('long');
  return (
    <div className={classes.join(' ')}>
      {editing ? (
        <BodyEditor
          initial={body}
          onDone={onDone}
          onSave={props.onSave}
          onImage={onImage}
          {...(placeholder ? { placeholder } : {})}
        />
      ) : (
        <div className="body-clip" ref={clip}>
          <BodyView
            body={body}
            onImage={onImage}
            onRemovePart={onRemovePart}
            onRelink={onRelink}
            onEdit={() => {
              if (long && onOpenPage) onOpenPage();
              else if (editable) onEdit();
            }}
          />
        </div>
      )}
      {long && onOpenPage && (
        <button type="button" className="body-open-page" onClick={onOpenPage}>
          Open as page
        </button>
      )}
    </div>
  );
}

/**
 * D-86, D-87: a task's notes that are always the M5 editor (the context panel, a task's page), like
 * a note's body: typed in place, saved as typed (debounced), when left, and when the editor goes, so
 * nothing typed is lost. Changes from elsewhere show while nobody types in it.
 */
export function LiveNotes(props: {
  /** The task: a new one starts a new editor. */
  readonly id: string;
  readonly body: string;
  readonly className: string;
  readonly onSave: (body: string) => void;
  readonly onImage: ShowImage;
}): ReactElement {
  const { id, body, className, onSave, onImage } = props;
  const [focused, setFocused] = useState(false);
  // The text the editor was made with: it follows the body only while nobody types in it.
  const [shown, setShown] = useState(body);
  useEffect(() => {
    if (!focused) setShown(body);
  }, [body, focused]);
  const autosave = useAutosave(shown, onSave);
  const save = (text: string): void => {
    autosave.settle(text);
    if (text.trim() !== body.trim()) onSave(text);
  };
  return (
    <div
      className="live-notes"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <MarkdownEditor
        key={`${id}:${shown}`}
        text={shown}
        className={className}
        ariaLabel="Notes"
        placeholder="Notes, code, links…"
        handlers={{
          openLink: (href) => window.flintMain.openLink(href),
          openImage: (images, index) => onImage(images, index),
        }}
        onChange={autosave.change}
        onBlur={save}
        onEscape={(text) => {
          save(text);
          (document.activeElement as HTMLElement | null)?.blur();
        }}
      />
    </div>
  );
}
