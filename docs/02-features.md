# 02 — Features

Every feature has a stable ID and a status: **v1** (ships in the first release) or **Later** (agreed, deferred).
Items marked **Proposed** are concrete designs that were not explicitly confirmed; implement them as written unless the matching open question in [06](06-roadmap-and-open-questions.md) is decided otherwise.
Interaction details (keys, visuals, motion) live in [03](03-ux-and-design-language.md); on-disk details live in [04](04-data-and-storage.md); implementation details live in [05](05-architecture-and-performance.md).

---

## 1. Lists and modes

### LIST-01 — Multiple lists, two modes (v1)
- Users can create any number of lists. Each list is either a **task list** (mode: tasks) or a **note** (mode: note).
- Each list is one markdown file in the Flint folder (see 04).
- Lists can be created, renamed, reordered in the sidebar, and deleted (deleted lists go to Trash, DATA-02).
- Lists are the top-level `*.md` files in the Flint folder. A file without Flint frontmatter (e.g. created in VS Code or by Claude) shows up as a note; Flint adds its header only when the user edits the file in Flint (D-23).

### LIST-02 — Markdown by default (v1)
- All content is markdown, in both modes. Task titles and task bodies support inline markdown; notes are full markdown documents.
- Files must stay readable and editable in other markdown tools (Obsidian, VS Code, GitHub). See 04.

### LIST-03 — Inbox (v1)
- A built-in task list named **Inbox** always exists and cannot be deleted.
- It is the default target for every capture (CAP-02).
- **Proposed (D-23):** Inbox is identified by the reserved frontmatter `id: inbox`, always displays as "Inbox", is pinned at the top, and cannot be renamed in Flint. If no list has that id at startup, Flint adopts `Inbox.md` if it exists, otherwise creates it.

### LIST-04 — Convert between modes (v1)
- A note can be converted into a task list and back.
- Note → task list (**D-22**, resolves Q-16): checklist items (`- [ ]` / `- [x]`) become tasks (with completion state preserved), and plain bullet lines become tasks too. Everything else (headings, paragraphs) stays in place as non-task content, which task lists show read-only (TASK-15). Nothing is dropped and no confirmation is needed. Example use: meeting notes → action items.
- Task list → note: tasks become a markdown checklist; priority, reminders, and bodies are preserved in the file format (see 04) so converting back is lossless. While the list is a note, its task fields are inert: no Today membership, no reminders (D-29).
- Conversion is undoable (DATA-03).

---

## 2. Capture

### CAP-01 — Global hotkey quick-capture popup (v1)
- A global hotkey opens a **Spotlight-style popup** over any app, **including a full-screen Teams call**, without switching to the main Flint window.
- The user types and presses **Enter**: the task is saved and the popup disappears. **Esc** closes the popup (the draft is kept, CAP-08); **Shift+Esc** discards the draft and closes (D-39).
- **D-46:** a × in the card's top right closes the popup like Esc (the draft is kept). Esc and Shift+Esc work anywhere in the popup while it has the focus; Esc is never a global hotkey, so it keeps working in other apps while the popup stays open. From another window, close it with Ctrl+Shift+Space (cursor back to the popup), then Esc.
- **D-47:** the popup can be dragged by its card's background (not by text fields or buttons); where it was dragged is not remembered, every open starts centered on the active monitor (CAP-09).
- **D-41:** clicking elsewhere closes an empty popup; a popup with content stays visible without the focus, so the user can copy from other apps or add more with Ctrl+Shift+X. It closes on Enter, Esc, Shift+Esc or the capture hotkey; the capture hotkey first brings the cursor back to a popup that stayed open, and closes it when pressed while it has the focus.
- Focus returns to whatever app the user was in before.
- **No after-save overlay (D-26):** for a normal capture, the popup hiding is the confirmation. Messages that must follow a capture (e.g. `Created list "unis" · Undo`, CAP-05, or a failed save) appear as an in-app toast if the main window or mini mode is visible, otherwise as one quiet line at the top of the popup the next time it opens, until dismissed or until the next capture is saved. No system notification.
- **Saving (D-27):** on Enter the popup hands the capture to the main process, waits only for the IPC acknowledgement, then hides. The main process owns the pending capture until the write is confirmed; if the write fails, the next-open notice says `Couldn't save your last capture · Retry` with the text restored.
- The popup is pre-warmed and must appear in under 100 ms (target < 50 ms). See CAP-10 and 05.
- Default hotkey **Ctrl+Shift+Space** (D-37). Hotkeys are rebindable (APP-08).

