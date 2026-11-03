# Flint release notes

Short notes for every build handed out (APP-15, D-64). The app shows them as "What's new" from M8. Newest first.

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
