# 08 — Coverage Checklist

Traceability from everything agreed during design to where it is specified. Use this when reviewing the docs or checking v1 completeness. If an item is added to the product, add it here too.

## A. Davit's original requirements

| Requirement | Where |
|---|---|
| Simple, minimal, not ClickUp/Jira; quick capture during calls or work; today's focus | 01 (Problem, Principles, Non-goals), D-01 |
| Smooth, beautiful design; UI/UX comfort over dumping information | 01 Principle 4, 03 §1 |
| Markdown by default | LIST-02 |
| Note mode: free-form, Obsidian-like, right-click menu for bullets/checkboxes etc. | NOTE-01, NOTE-02 |
| Task-list mode: each line a separate draggable task; drag to top to focus | TASK-01 |
| Priority low/medium/high via color coding, not text | TASK-03, 03 §4, D-08 |
| Completed tasks go to a Completed section in the same list | TASK-06 |
| Multiple lists of both modes | LIST-01 |
| Images and videos | MEDIA-01…04 |
| Save as markdown in a user-configurable location | DATA-07, 04 |
| Sync via OneDrive (original idea) | Decided **not in v1**: D-03, 04 §7 |
| Reminder on every task: button, set time, Windows notification or sound | REM-01, REM-06, D-07 |
| Desktop app, easily installable .exe, Windows x64 first, macOS/ARM later | D-05, 05 §6–7 |
| Future integration with other (JS/TS) apps | 05 §7, D-04 |
| Built/maintained by Claude, no dev resources | README Status, D-04 |
| Name: Flint; repo `C:\Forge\flint` | README, D-06 |

## B. Davit's selected feature notes (in the order noted)

| Note | Where |
|---|---|
| Global hotkey quick-capture (over any app incl. full-screen Teams) | CAP-01 |
| Inbox as default target, zero decisions | CAP-02, LIST-03 |
| Inline shorthand (`!h #list`), stripped from stored text | CAP-03 |
| Paste-to-capture (screenshot → attachment; stack trace/JSON → code block) | CAP-06 |
| CLI later (`flint add … -p high`), also for AI models | CLI-01, D-15 |
| Mini mode (always-on-top, Today or Inbox) | MINI-01 |
| Fully keyboard-driven (Enter, Alt+↑/↓, 1/2/3/0, Space) | TASK-02, 03 §2–3 |
| Expandable task body with small indicator | TASK-05, 03 §4 |
| One level of subtasks (Tab) | TASK-04 |
| Undo toast; collapsible "Completed · N"; completion timestamp; auto-archive after N days | TASK-06 |
| Convert between modes | LIST-04 |
| Today view (references), end-of-day rollover prompt | TODAY-01, TODAY-02 |
| Priority stripe, second cue, color-blind palette, "no priority" default neutral | TASK-03, 03 §4 |
| Slash commands + right-click menu | NOTE-02, NOTE-03 |
| Obsidian-style live preview | NOTE-01 |
| Syntax-highlighted code, monospace toggle, configurable auto-linking (`AB#1234`) | NOTE-04, NOTE-06, NOTE-07 |
| Ctrl+K command palette, fuzzy search across all lists | NAV-01 |
| Spring animations on drag, completion animation, nothing slower than ~150 ms | 03 §5, TASK-06 |
| Density setting, dark/light themes, calm empty states | 03 §4, APP-11 |
| Lightweight snooze ("in 1h / tomorrow") | REM-04 |
| Natural-language times in picker and capture (`@30m`) | REM-02, REM-03, CAP-03 |
| Actionable notifications (Done / Snooze 10m / Open) | REM-05, 05 §5 |
| Missed-reminder recovery | REM-07 |
| Bell indicator + Reminders section in Today | REM-08, TODAY-03 |
| Capture-selection hotkey | CAP-07, 05 §5 |
| Multi-line paste → N tasks with "Keep as one?" | TASK-09 |
| Draft persistence | CAP-08 |
| Multi-select and bulk actions | TASK-07 |
| Triage mode for Inbox (Later) | TASK-14 |
| Temporary sort by priority | TASK-08 |
| Stale-task fading (Later) | TASK-13 (+ `lastTouched` recorded in v1, 04 §3) |
| Smart link titles; long URLs never wrap | TASK-10 |
| Atomic writes | DATA-01, 04 §6 |
| Trash, 30 days | DATA-02 |
| Global Ctrl+Z | DATA-03 |
| Local snapshots and one-click zip export | DATA-04, DATA-05 |
| File watcher (CLI / Claude writes picked up live) | DATA-06, 04 §6 |
| Rebindable global hotkeys with conflict detection | APP-08 |
| `?` cheat sheet | NAV-02 |
| Teaching Inbox onboarding | APP-10 |
| Respect OS reduce-motion | APP-12, 03 §5 |
| Machine-friendly CLI output (Later) | CLI-02 |
| Live preview chips while typing | CAP-04 |
| `#` list autocomplete, never silent on unknown list | CAP-05 |
| Popup opens on the active monitor | CAP-09 |
| Pre-warmed popup (< 100 ms) | CAP-10, 05 §4 |
| Copy button on code blocks | NOTE-05 |
| Relative attachment paths | MEDIA-02 |
| Orphaned-attachment cleanup | MEDIA-04 |
| Single instance | APP-04 |
| Remembered window positions per monitor setup | APP-05 |
| Auto-update | APP-06 |
| No telemetry, stated plainly | APP-09, D-16 |
| Never destroy windows; only hide | APP-02, 05 §3 |
| Never quit by accident (X hides, Quit in tray) | APP-03 |
| Apply updates on quit or idle, never mid-session | APP-06, 05 §5 |
| Silent crash recovery | APP-07, 05 §3 |
| Keep the popup tiny | CAP-10, 05 §4 |

