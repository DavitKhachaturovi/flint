# Flint release notes

Detailed notes for every build handed out (D-64). Newest first. The app's What's new card shows the shorter, plain-language [`whats-new.md`](whats-new.md) instead (D-117).

## 1.7.0 (11 Nov 2026)

- **Mini mode collapses to the edge (MINI-04, D-177, D-178, mockup 16):** a **Collapse to the edge** button in mini's header (left of the pin; Reset size opens its place left of it) and **Ctrl+M** (also in a text field, before the Note editor's own Ctrl+M) tuck the card into the screen's side edge, leaving the app icon cut in half by the edge. Resting the mouse on it for 350 ms peeks: the card slides out level with the tab, 24 px from the edge, without taking the keyboard; leaving the card's place (the strip to the edge included) slides it back after 1 s. A click on the tab, a click into a peek, the hotkey, the tray or the palette opens it with the keyboard; it stays until collapsed. Pressing or dragging the tab never takes the keyboard from the app in front.
- **Placing the tab:** dragged along its edge it stays where it is let go; within 48 px of a corner spot (its top 120 px below the work area's top, its bottom 48 px above the work area's bottom) it snaps there; past the screen's middle it moves to the other edge. Remembered per monitor setup with the card's place (one position: the card comes out of the tab, growing down in the upper half of the screen and up in the lower). Collapsing an ordinary card puts the tab on its nearer edge, level with it; a card snapped into a corner goes to that corner's spot. A tab whose screen is gone goes to the primary screen.
- **The hotkey (Q4):** Ctrl+Alt+Space goes back where it came from: from the tab it opens mini and collapses it again; from hidden it opens and hides as before. × always hides.
- **On the tab:** a reminder waiting puts the bell's white dot on it with one pulse (the card never comes out by itself; with Show reminders in Flint: Always, it comes out without the keyboard until the reminder is dealt with); a running Focus session draws a thin line round the icon's visible half, white in focus and grey in a break. The tab is always on top whatever the pin says (the pin is the open card's) and hidden from screen sharing with the card.
- **Settings → Mini mode:** **Open on hover** (on; off, only a click opens) and **Start collapsed with Flint** (on: every start shows the tab, also after Windows starts, the one exception to the tray start; mini's window is made after the capture popup is ready). The walkthrough's mini step mentions the tab.
- **From the preview (D-179):** mini's reminder alert has an **X** in its top-right corner that takes the card away and leaves the task as it is (overdue); a click anywhere on a peeking card opens it, so it stays (its blank space and header included; a press on the header's drag region reaches main as `WM_NCLBUTTONDOWN`); mini's ⋯ (Focus settings…) shows only while the list tab shows Focus.
- **Today's "+N" menu (D-180):** each reminder in it looks as its row would: done struck through, overdue faded.
- **Reminders and the lock screen (D-182):** reminders that come due while the screen is locked (the PIN screen after a wake) wait for the unlock instead of showing as toasts Windows drops from the lock screen; at the unlock those still due show at once, "Missed reminder" when late. `ReminderService.lock`/`unlock` on Electron's `lock-screen`/`unlock-screen`; `heldStillDue` in `reminders.ts`.
- **Sync's log (D-181):** a run that runs again 5 s later now logs why (the note, list or bookkeeping file, the revision expected and found, the device that wrote it), to find why an idle PC synced every few seconds.
- **Sync on an idle PC (D-183):** with synced groups, every run applied them to the sidebar unchanged, the workspace announced it, and that asked for the next run 5 s later, so the sync animation played every few seconds for ever. Now a group is applied only when it differs from the one here, and the workspace announces a sync's groups only when the sidebar changed.
- **Under the hood:** at the edge mini's window is a strip along the edge, the work area's height, ending exactly at it, so the tab moves and the card comes out without the window moving (it moves only to change sides, hiding what it shows for those frames as a corner snap does). Main decides peek and slide-back from the cursor it already checks for click-through, as a pure state machine (`main/mini-edge.ts`); the geometry is pure too (`mini-place.ts`: the spots, the snap, the tab for a card, the card for a tab, the strip). A drag shows the spots of the tab's edge (the other edge's once it crosses).
- **Tests:** `mini-edge.test.ts` (the 350 ms wait, a press never peeking, Open on hover off, the 1 s slide-back, a reminder holding a peek, open staying open) and `mini-place.test.ts` (the spots, the snap, collapsing from a card and a corner-snapped card, the card's level, the strip); end to end in `mini.spec.ts`: collapsing from the header, the peek and its way back, a click and Ctrl+M, the hotkey both ways, Flint's start as the tab, dragging along and across with the spots and the snap, a reminder's dot and pulse, both settings.

## 1.6.0 (11 Nov 2026)

- **Focus (FOCUS-01, D-170, D-171, mockup 15):** a Pomodoro timer page under Inbox in the sidebar. The timer card has the modes Focus · Short break · Long break (25 / 5 / 15 minutes by default, a long break after every 4th focus session), large digits, Start / Pause / Resume and Skip, and a thin progress line. While a focus session runs the card inverts to white with dark digits; breaks and pauses stay dark; the page and the sidebar never change colour. Under the card: "#3" (today's session number) and the active task. The timer lives in the main process as the moment the session ends, saved in `focus-state.json`: hidden windows, sleep, restarts, updates and crashes lose nothing; a session that ended long ago (Flint closed, the PC asleep) is closed quietly.
- **The sprint (FOCUS-02):** **F** sends the selected tasks to Focus from any list (also the right-click menu, the multi-select bar and Ctrl+K), with a toast offering **Go to Focus**; F again, or **Remove from Focus**, takes them out. Nothing changes in the task's line: the sprint is `.flint/focus.json`. Rows show their home list; completing and editing work as in Today. The top open task is the active one; **Shift+F** (Focus on this), Alt+↑/↓ or a drag change it. Done tasks sink below the open ones (Check to bottom). The composer under the sprint adds to Inbox and to the sprint. The ⋯ menu: Clear finished, Reset counts, Remove all from Focus (only the sprint changes; undoable).
- **Estimates and counts (FOCUS-03):** each task shows "1/4", sessions done against its estimate; − and + around it (on hover or the selected row, or the keys − and +) change the estimate. Under the sprint: "2 of 7 sessions · finish at 15:40". Auto check tasks completes the active task when it reaches its estimate.
- **A session's end (FOCUS-04):** Flint's alarm sound (also under Do Not Disturb), an ordinary toast with **Start break** / **Start focus**, and the next mode waiting (or starting with Auto start). A finished focus session counts for the active task; Skip doesn't count. An optional heads-up toast before the end.
- **Focus settings (FOCUS-05):** the gear on the Focus page opens them over the page, their one place (D-176: Settings' Focus section, a duplicate, removed before the release). Timer lengths, auto start, long break interval, Auto check tasks, Check to bottom, the alarm sound (Nudge, Drop, Mallet or None, with Play, volume and repeat), the end-of-session toast and the heads-up. Drop and Mallet are new sounds made by `make-chime.mjs`, their hashes checked like the chime's.
- **Focus in mini mode (FOCUS-06):** mini's list picker starts with Inbox, then Focus. With Focus chosen, the list tab shows a compact timer (never inverted: white digits while focus runs, grey in a break), the sprint's rows with their counts and "Add to Focus…"; Shift+Space starts and pauses. While a session runs and another tab is in view, the tab reads "Focus 12:34". Mini's new ⋯ has Focus settings….
- **Today:** its "Focus · pinned" section is now **Pinned**.
- **Motion on Focus (D-173, Davit: none of its numbers or text moved):** the mode tabs' highlight glides; each changing digit of the time slides softly in; the button's label, "#N", the active task, "Session N today", the counts, the finish line and mini's tab time crossfade. Off under reduce-motion. The motion census has two more steps (a mode tab, a tick).
- **Switching to and from Focus (D-175, Davit, before the release):** the side panel followed the page chosen rather than the page shown, so on a wide screen it appeared or went on the page being left while the next one loaded, the column jumped, and only then did the new page fade in. It now changes in the same frame as the page. `focus.spec.ts` watches every frame of the switch for a panel on Focus or none on Inbox.
- **The side panel on Focus (D-172):** off on Focus by default, also on wide screens (Davit: on a 1080p screen it showed by itself, at the bottom); Ctrl+\ or the panel button shows it, remembered for Focus apart from the other pages; shown, its top is level with the timer card.
- **Keys and commands:** F, Shift+F, Shift+Space and − / + on the Focus page; Ctrl+K has Go to Focus, Start focus / Pause / Resume, Skip, the modes, Focus settings, Clear finished, Reset counts and Remove all from Focus. All in the `?` cheat sheet and Settings → Keyboard shortcuts.
- **Tests:** core `focus.test.ts` (the sprint file's round trip and tolerance, the timer's state machine, the plan); `workspace.focus.test.ts`; `focus-timer.test.ts` (the service, restarts, the toast XML and its activation); the sounds' hashes; end to end `focus.spec.ts` and six Focus steps in the motion census; `smoke.spec.ts` updated for the menu's Send to Focus, Settings' 14 sections and Pinned.

## 1.5.1 (11 Nov 2026)

- **The sidebar's clouds (SYNC-01, D-163):** synced lists, notes and groups no longer carry a cloud after their name (with everything synced, every row had one). Only an item with an unresolved sync conflict shows the cloud with "!", titled "1 sync conflict" (a group's header too, while one of its lists has one); it fades in when the conflict appears and goes after the run that sees it resolved. Which items sync stays in the header line, the sort menu's Show filter and the status popover.
- **The timeline (TODAY-03, D-163):** reminders too close to show apart at the rail's scale (the same time, or minutes apart) share one row at the earliest's time instead of pushing each other down the rail, where two at 14:00 ended up on 13:00 and 15:00. The row shows the next reminder if it is among them, else the earliest, with a "+N" badge; its menu lists the reminders behind the shown one (as many as the badge says, D-169) with their times and lists, and choosing one opens it. Dragging a row's reminder still changes its time; the others regroup around it.
- **Overdue on the timeline (TODAY-03, D-164):** a passed reminder whose task isn't done was struck through like a done one. It is now overdue: faded as a passed one, not struck, with the white overdue dot. Only a done task's reminder is struck through. **After the preview (D-167):** the rail grows so that reminders an hour apart always have rows of their own (only reminders under an hour apart share one); the now line never crosses a row (it crossed a row's text and read as a strike-through): where it would, it runs along the row's edge, above a row still to come and below a passed one (D-168), and a "+N" badge its time pill would cover moves to its left.
- **Long list names (TODAY-03, D-163):** a reminder card's list chip keeps the name on one line with an ellipsis and the full name on hover (it wrapped and spilled out of the chip); Overdue's and Captured today's list names shorten the same way, leaving the title room.
- **Tests:** `e2e/today.spec.ts` (new: the grouped row, the 16:00 row on its hour line, the +N menu, an overdue reminder faded and not struck through and a done one struck, reminders an hour apart on separate rows, the now line along a row's edge and "+N" clear of its pill, the chip on one line); `e2e/sync.spec.ts` checks that a synced row has no cloud and that a conflict marks its row until resolved.

## 1.5.0 (10 Nov 2026)

- **Google Drive sync (SYNC-01, D-161):** opt-in sync of chosen lists, notes and groups between PCs through the user's own Drive, as in mockup 13 (eight states). The local Flint folder stays the source of truth; Drive holds a visible `My Drive › Flint` folder of plain markdown (development builds `Flint (development)`), with sync's bookkeeping in `.flint-sync/` (groups, per-task created and last-touched times, linked files' PC and size, deletion records). No Flint server; Google access only to files Flint created (`drive.file`).
- **Setup and status:** Settings → Sync (Connect Google Drive; then the account with Sync now and Disconnect, What syncs, Chosen items with Choose…, Drive folder with Open in Drive, and the privacy note); the first-time question What should sync? (Only what I choose preselected); the status button left of the sort and + buttons (synced, syncing, offline, needs attention) with its popover (state, what syncs, conflicts, the problem and its action, Sync settings…, Sync now). Choose what syncs lists what is on this PC and what is in Drive but not here, grouped as the sidebar.
- **The sidebar:** clouds on synced lists, notes and groups; Show all / Synced only / Local only in the sort menu; "Sync with Google Drive" in the right-click menus (checked while it syncs; on a synced item it opens Stop syncing). Today shows everything on the PC. A synced list says "Synced with Google Drive · 2 min ago" under its title.
- **Merging (core):** task lists three-way per task by ID, across lists (a task moved on one PC and edited on another moves with the edit): done wins, values by the later change (clamped to Drive's clock), a title changed on both keeps the other in the body, the body merges as text, edited beats deleted. Notes merge as text; where both PCs changed the same lines, both versions are kept in a `> [!conflict]` callout, shown in Flint as a card with Use <PC>'s, Keep mine and Keep both (one undo step), a "1 conflict" chip in the note's header, a marker on task rows with a conflicted body, and in the popover. The callout says how many lines above are this PC's version, so the buttons are right on every PC. Inbox merges by its fixed ID; same-name lists stay separate ("Groceries 2"); colliding task IDs are re-IDed; new task IDs have 6 characters.
- **Stopping and deleting:** stop syncing on this PC (the question unticked by default; "Also remove from Drive" reads Stop syncing everywhere and moves it to Drive's trash); an item removed from Drive elsewhere stays here with "No longer synced: removed from Drive on another device"; a list deleted on another PC goes to this PC's Trash unless edited here.
- **Linked files (MEDIA-03):** never synced; their line keeps a crossed-out cloud with the explanation (on this PC: Copy into Flint to sync it; on another PC: which PC has it and its size, "1.8 GB · on DAVIT-LAPTOP").
- **When Drive goes wrong:** a renamed or moved folder is found by its ID; a trashed folder pauses sync (Restore it in Drive / Start a new folder); revoked access asks to sign in again; a full Drive syncs text first, then the smallest attachments, naming what didn't fit; offline retries by itself. Local data is never changed by any of these.
- **Sign-in and network (APP-09, docs/05 §5):** OAuth for desktop apps with PKCE in the default browser, the redirect to a loopback listener open only during sign-in, no client secret, the refresh token in safeStorage. Google's token and Drive hosts are allowed only from sync's own session and only while connected or signing in. The Privacy row says what syncs and where. Test runs use an in-process fake Drive: the network test still allows no endpoint.
- **Open in Google Drive:** a synced list's or note's right-click menu (and the palette) opens its own file in Drive in the browser; Settings → Sync's Open in Drive opens the folder.
- **The Google client:** Davit's Cloud project (docs/06 §6). Its ID is in the code; its secret is injected at build time, never in the repository (Google's token endpoint requires it for desktop clients, PKCE or not; it identifies Flint and grants nothing by itself). A failed sign-in shows Google's reason in Settings → Sync, and Flint comes back to the front after the browser.
- **Under the hood:** `packages/core/src/sync/` (line diff, text and task-list merges, the conflict callout, the engine against a `Drive` interface, a fake Drive): 42 unit tests including two simulated PCs, offline edits, deletes, stopping with and without removal, linked files, groups, a full Drive and a trashed folder, and a randomised "never loses a line" property. `apps/desktop/src/main/sync/` (sign-in, Drive client, service, workspace bridge). `e2e/sync.spec.ts`: 14 end-to-end tests on the fake Drive.

## 1.4.0 (10 Nov 2026)

- **Capture into mini mode's note (MINI-02, D-157):** a fourth global hotkey, **Ctrl+Alt+X** by default (rebindable in Settings → Capture & hotkeys with the usual conflict check; in the `?` cheat sheet and Keyboard shortcuts), copies the text selected in the app in front exactly as Ctrl+Shift+X does (the keys released first, a simulated Ctrl+C, the clipboard put back) and adds it to the end of the note mini's Note tab shows, as a paragraph of its own; code, JSON and stack traces come in as a code block. With no note yet, a quick note is made. A hidden mini opens on the Note tab with the caret after the text; one already on screen gets the text and the focus stays where it was. Nothing selected: the Note tab, no message. An admin window: the usual hint as a toast. The text is saved at once. The hotkey's Settings row notes that on a keyboard layout where AltGr+X types a character, another combination should be chosen (AltGr stands for Ctrl+Alt there).
- **The list tab (MINI-03, D-158):** mini mode's second tab shows any task list, Inbox by default. Its label is the list's name with a chevron: a click on the tab while another tab is active switches to it; a click on the active tab, or on the chevron, opens the list picker (search, most recently used first; Inbox to come back; no "New list"). The choice is remembered in mini's state file; a list that is gone falls back to Inbox. The composer, keys, drag and the menu work on the chosen list as on Inbox.
- **Mini mode's click-through (MINI-01, D-159):** a menu or picker that reached beyond the card's edge (the list picker below a short card, Open a note…) took clicks only over the card; the rest passed them to the app underneath. Everything open outside the card now takes clicks for as long as it is open, measured every frame (menus and pickers place themselves, grow with their rows and fade out), and the region shrinks back when it closes.
- **Mini mode's header and Reset size (MINI-01, D-160):** a long list name in the second tab no longer pushes the pin and × out of a narrow card; the name shortens first and the buttons stay, and the card is never narrower than 320 px (was 300). Reset size shows only when the card's visible size differs from the default: dragging the height limit taller over short content on Today or the list tab changes nothing visible and no longer shows it (the Note tab, which takes the limit, does).
- **Under the hood:** the appended text goes through mini's own editor (one window edits a note at a time), inserted once the note's text has loaded and the note is this window's to edit; main queues a capture until mini's page takes it, so one that arrives while the page starts is never lost. `noteAppend` in `packages/core` is unit-tested; two end-to-end tests in `mini.spec.ts` cover both features through a test hook.

## 1.3.1 (10 Nov 2026)

- **Tables (NOTE-10, D-154):** a cell's backslashes are written once. A cell ending in a backslash (a Windows path such as `C:\dir\`) or with one right before a pipe had its backslashes doubled at every write since 1.2.0 (`C:\dir\\`, then more), and typing a backslash could show two. Found from three CodeQL "incomplete escaping" alerts. The randomised table tests now write backslashes and check that every cell reads back exactly as set. Cells already doubled can't be told from intended double backslashes and aren't changed: remove the extra ones once; they don't come back.
- **Lists read while another program writes them (DATA-06, D-156):** a list whose file was held for a moment (a virus scanner on a new file) or emptied while another program wrote it lost its ID until the next read, and opened as a blank page. It now keeps its ID and what Flint had, read-only ("being written") until the file reads again, so no edit can write it back without its header.
- **Pasting from Excel (NOTE-10, D-156):** one large quoted cell is read in linear time (it took superlinear time).
- **Capture popup (CAP-02, D-156):** after a capture the popup empties only if it still holds what was sent, so text typed into it meanwhile is never cleared.
- **Tests and CI (D-155, D-156):** the flaky-test batch: each test waits for what it checks (linear-time checks by growth in a timing pass of their own, editor tests parse to the end, end-to-end steps wait for the UI); test windows keep drawing off-screen. CodeQL scans pushes to `next` too.

## 1.3.0 (9 Nov 2026)

- **Give to Claude (TASK-18, D-151):** a task's right-click menu, G, Ctrl+K and the side panel's task details open a palette-style card that hands the task to Claude Code in the Claude desktop app, through its documented link (`claude://code/new?q=…&folder=…`): Claude opens with the prompt in its composer, not sent, and asks to confirm the folder. The prompt is the task's own words in markdown: the title as a heading, the notes, the subtasks with their state and notes, attachment links made absolute paths; no fields, no preamble. A subtask gives itself with a `Part of:` line.
- **Folders:** the card offers the list's folder, up to five recent ones and Choose a folder…; Shift+Enter makes the folder the list's. A list's folder is also set from its right-click menu (Claude folder ›), the palette and Settings → Claude (Change…, Forget, Clear recent folders). Kept in Flint's settings on this machine, never in the Flint folder.
- **Limits, measured on Windows:** Claude keeps the first 14,336 characters of a link's prompt, and Windows hands over a link of up to about 32,000 encoded characters (Flint stays under 30,000). The card shows the count and a rough token estimate first; a prompt over either limit goes to the clipboard instead, said before giving, and Claude opens with a note to paste it.
- **Claude not installed:** a toast says so, with Download (claude.com/download).
- **Privacy (APP-09):** Flint makes no request for this; it only hands a link to the Claude app on the computer. Settings → About's Privacy line says so: nothing leaves the machine unless it is sent from Claude.

## 1.2.1 (9 Nov 2026)

- **Tables (NOTE-10, D-152):** a table cell takes the keys in the same step it lights up. Arriving from the note's own text (a click, Backspace under a table, ↓ from the line above) the cell's editor used to take the focus a frame later, so keys typed in that moment went into the note under the table, and on a slow machine a key right after a click (Home, Shift+↓) could be undone by the click's caret arriving late. The focus and the click's caret now come before the next key. The table tests no longer wait for a cell's focus; they type right after the key.
- **Performance (D-153):** escaping a title with deeply nested field-like text (`[ a :: ` repeated before `[priority:: high]`) took about 8 s at 50,000 characters, when such a title was typed or a task with one was changed. The escaping now stops after 16 passes and escapes every bracket with `::` after it instead: 30–70 ms, and the same output as before for every title that needs no more (titles people type need one to three).
- **CI (D-150):** the checks run once per commit, on pushes to `next` and pull requests; a release commit is `next`'s green commit, so it is no longer run three times (next, main, the tag).

## 1.2.0 (9 Nov 2026)

- **Tables (NOTE-10; D-141 Q9–Q12, D-144, D-149):** GFM tables are drawn in the note editor, mini mode's Note tab and task bodies, and edited cell by cell in place (Tab, Enter, Shift+Enter, the arrows, Esc; undo, Ctrl+F and copy through the note's own text), writing only the edited cell's bytes (Align table re-pads on request). The edge drag adds or removes columns and rows (the "+" chips beside the right and bottom edges, a ghost of what it adds or takes, a toast with Delete and Cancel before text is removed); Add / Delete row and column and Delete table in the menu and the palette; selecting cells (drag, Shift+click, Shift+arrows), Ctrl+C as tab-separated text, Delete with one undo step, a pasted block filling and growing the table. Text typed, pasted or deleted under a table stays out of it (GFM would make it a row), also in Source mode, quotes and list items; a click under a table lands on the line clicked; a new empty row always gets both edge pipes. No slash menu in a cell (a `/` is just a slash; a menu for cells is planned).
- **Go to from the composer's toast (D-147):** a task added from Inbox that goes to another list (`##list`) gets "Go to <list>" beside Undo, opening the list with the task selected, in view and flashed; in mini mode it opens the main window there.
- **Performance (D-146, D-143):** the file format's task-line reader, the code-span scan and the writer's escaping run in linear time on long field-like lines (they took seconds at 50,000 characters), byte for byte the same results, tested against the old code; the highlighter's file-and-line and JSON patterns in linear time (moved from 1.1.1).
- **Fixed:** the caret beside a pasted picture is at its edge at once and follows any change of its size (also a "File not found" card); an Undo toast closes when the note changes again, so its Undo never takes back something else.
- **The app icon (D-148):** the taskbar and tray icons use the master's 13 facets at 16, 24, 32 and 48 px, with a hairline outline, instead of a six-facet drawing stretched up to 96 px.
- **How we work (D-145):** CI runs the end-to-end tests split across four parallel runners, and a release is published only from a commit CI has passed; work in progress lives on a `next` branch.

## 1.1.1 (8 Nov 2026)

- **Security (D-143):** the CodeQL and Dependabot alerts on GitHub are fixed, none dismissed. The capture shorthand (`##` list names, `@` times, code spans), paste handling, stack-trace recognition and the list lookup ran in quadratic time on long pasted lines (up to 16 s per keystroke at 50,000 characters) and now run in linear time, each tested against the code it replaced and timed on pathological inputs. The release scripts escape completely (a version with build metadata found no release-notes section). minimatch 11.0.3 for the vulnerable range (an override; build tools only, nothing that ships); `npm audit` reports none. The installer packs the same files as 1.1.0, checked file by file.
- **The note-line flash (NAV-01, D-143):** a note's line chosen in Ctrl+K now lights the words searched for in it (its whole text on a loose match) in Ctrl+F's current-match style, held, then fading; it ends at the first edit. Before, a box flashed on the whole line, faint and not lined up with the text, and on a busy machine it could miss the line.
- **Fixed (NOTE-01, D-115, D-143):** in mini mode's Note tab, a quick note opened again after another note kept that note's editor, and Ctrl+Z could bring the other note's text into it and save it. A note's editor is now kept only for the step where its own note is made or given its ID, in both windows. A change from outside (the file edited elsewhere, the other window's text) is no longer an undo step.
- **Moved:** the highlighter's linear matchers ship with 1.2.0; the file format's task-line reader is its own change right after 1.1.1.

## 1.1.0 (8 Nov 2026)

- **The live preview, rebuilt (D-141, D-142):** its decisions are one pure function on CodeMirror's syntax tree (`editor/preview.ts`). Block markers (bullets, checkboxes, headings, quotes, task-field chips) and embedded objects (pictures, videos, files) stay drawn with the caret beside them and show raw only with the caret strictly inside; inline formatting shows raw with the caret inside it or at its edge; ← / → step into a marker; clicks and selections never reveal. A picture's (video's, file's) right-click menu has **Edit markdown**. The raw link no longer shows beside a picture on the cursor's line, and the caret beside a picture is one text-sized caret at its real position.
- **Source mode (NOTE-09):** a note's whole raw markdown, per note on this machine: Ctrl+Shift+E, the note's right-click menu (next to Monospace), the Ctrl+K palette (with Monospace beside it) and mini mode's Note tab; switching fades the text over. **Ctrl+E** wraps the selection or the word at the caret in backticks (Format ▸ Code).
- **Checklists in notes:** the task row's checkbox in its compact size with the row's 12 px tick, centred; ticking pops it, and the item's text is dimmed and struck through. List numbers are plain text in the note's font. Numbered lists behave as in 1.0.1 (a parser extension, renumbering and nesting were tried in the previews and taken out after testing).
- **Fixed:** a link whose address starts on the next line could stop a note from drawing; formatting inside a link's text showed raw; a note with Windows line endings had all of them rewritten on its first edit.
- **Tests:** the CommonMark 0.31.2 and GFM extension examples at every caret position, a local-only check on a real notes folder (`FLINT_CORPUS`), randomised editing; `npm run fuzz` for long fuzzing on demand and a nightly fuzz workflow (`fuzz.yml`). Text formatting stays out of the palette, a deliberate exception to D-106.

## 1.0.1 (8 Nov 2026)

- **Restart to update (D-140):** Flint now hides at once and shows a notification that it is updating and reopens by itself in about a minute, instead of a window that stops responding. The minute is Windows checking the new, not yet signed, version the first time it starts.
- The release workflow creates the release before uploading its files, so every file lands in the one release.

## 1.0.0 (8 Nov 2026)

- **The first release on GitHub Releases (D-139):** Flint is open source (MIT) at github.com/DavitKhachaturovi/flint, its history rewritten once and verified before it was published (D-135). The installer, `Flint-Setup-1.0.0.exe`, comes with `latest.yml`, so installed copies (0.9.1 and later) update themselves.
- Nothing changes in the app since 0.9.3; 1.0.0 marks the end of M9 and of the v1 scope.

## 0.9.3 (8 Nov 2026)

- **Nothing lost on a quick quit (D-138):** quitting (or Restart to update) right after closing the capture popup waits a moment for what is still being saved: the draft, a capture, a list change, pins and Today's order.
- **No more error boxes on the way out:** an unexpected error while Flint quits is written to the log and the quit goes on; test runs never show error boxes on the screen.

## 0.9.2 (8 Nov 2026)

- **A clean quit (D-138):** quitting within a moment of closing the capture popup (or mini mode) could leave Flint unable to exit, behind an error box. Fixed; quitting and Restart to update are tested with a draft waiting.
- **Performance, checked on every run (D-137):** typing, the popup, opening lists and notes, Ctrl+K, idle CPU and memory are measured each run and fail past their limits. Memory after start is about 300–350 MB; a list of 1,000 tasks opens in about 150 ms, over its 100 ms budget, until long lists are virtualised after 1.0.
- **README** at the root of the repository, with a screenshot of the app.

## 0.9.1 (7 Nov 2026)

- **Auto-update (APP-06, D-136):** installed copies check GitHub Releases 30 s after start and every 4 hours, download a new version in the background and install it when Flint quits, or at once with Restart now. A quiet toast says "Update ready · Restart now / Later"; Restart to update is also in the palette and the tray while an update waits.
- **Settings → About:** the version with what the updater is doing, Check for updates, and the switch "Check for updates automatically" (on). The Privacy row now says Flint only contacts GitHub to check for updates, which you can turn off.
- **GitHub Actions:** CI on every push and pull request, and releases built and published from a version tag, with What's new as the release text.
- The installer is now named `Flint-Setup-<version>.exe`.

## 0.9.0 (7 Nov 2026)

- **Open source (D-135):** Flint is Davit Khachaturovi's personal project, open source under the MIT licence, moving to github.com/DavitKhachaturovi/flint. M9 begins.
- **Neutral examples:** private names are gone from the code, tests, docs and mockups; the examples use neutral names (the list "Unicorn", "Alex", acme, Contoso). The design screenshots are re-rendered from the mockups.
- No change to how Flint works.

## 0.8.30 (7 Nov 2026)

- **Lists saved by other programs (D-134):** a list you open while another program is still saving it now shows its tasks as soon as they arrive (it could jump back to Inbox instead).

## 0.8.29 (7 Nov 2026)

- **The motion pass (UI-10, D-133):** a census drives every kind of action in Flint and checks that it moves; it stays as a test. What it found is fixed: pinning with P or the menu now pops the pin, the slash menu fades in and out, Settings' link pattern editor and folder panel fade away when closed, and Trash fades its buttons back after its question and folds away a day whose last item goes. M8 is complete.

## 0.8.28 (7 Nov 2026)

- **Privacy, stated plainly (D-132):** Settings → About starts with "Your notes never leave your machine. Flint sends no telemetry, needs no account and makes no network requests of its own."
- **Docs:** the plan after v1 (GitHub, Releases, signing) in 06 §5; 1.0.0 is kept for the first release on GitHub, so M9 stays 0.9.x; the checklist's older M8 rows say where they were built.

## 0.8.27 (7 Nov 2026)

- **Sidebar highlight (D-131):** after deleting a quick note, the highlight lands exactly on the list or note that opens instead, also inside a group.
- **Empty quick notes:** going back to an empty quick note before it's removed keeps it; it's removed only after you leave it again (2 s later).

## 0.8.26 (7 Nov 2026)

- **Attachments folder (D-130):** pasting a picture no longer leaves a temporary `.flint` folder inside `attachments/`; it uses the Flint folder's own.

## 0.8.25 (7 Nov 2026)

- **Back where you were (D-130):** a list opened again returns to its scroll position on a slow PC too (it could land at the top while its rows were still being drawn).
- **Side panel:** what the panel scrolls into view no longer ends up under the Clipboard section.

## 0.8.24 (7 Nov 2026)

- **Pictures in the Clipboard section (D-129):** pictures you copied show as thumbnails (a blank tile until the pointer rests on the section). Click one to paste it into a note or the composer (saved to attachments/); Capture as task puts it in the capture popup.
- **Delete and Clear all:** right-click → Delete (also from Win+V) removes an item from Windows' history too; Undo adds it back as the newest. Clear all (next to the eye) asks first and can't be undone; Win+V's pinned items are kept.
- **Copy** now works like picking an item in Win+V: no duplicate.
- **Motion:** items slide in and fold away; with contents hidden, they fade in and out as the pointer comes and goes.
- **Settings → Clipboard:** one switch, with a clearer description; the eye in the section shows contents always.
- Windows doesn't tell apps which Win+V items are pinned, so Flint can't mark them.

## 0.8.23 (7 Nov 2026)

- **The Clipboard section (M8 step 5, D-128):** Windows' clipboard history (Win+V) at the foot of the side panel, in every panel state: folded, the newest three items; open, all of them. For screen sharing, the rows are blank bars with their kind (Text, Link, Code) and age until the pointer rests on the section; the eye in its header (or Settings, or the palette) shows them always. Click an item to paste it where your cursor is (one Ctrl+Z undoes it); right-click for Insert, Capture as task (opens the capture popup with it) and Copy.
- **Paste from clipboard history… (Ctrl+Shift+H):** a picker with the items' text: Enter inserts, Shift+Enter captures as a task, Ctrl+C copies. Works without the side panel.
- **Settings → Clipboard:** turn clipboard history off in Flint (it then never reads it) or show its contents always. When history is off in Windows, turned off by your organisation, or a read went wrong, the section says so, with a button where one helps.
- **Faster and gentler reading:** the history is read in about 40 ms instead of 289, in the background, only when something new was copied. The Check clipboard history command is gone.

## 0.8.22 (7 Nov 2026)

- **Clipboard history, first part (M8 step 5, D-127):** Flint can read Windows' own clipboard history (Win+V), read-only and text only for now, through koffi with no new dependency. Ctrl+K → **Check clipboard history** reads it once and says how it went (items, text items, time, the start of the newest). A marker file around every read means a read that crashed Flint is never repeated by itself: reading stays off until you press Retry.

## 0.8.21 (7 Nov 2026)

- **What's new (D-126):** the card sits a little lower, its middle at the window's optical centre (45 % of its height).

## 0.8.20 (7 Nov 2026)

- **What's new (D-125):** the app is dimmed behind the card, as in the walkthrough, until Got it, Esc or ×; nothing behind it takes a click.
- **The walkthrough:** the step card never covers the ringed target or the field you type in. In step 4 it glides to the bottom-right corner when the quick note opens, so the note's title and text stay in view.
- **Tips:** up to two a session, at least 10 minutes apart; the card now sits as far from the right edge as from the bottom.

## 0.8.19 (7 Nov 2026)

- **Pickers:** typing to narrow a list (Move to, Open a note…) and pressing Enter always takes the top match, even with the mouse resting over the list.

## 0.8.18 (7 Nov 2026)

- **Tips (M8 step 4b):** now and then, a one-line hint in the bottom-right corner about a quicker way to do what you just did (shorthand instead of the buttons, Ctrl+K, capturing from any app, the keyboard, `/` in notes, Trash, short links, triage, the side panel). Each shows once, at most one a session, never while you type. "Don't show tips" turns them off; Settings → About has Show tips and Reset tips.

## 0.8.17 (7 Nov 2026)

- **Pin from the row:** hover an open task and click the faint pin to put it on Today; the pin pops in.
- **Mini mode:** the Note tab's ⋯ menu has "Open a note…": search any note or quick note (newest first) and it opens right there.
- **The walkthrough:** the dim and the card stay while the capture popup or mini is open; step 4 waits for something real (an empty quick note stays open for you to type in); step 5 points at the new pin; Replay walkthrough is in Settings → About.
- **What's new:** a proper reading size, with Got it at the bottom.

## 0.8.16 (6 Nov 2026)

- **The walkthrough (M8 step 4b):** a fresh install starts an 8-step tour once the window shows: welcome and the Flint folder (Change… restarts Flint and the tour goes on), capture from anywhere, shorthand, lists and quick notes, Today, reminders, the palette, mini mode. Each step moves on when you do the thing; only the ringed part of the window takes clicks; Esc or Skip all ends it. At the end, "Remove what I created during the tour" puts everything the tour made in Trash at once (Ctrl+Z brings it back). Replay it from Settings → General or Ctrl+K.
- **What's new:** after an update, a short card says what's new in plain words, once; again from Settings → About or Ctrl+K.

## 0.8.15 (6 Nov 2026)

- **After an update:** your link patterns (and the animation speed) work right away; no need to save them again in Settings.

## 0.8.14 (6 Nov 2026)

- **Inbox triage:** the Triage link is back under Inbox's title. Click a task's notes to see it in the side panel; the next task, or a click elsewhere, shows Up next again.
- **Quick notes:** Enter, Tab or ↓ in "Add a title" saves the title and puts you in the note's text. Giving a quick note a title no longer looks like a new note.
- **Sidebar:** in a group, "Move to top of group" keeps it in the group; "Move out to top of Lists" takes it out.
- **Mini mode:** menus open where there's room, never cut off at the screen's edge.

## 0.8.13 (6 Nov 2026)

- **Inbox triage:**
  - Start it from the Triage button at the end of Inbox's title.
  - Leave partway and it picks up where you were; Start over goes back to the first task.
  - Hover the progress line to see a task's number, click to jump there.
  - Click a task's notes to read all of it (in the side panel, or on the card in a narrow window).
  - The card and its buttons move smoothly, and editing the title no longer jumps.
- **Today:** the Timeline is always there, even without reminders.
- **Sidebar:** a new list, note or group you're naming scrolls into view. Lists in a group can move to the top of the group; Move to top takes them to the top of Lists.
- **Mini mode:** the note's title sits a little lower again, without moving the "Quick note" line, and switching tabs no longer shows a scrollbar or shifts anything sideways. Closing it returns you to the app you were in, never to a minimized Flint.

## 0.8.12 (6 Nov 2026)

- **Inbox triage:** sort your Inbox one task at a time, oldest first, without leaving the keyboard. Press T in Inbox (or "Triage" under its title, or "Sort Inbox" on Today): M moves it to a list, Space marks it done, Delete deletes it, 3 / 2 / 1 / 0 set its priority, P pins it, R sets a reminder, → keeps it in Inbox. Ctrl+Z brings the last one back; at the end you see what you sorted.

## 0.8.11 (6 Nov 2026)

- Subtasks in the side panel now slide in and fade away like tasks in the list.
- Mini mode's note sits a little lower under the tabs, and switching to it no longer flashes a scrollbar.
- The capture popup has the same softer shadow as mini mode.

## 0.8.10 (6 Nov 2026)

- **Link patterns** can have two changing parts: give two examples like `unicorn-api-PR-45` and `platform-PR-12` and one pattern covers every repository.
- **Notes:** selecting text highlights just the text, not whole lines. Click a note's title to rename it.
- **The task box** keeps what you typed in each list until you send it, even when you go elsewhere and come back; its notes field can be clicked again after the title.
- While you edit a task, `!h`, `@15:00` and `##list` show on the row as you type (the priority bar, the time, the list).
- An empty new task you leave now fades away instead of vanishing.
- **Mini mode:**
  - One size for all tabs: Today and Inbox grow with what's in them up to it, Note always uses all of it. Resize from either side, wherever it is; a button next to the pin puts it back to the standard size.
  - Click a selected task again to open it in Flint. The bell on a task turns its reminder off and on.
  - D, S and O work as soon as mini has the focus.
  - A softer shadow below, and the space just above it no longer catches the mouse.
- Mini mode and the capture popup now fade in and out (typing and focus are never delayed).

## 0.8.9 (6 Nov 2026)

- **Mini mode, redone** to look and feel like the rest of Flint:
  - About a third smaller, with the rounded floating card from the design: it hangs from its screen corner, grows and shrinks with what's in it, and scrolls past its height limit. Drag its edges to resize it; drag the small bar at the top (or the header) to move it.
  - The same tasks as the main window: the same selection that glides, the same check and completion, drag to reorder (and Alt+↑/↓), the same scrollbars and menus.
  - The top of Today shows your next reminder with a countdown; when a reminder fires, that card turns into Done / Snooze 10m / Open. It never takes the cursor away while you type.
  - The box at the bottom works like the main window's, chips and all; the shorthand hint shows while it's empty.
  - Switching tabs eases in; the pin shows whether mini stays on top.
  - Note: you can type the title first; New quick note waits until there's something in the current one; fixed a note tab where nothing could be clicked after an empty note was removed.
- The animation speed setting now applies to mini mode too.

## 0.8.8 (5 Nov 2026)

- **Mini mode**: a small window that stays on top, for calls. Ctrl+Alt+Space opens and hides it (also from the tray, Ctrl+K or the button at the top right of Flint).
  - **Today** shows your pinned tasks and the reminders still to come today; **Inbox** shows what you captured; **Note** is a sticky note (a quick note).
  - Click a task to select it, double-click or Enter to open it in Flint; Space completes it, P pins it.
  - When a reminder fires, mini mode shows it too, with Done, Snooze and Open. Acting on either the card or the Windows notification clears the other.
  - A note is edited in one window at a time; the other shows it changing live.
  - Drag it near a screen corner and it snaps there. It doesn't show up when you share your screen (and neither does the capture popup); both can be changed in Settings.

## 0.8.7 (5 Nov 2026)

- Renaming a list, note or group and clicking away now looks just like pressing Enter (no disappearing and coming back), and clicking another list saves the name too.
- The search button next to the logo always lights up under the mouse.
- A line opened from Ctrl+K stands out a little more, a little longer.
- It's "Good evening" until 4 in the morning.

## 0.8.6 (5 Nov 2026)

- **Search** moved to a small button next to the Flint logo (Ctrl+K still opens it anywhere); the big box at the top of lists and Today is gone. The palette shows its keys at the bottom.
- In the palette, **Esc goes back** from Move to…, Priority and the like (there's a back arrow too), and closes only from the top. Results always come in the same order: places, commands, tasks, lists and notes, then lines inside notes. Choosing a line opens the note right at it.
- **Renaming** a list, note or group keeps the new name when you click away; only Esc cancels.
- An empty quick note that disappears when you leave it now says why (the first few times).
- Fixed: at midnight, Today showed the new date with yesterday's tasks for a minute or two; the rollover card, tomorrow's reminders and done pins now update right at midnight.
- Fixed: clicking a list just as it appeared (or right after renaming another) could jump back to where you were.
- Fixed: a new quick note could still, rarely, open without the cursor.

## 0.8.5 (5 Nov 2026)

- Fixed: a new quick note (Ctrl+Shift+J) sometimes opened without the cursor in it.

## 0.8.4 (5 Nov 2026)

- **Ctrl+K**: one box to find anything (lists, notes, tasks in every list, lines of notes) and to run commands: go somewhere, make a list or note, move or pin the selected task, change the interface size, export, quit. Also from "Search or run a command" at the top of a list. Deleted and archived things are one row away: "Search Trash and Archive".
- **?** shows every keyboard shortcut; type to narrow it down.
- In notes, Ctrl+K with text selected makes it a link.

## 0.8.3 (5 Nov 2026)

- **Link patterns** can be edited, and Flint understands more of them: a part that changes can be a word with fixed text around it (`platform-repo`). A short form needs some fixed text (like `AB#` or `dx:`), so ordinary words never turn into links; Flint suggests one and shows how many places a pattern would link.
- The built-in kinds (Azure DevOps, GitHub, Jira) are listed in Settings → Links, each with a switch.
- **Links show while you type**: the composer and the capture popup show a chip for each link, and a pasted link turns into its short form right away in notes.
- The Trash button is just "Trash"; the count is inside.

## 0.8.2 (4 Nov 2026)

- **Move your Flint folder** from Settings → General → Change…: Flint copies everything to the new place, checks every file, and keeps the old folder as a backup. You can also start fresh somewhere else, or open a folder that already has Flint lists.
- **Link patterns** in Settings → Links: paste a link (an Azure DevOps work item, a GitHub issue, a Jira ticket…), choose its short form, and from then on typing `AB#1234` makes a link and pasted links show as `AB#1234`.

## 0.8.1 (4 Nov 2026)

- **Settings and Trash** sit side by side at the bottom of the sidebar, both names in full, and your lists fade out softly above them.
- The side panel always fits the window, so its bottom is never out of reach.

## 0.8.0 (4 Nov 2026)

Versions now follow the milestone: 0.8 is M8 (polish), and 1.0 is the first public release.

- **Change your hotkeys in Settings → Capture & hotkeys**: click the hotkey, press the new keys. Flint still tells you when another app already uses them. The tray is shorter: Open Flint, Quick capture, Mini mode, Settings, Quit Flint.
- **Quick notes keep their title**: the title saves when you click away, and a titled quick note stays under Quick notes until you keep it as a note or the day ends.
- **Two designs for Settings and Trash at the bottom of the sidebar**: try Card and Buttons in Settings → Appearance → Sidebar footer.
- **Snapshot comparisons scroll** in the side panel, with their buttons always readable at the bottom.
- **Interface size** sets exactly the size you press (80 % to 150 %).
- The reminder sound explains what Flint's chime is for: you still hear it when Do Not Disturb or Focus silences notifications.
- Fixed: making a list or note in a group no longer makes the selected item flash.

## 0.4.34 (4 Nov 2026)

- **Settings**, above Trash in the sidebar (and in the tray): start with Windows, your hotkeys, notifications and the reminder sound (Windows' or Flint's chime), unfinished pins, auto-archive, snapshots and how long they're kept, export, interface size, animation speed, and every keyboard shortcut. Ctrl+F finds a setting.

## 0.4.33 (4 Nov 2026)

- **Quick notes**: Quick note under Inbox, or Ctrl+Shift+J anywhere, opens a fresh note ready to type, no name needed. They wait under Quick notes; add a title when you want to keep one as a normal note. Empty ones disappear by themselves.
- **Rename in place**: double-click a list or note in the sidebar (or click the open one again) to rename it; double-click a group to rename it.
- **Compare with a snapshot**: in Snapshots, click a changed list to see which tasks were added, deleted or changed, and bring back just the ones you want; a note shows what changed line by line.
- The tray menu is back to the essentials; Snapshots and Export are linked from Trash until Settings arrives.
- Fixed: reminder cards' hover shadow, the selection jumping when a new list is made in a group, a gap under Trash in the sidebar, and "Restore to edit" not showing on deleted lists.

## 0.4.32 (4 Nov 2026)

- **Snapshots**: Flint keeps a copy of your Flint folder every hour something changes (for two days), then once a day (for a month), on this computer. From the tray (Restore from a snapshot…) or Trash, bring back one list or note as it was, or everything. Ctrl+Z undoes a restore.
- **Export**: the tray's Export Flint folder… saves everything as one zip file.

## 0.4.31 (4 Nov 2026)

- **New lists right in a group**: right-click a group for New task list or New note.
- **Trash stays at the bottom** of the sidebar, however many lists you have.
- **Back to top**: once you scroll down, a small button at the bottom right takes you up again.
- **Look inside the Trash**: click a deleted task, list or note to read it. Restore to edit it where it was; after Restore, "Go to" takes you there.
- Fixed: the shadow flicker under reminder cards after hovering.

## 0.4.30 (4 Nov 2026)

- **Trash**, at the bottom of the sidebar: everything you deleted in the last 30 days, by day. Restore puts it back where it was (Ctrl+Z undoes that); Delete now and Empty Trash remove things for good, after asking.
- **Archived**, the second tab: completed tasks that auto-archive moved away, by list. Restore one to bring it back to its list.
- Flint now removes pictures and files nothing uses any more, when it starts.

## 0.4.29 (4 Nov 2026)

- **Flint's window comes back as you left it**: maximized if it was, from a reminder, the tray, the Start menu or opening Flint again.
- **The list name on a task in Today** now takes you to the task in its list, scrolled into view.
- **Flint's chime is "Nudge"**, two soft taps (still off by default).
- Fixed: the side panel's scrollbar running over the card's rounded corner, a second shadow flicker under reminder cards after hovering, and "Sort Inbox" not reacting to the pointer.

## 0.4.28 (4 Nov 2026)

- **Overdue reminders in Today**: a quiet "Overdue" card under "Unfinished from yesterday" lists every task whose reminder has passed, including ones missed while Flint was closed. Mark them Done, Snooze them (in an hour, tomorrow at 10:00, or a time you pick), or click to open. It folds, and remembers.
- **"N reminders you missed" opens that card.**
- **Press R** on a selected task to set or change its reminder, in any list and in Today.
- **Flint can play its own soft chime** when a reminder fires. It is off by default, since Windows already plays a sound; Settings will have the switch.

## 0.4.27 (4 Nov 2026)

- **Open on a reminder is instant**: the task is scrolled to, selected and flashed straight away, also when it was already selected.
- **Click a task in Today to see its details** in the column on the right; Esc, the back arrow or a click on empty space brings the timeline back.
- **Drag a reminder on the timeline** to change its time, in quarter hours (hold Alt for 5 minutes). Ctrl+Z undoes it.
- **Done today and Captured today are always there**, saying so when empty. "Sort Inbox" stands out, and the list name on a task in Today opens that list.
- Fixed: a scrollbar flashing as Today's column appeared, the task details shifting as they opened and scrolling a little past the top, and reminder cards' hover shadows spilling over their neighbours.

## 0.4.26 (4 Nov 2026)

- **Today, redesigned**: a progress line under the date ("2 of 7 done") fills as you finish today's pinned tasks and reminders.
- **Focus shows high-priority tasks too**, below your pinned ones, quieter; press P to pin one. Done pinned tasks stay, faded, with the time you finished them, until tomorrow.
- **The next reminder stands out**, with a live countdown; cards go as their time comes, without leaving Today.
- **A Today column on wide screens**: a timeline of today's reminders with a line for now, what you finished today, and today's captures with a "Sort Inbox" button. On smaller windows these sit under Focus and fold. Shift+Enter or a task's notes icon shows its details there; the back arrow or Esc returns.
- **"Unfinished from yesterday" stays** until you choose Roll over, Clear or ×.

## 0.4.25 (4 Nov 2026)

- **Open on a reminder takes you to the task**: its list opens, the task is scrolled into view, selected and flashed.
- **Lists, notes and pages remember where you were**: coming back (back, or the sidebar) puts you at the same place, at once.
- **Code copied from Windows apps pastes again**: in a note it pasted nothing. Code on a single line is now recognised as code too.
- **The task menu is tidier**: Complete, Edit and Open as page first; Priority, Reminder and Pin; Add (subtask, notes); Move to and Duplicate; More (indent, outdent, format as code, convert to note); Delete.
- Fixed: "Open in viewer" on a picture in a note, selected text in the panel missing its first characters, and the note's find bar sitting too low and drifting while scrolling.

## 0.4.24 (3 Nov 2026)

- **Today**, first in the sidebar, where Flint now opens: a greeting, today's reminders as cards, and **Focus**, every pinned task from every list, each showing its list. Pin a task with P (or its menu) to bring it here.
- **Changes in Today go to the task's own list**: complete, edit, prioritise or add notes there as in any list.
- **Put Today in your own order** with Alt+↑/↓ or by dragging; your lists keep theirs.
- **Add tasks from Today**: they go to Inbox (or the `##list` you type), already pinned.
- **Unfinished from yesterday**: on the first look at Today each day, Flint asks whether to keep yesterday's unfinished pinned tasks (Roll over) or unpin them (Clear). They always stay in their lists.

## 0.4.23 (3 Nov 2026)

- **A click selects a task**, wherever you click, the title too. Click it again, or double-click, to edit, with the cursor where you clicked. A link in a title opens with a click once the task is selected, or with Ctrl+click.
- **Subtasks in the panel are clickable**: their details open in the panel, and the back arrow returns to the parent. On a task's page, a selected subtask shows its notes in the panel.
- **Shift+Enter while typing a title goes to the panel's notes** on wide screens; Esc closes a body opened in the list.
- **Holding ↑ or ↓** keeps up with the key instead of lagging behind.
- **Sorting moves the rows** to their new places, and the "Sorted by" line comes and goes smoothly. The find bar (Ctrl+F) opens and closes smoothly too, sits next to the list's title, and lines up with the panel as you scroll.
- **The `##` list menu shows every matching list**, scrolling past five.
- **Right-click menus** in the image viewer, on Attachments and on References in the panel; Inbox has one too (sorting, Duplicate).
- **Copy buttons show a checkmark** after copying.
- Fixed: an open task's card overlapping the selected task above it, the editing field's top edge cut off in a body, the indent nudge missing from the right-click menu, and Ctrl+A on a note selecting the whole window.

## 0.4.22 (3 Nov 2026)

- **Pasted links get short titles**: an Azure DevOps pull request shows as "PR 42", a work item as "AB#1234", GitHub issues and pull requests as "repo#12" and "repo!9", Jira as "KEY-5"; other links as their site and a short path. The full link stays in the file (hover to see it).
- **Sort a list for a moment** by priority, reminder time or date added: right-click the list (or an empty spot in it) → Sort tasks by. Your own order stays; "Back to manual order" returns to it.
- **Ctrl+F in a task list** finds text in titles and notes, Completed included; Enter and Shift+Enter go through the matches.
- **Paste several lines** into a list (with nothing being edited) to get a task per line, below the selected task. "Keep as one" in the message turns them into one task with notes. Pasted code becomes one task with a code block.
- **Swipe with two fingers** on the touchpad to go back and forward, as in the browser.
- **Lists with 50 or more completed tasks** offer to archive tasks completed more than two weeks ago, automatically. They move to an archive file in the Flint folder; nothing is deleted.

## 0.4.21 (3 Nov 2026)

- **Notes are never lost**: in the panel, under a task in the list, and on a task's page, notes are saved as you type, also when you click somewhere else right away.
- **Showing and hiding the panel** moves your tasks and the panel together, without them overlapping.
- **Subtasks in the panel** show their priority, reminder and pin, and right-click gives the same menu as in the list. Adding a subtask uses Flint's own editing field.
- **Notes in the panel** keep their spacing after a code block and line up with the rest of the panel; code blocks no longer start with an empty line.
- **A task's page**: its notes look and work like a note's text (no inner card), and pasting code, JSON or a stack trace adds it as a code block to the selected subtask's notes (or the task's own).
- Code in notes under a task is no longer cut off at the top, and an open task and its open subtask no longer overlap.
- **↑/↓ keep the selected task in view**, scrolling the list along.
- **Moves that can't happen** (indenting the first task, Alt+↑ on the top one…) give the task a small nudge.
- **The "Add a task" box** has the `##` list menu and the close-match card again, like the quick capture. `##new list 2` now always finds "new list 2", here and in the quick capture.
- **Right-click a picture** (in notes, under tasks, in the "Add a task" box or in the image viewer): Copy image, Open in viewer, Open in default app, Show in folder.
- **Move to top** for a list or note in the sidebar (with the Manual sort).

## 0.4.20 (3 Nov 2026)

- **The panel slides in and out** when you show or hide it (Ctrl+\ or the panel button), and your tasks glide to their new place.
- **The panel scrolls with the page** and then sticks just below the title bar, without a gap above it.
- **Up next rows** start with the title; the pin, bell or overdue bell, the time and the list are on the right, as in your task list.
- **"In this note" and "In this task" are clickable**: open checklist items, code blocks, images and links, with counts. Click to jump to the first, again for the next.
- **Edit a task's notes right in the panel**, and add subtasks there too.
- No more scrollbar flashing in the panel, and its sections (Recently captured, References, Attachments) open and close smoothly, all lined up.
- **Pictures in Attachments** open in Flint's viewer; other files open in their app as before.
- **Click a pin** (on a task, in Up next, or the panel's Pin chip) to unpin.
- **Right-click works like Explorer**: inside a selection the menu acts on all of it and says so ("Unpin 3 tasks"); outside it, on just that task. Unpinning one task no longer unpins the others.
- **After Convert to note** (a task or a whole list) the note opens, ready to type.
- **A task's page** sits on a card like notes do.

## 0.4.19 (2 Nov 2026)

- **The panel fits more screens.** A slightly narrower version of the side panel appears on windows from about 1480 px, so a 1920 px laptop screen at 125 % gets it at 100 % size.
- **Back in the panel.** When you open a task from Up next, a back arrow in the panel's header (or Alt+←) returns to where you were.
- **A panel button** at the top right, next to the window buttons, shows and hides the panel (as Ctrl+\ does). Right-click the page's empty space or the panel for Show / Hide panel.
- The panel now lines up with the "Add a task" box (or the note's card) and stays there while you scroll.
- **Click empty space** next to your tasks to clear the selection and see Up next again.
- **Up next** shows your pinned tasks first, then today's and tomorrow's reminders, then overdue ones, a little quieter, at the bottom. **Recently captured** (your last five quick captures) sits below as one line you can open.
- **Pin tasks** with **P** or right-click → Pin (also for several selected tasks). Pinned tasks show a small pin and appear in the panel from any list; they will make up the Today view later. A completed pinned task drops off at the end of its day.
- **References and Attachments**: a task's or note's links and files, each as one line in the panel ("References · 3") that opens with a click. Linked large files are marked, missing ones flagged. The panel remembers which ones you keep open.
- **Notes sit on a card**, so it's clear where you can type. "In this note" now says when the note was created as well as last edited.
- The outline follows your reading reliably, all the way to the last heading, and a click on an entry scrolls there smoothly.
- The panel animates as intended: it slides in, the old content fades out as the new fades in, and the outline's marker slides.
- **Convert to note**: right-click a task to make it a note (its notes become the text, subtasks a checklist). Ctrl+Z brings the task back.
- Folding a group in the sidebar no longer stalls now and then.

## 0.4.18 (2 Nov 2026)

- **A panel beside your tasks on wide windows** (about 1580 px and up, or a smaller interface size with Ctrl+−). **Ctrl+\** hides and shows it; each monitor remembers.
- **Select a task** and the panel shows it: tick it, edit the title, change priority, list or reminder from the chips, write its notes, tick and add subtasks, see when it was created and last edited. On wide windows the notes are edited there instead of opening under the row.
- **With nothing selected**, it shows **Up next**: overdue reminders, then today's and tomorrow's by time. Click one to go to the task.
- **In a note**, it shows the outline: headings, and the code blocks and pictures under each, named by their first comment, their JSON keys or the exception. Click to jump there. Below: the checklist's progress and when the note was last edited. A task opened as a page gets the same for its notes.

## 0.4.17 (2 Nov 2026)

The note editor is complete; please test it as a whole.

- **Right-click in a note or a task's notes** for Format (Bold, Italic, Strikethrough, Highlight, Code, Clear formatting), Paragraph (lists, checklist, headings, quote) and Insert (Link, Image from a file, Table, Code block, Horizontal rule). **Ctrl+B** and **Ctrl+I** for bold and italic, **Ctrl+Shift+V** pastes as plain text.
- **Type `/`** at the start of a line or after a space for the same commands; keep typing to filter (`/co`), Enter or Tab to apply, Esc to close.
- **Code blocks** have their copy button while editing too, and are highlighted for every common language (bash, PowerShell, C#, Go, Rust, SQL, YAML…), in notes and in task notes.
- **Ctrl+F** finds in a note: Enter and Shift+Enter go through the matches.
- **Monospace** for a note: in its right-click menu, or Ctrl+Shift+M.
- **Videos** (MP4, WebM, MOV) and other files can be dragged in from Explorer or pasted. Videos play in place; one that can't (a phone's HEVC video) offers your default player.
- **Large files (over 25 MB) are linked, not copied**, so your Flint folder stays small. A notice offers **Copy into Flint instead** and stays until you choose; a linked file shows a "Linked" badge, and "File not found" if the original moves.
- `==highlighted text==` shows highlighted in task titles and notes too.
- Link patterns (like `AB#1234` for Azure DevOps) are ready underneath; setting them up comes with Settings.
- The task list is back to its 0.4.15 width.

## 0.4.16 (2 Nov 2026)

- **A new editor for notes and task notes** (the first part of M5). It looks like the finished text: headings, bold, links, bullets, checkboxes, code blocks and pictures show formatted, and the markdown signs (`**`, `#`, a link's address) appear only on the line you are typing in. Click a link to open it, a checkbox to tick it, a picture to see it large. Task fields in a note show as small chips ("high", "30 Oct 15:00"). Lists continue on Enter, Tab indents, brackets close by themselves, and pasting code or a screenshot works as in the capture popup.
- **Groups look as they did in 0.4.14** again: the small all-caps label with the count. An open group now sits on a soft card, and dragging a list over a group draws a white ring around it. Dragging feels as before (no wobble, no line under the dragged list). New groups still start at the top, dropping on a folded group still adds the list to its end, and the animations stay.
- **Wide screens**: task lists grow with the window (up to about 1160 px); notes and task pages keep a comfortable reading width.
- **Interface size**: Ctrl+= and Ctrl+− make everything larger or smaller, Ctrl+0 goes back to 100 %. Each monitor remembers its own size; the level shows for a moment when it changes. The capture popup stays as it is.

## 0.4.15 (2 Nov 2026)

- **Pasting into the task box at the top** looks like the capture popup: code, JSON and stack traces show as a small code card (language, line count, the first lines; the chevron shows all, × removes it), a screenshot as a thumbnail chip. On Enter they become the task's notes. Nothing shows as raw `![](attachments/…)` or ``` text any more.
- **Every task with notes shows the notes icon**, also when the notes are only pictures; the picture icon shows as well when there are pictures. The notes icon opens the task with its thumbnails.
- **Delete a code block or a picture from a task's notes** with the small trash button in its corner (in the list and on the task's page). It folds away, and the message at the bottom has Undo. A deleted picture's file stays in `attachments/`.
- **Deleting an opened task** first closes it, then it goes.
- **Groups are cards** (as in the new mockup): a folder tile and the name, the lists inside on a faint line; folded, one row that says "3 lists".
- **New groups appear at the top of Lists**, ready to name.
- **The sidebar moves smoothly**: new, renamed and deleted groups, folding, Move to group and Remove from group, and changing the sort all animate to the new places.
- **Dragging a list into a group shows where it lands**: the group lights up and says "Drop to add", a line marks the spot, and the group's card makes room. Drop a list on a folded group to add it there; the group pulses.
- The sidebar no longer shifts when its scrollbar appears.
- **Dragging a task**: the sidebar keeps its highlight, the dragged task keeps its own, and a task with notes or subtasks folds them away smoothly while it moves and opens them again after.

## 0.4.14 (2 Nov 2026)

- **Groups in the sidebar**: New group from the + (or right-click the sidebar). Click a group's header to fold it. Right-click a list for **Move to group** (with New group at the end) or **Remove from group**; right-click a group to rename or delete it (its lists stay, and Ctrl+Z brings the group back).
- **Sort the sidebar** with the new button next to the +: Manual, Recently edited or Created.
- **Drag to reorder**: drag a task (it takes its subtasks along), a subtask among its siblings, a list in the sidebar (also into and out of a group) or a whole group. Everything else slides out of the way. Ctrl+Z undoes a move.
- **Alt+↑/↓** moves whatever you picked last: the selected task, or the list or group you clicked in the sidebar. With nothing picked, nothing moves.
- **Fixed: a task with two or more subtasks showed only the first one.** The others were read as part of the first subtask's notes. Your files were never changed; the missing subtasks come back as they were.

## 0.4.13 (1 Nov 2026)

- **Switching lists and pages animates again** (it had stopped in 0.4.12); a test now catches it if it ever stops.
- **Submenus are easier to reach**: moving the mouse diagonally towards an open submenu no longer closes it on the way.
- **Menus and pickers fade out** when they close, also when their task scrolls out of view.
- **Expanded tasks** keep the same spacing above and below as every other row. A long body's hover is a quiet tone of its card.
- **Code cards name their language** (json, yaml, stack trace, sql, shell, powershell, python, c#, typescript…). Right-click a task with unfenced code in its body for **Format as code**.
- **Pasting in the task box at the top** works like the capture popup: code, JSON and stack traces go into the notes as a code block, and a pasted screenshot is saved to `attachments/` and linked there. Pasted markdown (code blocks, image links) stays as it is.
- **Images**: a task shows an image icon when its body has images (and the body icon when it has text). Expanded tasks show small thumbnails; the task's page shows them full size. Click an image or the image icon to view it large; ← and → go through the task's images, Esc closes.
- **Indent and Outdent** are in a task's right-click menu.
- The notes field under the task box is no longer cut off at the top.

## 0.4.12 (1 Nov 2026)

- **Menus and pickers stay with their task or button** while you scroll, and close when it scrolls out of view.
- **Priority is one submenu** in a task's right-click menu (High, Medium, Low, None).
- **Notes, quickly**: Shift+Enter in the task box at the top opens a notes field under it; the notes become the new task's body. Shift+Enter while editing a task's title opens its notes. "Add notes" is in the task's right-click menu too.
- **Expanded tasks** look like the reference design: always a raised card, the priority stripe along its whole height, body and code inside.
- Clicking another task while editing one saves the edit and selects the other task. Collapsing a task next to the selected one no longer drags the highlight across it. Selected tasks with a body keep their own spacing.

## 0.4.11 (1 Nov 2026)

- **Pickers switch reliably**: flag, # and bell pickers (and a reminder's picker) hand over to each other smoothly instead of disappearing or opening at the bottom of the window. They open more visibly and fade out when closed.
- **Expanded tasks are one card**: the title and its body together, with code and stack traces in their own small card with a copy button. A long body opens its page when you click it; short ones are edited in place.
- **Selection**: nothing is selected when you open a list (↓ selects the first task, so a click never starts editing by surprise). Ctrl+A selects the open tasks only. Selected tasks next to each other form one highlight, and opening any list clears the selection.
- **Motion**: deleting and duplicating (and undoing them) animate like completing; the Undo message fades out; Completed folds away smoothly; the editing box arrives more noticeably.
- **Notes to task lists**: every line of a note becomes a task; headings stay as labels, and code or quotes go under the task above them.
- Switching to a note no longer flashes a scrollbar. In the time wheels, clicking a value after typing goes straight to it.

## 0.4.10 (1 Nov 2026)

- **Select several tasks**: Shift+click or Shift+↑/↓ for a range, Ctrl+click for single ones, Ctrl+A for all. A bar at the bottom then offers Select all, Move, Priority and Delete; Space, 1/2/3/0 and Delete work on all of them too, and one Ctrl+Z undoes the whole action. Esc clears the selection.
- **Duplicate** a task (right-click): the copy appears right below it, without the reminder. Lists and notes can be duplicated too ("Name copy").
- **Convert** a task list into a note, or a note into a task list (right-click it in the sidebar). Plain bullets become tasks; everything else stays.
- **Delete several lists at once**: Ctrl+click or Shift+click them in the sidebar, then right-click. One Ctrl+Z brings them all back.

## 0.4.9 (1 Nov 2026)

- **Pickers and menus open with nothing highlighted**; the arrow keys or typing show the highlight, and Enter only acts on what you see highlighted. Clicking a picker's button again closes it. Pickers grow out of their button, and switching between pickers morphs from one to the next.
- **Time wheels**: a touchpad scrolls them freely and they settle on the nearest value; a mouse wheel moves one value per notch. Click a value (or type a digit) to type it: 4_ then 47, any minute.
- **Editing a task**: click a selected task again to edit it, like renaming a file. The dark field fades in and slides along when you move to the next task.
- **Bodies** keep their line breaks, show lists of links as text instead of code, and fence pasted JSON, code and stack traces. They open under the task in a soft box; a long one shows its first lines with "Open as page". Editing a body no longer moves anything.
- **Task pages**: a lighter title that wraps while you edit it, the back arrow lined up with the first line, and the task's subtasks with "Add subtask" (also in the task's right-click menu).
- **Motion**: completing a task is a bit quicker, switching lists a bit slower; new tasks open up their place, reopened tasks come back from the left, pages slide in. Switching to a note no longer makes the text jump.

## 0.4.8 (1 Nov 2026)

- **Task bodies.** Click the lines icon on a task (or press →) to see its body: a short one opens right under the task, a long one as its own page. Bodies show formatting, highlighted JSON and stack traces, and screenshots. ← or the icon closes it again.
- **Edit a body** by clicking it: it turns into a plain text box (the full editor comes later). Esc or clicking elsewhere saves.
- **Open any task as a page** with Shift+Enter or "Open as page" in its menu: the title (click to edit), the body, and a back arrow. Esc goes back to the list.
- **Back and forward** with Alt+← / Alt+→ or the mouse's side buttons, through the lists and pages you opened.

## 0.4.7 (1 Nov 2026)

- **Nothing waits for an animation any more.** Completing a task saves it at once (you can undo right away); the animation plays on where the row was. Animations are a little fuller: the selection, menus and pickers take about 0.2 s, switching lists about 0.3 s, completing about 0.4 s. Tell me if they feel slow.
- **Editing a task looks like a text box**: a dark field like the one at the top, clearly different from a selected task. Clicking another task's text goes straight into editing it, without the highlight sliding over first.
- **Pickers:** when the mouse leaves the list, nothing stays highlighted; the arrow keys bring the highlight back from where the mouse was.
- **Time wheels:** touchpad scrolling moves calmly, one step per bit of movement; a mouse wheel notch is still one step.
- **Taskbar and tray icon:** rounded corners like the Flint logo again, and a slightly smaller leaf.

## 0.4.6 (1 Nov 2026)

- **Click a task's text to edit it**, with the cursor right where you clicked. Clicking beside the text only selects the task; double-click anywhere edits; Esc goes back.
- **A new time picker**: after you pick a day, two wheels for hours and minutes (5-minute steps). Scroll, drag or click them, or use the arrow keys and type digits; Tab switches between hours and minutes; Enter or the Set button sets it. Type exact minutes (`14:37`, `3pm`) in the field above as before.
- **Quick reminders**: In 10 minutes, In 1 hour, Tomorrow 10:00. A day without a time (tomorrow, fri) now means 10:00.
- **Undo plays the animation too**: undoing a completion brings the task back the same way un-checking does.
- **A changed reminder time** fades into the new one instead of jumping. Overdue reminders keep the white dot on the bell, without brighter text.
- **Selected text** is Flint's soft gray instead of Windows blue.
- **Fixes:** the text cursor no longer flickers over the task box and notes; pickers drop the mouse's highlight when the mouse leaves; today in the calendar no longer turns gray on hover; right-clicking empty space in the sidebar opens Flint's menu (New task list, New note) instead of Windows' window menu.
- The taskbar icon follows one rule now: the dark tile fills the whole square with Windows' corner rounding, and the leaf sits inside it in proportion.

## 0.4.5 (1 Nov 2026)

- **Completing a task** is easier to see: the check fills with a small pop, then the row fades, slides and folds away into Completed. **Reopening** one folds it out of Completed and back into your tasks. Switching lists is a little calmer.
- **Change a reminder** by clicking its time, or with "Change reminder…" in the task's right-click menu. A new time turns a muted reminder back on.
- **The date/time picker** now goes day first: pick a day in the calendar, then a time of day (common times, or type one under "Other time"), with a back button to the calendar. Typing "fri 15" and the presets still work, everywhere.
- **Overdue reminders** keep the bell in place with a small dot on it and brighter time; no "Overdue" word. Muting and unmuting draws and removes the line through the bell smoothly.
- **Reminder notifications** say just "Reminder" and the task name, without the time or the big logo.
- **The capture popup** moves only by the small grip at its top, not by its text. Closing it returns you to the window you were in right before you clicked into it; if it never had the focus, nothing changes. No more "Nothing was selected" message.
- **Notes are pages**: the text sits under the note's name and fills the window, no box around it.
- **Move to** and the list picker show all your lists and scroll.
- **Starting Flint yourself** opens its window (only the start with Windows stays in the tray). Installing or updating takes one click and opens Flint at the end.
- The taskbar icon's leaf stays inside its tile; menus no longer keep a highlight after the mouse leaves; the text cursor appears only over text you can edit.

## 0.4.4 (31 Oct 2026)

- **Pickers** behind the flag, # and bell buttons, in the composer and in the capture popup: priority (or press 3/2/1/0), a list with search and recent lists, and a date/time picker (type "fri 10", pick a preset, or use the calendar). They fill in the same shorthand you could type, and replace what was there.
- **Turn a reminder off without deleting it**: click its bell. A line goes through the bell, the time turns faint, and it won't notify you; click again to turn it back on. Also in the task's right-click menu, with Undo.
- **Overdue reminders** read "Overdue · <time>" in brighter text with a small dot.
- **Brackets and quotes close themselves**: ( gives (), typing ) steps over it; also [], {}, quotes and backticks.
- Menus and pickers in the capture popup now always have room to open fully.

## 0.4.3 (31 Oct 2026)

- **Completing a task** plays a short animation before it moves to Completed, instead of just disappearing.
- **The Undo toast** always sits above the list; task text and hovered rows no longer cover it.
- **Switching lists** fades the content in, and the sidebar highlight glides to the list you opened.
- **A bigger taskbar icon**: the leaf now fills the square like other apps' icons. Reminder notifications show the Flint logo larger.
- **Stack traces** are recognised and highlighted in the capture popup in the common formats (.NET, Java, JavaScript, Python, Go), also when copied without indentation.
- No more cursor flicker around the composer's text box.

## 0.4.2 (31 Oct 2026)

- **Right-click menus** on tasks, lists, notes and the sidebar, and Cut / Copy / Paste / Select all in every text field (also in the capture popup). Shift+F10 or the Menu key opens a selected task's menu.
- **Delete** a task with Del or from its menu: it goes to Flint's trash folder, never lost, and Undo brings it back.
- **Move to another list** from a task's menu: search or pick a recent list, or type a new name.
- **Create, rename and delete lists and notes**: the + next to "Lists" or Ctrl+Shift+N. Deleted lists go to the trash folder too, with Undo.
- **Notes are editable** as plain text for now, saved as you type (the full note editor comes later).

## 0.4.1 (31 Oct 2026)

- **New fonts.** Onest for everything you read, FiraGO for Georgian text (only Georgian characters use it), Geist Mono kept for times and code.
- **Task titles show their formatting**: bold, italic, `code`, ~~strikethrough~~ and links instead of raw `**…**`. Click a link to open it in your browser; editing shows the raw text.
- **Calmer list**: the selection glides from row to row, new rows ease in, a hovered row no longer overlaps the selected one, the normal arrow cursor everywhere (the hand only on links), and a thin scrollbar at the window's edge.
- **A proper taskbar icon** that fills its slot like other apps' icons; the logo in the sidebar is a little bigger.
- Code pasted into the capture popup is highlighted in the new grayscale style.
- The Settings entry, which did nothing yet, is hidden until Settings exists.

## 0.4.0 (31 Oct 2026)

- **Reminders now notify you.** A reminder pops up as a Windows notification with Done, Snooze 10m and Open while Flint runs. Reminders that came due while Flint wasn't running or the PC slept show once at the next start, marked "Missed" (more than three at once: one "N reminders you missed" notification).
