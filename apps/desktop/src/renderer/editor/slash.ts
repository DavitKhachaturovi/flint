import {
  acceptCompletion,
  autocompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { EDITOR_COMMANDS, inCode, type CommandHost } from './commands.js';

/**
 * Slash commands (M5, NOTE-03, D-82): `/` at the start of a line or after a space opens the command
 * menu, never inside code; typing filters it (`/co` → Code, Code block); ↑/↓ move, Enter or Tab
 * applies, Esc closes and leaves the `/` as typed. The items are the right-click menu's (NOTE-02),
 * each with its tile and `/word` (mockup 04). The menu is CodeMirror's completion list, styled in
 * editor.css.
 */
export function slashCommands(host: () => CommandHost): Extension {
  const source = (context: CompletionContext): CompletionResult | null => {
    const typed = context.matchBefore(/(?:^|\s)\/[\w-]*$/);
    if (!typed) return null;
    const slash = typed.text.startsWith('/') ? typed.from : typed.from + 1;
    if (inCode(context.state, slash)) return null;
    const query = context.state.sliceDoc(slash + 1, context.pos).toLowerCase();
    const options = EDITOR_COMMANDS.filter(
      (command) =>
        query === '' ||
        command.word.startsWith(query) ||
        command.label
          .toLowerCase()
          .split(/\s+/)
          .some((part) => part.startsWith(query)),
    ).map((command): Completion => ({
      label: command.label,
      detail: `/${command.word}`,
      type: command.id,
      apply: (view, _completion, _from, to) => {
        // The `/word` typed goes; the command acts where it was.
        view.dispatch({ changes: { from: slash, to }, selection: { anchor: slash } });
        command.run(view, host());
      },
    }));
    if (options.length === 0) return null;
    return { from: slash + 1, options, filter: false };
  };
  // Only a typed `/` in the right place opens the menu (no check on every other key, so an Esc right
  // after typing always reaches the editor); once open, typing filters it.
  const opener = EditorView.updateListener.of((update) => {
    if (!update.docChanged || !update.transactions.some((tr) => tr.isUserEvent('input.type')))
      return;
    const head = update.state.selection.main.head;
    if (update.state.sliceDoc(head - 1, head) !== '/') return;
    const before = update.state.sliceDoc(head - 2, head - 1);
    const lineStart = update.state.doc.lineAt(head).from === head - 1;
    if (!lineStart && !/\s/.test(before)) return;
    if (inCode(update.state, head - 1)) return;
    window.setTimeout(() => startCompletion(update.view), 0);
  });
  return [
    // Tab applies the item too (D-82); without the menu it indents as usual.
    Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
    opener,
    autocompletion({
      override: [source],
      icons: false,
      activateOnTyping: false,
      defaultKeymap: true,
      closeOnBlur: true,
      tooltipClass: () => 'fl-slash-menu',
      addToOptions: [
        {
          position: 20,
          render: (completion) => {
            const tile = document.createElement('span');
            tile.className = 'fl-slash-tile';
            const command = EDITOR_COMMANDS.find((each) => each.id === completion.type);
            const glyph = command?.glyph ?? '';
            // Constant markup only (the icons are defined in commands.ts).
            if (glyph.startsWith('<svg')) tile.innerHTML = glyph;
            else tile.textContent = glyph;
            return tile;
          },
        },
      ],
    }),
  ];
}
