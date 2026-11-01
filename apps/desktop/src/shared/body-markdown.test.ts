import { describe, expect, it } from 'vitest';
import { bodyHtml, mediaUrl } from './body-markdown.js';

describe('task bodies rendered (TASK-05, D-49)', () => {
  it('renders markdown blocks, never raw HTML', () => {
    expect(bodyHtml('# Notes\n\n- one\n- two\n\n> quoted')).toBe(
      '<h1>Notes</h1>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<blockquote>\n<p>quoted</p>\n</blockquote>\n',
    );
    expect(bodyHtml('<img src=x onerror=alert(1)>')).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>\n',
    );
  });

  it('marks code blocks with their language for the highlighter', () => {
    expect(bodyHtml('```json\n{"a": 1}\n```')).toBe(
      '<pre class="body-code" data-lang="json"><code>{&quot;a&quot;: 1}</code></pre>\n',
    );
    expect(bodyHtml('    indented <b>')).toBe(
      '<pre class="body-code" data-lang=""><code>indented &lt;b&gt;</code></pre>\n',
    );
  });

  it('loads images from the Flint folder only', () => {
    expect(bodyHtml('![shot](attachments/shot%201.png)')).toBe(
      '<p><img src="app://media/attachments/shot%201.png" alt="shot"></p>\n',
    );
    expect(bodyHtml('![remote](https://example.com/x.png)')).toBe(
      '<p><span class="body-image-missing">remote</span></p>\n',
    );
    expect(mediaUrl('C:/Windows/x.png')).toBeNull();
    expect(mediaUrl('/etc/x.png')).toBeNull();
    expect(mediaUrl('data:image/png;base64,AAAA')).toBeNull();
  });

  it('refuses script links', () => {
    expect(bodyHtml('[x](javascript:alert(1))')).toBe('<p>[x](javascript:alert(1))</p>\n');
  });
});
