/**
 * Give to Claude (TASK-18, D-151): the prompt made from a task, and the link that opens Claude
 * Code in the Claude desktop app with it. Pure, so main, the renderer and the tests share it.
 *
 * Flint only hands `claude://code/new?q=…&folder=…` to Windows; it never runs anything, and the
 * prompt is sent only if the user sends it from Claude (APP-09).
 */

/** Claude keeps the first 14,336 characters of `q` (measured, D-151). */
export const CLAUDE_PROMPT_LIMIT = 14_336;

/**
 * The longest link Flint hands to Windows, in characters once encoded. Windows refused 32,700 and
 * more (its 32,767-character command line less Claude's path) and accepted 32,000; 30,000 is the
 * largest seen to arrive whole (D-151).
 */
export const CLAUDE_LINK_LIMIT = 30_000;

/** Where to download Claude when its link can't be opened. */
export const CLAUDE_DOWNLOAD_URL = 'https://claude.com/download';

/** `q` when the prompt went to the clipboard instead (too long for a link, D-151). */
export const CLAUDE_PASTE_NOTE = 'Paste the task from Flint here (Ctrl+V), in place of this line.';

/** A task as the prompt needs it: its words only, fields already left out. */
export interface PromptTask {
  /** The title as shown, or an untitled task's label (D-45). */
  readonly title: string;
  /** The notes, markdown, not indented. */
  readonly body: string;
  readonly subtasks: readonly PromptSubtask[];
  /** A subtask given on its own: its parent's title, for a last `Part of:` line. */
  readonly partOf?: string;
}

export interface PromptSubtask {
  readonly title: string;
  readonly done: boolean;
  readonly body: string;
}

/**
 * The prompt (D-151, Q4): the title as a heading, the notes as they are, then the subtasks with
 * their state and their notes indented under them. Links to the Flint folder's attachments (and
 * to linked files, `file:///`) become absolute paths, so Claude can open them. No preamble.
 */
export function buildPrompt(task: PromptTask, flintFolder: string): string {
  const parts = [`# ${oneLine(task.title)}`];
  const body = absoluteLinks(task.body.trim(), flintFolder);
  if (body !== '') parts.push(body);
  if (task.subtasks.length > 0) {
    const lines = ['## Subtasks'];
    for (const subtask of task.subtasks) {
      lines.push(`- [${subtask.done ? 'x' : ' '}] ${oneLine(subtask.title)}`);
      const notes = absoluteLinks(subtask.body.trim(), flintFolder);
      if (notes !== '')
        for (const line of notes.split('\n')) lines.push(line === '' ? '' : `    ${line}`);
    }
    parts.push(lines.join('\n'));
  }
  if (task.partOf !== undefined) parts.push(`Part of: ${oneLine(task.partOf)}`);
  return `${parts.join('\n\n')}\n`;
}

function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/**
 * A markdown link's target in the Flint folder (`attachments/…`) or a linked file (`file:///…`):
 * in angle brackets (`<attachments/a (1).png>`, which may hold spaces and parentheses) or bare,
 * then an optional title (`"…"`), kept as it is.
 */
const LINK_TARGET =
  /\]\((?:<((?:attachments\/|file:\/\/\/)[^>\n]*)>|((?:attachments\/|file:\/\/\/)[^)\s]*))((?:[ \t]+"[^"\n]*")?)\)/g;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Makes attachment and linked-file links absolute Windows paths, outside fenced code. */
function absoluteLinks(markdown: string, flintFolder: string): string {
  let fence: string | null = null;
  return markdown
    .split('\n')
    .map((line) => {
      const opener = FENCE.exec(line)?.[1];
      if (opener) {
        if (fence === null) fence = opener;
        else if (opener[0] === fence[0] && opener.length >= fence.length) fence = null;
        return line;
      }
      if (fence !== null) return line;
      return line.replace(
        LINK_TARGET,
        (_, angled: string | undefined, bare: string | undefined, title: string) =>
          `](<${absolutePath(angled ?? bare ?? '', flintFolder)}>${title})`,
      );
    })
    .join('\n');
}

/** A folder's own name, for the card and the toasts (`C:\Code\acme-web` → `acme-web`; `C:\` stays). */
export function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  if (/^[A-Za-z]:$/.test(trimmed) || trimmed === '') return path;
  return trimmed.split(/[\\/]/).pop() ?? path;
}

function absolutePath(target: string, flintFolder: string): string {
  let path = target.startsWith('file:///') ? target.slice('file:///'.length) : target;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Not percent-encoded as a URL would be: keep it as written.
  }
  if (!target.startsWith('file:///')) path = `${flintFolder.replace(/[\\/]+$/, '')}/${path}`;
  return path.replace(/\//g, '\\');
}

/**
 * A rough count of tokens (D-151): about 4 characters a token for Latin script, digits and code,
 * about 1 for other scripts (Georgian, Cyrillic, CJK…), rounded to two significant figures. Shown
 * as "about N tokens"; nothing is sent anywhere to count them.
 */
export function estimateTokens(text: string): number {
  let latin = 0;
  let other = 0;
  for (const char of text) {
    if ((char.codePointAt(0) ?? 0) < 0x250) latin++;
    else other++;
  }
  return roughly(Math.ceil(latin / 4 + other));
}

function roughly(count: number): number {
  if (count < 100) return count;
  const step = 10 ** (Math.floor(Math.log10(count)) - 1);
  return Math.round(count / step) * step;
}

/** How a prompt goes to Claude: in the link, or on the clipboard with a note in the link. */
export interface Handoff {
  readonly via: 'link' | 'clipboard';
  /** The prompt's length, as Claude counts it for its limit. */
  readonly characters: number;
  readonly tokens: number;
  /** The link Flint hands to Windows. */
  readonly url: string;
}

/** The `claude://code/new` link for a prompt and a folder, both URL-encoded. */
export function claudeLink(prompt: string, folder: string): string {
  return `claude://code/new?q=${encodeURIComponent(prompt)}&folder=${encodeURIComponent(folder)}`;
}

/**
 * The link for a prompt, or, when the prompt is over Claude's limit or its link over Windows'
 * (D-151, Q2), the clipboard: then the link carries only a note to paste it.
 */
export function planHandoff(prompt: string, folder: string): Handoff {
  const characters = prompt.length;
  const tokens = estimateTokens(prompt);
  const url = claudeLink(prompt, folder);
  if (characters <= CLAUDE_PROMPT_LIMIT && url.length <= CLAUDE_LINK_LIMIT)
    return { via: 'link', characters, tokens, url };
  return { via: 'clipboard', characters, tokens, url: claudeLink(CLAUDE_PASTE_NOTE, folder) };
}
