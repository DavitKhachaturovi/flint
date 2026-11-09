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
| Future integrations through the CLI and the shared TypeScript packages | 05 §7, D-04 |
| Built/maintained by Claude, no dev resources | README Status, D-04 |
| Name: Flint; repo `github.com/DavitKhachaturovi/flint`, cloned at `C:\Forge\flint-repo` | README, D-06, D-135 |

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
| Core logic in pure TS packages; narrow Platform interface (future shell switch, integrations) | 05 §2, 05 §7 |
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
| Personal open-source project (MIT); the installer on GitHub Releases from 1.0.0 | 05 §6, D-19, D-135, 06 Q-10 |
| Unsigned v1; SmartScreen "Run anyway" | 05 §6, D-19 |
| No auto-update in v1; v1 makes no network requests | APP-06, APP-09, D-19 |
| Dataview inline fields `[key:: value]` for task metadata | 04 §3, D-20, Q-09 |
| Everything important in the markdown line; side files only hold losable bookkeeping | 04 §3 |
| Round-trip and fuzz tests for the file format | 04 §3, 06 M1 |
| Repo on GitHub (`DavitKhachaturovi/flint`, public, one branch `main`) | README, CLAUDE.md, D-135 |
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
| CI: lint, format, typecheck, tests (10k fuzz runs), build, e2e; GitHub Actions since D-136 | `.github/workflows/ci.yml`, 05 §6 |
| Node 24.22.1+ (CVE-2026-111497), engines + engine-strict, CI pins Node | D-30, 05 §1, `.node-version`, `.github/workflows/ci.yml` |
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
| 6 | Settings entry hidden until Settings exists | APP-11 · Done (Settings in M8 step 1, D-100) | D-52 |
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
| 18 | Guidance spotlight: first-run walkthrough (replacing the teaching Inbox, D-64), contextual tips, What's new with release notes | APP-13, APP-10, APP-14, APP-15 · Done (0.8.16–0.8.18, D-121 to D-123; release notes from 0.4.0, D-64) | 09 §8, 04 §2, D-61 |
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
| 13 | Animation-speed setting that scales all motion | APP-11, APP-12 · Done (0.4.34; mini mode 0.8.9) | D-67, D-100, D-110 |
| 14a | Capture popup: drag only by a grip at the top of the card | CAP-01 · v1 · M4 step 6 (start) | 03 §3, D-47, D-68 |
| 14b | No "Nothing was selected" message (admin hint stays) | CAP-07 · v1 · M4 step 6 (start) | D-68 |
| 14c | Focus returns to the window active right before the popup last got focus; none if it had none | CAP-01 · v1 · M4 step 6 (start) | D-41, D-68 |
| 14d | Date/time picker: day, then a time-of-day view (common times + custom field), back to the calendar | CAP-11 · v1 · M4 step 6 (start) | D-68 |
| 15 | Motion pass over every button, menu, picker, popup and row action | UI-10 · Done (0.8.29, the census kept as a test) | D-67, D-89, D-133 |

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
| 4 | Motion never delays input; fuller durations (selection ~200, menus ~200, pages ~280, completion ~400 ms); popup instant | UI-04, UI-10 · v1 · M4 step 6 (0.4.6 fixes); speed setting Done (0.4.34) | 03 §5, 09 §9, tokens.css, D-75 |
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
| 14 | Settings: Keyboard shortcuts section, global hotkeys rebound there, `?` shows the same list | APP-11, APP-08, NAV-02 · Done (M8 steps 1 and 2, D-100, D-106) | 02, 06 §2, D-80 |
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
| 13 | Clipboard section: Windows clipboard history, docked, insert / Capture as task, settings note | NAV-08 · Done (0.8.23, 0.8.24: D-128, D-129) | 02, D-86 |

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
| 6 | The in-app alert when a reminder fires | REM-06 · Done (0.8.8, with mini mode, D-109) | 02, D-94 |
| 7 | The Focus Assist note in Settings | REM-06 · Done (0.4.34) | 02, D-94 |

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
| 7 | Reminder sound: Windows sound or Flint chime (the toast silent then), with an info card | REM-06, APP-11 · Done (0.4.34) | 02, D-98 |

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
| 9 | Snapshot settings in Settings → Data | DATA-04, APP-11 · Done (M8 step 1, D-100) | 02, D-99 |
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
| 1 | Version numbers follow the milestone: 0.8.0 next; M9 stays 0.9.x, 1.0.0 the first release on GitHub Releases (D-132) | Q-22 · Decided | 06, D-101, D-132 |
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
| 7 | Onboarding: Ctrl+K in the walkthrough; the mouse-opener's one-time Ctrl+K tip | APP-13, APP-14 · Done (0.8.16, 0.8.18) | D-107 |
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
| 5 | Mini mode beside the main window, in sync; Open brings the main window forward | MINI-01 · Done (0.8.8) | 02, D-109 |
| 6 | Mini mode's Note tab: one quick note as a sticky note | MINI-01, NOTE-08 · Done (0.8.8) | 02, 03, D-109 |

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
| 4 | Replay walkthrough in Settings; the walkthrough says so | APP-10, APP-11 · Done (0.8.16; in Settings → About since 0.8.17) | 02, D-112 |

