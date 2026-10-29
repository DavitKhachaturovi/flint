# 06 — Roadmap & Open Questions

## 1. Risk-first build order (replaces the separate spike, D-18)

There is **no throwaway spike**. Instead, the three riskiest pieces are built first, **as production code**, at the start of M2/M3, each with measurable acceptance checks. If one fails, it is found in the first days, and only that piece is reworked. Test on an **average laptop with a Teams call active** (including full-screen), not a dev workstation.

| # | Risky piece | Acceptance check |
|---|---|---|
| R-1 | **Popup latency** (CAP-01, CAP-10) | Hotkey → popup visible with focused cursor **< 50 ms** (hard limit 100 ms) over a full-screen Teams call; no blank/white flash; appears on the active monitor; focus returns to the previous app after Enter/Esc. |
| R-2 | **Capture-selection** (CAP-07) | Selected text is captured from a normal window (browser, Teams chat, normal terminal); the original clipboard is restored; hotkey modifiers don't corrupt the Ctrl+C; from an **admin** terminal the failure is detected and the popup opens empty with the hint. |
| R-3 | **Actionable toast** (REM-05) | Done / Snooze 10m / Open work while the toast is on screen **and** from Action Center, including when the main window is hidden; AppUserModelID set; protocol activation routed to the running instance. Works with the unsigned build. |

Also measure: keypress → screen (one frame), Enter → popup hidden and focus returned (< 50 ms), and Enter → capture durably on disk (< 100 ms at p95) (D-27). Record the numbers here.

### Measurements

| Milestone | What | Target | Measured |
|---|---|---|---|
| M1 | Parse and serialize a 1,000-task list file (`packages/core`) | < 10 ms (Proposed) | parse 5.2 ms, serialize 0.03 ms; edit + save preparation + serialize 0.14 ms |
| M1 | Shorthand parse per keystroke | < 1 ms (Proposed) | 0.008 ms |
| M1 | Shorthand + time parser size, minified and gzipped (it ships in the capture popup) | < 15 KB (Proposed) | 3.7 KB (time parser alone 2.0 KB) |

R-1 numbers: `FLINT_BENCH=50` (apps/desktop, development builds only, D-33) presses the real hotkey through Windows (`SendInput`) over a full-screen stand-in window; key → first frame with the focused input; Electron 45.1.0, 29 Oct 2026. Windows sometimes refuses to hand over the foreground; the popup then takes it explicitly (attaching to the foreground thread), which this run never needed. The benchmark takes over the screen: run it only when the machine is free.

**R-1 accepted (D-36).** Davit accepted R-1 on the measurements above: about 28 ms on a standard work laptop leaves enough headroom under 50 ms. It is re-measured only if capture feels slow in daily use; the laptop benchmark below stays in the repo for that, and is not part of normal builds or the installer.

