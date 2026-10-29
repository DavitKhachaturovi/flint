# 06 — Roadmap & Open Questions

## 1. Risk-first build order (replaces the separate spike, D-18)

There is **no throwaway spike**. Instead, the three riskiest pieces are built first, **as production code**, at the start of M2/M3, each with measurable acceptance checks. If one fails, it is found in the first days, and only that piece is reworked. Test on an **average laptop with a Teams call active** (including full-screen), not a dev workstation.

| # | Risky piece | Acceptance check |
|---|---|---|
| R-1 | **Popup latency** (CAP-01, CAP-10) | Hotkey → popup visible with focused cursor **< 50 ms** (hard limit 100 ms) over a full-screen Teams call; no blank/white flash; appears on the active monitor; focus returns to the previous app after Enter/Esc. |
| R-2 | **Capture-selection** (CAP-07) | Selected text is captured from a normal window (browser, Teams chat, normal terminal); the original clipboard is restored; hotkey modifiers don't corrupt the Ctrl+C; from an **admin** terminal the failure is detected and the popup opens empty with the hint. |
| R-3 | **Actionable toast** (REM-05) | Done / Snooze 10m / Open work while the toast is on screen **and** from Action Center, including when the main window is hidden; AppUserModelID set; protocol activation routed to the running instance. Works with the unsigned build. |

Also measure: keypress → screen (one frame) and Enter → saved + hidden (< 100 ms). Record the numbers here.

If a piece fails badly, record the finding and decide in the Decision Log before continuing. (Switching shells later is possible but costly; see 05, Future.)

## 2. v1 milestones (Proposed order)

| Milestone | Scope |
|---|---|
| **M1 — Core** | `packages/core`: file format parse/serialize (Dataview inline fields, 04 §3) with round-trip and fuzz tests, task IDs, shorthand parser, natural-language time parser, list/task operations, undo model |
| **M2 — Shell** | **First: R-1 (pre-warmed popup + latency checks) and R-3 (actionable toast).** Then tray, autostart, single instance, hide-not-destroy windows, no accidental quit, crash recovery, settings storage, Flint folder selection, atomic writes, file watcher, window-state per monitor setup |
| **M3 — Capture** | **First: R-2 (capture-selection).** Then shorthand + live chips, `#` autocomplete, paste-to-capture, draft persistence, rebindable hotkeys with conflict detection |
| **M4 — Task lists** | Rows, navigate/edit model, full keymap, drag with springs, priority stripes, subtasks (1 level), expandable body, completion + undo toast + Completed section + timestamps + auto-archive, multi-select bulk actions, temporary sort, multi-line paste, smart link titles, move between lists, delete to Trash |
| **M5 — Notes & media** | CodeMirror live preview, right-click menu, slash commands, code blocks (highlight + copy), monospace toggle, auto-link patterns, images/videos, attachments with relative paths, large-file warning, mode conversion |
| **M6 — Today & reminders** | Star to Today (references), Today ordering, rollover prompt, reminders on any task, natural-language picker, actionable toasts, sound / Focus Assist handling, missed-reminder recovery, bell indicator, Reminders section |
| **M7 — Data safety** | Trash (30 days), global undo for structural ops, snapshots + restore, zip export, orphaned-attachment cleanup |
| **M8 — Polish** | Ctrl+K palette, `?` cheat sheet, mini mode, dark theme per 09 (tokens, depth, icon tiles, chips), density, reduce-motion, calm empty states, teaching-Inbox onboarding, "no telemetry" statement |
| **M9 — Ship** | Unsigned NSIS installer (per-user, no admin), Azure DevOps pipeline producing the `.exe` as a build artifact, version shown in the app, performance budget verification (05). Distributed manually to coworkers (D-19). |

## 3. Later (agreed, deferred)

- **CLI-01** `flint add …` and **CLI-02** `flint list --json` + stable exit codes (also for AI agents).
- **TASK-13** Stale-task fading (v1 already records `lastTouched`).
- **TASK-14** Inbox triage mode.
- **Sync** between machines (see 04, Future: sync).
- **macOS and ARM** builds.
- **Light mode** (v1 is dark only; tokens in `docs/design/tokens.css` get a light set).
- **Decorative graphics** (e.g. a faint header graphic on Today): tried and removed for v1; can be revisited.
- **Integration with other apps** and other the author apps.
- **APP-06 Auto-update** (deferred by D-19; needs an update feed, e.g. a static Azure Storage endpoint).
- **Code signing** (deferred by D-19; Azure Artifact Signing is not available to Georgian organizations, so this needs an OV certificate from a commercial CA).

## 4. Open questions

Each has a proposed default that is used until decided. Record decisions in [07](07-decision-log.md).

| ID | Question | Proposed default |
|---|---|---|
| Q-01 | ~~Priority colors vs cool-only palette.~~ **Resolved (D-17):** grayscale by lightness and thickness, High = 4 px white, Medium = 3 px accent `#9AA0AB`, Low = 2 px `#55585D`. | — |
| Q-02 | Default time when a reminder gives only a day (`tomorrow`, `fri`). (Workday-aware defaults were not selected.) | A fixed 09:00, shown in the chip/preview before confirming. |
| Q-03 | Default global hotkeys for capture and capture-selection. Must avoid common conflicts (Alt+Space = PowerToys Run / window menu, Ctrl+Space = input method switching, Win+ combos = reserved). | Test candidates such as Ctrl+Alt+N (capture) and Ctrl+Alt+Shift+N (capture-selection) while building R-1/R-2; pick what's free on typical the author machines. |
| Q-04 | When/how the Today rollover prompt appears. | On the first open of a new day: "Yesterday's unfinished Today tasks — roll over?" (no fixed end-of-day time needed). |
| Q-05 | Snapshot frequency and retention. | Only when changed; hourly for 48 h, then daily for 30 days. |
| Q-06 | Single-key binding for "move to list" (the `M` key idea was not selected). | No dedicated key in v1; move via Ctrl+K, context menu, and drag to sidebar. |
| Q-07 | CLI command name: `flint` (from "Notes") vs `flint`. | Decide before the CLI ships; `flint` matches the product name. |
| Q-08 | Enter semantics in Navigate state and the "new task" key. "Enter adds a task" is decided for Edit state. | Navigate: Enter = edit selected task; N / Ctrl+N = new task. Edit: Enter = save + new task below. |
| Q-09 | ~~Confirm the on-disk format.~~ **Resolved (D-20):** Dataview inline fields `[key:: value]` (`id`, `priority`, `reminder`, `today`, `completion`), `.flint/meta.json`, `.flint/today.json`, as in 04 §3. | — |
| Q-10 | ~~Where to host the auto-update feed and installers.~~ **Resolved (D-19):** internal tool, `.exe` handed out manually; auto-update and code signing are Later. | — |
| Q-11 | Trademark clearance for the name "Flint". | Clear before any public release. |
| Q-12 | Exact capabilities of mini mode. | Add task, complete task, toggle Today/Inbox, see reminders; everything else opens the main window. |
| Q-13 | Auto-archive default and trigger. | Off by default; Flint offers it when a Completed section grows large (e.g. 50+ items); N = 14 days when enabled. |
| Q-14 | Where new captures land inside Inbox. | Top of Inbox. |
| Q-15 | Default Flint folder location. | `Documents\Flint`, chosen/confirmed during onboarding. |
| Q-16 | Note → task-list conversion of non-list content (headings, paragraphs). | Attach to the nearest preceding task's body; confirm before dropping anything (LIST-04). |
