/**
 * A note's line endings kept as they are (D-141 Q1, byte-exact files): CodeMirror works with `\n`
 * and gives its text back with `\n`, so the editor converts at its edges. A note written with
 * Windows line endings (`\r\n`) stays so; one that mixes them gets its dominant one on the first
 * edit, as task lists do (core's `dominantEol`).
 */

export type LineEnding = '\n' | '\r\n';

/** The line ending most of the text's lines use (`\n` when there is none). */
export function lineEndingOf(text: string): LineEnding {
  let crlf = 0;
  let lf = 0;
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) {
    if (at > 0 && text.charCodeAt(at - 1) === 13) crlf++;
    else lf++;
  }
  return crlf > lf ? '\r\n' : '\n';
}

/** The text as the editor holds it. */
export const toEditor = (text: string): string => text.replace(/\r\n?/g, '\n');

/** The editor's text with the note's line ending. */
export const fromEditor = (text: string, eol: LineEnding): string =>
  eol === '\n' ? text : text.replace(/\n/g, '\r\n');
