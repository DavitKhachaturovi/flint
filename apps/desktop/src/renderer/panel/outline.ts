import { markdownLanguage } from '@codemirror/lang-markdown';
import { classifyPaste } from '@flint/core/shorthand';
import { codeLanguage } from '../../shared/code-language.js';

/**
 * The context panel's outline (NAV-07, D-83) of a note or a task page's body: its headings
 * (indented by level) and, under each, its blocks: code, JSON, stack traces and images, each with a
 * title and a type tag. A block's title, in this order: an explicit title after the language in
 * the fence's info string (```` ```bash Check gateway health ````); the code's first comment line;
 * for JSON its top-level keys, for a stack trace the exception's name; else the type ("Python
 * block"). An image's title is its alt text, else its file name. Pure: unit-tested.
 */

export interface OutlineBlock {
  readonly kind: 'code' | 'image' | 'video';
  readonly title: string;
  /** `bash`, `json`, `stack trace`, `image`… */
  readonly tag: string;
  /** Where it starts in the text (for scrolling to it). */
  readonly from: number;
}

export interface OutlineHeading {
  readonly level: number;
  readonly text: string;
  readonly from: number;
  readonly blocks: readonly OutlineBlock[];
}

export interface Outline {
  /** Blocks before the first heading. */
  readonly blocks: readonly OutlineBlock[];
  readonly headings: readonly OutlineHeading[];
  /** Checklist items (`- [ ]`, `- [x]`). */
  readonly checklist: { readonly done: number; readonly total: number };
  /**
   * D-86: where the clickable facts' items start, in order: open checklist items, code blocks,
   * images and links (not inside code).
   */
  readonly facts: {
    readonly open: readonly number[];
    readonly code: readonly number[];
    readonly images: readonly number[];
    readonly links: readonly number[];
  };
  /** Whether there is anything to outline (no headings and no blocks: the panel shows Up next). */
  readonly empty: boolean;
}

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  py: 'Python',
  python: 'Python',
  sh: 'Shell',
  bash: 'Shell',
  shell: 'Shell',
  ps1: 'PowerShell',
  powershell: 'PowerShell',
  'c#': 'C#',
  cs: 'C#',
  csharp: 'C#',
  sql: 'SQL',
  yaml: 'YAML',
  yml: 'YAML',
  json: 'JSON',
  xml: 'XML',
  html: 'HTML',
  css: 'CSS',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
};

