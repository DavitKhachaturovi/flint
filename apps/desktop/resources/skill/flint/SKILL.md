---
name: flint
description: Work with the user's Flint notes and tasks (the Flint app on this PC) through the `flint` command or Flint's MCP tools. Use when the user mentions Flint, their task lists, Inbox, Today, pinned tasks, reminders, Focus, or asks to add, find, read, complete, move or organise their tasks and notes, or to write something into a Flint note.
metadata:
  version: 1.8.0
---

# Flint

Flint is the user's keyboard-first notes and tasks app on this Windows PC. Its data is plain markdown in a folder, but **never edit those files directly**: always go through Flint (the `flint` command or the `flint_*` MCP tools), so task IDs, open windows, undo and Google Drive sync stay correct.

## What the words mean

Use Flint's words the way the user does:

| Word | Means | Not |
|---|---|---|
| **list** or **task list** | A named list of tasks (Inbox, "Backend"): one item in the sidebar | The tasks in it |
| **note** | A named page of free markdown ("Meeting notes"); also in the sidebar | A task's notes |
| **lists** (plural, "my lists") | Usually lists *and* notes, the sidebar's items | Every task |
| **group** | A folder-like heading in the sidebar holding lists and notes (one level) | A list |
| **task** | One item in a list: a title, maybe notes (its body), priority, reminder, pin, subtasks (one level) | A list |
| **Inbox** | The default list: anything added without a list lands at its top | |
| **Today** | The tasks the user **pinned**, from any list | A date filter |
| **Reminders** | Tasks with a reminder time (a Windows notification then) | |
| **Focus** | The user's Pomodoro sprint: tasks sent there from any list | |
| **done / archived / Trash** | Done tasks sit in the list's Completed part; archived ones in its Archived tab; deleted things in Trash (the user can restore them) | |

**Answer the question asked.** "Which task lists do I have?" or "show my lists" wants the names (and counts): run `flint` (or `flint find --type list`) and list them; don't open every list. "What's in Backend?" or "what's on my plate?" wants tasks: read those lists. When it's unclear, give the lists first and offer to open one.

Some lists may be **hidden from agents** by the user: they don't exist for you. Don't guess around it.

## Prefer this order

1. In a shell (Claude Code, scripts): the **`flint` command**. Use `--json` to read results, `--literal` so `@`, `!` and `##` in titles stay text, and the explicit flags (`--priority`, `--remind`, `--list`).
2. Elsewhere: the **MCP tools** `flint_find`, `flint_read`, `flint_create`, `flint_update`, `flint_delete`, `flint_link_patterns`.

**`flint: command not found`?** The shell may have started before Flint was installed (the installer adds `flint` to the user's PATH for new terminals). Call it by its full path: `"$LOCALAPPDATA/Programs/flint/resources/bin/flint.exe"` in Git Bash, `& "$env:LOCALAPPDATA\Programs\flint\resources\bin\flint.exe"` in PowerShell.

If `flint` says Flint isn't running, it starts Flint itself; if it says agents are off, tell the user to turn them on in Flint → Settings → AI agents. Don't try to change Flint's settings.

## Working rules

- **Find first, then act by ID.** `flint find "login"` (or `flint_find`) returns IDs; use them for every change. Names work only when they are exact; if two things share a name you get `ambiguous` with the candidates: pick by ID or ask the user. Never pick one yourself on a delete or move.
- **No query = overview**: `flint` / `flint_find {}` gives every list, note and group, Today and upcoming reminders, plus `now` (the user's local date and time). Use `now` for "tomorrow", "Friday". `flint find --type list` gives just the task lists.
- **A list that doesn't exist isn't made for you**: `##Name` in a title (or `--list Name`) must name an existing list; otherwise you get `not_found` with the close ones. Ask the user, or make it with `flint list add` when they asked for it.
- **Read big notes in parts.** A read returns at most ~200 lines and says `truncated`; ask for `lines` ranges, or `outline` first to find the section.
- **Edit notes surgically**: `append` text, or `replace` an exact passage that occurs once. Don't resend a whole note to change a line.
- **Reminders**: Flint phrases (`tomorrow 9:00`, `fri 14:30`, `in 2h`, `14 nov 9:30`) or ISO (`2026-11-14T09:00`); a day alone means 10:00; `none` removes it. Every answer echoes the time it set: check it. `overdue: true` means its time passed and the task is open; `muted: true` means it won't notify.
- **Batches are all or nothing.** If one item has a problem, nothing changes and every problem is listed: fix and resend.
- **Limits**: a request has a maximum size and there's an hourly budget. On `too_large`, split the work; on `paused`, stop and tell the user (they resume it in Flint).
- Every change shows in Flint at once and appears in the user's **Recent agent changes**, where they can undo it. Say briefly what you changed.

## Examples

```sh
flint                                   # overview (lists, notes, groups, Today, reminders, now)
flint find --type list                  # just the task lists
flint find "login" --json               # find, with IDs
flint add "Fix login loop" --list Backend --priority high --remind "tomorrow 9:00" --literal
flint task done k3f9a2
flint task edit k3f9a2 --remind none --pin
flint task snooze k3f9a2 "in 2h"
flint task move k3f9a2 --to Inbox
flint task add "Write a test" --parent k3f9a2 --literal
flint read Backend                      # a list's open tasks
flint read "Release plan" --outline
flint read "Release plan" --lines 40:80
flint note append "Release plan" "- Ship on Friday"
flint list add "Groceries"
flint attach "C:\Users\Alex\Desktop\shot.png" --to k3f9a2
```

MCP:

```json
{ "tool": "flint_find", "arguments": { "type": "list" } }
{ "tool": "flint_create", "arguments": { "items": [ { "kind": "task", "title": "Fix login loop", "list": "Backend", "priority": "high", "remind": "tomorrow 9:00" } ] } }
{ "tool": "flint_update", "arguments": { "items": [ { "ref": "k3f9a2", "done": true } ] } }
{ "tool": "flint_update", "arguments": { "items": [ { "kind": "note", "ref": "Release plan", "replace": { "find": "Ship on Friday", "with": "Ship on Monday" } } ] } }
```

More detail on every command and field: [reference.md](reference.md).
