import MarkdownIt from 'markdown-it';

/**
 * A task's body, rendered (TASK-05, D-49): markdown with headings, lists, quotes, tables, code
 * blocks, links and images, but never raw HTML (it shows as text). Code blocks come out as
 * `pre.body-code` with their language in `data-lang`, for the grayscale highlighter (UI-06).
 * Images in the Flint folder (`attachments/…`, MEDIA-02) load from `app://media/…`; any other image
 * source shows as its text, since Flint makes no network requests (APP-09).
 */
export const MEDIA_ORIGIN = 'app://media';

// D-76: a single line break stays a line break, as in Obsidian.
const md = new MarkdownIt('commonmark', { html: false, linkify: true, breaks: true }).enable([
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

/** D-80: code blocks and images are numbered in order (`data-part`), so one can be removed. */
interface Parts {
  code: number;
  image: number;
}
const parts = (env: unknown): Parts => {
  const holder = env as { parts?: Parts };
  holder.parts ??= { code: 0, image: 0 };
  return holder.parts;
};

const code = (lang: string, content: string, part: number): string =>
  `<pre class="body-code" data-lang="${escape(lang)}" data-part="${part}"><code>${escape(content.replace(/\n$/, ''))}</code></pre>\n`;

md.renderer.rules.fence = (tokens, index, _options, env) => {
  const token = tokens[index];
  return token
    ? code(token.info.trim().split(/\s+/)[0] ?? '', token.content, parts(env).code++)
    : '';
};
md.renderer.rules.code_block = (tokens, index, _options, env) =>
  code('', tokens[index]?.content ?? '', parts(env).code++);
md.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (!token) return '';
  const part = parts(env).image++;
  const alt = self.renderInlineAsText(token.children ?? [], options, env);
  const raw = String(token.attrGet('src') ?? '');
  const src = mediaUrl(raw);
  return src
    ? `<img src="${escape(src)}" alt="${escape(alt)}" data-part="${part}">`
    : `<span class="body-image-missing">${escape(alt || raw)}</span>`;
};

/** D-79: the body's images from the Flint folder, as `app://media/…` addresses, in order. */
export function bodyImages(body: string): string[] {
  const images: string[] = [];
  for (const token of md.parse(body, {})) {
    for (const child of token.children ?? []) {
      const src = child.type === 'image' ? mediaUrl(String(child.attrGet('src') ?? '')) : null;
      if (src) images.push(src);
    }
  }
  return images;
}

/** D-79: whether the body has anything besides image links (the row shows the body icon). */
export function bodyHasText(body: string): boolean {
  return body.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim() !== '';
}

/** The body as HTML (safe to set as innerHTML: markdown-it escapes everything else). */
export function bodyHtml(body: string): string {
  return md.render(body, {});
}

/** An image in the source, `![alt](src "title")`, with its target in group 1. */
const IMAGE = /!\[[^\]]*\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g;

/**
 * D-80: the body without one of its code blocks or images (numbered as `data-part` in the HTML).
 * A code block goes with its fence lines; an image only loses its link (the file stays, MEDIA-04),
 * and its line too when nothing else is on it. One blank line is left where two would meet.
 */
export function removeBodyPart(body: string, kind: 'code' | 'image', index: number): string {
  const tokens = md.parse(body, {});
  const lines = body.split('\n');
  const code = tokens.flatMap((token) =>
    (token.type === 'fence' || token.type === 'code_block') && token.map ? [token.map] : [],
  );
  const tidy = (at: number): string => {
    if (lines[at - 1]?.trim() === '' && (lines[at] ?? '').trim() === '') lines.splice(at - 1, 1);
    while (lines[0]?.trim() === '') lines.shift();
    while (lines.at(-1)?.trim() === '') lines.pop();
    return lines.join('\n');
  };
  if (kind === 'code') {
    const range = code[index];
    if (!range) return body;
    lines.splice(range[0], range[1] - range[0]);
    return tidy(range[0]);
  }
  const sources = tokens.flatMap((token) =>
    (token.children ?? []).flatMap((child) =>
      child.type === 'image' ? [String(child.attrGet('src') ?? '')] : [],
    ),
  );
  const src = sources[index];
  if (src === undefined) return body;
  // The same picture can be in a body twice: the right one is the n-th with this target.
  let skip = sources.slice(0, index).filter((other) => other === src).length;
  for (let at = 0; at < lines.length; at++) {
    if (code.some(([start, end]) => at >= start && at < end)) continue;
    const line = lines[at] ?? '';
    for (const match of line.matchAll(IMAGE)) {
      const target = match[1] ?? '';
      if (target !== src && md.normalizeLink(target) !== src) continue;
      if (skip-- > 0) continue;
      const rest = line.slice(0, match.index) + line.slice(match.index + match[0].length);
      if (rest.trim() === '') {
        lines.splice(at, 1);
        return tidy(at);
      }
      lines[at] = rest.replace(/[ \t]+$/, '');
      return lines.join('\n');
    }
  }
  return body;
}
