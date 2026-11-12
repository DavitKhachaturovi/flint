---
name: flint
description: Work with the user's Flint notes and tasks (the Flint app on this PC) through the `flint` command or Flint's MCP tools. Use when the user mentions Flint, their task lists, Inbox, Today, pinned tasks, reminders, Focus, or asks to add, find, read, complete, move or organise their tasks and notes, or to write something into a Flint note.
metadata:
  version: 1.8.0
---

# Flint

Flint is the user's keyboard-first notes and tasks app on this Windows PC. Its data is plain markdown in a folder, but **never edit those files directly**: always go through Flint (the `flint` command or the `flint_*` MCP tools), so task IDs, open windows, undo and Google Drive sync stay correct.

## How Flint is organised

- **Lists** hold tasks; **notes** hold free markdown. Each is one file with a stable `id`.
- **Inbox** is the default list: anything added without a list lands at its top.
- **Groups** collect lists and notes in the sidebar (one level).
- **Tasks** have a title, optional notes (the body), **priority** (`high`, `medium`, `low`), a **reminder** (a Windows notification at that time), can be **pinned** (pinned tasks make up **Today**), sent to **Focus** (the user's Pomodoro sprint), and have **subtasks** (one level only).
- Done tasks go to the list's Completed section; **archived** ones to its Archived tab. Deleted things go to **Trash** (the user can restore them).
- **Link patterns** turn short forms like `AB#123` into links.
- Some lists may be **hidden from agents** by the user: they don't exist for you. Don't guess around it.

## Prefer this order

1. In a shell (Claude Code, scripts): the **`flint` command**. Use `--json` to read results, `--literal` so `@`, `!` and `##` in titles stay text, and the explicit flags (`--priority`, `--remind`, `--list`).
2. Elsewhere: the **MCP tools** `flint_find`, `flint_read`, `flint_create`, `flint_update`, `flint_delete`, `flint_link_patterns`.

If `flint` says Flint isn't running, it starts Flint itself; if it says agents are off, tell the user to turn them on in Flint → Settings → AI agents. Don't try to change Flint's settings.

## Working rules

- **Find first, then act by ID.** `flint find "login"` (or `flint_find`) returns IDs; use them for every change. Names work only when they are exact; if two things share a name you get `ambiguous` with the candidates: pick by ID or ask the user. Never pick one yourself on a delete or move.
- **No query = overview**: `flint` / `flint_find {}` lists lists, notes, groups, Today and upcoming reminders, plus `now` (the user's local date and time). Use `now` for "tomorrow", "Friday".
- **Read big notes in parts.** A read returns at most ~200 lines and says `truncated`; ask for `lines` ranges, or `outline` first to find the section.
- **Edit notes surgically**: `append` text, or `replace` an exact passage that occurs once. Don't resend a whole note to change a line.
- **Reminders**: Flint phrases (`tomorrow 9:00`, `fri 14:30`, `in 2h`, `14 nov 9:30`) or ISO (`2026-11-14T09:00`); a day alone means 10:00; `none` removes it. Every answer echoes the time it set: check it.
- **Batches are all or nothing.** If one item has a problem, nothing changes and every problem is listed: fix and resend.
- **Limits**: a request has a maximum size and there's an hourly budget. On `too_large`, split the work; on `paused`, stop and tell the user (they resume it in Flint).
- Every change shows in Flint at once and appears in the user's **Recent agent changes**, where they can undo it. Say briefly what you changed.

## Examples

```sh
flint                                   # overview (lists, Today, reminders, now)
flint find "login" --json               # find, with IDs
flint add "Fix login loop" --list Backend --priority high --remind "tomorrow 9:00" --literal
flint task done k3f9a2
flint task edit k3f9a2 --remind none --pin
flint task move k3f9a2 --list Inbox
flint read "Release plan" --outline
flint read "Release plan" --lines 40:80
flint note append "Release plan" --text "- Ship on Friday"
flint task add "Write a test" --parent k3f9a2 --literal
flint list add "Groceries"
```

MCP:

```json
{ "tool": "flint_create", "arguments": { "items": [ { "kind": "task", "title": "Fix login loop", "list": "Backend", "priority": "high", "remind": "tomorrow 9:00" } ] } }
{ "tool": "flint_update", "arguments": { "items": [ { "ref": "k3f9a2", "done": true } ] } }
{ "tool": "flint_update", "arguments": { "items": [ { "kind": "note", "ref": "Release plan", "replace": { "find": "Ship on Friday", "with": "Ship on Monday" } } ] } }
```

More detail on every command and field: [reference.md](reference.md).