**Laptop benchmark (only if R-1 is re-measured).** A separate build that measures the popup over a real full-screen Teams call and installs nothing.
1. Build it on a dev machine: `npm run dist:bench` in `apps/desktop` gives `apps/desktop/dist-bench/Flint-R1-benchmark-<version>-win-x64.zip` (about 150 MB; same app and Electron fuses as the installer, identity `com.davitkhachaturovi.flint.bench`, D-33).
2. On the laptop: copy the zip, right-click it → Properties → **Unblock** if offered, unzip it anywhere (e.g. `DesktopFlint-R1`), and quit Flint if it is running (it holds the hotkey). Start `Flint R-1 benchmark.exe`; SmartScreen may ask once (More info → Run anyway).
3. Follow its window: start a Teams call (Meet now on your own is fine), camera on, muted, meeting window full screen; click **Start**, then within 10 seconds click the Teams window; hands off for about a minute. It presses Ctrl+Shift+Space 50 times and closes the popup with Enter; nothing is typed into Teams, Enter is only sent when the popup is confirmed in front, and the run stops if the window in front changes. Tray icon → Quit Flint stops it early.
4. Results: shown in a window at the end and saved as `R-1 results <date>.json` next to the exe: hotkey → focused popup and Enter → hidden-and-focus-returned (p50, p95, max), failures, whether the window in front looked like Teams (its title isn't kept), the M1 parse and shorthand timings on that laptop, and the machine (CPU, cores, memory, Windows version, displays, on battery, Teams running). Send the file to Claude Code (or paste its window), which records it in the table above.
5. Cleanup: delete the unzipped folder. Nothing else is created: no Start Menu entry, no start-with-Windows entry, no `flint://` handler, no app data outside the folder (`bench-data`), no toasts (verified 29 Oct 2026).

R-1 manual check by Davit (29 Oct 2026): hotkey → focused frame 17.3 and 32.1 ms, Enter → hidden and focus returned 8.8 ms, popup in front without the fallback.

R-3 status (29 Oct 2026, Windows 11 25H2, development build): the reminder toast shows with Done / Snooze 10m / Open; clicking each button on the toast (default, reminder and urgent toasts) reaches the running app through `flint://`; opening the links while Flint is not running cold-starts it and handles the action. A click from Action Center reaches the app too. Do Not Disturb (REM-06): a plain toast is suppressed, while toasts with `scenario="reminder"` and `"urgent"` still pop up and stay until dismissed (Windows priority settings at their defaults). Installed (NSIS) build, same day: the toast shows under "Flint" (the installer's Start Menu shortcut carries the AppUserModelID), and its `flint://` actions reach the running app and cold-start it. Install and uninstall were verified too (D-32): uninstalling, also while Flint runs, removes the program, shortcut, `flint://`, start-with-Windows entry and updater copy, and leaves the Flint folder and `%APPDATA%\Flint` byte-for-byte unchanged; installing over an existing install keeps `flint://` and start-with-Windows. Development builds need their "Flint (development)" Start Menu shortcut. Re-checked after D-33 (development identity `com.davitkhachaturovi.flint.dev`, `flint-dev://`), same day: Done clicked on the toast and on an older toast, and Open on a toast while the development build was not running (cold start), all reached the app; no `flint://` handler was involved. Finding: Electron reported notifications unsupported for a whole session when its first notification call came late (from a toast-button launch of the hidden app; also seen earlier with `electron-vite preview`); Flint now sets up notifications at startup and logs `notifications supported: …`.

M1 numbers: `npm run measure` (median of 200–5,000 runs, Node 24) on a developer laptop (Intel Core Ultra 7 258V, 32 GB), not yet on an average laptop. Re-measured on Node 24.22.1 after D-30: parse 6.0 ms, serialize 0.04 ms, save path 0.15 ms, keystroke 0.012 ms, bundle unchanged. Parsing has the least headroom, but it runs in the main process off the capture hot path; with R-1 accepted (D-36) it is not re-measured on another laptop either. Parsing happens in the main process, off the capture hot path.
| M2 | R-1 hotkey → focused popup | < 50 ms (hard limit 100 ms) | p50 28.2 ms, p95 40.3 ms, max 47.7 ms (50/50, standard work laptop, full-screen stand-in window); accepted, D-36 |
| M2/M3 | Enter → popup hidden and focus returned | < 50 ms | p50 13.5 ms, p95 20.2 ms, max 28.9 ms (same run) |
| M2/M3 | Enter → capture durably on disk | < 100 ms at p95 | — |
| M4 | Keypress → character on screen | one frame (~16 ms) | — |

If a piece fails badly, record the finding and decide in the Decision Log before continuing. (Switching shells later is possible but costly; see 05, Future.)

## 2. v1 milestones (Proposed order)

| Milestone | Scope |
|---|---|
| **M1 — Core** | `packages/core`: file format parse/serialize (Dataview inline fields, 04 §3) with round-trip and fuzz tests, task IDs, shorthand parser, natural-language time parser, list/task operations, undo model |
| **M2 — Shell** | **First: R-1 (pre-warmed popup + latency checks) and R-3 (actionable toast).** Then tray, autostart, single instance, hide-not-destroy windows, no accidental quit, crash recovery, settings storage, Flint folder selection, atomic writes, file watcher, window-state per monitor setup |
| **M3 — Capture** | **First (D-37): capture saved to the top of Inbox** (D-27 durable write, failure notice with Retry), draft persistence, the follow-up notice line. Then shorthand + live chips, `##` autocomplete and the new-list card, paste-to-capture, **R-2 (capture-selection)**, rebindable hotkeys with conflict detection |
| **M4 — Task lists** | Rows, navigate/edit model, full keymap, drag with springs, priority stripes, subtasks (1 level), non-task content shown read-only (TASK-15), expandable body, completion + undo toast + Completed section + timestamps + auto-archive, multi-select bulk actions, temporary sort, multi-line paste, smart link titles, move between lists, delete to Trash |
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
| Q-03 | ~~Default global hotkeys for capture and capture-selection.~~ **Resolved (D-37):** capture **Ctrl+Shift+Space**, capture-selection **Ctrl+Shift+X**; no Alt (push-to-talk); both rebindable with conflict detection (APP-08). | — |
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
| Q-14 | ~~Where new captures land inside Inbox.~~ **Resolved (D-22):** top of Inbox, meaning just before the first task (not above a heading or paragraph the file starts with). | — |
| Q-15 | ~~Default Flint folder location.~~ **Resolved (D-24):** `%USERPROFILE%\Flint` (outside OneDrive Known Folder Move), confirmed during onboarding; warn but allow when the chosen folder is inside OneDrive. | — |
| Q-16 | ~~Note → task-list conversion of non-list content (headings, paragraphs).~~ **Resolved (D-22):** it stays in place as non-task content, shown read-only in the task list; nothing is dropped, no confirmation. | — |
