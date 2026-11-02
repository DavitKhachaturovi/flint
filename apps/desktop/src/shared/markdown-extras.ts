import type { MarkdownIt, StateInline, Token } from 'markdown-it';
import { activeLinkPatterns, findShortForms, shortFormOf } from './link-patterns.js';

/**
 * Flint's additions to markdown in task titles and bodies (M5, D-84), the same as in the note
 * editor: `==highlight==` (LIST-02, NOTE-02) and the user's link patterns (NOTE-07, TASK-10): a
 * typed short form (`AB#1234`) becomes a link, and a link whose text is its own URL shows as the
 * short form. Everything else stays markdown-it's (escaped, no raw HTML).
 */
export function flintMarkdown(md: MarkdownIt): void {
  md.inline.ruler.before('emphasis', 'flint_mark', highlightRule);
  md.core.ruler.after('linkify', 'flint_link_patterns', (state) => {
    const patterns = activeLinkPatterns();
    if (patterns.length === 0) return;
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue;
      const out: Token[] = [];
      let inLink = 0;
      const children = block.children;
      for (let at = 0; at < children.length; at++) {
        const token = children[at];
        if (!token) continue;
        if (token.type === 'link_open') {
          inLink++;
          // A link whose text is its URL (a pasted URL) shows the short form (TASK-10).
          const href = String(token.attrGet('href') ?? '');
          const text = children[at + 1];
          const short = shortFormOf(href, patterns);
          if (short && text?.type === 'text' && text.content === href) text.content = short;
        }
        if (token.type === 'link_close') inLink--;
        if (token.type !== 'text' || inLink > 0) {
          out.push(token);
          continue;
        }
        const found = findShortForms(token.content, patterns);
        if (found.length === 0) {
          out.push(token);
          continue;
        }
        let last = 0;
        const text = (content: string): void => {
          if (content === '') return;
          const piece = new state.Token('text', '', 0);
          piece.content = content;
          out.push(piece);
        };
        for (const link of found) {
          text(token.content.slice(last, link.from));
          const open = new state.Token('link_open', 'a', 1);
          open.attrs = [
            ['href', link.href],
            ['class', 'auto-link'],
          ];
          out.push(open);
          text(link.text);
          out.push(new state.Token('link_close', 'a', -1));
          last = link.to;
        }
        text(token.content.slice(last));
      }
      block.children = out;
    }
  });
}

/** `==text==` → `<mark>`: content inside, not across a line or another `==`. */
function highlightRule(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  const src = state.src;
  if (src.charCodeAt(start) !== 61 || src.charCodeAt(start + 1) !== 61) return false;
  const after = src.charAt(start + 2);
  if (after === '' || after === '=' || /\s/.test(after)) return false;
  const end = src.indexOf('==', start + 2);
  if (end < 0 || /\s/.test(src.charAt(end - 1)) || src.slice(start + 2, end).includes('\n'))
    return false;
  if (!silent) {
    state.push('mark_open', 'mark', 1);
    const max = state.posMax;
    state.pos = start + 2;
    state.posMax = end;
    state.md.inline.tokenize(state);
    state.posMax = max;
    state.push('mark_close', 'mark', -1);
  }
  state.pos = end + 2;
  return true;
}
