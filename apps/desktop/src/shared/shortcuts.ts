/**
 * Every shortcut worth knowing, in one list (D-80, D-100): Settings' Keyboard shortcuts section
 * shows it now; the `?` cheat sheet and the Ctrl+K palette (M8 step 2) read the same list.
 * Keep it in step with docs/03 §3.
 */

export interface Shortcut {
  readonly keys: string;
  readonly action: string;
}

export interface ShortcutGroup {
  readonly name: string;
  readonly shortcuts: readonly Shortcut[];
}

export const SHORTCUTS: readonly ShortcutGroup[] = [
  {
    name: 'Anywhere in Windows',
    shortcuts: [
      { keys: 'Ctrl+Shift+Space', action: 'Quick capture (changeable)' },
      { keys: 'Ctrl+Shift+X', action: 'Capture the selected text (changeable)' },
    ],
  },
  {
    name: 'Anywhere in Flint',
    shortcuts: [
      { keys: 'Ctrl+N', action: 'New task in the open list' },
      { keys: 'Ctrl+Shift+N', action: 'New list or note' },
      { keys: 'Ctrl+Shift+J', action: 'Quick note' },
      { keys: 'Ctrl+F', action: 'Find in the list or note' },
      { keys: 'Ctrl+Z / Ctrl+Y', action: 'Undo / redo' },
      { keys: 'Alt+← / Alt+→', action: 'Back / forward' },
      { keys: 'Ctrl+\\', action: 'Show or hide the side panel' },
      { keys: 'Ctrl+= / Ctrl+− / Ctrl+0', action: 'Interface size' },
    ],
  },
  {
    name: 'A task list',
    shortcuts: [
      { keys: '↑ / ↓', action: 'Select the task above or below' },
      { keys: 'Shift+↑ / Shift+↓', action: 'Select several' },
      { keys: 'Ctrl+A', action: 'Select every open task' },
      { keys: 'Enter', action: 'Edit the selected task' },
      { keys: 'N', action: 'Add a task (the composer)' },
      { keys: 'Space', action: 'Complete or reopen' },
      { keys: '1 / 2 / 3 / 0', action: 'Priority low, medium, high, none' },
      { keys: 'P', action: 'Pin to Today, or unpin' },
      { keys: 'R', action: 'Set or change the reminder' },
      { keys: 'Alt+↑ / Alt+↓', action: 'Move the task up or down' },
      { keys: 'Tab / Shift+Tab', action: 'Make a subtask, or not' },
      { keys: '→ / ←', action: 'Open or close the notes' },
      { keys: 'Shift+Enter', action: 'Open the task as a page' },
      { keys: 'Delete', action: 'Delete (to Trash, with Undo)' },
      { keys: 'Shift+F10', action: 'The task’s menu' },
      { keys: 'Esc', action: 'Clear the selection' },
    ],
  },
  {
    name: 'Editing a task',
    shortcuts: [
      { keys: 'Enter', action: 'Save and start the next task' },
      { keys: 'Shift+Enter', action: 'Go on into its notes' },
      { keys: 'Esc', action: 'Stop editing (it is saved)' },
      { keys: '!h !m !l', action: 'Priority, as you type' },
      { keys: '##list', action: 'Send it to a list' },
      { keys: '@15:00, @tomorrow', action: 'A reminder' },
    ],
  },
  {
    name: 'Notes',
    shortcuts: [
      { keys: '/', action: 'Insert a block (slash commands)' },
      { keys: 'Ctrl+B / Ctrl+I', action: 'Bold / italic' },
      { keys: 'Ctrl+Shift+V', action: 'Paste as plain text' },
      { keys: 'Ctrl+Shift+M', action: 'Monospace for this note' },
    ],
  },
];
