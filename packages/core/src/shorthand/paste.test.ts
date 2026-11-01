import { describe, expect, it } from 'vitest';
import { parseCapture } from './parse.js';
import {
  blockFor,
  classifyPaste,
  composeCapture,
  fencedBlock,
  isCodeBlock,
  taskLabel,
  titleFromPaste,
} from './paste.js';

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

  it('keeps pasted markdown as markdown: fenced blocks and image links (D-79)', () => {
    const fenced = 'Repro:\n```js\nconst a = 1;\nfoo();\n```\n![shot](attachments/shot.png)';
    expect(classifyPaste(fenced)).toBe('text');
    expect(classifyPaste('```\n{"a": 1}\n```')).toBe('text');
    expect(classifyPaste('![](attachments/a.png)')).toBe('text');
    // Raw code is still fenced.
    expect(classifyPaste(code)).toBe('code');
  });

  it('keeps markdown notes as text, even when their lines end in links (D-76)', () => {
    const links =
      '- [Runbook](https://wiki/run)\n- [Dashboard](https://grafana/d)\n- [Alerts](https://pd/a)';
    expect(classifyPaste(links)).toBe('text');
    const steps = '## Steps\n1. Open the app (Ctrl+Shift+Space)\n2. Paste the trace (Ctrl+V)';
    expect(classifyPaste(steps)).toBe('text');
    expect(classifyPaste('> quoted (one)\n> quoted (two)\n> quoted (three)')).toBe('text');
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

  it('puts code in the body and keeps the typed task line', () => {
    expect(composeCapture('fix token refresh !h', [blockFor(json)])).toBe(
      `fix token refresh !h\n\`\`\`json\n${json}\n\`\`\``,
    );
    expect(composeCapture('title', [{ kind: 'note', text: 'note line\n' }, blockFor(code)])).toBe(
      `title\nnote line\n\`\`\`\n${code}\n\`\`\``,
    );
  });

  it('the pasted block survives parsing verbatim as the body', () => {
    const text = composeCapture('deploy failed ##infra', [blockFor(python)]);
    const parsed = parseCapture(text, { now: new Date(2026, 9, 29, 10), lists: [] });
    expect(parsed.title).toBe('deploy failed');
    expect(parsed.target).toEqual({ kind: 'new', name: 'infra' });
    expect(parsed.body).toBe(`\`\`\`\n${python}\n\`\`\``);
  });
});

describe('the selection is the task (D-45)', () => {
  it('classifies selections into blocks', () => {
    expect(blockFor('  ping Alex about the tenant cache  ')).toEqual({
      kind: 'text',
      text: 'ping Alex about the tenant cache',
    });
    expect(blockFor(`\n${json}\n\n`)).toEqual({ kind: 'json', text: json });
    expect(isCodeBlock('stack-trace')).toBe(true);
    expect(isCodeBlock('note')).toBe(false);
  });

  it('code with nothing typed: an empty task line and the code as the body', () => {
    expect(composeCapture('', [blockFor(node)])).toBe(`\n\`\`\`\n${node}\n\`\`\``);
    const parsed = parseCapture(composeCapture('!h', [blockFor(json)]), {
      now: new Date(2026, 9, 29, 10),
      lists: [],
    });
    expect(parsed.title).toBe('');
    expect(parsed.priority).toBe('high');
    expect(parsed.body).toBe(`\`\`\`json\n${json}\n\`\`\``);
  });

  it('plain text with nothing typed: its first line is the task line, the rest the body', () => {
    expect(composeCapture('', [blockFor('the line from Teams')])).toBe('the line from Teams');
    expect(composeCapture('', [blockFor('two lines\nfrom Teams')])).toBe('two lines\nfrom Teams');
    expect(composeCapture('', [{ kind: 'note', text: 'first\nsecond' }, blockFor(json)])).toBe(
      `first\nsecond\n\`\`\`json\n${json}\n\`\`\``,
    );
    expect(composeCapture('follow up', [blockFor('the line from Teams')])).toBe(
      'follow up\nthe line from Teams',
    );
  });

  it('labels an untitled task when it is shown, never in the file', () => {
    expect(taskLabel('fix token refresh', '')).toBe('fix token refresh');
    expect(taskLabel('', fencedBlock(json, 'json'))).toBe('JSON · error');
    expect(taskLabel('', fencedBlock(node))).toBe(
      'Stack trace · TypeError: Cannot read properties…',
    );
    expect(taskLabel('', fencedBlock(code))).toBe('Code · function retry(fn)');
    expect(taskLabel('', '![](attachments/2026-10-29-153012-k3f9.png)')).toBe('Screenshot');
    expect(taskLabel('', '')).toBe('Untitled task');
  });
});
