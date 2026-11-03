# 07 — Decision Log

Every significant decision, newest at the bottom. To change a decision, add a new entry that supersedes it; don't edit history.
Status: **Decided** (confirmed by Davit) or **Proposed** (designed by Claude, needed by decided features, awaiting confirmation).

---

### D-01 — Product focus: quick capture for developers, not a PM tool
- **Date:** Oct 2026 · **Status:** Decided
- **Decision:** Flint is a minimal, beautiful, keyboard-first app for capturing spontaneous tasks/bugs as fast as possible (e.g. during a call or while working on something else) and for writing down what to focus on today. It is explicitly **not** ClickUp, Jira, or similar.
- **Rationale:** Existing tools optimize for managing work; none optimize for the 3-second capture moment.

### D-02 — Core model: lists in two modes
- **Date:** Oct 2026 · **Status:** Decided
- **Decision:** Markdown by default. Two list modes: **note mode** (free-form, Obsidian-like, right-click formatting menu) and **task-list mode** (each line a separate draggable task, like Microsoft To Do; drag to top to focus). Priority low/medium/high shown by color coding instead of text. Completed tasks move to a Completed section in the same list instead of disappearing. Users can create multiple lists of both modes. Images and videos supported. Data saved as markdown in a user-configurable folder.

### D-03 — No sync in v1
- **Date:** Oct 2026 · **Status:** Decided
- **Decision:** v1 has no syncing of any kind.
- **Rationale:** The original idea was syncing the folder via OneDrive for collaboration without a server. Folder sync can't merge concurrent edits; OneDrive creates machine-named conflict copies that often go unnoticed. Fine for one person on several machines, fragile for several people on one list. Lessons recorded in 04 for later.

### D-04 — Stack: Electron + React + TypeScript
- **Date:** Oct 2026 · **Status:** Decided
- **Context:** Initially Claude recommended Tauri 2 (Rust backend) for lower RAM (~40 MB vs ~150+ MB), smaller installer (~8–10 MB vs ~100 MB), and faster cold start. Then a new constraint appeared: **no developer resources; Flint will be built and maintained mostly by Claude Code.**
- **Decision:** Electron.
- **Rationale:**
  - Claude is most productive in TypeScript, and other engineers can step in on TypeScript but not Rust.
  - Risky features have proven Electron paths; Tauri's desktop notification action buttons were only weeks old (plugin v2.6.0, Oct 10, 2026).
  - Perceived performance (popup, typing, animation) is equal: on Windows, Tauri's WebView2 is Chromium too. Popup speed comes from pre-warming, not the framework.
  - 150–200 MB idle RAM judged acceptable.
  - Most tools around it are JS/TS → easier future integration (e.g. other apps).
- **Alternatives rejected:** C++/Qt and Python (would require building a live-preview markdown editor from scratch; Python .exe packaging is slow to start and prone to antivirus false positives); WinUI/.NET (blocks macOS and TS code sharing); Tauri (above).
- **Escape hatch:** core logic in pure TS packages + a narrow Platform interface, so a later shell switch only rewrites the native layer (05).

### D-05 — Platform: Windows x64 installable .exe first
- **Date:** Oct 2026 · **Status:** Decided
- **Decision:** v1 ships as an easily installable `.exe` for Windows x64. macOS and ARM later.

### D-06 — Name and brand: Flint
- **Date:** Oct 2026 · **Status:** Decided (trademark not yet cleared, Q-11)
- **Decision:** Product name **Flint** (formerly "Notes"). Cool palette only (black/gray/blue/white/purple; no warm colors, no greens). Logo: centered knapped-flint leaf alone on a dark tile, light blue-gray palette, irregular flint shading; no sparkles/glows/gradients; carved-groove idea dropped (unreadable small); must not resemble Obsidian's logo.
- **Repo:** `C:\Forge\flint` (not yet a git repo).

### D-07 — Reminders on every task, in v1
- **Date:** Oct 2026 · **Status:** Decided
- **Decision:** Every task can have a reminder (press a button, set a time) that triggers a Windows notification and/or a sound. Natural-language times, actionable toasts (Done / Snooze 10m / Open), missed-reminder recovery, bell indicator + Reminders section in Today, lightweight snooze presets. Ceiling: no recurring reminders, no calendars.

### D-08 — Priority styling
- **Date:** Oct 2026 · **Status:** Decided (exact colors: Q-01)
- **Decision:** Thin left-edge stripe (no row tint), second non-color cue (thickness/shape), color-blind-safe palette option, "no priority" default and visually neutral.
- **Rationale:** Color-only red/amber/green fails for roughly 8% of men; tinting whole rows is noisy; if everything is colored nothing stands out.

### D-09 — Feature list v1 / Later
- **Date:** Oct 2026 · **Status:** Decided
- **Decision:** The feature set in [02](02-features.md), as selected over three brainstorming rounds. Later: CLI (+ JSON output), triage mode, stale-task fading.
- **Not selected (do not build without a new decision):** see 01, "Considered and not selected".

### D-10 — Non-goals
- **Date:** Oct 2026 · **Status:** Decided
- **Decision:** No assignees, extra statuses, due-date calendars, comments, nested projects, unlimited nesting, recurring tasks/reminders, tags alongside lists, backlinks/graph view, voice capture (01).

### D-11 — Performance comes from architecture
- **Date:** Oct 2026 · **Status:** Decided
- **Decision:** Never destroy windows (hide only); never quit by accident (X hides, Quit in tray); apply updates on quit or idle, never mid-session; recover from renderer crashes silently; keep the popup tiny and pre-warmed. Budgets in 05.

### D-12 — Stable task IDs
- **Date:** Oct 2026 · **Status:** Decided; storage format superseded by D-20 (`[id:: …]` field instead of `^id`)
- **Decision:** Every task has a stable ID stored in its markdown line.
- **Rationale:** Today references, reminders, undo, and external edits (CLI/Claude) all break if tasks are identified by line position.

### D-13 — Navigate vs Edit keyboard states
- **Date:** Oct 2026 · **Status:** Proposed (Q-08)
- **Decision:** Task lists have a Navigate state (single keys are commands) and an Edit state (keys type text), visibly distinct. Enter/click → Edit; Esc → Navigate.
- **Rationale:** Space completes and 1/2/3/0 set priority, but users also type spaces and digits into tasks.

### D-14 — User data vs machine state
- **Date:** Oct 2026 · **Status:** Proposed (was tied to Q-09; D-20 resolved Q-09 for the file format only)
- **Decision:** Content lives in the Flint folder; settings, window state, drafts, and UI state live in app data (04).
- **Rationale:** Keeps the Flint folder clean and portable, and avoids the sync-conflict problem if sync is ever added.

### D-15 — CLI later, designed for humans and AI agents
- **Date:** Oct 2026 · **Status:** Decided (name: Q-07)
- **Decision:** A CLI (`flint add …`, `flint list --json`, stable exit codes) comes after v1. It reuses the core package and writes the same files; the app picks changes up through the file watcher. It also lets AI models (e.g. Claude) add and read tasks.

### D-16 — No telemetry
- **Date:** Oct 2026 · **Status:** Decided
- **Decision:** No telemetry or analytics. The only network use is auto-update. Stated plainly: "Your notes never leave your machine."

### D-17 — Visual design v1: dark, grayscale, "solid glass"
- **Date:** Oct 2026 · **Status:** Decided
- **Decision:**
  - Logo final: `assets/icon/flint-icon-512.svg`.
  - v1 ships **dark mode only**; light mode is Later.
  - Grayscale palette with one cool-gray accent **`#9AA0AB`** and **white** for emphasis. No purple or other hues in the UI.
  - Visual language inspired by a chat-style Excel add-in: soft layered shadows, smooth rounded corners, icon tiles, monospace chips, composer-style capture box, headings with key words emphasized, rounded-square bullets. Its purple highlights become white.
  - "Solid glass": Liquid-Glass-like depth (edge ring, inner top highlight, soft drop shadows) and springy motion, **without translucency**.
  - Priority by lightness and thickness only (High 4 px white, Medium 3 px accent, Low 2 px dim): **resolves Q-01** and makes the separate color-blind palette option unnecessary.
  - Fonts Geist / Geist Mono, bundled with the app.
  - Motion capped at 150 ms (spring curve with slight overshoot).
  - No decorative graphics in v1 (a faint header graphic on Today was tried and removed).
- **Alternatives considered:** accent `#999E98` (rejected: slight green tint clashes with the cool logo and the no-greens rule); a cool-hued priority scale (gray/blue/purple, rejected in favour of grayscale).
- **Spec:** [09](09-visual-design.md), tokens in `design/tokens.css`, screenshots and static mockups in `design/`.

### D-18 — No separate spike; risk-first production build
- **Date:** Oct 2026 · **Status:** Decided
- **Decision:** Drop the throwaway 2–3 day spike (former M0). Build the three riskiest pieces first as production code, at the start of M2/M3, with measurable acceptance checks (06 §1: R-1 popup latency, R-2 capture-selection, R-3 actionable toast).
- **Rationale:** the spike existed to de-risk the shell choice (Electron vs Tauri). With Electron decided and these features on documented paths, a failure would mean reworking one feature, not changing the stack, so throwaway code would mostly be wasted time. Building them first still surfaces problems in the first days.

### D-19 — Internal distribution, unsigned, no auto-update in v1
- **Date:** Oct 2026 · **Status:** Decided
- **Decision:** v1 is a tool handed out by hand. The installer `.exe` (a pipeline artifact) is handed to coworkers manually. No code signing and no auto-update in v1; both move to Later. Open-sourcing is far in the future and out of scope.
- **Rationale:** Azure Artifact Signing (formerly Trusted Signing) does not issue public-trust certificates to organizations in Georgia; the alternative (an OV certificate from a commercial CA) needs CA identity validation, a hardware/HSM-held key, and a yearly fee, and new certificates still have to build SmartScreen reputation. Not worth it for an internal tool. Without a hosted feed, auto-update has nothing to update from.
- **Consequences:** users click "More info → Run anyway" on SmartScreen once per new installer; updates are installed by running the new `.exe` over the old one; v1 makes no network requests at all.

### D-20 — Task metadata uses Dataview inline fields
- **Date:** Oct 2026 · **Status:** Decided (resolves Q-09)
- **Decision:** Task metadata is written as Dataview bracketed inline fields, `[key:: value]`: `priority`, `reminder`, `today`, `completion`, `id`. Unknown fields are preserved; the reader is tolerant, the writer canonical. Everything that matters is in the markdown line; side files (`meta.json`, `today.json`) hold only bookkeeping that is harmless to lose.
- **Rationale:** an existing, widely used convention (Dataview, Obsidian Tasks "Dataview format") instead of an invented one; explicit delimiters make parsing unambiguous, unlike the earlier trailing tokens (`!high ⏰… ★ ^id`), which could collide with title text and depended on emoji encodings.
- **Alternatives considered:** the original trailing-token format; Obsidian Tasks' emoji format (compact but emoji-dependent); todo.txt (different file model, not markdown).

### D-21 — Where inline fields are recognized; canonical field order
- **Date:** Oct 2026 · **Status:** Decided (refines D-20; pre-M1 review, Q1–Q2). Valid-value details Proposed.
- **Decision:**
  - Flint's own keys (`priority`, `reminder`, `today`, `completion`, `id`) are fields anywhere in a task line, in `[]` or `()`, with or without a space after `::`, **but only when the value is valid for that key**. Otherwise the text is title text, untouched and visible.
  - Unknown keys are fields only in the **trailing run** of fields at the end of the line, and only with whitespace after `::`: `[due:: 2026-11-02]` is a field, `[Vec::new]` is title text.
  - Nothing inside an inline code span is ever a field.
  - Canonical write order: `reminder`, `today`, `completion`, `priority`, `id`, then unknown fields in their original order, then a trailing Obsidian block ID (`^a1b2`) if the line has one.
  - Compatibility, stated honestly: queryable with Dataview; Obsidian Tasks (Dataview format) reads `priority` and `id` only. Obsidian compatibility is a bonus, not a goal: `completion` keeps its time.
  - Valid values (**Proposed**): `priority` is `low`/`medium`/`high` (plus Obsidian Tasks' `lowest`/`highest`, read as low/high); `reminder` and `completion` are `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS`; `today` is `true` in any letter case; `id` matches `[A-Za-z0-9_-]{1,32}` (Obsidian Tasks' `id` character set; Flint itself generates `[a-z0-9]{4,6}`).
- **Rationale:** Dataview's parser treats any `[…::…]` or `(…::…)` as a field, with no space required after `::`. Developers write `::` constantly (`[Vec::new]`, `(std::move)`, `Foo::Bar`); under "fields anywhere" Flint would hide that text and move it to the end of the line on the next write. Obsidian Tasks reads Dataview fields only at the end of the line, parses from the end, stops at the first field it doesn't recognise, and accepts date-only values; with the old order (`priority, reminder, today, completion, id`) it read only `id`.
- **Alternatives considered:** parse exactly like Dataview (rejected: eats developer titles); keep the old order and only fix the wording (rejected: the reorder was free while no files exist).

