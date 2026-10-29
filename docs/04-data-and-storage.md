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

## 3. Task-list file format

Task metadata uses **Dataview bracketed inline fields**: `[key:: value]`. This is an existing, widely used plain-text convention from the Obsidian ecosystem (the Dataview plugin, and the Obsidian Tasks plugin's "Dataview format", which reads `[priority:: high]`, `[completion:: …]`, `[created:: …]` and similar). Files therefore stay readable and queryable in Obsidian, and render as normal checklists in VS Code and GitHub.

```markdown
---
flint: 1
id: l7c2
mode: tasks
---
- [ ] Fix null ref in tenant resolver [priority:: high] [reminder:: 2026-10-30T15:00] [id:: k3f9]
    Stack trace from staging:
    ```
    NullReferenceException at TenantResolver.Resolve(...)
    ```
    - [ ] Add regression test [id:: m2p1]
- [ ] Ask about staging DNS [today:: true] [id:: q8x2]
- [ ] Update CI agent image [priority:: low] [id:: r5t0]

## Completed
- [x] Rotate service principal secret [priority:: medium] [completion:: 2026-10-28T14:03] [id:: a1b2]
```

### Why this format is reliable
The earlier draft used bare trailing tokens (`!high`, `⏰…`, `★`, `^id`) read backwards from the end of the line. That is fragile: a title that ends in `!high` or contains `★` is ambiguous, and emoji can be stored differently across systems. Bracketed fields fix this:
- **Explicit boundaries.** A field is exactly `[` key `::` value `]`. No guessing where the title ends.
- **Position-independent and order-independent.** Fields may appear anywhere in the line (Flint writes them at the end, in a fixed order).
- **Extensible and lossless.** Unknown keys (from Dataview, Obsidian Tasks, or a future Flint version) are kept and written back unchanged.
- **Plain ASCII keys, ISO 8601 values.** No emoji encodings, no locale-dependent dates.
- **Human-editable.** Someone editing the file by hand (or Claude via the CLI) can see and change every field.

### Fields
| Field | Values | Meaning | Feature |
|---|---|---|---|
| `id` | short base-36 string, 4–6 chars | Stable task ID, unique within the Flint folder | Today, reminders, undo, CLI |
| `priority` | `low` / `medium` / `high` (absent = none) | Priority. Same value names as Obsidian Tasks (which also has `lowest`/`highest`; Flint reads those as `low`/`high`). | TASK-03 |
| `reminder` | `YYYY-MM-DDTHH:MM` (local time) | Reminder time | REM-01 |
| `today` | `true` (absent = not starred) | Starred into Today | TODAY-01 |
| `completion` | `YYYY-MM-DDTHH:MM` | Completion timestamp (completed tasks only) | TASK-06 |

The app never shows fields as text; it renders them as the stripe, bell, star, and so on. The capture shorthand (`!h #list @15:00`, CAP-03) is input syntax only and is never written to disk.

### Parsing and writing rules
- **Tolerant reader, canonical writer.** Read fields in any position and either bracket style (`[]` or `()`); always write `[]` fields at the end of the line in the order `priority`, `reminder`, `today`, `completion`, `id`, followed by any unknown fields in their original order.
- **Only touch what changed.** Lines Flint didn't modify are written back byte-for-byte. Non-task content (headings, paragraphs, blank lines, HTML comments) is preserved exactly.
- **Missing IDs** (lines added by hand or by the CLI) are assigned on Flint's next save of that file.
- **Duplicate IDs** (e.g. a line copy-pasted in a text editor): the first keeps the ID, later ones get new IDs.
- **Invalid values** (e.g. `[priority:: urgent]`, a malformed date) are kept as unknown fields, never silently dropped; the task shows as having no priority / no reminder.
- **Format version:** `flint: 1` in frontmatter. A file with a higher version than the app understands is opened read-only with a notice.
- **Required tests (M1):** round-trip tests (`serialize(parse(file)) === file` for untouched files), property-based/fuzz tests over random titles, fields, bodies and line endings, and fixtures of hand-edited and Obsidian-edited files.

### Task IDs
- **Why IDs are mandatory:** Today holds references, reminders point at tasks, undo restores tasks, and the CLI edits files the app has open. All of that breaks if tasks are identified by line position.
- Stored as the `id` field (not Obsidian's `^block` syntax, so there is one convention for all metadata).

### Body and subtasks
- A **task body** (TASK-05) is the indented, non-list-item content directly under a task (standard markdown list-item continuation), including fenced code blocks and media links.
- A **subtask** (TASK-04) is an indented `- [ ]` item directly under a top-level task. Only one level is valid; deeper items are treated as body content (**Proposed**).

### Order
- **Line order is the manual order.** Dragging or Alt+↑/↓ rewrites line order (TASK-01). Temporary sort by priority never touches the file (TASK-08).
- Active tasks first, then a `## Completed` heading followed by completed tasks (most recently completed first, **Proposed**).

### Bookkeeping in `.flint/meta.json` and `.flint/today.json`
- Rule: **everything that matters lives in the markdown line; side files hold only bookkeeping that is harmless to lose.**
- `meta.json`, per task ID: `created`, `lastTouched` (any edit, move, priority change, completion). `lastTouched` must be recorded from v1 so stale-task fading (TASK-13, Later) needs no migration. Missing entries are created on first sight.
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
- Converting a task list to a note keeps the `[key:: value]` fields on checklist lines so converting back is lossless (LIST-04).

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
