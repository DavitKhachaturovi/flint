# 04 — Data & Storage

All user data is plain markdown in a folder the user chooses. No database, no server, no account. (**D-161:** Google Drive sync, SYNC-01, is opt-in and goes only to the user's own Drive; §7.)
The task-line format (§3) uses the established **Dataview inline-field convention**, chosen for reliable parsing (D-20, decided). Changing it later requires a migration of users' files, so treat it as stable.

---

## 1. Principles

1. **Plain markdown, human-readable.** Every list is a `.md` file that opens correctly in Obsidian, VS Code, and GitHub (standard `- [ ]` / `- [x]` checkboxes).
2. **Tolerant of outside edits.** Files may be edited by the CLI, by Claude via the CLI, or by a text editor. Flint must parse what it finds, fill in anything missing (e.g. task IDs), and never destroy content it doesn't understand.
3. **User data in the Flint folder; machine/UI state in app data.** The Flint folder contains only content. Window positions, collapsed sections, drafts, and settings live in `%APPDATA%\Flint`. (Lesson from Obsidian, whose constantly changing `workspace.json` lives inside the vault and causes sync conflicts.)
4. **Never lose data.** Atomic writes, trash, snapshots, undo (DATA-01…05).
5. **Autosave.** There is no Save button. Every change is saved automatically (**Proposed:** debounced ~300 ms; immediately on blur/hide/quit).

---

## 2. Flint folder layout (Proposed)

```
<Flint folder>/                 ← user-configurable (DATA-07); default %USERPROFILE%\Flint (D-24)
  Inbox.md                      ← always exists (LIST-03); frontmatter id: inbox (D-23)
  Unicorn.md                  ← a task list
  Meeting notes.md              ← a note
  attachments/                  ← images/videos (MEDIA-02), referenced by relative paths
  .flint/
    meta.json                   ← per-task bookkeeping (created, last touched), keyed by task ID
    today.json                  ← Today's manual order (task IDs), pin days, the rollover prompt's last answer (D-90)
    focus.json                  ← Focus's sprint: task IDs in order, each with its estimate and count (FOCUS-02, FOCUS-03, D-170)
    sidebar.json                ← sidebar groups and the manual order of lists, notes and groups (LIST-05, LIST-06, D-73)
    agents.json                 ← AGENT-06 (D-185): the lists, notes and groups hidden from AI agents: { "flint": 1, "hidden": { "<list or group ID>": "<ISO time of the change>" }, "shown": { … } } (Proposed format; `shown` keeps un-hiding times for sync's later-change rule)
    archive/                    ← auto-archived completed tasks, one task list per list: `<list ID>.md` (TASK-06, D-88)
    trash/                      ← deleted lists and tasks, with deletion time (DATA-02)
```

App data (not in the Flint folder):

```
%APPDATA%\Flint\
  settings.json                 ← all settings (APP-11), incl. Flint folder path and hotkeys; `reminderSound` (Flint's own chime, off by default, D-94); `rolloverPrompt`, `snapshotEveryMinutes`, `keepHourlyHours`, `keepDailyDays`, `animationSpeed` (D-100); `linkPatterns` (each with its `examples`, D-105) and `builtInLinksOff` (the built-in recognizers turned off, by id: `ado-work-item`, `ado-pull-request`, `github-issue`, `github-pull-request`, `jira-issue`; D-105)
  window-state.json             ← window sizes/positions per monitor setup, and whether maximized (APP-05, D-96; D-109: mini mode's too, one copy for all windows)
  ui-state.json                 ← collapsed sections and sidebar groups, the sidebar sort (LIST-06), last opened list, guidance state: walkthrough done, tips shown, last version seen (APP-10, APP-14, APP-15)
  (the window's local storage)  ← how often each palette command is used, for "most used" (D-106; a convenience, safe to lose)
  tips.json                     ← how often each first-few-times tip was shown (D-107, D-109: shared by both windows; safe to lose: a tip shows again)
  mini-state.json               ← mini mode's tab, the quick note it shows, and per monitor setup the corner it is anchored to (D-109)
  focus-state.json              ← Focus's timer: the mode, when the session ends (or the time left while paused), the day's session number (FOCUS-01, D-170; machine state, never synced)
  drafts.json                   ← capture popup draft (CAP-08)
  draft-attachments            ← images pasted into the draft, until the capture is saved (CAP-06)
  reminders-state.json          ← last-fired bookkeeping for missed-reminder recovery (REM-07)
  sync\                         ← Google Drive sync: the encrypted account, state.json, the merge bases (SYNC-01, §7, D-161)
  agent-token                   ← AGENT-01 (D-185): the 256-bit token agents' requests must carry; only while agents are on, renewed at each start and turn-on
  agent-changes.json            ← AGENT-07 (D-185): the last 100 agent changes or 7 days (label, agent, time, inverse operations, the Trash files they made), for Recent agent changes and their Undo
%LOCALAPPDATA%\Flint\
  snapshots\                    ← local snapshots (DATA-04)
  logs\                         ← local logs only, never uploaded (APP-09)
```

- File names are the list names, sanitized for Windows (illegal characters replaced). Renaming a list renames its file.
- Each list also has a stable `id` in its frontmatter, so renames don't break references.
- **Which files are lists (D-23):** the top-level `*.md` files only. Subfolders and dot-folders (`.obsidian/`, `.git/`, `.flint/`, `attachments/`) never contain lists.
- The daily-use feedback of 31 Oct 2026 (D-52 to D-63) changes nothing in the file format: inline markdown in titles, page view, overdue reminders and the sidebar order are display or app-data matters. Deleted lists go to Trash storage like deleted tasks (D-50, D-55).
- **Files Flint didn't create (D-23):** a file without Flint frontmatter (or without `mode`) is shown as a note. Flint adds `flint`, `id` and `mode` only when it next saves that file because the user edited it in Flint; other frontmatter keys are preserved byte-for-byte.
- **Inbox (D-23, Proposed):** the list with the reserved `id: inbox`. If no list has it at startup, Flint adopts `Inbox.md` if it exists, otherwise creates it.
- **Duplicate list IDs (D-23, Proposed):** e.g. Explorer's "Unicorn - Copy.md" (which also duplicates every task ID) or two files claiming `id: inbox`. The older file (by creation time, then path) keeps its IDs; the copy gets new IDs on its next save.
- **Obsidian vault as the Flint folder (D-23):** if the chosen folder contains `.obsidian/`, onboarding and settings suggest a `Flint` subfolder inside the vault instead; the user can still choose the vault root.
- **OneDrive (D-24):** the default folder `%USERPROFILE%\Flint` is outside OneDrive Known Folder Move (which redirects Documents). If the chosen folder is inside a OneDrive root (`%OneDrive%`, `%OneDriveCommercial%`, `%OneDriveConsumer%`), Flint warns that it is synced and that sync isn't supported yet, and allows continuing. **Proposed:** a file that looks like a OneDrive conflict copy (same list id as another file, name ending in `-<MACHINENAME>`) shows a notice saying so instead of appearing as a normal extra list.

---

## 3. Task-list file format

Task metadata uses **Dataview bracketed inline fields**: `[key:: value]`. This is an existing, widely used plain-text convention from the Obsidian ecosystem (the Dataview plugin, and the Obsidian Tasks plugin's "Dataview format", which reads `[priority:: high]`, `[completion:: …]`, `[created:: …]` and similar). Files therefore stay readable in Obsidian and render as normal checklists in VS Code and GitHub.

**Compatibility, stated honestly (D-21):** queryable with Dataview; Obsidian Tasks (Dataview format) reads `priority` and `id` only, because it reads fields only at the end of the line, stops at the first field it doesn't know, and accepts date-only values. Obsidian compatibility is a bonus, not a goal.

```markdown
---
flint: 1
id: l7c2
mode: tasks
---
- [ ] Fix null ref in tenant resolver [reminder:: 2026-10-30T15:00] [priority:: high] [id:: k3f9]
    Stack trace from staging:
    ```
    NullReferenceException at TenantResolver.Resolve(...)
    ```
    - [ ] Add regression test [id:: m2p1]
- [ ] Ask about staging DNS [pinned:: true] [id:: q8x2]
- [ ] Update CI agent image [priority:: low] [id:: r5t0]

## Completed
- [x] Rotate service principal secret [completion:: 2026-10-28T14:03] [priority:: medium] [id:: a1b2]
```

### Why this format is reliable
The earlier draft used bare trailing tokens (`!high`, `⏰…`, `★`, `^id`) read backwards from the end of the line. That is fragile: a title that ends in `!high` or contains `★` is ambiguous, and emoji can be stored differently across systems. Bracketed fields fix this:
- **Explicit boundaries.** A field is exactly `[` key `::` value `]`. No guessing where the title ends.
- **Order-independent, and position-independent for Flint's own fields.** Flint's fields are recognised anywhere in the line when their value is valid; unknown fields only at the end of the line, so developer text such as `[Vec::new]` stays title text (D-21). Flint writes all fields at the end, in a fixed order.
- **Extensible and lossless.** Unknown keys (from Dataview, Obsidian Tasks, or a future Flint version) are kept and written back unchanged.
- **Plain ASCII keys, ISO 8601 values.** No emoji encodings, no locale-dependent dates.
- **Human-editable.** Someone editing the file by hand (or Claude via the CLI) can see and change every field.

### Fields
| Field | Values | Meaning | Feature |
|---|---|---|---|
| `id` | written: `[a-z0-9]{4,6}` (6 from 1.5.0, D-161); read: `[A-Za-z0-9_-]{1,32}` (D-21, D-29) | Stable task ID, unique within the Flint folder: lists, notes, archive and Trash (D-29) | Today, reminders, undo, CLI |
| `priority` | `low` / `medium` / `high` (absent = none) | Priority. Same value names as Obsidian Tasks (which also has `lowest`/`highest`; Flint reads those as `low`/`high`). | TASK-03 |
| `reminder` | written: `YYYY-MM-DDTHH:MM` (local time); read: also `YYYY-MM-DD` and `…:SS` (D-29). A date-only value means 10:00 (D-69; 09:00 before, Q-02). | Reminder time | REM-01 |
| `muted` | `true`, any letter case (absent = the reminder is on) (D-66) | The reminder is turned off: kept, shown faint, never fired | REM-12 |
| `pinned` | `true`, any letter case (absent = not pinned). **D-85:** `today:: true` (the earlier name) is read as `pinned` and written as `pinned` when Flint next writes that line | Pinned (the Today view in M6) | TODAY-01 |
| `completion` | written: `YYYY-MM-DDTHH:MM`; read: also `YYYY-MM-DD` (what Dataview and Obsidian Tasks write) and `…:SS` (**Proposed**) | Completion timestamp (completed tasks only) | TASK-06 |

The app never shows fields as text; it renders them as the stripe, bell, pin, and so on (unknown fields are kept but not shown). The capture shorthand (`!h ##list @15:00`, CAP-03) is input syntax only and is never written to disk.

### Parsing and writing rules
- **Tolerant reader (D-21):**
  - **Flint's own fields** (`priority`, `reminder`, `muted`, `pinned` (read also as `today`, D-85), `completion`, `id`) are recognised anywhere in the line, in `[]` or `()`, with or without a space after `::`, **only when the value is valid** for that key (see Fields).
  - **Unknown fields** are recognised only in the trailing run of fields at the end of the line, and only with whitespace after `::` (`[due:: 2026-11-02]`). Anywhere else, `[…::…]` and `(…::…)` are title text: `check [Vec::new] behaviour` keeps its text, visible and in place.
  - Nothing inside an inline code span is ever a field.
  - A trailing Obsidian block ID (`^a1b2`) at the very end of the line doesn't break the trailing run (D-29).
- **Canonical writer (D-21, D-66):** `[]` fields at the end of the line in the order `reminder`, `muted`, `pinned`, `completion`, `priority`, `id`, then unknown fields in their original order, then the block ID if there is one. Values of fields that didn't change keep their raw text, so `[priority:: highest]` is not rewritten as `high` (D-29).
- **Only touch what changed.** Lines Flint didn't modify are written back byte-for-byte. Non-task content (headings, paragraphs, plain bullets, blank lines, HTML comments) is preserved exactly and stays in place (D-22). Parsing and serializing an untouched file returns it byte-for-byte, including one with missing IDs: repair only happens as part of a save caused by an edit.
- **Missing IDs** (lines added by hand or by the CLI) are assigned on Flint's next save of that file. Until then the task has a provisional in-memory ID that stays stable across re-parses (D-29).
- **Duplicate IDs** (e.g. a line copy-pasted in a text editor): within a file, the first keeps the ID and later ones get new IDs; across files, the older file (by creation time, then path) keeps them (D-23, **Proposed**).
- **Invalid values** (e.g. `[priority:: urgent]`, a malformed date): not a field. The text stays in the title, visible, never silently dropped or hidden; the task has no priority / no reminder (D-21).
- **Repeated Flint fields (D-29):** the first valid occurrence of a key is the field; later ones stay visible as title text. When Flint rewrites such a line it escapes them (`\[priority:: low]`) so they can't turn into the field; in general a written line is checked to read back as the same task, with the least escaping needed. **D-153:** a title whose escaping needs more than 16 passes (about 16 layers of nested field-like text) instead gets every bracket with `::` after it escaped, in one pass; it reads back and renders the same.
- **Checkbox states (D-29):** `[ ]` is open, `[x]`/`[X]` is completed. A task completed outside Flint (`[x]` without `completion`) gets `completion` on the next save of that file. A `completion` field on an open task is ignored and kept until Flint changes that task's completion state. Items with other status characters (Obsidian Tasks' `[-]`, `[/]`, …) are not Flint tasks: they are non-task content, shown read-only and never modified.
- **List markers (D-29):** `- [ ]`, `* [ ]` and `+ [ ]` items are tasks (the marker is kept as written). Numbered `1. [ ]` items and plain bullets without a checkbox are non-task content (D-22). Lines inside fenced code blocks or HTML comments are never tasks.
- **Format version:** `flint: 1` in frontmatter. A file with a higher version than the app understands is opened read-only with a notice. So is a file whose `mode` is neither `tasks` nor `note` (D-29); a missing `mode` means note (D-23).
- **Required tests (M1):** round-trip tests (`serialize(parse(file)) === file` for untouched files), property-based/fuzz tests over random titles (including `::`, `#`, brackets, backticks and non-Latin text), fields, bodies and line endings, and fixtures of hand-edited, VS Code-edited and Obsidian-edited files (tabs, block IDs, Obsidian Tasks fields, CRLF, BOM).

### Task IDs
- **Why IDs are mandatory:** Today holds references, reminders point at tasks, undo restores tasks, and the CLI edits files the app has open. All of that breaks if tasks are identified by line position.
- Stored as the `id` field (not Obsidian's `^block` syntax, so there is one convention for all metadata).

### Body and subtasks
- **Untitled tasks (D-45):** a task line may be empty apart from its checkbox and fields (`- [ ] [priority:: high] [id:: k3f9]`) when its body says what the task is, e.g. a captured stack trace or JSON (fenced) or only a screenshot. This is valid and round-trips byte-for-byte; Flint never writes a generated title. Where a short label is needed (reminder toasts, Today reminder cards, search results) it is made when shown (`taskLabel`: `JSON · died_at`, `Stack trace · TypeError: …`, `Screenshot`). Lists show such a task as a collapsed code row (kind, line count and a one-line peek), expandable.
- A **task body** (TASK-05) is the indented, non-list-item content directly under a task (standard markdown list-item continuation), including fenced code blocks and media links.
- A **subtask** (TASK-04) is an indented `- [ ]` item directly under a top-level task. Only one level is valid; content indented under a subtask, including deeper list items, is that subtask's body (**Proposed**).
- **Indentation (D-29):** read as tabs, 2 spaces or 4 spaces. Flint writes 4 spaces, or tabs if the file already indents with tabs.

### Order
- **Line order is the manual order.** Dragging or Alt+↑/↓ rewrites line order (TASK-01). Temporary sort by priority never touches the file (TASK-08).
- **Non-task content stays in place (D-22).** Moving a task moves only its block (line, body, subtasks), placed next to the target task; non-task blocks never move as a side effect.
- **New tasks "at the top"** go just before the first task, not above a heading or paragraph the file starts with (D-22).
- Active tasks first, then a `## Completed` heading followed by completed tasks (most recently completed first, **Proposed**). The Completed section starts at the first level-2 heading whose text is "Completed" (any letter case); Flint appends one when the first task is completed (D-29).
- Open or completed comes from the checkbox, not the position: a task checked by hand above the heading shows as completed, and its line only moves when Flint changes that task (D-29).

### Bookkeeping in `.flint/meta.json` and `.flint/today.json`
- Rule: **everything that matters lives in the markdown line; side files hold only bookkeeping that is harmless to lose.**
- **D-185 (AGENT-01):** `meta.json` entries (tasks and notes) may also hold `createdBy` and `touchedBy`, the name of the AI agent that created or last changed the item (written only for agent changes; an edit by the user removes `touchedBy`). Optional, so older Flint versions keep them (unknown keys are kept).
- `meta.json`, per task ID: `created`, `lastTouched` (any edit, move, priority change, completion), and **D-85** `captured` (when it came from the capture popup, for Recently captured); per note ID its `created` (first sighting). `lastTouched` must be recorded from v1 so stale-task fading (TASK-13, Later) needs no migration. Missing entries are created on first sight. For completed tasks also `completedAfter`: the ID of the task that preceded it when it was completed, so un-checking can return it to its previous position (TASK-06, **Proposed**).
- `today.json`: the manual order of Today. Today membership itself is the `pinned` field in the line (D-85), so losing this file only loses the order. **D-90 (Proposed format):** `{ "flint": 1, "order": [task IDs], "pinnedOn": { task ID: "YYYY-MM-DD" }, "answered": "YYYY-MM-DD" | null }`: the order, the day each task was pinned (for the rollover prompt; a pin first seen counts as pinned that day) and the day the prompt was last answered; unknown keys are kept.
- `focus.json` (D-170): Focus's sprint, the one place a task's membership is kept (never in its line, so the format doesn't change). **Proposed format:** `{ "flint": 1, "tasks": [{ "id": task ID, "estimate": 1, "count": 0 }] }` in the sprint's order; a task no longer found (deleted, its list gone) isn't shown but stays in the file, so undoing the delete brings it back into Focus; **Clear finished** drops it (D-171); unknown keys are kept. Losing it empties the sprint and its counts, never a task. Per PC: not synced (like `today.json`).

### Sidebar groups in `.flint/sidebar.json` (LIST-05, LIST-06, D-73, Proposed format)
- One file for the sidebar's groups and its manual order, kept in the Flint folder so it travels with the lists. Groups are not folders: the list files stay flat (D-23).
- Shape: `{ "flint": 1, "items": [ { "group": "g-k3f9", "name": "Work", "lists": ["unicorn", "standup"] }, { "list": "errands" } ] }`. `items` is the one manual order of groups and ungrouped lists together, so a group can sit between lists (D-74); `lists` is the order inside a group. Under a non-manual sort the groups keep these positions (LIST-06). Lists are named by their frontmatter `id`, or by file name for a file without a Flint header (D-23).
- Tolerant reader: unknown IDs are skipped, a list that isn't mentioned shows ungrouped at the end, unknown keys are kept. Written atomically (DATA-01).
- Losing the file loses only the grouping and the manual order, never a list (the bookkeeping rule above). Which groups are collapsed and the sort choice are machine UI state in `ui-state.json`.

---

## 4. Note file format

```markdown
---
flint: 1
id: n4d8
mode: note
---
# Sprint planning 29 Oct

- Discussed staging DNS
- [ ] Davit: check VPN gateway logs
```

- Free-form markdown. Checkboxes in notes are plain markdown checkboxes; they become tasks only via conversion (LIST-04).
- **Numbered lists (D-142):** as in 1.0.1 and CommonMark: a numbered line right after a paragraph line stays part of that paragraph unless a blank line separates them (only `1.` interrupts a paragraph). Flint doesn't renumber lists itself (CodeMirror's Enter continues a list and numbers the items after it), and Tab / Shift+Tab indent by two spaces. D-141's parser extension, renumbering and nesting (grill Q4, Q6, Q7) were built for the first 1.1.0 preview and taken out after Davit's test.
- **Line endings (D-141, Proposed; built in 1.1.0):** the note editor keeps a note's line endings: a note written with `\r\n` stays so after edits; one that mixes them gets its dominant one on the first edit, as task lists do.
- **Tables (NOTE-10, D-141, grill Q10; the model built for 1.2.0):** where a row has no edge pipe, an emptied first or last cell, or a first cell that starts like a block (`* `, `- `, `# `, `1. `…), gets that edge pipe written too, so the table keeps its shape (**Proposed**). a cell edit changes only that cell's bytes, its padding kept (an empty cell gets one space on each side of the new text); `|` in a cell is written `\|`, pasted line breaks become spaces; a short row grows only up to the edited cell, and cells beyond the header's count are kept untouched; new rows copy the row above's padding, always with both edge pipes (an empty first or last cell needs them: `  |  ` would read as no cells; D-144, **Proposed**), a new column gets an empty header and `---`; the line endings are kept. Flint never re-pads or re-aligns a table by itself; **Align table** (right-click menu, palette) does it deliberately for the whole table, in one undo step. **D-144 (Proposed):** a table ends at a blank line (GFM's "lazy" rows), so where an edit in the note editor (Source mode too) would make a line without a pipe a new row, or join it onto the last row, Flint writes that blank line before it in the same change (in a quote, a `>` line); Insert ▸ Table leaves one before the text after it. A row's prefix is its indentation and, in a quote, the quote's marks: a quoted table's cells start after the `> `, and its new rows copy it. Flint's parser stays GFM's: a file with a line right under a table shows it as a row, as GitHub does.
- Converting a task list to a note keeps the `[key:: value]` fields on checklist lines so converting back is lossless (LIST-04). While a list is a note, those fields are inert (no Today membership, no reminders) and their IDs stay reserved (D-29).
- A `.md` file without Flint frontmatter is a note (D-23). When Flint adds its header on the first save caused by an edit, it inserts `flint`, `id` and `mode` into the existing frontmatter block (or creates one) without changing the other keys.

---

## 5. Attachments (MEDIA-01…04)

- Stored in `attachments/` with unique file names (e.g. `2026-10-29-153012-k3f9.png`).
- Referenced with **relative** markdown links (`![](attachments/…png)`), so moving the folder never breaks them.
- **D-84 (MEDIA-03):** a file over 25 MB is not copied: it is linked where it is, with a `file:///` link (**Proposed**), and shows a **Linked** badge with **Copy into Flint**. Linked files are outside the Flint folder, so snapshots, export and sync don't carry them; a moved or deleted original shows **File not found**.
- Large-file warning above a threshold (MEDIA-03).
- **Orphan cleanup:** when content leaves Trash permanently, any attachment not referenced by a list, the archive, or Trash is deleted (MEDIA-04).

---

## 6. Data safety mechanics

### Atomic writes (DATA-01)
- Write to a temporary file **in the same directory** (same volume), flush to disk, then rename over the original.
- Windows specifics: antivirus, the search indexer or OneDrive can briefly lock files; retry the rename with short backoff instead of failing.
- A crash or power loss mid-save leaves either the old or the new file, never a corrupted one.
- **Re-read before writing (D-29):** if the file changed on disk since Flint last read it, Flint re-parses it and re-applies its pending operations by task ID, then writes. A CLI or Claude write is never overwritten by a stale in-memory copy.
- **Unreadable files (D-24, Proposed):** a list that is cloud-only (OneDrive Files On-Demand) or locked shows that plainly on the list, never as an empty list.

### Changing the Flint folder (DATA-07, D-104)
- **Move:** every file in the Flint folder (lists, notes, `attachments/`, `.flint/` except its `tmp/` scratch) is copied to the new folder, never over an existing file, and each copy is checked against the original (size and SHA-256) before `settings.json`'s `flintFolder` changes; on any failure the copies are removed and nothing changes. The old folder is left as it was, as a backup.
- **Start fresh:** the new folder gets a new Inbox at the next start (as a first start does); **Open:** the folder's own lists are used as they are. Either way the old folder isn't touched.
- Snapshots (`%LOCALAPPDATA%\Flint\snapshots`) are of whichever folder is in use; older ones stay until they expire. Flint restarts to switch.

### Quick notes (NOTE-08, D-99)
- A quick note is an ordinary note file at the folder's top level, named after when it was made (`Quick note 2026-11-04 1530.md`; `(2)` added for a second one in the same minute), with `quick: true` in its header next to `flint`, `id` and `mode: note`. Plain markdown, readable in Obsidian; snapshots and export carry it like any note.
- Flint lists it under Quick notes (not among Lists or groups) while the flag is there. Keep as a note (or a move to a group) removes the flag. An empty untitled quick note (nothing after its header) is deleted for good when it is left.
- **D-102:** the flag has two values: `quick: true` (untitled, still its time-based name) and `quick: 2026-11-04` (given a title that day). A title renames the file and sets the day (one undo step); at the next day change (and at start-up) Flint removes the flag of quick notes titled on an earlier day, so they become normal notes. A reader that doesn't know the day form treats any `quick` line as an unknown header field and keeps it.

### Trash (DATA-02)
- Deleted lists move to `.flint/trash/` with their deletion time. Deleted tasks are stored there with their original list ID and deletion time so they can be restored in place.
- **Layout (Proposed, M4 step 4, D-50):** plain markdown, readable and restorable by hand until the Trash screen (M7). A deleted list or note is its file, moved there as `<YYYY-MM-DD-HHmmss>-<name>.md`. A deleted task is `<YYYY-MM-DD-HHmmss>-task-<id>.md`: a header with `trashed` (the deletion time), `list` (the list ID) and `listName`, then the task block as it was, subtasks and body included. The task file is written before the task leaves its list, so it is never only in memory. IDs in the trash stay taken (D-29). Undo in the main window removes the trash file again or moves the list back.
- Items older than 30 days are purged (then MEDIA-04 runs).
- **D-97 (0.4.30):** the Trash view reads these files as they are (a task's header says when and from where; a list's or note's deletion time is its name's stamp). Restore removes the file (undo writes it back); Delete now and Empty Trash delete it for good; the expiry runs at start-up and at each day change. **Orphan cleanup (MEDIA-04)** runs at start-up only: an attachment in `attachments/` that no markdown file in the Flint folder mentions (lists, notes, `.flint/archive/`, `.flint/trash/`; its file name as written or URL-encoded) and that is over a day old is deleted.

### Undo (DATA-03)
- An in-app operation history (per session) covers text edits and structural operations: delete, move, reorder, priority, completion, pin, conversion (TASK-17 too), bulk actions, multi-line paste.

### Snapshots (DATA-04)
- Periodic zipped copies of the Flint folder (excluding nothing; it's small) in `%LOCALAPPDATA%\Flint\snapshots`, taken only when something changed. Restore from settings. Retention: Q-05 (**Proposed:** hourly for 48 h, then daily for 30 days).
- **D-84:** snapshots store each attachment once (an unchanged attachment, large ones especially, is never zipped again); linked files (MEDIA-03) are never in a snapshot.
- **D-97 (0.4.32):** not zips but a manifest per snapshot (`<YYYY-MM-DD-HHmmss>.json`: path → content hash) and each content once, gzipped, under `blobs/<first two hex>/<sha-256>`; taken a minute after start-up and hourly when something changed; pruned as Q-05 says; `.git` and temp files left out. Restoring (one list or note, or everything) takes a fresh snapshot first and is one undo step.

### Export (DATA-05)
- One click → a zip of the entire Flint folder, saved where the user chooses.
- **D-97 (0.4.32):** the tray's Export Flint folder…; a standard zip (deflate, UTF-8 names) with the folder inside named `Flint`; `.git` and temp files left out; written to `<name>.part` and renamed when complete.

### File watcher (DATA-06)
- Watch the Flint folder recursively; debounce bursts.
- Ignore Flint's own writes (track what was just written).
- On an external change: re-parse the file and update the UI **without losing cursor position or selection**.
- If the user is editing a task that also changed on disk: merge by task ID; if the same task changed in both places, keep the disk version and keep the user's version as an undo step (**Proposed**). Autosave keeps this window tiny.

### Encoding
- UTF-8, `LF` line endings for files Flint creates; preserve the existing line endings of files it edits, per line (D-29). New lines use the file's most common line ending.
- Preserve a UTF-8 BOM and the presence or absence of a final newline. A file that isn't valid UTF-8 opens read-only with a notice (D-29).

---

## 7. Google Drive sync (SYNC-01, 1.5.0, D-161)

The local Flint folder stays the source of truth; Drive holds a second copy that each PC merges with. Behaviour and wording are in 02 SYNC-01; this section is the data.

### In Drive
```
My Drive/Flint/                 ← found by its Drive ID, so renaming or moving it changes nothing; development builds use "Flint (development)"
  Inbox.md                      ← a synced list or note: the same file, the same name as on disk (byte for byte as the PC that wrote it last has it)
  Groceries.md
  attachments/                  ← attachments inside the Flint folder that a synced list or note links
  .flint-sync/
    groups.json                 ← synced groups: { "flint": 1, "groups": [ { "id": "g-k3f9", "name": "Personal", "lists": ["l7c2", "n4d8"] } ] }
    items.json                  ← per synced list or note (by list ID): its file's Drive ID; per task ID `created` and `lastTouched`; the linked files of its lines: { "<file:/// target>": { "device": "DAVIT-LAPTOP", "size": 1932735283 } }
    removed.json                ← what left Drive and why: { "<list ID>": { "how": "deleted" | "unsynced", "at": "<ISO time>", "device": "DAVIT-LAPTOP" } }, kept 90 days (Proposed)
    compat.json                 ← SYNC-02 (D-166): { "flint": 1, "sync": 1, "raisedBy": null | { "device", "app", "version" }, "devices": { "<device name>": { "app": "Flint" | "Flint for Android", "version": "1.6.0", "sync": 1, "seen": "<ISO time>" } } }
```
- **D-185 (AGENT-01, AGENT-06):** `items.json` also carries per task `createdBy` / `touchedBy` when set, and per synced list or note `agents: { "hidden": true | false, "at": "<ISO time>" }`; `groups.json` the same `agents` per group. Hidden from agents merges by the later `at`. New optional fields: the sync version stays 1 (SYNC-02).
- **Sync version (SYNC-02, D-166):** every run reads `compat.json` first. A `sync` higher than this app supports stops the run before anything else is read or written. Missing, it is created with `sync: 1` (Drive folders from 1.5.x). Each run updates its own `devices` entry. Unknown keys anywhere in the `.flint-sync` files are kept when a file is rewritten (a round-trip test), so a field added later never breaks an older app. A synced file whose frontmatter `flint:` is higher than this app reads (§3) is never merged or written by this app; it downloads as it is and stays read-only.
- Only files Flint created are visible to it (`drive.file`); a file added to the folder by hand in Drive is not seen. Each file's Drive `appProperties` carry `flintId` (the list ID, or the attachment's file name), so Flint never matches by name alone.
- **Deletes** move files to Drive's own trash (Google keeps them 30 days), never deleted for good, and are recorded in `removed.json`: `deleted` means "to Trash on every PC", `unsynced` means "each PC keeps its copy and stops syncing it". A file that disappears from Drive without a record (removed in Drive itself) counts as `unsynced`.
- `.flint-sync/*.json` files are written whole with Drive's `If-Match`-style revision check (the file's `headRevisionId` read before; a changed one means read, merge, write again), so two PCs never overwrite each other's bookkeeping (Proposed).

