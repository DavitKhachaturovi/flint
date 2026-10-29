# 04 — Data & Storage

All user data is plain markdown in a folder the user chooses. No database, no server, no account.
Most of the concrete format below is **Proposed** (it was designed to satisfy the agreed features but not individually confirmed). Changing it later requires a migration, so settle Q-09 before writing the parser.

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
<Flint folder>/                 ← user-configurable (DATA-07)
  Inbox.md                      ← always exists (LIST-03)
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

---

## 3. Task-list file format (Proposed)

```markdown
---
flint: 1
id: l7c2
mode: tasks
---
- [ ] Fix null ref in tenant resolver !high ⏰2026-10-30T15:00 ^k3f9
    Stack trace from staging:
    ```
    NullReferenceException at TenantResolver.Resolve(...)
    ```
    - [ ] Add regression test ^m2p1
- [ ] Ask about staging DNS ★ ^q8x2
- [ ] Update CI agent image !low ^r5t0

## Completed
- [x] Rotate service principal secret !med ✓2026-10-28T14:03 ^a1b2
```

### Line structure
A task line is: `- [ ] <title> <trailing tokens>`.
Trailing tokens are read **from the end of the line backwards**; everything before them is the title. The app never shows tokens as text.

| Token | Meaning | Feature |
|---|---|---|
| `^xxxx` | Stable task ID (always last) | Required by Today, reminders, undo, CLI |
| `!low` / `!med` / `!high` | Priority (absent = none) | TASK-03 |
| `⏰YYYY-MM-DDTHH:MM` | Reminder time (local time) | REM-01 |
| `★` | Starred into Today | TODAY-01 |
| `✓YYYY-MM-DDTHH:MM` | Completion timestamp (completed tasks only) | TASK-06 |

### Task IDs
- `^` + short base-36 string (e.g. 4–6 chars), unique within the Flint folder.
- This is Obsidian's own block-reference syntax, so files stay Obsidian-friendly.
- **Why IDs are mandatory:** Today holds references, reminders point at tasks, undo restores tasks, and the CLI edits files the app has open. All of that breaks if tasks are identified by line position.
- Lines added without an ID (by hand or by CLI) get one assigned by Flint on its next save of that file.

### Body and subtasks
- A **task body** (TASK-05) is the indented, non-list-item content directly under a task (standard markdown list-item continuation), including fenced code blocks and media links.
- A **subtask** (TASK-04) is an indented `- [ ]` item directly under a top-level task. Only one level is valid; deeper items are treated as body content (**Proposed**).

### Order
- **Line order is the manual order.** Dragging or Alt+↑/↓ rewrites line order (TASK-01). Temporary sort by priority never touches the file (TASK-08).
- Active tasks first, then a `## Completed` heading followed by completed tasks (most recently completed first, **Proposed**).

### Bookkeeping in `.flint/meta.json`
- Per task ID: `created`, `lastTouched` (any edit, move, priority change, completion).
- `lastTouched` must be recorded from v1 so stale-task fading (TASK-13, Later) needs no migration.
- If an entry is missing (e.g. task added by CLI), Flint creates it on first sight.

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
- Converting a task list to a note keeps trailing tokens on checklist lines so converting back is lossless (LIST-04).

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
- Windows specifics: antivirus or the search indexer can briefly lock files; retry the rename with short backoff instead of failing.
- A crash or power loss mid-save leaves either the old or the new file, never a corrupted one.

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
- UTF-8, `LF` line endings for files Flint creates; preserve the existing line endings of files it edits (**Proposed**).

---

## 7. Future: sync (not in v1)

v1 has **no sync**. If sync is added later (OneDrive or otherwise), these lessons apply:

- Folder-sync services can't merge concurrent edits. When the same file is edited on two machines before syncing, OneDrive keeps both and creates a conflict copy named after the machine (e.g. `Inbox-DESKTOP-7QK2M1B.md`), often unnoticed for a long time.
- It works for **one person on several machines**; it is fragile for **several people editing the same list**.
- Mitigations to build at that point: detect conflict-copy files and offer a merge view; merge task lists by task ID (union of tasks, a completed state wins); keep all app/UI state outside the synced folder (already the v1 design).
