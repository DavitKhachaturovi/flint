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
| Triage mode for Inbox (v1, D-113) | TASK-14 |
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
| Rebindable global hotkeys with conflict detection: recorded in Settings → Capture & hotkeys (D-102; was the Hotkeys window of D-44), tray warning when a hotkey is taken | APP-08, D-44, D-102, `apps/desktop/src/main/hotkey-registry.ts`, `src/renderer/main-window/Settings.tsx` |
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

## Z. M6 step 1: Today (3 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Today first in the sidebar, the window opens on it; greeting and date | TODAY-01 · Done (0.4.24) | 02, D-90 |
| 2 | Focus: pinned tasks of every list as rows, home-list chip, changes to the home list | TODAY-01 · Done (0.4.24) | 02, 03 §4, D-90 |
| 3 | Today's own order in `.flint/today.json` (Alt+↑/↓, drag), undoable | TODAY-01 · Done (0.4.24) | 02, 04, D-90 |
| 4 | Today's composer adds pinned tasks to Inbox (or `##list`) | TODAY-01 · Done (0.4.24) | 02, D-90 |
| 5 | Rollover prompt on the first open of a new day: Clear, Roll over, × | TODAY-02 · Done (0.4.24; off in Settings M8) | 02, 06 Q-04, D-90 |
| 6 | Today's reminder cards | TODAY-03 · Done (0.4.24, first part; overdue and the section with M6) | 02, D-90 |

## AA. Fixes after 0.4.23 and 0.4.24 (4 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | A reminder's Open: the task's list, scrolled into view, selected, flashed | REM-05 · Done (0.4.25) | 02, D-91 |
| 2 | Scroll position kept per list, note and page for the session, restored at once | NAV-04 · Done (0.4.25) | 02, D-91 |
| 3 | CRLF code pastes into a note; a paste always lands; one-line code recognised; the sample as a fixture | CAP-06 · Done (0.4.25) | 02, D-91 |
| 4 | Open in viewer from a picture's menu in an editor | MEDIA-02 · Done (0.4.25) | 02, D-91 |
| 5 | Whole-line selection not inset when a note starts with a code card | NOTE-01 · Done (0.4.25) | D-91 |
| 6 | The note's find bar placed as the list's, fading out | NAV-06 · Done (0.4.25) | 02, D-91 |
| 7 | The task menu in groups (Add ▸, More ▸, Reminder ▸) | UI-08 · Done (0.4.25) | 02, 03 §4, D-91 |

## AB. The Today redesign (4 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | The rollover card stays until Roll over, Clear or × | TODAY-02 · Done (0.4.26) | 02, D-92 |
| 2 | Focus · pinned with done pins faded ("done 11:20"); High priority · not pinned, five and "Show all N" | TODAY-01 · Done (0.4.26) | 02, 03 §4, 09, D-92 |
| 3 | Reminder cards follow the clock; countdowns tick | TODAY-03 · Done (0.4.26) | 02, D-92 |
| 4 | The Today column: Timeline with the now line, Done today, Captured today with Sort Inbox; stacked and folding on narrow windows | TODAY-01, TODAY-03 · Done (0.4.26) | 02, 09, D-92 |
| 5 | A task's details in the Today column after Shift+Enter or its notes icon; back, Esc | TODAY-01, NAV-07 · Done (0.4.26) | 02, D-92 |
| 6 | The progress line, "X of Y done" | TODAY-01 · Done (0.4.26) | 02, 09, D-92 |
| 7 | The next reminder's card wider and brighter; three a row, "+N more" | TODAY-03 · Done (0.4.26) | 09, D-92 |
| 8 | "Add a task to today…" | TODAY-01 · Done (0.4.26) | D-92 |
| 9 | Motion for all of it | UI-10 · Done (0.4.26) | 03 §5, D-92 |

