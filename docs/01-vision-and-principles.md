# 01 — Vision & Principles

## The problem

Developers constantly hit small, spontaneous things that must not be forgotten: a bug noticed while working on something else, an action item said out loud on a call, an error in a terminal, a "remember to check X tomorrow." At that moment they cannot stop and write a proper ticket.

Existing tools fail this moment:

- **Heavy tools** (ClickUp, Jira, and similar) are built for *managing* work. Creating an item means choosing a project, status, assignee, fields. By the time it's saved, the thought or the conversation has moved on.
- **Plain notes apps** capture fast but turn into an unstructured pile with no priority, order, or completion.

**Flint optimizes for the 3-second "write it down before I forget" moment**, then makes it calm and pleasant to work through what was captured.

## Target users

- Primarily **developers** (and technical people around them: DevOps, QA, tech leads).
- Typical situations:
  - On a call (often a full-screen Teams call) and need to note something without leaving the call.
  - Working on one thing, encountering a bug in another, and wanting to park it in seconds.
  - Writing down what to focus on today.
  - Keeping lightweight free-form notes (meeting notes, scratch notes) alongside tasks.

## Product principles

These principles decide every ambiguous case. When a feature request conflicts with them, the principle wins.

1. **Capture speed is the product.** Capturing must be faster than forgetting. Any extra step, decision, or delay in capture is a bug.
2. **Zero decisions at capture time.** Everything can land in Inbox with no choices. Sorting happens later, or never.
3. **Simple and minimal, not "lite Jira."** Flint is a place to write things down and work through them, not a project-management system. It must never become ClickUp or Jira.
4. **UI/UX comfort over information density.** Don't dump information on the user. Show what matters; hide the rest until asked for. Calm, uncluttered, beautiful.
5. **Meaning without reading.** Status like priority is shown visually (color + a second cue), not as extra text that clutters rows.
6. **Keyboard-first, mouse-friendly.** Every action is reachable from the keyboard; everything also works with mouse and drag-and-drop.
7. **Your files, your machine.** Data is plain markdown in a folder the user chooses. No server, no account, no telemetry. "Your notes never leave your machine."
8. **Never lose a thought.** Drafts persist, writes are atomic, deletes go to trash, everything is undoable, missed reminders are surfaced.
9. **Snappy and smooth.** Instant response (< 100 ms for anything the user waits on), short spring animations, nothing slower than ~150 ms.
10. **Respect the user's system.** Reduce-motion, accessibility (color-blind-safe priority), focus, monitor setup. (Following the system light/dark theme comes with light mode, Later; v1 is dark only, D-17.)

## Non-goals ("Not doing")

These are deliberately excluded. Every one of them will sound reasonable when requested; this list is what keeps Flint from becoming the tool it is escaping. Changing anything here requires an explicit entry in the [Decision Log](07-decision-log.md).

**Project-management features (never):**
- Assignees, owners, or any multi-user workflow.
- Statuses beyond done / not done (no "In progress", "Review", etc.).
- Due-date calendars, Gantt charts, calendar views.
- Comments or discussion threads.
- Nested projects, folders-within-folders hierarchies. (**D-73:** one level of collapsible sidebar groups, LIST-05, is allowed; they are not folders on disk. Nested groups and real folders still aren't.)
- Unlimited subtask nesting (max one level, see TASK-04).

**Explicitly skipped for this product:**
- **Recurring tasks and recurring reminders**: a deep rabbit hole of edge cases.
- **Tags in addition to lists**: two organizing systems double the cognitive load. Lists are the only organizing system.
- **Backlinks / graph view**: that is Obsidian's job.
- **Voice capture**: you can't speak while you're on the call that triggered the capture.
- **Time features beyond lightweight reminders/snooze**: reminders are the ceiling (see REM-*).

**Not in v1 (may be revisited later):**
- **Syncing of any kind** (OneDrive, cloud, server). See 04, "Future: sync".
- **Integrations** with other apps (planned later; see 05, "Future integration").

**Considered and not selected** (ideas raised during design that were *not* chosen; do not implement without a new decision):
- Auto-stamping captures with context (active git branch/repo, window title).
- "Copy as branch name" for tasks.
- "Add to last capture" (append to the previous capture's body within ~2 minutes).
- Region-screenshot capture hotkey.
- Permanent Scratchpad note.
- Note templates (e.g. `/bug`).
- Collapsible headings in notes.
- "Send selection to list" (highlighted note lines → tasks).
- Instant `/` filter within a list (Ctrl+K covers search).
- Standup copy ("Yesterday / Today" summary).
- "Now" pin (current task in mini mode header / tray tooltip).
- Workday-aware reminder defaults.
- "Reminder on unlock" (`@back`).

## Brand

- **Name:** Flint. (Trademark not yet formally cleared; see open questions.)
- **Palette direction:** cool colors only: black, grays, blues, white, purple. **No warm colors and no greens** in the brand/UI palette.
- **v1 UI palette (decided):** dark mode only, grayscale with one cool-gray accent `#9AA0AB` and white for emphasis. No purple in the UI. See [09](09-visual-design.md).
- **Logo direction:** a centered knapped-flint leaf shape, alone on a dark tile, in a light blue-gray palette with irregular flint shading. **Final file:** `assets/icon/flint-icon-512.svg`.
  - No sparkles, glows, or gradients (an earlier "spark" idea was dropped).
  - A carved-groove idea was dropped as unreadable at small sizes.
  - Must not resemble Obsidian's logo.
- **Promise to state plainly in the app and installer:** "Your notes never leave your machine."
