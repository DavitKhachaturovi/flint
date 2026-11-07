# Flint release notes

Detailed notes for every build handed out (D-64). Newest first. The app's What's new card shows the shorter, plain-language [`whats-new.md`](whats-new.md) instead (D-117).

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

Versions now follow the milestone: 0.8 is M8 (polish), and 1.0 is the first release for coworkers.

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