## AC. Fixes after 0.4.25 and 0.4.26 (4 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | A reminder's Open scrolls, selects and flashes at once, also for the selected task | REM-05 · Done (0.4.27) | 02, D-93 |
| 2 | No scrollbar while the Timeline and the column's sections appear | TODAY-03 · Done (0.4.27) | 09 §8, D-93 |
| 3 | The details in the column: no scrolling past the top, no shift as they appear | NAV-07 · Done (0.4.27) | 09 §8, D-93 |
| 4 | Reminder cards: the card hover lift, a close shadow | TODAY-03 · Done (0.4.27) | 09, D-93 |
| 5 | A click on a Focus task shows its details in the column; Esc, back, empty space return | TODAY-01, NAV-07 · Done (0.4.27) | 02, D-93 |
| 6 | Done today and Captured today always, "· 0" with a quiet line | TODAY-01 · Done (0.4.27) | 02, 09, D-93 |
| 7 | "Sort Inbox · N" the primary button | TODAY-01 · Done (0.4.27) | 09, D-93 |
| 8 | The list chip on Focus rows: hover, a click opens the list with the task selected | TODAY-01 · Done (0.4.27) | 02, 03 §4, D-93 |
| 9 | Dragging a reminder on the Timeline changes its time (15 min, Alt 5), live, undoable | TODAY-03, REM-01 · Done (0.4.27) | 02, D-93 |
| 10 | Tests and probes never touch the real clipboard | — · Done (0.4.27) | CLAUDE.md, D-93 |

## AD. The rest of M6 (4 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | The Overdue card in Today: missed and overdue reminders, quieter, folding, remembered | REM-07, REM-11, TODAY-03 · Done (0.4.28) | 02, 09, D-94 |
| 2 | Done, Snooze ▸ (In 1 hour, Tomorrow 10:00, Pick a time…), a click opens the task | REM-04, REM-07 · Done (0.4.28) | 02, D-94 |
| 3 | "N reminders you missed" opens Today's Overdue card | REM-07, REM-05 · Done (0.4.28) | 02, D-94 |
| 4 | R sets or changes the selected task's reminder anywhere | REM-01 · Done (0.4.28) | 02, 03 §3, D-94 |
| 5 | Flint's own chime, off by default (`reminderSound`); the "Nudge" sound | REM-06 · Done (0.4.28; Nudge after 0.4.28, D-95; the switch in Settings with M8) | 02, 04 §2, D-94, D-95 |
| 6 | The in-app alert when a reminder fires | REM-06 · v1 · M8 (with mini mode) | 02, D-94 |
| 7 | The Focus Assist note in Settings | REM-06 · v1 · M8 | 02, D-94 |

## AE. Fixes after 0.4.27 and 0.4.28 (4 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | The main window comes back as it was left (maximized, or its bounds per monitor setup) from every entry point | APP-05 · Done (0.4.29) | 02, 04 §2, D-96 |
| 2 | The panel's scrollbar inside the card's rounded area, the content never shifting | NAV-07 · Done (0.4.29) | 09, D-96 |
| 3 | No second shadow animation after a reminder card's hover | TODAY-03 · Done (0.4.29) | 09, D-96 |
| 4 | The list chip scrolls to the task at once, then flashes | TODAY-01 · Done (0.4.29) | D-96 |
| 5 | "Sort Inbox · N" (and every primary button) has a hover state, the arrow cursor kept | UI-01 · Done (0.4.29) | 09, D-96 |
| 6 | The chime file is the source of truth: the generator a one-off tool, a hash check | REM-06 · Done (0.4.29) | 02, D-95, D-96 |

## AF. M7, data safety (4 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Trash in the sidebar: deleted tasks, lists and notes by day; Restore, Delete now, Empty Trash; 30-day expiry | DATA-02 · Done (0.4.30) | 02, 04, 09, D-97 |
| 2 | Archived tab: auto-archived tasks by list, restorable | DATA-02, TASK-06 · Done (0.4.30) | 02, D-97 |
| 3 | Snapshots, hourly 48 h then daily 30 days; restore one list or note, or everything | DATA-04 · Done (0.4.32) | 02, 04, 09, D-97 |
| 4 | Export as zip and Restore from a snapshot in the tray (Settings and Ctrl+K in M8) | DATA-05, DATA-04 · Done (0.4.32) | 02, 04, D-97 |
| 5 | Orphaned attachments cleaned up at start-up | MEDIA-04 · Done (0.4.30) | 04, D-97 |

