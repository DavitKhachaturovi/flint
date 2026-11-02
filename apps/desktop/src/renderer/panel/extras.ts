import { markdownLanguage } from '@codemirror/lang-markdown';
import { findShortForms, shortFormOf, type CompiledPattern } from '../../shared/link-patterns.js';

/**
 * The context panel's extra sections (NAV-07, D-85) for a task or a note: **References**, the link
 * chips in it (link-pattern short forms like `AB#1234`, links and bare URLs; a URL a pattern knows
 * shows as its short form), and **Attachments**, the files it shows or links to (`attachments/…`
 * and large files linked where they are, `file:///…`). Code is never searched. Pure: unit-tested.
 */

export interface Reference {
  readonly text: string;
  readonly href: string;
}

export interface Attachment {
  /** The markdown target, unchanged (`attachments/…` or `file:///…`). */
  readonly link: string;
  readonly name: string;
  readonly kind: 'image' | 'video' | 'file';
  /** MEDIA-03: a large file linked where it is, not copied. */
  readonly linked: boolean;
}

const VIDEO = /\.(mp4|m4v|webm|mov)$/i;
const CODE = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'CommentBlock']);

const isFile = (url: string): boolean => /^(attachments\/|file:\/\/)/i.test(url);

function fileName(link: string): string {
  const last = link.split(/[?#]/)[0]?.split(/[\\/]/).pop() ?? link;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** A bare URL as the panel shows it: without the scheme and a trailing slash. */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

export function panelExtras(
  text: string,
  patterns: readonly CompiledPattern[],
): { readonly references: Reference[]; readonly attachments: Attachment[] } {
  const tree = markdownLanguage.parser.parse(text);
  const found: (Reference & { readonly from: number })[] = [];
  const files: Attachment[] = [];
  // Where short forms can't be: code, and links already counted.
  const taken: [number, number][] = [];
  tree.iterate({
    enter: (node) => {
      if (CODE.has(node.name)) {
        taken.push([node.from, node.to]);
        return false;
      }
      if (node.name === 'Image' || node.name === 'Link') {
        taken.push([node.from, node.to]);
        const url = node.node.getChild('URL');
        const href = url ? text.slice(url.from, url.to).trim() : '';
        if (href === '') return false;
        if (node.name === 'Image' || isFile(href)) {
          files.push({
            link: href,
            name: fileName(href),
            kind: node.name === 'Image' ? (VIDEO.test(href) ? 'video' : 'image') : 'file',
            linked: /^file:\/\//i.test(href),
          });
        } else if (/^https?:\/\//i.test(href)) {
          const label = text
            .slice(node.from, node.to)
            .replace(/^\[([^\]]*)\][\s\S]*$/, '$1')
            .trim();
          found.push({
            text: shortFormOf(href, patterns) ?? (label || shortUrl(href)),
            href,
            from: node.from,
          });
        }
        return false;
      }
      if (node.name === 'URL') {
        // A bare URL (GFM autolink) or `<…>`.
        taken.push([node.from, node.to]);
        const href = text.slice(node.from, node.to).trim();
        if (/^https?:\/\//i.test(href))
          found.push({
            text: shortFormOf(href, patterns) ?? shortUrl(href),
            href,
            from: node.from,
          });
        return false;
      }
      return undefined;
    },
  });
  for (const link of findShortForms(text, patterns))
    if (!taken.some(([from, to]) => link.from < to && link.to > from))
      found.push({ text: link.text, href: link.href, from: link.from });
  const seen = new Set<string>();
  const references = found
    .sort((a, b) => a.from - b.from)
    .filter((each) => !seen.has(each.href) && seen.add(each.href))
    .map(({ text: label, href }) => ({ text: label, href }));
  const kept = new Set<string>();
  const attachments = files.filter((each) => !kept.has(each.link) && kept.add(each.link));
  return { references, attachments };
}
