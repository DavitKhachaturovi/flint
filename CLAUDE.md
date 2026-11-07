# CLAUDE.md — Flint

Flint is a minimalist, keyboard-first quick-capture notes and task app for developers (Electron + React + TypeScript, Windows x64 first).

## Source of truth

- **`docs/` is the spec.** Read `docs/README.md` first, then the document relevant to the task. If code and docs disagree, the docs win until they are deliberately changed.
- **Any change to scope, behaviour, format, or architecture updates the docs in the same change**, including `docs/07-decision-log.md` (new decision entry) and `docs/08-coverage-checklist.md` when items are added.
- Feature IDs (e.g. `CAP-07`, `TASK-06`) are stable. Reference them in commit messages, PR titles, and test names.
- Items marked **Proposed** in the docs are the default to implement. If an open question in `docs/06-roadmap-and-open-questions.md` is still undecided, implement its proposed default and do not invent a different one.
- Never build anything listed as a non-goal or "considered and not selected" in `docs/01-vision-and-principles.md` without a new decision.

## Questions and disagreements

- The docs were written before any code existed, so they can be wrong, incomplete, or contradict each other. **If something is unclear, missing, contradictory, or you think a decision is wrong, stop and ask Davit** instead of guessing or silently working around it. Double-check against the docs before and after each milestone.
- Disagreeing is welcome. Explain the problem and the alternative; once Davit decides, record it in `docs/07-decision-log.md` and update the affected docs.
- Small gaps with an obvious answer that fits the principles in `docs/01`: implement the obvious answer, mark it **Proposed** in the relevant doc, and mention it in your summary.

## Where to start

1. **M1, `packages/core`** (`docs/06` §2): the file format (Dataview inline fields, `docs/04` §3, decided in D-20) with round-trip and fuzz tests first.
2. **M2/M3 start with the risky pieces** (`docs/06` §1): R-1 popup latency, R-3 actionable toast, R-2 capture-selection (in M3 after the capture is saved to Inbox, D-37), built as production code with their acceptance checks. Record the measured numbers in `docs/06`. There is no throwaway spike (D-18).
3. Then the remaining milestones in order.

## Non-negotiables

- **Architecture** (`docs/05`): `packages/core` is pure TypeScript with no Electron imports; the UI reaches the OS only through the typed Platform interface in the preload; `contextIsolation` on, `nodeIntegration` off, sandboxed renderers.
- **Performance budgets** (`docs/05` §4): hotkey → focused popup < 50 ms (hard limit 100 ms); keypress → screen one frame; Enter → saved and hidden < 100 ms. Pre-warmed, tiny capture popup; windows are hidden, never destroyed.
- **Data** (`docs/04`): plain markdown, task metadata as `[key:: value]` fields with a stable `id`, tolerant reader and canonical writer, atomic writes, never destroy content the parser doesn't understand. Round-trip and fuzz tests for the format are mandatory.
- **Privacy:** no telemetry; **the only network use is the updater** (APP-06, D-136): installed builds check GitHub Releases, only from electron-updater's own session and only to GitHub's release hosts; development, test and benchmark builds never update, and the end-to-end network test still allows no endpoint at all. Fonts (Onest, FiraGO for Georgian only, Geist Mono; D-60) are bundled locally, never loaded from Google Fonts.
- **Visual design** (`docs/09`): use `docs/design/tokens.css` variables only, no raw hex values in components. Match `docs/design/screenshots/` and `docs/design/mockups/`. Dark mode only in v1. No emoji in the UI. Motion follows `docs/03` §5 (D-75: never delays input, interruptible, off under reduce-motion).
- **Every action has a palette command (D-106):** a new feature with an action adds its Ctrl+K command (and its shortcut to `apps/desktop/src/shared/shortcuts.ts` if it has one) in the same change.
- **Motion is part of done (D-89):** every UI change or action added comes with smooth, minimal motion for appearing, disappearing and changing state, following those rules. A feature isn't done without it; add it to the motion regression tests (`e2e/smoke.spec.ts`, the animation recorder) where practical.

## Working conventions

- TypeScript strict mode everywhere. Vitest for `packages/core`, Playwright for Electron end-to-end tests.
- **End-to-end tests run on a fixed clock (D-107):** `smoke.spec.ts` on Tuesday 10 March 2026 from 10:00 (`appNow()` is Flint's time; never build times from the real clock in a test); `day-change.spec.ts` crosses midnight on purpose. A new time-dependent behaviour gets its check on the test clock.
- **Tests and probes never touch Davit's real clipboard (D-93):** use synthetic paste events (`ClipboardEvent` with a `DataTransfer`); a step that must write to the clipboard (a copy button) saves it first and puts it back right after (`saveClipboard` / `restoreClipboard` in the e2e hooks).
- **Dependencies (D-30, docs/05 §1):** Node 24.22.1+ on the 24.x line (`.node-version`, engine-strict). Use the latest stable version the rest of the toolchain supports, pinned exactly; never adopt a version published less than 7 days ago (`min-release-age=7`, `scripts/check-release-age.mjs` in CI) unless it is a security fix from the project's official maintainers, which you record in D-30 and the script's allowlist. CI fails on high/critical `npm audit` findings. Adopt Node and Electron security releases promptly and record them in docs/07. Electron 45.1.0+ (embeds Node 24.22.1).
- Before a non-trivial change, stress-test the plan with Davit: one question at a time, each with a recommendation and its severity (the **grill-me** routine). Flint's conventions are the ones in `docs/05` and this file.
- **Every version bump (D-117)** adds a detailed entry to `docs/release-notes.md` and a short, user-facing one to `docs/whats-new.md` (2–5 plain-language highlights, what's new and how to use it; no decision numbers, tests or files). The app's What's new card shows `whats-new.md`.
- Keep commits small and scoped to one feature ID or milestone step.
- **Flint is Davit Khachaturovi's personal, open-source project** (MIT, D-135). The repo is public on GitHub, `DavitKhachaturovi/flint` (one branch, `main`), cloned at `C:\Forge\flint-repo` (`C:\Forge\flint` is Davit's own Flint folder). Keep it free of anything private: no employer, client or colleague names, internal URLs, work emails or private ticket numbers, in code, tests, fixtures, docs or commit messages; examples use neutral names (`Unicorn`, `Alex`, `acme`, `Contoso`, `*.example`). 1.0.0 was the first GitHub release (D-139); after it, a release is a version bump and a tag `v<version>` pushed to `main` (1.0.x for fixes, 1.x.0 for features: Proposed, D-139). Installers are unsigned NSIS (`docs/05` §6). CI is GitHub Actions (`.github/workflows/ci.yml`, every push and pull request); a tag `v*` runs `release.yml`, which publishes the installer and `latest.yml` to GitHub Releases with the version's section of `docs/whats-new.md` as its text.