## AG. Fixes after 0.4.29 and 0.4.30 (4 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Reminder card hover: no second shadow after un-hovering | TODAY-03 · Done (0.4.31) | 09, D-98 |
| 2 | A group's right-click menu: New task list, New note, made inside the group | LIST-05 · Done (0.4.31) | 02, D-98 |
| 3 | The sidebar's foot (Trash, Settings in M8) pinned while the lists scroll | LIST-05, DATA-02 · Done (0.4.31) | 02, 03, 09, D-98 |
| 4 | Back to top in every scrolling page | NAV-09 · Done (0.4.31) | 02, 03, 09, D-98 |
| 5 | A trash item opened read-only; "Restore to edit" with Restore | DATA-02 · Done (0.4.31) | 02, 09, D-98 |
| 6 | Restore's toast: Undo and "Go to <list>" | DATA-02 · Done (0.4.31) | 02, D-98 |
| 7 | Reminder sound: Windows sound or Flint chime (the toast silent then), with an info card | REM-06, APP-11 · v1 · M8 | 02, D-98 |

## AH. Quick notes and fixes after 0.4.31 and 0.4.32 (4 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Quick notes: one click or Ctrl+Shift+J, listed under Inbox, a title makes a normal note, an empty one goes | NOTE-08 · Done (0.4.33) | 01, 02, 03, 04, 09, D-99 |
| 2 | Renaming lists, notes and groups in place in the sidebar | LIST-01, LIST-05 · Done (0.4.33) | 03, D-99 |
| 3 | Reminder cards: a close shadow at rest and on hover | TODAY-03 · Done (0.4.33) | 09, D-99 |
| 4 | A new list in a group: no flashes, the highlight stays on its row | LIST-05 · Done (0.4.33) | D-99 |
| 5 | The pinned foot reaches the window's bottom edge | DATA-02 · Done (0.4.33) | D-99 |
| 6 | "Restore to edit": in view with the same gap for every kind, fading after 4 s | DATA-02 · Done (0.4.33) | D-99 |
| 7 | The tray slimmed; Export and Snapshots from Trash's header until Settings → Data | APP-03, DATA-04, DATA-05 · Done (0.4.33) | 02, D-99 |
| 8 | Snapshots compared with now: tasks by ID restorable one by one, a note's line diff, deleted ones read-only | DATA-04 · Done (0.4.33) | 02, 09, D-99 |
| 9 | Snapshot settings in Settings → Data | DATA-04, APP-11 · v1 · M8 | 02, D-99 |
| 10 | Restoring single blocks inside a note | DATA-04 · Later | D-99 |

## AI. M8 step 1: Settings (4 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Settings as one page with a section index; the Settings row above Trash; the tray's Settings | APP-11 · Done (0.4.34) | 02, 09, D-100 |
| 2 | The reminder sound (Windows / Flint chime, the toast silent), notifications on/off, hide task text, the Focus Assist note | REM-06, REM-10 · Done (0.4.34) | 02, D-98, D-100 |
| 3 | The rollover prompt on/off; auto-archive days | TODAY-02, TASK-06 · Done (0.4.34) | 02, D-100 |
| 4 | Snapshots: how often, how long, the space used, Clear old snapshots; Export | DATA-04, DATA-05 · Done (0.4.34) | 02, 04, D-99, D-100 |
| 5 | Interface size and animation speed | UI-12, APP-12 · Done (0.4.34) | 02, D-67, D-100 |
| 6 | Keyboard shortcuts from one list | APP-11, NAV-02 · Done (0.4.34; the cheat sheet in step 2) | 02, D-80, D-100 |
| 7 | The link-patterns editor; changing the Flint folder | NOTE-07, DATA-07 · Done (0.8.2) | D-100, D-104 |
| 8 | Recording hotkeys in place | APP-08 · Done (0.8.0) | 02, D-102 |