## AU. M8 step 4 decided (6 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Inbox triage, a card at a time, by keyboard, oldest first, with a summary | TASK-14 · Done (0.8.12) | 02, 03, 09, D-113 |
| 2 | The 8-step walkthrough, each step advancing when it is done | APP-10, APP-13 · Done (M8 step 4b, 0.8.16–0.8.18) | 02, D-113 |
| 3 | Existing installs get What's new, fresh ones the walkthrough | APP-10, APP-15 · Done (M8 step 4b, 0.8.16–0.8.18) | D-113 |
| 4 | What's new as one card with the notes since last seen | APP-15 · Done (M8 step 4b, 0.8.16–0.8.18) | 02, D-113 |
| 5 | The first nine contextual tips | APP-14 · Done (M8 step 4b, 0.8.16–0.8.18) | 02, D-113 |

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
| 6 | The walkthrough's spotlight: only the target live, taught keys everywhere, Esc ends it | APP-10, APP-13 · Done (M8 step 4b, 0.8.16–0.8.18) | 02, D-115 |

## AX. Settings right after an update; the walkthrough's steps; Import from Obsidian (6 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Settings saved by an older version work at once after an update (the pages' calls wait for main) | NOTE-07, APP-11 · Done (0.8.15) | D-116, `e2e/startup.spec.ts` |
| 2 | The walkthrough's rings and what moves each step on; the title bar's mini button for step 8 | APP-10, APP-13 · Done (M8 step 4b, 0.8.16–0.8.18) | 02, D-116 |
| 3 | You're set: Remove what I created during the tour (one undoable step) | APP-10 · Done (M8 step 4b, 0.8.16–0.8.18) | 02, D-116 |
| 4 | Import from Obsidian (copy notes and images, never change the vault) | DATA-08 · Later (after v1, D-131) | 02, D-116, D-131 |

## AY. Fresh install or update; What's new in plain language (6 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Fresh install (no settings) → walkthrough; update → What's new once, versions since `lastSeenVersion` | APP-10, APP-15 · Done (M8 step 4b, 0.8.16–0.8.18) | 02, D-117 |
| 2 | What's new shows `docs/whats-new.md` (2–5 plain highlights per version), not the release notes | APP-15 · Done (M8 step 4b, 0.8.16–0.8.18) | 02, whats-new.md, D-117 |
| 3 | What's new from the palette and Settings → About; no tray item | APP-15 · Done (M8 step 4b, 0.8.16–0.8.18) | 02, D-117 |
| 4 | Remove what I created during the tour: only items made during it | APP-10 · Done (M8 step 4b, 0.8.16–0.8.18) | 02, D-117 |

## AZ. Tips: when, where, how long; Reset tips (6 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | A tip 2 s after its pattern, not while typing or with a menu open; never during the walkthrough, triage or What's new | APP-14 · Done (M8 step 4b, 0.8.16–0.8.18) | 02, D-118 |
| 2 | Bottom right of the main window, above the toasts; stays until closed or hidden; shown after ~3 s visible or closed | APP-14 · Done (M8 step 4b, 0.8.16–0.8.18) | 02, D-118 |
| 3 | Settings: Reset tips next to Replay walkthrough; both in the palette | APP-11, APP-14 · Done (M8 step 4b, 0.8.16–0.8.18) | 02, D-118 |

## BA. A restart during the walkthrough (6 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Step 1's folder change restarts Flint and the tour goes on at step 2, what it made still known | APP-10, DATA-07 · Done (M8 step 4b, 0.8.16–0.8.18) | 02, D-119 |
| 2 | A tour cut short by a quit or crash: not resumed; once "The walkthrough was interrupted · Replay" | APP-10 · Done (M8 step 4b, 0.8.16–0.8.18) | 02, D-119 |

## BB. The walkthrough's words (6 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | The 8 cards' titles and text, and You're set's | APP-10 · Done (M8 step 4b, 0.8.16–0.8.18) | 02, D-120 |
| 2 | The spotlight card: "3 / 8", centred when there is no ring | APP-13 · Done (M8 step 4b, 0.8.16–0.8.18) | 09 §8, D-120 |

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

## BE. The tips built (7 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | The nine tips, their patterns, once each, one a session, none in a walkthrough's session | APP-14 · Done (0.8.18; D-125: two a session) | 02, D-123 |
| 2 | When and where a tip shows; seen after 3 s or closed; back after a hidden window | APP-14 · Done (0.8.18) | 09, D-123 |
| 3 | Don't show tips (card, Settings → About), Reset tips (Settings, palette) | APP-14, APP-11 · Done (0.8.18) | 02, D-123 |
| 4 | The tips' words | APP-14 · Done (0.8.18, decided in D-125) | D-123, D-125 |
| 5 | Pickers: Enter takes what was typed for, under a resting pointer too | UI-08 · Done (0.8.19) | D-124 |

## BF. What's new dimmed; the card keeps clear; tips two a session (7 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | What's new over the dim; nothing behind it takes a click until Got it, Esc or × | APP-15 · Done (0.8.20) | 02, 09, D-125 |
| 2 | The walkthrough's card never covers a ring or where you type (step 4: the quick note, the name field); it glides out of the way | APP-13 · Done (0.8.20) | 02, 09, D-125 |
| 3 | Two tips a session at most, at least 10 minutes apart | APP-14 · Done (0.8.20) | 02, D-125 |
| 4 | The tip as far from the right edge as from the bottom (84 px) | APP-14 · Done (0.8.20) | 09, D-125 |
| 5 | What's new at the optical centre (its middle at 45 % of the window) | APP-15 · Done (0.8.21) | 09, D-126 |

## BG. M8 step 5: Windows' clipboard history, the reading (7 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Reading Windows' clipboard history through koffi (WinRT), read-only, text first | NAV-08 · Done (0.8.22) | 05, D-127 |
| 2 | The crash marker: a read that never finished keeps reading off until Retry | NAV-08 · Done (0.8.22) | 02, D-127 |
| 3 | Ctrl+K → Check clipboard history (the proof, before the section) | NAV-08 · Done (0.8.22; checked by Davit; removed in 0.8.23) | 02, D-127 |
| 4 | The Clipboard section in the side panel | NAV-08 · Done (0.8.23) | 02, D-86, D-128 |

