import { describe, expect, it } from 'vitest';
import { compileLinkPatterns } from '../../shared/link-patterns.js';
import { panelExtras } from './extras.js';

const patterns = compileLinkPatterns([
  { short: 'AB#{id}', url: 'https://dev.azure.com/acme/web/_workitems/edit/{id}' },
]);

describe('the context panel’s References and Attachments (NAV-07, D-85)', () => {
  it('collects short forms, links and bare URLs once each, in order, never from code', () => {
    const { references } = panelExtras(
      [
        'See AB#1234 and [the runbook](https://wiki.example.com/runbook).',
        'Also https://dev.azure.com/acme/web/_workitems/edit/77 and https://example.com/a/',
        '`AB#9` in code, and again AB#1234.',
        '```',
        'https://example.com/in-code AB#555',
        '```',
      ].join('\n'),
      patterns,
    );
    expect(references).toEqual([
      { text: 'AB#1234', href: 'https://dev.azure.com/acme/web/_workitems/edit/1234' },
      { text: 'the runbook', href: 'https://wiki.example.com/runbook' },
      { text: 'AB#77', href: 'https://dev.azure.com/acme/web/_workitems/edit/77' },
      { text: 'example.com/a', href: 'https://example.com/a/' },
    ]);
  });

  it('lists pictures, videos and linked files, marking files linked where they are', () => {
    const { attachments, references } = panelExtras(
      [
        '![gateway](attachments/2026-11-02-diff.png)',
        '![](attachments/demo%20run.mp4)',
        '![](file:///D:/Videos/huge.mov)',
        '[spec.pdf](attachments/spec.pdf)',
        '![again](attachments/2026-11-02-diff.png)',
      ].join('\n\n'),
      patterns,
    );
    expect(attachments).toEqual([
      {
        link: 'attachments/2026-11-02-diff.png',
        name: '2026-11-02-diff.png',
        kind: 'image',
        linked: false,
      },
      { link: 'attachments/demo%20run.mp4', name: 'demo run.mp4', kind: 'video', linked: false },
      { link: 'file:///D:/Videos/huge.mov', name: 'huge.mov', kind: 'video', linked: true },
      { link: 'attachments/spec.pdf', name: 'spec.pdf', kind: 'file', linked: false },
    ]);
    expect(references).toEqual([]);
  });
});
