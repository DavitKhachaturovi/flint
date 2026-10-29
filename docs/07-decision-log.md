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
- **Date:** Oct 2026 · **Status:** Proposed (Q-09)
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
