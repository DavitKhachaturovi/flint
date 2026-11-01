import MarkdownIt from 'markdown-it';

/**
 * A task's body, rendered (TASK-05, D-49): markdown with headings, lists, quotes, tables, code
 * blocks, links and images, but never raw HTML (it shows as text). Code blocks come out as
 * `pre.body-code` with their language in `data-lang`, for the grayscale highlighter (UI-06).
 * Images in the Flint folder (`attachments/…`, MEDIA-02) load from `app://media/…`; any other image
 * source shows as its text, since Flint makes no network requests (APP-09).
 */
export const MEDIA_ORIGIN = 'app://media';

const md = new MarkdownIt('commonmark', { html: false, linkify: true }).enable([
  'linkify',
  'strikethrough',
  'table',
]);

const escape = (text: string): string => md.utils.escapeHtml(text);

/** The `app://media/…` address of a relative image path, or null for anything else. */
export function mediaUrl(src: string): string | null {
  if (src === '' || /^[a-z][a-z0-9+.-]*:/i.test(src) || /^[\\/]/.test(src)) return null;
  return `${MEDIA_ORIGIN}/${src}`;
}

const code = (lang: string, content: string): string =>
  `<pre class="body-code" data-lang="${escape(lang)}"><code>${escape(content.replace(/\n$/, ''))}</code></pre>\n`;

md.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  return token ? code(token.info.trim().split(/\s+/)[0] ?? '', token.content) : '';
};
md.renderer.rules.code_block = (tokens, index) => code('', tokens[index]?.content ?? '');
md.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (!token) return '';
  const alt = self.renderInlineAsText(token.children ?? [], options, env);
  const raw = String(token.attrGet('src') ?? '');
  const src = mediaUrl(raw);
  return src
    ? `<img src="${escape(src)}" alt="${escape(alt)}">`
    : `<span class="body-image-missing">${escape(alt || raw)}</span>`;
};

/** The body as HTML (safe to set as innerHTML: markdown-it escapes everything else). */
export function bodyHtml(body: string): string {
  return md.render(body);
}
