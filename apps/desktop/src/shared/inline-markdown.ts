import MarkdownIt from 'markdown-it';

/**
 * Inline markdown in task titles (LIST-02, D-52): bold, italic, strikethrough, inline code, links
 * and bare URLs. Raw HTML is never rendered (it shows as text), and links pass markdown-it's
 * check, which refuses `javascript:`, `vbscript:`, `file:` and `data:` URLs. Titles are stored with
 * Flint's escapes (`\[` before a field opener, docs/04 §3); markdown reads them back as `[`.
 */
const md = new MarkdownIt('zero', { html: false, linkify: true })
  .enable(['text', 'escape', 'backticks', 'emphasis', 'strikethrough', 'link', 'autolink'])
  .enable(['entity', 'linkify', 'text_join']);

/** The title as HTML for a row (safe to set as innerHTML: markdown-it escapes everything else). */
export function titleHtml(title: string): string {
  return md.renderInline(title);
}

/** The title as plain text, for places that can't show markdown (notifications). */
export function titlePlain(title: string): string {
  let text = '';
  for (const token of md.parseInline(title, {})[0]?.children ?? []) {
    if (token.type === 'text' || token.type === 'code_inline') text += token.content;
    else if (token.type === 'softbreak' || token.type === 'hardbreak') text += ' ';
  }
  return text;
}

/** Links Flint opens in the browser; anything else stays unopened. */
export function isOpenableLink(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}
