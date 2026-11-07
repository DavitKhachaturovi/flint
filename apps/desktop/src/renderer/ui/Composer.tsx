/** The composer (mockup 01, D-51), shared by the main window and mini mode (D-110). */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from 'react';
import {
  blockFor,
  classifyPaste,
  fencedBlock,
  listToken,
  listTokenAt,
  parseCapture,
  suggestLists,
  type ListInfo,
  type TokenKind,
} from '@flint/core/shorthand';
import { listShorthand, PRIORITY_TOKENS, timeShorthand } from '../../shared/tokens.js';
import {
  openListPicker,
  openPriorityPicker,
  openTimePicker,
  type PickerHost,
} from '../pickers/pickers.js';
import type { ListSummary } from '../../shared/ipc.js';
import {
  BellIcon,
  ChevronIcon,
  CloseIcon,
  FlagIcon,
  HashIcon,
  LinkIcon,
  SendIcon,
} from '../main-window/icons.js';
import { openMenu } from '../menu/menu.js';
import { mediaUrl } from '../../shared/body-markdown.js';
import { codeLanguage } from '../../shared/code-language.js';
import { knownLinks } from '../../shared/link-patterns.js';
import { imageMenuItems, showInViewer } from '../media/media.js';
import { highlightLines } from '../highlight/highlight.js';
import { enableAutoPair } from '../auto-pair.js';
import { useInertText, type InertText } from '../main-window/inert-text.js';

let seq = 0;

/** D-111: the composers' unsent drafts, per list, for this window's session. */
interface Draft {
  readonly text: ReturnType<InertText['snapshot']>;
  readonly notes: string | null;
  readonly pasted: readonly ComposerPaste[];
}
const drafts = new Map<string, Draft>();

const PRIORITY_NAMES = { high: 'High', medium: 'Medium', low: 'Low' } as const;

/** The lists as the shorthand and the pickers see them, most recently used ranked (D-25). */
export function listInfos(lists: readonly ListSummary[]): ListInfo[] {
  return lists.map((list): ListInfo => ({
    id: list.id,
    name: list.name,
    mode: list.mode,
    ...(list.recentRank === undefined ? {} : { recentRank: list.recentRank }),
  }));
}

/**
 * The composer (mockup 01, TASK-02): adds to the top of this list with the capture shorthand;
 * `##list` sends the task elsewhere (D-25). Chips show what the shorthand will do.
 */
