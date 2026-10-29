# 03 — UX & Design Language

Flint should feel **calm, fast, and comfortable**. It is not a dashboard: it never dumps information on the user. This document defines how Flint looks, moves, and responds to input.

---

## 1. Design philosophy

- **Comfort over density.** Generous spacing, few elements per screen, nothing competing for attention. The user should feel relaxed opening Flint, not overwhelmed.
- **No clutter, ever.** Metadata stays hidden until it's useful: shown on hover/selection, or as a tiny indicator. A task row is primarily its text.
- **Meaning without reading.** State is communicated visually (priority stripe, bell, body indicator, check) instead of text labels.
- **Progressive disclosure.** One-line tasks expand into bodies; the Completed section collapses; settings stay in settings.
- **Speed is part of the design.** Nothing the user waits on should take longer than 100 ms; animations never exceed ~150 ms (see Motion).
- **Not a project-management tool.** If a UI element exists mainly to "manage" (fields, statuses, assignees), it does not belong (01, Non-goals).

---

## 2. Interaction model: Navigate vs Edit

Task lists are keyboard-driven, and single keys like **Space** and **1/2/3/0** are commands. But users also type spaces and digits *into* tasks. So every task list has two clearly distinct states:

| State | What's happening | Keys mean |
|---|---|---|
| **Navigate** | A row is *selected* (highlighted), no text cursor | Commands (Space completes, 3 sets high priority, ↑/↓ moves selection) |
| **Edit** | A text cursor is *inside* a task's text | Typing (Space is a space, 3 is a 3) |

- **Enter** or **click** on a task → Edit state. **Esc** → back to Navigate (with the same row selected).
- The **selected** row and the **row being edited** must look visibly different (e.g. selection = subtle background; editing = caret + slightly stronger outline).
- This is the same model as Things 3 and Vim, so it feels familiar to developers.

---

## 3. Keyboard map

**Decided** keys come from the agreed feature list. **Proposed** keys are defaults to implement unless changed (see Q-06/Q-08). All in-app keys should be shown in the `?` cheat sheet (NAV-02).

### Global (work from any app)
| Action | Key | Status |
|---|---|---|
| Open capture popup (CAP-01) | Rebindable; default see Q-03 | Decided (rebindable) |
| Capture selected text (CAP-07) | Rebindable; default see Q-03 | Decided (rebindable) |

### Capture popup
| Action | Key | Status |
|---|---|---|
| Save task and close | Enter | Decided |
| Close (draft kept) | Esc | Decided |
| Accept `#list` autocomplete | Tab / Enter while the suggestion menu is open | Proposed |
| New line in text | Shift+Enter | Proposed |
| Paste screenshot / stack trace / JSON | Ctrl+V | Decided (behaviour in CAP-06) |

### Task list — Navigate state
| Action | Key | Status |
|---|---|---|
| Move selection | ↑ / ↓ | Proposed |
| Extend selection (multi-select) | Shift+↑ / Shift+↓ | Decided |
| Reorder selected task(s) | Alt+↑ / Alt+↓ | Decided |
| Complete / un-complete | Space | Decided |
| Priority low / medium / high / none | 1 / 2 / 3 / 0 | Decided |
| Indent / outdent (one level max) | Tab / Shift+Tab | Decided (Tab indents once) |
| Edit selected task | Enter | Proposed (see Q-08) |
| New task | N (and Ctrl+N anywhere in the app) | Proposed (see Q-08) |
| Expand / collapse task body | → / ← | Proposed |
| Star to / unstar from Today | S | Proposed |
| Set reminder | R | Proposed |
| Move to list | via Ctrl+K / context menu; single key undecided | Q-06 |
| Delete (to Trash, undo toast) | Delete | Proposed |
| Temporary sort by priority | via Ctrl+K / list menu | Proposed |
| Back to Navigate / clear selection | Esc | Proposed |

### Task list — Edit state
| Action | Key | Status |
|---|---|---|
| Save and add a new task below | Enter | Decided ("Enter adds a task") |
| Back to Navigate | Esc | Decided |
| Indent / outdent | Tab / Shift+Tab | Decided |

### Everywhere in the main window
| Action | Key | Status |
|---|---|---|
| Command palette / fuzzy search | Ctrl+K | Decided |
| Keyboard cheat sheet | ? (Navigate state) | Decided |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y) | Undo decided; redo proposed |

