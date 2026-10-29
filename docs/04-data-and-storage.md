# 04 — Data & Storage

All user data is plain markdown in a folder the user chooses. No database, no server, no account.
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
    today.json                  ← Today's manual order (task IDs)
    archive/                    ← auto-archived completed tasks, one file per list (TASK-06)
    trash/                      ← deleted lists and tasks, with deletion time (DATA-02)
```

App data (not in the Flint folder):

```
%APPDATA%\Flint\
  settings.json                 ← all settings (APP-11), incl. Flint folder path and hotkeys
  window-state.json             ← window sizes/positions per monitor setup (APP-05)
  ui-state.json                 ← collapsed sections, last opened list, sidebar state
  drafts.json                   ← capture popup draft (CAP-08)
  reminders-state.json          ← last-fired bookkeeping for missed-reminder recovery (REM-07)
%LOCALAPPDATA%\Flint\
  snapshots\                    ← local snapshots (DATA-04)
  logs\                         ← local logs only, never uploaded (APP-09)
```

- File names are the list names, sanitized for Windows (illegal characters replaced). Renaming a list renames its file.
- Each list also has a stable `id` in its frontmatter, so renames don't break references.
- **Which files are lists (D-23):** the top-level `*.md` files only. Subfolders and dot-folders (`.obsidian/`, `.git/`, `.flint/`, `attachments/`) never contain lists.
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
- [ ] Ask about staging DNS [today:: true] [id:: q8x2]
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
| `id` | written: `[a-z0-9]{4,6}`; read: `[A-Za-z0-9_-]{1,32}` (D-21, D-29) | Stable task ID, unique within the Flint folder: lists, notes, archive and Trash (D-29) | Today, reminders, undo, CLI |
| `priority` | `low` / `medium` / `high` (absent = none) | Priority. Same value names as Obsidian Tasks (which also has `lowest`/`highest`; Flint reads those as `low`/`high`). | TASK-03 |
| `reminder` | written: `YYYY-MM-DDTHH:MM` (local time); read: also `YYYY-MM-DD` and `…:SS` (D-29). A date-only value means 09:00 (Q-02). | Reminder time | REM-01 |
| `today` | `true`, any letter case (absent = not starred) | Starred into Today | TODAY-01 |
| `completion` | written: `YYYY-MM-DDTHH:MM`; read: also `YYYY-MM-DD` (what Dataview and Obsidian Tasks write) and `…:SS` (**Proposed**) | Completion timestamp (completed tasks only) | TASK-06 |

The app never shows fields as text; it renders them as the stripe, bell, star, and so on (unknown fields are kept but not shown). The capture shorthand (`!h ##list @15:00`, CAP-03) is input syntax only and is never written to disk.

### Parsing and writing rules
- **Tolerant reader (D-21):**
  - **Flint's own fields** (`priority`, `reminder`, `today`, `completion`, `id`) are recognised anywhere in the line, in `[]` or `()`, with or without a space after `::`, **only when the value is valid** for that key (see Fields).
  - **Unknown fields** are recognised only in the trailing run of fields at the end of the line, and only with whitespace after `::` (`[due:: 2026-11-02]`). Anywhere else, `[…::…]` and `(…::…)` are title text: `check [Vec::new] behaviour` keeps its text, visible and in place.
  - Nothing inside an inline code span is ever a field.
  - A trailing Obsidian block ID (`^a1b2`) at the very end of the line doesn't break the trailing run (D-29).
- **Canonical writer (D-21):** `[]` fields at the end of the line in the order `reminder`, `today`, `completion`, `priority`, `id`, then unknown fields in their original order, then the block ID if there is one. Values of fields that didn't change keep their raw text, so `[priority:: highest]` is not rewritten as `high` (D-29).
- **Only touch what changed.** Lines Flint didn't modify are written back byte-for-byte. Non-task content (headings, paragraphs, plain bullets, blank lines, HTML comments) is preserved exactly and stays in place (D-22). Parsing and serializing an untouched file returns it byte-for-byte, including one with missing IDs: repair only happens as part of a save caused by an edit.
- **Missing IDs** (lines added by hand or by the CLI) are assigned on Flint's next save of that file. Until then the task has a provisional in-memory ID that stays stable across re-parses (D-29).
- **Duplicate IDs** (e.g. a line copy-pasted in a text editor): within a file, the first keeps the ID and later ones get new IDs; across files, the older file (by creation time, then path) keeps them (D-23, **Proposed**).
- **Invalid values** (e.g. `[priority:: urgent]`, a malformed date): not a field. The text stays in the title, visible, never silently dropped or hidden; the task has no priority / no reminder (D-21).
- **Repeated Flint fields (D-29):** the first valid occurrence of a key is the field; later ones stay visible as title text. When Flint rewrites such a line it escapes them (`\[priority:: low]`) so they can't turn into the field; in general a written line is checked to read back as the same task, with the least escaping needed.
- **Checkbox states (D-29):** `[ ]` is open, `[x]`/`[X]` is completed. A task completed outside Flint (`[x]` without `completion`) gets `completion` on the next save of that file. A `completion` field on an open task is ignored and kept until Flint changes that task's completion state. Items with other status characters (Obsidian Tasks' `[-]`, `[/]`, …) are not Flint tasks: they are non-task content, shown read-only and never modified.
- **List markers (D-29):** `- [ ]`, `* [ ]` and `+ [ ]` items are tasks (the marker is kept as written). Numbered `1. [ ]` items and plain bullets without a checkbox are non-task content (D-22). Lines inside fenced code blocks or HTML comments are never tasks.
- **Format version:** `flint: 1` in frontmatter. A file with a higher version than the app understands is opened read-only with a notice. So is a file whose `mode` is neither `tasks` nor `note` (D-29); a missing `mode` means note (D-23).
- **Required tests (M1):** round-trip tests (`serialize(parse(file)) === file` for untouched files), property-based/fuzz tests over random titles (including `::`, `#`, brackets, backticks and non-Latin text), fields, bodies and line endings, and fixtures of hand-edited, VS Code-edited and Obsidian-edited files (tabs, block IDs, Obsidian Tasks fields, CRLF, BOM).

