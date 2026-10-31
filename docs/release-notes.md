# Flint release notes

Short notes for every build handed out (APP-15, D-64). The app shows them as "What's new" from M8. Newest first.

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
