import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightCode, tagHighlighter, tags } from '@lezer/highlight';

/**
 * All common languages in the grayscale scheme (NOTE-04, UI-06, D-63, D-84): the code blocks of
 * rendered task bodies get the same highlighting as the note editor, for any language CodeMirror's
 * language data knows (bash, PowerShell, C#, Go, Rust, SQL, YAML…). Each language loads only when a
 * block uses it. JSON and stack traces keep the popup's own highlighter (highlight.ts).
 */

const classes = tagHighlighter([
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.operatorKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
    ],
    class: 'tok-keyword',
  },
  { tag: [tags.number, tags.integer, tags.float], class: 'tok-number' },
  { tag: [tags.bool, tags.null, tags.atom], class: 'tok-literal' },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character],
    class: 'tok-string',
  },
  {
    tag: [tags.propertyName, tags.attributeName, tags.variableName, tags.labelName],
    class: 'tok-key',
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName],
    class: 'tok-function',
  },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], class: 'tok-type' },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    class: 'tok-comment',
  },
  {
    tag: [tags.punctuation, tags.bracket, tags.operator, tags.separator],
    class: 'tok-punctuation',
  },
]);

/** The language a fence names (`bash`, `ts`, `c#`…), if CodeMirror knows it. */
export function languageFor(name: string): LanguageDescription | null {
  const clean = name.trim().toLowerCase();
  if (clean === '') return null;
  return LanguageDescription.matchLanguageName(languages, clean, true);
}

/**
 * Highlights `code` (an element holding the block's text) in its language; resolves false when the
 * language isn't known, leaving the block as it was. One span per line, like highlight.ts.
 */
export async function highlightLanguage(
  code: HTMLElement,
  text: string,
  name: string,
): Promise<boolean> {
  const description = languageFor(name);
  if (!description) return false;
  const support = await description.load();
  const tree = support.language.parser.parse(text);
  const lines: HTMLElement[] = [];
  let line = document.createElement('span');
  line.className = 'code-line';
  highlightCode(
    text,
    tree,
    classes,
    (piece, pieceClasses) => {
      if (pieceClasses === '') {
        line.append(piece);
        return;
      }
      const span = document.createElement('span');
      span.className = pieceClasses;
      span.textContent = piece;
      line.append(span);
    },
    () => {
      lines.push(line);
      line = document.createElement('span');
      line.className = 'code-line';
    },
  );
  lines.push(line);
  if (!code.isConnected) return true;
  code.replaceChildren(...lines);
  return true;
}
