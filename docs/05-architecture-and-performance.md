# 05 — Architecture & Performance

## 1. Stack decision

**Electron + React + TypeScript + Vite**, Windows x64 first. Full rationale and alternatives are in the [Decision Log](07-decision-log.md) (D-04); the short version:

- Flint will be built and maintained mainly by **Claude (Claude Code)** with no dedicated developers. TypeScript is where Claude is most productive (most training examples, fastest iteration, no compile/borrow-checker loops), and **far more engineers can read and fix TypeScript** than Rust if Claude gets stuck.
- Every risky feature has a **proven, documented path** in Electron (actionable toasts, global hotkeys, tray, auto-update).
- What users actually *feel* (popup speed, typing, scrolling, animation) is the same as Tauri: on Windows, Tauri's WebView2 is the same Chromium engine. Tauri's real wins (≈40 MB vs 150+ MB RAM, ~8–10 MB vs ~100 MB installer, faster cold start) were judged not worth the maintenance risk. 150–200 MB idle RAM is acceptable.
- JS/TS end to end also eases future integrations (the CLI and other tools reuse `packages/core`).

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
      sync/                  ← Google Drive sync without Google or Electron: the three-way merges, the conflict callout, the sync engine against a `Drive` interface, a fake Drive for tests (SYNC-01, D-161)
      links/                 ← link patterns (NOTE-07), moved from the desktop app so the phone shares them (D-165)
    editor/                  ← D-165: the CodeMirror note editor and its live preview, moved out of the desktop renderer; DOM only, no Electron or React Native (used by the desktop renderer and the phone's editor web view)
  apps/
    android/                 ← D-165: Flint for Android, React Native with Expo (§8)
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
- **The UI reaches the OS only through a narrow, typed `Platform` interface** exposed by the preload script: windows (show/hide/position), notifications, global hotkeys, clipboard, file operations, autostart, updates. This keeps a future switch to another shell (e.g. Tauri) limited to rewriting this layer, and keeps future integrations simple.
- **Security defaults:** `contextIsolation: true`, `nodeIntegration: false`, sandboxed renderers, no remote content loaded, strict Content-Security-Policy. **D-34:** the renderers load from an in-app scheme, `app://flint/…` (standard and secure, served only from the built renderer folder, not registered with Windows), never `file://`; the network guard allows no `file:` requests. The packaged `Flint.exe` has its Electron fuses set: not usable as a Node runtime (`ELECTRON_RUN_AS_NODE` ignored), no `NODE_OPTIONS` and no inspector flags, loads only its own `app.asar` with embedded integrity validation, cookie encryption on, no extra `file://` privileges. **Task bodies (TASK-05, D-49):** images in the Flint folder load from `app://media/…` (the same in-app scheme, another host): only raster image files (PNG, JPEG, GIF, WebP, BMP; not SVG) inside the Flint folder, with the same path checks as the renderer files; the main window's CSP allows `img-src app://media` and nothing remote. **D-84:** videos (MP4, WebM, MOV) load the same way, streamed with range requests; a large file linked outside the Flint folder (MEDIA-03) loads from `app://linked/…`, which serves only image and video types at an absolute path, nothing else. Opening an attachment in its default app (`shell.openPath`) is allowed for media and documents only; programs and scripts are never opened, and any other type asks first.

---

## 3. Process and window model

- **Main process** owns: storage (read/parse/write), the file watcher, the reminder scheduler, global hotkeys, the tray, notifications, auto-update (APP-06, D-136), single-instance lock, and Google Drive sync (SYNC-01, D-161).
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
| Enter in popup → capture durably on disk | **< 100 ms at p95** (D-27); recorded on every run, not failing a test (D-137: it is the disk's flush time) |
| Switching lists, opening a note | < 100 ms (Proposed); a 1,000-task list takes longer (a known issue, D-137) |
| Ctrl+K results update per keystroke | < 50 ms for typical data (Proposed) |
| Idle CPU (tray, nothing happening) | ~0% (Proposed) |
| Memory after start (private, all processes) | ~300–350 MB (D-137; was "~150–200 MB", D-04, which left out the GPU process) |

**Test conditions:** an average laptop (not a developer workstation) **with a Teams call running**, including a full-screen Teams call. **Checked on every run (D-137):** `e2e/performance.spec.ts` measures each budget on the development build, windows off-screen, and fails only past its hard limit (keypress two frames; Enter → popup hidden and focus back 50 ms; switching a list and opening a note 200 ms; Ctrl+K per keystroke and the search 100 ms; idle CPU 2 %; memory after start 400 MB); Enter → durably on disk is recorded only. On CI a check listed in its `ADVISORY_ON_CI` only logs (none so far); locally every check is strict. The numbers go to `apps/desktop/test-results/performance.md` and 06's Measurements.

**Capture save path (D-27):** the popup never waits for the disk. On Enter it hands the capture to the main process, waits for the IPC acknowledgement, and hides; the main process owns the pending capture until the write is confirmed, and the draft (CAP-08) is cleared only then. **Accepted risk:** if the main process itself crashes between the acknowledgement and the write, the fallback is the last persisted draft, which can lag the final keystrokes by one draft-save debounce (~300 ms).

### Why cold start doesn't matter (and reliability does)
- Electron cold start is roughly 1–1.5 s (vs ~0.4 s for Tauri in one 2026 benchmark). It only happens at Windows login (background), first launch after install, after an update restart (controlled, APP-06), or after a crash/quit.
- **If Flint isn't running, the global hotkey does nothing at all** (in any framework). So the real requirement is that Flint is **never not running**: autostart, hide-not-destroy, no accidental quit, silent crash recovery, safe update timing.

### Rules that make it fast
1. **Pre-warmed popup** (CAP-10): created at startup, rendered while hidden; the hotkey only calls show + focus.
2. **Keep the popup tiny**: its own small bundle (input, chips, autocomplete, paste handling). A lighter popup also recovers faster when Windows has paged out an app that has been idle for hours, which matters more for Electron because it has more memory to page back in.
3. **No blank/white flash**: both Electron (hidden window shown blank in some cases) and WebView2 have known issues here. Mitigations: keep the popup rendered while hidden, give every window a `backgroundColor` matching the current theme, and verify the popup's renderer isn't throttled in a way that delays its first frame after `show()` (tune `backgroundThrottling` for the popup and verify in the spike).
4. **Open on the active monitor** (CAP-09): position using the cursor's display before showing.
5. **Only main window + popup alive at idle**; mini mode on demand (then kept hidden). **D-177 (1.7.0):** with **Start collapsed with Flint** on (the default), mini is created at startup for its edge tab (MINI-04), **after** the capture popup is pre-warmed, so the popup's readiness doesn't wait for it; off, mini is on demand as before.
6. **Rendering discipline:** memoized rows, update only changed rows, animate with transforms/opacity only, virtualize very long lists (Proposed: above a few hundred rows).
7. **Main-process work never blocks the UI**: file I/O is async; parsing large files off the hot path.
8. **A quit loses nothing and never sticks (D-138):** it waits, at most 3 s, for what is still being written (a capture just handed over, the draft, a list change, the pins and Today's order); an error nothing caught while quitting is logged and the quit goes on.
9. **Updates never mid-session** (APP-06, D-136): downloaded in the background, installed when Flint quits or on the user's Restart now; the first check waits 30 s after start, off the startup path.

---

## 5. Feature implementation notes

### The Focus timer (FOCUS-01, FOCUS-04, D-170)
- The **main process** owns the timer, as reminders' schedule: the mode, the moment the session ends (or the time left while paused) and the day's session number, saved in `focus-state.json` (app data) on every change. The windows (main, mini) only show it, from one broadcast; they compute the digits from the end time each frame they draw, so they never drift and never disagree.
- One main-process timeout per session end (and per heads-up), set again after resume from sleep (`powerMonitor`) and on start. A session whose end passed while Flint was closed or asleep is closed quietly: the next mode is shown ready, no sound, no toast.
- The alarm sound plays in the main window's renderer (hidden windows still play audio), from the bundled sound files; the toast is an ordinary Windows toast (no reminder scenario).
- The sprint (`.flint/focus.json`) is read and written by `packages/core` (a pure module with its tests) through the workspace, as `today.json`. The timer reads the clock the end-to-end tests fix (`FLINT_E2E_CLOCK_OFFSET`, `fixClockForTests`, D-107), so its tests run on the test clock and wait for the state they check (D-156), never for 25 real minutes (a test sets short durations).

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
- **Windows' clipboard history (NAV-08, D-127):** `main/clipboard-history.ts` calls its WinRT interfaces through koffi (method positions from Windows' own metadata, only reads ever called), behind `main/clipboard-guard.ts`'s crash marker; read-only, text first. **D-128:** the texts are read all at once (about 40 ms for 25 items, the main thread busy at most about 5–7 ms at a time); main keeps the last items and reads again only on a new clipboard sequence number, while the window is in front; the section polls every second while it is on screen and only it renders; an item goes into a field as a synthetic paste (`renderer/main-window/clipboard-paste.ts`). **D-129:** pictures are read as BMP and decoded by `shared/bmp.ts` (Electron's `nativeImage` can't open BMP), thumbnails cached by item id in main; the writes (Delete, Clear all, Copy as Win+V's pick) go through the same module and the crash marker; Undo's copy of a deleted item lives in main's memory only, for 10 s.
- Images from the clipboard → saved to `attachments/` → relative link.
- Detection heuristics for stack traces/JSON/code: valid JSON parse, typical stack-frame line patterns (`at …(file:line)`, `File "…", line N`, `Exception`, `Traceback`), indentation/brace density. Detected content → fenced code block, not split into tasks.

### Storage (04)
- All file I/O in the main process via the core format package; atomic writes (DATA-01) with retry for transient Windows file locks.
- Before writing, re-read the file; if it changed on disk, re-parse it and re-apply the pending operations by task ID (core operations are keyed by ID and can be replayed), so external writes (CLI, Claude, an editor) are never overwritten (04 §6, D-29).
- File watcher ignores Flint's own writes and preserves cursor/selection on reload (DATA-06).

### Auto-update (APP-06, D-136)
- **electron-updater 6.8** with the NSIS target and the **GitHub provider** (`publish` in `electron-builder.yml`: `DavitKhachaturovi/flint`, public, so no token in the app). `src/main/updates.ts` (`UpdateService`) owns it: `autoDownload` and `autoInstallOnAppQuit` on, no pre-releases, no downgrades; checks 30 s after start, every 4 hours, and on `powerMonitor` resume when a check is due (Settings' switch `checkForUpdates`, on by default, stops the automatic checks); Restart now is `quitAndInstall(silent, run after)`, through the app's normal quit. Only the installed build creates it (`BUILD === 'installed'`); development and benchmark builds have none; test runs get a fake (`testUpdater`) whose events a test emits (`e2e/updates.spec.ts`).
- **Network (APP-09):** Flint's guard (`blockNetwork`) blocks every request except local content; in the installed build it lets through HTTPS to GitHub's release hosts (`UPDATE_HOSTS`: github.com, api.github.com and the release-asset hosts) and only from electron-updater's own session (`electron-updater` partition). **D-161:** while Google Drive is connected or a sign-in is under way, also HTTPS to `SYNC_HOSTS` from sync's own session (`sync` partition; Google Drive sync below). No other session, page or host is reachable. **D-151:** Give to Claude (TASK-18) is no request: main hands Windows a `claude://code/new` link it builds itself from a prompt and a folder (`shell.openExternal`), and opens nothing else that way.
- **Integrity, unsigned (D-19, D-135):** `win.verifyUpdateCodeSignature: false` (there is no publisher name to check; electron-builder 28 will refuse a missing name unless said explicitly); the download comes over HTTPS and must match the SHA-512 in the release's `latest.yml`. That catches a damaged download, not a compromised GitHub account, so the account's 2FA and the tag ruleset are the trust boundary. Follow-ups: **signed update manifests** (Ed25519, electron-updater 7, once it is stable) and code signing.
- **What updates leave behind:** electron-updater keeps the downloaded installer in `%LOCALAPPDATA%\flint-updater` (removed by the uninstaller, D-32).

### Google Drive sync (SYNC-01, D-161)
- **Split:** `packages/core/src/sync/` holds everything that decides: the task-list and text merges (04 §7), the conflict callout, and the **sync engine**, which compares this PC's synced files, their merge bases and Drive's listing and plans uploads, downloads, merges, deletes and bookkeeping writes against two interfaces: `Drive` (list the folder, read and write a file with a revision check, trash, the `.flint-sync` JSON) and `LocalSide` (read, write and trash list files and attachments through the workspace). A fake Drive (`fake-drive.ts`, in memory, with clocks, revisions, quotas and failures to inject) runs the engine in unit tests, two simulated PCs included. `apps/desktop/src/main/sync/` holds the Google parts: OAuth (PKCE, the loopback listener), the token store (`safeStorage`), the Drive REST client, the `SyncService` that schedules runs and reports status over IPC, and the bridge to the workspace.
- **Writes go through the workspace** like any other edit (atomic, re-read before write, D-29), so the file watcher, open views and undo see a synced change as an external edit (DATA-06): an open note keeps its cursor. A merged file is written only if it differs.
- **OAuth for desktop apps:** the authorization request opens in the default browser (`shell.openExternal`, `accounts.google.com`, never inside Flint), with PKCE (S256), `state`, `access_type=offline` and the one scope `https://www.googleapis.com/auth/drive.file`; the redirect goes to `http://127.0.0.1:<random port>/` served by a listener that exists only while a sign-in is under way (2 minutes at most) and answers with a small "You can close this tab and return to Flint" page. The code is exchanged at `oauth2.googleapis.com/token` with the client ID, **the client's secret** and the verifier: Google's endpoint refuses a desktop client's exchange without the secret, PKCE or not (found on Davit's first sign-in, 10 Nov 2026, although Google's page calls it optional). A desktop app can't keep it secret (Google says so) and it opens nothing on its own: it only names Flint to Google, and only a user's own consent gives access, to their own files Flint made. It is **injected at build time, never in the repository** (`__FLINT_GOOGLE_CLIENT_SECRET__`, `electron.vite.config.ts`): release builds from the repository secret `GOOGLE_CLIENT_SECRET` (`release.yml` fails without it), local builds from the git-ignored `apps/desktop/.env.local` (`FLINT_GOOGLE_CLIENT_SECRET=…`); a build without it says "Not set up in this build". The account's e-mail comes from Drive's `about.get` (`user.emailAddress`), so no extra scope. The refresh token is stored with `safeStorage`; access tokens live in memory only. Disconnect revokes the token (`oauth2.googleapis.com/revoke`).
- **The client ID** is committed in `apps/desktop/src/main/sync/google.ts` (public by design for desktop clients, D-161 Q7); the secret is not (above).
- **Builds:** the installed build syncs with `My Drive › Flint`, the development build with `My Drive › Flint (development)` (its own identity and app data, D-33), connected separately; test runs only with the fake Drive (`FLINT_E2E`: the sign-in and Drive are replaced by an in-process fake that the end-to-end hooks drive), so the network test still allows no endpoint; the benchmark build has no sync.
- **Network (APP-09):** Drive and token requests go only through sync's own session (`session.fromPartition('sync')`, `ses.fetch`), HTTPS, to `SYNC_HOSTS`: `oauth2.googleapis.com` and `www.googleapis.com` (the Drive API and its upload endpoint). The guard lets them through only from that session and only while Drive is connected or a sign-in is under way; every other session, page and host stays blocked. Opening Drive in the browser (Open in Drive, Restore it in Drive) is `shell.openExternal` of an `https://drive.google.com/…` link Flint builds itself, not a request.
- **Drive calls:** `files.list` in the folder (paged, `fields` limited to ID, name, `appProperties`, `md5Checksum`, `size`, `headRevisionId`, `modifiedTime`, `trashed`), `files.get?alt=media`, multipart upload for files up to 5 MB and resumable upload above (attachments, resumed after a failure), `files.update` with the revision checked before writing, `files.update {trashed: true}` for deletes. Errors: 401 refreshes the token once, then "sign in again"; 403 `storageQuotaExceeded` is "Drive is full"; 404 on the folder or a trashed folder pauses (02 SYNC-01); 429 and 5xx back off exponentially (from 2 s, at most the 3-minute cycle).
- **When:** 5 s after the last local change, every 3 minutes, on `powerMonitor` resume and when the network comes back, and on Sync now; one run at a time (a request during a run queues one more). A run compares checksums first, so an idle run is one listing request.
- **Budgets:** sync never blocks the UI or the capture path (rule 7); a run's parsing and merging happen in the main process off the hot path and yield between files; reading Drive's listing and merging an unchanged folder of 200 files stays under 50 ms of main-thread time (Proposed).

### Window state (APP-05)
- Persist bounds per **monitor setup** (keyed by the set of connected displays and their bounds); if a saved position is off-screen, fall back to the active monitor.

---

## 6. Build, signing, and distribution

- **Installer:** NSIS via electron-builder, Windows x64, per-user install (no admin rights needed). Installing over an existing version upgrades it in place. One-click: installs to `%LOCALAPPDATA%\Programs\flint` and creates the Start Menu shortcut "Flint" carrying the AppUserModelID `com.davitkhachaturovi.flint` (D-33). Built with `npm run dist` in `apps/desktop` (`electron-builder.yml`, output `dist-installer/`), which fails if the packaged exe's fuses are not as configured (`scripts/check-fuses.mjs`, D-34).
- **Uninstall (D-32):** "Flint" in Windows Settings → Apps, or `Uninstall Flint.exe` in the install folder. It closes Flint and removes the program folder, the Start Menu shortcut, the uninstall entry, and what Flint registered itself at runtime: the `flint://` handler (only if it still points at this installation), the start-with-Windows entry, and the installer copy electron-builder keeps for a future updater (`%LOCALAPPDATA%\flint-updater`, about 120 MB). It **keeps** the Flint folder (the user's notes, `%USERPROFILE%\Flint` by default, never touched), the settings and app state in `%APPDATA%\Flint`, and the logs in `%LOCALAPPDATA%\Flint\logs`, so reinstalling picks up where the user left off. Windows' own per-app notification settings for `com.davitkhachaturovi.flint` also stay. Installing over an existing version runs the old uninstaller in update mode, which keeps `flint://` and start-with-Windows. The cleanup lives in `apps/desktop/resources/installer.nsh`.
- **Distribution (D-135, D-136):** Flint is open source (MIT) on GitHub, `DavitKhachaturovi/flint`; the installer (`Flint-Setup-<version>.exe`), its `.blockmap` and `latest.yml` are published on GitHub Releases from 1.0.0, and installed copies update themselves (APP-06). Builds before it (0.9.x) are installed by hand.
- **Code signing: not yet (D-19, D-135).** Planned: the SignPath Foundation (free for open-source projects) or a Certum open-source certificate. Azure Artifact Signing (formerly Trusted Signing) only issues public-trust certificates to organizations in a fixed list of regions that does not include Georgia, so the alternative is an OV certificate from a commercial CA: organization validation by the CA (documents and verification, typically days), a private key that must live on a hardware token or cloud HSM, and a yearly fee. Even signed, a new certificate has to build SmartScreen reputation.
- **What unsigned means for users:** on first run of a downloaded installer, Windows SmartScreen shows "Windows protected your PC"; the user clicks **More info → Run anyway**. The release notes say so. Toast notifications still work unsigned (they depend on the AppUserModelID and the Start Menu shortcut the installer creates, not on a signature).
- **CI/CD (D-136): GitHub Actions** on `windows-latest`. `ci.yml` runs on pushes to `next` and on pull requests (D-150: once per commit; `main` is fast-forwarded to `next`'s green commit): Node from `.node-version`, `npm ci` with `.npmrc`'s rules (engine-strict, the 7-day release age), npm audit (high/critical fail) and the release-age check (D-30), the embedded-Node check, lint, format, typecheck, unit tests (10,000 fuzz runs); and the end-to-end tests (zero network requests: D-31), built and split across four parallel runners (`--shard`, D-145), each failed shard keeping its `test-results/`. `release.yml` runs on a tag `v*`: it checks that the tag is the app's version and that `docs/whats-new.md` has its section (`scripts/release-notes.mjs`) and that CI passed on the tagged commit (the release gate, D-145; it doesn't run the tests again), runs the audit and release-age checks, builds the installer and uploads it with its `.blockmap` and `latest.yml` to a draft release (`npm run release`, electron-builder `--publish always`, the workflow's `GITHUB_TOKEN` with `contents: write` for that job only), then publishes the release with the What's new section and the SmartScreen note as its text. **D-141:** `fuzz.yml` runs `npm run fuzz` (every fast-check property, core's and the note editor's randomised editing, in rounds for a time budget, each round's random seed printed) nightly at 02:00 Tbilisi and on demand (`workflow_dispatch`, a minutes input), with a read-only token; a failed round prints the command that repeats it. Actions are pinned by commit SHA; checkout keeps no credentials. Local installers (`npm run dist`) never publish. **D-107:** the end-to-end tests run on a fixed clock (`FLINT_E2E_CLOCK_OFFSET`, test mode only: the main process and every window read a `Date` shifted to the test's moment, still running), so they never depend on when CI runs; `day-change.spec.ts` crosses midnight on purpose. Signing slots in later.
- **Logs** stay local (`%LOCALAPPDATA%\Flint\logs`); nothing is uploaded (APP-09).
- **The website (WEB-01, D-162):** `site/` is published by `.github/workflows/pages.yml` (GitHub Pages, source "GitHub Actions") on pushes to `next` or `main` that touch `site/` (or, since D-184, the app's version and `docs/release-notes.md`: the workflow writes the hero's "Latest release" line with `scripts/site-release.mjs` before uploading) (Davit, 10 Nov 2026: the site may go live ahead of the release it describes; the app still releases from `main` only, D-145); the `github-pages` environment allows both branches. The custom domain `flintnotes.app` comes from `site/CNAME` and the DNS at the registrar (GoDaddy): four A and four AAAA records for the apex pointing at GitHub Pages, `www` a CNAME to `davitkhachaturovi.github.io`; HTTPS enforced (`.app` is HTTPS-only); the domain verified for the GitHub account (a TXT record) so no other repository can claim it, and in Google Search Console (a TXT record) as the OAuth consent screen's authorised domain.

---

## 7. Future platforms and integrations

- **macOS and ARM:** later. Electron ships the same Chromium everywhere, so rendering stays consistent across platforms. Platform-specific parts (hotkeys, notifications, capture-selection, tray) sit behind the Platform interface.
- **Other apps:** integrate through the CLI, APIs and the shared `packages/core` TypeScript packages, not by coupling runtimes.
- **Switching shells (e.g. to Tauri)** stays possible: only `apps/desktop/main` + `preload` would be rewritten; the React UI, CodeMirror editor, and core packages carry over.
- **CLI** (Later): a small Node-based `flint` (name: Q-07, Proposed) reusing `packages/core`; packaged as a single executable so users don't need Node installed (Proposed).
- **Phones:** Android first (§8, D-165); iPhone later from the same React Native app (its own sign-in, notifications and storage parts).

---

## 8. Flint for Android (D-165, Proposed unless D-165 records it)

- **Stack:** React Native (New Architecture) with Expo, TypeScript strict, in `apps/android`; Expo's prebuild generates the native project (not committed, Proposed), so native settings live in `app.json` and config plugins. Dependencies follow D-30 (exact pins, 7-day release age, audit in CI).
- **Shared code:** `packages/core` unchanged (the format, shorthand, time, model, undo, sync engine and merges; it already has no Node APIs, so it runs on Hermes); `packages/editor` (the CodeMirror live preview) runs in the editor's web view.
- **The editor:** an Expo DOM component holding CodeMirror 6 in Android's WebView, kept warm (one instance, reused across notes) so opening a note costs no web-view start; the text goes in and out over the component's message bridge (whole text on open, changes as CodeMirror transactions' summaries, Proposed); the formatting bar is native and calls the editor's commands. The web view loads only the bundled editor (no remote content, a strict CSP) and has no access to files or network.
- **Storage:** the app's private files directory through Expo's file system, atomic writes (04 §8). The workspace logic that the desktop's main process does today (read, parse, write, Trash, `.flint/` bookkeeping) moves into core where it is platform-neutral, with a small file-system adapter per app (05 §2's rule).
- **Reminders:** each reminder an exact alarm (`AlarmManager.setExactAndAllowWhileIdle` through a native module; `SCHEDULE_EXACT_ALARM`, asked once with an explanation; denied, reminders fall back to inexact delivery and Settings says so); rescheduled on boot, on time-zone change and after a sync changes reminders; notifications with actions on a "Reminders" channel (high importance). Which module (Expo Notifications or a small Kotlin module) is settled by R-A3.
- **Sync:** the same `SyncEngine` with an Android `LocalSide` over the private folder and a `Drive` client over `fetch`. **Sign-in:** Google's Android authorization API (Identity Services `AuthorizationClient`) for the `drive.file` scope, with Flint's **Android OAuth client** in the same Cloud project (app ID and the signing certificate's SHA-1; one for debug builds, one for release): access tokens come from Google Play services, silently after the first consent; no refresh token, client secret or browser round trip on the phone. Whether `drive.file` lets this client see files the desktop client created is R-A1. Background runs: WorkManager (Expo's background task), at least 15 minutes apart, network required.
- **Network (APP-09):** only Google's token and Drive hosts while connected, and GitHub's release listing for the update check. No analytics, crash reporting or ads; the network test's equivalent on Android is an end-to-end check that a session makes no other request (Proposed: through a fetch wrapper that refuses other hosts, like the desktop's guard).
- **Sharing to Flint and the app shortcut:** an intent filter for `ACTION_SEND` / `ACTION_SEND_MULTIPLE` (text, URLs, images, any file) opening the Save to Flint sheet; a static app shortcut "New task".
- **Builds and signing:** debug builds locally; release APKs signed with Flint's upload key (kept only in the repository secret and Davit's own backup, never in the repository; losing it means the app can't be updated in place). `versionName` from `apps/android/package.json`, `versionCode` increasing with every build (Proposed: major × 10000 + minor × 100 + patch). Tags `android-v<version>` run an Android release workflow that builds the APK and attaches it to its GitHub release, after CI passed on the commit (D-145's gate).
- **Tests:** core's tests as today; the app's logic with Jest; end to end with Maestro on an Android emulator in CI (Linux runners with KVM), on the fake Drive (an in-app fake as on the desktop, test builds only) and the fixed test clock (D-107); real devices for what an emulator can't judge (keyboards, alarms in Doze).
- **Budgets:** + to a focused capture field one frame after the sheet starts rising (the keyboard's own animation aside); save and close < 100 ms; a note opens in the frame its screen arrives (the warm editor); a list of 500 tasks scrolls at the display's rate (Proposed).