### CAP-02 — Inbox as the default target (v1)
- Capture requires **zero decisions**. Without any shorthand, every capture lands at the top of Inbox, so the newest capture is visible first. "Top" means just before the first task, not above a heading or paragraph the file starts with (D-22, resolves Q-14).
- Sorting into other lists happens later (or never).

### CAP-03 — Inline shorthand in the capture box (v1)
- Example: `fix token refresh !h ##unicorn` → task "fix token refresh", high priority, in list "Unicorn".
- Example: `deploy hotfix !h @30m` → high priority, reminder in 30 minutes, in Inbox.
- Example: `fix regression from #123 ##infra` → task "fix regression from #123" in list "Infra". A single `#` is never a token.
- Tokens:
  - **Priority:** `!h` / `!high`, `!m` / `!med` / `!medium`, `!l` / `!low`.
  - **List:** `##listname` (D-25; autocomplete and unknown lists: CAP-05). Matching ignores case, spaces, hyphens and underscores, so `##meeting-notes` finds "Meeting notes"; autocomplete inserts the hyphenated form. A single `#` always stays text (`#123`, `#bug`, `#hotfix`, `C#`).
  - **Reminder:** `@<time>` using natural-language times (REM-02), e.g. `@30m`, `@15:00`, `@tomorrow 10`, `@fri`.
- **D-45: shorthand is read only from text the user types.** Text that came from a selection (Ctrl+Shift+X) or a paste is plain text even in the task line: a selected Teams message like `deploy hotfix @15:00, see ##infra` sets no reminder and no list, and its `!`, `##` and `@` never become chips, also after editing inside it. Text typed before or after it, and tokens inserted with the toolbar buttons or the `##` menu, are live.
- A token is **stripped from the stored task text only if it resolves to something valid** (D-25); anything else stays in the title as text.
- With several valid tokens of one kind, the **last** wins and only it is stripped; the others stay in the title as text and the chip says so (e.g. `2 lists → Unicorn`). This applies to `##` and `!`, and (**Proposed**) to `@`.
- Parsing rules (**Proposed**):
  - A token is recognized only at a word boundary (start of input or after whitespace). `foo##bar` inside a word is *not* a list token.
  - `@` is only parsed when what follows is a valid time expression; `email @alex` is left as text.
  - Nothing inside inline code (backticks) is a token.
  - A backslash escapes a token: `\##infra` is stored literally as `##infra`.
  - A `##` token is made of Unicode letters and digits plus `-` `_` `.` (Georgian list names work); trailing punctuation is not part of it (`##infra,`).
  - **D-29, D-38:** Shorthand is read in the **title line only**, which is always one line. Notes (Shift+Enter), pastes and selections go to the selection area below it and become the body, kept verbatim, so `@`, `!` and `##` inside them are never touched.
  - **D-29:** `@` takes the longest valid time expression right after it, up to 6 words: `@tomorrow 10 deploy` reads `tomorrow 10`. A bare number after a day is read as its time (`@tomorrow 10 people` → 10:00); the chip shows it.
  - The live chip preview (CAP-04) is the source of truth for what was parsed.
- The same shorthand parser is used by the capture popup, the in-list task input, and the CLI (CLI-01), from one shared package (05).

### CAP-04 — Live preview chips while typing (v1)
- As the user types, recognized shorthand appears as chips with the text, e.g. `High · Unicorn · 15:00` (each chip with its icon: priority stripe, list `#` glyph, bell; no emoji, 09 §8).
- The user sees exactly what will be parsed **before** pressing Enter. This is what makes the inline syntax trustworthy.
- Reminder chips show the resolved absolute time (e.g. bell icon + `Tomorrow 10:00`).

