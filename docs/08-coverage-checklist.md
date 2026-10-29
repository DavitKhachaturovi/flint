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
| Inline shorthand (`!h ##list`, D-25), stripped from stored text | CAP-03 |
| Paste-to-capture (screenshot → attachment; stack trace/JSON → code block) | CAP-06 |
| CLI later (`flint add … -p high`), also for AI models | CLI-01, D-15 |
| Mini mode (always-on-top, Today or Inbox) | MINI-01 |
| Fully keyboard-driven (Enter, Alt+↑/↓, 1/2/3/0, Space) | TASK-02, 03 §2–3 |
| Expandable task body with small indicator | TASK-05, 03 §4 |
| One level of subtasks (Tab) | TASK-04 |
| Undo toast; collapsible "Completed · N"; completion timestamp; auto-archive after N days | TASK-06 |
| Convert between modes | LIST-04 |
| Today view (references), end-of-day rollover prompt | TODAY-01, TODAY-02 |
| Priority stripe, second cue, color-blind palette, "no priority" default neutral | TASK-03, 03 §4, 09 §4 (color-blind palette superseded by grayscale priority, D-17) |
| Slash commands + right-click menu | NOTE-02, NOTE-03 |
| Obsidian-style live preview | NOTE-01 |
| Syntax-highlighted code, monospace toggle, configurable auto-linking (`AB#1234`) | NOTE-04, NOTE-06, NOTE-07 |
| Ctrl+K command palette, fuzzy search across all lists | NAV-01 |
| Spring animations on drag, completion animation, nothing slower than ~150 ms | 03 §5, TASK-06 |
| Density setting, dark/light themes (v1 dark only; light Later, D-17), calm empty states | 03 §4, APP-11 |
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
| `##` list autocomplete, never silent on unknown list (D-25) | CAP-05 |
| Popup opens on the active monitor | CAP-09 |
| Pre-warmed popup (< 100 ms) | CAP-10, 05 §4 |
| Copy button on code blocks | NOTE-05 |
| Relative attachment paths | MEDIA-02 |
| Orphaned-attachment cleanup | MEDIA-04 |
| Single instance | APP-04 |
| Remembered window positions per monitor setup | APP-05 |
| Auto-update | APP-06 (moved to Later by D-19) |
| No telemetry, stated plainly | APP-09, D-16 |
| Never destroy windows; only hide | APP-02, 05 §3 |
| Never quit by accident (X hides, Quit in tray) | APP-03 |
| Apply updates on quit or idle, never mid-session | APP-06, 05 §5 (applies once auto-update is added) |
| Silent crash recovery | APP-07, 05 §3 |
| Keep the popup tiny | CAP-10, 05 §4 |

## C. Agreed during discussion but not in the notes

| Item | Where |
|---|---|
| Navigate vs Edit keyboard states (Space/digits conflict) | 03 §2, D-13, Q-08 |
| Stable task IDs for Today, reminders, undo, CLI | 04 §3 (`[id:: …]` field), D-12, D-20, Q-09 |
| Capture-selection fails on admin windows → popup empty with hint | CAP-07, 05 §5 |
| Restore clipboard + wait for modifier release in capture-selection | CAP-07, 05 §5 |
| Tray resident + autostart (required for reminders and hotkeys) | APP-01, REM-09 |
| AppUserModelID required for Windows toasts | 05 §5 |
| Focus Assist suppresses toasts → own sound / in-app alert | REM-06 |
| Reminder toasts show through Do Not Disturb (`scenario="reminder"`); "Hide task text in notifications" for screen sharing | REM-06, REM-10, D-35 |
| Electron stack, rationale, alternatives | 05 §1, D-04 |
| Perception thresholds (100 ms / 1 s) and performance budgets | 05 §4 |
| Test on average laptop with a Teams call (R-1 accepted on the work-laptop measurement instead, D-36) | 05 §4, 06 §1, D-36 |
| Cold start irrelevant if Flint is never not running | 05 §4 |
| No blank/white flash (background color, rendered while hidden) | 05 §4, 03 §4 |
| Only main window + popup alive at idle; mini mode on demand then hidden | 05 §3 |
| Core logic in pure TS packages; narrow Platform interface (future shell switch, other apps) | 05 §2, 05 §7 |
| CodeMirror 6 editor; electron-builder (NSIS) + electron-updater | 05 §1 |
| Code signing (SmartScreen) | Later: 05 §6, D-19 (Artifact Signing unavailable in Georgia; unsigned internal builds in v1) |
| Azure DevOps pipeline on Windows agent | 05 §6 |
| Risky pieces first (popup latency, capture-selection, actionable toast in Action Center), built as production code instead of a throwaway spike | 06 §1, D-18 |
| App/UI state outside the Flint folder | 04 §1–2, D-14 |
| OneDrive sync lessons for later | 04 §7 |
| Non-goals: assignees, statuses, calendars, comments, nested projects, recurring, tags, backlinks/graph, voice | 01, D-10 |
| Ideas considered and not selected | 01 |
| Brand: cool palette only; logo direction | 01 Brand, D-06, 03 §4 |
| Priority colors must fit the cool palette | 03 §4, 09 §4, D-17 (Q-01 resolved: grayscale) |
| Files stay Obsidian/VS Code/GitHub compatible | LIST-02, 04 §1 |
| Autosave (no Save button) | 04 §1 |

