# 05 — Architecture & Performance

## 1. Stack decision

**Electron + React + TypeScript + Vite**, Windows x64 first. Full rationale and alternatives are in the [Decision Log](07-decision-log.md) (D-04); the short version:

- Flint will be built and maintained mainly by **Claude (Claude Code)** with no dedicated developers. TypeScript is where Claude is most productive (most training examples, fastest iteration, no compile/borrow-checker loops), and **other engineers can read and fix TypeScript** if Claude gets stuck. Few engineers maintain Rust.
- Every risky feature has a **proven, documented path** in Electron (actionable toasts, global hotkeys, tray, auto-update).
- What users actually *feel* (popup speed, typing, scrolling, animation) is the same as Tauri: on Windows, Tauri's WebView2 is the same Chromium engine. Tauri's real wins (≈40 MB vs 150+ MB RAM, ~8–10 MB vs ~100 MB installer, faster cold start) were judged not worth the maintenance risk. 150–200 MB idle RAM is acceptable.
- Most tools around it are JS/TS, which eases future integration with other apps.

### Libraries (Proposed unless noted)

| Concern | Choice |
|---|---|
| Shell | Electron (decided) |
| UI | React + TypeScript (strict) + Vite (decided) |
| Note editor / task body editor | CodeMirror 6 with an Obsidian-style live-preview layer (Obsidian itself is built on CodeMirror 6) |
| Drag and drop | dnd-kit (or equivalent) |
| Spring animations | A spring animation library (e.g. Motion / react-spring), disabled under reduce-motion |
| Markdown rendering (read-only) | markdown-it 15, raw HTML off and unsafe link schemes refused: inline markdown in task titles from M4 (LIST-02, D-52), rendered task bodies (D-49) |
| Syntax highlighting | CodeMirror language packages (in editor) |
| Fuzzy search | A small in-memory fuzzy matcher (data sizes are small) |
| Shorthand and natural-language time parsing | Small custom parsers in `packages/core`, no library such as chrono-node: they run in the capture popup, which must stay tiny (CAP-10, D-28) |
| Monorepo | npm workspaces (D-28) |
| Node | 24.22.1 or newer on the 24.x line, the major Electron embeds (D-30) |
| Fonts | Geist + Geist Mono (OFL), **bundled as local font files**; never loaded from Google Fonts at runtime (offline, no network, APP-09) |
| Design tokens | `docs/design/tokens.css` (09) as the base stylesheet's CSS custom properties |
| File watching | chokidar or Node `fs.watch` with debouncing |
| Win32 calls (capture-selection) | An FFI library such as **koffi** (calls Win32 directly, no native addon rebuilds per Electron version) |
| Packaging | electron-builder, NSIS installer; Electron fuses set by electron-builder and checked with `@electron/fuses` (D-34) |
| Updates | electron-updater (Later, D-19) |
| Tests | Vitest with fast-check for property-based tests (core), Playwright for Electron (end-to-end) |

### Dependency policy (D-30)
- **Latest stable version the rest of the toolchain supports**, pinned exactly: exact versions in `package.json`, the lockfile pins the whole tree. Exceptions are recorded in D-30 (TypeScript 6.0.3: typescript-eslint supports < 6.1).
- **7-day cooldown** against supply-chain attacks: `min-release-age=7` in `.npmrc`, and `scripts/check-release-age.mjs` in CI checks the whole lockfile (npm only applies the setting when resolving). Security fixes from a project's official maintainers may skip it: installed with `--min-release-age=0` and listed in the script's allowlist.
- **`npm audit --audit-level=high`** in CI; high or critical findings fail the build.
- **Install scripts** run only when approved in `package.json` `allowScripts`, pinned to an exact version (npm 11.19). Review what a script runs before approving it.
- **Node and Electron security releases** are adopted promptly and recorded in the decision log. Electron must embed a patched Node: a test fails if its `process.versions.node` is below 24.22.1.

---

## 2. Repository structure (Proposed)

