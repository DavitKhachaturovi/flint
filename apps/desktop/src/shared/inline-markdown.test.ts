import { describe, expect, it } from 'vitest';
import { isOpenableLink, titleHtml, titlePlain } from './inline-markdown.js';

describe('inline markdown in titles (LIST-02, D-52)', () => {
  it('renders bold, italic, strikethrough, code and links', () => {
    expect(titleHtml('**Recover from crashes silently.**')).toBe(
      '<strong>Recover from crashes silently.</strong>',
    );
    expect(titleHtml('fix _this_ and ~~that~~ in `resolve()`')).toBe(
      'fix <em>this</em> and <s>that</s> in <code>resolve()</code>',
    );
    expect(titleHtml('see [the PR](https://dev.azure.com/x/pr/42)')).toBe(
      'see <a href="https://dev.azure.com/x/pr/42">the PR</a>',
    );
    expect(titleHtml('docs at https://example.com/a')).toBe(
      'docs at <a href="https://example.com/a">https://example.com/a</a>',
    );
  });

  it('never renders HTML, dangerous links, or block syntax', () => {
    expect(titleHtml('<img src=x onerror=alert(1)> <b>x</b>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt; &lt;b&gt;x&lt;/b&gt;',
    );
    expect(titleHtml('[click](javascript:alert(1))')).toBe('[click](javascript:alert(1))');
    expect(titleHtml('# not a heading')).toBe('# not a heading');
    expect(titleHtml('- not a list')).toBe('- not a list');
  });

  it("reads Flint's field-opener escapes back as plain brackets", () => {
    expect(titleHtml('use \\[Vec::new] here')).toBe('use [Vec::new] here');
  });

  it('gives plain text for notifications', () => {
    expect(titlePlain('**Call** `Alex` about [the PR](https://x.y/1) ~~today~~')).toBe(
      'Call Alex about the PR today',
    );
    expect(titlePlain('use \\[Vec::new]')).toBe('use [Vec::new]');
  });

  it('opens only web and mail links', () => {
    expect(isOpenableLink('https://dev.azure.com/x')).toBe(true);
    expect(isOpenableLink('mailto:alex@example.com')).toBe(true);
    expect(isOpenableLink('file:///C:/Windows/system32/calc.exe')).toBe(false);
    expect(isOpenableLink('flint://reminder/done?id=x')).toBe(false);
    expect(isOpenableLink('not a url')).toBe(false);
  });
});
