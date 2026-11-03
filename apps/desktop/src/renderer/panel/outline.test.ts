import { describe, expect, it } from 'vitest';
import { codeBlockTitle, outline } from './outline.js';

describe('the context panel outline (NAV-07, D-83)', () => {
  it('titles blocks: the fence title, the first comment, JSON keys, the exception, the type', () => {
    expect(codeBlockTitle('bash Check gateway health', 'az network show')).toEqual({
      title: 'Check gateway health',
      tag: 'bash',
    });
    expect(codeBlockTitle('bash', '# Check the gateway health\naz network show')).toEqual({
      title: 'Check the gateway health',
      tag: 'bash',
    });
    expect(codeBlockTitle('ts', '// Retry with backoff\nexport const x = 1;').title).toBe(
      'Retry with backoff',
    );
    expect(codeBlockTitle('sql', '-- Active tenants\nselect 1').title).toBe('Active tenants');
    expect(codeBlockTitle('', '/* Reindex job */\nrun()').title).toBe('Reindex job');
    expect(
      codeBlockTitle('json', '{ "region": "westeurope", "retries": 3, "window": "tue-02:00" }'),
    ).toEqual({ title: '{ region, retries, window }', tag: 'json' });
    expect(
      codeBlockTitle(
        '',
        'System.NullReferenceException: Object reference not set\n   at Tenant.Resolver.Resolve() in Resolver.cs:line 42\n   at Api.Middleware.Invoke() in Middleware.cs:line 17',
      ).title,
    ).toBe('NullReferenceException');
    expect(codeBlockTitle('python', 'print(1)')).toEqual({ title: 'Python block', tag: 'python' });
    expect(codeBlockTitle('', 'x y z').title).toBe('Code block');
  });

  it('lists headings by level, the blocks under each, and checklist progress', () => {
    const result = outline(
      [
        '# Sprint planning',
        '## Goals',
        'Ship it.',
        '## Discussed',
        '```bash',
        '# Check the gateway health',
        'az network vnet-gateway show',
        '```',
        '## Decisions',
        '![](attachments/gateway-diff.png)',
        '## Action items',
        '- [ ] Check logs',
        '- [ ] Dry-run',
        '- [x] Share the diff',
        '```json',
        '{ "region": "westeurope", "retries": 3, "window": "tue-02:00" }',
        '```',
        '## Open questions',
      ].join('\n'),
    );
    expect(result.headings.map((heading) => `${heading.level} ${heading.text}`)).toEqual([
      '1 Sprint planning',
      '2 Goals',
      '2 Discussed',
      '2 Decisions',
      '2 Action items',
      '2 Open questions',
    ]);
    expect(result.headings[2]?.blocks).toMatchObject([
      { kind: 'code', title: 'Check the gateway health', tag: 'bash' },
    ]);
    expect(result.headings[3]?.blocks).toMatchObject([
      { kind: 'image', title: 'gateway-diff.png', tag: 'image' },
    ]);
    expect(result.headings[4]?.blocks).toMatchObject([
      { kind: 'code', title: '{ region, retries, window }', tag: 'json' },
    ]);
    expect(result.checklist).toEqual({ done: 1, total: 3 });
    expect(result.empty).toBe(false);
  });

  it('is empty without headings or blocks', () => {
    expect(outline('Just a few words.\n- [ ] and a checkbox').empty).toBe(true);
    expect(outline('![shot](attachments/a.png)').blocks).toMatchObject([{ title: 'shot' }]);
  });

  it('finds where the clickable facts are: open checklist items, code, images, links (D-86)', () => {
    const text = [
      '- [ ] one',
      '- [x] two',
      '- [ ] three',
      '```',
      'https://in.code/ignored',
      '```',
      '![shot](attachments/a.png) and ![clip](attachments/b.mp4)',
      'See [docs](https://example.com/docs), https://example.com/bare and `https://x.y/z`.',
    ].join('\n');
    const { facts } = outline(text);
    const at = (needle: string): number => text.indexOf(needle);
    expect(facts.open).toEqual([at('[ ] one'), at('[ ] three')]);
    expect(facts.code).toEqual([at('```')]);
    expect(facts.images).toEqual([at('![shot]')]);
    expect(facts.links).toEqual([at('[docs]'), at('https://example.com/bare')]);
  });
});
