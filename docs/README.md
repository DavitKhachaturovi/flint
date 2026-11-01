# Flint — Documentation Index

**Flint** is a minimalist, keyboard-first, quick-capture notes and task app for developers, by Davit Khachaturovi.
It exists for one moment: you are on a call or deep in work, a task or bug pops into your head, and you need it written down in under three seconds without losing focus.

These documents are the **single source of truth** for Flint v1. If code and docs disagree, the docs win until they are deliberately updated. Any change in scope, behavior, or architecture must be reflected here in the same change.

## Documents

| # | Document | What it covers |
|---|---|---|
| 01 | [Vision & Principles](01-vision-and-principles.md) | Problem, target users, product principles, non-goals ("not doing" list), brand |
| 02 | [Features](02-features.md) | Every feature with an ID, status (v1 / Later), and behavior spec |
| 03 | [UX & Design Language](03-ux-and-design-language.md) | Interaction model (navigate vs edit), keyboard map, visual language, priority styling, motion, themes, density |
| 04 | [Data & Storage](04-data-and-storage.md) | On-disk format, folder layout, task IDs, metadata, attachments, trash, snapshots, atomic writes, file watching |
| 05 | [Architecture & Performance](05-architecture-and-performance.md) | Electron stack, process/window model, platform boundary, performance budgets, notifications, capture-selection, updates, signing, CI |
| 06 | [Roadmap & Open Questions](06-roadmap-and-open-questions.md) | Technical spike, v1 milestone plan, Later items, open questions that need a decision |
| 07 | [Decision Log](07-decision-log.md) | Every decision made so far, with rationale and alternatives considered |
| 08 | [Coverage Checklist](08-coverage-checklist.md) | Traceability: every agreed item mapped to where it is specified |
| 09 | [Visual Design](09-visual-design.md) | Dark-mode visual language, tokens, components, depth, motion, screen-by-screen mockups (`design/`) |

## Status

- **Phase:** M4 (task lists) up to step 8 plus the D-80 fixes (0.4.15), on branch `m4-lists`; next the M5 editor, then M4 step 9. The current state is in [06 §0](06-roadmap-and-open-questions.md#0-handoff-2-nov-2026-after-the-d-80-fixes-0415).
- **Logo:** `assets/icon/flint-icon-512.svg` (final), with the small in-app variant `flint-icon-16.svg` and the taskbar and tray variants `flint-taskbar-16.svg` and `flint-taskbar-24.svg` (D-74).
- **Visual design:** dark mode only for v1; see [09](09-visual-design.md) and `docs/design/`.
- **Repository:** `C:\Forge\flint`, Azure DevOps `DavitKhachaturovi/flint` (branch `main`).
- **Target platform (v1):** Windows x64, an unsigned installable `.exe` handed to coworkers manually (internal tool, D-19). macOS and ARM come later.
- **Stack:** Electron + React + TypeScript + Vite. See [05](05-architecture-and-performance.md).
- **Who builds it:** No dedicated developer resources are assigned. Flint is expected to be built and maintained primarily by Claude (Claude Code), with other engineers able to step in. This is why the stack is TypeScript end to end.

## Conventions used in these docs

- **Status tags:** `v1` = must ship in the first release. `Later` = agreed, explicitly deferred. `Not doing` = deliberately excluded (see 01, Non-goals).
- **Feature IDs** (e.g. `CAP-03`) are stable. Reference them in commits, PRs, and tests.
- **"Proposed"** marks a concrete design that was not explicitly confirmed yet. It is the default to implement unless an open question in [06](06-roadmap-and-open-questions.md) is resolved differently.

## Glossary

| Term | Meaning |
|---|---|
| **List** | A single document. Either a *task list* (mode: tasks) or a *note* (mode: note). Stored as one markdown file. |
| **Task list mode** | A list where every line is a separate, draggable task with priority, completion, reminder, and an optional body. |
| **Note mode** | A free-form markdown document with Obsidian-style live preview. |
| **Inbox** | The default task list. Every capture lands here unless told otherwise. |
| **Today** | A virtual view of starred tasks from any list. Holds references, not copies. |
| **Capture popup** | The Spotlight-style window opened by the global hotkey. |
| **Mini mode** | A small always-on-top floating window showing only Today or Inbox. |
| **Flint folder** | The user-configurable folder on disk where all lists and attachments live. |
| **Navigate state / Edit state** | The two keyboard states of a list (see 03). |