export function Composer(props: {
  readonly listId: string;
  readonly lists: readonly ListSummary[];
  readonly inputRef: RefObject<HTMLInputElement | null>;
  /** `chooseNewList`: the close-match card was flipped to a new list (Tab, D-25). */
  readonly onAdd: (text: string, chooseNewList: boolean) => Promise<void>;
  /** D-92: Today's "Add a task to today…". */
  readonly placeholder?: string;
  /**
   * D-110: mini mode's compact size: no tool buttons (the shorthand does it), a send arrow beside
   * the field, the `##` menu and list card above it, and the shorthand hint only while the field
   * is focused and empty.
   */
  readonly compact?: boolean;
}): ReactElement {
  const { listId, lists, inputRef, onAdd, placeholder = 'Add a task…', compact = false } = props;
  // D-111: what was typed here and not sent waits for this list, for the session (as the popup's
  // drafts do): the title (its pasted stretches still inert), the notes and the pastes.
  const draft = useRef(drafts.get(listId));
  const text = useInertText('', false);
  /** D-78: notes under the title (Shift+Enter, as in the capture popup): the new task's body. */
  const [notes, setNotes] = useState<string | null>(draft.current?.notes ?? null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const focusNotes = useRef(false);
  useEffect(() => {
    if (notes === null || !focusNotes.current) return;
    focusNotes.current = false;
    notesRef.current?.focus();
  }, [notes]);
  /**
   * D-80 (CAP-06 in the composer, as in the popup's selection area): pasted code, JSON or a stack
   * trace is a code card, a pasted image a thumbnail chip (the file is saved to attachments/ at
   * once); on Enter the body is the notes, then the code fenced, then the image links. Pasted
   * markdown and other text is typed as usual (D-79).
   */
  const [pasted, setPasted] = useState<readonly ComposerPaste[]>(draft.current?.pasted ?? []);
  useLayoutEffect(() => {
    if (draft.current) text.restore(draft.current.text);
  }, []);
  useEffect(() => {
    const kept = text.snapshot();
    if (kept.value === '' && (notes ?? '') === '' && pasted.length === 0) drafts.delete(listId);
    else drafts.set(listId, { text: kept, notes, pasted });
  }, [text.value, notes, pasted, listId]);
  const pasteRules = (event: React.ClipboardEvent): boolean => {
    const image = [...event.clipboardData.items]
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
      ?.getAsFile();
    if (image) {
      event.preventDefault();
      void image
        .arrayBuffer()
        .then((buffer) => window.flintMain.attach(new Uint8Array(buffer), image.type))
        .then((link) => {
          if (link) setPasted((current) => [...current, { kind: 'image', link, id: ++seq }]);
        });
      return true;
    }
    const clipboard = event.clipboardData.getData('text/plain');
    const kind = classifyPaste(clipboard);
    if (kind === 'text') return false;
    event.preventDefault();
    const block = blockFor(clipboard);
    setPasted((current) => [
      ...current,
      { kind: 'code', text: block.text, lang: kind === 'json' ? 'json' : '', id: ++seq },
    ]);
    return true;
  };
  const byButton = useRef(false);
  const submit = (): void => {
    const typed = text.escaped();
    if (typed.trim() === '') return;
    // APP-14, D-113: a task whose priority, list or reminder came from the buttons (the main
    // window's tips count it; mini mode's page has none).
    if (byButton.current)
      window.dispatchEvent(new CustomEvent('flint:tip', { detail: 'shorthand' }));
    byButton.current = false;
    const parts = [
      ...(notes?.trim() ? [notes.replace(/\s+$/, '')] : []),
      ...pasted.flatMap((item) =>
        item.kind === 'code' ? [fencedBlock(item.text, item.lang)] : [],
      ),
      ...pasted.flatMap((item) => (item.kind === 'image' ? [`![](${item.link})`] : [])),
    ];
    const body = parts.length > 0 ? `\n${parts.join('\n\n')}` : '';
    const newList = parsed?.target.kind === 'new' && chooseNewFor !== null;
    text.reset('', false);
    setNotes(null);
    setPasted([]);
    setChooseNewFor(null);
    setCardAcceptedFor(null);
    setMenuAcceptedFor(null);
    inputRef.current?.focus();
    void onAdd(typed + body, newList);
  };
  // UI-09: auto-closing brackets and quotes in the composer.
  useEffect(() => (inputRef.current ? enableAutoPair(inputRef.current) : undefined), [inputRef]);
  const infos = useMemo(() => listInfos(lists), [lists]);
  const { escaped, value } = text;
  /**
   * CAP-05, D-25, D-51, D-87: the popup's `##` menu (search and recent lists) and close-match card,
   * here too. Tab on the card flips between the close match and a new list.
   */
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(-1);
  const [menuAcceptedFor, setMenuAcceptedFor] = useState<string | null>(null);
  const [chooseNewFor, setChooseNewFor] = useState<string | null>(null);
  const [cardAcceptedFor, setCardAcceptedFor] = useState<string | null>(null);
  const { parsed, flippedFrom } = useMemo(() => {
    if (value.trim() === '') return { parsed: null, flippedFrom: null };
    const now = new Date();
    const first = parseCapture(escaped(), { now, lists: infos });
    if (chooseNewFor && first.target.kind === 'close-match' && first.target.name === chooseNewFor)
      return {
        parsed: parseCapture(escaped(), { now, lists: infos, chooseNewList: true }),
        flippedFrom: first.target.list,
      };
    return { parsed: first, flippedFrom: null };
  }, [value, escaped, infos, chooseNewFor]);
  const token = useMemo(() => {
    const at = listTokenAt(value, caret);
    // A pasted `##` is text (D-45): no menu for it.
    if (!at || escaped().includes(`\\${value.slice(at.start, at.end)}`)) return null;
    return { ...at, text: value.slice(at.start, at.end) };
  }, [value, caret, escaped]);
  const suggestions = useMemo(
    () =>
      // D-89: every matching list; the menu scrolls past five.
      token && token.text !== menuAcceptedFor ? suggestLists(token.typed, infos) : [],
    [token, menuAcceptedFor, infos],
  );
  useEffect(() => setHighlight(-1), [suggestions.map((list) => list.id).join()]);
  // D-89: the highlighted list stays in view as ↑/↓ go past the menu's five visible rows.
  const suggestionsBox = useRef<HTMLUListElement>(null);
  useEffect(() => {
    suggestionsBox.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);
  const cardTarget =
    parsed &&
    (parsed.target.kind === 'close-match' || parsed.target.kind === 'new') &&
    parsed.target.name !== cardAcceptedFor
      ? parsed.target
      : null;
  /** Replaces a stretch of the title with the list's own spelling, the caret after it. */
  const spell = (start: number, end: number, list: ListInfo): string => {
    const spelled = `##${listToken(list.name)}`;
    const next = value.slice(0, start) + spelled + value.slice(end);
    text.change(next);
    const at = start + spelled.length;
    setCaret(at);
    window.requestAnimationFrame(() => inputRef.current?.setSelectionRange(at, at));
    return spelled;
  };
  const acceptSuggestion = (list: ListInfo | undefined): void => {
    if (!list || !token) return;
    setMenuAcceptedFor(spell(token.start, token.end, list));
  };
  const acceptCard = (): void => {
    if (!parsed || !cardTarget) return;
    const winner = parsed.tokens.find((item) => item.kind === 'list' && item.role === 'winner');
    if (cardTarget.kind === 'close-match' && winner) {
      const { toOriginal } = text.mapped();
      setMenuAcceptedFor(spell(toOriginal(winner.start), toOriginal(winner.end), cardTarget.list));
    } else setCardAcceptedFor(cardTarget.name);
  };
  const chips: string[] = [];
  if (parsed?.priority) chips.push(PRIORITY_NAMES[parsed.priority]);
  const target = parsed?.target;
  if ((target?.kind === 'existing' || target?.kind === 'close-match') && target.list.id !== listId)
    chips.push(`→ ${target.list.name}`);
  if (target?.kind === 'new') chips.push(`New list ${target.name}`);
  // D-105: the links the task will show, while it is typed (a pasted URL as its short form).
  const links = parsed ? knownLinks(parsed.title) : [];

  /**
   * CAP-11, D-57: a picker's choice becomes the same shorthand typing would give. The token of
   * that kind already in the text is replaced (never left behind as text, D-25); null removes it.
   */
  const replaceToken = (kind: TokenKind, token: string | null): void => {
    // APP-14, D-113: set with a button, not typed (the shorthand tip counts these).
    if (token !== null) byButton.current = true;
    for (let guard = 0; guard < 10; guard++) {
      const { text: parsedText, toOriginal } = text.mapped();
      const found = parseCapture(parsedText, { now: new Date(), lists: infos }).tokens.find(
        (item) => item.kind === kind,
      );
      if (!found) break;
      const current = text.current();
      let start = toOriginal(found.start);
      let end = toOriginal(found.end);
      if (current[end] === ' ') end++;
      else if (start > 0 && current[start - 1] === ' ') start--;
      text.change(current.slice(0, start) + current.slice(end));
    }
    if (token) text.insertLive(token);
    inputRef.current?.focus();
  };
  const host = (button: HTMLElement): PickerHost => ({
    anchor: button.getBoundingClientRect(),
    returnFocus: inputRef.current,
    trigger: button,
  });

  const field = (
    <input
      ref={inputRef}
      className="composer-input"
      placeholder={placeholder}
      value={value}
      spellCheck={false}
      aria-controls="composer-suggestions"
      onChange={(event) => {
        text.change(event.target.value);
        setCaret(event.target.selectionStart ?? event.target.value.length);
      }}
      onSelect={(event) =>
        setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
      }
      onPaste={(event) => {
        if (!pasteRules(event)) text.paste();
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter' && event.shiftKey) {
          event.preventDefault();
          focusNotes.current = true;
          if (notes === null) setNotes('');
          else notesRef.current?.focus();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          // D-40: with the menu or the card showing, Enter first accepts it; the next saves.
          if (suggestions.length > 0) acceptSuggestion(suggestions[Math.max(0, highlight)]);
          else if (cardTarget) acceptCard();
          else submit();
        } else if (
          (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
          suggestions.length > 0
        ) {
          event.preventDefault();
          const step = event.key === 'ArrowDown' ? 1 : -1;
          setHighlight((at) => (at + step + suggestions.length) % suggestions.length);
        } else if (event.key === 'Tab' && !event.shiftKey && parsed) {
          // D-25: Tab flips the card between the close match and a new list.
          if (parsed.target.kind === 'close-match') {
            event.preventDefault();
            setChooseNewFor(parsed.target.name);
            setCardAcceptedFor(null);
          } else if (parsed.target.kind === 'new' && chooseNewFor) {
            event.preventDefault();
            setChooseNewFor(null);
            setCardAcceptedFor(null);
          }
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );

  return (
    <section
      className={
        compact
          ? `card composer compact${value === '' && notes === null ? ' empty' : ''}`
          : 'card composer'
      }
      aria-label="Add a task"
      // UI-01, D-65: the whole card is the text box's target (one cursor, no flicker around it).
      onMouseDown={(event) => {
        const target = event.target as HTMLElement;
        // D-111: the notes field (and anything else that takes text or a click) keeps its own.
        if (target.closest('button, input, textarea, a, [contenteditable="true"]')) return;
        event.preventDefault();
        inputRef.current?.focus();
      }}
    >
      {compact ? (
        <div className="composer-line">
          {field}
          <button
            type="button"
            className="composer-send"
            aria-label="Add"
            title="Add (Enter)"
            disabled={value.trim() === ''}
            onClick={submit}
          >
            <SendIcon />
          </button>
        </div>
      ) : (
        field
      )}
      {suggestions.length > 0 && (
        <ul
          ref={suggestionsBox}
          id="composer-suggestions"
          className="composer-suggestions"
          role="listbox"
          aria-label="Lists"
        >
          {suggestions.map((list, index) => (
            <li
              key={list.id}
              className="composer-suggestion"
              role="option"
              aria-selected={index === highlight}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                acceptSuggestion(list);
                inputRef.current?.focus();
              }}
            >
              <span className="composer-suggestion-tile">
                <HashIcon size={13} />
              </span>
              <span>{list.name}</span>
            </li>
          ))}
        </ul>
      )}
      {suggestions.length === 0 && cardTarget && (
        <div className="composer-choice" aria-live="polite">
          {cardTarget.kind === 'new' && flippedFrom ? (
            <>
              <span className="composer-option selected">
                New list &quot;{cardTarget.name}&quot; <span className="composer-key">Enter</span>
              </span>
              <span className="composer-option">
                {flippedFrom.name} <span className="composer-key">Tab</span>
              </span>
            </>
          ) : cardTarget.kind === 'close-match' ? (
            <>
              <span className="composer-option selected">
                {cardTarget.list.name} <span className="composer-key">Enter</span>
              </span>
              <span className="composer-option">
                New list &quot;{cardTarget.name}&quot; <span className="composer-key">Tab</span>
              </span>
            </>
          ) : (
            <span className="composer-option selected">
              New list &quot;{cardTarget.name}&quot; <span className="composer-key">Enter</span>
            </span>
          )}
        </div>
      )}
      {notes !== null && (
        <textarea
          ref={notesRef}
          className="composer-notes"
          aria-label="Notes"
          placeholder="Notes, code, links…"
          value={notes}
          spellCheck={false}
          onChange={(event) => setNotes(event.target.value)}
          onPaste={(event) => void pasteRules(event)}
          onKeyDown={(event) => {
            const field = event.currentTarget;
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            } else if (event.key === 'Backspace' && field.value === '') {
              event.preventDefault();
              setNotes(null);
              inputRef.current?.focus();
            } else if (
              (event.key === 'ArrowUp' && field.selectionStart === 0) ||
              (event.key === 'Tab' && event.shiftKey)
            ) {
              event.preventDefault();
              inputRef.current?.focus();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              field.blur();
            }
          }}
        />
      )}
      {pasted.length > 0 && (
        <ComposerPastes
          items={pasted}
          onRemove={(id) => setPasted((current) => current.filter((item) => item.id !== id))}
        />
      )}
      <div className="composer-bar">
        {!compact && (
          <div className="tools">
            <button
              type="button"
              className="tool"
              data-picker-trigger
              aria-label="Set priority"
              onClick={(event) =>
                openPriorityPicker(
                  host(event.currentTarget),
                  parsed?.priority ?? null,
                  (priority) =>
                    replaceToken('priority', priority ? PRIORITY_TOKENS[priority] : null),
                )
              }
            >
              <FlagIcon />
            </button>
            <button
              type="button"
              className="tool"
              data-picker-trigger
              aria-label="Choose list"
              onClick={(event) =>
                openListPicker(
                  host(event.currentTarget),
                  infos,
                  { placeholder: 'Add to list…' },
                  (pick) =>
                    replaceToken(
                      'list',
                      'newList' in pick
                        ? listShorthand(pick.newList)
                        : // The list the composer is in needs no token.
                          pick.list.id === listId
                          ? null
                          : listShorthand(pick.list.name),
                    ),
                )
              }
            >
              <HashIcon />
            </button>
            <button
              type="button"
              className="tool"
              data-picker-trigger
              aria-label="Set reminder"
              onClick={(event) =>
                openTimePicker(
                  host(event.currentTarget),
                  new Date(),
                  parsed?.reminder ?? null,
                  (at) => replaceToken('reminder', timeShorthand(at)),
                )
              }
            >
              <BellIcon size={15} />
            </button>
          </div>
        )}
        {chips.length > 0 || parsed?.reminderLabel || links.length > 0 ? (
          <span className="composer-chips">
            {chips.map((chip) => (
              <span key={chip} className="chip">
                {chip}
              </span>
            ))}
            {links.map((link) => (
              <span key={`link:${link.label}`} className="chip link-chip" title={link.href}>
                <LinkIcon />
                {link.label}
              </span>
            ))}
            {parsed?.reminderLabel && (
              <span className="chip">
                <BellIcon />
                {parsed.reminderLabel}
              </span>
            )}
          </span>
        ) : (
          <span className="hint">
            or type <span className="chip">!h ##list @15:00</span> · Shift+Enter for notes
          </span>
        )}
      </div>
    </section>
  );
}

/** D-80: what was pasted into the composer, shown under it until Enter. */
type ComposerPaste =
  | {
      readonly kind: 'code';
      readonly text: string;
      /** The fence's language (json), or none. */
      readonly lang: string;
      readonly id: number;
    }
  | { readonly kind: 'image'; readonly link: string; readonly id: number };

/** Lines a folded code card shows (as in the popup, D-38). */
const PREVIEW_LINES = 4;

/**
 * D-80: pasted code as a card (language, background, the first lines with a chevron to see all, ×
 * to remove; a preview, not edited here) and pasted images as thumbnail chips, as in the capture
 * popup's selection area (CAP-06, D-38). Removing an image keeps its file (MEDIA-04).
 */
function ComposerPastes(props: {
  readonly items: readonly ComposerPaste[];
  readonly onRemove: (id: number) => void;
}): ReactElement {
  const { items, onRemove } = props;
  const images = items.filter((item) => item.kind === 'image');
  return (
    <div className="composer-pastes">
      {items.map((item) =>
        item.kind === 'code' ? (
          <CodePreview key={item.id} item={item} onRemove={() => onRemove(item.id)} />
        ) : null,
      )}
      {images.length > 0 && (
        <div className="composer-images">
          {images.map((item) => (
            <span
              key={item.id}
              className="chip image-chip"
              // MEDIA-02, D-87: the picture's menu.
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const url = mediaUrl(item.link) ?? '';
                openMenu(
                  imageMenuItems(item.link, () => showInViewer([url], 0)),
                  { x: event.clientX, y: event.clientY },
                );
              }}
            >
              <img className="thumb" src={mediaUrl(item.link) ?? ''} alt="" />
              <span>{item.link.split('/').pop()}</span>
              <button
                type="button"
                className="chip-x"
                aria-label="Remove image"
                onClick={() => onRemove(item.id)}
              >
                <CloseIcon size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CodePreview(props: {
  readonly item: Extract<ComposerPaste, { kind: 'code' }>;
  readonly onRemove: () => void;
}): ReactElement {
  const { item, onRemove } = props;
  const [open, setOpen] = useState(false);
  const code = useRef<HTMLPreElement>(null);
  const lines = useMemo(() => item.text.split(/\r\n|\r|\n/), [item.text]);
  useLayoutEffect(() => {
    const kind = item.lang === 'json' ? 'json' : blockFor(item.text).kind;
    code.current?.replaceChildren(
      ...highlightLines(kind, open ? lines : lines.slice(0, PREVIEW_LINES)),
    );
  }, [item, lines, open]);
  return (
    <section className="composer-code">
      <header className="composer-code-head">
        <span className="code-kind">
          {codeLanguage(item.text, item.lang)} · {lines.length}{' '}
          {lines.length === 1 ? 'line' : 'lines'}
        </span>
        {lines.length > PREVIEW_LINES && (
          <button
            type="button"
            className={open ? 'code-toggle open' : 'code-toggle'}
            aria-expanded={open}
            aria-label={open ? 'Show less' : 'Show all'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setOpen(!open)}
          >
            <ChevronIcon size={12} />
          </button>
        )}
        <button type="button" className="chip-x" aria-label="Remove code" onClick={onRemove}>
          <CloseIcon size={10} />
        </button>
      </header>
      <pre ref={code} className={open ? 'composer-code-lines open' : 'composer-code-lines'} />
    </section>
  );
}
