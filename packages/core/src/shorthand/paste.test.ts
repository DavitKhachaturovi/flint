import { describe, expect, it } from 'vitest';
import { parseCapture } from './parse.js';
import { capturePaste, classifyPaste, fencedBlock, titleFromPaste } from './paste.js';

const dotnet = `System.NullReferenceException: Object reference not set to an instance of an object.
   at Unicorn.Tenants.TenantResolver.Resolve(String host) in C:\\src\\Tenants\\TenantResolver.cs:line 42
   at Unicorn.Api.Middleware.TenantMiddleware.InvokeAsync(HttpContext context) in C:\\src\\Api\\TenantMiddleware.cs:line 18`;

const node = `TypeError: Cannot read properties of undefined (reading 'id')
    at refreshToken (/app/src/auth/refresh.ts:31:18)
    at async Importer.run (/app/src/importer.ts:88:5)`;

const python = `Traceback (most recent call last):
  File "/app/etl/load.py", line 12, in <module>
    main()
  File "/app/etl/load.py", line 9, in main
    rows["tenant"]
KeyError: 'tenant'`;

const json = `{
  "error": "token expired",
  "code": 401
}`;

const code = `function retry(fn) {
  for (let i = 0; i < 3; i++) {
    try { return fn(); } catch {}
  }
}`;

describe('paste-to-capture (CAP-06)', () => {
  it('recognises stack traces, JSON and code; everything else is text', () => {
    expect(classifyPaste(dotnet)).toBe('stack-trace');
    expect(classifyPaste(node)).toBe('stack-trace');
    expect(classifyPaste(python)).toBe('stack-trace');
    expect(classifyPaste(json)).toBe('json');
    expect(classifyPaste('[1, 2, 3]')).toBe('json');
    expect(classifyPaste(code)).toBe('code');
    expect(classifyPaste('call Alex about the tenant migration')).toBe('text');
    expect(classifyPaste('first thing\nsecond thing\nthird thing')).toBe('text');
    expect(classifyPaste('{ not json')).toBe('text');
    expect(classifyPaste('42')).toBe('text');
  });

  it('titles a paste with its exception message', () => {
    // 86 characters: cut to 80 with an ellipsis.
    expect(titleFromPaste(dotnet)).toBe(
      'System.NullReferenceException: Object reference not set to an instance of an ob…',
    );
    expect(titleFromPaste(node)).toBe(
      "TypeError: Cannot read properties of undefined (reading 'id')",
    );
    expect(titleFromPaste(python)).toBe("KeyError: 'tenant'");
    expect(titleFromPaste(json)).toBe('error: token expired');
    expect(titleFromPaste('[1, 2]')).toBe('JSON');
    expect(titleFromPaste('x'.repeat(200), 20)).toBe(`${'x'.repeat(19)}…`);
  });

  it('keeps shorthand-looking text in a pasted title as text', () => {
    const title = titleFromPaste(
      'Error: deploy !h failed for ##infra @15:00\n  at x (a.js:1:1)\n  at y (b.js:2:2)',
    );
    const parsed = parseCapture(title, { now: new Date(2026, 9, 29, 10), lists: [] });
    expect(parsed.title).toBe('Error: deploy !h failed for ##infra @15:00');
    expect(parsed.priority).toBeNull();
    expect(parsed.reminder).toBeNull();
    expect(parsed.target).toEqual({ kind: 'inbox' });
  });

  it('fences with more backticks than the paste contains', () => {
    expect(fencedBlock('a ``` b', 'json')).toBe('````json\na ``` b\n````');
    expect(fencedBlock('plain\n\n')).toBe('```\nplain\n```');
  });

  it('puts code in the body and keeps what was typed as the title', () => {
    expect(capturePaste('fix token refresh !h', json)).toBe(
      `fix token refresh !h\n\`\`\`json\n${json}\n\`\`\``,
    );
    expect(capturePaste('', node)).toBe(
      `TypeError: Cannot read properties of undefined (reading 'id')\n\`\`\`\n${node}\n\`\`\``,
    );
    expect(capturePaste('title\nnote line', code)).toBe(
      `title\nnote line\n\`\`\`\n${code}\n\`\`\``,
    );
    expect(capturePaste('title', 'just words')).toBeNull();
  });

  it('the pasted block survives parsing verbatim as the body', () => {
    const text = capturePaste('deploy failed ##infra', python) ?? '';
    const parsed = parseCapture(text, { now: new Date(2026, 9, 29, 10), lists: [] });
    expect(parsed.title).toBe('deploy failed');
    expect(parsed.target).toEqual({ kind: 'new', name: 'infra' });
    expect(parsed.body).toBe(`\`\`\`\n${python}\n\`\`\``);
  });
});
