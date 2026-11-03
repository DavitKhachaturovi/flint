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
| The selection itself is the task: no generated titles, untitled tasks valid in the file (round-trip tests), labels made when shown; popup × close, window-level Esc (never global), drag by the card | D-45, D-46, D-47, docs/04 §3, `packages/core/src/shorthand/paste.ts` (`taskLabel`) |
| Shorthand only from typed text: selected and pasted text in the task line stays plain, also after editing inside it | D-45, CAP-03, CAP-06, CAP-07, `packages/core/src/shorthand/inert.ts` |
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
| Geist / Geist Mono, bundled locally (UI font superseded by Onest + FiraGO, D-60) | 09 §7, 05 §1 |
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
| Live chips (priority stripe, list, time; `2 lists → X`; note and bad-name notes), `##` menu with ↑/↓, close-match / new-list card with Tab, target list beside the save button; the popup window follows the card | CAP-04, CAP-05, D-25, D-29, `apps/desktop/src/renderer/capture-popup/` |
| Paste-to-capture: stack traces, JSON and code fenced into the body with a title from the paste; screenshots kept with the draft, saved to `attachments/` with a relative link | CAP-06, CAP-08, MEDIA-02, `packages/core/src/shorthand/paste.ts` |
| Capture-selection (Ctrl+Shift+X): copy with clipboard restore, admin-window hint; fresh vs append, previous draft, Shift+Esc | CAP-07, R-2, D-39, D-43, `apps/desktop/src/main/capture/selection.ts` |
| Popup: single-line title + selection area (compact highlighted blocks, notes), Enter accepts menu/card first, stays open with content, hint on the card, click-through shadow margin | D-38, D-40, D-41, D-42, `apps/desktop/src/renderer/capture-popup/` |
| Main window in React: sidebar, rows (stripes, reminders, code rows, read-only non-task content), completion with Undo toast and Completed section | TASK-01, TASK-03, TASK-06, TASK-15, D-48, `apps/desktop/src/renderer/main-window/` |
| Navigate/Edit model: composer with shorthand, inline edit with inert existing title, Edit-state Enter rows, 1/2/3/0, Alt+↑/↓, Tab/Shift+Tab, undo/redo (Proposed details) | TASK-02, TASK-03, TASK-04, 03 §2, Q-08, D-45, D-51 |
| Rebindable global hotkeys with conflict detection: Hotkeys window from the tray, tray warning when a hotkey is taken | APP-08, D-44, `apps/desktop/src/main/hotkey-registry.ts`, `src/renderer/hotkeys/` |
| Geist and Geist Mono bundled with the app (variable woff2 from Vercel's `geist` 1.8.2, OFL), never loaded from the web; since D-60 only Geist Mono, with Onest 2.001 and FiraGO 1.001 (Georgian only) | docs/09, APP-09, `apps/desktop/src/renderer/fonts/` |
| R-1 laptop benchmark build (`npm run dist:bench`), kept for a re-measure only (D-36): over a real Teams call, installs nothing, not in normal builds or the installer | 06 §1, `apps/desktop/src/main/laptop-bench.ts`, `packages/core/src/bench` |

## G. Daily-use feedback (31 Oct 2026)

Every item of Davit's first feedback batch, with its ID, status and milestone.

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Hovered row overlapping the selected row: fix hover/selection styling | UI-03 · v1 · M4 | 09 §6, D-52 |
| 2 | Arrow cursor on all controls, hand only on real links | UI-01 · v1 · M4 | 09 §8, 03 Mouse, D-52 |
| 3 | Inline markdown rendered in task titles | LIST-02 · v1 · M4 | 03 §4, D-52 |
| 4 | Thin token-designed scrollbar at the window edge | UI-02 · v1 · M4 | 09 §8, tokens.css, D-52 |
| 5 | Create a list: "+" next to Lists and Ctrl+Shift+N, task list or note | LIST-01 · v1 · M4 (plain note editing until M5, D-64) | 03 §3, D-52 |
| 6 | Settings entry hidden until Settings exists | APP-11 · v1 · M4 (Settings M8) | D-52 |
| 7 | Proper small icon sizes in the `.ico`; bigger in-app logo and wordmark | UI-07 · v1 · M4 | 09 §7, §8, D-52 |
| 8 | Task bodies: inline up to ~8 lines, otherwise a full page; "Open as page" for every task; page replaces the list with a back arrow | TASK-05 · v1 · M4 | 03 §3, 09 §8, D-53 |
| 9 | Locked, springy mouse drag for rows (collapse while dragged) and sidebar lists | TASK-01, LIST-01 · Done (0.4.14; no drag to sidebar, D-64) | 03 Mouse, 09 §9, D-54 |
| 10 | Right-click menus everywhere; Cut / Copy / Paste / Select all in text fields | UI-08 · v1 · M4 (note items M5) | 03, 09 §8, D-55, D-64 (in-page everywhere) |
| 11 | Minimal motion for the selection highlight and new rows | UI-04 · v1 · M4 | 03 §5, 09 §9, D-56 |
| 12 | Back/forward via mouse side buttons and Alt+←/→, no visible buttons | NAV-04 · v1 · M4 (with the page view) | 03 §3, D-53 |
| 13 | Priority / list / date-time pickers in the composer and popup, same style, keyboard-accessible, inserting the same chips | CAP-11 · v1 · M4 step 5 | 03 §3, 09 §8, D-57 |
| 14 | Auto-closing brackets and quotes with overtype; quotes not after a letter | UI-09 · v1 · M4 (note editor M5) | 03 §3, D-57 |
| 15 | Overdue reminders: "Overdue · <time>", brighter text, small dot, no red, no badges; top of Reminders in Today | REM-11 · v1 · M4 row, M6 Today | 03 §4, 09 §8, D-58 |
| 16 | Multi-select floating action bar; sidebar Ctrl/Shift-click and Delete | TASK-07, LIST-01 · v1 · M4 | 03 Mouse, 09 §8, D-59 |
| 17 | Fonts: Onest, FiraGO for Georgian (unicode-range), Geist Mono; mockups and screenshots re-rendered | UI-05 · v1 · M4 | 09 §7, 03 §4, D-60 (supersedes D-17's fonts) |
| 18 | Guidance spotlight: first-run walkthrough (replacing the teaching Inbox, D-64), contextual tips, What's new with release notes | APP-13, APP-10, APP-14, APP-15 · v1 · M8 (release notes from 0.4.0, D-64) | 09 §8, 04 §2, D-61 |
| 19 | Tabs bar (Obsidian-style) | NAV-05 · Later | 06 §3, D-62 |
| 20 | Priority visibility: no text fading or bolding for now | Q-17 · Open question | 06 §4, D-62 |
| 21 | Grayscale syntax highlighting; tokens in tokens.css and 09; mockup 07 and its screenshot | UI-06 · v1 · M4 (popup, bodies), M5 (CodeMirror) | 09 §10, §11, tokens.css, D-63 |
| — | Found during intake: reminders didn't fire before M6 | REM-01, REM-05, REM-07 (basic) · v1 · M4 step 3 | D-64 |
| — | Versioning 0.4.x with release notes per build | APP-15 · v1 · M4 | `docs/release-notes.md`, D-64 |

## H. Feedback on 0.4.1 (31 Oct 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Cursor still flickers around the main composer's text box | UI-01 · v1 · M4 step 5 (start) | 03 §5, D-65 |
| 2 | The undo toast covered by task text and hovered rows: always above the list | TASK-06 · v1 · M4 step 5 (start) | 03 §4 Toasts, D-65 |
| 3 | Completing a task: the specified completion animation | TASK-06, UI-04 · v1 · M4 step 5 (start) | 09 §9, D-65 |
| 4 | Taskbar icon still small: the mark fills nearly the whole square at 16–48 px; larger logo in the reminder toast (`appLogoOverride`) | UI-07, REM-05 · v1 · M4 step 5 (start) | 09 §8, D-65 |
| 5 | Stack traces highlighted in the popup (exception bright, frames dimmed) | UI-06, CAP-06 · v1 · M4 step 5 (start) | 09 §11, D-65 |
| 6 | Switching lists or pages: short fade with a small rise; the sidebar highlight glides | UI-04 · v1 · M4 step 5 (start) | 03 §5, D-65 |
| 7 | Clickable bell turns a reminder off without deleting it; strike-line animation; undoable; new field | REM-12 · v1 · M4 step 5 | 04 §3, 03 §4, D-66 |
| 8 | Full-language highlighting of rendered bodies with the M5 editor's parsers; the popup stays JSON + stack traces | UI-06 · v1 · M5 | D-65 |
| — | Step-4 choices accepted: trash layout, target-first moves, Shift+F10 / Menu key | TASK-11, TASK-12, UI-08 · Decided | D-65 |

## I. Feedback on 0.4.2 and 0.4.4 (1 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Menu hover highlight clears on mouse-leave; only keyboard keeps it | UI-08 · v1 · M4 step 6 (start) | D-68 |
| 2 | Every picker list scrolls (thin scrollbar, sensible max height) | CAP-11, UI-02 · v1 · M4 step 6 (start) | D-68 |
| 3 | I-beam only over editable text; arrow everywhere else | UI-01 · v1 · M4 step 6 (start) | 03 Mouse, D-68 |
| 4 | The note page looks like a page: title, comfortable width, aligned with the lists | LIST-01 · v1 · M4 step 6 (start) | 09 §8, D-64, D-68 |
| 5 | Click a reminder time to change it; "Change reminder…" in the menu; the bell stays the toggle | REM-01 · v1 · M4 step 6 (start) | 03 §4, D-68 |
| 6 | Taskbar icon: the tile scales with the leaf, the leaf inside the tile | UI-07 · v1 · M4 step 6 (start) | 09 §8, D-68 |
| 7 | One-click per-user installer; installs and opens Flint; updates too | APP-16 · v1 · M4 step 6 (start) | 05 §6, D-68 |
| 8 | A manual start shows the main window; only start-with-Windows stays in the tray | APP-01 · v1 · M4 step 6 (start) | D-68 |
| 9 | Reminder notification: "Reminder" + task name; no time, no large logo | REM-05 · v1 · M4 step 6 (start) | D-68 |
| 10 | Overdue: bell + dot + brighter time, no "Overdue" word; the bell never moves | REM-11, REM-12 · v1 · M4 step 6 (start) | 09 §8, D-68 |
| 11 | Bell strike slower and smooth in both directions | REM-12 · v1 · M4 step 6 (start) | 09 §9, D-68 |
| 12 | Motion rule: ≤ ~150 ms gating, ~250–300 ms non-blocking; slower list switching; fuller completion; un-complete animation | UI-04, TASK-06 · v1 · M4 step 6 (start) | 03 §5, 09 §9, D-67 |
| 13 | Animation-speed setting that scales all motion | APP-11, APP-12 · v1 · M8 | D-67 |
| 14a | Capture popup: drag only by a grip at the top of the card | CAP-01 · v1 · M4 step 6 (start) | 03 §3, D-47, D-68 |
| 14b | No "Nothing was selected" message (admin hint stays) | CAP-07 · v1 · M4 step 6 (start) | D-68 |
| 14c | Focus returns to the window active right before the popup last got focus; none if it had none | CAP-01 · v1 · M4 step 6 (start) | D-41, D-68 |
| 14d | Date/time picker: day, then a time-of-day view (common times + custom field), back to the calendar | CAP-11 · v1 · M4 step 6 (start) | D-68 |
| 15 | Motion pass over every button, menu, picker, popup and row action | UI-10 · v1 · M8 at the latest | D-67 |

## J. Feedback on 0.4.5 (1 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Focus return from the popup: confirmed fixed | CAP-01 · Done | D-68, D-69 |
| 2 | Taskbar icon: full-bleed dark tile with Windows' corner radius, the leaf proportionally inside (72 % of the diagonal), every small size | UI-07 · v1 · M4 step 6 (0.4.5 fixes) | 09 §8, D-69 |
| 3 | Undo of a completion plays the un-complete animation | TASK-06 · v1 · M4 step 6 (0.4.5 fixes) | D-69 |
| 4 | Overdue: the white dot stays; the time keeps the bell's tone, not highlighted | REM-11 · v1 · M4 step 6 (0.4.5 fixes) | 09 §8, D-69 |
| 5 | A changed reminder time crossfades instead of jumping | REM-01 · v1 · M4 step 6 (0.4.5 fixes) | 09 §9, D-69 |
| 6–8 | Notification text, popup grip, manual start and start after update: confirmed | REM-05, CAP-01, APP-01, APP-16 · Done | D-69 |
| 9 | Bug: picker hover highlight clears on mouse-leave (Move to, priority, list, reminder presets) | UI-08, CAP-11 · v1 · M4 step 6 (0.4.5 fixes, bugs first) | D-69 |
| 10 | Bug: no I-beam flicker over the composer and the note text box | UI-01 · v1 · M4 step 6 (0.4.5 fixes, bugs first) | D-69 |
| 11 | Bug: today in the calendar gets the normal hover, keeps its marker | CAP-11 · v1 · M4 step 6 (0.4.5 fixes, bugs first) | 09 §8, D-69 |
| 12 | Bug: only the title-bar strip drags the window; right-clicking empty sidebar space opens the + menu | UI-08, LIST-01 · v1 · M4 step 6 (0.4.5 fixes, bugs first) | 03 Mouse, D-69 |
| 13 | Presets In 10 minutes / In 1 hour / Tomorrow 10:00; a day without a time means 10:00 (supersedes Q-02's 09:00) | CAP-11, REM-02 · v1 · M4 step 6 (0.4.5 fixes) | 04 §3, 06 Q-02, D-69 |
| 14 | Wheels time picker after the day (hours, 5-minute steps, snapping, keyboard, Set button), typed field kept, same everywhere | CAP-11, REM-01 · v1 · M4 step 6 (0.4.5 fixes) | 03 §3, 09 §8, mockup 08, D-70 |
| 15 | Click the title text to edit with the caret there; empty row space selects; double-click edits; Esc back to selected | TASK-02 · v1 · M4 step 6 (0.4.5 fixes) | 03 §2, D-71 |
| 16 | Flint's own text selection colour (translucent accent gray, white text) | UI-11 · v1 · M4 step 6 (0.4.5 fixes); M5 editor | 09 §8, tokens.css, D-69 |
| 17 | Duplicate for tasks, lists and notes; Convert to note / task list in M4 | TASK-16, LIST-01, LIST-04 · v1 · M4 step 7 | 02, D-72 |
| 18 | Note right-click menu: trimmed Obsidian-style submenus incl. `==highlight==` | NOTE-02 · v1 · M5 | 02, D-72 |
| 19 | Ctrl+F find bar: task lists highlight and jump (no filter); notes CodeMirror search restyled | NAV-06 · v1 · M4 step 10 (lists, else M5), M5 (notes) | 03 §3, 09 §8, D-72 |
| 20 | One level of sidebar groups, not folders; membership and order in `.flint/sidebar.json`; New group, rename, delete; docs/01 non-goal clarified | LIST-05 · Done (0.4.14) | 01, 02, 04 §2, D-73 |
| 21 | Sidebar sort menu: Manual / Recently edited / Created; Alt+↑/↓ and drag in Manual; hint otherwise | LIST-06 · Done (0.4.14) | 02, 03 §3, D-73 |
| 22 | Temporary sort by reminder time and date added, next to priority | TASK-08 · v1 · M4 step 10 | 02, D-72 |

## K. Feedback on 0.4.6 (1 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| — | Confirmed: flicker gone, calendar today, sidebar + menu, undo animations, overdue tone, time crossfade, presets, wheels, selection colour, click-to-edit | Done | D-74 |
| 1 | Picker highlight follows the last input: none after the mouse leaves; keys bring it back from the mouse's last row | CAP-11, UI-08 · v1 · M4 step 6 (0.4.6 fixes) | 02, D-74 |
| 2a | Click another task's text: straight into editing, no glide first | TASK-02 · v1 · M4 step 6 (0.4.6 fixes) | 03 §2, D-74 |
| 2b | The editing row looks like a dark input field (well, subtle edge) | TASK-02 · v1 · M4 step 6 (0.4.6 fixes) | 03 §2, 09 §8, D-74 |
| 3 | Icon: the master logo's corner proportions at every size; leaf ~10 % smaller at taskbar/tray sizes; in-app logos unchanged | UI-07 · v1 · M4 step 6 (0.4.6 fixes) | 09 §8, D-74 |
| 4 | Motion never delays input; fuller durations (selection ~200, menus ~200, pages ~280, completion ~400 ms); popup instant | UI-04, UI-10 · v1 · M4 step 6 (0.4.6 fixes); speed setting M8 | 03 §5, 09 §9, tokens.css, D-75 |
| — | Sidebar: groups and ungrouped lists in one manual order; groups keep positions under sorts | LIST-05, LIST-06 · Done (0.4.14) | 02, 04 §2, D-74 |
| — | Duplicated task without its reminder; "<name> copy" for lists | TASK-16, LIST-01 · v1 · M4 step 7 | 02, D-74 |
| — | Wheels: touchpad scrolling adds up deltas, one stop per threshold | CAP-11 · v1 · M4 step 6 (0.4.6 fixes) | 02, D-74 |

## L. Feedback on 0.4.8 (1 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| — | Confirmed: selection animation, icon, highlight follows the last input; step-6 details accepted | Done | D-76 |
| — | Enter only on a visible highlight; nothing highlighted at open; typing highlights the top match | CAP-11, UI-08 · v1 · M4 step 6 (0.4.8 fixes) | 02, D-76 |
| 1 | Pickers and menus open without a highlight | CAP-11, UI-08 · v1 · M4 step 6 (0.4.8 fixes) | 02, D-76 |
| 2 | A picker's button closes its open picker | CAP-11 · v1 · M4 step 6 (0.4.8 fixes) | 02, D-76 |
| 3 | Picker scale+fade from the button, menu fade, picker-to-picker morph | UI-10 · v1 · M4 step 6 (0.4.8 fixes) | 09 §9, D-76 |
| 4 | Slow second click on a selected row edits | TASK-02 · v1 · M4 step 6 (0.4.8 fixes) | 03 §2, D-76 |
| 5 | The editing field eases in and glides between rows | TASK-02, UI-04 · v1 · M4 step 6 (0.4.8 fixes) | 03 §2, 09 §9, D-76 |
| 6 | Completion ~360 ms, pages ~320 ms; new-task and un-complete animations | UI-04, TASK-06 · v1 · M4 step 6 (0.4.8 fixes) | 03 §5, 09 §9, tokens.css, D-76 |
| 7 | Stable scrollbar gutter: no shift from a list to a note | UI-02 · v1 · M4 step 6 (0.4.8 fixes) | 02, D-76 |
| 8 | Wheels: free pixel scrolling with an inertia-aware snap; a notch is one value | CAP-11 · v1 · M4 step 6 (0.4.8 fixes) | 02, D-70, D-76 |
| 9 | Wheels: click or type to edit a value (`4_` → `47`), any minute, Tab/Enter commits | CAP-11 · v1 · M4 step 6 (0.4.8 fixes) | 02, D-76 |
| 10 | "Add subtask" in the task menu | TASK-04 · v1 · M4 step 6 (0.4.8 fixes) | 02, 03 §3, D-76 |
| 11 | Bodies: line breaks kept, markdown renders (bug), pasted code fenced and highlighted | TASK-05, CAP-06 · v1 · M4 step 6 (0.4.8 fixes); notes M5 | 02, D-76 |
| 12 | Inline bodies in a well; long ones show their top lines with "Open as page" | TASK-05 · v1 · M4 step 6 (0.4.8 fixes) | 02, 09 §8, D-76 (supersedes part of D-53) |
| 13 | Task page: lighter title, back arrow on the first line, wrapped title editing, subtasks with Add subtask | TASK-05, TASK-04 · v1 · M4 step 6 (0.4.8 fixes) | 02, 09 §8, D-76 |
| 14 | The plain body field doesn't shift the layout | TASK-05 · v1 · M4 step 6 (0.4.8 fixes); real editor M5 | 02, D-49, D-76 |
| 15 | Animations: inline body open/close, page open/close, editing start/end | UI-04, UI-10 · v1 · M4 step 6 (0.4.8 fixes) | 09 §9, D-76 |

## M. Feedback on 0.4.9 and 0.4.10 (1 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| — | Confirmed: highlight on open, second click, task motion, wheels, Add subtask, multi-select, action bar, Duplicate | Done | D-77 |
| — | Ctrl+A: visible open tasks only; no sidebar action bar; nothing selected when a list opens | TASK-07, LIST-01, TASK-02 · v1 · M4 (0.4.10 fixes) | 02, 03 §2–3, D-77 |
| 1 | Picker open, close and switch smooth and reliable | CAP-11, UI-10 · v1 · M4 (0.4.10 fixes) | 02, D-77 |
| 2 | Fuller editing-field motion | TASK-02, UI-04 · v1 · M4 (0.4.10 fixes) | D-77 |
| 3 | No scrollbar flash; scrollbar only on overflow | UI-02 · v1 · M4 (0.4.10 fixes) | 02, D-77 |
| 4 | Wheels: a click after typing goes straight to the clicked value | CAP-11 · v1 · M4 (0.4.10 fixes) | D-77 |
| 5 | Opening any list (Inbox too) clears the marks | TASK-07 · v1 · M4 (0.4.10 fixes) | 02, D-77 |
| 6 | Adjacent marked rows: one continuous highlight | TASK-07 · v1 · M4 (0.4.10 fixes) | 02, 09 §8, D-77 |
| 7 | The toast animates out | UI-10 · v1 · M4 (0.4.10 fixes) | D-77 |
| 8 | Completed collapses with an animation, scroll anchored | TASK-06, UI-10 · v1 · M4 (0.4.10 fixes) | D-77 |
| 9 | Delete and Duplicate (and undo) animate | TASK-12, TASK-16, UI-04 · v1 · M4 (0.4.10 fixes) | D-77 |
| 10 | An expanded task is one raised card; body in the secondary tone; code cards with label and copy | TASK-05 · v1 · M4 (0.4.10 fixes) | 02, 09 §8, mockup 01, D-77 |
| 11 | Long bodies open their page from the clickable preview; short ones edit inline | TASK-05 · v1 · M4 (0.4.10 fixes) | 02, D-77 |
| 12 | Page title field: the body field's inner spacing | TASK-05 · v1 · M4 (0.4.10 fixes) | D-77 |
| 13 | Image thumbnails and a lightbox with ←/→ within the task | MEDIA-01 · Done (0.4.13; moved from M5 by D-79) | 02, D-77 |
| 14 | Note → task list: every plain line a task; headings labels; code and quotes as bodies | LIST-04 · v1 · M4 (0.4.10 fixes) | 02, D-77 (supersedes D-22 for plain lines) |
| 15 | Fields in notes as muted chips, id hidden, raw on the cursor's line | LIST-04, NOTE-01 · v1 · M5 | 02, D-77 |

## N. Feedback on 0.4.11 (1 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| — | Confirmed: picker morphing, marks cleared, editing motion, toast and Completed, scrollbar, wheels | Done | D-78 |
| 1 | Menus and pickers stay anchored while scrolling; close when the anchor leaves the view | UI-08, CAP-11 · v1 · M4 (0.4.11 fixes) | 02, D-78 |
| 2 | A marked task with a body keeps the subtask spacing; no overlap | TASK-07 · v1 · M4 (0.4.11 fixes) | 02, D-78 |
| 3 | The expanded task per mockup 09: always raised, full-height stripe, body and code inside | TASK-05 · v1 · M4 (0.4.11 fixes) | 02, 09 §8, mockup 09, D-78 |
| 4 | Editing A, click B's blank space: A saved, B selected | TASK-02 · v1 · M4 (0.4.11 fixes) | 02, D-78 |
| 5 | Collapsing next to the selection: no stray selection move | TASK-05, UI-04 · v1 · M4 (0.4.11 fixes) | D-78 |
| 6 | Shift+Enter for notes in the composer and while editing a title; "Add notes" in the menu; hint | TASK-05 · v1 · M4 (0.4.11 fixes) | 02, 03 §3, D-78 |
| 7 | "Priority ›" submenu in the task menu | UI-08 · v1 · M4 (0.4.11 fixes) | 02, D-78 |
| 8 | Cloud sync via Google Drive, then OneDrive; OAuth PKCE, safeStorage, drive.file; per-task merge with tombstones; no iCloud | SYNC-01 · Later | 06 §3, D-78 |
| — | Drag to reorder moves into step 8 | TASK-01, LIST-05, LIST-06 · Done (0.4.14) | 06, D-78 |

## O. Feedback on 0.4.12 (1 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | List/page switching motion restored; motion regression test | UI-04 · Done (0.4.13) | 03 §5, D-79 |
| 2 | Submenu safe triangle with ~300 ms grace | UI-08 · Done (0.4.13) | 02, D-79 |
| 3 | Close animations for menus and pickers, also on scroll-out | UI-08, UI-10 · Done (0.4.13) | 02, D-79 |
| 4 | Same vertical rhythm around expanded and marked tasks with bodies | TASK-05, TASK-07 · Done (0.4.13) | 02, D-79 |
| 5 | Subtler preview hover; detected language on code cards; Format as code | TASK-05 · Done (0.4.13) | 02, D-79 |
| 6 | Composer notes field not clipped | TASK-05 · Done (0.4.13) | D-79 |
| 7 | Composer paste follows CAP-06 (code, JSON, traces, images) | CAP-06, TASK-05 · Done (0.4.13) | 02, D-79 |
| 8 | Paste keeps markdown as markdown; only raw code is fenced | CAP-06 · Done (0.4.13) | 02, D-79 |
| 9 | Body and image indicators; lightbox from the icon or a thumbnail | TASK-05, MEDIA-01 · Done (0.4.13) | 02, D-79 |
| 10 | Thumbnails in expanded bodies, full size on the page | TASK-05, MEDIA-01 · Done (0.4.13) | 02, D-79 |
| 11 | Indent and Outdent in the task menu | TASK-04, UI-08 · Done (0.4.13) | 03 §3, D-79 |
| — | Alt+↑/↓ by keyboard focus (task list or sidebar) | LIST-06, TASK-02 · Done (0.4.14) | 02, 03 §3, D-79 |
| 12 | Two-finger touchpad swipe back/forward with an arrow | NAV-04 · v1 · M4 step 9 | 02, 03 §3, D-79 |
| — | The M5 editor before step 9; handoff note after step 8 | NOTE-01, TASK-05 · v1 | 06, D-79 |

## P. Feedback on 0.4.13 and 0.4.14 (2 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| — | Accepted: lightbox on the solid ground, Alt+↑/↓ by keyboard focus, the drag rules; open questions keep their defaults | 09 §8, LIST-06, TASK-01, LIST-05 · Done | 02, 06 §4, D-80 |
| — | Format tests check the parsed structure (tasks, subtasks, bodies), not only round-trips | DATA, 04 §3 · Done (0.4.15) | D-80 |
| 1 | Composer: a pasted image is a thumbnail chip | CAP-06, TASK-05 · Done (0.4.15) | 02, D-80 |
| 2 | Composer: pasted code is a code card preview (language, background) | CAP-06, TASK-05 · Done (0.4.15) | 02, D-80 |
| 3 | Body icon for any body (images only too); image icon in addition; thumbnails on expand | TASK-05, MEDIA-01 · Done (0.4.15) | 02, 09 §8, D-80 |
| 4 | Trash button on code cards and body images, fold animation and undo toast; image link only | TASK-05, MEDIA-01 · Done (0.4.15) | 02, 09 §8, D-80 |
| 5 | Deleting an expanded task collapses it first, then animates | TASK-12 · Done (0.4.15) | 02, D-80 |
| 6 | Groups as soft cards per mockup 10; collapsed "N lists" | LIST-05 · Done (0.4.15) | 02, 09 §8, mockup 10, D-80 |
| 7 | New groups at the top of Lists | LIST-05, LIST-06 · Done (0.4.15) | 02, D-80 |
| 8 | Group motion: create, rename, delete, expand/collapse, move in/out, sort | LIST-05, LIST-06, UI-10 · Done (0.4.15) | 02, 09 §8, D-80 |
| 9 | Drag into a group: lit group, "Drop to add", indented drop line, lifted row; drop on a collapsed header (pulse) | LIST-05 · Done (0.4.15) | 02, 09 §8, D-80 |
| 10 | Stable scrollbar gutter in the sidebar | UI-02 · Done (0.4.15) | 09 §8, D-80 |
| 11 | Sidebar highlight stays while a task is dragged | TASK-01 · Done (0.4.15) | 02, D-80 |
| 12 | Every dragged task keeps its selection highlight | TASK-01 · Done (0.4.15) | 02, D-80 |
| 13 | Animated fold and unfold of bodies and subtasks while dragging | TASK-01 · Done (0.4.15) | 02, D-80 |
| 14 | Settings: Keyboard shortcuts section, global hotkeys rebound there, `?` shows the same list | APP-11, APP-08, NAV-02 · v1 · M8 | 02, 06 §2, D-80 |
| — | M5 editor, first step: CodeMirror live preview for notes and task bodies (marks on the cursor's line only, inline images, field chips, CAP-06 paste) | NOTE-01, TASK-05, LIST-04, MEDIA-01 · Done (0.4.16, first step) | 02 NOTE-01, 06 §0, D-79 |

## Q. Feedback on 0.4.15 (2 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| — | 0.4.15 confirmed except below; D-80's "my call" details accepted | Done | D-81 |
| 1 | Group look and drag visuals back to 0.4.14; keep the expanded card, the white drop ring, the animations and the functional changes | LIST-05, LIST-06 · Done (0.4.16) | 02, 09 §8, D-81 |
| 2a | Task-list column grows with the window (to ~1160 px) | UI-12, NAV-03 · Done (0.4.16) | 02, 09 §8, D-81 |
| 2b | Notes and task pages keep a reading width | UI-12 · Done (0.4.16) | 02, 09 §8, D-81 |
| 2c | App zoom Ctrl+= / Ctrl+− / Ctrl+0 per display, with a brief level pill; "Interface size" in M8 Settings | UI-12, APP-11 · Done (0.4.16; the setting M8) | 02, 03 §3, D-81 |

## R. Feedback on 0.4.16 (2 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| — | Groups confirmed; the editor is tested when M5's editor work is complete | Done | D-82 |
| 1 | Task column back to 820 px with 40 px sides; zoom per display and the reading column stay | UI-12 · Done (0.4.17) | 02, 09 §8, D-82 |
| 2 | A right-side panel for wide screens (Davit is designing it) | — · not specified yet | D-82 |
| 3 | Right-click formatting menu in the editor | NOTE-02 · Done (0.4.17) | 02, D-72, D-82 |
| 4 | Slash commands, `/` at line start or after a space | NOTE-03 · Done (0.4.17) | 02, D-82 |
| 5 | Copy button on code blocks inside the editor | NOTE-05 · Done (0.4.17) | 02, D-82 |
| 6 | Insert ▸ Image: file picker, copied into attachments/ | NOTE-02, MEDIA-02 · Done (0.4.17) | 02, D-82 |

## S. The editor's details and the context panel (2 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| — | Ctrl+B / Ctrl+I, Ctrl+Shift+V, wrap/unwrap, prefix replacing, 3-column tables accepted | NOTE-02, NOTE-03 · Done | 02, 03 §3, D-83 |
| 1 | Context panel: 440 px beside the 820 px column, centred pair, 28 px gap, height fits content | NAV-07 · Done (0.4.18) | 02, 09 §8, mockup 11, D-83 |
| 2 | Appears at a 1336 px main area (~1580 px window, tuned); Ctrl+\ hides/shows, remembered per monitor | NAV-07 · Done (0.4.18) | 02, 03 §3, D-83 |
| 3 | Task selected: details, chips with pickers, notes in the editor, subtasks with progress, dates; no row expand on wide screens | NAV-07, TASK-05 · Done (0.4.18) | 02, D-83 |
| 4 | Nothing selected: Up next (overdue, today, tomorrow; starred once M6) | NAV-07, REM-11, TODAY-01 · Done (0.4.18; starred with M6) | 02, D-83 |
| 5 | Note open: outline with headings and titled blocks, In this note | NAV-07, NOTE-01 · Done (0.4.18) | 02, D-83 |
| 6 | Block titles: fence info title, first comment, JSON keys / exception, type | NAV-07 · Done (0.4.18) | 02, D-83 |
| 7 | Motion: slide/fade in, height eases, content crossfades | NAV-07, UI-10 · Done (0.4.18) | 03 §5, 09 §8, D-83 |

## T. The rest of the M5 editor (2 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Per-note Monospace (menu, Ctrl+Shift+M), this machine; global default in M8 | NOTE-06, APP-11 · Done (0.4.17; setting M8) | 02, D-84 |
| 2 | Link patterns engine (both ways), settings.json; the M8 editor with inference, preview, presets | NOTE-07, TASK-10, APP-11 · Done (0.4.17, engine; editor M8) | 02, D-84 |
| 3 | Videos MP4/WebM/MOV inline with thumbnail; an unplayable one offers its default player | MEDIA-01 · Done (0.4.17) | 02, D-84 |
| 4 | Files over 25 MB linked, sticky notice with Copy into Flint, Linked badge, File not found | MEDIA-03 · Done (0.4.17) | 02, 04, D-84 |
| 5 | Linked files not in snapshots, export, sync; snapshots store each attachment once | DATA-04, DATA-06, SYNC-01 · v1 · M7 | 04, D-84 |
| 6 | Programs and scripts are never launched from a link | MEDIA-03, APP-09 · Done (0.4.17) | 02, 05, D-84 |
| 7 | Highlighting for all common languages, in the editor and in rendered bodies | NOTE-04, UI-06 · Done (0.4.17) | 02, D-84 |
| 8 | Find in notes (Ctrl+F) | NAV-06 · Done (0.4.17, notes) | 02, D-84 |

## U. The context panel after 0.4.18, pins, task to note (2 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Responsive pair: full 820/28/440, compact 780/24/380 (1536 px at 100 %), else none | NAV-07 · Done (0.4.19) | 02, 09 §8, D-85 |
| 2 | Panel back arrow for tasks reached from a panel link; Alt+← and mouse back too | NAV-07, NAV-04 · Done (0.4.19) | 02, D-85 |
| 3 | Panel-toggle button at the top right; Show/Hide panel in right-click menus (Ctrl+K later) | NAV-07, UI-08, NAV-03 · Done (0.4.19) | 02, 09 §8, D-85 |
| 4 | Panel top aligned with the composer (task lists) or the note card, sticky, never higher | NAV-07 · Done (0.4.19) | 02, D-85 |
| 5 | In this note: Created and Edited; Up next footer without the Ctrl+\ hint | NAV-07 · Done (0.4.19) | 02, D-85 |
| 6 | A click on blank space clears the selection (panel shows Up next) | NAV-07, TASK-07 · Done (0.4.19) | 02, D-85 |
| 7 | Scroll-spy outline: last heading at the end, current entry kept in view, smooth jump | NAV-07 · Done (0.4.19) | 02, D-85 |
| 8 | Panel motion plays (appear, height, crossfade, marker); in the motion regression test | NAV-07, UI-10 · Done (0.4.19) | 02, 03 §5, D-85 |
| 9 | Notes on a card (title and body); the panel outside it | NOTE-01 · Done (0.4.19) | 02, 09 §8, D-85 |
| 10 | Up next: Pinned, Today, Tomorrow, then a quiet Overdue | NAV-07, TODAY-01 · Done (0.4.19) | 02, D-85 |
| 11 | Pins replace star to Today: Pin/Unpin menu, P, pin on the row, `pinned:: true` (reads `today`) | TODAY-01 · Done (0.4.19; Today view M6) | 02, 03, 04, D-85 |
| 12 | Done pins unpinned at the day change; rollover prompt "Roll over unfinished pinned tasks?" | TODAY-01, TODAY-02 · Done (0.4.19, unpinning; prompt M6) | 02, 06 Q-04, D-85 |
| 13 | Recently captured (last 5 popup captures, `captured` in meta.json) | NAV-07, CAP-01 · Done (0.4.19) | 02, 04, D-85 |
| 14 | References and Attachments sections, collapsed with a count, remembered, hidden when empty | NAV-07, MEDIA-03 · Done (0.4.19) | 02, D-85 |
| 15 | Convert a task to a note, one undo step | TASK-17 · Done (0.4.19) | 02, D-85 |
| 16 | Group fold lag: obvious cause looked for | LIST-05 · Done (0.4.19) | D-85 |

## V. The context panel after 0.4.19, right-click, the clipboard section (3 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Show / hide slide and fade both ways; the column glides | NAV-07, UI-10 · Done (0.4.20) | 02, D-86 |
| 2 | Standard sticky: from the composer / note card up to 16 px below the title bar, no gap | NAV-07 · Done (0.4.20) | 02, D-86 |
| 3 | Up next rows: title at one left edge; icon, time, list on the right | NAV-07 · Done (0.4.20) | 02, 09 §8, D-86 |
| 4 | Clickable facts in In this note / In this task (open checklist items, code, images, links) | NAV-07 · Done (0.4.20) | 02, D-86 |
| 5 | No scrollbar in the panel during transitions | NAV-07, UI-02 · Done (0.4.20) | 02, D-86 |
| 6 | Extra sections animate in one motion; Recently captured rows aligned | NAV-07 · Done (0.4.20) | 02, D-86 |
| 7 | Attachments: pictures in the lightbox, other files in their default app | NAV-07, MEDIA-03 · Done (0.4.20) | 02, D-86 |
| 8 | Task details: notes edited in the panel; Add subtask in the panel | NAV-07, TASK-04, TASK-05 · Done (0.4.20) | 02, D-86 |
| 9 | A click on a pin unpins | TODAY-01 · Done (0.4.20) | 02, D-86 |
| 10 | Right-click inside a selection acts on all (counted labels); outside selects just that item | TASK-07, LIST-01, UI-08 · Done (0.4.20) | 02, 03, D-86 |
| 11 | After Convert to note (task or list) the note opens, cursor ready | TASK-17, LIST-04 · Done (0.4.20) | 02, D-86 |
| 12 | A task's page on a card | TASK-05 · Done (0.4.20) | 02, 09 §8, D-86 |
| 13 | Clipboard section: Windows clipboard history, docked, insert / Capture as task, settings note | NAV-08 · v1 · late (with M8) | 02, D-86 |

## W. After 0.4.20 (3 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Notes in every body editor saved as typed (debounced) and when left, never discarded | NAV-07, TASK-05, DATA-01 · Done (0.4.21) | 02, D-87 |
| 2 | Show / hide: column and panel move together, never overlapping | NAV-07, UI-10 · Done (0.4.21) | 02, D-87 |
| 3 | The panel's Add subtask field in the editing-field style | NAV-07 · Done (0.4.21) | 02, D-87 |
| 4 | Panel subtasks: the list's right-click menu and indicators | NAV-07, UI-08 · Done (0.4.21) | 02, D-87 |
| 5 | Panel notes spacing and inset; no empty first line in code blocks | NAV-07, NOTE-04 · Done (0.4.21) | 02, D-87 |
| 6 | Task page paste: code into the selected subtask's notes, else the task's | TASK-05, CAP-06 · Done (0.4.21) | 02, D-87 |
| 7 | Task page notes without an inner card | TASK-05 · Done (0.4.21) | 02, D-87 |
| 8 | Inline code cards not cut off; parent and subtask cards don't overlap | TASK-05 · Done (0.4.21) | 02, D-87 |
| 9 | ↑/↓ scroll the selected row into view | TASK-02, UI-04 · Done (0.4.21) | 02, D-87 |
| 10 | Impossible moves nudge the row | TASK-02, UI-10 · Done (0.4.21) | 02, D-87 |
| 11 | Composer ## menu and close-match card back; longest exact list name wins (popup too) | CAP-03, CAP-05 · Done (0.4.21) | 02, D-87 |
| 12 | Picture menus: Copy image, Open in viewer / default app, Show in folder; in the viewer too | MEDIA-02 · Done (0.4.21) | 02, D-87 |
| 13 | Move to top for lists and notes (Manual sort only) | LIST-06 · Done (0.4.21) | 02, D-87 |

## X. M4 step 9 (3 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Smart link titles: user patterns, built-in recognizers, domain and path; no wrapping | TASK-10 · Done (0.4.22) | 02, D-88 |
| 2 | Temporary sorts: priority, reminder time, date added; indicator; back to manual | TASK-08 · Done (0.4.22) | 02, D-88 |
| 3 | Find in task lists: highlights, next/previous, opens Completed or a body | NAV-06 · Done (0.4.22) | 02, D-88 |
| 4 | Multi-line paste: a task per line, one undo, Keep as one; code as one task | TASK-09 · Done (0.4.22) | 02, D-88 |
| 5 | Two-finger swipe back and forward with the edge arrow | NAV-04 · Done (0.4.22) | 02, D-88 |
| 6 | The auto-archive offer and archiving into `.flint/archive/` | TASK-06 · Done (0.4.22; Settings in M8) | 02, 04, D-88 |

## Y. After 0.4.21 and 0.4.22 (3 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| — | Standing rule: motion is part of done, in the motion tests where practical | UI-10 · v1 · every milestone | CLAUDE.md, 03 §5, D-89 |
| 1 | A single click selects (title included); double-click or a second click edits; links: click on a selected row or Ctrl+click | TASK-02 · Done (0.4.23) | 02, 03 §2, D-89 |
| 2 | Panel subtasks: hover, click opens their details, back to the parent | NAV-07 · Done (0.4.23) | 02, D-89 |
| 3 | Subtask notes on a task's page with the panel; code pasted on a task with open notes goes into them | NAV-07, CAP-06 · Done (0.4.23) | 02, D-89 |
| 4 | Open cards keep 6 px from a selected row; the inline editing field's edge not clipped | TASK-05 · Done (0.4.23) | D-89 |
| 5 | Held ↑/↓ scroll at once; the menu's impossible Indent/Outdent nudges | TASK-02 · Done (0.4.23) | 02, D-89 |
| 6 | `##` menu: every match, scrolling past five | CAP-05 · Done (0.4.23) | 02, D-89 |
| 7 | Menus: the image viewer, Attachments, References | MEDIA-02, UI-08 · Done (0.4.23) | 02, D-89 |
| 8 | Ctrl+A on a note or page selects its text, never the panel | NAV-07 · Done (0.4.23) | 02, D-89 |
| 9 | The panel's lower sections ease in with it; Shift+Enter and Add notes into the panel; Esc closes an inline body | NAV-07 · Done (0.4.23) | 02, D-89 |
| 10 | Copy buttons morph into a checkmark | NOTE-05 · Done (0.4.23) | 02, D-89 |
| 11 | Temporary sorts glide; the sort line eases in and out | TASK-08 · Done (0.4.23) | 02, D-89 |
| 12 | Inbox's right-click menu | LIST-03 · Done (0.4.23) | 02, D-89 |
| 13 | Find bar motion and position (title row, then level with the panel) | NAV-06 · Done (0.4.23) | 02, D-89 |
| 14 | The task menu's grouping (proposed, not built) | UI-08 · v1 · awaiting Davit | D-89 |
