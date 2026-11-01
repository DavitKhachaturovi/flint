# 03 — UX & Design Language

Flint should feel **calm, fast, and comfortable**. It is not a dashboard: it never dumps information on the user. This document defines how Flint looks, moves, and responds to input.

---

## 1. Design philosophy

- **Comfort over density.** Generous spacing, few elements per screen, nothing competing for attention. The user should feel relaxed opening Flint, not overwhelmed.
- **No clutter, ever.** Metadata stays hidden until it's useful: shown on hover/selection, or as a tiny indicator. A task row is primarily its text.
- **Meaning without reading.** State is communicated visually (priority stripe, bell, body indicator, check) instead of text labels.
- **Progressive disclosure.** One-line tasks expand into bodies; the Completed section collapses; settings stay in settings.
- **Speed is part of the design.** Nothing the user waits on should take longer than 100 ms; animations never exceed ~150 ms (see Motion).
- **Not a project-management tool.** If a UI element exists mainly to "manage" (fields, statuses, assignees), it does not belong (01, Non-goals).

---

## 2. Interaction model: Navigate vs Edit

Task lists are keyboard-driven, and single keys like **Space** and **1/2/3/0** are commands. But users also type spaces and digits *into* tasks. So every task list has two clearly distinct states:

| State | What's happening | Keys mean |
|---|---|---|
| **Navigate** | A row is *selected* (highlighted), no text cursor | Commands (Space completes, 3 sets high priority, ↑/↓ moves selection) |
| **Edit** | A text cursor is *inside* a task's text | Typing (Space is a space, 3 is a 3) |