## AJ. Fixes after 0.4.33 and 0.4.34 (4 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Version numbers follow the milestone: 0.8.0 next, 1.0.0 at the end of M9 | Q-22 · Decided | 06, D-101 |
| 2 | Hotkeys recorded in Settings with conflict detection; the Hotkeys window and the tray's Hotkeys… removed | APP-08 · Done (0.8.0) | 02, 03, 09, D-102 |
| 3 | A quick note's title saved when the field is left; a title keeps it a quick note until Keep as a note, a group or the next day | NOTE-08 · Done (0.8.0) | 02, 04, D-102 |
| 4 | No flash of the selected row when a list or note is made in its group | LIST-05, UI-04 · Done (0.8.0) | D-102 |
| 5 | Two designs for the sidebar's foot, chosen in Settings → Appearance (Davit picks one) | NAV-09, APP-11 · Done (0.8.0); Buttons chosen, the rest removed (0.8.1, D-103) | 09, D-102, D-103 |
| 6 | The snapshot comparison scrolls in the side panel; its action bar sticky on a solid ground | DATA-04 · Done (0.8.0) | 03, 09, D-102 |
| 7 | The reminder sound described as heard through Do Not Disturb and Focus; the Do Not Disturb row | REM-06 · Done (0.8.0; Davit checks by ear) | 02, D-102 |
| 8 | Interface size as exact levels; every segmented choice sets the value pressed | UI-12, APP-11 · Done (0.8.0) | 02, D-102 |

## AK. Fixes after 0.8.0 (4 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | The sidebar's foot as two buttons; the Card design and its setting removed | NAV-09, APP-11 · Done (0.8.1) | 02, 09, D-103 |
| 2 | The foot buttons' hover in their own shape | UI-03 · Done (0.8.1) | D-103 |
| 3 | A soft fade above the foot, the last list clear of it at the end | NAV-09 · Done (0.8.1) | 03, 09, D-103 |
| 4 | "Settings" and "Trash" with its count in full; the count left out where it can't fit | NAV-09 · Done (0.8.1) | 02, 09, D-103 |
| 5 | The context panel's and Today's column's bottom always in the window | NAV-07, TODAY-01 · Done (0.8.1) | 03, D-103 |

## AL. M8 step 1b: the Flint folder and link patterns (4 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Changing the Flint folder: choices by the chosen folder's state, the likeliest preselected, a confirmation that says what happens | DATA-07 · Done (0.8.2) | 02, 03, 04, D-104 |
| 2 | Move: copied file by file, checked, nothing overwritten, undone on failure; the old folder kept | DATA-07 · Done (0.8.2) | 04, D-104 |
| 3 | The OneDrive warning; the folder itself and folders inside it refused | DATA-07 · Done (0.8.2) | 02, D-24, D-104 |
| 4 | Flint restarts on the new folder, back on Settings | DATA-07 · Done (0.8.2) | D-104 |
| 5 | Merging the current lists into another Flint folder | DATA-07 · Later | 06, D-104 |
| 6 | Settings → Links: patterns listed with Delete; Add from an example with presets, a live preview, a second example, Advanced | NOTE-07 · Done (0.8.2) | 02, 09, D-84, D-104 |
| 7 | The Settings index opens on General | APP-11 · Done (0.8.2) | D-104 |

## AM. Fixes after 0.8.2 (5 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | The Trash button without its count, the size of Settings | NAV-09, DATA-02 · Done (0.8.3) | 02, 09, D-105 |
| 2 | Edit a link pattern (the same editor, prefilled; examples kept) | NOTE-07 · Done (0.8.3) | 02, 04, D-105 |
| 3 | Inference of a word between fixed text (`{name}-repo`), with test fixtures; the second example stays while typed | NOTE-07 · Done (0.8.3) | D-105 |
| 4 | Over-broad patterns refused with a suggested fixed part; the match count and its warning | NOTE-07 · Done (0.8.3) | 02, D-105 |
| 5 | The built-in recognizers listed with a switch each | TASK-10, NOTE-07 · Done (0.8.3) | 02, 04, 09, D-105 |
| 6 | Links everywhere text shows; link chips in the composer and the capture popup; pasted URLs short in the editors at once | NOTE-07, TASK-10, CAP-04 · Done (0.8.3) | 02, 03, D-105 |