### D-22 — Non-task content in task lists stays in place and is shown read-only
- **Date:** Oct 2026 · **Status:** Decided (pre-M1 review, Q3; resolves Q-16, refines Q-14)
- **Decision:**
  - Non-task content in a task-list file (headings, paragraphs, plain bullets, HTML comments, anything else that isn't a task) stays exactly where it is. Moving a task (Alt+↑/↓, drag-and-drop, move to another list) moves only that task's block (its line, body and subtasks), placed next to the target task. Non-task blocks never move as a side effect.
  - The UI shows non-task content **read-only**: headings as quiet section labels, other text as muted markdown. It is not selectable in Navigate state. There is no UI for creating or collapsing sections.
  - LIST-04, note → task list: checklist items and plain bullets become tasks; everything else stays in place as non-task content. Nothing is dropped and no confirmation is needed.
  - "Top of Inbox" (CAP-02, Q-14) means just before the first task, not above a heading or paragraph the file starts with.
- **Rationale:** content Flint hides is as good as lost, because people won't know it's there; folding it into task bodies would rewrite lines the user didn't touch.
- **Alternatives considered:** hide it but preserve it; attach it to the preceding task's body (the former Q-16 default).

### D-23 — Files Flint didn't create; Inbox identity
- **Date:** Oct 2026 · **Status:** Decided (pre-M1 review, Q4). Inbox and duplicate-file rules Proposed.
- **Decision:**
  - Lists are the **top-level `*.md` files** in the Flint folder. Subfolders and dot-folders (`.obsidian/`, `.git/`, `.flint/`, `attachments/`) never contain lists.
  - A file without Flint frontmatter (or without `mode`) is shown as a **note**. Flint adds `flint`, `id` and `mode` only when it next saves that file because the user edited it in Flint. Other frontmatter keys (e.g. Obsidian `tags`, `aliases`) are preserved byte-for-byte.
  - If the chosen Flint folder is an Obsidian vault root (it contains `.obsidian/`), onboarding and settings suggest a `Flint` subfolder inside the vault instead. The user can still choose the vault root.
  - **Proposed:** Inbox is the list with the reserved `id: inbox`. It always displays as "Inbox", pinned at the top, and cannot be renamed or deleted in Flint. If no list has that id at startup, Flint adopts `Inbox.md` if it exists, otherwise creates it.
  - **Proposed:** duplicate list IDs (e.g. Explorer's "Unicorn - Copy.md", which also duplicates every task ID, or two files claiming `id: inbox`): the older file (by creation time, then path) keeps its IDs; the copy gets new IDs on its next save.
- **Rationale:** a file created by hand or by Claude must never silently fail to appear; a vault root would flood the sidebar.
- **Alternatives considered:** only files with Flint frontmatter are lists (rejected: silent failure).

### D-24 — Default Flint folder outside OneDrive
- **Date:** Oct 2026 · **Status:** Decided (pre-M1 review, Q5; resolves Q-15). Conflict-copy and unreadable-file handling Proposed.
- **Decision:**
  - The default Flint folder is **`%USERPROFILE%\Flint`**.
  - When the chosen folder is inside a OneDrive root (`%OneDrive%`, `%OneDriveCommercial%`, `%OneDriveConsumer%`), onboarding and settings warn plainly ("This folder is synced by OneDrive. Flint doesn't support sync yet; using it on two PCs can create conflict copies.") and allow continuing.
  - An **"Open Flint folder"** command.
  - **Proposed:** a file that looks like a OneDrive conflict copy (same list id as another file, name ending in `-<MACHINENAME>`) shows a short notice saying so instead of appearing as a normal extra list. The D-23 duplicate rule still applies.
  - **Proposed:** a list file that can't be read because it is cloud-only (Files On-Demand) or locked shows that plainly on the list instead of an empty list.
- **Rationale:** OneDrive Known Folder Move redirects Documents into OneDrive, and Microsoft recommends it for organisations. On managed work machines `Documents` resolves to `OneDrive - Contoso\Documents`, so the old default (`Documents\Flint`) would sync silently, contradicting D-03 and inviting conflict copies, cloud-only files and upload locks.
- **Alternatives considered:** keep `Documents\Flint` with only the warning (rejected: the zero-decision default would land in the unsupported setup).

### D-25 — `##` list shorthand; unknown lists are created with a card before Enter
- **Date:** Oct 2026 · **Status:** Decided (pre-M1 review, Q6–Q7). Token details Proposed.
- **Decision:**
  - The list token is **`##name`**. A single `#` is never a token and always stays text (`#123`, `#bug`, `#hotfix`, `C#`).
  - `##name` matches an existing task list ignoring case, spaces, hyphens and underscores (`##meeting-notes` finds "Meeting notes"). Autocomplete inserts the hyphenated form.
  - A shorthand token is stripped only if it resolves to something valid; anything else stays in the title as text. With several valid tokens of one kind, the **last** wins and only it is stripped; the others stay as text and the chip says so (e.g. "2 lists → Unicorn"). This applies to `##` and `!`, and (**Proposed**) `@`.
  - **Close match:** an existing task list whose name starts with the token (2+ characters), or is within edit distance 2 (1 for names of 4 characters or fewer). When several lists match the prefix, the most recently used one is offered; sidebar order only breaks exact ties.
  - Before Enter, the popup shows a small card. With a close match: `Unicorn · Enter · New list "unis" · Tab`. Enter saves into the close match; Tab switches the choice to creating the new list (the card then reads `New list "unis" · Enter`). Without a close match: `New list "<name>" · Enter`. Enter is the only key that saves.
  - An unmatched `##name` creates a new task list, named exactly as typed, on save. Confirmation: `Created list <name> · Undo` (where it appears: D-26). Undo moves the task to Inbox and deletes the new list if it is still empty.
  - `##name` pointing at a **note** stays as text; the task goes to Inbox; the chip says `<name> is a note → Inbox`.
  - **Proposed:** token characters are Unicode letters and digits plus `-` `_` `.` (Georgian list names work); trailing punctuation is not part of the token (`##infra,`); a name Windows can't use as a file name (`##con`, illegal characters) stays as text, the task goes to Inbox and the chip explains why; "most recently used" means the last capture or move target, kept in `ui-state.json`.
- **Rationale:** `#123`, `#bug` and `#hotfix` are everyday developer text, and stripping an unknown `#token` deleted it. Under time pressure Enter must do the most likely intended thing: `##unis` + Enter must not create a list called "unis" (the prefix trap). A deliberate new list that looks like an existing one is rare and worth one extra key.
- **Alternatives considered:** `#name` with unknown tokens kept as text (superseded); "Tab = existing list, Enter = create" (rejected: muscle-memory Enter on a near-match creates a junk list).

### D-26 — No after-save overlay; follow-up messages appear where the user looks next
- **Date:** Oct 2026 · **Status:** Decided (pre-M1 review, Q8)
- **Decision:**
  - A normal capture has **no after-save overlay**: the popup hiding is the confirmation. No system notification.
  - A message that must follow a popup capture (e.g. `Created list "unis" · Undo` from D-25, or a failed save from D-27): if the main window or mini mode is visible, it appears there as a normal in-app toast; otherwise it waits as one quiet line at the top of the popup the **next time it opens**, until dismissed or until the next capture is saved. Global Ctrl+Z in the main window covers it too.
- **Rationale:** the popup must hide at once and hand focus back to the call. Windows 11 turns on Do Not Disturb automatically while an app is full screen (default setting), so a system notification would often be suppressed exactly then. The card before Enter already announced the outcome.
- **Alternatives considered:** a Windows notification with an Undo button using the R-3 protocol machinery (rejected: suppressed during full-screen calls, and an interruption for a rare event).

### D-27 — Capture save: split budget, the main process owns the pending capture
- **Date:** Oct 2026 · **Status:** Decided (pre-M1 review, Q9)
- **Decision:**
  - On Enter, the popup hands the capture to the main process and waits only for the IPC acknowledgement, then hides. From then on the main process owns the pending capture until the write is confirmed, so a popup/renderer crash can't lose it.
  - Budgets (05 §4): **Enter → popup hidden and focus returned < 50 ms**; **Enter → capture durably on disk < 100 ms at p95**, measured and recorded in 06.
  - The draft (CAP-08) is cleared only after the write is confirmed. If the write fails, the next-open notice (D-26) says `Couldn't save your last capture · Retry`, with the text restored.
  - **Accepted risk:** if the main process itself crashes after the acknowledgement and before the write, the fallback is the last persisted draft, which can lag the final keystrokes by one draft-save debounce (~300 ms). Closing this gap would put a disk write back in front of the hide.
- **Rationale:** a durable write (flush and rename, with retries when antivirus, the indexer or OneDrive hold a lock) can exceed 100 ms on an average laptop. The popup must never hang over a call, and "never lose a thought" is kept by the draft.
- **Alternatives considered:** hide only after the write completes (rejected: a slow or locked disk keeps the popup on top of the call).

### D-28 — Pre-M1 review gap-fills (Proposed defaults)
- **Date:** Oct 2026 · **Status:** Decided (confirmed after M1 by D-29; was Proposed)
- **Decision:** the gaps found while reviewing the docs before M1 are filled as follows:
  - **IDs:** missing IDs are written on the next save of the file (as before); until then the task has a provisional in-memory ID that stays stable across re-parses. ID uniqueness covers lists, notes, the archive and Trash (04 §3).
  - **Hand-edited files:** a task checked outside Flint (`[x]` without `completion`) gets `completion` on the next save of that file; indentation is read as tabs, 2 or 4 spaces and written as 4 spaces unless the file already uses tabs; unchanged field values keep their raw text (`highest` is not rewritten as `high`); per-line endings, BOM and the final newline are preserved; a file that isn't valid UTF-8 opens read-only (04 §3, §6).
  - **Subtasks:** completed subtasks stay under their parent; Tab on a task that has subtasks does nothing; an outdented subtask moves to just after its parent's group (TASK-04).
  - **Saving:** before writing, Flint re-reads the file; if it changed on disk, Flint re-applies its pending operations by task ID, so a CLI or Claude write is never overwritten (04 §6).
  - **Tooling:** a small custom natural-language time parser instead of a library such as chrono-node, because it runs in the tiny capture popup; npm workspaces for the monorepo (05 §1–2).
  - **Docs hygiene:** no emoji in UI examples (CAP-04); no theme switching in v1 (NAV-01, 01 Principle 10, 03 §6).
  - **Filled while writing the spec, not yet reviewed (04 §3–4):** checkbox states (`[x]`/`[X]` completed; other status characters such as `[-]` are non-task content; `completion` on an open task is ignored and kept), list markers (`-`/`*`/`+` tasks; numbered items are non-task content), Completed-section recognition (first level-2 "Completed" heading; state comes from the checkbox, not the position), task fields are inert while a list is a note, a date-only `reminder` means 09:00, and `completedAfter` in `meta.json` for un-checking (TASK-06).

### D-29 — M1 review: gap-fills confirmed; capture card, body checklists, bulk moves
- **Date:** Oct 2026 · **Status:** Decided (after M1)
- **Decision:**
  - The D-28 gap-fills and the behaviours added as Proposed during M1 are confirmed: shorthand read on the first line only and `@` taking the longest time expression (CAP-03), close-match ranking (CAP-05), un-checking a subtask reopens its completed parent (TASK-04), a moved task lands at the top of the target list (TASK-11), the REM-02 grammar and weekday rules, repeated Flint fields, read-only files with an unknown `mode`, checkbox states, list markers, Completed-section recognition, inert fields in notes, and the format details in 04 §3–6. Each now points at D-29 where it is specified.
  - **Bulk move** (TASK-07, TASK-11): tasks moved to another list together land at its top in their original relative order.
  - **Close-match card** (D-25): Tab switches the card to "New list"; Enter is the only key that saves. The card visibly flips so the selected option is always obvious (09 §8).
  - **Checklists in a body**: a `- [ ]` line in a top-level task's body is a subtask (04 §3). In the editor (M4), typing `- [ ]` in a body visibly turns that line into a subtask.
  - **`next fri`** means the same as `fri`; the chip shows the exact date.
- **Rationale:** Enter must never do anything but save under time pressure, and a Tab pressed out of autocomplete habit must not save half-typed text; the format's definition of a subtask is kept rather than special-cased in the editor, and made visible instead.

### D-30 — Dependency policy and the Node2Shell security update
- **Date:** 29 Oct 2026 · **Status:** Decided
- **Context:** CVE-2026-111497 "Node2Shell" (out-of-bounds write in Node.js's bundled Brotli decoder, remote code execution) and TLS/DNS fixes, in the Node.js security release of 20–21 Oct 2026: fixed in 22.23.4, 24.22.1 and 26.12.1. Electron embeds Node: 45.1.0 (27 Oct 2026) embeds 24.22.1; 45.0.0 embeds the vulnerable 24.22.0.
- **Decision:**
  - **Node for development and builds: >= 24.22.1 on the 24.x line** (`.node-version` / `.nvmrc` = 24.22.1, `"engines": { "node": ">=24.22.1 <25" }`, `engine-strict=true` in `.npmrc`; the Azure pipeline pins 24.22.1, a future GitHub Actions `setup-node` reads `.node-version`). Node 24, not 26, so tests run on the major Electron embeds.
  - **Electron 45.1.0** when it is added in M2, with a test that launches Electron and fails if `process.versions.node` is below 24.22.1, so a vulnerable embedded Node never ships.
  - **Versions:** the latest stable version the rest of the toolchain supports, pinned exactly (`save-exact=true`, exact versions in `package.json`, the lockfile pins the whole tree). Exceptions are recorded here: **TypeScript 6.0.3**, not 7.x, because typescript-eslint supports TypeScript < 6.1 only.
  - **Supply-chain cooldown:** no version published less than 7 days ago (`min-release-age=7` in `.npmrc`, npm >= 11.10; the project uses npm 11.19.1). npm applies it only when resolving versions, not to an existing lockfile, so CI also runs `scripts/check-release-age.mjs` over every package in `package-lock.json`. Exception: a security fix from the project's official maintainers, installed with `--min-release-age=0` and listed in the script's allowlist. Recorded exceptions: **Electron 45.1.0** (security fix above).
  - **`npm audit --audit-level=high` in CI**; high or critical findings fail the build.
  - **Security releases** of Node or Electron are adopted promptly and recorded in this log.
- **Applied (29 Oct 2026):** Node 24.22.1 locally and in CI; lockfile regenerated under the cooldown (158 packages, all >= 7 days old); typescript-eslint 8.72.1 (published 26 Oct) → 8.72.0 (19 Oct); all other M1 dependencies were already the newest eligible versions.
- **Applied in M2 (29 Oct 2026):** Electron 45.1.0 added with `--min-release-age=0` (embeds Node 24.22.1, verified by `npm run check:electron-node`, which also runs in CI). That one-off override also pulled in Electron's dependency `@electron-internal/extract-zip@1.0.8` (published that day); it is pinned to 1.0.6 (22 Oct, same dependencies and engines) in `package-lock.json` and `overrides`, because npm 11.19 did not apply the override on its own. The override must cover only the security fix, never its dependencies. npm 11.19 also gates install scripts: koffi 3.3.3's script (it selects koffi's prebuilt native binary) is approved in `allowScripts`, pinned to that exact version; electron-winstaller's script (Squirrel installers, which Flint doesn't use: NSIS, docs/05 §6) is denied; Electron 45 has no install script and downloads its binary through its `install-electron` command.

### D-31 — Zero network requests, enforced by a test
- **Date:** 29 Oct 2026 · **Status:** Decided
- **Decision:** v1 makes **zero** network requests (APP-09), and an end-to-end test enforces it on every CI run (`apps/desktop/e2e/smoke.spec.ts`): every request the app attempts is recorded and refused (Chromium sessions, and Node-level connections and DNS lookups in the main process), Chromium's network stack goes through a recording proxy, and Flint's TCP connections are polled. Each layer was checked with a deliberate request. If a network feature is ever added (e.g. auto-update, APP-06), it adds **exactly its own endpoint** to the test's allowlist, with a decision-log entry; the checks are never loosened.
- **Rationale:** "Your notes never leave your machine" (APP-09) is a promise; a test that fails on the first stray request keeps it true as dependencies change.

### D-32 — Uninstall removes the app, never the user's data
- **Date:** 29 Oct 2026 · **Status:** Decided (Davit; the cleanup details and keeping the logs and Windows' notification settings accepted the same day)
- **Decision:** Uninstalling Flint removes it cleanly but leaves the user's data untouched: the Flint folder (`%USERPROFILE%\Flint` by default) and `%APPDATA%\Flint` (settings, app state) are never deleted (Davit). Details: the logs in `%LOCALAPPDATA%\Flint\logs` stay too, and the uninstaller also removes what Flint registers itself at runtime, which electron-builder's uninstaller does not know about: the `flint://` handler (only when it points at the installation being removed), the start-with-Windows entry (and its Startup Apps state), and the installer copy kept for a future updater (`%LOCALAPPDATA%\flint-updater`). None of this runs when a newer version is installed over the old one. Behaviour is in docs/05 §6; code in `apps/desktop/resources/installer.nsh`.
- **Rationale:** notes are the user's files, not the app's; a reinstall should pick up where the user left off. Leftover registrations would point Windows at a deleted `Flint.exe` (a toast button or a login that silently does nothing).
- **Verified (29 Oct 2026):** before the fix, `flint://` and the start-with-Windows entry dangled after uninstall; after it, nothing points at the removed app, the Flint folder and `%APPDATA%\Flint` are unchanged (file hashes compared), and an install over an existing install keeps both registrations. The same check found that each end-to-end run pointed `flint://` at the development checkout and wrote the development Start Menu shortcut, which on a machine with Flint installed would send its toast buttons to the checkout; test runs now skip both, and the smoke test fails if either changes.


### D-33 — App identity: `com.davitkhachaturovi.flint`, and development builds never touch the installed app
- **Date:** 29 Oct 2026 · **Status:** Decided (Davit); ID changed the same day from `app.flint.desktop` to `com.davitkhachaturovi.flint`, before anyone else installed Flint
- **Decision:** The installed app's AppUserModelID and electron-builder `appId` is **`com.davitkhachaturovi.flint`** (was `com.example.flint`, then briefly `app.flint.desktop`), set before anyone else installs Flint and **never changed afterwards**: the installer's upgrade detection, the start-with-Windows entry and Windows' notification settings are keyed by it. Development builds use **`com.davitkhachaturovi.flint.dev`** and their own toast scheme **`flint-dev://`**; the R-1 laptop benchmark uses `com.davitkhachaturovi.flint.bench` and registers no scheme. Each build also has its own app-data folder (`Flint`, `Flint (development)`, `Flint R-1 benchmark`), and with it its own single-instance lock. Defined once in `apps/desktop/src/main/identity.ts`; a unit test keeps it equal to `electron-builder.yml` and to the uninstaller's cleanup. The development-only test hooks (`FLINT_BENCH`, `FLINT_TEST_TOAST`, the `flint-dev://dev/toast` route) are ignored by installed builds.
- **Rationale:** with a shared `flint://`, every development run pointed an installed Flint's toast buttons at the checkout. The ID can only change for free before the first real install.
- **Note:** the `app.flint.desktop` builds only ever ran on Davit's machine; their notification-settings entries were removed with the switch.

### D-34 — Electron fuses, and the UI served from `app://flint`
- **Date:** 29 Oct 2026 · **Status:** Decided (Davit chose the in-app scheme)
- **Decision:** The packaged `Flint.exe` has its Electron fuses set (electron-builder `electronFuses`): `runAsNode` off, `enableNodeOptionsEnvironmentVariable` off, `enableNodeCliInspectArguments` off, `onlyLoadAppFromAsar` on, `enableEmbeddedAsarIntegrityValidation` on, `enableCookieEncryption` on, `grantFileProtocolExtraPrivileges` off. With the last one off, `file://` pages can't run the built module scripts, so the renderers load from an in-app scheme **`app://flint/…`**: registered as standard and secure inside Flint only (not with Windows), served by the main process from the built renderer folder and nothing else (path-confinement unit tests), read directly from disk, so the network guard no longer allows `file:` at all. The development server is unchanged; the end-to-end test runs the built renderers through `app://flint`. `npm run dist` reads the fuses back from the packaged exe and fails if they differ (`apps/desktop/scripts/check-fuses.mjs`, `@electron/fuses` 1.8.0, already installed with electron-builder and now a pinned devDependency).
- **Rationale:** an unsigned, per-user `Flint.exe` that honours `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` or `--inspect` is a ready-made way to run arbitrary code under Flint's name; Electron and electron-builder recommend these settings, and a custom scheme over `file://`.
- **Verified (29 Oct 2026, installed build):** both windows load through `app://flint` (first start after install about 20 s, most likely Windows Defender scanning the new unsigned exe; next start 0.6 s); `ELECTRON_RUN_AS_NODE=1 Flint.exe -e "…"` ran no code and arrived at the running Flint as an ordinary second launch; the fuse check fails on stock Electron (all seven differ) and passes on the packaged exe; toasts report supported and uninstall removes the start-with-Windows entry under the app ID (re-verified under `com.davitkhachaturovi.flint`, D-33).
- **Consequences:** Playwright can't attach to the packaged exe (inspector flags are off), so end-to-end tests keep running the unpackaged build. Each window now logs when it has loaded, or why it failed to.

### D-35 — Reminders show through Do Not Disturb; task text can be hidden
- **Date:** 29 Oct 2026 · **Status:** Decided (Davit)
- **Decision:** Reminder toasts use Windows' reminder scenario (`scenario="reminder"`, REM-06): they stay until acted on and, with Windows' default priority settings, still appear during Do Not Disturb (verified, docs/06 §1). New setting **"Hide task text in notifications"** (REM-10), default off: the toast then says only "Flint reminder". Proposed details: the buttons stay, and the setting is `hideNotificationText` in `settings.json` until the settings screen (M8).
- **Rationale:** a reminder that Do Not Disturb swallows during the call it was set for is a silent miss (REM-07); but a toast that appears during screen sharing must not show the task to everyone watching.

### D-36 — R-1 accepted on the existing measurement
- **Date:** 29 Oct 2026 · **Status:** Decided (Davit)
- **Decision:** R-1 (popup latency) is accepted on the measurements already taken: hotkey → focused popup p50 28.2 ms, p95 40.3 ms over a full-screen stand-in, and 17.3 / 32.1 ms by hand, on Davit's standard work laptop (docs/06 §1). There is no separate run on another laptop during a Teams call; R-1 is re-measured only if capture feels slow in daily use. The laptop benchmark (`npm run dist:bench`) stays in the repo for that case and is compiled out of normal builds and the installer (`__FLINT_BENCH_BUILD__`).
- **Rationale:** about 28 ms leaves enough headroom under the 50 ms budget; measuring again on purpose would cost time better spent on v1 features.

### D-37 — M3 starts with saving captures; capture-selection hotkey Ctrl+Shift+X
- **Date:** 29 Oct 2026 · **Status:** Decided (Davit)
- **Decision:** M3 starts by saving captures to Inbox (D-27), with drafts and the follow-up notice line, because an unsaved capture is what keeps Flint from daily use; R-2 (capture-selection) follows the shorthand and paste work in the same milestone instead of opening it. Q-03 resolved: capture **Ctrl+Shift+Space**, capture-selection **Ctrl+Shift+X**. Both are rebindable with conflict detection (APP-08); Ctrl+Shift+X takes the combination from VS Code (Extensions view) and Teams (expand compose box), rarely used by keyboard.
- **Proposed details (docs/03 §3):** in the popup, Ctrl+Z with an empty box undoes `Created list <name>`; Retry of a failed save is Enter, since the text is back in the box.

### D-38 — Capture popup: a single-line title and a selection area
- **Date:** 29 Oct 2026 · **Status:** Decided (Davit, after the R-2 run: pasted JSON landed as raw fences in the input, took the first JSON line as the title and broke the shorthand)
- **Decision:** The popup has a **title line**, always one line and focused, the only place shorthand is read; its placeholder showed a fallback title (the first meaningful line of the first block) used when the title was empty; **superseded by D-45** (no fallback title, the selection itself is the task). Below it, the **selection area** holds multi-line content, code, JSON and stack traces as compact blocks (`JSON · 8 lines`, first four lines, expandable) and plain text and notes as editable blocks. The priority / list / reminder buttons always act on the title. Davit's answers: **Shift+Enter** adds a note block (multi-line, Enter saves from it); highlighting is **built in for JSON and stack traces** only (keeps the popup tiny, CAP-10), other code plain monospace; a **single-line selection** also goes to the selection area, becoming the title without repetition when the title stays empty. One plain line pasted into the title is typed there. Implementation: `composeCapture` in `@flint/core/shorthand` turns title and blocks into the saved text.

### D-39 — Ctrl+Shift+X starts fresh or collects; Shift+Esc discards
- **Date:** 29 Oct 2026 · **Status:** Decided (Davit)
- **Decision:** Ctrl+Shift+X on a **closed** popup starts fresh with the new selection; an earlier draft is set aside and shown as "Previous draft · Restore" (Restore swaps the two, × forgets it), so a draft is never lost. On an **open** popup the selection is appended to the selection area. Esc closes and keeps the draft; **Shift+Esc** discards the draft (and its images) and closes. Both drafts survive restarts (`drafts.json`).

### D-40 — Enter first accepts the `##` menu or the list card
- **Date:** 29 Oct 2026 · **Status:** Decided (Davit); replaces "Enter is the only key that saves" from D-25 / D-29
- **Decision:** While the `##` suggestion menu or the close-match / new-list card is visible, the first Enter only accepts the highlighted option (a list's own spelling replaces the token; a new list is confirmed) without saving; the next Enter saves. Tab still flips between the existing list and "New list". The save button saves straight away, and an unresolved `##` token then follows the close-match rules of D-25 and Q-07.

### D-41 — A popup with content stays open on click-away
- **Date:** 29 Oct 2026 · **Status:** Decided (Davit)
- **Decision:** Clicking elsewhere closes an empty popup, as before; a popup with content stays visible without stealing focus, so the user can copy from other apps or add more with Ctrl+Shift+X. It closes on Enter, Esc, Shift+Esc or the capture hotkey; Davit's answer: the capture hotkey brings the cursor back to a popup that stayed open, and closes it when pressed while the popup has the focus (draft kept). Focus return after Enter and Esc is unchanged.

### D-42 — Popup visuals: the hint on the card, no visible window edge
- **Date:** 29 Oct 2026 · **Status:** Decided (Davit asked for both fixes; the approach is Proposed)
- **Decision:** The key hint moves into the card's bottom toolbar (`Enter saves · Esc keeps draft · Shift+Esc discards`, giving way first when crowded). The light-grey rectangle was the card's float shadow cut off by the window edge (16–20 px margin against a shadow reaching ~96 px); the window now keeps a fully transparent margin that holds the whole shadow (72 px sides, 36 px top, 108 px bottom) and lets clicks through it (`setIgnoreMouseEvents` with forwarding; the renderer turns clicks on over the card). This keeps the design's 22 px corners and soft shadow, which a native window frame (8 px corners) would not, and leaves the pre-warmed show path unchanged.
- **Verified (29 Oct 2026):** screenshots of the composited screen on a white background, a dark background and over text show no edge and a readable hint; the popup's hotkey-callback → focused frame stayed at 12–35 ms after the first show.

### D-43 — R-2 (capture-selection) accepted
- **Date:** 29 Oct 2026 · **Status:** Decided (Davit's run)
- **Decision:** R-2 passes: the selection is captured from a browser / Notepad, a Teams chat and a normal terminal; an admin terminal gives "Couldn't read selection from an admin window; paste with Ctrl+V"; the clipboard afterwards still holds what the user had copied; Ctrl+Shift+X doesn't conflict in VS Code. The JSON finding from the same run led to D-38. Implementation notes: the copy waits for the hotkey's keys to be released, Ctrl+C is detected by the clipboard sequence number, the elevated case by the foreground process's token, and the clipboard is restored with Electron 45's async API (every item and type it can read).

### D-44 — Rebinding the global hotkeys before the Settings screen
- **Date:** 29 Oct 2026 · **Status:** Proposed (obvious answer to a gap: APP-08 is M3, the Settings screen M8)
- **Decision:** APP-08 gets a small **Hotkeys** window from the tray (it moves into Settings in M8). Click a hotkey and press the new keys; Flint tries to register the combination at once: if another app owns it the old hotkey stays and the window says so, otherwise it is saved in `settings.json`. Rules: Ctrl, Alt or Win required; the two hotkeys differ; Alt allowed with a push-to-talk note (Q-03). While recording, the current hotkeys are off, yet a taken combination is still detected. A hotkey taken at startup shows as a warning item at the top of the tray menu, so a dead capture hotkey never fails silently.
- **Limit:** Windows only reports combinations other apps register globally; an app's own shortcuts (VS Code's, Teams') can't be detected.

### D-45 — The selection itself is the task; no generated titles
- **Date:** 29 Oct 2026 · **Status:** Decided (Davit); replaces the fallback title of D-38
- **Decision:** What the user types is the task line and the selection its body. With nothing typed: one line or plain text fills the task line (first line; the rest is body); code, JSON and stack traces leave the task line **empty** and are the body, fenced and verbatim; an image alone also leaves it empty. The title line's placeholder is always "Capture a task…". Flint never writes a generated title; places that need a short label (reminder toasts, Today reminder cards, search results) make one when shown (`taskLabel` in `@flint/core/shorthand`: `JSON · died_at`, `Stack trace · …`, `Screenshot`). Lists show an untitled task as a collapsed code row (kind, line count, one-line peek), expandable (M4). docs/04 §3: an empty task line with a body is valid; round-trip tests added.
- **Correction (Davit, 30 Oct 2026): shorthand only from typed text.** Text that came from a selection or a paste is placed in the task line as plain text: its `!`, `##` and `@` never become chips or set anything (a selected `deploy hotfix @15:00, see ##infra` sets no reminder and no list), also after editing inside it. Text typed outside it, and tokens Flint inserts (toolbar buttons, the `##` menu), are live. Implementation: the popup tracks those stretches as inert ranges (`shiftRanges`, kept in the draft) and escapes their markers before parsing (`escapeInert`, the CAP-03 backslash escape), so the saved title shows them as written. Tests in `packages/core/src/shorthand/inert.test.ts` and the e2e smoke test.

### D-46 — A close button on the card; Esc never global
- **Date:** 29 Oct 2026 · **Status:** Decided (Davit)
- **Decision:** A small × in the card's top right closes the popup like Esc (the draft is kept). Esc and Shift+Esc are handled at window level, so they work anywhere in the popup, also after clicking the card's background. Esc is **not** a global hotkey: that would break Esc in other apps (e.g. a full-screen Teams call) while the popup stays visible (D-41). From another window, closing is Ctrl+Shift+Space (cursor back to the popup), then Esc.

### D-47 — The popup can be dragged by its card
- **Date:** 29 Oct 2026 · **Status:** Decided (Davit)
- **Decision:** Dragging the card's background (not text fields, buttons, chips or code) moves the popup. The position is not remembered: every open starts centered on the active monitor (CAP-09). Implementation: the main process moves the window with the cursor until the left button is up, rather than CSS drag regions, which swallow mouse events on Windows and would break the click-through margin (D-42).

### D-48 — M4 order: a daily-use build first
- **Date:** 30 Oct 2026 · **Status:** Decided (Davit)
- **Decision:** M4 starts with what makes Flint usable every day: the main window (sidebar, list views, rows with priority stripes, untitled tasks as collapsed code rows, non-task content read-only), completion with an undo toast and the Completed section, then the Navigate/Edit model and keymap (add, edit, priority, reorder, subtasks). As soon as that works, Davit gets an installable build; the rest of M4 (bodies, drag, multi-select, move, delete, temporary sort, multi-line paste, smart link titles, auto-archive offer) lands as updates installed over it.

### D-49 — Task bodies in M4: rendered, with plain editing
- **Date:** 30 Oct 2026 · **Status:** Decided (Davit)
- **Decision:** TASK-05's editor is the note editor (CodeMirror live preview, M5). Until then a body is shown rendered (markdown, highlighted code blocks, images) and edited in a plain monospace field; M5 replaces the field with the note editor for notes and bodies alike. The rendering is kept.

### D-50 — Delete to trash/ from M4; the Trash screen in M7
- **Date:** 30 Oct 2026 · **Status:** Decided (Davit)
- **Decision:** Deleting a task (TASK-12) from M4 moves it to the Flint folder's `trash/` with its deletion time and shows an Undo toast, so nothing is destroyed. Browsing, restoring and the 30-day expiry come with the Trash screen (DATA-02, M7).

### D-51 — Main-window editing details (M4 step 2)
- **Date:** 30 Oct 2026 · **Status:** Proposed (gap-fills, Claude; Q-08 implemented as its proposed default)
- **Decision:**
  - **Composer** (mockup 01): adds to the top of the list it sits in, with the capture shorthand. `##list` sends the task to the top of that list with `Added to <list> · Undo`; an unknown name creates the list (Undo removes it again if still empty). There is no `##` menu or close-match card in the composer yet: a close match goes to the existing list, and the chips show where the task will go before Enter. The paperclip tool comes with attachments in the main window (M5).
  - **Edit state:** Enter saves and opens a new row below; the row stays one text field while Enter adds task after task, and its task IDs are fetched ahead, so typing straight on after Enter never loses keys or reorders tasks. Esc and leaving the field also save (typing is never discarded); Enter or Esc on an empty new row closes it. Emptying the title of a task without a body changes nothing (D-45 allows an empty title only with a body).
  - **Shorthand while editing:** the existing title is inert, like selected text (D-45); typed `!` and `@` tokens apply. A typed `##list` stays text while editing until moving between lists arrives later in M4.
  - **Tab / Shift+Tab** while editing a task move it at once (TASK-04); on a new row they set the level the next task is added at.
  - **Navigate:** completing a task moves the selection to the next open task; double-click edits a task; Esc clears the selection.
  - **Undo / redo** in the main window covers its own changes this session, newest first; redo (Ctrl+Shift+Z, Ctrl+Y) as proposed in 03 §2. Global undo across captures and structural changes stays M7 (DATA-03).
- **Why:** these fill gaps docs/03 §2 leaves open, in line with "never lose typed content" (01) and D-45; none changes the file format.

### D-52 — Daily-use fixes (feedback of 31 Oct 2026)
- **Date:** 31 Oct 2026 · **Status:** Decided (Davit; visual details Proposed)
- **Decision:** From the first days of daily use, fixed early in the rest of M4:
  - Row hover never stacks a second rounded background against the selected row (UI-03).
  - The arrow cursor on all controls, the hand only on real links (UI-01).
  - Task titles render their inline markdown; raw syntax only while editing (LIST-02).
  - A thin scrollbar from the tokens, at the window edge (UI-02).
  - Lists are created from a **+** next to "Lists" and with **Ctrl+Shift+N** (free in Flint's keymap), choosing task list or note (LIST-01; notes before M5: Q-20).
  - The Settings entry is hidden until Settings exists (APP-11, M8).
  - The app icon gets proper small sizes in a multi-size `.ico`; the in-app logo and wordmark get slightly bigger (UI-07).
- **Why:** each was a visible rough edge in daily use. Root cause of the small taskbar icon: only a 256 px image was shipped, which Windows scales down (Microsoft asks for at least 16/24/32/48/256 px).
- **Correction (31 Oct 2026, when UI-07 was built):** electron-builder did put seven sizes into the exe, downscaled from that image. The icon looked small because its near-black tile disappears against the dark taskbar, leaving only the leaf (about 60 % of the slot), and the downscaled sizes lost the tile's rim. Fix: sizes up to 96 px drawn from the hand-tuned small logos (visible rim, leaf enlarged about 15 %), 256 px from the master (09 §8).

### D-53 — Task bodies: inline when small, a page when large; back/forward
- **Date:** 31 Oct 2026 · **Status:** Decided (Davit); keys Proposed
- **Decision:** A body up to roughly 8 rendered lines expands inline under its row; a larger one opens as a full page, which is its only view. "Open as page" works for every task. In v1 the page replaces the list view with a back arrow (no tabs). Back / forward via the mouse's side buttons and Alt+← / Alt+→, no visible buttons (NAV-04). Proposed: Shift+Enter opens a task as a page.
- **Why:** a stack trace or long note in the list would push everything else away; the page keeps the list calm (03 §1, progressive disclosure). Builds on D-49 (rendered bodies, plain editing until M5).

### D-54 — Locked, springy drag for rows and sidebar lists
- **Date:** 31 Oct 2026 · **Status:** Decided (Davit)
- **Decision:** Mouse drag to reorder (TASK-01) is locked to the vertical axis and to the list's bounds (no free floating); other rows slide out of the way with a spring; an expanded task collapses while dragged and re-expands after if it was expanded. Lists in the sidebar reorder the same way (order kept in `ui-state.json`, Proposed). Dragging onto a sidebar list to move a task conflicts with the lock: Q-18.

### D-55 — Right-click menus everywhere
- **Date:** 31 Oct 2026 · **Status:** Decided (Davit); item sets Proposed
- **Decision:** Tasks, lists, notes and the sidebar have right-click menus with relevant actions, in M4; note-specific items (NOTE-02) in M5. Every text field keeps Cut / Copy / Paste / Select all, which Electron doesn't provide by default. Deleting lists from the menu sends them to Trash storage like tasks (D-50). How menus are drawn: Q-19.

### D-56 — Minimal motion for selection and new rows
- **Date:** 31 Oct 2026 · **Status:** Decided (Davit)
- **Decision:** The selection highlight and new rows animate with the motion already specified (03 §5, 09 §9): no gimmicks, nothing slower than ~150 ms, off with reduce-motion (UI-04).

### D-57 — Pickers in the composer and popup; auto-closing brackets
- **Date:** 31 Oct 2026 · **Status:** Decided (Davit); visuals and some keys Proposed
- **Decision:** The flag, # and bell buttons of the composer and the capture popup open a priority picker, a list picker (recent lists plus search) and a proper date/time picker, all the same size and style, keyboard-accessible, inserting the same chips as the shorthand (CAP-11; replaces the Proposed token-inserting buttons of 03 §3). Typing `(`, `[`, `{`, `"`, `'` or `` ` `` inserts the pair, and typing the closer before an auto-inserted one steps over it; quotes don't pair right after a letter (UI-09), in the composer, popup and task editing in M4, in the note editor in M5. When the date/time picker comes: Q-21.

### D-58 — Overdue reminders: noticeable, not alarming
- **Date:** 31 Oct 2026 · **Status:** Decided (Davit); exact visual Proposed
- **Decision:** An open task with a reminder in the past shows "Overdue · <time>" in brighter text with a small dot; no red (brand: no warm colours), no badges. In Today, overdue items sit at the top of Reminders. Completing or snoozing clears it (REM-11). Row display in M4, Today grouping in M6.

### D-59 — Multi-select action bar
- **Date:** 31 Oct 2026 · **Status:** Decided (Davit); Ctrl+A Proposed
- **Decision:** With 2+ tasks selected, a floating action bar shows the count, Select all, Move, Priority, Star and Delete. No separate edit mode and no extra checkboxes on rows (they would clash with the completion checkbox). Lists and notes in the sidebar: Ctrl/Shift-click multi-select plus Delete in the right-click menu (TASK-07, LIST-01). Star appears once Today exists (M6).

### D-60 — Fonts: Onest, FiraGO for Georgian, Geist Mono
- **Date:** 31 Oct 2026 · **Status:** Decided (Davit); mono fallback Proposed
- **Decision:** Onest replaces Geist for UI and text. FiraGO is added for Georgian and applied only to Georgian characters via `unicode-range`, so Latin stays Onest. Geist Mono stays for times, counts and code. All bundled locally (OFL), never fetched. tokens.css, 09 §7 and the type spec are updated, and the docs/design mockups and screenshots re-rendered with the new fonts, when UI-05 is built in M4. **Supersedes the font part of D-17.**
- **Facts checked (31 Oct 2026):** Onest is OFL 1.1 (`github.com/simpals/onest`, Latin and Cyrillic, variable weight). FiraGO 1.001 (bBox Type) is OFL 1.1 with the Reserved Font Name "Fira" and has static weights only, so Flint bundles the official files unmodified. Neither covers what the other does: Onest has no Georgian.
- **Correction (31 Oct 2026, when UI-05 was built):** the `OFL.txt` in FiraGO's official repository declares no Reserved Font Name; the "Fira" RFN appears in third-party copies of the notice. Shipping the official files unmodified (D-64) is right either way. Onest's licence declares none either. Bundled: Onest 2.001 (variable WOFF2 from its release) and FiraGO 1.001 WOFF2 Regular/Medium/SemiBold/Bold; Geist (UI) is removed, Geist Mono stays.

### D-61 — Guidance: one spotlight for walkthrough, tips and What's new
- **Date:** 31 Oct 2026 · **Status:** Decided (Davit), except where marked Proposed
- **Decision:** One shared spotlight component (soft dim, ring around the target, Next / Skip / Skip all) serves (a) a first-run walkthrough of Flint-specific features, about 5–6 steps, skippable and replayable (APP-10); (b) contextual tips for repeated inefficient patterns, non-blocking, in a corner of the main window, never in the popup, never taking focus, never mid-typing, each shown once, at most one per session, with "Don't show tips", detection local only (APP-14); (c) What's new once after an update, also from the tray, with short release notes for every version bump (APP-15; versioning: Q-22). v1, M8. **Proposed (Davit's suggestion, to confirm):** the walkthrough replaces the teaching-Inbox sample tasks (old APP-10), so there is one onboarding system. The spotlight's dim is the one deliberate exception to "no translucency" (09 §1).

### D-62 — Tabs Later; priority visibility stays an open question
- **Date:** 31 Oct 2026 · **Status:** Decided (Davit)
- **Decision:** An Obsidian-style tabs bar is Later (NAV-05): it needs careful design to fit the visual language. Priority visibility beyond the stripe (text fading or bolding) is not done for now and is open as Q-17, to revisit after more daily use.

### D-63 — Grayscale syntax highlighting
- **Date:** 31 Oct 2026 · **Status:** Decided (Davit)
- **Decision:** Code tokens by lightness, weight and italics, plus the accent for strings: keywords white semibold; numbers white; literals white italic; keys and variables light gray; strings accent `#9AA0AB`; functions and `file:line` light gray with a faint underline; types and flags mid-gray italic; punctuation and comments dim gray (comments italic); stack traces with a bright exception line and dimmed frames. Tokens in tokens.css and 09 §11; reference mockup 07 (added by Davit). Used by the popup's JSON / stack-trace highlighter and rendered task bodies in M4, and the CodeMirror theme for all languages in M5 (UI-06, NOTE-04). Supersedes the highlighting colours of the selection area in 09 §8 (D-38).

### D-64 — Answers to Q-18 to Q-22; the walkthrough replaces the teaching Inbox
- **Date:** 31 Oct 2026 · **Status:** Decided (Davit)
- **Decision:**
  - **Q-21:** reminders fire as notifications from **M4 step 3, as its first item**, before the visual fixes: the actionable toast (Done / Snooze 10m / Open) while Flint runs; missed ones shown once at the next start. The date/time picker stays in step 5. "Reminders that silently don't fire are worse than none."
  - **Q-18:** no dragging tasks onto sidebar lists in v1 (TASK-11, Q-06, 03 Mouse updated).
  - **Q-19:** consistent in-page menus everywhere. The capture popup makes room for an open menu (e.g. by temporarily enlarging its transparent margin or window); the native dark menu only if that genuinely doesn't work, reported to Davit.
  - **Q-20:** + offers Task list and Note; notes get plain monospace editing until M5.
  - **Q-22:** versions 0.4.x during M4; every build gets a short entry in `docs/release-notes.md`.
  - **D-61 confirmed:** the first-run walkthrough replaces the teaching-Inbox sample tasks.
  - **FiraGO** ships as the official, unmodified files (Reserved Font Name "Fira"), loaded via `unicode-range` (D-60).

### D-65 — Feedback on 0.4.1; the step-4 choices accepted
- **Date:** 31 Oct 2026 · **Status:** Decided (Davit)
- **Decision:**
  - **Accepted (were Proposed in step 4):** the trash layout (docs/04, D-50), writing the target before removing the source when moving a task (TASK-11), Shift+F10 / the Menu key for a task's menu (03 §3).
  - **Bugs, fixed at the start of step 5:** the cursor still flickered around the main composer's text box (UI-01: the whole card becomes one text target); the undo toast was covered by task text and hovered rows (it always sits above the list); completing a task made it disappear without the specified animation (09 §9); the taskbar icon still looked small (UI-07: the mark fills nearly the whole square at 16–48 px, and the reminder toast shows a larger logo with `appLogoOverride`); stack traces must be highlighted in the popup as JSON is (UI-06: common trace formats recognised).
  - **Change, also at the start of step 5:** switching lists or pages fades the content in while it rises a few pixels (~120–150 ms) and the sidebar highlight glides to the new list (UI-04).
  - **Highlighting scope:** the popup stays JSON + stack traces; rendered task bodies get full-language highlighting with the M5 editor's language parsers (UI-06).
  - **Change, in step 5 with the reminder and picker work:** a clickable bell turns a reminder off without deleting it (REM-12, D-66).

### D-66 — Reminders can be turned off: the `muted` field
- **Date:** 31 Oct 2026 · **Status:** Decided (Davit asked for the feature and left the field name to Claude)
- **Decision:** A turned-off reminder is stored as `[muted:: true]` on the task, next to its `reminder` field, which stays as it was. Values: `true`, any letter case; absent means the reminder is on. It is one of Flint's own fields (recognised anywhere in the line with a valid value, D-21), and the canonical order becomes `reminder`, `muted`, `today`, `completion`, `priority`, `id`. Setting a new reminder time removes it (Proposed); a reminder whose time passes while muted is never shown later (Proposed). Round-trip tests in `packages/core`.
- **Why this name:** short and plain like the other keys (`today`, `priority`); it reads correctly next to the reminder in any markdown tool (`[reminder:: 2026-11-02T15:00] [muted:: true]`) and matches what the UI shows, a struck-through bell. A separate field keeps the `reminder` value a valid date for Dataview and Obsidian Tasks, which an encoding inside the date (`… off`) would break. Older Flint builds keep the field as an unknown one and would still fire the reminder; acceptable for an internal tool that updates together.
- **Considered:** `reminderOff` (camel case, unlike the other keys), `remind:: off` (a second reminder-like key next to `reminder` is confusing), `paused` (suggests it resumes by itself).

### D-67 — Motion: two duration bands, a fuller completion, an animation-speed setting
- **Date:** 1 Nov 2026 · **Status:** Decided (Davit); the duration bands are superseded by D-75
- **Decision:** The single ~150 ms ceiling (03 §5, 09 §9, D-17) becomes two bands: **up to ~150 ms** for motion that gates the next action (navigation, selection, menus and pickers opening) and **up to ~250–300 ms** for non-blocking visual state changes (strike, fade, completion feedback). Applied now: slightly slower list/page switching (150 ms, ease-out); a more visible completion (the check fills with a small pop, then the row fades, slides and collapses into Completed); an un-complete animation (the row returns smoothly). Settings (M8) gets an animation-speed setting that scales all motion, next to reduce-motion (APP-11). A motion pass over every button, menu, picker, popup and row action follows the same rule (UI-10, M8 at the latest).

### D-68 — Feedback on 0.4.2 and 0.4.4
- **Date:** 1 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in the docs
- **Decision (fixed at the start of M4 step 6):**
  - Menus: the hover highlight clears when the mouse leaves the menu; only keyboard navigation keeps an item highlighted (UI-08).
  - Every picker list scrolls with the thin scrollbar and a sensible maximum height, so all lists are reachable (CAP-11, UI-02).
  - Cursor rule: the I-beam only over text that is editable at that moment (text fields, a task being edited, the note editor); the arrow everywhere else, titles, times and hints included (UI-01; refines D-65's composer fix).
  - The note page (plain editing until M5, D-64) becomes a proper page: title, comfortable width, aligned with the list views, tokens only.
  - Clicking a task's reminder time opens the date/time picker for it (also for reminders that already fired); the bell stays the off/on toggle; "Change reminder…" in the task's menu (REM-01, pulled into M4).
  - Taskbar icon: the tile scales with the leaf, so the whole icon fills the square with the leaf inside the tile at every small size (UI-07).
    - **Built (1 Nov 2026):** the tile already fills the whole square, so it grows with the leaf through tighter corners (radius 4 px instead of 5 at 24, 3 instead of 3.5 at 16) while the leaf shrinks slightly (scale 0.076 and 0.05), until both tips sit inside the rim; still larger than in 0.4.1 (09 §8). **Superseded by D-69's rule.**
  - Install and update in one step, Flint opening at the end (APP-16); a manual start shows the main window, only the start-with-Windows launch stays in the tray (APP-01).
  - Reminder notification: "Reminder" and the task name, with Done / Snooze 10m / Open; no time, no list name and no large logo (the small app icon stays). Supersedes the toast-logo part of D-65 (REM-05).
  - Overdue: no "Overdue" word; the bell with a small dot and brighter time. The bell always stays in place: turning an overdue reminder off strikes the bell, fades the time and removes the dot; nothing else moves (REM-11, REM-12).
  - The strike animation is slower and smooth in both directions (it didn't animate back, a bug) (REM-12, D-67).
  - Capture popup: drag only by a small grip at the top of the card, never by its background, so static text never moves the window (supersedes D-47's handle; no pin); no "Nothing was selected" message (CAP-07); focus goes back to the window that was active right before the popup last got the focus, and a popup closed without the focus moves no focus at all (CAP-01, D-41); the date/time picker flow everywhere: pick a day, then a time-of-day view with common times and a custom time field, keyboard-friendly, with a way back to the calendar; typed input and presets stay (CAP-11).

### D-69 — Feedback on 0.4.5
- **Date:** 1 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in the docs
- **Confirmed working:** focus return from the popup, the completion animation, the bell animations, reminder editing, the notification text, the popup's grip, the manual start and the start after an update.
- **Decision (fixed in M4 step 6, before bodies and pages; bugs first):**
  - Bugs: the mouse's hover highlight still stayed in the pickers (Move to, priority, list, the reminder presets) after the mouse left; it clears like in the menus (UI-08, CAP-11). The I-beam still flickered anywhere over the composer's and the note's text boxes (UI-01). Hovering today in the calendar turned it gray with black text: it gets the normal hover and keeps its subtle marker. Empty sidebar space was a window drag region, so right-clicking it showed Windows' window menu (Restore, Move, Size…): only the title-bar strip drags, and right-clicking empty sidebar space opens the **+** menu (UI-08, LIST-01).
    - **Built (1 Nov 2026):** the I-beam flicker was not CSS: it is an Electron bug on Windows (issues #48035, #35414): while any window has `setIgnoreMouseEvents(true, { forward: true })`, even a hidden one, the cursor flickers over text fields in the app's other windows. The capture popup used it for its click-through margin (D-42) all the time. It now forwards only while it is visible, so the flicker can only appear while the popup is open. Picker rows follow real mouse moves only, so a picker opening under a resting pointer keeps the keyboard's row.
  - Undoing a completion (Ctrl+Z, the toast's Undo) plays the un-complete animation (TASK-06, D-67).
  - Overdue: the white dot stays on the bell, but the time is not highlighted: it keeps the bell's tone (REM-11; replaces D-68's brighter time).
  - A changed reminder time crossfades from the old text to the new instead of jumping (REM-01).
  - App icon, **one rule, no more alternating between shrinking the leaf and growing the tile:** the dark tile fills the entire icon square (full-bleed) with Windows' corner radius for app icons (Microsoft's icon grid: 2 px at 48 px, so size / 24) and a 1-pixel rim on its edge for the dark taskbar; the leaf sits proportionally inside, its tips and outline spanning 72 % of the tile's diagonal, at every size from 16 to 96 px. Supersedes the tile and leaf numbers of D-52, D-65 and D-68; the 256 px master is unchanged (UI-07).
  - Reminder presets: In 10 minutes, In 1 hour, Tomorrow 10:00 (CAP-11).
  - The default time for a day without a time (`tomorrow`, `fri`, `3d`, and date-only values in files) is **10:00** instead of 09:00, so typing and the presets agree. Resolves Q-02 with a new default (REM-02, 04 §3).
  - Text selection: Flint's own colour instead of Windows blue, a soft translucent gray based on the accent with white text, in text fields and selectable app text alike; tokens `--fl-selection` and `--fl-selection-text` (UI-11).

### D-70 — The time of day is picked with wheels
- **Date:** 1 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in CAP-11
- **Decision:** after a day is picked in the calendar, the time-of-day list and "Other time" field of D-68 are replaced by a **wheels picker** (mockup `design/mockups/08-time-picker-wheels.html`): two columns, hours 00–23 and minutes in 5-minute steps, snapping to a highlighted centre band; mouse wheel or drag per column, ↑/↓ and typed digits, Tab between the columns; a "Set · <day, time>" button; back to the calendar via the header and ←. It starts at the reminder's current time, or the next rounded time for a new one. The typed field above it stays for exact minutes (`14:37`, `3pm`). The same picker in the composer, the capture popup and "Change reminder…" (CAP-11, REM-01).

### D-71 — Clicking a task edits it directly
- **Date:** 1 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in 03 §2
- **Decision:** clicking a task's title text enters Edit with the caret where you clicked, and the row stays highlighted; clicking empty row space only selects; double-click anywhere edits; Esc returns to the selected state. The keyboard's Navigate/Edit behaviour stays as it is. Replaces click-to-select-then-click-to-edit (M4 step 2, D-51); updates 03 §2.

### D-72 — Duplicate, convert, the note menu, find in page, more temporary sorts
- **Date:** 1 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in 02
- **Decision:**
  - Right-click menus: tasks, lists and notes get **Duplicate** (TASK-16, LIST-01); lists and notes get **Convert to note** / **Convert to task list**. LIST-04 is v1 and its rules are decided (D-22, D-29), so conversion moves from M5 into M4 (step 7).
  - The note right-click menu (NOTE-02) gets Obsidian-style submenus, trimmed: Format (bold, italic, strikethrough, highlight `==text==` with a subtle gray background, code, clear formatting), Paragraph (bullet, numbered and task list, Heading 1–3, body, quote), Insert (link, image, table, code block, horizontal rule), then Cut / Copy / Paste / Paste as plain text / Select all. No H4–H6, math, comments, footnotes, callouts or internal links. M5.
  - **Ctrl+F** finds in the page with a custom find bar in Flint's style (NAV-06): in notes CodeMirror's search, restyled (M5); in task lists matches are highlighted and Enter / Shift+Enter jump between them, without filtering (M4 step 10, else M5).
  - The temporary sort in task lists (TASK-08) also sorts by **Reminder time** and **Date added**. Manual order stays the source of truth.

### D-73 — Sidebar groups and sorting
- **Date:** 1 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in 02 and 04
- **Decision:**
  - **Groups (LIST-05, v1, now):** one level of collapsible sections in the sidebar that hold task lists and notes. Not file-system folders: the list files stay flat in the Flint folder. Group membership and order live in a file under `.flint/` (`sidebar.json`; user data, travels with the folder); which groups are collapsed is machine UI state. **+** and the sidebar's right-click menu offer "New group"; groups can be renamed and deleted (deleting a group keeps its lists, which move out of it). No nesting. Lists move into and out of groups by drag and the right-click menu. docs/01's non-goals now say one-level sidebar groups are allowed and nested folders still aren't.
  - **Sorting (LIST-06):** a small sort menu with Manual (default, custom order), Recently edited and Created, applied within each group and the ungrouped area. In Manual, lists, notes and groups reorder with Alt+↑/↓ and the same locked-axis drag as tasks (D-54). While another sort is active, reordering is disabled with a short hint to switch to Manual.
  - The manual sidebar order moves from `ui-state.json` (D-54, never built) to `.flint/sidebar.json`.
- **Milestones:** groups, the sort menu and Alt+↑/↓ in M4 step 8; dragging into, out of and within groups with the rest of drag in M4 step 9.

### D-74 — Feedback on 0.4.6; answers to the Proposed group and duplicate details
- **Date:** 1 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in the docs
- **Confirmed working:** no cursor flicker (the leftover while the popup is open without focus is fine for now), today in the calendar, the sidebar's + menu on right-click, undo animations, the overdue tone and the time crossfade, the presets, the wheels (mouse wheel and drag), the selection colour, click-to-edit.
- **Decision (fixed first in the rest of M4 step 6):**
  - Picker highlight (Move to, priority, list, reminder presets): **the highlight follows the last input used.** The mouse leaving the rows leaves no highlight, as in the right-click menus; an arrow key or typing brings it back, starting from the row the mouse was last on; Enter acts on the keyboard's row (CAP-11, UI-08; replaces D-69's return to the keyboard's row).
  - Click to edit: a click on another task's text goes straight into editing on that row, without the selection gliding there first; the editing row looks like a dark input field like the composer (well background, subtle edge), clearly different from a selected row (TASK-02, 03 §2, D-71).
  - App icon: the tile keeps the **corner proportions of the master logo** (`flint-icon-512.svg`) at every size, full-bleed with its rim; size / 24 had made it nearly square at taskbar sizes. The leaf at taskbar and tray sizes is about 10 % smaller (from 72 % to 65 % of the diagonal). The in-app logos stay as they are (UI-07; replaces D-69's corner radius and leaf size).
  - Wheels: touchpad scrolling adds up small pixel deltas (honouring `deltaMode`) and moves one stop per threshold; a mouse notch stays one stop (CAP-11, D-70).
- **Answers to the Proposed details of D-72 and D-73:**
  - Sidebar order: groups and ungrouped lists share **one manual order**, so a group can sit between lists (like Microsoft To Do); Inbox stays pinned at the top. Under a non-manual sort, groups keep their manual positions and lists are sorted within each group and among the ungrouped ones (LIST-05, LIST-06; replaces "groups first").
  - `.flint/sidebar.json` keyed by list ID with the file name as fallback: accepted.
  - Recently edited / Created from the files' times, newest first: accepted.
  - A duplicated list is "<name> copy": accepted.
  - A duplicated task copies the title, body and priority, **not the reminder**, so it doesn't fire twice (TASK-16).

### D-75 — Motion never delays input
- **Date:** 1 Nov 2026 · **Status:** Decided (Davit) · supersedes the duration limits of D-67 (and of D-17, D-56, D-65)
- **Decision:** the guiding rule is **"motion never delays input"**. Every action takes effect immediately, animations are interruptible and retarget smoothly on new input (springs), and nothing waits for an animation to finish. With that, fuller default durations: selection movement ~200 ms, menus and pickers opening ~200 ms, list and page switching ~280 ms (the old fade was barely noticeable), the completion sequence ~400 ms in all. **Exception:** the capture popup still appears instantly and takes typing from the first frame; it may fade in but never delays input. The animation-speed setting (M8, D-67) scales everything; reduce-motion still turns it off. If the defaults feel too slow in daily use, Davit asks to dial them back. Updates 03 §5 and 09 §9.
- **Consequence for completion:** the task is completed (saved, undoable) the moment Space is pressed; the row's animation plays on from where it was, instead of the save waiting for the animation as in 0.4.3 to 0.4.6.

### D-76 — Feedback on 0.4.8
- **Date:** 1 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in the docs
- **Confirmed working:** the selection animation, the icon, the picker highlight following the last input. Step-6 details accepted: completed tasks show their bodies, a reminder's Open is a back/forward step, the empty-body placeholder.
- **Decision (fixed before step 7):**
  - **Enter acts only on a visible highlight.** Pickers and menus open with nothing highlighted; the first arrow key or typed character reveals the highlight; typing in a search field highlights the top match (CAP-11, UI-08; refines D-74).
  - Pressing a picker's button while its picker is open closes it.
  - Menu and picker motion: pickers open with a short scale and fade from their button, right-click menus fade in subtly, and switching from one picker to another morphs the panel (size and content crossfade) (UI-10).
  - A second single click on an already-selected row enters editing, like renaming in Explorer; a double-click still edits from any state (03 §2).
  - The editing field eases in when editing starts and moves smoothly from one editing row to the next.
  - Motion tuning (D-75): completion about 360 ms, list and page switching about 320 ms; new animations for a new task appearing and for un-completing (leaving Completed with one animation, entering the open tasks with another).
  - The scrollbar's space is reserved, so switching from a task list to a note never shifts the text (UI-02).
  - Wheels: free, pixel-precise scrolling per column that snaps to the nearest value when the movement settles (inertia-aware), a mouse notch one value; a clicked value (or a typed digit) becomes editable, `4_` then `47`, any minute 00–59, Tab or Enter commits (CAP-11, D-70; replaces D-74's touchpad thresholds).
  - "Add subtask" in a task's right-click menu (TASK-04).
  - Bodies and pages (TASK-05; D-49's editor stays in M5): single line breaks stay line breaks, as in Obsidian, in bodies, pages and notes; markdown must render (it didn't in Davit's bodies, a bug); JSON, code and stack traces pasted into a body are fenced and highlighted (CAP-06's rule). A long body (more than about 8 rendered lines) never renders fully inline: inline shows its top lines with "Open as page", in a subtle well aligned with the title (supersedes D-53's "a larger body opens as a full page"). The page title is white, weight 600, about 26–28 px; the back button lines up with the title's first line; editing the title keeps it wrapped in the same type, Enter saves and the file keeps one line. The page lists the subtasks with "Add subtask". The plain body field takes the rendered text's place, padding and height, without an extra blank line (supersedes D-49's monospace field); image paste and live markdown come with M5. Expanding and collapsing an inline body, opening and closing a page, and entering and leaving editing are animated.

### D-77 — Feedback on 0.4.9 and 0.4.10
- **Date:** 1 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in the docs
- **Confirmed working:** no highlight on open, the second click to edit, the new and reopened task motion, touchpad and typing in the wheels, Add subtask, multi-select with Shift/Ctrl-click, the action bar, Duplicate.
- **Answers to the Proposed details of step 7:** Duplicate only for open tasks, a new list created once for a bulk move, and the bar at the bottom centre: accepted. **Ctrl+A selects the visible open tasks only** (Ctrl+A then Delete must not wipe Completed). **No action bar for sidebar marks**: the right-click menu covers lists and notes. **Nothing is selected when a list opens**: the first ↓ selects the first row, so a single click never unexpectedly starts editing (03 §2).
- **Decision (fixed before step 8):**
  - Bugs: switching between the priority, list and reminder pickers (also from a reminder's picker) lost the second picker or opened it far from its button; open, close and switch must be smooth and reliable, the close animation was missing and the open one barely visible. The editing field's motion is fuller, still subtle. The scrollbar flashed when switching from a list to a note: it shows only when the content overflows and never during transitions. In the wheels, a click on another value after typing one goes straight there. Opening any other list, Inbox included, clears the marks. Adjacent marked rows form one continuous rounded highlight. The undo toast animates out. Collapsing Completed animates and keeps the scroll position anchored. Delete and Duplicate, and their undos, animate consistently with completion.
  - Bodies and pages (TASK-05; the editor stays in M5, D-49): an expanded task is **one raised card** with its title row and body, as in mockup 01 (supersedes D-76's well): the body in the secondary tone, code and stack traces in their own small code card with a label and a copy button. Long bodies are not editable inline: the preview is clickable with a soft hover and opens the page; "Open as page" stays. The page title's edit field gets the body field's inner spacing.
  - Conversion: note → task list turns **every non-empty plain text line into a task**; headings stay as section labels; fenced code and quotes attach to the preceding task as its body (supersedes D-22 for plain lines, LIST-04). Task list → note keeps the fields (lossless).
  - **M5:** task fields in notes show as small muted chips (priority, reminder), `id` hidden, raw text only while the cursor is on the line (LIST-04, NOTE-01). Images in bodies show as thumbnails; a click opens a lightbox with smooth motion and ←/→ through the same task's images (MEDIA-01).

### D-78 — Feedback on 0.4.11; cloud sync recorded for later
- **Date:** 1 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in the docs
- **Confirmed working:** picker switching and morphing, marks cleared on list switch, the editing field's motion, the toast and Completed animations, the scrollbar, the wheels.
- **Decision (fixed before step 8):**
  - Menus and pickers, right-click menus included, stay anchored to their button or task while the page scrolls and close only when the anchor scrolls out of view.
  - A marked task with a body keeps the spacing used around subtasks; its merged highlight no longer overlaps the task above.
  - The expanded task follows `design/mockups/09-expanded-task.html` (with its screenshot): always a raised card while expanded (selected-like surface, edge ring, top highlight, soft shadow), the priority stripe over its full height, the body in the secondary tone and code cards inside it.
  - While editing task A, a click on task B's blank space saves A and selects B.
  - Collapsing an expanded task while another task is selected no longer plays the selection's move over the body's card.
  - Shift+Enter adds notes: in the main composer as in the capture popup, and while editing a title it opens and focuses that task's body; "Add notes" in the task menu; the composer's hint says "Shift+Enter for notes" (TASK-05).
  - The task menu's priority entries become one "Priority ›" submenu (UI-08).
- **Step 8 now includes drag to reorder** for the sidebar and task lists (was step 9).
- **Later (post-v1), recorded: cloud sync (SYNC-01).** Through the providers' own APIs, Google Drive first, then OneDrive (Microsoft Graph); no iCloud. Opt-in sign-in with the provider's auth (OAuth with PKCE and a loopback redirect); tokens kept with Electron `safeStorage`; Google access limited to files Flint creates (`drive.file`). Automatic or manual sync by preference. Merged per task by ID, with tombstones for deletions, never conflict copies. When turned on, it changes the "no network" promise (APP-09) for that feature only.

### D-79 — Feedback on 0.4.12; the M5 editor before step 9
- **Date:** 1 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in the docs
- **Regression:** list and page switching had lost its motion. Cause: D-78's "follow layout shifts at once" cancelled the sidebar highlight's glide when the sidebar re-measured during it. Fixed, and an e2e test now fails if a page's arrival or a highlight's glide stops running to its end (03 §5).
- **Decision (fixed before step 8 continues):**
  - Submenus: the safe-triangle (menu-aim) rule with a ~300 ms grace delay, so a diagonal move toward a submenu never closes it.
  - Menus and pickers animate when they close, also when their anchor scrolls out of view.
  - An expanded or marked task with a body has the same vertical rhythm as the rows around it; the card's outline adds no space.
  - Expanded bodies: a much subtler hover on a long body's preview; code cards labelled with the detected language; "Format as code" fences a body's unfenced code or JSON on purpose (old text is never re-detected on render).
  - The composer's notes field is never clipped; pasting into the composer follows CAP-06 (code fenced into its notes, images saved to `attachments/`).
  - Paste detection keeps markdown as markdown (a fenced block, an image link); only raw unfenced code, JSON and stack traces are fenced (CAP-06).
  - Row indicators: body icon for text, image icon for images, both when both. Thumbnails in expanded bodies, full size on the page. **The image lightbox moves from M5 into M4** (a smooth popup, ←/→ through the task's images).
  - Indent and Outdent in the task's right-click menu.
- **Answers:** Alt+↑/↓ follows the keyboard focus: the task list moves the selected task, the sidebar moves its selected list or group, nothing selected moves nothing; no fallback to the open list. New groups at the end and unique names up to 60 characters: accepted.
- **New:** two-finger horizontal touchpad swipe = back/forward, with a subtle arrow during the swipe, ignored over horizontally scrollable areas (NAV-04, step 9).
- **Plan change:** after step 8 comes the M5 editor (CodeMirror live preview for notes, task bodies and task pages, inline images, raw markdown only on the cursor's line), **before** step 9. A handoff note in docs/06 follows step 8, so a new session can continue from the docs alone.

### D-80 — Feedback on 0.4.13 and 0.4.14; the step-8 choices accepted
- **Date:** 2 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in the docs
- **Accepted (were Proposed):** the image lightbox on the window's solid ground, without a dimmed overlay (09 §8). Alt+↑/↓ by keyboard focus: a click on a list or group header puts the keyboard in the sidebar, selecting a task takes it back (LIST-06). The drag rules: tasks move only among tasks at their own level (Tab / Shift+Tab nest), a list joins a group when dropped nearer its last list, and under a non-manual sort neither drag nor Move to group happens (TASK-01, LIST-05), **provided the drop target is clearly visible** (below). The open questions in 06 §4 keep their proposed defaults.
- **Format tests:** the hidden-subtasks bug (0.4.14) went unnoticed since M1 because the format tests only checked round-trips. `packages/core` now also has tests that check the **parsed structure** (tasks, subtasks, bodies, non-task content) of hand-written files and of generated ones (04 §3).
- **Decision (fixed in 0.4.15, before the M5 editor):**
  - **Composer paste (CAP-06, TASK-05):** a pasted image shows as a **thumbnail chip** under the composer, and pasted code, JSON or a stack trace as a **code card preview** (language label, code background, the first 4 lines with an expand chevron, × to remove), as in the capture popup's selection area; never as raw `(attachments/…png)` text or raw fences. The card is a preview, not editable (as in the popup); typed notes stay in the notes field. On Enter they become the body: notes, then the code fenced, then the image links. Full-language highlighting comes with the M5 editor; JSON and stack traces already highlight.
  - **Row indicators (TASK-05, supersedes D-79's "body icon for text"):** the body icon shows whenever the task has **any** body content, images only included; the image icon additionally shows when there are images. The body icon expands the task, showing its text and image thumbnails; a thumbnail or the image icon opens the lightbox.
  - **Deleting parts of a body (TASK-05, MEDIA-01):** code cards and images in a body get a small **trash button** in their corner, in the task list and on the task page. The part folds away and an undo toast shows; no confirmation (reversible). Deleting an image removes only its link; the file stays in `attachments/` until the orphaned-attachment cleanup (MEDIA-04, M7). Removing a thumbnail chip in the composer works the same way.
  - **Deleting an expanded task (TASK-12):** it first collapses, then plays the delete animation.
  - **Groups look (LIST-05, `design/mockups/10-sidebar-groups.html`, replaces 09 §8's section-label header):** a group is a **soft card** with a folder tile and its name in normal case, its lists inside, indented on a faint guide line. Collapsed, it is a single card row whose count says "3 lists". Grouped and ungrouped lists must be easy to tell apart.
  - **New groups go at the top of Lists** with the name field ready (supersedes D-79's "new groups at the end"); also with "Move to group › New group".
  - **Group motion (UI-10):** creating, renaming and deleting a group; expanding and collapsing; Move to group and Remove from group; changing the sort (every row animates to its new place).
  - **Dragging into a group (LIST-05, D-54):** over a group, the group lights up (accent ring and "Drop to add"), an indented drop line shows where the list lands, the other rows slide apart and the dragged row lifts. Dropping on a collapsed group's header adds the list to it (at its end); the header pulses once.
  - **The sidebar's scrollbar** reserves its space (a stable gutter), as the main view does (UI-02): its appearing never shifts the sidebar.
  - **Drag and selection (TASK-01):** dragging a task never hides the sidebar's highlight (e.g. on Inbox), and every dragged task keeps its selection highlight while it moves (before, only tasks with a body kept it).
  - **Drag folding (TASK-01, D-54):** an expanded task folds its body with an animation when lifted and re-expands with one after the drop; a task with subtasks folds them away while dragged and restores them after.
- **M8 (APP-11, NAV-02, APP-08):** Settings gets a **Keyboard shortcuts** section listing every non-obvious shortcut (Tab / Shift+Tab, Shift+Enter for notes, Alt+↑/↓, Ctrl+Shift+Space, Ctrl+Shift+X, the mini-mode shortcut, back/forward, Ctrl+K, Ctrl+F…). The global hotkeys are rebound there (the Hotkeys window of D-44 moves into Settings). The `?` cheat sheet shows the same list, from one source.
- **Answers (grill, 2 Nov 2026):** image deletion removes the link only; the composer's code card is a preview like the popup's; 0.4.15 ships these fixes before the editor, which follows as 0.4.16+.
- **Next:** the M5 editor (D-79), then M4 step 9.

### D-81 — Feedback on 0.4.15: the group look reverted, wide screens and app zoom
- **Date:** 2 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in the docs
- **Confirmed:** everything in 0.4.15 except the points below; the "my call" details of D-80 are accepted (a list dropped on a folded group goes to its end; body images at least 64 px; the group card grows and shrinks with its sliding lists while a list is dragged; a folded header holds still under a dragged list; a title is needed to add from the composer).
- **Groups (LIST-05; supersedes D-80's visual redesign and mockup 10 on these points):** the group look and the sidebar drag visuals go back to how they were before D-80 (0.4.14), then only these stay from D-80:
  - an **expanded** group has its highlighted card background by default; a **folded** group is the plain label row again (no card);
  - while a list is dragged over a group, the group's card shows a **white outline ring** (a folded group shows the card and the ring only then); no "Drop to add" text, the count stays;
  - D-80's animations that still apply (create, rename, delete, fold/open, Move to / Remove from group, sorting, rows sliding), and all functional changes (new groups at the top with the name field ready, a drop on a folded group adds to its end and the group pulses, the card growing with sliding lists, the reserved scrollbar space, Alt+↑/↓ by focus).
  - **Reverted:** no folder tile in the header; the name back in the all-caps label style; the count just the number ("4", not "4 lists"); the previous drag feel and visuals: no lift scale, no shrinking over a folded header, no drop line, the card's edges without the spring's overshoot (it read as wobbly). The guide line and the name field's hint go too.
- **Wide screens (NAV-03, UI-12):** on a 1920 × 1080 monitor at 100 % the fixed ~820 px column left a lot of empty space.
  - The task-list column grows with the window up to **1160 px** (Proposed), with side padding that grows from 24 to 56 px.
  - Notes and task pages keep a comfortable reading width (**820 px**, centred); prose never runs edge to edge.
  - **App zoom (UI-12):** Ctrl+= (and Ctrl++), Ctrl+− and Ctrl+0 zoom the main window in Chrome's steps (67–200 %), **remembered per display**; the level shows briefly when it changes. The capture popup stays at 100 %: zoom is shared per origin in Chromium, so the main window gets its own (`app://main`). M8's Settings plan gets an **Interface size** option.
  - Checked at 1440 × 900 and 1920 × 1080 effective sizes, maximised and half-screen.
- **Answers (grill, 2 Nov 2026):** ring only, no "Drop to add"; a folded group is the plain label; zoom for the main window only, Chrome's steps.
- **Build:** 0.4.16 carries these and the M5 editor's first step.

### D-82 — Feedback on 0.4.16; the next M5 editor step
- **Date:** 2 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in the docs
- **Confirmed:** the groups (D-81). The editor is tested once M5's editor work is complete.
- **Wide screens (UI-12, supersedes D-81's growing column):** at 1160 px task rows just get long. The task column goes back to exactly its pre-0.4.16 width and margins (max 820 px, 40 px sides), the same column as notes and task pages. The app zoom per display stays. **Planned by Davit, not specified yet:** a right-side panel will use the empty space on wide screens; nothing is built for it until it is designed.
- **Next M5 editor step:** the right-click formatting menu (NOTE-02, the item set of D-72), slash commands (NOTE-03) and the copy button on code blocks inside the editor (NOTE-05).
- **Answers (grill, 2 Nov 2026):** Insert ▸ Image (and `/image`) opens the Windows file picker; the chosen picture is copied into `attachments/` and linked, like a pasted screenshot (MEDIA-02). `/` opens the command menu at the start of a line or after a space (never inside code), typing filters it, Enter or Tab applies, Esc closes and leaves the `/` as typed.

### D-83 — The editor's Proposed details accepted; the context panel for wide screens
- **Date:** 2 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in the docs
- **Accepted (were Proposed in D-82):** Ctrl+B / Ctrl+I, Ctrl+Shift+V for Paste as plain text, format items wrapping and unwrapping, paragraph items replacing the line's prefix, 3-column tables. The rest of the M5 editor work goes on; one build when it is complete.
- **New: the context panel (NAV-07, `design/mockups/11-context-panel.html`, three states).** Built after the M5 editor work and before M4 step 9.
  - **Layout:** one context-aware panel to the right of the main column. The 820 px column stays; column and panel are centred together as a pair with a 28 px gap. The panel is 440 px wide, on the task list's card surface; its height fits its content (no empty space), grows with it and scrolls inside only when it would be taller than the window. It appears by itself when the window is wide enough for both (about 1400 px effective width, to be tuned); **Ctrl+\\** hides and shows it, remembered per monitor. Narrower windows are unchanged.
  - **Task selected:** the selected task's details, following the selection (a click or the arrow keys). Header: a label, "Open as page", hide. Then the checkbox and the title (editable), chips for priority, list and reminder (each opens its picker), **Notes** in the M5 editor (code cards, image thumbnails; on wide screens notes are edited here instead of by expanding the row inline), **Subtasks** with progress ("1 of 2"), toggling and "Add subtask", and a footer with the created and edited dates. On wide screens the row's own body/"open as page" control goes (the panel has it); on narrow windows inline expanding and the page view stay as they are.
  - **Nothing selected: "Up next".** Overdue reminders first (the bell with the white dot), then Today's and Tomorrow's reminders by time, then "Starred for today" (once starring exists, M6; until then reminders only). A footer hint: select a task to see its details, Ctrl+\\ hides the panel. Clicking an item selects (or opens) that task.
  - **Note open:** the note keeps its 820 px reading column; the panel shows the **outline** and "In this note" (checklist progress, last edited). The outline lists the headings (indented by level, the current section marked, a click jumps there) and the blocks under each: code blocks, JSON, stack traces and images, each with a small icon tile and a type tag on the right (`bash`, `json`, `image`…); a click scrolls to the block. A block's title, in this order: (1) an explicit title after the language in the fence's info string (```` ```bash Check gateway health ````), kept in the file and ignored by other editors; (2) the code's first comment line (`# …`, `// …`, `-- …`, `/* … */`); (3) for JSON its top-level keys (`{ region, retries, window }`), for a stack trace the exception's name; (4) the type ("Python block", "Code block"). An image's title is its alt text, else its file name.
  - **Motion:** the panel slides and fades in when it appears, its height eases when its content changes, and its content crossfades when the selection or state changes (03 §5, 09 §9; motion never delays input, D-75).
  - **Tuned when built (0.4.18, Proposed):** the panel appears when the main area is at least 1336 px wide (the 820 px column, the 28 px gap, the 440 px panel and 24 px either side), about 1580 px of window with the 236 px sidebar. "About 1400 px" can't hold both beside the sidebar without narrowing the column. A 1536 px wide window (1920 px at 125 %) shows the panel at 90 % interface size. Task dates (created, last touched) are kept in `.flint/meta.json` (04 §3) from now on; tasks seen before have their first sighting as their created date.
  - **Answer (grill, 2 Nov 2026), a task open as a page:** the panel shows the outline of the page's body (its headings and blocks, with the same titles as for a note) and **In this task** (subtask progress, reminder, created and edited). A body without headings or blocks shows **Up next** instead. Selecting a subtask on the page doesn't change the panel.

### D-84 — The rest of the M5 editor: monospace, link patterns, videos and large files
- **Date:** 2 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in the docs
- **Scope of the step:** highlighting for all common languages (in the editor and in rendered bodies, UI-06), find in notes (NAV-06), the monospace toggle (NOTE-06), link patterns (NOTE-07), videos (MEDIA-01), dragging files in, large files (MEDIA-03), `==highlight==` in titles and bodies (LIST-02). Then one build.
- **Monospace (NOTE-06):** a checked "Monospace" item in the note's right-click menu (and Ctrl+Shift+M), remembered per note on this machine (UI state); the file never changes. The global default comes with Settings (M8).
- **Link patterns (NOTE-07, TASK-10):** per user, in `settings.json` (`linkPatterns`). The engine comes now; its editor in M8's Settings, a **Link patterns** section: paste an example link and type the short form wanted (`https://dev.azure.com/org/project/_workitems/edit/1234` + `AB#1234`); Flint infers the pattern from what varies (the part present in both), shows a live preview, asks for a second example when it is ambiguous, and an **Advanced** toggle shows the generated pattern. Each pattern works both ways: a typed short form becomes a link chip, a pasted full URL displays as its short form (this feeds smart link titles, TASK-10). Presets for GitHub issues and pull requests, Azure DevOps work items and pull requests, and Jira. No company-specific URLs as built-in defaults. Only http(s) links.
- **Videos (MEDIA-01):** MP4, WebM and MOV, added by paste or drag, play inline with a player and a first-frame thumbnail. A video that can't play inline (e.g. HEVC from a phone) shows a placeholder with **Open in default player**, never a broken player.
- **Large files (MEDIA-03, replaces the warning):** no hard size limit.
  - Up to **25 MB**, files are copied into `attachments/` as now.
  - Above 25 MB, a file is added **as a link to its original location** at once (nothing copied). A notice says **"Large file, linked to its original location"** with **Copy into Flint instead**; it stays until acted on or dismissed (no fading) and never blocks input. Hovering the button (or the small info icon beside it) explains: large files are linked by default because copying them makes the Flint folder, snapshots, exports and future sync slow and big; copying keeps the file safe if the original is moved or deleted.
  - A linked attachment shows a small **Linked** badge, and its right-click menu has **Copy into Flint**, so it can be switched later.
  - A linked file plays inline when it can, otherwise a click opens it in its default app. When the original is moved or deleted it shows a clear **File not found** state with the original path, never a broken player.
  - Linked files are not included in snapshots, export or (later) sync. Snapshots store each attachment once (an unchanged large attachment is never zipped again).
  - **Never launches programs or scripts** (`.exe`, `.bat`, `.cmd`, `.ps1`, `.msi`, `.com`, `.scr`, `.vbs`, `.js`, `.lnk`, …) from a link: only media and documents open; anything else asks first.

### D-85 — The context panel after 0.4.18; pins replace starring; a task converts to a note
- **Date:** 2 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in the docs
- **Responsive pair (NAV-07, replaces D-83's single cutoff):** the full pair (820 px column, 28 px gap, 440 px panel) when the main area fits it; below that a **compact pair** (780 px column, 24 px gap, 380 px panel), so a 1920 px laptop at 125 % (1536 px) shows the panel at 100 % interface size; below the compact size, no panel. Exact thresholds tuned when built (Proposed).
- **Panel fixes:**
  1. **Back:** a task reached from Up next (or any link in the panel) shows a back arrow in the panel header that returns to the previous state (list and selection). Alt+← and the mouse's back button do the same.
  2. **Hiding leaves a way back:** a small panel-toggle button stays at the top right of the main area, near the window controls, whenever the window can fit the panel. "Show panel" / "Hide panel" joins the right-click menus where it fits (the page's blank area, the panel itself) and later the Ctrl+K list.
  3. **Position:** in task lists the panel's top lines up with the top of the "Add a task" composer and stays sticky while scrolling, never rising above that starting position. In notes it lines up with the top of the note card.
  4. **"In this note"** shows Created as well as Edited ("Created 2 Nov · edited 11 min ago").
  5. The Up next footer is "Select a task to see its details here" (no Ctrl+\ hint).
  6. **Clicking blank space** in the main area (not on a row) clears the selection, so the panel shows Up next.
  7. **Scroll-spy:** the current section is the last heading above a line near the top of the view; once the note is scrolled to its end the last heading is current. The outline keeps the current entry in view; a click smooth-scrolls to its heading or block.
  8. **Motion** (D-83's appear, height and crossfade, plus the marker moving) must actually play; it joins the motion regression test.
- **Note workspace (NOTE-01):** a note's title and body sit on a card (the task list's card surface), so it is clear where to type. The panel stays outside it.
- **Up next order:** **Pinned**, then Today's and Tomorrow's reminders by time, then **Overdue** as a quieter section at the bottom (grill answer: pins lead).
- **Pins replace "star to Today" (TODAY-01, TODAY-02):** one concept instead of two. A task is pinned from any list (right-click **Pin** / **Unpin**, the **P** key; S no longer stars), and shows a small pin on its row. Pinned tasks show in the panel (their own Pinned section of Up next) whichever list is open, and in M6 they are the Today view. Everything else planned for Today stays: references not copies, its own order, the rollover prompt (TODAY-02, on by default, can be turned off in Settings), now "Roll over unfinished pinned tasks?": keep them pinned for tomorrow, or unpin them.
  - **File format (grill answer):** written `[pinned:: true]`. `[today:: true]` is read as a pin too and becomes `[pinned:: true]` the next time Flint writes that task's line; lines Flint doesn't change keep their text.
  - **Done pins (grill answer):** a completed pinned task stays in Pinned (faded) for the rest of the day; at the day change its pin is removed, whether or not the rollover prompt is on, so Pinned never fills with old done tasks.
- **Extra panel sections, kept unobtrusive:** **Recently captured** in Up next; **References** (the link chips in a task or note: work items, PRs, URLs, clickable) and **Attachments** (file names, linked large files marked, missing ones flagged) for a task and a note. Each is collapsed by default as one quiet header line with a count ("References · 3"); a click opens it; open or closed is remembered per section (machine UI state); hidden when empty; always below the core content (details, notes, subtasks; or reminders and pins), never pushing it down.
  - **Recently captured (grill answer):** the last 5 popup captures (not the composer), open or done (done ones faded), from any list, newest first, each with its list name. Which tasks came from the popup is recorded in `.flint/meta.json` (`captured`), so the section starts empty after the update.
- **Task → note (TASK-17):** "Convert to note" in a task's right-click menu creates a note in the sidebar from the task (the title becomes the note's title, the body its content, subtasks a checklist), removes the task from its list, and is undone in one step.
- **Group fold lag (LIST-05):** look for an obvious cause of the occasional one-second lag when a group expands or collapses; don't spend long if none turns up.
- **Built (0.4.19), what was found and tuned (Proposed):**
  - **Thresholds:** the full pair when the main area is at least 1336 px (820 + 28 + 440 + 48), the compact pair from 1232 px (780 + 24 + 380 + 48); a 1536 px window has about 1290 px.
  - **Motion:** the events fired in 0.4.18, but the "crossfade" only faded the new content in while the old vanished at once, the marker had no motion, and the appearing slide was 8 px; it read as no animation. Now the old content fades out over the new, the marker slides, the panel slides in from 16 px, and the motion test checks the panel's appearance and crossfade.
  - **Scroll-spy:** 0.4.18 measured headings with the editor's screen coordinates, which don't exist for headings the editor hasn't drawn yet (it draws only what is near the view), so the marker fell back to the top heading; it now uses the editor's height map, and the end of the note makes the last heading current.
  - **Group fold lag:** every refresh of the window (the echo after a fold is saved, the once-a-minute refresh) measured the sidebar's rows for its motion; landing during a fold, it measured rows mid-animation and played the move a second time. A refresh now measures only when the lists or the sidebar actually changed.
  - The extra sections' open or closed state is kept in the main window's local storage (machine UI state).

### D-86 — The context panel after 0.4.19; right-click in a selection; the clipboard section later
- **Date:** 3 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in the docs
- **Confirmed (0.4.19):** the panel's back arrow, the Up next footer text, a click on blank space clearing the selection, outline tracking, the note card, the Up next order, the group fold fix.
- **Panel (NAV-07):**
  1. **Show and hide animate clearly and smoothly**, both ways: the panel slides and fades in, and out again when hidden (it stays on screen until it has gone); the column glides to its new place at the same time. **Proposed:** about 320 ms, the page curve; changing the window's size switches at once.
  2. **Standard sticky:** the panel starts level with the composer (or the note card), scrolls up with the page and sticks once it reaches a small margin below the title bar (**Proposed:** 16 px). No gap opens above it, and it never sits above its starting position.
  3. **Up next rows:** the title first, every title starting at the same left edge; on the right, as on task rows in the list, the icon (pin, bell, overdue bell with the white dot) next to the time or date, then the list name. The shades stay.
  4. **Clickable facts** in "In this note" and, on a task's page, "In this task" (grill answer): open checklist items, code blocks, images and links, each with its count. A click jumps to the first, clicking again to the next (wrapping). **Proposed:** the target scrolls into view and flashes briefly.
  5. **No scrollbar during transitions:** the panel shows a scrollbar only when its content really overflows at rest, never while its height, crossfade or a section animates.
  6. **Extra sections:** their open and close animations work again (smooth, one motion), and Recently captured's rows line up with the other sections' rows.
  7. **Attachments:** a picture opens in Flint's lightbox (with the other pictures of the task or note); other files open in their default app as before (MEDIA-03: never a program).
  8. **Task details edit:** the notes are edited right in the panel with the M5 editor (the point of D-83), and Add subtask adds the subtask in the panel (it shows in the list too).
- **Pins and selection (TODAY-01, TASK-07, LIST-01):**
  9. A click on a pin (on a row, in Up next, or the panel's Pin chip, **Proposed**) unpins the task.
  10. **Right-click follows Windows Explorer (grill answer, resolves the 0.4.19 "unpin one unpinned all"):** right-clicking inside a multi-selection keeps it and the menu acts on all of it, and says so: a "3 selected" header and counted labels ("Unpin 3 tasks", "Complete 3 tasks"). Right-clicking outside the selection selects just that item (task or sidebar list) and its menu acts on it alone. Marks stay after an action-bar action.
- **Conversion and pages:**
  11. After **Convert to note** (a task, TASK-17, or a whole task list, LIST-04) the note opens with the cursor ready to type (**Proposed:** at the end of its text).
  12. A **task opened as a page** has the note's card around its title and body (TASK-05); its subtasks keep their own card below.
- **New, late in v1 (low priority, alongside M8; not now): the Clipboard section (NAV-08).** Docked at the bottom of the context panel, apart from its scrolling content, so it stays reachable under long outlines. It shows **Windows' own clipboard history** (`Clipboard.GetHistoryItemsAsync`, Windows 10 1809+): Flint never records the clipboard itself, and what password managers exclude stays excluded. Collapsed it shows the newest 3–4 items; expanded it scrolls; expanded or not is remembered. A click inserts an item at the cursor; **Capture as task** makes it a task. With clipboard history off, a note with a button opens `ms-settings:clipboard`; Flint never changes that setting. A caution for screen sharing is part of its design.
  - **Research (3 Nov 2026, Microsoft Learn and others):** the API is WinRT only (Flint needs a small native bridge, chosen under D-30 when built); it works only while Flint is in the foreground (else `AccessDenied`), so the section reads it when the window is active; `Clipboard.IsHistoryEnabled()` says whether history is on; on work PCs the "Allow Clipboard History" group policy can turn it off, which shows the same note (the button then can't help, so the note says it may be managed by the organisation).
- **Built (0.4.20), what was found (Proposed details):**
  - **Sticky:** the panel sticks at 16 px below the title bar, or at its starting position when that is higher (a note card starts 4 px down), so it never sits below where it started either.
  - **Scrollbar flash and broken section animations (5, 6):** both came from the panel animating its height on every resize of its content: it fought the sections' own folding and let the card be shorter than its content for a moment. The height now animates only when the panel's state changes, with its overflow hidden meanwhile. Recently captured's rows were indented by the fold's padding and clipped by its overflow.
  - **Hide animation:** a copy of the panel slides and fades out; its contents' own animations are switched off, since one of them ending removed the copy early.
  - **Notes in the panel (8):** clicking the rendered notes started editing only on plain text (a link opens, a code card's buttons act), so it often seemed view-only. The panel's notes are now always the editor, saved when it is left; a subtask typed in the panel is added with its own field (Enter adds the next one).
  - **Unpin one unpinned all (10):** the task menu kept an old copy of the marks, and a right-click's mouse press selected the row (clearing the marks) before the menu opened. Now a right-click doesn't select on press; the menu reads the current marks, keeps them inside a selection and selects just the row outside one. Menus anchor to their row, so selecting it for the menu can't close it.
  - **Clickable facts (4):** open checklist items (on a task's page its open subtasks), code blocks, images and links; the target is scrolled to a third of the way down and flashes.
  - **Convert to note (11):** the note opens with the cursor at the end; Undo (the toast's) returns to the list the task came from (an open list or note that goes away returns to the last place still there).
  - **Tests never open anything outside Flint:** in test mode, links and attachments a click would open are recorded instead of handed to the browser or an app (a test had clicked a link in the panel).

### D-87 — After 0.4.20: notes never lost, the panel's choreography, subtasks in the panel, pages and rows, the composer's ## menu, image menus
- **Date:** 3 Nov 2026 · **Status:** Decided (Davit); details marked Proposed in the docs
- **Confirmed (0.4.20):** the sticky panel, Up next rows, clickable facts, no scrollbar flash, the extra sections, attachments in the image viewer, unpinning with the pin, the unpin-all fix, Explorer-style right-click, the note opening after Convert to note, the task page card.
- **High priority, data loss (NAV-07, TASK-05, DATA-01):** notes edited in the panel were lost when the click outside went to the page (the panel changed before the editor was left). Every notes editor (the panel, inline bodies, a task's page) **saves as it is typed** (debounced, as notes do) and when it is left or closed, and never discards what was typed.
- **Panel (NAV-07):**
  1. **Show and hide are one choreography:** the column slides left while the panel comes in, and slides back while the panel goes out, moving together the same distance with the same curve, so they never overlap.
  2. The panel's **Add subtask** field uses Flint's editing-field style (not a default input).
  3. **Subtasks in the panel** have the list's right-click menu (delete, priority, reminder, pin, move…) and its indicators: the priority stripe, the reminder bell and time, the pin.
  4. **Notes in the panel:** a paragraph after a code block gets the normal paragraph spacing; text lines up with the panel's content inset; a code block shows no empty first line (everywhere the editor is used).
- **Task page and rows (TASK-05, TASK-02, UI-04, UI-10):**
  5. On a task's page, pasting code, JSON or a stack trace follows CAP-06: into the **selected subtask's notes** as a code block, or **with none selected, into the task's own notes** (grill answer); one undo step.
  6. A task's page shows its notes exactly as a note's body (no inner dark card).
  7. Code cards in bodies in the list are never cut off at the top, and when a subtask and its parent are both highlighted, their cards don't overlap.
  8. **↑/↓ keep the selected row in view**, scrolling smoothly (instantly under reduce-motion).
  9. **Impossible moves nudge (grill answer):** indenting the first task (or a subtask's first sibling), outdenting a top-level task, Alt+↑ on the first task and Alt+↓ on the last stay impossible, and the row gives a short nudge in that direction (off with reduce-motion).
- **Composer regression (CAP-03, CAP-05, D-51, D-25):** the main window's composer has the capture popup's `##` list menu (search and recent lists) and close-match card again. **Matching in both places:** after `##`, the longest existing list name that the following words spell out, spaces included (an exact name, ignoring case, spaces and hyphens as D-25 does), wins; only then do the single-word token rules apply. So with "new list 1" and "new list 2", `##new list 2` goes to "new list 2".
- **Images and sidebar (MEDIA-02, LIST-06):**
  10. Right-clicking a picture (a thumbnail in a body, a note or the composer, and in the image viewer, which gets a menu too): **Copy image**, **Open in viewer**, **Open in default app**, **Show in folder**.
  11. A list's or note's right-click menu has **Move to top**, only under the Manual sort; under another sort it is disabled with the usual "Switch to Manual" hint.
- **Builds (grill answer):** 0.4.21 with these fixes, then M4 step 9 as 0.4.22.
- The Trash screen (restoring deleted tasks, lists and notes, 30-day expiry) stays as planned for M7.
- **Built (0.4.21), what was found (Proposed details):**
  - **Lost notes:** the panel's notes were saved only when the editor was left; a click elsewhere made the panel move on first, and the editor went without being left. All notes editors (the panel, inline bodies, a task's page) now save 600 ms after typing stops, when left, and when they go. A task's page uses the same always-open editor as the panel and notes.
  - **Choreography:** the column and the panel (or, hiding, a copy of it) are animated together from the same distance with the same curve (`--fl-dur-page`); the end-to-end test samples every frame and checks the gap never closes.
  - **Cut-off code cards:** a code card's 1 px ring lay outside it and the body's clipping cut it when the body started with code; cards of a task and its subtask, both open, now keep 6 px apart.
  - **Code blocks in the editor:** a closed fence without a language is only the card's top edge; its copy button keeps room on the first line.
  - **Selection kept in view:** a selection made with ↑/↓ or from a panel link scrolls into view; a click or a right-click never moves the list (the menu would move with it).
  - **The composer's ## menu** was never built in the main window (only its chips); it now has the popup's menu and card, written for the composer. Matching (both places): after `##`, the longest run of two to eight words that spells an existing list's or note's name wins.
  - **Copy image** uses Electron 45's clipboard (`ClipboardItem` with a PNG). **Move to top** moves to the top of the list's group, or of the lists outside groups.
  - **A task page's paste:** handled outside text fields only; plain text waits for TASK-09.
  - **Menu aim (D-79):** moving on toward an open submenu restarts its grace, so a slow move (or a slow machine) across other items keeps the submenu; only a pause on an item switches to it.
  - **Menus near the window's bottom:** a menu with room neither below nor above the click (the task menu has grown) now sits as low as fits, never past the window's edge, and scrolls if it is taller than the window; before, its lower items could be off-screen.

### D-88 — M4 step 9 as built: smart link titles, temporary sorts, find in lists, multi-line paste, swipe, the auto-archive offer
- **Date:** 3 Nov 2026 · **Status:** Built (0.4.22); within D-72, D-79, D-84 and Q-13; the details below are **Proposed** (Davit's look at 0.4.22)
- **Smart link titles (TASK-10):** a pasted URL (a link whose text is its URL, or a bare URL in the editor) shows the user's link pattern's short form (D-84), else a built-in recognizer's: the link-pattern presets with every part varying (Azure DevOps `PR 42` and `AB#1234`, GitHub `repo#12` and `repo!9`, Jira `KEY-5`; no company URLs), else the domain and a shortened path (`example.com/docs/…/setup`, at most about 40 characters). The full URL stays in the file and is the link's tooltip; a long link in a row ends in an ellipsis and never wraps the row.
- **Temporary sorts (TASK-08):** "Sort tasks by" Priority, Reminder time or Date added, in a list's right-click menu and the page's blank-area menu (Ctrl+K later). A view only: the file's order stays. While sorted: the open tasks in that order with their subtasks under them, headings and other text left out, a line "Sorted by priority · Back to manual order" above the tasks; tasks without a reminder (or an unknown date added) last, date added newest first, ties in the file's order. Reordering returns to the manual order first (Alt+↑/↓; nothing drags while sorted). Opening another list ends the sort.
- **Find in task lists (NAV-06):** Ctrl+F in a task list opens the find bar in the note's style, floating at the top right of the list. Titles and notes are searched, Completed included; matches are highlighted (CSS Custom Highlight API), "2 of 5"; Enter and Shift+Enter jump, opening the Completed section or a body under its row when the match is there; Esc closes it and keeps the selection on the last match.
- **Multi-line paste (TASK-09):** text pasted into a task list (not into a field): each non-empty line a task (list markers and checkboxes at the start dropped; `!`, `##`, `@` stay text), below the selected task or at the top, one undo step; the toast offers **Keep as one** (one task: the first line its title, the rest its notes) and Undo. Code, JSON or a stack trace is one untitled task with it as a code block (D-45). A task's page keeps D-87's paste.
- **Swipe (NAV-04, D-79):** a two-finger horizontal swipe (the touchpad's horizontal scroll) adds up over about 240 px and then goes back (fingers to the right) or forward; an arrow grows at that edge while swiping; not over anything that scrolls sideways itself, not with Ctrl (zoom), only when there is somewhere to go.
- **The auto-archive offer (TASK-06, Q-13):** off by default (`autoArchiveDays` in `settings.json`, null). A Completed section of 50 or more offers "Archive tasks completed more than 14 days ago, automatically? Turn on · Not now" ("Not now" remembered per list on this machine). On, completed top-level tasks finished more than 14 days ago move with their subtasks to `.flint/archive/<list ID>.md`, a task list of its own (written first, so a crash leaves a copy, never a loss), at once, at start-up and at each day change; not an undo step. Turning it off and the number of days come with Settings (M8); archived tasks become searchable with Ctrl+K (M8).

### D-89 — After 0.4.21 and 0.4.22: a click selects, motion is part of done, 15 fixes
- **Date:** 3 Nov 2026 · **Status:** Decided by Davit (the rules, the click model, the link and caret details); fixes built (0.4.23); details marked **Proposed** are for Davit's look at 0.4.23
- **Standing rule:** every UI change or action added comes with smooth, minimal motion for appearing, disappearing and changing state, following 03 §5 (never delays input, interruptible, off with reduce-motion). A feature isn't done without it; it goes into the motion regression tests where practical (CLAUDE.md, 03 §5).
- **Clicks (supersedes D-71's click-to-edit; updates TASK-02, 03 §2):** a single click on a task always selects it, wherever it lands, the title's text included. Editing starts with a double-click or a slow second click on an already-selected row (D-76, unchanged), the caret where the click landed on the title (the end beside it). A link in a title: a click on an unselected row selects it, a click on a selected row opens the link, **Ctrl+click** opens it from any state and marks nothing.
- **0.4.21 fixes:** (1) a subtask in the context panel highlights on hover and is clickable: it is selected in the list (scrolled into view if needed) and the panel shows its details, with the panel's back arrow (and Alt+←) returning to the parent (NAV-07). (2) Code, JSON and stack traces pasted into a subtask's notes (CAP-06): the editors already fenced them; what was missing is fixed: on a task's page with the panel, a selected subtask now shows its own details (its notes editable there; before, its notes couldn't be opened at all), and in the list, a paste on a selected task whose notes are open inline goes into those notes (**Proposed**; without open notes it stays TASK-09's untitled code task). (3) An open task's raised card keeps 6 px from a selected row next to it, as between two cards. (4) The editing field's top edge in an inline body is no longer cut off (the body clips for its opening and closing only, with a 6 px margin). (5) Held ↑/↓ keep the selection in view at once, without smooth scrolling; a single press still scrolls smoothly. (6) Indent and Outdent from the right-click menu nudge the row when impossible, as the keyboard does. (7) The `##` menu (the composer's and the capture popup's) lists every matching list; past five it scrolls (wheel, ↑/↓ keep the highlighted one in view). (8) Right-click menus in the image viewer (the menu now draws above the viewer and takes its keys first), on Attachments (a picture's menu; for other files Open in default app and Show in folder) and on References (Open link, Copy link) (MEDIA-02, UI-08).
- **New issues:** (9) Ctrl+A on a note or a task's page selected the whole window's text, the sticky context panel included, which glitched while scrolling: it now selects the note's (or the page's notes') text; the panel's own text is never part of a window-wide selection (**Proposed**). (10) The panel's lower sections (Attachments, References, Recently captured) ease in with the rest: content that arrives just after a change (Up next loads a moment later) animates the panel's height too, and each section fades in as it appears. (11) With the context panel, Shift+Enter in a task's title (and "Add notes") goes into the panel's notes editor instead of opening the body inline; a body open inline anyway closes with Esc or its notes icon. (12) Copy buttons (code cards in bodies, notes and the panel) morph into a checkmark for a moment.
- **0.4.22:** (13) temporary sorts: the rows glide to their new places when a sort starts or ends (the selection's highlight with its row; rows that come back fade in), and the "Sorted by … · Back to manual order" line eases in and out, taking and giving back its room (TASK-08). (14) Inbox has a right-click menu of its own: Sort tasks by ▸, Back to manual order while sorted, Duplicate (**Proposed**; no rename, convert, grouping or delete; LIST-03). (15) The find bar (NAV-06) opens and closes with a short rise and fade, its count crossfades as matches go by, and the match's row lights up as a jump lands; with the list at its top it sits level with the title row, and as the list scrolls it settles 16 px below the window's top, level with the context panel's top.
- **The task menu (17 items), proposed grouping, not built (Davit to approve):** Complete · Edit · Open as page | Priority ▸ · Reminder ▸ (Set or Change…, Turn off/on) · Pin | Add ▸ (Subtask, Notes) | Move to… · Arrange ▸ (Indent, Outdent, Format as code, Duplicate, Convert to note) | Delete: 10 lines instead of 17, the daily actions first, shortcuts kept as hints.
- **Plan:** 0.4.23 has these; M5's list is complete (D-84), so M6 step 1 follows as 0.4.24: the Today view of pinned tasks, Today ordering and the rollover prompt (TODAY-01/02).

### D-90 — M6 step 1: the Today view, its order, the rollover prompt and today's reminders
- **Date:** 3 Nov 2026 · **Status:** Decided by Davit (scope, composer, start view, the ×); built (0.4.24); details marked **Proposed** for Davit's look
- **Decided:** step 1 includes today's reminder cards (TODAY-03, as in mockup 03); Today has its own composer, which adds to Inbox already pinned; Today is first in the sidebar and the main window opens on it; the rollover card's × keeps the tasks pinned, like Roll over, and the card is gone for the day.
- **The view (TODAY-01, mockup 03):** a greeting by the time of day ("Good morning. Four tasks are **in focus.**"; "Nothing is **in focus** yet." when nothing is pinned), the date and the number of reminders today; the rollover card; the reminder cards; the composer; and **Focus**, the pinned tasks of every list as ordinary rows (the same keys, menus, panel and motion as a list) with each task's home list as a small chip at the row's end. Today is a view, never a file: every change goes to the task's home list (complete, edit, priority, notes, pin, move…), so Today holds references, not copies. A pinned subtask shows on its own row unless its parent is pinned too. Completed pins sit in Today's Completed section until the day changes (D-85). Today's ID is `@today` (no list ID can start with `@`).
- **Order (Proposed):** Today's own manual order (Alt+↑/↓, drag) in `.flint/today.json`, undoable, never the home lists' order; a task pinned in Flint (P, the menu, the composer) goes to the top, a pin found in a file (Obsidian, an older Flint) at the end. Indent and Outdent are the home list's business and nudge in Today.
- **The composer (Proposed):** `##list` still sends the task to that list (pinned); Edit-state Enter below a Today task adds the new task after it in its home list, pinned, right below it in Today.
- **The rollover prompt (TODAY-02, Q-04 resolved as proposed):** on the first open of Today on a new day, "Unfinished from yesterday" lists the open tasks pinned before today (each pin's day is kept in `today.json`; a pin Flint sees for the first time counts as pinned today). **Roll over** or **×** keeps them pinned (for today); **Clear** unpins them, one undo step, and they stay in their lists. The card rises in and folds away. Turning the prompt off comes with Settings (M8).
- **Reminder cards (TODAY-03, Proposed):** the reminders still to come today (not muted, open tasks), two cards a row, each with the time, "in 2 h 30 min", the title and its list; the next one's bell tile is the strong one; a click selects the task in Today, or opens it in its list. Overdue ones and the full Reminders section (REM-11) come with the rest of M6.
- **Sidebar (Proposed):** Today (sun icon) above Inbox with its count of open pinned tasks; it can't be dragged, renamed or deleted; its right-click menu has the temporary sorts.
- **Next:** the rest of M6 (reminders on any task from anywhere, the natural-language picker, sound and Focus Assist, the full missed-reminder list, the Reminders section with overdue items), then M7 and M8.

### D-91 — Fixes after 0.4.23 and 0.4.24: a reminder opens its task, scroll memory, code pasted from Windows, the task menu in groups
- **Date:** 4 Nov 2026 · **Status:** Decided by Davit (items 1 to 6 and the menu grouping); built (0.4.25); details marked **Proposed**
- **A reminder opens its task (REM-05, REM-07):** Open on a reminder toast (and, with the rest of M6, in the missed list) goes to the task's list, scrolls the task into view (centred; at once in another list, smoothly in the same one), selects it, so the panel shows it on wide screens, and plays the brief highlight flash (as find's jump does). On narrow windows the body stays closed. The flash and the scroll wait for the list's rows (also for a list that wasn't open).
- **Scroll memory (NAV-04):** every list, note and task page keeps its scroll position for the session; going back to it (back, its sidebar row, a link) restores it at once, never with a smooth scroll; a place not seen yet opens at the top. Nothing is kept after Flint quits.
- **Pasting code (CAP-06, cause found):** code copied on Windows has CRLF line endings; in a note's main editor the code block's cursor was placed past the end (the `\r`s counted) and the insert threw after the normal paste had been cancelled, so nothing was pasted. Pasted text is now normalised to `\n` everywhere (`normalizeNewlines`, `blockFor`, `fencedBlock`, `insertBlock`), and if a code block still can't be made the text is pasted as it is: a paste never silently does nothing. **Code on one or two lines (Proposed):** a line that starts like code (`export`, `const`, `def`, `SELECT`, a `/**` comment…) with code punctuation and a code-only mark (`=>`, `({`, `});`, `===`, `a::b`, `x = 1`…), or with two such marks, is code; prose with a bracket or a semicolon, links, Dataview fields and `[[wikilinks]]` stay text. Davit's sample is a fixture (`packages/core/test/fixtures/paste-typescript-*.txt`, CRLF and one line).
- **The picture menu's Open in viewer (MEDIA-02):** in an editor a picture opens on mousedown, so the menu's simulated click did nothing; the menu now opens the viewer directly.
- **Selection in the panel (NOTE-01):** CodeMirror measures a whole-line selection from the first rendered line's side padding; a note starting with a code card (14 px padding) shifted every selection 14 px in on both sides. No line has side padding any more: the code card's inset is a transparent border with its ring just outside, and the quote's bar a background.
- **The note's find bar (NAV-06):** it sits as the task list's does: level with the title row at the top of the page, then level with the context panel's top (or 16 px) while scrolling; it no longer pushes the note down, and it fades out when closed.
- **The task menu (UI-08), Davit's grouping:** Complete · Edit · Open as page / Priority ▸ · Reminder ▸ (Set… or Change…, Turn off/on) · Pin / Add ▸ (Subtask, Notes) / Move to… · Duplicate / More ▸ (Indent, Outdent, Format as code, Convert to note) / Delete, with the shortcut hints kept. **Proposed:** a done task's menu is Reopen · Open as page / Pin / Move to… / More ▸ (Convert to note) / Delete; More always shows both Indent and Outdent, and an impossible one nudges the row (D-89).
- **Next:** the Today redesign (D-92, mockup 12), then the rest of M6.

### D-92 — The Today redesign (mockup 12): Focus with high priority, the progress line, the Today column, live reminders
- **Date:** 4 Nov 2026 · **Status:** Decided by Davit (items 7 to 14 and the three answers below); built (0.4.26); details marked **Proposed**. Reference: `docs/design/mockups/12-today-redesign.html`, `docs/design/screenshots/12-today-redesign.png`.
- **Decided (grill):** on wide screens the Today column shows Timeline, Done and Captured, and selecting a task doesn't change it; Shift+Enter (while editing a title) or the notes icon switches the column to that task's details (the same panel as elsewhere, editable), and its back arrow, Esc or selecting another task return to the Today sections; Open as page still works. On windows too narrow for the column (or with the panel hidden) the sections **stack under Focus**, each folding, its open or closed state remembered. The high-priority rows are **full rows in a fixed order**: select, ↑/↓ through both groups, complete, edit, menus, notes; P pins one (it joins the pinned tasks); Alt+↑/↓ and drag only move pinned tasks (a high-priority or done row nudges); the sidebar's list order (Inbox first), then file order; subtasks count unless their parent is pinned or itself high priority (they show under it); "Show all N" stays open for the session.
- **The rollover card (TODAY-02):** stays on every open that day until Roll over, Clear or × is chosen (as built in 0.4.24, now said explicitly); the tasks on the left, Clear and Roll over at the bottom right.
- **Focus (TODAY-01):** "Focus · pinned" first; a done pinned task stays in place after the open ones, faded, with "done 11:20" instead of its list chip, until the day changes (Today has no Completed section any more); then "High priority · not pinned", a quieter group (secondary titles, softer stripes and checkboxes), the first five and "Show all N" / "Show fewer". Pinned rows show the pin, high-priority rows don't.
- **The greeting:** "Good afternoon. **Five tasks** are in focus." (the count in white, mockup 12), the date with "· 3 reminders left today", and a slim **progress line** with "X of Y done": Y is today's pinned tasks plus the tasks with a reminder today (not turned off; a task done before today doesn't count), X those done today; it fills smoothly as tasks are done.
- **Reminder cards (TODAY-03):** the next one is wider (1.25 : 1 : 1) and brighter: the strong bell tile, a 20 px time, "Next", a live countdown ("in 1 h 18 min", then "in 40 s"); later cards are quieter ("in 2 h 48"). Up to three in a row; **Proposed:** more give "+N more", which shows them all in further rows ("Show fewer" again). They follow the clock: when a reminder's time comes its card folds away and the next one takes over, without leaving Today.
- **The Today column (in the context panel's place: 440 px, 380 px compact, sticky, its top level with the rollover card or the first card):** **Timeline**, today's reminders on a slim hour rail covering the hours with reminders and the current time, padded half an hour and rounded to the hour (**Proposed:** labels every 1, 2 or 3 hours, room for close reminders, at most 300 px), passed ones faded and struck through, the next one highlighted, a white now line with the time that moves with the clock; **Done today · N**, the tasks completed today in any list with their times, newest first; **Captured today · N**, today's popup captures with their list and time and "Sort Inbox · N" (opens Inbox; hidden when Inbox is empty). Each section hides when empty; Done and Captured fold (remembered on this machine). A click on any of them opens the task: selected and flashed in Today when it is there, otherwise in its own list (as a reminder's Open, D-91).
- **Composer:** "Add a task to today…" (adds to Inbox, pinned, D-90).
- **Motion (D-89):** the cards rise in and fold away, the progress line fills, the now line glides, sections fold, entries ease in and out as they come and go, the column slides in and crossfades with a task's details; all off under reduce-motion.
- **Data (Proposed):** `TodayExtras` gains `high`, `done`, `captured`, `inbox` and `progress`, and its `reminders` hold all of today's (passed and done ones too, with `done`); the window works out what is still to come from the clock.
