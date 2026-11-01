import { describe, expect, it } from 'vitest';
import { bodyHasText, bodyHtml, bodyImages, mediaUrl, removeBodyPart } from './body-markdown.js';

describe('task bodies rendered (TASK-05, D-49)', () => {
  it('renders markdown blocks, never raw HTML', () => {
    expect(bodyHtml('# Notes\n\n- one\n- two\n\n> quoted')).toBe(
      '<h1>Notes</h1>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<blockquote>\n<p>quoted</p>\n</blockquote>\n',
    );
    expect(bodyHtml('<img src=x onerror=alert(1)>')).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>\n',
    );
  });

  it('keeps single line breaks (D-76)', () => {
    expect(bodyHtml('first line\nsecond line')).toBe('<p>first line<br />\nsecond line</p>\n');
  });

  it('marks code blocks with their language for the highlighter', () => {
    expect(bodyHtml('```json\n{"a": 1}\n```')).toBe(
      '<pre class="body-code" data-lang="json" data-part="0"><code>{&quot;a&quot;: 1}</code></pre>\n',
    );
    expect(bodyHtml('    indented <b>')).toBe(
      '<pre class="body-code" data-lang="" data-part="0"><code>indented &lt;b&gt;</code></pre>\n',
    );
  });

  it('loads images from the Flint folder only', () => {
    expect(bodyHtml('![shot](attachments/shot%201.png)')).toBe(
      '<p><img src="app://media/attachments/shot%201.png" alt="shot" data-part="0"></p>\n',
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

describe('body indicators and the lightbox (D-79)', () => {
  it('lists the images from the Flint folder, in order', () => {
    const body =
      'See:\n![a](attachments/a.png) and ![b](attachments/b.jpg)\n\n![web](https://x/y.png)';
    expect(bodyImages(body)).toEqual([
      'app://media/attachments/a.png',
      'app://media/attachments/b.jpg',
    ]);
    expect(bodyImages('```\n![not](attachments/c.png)\n```')).toEqual([]);
  });

  it('tells text from image-only bodies', () => {
    expect(bodyHasText('![](attachments/a.png)\n\n![](attachments/b.png)')).toBe(false);
    expect(bodyHasText('![](attachments/a.png)\nthe crash')).toBe(true);
    expect(bodyHasText('plain')).toBe(true);
  });
});

describe('removing a part of a body (D-80)', () => {
  const body = [
    'Context',
    '',
    '```json',
    '{ "a": 1 }',
    '```',
    '',
    '![](attachments/a.png)',
    '',
    'See ![shot](attachments/b.png) here',
    '',
    '```',
    '![](attachments/a.png)',
    '```',
    '',
    '![](attachments/a.png)',
  ].join('\n');

  it('numbers code blocks and images in the HTML', () => {
    const html = bodyHtml(body);
    expect(html.match(/data-part="\d+"/g)).toEqual([
      'data-part="0"',
      'data-part="0"',
      'data-part="1"',
      'data-part="1"',
      'data-part="2"',
    ]);
  });

  it('removes a code block with its fences, leaving one blank line', () => {
    expect(removeBodyPart(body, 'code', 0)).toBe(
      ['Context', '', '![](attachments/a.png)', '', 'See ![shot](attachments/b.png) here']
        .concat(['', '```', '![](attachments/a.png)', '```', '', '![](attachments/a.png)'])
        .join('\n'),
    );
  });

  it('removes only the link of the n-th image, never a look-alike inside code', () => {
    // Image 2 is the second a.png outside code: the last line.
    expect(removeBodyPart(body, 'image', 2)).toBe(body.split('\n').slice(0, -2).join('\n'));
    // An image within text keeps the text.
    expect(removeBodyPart(body, 'image', 1)).toContain('See  here');
    expect(removeBodyPart(body, 'image', 0).split('\n').slice(0, 7)).toEqual([
      'Context',
      '',
      '```json',
      '{ "a": 1 }',
      '```',
      '',
      'See ![shot](attachments/b.png) here',
    ]);
  });

  it('leaves the body alone for a part that is not there', () => {
    expect(removeBodyPart(body, 'code', 5)).toBe(body);
    expect(removeBodyPart(body, 'image', 9)).toBe(body);
    expect(removeBodyPart('```\nonly code\n```', 'code', 0)).toBe('');
  });
});
