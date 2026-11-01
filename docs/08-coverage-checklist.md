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
| 9 | Locked, springy mouse drag for rows (collapse while dragged) and sidebar lists | TASK-01, LIST-01 · v1 · M4 (no drag to sidebar, D-64) | 03 Mouse, 09 §9, D-54 |
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
| 20 | One level of sidebar groups, not folders; membership and order in `.flint/sidebar.json`; New group, rename, delete; docs/01 non-goal clarified | LIST-05 · v1 · M4 step 8 (drag in step 9) | 01, 02, 04 §2, D-73 |
| 21 | Sidebar sort menu: Manual / Recently edited / Created; Alt+↑/↓ and drag in Manual; hint otherwise | LIST-06 · v1 · M4 step 8 (drag in step 9) | 02, 03 §3, D-73 |
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
| — | Sidebar: groups and ungrouped lists in one manual order; groups keep positions under sorts | LIST-05, LIST-06 · v1 · M4 step 8 | 02, 04 §2, D-74 |
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
| 13 | Image thumbnails and a lightbox with ←/→ within the task | MEDIA-01 · v1 · M5 | 02, D-77 |
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
| — | Drag to reorder moves into step 8 | TASK-01, LIST-05, LIST-06 · v1 · M4 step 8 | 06, D-78 |

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
| 9 | Body and image indicators; lightbox from the icon or a thumbnail | TASK-05, MEDIA-01 · v1 · M4 (0.4.12 fixes; was M5) | 02, D-79 |
| 10 | Thumbnails in expanded bodies, full size on the page | TASK-05, MEDIA-01 · v1 · M4 (0.4.12 fixes) | 02, D-79 |
| 11 | Indent and Outdent in the task menu | TASK-04, UI-08 · Done (0.4.13) | 03 §3, D-79 |
| — | Alt+↑/↓ by keyboard focus (task list or sidebar) | LIST-06, TASK-02 · v1 · M4 step 8 | 02, 03 §3, D-79 |
| 12 | Two-finger touchpad swipe back/forward with an arrow | NAV-04 · v1 · M4 step 9 | 02, 03 §3, D-79 |
| — | The M5 editor before step 9; handoff note after step 8 | NOTE-01, TASK-05 · v1 | 06, D-79 |
