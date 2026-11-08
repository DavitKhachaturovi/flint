import { describe, expect, it } from 'vitest';
import { readFixture } from '../../test/fixtures.js';
import { parseCapture } from './parse.js';
import {
  blockFor,
  classifyPaste,
  composeCapture,
  fencedBlock,
  isCodeBlock,
  normalizeNewlines,
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

describe('code copied on Windows and code on one line (CAP-06, D-91)', () => {
  // Davit's sample: playwright.config.ts as VS Code copies it (CRLF), and the same as one line.
  const crlf = readFixture('paste-typescript-crlf.txt');
  const oneLine = readFixture('paste-typescript-one-line.txt');

  it('recognises both as code', () => {
    expect(crlf).toContain('\r\n');
    expect(classifyPaste(crlf)).toBe('code');
    expect(classifyPaste(oneLine)).toBe('code');
    expect(classifyPaste('const total = items.reduce((sum, item) => sum + item.price, 0);')).toBe(
      'code',
    );
    expect(classifyPaste('SELECT id, name FROM tenants WHERE active = 1;')).toBe('code');
    expect(classifyPaste('std::vector<int> values = {1, 2, 3};')).toBe('code');
    expect(classifyPaste('if (user && user.id) { refresh(user); }')).toBe('code');
  });

  it('keeps prose with brackets, semicolons and links as text', () => {
    for (const prose of [
      'Fix null ref in tenant resolver',
      'Call the vendor (re: licences); then email Ana.',
      'Use foo() and bar() here',
      'TODO: check the `npm run build` output',
      'https://dev.azure.com/acme/web/_git/platform/pullrequest/42',
      'Read [the docs](https://example.com/docs) first',
      'Review the PR [priority:: high] [id:: k3f9]',
      'Plan the Q4 roadmap (draft) and share it',
      'See [[Sprint planning]] and [[Backend]]',
    ])
      expect(classifyPaste(prose), prose).toBe('text');
  });

  it('fences CRLF text with \n line endings only, and keeps every line', () => {
    const block = blockFor(crlf);
    expect(block.kind).toBe('code');
    expect(block.text).not.toContain('\r');
    const fenced = fencedBlock(crlf);
    expect(fenced).not.toContain('\r');
    expect(fenced.split('\n')).toHaveLength(9);
    expect(fenced).toBe(`\`\`\`\n${normalizeNewlines(crlf).trim()}\n\`\`\``);
    expect(normalizeNewlines('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
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

  it('labels fenced bodies with blank lines, info strings and text around them', () => {
    expect(taskLabel('', `\n\n${fencedBlock(json, 'json')}\n\nnotes after`)).toBe('JSON · error');
    expect(taskLabel('', `intro\n\`\`\`\n\n\n${code}\n\`\`\`  \nafter`)).toBe(
      'Code · function retry(fn)',
    );
    expect(taskLabel('', '~~~\nCall Alex\n~~~')).toBe('Code · Call Alex');
    expect(taskLabel('', '```\nnot closed')).toBe('```');
    expect(taskLabel('', 'see ![shot](a b.png) here')).toBe('Screenshot');
    expect(taskLabel('', 'see ![shot] (a.png) here')).toBe('see ![shot] (a.png) here');
  });
});

/**
 * Long pastes and task bodies in the shapes CodeQL named (js/polynomial-redos): every function
 * here once rescanned the rest of the text from each position, taking seconds on 50,000
 * characters and freezing the capture popup, the main window or the main process. Each must now
 * take a few milliseconds; the limit is generous for slow CI machines.
 */
describe('long pathological pastes stay fast (CAP-06, js/polynomial-redos)', () => {
  const SIZE = 50_000;
  const LIMIT_MS = 100;

  function fast<T>(run: () => T): T {
    run(); // Warm up: the first call also compiles the code.
    const start = performance.now();
    const result = run();
    expect(performance.now() - start).toBeLessThan(LIMIT_MS);
    return result;
  }

  it('titles: spaces, brackets and quotes inside a long line', { timeout: 10_000 }, () => {
    const tabs = `abc${'\t'.repeat(SIZE)}x`;
    expect(fast(() => titleFromPaste(tabs))).toBe(`${tabs.slice(0, 79).trimEnd()}…`);
    const brackets = `abc${'{['.repeat(SIZE / 2)}x`;
    expect(fast(() => titleFromPaste(brackets))).toBe(`${brackets.slice(0, 79)}…`);
    const quoted = `"${'\t'.repeat(SIZE)}abc ${'\t,"'.repeat(SIZE / 5)}x`;
    expect(fast(() => titleFromPaste(quoted, SIZE * 2))).toBe(quoted.slice(1 + SIZE));
  });

  it('trailing spaces: code blocks, fences and the capture text', { timeout: 10_000 }, () => {
    const spaces = `a${' '.repeat(SIZE)}b`;
    expect(fast(() => fencedBlock(spaces))).toBe(`\`\`\`\n${spaces}\n\`\`\``);
    expect(fast(() => composeCapture('t', [{ kind: 'text', text: spaces }]))).toBe(`t\n${spaces}`);
    expect(fast(() => composeCapture('t', [{ kind: 'note', text: `${spaces}\n \n ` }]))).toBe(
      `t\n${spaces}`,
    );
    const json = `{"a":${' '.repeat(SIZE)}1}`;
    expect(fast(() => blockFor(`\n \n${json}${' \n'.repeat(SIZE / 2)}`))).toEqual({
      kind: 'json',
      text: json,
    });
  });

  it('task labels: unclosed fences over many blank lines', { timeout: 10_000 }, () => {
    expect(fast(() => taskLabel('', `\`\`\`${'\n '.repeat(SIZE / 2)}x`))).toBe('```');
    expect(fast(() => taskLabel('', '```a\n'.repeat(SIZE / 5)))).toBe('```a');
    expect(fast(() => taskLabel('', `\`\`\`\n${'\n```x'.repeat(SIZE / 5)}`))).toBe('```');
    expect(fast(() => taskLabel('', `\`\`\`${'\n'.repeat(SIZE)}x`))).toBe('```');
    // Openings separated by line ends that are no `\n`: the file format keeps U+2028 inside a
    // body line, so a stored body can hold thousands of them.
    const separated = '```a\u2028'.repeat(SIZE / 5);
    expect(fast(() => taskLabel('', separated))).toBe(`${separated.slice(0, 47)}…`);
    expect(fast(() => taskLabel('', '~~~ \r'.repeat(SIZE / 5)))).toBe('~~~');
    expect(fast(() => taskLabel('', `x\n${separated}`))).toBe('x');
    const after = `${separated}\n\`\`\`a\nCall Alex\n\`\`\``;
    expect(fast(() => taskLabel('', after))).toBe('Code · Call Alex');
    // And a block that does close, after all that.
    const closed = `\`\`\`${'\n '.repeat(SIZE / 2)}\nCall Alex\n\`\`\``;
    expect(fast(() => taskLabel('', closed))).toBe('Code · Call Alex');
  });

  it('images: many `![` with no link', { timeout: 10_000 }, () => {
    const opens = '!['.repeat(SIZE / 2);
    expect(fast(() => taskLabel('', opens))).toBe(`${opens.slice(0, 47)}…`);
    expect(fast(() => classifyPaste(opens))).toBe('text');
    const targets = `![](${'a![]('.repeat(SIZE / 5)}`;
    expect(fast(() => taskLabel('', targets))).toBe(`${targets.slice(0, 47)}…`);
    expect(fast(() => classifyPaste(targets))).toBe('text');
    const spaced = '![](a ![](b '.repeat(SIZE / 12);
    expect(fast(() => classifyPaste(spaced))).toBe('text');
    expect(fast(() => classifyPaste(`${opens}![x](a.png)`))).toBe('text');
  });

  it('one-line code: Dataview fields and URLs', { timeout: 10_000 }, () => {
    expect(fast(() => classifyPaste(`x${'[a::'.repeat(SIZE / 4)}`))).toBe('text');
    const field = `x${'[a::'.repeat(SIZE / 4)}] && total => sum`;
    expect(fast(() => classifyPaste(field))).toBe('code');
    expect(fast(() => classifyPaste(`${'a://'.repeat(SIZE / 4)} b`))).toBe('text');
  });
});