- **Enter** → Edit state. **Esc** → back to Navigate (with the same row selected).
- **Mouse (D-71, replaces click-to-select-then-click-to-edit):** clicking a task's **title text** enters Edit directly, with the caret where you clicked, and the row stays highlighted; clicking **empty row space** only selects; **double-click** anywhere on the row edits; Esc returns to the selected row. **Proposed:** the caret lands at the matching place in the raw text (markup characters such as `**` counted); clicking a link in a title still opens it; Ctrl/Shift+click selects (TASK-07); a press that becomes a drag never edits.
- **D-74:** a click on another task's text goes **straight into editing** on that row: no selection glide first. The **editing row looks like a dark input field**, like the composer (`--fl-ground-well` with a subtle edge), so Edit is clearly different from a selected row (09 §8).
- **D-76:** a **second single click** on an already-selected row (outside its text) enters Edit too, like renaming in Explorer; a double-click edits from any state. The field eases in when Edit starts and glides when Edit moves to another row (Enter on a new row, a click on another task's text).
- The **selected** row and the **row being edited** must look visibly different (e.g. selection = subtle background; editing = caret + slightly stronger outline).
- This is the same model as Things 3 and Vim, so it feels familiar to developers.

---

## 3. Keyboard map

**Decided** keys come from the agreed feature list. **Proposed** keys are defaults to implement unless changed (see Q-06/Q-08). All in-app keys should be shown in the `?` cheat sheet (NAV-02).

### Global (work from any app)
| Action | Key | Status |
|---|---|---|
| Open capture popup (CAP-01) | Ctrl+Shift+Space, rebindable (D-37) | Decided |
| Capture selected text (CAP-07) | Ctrl+Shift+X, rebindable (D-37) | Decided |
| Change a global hotkey (APP-08) | Tray → Hotkeys…, click the hotkey, press the new keys; Esc cancels | Proposed (D-44) |

### Capture popup
| Action | Key | Status |
|---|---|---|
| Save task and close | Enter | Decided |
| Close (draft kept) | Esc | Decided |
| Discard the draft and close | Shift+Esc | Decided (D-39) |
| Esc / Shift+Esc anywhere in the popup (also after clicking the card's background) | Esc, Shift+Esc while the popup has the focus; never a global hotkey, so Esc keeps working in other apps while the popup stays open | Decided (D-46) |
| Close the popup from another window | Ctrl+Shift+Space (cursor back to the popup), then Esc; or the × on the card | Decided (D-46) |
| Move the popup | Drag the small grip at the top of the card (not the background, so text never moves the window); not remembered | Decided (D-47, D-68) |
| Accept the highlighted `##` suggestion, or the option on the close-match / new-list card | Enter: the first Enter only accepts, the next Enter saves | Decided (D-40) |
| Save with an open card or menu straight away | The save button (D-25 rules apply to the `##` token) | Decided (D-40) |
| Choose another suggested list | ↑ / ↓ while the `##` suggestion menu is open | Proposed |
| Create a new list instead of the close match | Tab (the card switches to `New list "<name>" · Enter`) | Decided (D-25) |
| Go back to the close match after Tab | Tab again (the card offers `<list> · Tab`) | Proposed |
| Remove a parsed token (priority, list, time) | Click the × on its chip; the token leaves the text | Proposed |
| Type a token without remembering it | The flag, `#` and bell buttons under the box open the priority, list and date/time pickers (CAP-11); each picks with the keyboard and inserts the same chip as the shorthand | Decided (D-57) |
| Date/time picker (also in the main window) | Type a time (`fri 15`, `14:37`) and Enter, or ↑/↓ and Enter on a preset; in the calendar the arrows move the day and Enter picks it; in the wheels ↑/↓ or digits change the column, Tab switches hour / minute, Enter sets, ← goes back to the calendar | Decided (D-70); keys Proposed |
| Add a note below the title (the title line is always one line) | Shift+Enter; in a note Shift+Enter is a new line, Enter saves, Up from its first line or Shift+Tab goes back to the title, Backspace on an empty note removes it | Decided (D-38); note keys Proposed |
| Capture hotkey while the popup stays open without focus | Ctrl+Shift+Space brings the cursor back; pressed again while focused, it closes the popup (draft kept) | Decided (D-41) |
| Add another selection while the popup is open | Ctrl+Shift+X in the other app: appended to the selection area | Decided (D-39) |
| Paste screenshot / stack trace / JSON | Ctrl+V | Decided (behaviour in CAP-06) |
| Undo `Created list <name>` from the notice line (D-26) | Ctrl+Z while the title is empty, or click Undo | Proposed |
| Retry `Couldn't save your last capture` | Enter (the capture is back in the popup), or click Retry | Proposed |

### Task list — Navigate state
| Action | Key | Status |
|---|---|---|
| Move selection | ↑ / ↓ | Proposed |
| Extend selection (multi-select) | Shift+↑ / Shift+↓ | Decided |
| Reorder selected task(s) | Alt+↑ / Alt+↓ | Decided |
| Complete / un-complete | Space | Decided |
| Priority low / medium / high / none | 1 / 2 / 3 / 0 | Decided |
| Indent / outdent (one level max) | Tab / Shift+Tab | Decided (Tab indents once) |
| Edit selected task | Enter | Proposed (see Q-08) |
| New task | N (and Ctrl+N anywhere in the app) | Proposed (see Q-08) |
| Expand / collapse task body | → / ← | Proposed |
| Add a subtask to the selected task | Right-click → Add subtask (also on the task's page) | Decided (D-76) |
| Open task as page (TASK-05) | Shift+Enter | Proposed (D-53) |
| Back from a task's page to its list | Esc (or the back arrow, Alt+←) | Proposed (D-53) |
| Select all tasks (TASK-07) | Ctrl+A | Proposed (D-59) |
| Star to / unstar from Today | S | Proposed |
| Set reminder | R | Proposed |
| Move to list | via Ctrl+K / context menu; single key undecided | Q-06 |
| Delete (to Trash, undo toast) | Delete | Proposed |
| Open the selected task's menu (UI-08) | Shift+F10 or the Menu key | Proposed (D-55) |
| Temporary sort by priority | via Ctrl+K / list menu | Proposed |
| Back to Navigate / clear selection | Esc | Proposed |

### Task list — Edit state
| Action | Key | Status |
|---|---|---|
| Save and add a new task below | Enter | Decided ("Enter adds a task") |
| Back to Navigate | Esc | Decided |
| Indent / outdent | Tab / Shift+Tab | Decided |

Details of the Navigate/Edit model and the composer, built in M4 (**Proposed**, D-51): the composer adds to the top of its list with the capture shorthand (`##list` sends the task elsewhere, with Undo); Edit-state Enter keeps one new row open for task after task, and nothing typed straight on is lost; Esc and leaving a field save; the existing title is inert while editing, so only typed shorthand applies (D-45); Tab on a new row sets its level; completing moves the selection to the next open task; double-click edits.

### Everywhere in the main window
| Action | Key | Status |
|---|---|---|
| Command palette / fuzzy search | Ctrl+K | Decided |
| Keyboard cheat sheet | ? (Navigate state) | Decided |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y) | Undo decided; redo proposed |
| New list or note (LIST-01) | Ctrl+Shift+N | Decided (D-52) |
| Back / forward (NAV-04) | Alt+← / Alt+→, the mouse's side buttons | Decided (D-53) |
| Find in page (NAV-06) | Ctrl+F; Enter / Shift+Enter next / previous match; Esc closes | Decided (D-72) |
| Reorder the selected list, note or group in the sidebar (LIST-06) | Alt+↑ / Alt+↓, Manual sort only | Decided (D-73) |

### All text fields
- Auto-closing brackets and quotes with overtype (UI-09, D-57): `()`, `[]`, `{}`, `""`, `''`, ``` `` ```; quotes don't pair right after a letter.
- Right-click: Cut / Copy / Paste / Select all (UI-08, D-55).

### Note mode
| Action | Key | Status |
|---|---|---|
| Slash command menu | / | Decided |
| Formatting context menu | Right-click | Decided |
| Bold / italic / inline code / link | Ctrl+B / Ctrl+I / Ctrl+E / Ctrl+K inside a selection → link | Proposed (resolve Ctrl+K conflict: palette unless text is selected) |

### Mouse
- Drag rows to reorder, locked to the vertical axis and the list's bounds (D-54); lists in the sidebar reorder the same way. Rows are not dragged onto sidebar lists (D-64); moving is the right-click menu, the list picker, the action bar and Ctrl+K.
- Click a task's title text to edit it there, empty row space to select it, double-click to edit (D-71, §2); click the check to complete.
- Right-click empty sidebar space for the **+** menu: New task list, New note, New group (D-69, D-73). Only the title-bar strip at the top drags the window.
- Right-click anything for its menu (UI-08, D-55). A task: edit, open as page, priority, move, delete; star to Today and reminder join in M6 (**Proposed** items).
- Shift+click / Ctrl+click for multi-select of tasks, and of lists and notes in the sidebar (D-59). With 2+ tasks selected, the floating action bar appears (TASK-07).
- The mouse's back and forward buttons navigate (NAV-04).
- Cursor: the arrow on every control, the hand only on links (UI-01).

---

## 4. Visual language

### Palette
- **v1: dark mode only**, grayscale with one cool-gray accent **`#9AA0AB`** and **white** for emphasis (brand rule: cool palette, no warm colors, no greens). Light mode is Later.
- Every color is a theme token (`docs/design/tokens.css`); no hard-coded colors in components.
- Full visual spec (grounds, text levels, depth, components): [09](09-visual-design.md).

### Priority styling (TASK-03)
- **None (default):** no stripe. Visually neutral.
- **Low / Medium / High:** a **thin left-edge stripe** on the row. The row itself is never tinted.
- **Decided (D-17, resolves Q-01):** lightness and thickness only, never hue. High = 4 px `#FFFFFF`, Medium = 3 px accent `#9AA0AB`, Low = 2 px `#55585D`. Color-blind-safe by default, so no separate palette option.
- No priority text is shown on rows.

### Row anatomy (task list)
- Checkbox · task text · (tiny indicators, right-aligned and muted): body exists, attachment, bell (reminder), home-list label (only in Today), star (only if starred, **Proposed**).
- Task text renders its inline markdown; the raw syntax shows only while editing (LIST-02, D-52).
- An overdue reminder: the bell with a small dot and the time in brighter text; no "Overdue" word, no red, no badge (REM-11, D-68).
- The bell is a button: clicking it turns the reminder off (a strike line is drawn through the bell, the time turns faint, an overdue dot goes away) and on again; the bell never moves (REM-12, D-66, D-68). Clicking the **time** opens the date/time picker to change it (REM-01, D-68).
- Hover never stacks a second rounded background against the selected row (UI-03).
- Indicators are small, monochrome, and low-contrast until hover/selection.
- Subtasks are indented one step; no tree lines.
- Non-task content in the file (TASK-15) appears between rows where it sits: headings as quiet section labels, other text as muted markdown; never selectable in Navigate state, and ↑/↓ skips it.
- Long URLs are shown as smart titles and **never wrap** the row (TASK-10).

### Completed tasks
- Live in a collapsible **"Completed · N"** section at the bottom of the same list.
- Rendered muted (lower contrast, checked). **Proposed:** no strikethrough, to keep the section calm and readable.

### Typography
- **Onest** for UI and text, **FiraGO** for Georgian characters only, **Geist Mono** for code blocks, times, counts, chips, and the monospace toggle (NOTE-06). All bundled with the app, never fetched at runtime (09 §7, UI-05, D-60).
- Restraint in sizes and weights: one size for task text, a smaller muted size for indicators/metadata.

### Density
- **Comfortable** (default) and **Compact** settings. Compact reduces vertical padding only; it never adds information.

### Empty states
- Calm and short: one line of text and, at most, one hint (e.g. "Nothing here. Press Ctrl+N to add a task, or capture from anywhere with your hotkey.").
- No illustrations that compete for attention (**Proposed**: a very subtle monochrome mark at most).

### Toasts
- Small, bottom-anchored, short-lived, always with **Undo** where an action is reversible (completion, delete, move, multi-line paste "Keep as one?").
- A toast always sits **above** the list: rows, hovered rows and their text never cover it (D-65).
- Never a blocking confirmation dialog for reversible actions.

### Capture popup look
- Frameless, centered horizontally on the **active monitor**, in the upper third (Spotlight-like) (**Proposed** position).
- **D-38:** a **single-line title** (the only place shorthand is read), the chip preview row, the autocomplete menu when typing `##`, the small list card (CAP-05, D-25), and below them the **selection area**: pasted and selected content as compact blocks (code, JSON and stack traces as a short highlighted preview such as `JSON · 8 lines`, expandable; plain text and notes editable). The title line's placeholder is always "Capture a task…" (D-45: no fallback title; the selection itself is the task).
- **D-39:** a "Previous draft · Restore" line when Ctrl+Shift+X set an earlier draft aside.
- No after-save overlay: the popup hiding is the confirmation. A follow-up message (e.g. `Created list "unis" · Undo`) waits as one quiet line at the top of the popup the next time it opens, if no Flint window is visible (D-26).
- **D-41:** clicking elsewhere closes an empty popup; one with content stays visible without the focus.
- **D-46:** a small × in the card's top right closes it like Esc. **D-47:** the card's background drags the popup; the position is not remembered.
- **D-42:** the key hint (`Enter saves · Esc keeps draft · Shift+Esc discards`) sits on the card, in the bottom toolbar between the tools and the target list, and gives way first when the toolbar is crowded. Around the card the window is fully transparent and lets clicks through, so nothing but the card and its shadow is ever visible.
- Background color matches the theme so it never flashes white/blank when shown (05).

### Mini mode look
- Small, always-on-top, minimal chrome. Shows Today or Inbox with a toggle; compact rows.

---

## 5. Motion

- **Spring animations** on drag-and-drop and reorder: snappy, physical, quick to settle.
- A **small, satisfying completion animation** (check + row moving to Completed).
- The **selection highlight** glides to the newly selected row and **new rows** ease in instead of appearing rigidly (UI-04, D-56).
- **Switching lists or pages:** the content fades in while rising a few pixels, and the sidebar's highlight glides to the new list (UI-04, D-65).
- The whole composer card is one text target: the I-beam over all of it except its buttons, so the cursor doesn't flicker between arrow and I-beam around the text box (UI-01, D-65).
- **Motion never delays input (D-75, supersedes D-67's ~150 / ~250–300 ms limits).** Every action takes effect immediately; animations are interruptible and retarget smoothly on new input (springs); nothing waits for an animation to finish (a completed task is saved and its row can be undone at once, while the animation plays on). Default durations: **selection** movement ~200 ms; **menus and pickers** opening ~200 ms; **list and page switching** ~320 ms (D-76); the **completion** sequence ~360 ms in all (D-76); small state changes (a strike line, a fade) ~260 ms; hover and colour ~120 ms. **Exception:** the capture popup appears instantly and takes typing from its first frame; it may fade in, but never delays input (CAP-10).
- **Completion (D-67):** the check fills with a small pop, then the row fades, slides and collapses into Completed. **Un-completing** brings the row back smoothly into the open tasks.
- **Animation speed (D-67, D-75):** a setting scales all motion (APP-11, M8), next to the reduce-motion behaviour. If the defaults feel slow in daily use, they are dialled back.
- **Respect OS reduce-motion** (APP-12): when the OS asks for reduced motion, spring and completion animations are disabled; state changes become instant.
- No decorative motion (no idle animations, no bouncing icons).

---

## 6. Accessibility

- Priority never relies on color alone (lightness + thickness, no hue).
- Every action is keyboard-reachable; focus is always visible.
- Reduce-motion respected.
- **Proposed:** proper accessible names/roles for rows, checkboxes, and buttons so screen readers work.
- Sufficient text contrast in the dark theme (light mode is Later).

---

## 7. Writing style (UI copy)

- Short, plain, friendly. No jargon in user-facing text.
- Tell the truth about limitations (e.g. admin-window capture, Focus Assist, "Flint must be running for reminders").
- The privacy promise is stated plainly: "Your notes never leave your machine."
