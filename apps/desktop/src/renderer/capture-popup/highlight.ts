import { traceLineKinds, type BlockKind, type TraceLineKind } from '@flint/core/shorthand';

/**
 * A small highlighter for what actually gets captured (D-38), in the grayscale scheme (UI-06, D-63):
 * JSON (keys, strings, numbers, literals, punctuation) and stack traces in the common formats (the
 * exception lines bright, frames and headers dim, file:line marked; core's `traceLineKinds`, D-65).
 * Other code stays plain monospace; a full highlighter would weigh down the pre-warmed popup
 * (CAP-10).
 * Everything is set as text, never as HTML.
 */

const JSON_TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)/g;
const LOCATION = /((?:[A-Za-z]:)?[\\/\w.-]+\.\w+(?::line)?[:\s]\d+(?::\d+)?)|(line \d+)/;

function span(className: string, text: string): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}

/** Text between JSON tokens: braces, brackets, commas and colons dimmed, the rest as it is. */
function plain(text: string): Node[] {
  return text
    .split(/([{}[\],:]+)/)
    .filter((part) => part !== '')
    .map((part) =>
      /^[{}[\],:]+$/.test(part) ? span('tok-punctuation', part) : document.createTextNode(part),
    );
}

function jsonLine(line: string): Node[] {
  const nodes: Node[] = [];
  let last = 0;
  for (const match of line.matchAll(JSON_TOKEN)) {
    const start = match.index;
    if (start > last) nodes.push(...plain(line.slice(last, start)));
    const [whole, string, colon, number, literal] = match;
    if (string !== undefined) {
      nodes.push(span(colon ? 'tok-key' : 'tok-string', string));
      if (colon) nodes.push(...plain(colon));
    } else if (number !== undefined) nodes.push(span('tok-number', number));
    else if (literal !== undefined) nodes.push(span('tok-literal', literal));
    last = start + whole.length;
  }
  if (last < line.length) nodes.push(...plain(line.slice(last)));
  return nodes;
}

function traceLine(line: string, kind: TraceLineKind): Node[] {
  if (kind === 'exception') return [span('tok-error', line)];
  if (kind === 'header') return [span('tok-frame', line)];
  if (kind === 'plain') return [span('', line)];
  const location = LOCATION.exec(line);
  if (!location) return [span('tok-frame', line)];
  return [
    span('tok-frame', line.slice(0, location.index)),
    span('tok-location', location[0]),
    span('tok-frame', line.slice(location.index + location[0].length)),
  ];
}

/** One element per line, highlighted for the block's kind. */
export function highlightLines(kind: BlockKind, lines: readonly string[]): HTMLElement[] {
  const trace = kind === 'stack-trace' ? traceLineKinds(lines) : [];
  return lines.map((line, index) => {
    const row = document.createElement('span');
    row.className = 'code-line';
    if (kind === 'json') row.append(...jsonLine(line));
    else if (kind === 'stack-trace') row.append(...traceLine(line, trace[index] ?? 'plain'));
    else row.textContent = line;
    return row;
  });
}