## D. Visual design (agreed during design review)

| Item | Where |
|---|---|
| Final logo `assets/icon/flint-icon-512.svg` | README, 01 Brand, D-17 |
| Dark mode only in v1; light mode Later | 09 §2, 03 §4, APP-11, 06 Later |
| Grayscale + accent `#9AA0AB`, white for emphasis, no purple | 09 §3, 01 Brand, D-17 |
| `#999E98` rejected (green tint) | 09 §2, D-17 |
| Add-in-inspired: soft shadows, rounded corners, icon tiles, chips, composer, emphasized heading words, rounded bullets | 09 §1, §8 |
| "Solid glass": Liquid-Glass feel without translucency | 09 §1, §6 |
| Grayscale priority by lightness + thickness | 09 §4, TASK-03, D-17 |
| Geist / Geist Mono, bundled locally | 09 §7, 05 §1 |
| Motion: spring curve, 150 ms ceiling, reduce-motion | 09 §9, 03 §5 |
| No decorative graphics in v1 | 09 §1, 06 Later |
| Design tokens | `design/tokens.css` |
| Screenshots of all six screens | `design/screenshots/`, 09 §10 |
| Static HTML mockups | `design/mockups/`, 09 §10 |

## E. Build and release decisions

| Item | Where |
|---|---|
| No throwaway spike; risky pieces first in M2/M3 | 06 §1–2, D-18 |
| Internal tool, `.exe` handed out manually | 05 §6, D-19, 06 Q-10 |
| Unsigned v1; SmartScreen "Run anyway" | 05 §6, D-19 |
| No auto-update in v1; v1 makes no network requests | APP-06, APP-09, D-19 |
| Dataview inline fields `[key:: value]` for task metadata | 04 §3, D-20, Q-09 |
| Everything important in the markdown line; side files only hold losable bookkeeping | 04 §3 |
| Round-trip and fuzz tests for the file format | 04 §3, 06 M1 |
| Repo on Azure DevOps (`DavitKhachaturovi/flint`) | README, CLAUDE.md |
| Open-sourcing out of scope for now | D-19 |

## F. Pre-M1 review (Oct 2026)

