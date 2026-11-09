import { describe, expect, it } from 'vitest';
import {
  blockFor,
  classifyPaste,
  composeCapture,
  fencedBlock,
  taskLabel,
  titleFromPaste,
} from './paste.js';

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
