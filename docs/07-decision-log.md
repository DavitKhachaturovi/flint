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
- **Date:** Oct 2026 · **Status:** Proposed (accepted by Davit as defaults during the pre-M1 review; each is marked Proposed where it is specified)
- **Decision:** the gaps found while reviewing the docs before M1 are filled as follows:
  - **IDs:** missing IDs are written on the next save of the file (as before); until then the task has a provisional in-memory ID that stays stable across re-parses. ID uniqueness covers lists, notes, the archive and Trash (04 §3).
  - **Hand-edited files:** a task checked outside Flint (`[x]` without `completion`) gets `completion` on the next save of that file; indentation is read as tabs, 2 or 4 spaces and written as 4 spaces unless the file already uses tabs; unchanged field values keep their raw text (`highest` is not rewritten as `high`); per-line endings, BOM and the final newline are preserved; a file that isn't valid UTF-8 opens read-only (04 §3, §6).
  - **Subtasks:** completed subtasks stay under their parent; Tab on a task that has subtasks does nothing; an outdented subtask moves to just after its parent's group (TASK-04).
  - **Saving:** before writing, Flint re-reads the file; if it changed on disk, Flint re-applies its pending operations by task ID, so a CLI or Claude write is never overwritten (04 §6).
  - **Tooling:** a small custom natural-language time parser instead of a library such as chrono-node, because it runs in the tiny capture popup; npm workspaces for the monorepo (05 §1–2).
  - **Docs hygiene:** no emoji in UI examples (CAP-04); no theme switching in v1 (NAV-01, 01 Principle 10, 03 §6).
  - **Filled while writing the spec, not yet reviewed (04 §3–4):** checkbox states (`[x]`/`[X]` completed; other status characters such as `[-]` are non-task content; `completion` on an open task is ignored and kept), list markers (`-`/`*`/`+` tasks; numbered items are non-task content), Completed-section recognition (first level-2 "Completed" heading; state comes from the checkbox, not the position), task fields are inert while a list is a note, a date-only `reminder` means 09:00, and `completedAfter` in `meta.json` for un-checking (TASK-06).
