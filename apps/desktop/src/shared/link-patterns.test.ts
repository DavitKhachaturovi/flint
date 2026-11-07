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

  it('D-105: a short form with a hyphen links in titles and bodies too (as in the note editor)', async () => {
    const { setLinkPatterns } = await import('./link-patterns.js');
    const { titleHtml } = await import('./inline-markdown.js');
    const { bodyHtml } = await import('./body-markdown.js');
    setLinkPatterns([{ short: 'DEV-{id}', url: 'https://tracker.example/t/DEV-{id}' }]);
    expect(titleHtml('check DEV-123 today')).toBe(
      'check <a href="https://tracker.example/t/DEV-123" class="auto-link">DEV-123</a> today',
    );
    expect(bodyHtml('see DEV-7.')).toContain(
      '<a href="https://tracker.example/t/DEV-7" class="auto-link">DEV-7</a>.',
    );
    setLinkPatterns([]);
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

describe('D-105: inference, the fixed part, built-ins', () => {
  it('a varying word between fixed text: repositories with a "-repo" suffix', async () => {
    const { compileLinkPatterns, inferLinkPattern, shortFormOf, findShortForms } =
      await import('./link-patterns.js');
    const examples = [
      {
        url: 'https://dev.azure.com/acme/web/_git/unicorn-api',
        short: 'unicorn-api-repo',
      },
      { url: 'https://dev.azure.com/acme/web/_git/platform', short: 'platform-repo' },
    ];
    // One example can't say which parts change.
    expect(inferLinkPattern(examples.slice(0, 1)).ambiguous).toBe(true);
    const inference = inferLinkPattern(examples);
    expect(inference.problem).toBeUndefined();
    expect(inference.ambiguous).toBe(false);
    expect(inference.pattern).toMatchObject({
      short: '{name}-repo',
      url: 'https://dev.azure.com/acme/web/_git/{name}',
    });
    const compiled = compileLinkPatterns(inference.pattern ? [inference.pattern] : []);
    expect(shortFormOf('https://dev.azure.com/acme/web/_git/web-shell', compiled)).toBe(
      'web-shell-repo',
    );
    expect(findShortForms('see unicorn-api-repo and docs', compiled)[0]?.href).toBe(
      'https://dev.azure.com/acme/web/_git/unicorn-api',
    );
  });

  it('a number between fixed text: DEV-123 and DEV-200', async () => {
    const { inferLinkPattern } = await import('./link-patterns.js');
    expect(
      inferLinkPattern([
        { url: 'https://tracker.example/t/DEV-123', short: 'DEV-123' },
        { url: 'https://tracker.example/t/DEV-200', short: 'DEV-200' },
      ]).pattern,
    ).toMatchObject({ short: 'DEV-{id}', url: 'https://tracker.example/t/DEV-{id}' });
  });

  it('D-111: two parts that change, fixed text between them: {name}-PR-{id}', async () => {
    const { compileLinkPatterns, inferLinkPattern, shortFormOf, findShortForms, fixedPartProblem } =
      await import('./link-patterns.js');
    const inference = inferLinkPattern([
      {
        url: 'https://dev.azure.com/acme/web/_git/unicorn-api/pullrequest/45',
        short: 'unicorn-api-PR-45',
      },
      {
        url: 'https://dev.azure.com/acme/web/_git/platform/pullrequest/12',
        short: 'platform-PR-12',
      },
    ]);
    expect(inference.problem).toBeUndefined();
    expect(inference.ambiguous).toBe(false);
    expect(inference.pattern).toMatchObject({
      short: '{name}-PR-{id}',
      url: 'https://dev.azure.com/acme/web/_git/{name}/pullrequest/{id}',
      kinds: { name: 'word', id: 'digits' },
    });
    const pattern = inference.pattern;
    if (!pattern) throw new Error('no pattern');
    // The fixed text between the parts counts as the fixed part.
    expect(fixedPartProblem(pattern)).toBeNull();
    const compiled = compileLinkPatterns([pattern]);
    // Every repository, both ways.
    expect(
      shortFormOf('https://dev.azure.com/acme/web/_git/web-shell/pullrequest/7', compiled),
    ).toBe('web-shell-PR-7');
    expect(findShortForms('review web-shell-PR-7 today', compiled)[0]?.href).toBe(
      'https://dev.azure.com/acme/web/_git/web-shell/pullrequest/7',
    );
    // Short forms that don't fit stay text.
    expect(findShortForms('a PR-7 or web-shell-PR- here', compiled)).toEqual([]);
  });

  it('a short form with no fixed part is refused, with a suggestion', async () => {
    const { fixedPartProblem, suggestShortForm } = await import('./link-patterns.js');
    expect(fixedPartProblem({ short: '{name}', url: 'https://drop.example/{name}' })).toContain(
      'fixed text',
    );
    expect(fixedPartProblem({ short: 'AB#{id}', url: 'https://x.dev/{id}' })).toBeNull();
    expect(fixedPartProblem({ short: '{name}-repo', url: 'https://x.dev/{name}' })).toBeNull();
    expect(fixedPartProblem({ short: '#{id}', url: 'https://x.dev/{id}' })).toContain('fixed');
    expect(suggestShortForm('https://drop.example/Qx7Lp-M42sTn', 'Qx7Lp-M42sTn')).toBe(
      'de:Qx7Lp-M42sTn',
    );
  });

  it('a built-in turned off no longer shortens pasted links; examples are kept', async () => {
    const { linkTitle, setBuiltInLinksOff, readLinkPatterns, presetSample, LINK_PRESETS } =
      await import('./link-patterns.js');
    const url = 'https://dev.azure.com/acme/web/_git/api/pullrequest/42';
    expect(linkTitle(url, [])).toBe('PR 42');
    setBuiltInLinksOff(['ado-pull-request']);
    expect(linkTitle(url, [])).not.toBe('PR 42');
    setBuiltInLinksOff([]);
    expect(LINK_PRESETS.map(presetSample)).toEqual([
      'AB#42',
      'PR 42',
      'repo#42',
      'repo!42',
      'KEY-42',
    ]);
    expect(
      readLinkPatterns([
        {
          short: 'AB#{id}',
          url: 'https://x.dev/{id}',
          examples: [{ url: 'https://x.dev/1', short: 'AB#1' }, 3],
        },
      ]),
    ).toEqual([
      {
        short: 'AB#{id}',
        url: 'https://x.dev/{id}',
        examples: [{ url: 'https://x.dev/1', short: 'AB#1' }],
      },
    ]);
  });
});
