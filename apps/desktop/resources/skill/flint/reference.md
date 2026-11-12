# Flint for agents: reference

## The `flint` command

Every command prints short text by default; `--json` prints the result object (the same the MCP tools return) as one JSON document on stdout, errors as `{"error": {"code", "message", "candidates", "suggestions", "problems"}}`.

| Command | Does |
|---|---|
| `flint` | The overview (lists, notes, groups, Today, reminders, now) |
| `flint find [query] [--type task\|list\|note\|group] [--in <list>] [--status open\|done\|all] [--priority high\|medium\|low] [--pinned] [--remind-before <time>] [--remind-after <time>] [--limit n]` | Search; matches inside notes and task notes come with a line number and snippet |
| `flint read <ref> [--lines from:to] [--outline] [--status ...] [--limit n --offset n] [--archived]` | A list (paged tasks), a note (lines), a task, a group; `Today`, `Inbox`, `Reminders` |
| `flint task add "<title>" [--list <list>] [--parent <task>] [--priority p] [--remind <time>] [--pin] [--body <text\|->] [--bottom \| --after <task> \| --before <task>] [--literal]` | Add a task (`flint add` is the same) |
| `flint task edit <task> [--title t] [--body b] [--priority p\|none] [--remind <time>\|none] [--pin\|--unpin] [--focus\|--no-focus]` | Change a task |
| `flint task done\|undone <task>` | Complete or reopen |
| `flint task pin\|unpin <task>` | Pin to Today, or not |
| `flint task move <task> [--list <list>] [--parent <task>\|--outdent] [--top\|--bottom\|--after <task>\|--before <task>]` | Move to another list, under a parent, or within the list |
| `flint task snooze <task> --remind <time>` | A new reminder time |
| `flint task delete <task>` | To Trash |
| `flint list add\|rename\|move\|duplicate\|convert\|archive-done\|delete ...` | Task lists |
| `flint note add "<name>" [--text <text\|->] [--quick] [--group <group>]` | A note (or a quick note) |
| `flint note append <note> --text <text\|->`, `flint note replace <note> --find <passage> --with <text>`, `flint note keep <quick note> --name <name>`, `flint note delete <note>` | Note text and quick notes |
| `flint group add\|rename\|add-list\|remove-list\|move\|delete ...` | Sidebar groups |
| `flint attach <file> --to <task\|note>` | Attach a file (copied up to 25 MB, linked above; programs and scripts refused) |
| `flint links list\|add\|edit\|delete ...` | Link patterns (`--short "AB#{id}" --url "https://…/{id}"`) |
| `flint status` | On, read-only, paused, limits, version |
| `flint help agents` | A short guide like this one |

`<ref>` / `<task>` / `<list>` is an ID or an exact name (case and spaces don't matter for lists, notes and groups; tasks by exact title, open ones first). `--in <list>` narrows a task title to one list. Text flags take `-` to read standard input. `--as "<name>"` sets the name shown in Flint for your changes.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Done |
| 1 | Usage error |
| 2 | `not_found`, `ambiguous`, `bad_time`, invalid input |
| 3 | Flint isn't running (with `--no-start`) or isn't installed |
| 4 | Refused: agents off, `read_only`, `paused`, `too_large` |
| 5 | Internal error |

## MCP tools

- `flint_find { query?, type?, in?, status?, priority?, pinned?, remindBefore?, remindAfter?, limit? }`: no query and no filters gives the overview.
- `flint_read { items: [{ ref, kind?, in?, lines?: {from, to}, outline?, status?, limit?, offset?, archived? }] }` (at most 20 items).
- `flint_create { items: [...], parseShorthand? }`: items of `kind` `task` (`title`, `list`, `parent`, `body`, `priority`, `remind`, `pinned`, `focus`, `position`: `top` | `bottom` | `{after}` | `{before}`), `list` / `note` (`name`, `group`, a note's `text`), `quickNote` (`text`), `group` (`name`, `lists`).
- `flint_update { items: [...] }`: a task (`ref`, `in`, `title`, `body`, `priority`, `remind`, `muted`, `pinned`, `focus`, `done`, `moveTo`, `parent` or `null`, `position`, `attach: {path}`); a list or note (`kind`, `ref`, `name`, `group` or `null`, `position`, `mode`, `duplicate`, `archiveDone`, `keep: {name}`, `append`, `replace: {find, with}`, `text`, `attach`); a group (`kind: "group"`, `ref`, `name`, `addLists`, `removeLists`, `position`).
- `flint_delete { items: [{ ref, kind?, in? }] }`: to Trash; a group's lists stay.
- `flint_link_patterns { action: "list" | "add" | "edit" | "delete", ... }`.

Every answer carries `now`. Writes answer `changed` (each with its `id`) and `text` (one line per item).

## Errors

`not_found` (with `suggestions`), `ambiguous` (with `candidates`: choose by ID), `bad_time` (with examples), `invalid`, `too_large` (split the work), `paused` and `read_only` (tell the user), `off` (the user turns agents on in Flint).

## What agents can't do

Empty or restore Trash, restore snapshots, change Flint's settings, sync, hotkeys or folder, read the clipboard history, run Focus's timer, see or change what is hidden from agents, or undo (the user does that in Flint).