## BH. M8 step 5: the Clipboard section (7 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Docked at the panel's foot in every state; folded with the newest 3, open up to 45 %; remembered; text items only | NAV-08 · Done (0.8.23) | 02, 09, D-128 |
| 2 | Placeholder bars with kind and age at rest; the text after a ~300 ms rest of the pointer; Always show contents with its one-time note | NAV-08 · Done (0.8.23) | 02, 09, D-128 |
| 3 | A click pastes into the field with the keyboard (its paste rules, one undo); no field: the toast; press flash | NAV-08 · Done (0.8.23) | 02, D-128 |
| 4 | Right-click: Insert, Capture as task (the popup as by Ctrl+Shift+X), Copy (the only clipboard write) | NAV-08 · Done (0.8.23) | 02, D-128 |
| 5 | Paste from clipboard history… (Ctrl+Shift+H): Enter, Shift+Enter, Ctrl+C; Show / Hide clipboard contents in the palette | NAV-08, NAV-01 · Done (0.8.23) | 02, 03, D-128 |
| 6 | The six states: off, policy, paused, error, no text, refused | NAV-08 · Done (0.8.23) | 02, D-128 |
| 7 | Settings → Clipboard: Clipboard history, Always show contents | NAV-08, APP-11 · Done (0.8.23) | 02, D-128 |
| 8 | Reads in the background: texts at once (~40 ms), the last items kept, re-read on a new sequence number | NAV-08 · Done (0.8.23) | 05, D-128 |
| 9 | Whether Win+V lists a copied item twice after Copy | NAV-08 · It did; Copy is Win+V's pick since 0.8.24 | D-128, D-129 |

## BI. The Clipboard section after 0.8.23 (7 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Pictures: thumbnails (a tile at rest), inserted as a pasted picture, captured as a chip, counted | NAV-08 · Done (0.8.24) | 02, 09, D-129 |
| 2 | Motion: items slide in and fold away; content crossfades both ways | NAV-08, UI-10 · Done (0.8.24) | 09, D-129 |
| 3 | Delete (also from Win+V) with Undo (adds it back as the newest; memory only while offered) | NAV-08 · Done (0.8.24) | 02, D-129 |
| 4 | Clear all, asked inline, no undo (Win+V's pinned items kept) | NAV-08 · Done (0.8.24) | 02, 09, D-129 |
| 5 | Win+V's pins: not reported by Windows' API; no marker | NAV-08 · Checked (D-129) | D-129 |
| 6 | Copy as Win+V's pick (no duplicate) | NAV-08 · Done (0.8.24) | D-129 |
| 7 | Always show contents only in the section and the palette; the setting's new description | NAV-08, APP-11 · Done (0.8.24) | 02, D-129 |
| 8 | A place's scroll position restored on a slow machine too; nothing scrolls under the Clipboard section | NAV-04, NAV-08 · Done (0.8.25) | D-130 |
| 9 | Pictures saved without a temporary folder inside attachments/ | MEDIA-01 · Done (0.8.26) | D-130 |

## BJ. After 0.8.24–0.8.26 (7 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | The sidebar highlight lands exactly on its row after a deletion, in a group too | UI-04 · Done (0.8.27) | D-131 |
| 2 | An empty quick note gone back to isn't removed; each leave waits anew | NOTE-08 · Done (0.8.27) | D-131 |
| 3 | Density (comfortable / compact) | APP-11 · Later (D-131) | 02, D-131 |
| 4 | Import from Obsidian: top level or a group, the vault's folders decided then | DATA-08 · Later (D-131) | 02, D-131 |

## BK. The statement, the plan after v1, versioning (7 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | "Your notes never leave your machine…" as the Privacy row, first in Settings → About | APP-09 · Done (0.8.28) | 02, D-132 |
| 2 | The installer states it | APP-09 · Not in v1 (one-click installer, no page; D-132) | D-132 |
| 3 | The Privacy sentence changes if auto-update comes | APP-09, APP-06 · After v1 | 06 §5, D-132 |
| 4 | GitHub, private references removed, GitHub Releases with auto-update, signing (SignPath Foundation or Certum) | — · Brought forward into M9 (D-135) | 06 §5, D-132, D-135 |
| 5 | 1.0.0 only for the first release on GitHub Releases; M9 stays 0.9.x | Q-22 · Decided (D-132) | 06, D-101, D-132 |
| 6 | The checklist's older M8 rows marked with where they were built | — · Done (0.8.28) | D-132 |

## BL. The motion pass (7 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | The motion census: every kind of action, what animated, a test that fails on a step without motion | UI-10 · Done (0.8.29) | D-133 |
| 2 | The pin pop for P, the menu and the panel's chip | TODAY-01, UI-10 · Done (0.8.29) | D-133 |
| 3 | The slash menu fades in and out | NOTE-03, UI-10 · Done (0.8.29) | 09, D-133 |
| 4 | Settings' link pattern editor and folder panel fade out on Cancel or Save (a copy; the save isn't delayed) | APP-11, UI-10 · Done (0.8.29) | 09, D-133 |
| 5 | Trash: the buttons fade back after the question; an emptied day or list folds away; "Trash is empty." fades in | DATA-02, UI-10 · Done (0.8.29) | 09, D-133 |
| 6 | Instant by decision: reduce-motion, typing, the popup's first frame, opening a list's rows | UI-10 · Recorded | D-133 |
| 7 | A list opened while another program was still writing it shows its tasks once they arrive | DATA-06 · Done (0.8.30) | D-134 |

