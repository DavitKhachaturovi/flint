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
- **D-52 (M4):** a **+** next to the "Lists" label in the sidebar and **Ctrl+Shift+N** (anywhere in the main window) create a list. A small menu offers **Task list** or **Note**; the name is then typed in place in the sidebar (**Proposed**). **D-68:** until the M5 editor, a note is shown as a proper page: its title, a comfortable reading width, aligned with the list views, tokens only. **D-64:** a new note gets plain monospace editing (like task bodies, D-49) until M5's note editor; existing notes become editable the same way.
- **D-55, D-59 (M4):** lists and notes have a right-click menu (rename, delete; Inbox has neither). Ctrl+click / Shift+click select several lists or notes in the sidebar; Delete in the right-click menu removes them all. A deleted list goes to Trash storage with its deletion time and an Undo toast, like a deleted task (D-50; **Proposed** for lists).
- **D-107 (0.8.6):** a name typed in the sidebar (renaming a list, note or group in place, or naming a new one) is saved on Enter and when the field is left; only Esc cancels. **D-108 (0.8.7):** saved on leaving it looks like Enter (the row stays in place, no leave and arrive); a click on another list saves it too.
- **D-54 (M4):** lists are reordered in the sidebar by dragging, with the same locked, springy drag as task rows; Inbox stays first. The order is kept in `ui-state.json` (04 §2, **Proposed**).
- **D-73:** the manual order is kept in `.flint/sidebar.json` with the groups (LIST-05), not in `ui-state.json`; Alt+↑/↓ reorders the selected list, note or group too (LIST-06).
- **D-72, D-74:** "Duplicate" in the menu of lists and notes: "<name> copy" (then "<name> copy 2"…) right below the original, every task with a new ID. **Built in M4 step 7 (Proposed):** the copy leaves out reminders, like a duplicated task; undoing it removes the copy while it is unchanged. Ctrl/Shift+click marks lists and notes in the sidebar; a marked one's menu deletes them all, as one undo step. **D-69:** right-clicking empty sidebar space opens the same menu as the **+** (New task list, New note, New group); only the title-bar strip at the top drags the window.

### LIST-02 — Markdown by default (v1)
- All content is markdown, in both modes. Task titles and task bodies support inline markdown; notes are full markdown documents.
- Files must stay readable and editable in other markdown tools (Obsidian, VS Code, GitHub). See 04.
- **D-52 (M4, daily-use bug):** rows render a title's inline markdown (bold, italic, inline code, strikethrough, links) instead of showing the raw syntax (e.g. `**Recover from crashes silently.**`). The raw markdown shows only while the title is being edited. A link opens in the default browser when clicked (the only place with a hand cursor, UI-01).

### LIST-03 — Inbox (v1)
- A built-in task list named **Inbox** always exists and cannot be deleted.
- It is the default target for every capture (CAP-02).
- **Proposed (D-23):** Inbox is identified by the reserved frontmatter `id: inbox`, always displays as "Inbox", is pinned at the top, and cannot be renamed in Flint. If no list has that id at startup, Flint adopts `Inbox.md` if it exists, otherwise creates it.

- **D-89 (Proposed):** Inbox's right-click menu: Sort tasks by ▸, Back to manual order while sorted, Duplicate (never rename, convert, group or delete).
### LIST-04 — Convert between modes (v1)
- A note can be converted into a task list and back.
- Note → task list (**D-22**, resolves Q-16): checklist items (`- [ ]` / `- [x]`) become tasks (with completion state preserved), and plain bullet lines become tasks too. Everything else (headings, paragraphs) stays in place as non-task content, which task lists show read-only (TASK-15). Nothing is dropped and no confirmation is needed. Example use: meeting notes → action items.
- **D-77 (supersedes D-22 for plain lines):** **every non-empty plain text line becomes a task** (a plain-text note no longer becomes one read-only block with zero tasks). Headings stay as section labels; fenced code blocks and quotes attach to the task before them as its body. **Proposed:** numbered list items become tasks like bullets; tables, horizontal rules and HTML comments stay as they are.
- Task list → note: tasks become a markdown checklist; priority, reminders, and bodies are preserved in the file format (see 04) so converting back is lossless. While the list is a note, its task fields are inert: no Today membership, no reminders (D-29).
- Conversion is undoable (DATA-03).
- **D-77, task list → note:** keeping the `[key:: value]` fields in the file is right (lossless). **M5:** the note editor shows them as small muted chips (priority, reminder), hides `id` entirely, and shows the raw text only while the cursor is on that line.
- **D-72 (pulled into M4):** "Convert to note" / "Convert to task list" in the right-click menu of lists and notes (built in M4 step 7; Inbox stays a task list).

### LIST-05 — Sidebar groups (v1, D-73)
- **One level** of collapsible groups in the sidebar, each holding task lists and notes. No nesting.
- Groups are **not folders**: the list files stay flat in the Flint folder (04 §2). Membership and order live in `.flint/sidebar.json` (user data, travels with the folder); which groups are collapsed is machine UI state (`ui-state.json`).
- **+** and the sidebar's right-click menu offer **New group**. Groups can be renamed and deleted; deleting a group keeps its lists, which move out of the group (undoable).
- **D-98:** a group's right-click menu also offers **New task list** and **New note**, made inside that group (its name field at the end of the group; one undo step). The sidebar's foot (Trash; Settings above it in M8) is pinned at the bottom while the lists scroll.
- Lists and notes move into or out of a group by drag (M4 step 8, D-78) and the right-click menu ("Move to group ▸", "Remove from group").
- **Proposed (drag, step 8):** a list dragged right below a group's header goes into the group (first); right below a group's last list it joins the group when it is nearer that list, and goes after the group when it is nearer what follows; it shows indented while it would land in a group and flush while it would land outside one. A group's header drags the whole group among the top-level items. Under a non-manual sort a drag doesn't start and the hint shows.
- **D-81 (supersedes D-80's look):** the group look and drag visuals are 0.4.14's again (the all-caps label header with chevron, name and the count as a number; no folder tile; the previous drag feel, no lift scale, no drop line), plus: an **expanded group has a highlighted card background**; a list dragged over a group gives its card a **white outline ring** (a folded group shows the card and ring only then); D-80's animations and functional changes stay (new groups at the top, a drop on a folded group adds to its end with a pulse, the card grows with sliding lists).
- **D-80 (accepted, look superseded by D-81):** the drag rules above, provided the drop target is clearly visible: over a group, the group lights up (accent ring and "Drop to add" in place of its count), an **indented drop line** shows where the list lands, the other rows slide apart and the dragged row lifts (shadow, slight scale). Dropping on a **collapsed** group's header adds the list to it (**Proposed:** at its end) and the header pulses once. Look per `design/mockups/10-sidebar-groups.html` (09 §8): a group is a **soft card** with a folder tile and its name in normal case, its lists inside on a faint guide line; collapsed, a single card row whose count says "N lists". **New groups appear at the top of Lists** with the name field ready (supersedes D-79's "at the end"). Creating, renaming, deleting, expanding, collapsing, Move to group and Remove from group animate (UI-10).
- **Proposed (built in step 8):** "Move to group ▸" lists the other groups and ends with **New group**, which names a new group (at the top, D-80) with the list already in it. "Remove from group" puts the list right below its group. A click on a group's header folds or opens it (this machine remembers it) and picks the group for Alt+↑/↓. Deleting a group says "Deleted group Work · its lists stay" with Undo; its lists take its place in the order. Under a non-manual sort, moving a list into or out of a group is reordering too, so it shows the same hint.
- **D-74:** Inbox stays pinned at the top, outside any group. **Groups and ungrouped lists share one manual order**, so a group can sit between lists (like Microsoft To Do). Under a non-manual sort, groups keep their manual positions and lists are sorted within each group and among the ungrouped ones (LIST-06).
- **Proposed:** a group header shows a chevron, the name (all-caps label style) and the number of lists (D-81); empty groups stay until deleted; a list Flint hasn't placed yet (new, or made outside Flint) appears ungrouped at the end.
- Milestones: M4 step 8; dragging in M4 step 9.

### LIST-06 — Sidebar sorting (v1, D-73)
- A small sort menu in the sidebar: **Manual** (default, the custom order), **Recently edited**, **Created**. It applies within each group and within the ungrouped lists.
- In Manual, lists, notes and groups reorder with **Alt+↑/↓** and the locked-axis drag (D-54). While another sort is active, reordering is disabled with a short hint to switch to Manual.
- **D-79, Alt+↑/↓ follows the keyboard focus:** with the focus in the task list it moves the selected task; with the focus in the sidebar (a selected list or group) it moves that list or group; with nothing selected, nothing moves (never the open list as a fallback).
- **Accepted (D-80; how "the focus is in the sidebar" works):** a click on a list in the sidebar or on a group's header (or its right-click menu) puts the keyboard there, on that list or group; selecting a task (a click, or ↓ in the opened list) puts it back in the task list. A list opened from the sidebar has no task selected (D-77), so Alt+↑/↓ right after picking it moves the list. A picked group's header shows in `--fl-text-secondary`.
- **D-79:** group names are unique (ignoring case) and up to 60 characters (accepted). **D-80:** new groups go at the top of Lists (no longer at the end). The keyboard-focus rule below is accepted. Changing the sort animates every row to its new place.
- **D-74 (accepted):** Recently edited uses the file's modification time and Created its creation time, both newest first; groups keep their manual positions under every sort. **Proposed:** the menu is a small sort button next to the **+**; the choice is machine UI state.
- Milestone M4 step 8.

---

- **D-87:** **Move to top** in a list's or note's right-click menu, under the Manual sort only; otherwise disabled with the "Switch to Manual" hint.
- **D-114, D-115:** in a group, **Move to top of group** (stays in it) and **Move out to top of Lists** (leaves it); outside groups, **Move to top**. Both are palette commands for the open list.
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

