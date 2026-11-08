/**
 * Linear-time scanners for paste-to-capture (CAP-06, CAP-07). Each one does exactly what the regex
 * named in its comment did, but the regexes rescanned the rest of the text from every possible
 * start (CodeQL js/polynomial-redos), so a long paste or task body could freeze the capture popup,
 * the main window or the main process for seconds. Every scanner here reads each character a
 * bounded number of times. `paste-scan.test.ts` checks them against the old regexes.
 */

const SPACE = /\s/;
const WORD = /\w/;

/** The characters `\s` matches (the same set `String.prototype.trim` removes). */
export function isSpace(char: string | undefined): boolean {
  return char !== undefined && SPACE.test(char);
}

/** The line ends of `^` and `$` with the `m` flag. */
function isLineEnd(char: string | undefined): boolean {
  return char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029';
}

/** The characters `\w` matches (no `u` flag). */
function isWord(char: string | undefined): boolean {
  return char !== undefined && WORD.test(char);
}

/**
 * The text without the leading and trailing characters that `strip` accepts:
 * `text.replace(/^[…]+|[…]+$/g, '')` for a character class `[…]`.
 */
export function stripEnds(text: string, strip: (char: string) => boolean): string {
  let start = 0;
  while (start < text.length && strip(text.charAt(start))) start += 1;
  let end = text.length;
  while (end > start && strip(text.charAt(end - 1))) end -= 1;
  return text.slice(start, end);
}

/**
 * The text without its leading blank lines (up to and including the last `\n` in its leading
 * whitespace) and its trailing whitespace: `text.replace(/^\s*\n|\s+$/g, '')`.
 */
export function trimBlankLines(text: string): string {
  let space = 0;
  while (isSpace(text.charAt(space))) space += 1;
  const start = space === 0 ? 0 : text.lastIndexOf('\n', space - 1) + 1;
  // `trimEnd` removes exactly the characters `\s` matches, in linear time.
  return text.slice(start).trimEnd();
}

/**
 * Whether the text has a markdown image link: `/!\[[^\]]*\]\([^)]*\)/`, or with `plainTarget` a
 * target of at least one character and no spaces: `/!\[[^\]]*\]\([^)\s]+\)/`.
 */
export function hasImageLink(text: string, plainTarget: boolean): boolean {
  // Every `![` before a `]` ends its alt text at that same `]`, so each `]` is checked once; and a
  // target scan that stopped at a space also fails for any later `](` before that space.
  let from = 0;
  let spaceStop = -1;
  for (;;) {
    const open = text.indexOf('![', from);
    if (open === -1) return false;
    const close = text.indexOf(']', open + 2);
    if (close === -1) return false;
    if (text.charAt(close + 1) === '(') {
      const target = close + 2;
      if (!plainTarget) return text.indexOf(')', target) !== -1;
      if (target > spaceStop) {
        let end = target;
        while (end < text.length && text.charAt(end) !== ')' && !isSpace(text.charAt(end)))
          end += 1;
        if (end === text.length) return false;
        if (text.charAt(end) === ')' && end > target) return true;
        if (text.charAt(end) !== ')') spaceStop = end;
      }
    }
    from = close + 1;
  }
}

/** The text without Dataview fields (`[id:: x]`): `text.replace(/\[[\w-]+::[^\]]*\]/g, '')`. */
export function removeFields(text: string): string {
  let out = '';
  let copied = 0;
  let index = text.indexOf('[');
  while (index !== -1) {
    let name = index + 1;
    while (name < text.length && (isWord(text.charAt(name)) || text.charAt(name) === '-'))
      name += 1;
    if (name > index + 1 && text.startsWith('::', name)) {
      const close = text.indexOf(']', name + 2);
      // No `]` after this field: none after any later one either.
      if (close === -1) break;
      out += text.slice(copied, index);
      copied = close + 1;
      index = text.indexOf('[', copied);
    } else index = text.indexOf('[', index + 1);
  }
  return out + text.slice(copied);
}

/** Whether the text is one URL-like word (`a://b`), maybe padded: `/^\s*\S+:\/\/\S+\s*$/`. */
export function isBareUrl(text: string): boolean {
  const word = text.trim();
  if (SPACE.test(word)) return false;
  const scheme = word.indexOf('://', 1);
  return scheme !== -1 && scheme + 3 < word.length;
}

export interface Fence {
  /** The info string after the opening fence (`json`), word characters only. */
  readonly info: string;
  readonly content: string;
}

/** Whether only spaces follow `at` up to the end of its line. */
function blankToLineEnd(text: string, at: number): boolean {
  let index = at;
  while (index < text.length && isSpace(text.charAt(index)) && !isLineEnd(text.charAt(index)))
    index += 1;
  return index === text.length || isLineEnd(text.charAt(index));
}

/** The length of the run of `char` that starts at `at`. */
function runLength(text: string, at: number, char: string): number {
  let end = at;
  while (end < text.length && text.charAt(end) === char) end += 1;
  return end - at;
}

/**
 * The first fenced block in the text, as `/^(`{3,}|~{3,})(\w*)\s*\n([\s\S]*?)\n\1\s*$/m` finds it:
 * an opening fence at a line start, its info string, blank space up to a line break (blank lines
 * there are skipped), then the content up to the first line that is the same fence and nothing
 * else but spaces, after a `\n`.
 */
export function firstFence(text: string): Fence | null {
  // Closing fences, by fence: the positions of the `\n` before each one, in order.
  const closings = new Map<string, number[]>();
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
    const char = text.charAt(at + 1);
    if (char !== '`' && char !== '~') continue;
    const length = runLength(text, at + 1, char);
    if (length < 3 || !blankToLineEnd(text, at + 1 + length)) continue;
    const key = char.repeat(length);
    const list = closings.get(key);
    if (list) list.push(at);
    else closings.set(key, [at]);
  }
  const closingAt = (fence: string, from: number): number => {
    // A fence with no closing at or after `from` costs nothing; the search runs once, on a match.
    const list = closings.get(fence) ?? [];
    if ((list.at(-1) ?? -1) < from) return -1;
    return list.find((at) => at >= from) ?? -1;
  };
  for (let line = 0; line < text.length; line += 1) {
    if (line > 0 && !isLineEnd(text.charAt(line - 1))) continue;
    const char = text.charAt(line);
    if (char !== '`' && char !== '~') continue;
    const length = runLength(text, line, char);
    if (length < 3) continue;
    const fence = text.slice(line, line + length);
    let info = line + length;
    while (isWord(text.charAt(info))) info += 1;
    // The blank space after the info string must hold a `\n`; the content starts after the last.
    // The `\n`s are noted while the run is read, never searched for backwards: a search past the
    // run's start would reread the text before it for every opening (fences separated by U+2028
    // or `\r`, which end a line but are no `\n`).
    let space = info;
    let last = -1;
    let before = -1;
    while (isSpace(text.charAt(space))) {
      if (text.charAt(space) === '\n') {
        before = last;
        last = space;
      }
      space += 1;
    }
    if (last === -1) continue;
    const end = closingAt(fence, last + 1);
    if (end !== -1) {
      return { info: text.slice(line + length, info), content: text.slice(last + 1, end) };
    }
    // Only one closing can sit inside the blank space: right after its last `\n`, which then
    // closes an (empty or blank) block that starts after the `\n` before it.
    if (before !== -1 && closingAt(fence, last) === last) {
      return { info: text.slice(line + length, info), content: text.slice(before + 1, last) };
    }
  }
  return null;
}