## BM. Flint on GitHub, open source (7 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Personal open-source project, MIT (`LICENSE`), public at github.com/DavitKhachaturovi/flint; supersedes D-19 | — · Decided (0.9.0) | README, 05 §6, 06 §5, D-135 |
| 2 | No private names in code, tests, fixtures, mockups, screenshots or docs; neutral examples; the rule kept in CLAUDE.md | — · Done (0.9.0) | 06 §5, CLAUDE.md, D-135 |
| 3 | Screenshots re-rendered from the cleaned mockups | — · Done (0.9.0) | 09 §10, D-135 |
| 4 | The history rewritten once from a kit outside the repository (replacements, noreply author, internal-only files, older screenshots), verified, secrets-scanned | — · Kit ready; Davit runs it | 06 §5, D-135 |
| 5 | One branch `main`; no tags until v1.0.0; work continues in a fresh clone | — · Decided | 06 §5, D-135 |
| 6 | Q-07: the CLI's name `flint` | CLI-01 · Proposed | 02, 06, D-135 |
| 7 | Q-11: trademark an accepted risk; WIPO check by Davit before the first push | — · Settled (8 Nov 2026: 58 software records, several active in unrelated markets; name kept) | 06, D-135 |
| 8 | README at the root: why Flint exists, what makes it different (each claim checked against what is built), install, privacy, development, licence; a screenshot of the real app (`docs/readme/flint.png`, the development build in test mode on neutral demo data, 2x) | — · Done (before the move) | README.md |

## BN. Auto-update and GitHub Actions (7 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | electron-updater from GitHub Releases: 30 s after start, every 4 h, on waking when due; background download; install on quit or Restart now; stable only, no downgrade | APP-06 · Done (0.9.1) | 02, 05 §5, D-136 |
| 2 | "Update ready · Flint x · Restart now / Later" once a session, main window only; Later installs on quit | APP-06 · Done (0.9.1) | 02, D-136 |
| 3 | Settings → About: status line, Check for updates / Restart now, the switch "Check for updates automatically" (on) | APP-06, APP-11 · Done (0.9.1) | 02, D-136 |
| 4 | Palette: Check for updates; Restart to update while ready | APP-06, NAV-01 · Done (0.9.1) | D-106, D-136 |
| 5 | Tray: Restart to update only while ready (an exception to the five items) | APP-06 · Done (0.9.1) | D-136 |
| 6 | Privacy row: "…Flint only contacts GitHub to check for updates, which you can turn off." | APP-09 · Done (0.9.1) | 02, D-136 |
| 7 | Network guard: only GitHub's release hosts, HTTPS, the updater's own session, installed builds only; tests use a fake updater (zero endpoints) | APP-09 · Done (0.9.1) | 05, D-31, D-136 |
| 8 | Unsigned updates: verifyUpdateCodeSignature false; HTTPS + SHA-512; signed manifests and code signing as follow-ups | APP-06 · Recorded | 05 §6, D-136 |
| 9 | GitHub Actions: CI on every push to `next` and PR (D-150); release on v* tags with What's new as the text | — · Done (0.9.1) | 05 §6, D-136 |
| 10 | Motion: the status line and button fade, the toast rises and goes (in the census) | UI-10 · Done (0.9.1) | D-89, D-136 |

## BO. Performance checked, a clean quit (8 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | The performance budgets measured on every run, failing only past their hard limits; advisory on CI only if proved flaky there | M9 · Done (0.9.2) | 05 §4, 06 §1, D-137 |
| 2 | Memory after start ~300–350 MB private, hard limit 400 MB | M9 · Decided (Q5) | 05 §4, D-137 |
| 3 | A 1,000-task list over the 100 ms budget: a known issue, virtualised lists after 1.0 | LIST-01 · Later | 06 §0, D-137 |
| 4 | Enter → durably on disk recorded only; Enter → popup hidden and focus back strict < 50 ms | CAP-01 · Done (0.9.2) | 05 §4, D-27, D-137 |
| 5 | A quit during the popup's or mini mode's fade exits cleanly; quit stages logged | APP-03 · Done (0.9.2) | D-138 |
| 6 | Tests: quit inside the popup's fade with a draft; Restart to update with a draft | APP-06, CAP-08 · Done (0.9.2) | e2e/quit.spec.ts, D-138 |
| 7 | The walkthrough's test waits for real triggers (slower machines) | APP-10 · Done (0.9.2) | D-138 |
| 8 | Main-process errors: always logged; never a box while quitting or in a test run; the box as before otherwise | APP-07 · Done (0.9.3) | 05 §4, D-138 |
| 9 | A quit waits (at most 3 s) for pending writes: a capture, the draft, list changes, pins and Today's order | DATA-01, CAP-08 · Done (0.9.3) | 05 §4, D-138 |

## BP. On GitHub, 1.0.0 (8 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | History rewritten and verified; pushed to GitHub; public | — · Done | 06 §5, D-135, D-139 |
| 2 | Repository settings, Actions pinned by SHA, read-only token, secret scanning with push protection, rulesets (main, main CI, releases) | — · Done | D-139 |
| 3 | The logo at the top of the README; the social preview | — · Done (upload by Davit) | D-139 |
| 4 | 1.0.0 on GitHub Releases with latest.yml; installed copies update themselves | APP-06 · Done (1.0.0) | D-136, D-139 |
| 5 | Versions after 1.0.0: 1.0.x fixes, 1.x.0 features | — · Proposed | D-139 |
| 6 | Restart to update hides Flint at once and says it reopens in about a minute (no frozen window) | APP-06 · Done (1.0.1) | 02, D-140 |

