# What's new in Flint

What the app shows in its **What's new** card after an update (APP-15, D-117). Newest first. Each version gets 2–5 highlights in plain language: what's new and how to use it (e.g. "Mini mode for calls: Ctrl+Alt+Space"). No decision numbers, tests or file names; those stay in [`release-notes.md`](release-notes.md), the detailed log. Written with every version bump.

## 1.1.0 (8 Nov 2026)

- **Notes stay tidy while you write:** bullets, checkboxes, headings and pictures no longer turn into raw markdown just because the cursor is on their line. To edit one, press ← right after it (or → right before it), or right-click a picture and choose **Edit markdown**.
- **Source mode:** press **Ctrl+Shift+E** (or right-click → Source mode, or Ctrl+K) to see a note's raw markdown; press it again to go back. Flint remembers it per note.
- **Checklists in notes look like your tasks:** the same checkbox as the task list, and a ticked item is dimmed and struck through.
- **Ctrl+E** makes the selected word inline `code`. List numbers now look like the rest of the text.

## 1.0.1 (8 Nov 2026)

- **Smoother updates:** after Restart now, Flint steps out of the way at once and a notification tells you it reopens by itself in about a minute.

## 1.0.0 (8 Nov 2026)

- **Flint 1.0:** the first public release. Flint is open source now, at github.com/DavitKhachaturovi/flint.
- **Updates come by themselves:** a new version downloads in the background, and a small note offers Restart now or Later. Turn it off in Settings → About.
- **Everything so far, in one place:** quick capture over any app (Ctrl+Shift+Space), mini mode for calls (Ctrl+Alt+Space), your clipboard history beside your tasks (Ctrl+Shift+H), and Ctrl+K for every list, task and command.

## 0.9.3 (8 Nov 2026)

- **Safer quitting:** if you quit or restart for an update right after closing the capture popup, Flint first finishes saving your draft.

## 0.9.2 (8 Nov 2026)

- **Fix:** Flint always quits cleanly now, also right after you close the capture popup or restart for an update.

## 0.9.1 (7 Nov 2026)

- **Flint updates itself:** new versions download in the background and install when you restart Flint. When one is ready, a small note offers Restart now or Later.
- **Your choice:** Settings → About shows what's happening and has Check for updates; turn off "Check for updates automatically" and Flint only checks when you ask.

## 0.9.0 (7 Nov 2026)

- **Flint is open source:** it is now a personal project under the MIT licence, with its home on GitHub. Nothing changes in how you use it.

## 0.8.30 (7 Nov 2026)

- **Fix:** a list another program is still saving opens properly once its tasks arrive.

## 0.8.29 (7 Nov 2026)

- **Smoother all round:** pinning a task with P pops the pin, the / menu in notes fades in and out, and Settings panels and Trash ease away instead of vanishing.

## 0.8.28 (7 Nov 2026)

- **Privacy, in one line:** Settings → About now starts with it: your notes never leave your machine.

## 0.8.27 (7 Nov 2026)

- **Fixes:** the sidebar highlight lands on the right row after you delete a quick note, and an empty quick note you go back to stays put.

## 0.8.26 (7 Nov 2026)

- **Tidier attachments folder:** pasted pictures no longer leave a stray folder next to them.

## 0.8.25 (7 Nov 2026)

- **Back where you were:** a list you open again returns to where you left it, also on a slower PC.

## 0.8.24 (7 Nov 2026)

- **Pictures too:** pictures you copied show in the Clipboard section. Click one to paste it into a note.
- **Delete and Clear all:** right-click an item to delete it (from Win+V too, with Undo), or use Clear all next to the eye.
- **Copy without duplicates:** Copy now works like picking an item in Win+V.

## 0.8.23 (7 Nov 2026)

- **Your clipboard history, in Flint:** the side panel's Clipboard section lists what you copied (Windows' Win+V history). Click an item to paste it where your cursor is; right-click to make it a task or copy it again.
- **Safe for screen sharing:** items show as blank bars until you rest the pointer on the section. The eye button shows them always.
- **From the keyboard:** Ctrl+Shift+H opens Paste from clipboard history… Enter pastes, Shift+Enter makes a task, Ctrl+C copies.
- **Settings → Clipboard** turns it off or shows contents always.

## 0.8.22 (7 Nov 2026)

- **Getting ready for clipboard history:** press Ctrl+K and run "Check clipboard history" to see whether Flint can read Windows' clipboard history (the Win+V list). Flint only reads it; it never changes or records your clipboard.

## 0.8.21 (7 Nov 2026)

- **What's new** sits comfortably in the middle of the window.

## 0.8.20 (7 Nov 2026)

- **What's new stands out:** the app dims behind this card until you press Got it.
- **The tour stays out of your way:** its card moves aside when a quick note opens, so you can see what you type.
- **Tips:** up to two a session, never back to back.

## 0.8.19 (7 Nov 2026)

- **Pickers:** type to narrow a list and press Enter: it always takes the top match.

## 0.8.18 (7 Nov 2026)

- **Tips:** now and then Flint suggests a quicker way to do what you just did, in a small card in the corner. Turn them off with "Don't show tips", or bring them back in Settings → About → Reset tips.

## 0.8.17 (7 Nov 2026)

- **Pin from the row:** hover a task and click the faint pin to put it on Today.
- **Any note in mini mode:** in mini's Note tab, ⋯ → "Open a note…" finds any note or quick note.
- **The tour, smoother:** it stays in view while you try the capture popup, and a quick note only counts once you've written something in it.

## 0.8.16 (6 Nov 2026)

- **A short tour:** eight steps through capturing, shorthand, lists, Today, reminders, the palette and mini mode. Replay it any time from Settings → General, or Ctrl+K → "Replay walkthrough".
- **Mini mode for calls:** Ctrl+Alt+Space opens a small Flint that stays on top and is hidden when you share your screen.
- **Sort your Inbox:** press T in Inbox and go through it one task at a time: M moves, Space completes, P pins, R sets a reminder.
- **Everything from the keyboard:** Ctrl+K finds any list, task or command; press ? to see every shortcut.
- **Settings in one place:** your Flint folder, hotkeys, reminders, link patterns, snapshots and the interface size.