### On each PC (app data, never in the Flint folder)
```
%APPDATA%\Flint\sync\
  account.bin                   ← the refresh token and account e-mail, encrypted with Electron safeStorage (DPAPI)
  state.json                    ← the Drive folder ID, the mode (everything | chosen), the chosen items (list and group IDs), the items stopped on this PC, the Drive-side IDs and revisions last seen, the last sync time and status
  base\<list ID>.md             ← the last synced version of each synced list or note: the base of the three-way merge
```
- Losing `base\` turns the next merge into a first meeting (02 SYNC-01: union by ID, both versions kept), never into lost data. Losing `state.json` is like a new connection. Snapshots, Trash, the archive, `today.json`'s order, the sidebar's order and `ui-state.json` stay per PC.
- **Device name:** the Windows computer name (`os.hostname()`), upper case, used in conflict callouts and for linked files.

### Merge rules (core, `packages/core/src/sync/`)
- **Task lists:** three-way by task ID (D-161 Q4); the rules are in 02 SYNC-01. The result is written by the canonical writer, so lines nobody changed stay byte for byte. A **title conflict** keeps the other title as the body's first line: `Other version (DAVIT-LAPTOP): <title>` (indented as body text).
- **Notes, bodies and non-task content:** a line-based three-way merge (diff3). Where both sides changed the same lines, this PC's lines stay and the other side's follow as a callout:
  ```markdown
  > [!conflict] Also changed on DAVIT-LAPTOP, 10 Nov 14:02 (the 1 line above is WORK-PC's)
  > Leave Saturday morning instead. The drive is about three hours.
  ```
  The parenthesis says how many lines right above the callout are this PC's version and whose they are, so **Use … / Keep mine / Keep both** know exactly what to replace on any PC (Proposed, found while building: without it the other PC couldn't tell where this PC's version starts); when this PC deleted the lines it reads `(WORK-PC deleted these lines)`. An empty other side reads `> (deleted these lines)`. Inside a fenced code block the callout goes after the fence (a callout inside code would be code) and reads `(WORK-PC's version is in the code block above)`; Use … is then not offered (Keep mine / Keep both are). The format is plain markdown; Flint recognises `> [!conflict]` callouts (case-insensitive) for the card, the chip and the popover, and **Use … / Keep mine / Keep both** edit the text (02 SYNC-01).
- **First meeting** (no base): task lists merge as a union by task ID (a task on both sides with different content is two tasks, the incoming one re-IDed; the same content is one); notes with different text keep both (this PC's text, then the other as a callout).
- **Clocks:** a `lastTouched` from Drive later than the upload's server time (Drive's `modifiedTime`) is taken as that time; a local one later than now as now.
- **Frontmatter:** keys merge one by one (Flint's `flint`, `id`, `mode`, `quick` and unknown keys alike), the later change winning; a mode change (LIST-04) on one side converts the merged result.

### Task IDs (D-161 Q2)
- From 1.5.0 Flint writes new task IDs with **6 characters** (`[a-z0-9]{6}`, still within 04 §3's 4–6), so independent PCs rarely pick the same one; existing IDs stay. A collision found while merging re-IDs the incoming task (its Today order and reminders bookkeeping follow it).

### Lessons kept from the folder-sync idea
- Folder-sync services (OneDrive) can't merge concurrent edits and create unnoticed conflict copies (`Inbox-DESKTOP-7QK2M1B.md`); that is why Flint syncs through Drive's API itself and never writes conflict copies. Keeping all app and UI state outside the synced data (already the v1 design) still applies.

## 8. Flint for Android (D-165, Proposed)

- **The Flint folder** is in the app's private storage (`<files dir>/Flint/`), with the layout of §2: the same list and note files, `attachments/`, `.flint/` (meta, today, sidebar, trash). The same core writes them, so the format, IDs, Trash (30 days) and quick notes are identical.
- **Atomic writes (DATA-01):** a temp file in the same folder, flushed, then renamed over the old one, as on the PC; a file the parser doesn't understand is never rewritten.
- **App state** (the last tab, drafts, sync's `state.json`, `base/` and the account) lives beside it in the app's private storage, never in the Flint folder; the account in Android's encrypted storage (Keystore).
- **Android's automatic backup is off** (`allowBackup="false"`, no backup rules): nothing reaches Google unless the user syncs it.
- **Uninstalling deletes all of it** (Android's rule for private storage). First use and Settings say so; Export and sync are the ways to keep a copy.
- **Export (MOB-12):** copies the Flint folder (without temp files) into a folder the user picks with Android's picker, as plain files; a one-off copy, so Android's slower document access doesn't matter.
- **No snapshots** on the phone in the first version (DATA-04 stays a PC feature; Proposed). Synced items have their PCs' snapshots and Drive's history.