## BQ. The live preview made reliable: the plan (8 Nov 2026, grill Q1–Q14)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Rebuild Flint's live-preview layer on the syntax tree (no live-preview library; ProseMirror, Milkdown, Tiptap ruled out) | NOTE-01 · Decided (1.1.0) | D-141 |
| 2 | Block markers and embedded objects show raw only with the caret strictly inside; inline formatting inside or at its edge; ← / → step in; clicks and selections never reveal | NOTE-01 · Built (1.1.0 step 2) | 02, 03 §3, D-141 |
| 3 | A list's number is plain text in the note's font, with the caret on its line or not | NOTE-01 · Built (1.1.0) | D-142 |
| 4 | The checkbox: the shared task-row checkbox in its compact size (17 px) with the row's 12 px tick, centred; hover, press and check-pop | NOTE-01 · Built (1.1.0) | D-141, D-142 |
| 5 | Edit markdown in every embedded object's right-click menu | NOTE-01, MEDIA-01 · Built (1.1.0 step 2) | 02, D-141 |
| 6 | Source mode per note: palette, right-click menu next to Monospace, mini's Note tab, crossfade, not for task bodies; Ctrl+Shift+E | NOTE-09 · Built (1.1.0 step 5) | 02, 03 §3, D-141 |
| 7 | Any `N.` line starts a list (parser extension) | NOTE-01 · Reverted after testing (as in 1.0.1) | 04 §4, D-142 |
| 8 | Renumbering by Flint after structural edits | NOTE-01 · Reverted after testing (as in 1.0.1) | 04 §4, D-142 |
| 8a | Nesting at the parent's text column, the first-item nudge | NOTE-01 · Reverted after testing (Tab indents two spaces, as in 1.0.1) | 04 §4, D-142 |
| 9 | Tables rendered; edge drag adds or removes columns and rows, a warning before deleting content; only changed bytes written | NOTE-10 · Decided (1.2.0) | 02, D-141, 06 §0 |
| 9a | Editing a table: cells in place, Tab / Enter / Shift+Enter / arrows / Esc as in 03 §3, one editor at a time, the note's own undo, Ctrl+F into cells, whole-table selections, sideways scroll; in notes, mini's Note tab and task bodies (edited and rendered) | NOTE-10 · Decided (1.2.0) | 02, 03 §3, D-141 |
| 9b | Writing a table back: only the edited cell's bytes, padding kept, `\|` escaping, pasted line breaks as spaces, short rows grow to the edited cell, extra cells kept, new rows and columns in the existing style, line endings kept | NOTE-10 · Decided (1.2.0) | 04 §4, D-141 |
| 9c | Align table: right-click menu and palette, the whole table re-padded in one undo step (details and the toast Proposed) | NOTE-10 · Decided (1.2.0) | 02, 04 §4, D-141 |
| 9d | A table's size and shape: edge-drag handles (one column or row per step, at the end, dimmed before it goes, Esc cancels, minimum one column and the header), the inline warning for drags that remove text; Add row above / below, Add column left / right, Delete row / column / table with an Undo toast, in the menu and palette | NOTE-10 · Decided (1.2.0) | 02, D-141 |
| 9e | Reordering table rows and columns by drag | NOTE-10 · Later | D-141 |
| 9f | Motion: markers and Align table instant (in the census as such); the checkbox pop, table rows and columns, the drag's dimming, the active cell's ring, the warning and Source mode animated; every action in the motion census | NOTE-01, NOTE-09 · Decided (1.1.0); NOTE-10 (1.2.0) | D-141 |
| 10 | Editor test corpus: CommonMark and GFM spec examples (CC BY-SA, own folder), the real notes folder local-only (`FLINT_CORPUS`, read-only, no note text printed), randomised editing tests; decorations checked against the syntax tree at every caret position; no copies of real notes in the repository | NOTE-01 · Built (1.1.0) | D-141, D-142 |
| 10a | Long fuzzing: `npm run fuzz` on demand (a time budget) and a nightly scheduled GitHub Actions run, core's format fuzz and the editor's, the seed printed | NOTE-01 · Built (1.1.0 step 1) | 05, D-141 |
| 11 | Ctrl+E for inline code (decided in D-106, never built), built with this work | NOTE-02 · Built (1.1.0 step 5) | 03 §3, D-141 |
| 12 | Two releases: 1.1.0 the reliable live preview (corpus, reveal rule, Edit markdown, lists, checkbox, Source mode, Ctrl+E, nightly fuzzing), 1.2.0 tables; each a local installer for Davit first, released only after his OK | NOTE-01, NOTE-09, NOTE-10 · Decided | 06 §0, D-141 |
| 13 | The live preview's decisions as a pure function (`buildPreview`), the parser's additions in one module | NOTE-01 · Built (1.1.0 step 1) | D-141 |
| 14 | Fixed (found by the spec examples): a link whose address starts on the next line crashed the drawing; formatting inside a link's text showed raw; an image spanning lines | NOTE-01 · Built (1.1.0 step 1) | D-141 |
| 15 | A note's line endings kept by the editor (`\r\n` stays `\r\n`) | NOTE-01 · Proposed, built (1.1.0 step 1) | 04 §4, D-141 |
| 16 | A picture drawn with the caret beside it; raw (the picture after it) with the caret inside its markdown | NOTE-01, MEDIA-01 · Built (1.1.0 step 2) | D-141 |
| 17 | A click before a hidden line prefix puts the caret after it; a bullet click places the caret | NOTE-01 · Built (1.1.0 step 2) | D-141 |
| 18 | Source mode and Monospace in the palette while a note is open | NOTE-09, NOTE-06 · Built (1.1.0 step 5; Monospace's: Proposed) | 02, D-141 |
| 19 | Text formatting (Bold, Italic, Code…) as palette commands | NOTE-02 · Not doing: a deliberate exception to D-106 | 02, D-142 |
| 20 | One caret beside a drawn picture (the browser's hidden there, Flint's at the real position, the text caret's size) | NOTE-01, MEDIA-01 · Built (1.1.0) | 02, D-142 |
| 21 | The colleague's first name in the published history left as is; the fix in the next push; the local hooks widened (with a local test) | — · Decided | D-142 |
| 22 | A checked item in a note: dimmed and struck through from its text on (chips unstruck); task rows unchanged | NOTE-01 · Built (1.1.0) | 02, D-142 |
| 23 | The table model: rows and cells with exact ranges; setCell, addRow, addColumn, deleteRow, deleteColumn, deleteTable, alignTable; the edge pipe written where GFM needs it (Proposed) | NOTE-10 · Built (1.2.0 step 1; the edge-pipe detail accepted) | 04 §4, D-141 |
| 24 | Tables drawn in the editor (block widget, the rendered body's look, sideways scroll) and cells edited in place with the Q9 keys, the note's own undo, whole-table selections | NOTE-10 · Built (1.2.0 steps 2–3) | D-141 |
| 25 | The table's commands in its right-click menu and the palette (while the caret is in a table); deletes and Align table with an Undo toast; Edit markdown | NOTE-10 · Built (1.2.0 step 4) | D-141 |
| 26 | The edge drag: columns and rows added or taken away at the end in one step, dimmed and counted during the drag, Esc cancels, the warning before text goes (a toast since D-144, row 31) | NOTE-10 · Built (1.2.0 step 5) | D-141 |
| 27 | The table's motion: the ring glides, shape changes ease, new rows and columns fade in; in the motion census | NOTE-10 · Built (1.2.0 step 6) | D-141 |
| 28 | Text typed below a table stays out of it: a blank line written before a line that would become a row without a pipe (one undo step; Backspace moves up instead), a `\|` row typed under a table shows it raw, Insert ▸ Table leaves a blank line before following text; tables and pictures together in the randomised tests | NOTE-10 · Built (1.2.0, second preview; Proposed) | 02, 04 §4, D-144 |
| 29 | The same guard for Backspace / Ctrl+Backspace on the blank line under a table (the caret into its last cell) and Delete at its end, in Source mode, and for tables in a quote or a list item (a quoted table read without its `>` column); deletes and table edges in the randomised tests | NOTE-10 · Built (1.2.0, second preview; Proposed) | 02, 04 §4, D-144 |
| 30 | A pasted picture: the caret drawn beside it at once, measured again when the picture (a video's metadata) loads, not left at the 64 px placeholder's edge inside it | NOTE-10 · Built (1.2.0, second preview; Proposed) | D-142, D-144 |
| 31 | The edge drag's warning as the window's toast (Delete / Cancel, 8 s), never in the note; Cancel, Esc, the time running out or another toast cancel; the cells stay dimmed while it is up; Esc closes a palette, menu, picker, the find bar or the slash menu over it first; opening another note cancels it | NOTE-10 · Built (1.2.0, second preview; Proposed) | 02, 03 §4, D-144 |
| 32 | The edge handles as small "+" chips beside the middle of the right and bottom edges (fading in on hover, outside the cells, never taking a click into them); during a drag a dashed ghost of the new columns or rows (the box grows for it, the count in it) or a dashed outline round the dimmed ones that go (the "+" a "−"); in the motion census; no scrollbar under a table as wide as the note; a click under or beside a table, off its cells and handles, puts the caret on the line after it | NOTE-10 · Built (1.2.0, second preview; Proposed) | 02, D-144 |
| 33 | Selecting cells: a drag, Shift+click or Shift+arrows select a rectangle (the anchor keeps the ring, the others a soft fill, fading); Ctrl+C copies tab-separated text and a markdown table (a Flint note pastes it as a table); Delete / Backspace / Ctrl+X clear in one undo step of their own (never joined with typing just before) with an Undo toast; tab-separated text pasted into a cell fills cells, growing the table (new rows and columns fade in); Clear selected cells in the palette and the menu; `setCells` / `clearCells` linear in the rows (a 5,000-row paste under 500 ms) with a randomised test, short rows included; in the motion census | NOTE-10 · Built (1.2.0, second preview; Proposed) | 02, 03 §3, D-144 |
| 34 | A click anywhere on the line under a table lands on that line (the table's block has no vertical margin, which CodeMirror's height map would leave out) | NOTE-10 · Fixed (1.2.0, second preview) | D-144 |
| 35 | A table without edge pipes keeps its cells: a new empty row written with both edge pipes, so a grow paste, Enter and Tab work there; a randomised grow test over any table | NOTE-10 · Fixed (1.2.0, second preview; Proposed) | 04 §4, D-144 |
| 36 | Backspace on the empty line under a table that ends the note: the text unchanged, the caret at the end of the last cell | NOTE-10 · Fixed (1.2.0, second preview) | 02, 03 §3, D-144 |
| 37 | Esc with the edge drag's question up goes first to the note's find bar or slash menu over it | NOTE-10 · Fixed (1.2.0, second preview) | 02, 03 §4, D-144 |
| 38 | A click under a table (and ↓ from its last row): at the note's end the line made as Esc makes it; in a quote after the quote's mark; above a heading a new line | NOTE-10 · Fixed (1.2.0, second preview; Proposed) | 02, D-144 |
| 39 | A table's Undo toast goes once the note changes again; after its Undo the note (its active cell) has the focus | NOTE-10 · Fixed (1.2.0, second preview; Proposed) | D-144 |
| 40 | The caret beside a picture redrawn on any change of its size (loaded, "File not found", a player), not only on its load | NOTE-10, MEDIA-01 · Fixed (1.2.0, second preview) | D-144 |
| 41 | The editing fuzz again checks that plain text typed outside every table never changes a table's bytes (a table under a fence, or right under a line, excepted) | NOTE-10 · Done (1.2.0, second preview) | D-144 |
| 42 | The table rows' container prefix read in one pass, without a nested quantifier (CodeQL) | NOTE-10 · Fixed (1.2.0, second preview) | D-143, D-144 |
| 43 | A paste from a cell a short row hasn't got selects what it filled (the caret in a corner its row has); an edge drag gives the note's editor the focus, so Ctrl+Z undoes it | NOTE-10 · Fixed (1.2.0, second preview; Proposed) | D-144 |
| 44 | A table's Undo toast goes with its note's editor (another note opened, mini mode's tab changed), as the drag's question does | NOTE-10 · Fixed (1.2.0, second preview) | D-144 |
| 45 | A click under a table, ↓ and Esc never write to a read-only note (a newer format, or locked while another window edits it, D-109): the caret only moves | NOTE-10 · Fixed (1.2.0, second preview) | D-109, D-144 |
| 46 | The caret on the line under a table skips only the prefix the table's rows have: under a table outside any container, at the line's start (spaces there never make the text code) | NOTE-10 · Fixed (1.2.0, second preview) | D-144 |
| 47 | An edit that writes no `|` never makes a line a table's row (text typed before a quote's or list item's mark under a table, the mark deleted): the line goes below the blank line | NOTE-10 · Fixed (1.2.0, second preview; Proposed) | 02, D-144 |
| 48 | The blank line that ends a table keeps only the `>` marks of the quotes it stands in (a row that starts with `>` outside a quote gets an empty one) | NOTE-10 · Fixed (1.2.0, second preview) | D-144 |
| 49 | A `/` typed in a table's cell is just a slash: no slash menu in a table (a slash menu for cells is for later) | NOTE-10 · Built (1.2.0) | `editor/slash.ts`, D-149 |

## BR. 1.1.1: security alerts (8 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | CodeQL #4: the `##` list name's trailing dots in one pass; also `matchTime` reads at most six words, code spans walked once, list lookups indexed (many lists, long names) | CAP-03, CAP-05, REM-02 · Fixed (1.1.1) | `shorthand/parse.ts`, `shorthand/lists.ts`, `time/parse.ts`, D-143 |
| 2 | CodeQL #5–#8: paste titles, trailing spaces, fenced blocks and image links read by linear scanners, with four unflagged patterns in the same file | CAP-06, CAP-07 · Fixed (1.1.1) | `shorthand/paste.ts`, `shorthand/paste-scan.ts`, D-143 |
| 3 | CodeQL #9: the Go function line and the located frame of stack traces in linear time | CAP-06 · Fixed (1.1.1) | `shorthand/trace.ts`, D-143 |
| 4 | The highlighter's file-and-line and JSON token patterns (unflagged) in linear time | CAP-06 · Built (1.2.0) | `renderer/highlight/tokens.ts`, D-143 |
| 5 | CodeQL #1–#3: package names fully encoded in the release-age check; the release-notes heading matched as text; the workspace test's prefix compared as text | — · Fixed (1.1.1) | `scripts/`, `workspace.test.ts`, D-143 |
| 6 | Dependabot #1: minimatch (development and build only, not reachable) overridden to 11.0.3 for the vulnerable range; the preview's packed files compared with 1.1.0's; the override removed once the tools move to 11 | — · Fixed (1.1.1) | `package.json`, D-30, D-143 |
| 7 | Tests: each fix compared with the code it replaced (property tests) and timed on 50,000-character pathological inputs | CAP-03, CAP-06 · Done (1.1.1) | D-143 |
| 8 | The file format's task-line reader is quadratic on long field-like text (not a CodeQL alert) | — · Decided (Davit): its own change right after 1.1.1; done for 1.2.0 (BS) | 04 §3, D-21, D-143, D-146 |
| 9 | A note's line chosen in Ctrl+K flashes once it is drawn, not after a fixed 60 ms | NAV-01 · Fixed (1.1.1) | D-143 |
| 10 | A note's line from Ctrl+K: the words searched for lit as Ctrl+F's current match (the line's text on a loose match), then fading; gone at the first edit | NAV-01 · Fixed (1.1.1) | 09, D-143 |
| 11 | A note opened again after another note gets its own editor (D-115's kept editor only for its own ID step); a change from outside is not an undo step | NOTE-01, D-115 · Fixed (1.1.1) | D-143 |

## BS. The task-line reader in linear time (D-146)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | `parseTaskContent` linear on long field-like lines (unclosed fields, code spans, nested brackets, escapes, a run of spaces): the next `::` and bracket kept per scan, code spans walked once, values closed from one pass per bracket kind; byte for byte the same results (linear with item 5's code-span scan) | — · Done (1.2.0) | 04 §3, `format/fields.ts`, D-21, D-143, D-146 |
| 2 | The writer's last resort (`escapeEverything`, `insertBackslashes`) linear, the same output | — · Done (1.2.0) | `format/fields.ts`, D-146 |
| 3 | Tests: 24 reader and writer shapes of 50,000 characters under 100 ms (each fails on the old code); the old reader (with the old code-span scan) and writer as the reference in a property test (200,000 inputs once, identical); `packages/core` green with `FLINT_FUZZ_RUNS=20000` | — · Done (1.2.0) | `fields.linear.test.ts`, D-146 |
| 4 | `escapeTitle` on nested field-like titles: one more opener escaped per pass (8 s at 50,000 characters); reached when a typed title is saved, and from a file's changed task when its title doesn't read back as it is | — · Found, not fixed: its own change in 1.2.0 (Proposed, Davit to decide) | D-146 |
| 5 | The code-span scan (`codeSpanRanges`) linear: an escaped backtick before longer runs (`\``` repeated, 1.55 s at 50,000 characters) and runs of rising length; the runs listed once by length, each with a forward cursor; the same spans (review of D-146) | — · Done (1.2.0) | `format/code-spans.ts`, D-143, D-146 |
| 6 | The writer tries the title as it is before working out its escaped forms: a changed task read from a file no longer pays for the repeated escaping when its title reads back (7.7 s at 50,000 characters before); the same output (review of D-146) | — · Done (1.2.0) | `format/fields.ts`, D-146 |
| 7 | Tests: 8 code-span shapes (rising runs at 400,000), 3 writer shapes on a line read from a file and then changed, `escapeTitle` on escaped backticks, each under 100 ms (each fails on the old code); the old and new code-span scans and the writer on completed and pinned lines compared (200,000 inputs once, identical) | — · Done (1.2.0) | `fields.linear.test.ts`, D-146 |

## BT. Go to from the composer's toast (D-147)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | A task the composer sends to another list (`##list`): "Added to <list>" with Go to <list> and Undo; Go to opens the list, the task selected, scrolled into view and flashed (Restore's path, D-98) | CAP-05 · Built (1.2.0) | 02, D-147, `smoke.spec.ts` |
| 2 | The same for a list's new row typed below a task | CAP-05 · Built (1.2.0; Proposed) | 02, D-147 |
| 3 | Mini mode's composer: Go to opens the main window at the list, the task selected and flashed; mini stays | MINI-01 · Built (1.2.0; Proposed) | 02, D-147, `mini.spec.ts` |

## BU. App icon detail at small sizes (9 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Taskbar and tray icons: the master's facets at every small size, a hairline outline with a lit upper edge; logos drawn at 16, 24, 32 and 48 px, each `.ico` size from the nearest | UI-07 · Built (1.2.0) | 09 §8, D-148 |

## BV. 1.2.1: CI once per commit, the cell-focus race, the title escape (9 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | `ci.yml` on pushes to `next` and pull requests only; the release gate is `next`'s run of the same commit | — · Done (1.2.1) | 05 §6, D-150 |
| 2 | A table cell takes the keys in the same step it lights up (a click, Backspace or ↓ from the note); the tests' focus waits gone, keys typed right after the key | NOTE-10 · Done (1.2.1) | D-152, `tables.spec.ts` |
| 3 | The title escape: at most 16 passes, then every bracket with `::` after it; 30–70 ms instead of 8 s at 50,000 characters; the same output wherever 16 passes do | — · Done (1.2.1) | 04 §3, D-153, `fields.linear.test.ts` |

## BW. Give to Claude (9 Nov 2026, grill Q1–Q9)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | The prompt: title, notes, subtasks with state and notes, fields stripped, attachments absolute, untitled label, subtask with `Part of:` | TASK-18 · Built (1.3.0) | 02, D-151 |
| 2 | The link: `claude://code/new?q=…&folder=…`, only through `shell.openExternal`, only `claude://`; a refused open and a missing handler give the not-installed toast with Download | TASK-18 · Built (1.3.0) | 02, D-151 |
| 3 | Limits: 14,336 characters and 30,000 encoded; over either, the clipboard, said in the footer before giving | TASK-18 · Built (1.3.0) | 02, D-151 |
| 4 | The card: default, recent (5) and Choose a folder…, missing folders dimmed, Enter, Shift+Enter (default), Esc, the count and token estimate | TASK-18 · Built (1.3.0) | 02, D-151 |
| 5 | Entry points: right-click menu, palette, side panel task details, G in Navigate; not with several marked, mini, triage, popup or note rows | TASK-18 · Built (1.3.0) | 02, D-151, D-106 |
| 6 | Folders in `settings.json` by list id; the list's Claude folder › menu; Settings → Claude; the three palette commands | TASK-18 · Built (1.3.0) | 02, D-151 |
| 7 | Privacy row's sentence; no network request (the e2e network test unchanged) | APP-09 · Built (1.3.0) | 02, D-151 |
| 8 | Motion: the card as the palette's, the toast's | TASK-18 · Built (1.3.0) | 03 §5, D-89 |

## BX. 1.3.1: a cell's backslashes, CodeQL on next (9 Nov 2026)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | A table cell's backslashes written once: a pipe escaped after an even run, an escaped one kept, trailing backslashes as typed (a space before a tight pipe); the caret's place by the same writer; `hasRowPipe` by the run's parity | NOTE-10 · Done (1.3.1) | D-154, `table.test.ts`, `tables.spec.ts` |
| 2 | The randomised table tests write backslashes; a cell's own text written back changes nothing, in any table | NOTE-10 · Done (1.3.1) | D-154 |
| 3 | CodeQL (advanced setup, `codeql.yml`) on pushes to `main` and `next`, pull requests, weekly | — · Done (1.3.1) | D-155 |

## BY. The flaky-test batch (9 Nov 2026, D-156)

| # | Item | ID · status · milestone | Where |
|---|---|---|---|
| 1 | Linear-time checks by growth from n to 4n (`expectLinear`), in a timing pass of their own (`*.timing.test.ts`, one file at a time) | — · Done (1.3.1) | D-156 |
| 2 | `parseTsv`: a large quoted cell in linear time | NOTE-10 · Done (1.3.1) | D-156, `table.timing.test.ts` |
| 3 | A list whose file can't be read just then keeps its ID (no blank page) | DATA-06 · Done (1.3.1) | D-156, `workspace.test.ts` |
| 4 | Editor tests parse to the end (`parseFully`); workspace tests wait for their writes before cleanup | — · Done (1.3.1) | D-156 |
| 5 | End-to-end: test windows draw and keep their timers off-screen; the pin's pop, the popup's field, a new note's editor and mini's recorder waited for | — · Done (1.3.1) | D-156 |
