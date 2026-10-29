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
- **Decision:** The popup has a **title line**, always one line and focused, the only place shorthand is read; its placeholder shows the fallback title (the first meaningful line of the first block), used when the title is left empty or holds only shorthand (`!h ##infra` then gets the fallback title in front). Below it, the **selection area** holds multi-line content, code, JSON and stack traces as compact blocks (`JSON · 8 lines`, first four lines, expandable) and plain text and notes as editable blocks. The priority / list / reminder buttons always act on the title. Davit's answers: **Shift+Enter** adds a note block (multi-line, Enter saves from it); highlighting is **built in for JSON and stack traces** only (keeps the popup tiny, CAP-10), other code plain monospace; a **single-line selection** also goes to the selection area, becoming the title without repetition when the title stays empty. One plain line pasted into the title is typed there. Implementation: `composeCapture` in `@flint/core/shorthand` turns title and blocks into the saved text.

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