## AN. M8 step 2: the palette and the cheat sheet (5 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Ctrl+K palette: a centred card like the capture popup, the header's pill | NAV-01 · Done (0.8.4) | 02, 03, 09, D-106 |
| 2 | Search across lists, notes, groups, tasks (open, then completed), note lines; fuzzy | NAV-01 · Done (0.8.4) | 02, D-106 |
| 3 | Trash and the archive through "Search Trash and Archive" | NAV-01, DATA-02 · Done (0.8.4) | D-106 |
| 4 | Commands, the selected task's actions, second steps (Move to ›, Priority ›) | NAV-01 · Done (0.8.4) | 02, D-106 |
| 5 | Before typing: recent places, the task's actions, most used commands | NAV-01 · Done (0.8.4) | D-106 |
| 6 | `?` cheat sheet from the shared shortcuts list, with a filter | NAV-02 · Done (0.8.4) | 02, 03, D-80, D-106 |
| 7 | Ctrl+K with text selected in an editor makes a link | NOTE-01 · Done (0.8.4) | 03, D-106 |
| 8 | Quit Flint from the palette | APP-03 · Done (0.8.4) | 02, D-106 |

## AO. Fixes after 0.8.3–0.8.5, the test clock, the day change (5 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | The empty quick note's tip toast, the first three times | NOTE-08 · Done (0.8.6) | 02, D-107 |
| 2 | Renaming (and naming) in the sidebar saved when the field is left; only Esc cancels | LIST-01, LIST-05 · Done (0.8.6) | 02, D-107 |
| 3 | The palette's back arrow; Esc goes back one step, closes from the top | NAV-01 · Done (0.8.6) | 02, 03, D-107 |
| 4 | One result order: Go to, Commands, Tasks, Lists and notes, lines in notes last | NAV-01 · Done (0.8.6) | 02, D-107 |
| 5 | No header pill; the sidebar header's search button; the palette's footer of keys | NAV-01 · Done (0.8.6) | 02, 03, 09, D-107 |
| 6 | A note's line opens the note scrolled to it, flashed | NAV-01 · Done (0.8.6) | 02, D-107 |
| 7 | Onboarding: Ctrl+K in the walkthrough; the mouse-opener's one-time Ctrl+K tip | APP-13, APP-14 · Planned (M8 step 4) | D-107 |
| 8 | docs/06 §0's handoff brought up to date | — · Done | 06 |
| 9 | End-to-end tests on a fixed clock | — · Done (0.8.6) | 05, D-107 |
| 10 | Day-change tests across midnight; the day change acted on at midnight (bug fixed) | TODAY-01, TODAY-02, TODAY-03, REM-07 · Done (0.8.6) | 02, 05, D-107 |
| 11 | Overlapping reads: an older one dropped (a new list no longer bounces back) | NAV-03 · Done (0.8.6) | D-107 |
| 12 | A new note's caret request stands until the caret arrives | NOTE-08 · Done (0.8.6) | D-107 |

## AP. Fixes after 0.8.6; mini mode's first decisions (5 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | A rename saved on leaving looks like Enter (no leave and arrive); a click on another list saves it | LIST-01, LIST-05 · Done (0.8.7) | 02, D-108 |
| 2 | The search button's hover reliable (out of the drag strip) | NAV-01 · Done (0.8.7) | 09, D-108 |
| 3 | A stronger, longer flash for a note's line from the palette | NAV-01 · Done (0.8.7) | 09, D-108 |
| 4 | "Good evening" until 04:00 | TODAY-01 · Done (0.8.7) | D-108 |
| 5 | Mini mode beside the main window, in sync; Open brings the main window forward | MINI-01 · Decided (M8 step 3) | 02, D-109 |
| 6 | Mini mode's Note tab: one quick note as a sticky note | MINI-01, NOTE-08 · Decided (M8 step 3) | 02, 03, D-109 |