/** The first comment line of code, without its markers. */
function firstComment(code: string): string | null {
  for (const raw of code.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const match =
      /^(?:#(?!!)|\/\/|--|;)\s*(.+)$/.exec(line) ?? /^\/\*+\s*(.+?)\s*(?:\*+\/)?$/.exec(line);
    if (match?.[1]) return match[1].replace(/\s*\*+\/$/, '').trim() || null;
    // Only a comment that starts the block (after a shebang) names it.
    if (!line.startsWith('#!')) return null;
  }
  return null;
}

function jsonTitle(code: string): string | null {
  try {
    const value: unknown = JSON.parse(code);
    if (Array.isArray(value)) return `[ ${value.length} ${value.length === 1 ? 'item' : 'items'} ]`;
    if (typeof value === 'object' && value !== null) {
      const keys = Object.keys(value);
      if (keys.length === 0) return '{ }';
      return `{ ${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''} }`;
    }
  } catch {
    return null;
  }
  return null;
}

function exceptionName(code: string): string | null {
  const match =
    /\b([A-Z][\w$]*(?:\.[A-Z][\w$]*)*(?:Exception|Error))\b/.exec(code) ??
    /^(\w+(?:Error|Exception)):/m.exec(code);
  return match?.[1]?.split('.').pop() ?? null;
}

/** The title and tag of a fenced or indented code block. */
export function codeBlockTitle(info: string, code: string): { title: string; tag: string } {
  const [lang = '', ...rest] = info.trim().split(/\s+/);
  const explicit = rest.join(' ').trim();
  const kind = classifyPaste(code);
  const tag = codeLanguage(code, lang);
  if (explicit !== '') return { title: explicit, tag };
  const comment = firstComment(code);
  if (comment) return { title: comment, tag };
  if (lang.toLowerCase() === 'json' || kind === 'json') {
    const keys = jsonTitle(code);
    if (keys) return { title: keys, tag: 'json' };
  }
  if (kind === 'stack-trace') {
    const name = exceptionName(code);
    if (name) return { title: name, tag };
  }
  const name = LANGUAGE_NAMES[tag] ?? LANGUAGE_NAMES[lang.toLowerCase()];
  return { title: name ? `${name} block` : 'Code block', tag };
}

const VIDEO = /\.(mp4|m4v|webm|mov)$/i;

function fileName(src: string): string {
  const last = src.split(/[\\/]/).pop() ?? src;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export function outline(text: string): Outline {
  const tree = markdownLanguage.parser.parse(text);
  const headings: { level: number; text: string; from: number; blocks: OutlineBlock[] }[] = [];
  const before: OutlineBlock[] = [];
  let done = 0;
  let total = 0;
  const facts = {
    open: [] as number[],
    code: [] as number[],
    images: [] as number[],
    links: [] as number[],
  };
  const add = (block: OutlineBlock): void => {
    const current = headings.at(-1);
    if (current) current.blocks.push(block);
    else before.push(block);
  };
  tree.iterate({
    enter: (node) => {
      const heading = /^(ATX|Setext)Heading(\d)$/.exec(node.name);
      if (heading) {
        const raw = text.slice(node.from, node.to);
        const clean = raw
          .split('\n')[0]
          ?.replace(/^\s*#{1,6}\s*/, '')
          .replace(/\s*#+\s*$/, '')
          .replace(/[*_`~=]/g, '')
          .trim();
        headings.push({
          level: Number(heading[2]),
          text: clean ?? '',
          from: node.from,
          blocks: [],
        });
        return false;
      }
      if (node.name === 'FencedCode') {
        const info = node.node.getChild('CodeInfo');
        const body = node.node.getChild('CodeText');
        const { title, tag } = codeBlockTitle(
          info ? text.slice(info.from, info.to) : '',
          body ? text.slice(body.from, body.to) : '',
        );
        add({ kind: 'code', title, tag, from: node.from });
        facts.code.push(node.from);
        return false;
      }
      if (node.name === 'CodeBlock') {
        const code = text
          .slice(node.from, node.to)
          .split('\n')
          .map((line) => line.replace(/^ {4}|^\t/, ''))
          .join('\n');
        const { title, tag } = codeBlockTitle('', code);
        add({ kind: 'code', title, tag, from: node.from });
        facts.code.push(node.from);
        return false;
      }
      if (node.name === 'Image') {
        const raw = text.slice(node.from, node.to);
        const alt = /^!\[([^\]]*)\]/.exec(raw)?.[1]?.trim() ?? '';
        const url = node.node.getChild('URL');
        const src = url ? text.slice(url.from, url.to) : '';
        const video = VIDEO.test(src);
        add({
          kind: video ? 'video' : 'image',
          title: alt || fileName(src),
          tag: video ? 'video' : 'image',
          from: node.from,
        });
        if (!video) facts.images.push(node.from);
        return false;
      }
      if (node.name === 'Link') {
        const url = node.node.getChild('URL');
        if (url && /^https?:\/\//i.test(text.slice(url.from, url.to))) facts.links.push(node.from);
        return false;
      }
      if (node.name === 'URL') {
        if (/^https?:\/\//i.test(text.slice(node.from, node.to))) facts.links.push(node.from);
        return false;
      }
      if (node.name === 'InlineCode') return false;
      if (node.name === 'TaskMarker') {
        total++;
        if (/x/i.test(text.slice(node.from, node.to))) done++;
        else facts.open.push(node.from);
      }
      return undefined;
    },
  });
  return {
    blocks: before,
    headings,
    checklist: { done, total },
    facts,
    empty:
      headings.length === 0 && before.length === 0 && !headings.some((h) => h.blocks.length > 0),
  };
}