```
flint/
  docs/                      ← these documents (source of truth)
  packages/
    core/                    ← pure TypeScript, no Electron imports
      format/                ← markdown parse/serialize for lists, tokens, IDs (04)
      shorthand/             ← capture shorthand parser: !h ##list @time (CAP-03)
      time/                  ← natural-language time parser (REM-02)
      model/                 ← lists, tasks, operations (move, reorder, complete, convert…)
      undo/                  ← operation history (DATA-03)
  apps/
    desktop/
      main/                  ← Electron main process: storage, watcher, scheduler, hotkeys, tray, notifications, updater
      preload/               ← the typed Platform bridge (contextBridge)
      renderer/
        main-window/
        capture-popup/       ← separate, tiny entry point (CAP-10)
        mini-mode/
    cli/                     ← Later (CLI-01/02), reuses packages/core
```

### Rules
- **`packages/core` must not know it runs in Electron.** It operates on strings and a small file-system adapter. The same code powers the app, the CLI (Later), and future integrations, so the file format and shorthand parsing are identical everywhere.
- **The UI reaches the OS only through a narrow, typed `Platform` interface** exposed by the preload script: windows (show/hide/position), notifications, global hotkeys, clipboard, file operations, autostart, updates. This keeps a future switch to another shell (e.g. Tauri) limited to rewriting this layer, and keeps other apps integration simple later.
- **Security defaults:** `contextIsolation: true`, `nodeIntegration: false`, sandboxed renderers, no remote content loaded, strict Content-Security-Policy. **D-34:** the renderers load from an in-app scheme, `app://flint/…` (standard and secure, served only from the built renderer folder, not registered with Windows), never `file://`; the network guard allows no `file:` requests. The packaged `Flint.exe` has its Electron fuses set: not usable as a Node runtime (`ELECTRON_RUN_AS_NODE` ignored), no `NODE_OPTIONS` and no inspector flags, loads only its own `app.asar` with embedded integrity validation, cookie encryption on, no extra `file://` privileges. **Task bodies (TASK-05, D-49):** images in the Flint folder load from `app://media/…` (the same in-app scheme, another host): only raster image files (PNG, JPEG, GIF, WebP, BMP; not SVG) inside the Flint folder, with the same path checks as the renderer files; the main window's CSP allows `img-src app://media` and nothing remote. **D-84:** videos (MP4, WebM, MOV) load the same way, streamed with range requests; a large file linked outside the Flint folder (MEDIA-03) loads from `app://linked/…`, which serves only image and video types at an absolute path, nothing else. Opening an attachment in its default app (`shell.openPath`) is allowed for media and documents only; programs and scripts are never opened, and any other type asks first.

---

## 3. Process and window model