## AQ. M8 step 3: mini mode with the reminder alert (5 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Mini mode beside the main window, in sync; Open brings the main window forward | MINI-01 · Done (0.8.8) | 02, D-109 |
| 2 | Today (pinned, then later reminders today), Inbox, Note tabs | MINI-01 · Done (0.8.8) | 02, D-109 |
| 3 | A click selects, double-click / Enter opens in the main window; right-click menu; completion with Undo | MINI-01 · Done (0.8.8) | D-109 |
| 4 | The Note tab: one quick note, made on the first keystroke, title, ⋯ menu, Keep as a note | MINI-01, NOTE-08 · Done (0.8.8) | 02, D-109 |
| 5 | One window edits a note at a time ("Editing in mini mode") | MINI-01, NOTE-08 · Done (0.8.8) | D-109 |
| 6 | The reminder card beside the toast; each clears the other; "1 of 3"; Show reminders in Flint | REM-06 · Done (0.8.8) | 02, D-109 |
| 7 | Ctrl+Alt+Space (rebindable), the tray, the Ctrl+K command, the title-bar button | MINI-01, APP-08, NAV-01 · Done (0.8.8) | 03, D-109 |
| 8 | On top with its pin; corner snapping; its place per monitor setup; no taskbar button | MINI-01, APP-05 · Done (0.8.8) | D-109 |
| 9 | Mini mode and the capture popup hidden from screen sharing (switches in Settings) | MINI-01, CAP-01 · Done (0.8.8); a real Teams share to verify | D-109 |
| 10 | Mini mode's keys, letters only outside text fields; Esc never hides it | MINI-01 · Done (0.8.8) | 03, D-109 |