### CAP-05 — List autocomplete on `##`, new lists from capture (v1, D-25)
- Typing `##` shows a fuzzy autocomplete of existing **task list** names.
- An unknown list name must **never fail silently**. Before Enter, the popup shows a small card with what will happen:
  - **Close match** (an existing task list whose name starts with the token, 2+ characters, or is within edit distance 2, or 1 for names of 4 characters or fewer): `Unicorn · Enter · New list "unis" · Tab`. **Enter** takes the close match (D-40: the first Enter accepts it, the token takes the list's spelling, and the next Enter saves). **Tab** switches the choice to creating the new list (the card then reads `New list "unis" · Enter`). When several lists match the prefix, the most recently used one is offered; sidebar order only breaks exact ties.
  - **No close match:** `New list "<name>" · Enter`.
  - **D-40 (replaces "Enter is the only key that saves"):** while the `##` menu or the card shows, the first Enter only accepts the highlighted suggestion or the card's selected option; the next Enter saves. Tab still flips between the existing list and "New list"; the card visibly flips (D-29). The save button saves straight away, and an unresolved `##` token then follows the close-match rules above.
- An unmatched `##name` **creates a new task list**, named exactly as typed, when the capture is saved. Confirmation: `Created list <name> · Undo` (shown per CAP-01, D-26). Undo moves the task to Inbox and deletes the new list if it is still empty.
- `##name` pointing at a **note**: the token stays as text, the task goes to Inbox, and the chip says `<name> is a note → Inbox`.
- **Proposed:** a name Windows can't use as a file name (`##con`, illegal characters) stays as text, the task goes to Inbox and the chip explains why. "Most recently used" means the last capture or move target (kept in app data, `ui-state.json`).
- **Ranking (D-29):** a task list with the same normalized name is an exact match (an identical spelling wins, then sidebar order); a task list wins over a note of the same name. Among close matches, prefix matches come before typo matches; prefix matches are ordered most recently used first, typo matches by smallest edit distance first, and sidebar order breaks remaining ties.

### CAP-06 — Paste-to-capture (v1)
- **Pasting a screenshot/image** attaches it to the captured task (stored in the attachments folder, MEDIA-02). The popup shows a small thumbnail chip.
- **Pasting a stack trace or JSON** auto-wraps it in a fenced code block (with a language hint when detectable, e.g. `json`).
- **D-38:** pasted multi-line text, code, JSON and stack traces go to the **selection area** below the title line, shown as a compact, highlighted preview (`JSON · 8 lines`, expandable; JSON and stack traces highlighted, other code plain monospace), never as raw fences in the input; one plain line pasted into the title is typed there as usual. On save they become the task **body**, code fenced. **D-45 (replaces the fallback title of D-38):** the selection itself is the task. What the user types is the task line and the selection its body; with nothing typed, plain text fills the task line with its first line (the rest is body), while code, JSON and stack traces leave the task line empty and are the body. No title is ever generated.
- **Proposed (details, M3):** detected as code: valid JSON objects and arrays, stack traces (two or more frame lines in .NET, Java, JavaScript or Python style, or a Python traceback), and multi-line text where at least half the lines look like code (indented, or ending in `;` `{` `}` `)`). Other text pastes as text; pasted text in the task line is plain text, never shorthand (D-45). The title from a paste: the exception message (the last line of a Python traceback), for JSON its first text field (`error: token expired`), cut to 80 characters, with shorthand-looking text in it kept as text (`##`, `!`, `@`). The code fence is longer than any backtick run in the paste. A capture that is only an image keeps an empty task line (D-45). Pasted images (PNG, JPEG, GIF, WebP) wait with the draft in app data until the capture is saved, then go to `attachments/<date-time>-<task id>.png` with a relative link in the body. The + button under the title points to Ctrl+V for now.
- This is how bugs actually show up, so it is high-value for developers.

### CAP-07 — Capture-selection hotkey (v1)
- A **second global hotkey** (**Ctrl+Shift+X**, D-37) captures the currently selected text in any app (an error in a terminal, a line in a Teams chat) and opens the capture popup **prefilled** with it.
- **D-39:** on a closed popup it starts fresh with the new selection; an earlier draft is set aside and shown as "Previous draft · Restore", so it is never lost (Restore swaps the two). On a popup that is open (also one left open without focus, D-41) the selection is appended to the selection area, to collect from several places.
- **D-45:** a single line (or plain text) selected with nothing typed becomes the task line, editable (its `!`, `##` and `@` stay plain text, never shorthand, also after editing inside it (only what the user types is shorthand)); once something is typed, the selection becomes the body. Code, JSON and stack traces go to the selection area as body.
- **D-43:** the clipboard is restored with every format Electron can read back (all items and types of the async clipboard API); verified with browser/Notepad, Teams chat, a normal terminal and an admin terminal (29 Oct 2026).
- Implementation: simulates Ctrl+C in the foreground app and reads the clipboard (05). **The user's previous clipboard content must be restored afterwards.**
- **Known limitation:** Windows blocks simulated input into elevated (administrator) windows, e.g. an admin PowerShell or terminal, when Flint is not elevated. When the copy fails, open the popup empty with a short hint ("Couldn't read selection from an admin window; paste with Ctrl+V") rather than failing silently.
- The same rules as CAP-06 apply to the selection (stack traces/JSON → highlighted code block in the selection area).

### CAP-08 — Draft persistence (v1)
- If the user presses Esc or the popup loses focus, the title, the selection area and any pasted attachment are kept and restored the next time the popup opens.
- Drafts survive app restarts (persisted in app data, see 04).
- The draft is cleared only on successful capture (after the main process confirms the write, D-27) or by Shift+Esc (D-39). Ctrl+Shift+X on a closed popup sets it aside as the previous draft instead (D-39).

### CAP-09 — Open on the active monitor (v1)
- The popup appears on the monitor the user is currently working on (the monitor with the cursor/foreground window), not the primary monitor.

### CAP-10 — Pre-warmed, tiny popup (v1)
- The capture window is created at startup, kept rendered, and hidden. The hotkey only shows it.
- The popup loads only what it needs: input box, chip preview, list autocomplete, paste handling. Not the whole app.
- Performance targets in 05.

---

## 3. Task-list mode

### TASK-01 — Each line is a separate draggable task (v1)
- In a task list, each task is its own row (like the Microsoft To Do list behaviour).
- Tasks can be **dragged** to reorder, e.g. dragged to the top to focus on them first. The manual order is the source of truth and is persisted (it is the order of lines in the file, 04).
- Drag-and-drop and Alt+↑/↓ follow one rule: only the task's block (line, body, subtasks) moves; non-task content in the file never moves as a side effect (D-22).
- Drag uses snappy spring animations (03).

### TASK-02 — Fully keyboard-driven (v1)
- **Enter** adds a task (in Edit state; Navigate-state Enter is Q-08), **Alt+↑/↓** reorders, **1 / 2 / 3 / 0** set priority (low / medium / high / none), **Space** completes.
- Full keymap, including the navigate/edit state model that makes these keys safe, is in 03.
- Drag-and-drop works too; the keyboard is faster for power users.

### TASK-03 — Priority: low / medium / high, shown by color, not text (v1)
- Each task can have priority **low, medium, high**, or **none**.
- **"No priority" is the default** and is visually neutral. If every task were colored, nothing would stand out.
- Priority is shown with a **thin left-edge stripe**, not by tinting the whole row, which keeps the UI calm.
- Because color-only priority is an accessibility problem (red/amber/green is exactly the combination roughly 8% of men cannot reliably tell apart), the stripe is paired with a **second subtle cue** (stripe thickness). **Decided (D-17):** priority uses lightness and thickness only, never hue (High = 4 px white, Medium = 3 px accent, Low = 2 px dim gray), so it is color-blind-safe by default and no separate color-blind palette option is needed in v1. Spec in 09 §4.
- No priority text label is added to the row. Visual spec in 03.

### TASK-04 — One level of subtasks, max (v1)
- **Tab** indents a task once, making it a subtask of the task above. **Shift+Tab** outdents.
- Only one level is allowed; unlimited nesting is where simplicity dies.
- **Proposed:** subtasks move with their parent when dragged or moved to another list; completing a parent completes its open subtasks (undoable).
- **D-28, confirmed by D-29:** completed subtasks stay under their parent (only top-level tasks move to the Completed section). Tab on a task that has subtasks does nothing. An outdented subtask moves to just after its parent's group, so the remaining subtasks keep their parent.
- **D-29:** un-checking a subtask whose parent is completed reopens the parent too (it returns to the active tasks like any un-checked task, TASK-06).

### TASK-05 — Expandable task body (v1)
- Any one-line task can be expanded into a **markdown body** (for a stack trace, notes, screenshots).
- Collapsed, the row shows only a **small indicator** that a body exists. The list stays clean without forcing a separate note.
- The body supports the same editor features as note mode (live preview, code blocks, media).
- A checklist line (`- [ ]`) in a top-level task's body is a subtask (04 §3, D-29): typing `- [ ]` in a body visibly turns that line into a subtask.

### TASK-06 — Completion, undo toast, completed section, auto-archive (v1)
- Completing a task plays a small, satisfying completion animation and shows an **undo toast** instead of a confirmation dialog.
- Completed tasks move to a **Completed section in the same list**; they do not disappear.
- The Completed section is **collapsible** and shows a **count**, e.g. "Completed · 14".
- Each completed task stores a **completion timestamp**.
- Un-checking a completed task returns it to the active tasks (**Proposed:** to its previous position if still valid, i.e. after the task that preceded it when it was completed, remembered in `.flint/meta.json`; otherwise the bottom).
- **Auto-archive:** Flint offers to auto-archive completed tasks older than **N days** (N configurable) so the Completed section doesn't grow forever. Archived tasks remain on disk (04) and remain searchable via Ctrl+K (**Proposed**).

### TASK-07 — Multi-select and bulk actions (v1)
- **Shift+↑/↓** (and Shift+click / Ctrl+click with the mouse) selects multiple tasks.
- Bulk actions: set priority, move to another list, complete, star to Today (and delete, undoable).

### TASK-08 — Temporary "sort by priority" (v1)
- A one-off action that sorts the visible tasks by priority (high → none) **without destroying the manual order**.
- Manual (drag) order stays the source of truth: the temporary sort is a view; leaving it, or reordering manually, returns to manual order. **Proposed:** a clear "Sorted by priority · Back to manual order" indicator while active.

### TASK-09 — Multi-line paste creates multiple tasks (v1)
- Pasting N lines of plain text into a task list creates N tasks, with a toast offering **"Keep as one?"** (which merges them back into a single task with the text as its body). Great for dumping meeting action items.
- **Proposed:** if the pasted text is detected as a stack trace, code, or JSON (CAP-06 rules), it is treated as one task with a code-block body instead of being split.

### TASK-10 — Smart link titles (v1)
- Pasted URLs are displayed with short, meaningful titles; the full URL is kept in the file.
- Example: `https://dev.azure.com/.../pullrequest/42` displays as **"PR 42"**.
- **Proposed** built-in recognizers: Azure DevOps pull requests and work items, GitHub pull requests and issues. Other URLs display as domain + shortened path.
- **Long URLs never wrap rows**; they truncate with an ellipsis.
- Applies in task titles, task bodies, and notes.

### TASK-11 — Move tasks between lists (v1)
- Any task (or a multi-selection) can be moved to another list via a fuzzy list picker, the context menu, the command palette, or drag onto a list in the sidebar.
- This is the core action for sorting Inbox later. A dedicated single-key binding is **not decided** (see Q-06).
- **D-29:** a moved task lands at the top of the target list (like a capture), with its subtasks; a subtask moved on its own becomes a top-level task there. Several tasks moved together (TASK-07) land at the top in their original relative order. Its lines take on the target file's line endings.

### TASK-12 — Delete tasks (v1)
- Deleting a task sends it to Trash (DATA-02) with an undo toast. No confirmation dialog.

### TASK-15 — Non-task content shown read-only (v1, D-22)
- A task-list file can contain content that isn't a task: headings, paragraphs and plain bullets added in Obsidian or VS Code, or kept from a note → task-list conversion (LIST-04).
- It stays exactly where it is in the file and is **shown read-only**: headings as quiet section labels, other text as muted markdown. It is not selectable in Navigate state. To edit it, convert the list to a note or use another editor.
- There is no UI for creating or collapsing sections: Flint shows what's in the file, it does not grow a sections feature.

### TASK-13 — Stale-task fading (Later)
- Inbox tasks untouched for 14+ days become slightly dimmer: a gentle nudge without adding UI.
- Requires a per-task "last touched" timestamp, which **v1 must already record** (04) so this can ship without a migration.

### TASK-14 — Triage mode for Inbox (Later)
- Steps through Inbox tasks one at a time: pick a list, priority, star to Today, or delete, all by keyboard.
- Turns "sorted later, or never" into a 2-minute ritual.

---

## 4. Today

### TODAY-01 — Today view of starred tasks (v1)
- Users **star** tasks from any list into **Today**.
- Today holds **references, not copies**: completing, editing, or changing priority of a task in Today changes it in its home list, and vice versa.
- Each task in Today shows its home list subtly. **Proposed:** Today has its own manual order (drag to reorder) independent of home-list order.

### TODAY-02 — End-of-day rollover prompt (v1, optional)
- At the end of the day, Flint can optionally prompt: **"Roll over unfinished?"** — keep unfinished tasks starred for tomorrow, or clear them from Today (they stay in their home lists).
- The prompt is optional (can be turned off in settings). When and how the prompt appears is open question Q-04.

### TODAY-03 — Reminders section in Today (v1)
- Today includes a **Reminders** section listing tasks with upcoming reminders (see REM-08), so users can see what's scheduled without opening each task.

---

## 5. Reminders

### REM-01 — A reminder on any task (v1)
- Every task can have a reminder: press a button (or key), configure the time, done.
- When due, Flint shows a **Windows notification** and/or **plays a sound** (configurable, REM-06) so the user remembers the task.
- One reminder per task (**Proposed**). No recurring reminders (Non-goals).

### REM-02 — Natural-language times (v1)
- Accepted in both the reminder picker and the capture box.
- Must support at least: `in 20m`, `at 15:00`, `tomorrow 10`, `fri` (plus equivalents like `20m`, `2h`, `15:00`, weekday names).
- The resolved absolute time is always shown before confirming (picker preview / capture chip).
- Default time when only a day is given (`tomorrow`, `fri`): see Q-02.
- **Grammar (D-29):**
  - Relative: `20m`, `2h`, `1h30m`, `in 20m`, `in 2 hours`, `3d` (three days from now, at the default time).
  - Clock: `15:00`, `at 15:00`, `9`, `3pm`, `9:30am`.
  - Days: `today`, `tomorrow`, `mon`…`sun` and full weekday names, `next fri`, each with an optional time.
  - Dates: `2026-11-02`, `2.11` / `02.11` (day.month, the local convention), `2 nov` / `nov 2`, each with an optional time.
  - A clock time that has already passed today means its next occurrence; an explicit date in the past is not a valid time (so `@` stays text).
  - A weekday never means today (`fri` on a Friday is next week's Friday; today is `today`). `next fri` means the same as `fri`. `today` without a time is only valid before the default time. A date without a year is this year's, or next year's if it has passed.

### REM-03 — Reminder shorthand in capture (v1)
- `deploy hotfix !h @30m` captures with a reminder in one line, no picker at all (CAP-03).

### REM-04 — Lightweight snooze presets (v1)
- Quick presets such as **"in 1h"** and **"tomorrow"** in the reminder picker and in the missed-reminders list. (The notification itself has the fixed Done / Snooze 10m / Open buttons, REM-05.) This is the ceiling for time features (Non-goals).

### REM-05 — Actionable notifications (v1)
- The toast has three buttons: **Done**, **Snooze 10m**, **Open**.
  - **Done** completes the task (in its home list).
  - **Snooze 10m** re-schedules the reminder 10 minutes later.
  - **Open** shows the main window with the task selected.
- Clicking the toast body behaves like **Open**.
- Buttons must work while the toast is on screen and from Action Center. Implementation notes in 05.

### REM-06 — Sound option and Focus Assist (v1)
- Settings: notification on/off, sound on/off (and choice of a short sound).
- Windows **Focus Assist / Do Not Disturb silently suppresses ordinary toasts**, and people often enable it during exactly the calls where they capture tasks.
- **Decided (D-35, verified 29 Oct 2026, docs/06 §1):** reminder toasts use Windows' reminder scenario (`scenario="reminder"`): they stay on screen until acted on, and with Windows' default priority settings ("reminders" allowed) they still appear during Do Not Disturb, where an ordinary toast is suppressed. Flint's own sound and in-app alert remain for users who turn that setting off. Flint must make this visible: an option to play Flint's own sound and/or show an in-app alert (e.g. in mini mode) when a reminder fires, and a note in settings explaining Focus Assist.

### REM-07 — Missed-reminder recovery (v1)
- If the app was closed or the PC was asleep when a reminder was due, Flint shows **"N reminders you missed"** on next launch / wake, listing them with the same actions (Done / Snooze / Open).
- Silent misses destroy trust in reminders faster than anything else.

### REM-08 — Bell indicator (v1)
- Tasks with a reminder show a small **bell** indicator on the row (and the time on hover/selection). Combined with TODAY-03, users can see what's scheduled without opening each task.

### REM-09 — Reminders require Flint to be running (v1)
- Flint runs in the system tray and starts with Windows (APP-01), otherwise reminders cannot fire. Users are told this during onboarding and in settings.

### REM-10 — Hide task text in notifications (v1, D-35)
- Setting **"Hide task text in notifications"**, default **off**. When on, a reminder toast says only **"Flint reminder"**: no task title, list or time, so nothing leaks while the screen is shared (reminder toasts show even during Do Not Disturb, REM-06). It applies to the toast and to its copy in Action Center.
- **Proposed:** the Done / Snooze 10m / Open buttons stay (they reveal nothing); Open shows the task in Flint. Until the settings screen exists (M8) the setting is `hideNotificationText` in `settings.json`.

---

## 6. Note mode

### NOTE-01 — Free-form markdown with Obsidian-style live preview (v1)
- A note is a free-form text document, like an Obsidian note.
- **Live preview** (formatting renders inline as you type, markdown syntax revealed near the cursor), **not** a split editor/preview pane.

### NOTE-02 — Right-click formatting menu (v1)
- An Obsidian-like right-click context menu for inserting/formatting: bullet list, numbered list, checkbox, heading, code block, quote, link, image, table, bold/italic/strikethrough/inline code (**Proposed** item set).

### NOTE-03 — Slash commands (v1)
- Typing `/` opens a command menu: e.g. `/check` inserts a checkbox, `/code` a code block. Same items as the right-click menu.
- Slash commands are for keyboard users; the right-click menu stays for mouse users.

### NOTE-04 — Syntax-highlighted code blocks (v1)
- Fenced code blocks are syntax highlighted (in notes and task bodies).

### NOTE-05 — Copy button on code blocks (v1)
- Every code block has a copy button (visible on hover/focus).

### NOTE-06 — Monospace toggle (v1)
- A setting (and per-note toggle, **Proposed**) to render text in a monospace font.

### NOTE-07 — Configurable auto-linking patterns (v1)
- Users configure patterns that auto-link: e.g. `AB#1234` → the Azure DevOps work item URL.
- Configuration = a pattern + a URL template (e.g. `AB#(\d+)` → `https://dev.azure.com/<org>/<project>/_workitems/edit/$1`).
- Works in notes, task titles, and task bodies. Gives integration value without building an integration.

---

## 7. Media

### MEDIA-01 — Images and videos (v1)
- Images and videos can be added to notes and task bodies via paste, drag-and-drop, or the insert menu.
- Images render inline; videos render with a player and thumbnail.

### MEDIA-02 — Attachments folder with relative paths (v1)
- Media is stored in an `attachments/` folder inside the Flint folder and referenced by **relative paths**, so moving the Flint folder never breaks images.

### MEDIA-03 — Large-file warning (v1, Proposed)
- Warn when adding a file above a size threshold (e.g. large videos), since everything lives on local disk and is included in snapshots/exports.

### MEDIA-04 — Orphaned-attachment cleanup (v1)
- When a task or note leaves the Trash permanently, attachments no longer referenced by any list (or by anything still in Trash) are deleted too. Otherwise the attachments folder grows forever.

---

## 8. Navigation and views

### NAV-01 — Ctrl+K command palette (v1)
- Fuzzy search across **all lists** (task titles, bodies, notes) plus commands (create list, move task, open settings, open Flint folder, etc.). No theme switching in v1 (dark only).
- Fully keyboard-driven.

### NAV-02 — `?` keyboard cheat sheet (v1)
- Pressing `?` (in navigate state) shows all shortcuts. Essential for a keyboard-first app.

### NAV-03 — Main window layout (v1, Proposed)
- A minimal, collapsible sidebar: Today and Inbox pinned at the top, then the user's lists. The content area shows the selected list.

### MINI-01 — Mini mode (v1)
- A small **always-on-top floating window** showing just **Today or Inbox** (toggle between them), for calls.
- **Proposed:** supports adding a task, completing, and seeing reminders; everything else opens the main window.
- Created on first use, then hidden (never destroyed) when closed (APP-02). Remembers size/position (APP-05).

---

## 9. Data safety

Without sync, the local disk is the only copy, so this matters more.

### DATA-01 — Atomic writes (v1)
- Every save writes to a temporary file, then renames it over the original. A crash or power loss mid-save can never corrupt a list.

### DATA-02 — Trash, kept 30 days (v1)
- Deleted tasks and deleted lists go to Trash and can be restored for 30 days, after which they are permanently removed (and MEDIA-04 runs).

### DATA-03 — Global Ctrl+Z (v1)
- Undo (and redo, **Proposed:** Ctrl+Shift+Z / Ctrl+Y) works for deletes, moves, reorders, priority changes, completion, conversions, and bulk actions, not just text edits.

### DATA-04 — Local snapshots (v1)
- Flint keeps automatic local snapshots of the Flint folder so a bad change can be restored. Retention policy: see Q-05.

### DATA-05 — One-click zip export (v1)
- Export the whole Flint folder (lists + attachments) as a zip.

### DATA-06 — File watcher (v1)
- Flint watches the Flint folder and reloads lists changed on disk by anything else (the CLI, Claude via the CLI, a text editor) **live**, without losing the cursor position or selection.

### DATA-07 — User-configurable Flint folder (v1)
- The user chooses where the Flint folder lives (set during onboarding, changeable in settings).
- v1 does **not** support syncing this folder between machines (Non-goals, 04).
- **Default: `%USERPROFILE%\Flint`** (D-24, resolves Q-15), which OneDrive Known Folder Move never redirects. If the chosen folder is inside OneDrive, Flint warns plainly that it is synced and that sync isn't supported yet, and allows continuing. If it is an Obsidian vault root, Flint suggests a `Flint` subfolder inside the vault (D-23).
- An **"Open Flint folder"** command (palette and settings).
- **Proposed (D-24):** a list that can't be read because it is cloud-only or locked shows that plainly instead of an empty list; a OneDrive conflict copy shows a notice saying so instead of appearing as a normal extra list.

---

## 10. App behaviour

### APP-01 — Lives in the tray, starts with Windows (v1)
- Flint runs as a tray app and starts at login (configurable, default on). The global hotkeys and reminders depend on it running.
- Tray menu (**Proposed** items): Open Flint, Quick capture, Mini mode, Settings, Quit.

### APP-02 — Never destroy windows; only hide them (v1)
- Closing the main window hides it to the tray. The capture popup and main window stay alive; mini mode stays alive after first open. This removes the "opening a closed window" cost entirely.

### APP-03 — Never quit by accident (v1)
- The window's X button hides to the tray. Quitting is an explicit **Quit** in the tray menu (and a palette command).

### APP-04 — Single instance (v1)
- Launching Flint again focuses the running instance instead of starting a second one.

### APP-05 — Remembered window positions (v1)
- Each window (main, mini mode) remembers its size and position **per monitor setup**.

### APP-06 — Auto-update, applied safely (Later, D-19)
- v1 is distributed manually; users update by running the newer installer over the old one.
- When added: Flint updates itself; nobody reinstalls by hand.
- Updates are **applied on quit or at idle, never mid-session**. An update restart must never happen during a call.

### APP-07 — Silent crash recovery (v1)
- If the UI (renderer) process crashes, Flint detects it and reloads the window automatically. The tray and global hotkeys keep working.

### APP-08 — Rebindable global hotkeys with conflict detection (v1)
- Both global hotkeys (capture, capture-selection) are rebindable. If a chosen hotkey is already taken by another app, Flint says so and asks for another one.
- **Proposed (D-44, until the Settings screen in M8):** a small **Hotkeys** window from the tray: click a hotkey, press the new keys; Flint tries the combination at once and keeps the old one if another app owns it. A hotkey needs Ctrl, Alt or Win (Shift alone would swallow capital letters everywhere); the two must differ; Alt is allowed with a note that it is often a push-to-talk key. While recording, the current hotkeys are switched off. A hotkey that is taken at startup shows as a warning item at the top of the tray menu, which opens the window. Only combinations other apps register globally can be detected, not an app's own shortcuts (e.g. VS Code's).

### APP-09 — No telemetry, stated plainly (v1)
- Flint sends no telemetry and no analytics. The app and installer state plainly: **"Your notes never leave your machine."**
- The only network access is checking for and downloading updates (APP-06), and that is Later: **v1 makes no network requests at all.**
- **Enforced (D-31):** an end-to-end test fails on any network request the app attempts. A future network feature allowlists exactly its own endpoint there; the check is never loosened.

### APP-10 — Teaching Inbox onboarding (v1)
- On first launch, Inbox contains sample tasks that each teach one shortcut (e.g. "Press Space to complete me", "Press 3 to make me high priority", "Press your capture hotkey from any app").
- Users learn by doing and deleting them.
- First launch also asks for the Flint folder location (DATA-07: default `%USERPROFILE%\Flint`, with the OneDrive warning and the vault-root suggestion) and confirms the capture hotkey.

### APP-11 — Settings (v1)
Settings live in app data, not in the Flint folder (04). They include at least:
- Flint folder location.
- Global hotkeys (capture, capture-selection).
- Start with Windows.
- Theme: **dark only in v1** (light mode Later; the setting may be omitted until then), density (comfortable / compact), monospace toggle.
- ~~Priority palette (default / color-blind-safe)~~: not needed in v1, priority is grayscale by lightness and thickness (D-17).
- Notifications on/off, sound on/off and sound choice, Focus Assist explanation, "Hide task text in notifications" (REM-10).
- Today rollover prompt on/off.
- Auto-archive completed tasks after N days (on/off, N).
- Auto-link patterns.

### APP-12 — Respect OS reduce-motion (v1)
- If Windows "show animations" / reduce motion is off, Flint's spring and completion animations turn off automatically.

---

## 11. CLI (Later)

### CLI-01 — Add tasks from the terminal (Later)
- Example: `flint add "null ref in tenant resolver" -p high`.
- Supports the same shorthand as the capture box (CAP-03) and a target list.
- Cheap to build: it writes to the same markdown files using the **same core package** as the app; the running app picks up the change via the file watcher (DATA-06).
- Lets AI models and agents (e.g. Claude) add tasks too.
- Command name: `flint` was proposed before the app was named Flint; see Q-07.

### CLI-02 — Machine-friendly output (Later, with the CLI)
- `flint list --json` and **stable exit codes**, so models and scripts can read tasks, not just add them.