### Note mode
| Action | Key | Status |
|---|---|---|
| Slash command menu | / | Decided |
| Formatting context menu | Right-click | Decided |
| Bold / italic / inline code / link | Ctrl+B / Ctrl+I / Ctrl+E / Ctrl+K inside a selection → link | Proposed (resolve Ctrl+K conflict: palette unless text is selected) |

### Mouse
- Drag rows to reorder; drag rows onto a sidebar list to move them.
- Click a task to edit; click the check to complete.
- Right-click a task: priority, star to Today, reminder, move, delete (**Proposed** menu).
- Shift+click / Ctrl+click for multi-select.

---

## 4. Visual language

### Palette
- **Cool palette only:** black, grays, blues, white, purple. **No warm colors, no greens** (brand decision, 01).
- Two themes: **dark** and **light**, plus "follow system".
- Every color is a theme token; no hard-coded colors in components.

### Priority styling (TASK-03)
- **None (default):** no stripe. Visually neutral.
- **Low / Medium / High:** a **thin left-edge stripe** on the row. The row itself is never tinted.
- A **second cue** besides color, so priority is readable without color perception: stripe **thickness** increases with priority (e.g. 2 / 3 / 4 px), optionally plus a tiny shape.
- A **color-blind-safe palette** option in settings.
- **Default priority colors:** must fit the cool-only brand palette. The originally discussed scheme was red/amber-style; it conflicts with "no warm colors." **Proposed default:** a cool scale with strong luminance differences — Low = slate gray, Medium = blue, High = vivid purple/violet — with thickness doing the heavy lifting for accessibility (blue vs purple can be confused by color-blind users). Final palette: Q-01.
- No priority text is shown on rows.

### Row anatomy (task list)
- Checkbox · task text · (tiny indicators, right-aligned and muted): body exists, attachment, bell (reminder), home-list label (only in Today), star (only if starred, **Proposed**).
- Indicators are small, monochrome, and low-contrast until hover/selection.
- Subtasks are indented one step; no tree lines.
- Long URLs are shown as smart titles and **never wrap** the row (TASK-10).

### Completed tasks
- Live in a collapsible **"Completed · N"** section at the bottom of the same list.
- Rendered muted (lower contrast, checked). **Proposed:** no strikethrough, to keep the section calm and readable.

### Typography
- A clean, highly readable sans-serif for UI and text; a monospace font for code blocks and for the monospace toggle (NOTE-06).
- Restraint in sizes and weights: one size for task text, a smaller muted size for indicators/metadata.

### Density
- **Comfortable** (default) and **Compact** settings. Compact reduces vertical padding only; it never adds information.

### Empty states
- Calm and short: one line of text and, at most, one hint (e.g. "Nothing here. Press Ctrl+N to add a task, or capture from anywhere with your hotkey.").
- No illustrations that compete for attention (**Proposed**: a very subtle monochrome mark at most).

### Toasts
- Small, bottom-anchored, short-lived, always with **Undo** where an action is reversible (completion, delete, move, multi-line paste "Keep as one?").
- Never a blocking confirmation dialog for reversible actions.

### Capture popup look
- Frameless, centered horizontally on the **active monitor**, in the upper third (Spotlight-like) (**Proposed** position).
- One input line (grows for pasted content), the chip preview row beneath, autocomplete menu when typing `#`.
- Background color matches the theme so it never flashes white/blank when shown (05).

### Mini mode look
- Small, always-on-top, minimal chrome. Shows Today or Inbox with a toggle; compact rows.

---

## 5. Motion

- **Spring animations** on drag-and-drop and reorder: snappy, physical, quick to settle.
- A **small, satisfying completion animation** (check + row moving to Completed).
- **Nothing slower than ~150 ms.** Motion must never make the user wait.
- **Respect OS reduce-motion** (APP-12): when the OS asks for reduced motion, spring and completion animations are disabled; state changes become instant.
- No decorative motion (no idle animations, no bouncing icons).

---

## 6. Accessibility

- Priority never relies on color alone (thickness/shape cue + color-blind-safe palette).
- Every action is keyboard-reachable; focus is always visible.
- Reduce-motion respected.
- **Proposed:** proper accessible names/roles for rows, checkboxes, and buttons so screen readers work.
- Sufficient text contrast in both themes.

---

## 7. Writing style (UI copy)

- Short, plain, friendly. No jargon in user-facing text.
- Tell the truth about limitations (e.g. admin-window capture, Focus Assist, "Flint must be running for reminders").
- The privacy promise is stated plainly: "Your notes never leave your machine."
