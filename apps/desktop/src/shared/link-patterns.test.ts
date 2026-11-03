import { describe, expect, it } from 'vitest';
import {
  compileLinkPatterns,
  findShortForms,
  inferLinkPattern,
  linkTitle,
  patternFromPreset,
  readLinkPatterns,
  shortFormOf,
} from './link-patterns.js';

const ado = {
  short: 'AB#{id}',
  url: 'https://dev.azure.com/acme/web/_workitems/edit/{id}',
};

describe('link patterns (NOTE-07, TASK-10, D-84)', () => {
  it('turns a typed short form into its link, between non-word characters', () => {
    const compiled = compileLinkPatterns([ado]);
    expect(findShortForms('see AB#1234, and AB#7', compiled)).toEqual([
      {
        from: 4,
        to: 11,
        text: 'AB#1234',
        href: 'https://dev.azure.com/acme/web/_workitems/edit/1234',
      },
      { from: 17, to: 21, text: 'AB#7', href: 'https://dev.azure.com/acme/web/_workitems/edit/7' },
    ]);
    expect(findShortForms('XAB#1 and AB#12x', compiled)).toEqual([]);
  });

  it('shows a pasted full URL as its short form', () => {
    const compiled = compileLinkPatterns([ado]);
    expect(shortFormOf('https://dev.azure.com/acme/web/_workitems/edit/1234', compiled)).toBe(
      'AB#1234',
    );
    expect(shortFormOf('https://dev.azure.com/acme/web/_workitems/edit/1234/', compiled)).toBe(
      'AB#1234',
    );
    expect(
      shortFormOf('https://dev.azure.com/other/web/_workitems/edit/1234', compiled),
    ).toBeNull();
  });

  it('reads the settings tolerantly; only http(s) links, placeholders in both', () => {
    expect(
      readLinkPatterns([
        ado,
        { short: 'X{id}', url: 'javascript:alert({id})' },
        { short: 'Y{id}', url: 'https://y/{n}' },
        'nonsense',
      ]),
    ).toEqual([ado]);
  });

  it('infers a pattern from an example link and its short form', () => {
    const result = inferLinkPattern([
      { url: 'https://dev.azure.com/org/project/_workitems/edit/1234', short: 'AB#1234' },
    ]);
    expect(result).toEqual({
      pattern: {
        short: 'AB#{id}',
        url: 'https://dev.azure.com/org/project/_workitems/edit/{id}',
        kinds: { id: 'digits' },
      },
      ambiguous: false,
    });
  });

  it('asks for a second example when more than the number is shared, and settles with it', () => {
    const one = inferLinkPattern([
      { url: 'https://github.com/acme/web/issues/42', short: 'web#42' },
    ]);
    expect(one.ambiguous).toBe(true);
    const two = inferLinkPattern([
      { url: 'https://github.com/acme/web/issues/42', short: 'web#42' },
      { url: 'https://github.com/acme/web/issues/7', short: 'web#7' },
    ]);
    expect(two).toMatchObject({
      pattern: { short: 'web#{id}', url: 'https://github.com/acme/web/issues/{id}' },
      ambiguous: false,
    });
  });

  it('says what is wrong with an example', () => {
    expect(inferLinkPattern([{ url: 'ftp://x/1', short: 'X1' }]).problem).toMatch(/https/);
    expect(inferLinkPattern([{ url: 'https://x.y/1', short: 'Nothing' }]).problem).toMatch(/part/);
  });

  it('recognises presets in an example link, fixing the user’s parts', () => {
    expect(patternFromPreset('https://dev.azure.com/acme/web/_workitems/edit/1234')).toMatchObject({
      preset: { label: 'Azure DevOps work item' },
      pattern: { short: 'AB#{id}', url: 'https://dev.azure.com/acme/web/_workitems/edit/{id}' },
    });
    const jira = patternFromPreset('https://acme.atlassian.net/browse/OPS-12');
    expect(jira?.pattern).toMatchObject({
      short: '{key}-{n}',
      url: 'https://acme.atlassian.net/browse/{key}-{n}',
    });
    const compiled = compileLinkPatterns(jira ? [jira.pattern] : []);
    expect(shortFormOf('https://acme.atlassian.net/browse/OPS-12', compiled)).toBe('OPS-12');
    expect(patternFromPreset('https://example.com/a/1')).toBeNull();
  });
});

describe('link patterns and ==highlight== in titles and bodies (D-84)', () => {
  it('links short forms and shortens pasted URLs, highlights ==text==', async () => {
    const { setLinkPatterns } = await import('./link-patterns.js');
    const { titleHtml } = await import('./inline-markdown.js');
    const { bodyHtml } = await import('./body-markdown.js');
    setLinkPatterns([ado]);
    expect(titleHtml('fix AB#1234 now')).toBe(
      'fix <a href="https://dev.azure.com/acme/web/_workitems/edit/1234" class="auto-link">AB#1234</a> now',
    );
    expect(titleHtml('see https://dev.azure.com/acme/web/_workitems/edit/9')).toBe(
      'see <a href="https://dev.azure.com/acme/web/_workitems/edit/9" title="https://dev.azure.com/acme/web/_workitems/edit/9">AB#9</a>',
    );
    expect(titleHtml('a ==marked== word')).toBe('a <mark>marked</mark> word');
    expect(titleHtml('`AB#1` stays code')).toBe('<code>AB#1</code> stays code');
    expect(bodyHtml('a ==b== AB#2')).toContain(
      '<mark>b</mark> <a href="https://dev.azure.com/acme/web/_workitems/edit/2" class="auto-link">AB#2</a>',
    );
    setLinkPatterns([]);
    expect(titleHtml('fix AB#1234')).toBe('fix AB#1234');
  });
});

describe('smart link titles (TASK-10, D-88)', () => {
  const user = compileLinkPatterns([
    { short: 'TK-{id}', url: 'https://tracker.example.com/tickets/{id}' },
  ]);
  it('uses the user’s pattern, then the built-in recognizers', () => {
    expect(linkTitle('https://tracker.example.com/tickets/77', user)).toBe('TK-77');
    expect(linkTitle('https://dev.azure.com/acme/web/_git/api/pullrequest/42', user)).toBe('PR 42');
    expect(linkTitle('https://dev.azure.com/acme/web/_workitems/edit/1234', user)).toBe('AB#1234');
    expect(linkTitle('https://github.com/octo/flint/issues/12', user)).toBe('flint#12');
    expect(linkTitle('https://github.com/octo/flint/pull/9', user)).toBe('flint!9');
    expect(linkTitle('https://acme.atlassian.net/browse/OPS-5', user)).toBe('OPS-5');
  });
  it('shows other addresses as the domain and a shortened path', () => {
    expect(linkTitle('https://www.example.com/', user)).toBe('example.com');
    expect(linkTitle('https://example.com/docs/setup?x=1#top', user)).toBe(
      'example.com/docs/setup',
    );
    expect(
      linkTitle(
        'https://learn.example.com/en-us/windows/apps/develop/clipboard-history-guide',
        user,
      ),
    ).toBe('learn.example.com/en-us/…/clipboard-his…');
    expect(linkTitle('not a url', user)).toBe('not a url');
  });
});