## AR. Mini mode rebuilt on the main window's parts (6 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | The shared parts moved to `renderer/ui/` and `ui/app.css`, behaviour-neutral (screenshot gate) | MINI-01 · Done (0.8.9) | 05, D-110 |
| 2 | Mini built from the shared parts in a compact size, never copies | MINI-01 · Done (0.8.9) | 03, 09, D-110 |
| 3 | Transparent window, mockup 05's card (22 px, floating shadow, 364 px, height fitting up to 460 px), resize handles, hanging from its corner, grip | MINI-01 · Done (0.8.9); the look on a real desktop to check | 05, 09, D-110 |
| 4 | Today's next reminder on a card that turns into the alert; it never takes the caret | REM-06, TODAY-03 · Done (0.8.9) | 02, D-110 |
| 5 | The compact composer: no tools, menus upward, the hint while focused and empty, the send arrow | MINI-01, CAP-03 · Done (0.8.9) | D-110 |
| 6 | Drag and Alt+↑/↓ in mini (Today's pinned, Inbox); the tab switch and the pin's state animated | MINI-01, TASK-01 · Done (0.8.9) | 03, D-110 |
| 7 | Note tab: title before text; a removed empty note never leaves it dead; New quick note off while empty | MINI-01, NOTE-08 · Done (0.8.9) | D-110 |
| 8 | The animation-speed setting reaches mini mode | APP-11 · Done (0.8.9) | D-110 |

## AS. Fixes after 0.8.9 (6 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Link patterns guarded by an e2e check; two changing parts inferred, fixed text between them counts | NOTE-07 · Done (0.8.10) | D-111 |
| 2 | A note's selection covers only the characters | NOTE-01, UI-11 · Done (0.8.10) | D-111 |
| 3 | The composer's notes field takes a click | CAP-03, TASK-05 · Done (0.8.10) | D-111 |
| 4 | Composer drafts kept per list for the session | CAP-03 · Done (0.8.10) | D-111 |
| 5 | An empty new row left plays the remove animation (list and task page) | TASK-02, TASK-05 · Done (0.8.10) | D-111 |
| 6 | A note renamed from its title | NOTE-01, LIST-01 · Done (0.8.10) | 03, D-111 |
| 7 | Typed shorthand shown live on the row being edited | TASK-02, CAP-04 · Done (0.8.10) | 09, D-111 |
| 8 | Mini: one size for every tab, Note at full height, Reset size, resized from every side | MINI-01 · Done (0.8.10) | 02, 09, D-111 |
| 9 | Mini: slow second click opens; the bell mutes and unmutes; D/S/O with the focus | MINI-01, REM-12, REM-06 · Done (0.8.10) | D-111 |
| 10 | Mini and the capture popup fade in and out; focus returned at once | MINI-01, CAP-01 · Done (0.8.10) | 03, 05, D-111 |
| 11 | Mini's softer shadow below; nothing above a top-corner card takes the mouse | MINI-01 · Done (0.8.10); a Teams share still to check | 09, D-111 |

## AT. Fixes after 0.8.10 (6 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | The side panel's subtasks ease in and fold away like the list's rows | NAV-07, TASK-05 · Done (0.8.11) | D-112 |
| 2 | Mini's Note tab a little lower under the tabs; no scrollbar while the height eases | MINI-01 · Done (0.8.11) | 09, D-112 |
| 3 | The capture popup takes the softer desktop shadow | CAP-01 · Done (0.8.11) | 09, D-112 |
| 4 | Replay walkthrough in Settings; the walkthrough says so | APP-10, APP-11 · Decided (M8 step 4) | 02, D-112 |

## AU. M8 step 4 decided (6 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Inbox triage, a card at a time, by keyboard, oldest first, with a summary | TASK-14 · Done (0.8.12) | 02, 03, 09, D-113 |
| 2 | The 8-step walkthrough, each step advancing when it is done | APP-10, APP-13 · Decided · M8 step 4b | 02, D-113 |
| 3 | Existing installs get What's new, fresh ones the walkthrough | APP-10, APP-15 · Decided · M8 step 4b | D-113 |
| 4 | What's new as one card with the notes since last seen | APP-15 · Decided · M8 step 4b | 02, D-113 |
| 5 | The first nine contextual tips | APP-14 · Decided · M8 step 4b | 02, D-113 |

## AV. Fixes after 0.8.11 and 0.8.12 (6 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Mini's Note tab: the "Quick note" line back in place, only the title and the editor lower | MINI-01 · Done (0.8.13) | D-114 |
| 2 | Mini: no scrollbar and no sideways shift when another tab comes in | MINI-01 · Done (0.8.13) | 09, D-114 |
| 3 | Today's Timeline always shows, quietly when empty | TODAY-03 · Done (0.8.13) | D-114 |
| 4 | A new list, note or group out of sight scrolls into view | LIST-01, LIST-05 · Done (0.8.13) | D-114 |
| 5 | Move to top of group (and Move to top out of a group) | LIST-06 · Done (0.8.13) | 02, D-114 |
| 6 | Hiding mini or the popup returns the focus to the app before, never restoring the minimized main window | MINI-01, CAP-01 · Done (0.8.13) | D-114 |
| 7 | Triage pill at the end of Inbox's title row | TASK-14 · Done (0.8.13) | 09, D-114 |
| 8 | Triage: the card's height eases; the buttons move | TASK-14 · Done (0.8.13) | 09, D-114 |
| 9 | Triage: the place kept for the session; Start over | TASK-14 · Done (0.8.13) | 02, 03, D-114 |
| 10 | Triage: a click on the notes shows the whole task | TASK-14 · Done (0.8.13) | 02, 03, D-114 |
| 11 | Triage: editing the title moves nothing | TASK-14 · Done (0.8.13) | 09, D-114 |
| 12 | Triage: the progress line goes to a task | TASK-14 · Done (0.8.13) | 03, 09, D-114 |
| 13 | Triage: in and out as a page | TASK-14 · Done (0.8.13) | D-114 |

## AW. Fixes after 0.8.13; the walkthrough's spotlight (6 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Triage: back to "Triage · N" under Inbox's title | TASK-14 · Done (0.8.14) | 02, 03, D-115 |
| 2 | Triage: the side panel's one rule (Up next, the task on a click, Up next again) | TASK-14 · Done (0.8.14) | 02, 03, D-115 |
| 3 | Move to top of group / Move out to top of Lists | LIST-06 · Done (0.8.14) | 02, D-115 |
| 4 | Mini: menus and pickers open where they fit on the screen | MINI-01, UI-08 · Done (0.8.14) | 09, D-115 |
| 5 | A quick note's title: Enter, Shift+Enter, Tab, ↓ on into the text; never a new note | NOTE-08 · Done (0.8.14) | 03, D-115 |
| 6 | The walkthrough's spotlight: only the target live, taught keys everywhere, Esc ends it | APP-10, APP-13 · Decided · M8 step 4b | 02, D-115 |

## AX. Settings right after an update; the walkthrough's steps; Import from Obsidian (6 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Settings saved by an older version work at once after an update (the pages' calls wait for main) | NOTE-07, APP-11 · Done (0.8.15) | D-116, `e2e/startup.spec.ts` |
| 2 | The walkthrough's rings and what moves each step on; the title bar's mini button for step 8 | APP-10, APP-13 · Decided · M8 step 4b | 02, D-116 |
| 3 | You're set: Remove what I created during the tour (one undoable step) | APP-10 · Decided · M8 step 4b | 02, D-116 |
| 4 | Import from Obsidian (copy notes and images, never change the vault) | DATA-08 · Recorded · late v1 | 02, D-116 |

## AY. Fresh install or update; What's new in plain language (6 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Fresh install (no settings) → walkthrough; update → What's new once, versions since `lastSeenVersion` | APP-10, APP-15 · Decided · M8 step 4b | 02, D-117 |
| 2 | What's new shows `docs/whats-new.md` (2–5 plain highlights per version), not the release notes | APP-15 · Decided · M8 step 4b | 02, whats-new.md, D-117 |
| 3 | What's new from the palette and Settings → About; no tray item | APP-15 · Decided · M8 step 4b | 02, D-117 |
| 4 | Remove what I created during the tour: only items made during it | APP-10 · Decided · M8 step 4b | 02, D-117 |

## AZ. Tips: when, where, how long; Reset tips (6 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | A tip 2 s after its pattern, not while typing or with a menu open; never during the walkthrough, triage or What's new | APP-14 · Decided · M8 step 4b | 02, D-118 |
| 2 | Bottom right of the main window, above the toasts; stays until closed or hidden; shown after ~3 s visible or closed | APP-14 · Decided · M8 step 4b | 02, D-118 |
| 3 | Settings: Reset tips next to Replay walkthrough; both in the palette | APP-11, APP-14 · Decided · M8 step 4b | 02, D-118 |

## BA. A restart during the walkthrough (6 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Step 1's folder change restarts Flint and the tour goes on at step 2, what it made still known | APP-10, DATA-07 · Decided · M8 step 4b | 02, D-119 |
| 2 | A tour cut short by a quit or crash: not resumed; once "The walkthrough was interrupted · Replay" | APP-10 · Decided · M8 step 4b | 02, D-119 |

## BB. The walkthrough's words (6 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | The 8 cards' titles and text, and You're set's | APP-10 · Decided · M8 step 4b | 02, D-120 |
| 2 | The spotlight card: "3 / 8", centred when there is no ring | APP-13 · Decided · M8 step 4b | 09 §8, D-120 |

## BC. The walkthrough, the spotlight and What's new built (6 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | The spotlight: dim with cut-out targets (only they take clicks), rings, a card that never takes the keyboard | APP-13 · Done (0.8.16) | 09 §8, D-121 |
| 2 | The 8-step walkthrough with its triggers; You're set; Remove what I created during the tour (one undo) | APP-10 · Done (0.8.16) | 02, D-121 |
| 3 | Fresh install → tour; step 1's folder change goes on at step 2; a cut-short tour says so once | APP-10 · Done (0.8.16) | 02, D-121 |
| 4 | What's new from `docs/whats-new.md` once after an update; Settings → About and the palette | APP-15 · Done (0.8.16) | 02, D-121 |
| 5 | Replay walkthrough in Settings → General and the palette | APP-10, APP-11 · Done (0.8.16) | 02, D-121 |
| 6 | Step 5's ring and words (no pin on an unpinned row) | APP-10 · Done (0.8.17, D-122: the hover pin) | D-121, D-122 |

## BD. Fixes after 0.8.16; the hover pin; mini's Open a note… (7 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | The hover pin on an open task's row; a click pins, with a pop | TODAY-01 · Done (0.8.17) | 02, 03, 09, D-122 |
| 2 | Step 5 rings the hover pin: "Click its pin, or select it and press P." | APP-10 · Done (0.8.17) | 02, D-122 |
| 3 | What's new at a reading size, with Got it | APP-15 · Done (0.8.17) | 09, D-122 |
| 4 | Replay walkthrough in Settings → About | APP-10, APP-11 · Done (0.8.17) | 02, D-122 |
| 5 | The walkthrough's dim and card stay while the popup or mini is open | APP-13 · Done (0.8.17) | 02, D-122 |
| 6 | Step 4 only for something real; an empty quick note stays open | APP-10 · Done (0.8.17) | 02, D-122 |
| 7 | Mini: the Note tab's Open a note… | MINI-01, NOTE-08 · Done (0.8.17) | 02, D-122 |