| Item | Where |
|---|---|
| Flint's own fields recognised anywhere only with a valid value; unknown fields only in the trailing run with a space after `::`; never inside inline code | 04 §3, D-21 |
| Canonical field order `reminder, today, completion, priority, id`, block ID last; honest Dataview / Obsidian Tasks compatibility statement | 04 §3, D-21 |
| Invalid Flint field values stay visible as title text | 04 §3, D-21 |
| Non-task content in task lists stays in place, shown read-only; task moves never move it | TASK-15, TASK-01, 04 §3, 03 §4, 09 §8, D-22 |
| Note → task list keeps non-list content in place, no confirmation (resolves Q-16) | LIST-04, D-22 |
| "Top of Inbox" = just before the first task (resolves Q-14) | CAP-02, 04 §3, D-22 |
| Lists = top-level `*.md` files; files without frontmatter shown as notes, header added lazily | LIST-01, 04 §2, §4, D-23 |
| Obsidian vault root → suggest a `Flint` subfolder | DATA-07, APP-10, 04 §2, D-23 |
| Inbox identified by reserved `id: inbox` (Proposed) | LIST-03, 04 §2, D-23 |
| Duplicate list files (Explorer copies, two Inboxes): older file keeps its IDs (Proposed) | 04 §2–3, D-23 |
| Default Flint folder `%USERPROFILE%\Flint`; warn but allow inside OneDrive; "Open Flint folder" (resolves Q-15) | DATA-07, 04 §2, D-24 |
| OneDrive conflict-copy notice; cloud-only / locked lists shown plainly (Proposed) | DATA-07, 04 §2, §6, D-24 |
| `##name` list shorthand; single `#` is always text | CAP-03, D-25 |
| Only valid tokens are stripped; last valid token wins, others stay as text | CAP-03, D-25 |
| Unknown `##name` creates a list; card before Enter; close match by prefix or edit distance; MRU among prefix matches; Enter is the only save key, Tab chooses "new list" | CAP-05, 03 §3, 09 §8, D-25 |
| `Created list <name> · Undo` | CAP-05, D-25, D-26 |
| No after-save overlay for captures; follow-up messages as in-app toast or next-open notice | CAP-01, 03 §4, 09 §8, §10, D-26 |
| Split Enter budget (< 50 ms hidden, < 100 ms p95 on disk); main process owns the pending capture; draft cleared after confirmed write | CAP-01, CAP-08, 05 §4, 06 §1, D-27 |
| Accepted risk: main-process crash inside the draft debounce window | 05 §4, D-27 |
| Gap-fills: provisional IDs, ID uniqueness scope, hand-checked tasks, indentation, raw field values, line endings / BOM / UTF-8, subtask rules, re-read before writing, custom time parser, npm workspaces (Proposed) | 02, 04 §3, §6, 05 §1–2, D-28 |
| Natural-language time grammar for M1 (Proposed) | REM-02 |
| M1 measurement targets (Proposed) | 06 §1 |
| Screenshots 01/02 re-rendered for D-25 (`scripts/render-mockups.mjs`) | 09 §10 |
| Shorthand read on the first line only; `@` takes the longest time expression; close-match ranking (Proposed) | CAP-03, CAP-05 |
| Un-checking a subtask reopens its completed parent (Proposed) | TASK-04 |
| A task moved to another list lands at its top (Proposed) | TASK-11 |
| M1 measurements and `npm run measure` | 06 §1 |
| Azure DevOps CI for M1: lint, format, typecheck, tests (10k fuzz runs), build | `azure-pipelines.yml`, 05 §6 |
| Node 24.22.1+ (CVE-2026-111497), engines + engine-strict, CI pins Node | D-30, 05 §1, `.node-version`, `azure-pipelines.yml` |
| Electron 45.1.0 and the embedded-Node guard test | D-30, 05 §1 (added with Electron in M2) |
| Dependency policy: latest supported stable, exact pins, 7-day cooldown, npm audit in CI | D-30, 05 §1, CLAUDE.md, `.npmrc`, `scripts/check-release-age.mjs` |
| Zero network requests enforced by the e2e smoke test; a network feature allowlists exactly its endpoint | D-31, APP-09, `apps/desktop/e2e/smoke.spec.ts` |
| Flint folder setup: folder, Inbox (id: inbox / adopt / create), OneDrive and vault-root detection | DATA-07, LIST-03, D-23, D-24 |
| Per-user NSIS installer; uninstall keeps the Flint folder and app data, removes `flint://`, start-with-Windows and the updater copy | D-32, D-19, 05 §6, `apps/desktop/electron-builder.yml`, `resources/installer.nsh` |
| App identity `com.davitkhachaturovi.flint` (never changed once installed); development builds `.dev` with `flint-dev://`; test hooks development-only | D-33, 05 §5, `apps/desktop/src/main/identity.ts` |
| Electron fuses on the packaged exe (checked by `npm run dist`); UI served from `app://flint`, no `file:` requests | D-34, 05 §2, `apps/desktop/scripts/check-fuses.mjs`, `src/main/renderer-url.ts` |
| Capture saved to the top of Inbox or its `##` list (new lists created, Undo), failure notice with Retry, drafts across restarts, lists changed outside Flint picked up | CAP-01, CAP-02, CAP-05, CAP-08, D-26, D-27, DATA-06, `apps/desktop/src/main/capture/` |
| R-1 laptop benchmark build (`npm run dist:bench`), kept for a re-measure only (D-36): over a real Teams call, installs nothing, not in normal builds or the installer | 06 §1, `apps/desktop/src/main/laptop-bench.ts`, `packages/core/src/bench` |