## C. Agreed during discussion but not in the notes

| Item | Where |
|---|---|
| Navigate vs Edit keyboard states (Space/digits conflict) | 03 §2, D-13, Q-08 |
| Stable task IDs (`^id`) for Today, reminders, undo, CLI | 04 §3, D-12, Q-09 |
| Capture-selection fails on admin windows → popup empty with hint | CAP-07, 05 §5 |
| Restore clipboard + wait for modifier release in capture-selection | CAP-07, 05 §5 |
| Tray resident + autostart (required for reminders and hotkeys) | APP-01, REM-09 |
| AppUserModelID required for Windows toasts | 05 §5 |
| Focus Assist suppresses toasts → own sound / in-app alert | REM-06 |
| Electron stack, rationale, alternatives | 05 §1, D-04 |
| Perception thresholds (100 ms / 1 s) and performance budgets | 05 §4 |
| Test on average laptop with a Teams call | 05 §4, 06 §1 |
| Cold start irrelevant if Flint is never not running | 05 §4 |
| No blank/white flash (background color, rendered while hidden) | 05 §4, 03 §4 |
| Only main window + popup alive at idle; mini mode on demand then hidden | 05 §3 |
| Core logic in pure TS packages; narrow Platform interface (future shell switch, other apps) | 05 §2, 05 §7 |
| CodeMirror 6 editor; electron-builder (NSIS) + electron-updater | 05 §1 |
| Code signing (SmartScreen); Azure DevOps pipeline on Windows agent | 05 §6 |
| 2–3 day spike: capture-selection, actionable toast in Action Center, popup latency over full-screen Teams | 06 §1 |
| App/UI state outside the Flint folder | 04 §1–2, D-14 |
| OneDrive sync lessons for later | 04 §7 |
| Non-goals: assignees, statuses, calendars, comments, nested projects, recurring, tags, backlinks/graph, voice | 01, D-10 |
| Ideas considered and not selected | 01 |
| Brand: cool palette only; logo direction | 01 Brand, D-06, 03 §4 |
| Priority colors must fit the cool palette | 03 §4, Q-01 |
| Files stay Obsidian/VS Code/GitHub compatible | LIST-02, 04 §1 |
| Autosave (no Save button) | 04 §1 |