- **Main process** owns: storage (read/parse/write), the file watcher, the reminder scheduler, global hotkeys, the tray, notifications, auto-update (Later, D-19), single-instance lock.
- **Renderer windows:**
  - **Main window** — created at startup (hidden if Flint was started at login).
  - **Capture popup** — created at startup, kept rendered and hidden (pre-warmed).
  - **Mini mode** — created on first use only (keeps idle RAM down), then hidden, never destroyed. **D-109 (0.8.8):** `main/mini.ts`; its page `renderer/mini/` on its own host (`app://mini`); its preload exposes a typed subset of the main window's Platform (the lists, the quick notes, the editor's needs) plus its own window calls; content protection (`setContentProtection`, `WDA_EXCLUDEFROMCAPTURE`) on it and on the capture popup by default. One window edits a note at a time (`main/note-editors.ts`); the reminder card beside the toast closes the toast with `Notification.close()` (Action Center too, in the same session). **D-110 (0.8.9):** a transparent window that is a stage for the card (`main/mini-place.ts`: the largest card from the corner it hangs from, plus the shadow's margin), so resizing and the height are the page's own; clicks pass through except over the card, its handles and open menus, decided by main checking the cursor against the rectangles the page reports (16 ms near mini, 120 ms elsewhere, only while it is shown; no forwarded mouse moves, D-69). Its page shares the main window's components (`renderer/ui/`) and stylesheet (`ui/app.css`). **D-111 (0.8.10):** the stage keeps room on the card's hang side, so both side edges resize without the window moving; mini takes the foreground with the popup's fallback (`forceForeground`) when Windows refuses it; hiding (mini and the popup) hands the focus back at once, lets clicks through and hides the window after the card's fade.
- **Hide, never destroy** (APP-02). Closing hides. Quit only from the tray/palette (APP-03).
- **Single instance** via Electron's single-instance lock (APP-04); a second launch (or a toast protocol activation) is routed to the running instance.
- **Autostart** at login via Electron's login-item settings (APP-01), default on.
- **Crash recovery** (APP-07): on a renderer `render-process-gone` event, recreate/reload that window silently. Tray and hotkeys live in the main process and keep working.

---

## 4. Performance

### What "snappy" means
- **< 100 ms** feels instant.
- **100 ms – 1 s** is noticeable, but the train of thought survives.
- **> 1 s** loses focus — unacceptable during a call.

### Budgets (must be measured in the spike and in CI where possible)
| Interaction | Budget |
|---|---|
| Global hotkey → popup visible **with a focused cursor** | **< 50 ms** (hard limit 100 ms) |
| Keypress → character on screen | One frame (~16 ms) |
| Enter in popup → popup hidden and focus returned (after the main process acknowledges the capture over IPC) | **< 50 ms** (D-27) |
| Enter in popup → capture durably on disk | **< 100 ms at p95** (D-27) |
| Switching lists, opening a note | < 100 ms (Proposed) |
| Ctrl+K results update per keystroke | < 50 ms for typical data (Proposed) |
| Idle CPU (tray, nothing happening) | ~0% (Proposed) |
| Idle RAM | ~150–200 MB accepted |

**Test conditions:** an average laptop (not a developer workstation) **with a Teams call running**, including a full-screen Teams call.

**Capture save path (D-27):** the popup never waits for the disk. On Enter it hands the capture to the main process, waits for the IPC acknowledgement, and hides; the main process owns the pending capture until the write is confirmed, and the draft (CAP-08) is cleared only then. **Accepted risk:** if the main process itself crashes between the acknowledgement and the write, the fallback is the last persisted draft, which can lag the final keystrokes by one draft-save debounce (~300 ms).

### Why cold start doesn't matter (and reliability does)
- Electron cold start is roughly 1–1.5 s (vs ~0.4 s for Tauri in one 2026 benchmark). It only happens at Windows login (background), first launch after install, after an update restart (controlled, APP-06), or after a crash/quit.
- **If Flint isn't running, the global hotkey does nothing at all** (in any framework). So the real requirement is that Flint is **never not running**: autostart, hide-not-destroy, no accidental quit, silent crash recovery, safe update timing.

### Rules that make it fast
1. **Pre-warmed popup** (CAP-10): created at startup, rendered while hidden; the hotkey only calls show + focus.
2. **Keep the popup tiny**: its own small bundle (input, chips, autocomplete, paste handling). A lighter popup also recovers faster when Windows has paged out an app that has been idle for hours, which matters more for Electron because it has more memory to page back in.
3. **No blank/white flash**: both Electron (hidden window shown blank in some cases) and WebView2 have known issues here. Mitigations: keep the popup rendered while hidden, give every window a `backgroundColor` matching the current theme, and verify the popup's renderer isn't throttled in a way that delays its first frame after `show()` (tune `backgroundThrottling` for the popup and verify in the spike).
4. **Open on the active monitor** (CAP-09): position using the cursor's display before showing.
5. **Only main window + popup alive at idle**; mini mode on demand (then kept hidden).
6. **Rendering discipline:** memoized rows, update only changed rows, animate with transforms/opacity only, virtualize very long lists (Proposed: above a few hundred rows).
7. **Main-process work never blocks the UI**: file I/O is async; parsing large files off the hot path.
8. **Updates never mid-session** (applies once APP-06 auto-update is added; v1 users update by running a new installer).

---

## 5. Feature implementation notes

### Global hotkeys (CAP-01, CAP-07, APP-08)
- Register with Electron's global shortcut API. Registration fails if another app owns the combination → show "already in use, choose another" (conflict detection).
- Must work over full-screen apps such as a full-screen Teams call (verify in spike).

### Capture-selection (CAP-07)
1. Save the current clipboard contents (all formats Flint can restore).
2. **Wait for the user to release the hotkey's modifier keys** (or send key-ups first); otherwise the simulated Ctrl+C becomes e.g. Ctrl+Shift+C in the target app.
3. Send Ctrl+C to the foreground window via Win32 `SendInput` (through FFI).
4. Poll the clipboard briefly (≤ ~150 ms) for new content.
5. Open the popup prefilled; apply CAP-06 paste rules.
6. **Restore the original clipboard.**
- **Elevated windows:** Windows (UIPI) blocks simulated input into higher-integrity (admin) windows when Flint isn't elevated, e.g. an admin PowerShell. Detect the failure (no new clipboard content / elevated foreground process) and open the popup empty with a hint (CAP-07).

### Notifications with actions (REM-05)
- Use Electron's `Notification` with custom **`toastXml`**. In Electron, Windows toast buttons must use `activationType="protocol"` with an `arguments` URI pointing to a custom protocol registered for the app (e.g. `flint://reminder/done?id=k3f9`, `…/snooze?id=…`, `…/open?id=…`).
- Register the `flint://` protocol (development builds use `flint-dev://`, D-33); protocol activation starts a second process, so route it to the running instance through the single-instance lock. This path can also bring Flint up if it isn't running.
- **Set an AppUserModelID** (and ensure the installer creates the Start Menu shortcut carrying it). Without it Windows won't show the toasts. **D-33:** `com.davitkhachaturovi.flint` for the installed app, never changed once installed (upgrades, the start-with-Windows entry and Windows' notification settings are keyed by it); development builds use `com.davitkhachaturovi.flint.dev` with their own "Flint (development)" Start Menu shortcut, and the R-1 laptop benchmark uses `com.davitkhachaturovi.flint.bench`. Each build has its own app data, single-instance lock and toast scheme, so a development build never takes over an installed Flint (`apps/desktop/src/main/identity.ts`).
- Electron's built-in activation callbacks only work while the process is alive and toasts have historically lost interactivity in Action Center; the protocol approach avoids this. **Verify Action Center behaviour in the spike**, and check newer Electron notification activation APIs at that time.