- **D-87 (both the popup and the main window's composer, D-51 parity):** after `##`, the longest existing list name spelled out by the following words, spaces included (exact, ignoring case, spaces and hyphens as D-25), wins before the single-word rules; `##new list 2` goes to "new list 2" when "new list 1" exists too. The composer shows the popup's `##` menu (search, recent lists) and close-match card.
- **D-89:** the `##` menu lists every matching list, scrolling past five (wheel, ↑/↓), in the composer and the popup.
- **D-147 (1.2.0):** a task the main window's composer sends to another list (`##list`) gets the toast "Added to <list>" with **Go to <list>** and Undo, as Restore's toast (D-98): that list opens, the new task selected, scrolled into view and flashed. **Proposed:** the same for a list's new row (typed below a task) and for mini mode's composer, whose Go to opens the main window there as Open does (mini stays).
### CAP-06 — Paste-to-capture (v1)
- **D-80:** in the main window's composer, pasted images and code look as in the popup: a thumbnail chip and a code card preview, never raw link or fence text (TASK-05).
- **D-79:** pasted content that already contains markdown (a fenced code block, an image link) stays markdown; only raw, unfenced code, JSON and stack traces are fenced. The same rules apply in the main window's composer and in body fields.
- **Pasting a screenshot/image** attaches it to the captured task (stored in the attachments folder, MEDIA-02). The popup shows a small thumbnail chip.
- **Pasting a stack trace or JSON** auto-wraps it in a fenced code block (with a language hint when detectable, e.g. `json`).
- **D-38:** pasted multi-line text, code, JSON and stack traces go to the **selection area** below the title line, shown as a compact, highlighted preview (`JSON · 8 lines`, expandable; JSON and stack traces highlighted, other code plain monospace), never as raw fences in the input; one plain line pasted into the title is typed there as usual. On save they become the task **body**, code fenced. **D-45 (replaces the fallback title of D-38):** the selection itself is the task. What the user types is the task line and the selection its body; with nothing typed, plain text fills the task line with its first line (the rest is body), while code, JSON and stack traces leave the task line empty and are the body. No title is ever generated.
- **Proposed (details, M3):** detected as code: valid JSON objects and arrays, stack traces (two or more frame lines in .NET, Java, JavaScript or Python style, or a Python traceback), and multi-line text where at least half the lines look like code (indented, or ending in `;` `{` `}` `)`). Other text pastes as text; pasted text in the task line is plain text, never shorthand (D-45). The title from a paste: the exception message (the last line of a Python traceback), for JSON its first text field (`error: token expired`), cut to 80 characters, with shorthand-looking text in it kept as text (`##`, `!`, `@`). The code fence is longer than any backtick run in the paste. A capture that is only an image keeps an empty task line (D-45). Pasted images (PNG, JPEG, GIF, WebP) wait with the draft in app data until the capture is saved, then go to `attachments/<date-time>-<task id>.png` with a relative link in the body. The + button under the title points to Ctrl+V for now.
- This is how bugs actually show up, so it is high-value for developers.

- **D-89 (Proposed):** in a task list, code pasted on a selected task whose notes are open inline goes into those notes.
- **D-91:** pasted text is normalised to `\n` line endings first (code copied on Windows pasted nothing into a note's main editor), and a paste always lands: if a code block can't be made, the text goes in as it is. **Proposed:** code on one or two lines is recognised by how it starts (a keyword, a comment) and code-only marks (`=>`, `({`, `});`, `===`…); prose, links, Dataview fields and wikilinks stay text.

### CAP-07 — Capture-selection hotkey (v1)
- A **second global hotkey** (**Ctrl+Shift+X**, D-37) captures the currently selected text in any app (an error in a terminal, a line in a Teams chat) and opens the capture popup **prefilled** with it.
- **D-39:** on a closed popup it starts fresh with the new selection; an earlier draft is set aside and shown as "Previous draft · Restore", so it is never lost (Restore swaps the two). On a popup that is open (also one left open without focus, D-41) the selection is appended to the selection area, to collect from several places.
- **D-45:** a single line (or plain text) selected with nothing typed becomes the task line, editable (its `!`, `##` and `@` stay plain text, never shorthand, also after editing inside it (only what the user types is shorthand)); once something is typed, the selection becomes the body. Code, JSON and stack traces go to the selection area as body.
- **D-43:** the clipboard is restored with every format Electron can read back (all items and types of the async clipboard API); verified with browser/Notepad, Teams chat, a normal terminal and an admin terminal (29 Oct 2026).
- Implementation: simulates Ctrl+C in the foreground app and reads the clipboard (05). **The user's previous clipboard content must be restored afterwards.**
- **Known limitation:** Windows blocks simulated input into elevated (administrator) windows, e.g. an admin PowerShell or terminal, when Flint is not elevated. When the copy fails, open the popup empty with a short hint ("Couldn't read selection from an admin window; paste with Ctrl+V") rather than failing silently.
- **D-68:** when nothing at all was selected, the popup just opens, without a message (the admin-window hint above stays).
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

### CAP-11 — Pickers for priority, list and reminder (v1, D-57)
- The composer's and the capture popup's **flag**, **#** and **bell** buttons open pickers instead of typing `!h`, `##` and `@`:
  - **Priority picker:** High, Medium, Low, None.
  - **List picker:** a search field plus a few recent lists (most recently used first, D-25 matching; an unknown name offers "New list").
  - **Date/time picker:** a proper date and time picker (month grid, time, and a natural-language field reading the same grammar as `@`, REM-02). M4 step 5 (D-64).
- All three pickers have the **same size and visual style** (floating level, 09 §8), are fully **keyboard-accessible** (the buttons are focusable; arrows move, Enter picks, Esc closes back to the text), and insert **the same chip** the shorthand would. The chosen value goes into the title as a live token, so chips, saving and undo behave exactly as with typed shorthand (D-45 live insertion).
- Milestone: M4 for the composer and the capture popup.
- **D-68:** every picker list scrolls (thin scrollbar, UI-02) within a sensible maximum height, so every list can be reached. **Date/time flow, everywhere:** pick a day in the calendar, then a **time-of-day view** with common times and a custom time field, keyboard-friendly, with a back button to the calendar; typed input (`fri 15`) and the presets stay.
- **Built in M4 step 5 (Proposed details):** a picked value replaces the token of its kind already in the text (a second one would stay as text, D-25), and None or the list the text already goes to (the composer's list, Inbox in the popup) removes it. The date/time picker inserts `@YYYY-MM-DD HH:MM` (the chip shows `Tomorrow 10:00`) and offers In 1 hour, Tomorrow morning and Next Monday as presets; only future times can be picked. The list picker is also "Move to…" (TASK-11). In the capture popup the window grows while a picker or menu needs the room.
- **D-69:** the presets are **In 10 minutes**, **In 1 hour** and **Tomorrow 10:00**. Hovering a picker row highlights it only while the mouse is over the picker, as in the menus (UI-08).
- **D-70 (supersedes D-68's time-of-day list):** after a day is picked, a **wheels** time picker (mockup 08): two columns, hours 00–23 and minutes in 5-minute steps, snapping to a highlighted centre band; mouse wheel or drag per column, ↑/↓ and typed digits, Tab between the columns; a **Set · <day, time>** button; back to the calendar via the header (and ←). It starts at the reminder's current time, or the next rounded time for a new one. The typed field above it stays for exact minutes (`14:37`, `3pm`). The same picker in the composer, the popup and "Change reminder…".
  - **Proposed:** Enter anywhere in the wheels sets the time; a current time off the 5-minute grid (14:37) is an extra stop on the minutes wheel, so Set never changes it silently; the next rounded time is the next quarter hour today and 10:00 on another day (REM-02); two digits typed within a second make one value (`1`, `4` → 14); for today, a time that has passed disables Set ("Pick a later time").
  - **D-74:** touchpad scrolling adds up its small pixel deltas (honouring `deltaMode`) and moves one stop per threshold, keeping the rest; a mouse notch stays exactly one stop.
- **D-74 (replaces D-69's highlight rule): the highlight follows the last input used.** When the mouse leaves a picker's rows, no row is highlighted (as in the menus); an arrow key or typing brings the highlight back, starting from the row the mouse was last on. Enter acts on the keyboard's row.
- **D-76 (replaces "Enter acts on the keyboard's row"):** pickers and menus **open with nothing highlighted**. The first arrow key reveals the highlight (on the current value's row where there is one, else the first row), typing in a search field highlights the top match, and **Enter acts only on a visible highlight**. Pressing a picker's button while its picker is open closes it. Pickers open with a short scale and fade from their button; switching from one picker to another morphs the panel (size, place, crossfaded content). **D-77:** opening, closing and switching are smooth and reliable, also from a reminder's picker to the composer's: one panel moves and resizes to its new place while its new content fades in, it always stays within the window, and closing fades it out. **D-78:** pickers and menus (right-click menus too) **stay anchored** to their button or task while the page scrolls, moving with it, and close only when the anchor scrolls out of view. **D-79:** closing always animates, also when the anchor scrolls out of view.
- **D-76, wheels:** each column scrolls **freely and pixel-precisely** (touchpad), settling on the nearest value once the movement, inertia included, has stopped; a mouse-wheel notch moves exactly one value, smoothly. A click on a value (or a digit typed in a column) makes it editable: the first digit shows as `4_`, the second completes it (`47`); any minute 00–59 is allowed (it joins the 5-minute stops); Tab or Enter commits, Esc cancels.

---

## 3. Task-list mode

### TASK-01 — Each line is a separate draggable task (v1)
- In a task list, each task is its own row (like the Microsoft To Do list behaviour).
- Tasks can be **dragged** to reorder, e.g. dragged to the top to focus on them first. The manual order is the source of truth and is persisted (it is the order of lines in the file, 04).
- Drag-and-drop and Alt+↑/↓ follow one rule: only the task's block (line, body, subtasks) moves; non-task content in the file never moves as a side effect (D-22).
- Drag uses snappy spring animations (03).
- **D-80:** the rules below are accepted. While a task is dragged, the sidebar's highlight stays where it is, and **every dragged task keeps its selection highlight**. An expanded task folds its body **with an animation** when lifted and unfolds with one after the drop; a task with subtasks folds them away while dragged and restores them after (supersedes "the selection highlight waits until the drop").
- **Proposed (built in step 8, D-78):** a drag starts after the pointer moves 4 px with the left button held on a row (not on its buttons, a body or while editing). A task moves among the tasks at its own level: a top-level task with its subtasks among the top-level open tasks, a subtask among its parent's subtasks (making or breaking subtasks stays Tab and Shift+Tab). Completed tasks and read-only lists don't drag. The dragged row is raised (`--fl-ground-float`, `--fl-shadow-float`) and the selection highlight waits until the drop; it lands when its leading edge passes another row's middle. The drop is one undoable change ("Moved"). A drag that ends where it started is nothing; the click that ends a drag never starts editing. The task page's subtasks drag the same way.
- **D-54 (M4):** dragging is **locked to the vertical axis and to the list's bounds**: the row never floats freely. Other rows slide out of the way with a smooth spring (≤ 150 ms, off with reduce-motion). An expanded task collapses while it is dragged and re-expands after the drop if it was expanded. Subtasks move with their parent. **D-64:** there is no dragging tasks onto sidebar lists in v1; tasks move with the right-click menu, the list picker, the action bar and Ctrl+K (TASK-11).

### TASK-02 — Fully keyboard-driven (v1)
- **Enter** adds a task (in Edit state; Navigate-state Enter is Q-08), **Alt+↑/↓** reorders, **1 / 2 / 3 / 0** set priority (low / medium / high / none), **Space** completes.
- Full keymap, including the navigate/edit state model that makes these keys safe, is in 03.
- Drag-and-drop works too; the keyboard is faster for power users.
- **D-71 (mouse):** clicking a task's title text edits it directly, with the caret where you clicked; clicking empty row space only selects; double-click anywhere on the row edits; Esc goes back to the selected row (03 §2). **D-74:** clicking another task's text goes straight into editing on that row, without the selection gliding there first; the row being edited looks like a dark input field (09 §8), clearly different from a selected row. **D-76:** a second single click on an already-selected row (not on its text) also edits, like renaming in Explorer; the field eases in when editing starts and glides when editing moves to another row. **D-78:** while a task is being edited, a click on another task's blank space saves the edit and selects that task.

- **D-87:** ↑/↓ keep the selected row in view (smooth, instant under reduce-motion). Impossible moves (indenting the first task or a first subtask, outdenting a top-level task, Alt+↑ on the first, Alt+↓ on the last) nudge the row briefly in that direction (off with reduce-motion).
- **D-89 (supersedes D-71's click-to-edit):** a single click always selects, the title's text included; a double-click or a second click on the selected row edits, the caret where it landed. A link in a title opens with a click on a selected row or with Ctrl+click. Held ↑/↓ keep the selection in view without smooth scrolling; the menu's impossible Indent/Outdent nudges the row.
### TASK-03 — Priority: low / medium / high, shown by color, not text (v1)
- Each task can have priority **low, medium, high**, or **none**.
- **"No priority" is the default** and is visually neutral. If every task were colored, nothing would stand out.
- Priority is shown with a **thin left-edge stripe**, not by tinting the whole row, which keeps the UI calm.
- Because color-only priority is an accessibility problem (red/amber/green is exactly the combination roughly 8% of men cannot reliably tell apart), the stripe is paired with a **second subtle cue** (stripe thickness). **Decided (D-17):** priority uses lightness and thickness only, never hue (High = 4 px white, Medium = 3 px accent, Low = 2 px dim gray), so it is color-blind-safe by default and no separate color-blind palette option is needed in v1. Spec in 09 §4.
- No priority text label is added to the row. Visual spec in 03.

### TASK-04 — One level of subtasks, max (v1)
- **D-76:** "Add subtask" in a task's right-click menu and on the task's page opens a new row under the task's last subtask.
- **Tab** indents a task once, making it a subtask of the task above. **Shift+Tab** outdents.
- Only one level is allowed; unlimited nesting is where simplicity dies.
- **Proposed:** subtasks move with their parent when dragged or moved to another list; completing a parent completes its open subtasks (undoable).
- **D-28, confirmed by D-29:** completed subtasks stay under their parent (only top-level tasks move to the Completed section). Tab on a task that has subtasks does nothing. An outdented subtask moves to just after its parent's group, so the remaining subtasks keep their parent.
- **D-29:** un-checking a subtask whose parent is completed reopens the parent too (it returns to the active tasks like any un-checked task, TASK-06).

### TASK-05 — Expandable task body (v1)
- Any one-line task can be expanded into a **markdown body** (for a stack trace, notes, screenshots).
- Collapsed, the row shows only a **small indicator** that a body exists. The list stays clean without forcing a separate note.
- The body supports the same editor features as note mode (live preview, code blocks, media). **D-49:** in M4 the body is shown rendered (markdown, highlighted code blocks, images) and edited in a plain monospace field; M5 replaces the field with the note editor.
- A checklist line (`- [ ]`) in a top-level task's body is a subtask (04 §3, D-29): typing `- [ ]` in a body visibly turns that line into a subtask.
- **D-78, adding a body quickly:** **Shift+Enter** in the main composer opens a notes field under it, as in the capture popup (the text becomes the new task's body); Shift+Enter while editing a task's title opens and focuses that task's body. "Add notes" in the task's right-click menu does the same. The composer's hint mentions "Shift+Enter for notes". **D-79:** the composer's notes field is never clipped, and pasting into the composer follows the capture popup's rules (CAP-06): code, JSON and stack traces go into its notes fenced, images are saved to `attachments/` and linked there.
- **D-53 (M4):** today a row shows the "has a body" icon but can't be expanded. The rule:
  - A **small body** (up to roughly **8 rendered lines**, measured by its rendered height, images included) **expands inline** under the row with an expand control (the chevron, or → / ←).
  - A **larger body opens as a full page**; for it, the page is the only way to read it.
  - **"Open as page"** is available for every task (right-click menu, and **Shift+Enter** in Navigate state, **Proposed**).
  - In v1 the **page replaces the list view** with a **back arrow** (no tabs, NAV-05). Back also works with the mouse's back button and Alt+← (NAV-04). The page shows the editable title and the body, rendered, with D-49's plain editing until M5.
- **D-80 (supersedes D-79's "body icon when the body has text"):** the **body icon shows whenever the task has any body content**, images only included; the **image icon additionally** shows when there are images. The body icon expands the task, with its text and image thumbnails; a thumbnail or the image icon opens the lightbox. **Code cards and images in a body** get a small **trash button** in their corner (on hover or when the task is selected), in the list and on the task's page: the part folds away and an undo toast shows ("Removed code block" / "Removed image"), no confirmation. Deleting an image removes only its link; the file stays in `attachments/` until MEDIA-04 (M7). In the **composer**, a pasted image is a thumbnail chip and pasted code, JSON or a stack trace a code card preview (language label, code background, first 4 lines with an expand chevron, × to remove; not editable, as in the popup); on Enter the body is the notes, then the code fenced, then the image links.
- **D-79:** a long body's clickable preview takes a much subtler hover that matches the card. A code card's label shows the detected language (`yaml`, `json`, `stack trace`…), not "code". The row's indicators: the body icon when the body has text, the image icon when it has images, both when both. Images in an expanded body show as small **thumbnails** (full size on the task's page); a click on a thumbnail or the image icon opens the **lightbox** (pulled from M5 into M4: a smooth popup, ←/→ through that task's images only, Esc closes).
- **D-78 (mockup 09, `design/mockups/09-expanded-task.html`):** while a task is expanded it is **always** a raised card (the selected-row surface, edge ring, top highlight and soft shadow), not only when selected or hovered; the **priority stripe spans the card's full height**; the body (13.5 / 1.6, secondary tone) and its code cards sit inside it, 32 px in from the title row. Collapsing a task while another is selected doesn't replay the selection's move on top of it.
- **D-77 (supersedes D-76's well): an expanded task is one raised card** holding its title row and its body, as in mockup 01's first task: the body in the secondary text tone, code and stack traces in their own small code card with a label and a copy button. A short body is edited in place; a **long body is not editable inline**: its preview is clickable (a soft hover highlight) and opens the task's page, and "Open as page" stays visible. On the page, the title's edit field has the same inner spacing as the body's.
- **D-76 (0.4.8 feedback, supersedes "a larger body opens as a full page"):** the indicator (or →, or a click on an untitled code row) always opens the body **inline**, in a subtle well aligned with the title. A body longer than about 8 rendered lines shows only its top lines, fading out, with an **"Open as page"** control; ← or the indicator closes it. Single line breaks stay line breaks (as in Obsidian) in bodies and pages, and in notes once they render (M5). JSON, code and stack traces pasted into a body field are fenced and highlighted, as in the capture popup (CAP-06). Until the M5 editor, the plain field uses the rendered text's place, padding and type, so starting to edit doesn't shift anything (supersedes D-49's monospace field); image paste and live markdown come with M5.
- **D-76, the task page:** the title is white, weight 600, about 27 px; the back arrow lines up with its first line; editing the title keeps it wrapped in the same type (Enter saves; the title stays one line in the file). The page lists the task's **subtasks**, with **"Add subtask"**. "Add subtask" is also in the task's right-click menu.
- **Built in M4 step 6 (1 Nov 2026, Proposed details):** the body indicator is a button on every task with a body, completed ones included; ← or the indicator closes an inline body. A click on a rendered body (not on a link, not while selecting text) turns it into the plain monospace field; Esc or leaving the field saves, Enter is a new line. On the page, a click on the title edits it, an empty body offers "Add notes, code or links", and Esc goes back to the list with the task selected. Code blocks are highlighted like the popup (JSON and stack traces, UI-06); images load from the Flint folder only (05 §3, `app://media`); other images show their text.

- **D-86:** a task opened as a page has the note's card around its title and body (NOTE-01, D-85); its subtasks keep their own card below.
- **D-87:** every body editor (inline, a task's page, the context panel) saves as it is typed (debounced) and when left or closed, never discarding text. A task's page shows its notes exactly like a note's body (no inner card). On the page, pasting code, JSON or a stack trace (CAP-06) adds it as a code block to the selected subtask's notes, or with none selected to the task's own notes; one undo step. Code cards in inline bodies are never cut off, and a highlighted subtask's card never overlaps its highlighted parent's.
### TASK-06 — Completion, undo toast, completed section, auto-archive (v1)
- Completing a task plays a small, satisfying completion animation and shows an **undo toast** instead of a confirmation dialog.
- Completed tasks move to a **Completed section in the same list**; they do not disappear.
- The Completed section is **collapsible** and shows a **count**, e.g. "Completed · 14".
- Each completed task stores a **completion timestamp**.
- Un-checking a completed task returns it to the active tasks (**Proposed:** to its previous position if still valid, i.e. after the task that preceded it when it was completed, remembered in `.flint/meta.json`; otherwise the bottom).
- **D-69:** undoing a completion (Ctrl+Z or the toast's Undo) plays the same un-complete animation as un-checking (D-67).
- **Auto-archive:** Flint offers to auto-archive completed tasks older than **N days** (N configurable) so the Completed section doesn't grow forever. Archived tasks remain on disk (04) and remain searchable via Ctrl+K (**Proposed**).

- **The auto-archive offer built (0.4.22, D-88, Q-13):** off by default; a Completed section of 50+ offers it ("Turn on · Not now", Not now remembered per list on this machine); on, tasks completed more than 14 days ago move to `.flint/archive/<list ID>.md` at once, at start-up and at each day change (not undoable). Off and the days in Settings (M8).
### TASK-07 — Multi-select and bulk actions (v1)
- **Shift+↑/↓** (and Shift+click / Ctrl+click with the mouse) selects multiple tasks.
- Bulk actions: set priority, move to another list, complete, star to Today (and delete, undoable).
- **D-59 (M4):** with **2+ tasks selected**, a **floating action bar** appears at the bottom of the list: the count, **Select all**, **Move**, **Priority**, **Star** (once Today exists, M6) and **Delete**, plus a clear (×). There is **no separate "edit mode"** and **no extra checkboxes** on rows (they would clash with the completion checkbox): selection looks like the single selected row. **Ctrl+A** in Navigate state selects the visible **open** tasks, never completed ones (D-77), so Ctrl+A then Delete can't wipe Completed. Esc clears the selection.
- **Built in M4 step 7 (1 Nov 2026, Proposed details):** Shift+↑/↓ and Shift+click mark a range from the anchor (the last row clicked or moved to), Ctrl+click adds or removes one row; Ctrl+A marks every visible open task (D-77); Esc clears the marks first, then the selection. With marks, Space, 1/2/3/0 and Delete act on all of them, and a marked row's right-click menu offers the same for all; each bulk action is **one undo step**. Priority and Complete skip what they don't apply to (priority only on open tasks; Complete completes the open ones, or reopens all if none is open). Move with a new list name creates it once and moves them all there. The bar sits at the bottom centre of the window; Star joins it in M6. **D-77:** marked rows next to each other form one continuous rounded highlight; a mark on its own keeps its own. **D-78:** a marked task with a body (an expanded card) keeps the spacing used around subtasks, so its highlight never overlaps the task above. **D-79:** the vertical rhythm is identical above and below an expanded or marked task with a body and between normal tasks: the card's outline adds no space. Opening another list (Inbox included) clears the marks. Sidebar marks have no action bar; their right-click menu covers lists and notes.

- **D-86, right-click like Windows Explorer:** right-clicking inside a multi-selection keeps it and the menu acts on all of it, saying so (a "3 selected" header, "Unpin 3 tasks"); right-clicking outside it selects just that task (or sidebar list) and acts on it alone. Marks stay after an action-bar action.
### TASK-08 — Temporary "sort by priority" (v1)
- A one-off action that sorts the visible tasks by priority (high → none) **without destroying the manual order**.
- Manual (drag) order stays the source of truth: the temporary sort is a view; leaving it, or reordering manually, returns to manual order. **Proposed:** a clear "Sorted by priority · Back to manual order" indicator while active.
- **D-72:** the temporary sort offers **Priority**, **Reminder time** and **Date added**. **Proposed:** tasks without a reminder sort last; Date added uses `created` from `.flint/meta.json` (04), file order where it is missing; the indicator names the sort ("Sorted by reminder time · Back to manual order"). Milestone M4 step 10.

- **Built (0.4.22, D-88, Proposed details):** in a list's right-click menu and the page's blank-area menu; headings and text left out while sorted, subtasks under their parents; missing reminders and dates last, date added newest first; Alt+↑/↓ while sorted returns to the manual order; nothing drags while sorted; another list ends the sort.
- **D-89:** rows glide to their new places when a sort starts or ends; the sort's line eases in and out.
### TASK-09 — Multi-line paste creates multiple tasks (v1)
- Pasting N lines of plain text into a task list creates N tasks, with a toast offering **"Keep as one?"** (which merges them back into a single task with the text as its body). Great for dumping meeting action items.
- **Proposed:** if the pasted text is detected as a stack trace, code, or JSON (CAP-06 rules), it is treated as one task with a code-block body instead of being split.

- **Built (0.4.22, D-88, Proposed details):** below the selected task or at the top; list markers and checkboxes dropped, shorthand kept as text; one undo step; the toast has **Keep as one** (first line the title, the rest the notes) and Undo; code is one untitled task with a code block (D-45).
### TASK-10 — Smart link titles (v1)
- Pasted URLs are displayed with short, meaningful titles; the full URL is kept in the file.
- Example: `https://dev.azure.com/.../pullrequest/42` displays as **"PR 42"**.
- **Proposed** built-in recognizers: Azure DevOps pull requests and work items, GitHub pull requests and issues. Other URLs display as domain + shortened path.
- **D-84:** a pasted URL that matches one of the user's link patterns (NOTE-07) displays as that pattern's short form (`AB#1234`); the full URL stays in the file.
- **Long URLs never wrap rows**; they truncate with an ellipsis.
- Applies in task titles, task bodies, and notes.

- **Built (0.4.22, D-88, Proposed details):** the user's pattern, else the presets as built-in recognizers (`PR 42`, `AB#1234`, `repo#12`, `repo!9`, `KEY-5`), else domain and shortened path (about 40 characters); the URL is the link's tooltip; long links end in an ellipsis in rows.
### TASK-11 — Move tasks between lists (v1)
- Any task (or a multi-selection) can be moved to another list via a fuzzy list picker, the context menu, the command palette, or the multi-select action bar. **D-64:** not by dragging onto a sidebar list (the drag is locked to the list, D-54).
- This is the core action for sorting Inbox later. A dedicated single-key binding is **not decided** (see Q-06).
- **D-29:** a moved task lands at the top of the target list (like a capture), with its subtasks; a subtask moved on its own becomes a top-level task there. Several tasks moved together (TASK-07) land at the top in their original relative order. Its lines take on the target file's line endings.
- Moving uses the list picker of CAP-11. Milestone M4.

### TASK-12 — Delete tasks (v1)
- Deleting a task sends it to Trash (DATA-02) with an undo toast. No confirmation dialog.
- **D-50:** from M4 a deleted task is moved to the Flint folder's `trash/` with its deletion time, so nothing is destroyed; the Trash screen for browsing and restoring comes with DATA-02 in M7.
- **D-80:** deleting an expanded task first collapses its body, then plays the delete animation.

### TASK-15 — Non-task content shown read-only (v1, D-22)
- A task-list file can contain content that isn't a task: headings, paragraphs and plain bullets added in Obsidian or VS Code, or kept from a note → task-list conversion (LIST-04).
- It stays exactly where it is in the file and is **shown read-only**: headings as quiet section labels, other text as muted markdown. It is not selectable in Navigate state. To edit it, convert the list to a note or use another editor.
- There is no UI for creating or collapsing sections: Flint shows what's in the file, it does not grow a sections feature.

### TASK-16 — Duplicate a task (v1, D-72)
- "Duplicate" in a task's right-click menu.
- **D-74:** the copy has the title, body and priority, but **not the reminder** (a duplicate must not fire the same reminder twice). **Proposed:** it appears right below the original, open, with a new ID (subtasks copied with new IDs), and is selected; offered for open tasks. Undoable. Built in M4 step 7.

### TASK-17 — Convert a task to a note (v1, D-85)
- "Convert to note" in a task's right-click menu creates a note in the sidebar from the task: the title becomes the note's name (its title on the note card), the body its content, the subtasks a checklist (`- [ ]` / `- [x]`, their bodies indented under them). The task leaves its list. One undo step restores both (and removes the note while it is unchanged); a toast offers Undo.
- **D-86:** afterwards the note opens with the cursor at the end of its text, ready to type (also after converting a whole task list, LIST-04).
- **Proposed (built in 0.4.19):** the name is the title's plain text, without what Windows can't have in a file name, up to 80 characters ("Note" when nothing is left), with a number added when the name is taken; the task's priority, reminder and IDs are not carried over (a note's fields are inert, LIST-04); a task with subtasks converts as a whole, a subtask converts on its own. The note is written before the task leaves its list, so a crash in between leaves a copy, never a loss.

### TASK-18 — Give to Claude (1.3.0, D-151)
- Hands one task to **Claude Code in the Claude desktop app** through its documented link, `claude://code/new?q=<prompt>&folder=<absolute path>` (both URL-encoded). Claude opens with the prompt in its composer, not sent, and asks to confirm the folder. Flint only hands the link to Windows (`shell.openExternal`); it never runs a command or a program, and opens no other kind of link this way.
- **Where:** the task's right-click menu, the palette ("Give to Claude"), the side panel's task details and **G** in Navigate state; in task lists, Today and the task's page. One task at a time (not with several marked); completed tasks too. Not in mini mode, Inbox triage, the capture popup or a note's checkbox rows.
- **The card:** a palette-style card ("Give to Claude · <title>"): the list's default folder first, then up to five recent folders, then **Choose a folder…** (Windows' folder picker, Ctrl+O). ↑/↓ and Enter give the task to that folder, **Shift+Enter** also makes it the list's default, Esc closes. A folder that no longer exists is dimmed ("Not found") and can't be chosen. Footer: `1,240 / 14,336 characters · about 310 tokens`. The prompt isn't edited in Flint: Claude's composer is the place.
- **The prompt:** the title as a `# heading` (an untitled task's shown label, D-45), the notes as they are, then `## Subtasks` with each subtask's done state and its notes indented under it; fields (`id`, priority, reminder, pinned) stripped; links to the Flint folder's attachments made absolute, so Claude can open them. No preamble. A subtask gives itself, with a last line `Part of: <parent title>`.
- **Limits (measured, D-151):** Claude keeps the first 14,336 characters of `q`; Windows hands a link of up to about 32,000 encoded characters to Claude (Flint's budget: 30,000). A prompt over either limit goes to the **clipboard** instead, said in the footer before giving (`Too long for a link (18,900 characters): Flint copies it, paste it into Claude with Ctrl+V`); Claude then opens with a one-line note to paste.
- **The token estimate** is rough and local: about 4 characters a token for Latin script and code, about 1 for other scripts, rounded to two significant figures.
- **Folders (machine-local, not in the file format):** `claudeFolders` (the default per list, by the list's `id`, or its file name without a Flint header) and `claudeRecentFolders` (five, newest first) in `settings.json`. Set from the list's right-click menu (**Claude folder ›** Choose… / Forget), Shift+Enter in the card, and **Settings → Claude** (each list's folder with Change… and Forget; Clear recent folders). Palette: Give to Claude, Set Claude folder for this list…, Forget Claude folder for this list.
- **After giving:** the card closes and a toast says "Given to Claude · <folder name>" (or "Copied, paste it into Claude"). The task doesn't change.
- **Claude not installed** (no `claude://` handler, or Windows refuses the link): a toast says so, with **Download** opening claude.com/download in the browser.
- **Privacy (APP-09):** Flint makes no network request for this; the task's text leaves the machine only if you send it from Claude.
- **Built (1.3.0), with these details Proposed:** the card's rows show the folder's name, its path (mono, faint) and a tag ("Unicorn's folder", "Recent", "Not found"); its head reads "Give to Claude ›" and the task's title; Ctrl+O is Choose a folder… (Ctrl+Shift+O also makes it the list's); the menu entry sits after Duplicate; the list's Claude folder › follows its sorting and grouping (Inbox's, its Duplicate); Settings → Claude comes after Clipboard, lists only the lists with a folder (else a line saying where to choose one), and Clear recent folders shows when there are any; the side panel's button is a code-prompt icon (no brand mark) left of Open as page; the toasts: "Given to Claude · acme-web", "Copied: paste it into Claude with Ctrl+V", "Claude isn't installed, or Windows couldn't open it" with Download, "<folder> no longer exists"; a folder chosen from the list's menu or the palette says "Unicorn gives to Claude in acme-web". A failed link leaves the clipboard and the recent folders as they were.

### TASK-13 — Stale-task fading (Later)
- Inbox tasks untouched for 14+ days become slightly dimmer: a gentle nudge without adding UI.
- Requires a per-task "last touched" timestamp, which **v1 must already record** (04) so this can ship without a migration.

### TASK-14 — Triage mode for Inbox (v1, D-113; was Later)
- Steps through Inbox tasks one at a time: pick a list, priority, pin (TODAY-01), or delete, all by keyboard.
- Turns "sorted later, or never" into a 2-minute ritual.
- **D-113 (decided):** a mode in the main column, one large card at a time (the task, its notes, when it was captured), "3 of 18" and a progress line; started from Inbox's "Triage · N" button, Today's "Sort Inbox · N", the palette and T in Inbox. Oldest first. M move, Space done, Delete delete advance; 3/2/1/0 priority, P pin, R reminder stay on the card; → or Enter keep and go on, ← back, Ctrl+Z undo, Esc leave. A summary at the end. Not in mini mode in v1. Milestone M8 (step 4a).
- **Built (0.8.12):** as decided; the Proposed details of D-113 as built (top-level tasks, oldest by when Flint first saw it then from the bottom of the file, E edits the title, the slide between cards); the summary counts each task once, by what happened to it last.
- **D-114 (0.8.13):** the place is kept for the session, with **Start over**; the progress line goes to a task (hover shows "7 of 18", a click goes there); a click on the notes shows the whole task (unfolded on the card on a narrow window); the card's height eases; in and out as a page.
- **D-115 (0.8.14):** started from the quiet "Triage · N" under Inbox's title again (D-114's pill reverted). On a wide window the side panel shows Up next until the notes are clicked, that task while its card is shown, and Up next again with every other card and after a click elsewhere.

---

## 4. Today

### TODAY-01 — Pinned tasks and the Today view (v1, D-85)
- **D-122 (0.8.17):** an open task's row shows a faint pin on hover where a pinned task's pin is; a click pins it (the pin settles in with a pop). Main-window rows; mini keeps P and the menu.
- **D-86:** a click on a pin (on a row, in Up next, the panel's Pin chip) unpins the task.
- **D-85: pinning replaces "star to Today"**, one concept instead of two. A task is **pinned** from any list: right-click **Pin** / **Unpin**, or **P** in Navigate state (and the multi-select bar's Pin). A pinned row shows a small pin indicator. Pinned tasks show in the context panel's **Pinned** section (NAV-07) whichever list is open (built with D-85), and in M6 they are the **Today** view.
- Written `[pinned:: true]` (04 §3); `[today:: true]` from older files is read as a pin.
- **D-85, done pins:** a completed pinned task stays pinned (faded) for the rest of the day; at the day change its pin is removed, whether or not the rollover prompt is on. **D-107:** the day change is acted on at midnight itself (and on waking from sleep): the open Today shows the new day's rollover card and reminders at once.
- Today holds **references, not copies**: completing, editing, or changing priority of a task in Today changes it in its home list, and vice versa.
- Each task in Today shows its home list subtly. **Proposed:** Today has its own manual order (drag to reorder) independent of home-list order.

- **Built (0.4.24, D-90):** Today is first in the sidebar and the window opens on it: a greeting, the rollover card, today's reminder cards, a composer that adds pinned tasks to Inbox, and Focus, the pinned tasks of every list as ordinary rows with their home list as a chip; every change goes to the home list. **Proposed:** its own order (Alt+↑/↓, drag) in `.flint/today.json`, Flint's new pins on top, pins found in files at the end; a pinned subtask on its own row unless its parent is pinned; done pins in Today's Completed section until the day changes.
- **D-93 (0.4.27):** a click on a task in Focus shows its details in the Today column (the editable panel, replacing the Timeline); Esc, the panel's back arrow or a click on empty space return to Today's sections. Done today and Captured today always show ("· 0" and a quiet line when empty); "Sort Inbox · N" is the primary button; the list chip on a row lights up on hover and opens that list with the task selected.
- **D-92 (mockup 12, 0.4.26):** Focus has "Focus · pinned" (done pins stay, faded, "done 11:20", until the day changes; no Completed section in Today) and below it "High priority · not pinned": open high-priority tasks that aren't pinned, as full rows in the sidebar's list order, the first five and "Show all N"; only pinned tasks reorder; P pins one. The greeting puts the count in white and has a progress line, "X of Y done" (today's pinned and reminder tasks). The composer reads "Add a task to today…". On wide screens a Today column takes the context panel's place: Timeline, Done today, Captured today (with "Sort Inbox · N"); Shift+Enter or the notes icon shows a task's details there instead, back or Esc returns. On narrow windows the sections stack under Focus and fold.

### TODAY-02 — End-of-day rollover prompt (v1, optional)
- At the end of the day, Flint can optionally prompt: **"Roll over unfinished pinned tasks?"** (D-85): keep the unfinished pinned tasks pinned for tomorrow, or unpin them (they stay in their home lists).
- The prompt is on by default and can be turned off in Settings. When and how the prompt appears is open question Q-04.

- **Built (0.4.24, D-90, Q-04):** on the first open of Today on a new day, "Unfinished from yesterday" with **Clear** (unpins them, one undo step) and **Roll over**; × is Roll over. Turning it off comes with Settings (M8). **D-100 (0.4.34):** Settings → Today & lists → "Ask about unfinished pins".
- **D-92:** the card stays on every open that day until Roll over, Clear or × is chosen.

### TODAY-03 — Reminders section in Today (v1)
- Today includes a **Reminders** section listing tasks with upcoming reminders (see REM-08), so users can see what's scheduled without opening each task.

---

- **First part built (0.4.24, D-90, Proposed):** the reminders still to come today as cards, two a row (time, "in 2 h", title, list), as in mockup 03; overdue ones and the full section (REM-11) come with the rest of M6.
- **D-92:** the cards follow the clock (a passed reminder's card folds away, the countdowns tick); the next one is wider and brighter with "Next", later ones quieter; three a row, more behind "+N more" (**Proposed**). The Today column's Timeline shows all of today's reminders on an hour rail with a moving now line.
- **D-94:** overdue reminders are the Overdue card under the rollover card (REM-07, REM-11).
- **D-93:** dragging a reminder up or down on the Timeline changes its time (quarter hours, 5 minutes with Alt), shown live; it slides into place, or back when dropped in the past; one undo step. The keyboard way is Change reminder….

## 5. Reminders

### REM-01 — A reminder on any task (v1)
- Every task can have a reminder: press a button (or key), configure the time, done.
- When due, Flint shows a **Windows notification** and/or **plays a sound** (configurable, REM-06) so the user remembers the task.
- One reminder per task (**Proposed**). No recurring reminders (Non-goals).
- **D-68 (pulled into M4):** clicking a task's reminder time opens the date/time picker for that task (CAP-11), also for a reminder that already fired; the bell next to it stays the off/on toggle (REM-12). The task's right-click menu has "Change reminder…", and "Set reminder…" for a task without one (**Proposed**).
- **D-69:** when the time changes, the old text crossfades into the new (its width eases along) instead of jumping (D-67's state band).
- **D-94 (0.4.28):** **R** sets or changes the selected task's reminder in any list and in Today (the picker opens at the task); the menu's Set… / Change… shows R.

### REM-02 — Natural-language times (v1)
- Accepted in both the reminder picker and the capture box.
- Must support at least: `in 20m`, `at 15:00`, `tomorrow 10`, `fri` (plus equivalents like `20m`, `2h`, `15:00`, weekday names).
- The resolved absolute time is always shown before confirming (picker preview / capture chip).
- Default time when only a day is given (`tomorrow`, `fri`, `3d`): **10:00** (D-69, supersedes Q-02's 09:00), the same as the "Tomorrow 10:00" preset.
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
- **D-94:** the picker's In 10 minutes, In 1 hour and Tomorrow 10:00; the Overdue card's Snooze ▸ has In 1 hour, Tomorrow 10:00 and Pick a time….

### REM-05 — Actionable notifications (v1)
- The toast has three buttons: **Done**, **Snooze 10m**, **Open**.
  - **Done** completes the task (in its home list).
  - **Snooze 10m** re-schedules the reminder 10 minutes later.
  - **Open** shows the main window with the task selected.
- Clicking the toast body behaves like **Open**.
- Buttons must work while the toast is on screen and from Action Center. Implementation notes in 05.
- **D-64 (Davit, 31 Oct 2026):** pulled forward to **M4 step 3**, the first item: reminders fire as this toast while Flint runs; a reminder missed while Flint wasn't running or the PC slept is shown once at the next start (or wake) as a toast labelled "Missed". **Proposed:** more than 3 missed at once show as one toast, "N reminders you missed", whose Open shows the main window; the full REM-07 list comes in M6. A shown reminder is remembered in `reminders-state.json` (04 §2), so it is never shown twice.
- **D-68:** the toast says **"Reminder"** (or "Missed reminder") and the task name, with Done / Snooze 10m / Open: no time, no list name, no large logo image (the small app icon in its header stays).
- **D-91:** Open goes to the task's list, scrolls it into view, selects it (the panel shows it on wide screens; on narrow windows the body stays closed) and flashes it once.
- **D-93:** all of it at once (an instant scroll, never a long smooth one), also when the task is already selected; the flash plays where the row landed.

### REM-06 — Sound option and Focus Assist (v1)
- Settings: notification on/off, sound on/off (and choice of a short sound).
- **D-98 (for M8):** "Reminder sound: Windows sound (default) / Flint chime"; the chime makes the toast silent, so one sound plays; an info card explains why one would choose it and what changes. **Built (0.4.34, D-100).**
- **D-94 (0.4.28):** Flint's own sound is a short soft chime made for Flint, **off by default** (the reminder toast already plays Windows' sound); until Settings (M8) it is `reminderSound: true` in `settings.json`. The in-app alert comes with mini mode (M8).
- **D-95:** the chime is **"Nudge"**: two soft rounded taps on one pitch, about half a second (`apps/desktop/scripts/make-chime.mjs`). Drop and Mallet, the runners-up, are candidates for the choice of sounds in Settings.
- **D-96:** the bundled `sounds/chime.wav` is Davit's file and the source of truth; `make-chime.mjs` is a one-off tool that never runs in the build or the tests and refuses to write over it, and a test checks the file's hash.
- Windows **Focus Assist / Do Not Disturb silently suppresses ordinary toasts**, and people often enable it during exactly the calls where they capture tasks.
- **Decided (D-35, verified 29 Oct 2026, docs/06 §1):** reminder toasts use Windows' reminder scenario (`scenario="reminder"`): they stay on screen until acted on, and with Windows' default priority settings ("reminders" allowed) they still appear during Do Not Disturb, where an ordinary toast is suppressed. Flint's own sound and in-app alert remain for users who turn that setting off. Flint must make this visible: an option to play Flint's own sound and/or show an in-app alert (e.g. in mini mode) when a reminder fires, and a note in settings explaining Focus Assist.

### REM-07 — Missed-reminder recovery (v1)
- If the app was closed or the PC was asleep when a reminder was due, Flint shows **"N reminders you missed"** on next launch / wake, listing them with the same actions (Done / Snooze / Open).
- Silent misses destroy trust in reminders faster than anything else.
- **D-94 (0.4.28):** the list is Today's **Overdue** card (below the rollover card, quieter, folding, "Overdue · 3", its state remembered): every open task whose reminder has passed, missed or not, oldest first, each with Done, Snooze ▸ and a click that opens the task; a row leaves when done, snoozed or turned off. The "N reminders you missed" toast's Open shows Today with the card open.

### REM-08 — Bell indicator (v1)
- Tasks with a reminder show a small **bell** indicator on the row (and the time on hover/selection). Combined with TODAY-03, users can see what's scheduled without opening each task.

### REM-09 — Reminders require Flint to be running (v1)
- Flint runs in the system tray and starts with Windows (APP-01), otherwise reminders cannot fire. Users are told this during onboarding and in settings.

### REM-10 — Hide task text in notifications (v1, D-35)
- Setting **"Hide task text in notifications"**, default **off**. When on, a reminder toast says only **"Flint reminder"**: no task title, list or time, so nothing leaks while the screen is shared (reminder toasts show even during Do Not Disturb, REM-06). It applies to the toast and to its copy in Action Center.
- **Proposed:** the Done / Snooze 10m / Open buttons stay (they reveal nothing); Open shows the task in Flint. Until the settings screen exists (M8) the setting is `hideNotificationText` in `settings.json`.

### REM-11 — Overdue reminders (v1, D-58)
- An open task whose reminder is in the past is **overdue**: noticeable but not alarming.
- **D-68 (replaces D-58's label):** no "Overdue" word. The bell stays, with a **small white dot** on it. **D-69:** the time is **not** highlighted: it keeps the bell's tone. **No red** and no warm colours (brand), **no badges** or counts. Visual spec in 09 §8.
- The label turns overdue on its own when the time passes (the view checks every minute, **Proposed**).
- **Completing** the task or **snoozing** the reminder clears it. Completed tasks are never overdue.
- In Today, overdue items sit at the **top of the Reminders section** (TODAY-03). **D-94:** as the Overdue card, under the rollover card and above the reminder cards (REM-07).
- Milestones: the row display in M4; the Today grouping and snooze presets in M6. Reminders fire as notifications from M4 step 3 (D-64, REM-05).
- A reminder turned off (REM-12) is never overdue.

### REM-12 — Turn a reminder off without deleting it (v1, D-66)
- **Clicking the bell** on a task turns its reminder **off**: the time stays, but it won't fire. A quick animation draws a **strike line** through the bell, and the time turns faint. Clicking again turns it back **on**; a time that has already passed then shows as overdue (REM-11). Undoable. Also in the task's right-click menu (**Proposed**: "Turn reminder off" / "Turn reminder on").
- Stored as the field `[muted:: true]` next to the reminder (04 §3). Setting a new reminder time (snooze, the picker, an edit with `@`) turns the reminder back on (**Proposed**).
- A reminder whose time passes while it is off is not shown later when it is turned back on: turning it on doesn't pop a notification for a time that is already past (**Proposed**).
- Milestone M4 step 5.
- **D-68 (0.4.4 feedback):** the bell **always stays in place**. Turning a reminder off strikes the bell and fades the time; turning it on removes the strike just as smoothly (both ~250–300 ms, D-67); nothing else moves.

---

## 6. Note mode

### NOTE-01 — Free-form markdown with Obsidian-style live preview (v1)
- A note is a free-form text document, like an Obsidian note.
- **Live preview** (formatting renders inline as you type, markdown syntax revealed near the cursor), **not** a split editor/preview pane.
- **D-141, D-142 (built in 1.1.0; supersedes the line-based reveal described under "Built" below):** the live preview is rebuilt on CodeMirror's syntax tree. **Block markers** (bullet, checkbox, number, heading, quote, task-field chips) and **embedded objects** (image, video, file link) stay rendered also with the caret right before or after them, and show raw only while the caret is strictly inside them; **inline formatting** (bold, italic, code, highlight, strikethrough, links) shows raw while the caret is inside the span or at its edge. ← / → step into a marker deliberately; clicks and selections never reveal. A list's number is plain text in the note's font, the same with the caret on its line or not (D-142). Right before or after a drawn picture Flint draws a single caret where the cursor is, the size of the text caret (D-142). A checked item's text is dimmed and struck through (D-142; completed tasks in task lists are only dimmed). A picture's (and every embedded object's) right-click menu gets **Edit markdown**, revealing its raw link with the caret inside. Numbered lists behave as in 1.0.1 (D-142 reverted grill Q4, Q6 and Q7; 04 §4). The checkbox is the task row's shared checkbox in its compact size (17 px) with the row's own 12 px tick, centred (grill Q8, D-142).
- **Built (M5 editor, first step, 2 Nov 2026; Proposed details):** CodeMirror 6 (`apps/desktop/src/renderer/editor/`), the markdown text the source of truth and everything else decoration. On the cursor's lines the raw markdown shows, its marks faint in mono (mockup 04); elsewhere, and everywhere while the editor has no focus, the marks are hidden: headings, bold, italic, strikethrough, `==highlight==`, inline code, links (a click opens them), quotes, rules, rounded-square bullets, checkboxes (a click toggles them), fenced code as a code card with its language label and the grayscale highlighting for JavaScript, TypeScript, JSON, CSS, Python, SQL and YAML (UI-06), images inline (a click opens the lightbox), and Flint's task fields as small muted chips (`high`, `30 Oct 15:00`, `Today`), `id` hidden (LIST-04, D-77). Enter continues lists, Tab / Shift+Tab indent, brackets and quotes close (UI-09), pasting follows CAP-06 (code fenced, images saved to `attachments/`), and the right-click menu is the text-field menu until NOTE-02. Used for notes, and for a task's body while it is edited, inline and on its page (it replaces M4's plain fields; the rendered body with its code cards, copy and trash buttons shows when not editing). **Second step (2 Nov 2026, D-82):** NOTE-02's right-click menu, NOTE-03's slash commands, the code card's copy button inside the editor (NOTE-05), Ctrl+B / Ctrl+I, Ctrl+Shift+V for Paste as plain text (**Proposed**), Insert ▸ Image through the file picker. **Third step, the editor work complete (2 Nov 2026, D-84):** highlighting for every language CodeMirror's language data knows, in the editor and in rendered bodies (each loaded when a block uses it); find in notes (NAV-06); Monospace per note (NOTE-06); link patterns (NOTE-07, the engine; its editor comes with Settings, M8); videos, files dragged or pasted from Explorer, large files linked (MEDIA-01, MEDIA-03); `==highlight==` in titles and bodies. **Proposed details:** the find bar sits at the top right of the note and stays in view while it scrolls; documents (PDF, Office, text) dragged in show as a file chip that opens in its default app; a linked file is a `file:///` link. **Later in M5:** the large-file and media pieces of M7 (snapshots storing each attachment once) are M7's.

### NOTE-02 — Right-click formatting menu (v1)
- An Obsidian-like right-click context menu for inserting/formatting.
- **D-72 (decided item set):** Obsidian-style submenus, trimmed:
  - **Format ▸** Bold, Italic, Strikethrough, Highlight (`==text==` as in Obsidian, shown with a subtle gray background), Code, Clear formatting.
  - **Paragraph ▸** Bullet list, Numbered list, Task list, Heading 1, Heading 2, Heading 3, Body, Quote.
  - **Insert ▸** Link, Image, Table, Code block, Horizontal rule.
  - Then Cut / Copy / Paste / Paste as plain text / Select all.
  - Not included: Heading 4–6, math, comments, footnotes, callouts, internal links.
- **Proposed:** `==text==` also renders as a highlight in task titles and bodies (LIST-02) from M5. Milestone M5.
- **D-82:** Insert ▸ Image opens the Windows file picker (PNG, JPEG, GIF, WebP); the picture is copied into `attachments/` and linked, like a pasted screenshot. **Proposed:** Format items wrap the selection (or the word at the cursor) and unwrap it when it already has that format; Clear formatting removes the inline marks in the selection; Paragraph items set the line's kind (the current lines, replacing a bullet, number, checkbox, heading or quote prefix; Body removes it); Link wraps the selection as `[text](…)` with the cursor in the address; Table inserts a 3-column table with a header row; Code block a fence with the cursor inside; Horizontal rule `---` on its own line. Paste as plain text pastes without CAP-06's fencing. The same menu in task bodies while they are edited.

### NOTE-03 — Slash commands (v1)
- Typing `/` opens a command menu: e.g. `/check` inserts a checkbox, `/code` a code block. Same items as the right-click menu.
- **D-82:** `/` opens it at the start of a line or after a space, never inside code or inline code (so paths and URLs never trigger it); typing filters it (`/co` → Code, Code block); ↑/↓ move, Enter or Tab applies, Esc closes and leaves the `/` as typed. **Proposed:** each item has an icon tile, its name and its `/word` (mockup 04); the words are `/bold`, `/italic`, `/strike`, `/highlight`, `/code`, `/clear`, `/bullet`, `/number`, `/check`, `/h1`, `/h2`, `/h3`, `/body`, `/quote`, `/link`, `/image`, `/table`, `/codeblock`, `/rule`. Format items on an empty selection insert the marks with the cursor between them.
- Slash commands are for keyboard users; the right-click menu stays for mouse users.

### NOTE-04 — Syntax-highlighted code blocks (v1)
- Fenced code blocks are syntax highlighted (in notes and task bodies).
- **D-63:** highlighting is grayscale (UI-06): the popup's built-in JSON and stack-trace highlighter and rendered task bodies use it from M4, the CodeMirror theme for all languages in M5.

### NOTE-05 — Copy button on code blocks (v1)
- **D-82 (built):** in the editor too: the code card's copy button sits in its top-right corner, as in the rendered body; a press doesn't move the cursor.
- Every code block has a copy button (visible on hover/focus).

- **D-89:** after copying, the button's icon morphs into a checkmark for a moment.
### NOTE-06 — Monospace toggle (v1)
- A setting (and per-note toggle, **Proposed**) to render text in a monospace font.
- **D-84:** the per-note toggle is a checked **Monospace** item in the note's right-click menu (and **Ctrl+Shift+M**), remembered per note on this machine (UI state), the file unchanged. The global default comes with Settings (M8, APP-11).

### NOTE-08 — Quick notes (v1, D-99)
- A **Quick note** row under Inbox, and **Ctrl+Shift+J** anywhere in the window, make an untitled note and focus its editor: no name to type. It saves as it is written and is listed under **Quick notes** (under Inbox), newest first, labelled by its first line or by when it was made.
- **Keep as a note** or **Move to group ▸** makes it a normal note. An empty quick note goes when it is left. Built (0.4.33); its file layout is in 04 §3.
- **D-102 (0.8.0):** a title (the "Add a title" field at its top, saved on Enter or when it is left, or renaming it in the sidebar) renames the file but keeps it under Quick notes, shown by its title, until Keep as a note, Move to group, or the next day change, when titled quick notes become normal notes. Untitled ones with text stay. A titled quick note is never discarded as empty (**Proposed**).
- **D-107 (0.8.6):** when an empty quick note is removed on leaving it, a toast says "Empty quick notes are removed when you leave them", the first three times only.

### NOTE-07 — Configurable auto-linking patterns (v1)
- Users configure patterns that auto-link: e.g. `AB#1234` → the Azure DevOps work item URL.
- Configuration = a pattern + a URL template (e.g. `AB#(\d+)` → `https://dev.azure.com/<org>/<project>/_workitems/edit/$1`).
- Works in notes, task titles, and task bodies. Gives integration value without building an integration.
- **D-84:** per user, in `settings.json` (`linkPatterns`); the engine is built in M5, its editor in M8's Settings (APP-11): a **Link patterns** section where you paste an example link and type the short form you want (`https://dev.azure.com/org/project/_workitems/edit/1234` + `AB#1234`). Flint infers the pattern from what varies (the part present in both), shows a live preview, asks for a second example when it's ambiguous, and an **Advanced** toggle shows the generated pattern. **Each pattern works both ways:** a typed short form becomes a link chip, a pasted full URL is displayed as its short form (smart link titles, TASK-10). Presets: GitHub issues and pull requests, Azure DevOps work items and pull requests, Jira. No company-specific URLs as built-in defaults; only http(s) links. **Proposed engine details:** a pattern is a short form and a URL with named placeholders (`AB#{id}`, `https://dev.azure.com/acme/web/_workitems/edit/{id}`); a placeholder in both is the varying part (digits, or a word), one only in the URL is fixed by the example; a short form only matches between non-word characters.
- **D-104 (0.8.2):** the editor is built in **Settings → Links**: your patterns as their short form and where it links, each with Delete (asked inline); **Add a link pattern**: paste an example link (a preset kind is recognised and its short form filled in) or type the short form, a live preview both ways with another number, a second example when ambiguous, **Advanced** shows the pattern (read-only). A short form you already have is refused; to change one, delete it and add it again.
- **D-105 (0.8.3):** **Edit** on each pattern (the same editor, as it was left); a part that changes can be a word between fixed text (`{name}-repo`); a short form needs fixed text around what changes (Flint suggests one, `de:…`), and the preview counts the places it would link now, warning when that's many; the built-in recognizers are listed with a switch each; link chips show in the composer and the capture popup while a task is typed, and a pasted URL shows short in the editors once the caret isn't inside it.

### NOTE-09 — Source mode (v1.1, D-141, built)
- A per-note toggle that shows the whole note as raw markdown in the same editor, with Flint's font: an escape hatch when the live preview gets in the way. The file never changes.
- In the Ctrl+K palette and as a checked item in the note's right-click menu, next to Monospace; remembered per note on this machine like Monospace (UI state). Also in mini mode's Note tab; Monospace still applies in it; switching crossfades (off with reduce-motion). Not for task bodies.
- **Shortcut: Ctrl+Shift+E** (grill Q5; pairs with Monospace's Ctrl+Shift+M; Ctrl+E stays inline code, D-106, built with this work). **Built in 1.1.0** (D-141 step 5); the palette has Source mode / Source mode off while a note is open, and Monospace / Monospace off beside it (D-142). Text formatting is not in the palette: a deliberate exception to D-106 (D-142).

### NOTE-10 — Tables (v1.2, D-141)
- GFM tables (`| Column | … |`) render as real tables in the note editor, mini mode's Note tab and task bodies (edited and rendered; grill Q9) instead of raw text. Edits write back only the bytes that changed: the alignment row, padding and escaped pipes stay as they were.
- Markdown can't store column widths, so columns are not resized. Instead, **dragging the table's right edge adds or removes columns, dragging its bottom edge adds or removes rows**; removing columns or rows that contain text warns first ("This deletes content in 2 cells").
- **Editing (grill Q9):** click a cell to edit it in place. Tab / Shift+Tab move between cells (Tab in the last cell adds a row), Enter goes to the cell below (adding a row on the last one), Shift+Enter nudges (no line breaks in cells), ↑ / ↓ move between rows and in and out of the table, ← / → cross cell edges, Esc leaves it. Undo, Ctrl+F and copy work through the note's own text; a selection crossing the table takes all of it; wide tables scroll sideways. The raw table only through Source mode or Edit markdown in its right-click menu.
- **Selecting cells (D-144, Proposed; the minimum, not a spreadsheet):** a drag across cells, Shift+click from the active cell, or Shift+arrows from the cell text's edge select a rectangle of cells (a soft fill; the active cell keeps its ring); a plain click, a plain arrow or Esc clears it. **Ctrl+C** copies the cells as tab-separated text (pastes into Excel and Sheets as cells) and as a markdown table (a Flint note pastes that as a table); **Delete** or **Backspace** clears their text at once, in one undo step, with an Undo toast; **Ctrl+X** copies and clears. Tab-separated text pasted into a cell (from Excel or Sheets) fills the cells from there, growing the table when the block is larger; plain text without tabs or line breaks goes into the cell as before. **Clear selected cells** is in the palette and the table's right-click menu while cells are selected.
- **Writing back (grill Q10, 04 §4):** only the edited cell's bytes change; nothing is re-padded by itself. **Align table** in the table's right-click menu and the Ctrl+K palette re-pads the whole table in the raw text, in one undo step (a toast "Table aligned" with Undo, **Proposed**).
- **Size and shape (grill Q11):** a hover handle beside the right and bottom edge (D-144, Proposed: a small rounded "+" chip outside the cells, centred on the edge, fading in while the pointer is over the table; a click into the last column or row is never the handle's, and a click beside or under the table, off its cells and handles, puts the caret on the line after it, as ↓ from its last row does: after a quote's mark in a quote, on a new line when a heading or other block follows right under the table, and on a new line made as Esc makes it when the table ends the note); each drag step adds or removes one column or row at the end (D-144, Proposed: the new ones drawn as a faint dashed ghost beside the table, which makes room for it, with the count in it; the ones that would go dimmed inside a dashed outline, the handle's "+" a "−"; Esc cancels, at least one column and the header row); the warning shows on letting go only when the drag removes text, as the window's toast with **Delete** and **Cancel**, never in the note (D-144, Proposed: Esc, the toast's time running out, another toast or opening another note cancel; Esc closes a palette, menu, picker, the note's find bar or the slash menu over it first; the cells stay dimmed while it is up). The table's right-click menu and the palette: Add row above / below, Add column left / right, Delete row / column / table (at once, with an Undo toast), Align table. Reordering rows and columns by drag is Later.
- **Motion (grill Q12):** new rows and columns ease in, deleted ones fade and collapse, the edge handles fade in on hover, a drag's ghost grows and shrinks with each step, the parts a drag removes dim first, the active cell's ring moves between cells, the warning rises and sinks like every toast; off with reduce-motion.
- **Text below a table stays out of it (D-144, Proposed):** GFM makes every line right after a table one of its rows until a blank line. Text typed, pasted or moved onto the line under a table (and the picture or paragraph after it) stays a paragraph: Flint writes the blank line that ends the table before it, in the same undo step. Backspace or Delete that would only remove that blank line changes nothing: Backspace at the start of the line after it moves the caret up to it, Backspace on it moves the caret into the end of the table's last cell. A row typed in markdown (`|` first) is a row, and the table shows raw while the caret is in it. An edit that writes no `|` never adds a row (text typed before the `>` of a quote or the `-` of a list item right under the table, with pipes in it: that line goes below the blank line too). Insert ▸ Table leaves a blank line before the text after it. The same holds in Source mode, and for a table in a quote (the blank line is the quote's `>`) or a list item (a line typed under it keeps the item's indent).
- **No slash menu in a cell (D-149):** a `/` typed in a cell is just a slash. A slash menu for cells is for later: the arrow keys stay in the menu, it opens at the caret, and items that don't fit in a cell (/table, code blocks, headings and other blocks) are hidden.
- Built in 1.2.0 (D-141, D-144, D-149).

---

## 7. Media

### MEDIA-01 — Images and videos (v1)
- **D-80:** an image in a body has a small trash button in its corner; deleting removes its link (the file stays until MEDIA-04), with an undo toast.
- **D-77 (M5):** images in bodies show as small thumbnails; a click opens a lightbox with smooth motion, and ←/→ go to the other images of the same task (not other tasks).
- Images and videos can be added to notes and task bodies via paste, drag-and-drop, or the insert menu.
- Images render inline; videos render with a player and thumbnail.
- **D-84:** videos are MP4, WebM and MOV, added by paste or drag (also from Explorer), playing inline with a first-frame thumbnail. A video that can't play inline (e.g. HEVC from a phone) shows a placeholder with **Open in default player**. Files dragged or pasted from Explorer that aren't media (PDF, Office documents, text) are linked as attachments the same way and open in their default app; programs and scripts are never attached or launched (MEDIA-03).

### MEDIA-02 — Attachments folder with relative paths (v1)
- Media is stored in an `attachments/` folder inside the Flint folder and referenced by **relative paths**, so moving the Flint folder never breaks images.

- **D-87:** a picture's right-click menu (body and note thumbnails, the composer's chips, and the image viewer, which gets one): **Copy image**, **Open in viewer**, **Open in default app**, **Show in folder**.
- **D-89:** the image viewer's right-click menu works (Copy image, Open in default app, Show in folder); other files' menus have Open in default app and Show in folder.
- **D-91:** "Open in viewer" in a picture's menu in a note or the panel opens the viewer (it did nothing).

### MEDIA-03 — Large files are linked, not copied (v1, D-84)
- ~~Warn when adding a file above a size threshold.~~ **D-84 (replaces the warning):** no hard size limit. Up to **25 MB** a file is copied into `attachments/`; above it, it is added **as a link to its original location** at once (nothing copied).
- A notice says **"Large file, linked to its original location"** with **Copy into Flint instead**. It stays until acted on or dismissed (it never fades) and never blocks input. Hovering the button, or the small info icon beside it, explains: large files are linked by default because copying them makes the Flint folder, snapshots, exports and future sync slow and big; copying keeps the file safe if the original is moved or deleted.
- A linked attachment shows a small **Linked** badge; its right-click menu has **Copy into Flint**, so it can be switched later.
- A linked file plays inline when it can, otherwise a click opens it in its default app. If the original is moved or deleted it shows **File not found** with the original path, never a broken player.
- **Linked files are not included in snapshots, export or (later) sync** (DATA-04, DATA-06, SYNC-01).
- **Never launches programs or scripts** from a link (`.exe`, `.bat`, `.cmd`, `.ps1`, `.msi`, `.com`, `.scr`, `.vbs`, `.js`, `.lnk`, `.reg`, `.hta`, …): only media and documents open; anything else asks first.
- **Proposed:** a linked file is written as a `file:///` link (`![clip](file:///C:/Users/…/clip.mp4)`), which Obsidian also opens.

### MEDIA-04 — Orphaned-attachment cleanup (v1)
- When a task or note leaves the Trash permanently, attachments no longer referenced by any list (or by anything still in Trash) are deleted too. Otherwise the attachments folder grows forever.

---

## 8. Navigation and views

### NAV-01 — Ctrl+K command palette (v1)
- Fuzzy search across **all lists** (task titles, bodies, notes) plus commands (create list, move task, open settings, open Flint folder, etc.). No theme switching in v1 (dark only).
- Fully keyboard-driven.
- **D-107 (0.8.6):** no header pill: a small search button in the sidebar header (tooltip "Search or run a command (Ctrl+K)"); results always Go to → (This task) → Commands → Tasks → Lists and notes → lines in notes; a step has a back arrow, Esc goes back one step and closes only from the top; a footer with the keys and Ctrl+K; a note's line opens the note scrolled to it, flashed.
- **D-106 (0.8.4):** a centred card like the capture popup over a very light dim, opened with Ctrl+K anywhere or the header's "Search or run a command · Ctrl K" pill (replaced by D-107); results grouped Go to, Tasks, Notes, Commands (open tasks first, then completed ones); before typing, recent places, the selected task's actions and the most used commands; Trash and the archive through the last row, **Search Trash and Archive**; commands with choices as a second step (Move to ›, Priority ›). Every new feature with an action adds its palette command.

### NAV-02 — `?` keyboard cheat sheet (v1)
- Pressing `?` (in navigate state) shows all shortcuts. Essential for a keyboard-first app.
- **D-80:** it shows the same list as Settings' **Keyboard shortcuts** section (APP-11), from one source.
- **D-106 (0.8.4):** a card in the palette's style, the shortcuts in two columns by group, a filter at the top; `?` or Esc closes it.

### NAV-03 — Main window layout (v1, Proposed)
- A minimal, collapsible sidebar: Today and Inbox pinned at the top, then the user's lists. The content area shows the selected list.

### NAV-04 — Back and forward (v1, D-53)
- The main window keeps a history of the views shown this session (lists, Today, task pages). **Back / forward** with the **mouse's side buttons** and **Alt+← / Alt+→**.
- **Built in M4 step 6 (Proposed details):** going somewhere new drops the forward part, as in a browser; going back from a task's page selects that task in its list; a reminder's Open is a step in the history too.
- **D-79:** a **two-finger horizontal swipe** on a precision touchpad goes back or forward, as in Chrome and Edge on Windows, with a subtle arrow growing at the window's edge during the swipe; ignored over horizontally scrollable areas. Milestone M4 step 9.
- No visible back/forward buttons, except the back arrow on a task page (TASK-05).
- Milestone M4, with the page view.

- **Swipe built (0.4.22, D-88, Proposed details):** about 240 px of horizontal touchpad scroll steps; the arrow grows at that edge; not over sideways-scrolling content, not with Ctrl, only when there is somewhere to go.
- **D-91:** each list, note and task page keeps its scroll position for the session; coming back to it restores the position at once (no smooth scroll).

### NAV-05 — Tabs bar (Later, D-62)
- Obsidian-style tabs for several open lists and pages. Later: it needs careful design to fit the visual language. v1 has one view at a time with back/forward (NAV-04).

### NAV-07 — The context panel on wide screens (v1, D-83)
- `design/mockups/11-context-panel.html` (three states; screenshots `11-context-panel-details`, `-upnext`, `-note`). **Milestone:** after the M5 editor work, before M4 step 9. **Built (0.4.18).**
- One context-aware panel to the right of the main column. The 820 px column stays (UI-12, D-82); column and panel are centred together as a pair, 28 px apart. The panel is 440 px wide, on the task list's card surface; its height fits its content, grows with it, and scrolls inside only when it would be taller than the window.
- It appears by itself when the window is wide enough for both: the main area at least **1336 px** (820 + 28 + 440 and 24 px either side), a window of about **1580 px** with the sidebar (**Proposed**, tuned from "about 1400 px", which can't hold both next to the sidebar; D-83). A 1920 px screen at 125 % (1536 px) gets it at 90 % interface size (UI-12); **Ctrl+\** hides and shows it, remembered **per monitor** (like the interface size, UI-12). Below that width nothing changes.
- **Task selected:** the selected task's details, following the selection (click or ↑/↓). Header: a "Task" label, **Open as page**, hide. The checkbox and the title (editable); chips for priority, list and reminder, each opening its picker (CAP-11); **Notes** in the M5 editor with code cards and image thumbnails (on wide screens the notes are edited here; the row doesn't expand inline); **Subtasks** with progress ("1 of 2"), toggling and **Add subtask**; a footer with the created and edited dates. On wide screens the row's own body / open-as-page control goes (the panel has it); on narrow windows inline expanding and the page view stay as they are (TASK-05).
- **Nothing selected, "Up next":** overdue reminders first (the bell with the white dot, REM-11), then Today's and Tomorrow's reminders by time, then **Starred for today** (only once Today and starring exist, M6; until then reminders only). A footer hint: "Select a task to see its details here · Ctrl+\ hides the panel". Clicking an item selects (or opens) its task.
  - **D-85 (supersedes the order and the hint):** **Pinned** first (TODAY-01; done ones faded until the day changes), then **Today** and **Tomorrow** by time, then **Overdue** as a quieter section at the bottom. The footer is "Select a task to see its details here".
- **Note open:** the note keeps its 820 px reading column; the panel shows the **Outline** ("6 sections · 3 blocks") and **In this note** (checklist progress, last edited). The outline lists headings (indented by level, the current section marked, a click jumps there) and under each heading its blocks: code, JSON, stack traces and images, each with a small icon tile and a type tag on the right (`bash`, `json`, `image`…); a click scrolls to the block. Block titles: (1) an explicit title after the language in the fence's info string (```` ```bash Check gateway health ````), kept in the file and ignored by other editors; (2) the first comment line (`# …`, `// …`, `-- …`, `/* … */`); (3) JSON: its top-level keys (`{ region, retries, window }`), a stack trace: the exception's name; (4) the type ("Python block", "Code block"). Images: the alt text, else the file name.
- **Task open as a page (D-83, grill):** the panel shows the outline of the page's body (headings and blocks, titled as for a note) and **In this task** (subtask progress, reminder, created and edited). A body without headings or blocks shows **Up next** instead. Selecting a subtask on the page doesn't change the panel.
- **Motion:** slides and fades in when it appears; its height eases when its content changes; its content crossfades when the selection or state changes.
- **D-86, after 0.4.19 (supersedes D-85's sticky position; built in 0.4.20):**
  - **Show / hide** slide and fade both ways (the panel stays until it has gone), and the column glides to its place; **Proposed:** about 320 ms, the page curve; a window resize switches at once.
  - **Sticky:** starts level with the composer (or the note card), scrolls up with the page and sticks 16 px below the title bar, or where it started when that is higher (**Proposed**); no gap, never above where it started.
  - **Up next rows:** title first at one left edge; on the right the icon (pin, bell, overdue bell with the white dot) beside the time or date, then the list name, as on task rows.
  - **Clickable facts** in "In this note" and "In this task" (a task's page): open checklist items, code blocks, images, links, with counts; a click jumps to the first, the next click to the next (wrapping); the target flashes briefly (**Proposed**).
  - **No scrollbar** during the panel's transitions; only when its content overflows at rest.
  - **Extra sections** open and close in one smooth motion; Recently captured's rows line up with the others.
  - **Attachments:** pictures open in the lightbox; other files in their default app (never a program).
  - **Task details:** the notes are edited in the panel with the M5 editor; Add subtask adds it in the panel. A click on the Pin chip (**Proposed**) or on a pin in Up next unpins.
- **D-85, after 0.4.18 (built in 0.4.19):**
  - **Responsive pair:** the full pair (820 / 28 / 440) when the main area fits it, else a **compact pair** (780 px column, 24 px gap, 380 px panel), so a 1536 px window (1920 px at 125 %) shows the panel at 100 %; below that, no panel. **Proposed** thresholds: a main area of 1336 px for the full pair and 1232 px for the compact one (24 px either side).
  - **Back:** a task reached from Up next or another panel link shows a back arrow in the panel header; it returns to the previous list and selection (as Alt+← and the mouse's back button do).
  - **Toggle button:** a small panel button at the top right of the main area, near the window controls, shows or hides the panel whenever the window can fit it. "Show panel" / "Hide panel" is in the page's blank-area right-click menu and the panel's own menu (and Ctrl+K later).
  - **Position:** in a task list the panel's top lines up with the composer's top and stays there while scrolling (sticky, never above it); in a note, with the note card's top.
  - **In this note:** "Created 2 Nov · edited 11 min ago", as for a task. **Proposed:** a note's created date is its first sighting in `.flint/meta.json`.
  - **Blank space:** a click on the main area outside a row clears the selection (the panel shows Up next).
  - **Scroll-spy:** the current section is the last heading above a line 96 px below the top of the view (**Proposed**); scrolled to the end, the last heading is current. The outline keeps the current entry in view; a click smooth-scrolls (instantly under reduce-motion).
  - **Motion** as above, plus the current-section marker sliding; covered by the motion regression test.
  - **Extra sections:** **Recently captured** (Up next: the last 5 popup captures, open or done, newest first, with their list), **References** (a task's or note's link chips: work items, PRs, URLs; clickable) and **Attachments** (file names; linked large files marked, missing ones flagged; a click opens the file as MEDIA-03 does). Each is one quiet collapsed line with a count ("References · 3"), opens on a click, remembers open or closed per section on this machine (**Proposed:** in the main window's local storage), is hidden when empty, and sits below the core content.
  - **Proposed details (0.4.19):** the crossfade keeps the previous content a moment, fading out over the new; the current-section marker is one bar that slides; the panel toggle shows the panel's state (a filled background while shown); the multi-select bar has Pin / Unpin; the blank-area menu and the panel's own menu have Show / Hide panel.

- **D-87, after 0.4.20:** show and hide move the column and the panel together (same distance, same curve, never overlapping); the Add subtask field uses the editing-field style; subtasks in the panel have the list's right-click menu and indicators (priority stripe, reminder bell and time, pin); notes in the panel keep paragraph spacing after a code block and the panel's content inset; a code block has no empty first line. **Notes are saved as they are typed** (debounced) and when left, never discarded.
- **D-89:** subtasks in the panel highlight on hover and are clickable (selected in the list, the panel shows them, back returns); on a task's page a selected subtask shows its own details; Shift+Enter and "Add notes" go to the panel's notes; an inline body closes with Esc or its notes icon; the lower sections ease in with the rest; the panel's text isn't part of a window-wide selection; References and Attachments have right-click menus.
### NAV-08 — The clipboard section of the context panel (v1, late: alongside M8, D-86)
- A **Clipboard** section docked at the bottom of the context panel (NAV-07), apart from its scrolling content, so it stays reachable under long outlines.
- It shows **Windows' own clipboard history** (`Clipboard.GetHistoryItemsAsync`, Windows 10 1809+), read while Flint is in the foreground: Flint never records the clipboard itself, and items that password managers exclude stay excluded.
- Collapsed by default with the newest 3–4 items; scrollable when expanded; expanded state remembered (machine UI state).
- A click inserts the item at the cursor; **Capture as task** makes it a task (as a capture, CAP-02).
- Clipboard history off in Windows: a note with a button that opens `ms-settings:clipboard`; Flint never changes the setting. When a group policy turns it off, the note says it may be managed by the organisation.
- **Screen sharing:** the design includes a caution, since clipboard items are visible to viewers (**open for the design**, e.g. contents hidden until hovered or a "hide contents" switch).
- Needs a small native bridge to WinRT, chosen under D-30 when built. **D-127 (decided):** koffi, already a dependency (no compiled add-on); text items first; read-only; reads again when Windows' clipboard sequence number changes. A marker file around every read: a read that never finished (a crash) keeps reading off, says why in the section and reads again only on **Retry**. **Built first (0.8.22):** Ctrl+K → **Check clipboard history**, the proof that the reading works in the installed Flint; the section follows once it does. **D-128 (built, 0.8.23):** as decided in step 5's grill: docked in every panel state, folded with the newest 3, open up to about 45 % of the panel; placeholder bars with kind and age at rest, the text after the pointer rests about 300 ms (Always show contents: the header's eye, Settings, the palette); a click pastes into the field with the keyboard (its own paste rules, one undo), right-click Insert / Capture as task (the popup as by Ctrl+Shift+X) / Copy (the only clipboard write); **Paste from clipboard history…** (Ctrl+Shift+H): a picker with the text, Enter / Shift+Enter / Ctrl+C; the six states with their notes; Settings → Clipboard (Clipboard history, Always show contents). The proof command is gone. **D-129 (built, 0.8.24):** pictures as thumbnails (a tile at rest), inserted as a pasted picture, captured as a chip, counted; items slide in and fold away, content crossfades both ways; right-click **Delete (also from Win+V)** with Undo (adds it back as the newest; kept in memory only while offered); **Clear all** asks inline (Win+V's pinned items are kept); Copy is Win+V's pick (no duplicate); Windows doesn't report Win+V's pins, so no marker; Always show contents only in the section and the palette.

### NAV-09 — Back to top (v1, D-98)
- In every page that scrolls (task lists, Today, notes, task pages, Trash), once scrolled down a little, a small round button appears at the bottom right of the main column (never over the side panel). A click scrolls smoothly to the top (at once under reduce-motion); it appears and disappears with motion. Built (0.4.31).

### NAV-06 — Find in page (v1, D-72)
- **Ctrl+F** opens a find bar in Flint's style (09 §8).
- **Task lists:** matches are highlighted and **Enter / Shift+Enter** jump to the next / previous one; nothing is filtered. **Proposed:** titles and bodies are searched, the Completed section included; a match in a collapsed body or a collapsed Completed section opens it when jumped to; Esc closes the bar and keeps the selection on the last match. Milestone M4 step 10 (M5 if it doesn't fit).
- **Notes:** CodeMirror's search, restyled to the same bar. Milestone M5.

- **Built for task lists (0.4.22, D-88):** as proposed above; the matches are highlighted with the CSS Custom Highlight API; a jump opens Completed or a body under its row.
- **D-89:** in task lists the bar opens and closes with motion, its count crossfades, the match's row lights up; at the list's top it is level with the title row, scrolled it sits level with the context panel's top.
- **D-91:** the note's find bar sits as the list's: level with the title at the top, level with the panel's top while scrolling, never pushing the note down; it fades out when closed.

### MINI-01 — Mini mode (v1)
- A small **always-on-top floating window** showing just **Today or Inbox** (toggle between them), for calls.
- **Proposed:** supports adding a task, completing, and seeing reminders; everything else opens the main window.
- Created on first use, then hidden (never destroyed) when closed (APP-02). Remembers size/position (APP-05).
- **Built (0.8.8, D-109):** Today (pinned, then today's later reminders), Inbox and Note tabs; a click selects, double-click or Enter opens in the main window; Space, P, N, Ctrl+1/2/3, Ctrl+Z; the reminder card beside the toast (each clearing the other); Ctrl+Alt+Space, the tray, the Ctrl+K command and the title-bar button; on top with its pin; corner snapping; hidden from screen sharing.
- **0.8.17 (D-122):** the Note tab's ⋯ menu: **Open a note…** (a search field, every note and quick note newest first, five in view); the chosen note opens in the Note tab ("Note · <when>" and its name for a note that isn't a quick note).
- **0.8.10 (D-111):** one size for every tab (the Note tab takes the full height), Reset size, resized from both sides after any move, nothing above a top-corner card takes the mouse, a softer shadow below; a slow second click opens; the bell mutes and unmutes (a muted reminder stays, struck); D/S/O whenever mini has the focus; mini and the capture popup fade in and out.
- **Rebuilt (0.8.9, D-110):** on the main window's own components in a compact size (rows, selection glide, completion, drag, composer with chips, toast, tabs, editor, scrollbars, motion); a transparent window with mockup 05's card (364 px, height fitting its content up to 460 px, resizable from its handles, hanging from its snapped corner, a grip at the top); Today's next reminder on a card that turns into the alert; Alt+↑/↓ and drag reorder Today's pinned tasks and Inbox; the Note tab's title works before its text, and an empty note removed when it was left no longer leaves the tab dead.
- **D-109:** mini mode and the main window can be open at once and stay in sync; Open in mini brings the main window forward at that place, mini stays; × hides mini to the tray. A third tab, **Note**, shows one quick note (NOTE-08) as a sticky note: the most recent one or a new one, a small menu to switch or start another, a title and Keep as a note, a compact editor with the live preview.

---

## 9. Data safety

Without sync, the local disk is the only copy, so this matters more.

### DATA-01 — Atomic writes (v1)
- Every save writes to a temporary file, then renames it over the original. A crash or power loss mid-save can never corrupt a list.

### DATA-02 — Trash, kept 30 days (v1)
- Deleted tasks and deleted lists go to Trash and can be restored for 30 days, after which they are permanently removed (and MEDIA-04 runs).
- **D-97:** a **Trash** row at the bottom of the sidebar (with its count) opens a view: deleted tasks, lists and notes by day, newest first, with their list and "deleted 3 days ago"; Restore, Delete now, Empty Trash (inline confirms). A second tab, **Archived**, shows auto-archived completed tasks by list, each restorable to its list. **Built (0.4.30).**
- **D-98 (0.4.31):** a click on a deleted item opens it read-only (the side panel on wide screens, a page on narrow ones); trying to edit it says "Restore to edit" with Restore, which restores it and opens it there, ready to edit. Restore's toast offers Undo and "Go to <list>".

### DATA-03 — Global Ctrl+Z (v1)
- Undo (and redo, **Proposed:** Ctrl+Shift+Z / Ctrl+Y) works for deletes, moves, reorders, priority changes, completion, conversions, and bulk actions, not just text edits.

### DATA-04 — Local snapshots (v1)
- Flint keeps automatic local snapshots of the Flint folder so a bad change can be restored. Retention policy: see Q-05.
- **D-97:** restore one list or note at a time (what differs from now shown; a fresh snapshot first; one undo step), or **Restore everything** behind a confirm. From the tray's **Restore from a snapshot…** and the Trash view until Settings (M8). **Built (0.4.32).**
- **D-99 (0.4.33):** no longer in the tray (Trash's header links to Snapshots). A changed or deleted list or note opens its comparison with now: a task list task by task (added, deleted, changed and what), each restorable on its own, or the whole list; a note line by line ("Restore this note" / "Keep current"); a deleted one as it was, with Restore. Settings → Data (M8): how often, how long hourly and daily ones are kept, the space they use, "Clear old snapshots".

### DATA-05 — One-click zip export (v1)
- Export the whole Flint folder (lists + attachments) as a zip.
- **D-97:** the tray's **Export Flint folder…** (a save dialog, a dated file name) until Settings and Ctrl+K (M8). **Built (0.4.32).** **D-99:** in Settings → Data (M8) and Ctrl+K; until then a link in Trash's header, no longer in the tray.

### DATA-06 — File watcher (v1)
- Flint watches the Flint folder and reloads lists changed on disk by anything else (the CLI, Claude via the CLI, a text editor) **live**, without losing the cursor position or selection.

### DATA-07 — User-configurable Flint folder (v1)
- The user chooses where the Flint folder lives (set during onboarding, changeable in settings).
- v1 does **not** support syncing this folder between machines (Non-goals, 04).
- **Default: `%USERPROFILE%\Flint`** (D-24, resolves Q-15), which OneDrive Known Folder Move never redirects. If the chosen folder is inside OneDrive, Flint warns plainly that it is synced and that sync isn't supported yet, and allows continuing. If it is an Obsidian vault root, Flint suggests a `Flint` subfolder inside the vault (D-23).
- An **"Open Flint folder"** command (palette and settings).
- **D-104 (0.8.2), changing it:** Settings → General → Flint folder → **Change…**: Windows' folder picker, then Flint asks in the row, depending on the chosen folder: an empty one: **Move my lists here** (copied and checked file by file; the old folder stays as a backup) or **Start fresh here**; one with Flint lists: **Open these lists** (merging is Later); another non-empty one: **Use a Flint subfolder inside it** or **Use this folder directly**, then Move or Start fresh. The OneDrive warning shows when it applies; a failed copy leaves everything as it was and says why. Flint restarts on the new folder, back on Settings.
- **Proposed (D-24):** a list that can't be read because it is cloud-only or locked shows that plainly instead of an empty list; a OneDrive conflict copy shows a notice saying so instead of appearing as a normal extra list.

### DATA-08 — Import from Obsidian (Later, after v1; D-131)
- **D-131: moved to Later (after v1).** For then: import at the top level of the sidebar or into a group ("Obsidian" by default, renamable); the vault's folders and subfolders need a decision (Flint's groups are one level: flatten them, or sub-groups then).
- **Recorded (D-116), details to be grilled when it comes up.** The first-run welcome offers it, skippable ("you can import later from Settings → Data"); Settings → Data has it too.
- Pick a vault: Flint **copies** all its notes into the Flint folder as plain notes (no checklist-to-task conversion; notes often mix text and checklists). It never moves or changes the vault.
- Notes are copied flat; a duplicate name gets " (2)". To consider: the vault's top-level folders as sidebar groups.
- Embedded images (`![[image.png]]`) are copied into `attachments/` and the embeds rewritten so they still show.
- Not the same as putting the Flint folder inside a vault, which already works (D-23).

---

## 10. App behaviour

### APP-01 — Lives in the tray, starts with Windows (v1)
- Flint runs as a tray app and starts at login (configurable, default on). The global hotkeys and reminders depend on it running.
- **D-68:** only the start-with-Windows launch stays hidden in the tray. Starting Flint by hand (Start menu, shortcut, the installer's finish, or starting it again while it runs) shows the main window.
- Tray menu (**Proposed** items): Open Flint, Quick capture, Mini mode, Settings, Quit.
- **D-99:** exactly these (D-102: Hotkeys… is gone, the hotkeys are recorded in Settings); Export and Restore from a snapshot live in Settings → Data (M8) and Ctrl+K, and until then in Trash's header.

### APP-02 — Never destroy windows; only hide them (v1)
- Closing the main window hides it to the tray. The capture popup and main window stay alive; mini mode stays alive after first open. This removes the "opening a closed window" cost entirely.

### APP-03 — Never quit by accident (v1)
- The window's X button hides to the tray. Quitting is an explicit **Quit** in the tray menu (and a palette command).

### APP-04 — Single instance (v1)
- Launching Flint again focuses the running instance instead of starting a second one.

### APP-05 — Remembered window positions (v1)
- Each window (main, mini mode) remembers its size and position **per monitor setup**.
- **D-96 (0.4.29):** also whether it was **maximized** (its normal size and position kept underneath), and it comes back that way from every entry point: a reminder, the tray, the Start menu, a second launch, a manual start.

### APP-06 — Auto-update, applied safely (v1, D-136; was Later in D-19)
- Flint updates itself from **GitHub Releases**; nobody reinstalls by hand.
- Updates are **applied on quit, or on Restart now, never mid-session by themselves**. An update restart must never happen during a call.
- **D-140 (1.0.1):** on Restart now Flint's windows hide at once and a notification says it is updating and reopens by itself in about a minute (Windows checks a new unsigned version the first time it starts).
- **D-136 (built, 0.9.1):** electron-updater, GitHub provider (`DavitKhachaturovi/flint`), stable releases only, never a downgrade. Checks 30 s after start, then every 4 hours while Flint runs, and on waking when a check is due; downloads in the background. When ready, a quiet toast in the main window: "Update ready · Flint 1.0.1 · Restart now / Later" (once a session; if the window is hidden it waits until it is opened; never in mini or the popup, never a Windows notification). Later: installs when Flint quits; "Restart to update" stays in Settings → About, the palette and the tray (the tray's one exception to its five items, there only while an update is ready). **Settings → About:** the version with one status line (Up to date · checked 14:02 / Checking… / Downloading 1.0.2 · 42% / 1.0.2 is ready / Couldn't check (offline)), the button **Check for updates** (or **Restart now**) and the switch **Check for updates automatically** (on by default; off: Flint checks only when asked). Errors show only in that status line. Palette: **Check for updates** (opens About and checks) and, while one is ready, **Restart to update**. Development, test and benchmark builds never update.

### APP-07 — Silent crash recovery (v1)
- If the UI (renderer) process crashes, Flint detects it and reloads the window automatically. The tray and global hotkeys keep working.

### APP-08 — Rebindable global hotkeys with conflict detection (v1)
- Both global hotkeys (capture, capture-selection) are rebindable. If a chosen hotkey is already taken by another app, Flint says so and asks for another one.
- **D-102 (0.8.0):** recorded in **Settings → Capture & hotkeys** with the rules below (the Hotkeys window is gone): click the keycap, press the new keys; Esc or clicking elsewhere cancels. The tray's warning item opens Settings at Capture & hotkeys.
- **Proposed (D-44, until the Settings screen in M8; superseded by D-102 for where it lives):** a small **Hotkeys** window from the tray: click a hotkey, press the new keys; Flint tries the combination at once and keeps the old one if another app owns it. A hotkey needs Ctrl, Alt or Win (Shift alone would swallow capital letters everywhere); the two must differ; Alt is allowed with a note that it is often a push-to-talk key. While recording, the current hotkeys are switched off. A hotkey that is taken at startup shows as a warning item at the top of the tray menu, which opens the window. Only combinations other apps register globally can be detected, not an app's own shortcuts (e.g. VS Code's).

### APP-09 — No telemetry, stated plainly (v1)
- Flint sends no telemetry and no analytics. The app and installer state plainly: **"Your notes never leave your machine."**
- The only network access is checking for and downloading updates (APP-06, D-136), from GitHub, which Settings → About can turn off (then Flint contacts GitHub only when asked).
- **Enforced (D-31):** an end-to-end test fails on any network request the app attempts. Test runs use a fake updater, so that test still allows no endpoint at all (D-136). In the installed build Flint's network guard lets through only HTTPS to GitHub's release hosts, and only from the updater's own session.
- **D-132 (built, 0.8.28):** stated first in Settings → About, a **Privacy** row: "Your notes never leave your machine. Flint sends no telemetry, needs no account and makes no network requests of its own." The walkthrough's step 1 says "Nothing leaves your computer." The installer doesn't state it in v1 (one-click, no page). **D-136 (0.9.1):** with auto-update the row says: "Your notes never leave your machine. Flint only contacts GitHub to check for updates, which you can turn off." **D-151 (1.3.0):** Give to Claude (TASK-18) adds no network use; the row adds: "Give to Claude only hands a task to the Claude app on this computer; nothing leaves your machine unless you send it from Claude."

### APP-10 — First-run walkthrough (v1, D-61)
- First launch asks for the Flint folder location (DATA-07: default `%USERPROFILE%\Flint`, with the OneDrive warning and the vault-root suggestion) and confirms the capture hotkey.
- Then a short **walkthrough** of the features that are specific to Flint, using the spotlight (APP-13): the global capture hotkey, shorthand, `##` lists, capture-selection, Today and reminders, keyboard navigation. About **5–6 steps**, each skippable (Next / Skip / Skip all), and **replayable** later (tray, settings).
- **D-115 (decided):** while a step's spotlight is up, only the ringed target is live; the keys taught work everywhere; the dim lifts while the popup or mini is open; Esc ends it ("Replay it any time from Settings"); the card never takes the keyboard.
- **D-122 (0.8.17):** the dim and the card stay while the popup or mini is open; step 4 counts only something real (a named list, note or group, a quick note with a title or text; an empty one stays open to type in, and the step moves on once the typing pauses); step 5 rings the faint pin of the first open task ("Click its pin, or select it and press P."); Replay walkthrough is in Settings → About; D-121's Proposed points decided.
- **D-121 (built, 0.8.16):** as decided; Proposed: what the tour made is what didn't exist when it started (by ID); its progress in app data's `tour.json`; the card's buttons Next and Skip all; step 5 rings the first open task ("Select it and press P, or right-click it and choose Pin": an unpinned task has no pin in its row); a menu, picker or the palette takes Esc first.
- **D-120 (decided):** each card's title and text (the table in D-120); "3 / 8", Next / Skip / Skip all; You're set ends with "Flint will point out a few more things as you go; you can turn tips off in Settings."
- **D-119 (decided):** step 1's Change… is Settings' folder flow (D-104); after its restart the walkthrough goes on at step 2, with what it made still known (kept in the settings). Any other quit or crash ends it: the next start shows once "The walkthrough was interrupted · Replay" (from step 1); what it made stays.
- **D-117 (decided):** Remove what I created during the tour takes only what was made during it (by ID, the step-2 capture too); edits to what was there stay.
- **D-116 (decided):** each step's ring and what moves it on: (1) welcome and the folder, a centred card, Next; (2) capture, no ring, a capture saved from the popup; (3) shorthand, Inbox's composer, a task added with typed `!h`, `@time` or `##list`; (4) the sidebar's + and the Quick note row, a list, note or quick note made; (5) the first task's pin (Today when Inbox is empty), a task pinned; (6) the composer's reminder button, a reminder set; (7) the sidebar's palette button, the palette opened; (8) the title bar's mini-mode button, mini opened. Then **You're set** with Done and **Remove what I created during the tour** (one undoable step to Trash; otherwise all stays as real data).
- **D-113 (decided):** 8 steps, each advancing by itself when you do the thing (otherwise Next): welcome and the Flint folder; capture from anywhere; shorthand while writing; task lists, notes and quick notes; Today and pins; reminders; Ctrl+K and `?`; mini mode. A fresh install gets it; an existing one gets What's new. Steps in D-113.
- **Decided (D-112):** Settings has **Replay walkthrough**; the walkthrough's first step says it can be skipped now and replayed any time from Settings.
- **Decided (D-64):** the walkthrough **replaces the earlier "teaching Inbox"** (sample tasks that each taught a shortcut), so there is one onboarding system. Inbox starts empty.
- Milestone M8.

### APP-11 — Settings (v1)
Settings live in app data, not in the Flint folder (04). They include at least:
- Flint folder location.
- Global hotkeys (capture, capture-selection).
- Start with Windows.
- Theme: **dark only in v1** (light mode Later; the setting may be omitted until then), density (comfortable / compact; **D-131: Later**, v1 keeps one density), monospace toggle.
- ~~Priority palette (default / color-blind-safe)~~: not needed in v1, priority is grayscale by lightness and thickness (D-17).
- Notifications on/off, sound on/off and sound choice, Focus Assist explanation, "Hide task text in notifications" (REM-10).
- Today rollover prompt on/off.
- Tips on/off ("Don't show tips", APP-14).
- Auto-archive completed tasks after N days (on/off, N).
- Auto-link patterns.
- **D-52:** until this screen exists (M8), the sidebar's Settings entry is **hidden**, not shown disabled (it did nothing).
- **D-100 (0.4.34):** built as one page with a section index: General (start with Windows, the Flint folder), Capture & hotkeys (shown; Change… opens the Hotkeys window), Reminders (notifications, the reminder sound with Play and its info card, hide task text, the Focus Assist note), Today & lists (the rollover prompt, auto-archive), Data (snapshots: how often, how long, the space used, Clear old snapshots, Snapshots…, Export…), Appearance (interface size, animation speed), Keyboard shortcuts, About. A Settings row above Trash and the tray open it; Ctrl+F finds a setting. Next (step 1b): the link-patterns editor, changing the Flint folder, recording hotkeys in place.
- **D-102 (0.8.0):** Capture & hotkeys records the hotkeys in place (APP-08); Reminders' chime is described as what is still heard when Do Not Disturb or Focus silences notifications, and the Focus Assist row is now **Do Not Disturb**; Appearance has Interface size as exact levels (and, in 0.8.0 only, Sidebar footer: D-103 chose Buttons and removed the setting).
- **D-104 (0.8.2):** a ninth section, **Links**, after Today & lists: the link-patterns editor (NOTE-07); General's Flint folder row has **Change…** (DATA-07).
- **D-105 (0.8.3):** the Trash button is just "Trash", the size of Settings; its count is inside Trash.
- **D-103 (0.8.1):** Settings and Trash sit side by side at the sidebar's foot as two rounded buttons sized to their content; their names are never cut (Trash's count is left out where it can't fit); the lists blend out above them.
- **D-81, Interface size (M8):** the app zoom of UI-12 (per display), next to the animation speed. **D-102:** a segmented choice of exact levels, 80 / 90 / 100 / 110 / 125 / 150 % (decided, D-103), the current one marked.
- **D-84, Link patterns (M8):** the editor for NOTE-07's patterns: paste an example link, type the short form, a live preview, a second example when ambiguous, an Advanced view of the generated pattern; presets for GitHub, Azure DevOps and Jira. **Monospace** default for notes (NOTE-06).
- **D-80, Keyboard shortcuts (M8):** a section listing every non-obvious shortcut: Tab / Shift+Tab (indent, outdent), Shift+Enter (notes; Open as page in Navigate state), Alt+↑/↓, Ctrl+Shift+Space and Ctrl+Shift+X, the mini-mode shortcut, Alt+← / Alt+→ (back, forward), Ctrl+K, Ctrl+F, Ctrl+Shift+N, Ctrl+A, 1 / 2 / 3 / 0, Space, Delete, Ctrl+Z / Ctrl+Y. The **global hotkeys are rebound here** (APP-08: the Hotkeys window of D-44 moves into Settings). The `?` cheat sheet (NAV-02) shows the same list.

### APP-12 — Respect OS reduce-motion (v1)
- If Windows "show animations" / reduce motion is off, Flint's spring and completion animations turn off automatically.
- **D-67:** next to it, Settings (M8) gets an **animation speed** setting that scales all motion (APP-11).

### APP-16 — Install and update in one step (v1, D-68)
- The installer is one-click and per-user (no wizard pages, no admin rights): run it, it installs, and Flint opens with its main window. Installing a newer version over an existing one works the same way and also starts Flint at the end. Settings, drafts and the Flint folder are kept (D-32).
- Milestone M4 (it is already one-click; Flint opening with its window at the end needs APP-01's manual-start rule).

### APP-13 — Guidance spotlight (v1, D-61)
- One shared **spotlight** component for all guidance: a **soft dim** over the window and a **ring** around the target element, with a small card (one or two lines) and **Next / Skip / Skip all**. Used by the walkthrough (APP-10), contextual tips (APP-14) and What's new (APP-15). Visual spec in 09 §8.
- **D-125 (decided, 0.8.20):** the card never covers the ringed target or where you type in what a target opened (step 4: the quick note's title and text, the new list's name field); it glides out of the way to a corner of the window instead.
- Milestone M8.

### APP-14 — Contextual tips (v1, D-61)
- When the user repeats an inefficient pattern (e.g. sets priority with the button 3× instead of typing `!h`), Flint offers a one-line tip.
- Rules: a **non-blocking card in a corner** of the main window; **never** in the capture popup; **never takes focus**; **never appears mid-typing**; each tip shows **once** and never again once dismissed; **at most one tip per session** (**D-125:** two, at least 10 minutes apart); **"Don't show tips"** on the card and in settings (APP-11).
- Pattern detection is **local only**: counters in app data, no telemetry (APP-09).
- **D-123 (built, 0.8.18):** as decided; the words (decided in D-125); Settings → About: Tips (Show tips) with Reset tips.
- **D-125 (decided, 0.8.20):** at most **two tips a session**, at least **10 minutes** apart, so they never come back to back (a pattern inside the ten minutes still counts; its tip comes the next time it happens after them). The card sits as far from the window's right edge as from its bottom.
- **D-118 (decided):** a tip shows 2 s after its pattern, while nothing is being typed and no menu, picker or dialog is open; never during the walkthrough, triage or What's new, nor in the session the walkthrough ran. Bottom right of the main window, above the toasts, fading in; stays until × or **Got it** or the window is hidden (no timeout). It counts as shown after about 3 s visible, or when closed; hidden sooner, it can come again. Settings has **Reset tips** next to **Replay walkthrough** (all tips eligible again, the empty quick note's hint too, and Don't show tips off; D-119); both are palette commands.
- **D-113 (decided):** the first set of nine tips (shorthand over the composer's buttons, Ctrl+K over the mouse, capture from anywhere, ↑/↓ and Space, `/` in notes, Trash keeps deleted items, own short links, triage for a full Inbox, the side panel on a wide window); listed in D-113.
- Milestone M8.

### APP-15 — What's new (v1, D-61)
- After an update, the **first open** shows what's new once, with the same spotlight highlights (APP-13). It stays available later from the palette and Settings → About (D-117: no tray item).
- **D-113 (decided):** one floating card (the spotlight's card, no dim) with the notes of every version since the last one seen, scrolling when long; Close. Also from the tray and the palette (the latest notes).
- **D-121 (built, 0.8.16):** from Settings → About and the palette it shows every entry, newest first. **D-122:** a reading-size card (620 px) with **Got it** at the bottom. **D-125 (changes D-113's no dim):** the app is dimmed behind it, as in the walkthrough, and takes no clicks until Got it, Esc or × closes it.
- **Every version bump comes with short release notes** (D-117: the plain-language `whats-new.md` is what this shows). **D-64:** versioning starts with the next build: **0.4.x during M4** (the minor number is the milestone), bumped for every build handed out, each with a short entry in [`docs/release-notes.md`](release-notes.md), which the app bundles for What's new.
- **D-117 (decided):** a fresh install (no `settings.json`) gets the walkthrough; an existing one gets What's new once on the first start of a new version (in the main window, the next time it opens), every version since `lastSeenVersion`, newest first. It shows **[`docs/whats-new.md`](whats-new.md)**, not the release notes: per version 2–5 plain-language highlights (what's new and how to use it), written with every version bump; `release-notes.md` stays the detailed log. Esc or × closes it; the palette ("What's new") and Settings → About open it again. An install from before What's new sees only the current entry, which sums up the 0.8 line; a build with only small fixes may have one line (D-118).
- Milestone M8 (release notes from 0.4.0 on).

---

### SYNC-01 — Cloud sync (Later, D-78)
- Opt-in sync of the Flint folder through Google Drive first, then OneDrive (Microsoft Graph); no iCloud. Sign-in with the provider's own auth (OAuth with PKCE, loopback redirect); tokens kept with Electron `safeStorage`; Google access limited to files Flint creates (`drive.file`).
- Automatic or manual sync, by preference. Merged per task by ID, with tombstones for deletions; never conflict copies.
- When enabled it changes the no-network promise (APP-09) for this feature only.

## 11. CLI (Later)

### CLI-01 — Add tasks from the terminal (Later)
- Example: `flint add "null ref in tenant resolver" -p high`.
- Supports the same shorthand as the capture box (CAP-03) and a target list.
- Cheap to build: it writes to the same markdown files using the **same core package** as the app; the running app picks up the change via the file watcher (DATA-06).
- Lets AI models and agents (e.g. Claude) add tasks too.
- Command name: `flint`, matching the product name (Q-07, **Proposed** in D-135).

### CLI-02 — Machine-friendly output (Later, with the CLI)
- `flint list --json` and **stable exit codes**, so models and scripts can read tasks, not just add them.

---

## 12. Look and feel

Cross-cutting visual and input behaviour from daily use (31 Oct 2026, D-52 to D-63). Visual details in [09](09-visual-design.md).

### UI-01 — Cursors like native Windows (v1, D-52)
- The normal **arrow cursor on all controls**: buttons, checkboxes, the composer's tools, rows, sidebar items, menus. The text cursor in text fields. The **hand only on real links**. No cursor flicker when moving across controls.
- **D-68:** the I-beam shows **only over text that is editable at that moment**: text fields, a task being edited, the note editor. Everywhere else the arrow, task titles, reminder times, hints and read-only text included.
- **D-69 (bug):** the I-beam still flickered anywhere over the composer's and the note's text boxes; it must be steady.
- Milestone M4.

### UI-02 — Thin scrollbar at the window edge (v1, D-52)
- A thin scrollbar designed in the tokens (09 §8), at the **right edge of the window**, not next to the content column. No arrows, no visible track.
- **D-76:** the scrollbar's place is always reserved (a stable gutter), so a page that gains or loses a scrollbar (a task list → a note) never shifts. **D-77:** the scrollbar shows only when the content really overflows, and never flashes during transitions (an animation never makes the page overflow).
- Milestone M4.

### UI-03 — Row hover and selection (v1, D-52)
- A hovered row next to the selected row must not stack two rounded backgrounds. The selected row keeps its look under the pointer; hover is a quieter background that never touches another row's background (09 §6, §8).
- Milestone M4.

### UI-04 — Minimal motion for selection and new rows (v1, D-56)
- The selection highlight moves between rows and new rows appear with the motion specified in 03 §5 and 09 §9 (instead of jumping). No gimmicks, nothing slower than ~150 ms, off with reduce-motion (APP-12).
- **D-65:** completing a task plays the specified completion animation (09 §9: fade and slide, then it moves to Completed) instead of the row just disappearing.
- **D-65:** switching lists or pages: the content fades in while rising a few pixels (~120–150 ms), and the sidebar's highlight glides to the new list like the row selection. Off with reduce-motion.
- Milestone M4 (the switching transition and completion animation at the start of step 5).
- **D-75 (supersedes the ~150 ms limits above and D-67's bands): motion never delays input.** Every action takes effect at once; animations are interruptible and retarget smoothly on new input; nothing waits for an animation to finish. With that, fuller defaults: selection ~200 ms, list and page switching ~280 ms, completion ~400 ms in all (03 §5, 09 §9).
- **D-76 (tuning):** completion ~360 ms, list and page switching ~320 ms. Animated as well: a new task appearing (it opens up its place), un-completing (the row leaves Completed with one animation and enters the open tasks with another), menus (a subtle fade) and pickers (scale and fade from their button), inline bodies opening and closing, pages opening and closing, and editing starting and ending. **D-77:** also deleting and duplicating (and undoing them), consistent with completion; the undo toast leaving; collapsing and expanding Completed (the scroll position stays anchored); and a fuller, still subtle, editing-field motion. Pickers open and close visibly.

### UI-05 — Fonts: Onest, FiraGO for Georgian, Geist Mono (v1, D-60)
- **Onest** for UI and text. **FiraGO** for Georgian, applied only to Georgian characters (`unicode-range`), so Latin and Cyrillic stay Onest. **Geist Mono** for times, counts, chips, keycaps and code.
- All bundled with the app under the SIL Open Font License, never fetched (APP-09). Supersedes the font part of D-17.
- Milestone M4 (with the mockups and screenshots re-rendered).

### UI-06 — Grayscale syntax highlighting (v1, D-63)
- Code is highlighted by **lightness, weight and italics**, plus the cool accent for strings; no hues. Token spec in 09 §11 and `design/tokens.css`; reference mockup 07.
- Milestones: the capture popup's JSON / stack-trace highlighter and rendered task bodies in M4; the CodeMirror theme for all languages in M5 (NOTE-04).
- **D-65:** the capture popup stays with JSON and stack traces only (it must stay small, CAP-10). Rendered task bodies in the main window get **full-language highlighting when the M5 editor arrives**, reusing its language parsers; until then they highlight JSON and stack traces like the popup. Stack traces are recognised in the common formats (.NET, Java, JavaScript/Node, Python, Go): the exception line bright, frames dimmed, `file:line` underlined.

### UI-07 — App icon sizes and the in-app logo (v1, D-52)
- The taskbar icon looked noticeably smaller than other apps' icons (fine on the desktop). Cause, found when building it: the near-black tile disappears against the dark taskbar, so only the leaf (about 60 % of the slot) shows, and the sizes electron-builder downscaled from one 256 px image also lost the tile's rim. The app icon becomes a multi-size `.ico` drawn from the hand-tuned small logos, with a visible rim and a larger leaf (09 §8).
- The in-app logo and the "Flint" wordmark in the sidebar get slightly bigger.
- **D-65 (0.4.1 feedback):** still too small next to other apps' icons, whose mark fills the square edge to edge. For 16–48 px the mark fills nearly the whole square. ~~The reminder toast also shows Flint's logo larger, as its `appLogoOverride` image.~~ (Removed again by D-68.)
- **D-68 (0.4.4 feedback):** the leaf overflowed the dark tile. The tile scales with the leaf: the whole icon fills the square, with the leaf inside the tile, at every small size.
- **D-69 (0.4.5 feedback), one rule instead of more back and forth:** the dark tile fills the **entire icon square** (full-bleed), with the corner radius Windows uses for app icons (2 px at 48 px, i.e. size / 24, per Microsoft's icon grid) and a 1-pixel rim on its edge so it stays visible on the dark taskbar; the leaf sits **proportionally** inside it, its tips and outline spanning 72 % of the tile's diagonal, at every size from 16 to 96 px. The 256 px image stays the master logo. Details in 09 §8.
- **D-74 (0.4.6 feedback, replaces the corner radius of D-69):** size / 24 made the tile nearly square at taskbar sizes and lost the logo's rounded corners. The tile keeps **the corner proportions of the master logo** (`flint-icon-512.svg`: 108 / 480, about 22.5 % of the side) at every size, still full-bleed with its rim, and the leaf at taskbar and tray sizes is **about 10 % smaller** (65 % of the diagonal), so it doesn't look like it touches the edge from a normal laptop distance. The in-app logos stay as they are.
- **D-148 (9 Nov 2026):** the small icons kept only about six shapes of the rock. They now use the master's facets at every size with a hairline outline, drawn at 16, 24, 32 and 48 px, and each `.ico` size comes from the nearest of them instead of stretching the 24 px drawing up to 96 px. Details in 09 §8.
- Milestone M4.

### UI-08 — Right-click menus everywhere (v1, D-55)
- Every object has a right-click menu with relevant actions: tasks, lists and notes in the sidebar, the sidebar's background, the composer.
- **Every text field** keeps the standard **Cut / Copy / Paste / Select all** menu (Electron shows none by default).
- **D-68:** the mouse highlights an item only while it is over the menu; leaving the menu clears it. Keyboard navigation keeps its highlight.
- **D-69:** the same in every picker (Move to, priority, list, the reminder presets), which still kept the mouse's highlight. **D-74:** the highlight follows the last input used: leaving with the mouse leaves no highlight; an arrow key or typing brings it back from the row the mouse was last on.
- **D-72:** "Duplicate" for tasks, lists and notes; "Convert to note" / "Convert to task list" for lists and notes (LIST-04).
- **D-78:** a task's priority entries become one **"Priority ›"** submenu (High, Medium, Low, None with their keys), so the menu stays short. Menus can have submenus (→ opens, ← closes).
- **D-79:** moving the mouse diagonally toward an open submenu never closes it: the safe-triangle (menu-aim) rule, with a ~300 ms grace delay as fallback. The task menu also gets **Indent** and **Outdent** (Tab / Shift+Tab), and **Format as code** for a body with unfenced code or JSON (it fences it deliberately; old text is never re-detected on render).
- Menus show only actions that exist; items join as features land (e.g. Star to Today and Reminder in M6).
- **D-64:** menus are drawn **in the page**, with the tokens, **everywhere**, the capture popup included: while a menu is open there, the popup makes room for it (e.g. by enlarging its transparent margin or window). The native dark Windows menu is only a fallback if that genuinely doesn't work, and Davit is told if it comes to that.
- Milestones: M4; note-specific items (NOTE-02) in M5.
- **D-91, the task menu in groups:** Complete · Edit · Open as page / Priority ▸ · Reminder ▸ · Pin / Add ▸ (Subtask, Notes) / Move to… · Duplicate / More ▸ (Indent, Outdent, Format as code, Convert to note) / Delete, shortcut hints kept (**Proposed:** Reminder ▸ holds Set… or Change… and Turn off/on).

### UI-09 — Auto-closing brackets and quotes (v1, D-57)
- Like Obsidian: typing `(` inserts `()` with the cursor inside; typing `)` right before an auto-inserted `)` just steps over it. Same for `[]`, `{}`, `""`, `''` and ``` `` ```.
- Quotes pair only when **not directly after a letter or digit**, so "don't" works.
- **Proposed:** Backspace right after an auto-inserted pair removes both; with text selected, typing an opening character wraps the selection. Nothing pairs directly before a letter or digit, so typing `(` in front of a word doesn't add a stray `)` (as most editors do).
- Milestones: the composer, the capture popup and task editing in M4; the note editor (CodeMirror) in M5.

### UI-10 — A motion pass over everything (v1, D-67)
- **D-133 (done, 0.8.29):** a motion census (`e2e/motion.spec.ts`) drives every kind of action and fails on one that should move and doesn't; the gaps it found are fixed (the pin pop for P and the menu, the slash menu, Settings' panels closing, Trash's question and emptied groups). Instant by decision: reduce-motion, typing, the popup's first frame, opening a list's rows.
- Smooth, minimal opening, closing and state transitions for every button, menu, picker, popup and row action, following the motion rule of 03 §5 (D-75: motion never delays input; fuller default durations). No gimmicks; off with reduce-motion and scaled by the animation-speed setting (APP-11).
- Milestone: M8 at the latest; done earlier wherever it is cheap, as items are touched.

- **D-89, standing rule:** every UI change or action added comes with its motion; a feature isn't done without it (03 §5, CLAUDE.md).
### UI-12 — Wide screens and interface size (v1, D-81)
- **D-82 (supersedes D-81's growing column):** task lists, notes and task pages share one centred column of at most 820 px with 40 px sides, as before 0.4.16. A right-side panel for wide screens is being designed by Davit (not specified yet; nothing is built for it).
- **App zoom:** Ctrl+= (Ctrl++), Ctrl+− and Ctrl+0 zoom the main window in Chrome's steps (67, 75, 80, 90, 100, 110, 125, 150, 175, 200 %), remembered **per display** (a laptop panel and a monitor each keep their own); the level shows briefly in a small pill when it changes. The capture popup stays at 100 % (**Proposed**: it has its own fixed size and latency budget).
- **M8:** Settings gets an **Interface size** option for the same zoom (APP-11). **D-102 (0.8.0):** exact levels (80 to 150 %), each setting exactly that level on this display.

### UI-11 — Flint's own text selection colour (v1, D-69)
- Selected text uses Flint's colour instead of Windows blue: a **soft translucent gray based on the accent** with **white text**, in text fields and selectable app text alike (`--fl-selection`, `--fl-selection-text`, 09 §8).
- Milestones: M4; the note editor (CodeMirror) in M5.