### Task IDs
- **Why IDs are mandatory:** Today holds references, reminders point at tasks, undo restores tasks, and the CLI edits files the app has open. All of that breaks if tasks are identified by line position.
- Stored as the `id` field (not Obsidian's `^block` syntax, so there is one convention for all metadata).

### Body and subtasks
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
- `meta.json`, per task ID: `created`, `lastTouched` (any edit, move, priority change, completion). `lastTouched` must be recorded from v1 so stale-task fading (TASK-13, Later) needs no migration. Missing entries are created on first sight. For completed tasks also `completedAfter`: the ID of the task that preceded it when it was completed, so un-checking can return it to its previous position (TASK-06, **Proposed**).
- `today.json`: the manual order of Today. Today membership itself is the `today` field in the line, so losing this file only loses the order.

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
- Converting a task list to a note keeps the `[key:: value]` fields on checklist lines so converting back is lossless (LIST-04). While a list is a note, those fields are inert (no Today membership, no reminders) and their IDs stay reserved (D-29).
- A `.md` file without Flint frontmatter is a note (D-23). When Flint adds its header on the first save caused by an edit, it inserts `flint`, `id` and `mode` into the existing frontmatter block (or creates one) without changing the other keys.

---

## 5. Attachments (MEDIA-01…04)

- Stored in `attachments/` with unique file names (e.g. `2026-10-29-153012-k3f9.png`).
- Referenced with **relative** markdown links (`![](attachments/…png)`), so moving the folder never breaks them.
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

### Trash (DATA-02)
- Deleted lists move to `.flint/trash/` with their deletion time. Deleted tasks are stored there with their original list ID and deletion time so they can be restored in place.
- Items older than 30 days are purged (then MEDIA-04 runs).

### Undo (DATA-03)
- An in-app operation history (per session) covers text edits and structural operations: delete, move, reorder, priority, completion, star, conversion, bulk actions, multi-line paste.

### Snapshots (DATA-04)
- Periodic zipped copies of the Flint folder (excluding nothing; it's small) in `%LOCALAPPDATA%\Flint\snapshots`, taken only when something changed. Restore from settings. Retention: Q-05 (**Proposed:** hourly for 48 h, then daily for 30 days).

### Export (DATA-05)
- One click → a zip of the entire Flint folder, saved where the user chooses.

### File watcher (DATA-06)
- Watch the Flint folder recursively; debounce bursts.
- Ignore Flint's own writes (track what was just written).
- On an external change: re-parse the file and update the UI **without losing cursor position or selection**.
- If the user is editing a task that also changed on disk: merge by task ID; if the same task changed in both places, keep the disk version and keep the user's version as an undo step (**Proposed**). Autosave keeps this window tiny.

### Encoding
- UTF-8, `LF` line endings for files Flint creates; preserve the existing line endings of files it edits, per line (D-29). New lines use the file's most common line ending.
- Preserve a UTF-8 BOM and the presence or absence of a final newline. A file that isn't valid UTF-8 opens read-only with a notice (D-29).

---

## 7. Future: sync (not in v1)

v1 has **no sync**. If sync is added later (OneDrive or otherwise), these lessons apply:

- Folder-sync services can't merge concurrent edits. When the same file is edited on two machines before syncing, OneDrive keeps both and creates a conflict copy named after the machine (e.g. `Inbox-DESKTOP-7QK2M1B.md`), often unnoticed for a long time.
- It works for **one person on several machines**; it is fragile for **several people editing the same list**.
- Mitigations to build at that point: detect conflict-copy files and offer a merge view; merge task lists by task ID (union of tasks, a completed state wins); keep all app/UI state outside the synced folder (already the v1 design).