### Reminder scheduler (REM-01, REM-07)
- Lives in the main process. Do **not** rely on one long `setTimeout` per reminder (sleep/clock changes break them): use a periodic tick (Proposed: every 15–30 s) comparing wall-clock time with due reminders, plus a re-check on system resume (power monitor) and at launch.
- Reminders due while the PC slept or Flint wasn't running → missed-reminder flow (REM-07).
- **Built in M4 (D-64):** `apps/desktop/src/main/reminder-service.ts` re-checks at the next due time but at least every 30 s, on resume (`powerMonitor`) and 200 ms after any list change; the pure rules (due, missed after 2 minutes, one summary for more than 3 missed) are in `reminders.ts`. What was shown is kept per task and reminder value in `reminders-state.json`, so a reminder shows once, also across restarts, and again only when its time changes (snooze, an edit).
- **Focus Assist** suppresses toasts silently; offer Flint's own sound and an in-app alert (REM-06).
- **The day change (D-107):** acted on at local midnight (a timer to the next midnight, re-armed), with a once-a-minute check and `powerMonitor` resume as fallbacks: done pins lose their pin (D-85), then the main window reads every view again (Today's rollover card and reminders).

### Clipboard and paste (CAP-06, TASK-09)
- Images from the clipboard → saved to `attachments/` → relative link.
- Detection heuristics for stack traces/JSON/code: valid JSON parse, typical stack-frame line patterns (`at …(file:line)`, `File "…", line N`, `Exception`, `Traceback`), indentation/brace density. Detected content → fenced code block, not split into tasks.

### Storage (04)
- All file I/O in the main process via the core format package; atomic writes (DATA-01) with retry for transient Windows file locks.
- Before writing, re-read the file; if it changed on disk, re-parse it and re-apply the pending operations by task ID (core operations are keyed by ID and can be replayed), so external writes (CLI, Claude, an editor) are never overwritten (04 §6, D-29).
- File watcher ignores Flint's own writes and preserves cursor/selection on reload (DATA-06).

### Auto-update (APP-06) — Later (D-19)
- Not in v1: Flint is distributed manually as an `.exe`. Users update by running the newer installer over the old one (same per-user install location; settings and data are kept).
- When added later: electron-updater with the NSIS target and a generic feed (e.g. a static Azure Storage endpoint published by the pipeline); check and download in the background; **install on quit, or at idle**, never during active use.

### Window state (APP-05)
- Persist bounds per **monitor setup** (keyed by the set of connected displays and their bounds); if a saved position is off-screen, fall back to the active monitor.

---

## 6. Build, signing, and distribution

- **Installer:** NSIS via electron-builder, Windows x64, per-user install (no admin rights needed). Installing over an existing version upgrades it in place. One-click: installs to `%LOCALAPPDATA%\Programs\flint` and creates the Start Menu shortcut "Flint" carrying the AppUserModelID `com.davitkhachaturovi.flint` (D-33). Built with `npm run dist` in `apps/desktop` (`electron-builder.yml`, output `dist-installer/`), which fails if the packaged exe's fuses are not as configured (`scripts/check-fuses.mjs`, D-34).
- **Uninstall (D-32):** "Flint" in Windows Settings → Apps, or `Uninstall Flint.exe` in the install folder. It closes Flint and removes the program folder, the Start Menu shortcut, the uninstall entry, and what Flint registered itself at runtime: the `flint://` handler (only if it still points at this installation), the start-with-Windows entry, and the installer copy electron-builder keeps for a future updater (`%LOCALAPPDATA%\flint-updater`, about 120 MB). It **keeps** the Flint folder (the user's notes, `%USERPROFILE%\Flint` by default, never touched), the settings and app state in `%APPDATA%\Flint`, and the logs in `%LOCALAPPDATA%\Flint\logs`, so reinstalling picks up where the user left off. Windows' own per-app notification settings for `com.davitkhachaturovi.flint` also stay. Installing over an existing version runs the old uninstaller in update mode, which keeps `flint://` and start-with-Windows. The cleanup lives in `apps/desktop/resources/installer.nsh`.
- **Distribution (v1):** internal tool; the `.exe` is handed to coworkers manually (D-19).
- **Code signing: not in v1 (D-19).** Azure Artifact Signing (formerly Trusted Signing) only issues public-trust certificates to organizations in a fixed list of regions that does not include Georgia, so the alternative is an OV certificate from a commercial CA: organization validation by the CA (documents and verification, typically days), a private key that must live on a hardware token or cloud HSM, and a yearly fee. Even signed, a new certificate has to build SmartScreen reputation. For an internal tool this is not worth it yet.
- **What unsigned means for users:** on first run of a downloaded installer, Windows SmartScreen shows "Windows protected your PC"; the user clicks **More info → Run anyway**. Mention this in the hand-out message. Toast notifications still work unsigned (they depend on the AppUserModelID and the Start Menu shortcut the installer creates, not on a signature).
- **CI/CD:** Azure DevOps pipeline on a Windows agent: install → npm audit and release-age check (D-30) → embedded-Node check → lint → typecheck → unit tests → build → e2e smoke test (app starts, capture reaches the main process, zero network requests: D-31) → publish the installer as a pipeline artifact. **D-107:** the end-to-end tests run on a fixed clock (`FLINT_E2E_CLOCK_OFFSET`, test mode only: the main process and every window read a `Date` shifted to the test's moment, still running), so they never depend on when CI runs; `day-change.spec.ts` crosses midnight on purpose. Signing and an update feed slot in later.
- **Logs** stay local (`%LOCALAPPDATA%\Flint\logs`); nothing is uploaded (APP-09).

---

## 7. Future platforms and integrations

- **macOS and ARM:** later. Electron ships the same Chromium everywhere, so rendering stays consistent across platforms. Platform-specific parts (hotkeys, notifications, capture-selection, tray) sit behind the Platform interface.
- **other apps:** integrate through APIs and the shared `packages/core` TypeScript packages, not by coupling runtimes.
- **Switching shells (e.g. to Tauri)** stays possible: only `apps/desktop/main` + `preload` would be rewritten; the React UI, CodeMirror editor, and core packages carry over.
- **CLI** (Later): a small Node-based `flint` (name: Q-07) reusing `packages/core`; packaged as a single executable so users don't need Node installed (Proposed).
