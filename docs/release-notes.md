# Flint release notes

Short notes for every build handed out (APP-15, D-64). The app shows them as "What's new" from M8. Newest first.

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
